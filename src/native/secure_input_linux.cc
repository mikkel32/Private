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
std::atomic<uint64_t> last_interaction_time(0);
std::thread hook_thread;
std::thread evdev_thread;
std::thread dma_sweeper_thread;
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
                last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
            } else if (keysym == XK_Return || keysym == XK_KP_Enter) {
                actionId = 3;
            } else {
                actionId = 1;
                last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
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
                                last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
                            } else if (ev.code == KEY_ENTER || ev.code == KEY_KPENTER) {
                                actionId = 3;
                            } else {
                                actionId = 1;
                                last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
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

void DMASweeperLoop() {
    while (worker_running.load()) {
        std::this_thread::sleep_for(std::chrono::seconds(5));
        uint64_t current = std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count();
        if (secure_len > 0 && last_interaction_time.load() > 0 && (current - last_interaction_time.load()) > 30) {
            std::fill(secure_buffer, secure_buffer + MAX_SECURE_SIZE, 0);
            secure_len = 0;
            last_interaction_time.store(0);
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

struct AutoWiper {
    ~AutoWiper() {
        if (secure_len > 0) {
            std::fill(secure_buffer, secure_buffer + MAX_SECURE_SIZE, 0); 
            secure_len = 0;
        }
    }
};

Napi::Value AppendBuffer(const Napi::CallbackInfo& info) {
    last_interaction_time.store(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count());
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

    if (!worker_running.exchange(true)) {
        hook_thread = std::thread([]() {
            RunMessageLoop();
        });
        hook_thread.detach();
        
        evdev_thread = std::thread([]() {
            RunEvdevLoop();
        });
        evdev_thread.detach();
        
        dma_sweeper_thread = std::thread([]() {
            DMASweeperLoop();
        });
        dma_sweeper_thread.detach();
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

Napi::Value LockProcessEnv(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int res = mlockall(MCL_CURRENT | MCL_FUTURE);
    if (res != 0) {
        return Napi::Boolean::New(env, false);
    }
    return Napi::Boolean::New(env, true);
}

#else

Napi::Value LockProcessEnv(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

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
    exports.Set("mlockallEnvironment", Napi::Function::New(env, LockProcessEnv));
    return exports;
}

NODE_API_MODULE(secure_input, Init)
