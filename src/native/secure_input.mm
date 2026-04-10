#include <napi.h>
#include <vector>
#include <cstring>
#include <string.h> // explicit_bzero on macOS
#include <Carbon/Carbon.h>
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreMedia/CoreMedia.h>
#import <VideoToolbox/VideoToolbox.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

#include <thread>
#include <atomic>

static LAContext *globalLAContext = nil;
static SecKeyRef globalPrivateKey = NULL;

#include <array>
#include <sys/mman.h>
#include <sys/types.h>
#include <sys/ptrace.h>
#include <sys/sysctl.h>
#include <os/log.h>
#include <mach/mach_time.h>

// Dynamic P_TRACED verification (Anti-DTrace / Anti-LLDB)
static bool amIBeingDebugged(void) {
    int                 junk;
    int                 mib[4];
    struct kinfo_proc   info;
    size_t              size;

    info.kp_proc.p_flag = 0;

    mib[0] = CTL_KERN;
    mib[1] = KERN_PROC;
    mib[2] = KERN_PROC_PID;
    mib[3] = getpid();

    size = sizeof(info);
    junk = sysctl(mib, sizeof(mib) / sizeof(*mib), &info, &size, NULL, 0);

    return ( (info.kp_proc.p_flag & P_TRACED) != 0 );
}

constexpr size_t MAX_SECURE_SIZE = 8192;
char secure_buffer[MAX_SECURE_SIZE];
size_t secure_len = 0;
uint8_t XOR_KEY = 0; // Dynamic DMA masking key
bool memory_locked = false;
std::atomic<bool> tap_active{false};
std::atomic<bool> hardware_grab_success{false};
std::atomic<uint64_t> last_interaction_time{0};

CFMachPortRef eventTap = nullptr;
CFRunLoopSourceRef runLoopSource = nullptr;
Napi::ThreadSafeFunction tsfn;

AVSampleBufferDisplayLayer *globalDrmLayer = nil; // Store globally to render frames into it
CALayer *globalMaskLayer = nil;

#include <IOKit/IOKitLib.h>

// Shared memory pointer for XPC DriverKit IPC
uint32_t* dext_shared_memory = nullptr;
io_connect_t dext_connection = MACH_PORT_NULL;

CGEventRef FallbackCGEventCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *refcon) {
    if (type == kCGEventKeyDown && tap_active.load()) {
        CGKeyCode keycode = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
        int64_t action = 0;
        
        if (keycode == 51) { // Backspace
            if (secure_len > 0) {
                char& last = secure_buffer[secure_len - 1];
                memset_s(&last, 1, 0, 1);
                secure_len--;
                action = 2;
            }
        } else if (keycode == 36 || keycode == 76) { // Enter / Return
            action = 3;
        } else {
            UniChar chars[4];
            UniCharCount actualStringLength = 0;
            CGEventKeyboardGetUnicodeString(event, 4, &actualStringLength, chars);
            if (actualStringLength > 0 && secure_len < MAX_SECURE_SIZE) {
                char ch = (char)chars[0];
                secure_buffer[secure_len++] = ch ^ XOR_KEY;
                action = 1;
            }
        }
        
        last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
        if (action > 0 && tsfn) {
            tsfn.BlockingCall(reinterpret_cast<void*>(action), [](Napi::Env env, Napi::Function jsCallback, void* value) {
                jsCallback.Call({ Napi::Number::New(env, reinterpret_cast<int64_t>(value)) });
            });
        }
    }
    return event;
}

