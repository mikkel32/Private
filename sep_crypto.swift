import Foundation
import CryptoKit

// Read raw bytes from stdin
let stdinData = FileHandle.standardInput.readDataToEndOfFile()

// Generate a random 256-bit symmetric key
let key = SymmetricKey(size: .bits256)

// Extract the raw 32 bytes of the key
let keyData = key.withUnsafeBytes { Data($0) }

// Seal the data using AES-GCM
do {
    let sealedBox = try AES.GCM.seal(stdinData, using: key)
    
    // The Swift AES.GCM.SealedBox exposes nonce, tag, and ciphertext.
    // AES-GCM nonce is 12 bytes. Tag is 16 bytes.
    let nonce = sealedBox.nonce
    let tag = sealedBox.tag
    let ciphertext = sealedBox.ciphertext
    
    // Assemble the output: [32B Key][12B Nonce][16B Tag][Ciphertext]
    var outputData = Data()
    outputData.append(keyData)
    outputData.append(contentsOf: sealedBox.nonce)
    outputData.append(contentsOf: sealedBox.tag)
    outputData.append(contentsOf: sealedBox.ciphertext)
    
    // Write the binary data to stdout
    FileHandle.standardOutput.write(outputData)
    
} catch {
    fputs("Encryption failed\n", stderr)
    exit(1)
}
