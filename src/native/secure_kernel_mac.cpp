// =====================================================================================
// PROJECT MONOLITH: macOS DriverKit System Extension Scaffold (.dext)
// =====================================================================================
// CAUTION: This requires Xcode, a DriverKit Entitlement from Apple 
// (com.apple.developer.driverkit.transport.hid), and SIP-disablement for dev-signing.
// This serves as the C++ replacement for CGEventTap (Ring 3 hook) to achieve 
// true Ring 0 hardware-level keystroke isolation and extraction.
// =====================================================================================

#if __has_include(<DriverKit/DriverKit.h>) && __has_include(<HIDDriverKit/HIDDriverKit.h>)
#include <os/log.h>
#include <DriverKit/DriverKit.h>
#include <HIDDriverKit/HIDDriverKit.h>
#else
// Stub definitions for IDE / linter compliance when not compiling with the DriverKit SDK sysroot
typedef int kern_return_t;
typedef unsigned int uint32_t;
typedef unsigned long long uint64_t;
typedef unsigned int IOOptionBits;
#define kIOReturnSuccess 0
#define OS_LOG_DEFAULT 0
#define os_log(log, ...)
#define os_log_debug(log, ...)
class IOService {};
class IOUserClient {};
class IOUserHIDEventService : public IOService {
public:
    virtual bool init() { return true; }
    virtual void free() {}
    virtual kern_return_t Start(IOService *provider) { return kIOReturnSuccess; }
    virtual kern_return_t Stop(IOService *provider) { return kIOReturnSuccess; }
    virtual void dispatchKeyboardEvent(uint64_t timeStamp, uint32_t usagePage, uint32_t usage, uint32_t value, IOOptionBits options) {}
protected:
    void RegisterService() {}
};
#endif

// Forward declarations of Dext lifecycle
class MonolithSecureHIDDriver : public IOUserHIDEventService {
    typedef IOUserHIDEventService super;
public:
    virtual bool init() override;
    virtual void free() override;
    virtual kern_return_t Start(IOService *provider) override;
    virtual kern_return_t Stop(IOService *provider) override;
    virtual void dispatchKeyboardEvent(uint64_t timeStamp, uint32_t usagePage, uint32_t usage, uint32_t value, IOOptionBits options) override;
    
private:
    bool ghostProtocolEnabled;
    IOUserClient* userClient; // XPC queue back to our native Node Addon
};

// Extends Apple's HID Event Service to intercept Keyboard Usages BEFORE OS handling
bool MonolithSecureHIDDriver::init() {
    if (!super::init()) return false;
    this->ghostProtocolEnabled = true;
    os_log(OS_LOG_DEFAULT, "MonolithSecureHIDDriver::init DEXT loaded.");
    return true;
}

void MonolithSecureHIDDriver::free() {
    os_log(OS_LOG_DEFAULT, "MonolithSecureHIDDriver::free DEXT unloaded.");
    super::free();
}

kern_return_t MonolithSecureHIDDriver::Start(IOService *provider) {
    kern_return_t ret = super::Start(provider);
    if (ret != kIOReturnSuccess) {
        return ret;
    }
    
    // Register the custom AppKit communication port
    RegisterService();
    os_log(OS_LOG_DEFAULT, "MonolithSecureHIDDriver: Attached to Hardware Provider.");
    
    return kIOReturnSuccess;
}

kern_return_t MonolithSecureHIDDriver::Stop(IOService *provider) {
    os_log(OS_LOG_DEFAULT, "MonolithSecureHIDDriver::Stop Detaching.");
    return super::Stop(provider);
}

// Intercept the low-level HID signals
void MonolithSecureHIDDriver::dispatchKeyboardEvent(uint64_t timeStamp, uint32_t usagePage, uint32_t usage, uint32_t value, IOOptionBits options) {
    if (ghostProtocolEnabled) {
        // [GHOST PROTOCOL]
        // 1. Consume the keystroke here! By dropping the event, no subsequent driver
        //    or OS application (including Ring 0 System rootkits reading post-processing)
        //    will ever see this keycode!
        
        // 2. Transmit the 'usage' code directly back to the XPC port connected
        //    to secure_input.mm.
        if (this->userClient) {
            // Pseudo-code for dropping struct payload into our custom IOCTL memory map
            // userClient->DispatchMessage(usage);
        }
        
        os_log_debug(OS_LOG_DEFAULT, "Monolith: Hardware Key Swallow.");
    } else {
        // Standard passthrough when App is not focused
        super::dispatchKeyboardEvent(timeStamp, usagePage, usage, value, options);
    }
}