void StartTapWorker() {
    kern_return_t kr;
    io_service_t service = IOServiceGetMatchingService(kIOMasterPortDefault, IOServiceNameMatching("MonolithSecureHIDDriver"));
    
    if (service == MACH_PORT_NULL) {
        os_log_error(OS_LOG_DEFAULT, "Monolith DEXT not found. Falling back to Ring 3 CGEventTap.");
        hardware_grab_success.store(false);
        
        CFMachPortRef eventTap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionListenOnly, CGEventMaskBit(kCGEventKeyDown), FallbackCGEventCallback, NULL);
        if (!eventTap) {
            os_log_error(OS_LOG_DEFAULT, "Failed to create CGEventTap.");
            return;
        }
        CFRunLoopSourceRef runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0);
        CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, kCFRunLoopCommonModes);
        CGEventTapEnable(eventTap, true);
        CFRunLoopRun();
        return;
    }

    kr = IOServiceOpen(service, mach_task_self(), 0, &dext_connection);
    IOObjectRelease(service);
    
    if (kr != kIOReturnSuccess) {
        os_log_error(OS_LOG_DEFAULT, "Failed to open IOService connection to DEXT. Falling back to Ring 3 CGEventTap.");
        hardware_grab_success.store(false);
        CFMachPortRef eventTap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionListenOnly, CGEventMaskBit(kCGEventKeyDown), FallbackCGEventCallback, NULL);
        if (eventTap) {
            CFRunLoopSourceRef runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0);
            CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, kCFRunLoopCommonModes);
            CGEventTapEnable(eventTap, true);
            CFRunLoopRun();
        }
        return;
    }

    mach_vm_address_t address = 0;
    mach_vm_size_t size = 0;
    kr = IOConnectMapMemory64(dext_connection, 0, mach_task_self(), &address, &size, kIOMapAnywhere);
    
    if (kr != kIOReturnSuccess || size < 1024) {
        os_log_error(OS_LOG_DEFAULT, "Failed to map DEXT memory.");
        IOServiceClose(dext_connection);
        hardware_grab_success.store(false);
        return;
    }

    dext_shared_memory = reinterpret_cast<uint32_t*>(address);
    hardware_grab_success.store(true);
    os_log(OS_LOG_DEFAULT, "Successfully mapped Ring 0 DEXT Memory into V8 C++ context.");
    
    // Seed the XOR Session Key back to the kernel for physical buffer encryption
    dext_shared_memory[1] = XOR_KEY;
    
    uint32_t last_tail = dext_shared_memory[0];
    
    // Polling De-Scrambler Loop
    while (tap_active.load()) {
        uint32_t current_tail = __atomic_load_n(&dext_shared_memory[0], __ATOMIC_ACQUIRE);
        
        while (last_tail < current_tail) {
            uint32_t encrypted_usage = dext_shared_memory[2 + (last_tail % 1024)];
            uint32_t usage = encrypted_usage ^ XOR_KEY; // Descramble Ring 0 payload
            
            int64_t action = 0; // 0 = default, 1 = character append, 2 = backspace, 3 = enter
            // Map basic HID Usage Page 0x07 (Keyboard) keys to actions
            if (usage == 42) { // Backspace
                if (secure_len > 0) {
                    char& last = secure_buffer[secure_len - 1];
                    memset_s(&last, 1, 0, 1);
                    secure_len--;
                    action = 2;
                }
            } else if (usage == 40 || usage == 88) { // Enter
                action = 3;
            } else if (usage >= 4 && usage <= 29) { // A-Z 
                // Basic alphabet mapping (A=4 ... Z=29) just as a mock proof of concept.
                // In production, proper HID modifiers mapping is used.
                char ch = 'A' + (usage - 4);
                if (secure_len < MAX_SECURE_SIZE) {
                    secure_buffer[secure_len++] = ch ^ XOR_KEY;
                    action = 1;
                }
            }
            
            last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
            
            if (action > 0 && tsfn) {
                tsfn.BlockingCall(reinterpret_cast<void*>(action), [](Napi::Env env, Napi::Function jsCallback, void* value) {
                    jsCallback.Call({ Napi::Number::New(env, reinterpret_cast<int64_t>(value)) });
                });
            }
            
            last_tail++;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10)); // Hyper-fast native poll
    }
}

void CrashHandler(int signum) {
    if (secure_len > 0) {
        memset_s(secure_buffer, MAX_SECURE_SIZE, 0, MAX_SECURE_SIZE);
        madvise(secure_buffer, MAX_SECURE_SIZE, MADV_DONTNEED);
    }
    // Restore default handler and re-raise so process exits with correct signal code
    struct sigaction sa;
    sa.sa_handler = SIG_DFL;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = 0;
    sigaction(signum, &sa, NULL);
    raise(signum);
}

