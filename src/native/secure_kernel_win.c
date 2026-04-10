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

#define CTL_CODE( DeviceType, Function, Method, Access ) (                 \
    ((DeviceType) << 16) | ((Access) << 14) | ((Function) << 2) | (Method) \
)
#define IOCTL_KEYBOARD_SECURE_READ CTL_CODE(FILE_DEVICE_KEYBOARD, 0x801, METHOD_BUFFERED, FILE_ANY_ACCESS)

// Forward declarations
DRIVER_INITIALIZE DriverEntry;
EVT_WDF_DRIVER_DEVICE_ADD EvtDriverDeviceAdd;
EVT_WDF_IO_QUEUE_IO_INTERNAL_DEVICE_CONTROL EvtIoInternalDeviceControl;
EVT_WDF_IO_QUEUE_IO_DEVICE_CONTROL EvtIoDeviceControl;

// Struct to store original connection data
typedef struct _DEVICE_EXTENSION {
    CONNECT_DATA UpperConnectData;
    WDFQUEUE PendingIoctlQueue;
    BOOLEAN GhostProtocolActive;
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

    WDF_DRIVER_CONFIG_INIT(&config, EvtDriverDeviceAdd);
    status = WdfDriverCreate(DriverObject, RegistryPath, WDF_NO_OBJECT_ATTRIBUTES, &config, WDF_NO_HANDLE);
    return status;
}

/**
 * EvtDriverDeviceAdd - Called when a new keyboard device is detected.
 */
NTSTATUS EvtDriverDeviceAdd(_In_ WDFDRIVER Driver, _Inout_ PWDFDEVICE_INIT DeviceInit) {
    UNREFERENCED_PARAMETER(Driver);
    NTSTATUS status;
    WDFDEVICE hDevice;
    WDF_IO_QUEUE_CONFIG queueConfig;

    WdfFdoInitSetFilter(DeviceInit);

    status = WdfDeviceCreate(&DeviceInit, WDF_NO_OBJECT_ATTRIBUTES, &hDevice);
    if (!NT_SUCCESS(status)) return status;

    PDEVICE_EXTENSION devExt = FilterGetData(hDevice);
    devExt->GhostProtocolActive = TRUE;

    // Default Queue for regular requests
    WDF_IO_QUEUE_CONFIG_INIT_DEFAULT_QUEUE(&queueConfig, WdfIoQueueDispatchParallel);
    queueConfig.EvtIoInternalDeviceControl = EvtIoInternalDeviceControl;
    queueConfig.EvtIoDeviceControl = EvtIoDeviceControl;

    status = WdfIoQueueCreate(hDevice, &queueConfig, WDF_NO_OBJECT_ATTRIBUTES, WDF_NO_HANDLE);
    if (!NT_SUCCESS(status)) return status;

    // Manual Queue for inverted IRP calls (pending requests from User-Mode)
    WDF_IO_QUEUE_CONFIG_INIT(&queueConfig, WdfIoQueueDispatchManual);
    status = WdfIoQueueCreate(hDevice, &queueConfig, WDF_NO_OBJECT_ATTRIBUTES, &devExt->PendingIoctlQueue);

    // Create a symbolic link so User-Mode can connect
    DECLARE_CONST_UNICODE_STRING(dosDeviceName, L"\\DosDevices\\MonolithKbd");
    WdfDeviceCreateSymbolicLink(hDevice, &dosDeviceName);

    return status;
}

