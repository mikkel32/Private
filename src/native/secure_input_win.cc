#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#include <thread>
#include <atomic>
#include <vector>

std::vector<uint8_t> secure_buffer;
std::atomic<bool> is_hook_active(false);
std::atomic<bool> worker_running(false);
HHOOK hKeyboardHook = NULL;
std::thread hook_thread;
DWORD hook_thread_id = 0;

Napi::ThreadSafeFunction tsfn;

LRESULT CALLBACK KeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && is_hook_active.load()) {
        if (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN) {
            KBDLLHOOKSTRUCT* pKeyBoard = (KBDLLHOOKSTRUCT*)lParam;
            DWORD vkCode = pKeyBoard->vkCode;
            
            int actionId = 0;
            if (vkCode == VK_BACK) {
                actionId = 2; // Backspace
            } else if (vkCode == VK_RETURN) {
                actionId = 3; // Enter
            } else {
                actionId = 1; // Append
                secure_buffer.push_back((uint8_t)vkCode);
            }
            
            if (actionId > 0 && tsfn) {
                auto callback = [actionId](Napi::Env env, Napi::Function jsCallback) {
                    jsCallback.Call({ Napi::Number::New(env, actionId) });
                };
                tsfn.BlockingCall(callback);
            }
            return 1;
        }
    }
    return CallNextHookEx(hKeyboardHook, nCode, wParam, lParam);
}

void RunMessageLoop() {
    hook_thread_id = GetCurrentThreadId();
    hKeyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, KeyboardProc, NULL, 0);
    if (!hKeyboardHook) return;
    
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
    UnhookWindowsHookEx(hKeyboardHook);
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

Napi::Value Wipe(const Napi::CallbackInfo& info) {
    SecureZeroMemory(secure_buffer.data(), secure_buffer.size());
    secure_buffer.clear();
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value DrainPayload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Buffer<uint8_t> buf = Napi::Buffer<uint8_t>::Copy(env, secure_buffer.data(), secure_buffer.size());
    SecureZeroMemory(secure_buffer.data(), secure_buffer.size());
    secure_buffer.clear();
    return buf;
}

Napi::Value Backspace(const Napi::CallbackInfo& info) {
    if (!secure_buffer.empty()) {
        secure_buffer.pop_back();
    }
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value RegisterCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Function expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (!worker_running.exchange(true)) {
        hook_thread = std::thread([]() {
            RunMessageLoop();
        });
        hook_thread.detach();
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

#endif

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("enableSecureInput", Napi::Function::New(env, EnableProtection));
    exports.Set("disableSecureInput", Napi::Function::New(env, DisableProtection));
    exports.Set("append", Napi::Function::New(env, AppendBuffer));
    exports.Set("wipe", Napi::Function::New(env, Wipe));
    exports.Set("drain", Napi::Function::New(env, DrainPayload));
    exports.Set("backspace", Napi::Function::New(env, Backspace));
    exports.Set("registerCallback", Napi::Function::New(env, RegisterCallback));
    return exports;
}

NODE_API_MODULE(secure_input, Init)
