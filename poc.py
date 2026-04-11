import urllib.request
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# To bypass authentication locally in a vulnerable way:
# If you make the FastAPI server log a trace or use the wrong middleware
# No, we need something where we *have* a valid signature.
# Wait, electron prints the public key (`---SEP_PUB_KEY---:...`). Can we just sign it ourselves?
# No, the public key is printed, the private key is generated inside the SEP and cannot be extracted:
# `SecKeyCreateRandomKey((__bridge CFDictionaryRef)attributes, &privateKeyError);`
# `SecKeyCopyExternalRepresentation` is only called for the PUBLIC key. The private key remains in hardware.
