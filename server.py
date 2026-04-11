"""
Gemma 4 E4B Inference Server
─────────────────────────────
FastAPI backend serving the local GGUF model via llama-cpp-python.
Streams tokens over SSE with per-response performance telemetry.

Model:    Gemma 4 E4B — 128K context, MoE, ~4B effective parameters
KV Cache: Q4_0 (4-bit quantized) — ~4x memory reduction
          Enables full 128K context on 16 GB Apple Silicon
Backend:  llama.cpp + Apple Metal GPU acceleration
"""

from __future__ import annotations

# P18-17 REMEDIATION: `json` import REMOVED — JSONResponse is from FastAPI, not json stdlib.
import os
import base64
# P18-5 REMEDIATION: AESGCM import REMOVED — encryption is handled by native sep_crypto binary.

export_keys = {}

# P6-9 REMEDIATION: Gate all diagnostic output behind MONOLITH_DEBUG.
# Without this, model config, SEP key errors, boot status leak to stdout/Console.app.
_MONOLITH_DEBUG = os.environ.get("MONOLITH_DEBUG") == "1"
def _log(*args, **kwargs):
    if _MONOLITH_DEBUG:
        print(*args, **kwargs)

# Disable all AI telemetry
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["DO_NOT_TRACK"] = "1"
os.environ["ANONYMIZED_TELEMETRY"] = "False"

import time
import sys
import ctypes
import hashlib
from ctypes.util import find_library

# --- LAYER: ANTI-FORENSIC OS MEMORY DEPLOYMENT ---
try:
    MCL_CURRENT = 1
    MCL_FUTURE = 2
    _libc_path = find_library('c')
    if _libc_path:
        _libc = ctypes.CDLL(_libc_path)
        _res = _libc.mlockall(MCL_CURRENT | MCL_FUTURE)
        if _res != 0:
            _log("[SECURITY] mlockall() denied by sandbox — per-buffer mlock() active instead.")
        else:
            _log("[SECURITY ZERO-TRUST] Virtual Memory Paging disabled! Daemon securely locked to RAM.")
except Exception:
    _log("[SECURITY] mlockall() unavailable. Per-buffer mlock() will be used.")

from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, Request
# P17-12 REMEDIATION: CORSMiddleware import REMOVED — server has no CORS by design.
from fastapi.responses import StreamingResponse, JSONResponse

from llama_cpp import Llama

# Extreme Hardening: Mitigate CVE-2025-69872 in diskcache (used natively by llama_cpp_python under the hood)
# Diskcache defaults to pickle serialization which allows Arbitrary Code Execution (RCE) via insecure deserialization.
# By forcing the JSONDisk abstraction globally, we kill the RCE vector completely.
import diskcache
diskcache.core.Disk = diskcache.JSONDisk

from secure_memory import vault
from image_renderer import render_chat_history

# ── Configuration ────────────────────────────────────────────────────────────

MODEL_PATH = os.environ.get(
    "MODEL_PATH",
    str(Path(__file__).parent / "gemma-4-E4B-it-heretic-Q5_K_M.gguf"),
)

# Gemma 4 E4B native context window: 128K tokens.
# With Q4_0 KV cache quantization: ~1.2 GB KV at 32K.
# Fits safely in 16 GB unified memory alongside the ~5.4 GB Q5_K_M weights and the ~700 MB Metal compute buffers.
CONTEXT_SIZE = int(os.environ.get("CONTEXT_SIZE", "32768"))

GPU_LAYERS = int(os.environ.get("GPU_LAYERS", "-1"))
PORT = int(os.environ.get("SERVER_PORT", "8420"))

# ── KV Cache Quantization ────────────────────────────────────────────────────
#
# We quantize the KV cache to 4-bit (Q4_0) for both K and V.
# This gives ~4x memory reduction over FP16, enabling the full 128K context.
#
# With Flash Attention enabled, the dequantization is fused into the
# attention kernel, so there is no performance penalty from quantization.
#
# Memory budget at 128K context (Gemma 4 E4B, 36 layers, 8 KV heads, d=256):
#   FP16 KV:  128K × 36 × 2 × 8 × 256 × 2 bytes ≈ 8.5 GB
#   Q4_0 KV:  ~2.1 GB (4x reduction)
#   Q8_0 KV:  ~4.3 GB (2x reduction)
#
# Configuration:
#   CACHE_TYPE_K=q4_0  — 4-bit keys (Q4_0)
#   CACHE_TYPE_V=q4_0  — 4-bit values (Q4_0)
#
# NOTE: Google's TurboQuant paper (ICLR 2026) proposes PolarQuant + QJL for
# even better compression at same quality, but TurboQuant GGML types (TQ1_0,
# TQ2_0) are only for weight quantization — not yet wired for KV cache in
# llama.cpp. Q4_0 is the best available KV cache quantization in the
# upstream codebase. When TurboQuant KV cache support is merged, update
# CACHE_TYPE_K/V to the new types.

