/**
 * Project Monolith - Zero-Trust WDF Kernel-Mode Filter Driver (Windows)
 * ----------------------------------------------------------------------
 * 
 * ARCHITECTURAL DESIGN:
 * WH_KEYBOARD_LL (User-mode hook) is inherently flawed and cannot guarantee
 * keystroke privacy against Ring 0 rootkits or lower-level drivers.
 * 
 * To securely intercept keystrokes on Windows, Monolith requires an Upper
 * Filter Driver attached directly to `kbdclass` (Keyboard Class Driver).
 * By intercepting IRP (I/O Request Packets) before they reach the user-mode 
 * HID layer, we prevent all user-space keyloggers from seeing the input.
 * 
 * This C source acts as the Kernel-Mode framework scaffold. 
 * Cross-compilation requires the Windows Driver Kit (WDK) and EV-Certificate signing.
 */
#ifdef _WIN32
#include <ntddk.h>
#include <wdf.h>
#include <kbdmou.h>

// Forward declarations
DRIVER_INITIALIZE DriverEntry;
EVT_WDF_DRIVER_DEVICE_ADD EvtDriverDeviceAdd;
EVT_WDF_IO_QUEUE_IO_INTERNAL_DEVICE_CONTROL EvtIoInternalDeviceControl;

/**
 * DriverEntry - Entry point for the Windows Kernel driver.
 */
NTSTATUS DriverEntry(_In_ PDRIVER_OBJECT DriverObject, _In_ PUNICODE_STRING RegistryPath) {
    NTSTATUS status;
    WDF_DRIVER_CONFIG config;

    // Initialize WDF configuration and register EvtDriverDeviceAdd
    WDF_DRIVER_CONFIG_INIT(&config, EvtDriverDeviceAdd);
    
    // Register the driver with the framework
    status = WdfDriverCreate(DriverObject, RegistryPath, WDF_NO_OBJECT_ATTRIBUTES, &config, WDF_NO_HANDLE);
    if (!NT_SUCCESS(status)) {
        KdPrint(("MonolithKbdFilter: WdfDriverCreate failed with status 0x%x\n", status));
    }

    return status;
}

/**
 * EvtDriverDeviceAdd - Called when a new keyboard device is detected.
 * Binds our filter to the kbdclass generic device.
 */
NTSTATUS EvtDriverDeviceAdd(_In_ WDFDRIVER Driver, _Inout_ PWDFDEVICE_INIT DeviceInit) {
    UNREFERENCED_PARAMETER(Driver);
    NTSTATUS status;
    WDFDEVICE hDevice;
    WDF_IO_QUEUE_CONFIG queueConfig;

    // Tell WDF that this is a filter driver
    WdfFdoInitSetFilter(DeviceInit);

    // Create the framework device object
    status = WdfDeviceCreate(&DeviceInit, WDF_NO_OBJECT_ATTRIBUTES, &hDevice);
    if (!NT_SUCCESS(status)) {
        KdPrint(("MonolithKbdFilter: WdfDeviceCreate failed with status 0x%x\n", status));
        return status;
    }

    // Configure the default I/O queue to intercept internal device control requests
    WDF_IO_QUEUE_CONFIG_INIT_DEFAULT_QUEUE(&queueConfig, WdfIoQueueDispatchParallel);
    
    // We only care about internal I/O controls (which is where keyboard data passes)
    queueConfig.EvtIoInternalDeviceControl = EvtIoInternalDeviceControl;

    status = WdfIoQueueCreate(hDevice, &queueConfig, WDF_NO_OBJECT_ATTRIBUTES, WDF_NO_HANDLE);
    if (!NT_SUCCESS(status)) {
        KdPrint(("MonolithKbdFilter: WdfIoQueueCreate failed with status 0x%x\n", status));
        return status;
    }

    return status;
}

/**
 * EvtIoInternalDeviceControl - Intercepts IRP_MJ_INTERNAL_DEVICE_CONTROL
 * 
 * Here we capture the keystrokes (KEYBOARD_INPUT_DATA) BEFORE they are routed
 * up into the operating system's User Mode HID layer. By swallowing the packet 
 * (completing the IRP without forwarding), the OS and any user-space keylogger 
 * never receives the key press.
 */
VOID EvtIoInternalDeviceControl(
    _In_ WDFQUEUE Queue,
    _In_ WDFREQUEST Request,
    _In_ size_t OutputBufferLength,
    _In_ size_t InputBufferLength,
    _In_ ULONG IoControlCode
) {
    UNREFERENCED_PARAMETER(OutputBufferLength);
    UNREFERENCED_PARAMETER(InputBufferLength);
    WDFDEVICE hDevice = WdfIoQueueGetDevice(Queue);

    // The IOCTL_KEYBOARD_QUERY_ATTRIBUTES / SET_INDICATORS are standard, but the raw 
    // data retrieval flows through a registered Connect Service Callback loop.
    // In a full implementation, we hook the IOCTL_COMMAND_CONNECT callback here
    // and attach our own ISR/DPC routine to extract `PKEYBOARD_INPUT_DATA`.
    
    // PSEUDO-IMPLEMENTATION for the Data Extractor:
    /*
        if (IoControlCode == IOCTL_KEYBOARD_CONNECT) {
            // Replace the upper connection's ClassService callback with our own SecureCallback
            // Our SecureCallback will push the keys to an inverted IOCTL queue where our 
            // C++ user-space N-API addon via `DeviceIoControl()` is polling for bytes.
            //
            // Then we return success without calling the original ClassService, effectively 
            // blinding the OS completely to the keystroke!
        }
    */

    // Forward the request down the stack if we are not actively in "Ghost Protocol" blocking mode
    WDF_REQUEST_SEND_OPTIONS options;
    WDF_REQUEST_SEND_OPTIONS_INIT(&options, WDF_REQUEST_SEND_OPTION_SEND_AND_FORGET);
    WdfRequestSend(Request, WdfDeviceGetIoTarget(hDevice), &options);
}
#endif
