#include <napi.h>
#include <vector>
#include <cstring>
#include <Carbon/Carbon.h>

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

// Empties the vector directly using volatile pointers to force overwrite
Napi::Value Wipe(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    volatile char* p = secure_buffer.data();
    for (size_t i = 0; i < secure_buffer.size(); ++i) {
        p[i] = 0;
    }
    secure_buffer.clear();
    return Napi::Boolean::New(env, true);
}

// Copies the vault over into V8 for exactly one operation (network payload dispatch)
Napi::Value DrainPayload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Buffer<char> buffer = Napi::Buffer<char>::Copy(env, secure_buffer.data(), secure_buffer.size());
    
    // Instantly wipe physical memory after copying to V8 instance
    volatile char* p = secure_buffer.data();
    for (size_t i = 0; i < secure_buffer.size(); ++i) {
        p[i] = 0;
    }
    secure_buffer.clear();
    
    return buffer;
}

Napi::Value Backspace(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    // Assuming Backspace removes the entire last character
    // UTF-8 backspacing is complex, but for now we just pop bytes if requested 
    // or we handle backspace on the frontend.
    // If the frontend sends the exact diff, we don't need this.
    // But let's leave it functional for single bytes.
    if (!secure_buffer.empty()) {
        secure_buffer.pop_back();
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
    return exports;
}

NODE_API_MODULE(secure_input, Init)
