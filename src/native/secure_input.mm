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

constexpr size_t MAX_SECURE_SIZE = 8192;
char secure_buffer[MAX_SECURE_SIZE];
size_t secure_len = 0;
bool memory_locked = false;
std::atomic<bool> tap_active{false};

CFMachPortRef eventTap = nullptr;
CFRunLoopSourceRef runLoopSource = nullptr;
Napi::ThreadSafeFunction tsfn;

CGEventRef HookCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void* refcon) {
    if (!tap_active.load()) return event;

    if (type == kCGEventKeyDown) {
        CGKeyCode keycode = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
        int64_t action = 0; // 0 = default, 1 = character append, 2 = backspace, 3 = enter
        
        if (keycode == 51) { // Backspace
            if (secure_len > 0) {
                char& last = secure_buffer[secure_len - 1];
                memset_s(&last, 1, 0, 1);
                secure_len--;
                action = 2;
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
                secure_buffer[secure_len++] = ch;
                action = 1;
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
    eventTap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, (CGEventTapOptions)0, eventMask, HookCallback, nullptr);
    if (!eventTap) return;
    
    runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0);
    CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, kCFRunLoopCommonModes);
    CGEventTapEnable(eventTap, true);
    
    CFRunLoopRun();
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
        worker = std::thread(StartTapWorker);
        priority_thread = std::thread(EnforcePriorityLoop);
        priority_thread.detach();
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
    
    if (secure_len + length <= MAX_SECURE_SIZE) {
        for (size_t i = 0; i < length; ++i) {
            secure_buffer[secure_len++] = static_cast<char>(data[i]);
        }
    }
    return Napi::Boolean::New(env, true);
}

// Empties the vector directly using memset_s to prevent dead-store elimination
Napi::Value Wipe(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (secure_len > 0) {
        memset_s(secure_buffer, MAX_SECURE_SIZE, 0, MAX_SECURE_SIZE);
    }
    secure_len = 0;
    return Napi::Boolean::New(env, true);
}

// Copies the vault over into V8 for exactly one operation (network payload dispatch)
Napi::Value DrainPayload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Buffer<char> buffer = Napi::Buffer<char>::Copy(env, secure_buffer, secure_len);
    
    // Instantly wipe physical memory after copying to V8 instance
    if (secure_len > 0) {
        memset_s(secure_buffer, MAX_SECURE_SIZE, 0, MAX_SECURE_SIZE);
    }
    secure_len = 0;
    
    return buffer;
}

Napi::Value Backspace(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (secure_len > 0) {
        char& last = secure_buffer[secure_len - 1];
        memset_s(&last, 1, 0, 1);
        secure_len--;
    }
    return Napi::Boolean::New(env, true);
}

// Native Clipboard functions removed per Zero-Trust Protocol.

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    if (!memory_locked) {
        mlock(secure_buffer, MAX_SECURE_SIZE);
        memory_locked = true;
    }

    exports.Set(Napi::String::New(env, "enableSecureInput"), Napi::Function::New(env, EnableProtection));
    exports.Set(Napi::String::New(env, "disableSecureInput"), Napi::Function::New(env, DisableProtection));
    exports.Set(Napi::String::New(env, "append"), Napi::Function::New(env, AppendBuffer));
    exports.Set(Napi::String::New(env, "wipe"), Napi::Function::New(env, Wipe));
    exports.Set(Napi::String::New(env, "drain"), Napi::Function::New(env, DrainPayload));
    exports.Set(Napi::String::New(env, "backspace"), Napi::Function::New(env, Backspace));
    exports.Set(Napi::String::New(env, "registerCallback"), Napi::Function::New(env, RegisterCallback));
    return exports;
}

NODE_API_MODULE(secure_input, Init)
