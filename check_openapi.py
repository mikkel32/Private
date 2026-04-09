import urllib.request
import ssl
import subprocess
import time
import json

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

try:
    req = urllib.request.Request("https://127.0.0.1:8420/openapi.json", method="GET")
    with urllib.request.urlopen(req, context=ctx) as response:
        data = json.loads(response.read().decode())
        print("API Routes:")
        for path in data.get("paths", {}).keys():
            print(" -", path)
except Exception as e:
    print("Error fetching OpenAPI:", e)
