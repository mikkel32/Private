import urllib.request
import ssl
import subprocess
import time
import sys

proc = subprocess.Popen(["python3", "server.py"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
print("Server started. Waiting 30 seconds for model to load...")
time.sleep(30)

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

url = "https://127.0.0.1:8420/v1/chat/render/test_conv"
try:
    print("Making request...")
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, context=ctx) as response:
        print("Status:", response.status)
        first_chunk = response.read(4)
        if len(first_chunk) == 4:
            size = int.from_bytes(first_chunk, 'big')
            print("First chunk size:", size)
except Exception as e:
    if hasattr(e, 'read'):
        print("Error Code:", e.code, e.read().decode('utf-8'))
    else:
        print("Error:", e)

proc.terminate()
