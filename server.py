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

import json
import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

export_keys = {}

# Disable all AI telemetry
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["DO_NOT_TRACK"] = "1"
os.environ["ANONYMIZED_TELEMETRY"] = "False"

import time
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

from llama_cpp import Llama
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

app = FastAPI(title="Gemma 4 E4B Inference", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "file://"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

        print(f"[server] Loading model from {MODEL_PATH}")
        print(f"[server] Context: {CONTEXT_SIZE} tokens ({CONTEXT_SIZE // 1024}K)")
        print(f"[server] GPU layers: {GPU_LAYERS}")
        print(f"[server] KV cache: K={k_name}, V={v_name} (4-bit quantized)")
        print(f"[server] Flash Attention: {'enabled' if FLASH_ATTN else 'disabled'}")

        _model = Llama(
            model_path=MODEL_PATH,
            n_ctx=CONTEXT_SIZE,
            n_gpu_layers=GPU_LAYERS,
            flash_attn=FLASH_ATTN,
            type_k=CACHE_TYPE_K,
            type_v=CACHE_TYPE_V,
            verbose=False,
        )
        print(f"[server] Model loaded — {CONTEXT_SIZE // 1024}K context, KV: K={k_name} V={v_name}")
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


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "model": Path(MODEL_PATH).name,
        "context_size": CONTEXT_SIZE,
    }

@app.post("/v1/chat/completions", response_model=None)
async def chat_completions(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    stream = body.get("stream", True)
    max_tokens = body.get("max_tokens", 2048)
    temperature = body.get("temperature", 0.7)
    top_p = body.get("top_p", 0.9)
    enable_thinking = body.get("enable_thinking", True)
    thinking_budget = body.get("thinking_budget", 1024)

    if not messages:
        return JSONResponse(
            status_code=400,
            content={"error": "messages array is required"},
        )

    model = get_model()
    processed_messages = inject_thinking(messages, enable_thinking, thinking_budget)
    effective_max_tokens = max_tokens + thinking_budget if enable_thinking else max_tokens

    if not stream:
        t_start = time.perf_counter()
        result = model.create_chat_completion(
            messages=processed_messages,
            max_tokens=effective_max_tokens,
            temperature=temperature,
            top_p=top_p,
            stream=False,
        )
        t_end = time.perf_counter()
        total_ms = (t_end - t_start) * 1000
        comp_tokens = result.get("usage", {}).get("completion_tokens", 0)
        prompt_tokens = result.get("usage", {}).get("prompt_tokens", 0)
        tps = comp_tokens / (total_ms / 1000) if total_ms > 0 else 0

        result["timings"] = {
            "ttft_ms": round(total_ms, 1),
            "total_ms": round(total_ms, 1),
            "tokens": comp_tokens,
            "prompt_tokens": prompt_tokens,
            "tps": round(tps, 2),
        }
        return JSONResponse(content=result)

    # ── Streaming response with telemetry ─────────────────────────────────
    async def generate() -> AsyncGenerator[str, None]:
        completion_id = f"chatcmpl-{int(time.time() * 1000)}"
        t_start = time.perf_counter()
        t_first_token = None
        token_count = 0

        response_stream = model.create_chat_completion(
            messages=processed_messages,
            max_tokens=effective_max_tokens,
            temperature=temperature,
            top_p=top_p,
            stream=True,
        )

        try:
            for chunk in response_stream:
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                if content:
                    if t_first_token is None:
                        t_first_token = time.perf_counter()

                    token_count += 1
                    payload = {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "choices": [
                            {
                                "index": 0,
                                "delta": {"content": content},
                                "finish_reason": None,
                            }
                        ],
                    }
                    yield f"data: {json.dumps(payload)}\n\n"
        except Exception as e:
            msg = str(e)
            if "llama_decode returned" in msg:
                err_msg = "\n\n⚠️ [System: Generation halted. The required context has exceeded the physical Unified Memory limit or Context Window limit of this machine. Please clear the conversation or reduce Max Tokens/Thinking Budget.]"
            else:
                err_msg = f"\n\n⚠️ [System Error: {msg}]"
                
            payload = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "choices": [{"index": 0, "delta": {"content": err_msg}, "finish_reason": "length"}]
            }
            yield f"data: {json.dumps(payload)}\n\n"

        # ── Final telemetry chunk ────────────────────────────────────────
        t_end = time.perf_counter()
        total_ms = (t_end - t_start) * 1000
        ttft_ms = ((t_first_token - t_start) * 1000) if t_first_token else total_ms
        decode_time_s = (t_end - (t_first_token or t_start))
        tps = token_count / decode_time_s if decode_time_s > 0 else 0

        timings_payload = {
            "id": completion_id,
            "object": "chat.completion.timings",
            "timings": {
                "ttft_ms": round(ttft_ms, 1),
                "total_ms": round(total_ms, 1),
                "tokens": token_count,
                "tps": round(tps, 2),
            },
        }
        yield f"data: {json.dumps(timings_payload)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@app.get("/v1/chat/render/{conversation_id}")
