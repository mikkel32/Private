#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#include <thread>
#include <atomic>
#include <array>

constexpr size_t MAX_SECURE_SIZE = 8192;
uint8_t secure_buffer[MAX_SECURE_SIZE];
size_t secure_len = 0;

uint32_t SESSION_SEED = 0;
// Generate chaotic permutation mask mapped globally to array index
uint8_t get_mask_for_index(size_t index) {
    uint32_t state = SESSION_SEED + (uint32_t)index * 0x9E3779B9;
    state ^= state >> 15;
    state *= 0x85ebca6b;
    state ^= state >> 13;
    state *= 0xc2b2ae35;
    state ^= state >> 16;
    return (uint8_t)(state & 0xFF);
}

std::atomic<bool> worker_running(false);
std::atomic<uint64_t> last_interaction_time(0);
// Keyboard Input struct matching Kernel WDF driver
typedef struct _KEYBOARD_INPUT_DATA {
    USHORT UnitId;
    USHORT MakeCode;
    USHORT Flags;
    USHORT Reserved;
    ULONG  ExtraInformation;
} KEYBOARD_INPUT_DATA, *PKEYBOARD_INPUT_DATA;

#define CTL_CODE( DeviceType, Function, Method, Access ) (                 \
    ((DeviceType) << 16) | ((Access) << 14) | ((Function) << 2) | (Method) \
)
#define IOCTL_KEYBOARD_SECURE_READ CTL_CODE(FILE_DEVICE_KEYBOARD, 0x801, METHOD_BUFFERED, FILE_ANY_ACCESS)

HANDLE hDriver = INVALID_HANDLE_VALUE;

void FetchKeysFromKernelBroker() {
    KEYBOARD_INPUT_DATA keyData = {0};
    DWORD bytesReturned = 0;
    
    while (worker_running.load()) {
        if (!is_hook_active.load()) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            continue;
        }

        // Blocking call to WDF Pending IRP Queue
        BOOL res = DeviceIoControl(
            hDriver,
            IOCTL_KEYBOARD_SECURE_READ,
            NULL, 0,
            &keyData, sizeof(KEYBOARD_INPUT_DATA),
            &bytesReturned,
            NULL
        );

        if (res && bytesReturned == sizeof(KEYBOARD_INPUT_DATA)) {
            // Only process KeyDown events (Flags == 0 or 2, generally avoid KeyUp (Flags == 1 or 3))
            if ((keyData.Flags & 1) == 0) { // KEY_MAKE
                int actionId = 0;
                
                // Extremely basic scan code mapping for proof of concept
                if (keyData.MakeCode == 0x0E) { // Backspace
                    actionId = 2;
                } else if (keyData.MakeCode == 0x1C) { // Enter
                    actionId = 3;
                } else {
                    actionId = 1;
                    if (secure_len < MAX_SECURE_SIZE) {
                        // Map MakeCode natively into rolling sequence mask
                        secure_buffer[secure_len] = (uint8_t)keyData.MakeCode ^ get_mask_for_index(secure_len);
                        secure_len++;
                    }
                }
                
                last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
                
                if (actionId > 0 && tsfn) {
                    auto callback = [actionId](Napi::Env env, Napi::Function jsCallback) {
                        jsCallback.Call({ Napi::Number::New(env, actionId) });
                    };
                    tsfn.BlockingCall(callback);
                }
            }
        } else {
            // Driver absent or errored? sleep briefly and retry
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
        }
    }
}

BOOL WINAPI ConsoleHandlerRoutine(DWORD dwCtrlType) {
    if (secure_len > 0) {
        SecureZeroMemory(secure_buffer, MAX_SECURE_SIZE);
    }
    return FALSE;
}

LONG WINAPI CrashHandler(EXCEPTION_POINTERS *ExceptionInfo) {
    if (secure_len > 0) {
        SecureZeroMemory(secure_buffer, MAX_SECURE_SIZE);
    }
    return EXCEPTION_CONTINUE_SEARCH;
}

void SetupCrashHandlers() {
    SetConsoleCtrlHandler(ConsoleHandlerRoutine, TRUE);
    SetUnhandledExceptionFilter(CrashHandler);
}

void RunMessageLoop() {
    hDriver = CreateFileA("\\\\.\\MonolithKbd",
        GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        NULL,
        OPEN_EXISTING,
        0,
        NULL
    );

    if (hDriver != INVALID_HANDLE_VALUE) {
        FetchKeysFromKernelBroker();
        CloseHandle(hDriver);
    } else {
        // Driver could not be opened, log internally
        worker_running.store(false);
    }
}

