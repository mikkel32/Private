#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#include <thread>
#include <atomic>
#include <array>

constexpr size_t MAX_SECURE_SIZE = 8192;
uint8_t secure_buffer[MAX_SECURE_SIZE];
size_t secure_len = 0;
uint8_t XOR_KEY = 0; // Dynamic DMA masking key
std::atomic<bool> worker_running(false);
std::atomic<uint64_t> last_interaction_time(0);
HHOOK hKeyboardHook = NULL;
std::thread hook_thread;
DWORD hook_thread_id = 0;

Napi::ThreadSafeFunction tsfn;

LRESULT CALLBACK KeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && is_hook_active.load()) {
        if (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN) {
            KBDLLHOOKSTRUCT* pKeyBoard = (KBDLLHOOKSTRUCT*)lParam;
            DWORD vkCode = pKeyBoard->vkCode;
            
            // Block Ctrl+V (Paste) natively
            if (vkCode == 0x56 && (GetAsyncKeyState(VK_CONTROL) & 0x8000)) {
                return 1;
            }
            
            int actionId = 0;
            if (vkCode == VK_BACK) {
                actionId = 2; // Backspace
                last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
            } else if (vkCode == VK_RETURN) {
                actionId = 3; // Enter
            } else {
                actionId = 1; // Append
                last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
                if (secure_len < MAX_SECURE_SIZE) {
                    secure_buffer[secure_len++] = (uint8_t)vkCode ^ XOR_KEY;
                }
            }
            
            last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
            
            if (actionId > 0 && tsfn) {
                auto callback = [actionId](Napi::Env env, Napi::Function jsCallback) {
                    jsCallback.Call({ Napi::Number::New(env, actionId) });
                };
                tsfn.BlockingCall(callback);
            }
            return 1;
        }
    }
    // Optional: hook unhooked by system detection?
    // We could periodically test it, but WH_KEYBOARD_LL will timeout if we block.
    // For now we assume message pump is healthy.
    return CallNextHookEx(hKeyboardHook, nCode, wParam, lParam);
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

void CALLBACK RehookTimerProc(HWND hwnd, UINT uMsg, UINT_PTR idEvent, DWORD dwTime) {
    if (hKeyboardHook) {
        UnhookWindowsHookEx(hKeyboardHook);
    }
    hKeyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, KeyboardProc, NULL, 0);
}

void RunMessageLoop() {
    hook_thread_id = GetCurrentThreadId();
    hKeyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, KeyboardProc, NULL, 0);
    if (!hKeyboardHook) return;
    
    SetTimer(NULL, 1, 15000, (TIMERPROC)RehookTimerProc);
    
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
    KillTimer(NULL, 1);
    
    if (hKeyboardHook) UnhookWindowsHookEx(hKeyboardHook);
    worker_running.store(false);
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
    // Windows WH_KEYBOARD_LL is an inherently vulnerable user-mode hook.
    // It can NEVER guarantee isolation against kernel rootkits.
    return Napi::Boolean::New(info.Env(), false);
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
    
    // Decrypt the payload before passing it to V8
    uint8_t temp_buffer[MAX_SECURE_SIZE];
    for (size_t i = 0; i < secure_len; i++) {
        temp_buffer[i] = secure_buffer[i] ^ XOR_KEY;
    }
    
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
        
        // Generate random XOR mask for this session (simulated with generic seed as wincrypt is heavy)
        srand((unsigned int)time(NULL));
        XOR_KEY = (uint8_t)(rand() % 255);
        if (XOR_KEY == 0) XOR_KEY = 0xAA; // Avoid 0-mask
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
