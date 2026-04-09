#include <napi.h>

#ifdef __linux__

#include <X11/Xlib.h>
#include <X11/keysym.h>
#include <X11/Xutil.h>
#include <thread>
#include <atomic>
#include <vector>
#include <cstring>

std::vector<uint8_t> secure_buffer;
std::atomic<bool> is_hook_active(false);
std::atomic<bool> worker_running(false);
std::thread hook_thread;
Display* display = nullptr;

Napi::ThreadSafeFunction tsfn;

void RunMessageLoop() {
    display = XOpenDisplay(NULL);
    if (!display) return;
    
    Window root = DefaultRootWindow(display);
    
    // Grab the keyboard to prevent other X11 clients from seeing KeyPresses
    // GrabModeAsync means events are processed normally without freezing other devices.
    int status = XGrabKeyboard(display, root, True, GrabModeAsync, GrabModeAsync, CurrentTime);
    if (status != GrabSuccess) {
        XCloseDisplay(display);
        return;
    }
    
    XEvent ev;
    while (worker_running.load()) {
        XNextEvent(display, &ev);
        
        if (ev.type == KeyPress && is_hook_active.load()) {
            KeySym keysym = XLookupKeysym(&ev.xkey, 0);
            int actionId = 0;
            
            if (keysym == XK_BackSpace) {
                actionId = 2;
            } else if (keysym == XK_Return || keysym == XK_KP_Enter) {
                actionId = 3;
            } else {
                actionId = 1;
                secure_buffer.push_back((uint8_t)(keysym & 0xFF)); 
            }
            
            if (actionId > 0 && tsfn) {
                auto callback = [actionId](Napi::Env env, Napi::Function jsCallback) {
                    jsCallback.Call({ Napi::Number::New(env, actionId) });
                };
                tsfn.BlockingCall(callback);
            }
            
        }
    }
    
    XUngrabKeyboard(display, CurrentTime);
    XCloseDisplay(display);
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
    std::fill(secure_buffer.begin(), secure_buffer.end(), 0); 
    secure_buffer.clear();
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value DrainPayload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Buffer<uint8_t> buf = Napi::Buffer<uint8_t>::Copy(env, secure_buffer.data(), secure_buffer.size());
    std::fill(secure_buffer.begin(), secure_buffer.end(), 0);
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

// Fallback stubs for non-linux environments trying to parse this file
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
