#include <napi.h>
#include <vector>
#include <cstring>
#include <string.h> // explicit_bzero on macOS
#include <Carbon/Carbon.h>
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <thread>
#include <atomic>

#include <array>
#include <sys/mman.h>
#include <sys/types.h>
#include <sys/ptrace.h>

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

CGEventRef HookCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void* refcon) {
    if (!tap_active.load()) return event;

    if (type == kCGEventKeyDown) {
        CGEventFlags flags = CGEventGetFlags(event);
        CGKeyCode keycode = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
        
        // Block Cmd+V (Paste) natively
        if (keycode == 9 && (flags & kCGEventFlagMaskCommand)) {
            return NULL;
        }

        int64_t action = 0; // 0 = default, 1 = character append, 2 = backspace, 3 = enter
        
        if (keycode == 51) { // Backspace
            if (secure_len > 0) {
                char& last = secure_buffer[secure_len - 1];
                memset_s(&last, 1, 0, 1);
                secure_len--;
                action = 2;
                last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
            }
        } else if (keycode == 36 || keycode == 76) { // Return / Enter
            action = 3;
        } else {
            // Translate keycode to character
            UniChar chars[4];
            UniCharCount actualStringLength = 0;
            CGEventKeyboardGetUnicodeString(event, 4, &actualStringLength, chars);
            
            if (actualStringLength > 0 && secure_len < MAX_SECURE_SIZE) {
                // Approximate unichar -> char via utf8 for standard ascii
                // To avoid heap str evaluation, simply downcast if it's < 128
                char ch = (char)(chars[0] & 0xFF);
                secure_buffer[secure_len++] = ch ^ XOR_KEY;
                action = 1;
                last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
            }
        }
        
        if (action > 0 && tsfn) {
            tsfn.BlockingCall(reinterpret_cast<void*>(action), [](Napi::Env env, Napi::Function jsCallback, void* value) {
                jsCallback.Call({ Napi::Number::New(env, reinterpret_cast<int64_t>(value)) });
            });
            return NULL; // Swallow keystroke!
        }
    }
    return event;
}

void StartTapWorker() {
    CGEventMask eventMask = CGEventMaskBit(kCGEventKeyDown);
    eventTap = CGEventTapCreate(kCGHIDEventTap, kCGHeadInsertEventTap, static_cast<CGEventTapOptions>(0), eventMask, HookCallback, nullptr);
    if (!eventTap) {
        hardware_grab_success.store(false);
        return;
    }
    hardware_grab_success.store(true);
    
    runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0);
    CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, kCFRunLoopCommonModes);
    CGEventTapEnable(eventTap, true);
    
    CFRunLoopRun();
}

void CrashHandler(int signum) {
    if (secure_len > 0) {
        memset_s(secure_buffer, MAX_SECURE_SIZE, 0, MAX_SECURE_SIZE);
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
        if (tap_active.load() && eventTap) {
            if (!CGEventTapIsEnabled(eventTap)) {
                CGEventTapEnable(eventTap, true);
            }
        }
    }
}

void DMASweeperLoop() {
    while (true) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        uint64_t current = std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count();
        if (secure_len > 0 && last_interaction_time.load() > 0 && (current - last_interaction_time.load()) >= 3) {
            memset_s(secure_buffer, MAX_SECURE_SIZE, 0, MAX_SECURE_SIZE);
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
        priority_thread = std::thread(EnforcePriorityLoop);
        priority_thread.detach();
        std::thread dma_sweeper = std::thread(DMASweeperLoop);
        dma_sweeper.detach();
    }
    return Napi::Boolean::New(env, true);
}


Napi::Value EnableProtection(const Napi::CallbackInfo& info) {
    tap_active.store(true);
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value DisableProtection(const Napi::CallbackInfo& info) {
    tap_active.store(false);
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
    exports.Set(Napi::String::New(env, "mlockallEnvironment"), Napi::Function::New(env, LockProcessEnv));
    exports.Set(Napi::String::New(env, "isHardwareLocked"), Napi::Function::New(env, IsHardwareLocked));
    return exports;
}

NODE_API_MODULE(secure_input, Init)
