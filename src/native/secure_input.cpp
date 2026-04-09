#include <napi.h>
#include <vector>
#include <cstring>

// The global physically allocated buffer
std::vector<char> secure_buffer;

Napi::Value AppendByte(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Byte integer expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    char c = static_cast<char>(info[0].As<Napi::Number>().Int32Value());
    
    // Hard limit to 8192 bytes
    if (secure_buffer.size() < 8192) {
        secure_buffer.push_back(c);
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
    if (!secure_buffer.empty()) {
        secure_buffer.pop_back();
    }
    return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "append"), Napi::Function::New(env, AppendByte));
    exports.Set(Napi::String::New(env, "wipe"), Napi::Function::New(env, Wipe));
    exports.Set(Napi::String::New(env, "drain"), Napi::Function::New(env, DrainPayload));
    exports.Set(Napi::String::New(env, "backspace"), Napi::Function::New(env, Backspace));
    return exports;
}

NODE_API_MODULE(secure_input, Init)
