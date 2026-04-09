#include <napi.h>

Napi::Value EnableProtection(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

Napi::Value DisableProtection(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

Napi::Value AppendBuffer(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

Napi::Value Wipe(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

Napi::Value DrainPayload(const Napi::CallbackInfo& info) {
    return Napi::Buffer<char>::New(info.Env(), 0);
}

Napi::Value Backspace(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

Napi::Value ConcealedCopy(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

Napi::Value RegisterCallback(const Napi::CallbackInfo& info) {
    // Stub
    return Napi::Boolean::New(info.Env(), false);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("enableSecureInput", Napi::Function::New(env, EnableProtection));
    exports.Set("disableSecureInput", Napi::Function::New(env, DisableProtection));
    exports.Set("append", Napi::Function::New(env, AppendBuffer));
    exports.Set("wipe", Napi::Function::New(env, Wipe));
    exports.Set("drain", Napi::Function::New(env, DrainPayload));
    exports.Set("backspace", Napi::Function::New(env, Backspace));
    exports.Set("concealedCopy", Napi::Function::New(env, ConcealedCopy));
    exports.Set("registerCallback", Napi::Function::New(env, RegisterCallback));
    return exports;
}

NODE_API_MODULE(secure_input, Init)
