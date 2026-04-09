#include <napi.h>
#include <vector>
#include <cstring>
#include <string.h> // explicit_bzero on macOS
#include <Carbon/Carbon.h>
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

// The global physically allocated buffer
std::vector<char> secure_buffer;

Napi::Value EnableProtection(const Napi::CallbackInfo& info) {
    EnableSecureEventInput();
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value DisableProtection(const Napi::CallbackInfo& info) {
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
    
    // Hard limit to prevent memory exhaustion
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

// Writes text natively to the clipboard tagged with concealed type to bypass clipboard managers
Napi::Value ConcealedCopy(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string text = info[0].As<Napi::String>().Utf8Value();
    
    @autoreleasepool {
        NSPasteboard *pb = [NSPasteboard generalPasteboard];
        [pb clearContents];
        
        NSString *nsText = [NSString stringWithUTF8String:text.c_str()];
        [pb setString:nsText forType:NSPasteboardTypeString];
        [pb setString:@"" forType:@"org.nspasteboard.ConcealedType"];
    }
    
    return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "enableSecureInput"), Napi::Function::New(env, EnableProtection));
    exports.Set(Napi::String::New(env, "disableSecureInput"), Napi::Function::New(env, DisableProtection));
    exports.Set(Napi::String::New(env, "append"), Napi::Function::New(env, AppendBuffer));
    exports.Set(Napi::String::New(env, "wipe"), Napi::Function::New(env, Wipe));
    exports.Set(Napi::String::New(env, "drain"), Napi::Function::New(env, DrainPayload));
    exports.Set(Napi::String::New(env, "backspace"), Napi::Function::New(env, Backspace));
    exports.Set(Napi::String::New(env, "concealedCopy"), Napi::Function::New(env, ConcealedCopy));
    return exports;
}

NODE_API_MODULE(secure_input, Init)
