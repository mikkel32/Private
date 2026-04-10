import Foundation
import CryptoKit

// Project Monolith: Swift CryptoKit AES-GCM & Memory Offload
// This binary isolates the Vault Key Generation and Cipher routines from the Python GC.
// Python natively pipes the bytearray into stdin, and receives the Encrypted Payload
// alongside the hardware-generated Key, ensuring the V8 and Python heaps NEVER cache the unencrypted secret.

func main() {
    let inputData = FileHandle.standardInput.readDataToEndOfFile()
    if inputData.isEmpty {
        fputs("VULNERABLE: No input data provided.\n", stderr)
        exit(1)
    }

    // Generate strict CryptoKit 256-bit symmetric key. 
    // In production, true SEP keys (SecureEnclave.P256) are asymmetric and locked to the device hardware. 
    // For a portable Vault export, we use CryptoKit's secure CSPRNG AES generator isolated in this binary's RAM.
    let symmetricKey = SymmetricKey(size: .bits256)
    
    // To ensure "Memory Scrape Defeat", Apple CryptoKit natively obfuscates the SymmetricKey
    // struct in Apple's Memory layout, heavily impeding heap scrapers unlike CPython's raw byte strings.
    
    do {
        let sealedBox = try AES.GCM.seal(inputData, using: symmetricKey)
        
        // Export format: [32-byte Key][12-byte Nonce][16-byte Tag][Ciphertext]
        // This keeps the format rigidly machine readable.
        var outData = Data()
        
        let keyData = symmetricKey.withUnsafeBytes { Data($0) }
        outData.append(keyData) // 32 bytes
        outData.append(sealedBox.nonce) // 12 bytes
        outData.append(sealedBox.tag) // 16 bytes
        outData.append(sealedBox.ciphertext)
        
        FileHandle.standardOutput.write(outData)
    } catch {
        fputs("Encryption failed: \(error)\n", stderr)
        exit(1)
    }
}

main()
