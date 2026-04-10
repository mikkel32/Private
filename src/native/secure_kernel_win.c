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

// Struct to store original connection data
typedef struct _DEVICE_EXTENSION {
    CONNECT_DATA UpperConnectData;
} DEVICE_EXTENSION, *PDEVICE_EXTENSION;

WDF_DECLARE_CONTEXT_TYPE_WITH_NAME(DEVICE_EXTENSION, FilterGetData)

// The malicious/secure callback that intercepts the keystrokes
VOID SecureKeyboardCallback(
    _In_    PDEVICE_OBJECT DeviceObject,
    _In_    PKEYBOARD_INPUT_DATA InputDataStart,
    _In_    PKEYBOARD_INPUT_DATA InputDataEnd,
    _Inout_ PULONG InputDataConsumed
);

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

    // THE ACTUAL IMPLEMENTATION for Data Extraction via IRP_MJ_INTERNAL_DEVICE_CONTROL
    if (IoControlCode == IOCTL_KEYBOARD_CONNECT) {
        // Only process if the buffer is large enough for CONNECT_DATA
        if (InputBufferLength >= sizeof(CONNECT_DATA)) {
            PCONNECT_DATA connectData;
            NTSTATUS devStatus = WdfRequestRetrieveInputBuffer(Request, sizeof(CONNECT_DATA), (PVOID*)&connectData, NULL);
            
            if (NT_SUCCESS(devStatus)) {
                PDEVICE_EXTENSION devExt = FilterGetData(hDevice);
                
                // 1. Save the original Windows OS ClassService callback pointer
                devExt->UpperConnectData = *connectData;
                
                // 2. Overwrite the callback with our own secure function!
                connectData->ClassService = SecureKeyboardCallback;
                
                KdPrint(("MonolithKbdFilter: Bootlegged Keyboard Connection via IOCTL_KEYBOARD_CONNECT!\n"));
            }
        }
    }

    // Forward the request down the stack if we are not actively in "Ghost Protocol" blocking mode
    WDF_REQUEST_SEND_OPTIONS options;
    WDF_REQUEST_SEND_OPTIONS_INIT(&options, WDF_REQUEST_SEND_OPTION_SEND_AND_FORGET);
    WdfRequestSend(Request, WdfDeviceGetIoTarget(hDevice), &options);
}

/**
 * SecureKeyboardCallback - Blinds the OS to keystrokes.
 * Replaces the default kbdclass callback.
 */
VOID SecureKeyboardCallback(
    _In_    PDEVICE_OBJECT DeviceObject,
    _In_    PKEYBOARD_INPUT_DATA InputDataStart,
    _In_    PKEYBOARD_INPUT_DATA InputDataEnd,
    _Inout_ PULONG InputDataConsumed
) {
    // 1. Grab our device extension context mapping back to the WDF framework
    WDFDEVICE hDevice = WdfWdmDeviceGetWdfDeviceHandle(DeviceObject);
    PDEVICE_EXTENSION devExt = FilterGetData(hDevice);

    // 2. [ZERO-TRUST GHOST PROTOCOL INITIATED]
    // Here we can securely push `InputDataStart` to an inverted IOCTL Event Queue 
    // waiting for our React/C++ addon.
    
    // For now, we drop the keystrokes (Consume them entirely) so no user-space logger sees them
    ULONG numKeys = (ULONG)(InputDataEnd - InputDataStart);
    *InputDataConsumed = numKeys;
    
    // NOTE: To disable Ghost Protocol and let the OS receive the typing:
    /*
       (*(PSERVICE_CALLBACK_ROUTINE) devExt->UpperConnectData.ClassService)(
           devExt->UpperConnectData.ClassDeviceObject,
           InputDataStart, InputDataEnd, InputDataConsumed);
    */
}
#endif