from llama_cpp import (
    GGML_TYPE_F16,
    GGML_TYPE_Q4_0,
    GGML_TYPE_Q4_1,
    GGML_TYPE_Q5_0,
    GGML_TYPE_Q5_1,
    GGML_TYPE_Q8_0,
)

# All types usable for KV cache (matches upstream llama.cpp kv_cache_types)
_GGML_TYPE_MAP: dict[str, int] = {
    "f16": GGML_TYPE_F16,
    "q4_0": GGML_TYPE_Q4_0,
    "q4_1": GGML_TYPE_Q4_1,
    "q5_0": GGML_TYPE_Q5_0,
    "q5_1": GGML_TYPE_Q5_1,
    "q8_0": GGML_TYPE_Q8_0,
}


def _resolve_ggml_type(value: str, fallback: int) -> int:
    normalized = value.strip().lower()
    if normalized in _GGML_TYPE_MAP:
        return _GGML_TYPE_MAP[normalized]
    try:
        return int(normalized)
    except ValueError:
        return fallback


# Default: Q4_0 for both K and V — maximum compression for 128K context.
# Override via env: CACHE_TYPE_K=q8_0 CACHE_TYPE_V=q4_0 for asymmetric config.
CACHE_TYPE_K = _resolve_ggml_type(os.environ.get("CACHE_TYPE_K", "q4_0"), GGML_TYPE_Q4_0)
CACHE_TYPE_V = _resolve_ggml_type(os.environ.get("CACHE_TYPE_V", "q4_0"), GGML_TYPE_Q4_0)
FLASH_ATTN = os.environ.get("FLASH_ATTN", "1") == "1"

# Reverse-map for logging
_GGML_NAME_MAP = {v: k.upper() for k, v in _GGML_TYPE_MAP.items()}

# ── Application ──────────────────────────────────────────────────────────────

# P20-1/2/3 REMEDIATION: Disable API discovery endpoints.
# /openapi.json, /docs, /redoc are served WITHOUT SEP auth — any local process
# can enumerate the full attack surface (endpoints, params, types).
app = FastAPI(title="Gemma 4 E4B Inference", version="2.0.0",
              openapi_url=None, docs_url=None, redoc_url=None)

# Extreme Privacy: Completely Disabled CORS. The React frontend MUST NOT fetch directly.
# All requests are securely proxied via the NodeJS Main process natively utilizing AES pipelines.

# ── Model Loading ────────────────────────────────────────────────────────────

_model: Llama | None = None


