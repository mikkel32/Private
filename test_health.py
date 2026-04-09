import urllib.request
import ssl
ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
try:
    req = urllib.request.Request("https://127.0.0.1:8420/health", method="GET")
    with urllib.request.urlopen(req, context=ctx) as r: print("Health:", r.status, r.read())
except Exception as e: print("Error:", e)