VOID EvtIoDeviceControl(
    _In_ WDFQUEUE Queue,
    _In_ WDFREQUEST Request,
    _In_ size_t OutputBufferLength,
    _In_ size_t InputBufferLength,
    _In_ ULONG IoControlCode
) {
    UNREFERENCED_PARAMETER(InputBufferLength);
    WDFDEVICE hDevice = WdfIoQueueGetDevice(Queue);
    PDEVICE_EXTENSION devExt = FilterGetData(hDevice);

    if (IoControlCode == IOCTL_KEYBOARD_SECURE_READ) {
        if (OutputBufferLength < sizeof(KEYBOARD_INPUT_DATA)) {
            WdfRequestComplete(Request, STATUS_BUFFER_TOO_SMALL);
            return;
        }

        // Forward this request to our Manual Pending Queue
        NTSTATUS status = WdfRequestForwardToIoQueue(Request, devExt->PendingIoctlQueue);
        if (!NT_SUCCESS(status)) {
            WdfRequestComplete(Request, status);
        }
        return;
    }

    // Pass through standard requests
    WDF_REQUEST_SEND_OPTIONS options;
    WDF_REQUEST_SEND_OPTIONS_INIT(&options, WDF_REQUEST_SEND_OPTION_SEND_AND_FORGET);
    WdfRequestSend(Request, WdfDeviceGetIoTarget(hDevice), &options);
}

VOID EvtIoInternalDeviceControl(
    _In_ WDFQUEUE Queue,
    _In_ WDFREQUEST Request,
    _In_ size_t OutputBufferLength,
    _In_ size_t InputBufferLength,
    _In_ ULONG IoControlCode
) {
    UNREFERENCED_PARAMETER(OutputBufferLength);
    WDFDEVICE hDevice = WdfIoQueueGetDevice(Queue);

    if (IoControlCode == IOCTL_KEYBOARD_CONNECT) {
        if (InputBufferLength >= sizeof(CONNECT_DATA)) {
            PCONNECT_DATA connectData;
            NTSTATUS status = WdfRequestRetrieveInputBuffer(Request, sizeof(CONNECT_DATA), (PVOID*)&connectData, NULL);
            if (NT_SUCCESS(status)) {
                PDEVICE_EXTENSION devExt = FilterGetData(hDevice);
                devExt->UpperConnectData = *connectData;
                connectData->ClassService = SecureKeyboardCallback;
            }
        }
    }

    WDF_REQUEST_SEND_OPTIONS options;
    WDF_REQUEST_SEND_OPTIONS_INIT(&options, WDF_REQUEST_SEND_OPTION_SEND_AND_FORGET);
    WdfRequestSend(Request, WdfDeviceGetIoTarget(hDevice), &options);
}

VOID SecureKeyboardCallback(
    _In_    PDEVICE_OBJECT DeviceObject,
    _In_    PKEYBOARD_INPUT_DATA InputDataStart,
    _In_    PKEYBOARD_INPUT_DATA InputDataEnd,
    _Inout_ PULONG InputDataConsumed
) {
    WDFDEVICE hDevice = WdfWdmDeviceGetWdfDeviceHandle(DeviceObject);
    PDEVICE_EXTENSION devExt = FilterGetData(hDevice);

    if (devExt->GhostProtocolActive) {
        // Find a pending IRP from User-Mode
        WDFREQUEST request;
        NTSTATUS status = WdfIoQueueRetrieveNextRequest(devExt->PendingIoctlQueue, &request);
        
        if (NT_SUCCESS(status)) {
            PKEYBOARD_INPUT_DATA outBuffer;
            status = WdfRequestRetrieveOutputBuffer(request, sizeof(KEYBOARD_INPUT_DATA), (PVOID*)&outBuffer, NULL);
            if (NT_SUCCESS(status)) {
                // Return exactly one keystroke event to the user-mode app
                *outBuffer = *InputDataStart;
                WdfRequestCompleteWithInformation(request, STATUS_SUCCESS, sizeof(KEYBOARD_INPUT_DATA));
            } else {
                WdfRequestComplete(request, status);
            }
        }

        // Consume all input so typical keyloggers and OS are completely BLIND
        ULONG numKeys = (ULONG)(InputDataEnd - InputDataStart);
        *InputDataConsumed = numKeys;
    } else {
        // Pass to OS natively
        (*(PSERVICE_CALLBACK_ROUTINE) devExt->UpperConnectData.ClassService)(
            devExt->UpperConnectData.ClassDeviceObject,
            InputDataStart, InputDataEnd, InputDataConsumed);
    }
}
#endif
