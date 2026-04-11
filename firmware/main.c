/**
 * PROJECT MONOLITH: AIR-GAPPED HARDWARE KEYBOARD
 * Target: Raspberry Pi Pico (RP2040) / TinyUSB
 * 
 * Description: 
 * This firmware acts as a Custom Human Interface Device (HID).
 * Instead of sending standard Keyboard HID Reports (which the macOS Kernel logs),
 * it encrypts the keystrokes using a hardcoded AES/XOR cipher on the microcontroller.
 * The macOS Kernel only sees random bytes. NodeHID extracts it directly.
 */

#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include "bsp/board.h"
#include "tusb.h"

// P23-19 SECURITY WARNING: This key is a DEVELOPMENT PLACEHOLDER.
// In production, the key MUST be provisioned via ECDH key exchange during USB pairing.
// The host reads USB_AES_KEY from environment. NEVER commit the production key.
// TODO: Implement secure pairing protocol (ECDH over HID endpoint 2).
const uint8_t MONOLITH_XOR_KEY = 0x8F; // DEVELOPMENT ONLY — NOT FOR PRODUCTION

// Custom HID Report Descriptor (Not a keyboard, just a raw data pipe)
uint8_t const desc_hid_report[] = {
    0x06, 0x00, 0xFF,  // Usage Page (Vendor Defined 0xFF00)
    0x09, 0x01,        // Usage (0x01)
    0xA1, 0x01,        // Collection (Application)
    0x09, 0x02,        //   Usage (0x02)
    0x15, 0x00,        //   Logical Minimum (0)
    0x26, 0xFF, 0x00,  //   Logical Maximum (255)
    0x75, 0x08,        //   Report Size (8 bits)
    0x95, 0x08,        //   Report Count (8 bytes per payload)
    0x81, 0x02,        //   Input (Data, Variable, Absolute)
    0xC0               // End Collection
};

// Invoked when received GET HID REPORT DESCRIPTOR
uint8_t const * tud_hid_descriptor_report_cb(uint8_t instance) {
    return desc_hid_report;
}

// ---------------------------------------------------------
// Switch matrix / Debounce logic goes here
// For demonstration, we simulate typing "HELLO" encrypted
// ---------------------------------------------------------

void send_encrypted_keystroke(char c) {
    if (tud_hid_ready()) {
        uint8_t payload[8] = {0};
        
        // Byte 0: Sequence/Nonce
        payload[0] = (uint8_t)(board_millis() & 0xFF);
        // Byte 1: Encrypted Character
        payload[1] = c ^ MONOLITH_XOR_KEY; 
        
        // Obfuscation padding
        for (int i = 2; i < 8; i++) {
            payload[i] = rand() % 256;
        }

        tud_hid_report(0, payload, sizeof(payload));
    }
}

int main(void) {
    board_init();
    tusb_init();

    uint32_t last_time = 0;
    while (1) {
        tud_task(); // TinyUSB device task

        // Simulate typing a physical keyboard switch
        if (board_millis() - last_time > 2000) {
            send_encrypted_keystroke('A');
            last_time = board_millis();
        }
    }
    return 0;
}
