import urllib.request
import json
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

data = json.dumps({
    "conversation_id": "testsuite",
    "message": {"role": "user", "content": "hello world"},
    "max_tokens": 100,
    "temperature": 0.7,
    "top_p": 0.9,
    "enable_thinking": False
}).encode('utf-8')

req = urllib.request.Request("https://127.0.0.1:8420/v1/chat/stream_canvas", data=data, method="POST")
req.add_header('Content-Type', 'application/json')

try:
    print("Sending request...")
    with urllib.request.urlopen(req, context=ctx) as response:
        print("Status:", response.status)
        first_chunk = response.read(4)
        if len(first_chunk) == 4:
            size = int.from_bytes(first_chunk, 'big')
            print("First chunk size:", size)
            payload = response.read(size)
            print("Payload length read:", len(payload))
        else:
            print("Failed to read 4 bytes. Got:", first_chunk)
except urllib.error.HTTPError as e:
    print("HTTP Error:", e.code, e.read().decode('utf-8', errors='replace'))
except Exception as e:
    print("Error:", e)