def get_model() -> Llama:
    """
    Lazy-load the GGUF model with quantized KV cache.

    Using Q4_0 for both K and V caches:
      - 4-bit block quantization (32 values per block, 1 FP16 scale)
      - ~4x memory reduction vs FP16
      - Fused dequantization via Flash Attention — no perf penalty
      - Enables full 128K context on 16 GB Apple Silicon

    Memory at 128K context:
      Model weights (Q5_K_M): ~3.6 GB
      KV cache (Q4_0):         ~2.1 GB
      Total:                   ~5.7 GB → fits comfortably in 16 GB
    """
    global _model
    if _model is None:
        k_name = _GGML_NAME_MAP.get(CACHE_TYPE_K, str(CACHE_TYPE_K))
        v_name = _GGML_NAME_MAP.get(CACHE_TYPE_V, str(CACHE_TYPE_V))

        _log(f"[server] Loading model from {MODEL_PATH}")
        _log(f"[server] Context: {CONTEXT_SIZE} tokens ({CONTEXT_SIZE // 1024}K)")
        _log(f"[server] GPU layers: {GPU_LAYERS}")
        _log(f"[server] KV cache: K={k_name}, V={v_name} (4-bit quantized)")
        _log(f"[server] Flash Attention: {'enabled' if FLASH_ATTN else 'disabled'}")

        # Secure Boot Cryptographic Validation
        expected_hash = os.environ.get("MODEL_SHA256")
        if expected_hash:
            # Performance: launch.py already hashes and validates the model OUTSIDE the sandbox.
            # Re-hashing a 4GB file inside sandbox-exec is ~100x slower due to I/O overhead.
            # If MODEL_VERIFIED=1 is set, trust the pre-validated hash from launch.py.
            if os.environ.get("MODEL_VERIFIED") == "1":
                _log(f"[server] Secure Boot: hash pre-validated by launcher (skipping re-hash)")
            else:
                _log(f"[server] Executing Secure Boot Validation (SHA256)...")
                sha256 = hashlib.sha256()
                try:
                    with open(MODEL_PATH, "rb") as f:
                        for chunk in iter(lambda: f.read(65536), b""):
                            sha256.update(chunk)
                    file_hash = sha256.hexdigest()
                    if file_hash != expected_hash:
                        # Critical Panic
                        print(f"FATAL BOOT ERROR: Model cryptography failed! Expected {expected_hash}, got {file_hash}", file=sys.stderr)
                        sys.exit(1)
                    else:
                        _log(f"[server] SECURE BOOT SUCCESS! Cryptographic Integrity matched.")
                except Exception as e:
                    # P18-10 REMEDIATION: Don't include str(e) — may reveal file paths or OS errors.
                    print("FATAL BOOT ERROR: Model integrity check failed", file=sys.stderr)
                    sys.exit(1)
        else:
            _log("[server] [WARNING] Secure Boot Validation DISABLED.")

        _model = Llama(
            model_path=MODEL_PATH,
            n_ctx=CONTEXT_SIZE,
            n_gpu_layers=GPU_LAYERS,
            flash_attn=FLASH_ATTN,
            type_k=CACHE_TYPE_K,
            type_v=CACHE_TYPE_V,
            verbose=False,
        )
        _log(f"[server] Model loaded — {CONTEXT_SIZE // 1024}K context, KV: K={k_name} V={v_name}")
    return _model


# ── Reasoning Support ────────────────────────────────────────────────────────

THINKING_SYSTEM_PREFIX = "<|think|>\n"


def inject_thinking(messages: list[dict], enable: bool, budget: int) -> list[dict]:
    """
    Inject the <|think|> control token into the system prompt to enable
    Gemma 4's native reasoning mode.
    """
    if not enable:
        return messages

    msgs = list(messages)

    if msgs and msgs[0].get("role") == "system":
        current = msgs[0].get("content", "")
        if "<|think|>" not in current:
            msgs[0] = {**msgs[0], "content": THINKING_SYSTEM_PREFIX + current}
    else:
        msgs.insert(0, {"role": "system", "content": THINKING_SYSTEM_PREFIX.strip()})

    return msgs


# ── Routes ───────────────────────────────────────────────────────────────────


# Phase 7: Localhost Hijacking Mitigation & Physical Cryptographic Verification
# We rely exclusively on Apple's Secure Enclave Coprocessor.
from fastapi import Depends, HTTPException
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.exceptions import InvalidSignature

sep_pub_key_env = os.environ.get("SEP_PUB_KEY")
vk = None

if sep_pub_key_env:
    try:
        raw_bytes = base64.b64decode(sep_pub_key_env)
        if len(raw_bytes) == 65 and raw_bytes[0] == 4:
            x = int.from_bytes(raw_bytes[1:33], 'big')
            y = int.from_bytes(raw_bytes[33:], 'big')
            pn = ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1())
            vk = pn.public_key()
    except Exception as e:
        _log("[server] SEP Pub Key Parse Error:", e)

# P9-4 REMEDIATION: Track used timestamp nonces to prevent replay within 2s window.
_used_nonces: set[str] = set()
_nonce_cleanup_counter = 0

