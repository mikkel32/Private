import urllib.request, ssl, os
import sys

# Get IPC secret from command line args if possible, though we don't have it easily
# We just want to see the error for hitting it without auth to see if it's 403 or what HTTP issue

ctx = ssl._create_unverified_context()
req = urllib.request.Request("https://127.0.0.1:8420/health")
try:
    with urllib.request.urlopen(req, timeout=2, context=ctx) as r:
        print("OK", r.status)
except urllib.error.HTTPError as e:
    print("HTTPError:", e.code, e.reason)
except Exception as e:
    print("Exception:", type(e), e)