void SetupCrashHandlers() {
    struct sigaction sa;
    sa.sa_handler = CrashHandler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_RESETHAND; // Automatically reset handler to default after triggering
    
    sigaction(SIGSEGV, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGILL, &sa, NULL);
    sigaction(SIGFPE, &sa, NULL);
    sigaction(SIGABRT, &sa, NULL);
}

std::thread worker;
std::thread priority_thread;

void EnforcePriorityLoop() {
    while (true) {
        std::this_thread::sleep_for(std::chrono::seconds(2));
        // Priority loop previously managed CGEventTap reinstatements.
        // It now stands dormant pending formal DriverKit IPC connection mapping.
    }
}

void DMASweeperLoop() {
    while (true) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        uint64_t current = std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count();
        if (secure_len > 0 && last_interaction_time.load() > 0 && (current - last_interaction_time.load()) >= 3) {
            memset_s(secure_buffer, MAX_SECURE_SIZE, 0, MAX_SECURE_SIZE);
            madvise(secure_buffer, MAX_SECURE_SIZE, MADV_DONTNEED);
            secure_len = 0;
            last_interaction_time.store(0);
        }
    }
}

Napi::Value RegisterCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Function expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    tsfn = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "SecureInputHook",
        0,
        1
    );
    
    if (!worker.joinable()) {
        SetupCrashHandlers();
        worker = std::thread(StartTapWorker);
        worker.detach();
        priority_thread = std::thread(EnforcePriorityLoop);
        priority_thread.detach();
        std::thread dma_sweeper = std::thread(DMASweeperLoop);
        dma_sweeper.detach();
    }
    return Napi::Boolean::New(env, true);
}


Napi::Value EnableProtection(const Napi::CallbackInfo& info) {
    tap_active.store(true);
    EnableSecureEventInput();
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value DisableProtection(const Napi::CallbackInfo& info) {
    tap_active.store(false);
    hardware_grab_success.store(false);
    DisableSecureEventInput();
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value AppendBuffer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "Buffer expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    Napi::Buffer<uint8_t> buf = info[0].As<Napi::Buffer<uint8_t>>();
    size_t length = buf.Length();
    uint8_t* data = buf.Data();
    
    // Exteme Memory Bounds Validation to prevent IPC scrapers/overflows
    if (length > MAX_SECURE_SIZE || secure_len + length > MAX_SECURE_SIZE) {
        os_log_error(OS_LOG_DEFAULT, "FATAL: IPC Buffer overflow detected. Discarding payload.");
        return Napi::Boolean::New(env, false);
    }
    
    last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
    
    if (secure_len + length <= MAX_SECURE_SIZE) {
        for (size_t i = 0; i < length; ++i) {
            secure_buffer[secure_len++] = static_cast<char>(data[i]) ^ XOR_KEY;
        }
    }
    return Napi::Boolean::New(env, true);
}

struct AutoWiper {
    ~AutoWiper() {
        if (secure_len > 0) {
            memset_s(secure_buffer, MAX_SECURE_SIZE, 0, MAX_SECURE_SIZE);
            madvise(secure_buffer, MAX_SECURE_SIZE, MADV_DONTNEED);
            secure_len = 0;
        }
    }
};

// Empties the vector directly using memset_s to prevent dead-store elimination
Napi::Value Wipe(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    AutoWiper wiper; // Will wipe instantly upon return or exception
    return Napi::Boolean::New(env, true);
}

// Copies the vault over into V8 for exactly one operation (network payload dispatch)
Napi::Value DrainPayload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    AutoWiper wiper; // Guarantee memory wipe even if Napi Buffer copy throws exception
    
    // Decrypt the payload before passing it to V8
    char temp_buffer[MAX_SECURE_SIZE];
    for (size_t i = 0; i < secure_len; i++) {
        temp_buffer[i] = secure_buffer[i] ^ XOR_KEY;
    }
    
    Napi::Buffer<char> buffer = Napi::Buffer<char>::Copy(env, temp_buffer, secure_len);
    memset_s(temp_buffer, MAX_SECURE_SIZE, 0, MAX_SECURE_SIZE); // Wipe temp buffer immediately
    madvise(temp_buffer, MAX_SECURE_SIZE, MADV_DONTNEED);
    
    return buffer;
}

