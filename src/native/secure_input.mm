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
#include <sys/sysctl.h>
#include <os/log.h>

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

// CGEventTap (Ring 3 User-Space Hook) has been completely eradicated per Phase 15 protocol.
// Hardware keystroke extraction MUST happen in Ring 0 (secure_kernel_mac.cpp / .dext)
void StartTapWorker() {
    // Failing closed automatically forces the UI into Ghost Protocol (On-Screen Keyboard)
    hardware_grab_success.store(false);
    return;
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
    return exports;
}

NODE_API_MODULE(secure_input, Init)
