import urllib.request
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

req = urllib.request.Request("https://127.0.0.1:8420/v1/chat/render/abc", method="GET")

try:
    with urllib.request.urlopen(req, context=ctx) as response:
        print("Status:", response.status)
        first_chunk = response.read(4)
        if len(first_chunk) == 4:
            size = int.from_bytes(first_chunk, 'big')
            print("First chunk size:", size)
except Exception as e:
    print("Error:", e)
