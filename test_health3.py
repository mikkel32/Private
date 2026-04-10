import urllib.request, ssl, os
import sys

ctx = ssl._create_unverified_context()
req = urllib.request.Request("https://127.0.0.1:8420/health")
req.add_header("Authorization", "Bearer ANY_TOKEN")
try:
    with urllib.request.urlopen(req, timeout=2, context=ctx) as r:
        print("OK", r.status)
except urllib.error.HTTPError as e:
    print("HTTPError:", e.code, e.reason)
    print("Response:", e.read())
except Exception as e:
    print("Exception:", type(e), e)