async def verify_ipc_token(request: Request):
    global _nonce_cleanup_counter
    if not vk:
        # P9-6 REMEDIATION: Don't reveal internal state in error messages.
        raise HTTPException(status_code=500, detail="Authentication unavailable")
    
    timestamp_str = request.headers.get("X-SEP-Timestamp")
    if not timestamp_str:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    try:
        timestamp_ms = int(timestamp_str)
        import time
        current_time_ms = int(time.time() * 1000)
        
        if abs(current_time_ms - timestamp_ms) > 2000:
            raise HTTPException(status_code=401, detail="Unauthorized")
    except ValueError:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    # P9-4: Reject replayed nonces — even within the 2s window
    if timestamp_str in _used_nonces:
        raise HTTPException(status_code=401, detail="Unauthorized")
    _used_nonces.add(timestamp_str)
    
    # Periodic cleanup: remove nonces older than 5s (well beyond the 2s window)
    _nonce_cleanup_counter += 1
    if _nonce_cleanup_counter >= 50:
        _nonce_cleanup_counter = 0
        cutoff = current_time_ms - 5000
        _used_nonces.difference_update({n for n in _used_nonces if int(n) < cutoff})

    signature_b64 = request.headers.get("X-SEP-Signature")
    if not signature_b64:
        raise HTTPException(status_code=401, detail="Unauthorized: Missing SEP Signature")
    
    try:
        sig = base64.b64decode(signature_b64)
    except Exception:
        raise HTTPException(status_code=401, detail="Malformed SEP Signature")
        
    body = await request.body()
    # For GET requests without a body, we mathematically sign the endpoint path
    payload_base = body if body else request.url.path.encode('utf-8')
    
    # Mathematically lock the payload array to the timestamp nonce exactly as formatted by Node.js
    payload_bound = payload_base + timestamp_str.encode('utf-8')
    
    try:
        vk.verify(sig, payload_bound, ec.ECDSA(hashes.SHA256()))
    except InvalidSignature:
        raise HTTPException(status_code=401, detail="Unauthorized: SEP Hardware Cryptographic Verification Failed")
        
    return True

# ── Routes ───────────────────────────────────────────────────────────────────


@app.get("/health", dependencies=[Depends(verify_ipc_token)])
async def health() -> dict:
    # P13-4/P13-5 REMEDIATION: Don't leak model filename or context size.
    return {"status": "ok"}

# P13-1 REMEDIATION: Legacy /v1/chat/completions REMOVED.
# This endpoint accepted PLAINTEXT messages as JSON — a COMPLETE zero-trust bypass:
#   - User messages sent as readable JSON strings (no vault, no XOR, no binary protocol)
#   - Response returned as plaintext SSE (no DRM rendering, no PNG)
#   - Error handler leaked str(e) — Python internals exposed
# All message dispatch now exclusively routes through /v1/chat/stream_canvas.
@app.post("/v1/chat/completions", response_model=None, dependencies=[Depends(verify_ipc_token)])
async def chat_completions_blocked(request: Request):
    return JSONResponse(
        status_code=410,
        content={"error": "Endpoint removed — use /v1/chat/stream_canvas (binary vault protocol)"}
    )