async def get_chat_render(conversation_id: str):
    history = vault.get_history(conversation_id)
    if not history:
        history = [{"role": "system", "content": "Start a new secure session."}]
    png_bytes = render_chat_history(history, "")
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

@app.get("/v1/chat/export/{conversation_id}")
async def export_vault(conversation_id: str):
    if conversation_id not in vault.buffers:
        return JSONResponse(status_code=404, content={"error": "Vault not found"})
        
    raw_buffer = vault.buffers[conversation_id]
    
    # Generate 256-bit AES Key and 96-bit Nonce
    key = os.urandom(32)
    nonce = os.urandom(12)
    
    aesgcm = AESGCM(key)
    # The payload is entirely encrypted, immune to clipboard scrapers
    ciphertext = aesgcm.encrypt(nonce, bytes(raw_buffer), None)
    
    # Store the key volatile for exactly one fetch via image_renderer
    # Convert to readable hex for user backup
    export_keys[conversation_id] = key.hex()
    
    # Prepend Nonce to Ciphertext for standard GCM structure
    final_payload = nonce + ciphertext
    
    return StreamingResponse(
        iter([final_payload]),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename=Monolith_Vault_{conversation_id[:8]}.enc"
        }
    )

@app.get("/v1/chat/export/key/{conversation_id}")
async def export_vault_key(conversation_id: str):
    key_hex = export_keys.pop(conversation_id, None)
    if not key_hex:
         png_bytes = render_chat_history([], "[SECURITY WARNING]\nDecryption Key destroyed or never existed.")
    else:
         content = f"VAULT EXPORT SUCCESSFUL\n\nAES-256-GCM DECRYPTION KEY:\n{key_hex}\n\nWarning: This key has been purged from Memory. If you close this window, the file is permanently unreadable."
         png_bytes = render_chat_history([], content)
         
    # We do NOT return a length prefix here since we expect a raw image/png response for an <img> tag or buffer
    return StreamingResponse(
        iter([png_bytes]),
        media_type="image/png"
    )

@app.post("/v1/chat/stream_canvas")
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
    
    offset = header_sz
    conv_id_bytes = body[offset:offset+convId_len]
    offset += convId_len
    
    if offset + 4 > len(body):
        return StreamingResponse(iter([]), status_code=400)
        
    secret_len = struct.unpack_from("!I", body, offset)[0]
    offset += 4
    secret_bytes = body[offset:offset+secret_len]
    
    conv_id_str = conv_id_bytes.decode('utf-8')
    
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
        response_stream = model.create_chat_completion(
            messages=processed_messages,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            stream=True,
        )

        full_content = ""
        last_yield_time = time.time()
        
        try:
            for chunk in response_stream:
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                if content:
                    full_content += content
                    
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
                
                # Append to secure vault
                vault.append_message(conv_id_str, "assistant", full_content)
            
        except Exception as e:
            full_content += f"\n\n[System Error: {str(e)}]"
            png_bytes = render_chat_history(history, full_content)
            length_prefix = len(png_bytes).to_bytes(4, byteorder='big')
            yield length_prefix + png_bytes
        
        finally:
            import gc
            # Manually trigger garbage collection here to destroy string allocations from `llama_cpp_python`
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
        log_level="critical",
        ssl_keyfile="key.pem",
        ssl_certfile="cert.pem"
    )
