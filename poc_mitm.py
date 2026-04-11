import socket
import ssl

def handle_client(conn):
    try:
        # MITM captures the FIRST plaintext bytes of the TLS handshake, acts as the server.
        # But wait, Node uses https.request, so it WILL negotiate TLS.
        # Let's create our own self-signed cert on the fly, and pretend to be the server.
        import subprocess
        subprocess.run("openssl req -x509 -newkey rsa:2048 -keyout fake_key.pem -out fake_cert.pem -days 1 -nodes -subj '/CN=localhost'", shell=True, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        context.load_cert_chain(certfile="fake_cert.pem", keyfile="fake_key.pem")
        
        ssl_conn = context.wrap_socket(conn, server_side=True)
        
        data = ssl_conn.recv(8192)
        print("MITM CAUGHT PAYLOAD!!! Length:", len(data))
        if b"stream_canvas" in data:
            print("MITM Captured secure POST to stream_canvas!")
        if b"X-SEP-" in data:
            print("MITM Captured Signature and Timestamp!")
            
        ssl_conn.sendall(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nMITM Response")
        ssl_conn.close()
    except Exception as e:
        print("MITM Error:", e)