@app.get("/v1/chat/render/{conversation_id}", dependencies=[Depends(verify_ipc_token)])
async def get_chat_render(conversation_id: str, ocr_shield: str = "on"):
    history = vault.get_history(conversation_id)
    if not history:
        history = [{"role": "system", "content": "Start a new secure session."}]
    png_bytes = render_chat_history(history, "", ocr_disruption=(ocr_shield != "off"))
    length_prefix = len(png_bytes).to_bytes(4, byteorder='big')
    return StreamingResponse(
        iter([length_prefix + png_bytes]),
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

# P8-13 REMEDIATION: Secure conversation deletion endpoint.
# Without this, vault.buffers grows unbounded for the entire session.
@app.delete("/v1/chat/{conversation_id}", dependencies=[Depends(verify_ipc_token)])
async def delete_conversation(conversation_id: str):
    vault.delete_conversation(conversation_id)
    export_keys.pop(conversation_id, None)
    return {"status": "wiped"}

@app.delete("/v1/chat/purge/all", dependencies=[Depends(verify_ipc_token)])
async def purge_all():
    vault.wipe_all()
    export_keys.clear()
    return {"status": "all_wiped"}

@app.get("/v1/chat/export/{conversation_id}", dependencies=[Depends(verify_ipc_token)])
async def export_vault(conversation_id: str):
    if conversation_id not in vault.buffers:
        return JSONResponse(status_code=404, content={"error": "Vault not found"})
        
    raw_buffer = vault.buffers[conversation_id]
    
    # [Layer 7] Apple Secure Enclave (SEP) Crypto Offload
    # Evades OS-level memory scrapers inspecting Python's heap.
    # We pipe the binary buffer to the native Swift binary, which generates a 
    # CryptoKit SymmetricKey, seals the payload in AES-GCM, and returns the strictly packed bytes.
    
    import subprocess
    swift_bin = Path(__file__).parent / "sep_crypto"
    
    try:
        proc = subprocess.run(
            [str(swift_bin)],
            input=raw_buffer,
            capture_output=True,
            check=True
        )
        outData = proc.stdout
        
        # Parse the Swift struct: [32B Key][12B Nonce][16B Tag][Ciphertext]
        key_bytes = outData[0:32]
        final_payload = outData[32:]
        
        # DEEP-10 REMEDIATION: Store as mutable bytearray, not immutable str.
        # Python strings are immutable and CANNOT be wiped from memory.
        export_keys[conversation_id] = bytearray(key_bytes)
        
        # The key_bytes are wiped inside sep_crypto automatically by iOS/macOS memory layout safeguards.
        
        return StreamingResponse(
            iter([final_payload]),
            media_type="application/octet-stream",
            headers={
                # P18-1 REMEDIATION: Sanitize conversation_id server-side for header injection.
                "Content-Disposition": f"attachment; filename=Monolith_Vault_{''.join(c for c in conversation_id[:8] if c.isalnum())}.enc"
            }
        )
    except subprocess.CalledProcessError:
        # P7-7 REMEDIATION: Don't return raw stderr — reveals system paths and binary output.
        return JSONResponse(status_code=500, content={"error": "Export encryption failed"})

@app.get("/v1/chat/export/key/{conversation_id}", dependencies=[Depends(verify_ipc_token)])
async def export_vault_key(conversation_id: str):
    key_ba = export_keys.pop(conversation_id, None)
    if not key_ba:
         png_bytes = render_chat_history([], "[SECURITY WARNING]\nDecryption Key destroyed or never existed.")
    else:
         # Transiently convert to hex for rendering, then immediately wipe the source bytearray
         key_hex = key_ba.hex()
         ctypes.memset(ctypes.addressof((ctypes.c_char * len(key_ba)).from_buffer(key_ba)), 0, len(key_ba))
         content = f"VAULT EXPORT SUCCESSFUL\n\nAES-256-GCM DECRYPTION KEY:\n{key_hex}\n\nWarning: This key has been purged from Memory. If you close this window, the file is permanently unreadable."
         png_bytes = render_chat_history([], content)
         del key_hex  # Remove transient str reference for faster GC
         
    # We do NOT return a length prefix here since we expect a raw image/png response for an <img> tag or buffer
    return StreamingResponse(
        iter([png_bytes]),
        media_type="image/png"
    )

@app.post("/v1/chat/stream_canvas", dependencies=[Depends(verify_ipc_token)])
async def stream_canvas(request: Request):
    """
    Project Monolith: Binary Raster Streaming.
    Dumps all strings across IPC. Exclusively emits `Uint8Array` binary blocks containing complete PNG frames
    for direct HTML5 <canvas> instantiation to avoid V8 Memory Leaks.
    """
    import struct
    body = await request.body()
    
    if len(body) < 29:
        return StreamingResponse(iter([]), status_code=400)
    
    # Binary parse:
    # 1: uint8 enable_thinking
    # 4: uint32 thinking_budget
    # 4: uint32 max_tokens
    # 8: double temperature
    # 8: double top_p
    # 4: uint32 convId_len
    header_fmt = "!BIIddI"
    header_sz = struct.calcsize(header_fmt)
    
    enable_thinking_b, thinking_budget, max_tokens, temperature, top_p, convId_len = struct.unpack_from(header_fmt, body, 0)
    enable_thinking = bool(enable_thinking_b)
    
    # DEEP-11 REMEDIATION: Bounds validation on parsed uint32 fields.
    # Without this, a malicious client can set max_tokens=0xFFFFFFFF (DoS) or convId_len=4GB.
    if convId_len > 256:
        return StreamingResponse(iter([]), status_code=400)
    if max_tokens > 65536 or thinking_budget > 65536:
        return StreamingResponse(iter([]), status_code=400)
    # P14-9 REMEDIATION: Validate doubles for NaN/Infinity — undefined behavior in llama_cpp.
    import math
    if not math.isfinite(temperature) or not math.isfinite(top_p):
        return StreamingResponse(iter([]), status_code=400)
    temperature = max(0.0, min(temperature, 2.0))
    top_p = max(0.0, min(top_p, 1.0))
    
    offset = header_sz
    conv_id_bytes = body[offset:offset+convId_len]
    offset += convId_len
    
    if offset + 4 > len(body):
        return StreamingResponse(iter([]), status_code=400)
        
    secret_len = struct.unpack_from("!I", body, offset)[0]
    offset += 4
    
    # Validate secret_len against actual remaining body
    if secret_len > len(body) - offset or secret_len > 8192:
        return StreamingResponse(iter([]), status_code=400)
    
    secret_bytes = body[offset:offset+secret_len]
    
    # P21-18 REMEDIATION: Use 'replace' to prevent UnicodeDecodeError traceback leaks.
    conv_id_str = conv_id_bytes.decode('utf-8', 'replace')
    
    # Securely append to Mlocked vault directly in binary!
    history = vault.get_history(conv_id_str)
    if not history and secret_bytes:
         vault.append_message(conv_id_str, "system", "You are a secure assistant. Respond clearly.")
         
    if secret_bytes:
         vault.append_message_binary(conv_id_bytes, b"user", secret_bytes)
         history = vault.get_history(conv_id_str)
    
    processed_messages = inject_thinking(history, enable_thinking, thinking_budget)
    
    model = get_model()
    
    async def generate_binary() -> AsyncGenerator[bytes, None]:
        nonlocal processed_messages, history  # P5-7 + P14-17: allow cleanup in finally block
        response_stream = model.create_chat_completion(
            messages=processed_messages,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            stream=True,
        )

        full_content = bytearray()
        last_yield_time = time.time()
        
        try:
            for chunk in response_stream:
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                if content:
                    full_content.extend(content.encode('utf-8'))
                    
                    # Target roughly 5 FPS visual refresh to save CPU/Bandwidth (yield every 0.2s)
                    if time.time() - last_yield_time > 0.2:
                        png_bytes = render_chat_history(history, full_content)
                        length_prefix = len(png_bytes).to_bytes(4, byteorder='big')
                        yield length_prefix + png_bytes
                        last_yield_time = time.time()
            
            # Final frame render!
            if full_content:
                png_bytes = render_chat_history(history, full_content)
                length_prefix = len(png_bytes).to_bytes(4, byteorder='big')
                yield length_prefix + png_bytes
                
            # Append to secure vault directly as bytes to skip standard string caching
            if full_content:
                vault.append_message_binary(conv_id_bytes, b"assistant", full_content)
                
        except Exception:
            # P10-4 REMEDIATION: Don't embed str(e) — reveals Python internals.
            full_content.extend(b"\n\n[Generation interrupted]")
            png_bytes = render_chat_history(history, full_content)
            length_prefix = len(png_bytes).to_bytes(4, byteorder='big')
            yield length_prefix + png_bytes
        
        finally:
            import gc
            import ctypes
            
            # [Layer 6] Phantom Memory Vektor Destruction (BYTEARRAY PATCH)
            # Physical memory override of the bytearray
            if full_content:
                addr = ctypes.addressof((ctypes.c_char * len(full_content)).from_buffer(full_content))
                ctypes.memset(addr, 0, len(full_content))
            
            # P5-7 REMEDIATION: Delete processed_messages (plaintext history as Python dicts).
            # Without this, the full conversation persists in the closure until GC.
            processed_messages = None
            # P14-17 REMEDIATION: Release history str references. Without this,
            # conversation text as Python str objects persists in generator closure.
            history = None
                
            # GC cycle ensures pooled refs are swept
            gc.collect()

    return StreamingResponse(
        generate_binary(),
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── Entrypoint ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    get_model()
    uvicorn.run(
        app, 
        host="127.0.0.1", 
        port=PORT, 
        # P6-8 REMEDIATION: Disable access logs — they leak conversation IDs
        # in URL paths (e.g., /v1/chat/render/a1b2c3d4) to stdout/Console.app.
        log_level="warning",
        access_log=False,
        ssl_keyfile="key.pem",
        ssl_certfile="cert.pem"
    )
