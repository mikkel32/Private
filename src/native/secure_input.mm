#include <napi.h>
#include <vector>
#include <cstring>
#include <string.h> // explicit_bzero on macOS
#include <Carbon/Carbon.h>
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <thread>
#include <atomic>

// The global physically allocated buffer
std::vector<char> secure_buffer;
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
            if (!secure_buffer.empty()) {
                char& last = secure_buffer.back();
                memset_s(&last, 1, 0, 1);
                secure_buffer.pop_back();
                action = 2;
            }
        } else if (keycode == 36 || keycode == 76) { // Return / Enter
            action = 3;
        } else {
            // Translate keycode to character
            UniChar chars[4];
            UniCharCount actualStringLength = 0;
            CGEventKeyboardGetUnicodeString(event, 4, &actualStringLength, chars);
            
            if (actualStringLength > 0 && secure_buffer.size() < 81920) {
                NSString *str = [NSString stringWithCharacters:chars length:actualStringLength];
                const char* utf8 = [str UTF8String];
                if (utf8) {
                    size_t len = strlen(utf8);
                    for (size_t i = 0; i < len; ++i) {
                        secure_buffer.push_back(utf8[i]);
                    }
                    action = 1;
                }
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
    
    if (secure_buffer.size() + length < 81920) {
        for (size_t i = 0; i < length; ++i) {
            secure_buffer.push_back(static_cast<char>(data[i]));
        }
    }
    return Napi::Boolean::New(env, true);
}

// Empties the vector directly using memset_s to prevent dead-store elimination
Napi::Value Wipe(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!secure_buffer.empty()) {
        memset_s(secure_buffer.data(), secure_buffer.size(), 0, secure_buffer.size());
    }
    secure_buffer.clear();
    return Napi::Boolean::New(env, true);
}

// Copies the vault over into V8 for exactly one operation (network payload dispatch)
Napi::Value DrainPayload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Buffer<char> buffer = Napi::Buffer<char>::Copy(env, secure_buffer.data(), secure_buffer.size());
    
    // Instantly wipe physical memory after copying to V8 instance
    if (!secure_buffer.empty()) {
        memset_s(secure_buffer.data(), secure_buffer.size(), 0, secure_buffer.size());
    }
    secure_buffer.clear();
    
    return buffer;
}

Napi::Value Backspace(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!secure_buffer.empty()) {
        char& last = secure_buffer.back();
        memset_s(&last, 1, 0, 1);
        secure_buffer.pop_back();
    }
    return Napi::Boolean::New(env, true);
}

// Native Clipboard functions removed per Zero-Trust Protocol.

Napi::Object Init(Napi::Env env, Napi::Object exports) {
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