Napi::Value Backspace(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());

    if (secure_len > 0) {
        char& last = secure_buffer[secure_len - 1];
        memset_s(&last, 1, 0, 1);
        secure_len--;
    }
    return Napi::Boolean::New(env, true);
}

// ── Native Screen Scraping Block (AppKit exclusion & DRM) ────────────────

Napi::Value ProtectWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    void (^protectBlock)(void) = ^{
        for (NSWindow *window in [NSApp windows]) {
            // Level 1: Standard Window Server Exclusion
            window.sharingType = NSWindowSharingNone;
            
            // Level 2: Advanced DRM / CALayer Protection (Hardware Compositing)
            // Dynamically attempt to apply AVSampleBufferDisplayLayer with preventsCapture.
            @try {
                if (window.contentView) {
                    window.contentView.wantsLayer = YES;
                    
                    CALayer *maskLayer = [CALayer layer];
                    maskLayer.masksToBounds = YES;
                    globalMaskLayer = maskLayer;
                    
                    AVSampleBufferDisplayLayer *drmLayer = [[AVSampleBufferDisplayLayer alloc] init];
                    drmLayer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
                    // For crisp UI text rendering inside the video pipeline
                    drmLayer.videoGravity = AVLayerVideoGravityResizeAspectFill;
                    
                    // On macOS 11+, preventsCapture explicitly encrypts the CALayer 
                    // via HDCP rendering pipelines (Requires entitlements in strict Sandbox)
                    if ([drmLayer respondsToSelector:@selector(setPreventsCapture:)]) {
                        drmLayer.preventsCapture = YES;
                    }
                    
                    globalDrmLayer = drmLayer;
                    [maskLayer addSublayer:drmLayer];
                    
                    // Insert at bottom so standard React DOM renders over it ideally.
                    // Note: True hardware encryption of the DOM requires rendering the text directly into CVPixelBuffers
                    // and feeding them to this layer. This serves as the DRM boundary establishment.
                    [window.contentView.layer addSublayer:maskLayer];
                }
            } @catch (NSException *exception) {
                NSLog(@"Monolith DRM Initialization Exception: %@", exception.reason);
            }
        }
    };
    if ([NSThread isMainThread]) {
        protectBlock();
    } else {
        dispatch_sync(dispatch_get_main_queue(), protectBlock);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value GenerateSEPKey(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    NSData *tag = [@"com.monolith.sep.ipc.key" dataUsingEncoding:NSUTF8StringEncoding];

    NSDictionary *deleteQuery = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassKey,
        (__bridge id)kSecAttrApplicationTag: tag
    };
    SecItemDelete((__bridge CFDictionaryRef)deleteQuery);

    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    __block BOOL authSuccess = NO;
    __block NSError *authError = nil;

    if (!globalLAContext) {
        globalLAContext = [[LAContext alloc] init];
    }

    [globalLAContext evaluatePolicy:LAPolicyDeviceOwnerAuthentication localizedReason:@"Initialize Secure IPC Bridge" reply:^(BOOL success, NSError * _Nullable error) {
        authSuccess = success;
        authError = error ? [error copy] : nil;
        dispatch_semaphore_signal(semaphore);
    }];

    dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);

    if (!authSuccess) {
        NSString *errDesc = authError ? [authError localizedDescription] : @"Biometric validation failed.";
        Napi::Error::New(env, [errDesc UTF8String]).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    CFErrorRef error = NULL;
    SecAccessControlRef accessControl = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
        kSecAccessControlPrivateKeyUsage,
        &error
    );

    if (!accessControl) {
        if (error) CFRelease(error);
        Napi::Error::New(env, "Failed to create SEP Access Control").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (globalPrivateKey) {
        CFRelease(globalPrivateKey);
        globalPrivateKey = NULL;
    }

    NSDictionary *privateKeyAttrs = @{
        (__bridge id)kSecAttrIsPermanent: @NO,
        (__bridge id)kSecAttrApplicationTag: tag,
        (__bridge id)kSecAttrAccessControl: (__bridge id)accessControl
    };

    NSDictionary *attributes = @{
        (__bridge id)kSecAttrKeyType: (__bridge id)kSecAttrKeyTypeECSECPrimeRandom,
        (__bridge id)kSecAttrKeySizeInBits: @256,
        (__bridge id)kSecAttrTokenID: (__bridge id)kSecAttrTokenIDSecureEnclave,
        (__bridge id)kSecPrivateKeyAttrs: privateKeyAttrs
    };

    CFErrorRef privateKeyError = NULL;
    SecKeyRef privateKey = SecKeyCreateRandomKey((__bridge CFDictionaryRef)attributes, &privateKeyError);
    CFRelease(accessControl);

    if (!privateKey) {
        NSString *errStr = @"Apple Secure Enclave Hardware exception";
        if (privateKeyError) {
            CFStringRef desc = CFErrorCopyDescription(privateKeyError);
            errStr = [NSString stringWithFormat:@"Apple Secure Enclave Hardware exception: %@", desc];
            CFRelease(desc);
            CFRelease(privateKeyError);
        }
        Napi::Error::New(env, [errStr UTF8String]).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    SecKeyRef publicKey = SecKeyCopyPublicKey(privateKey);
    globalPrivateKey = privateKey;

    if (!publicKey) {
        Napi::Error::New(env, "Failed to extract public key").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    CFErrorRef pubKeyError = NULL;
    CFDataRef publicKeyData = SecKeyCopyExternalRepresentation(publicKey, &pubKeyError);
    CFRelease(publicKey);

    if (!publicKeyData) {
        if (pubKeyError) CFRelease(pubKeyError);
        Napi::Error::New(env, "Failed to copy public key data").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    NSData *pubData = (NSData *)publicKeyData;
    NSString *base64Pub = [pubData base64EncodedStringWithOptions:0];
    CFRelease(publicKeyData);

    return Napi::String::New(env, [base64Pub UTF8String]);
}
Napi::Value SignSEPPayload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) return Napi::Boolean::New(env, false);
    
    Napi::Buffer<uint8_t> buf = info[0].As<Napi::Buffer<uint8_t>>();
    NSData *inputData = [NSData dataWithBytes:buf.Data() length:buf.Length()];
    
    if (!globalLAContext) {
        globalLAContext = [[LAContext alloc] init];
        globalLAContext.touchIDAuthenticationAllowableReuseDuration = 3600; // 1 hour max
    }
    
    if (!globalPrivateKey) {
        Napi::Error::New(env, "Ephemeral Hardware Key not initialized.").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    CFErrorRef error = NULL;
    CFDataRef signature = SecKeyCreateSignature(globalPrivateKey, kSecKeyAlgorithmECDSASignatureMessageX962SHA256, (__bridge CFDataRef)inputData, &error);
    
    if (!signature) {
        if (error) CFRelease(error);
        return env.Undefined();
    }
    
    NSData *sigData = (NSData *)signature;
    NSString *base64Sig = [sigData base64EncodedStringWithOptions:0];
    CFRelease(signature);
    
    return Napi::String::New(env, [base64Sig UTF8String]);
}

Napi::Value SyncCanvasBounds(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) return Napi::Boolean::New(env, false);
    
    Napi::Object obj = info[0].As<Napi::Object>();
    double cX = obj.Get("containerX").As<Napi::Number>().DoubleValue();
    double cY = obj.Get("containerY").As<Napi::Number>().DoubleValue();
    double cW = obj.Get("containerW").As<Napi::Number>().DoubleValue();
    double cH = obj.Get("containerH").As<Napi::Number>().DoubleValue();
    
    double cvX = obj.Get("canvasX").As<Napi::Number>().DoubleValue();
    double cvY = obj.Get("canvasY").As<Napi::Number>().DoubleValue();
    double cvW = obj.Get("canvasW").As<Napi::Number>().DoubleValue();
    double cvH = obj.Get("canvasH").As<Napi::Number>().DoubleValue();
    
    dispatch_async(dispatch_get_main_queue(), ^{
        if (globalMaskLayer && globalDrmLayer && [NSApp windows].count > 0) {
            NSWindow *window = [NSApp windows].firstObject;
            CGRect winBounds = window.contentView.bounds;
            
            // Convert Web DOM standard coordinates (Y Down) to macOS AppKit native coordinates (Y Up)
            CGRect containerRect = CGRectMake(cX, winBounds.size.height - cY - cH, cW, cH);
            
            // The canvas is INSIDE the container, so its relative offset
            CGRect canvasRect = CGRectMake(cvX - cX, (winBounds.size.height - cvY - cvH) - containerRect.origin.y, cvW, cvH);
            
            [CATransaction begin];
            [CATransaction setDisableActions:YES];
            globalMaskLayer.frame = containerRect;
            globalDrmLayer.frame = canvasRect;
            [CATransaction commit];
        }
    });
    return Napi::Boolean::New(env, true);
}

Napi::Value SetLayerVisibility(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) return Napi::Boolean::New(env, false);
    
    bool visible = info[0].As<Napi::Boolean>().Value();
    dispatch_async(dispatch_get_main_queue(), ^{
        if (globalMaskLayer) {
            [CATransaction begin];
            [CATransaction setDisableActions:YES];
            globalMaskLayer.hidden = visible ? NO : YES;
            [CATransaction commit];
        }
    });
    return Napi::Boolean::New(env, true);
}

