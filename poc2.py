# Another PoC scratchpad... Let's look at `server.py` and `secure_memory.py`
# In `secure_memory.py`, parsing `conv_id` in `append_message_binary`:
# cid = conv_id.decode('utf-8') -> this creates a new string object! Strings are immutable.
# Also, in `server.py`: `conv_id_str = conv_id_bytes.decode('utf-8', 'replace')`
# This places the conversation ID into memory as an object... Not heavily secret since it's an ID, but still.

# What about Buffer Overflows? 
# In `server.py`:
# secret_len = struct.unpack_from("!I", body, offset)[0]
# if secret_len > len(body) - offset or secret_len > 8192:
#     return StreamingResponse(iter([]), status_code=400)
# secret_bytes = body[offset:offset+secret_len]

# What about `main.js`:
#     const req = https.request("https://127.0.0.1:8420/v1/chat/stream_canvas?ocr_shield=off", {
#       method: 'POST',
#       rejectUnauthorized: false,
#       headers: makeSEPHeaders(finalPayload)
#     });
# Node TLS `rejectUnauthorized: false`?!
# IN PRODUCTION?! 
# Yes, because the fast API uses a self-signed cert regenerated every run!
# Is it vulnerable? Oh yes!
# "Strict TLS Pinning" inside `main.js`:
# function validateFingerprint(res, req) {
#   const cert = res.socket.getPeerCertificate();
#   if (!cert || cert.fingerprint256 !== rawFingerprint) {
#      req.destroy();
#      return false;
#   }
# }

# BUT IN `fetch-history`, IT DOES IT IN `req.on('response')`

# Wait! If the response is intercepted, `req.on('response')` triggers, validation FAILS, and it aborts. 
# BUT `req.end(finalPayload)` happened ALREADY!
# The request was already sent to the Man-in-the-Middle! 
# validateFingerprint is called after the payload was already sent!

# LET'S VERIFY THIS.