void ClearWindowsClipboard() {
    if (OpenClipboard(NULL)) {
        EmptyClipboard();
        CloseClipboard();
    }
}

void DMASweeperLoop() {
    while (worker_running.load()) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        uint64_t current = std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count();
        if (secure_len > 0 && last_interaction_time.load() > 0 && (current - last_interaction_time.load()) >= 3) {
            SecureZeroMemory(secure_buffer, MAX_SECURE_SIZE);
            secure_len = 0;
            last_interaction_time.store(0);
            ClearWindowsClipboard();
        }
    }
}

Napi::Value EnableProtection(const Napi::CallbackInfo& info) {
    is_hook_active.store(true);
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value DisableProtection(const Napi::CallbackInfo& info) {
    is_hook_active.store(false);
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value AppendBuffer(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value IsHardwareLocked(const Napi::CallbackInfo& info) {
    // We can now confirm Ring-0 Isolation via the hDriver connection!
    bool is_locked = (hDriver != INVALID_HANDLE_VALUE);
    return Napi::Boolean::New(info.Env(), is_locked);
}

struct AutoWiper {
    ~AutoWiper() {
        if (secure_len > 0) {
            SecureZeroMemory(secure_buffer, MAX_SECURE_SIZE);
            secure_len = 0;
            ClearWindowsClipboard();
        }
    }
};

Napi::Value Wipe(const Napi::CallbackInfo& info) {
    AutoWiper wiper;
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value DrainPayload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    AutoWiper wiper;
    
    // Decrypt the payload natively bypassing Memory constraints
    uint8_t temp_buffer[MAX_SECURE_SIZE];
    for (size_t i = 0; i < secure_len; i++) {
        temp_buffer[i] = secure_buffer[i] ^ get_mask_for_index(i);
    }
    
    // Scramble deterministic seed forward to protect next array mathematically
    SESSION_SEED ^= (uint32_t)rand();
    
    Napi::Buffer<uint8_t> buf = Napi::Buffer<uint8_t>::Copy(env, temp_buffer, secure_len);
    SecureZeroMemory(temp_buffer, MAX_SECURE_SIZE); // Wipe temp buffer immediately
    
    return buf;
}

Napi::Value Backspace(const Napi::CallbackInfo& info) {
    last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
    if (secure_len > 0) {
        secure_buffer[secure_len - 1] = 0;
        secure_len--;
    }
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value RegisterCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Function expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (!hook_thread.joinable()) {
        SetupCrashHandlers();
        worker_running.store(true);
        hook_thread = std::thread(RunMessageLoop);
        std::thread dma_sweeper = std::thread(DMASweeperLoop);
        dma_sweeper.detach();
    }

    tsfn = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "SecureInputCallback",
        0,
        1
    );

    return Napi::Boolean::New(env, true);
}

#else

// Fallback stubs for non-windows environments trying to parse this file
Napi::Value EnableProtection(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), false); }
Napi::Value DisableProtection(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), false); }
Napi::Value AppendBuffer(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), false); }
Napi::Value Wipe(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), false); }
Napi::Value DrainPayload(const Napi::CallbackInfo& info) { return Napi::Buffer<char>::New(info.Env(), 0); }
Napi::Value Backspace(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), false); }
Napi::Value RegisterCallback(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), false); }
Napi::Value IsHardwareLocked(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), false); }

#endif

Napi::Object Init(Napi::Env env, Napi::Object exports) {
#ifdef _WIN32
    if (!memory_locked) {
        VirtualLock(secure_buffer, MAX_SECURE_SIZE);
        memory_locked = true;
        
        // Generate chaotic origin seed for the stream sequence
        srand((unsigned int)time(NULL));
        SESSION_SEED = (uint32_t)rand();
    }
#endif
    
    exports.Set("enableSecureInput", Napi::Function::New(env, EnableProtection));
    exports.Set("disableSecureInput", Napi::Function::New(env, DisableProtection));
    exports.Set("append", Napi::Function::New(env, AppendBuffer));
    exports.Set("wipe", Napi::Function::New(env, Wipe));
    exports.Set("drain", Napi::Function::New(env, DrainPayload));
    exports.Set("backspace", Napi::Function::New(env, Backspace));
    exports.Set("registerCallback", Napi::Function::New(env, RegisterCallback));
    exports.Set("isHardwareLocked", Napi::Function::New(env, IsHardwareLocked));
    return exports;
}

NODE_API_MODULE(secure_input, Init)