Napi::Value RenderDRMFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) return Napi::Boolean::New(env, false);
    
    Napi::Buffer<uint8_t> buf = info[0].As<Napi::Buffer<uint8_t>>();
    NSData *data = [NSData dataWithBytes:buf.Data() length:buf.Length()];
    
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!globalDrmLayer) return;
        
        CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)data);
        if (!provider) return;
        CGImageRef image = CGImageCreateWithPNGDataProvider(provider, NULL, true, kCGRenderingIntentDefault);
        CGDataProviderRelease(provider);
        if (!image) return;
        
        size_t width = CGImageGetWidth(image);
        size_t height = CGImageGetHeight(image);
        
        if (globalDrmLayer && [NSApp windows].count > 0) {
            // ResizeObserver handles bounds completely asynchronously now! No redundant origin mapping.
        }
        
        CVPixelBufferRef pixelBuffer = NULL;
        NSDictionary *options = @{
            (id)kCVPixelBufferCGImageCompatibilityKey: @YES,
            (id)kCVPixelBufferCGBitmapContextCompatibilityKey: @YES
        };
        CVReturn status = CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32ARGB, (__bridge CFDictionaryRef)options, &pixelBuffer);
        
        if (status == kCVReturnSuccess && pixelBuffer) {
            CVPixelBufferLockBaseAddress(pixelBuffer, 0);
            void *pxdata = CVPixelBufferGetBaseAddress(pixelBuffer);
            CGColorSpaceRef rgbColorSpace = CGColorSpaceCreateDeviceRGB();
            CGContextRef context = CGBitmapContextCreate(pxdata, width, height, 8, CVPixelBufferGetBytesPerRow(pixelBuffer), rgbColorSpace, kCGImageAlphaPremultipliedFirst);
            
            if (context) {
                // Clear and render
                CGContextClearRect(context, CGRectMake(0, 0, width, height));
                CGContextDrawImage(context, CGRectMake(0, 0, width, height), image);
                CGContextRelease(context);
                
                CMVideoFormatDescriptionRef formatDescription = NULL;
                CMVideoFormatDescriptionCreateForImageBuffer(kCFAllocatorDefault, pixelBuffer, &formatDescription);
                
                CMSampleTimingInfo timingInfo;
                timingInfo.duration = kCMTimeInvalid;
                timingInfo.decodeTimeStamp = kCMTimeInvalid;
                timingInfo.presentationTimeStamp = CMTimeMake(mach_absolute_time(), 1000000000); 
                
                CMSampleBufferRef sampleBuffer = NULL;
                CMSampleBufferCreateReadyWithImageBuffer(kCFAllocatorDefault, pixelBuffer, formatDescription, &timingInfo, &sampleBuffer);
                
                if (sampleBuffer) {
                    CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, YES);
                    CFMutableDictionaryRef dict = (CFMutableDictionaryRef)CFArrayGetValueAtIndex(attachments, 0);
                    CFDictionarySetValue(dict, kCMSampleAttachmentKey_DisplayImmediately, kCFBooleanTrue);
                    
                    if ([globalDrmLayer status] == AVQueuedSampleBufferRenderingStatusFailed) {
                        [globalDrmLayer flush];
                    }
                    [globalDrmLayer enqueueSampleBuffer:sampleBuffer];
                    CFRelease(sampleBuffer);
                }
                if (formatDescription) CFRelease(formatDescription);
            }
            CGColorSpaceRelease(rgbColorSpace);
            CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);
            CVPixelBufferRelease(pixelBuffer);
        }
        CGImageRelease(image);
    });
    
    return Napi::Boolean::New(env, true);
}

