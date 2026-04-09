#include <napi.h>

#ifdef __linux__

#include <X11/Xlib.h>
#include <X11/keysym.h>
#include <X11/Xutil.h>
#include <thread>
#include <atomic>
#include <array>
#include <vector>
#include <sys/mman.h>
#include <dirent.h>
#include <fcntl.h>
#include <unistd.h>
#include <linux/input.h>
#include <sys/select.h>
#include <sys/ioctl.h>
#include <cstring>

constexpr size_t MAX_SECURE_SIZE = 8192;
uint8_t secure_buffer[MAX_SECURE_SIZE];
size_t secure_len = 0;
bool memory_locked = false;
std::atomic<bool> is_hook_active(false);
std::atomic<bool> worker_running(false);
std::thread hook_thread;
std::thread evdev_thread;
Display* display = nullptr;

Napi::ThreadSafeFunction tsfn;

void RunMessageLoop() {
    display = XOpenDisplay(NULL);
    if (!display) return;
    
    Window root = DefaultRootWindow(display);
    
    // Grab the keyboard to prevent other X11 clients from seeing KeyPresses
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
                if (secure_len < MAX_SECURE_SIZE) {
                    secure_buffer[secure_len++] = (uint8_t)(keysym & 0xFF); 
                }
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

void RunEvdevLoop() {
    std::vector<int> fds;
    DIR* dir = opendir("/dev/input");
    if (!dir) return;
    
    struct dirent* ent;
    while ((ent = readdir(dir)) != NULL) {
        if (strncmp(ent->d_name, "event", 5) == 0) {
            char path[256];
            snprintf(path, sizeof(path), "/dev/input/%s", ent->d_name);
            int fd = open(path, O_RDONLY | O_NONBLOCK);
            if (fd >= 0) {
                // EVIOCGRAB locks out all other processes (including rootkeyloggers & X11)
                // This will fail if not run as Root, silently falling back to XGrabKeyboard.
                if (ioctl(fd, EVIOCGRAB, 1) == 0) {
                    fds.push_back(fd);
                } else {
                    close(fd);
                }
            }
        }
    }
    closedir(dir);
    
    if (fds.empty()) return; // No roots or no devices, evdev fallback ends.
    
    while (worker_running.load()) {
        fd_set readset;
        FD_ZERO(&readset);
        int maxfd = 0;
        for (int fd : fds) {
            FD_SET(fd, &readset);
            if (fd > maxfd) maxfd = fd;
        }
        
        struct timeval tv;
        tv.tv_sec = 0;
        tv.tv_usec = 100000; // 100ms
        
        int res = select(maxfd + 1, &readset, NULL, NULL, &tv);
        if (res > 0 && is_hook_active.load()) {
            for (int fd : fds) {
                if (FD_ISSET(fd, &readset)) {
                    struct input_event ev;
                    while (read(fd, &ev, sizeof(ev)) == sizeof(ev)) {
                        if (ev.type == EV_KEY && ev.value == 1) { // Key Press
                            int actionId = 0;
                            if (ev.code == KEY_BACKSPACE) {
                                actionId = 2;
                            } else if (ev.code == KEY_ENTER || ev.code == KEY_KPENTER) {
                                actionId = 3;
                            } else {
                                actionId = 1;
                                // Simple mapping for standard keycodes A-Z (approximation for raw binary log)
                                if (secure_len < MAX_SECURE_SIZE) {
                                    secure_buffer[secure_len++] = (uint8_t)(ev.code & 0xFF);
                                }
                            }
                            
                            if (actionId > 0 && tsfn) {
                                auto callback = [actionId](Napi::Env env, Napi::Function jsCallback) {
                                    jsCallback.Call({ Napi::Number::New(env, actionId) });
                                };
                                tsfn.BlockingCall(callback);
                            }
                        }
                    }
                }
            }
        }
    }
    
    for (int fd : fds) {
        ioctl(fd, EVIOCGRAB, 0); // Release grab
        close(fd);
    }
}

Napi::Value EnableProtection(const Napi::CallbackInfo& info) {
    // Fatal Wayland Fallback check
    if (access("/dev/input", R_OK) != 0 || access("/dev/input/event0", R_OK | W_OK) != 0) {
        Napi::Error::New(info.Env(), "FATAL: Root privileges required for evdev isolation (Wayland Evasion)").ThrowAsJavaScriptException();
        return info.Env().Null();
    }
    
    is_hook_active.store(true);
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value DisableProtection(const Napi::CallbackInfo& info) {
    is_hook_active.store(false);
    return Napi::Boolean::New(info.Env(), true);
}

struct AutoWiper {
    ~AutoWiper() {
        if (secure_len > 0) {
            std::fill(secure_buffer, secure_buffer + MAX_SECURE_SIZE, 0); 
            secure_len = 0;
        }
    }
};

Napi::Value AppendBuffer(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value Wipe(const Napi::CallbackInfo& info) {
    AutoWiper wiper;
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value DrainPayload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    AutoWiper wiper;
    Napi::Buffer<uint8_t> buf = Napi::Buffer<uint8_t>::Copy(env, secure_buffer, secure_len);
    return buf;
}

Napi::Value Backspace(const Napi::CallbackInfo& info) {
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

    if (!worker_running.exchange(true)) {
        hook_thread = std::thread([]() {
            RunMessageLoop();
        });
        hook_thread.detach();
        
        evdev_thread = std::thread([]() {
            RunEvdevLoop();
        });
        evdev_thread.detach();
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
#ifdef __linux__
    if (!memory_locked) {
        mlock(secure_buffer, MAX_SECURE_SIZE);
        memory_locked = true;
    }
#endif
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