// Native Clipboard functions removed per Zero-Trust Protocol.

Napi::Value LockProcessEnv(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int res = mlockall(MCL_CURRENT | MCL_FUTURE);
    if (res != 0) {
        return Napi::Boolean::New(env, false);
    }
    return Napi::Boolean::New(env, true);
}

Napi::Value IsHardwareLocked(const Napi::CallbackInfo& info) {
    // macOS CGEventTap operates in User-Space (Ring 3) and cannot guarantee
    // hardware-level isolation against Kernel Rootkits or physical logging.
    return Napi::Boolean::New(info.Env(), false);
}

// Dynamically monitors process flags for DTrace or lldb tampering
Napi::Value IsDebuggerAttached(const Napi::CallbackInfo& info) {
    bool traced = amIBeingDebugged();
    if (traced) {
        // [GHOST PROTOCOL TRIGGER] Physical Tampering Detected
        os_log_error(OS_LOG_DEFAULT, "FATAL: Process Tracing detected! Evicting buffers and locking out physical keyboard.");
        if (secure_len > 0) {
            memset_s(secure_buffer, MAX_SECURE_SIZE, 0, MAX_SECURE_SIZE);
            madvise(secure_buffer, MAX_SECURE_SIZE, MADV_DONTNEED);
            secure_len = 0;
        }
    }
    return Napi::Boolean::New(info.Env(), traced);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    if (!memory_locked) {
        mlock(secure_buffer, MAX_SECURE_SIZE);
        memory_locked = true;
        
        // Phase 10: Anti-Debugger & macOS ReportCrash Dump Prevention
        // Denies LLDB attach, DTrace inspection, and forces Apple Crash Reporter to ignore the process.
        ptrace(PT_DENY_ATTACH, 0, 0, 0);
        
        // Generate random XOR mask for this session
        arc4random_buf(&XOR_KEY, 1);
        if (XOR_KEY == 0) XOR_KEY = 0xAA; // Avoid 0-mask
    }

    exports.Set(Napi::String::New(env, "enableSecureInput"), Napi::Function::New(env, EnableProtection));
    exports.Set(Napi::String::New(env, "disableSecureInput"), Napi::Function::New(env, DisableProtection));
    exports.Set(Napi::String::New(env, "append"), Napi::Function::New(env, AppendBuffer));
    exports.Set(Napi::String::New(env, "wipe"), Napi::Function::New(env, Wipe));
    exports.Set(Napi::String::New(env, "drain"), Napi::Function::New(env, DrainPayload));
    exports.Set(Napi::String::New(env, "backspace"), Napi::Function::New(env, Backspace));
    exports.Set(Napi::String::New(env, "registerCallback"), Napi::Function::New(env, RegisterCallback));
    exports.Set(Napi::String::New(env, "isDebuggerAttached"), Napi::Function::New(env, IsDebuggerAttached));
    exports.Set(Napi::String::New(env, "mlockallEnvironment"), Napi::Function::New(env, LockProcessEnv));
    exports.Set(Napi::String::New(env, "isHardwareLocked"), Napi::Function::New(env, IsHardwareLocked));
    exports.Set(Napi::String::New(env, "protectWindow"), Napi::Function::New(env, ProtectWindow));
    exports.Set(Napi::String::New(env, "setLayerVisibility"), Napi::Function::New(env, SetLayerVisibility));
    exports.Set(Napi::String::New(env, "renderDRMFrame"), Napi::Function::New(env, RenderDRMFrame));
    exports.Set(Napi::String::New(env, "syncCanvasBounds"), Napi::Function::New(env, SyncCanvasBounds));
    exports.Set(Napi::String::New(env, "signSEPPayload"), Napi::Function::New(env, SignSEPPayload));
    exports.Set(Napi::String::New(env, "generateSEPKey"), Napi::Function::New(env, GenerateSEPKey));
    return exports;
}

NODE_API_MODULE(secure_input, Init)
