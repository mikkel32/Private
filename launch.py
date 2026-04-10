#!/usr/bin/env python3
"""
Gemma Chat — Single-Command Launcher
─────────────────────────────────────
Bootstraps the entire stack:
  1. Python venv + llama-cpp-python (Metal GPU, Q4_0 KV cache)
  2. FastAPI inference server (128K context window)
  3. Vite + Electron desktop app

Usage:
    python3 launch.py
"""

from __future__ import annotations

import atexit
import os

# Disable all built-in AI telemetry and tracking mechanisms globally
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["DO_NOT_TRACK"] = "1"
os.environ["ANONYMIZED_TELEMETRY"] = "False"

import platform
import signal
import subprocess
import sys
import time
import urllib.request
import urllib.error
import ssl
from pathlib import Path

# ── Constants ────────────────────────────────────────────────────────────────

ROOT = Path(__file__).parent.resolve()
VENV_DIR = ROOT / ".venv"
NODE_MODULES = ROOT / "node_modules"
REQUIREMENTS = ROOT / "requirements.txt"
SERVER_SCRIPT = ROOT / "server.py"
SERVER_PORT = int(os.environ.get("SERVER_PORT", "8420"))
SERVER_URL = f"https://127.0.0.1:{SERVER_PORT}"
HEALTH_URL = f"{SERVER_URL}/health"

IS_APPLE_SILICON = platform.system() == "Darwin" and platform.machine() == "arm64"

# ── Utilities ────────────────────────────────────────────────────────────────


def log(msg: str, level: str = "INFO") -> None:
    prefix = {
        "INFO": "\033[36m⬡\033[0m",
        "OK": "\033[32m✓\033[0m",
        "WARN": "\033[33m⚠\033[0m",
        "ERR": "\033[31m✗\033[0m",
        "RUN": "\033[35m▶\033[0m",
    }.get(level, "•")
    print(f"  {prefix}  {msg}", flush=True)


def run(cmd: list[str], cwd: Path = ROOT, env: dict | None = None, **kwargs) -> int:
    merged_env = {**os.environ, **(env or {})}
    log(f"$ {' '.join(str(c) for c in cmd)}", "RUN")
    return subprocess.call(cmd, cwd=str(cwd), env=merged_env, **kwargs)


# ── Phase 1: Python Virtual Environment ─────────────────────────────────────


def ensure_venv() -> Path:
    python = VENV_DIR / "bin" / "python"
    if python.exists():
        log("Python venv already exists", "OK")
        return python

    log("Creating Python virtual environment…")
    subprocess.check_call([sys.executable, "-m", "venv", str(VENV_DIR)])
    log("venv created", "OK")
    return python


def install_python_deps(python: Path) -> None:
    """
    Install Python dependencies with Metal GPU acceleration for llama-cpp-python.

    KV cache quantization (Q4_0 for both K and V) is configured at the Python
    level in server.py — no special llama.cpp fork is needed. Q4_0 gives ~4x
    KV cache memory reduction, enabling the full 128K Gemma 4 E4B context
    window on 16 GB Apple Silicon.
    """
    pip = VENV_DIR / "bin" / "pip"

    run([str(pip), "install", "--upgrade", "pip", "-q"])

    env = {}
    if IS_APPLE_SILICON:
        log("Apple Silicon detected — enabling Metal GPU backend for llama-cpp")
        env["CMAKE_ARGS"] = "-DGGML_METAL=on"

    log("Installing Python dependencies (this may take a few minutes on first run)…")
    result = run(
        [str(pip), "install", "-r", str(REQUIREMENTS), "-q"],
        env=env,
    )
    if result != 0:
        log("Failed to install Python dependencies", "ERR")
        sys.exit(1)
    log("Python dependencies installed", "OK")


# ── Phase 2: Start Inference Server ──────────────────────────────────────────



def launch_electron_and_trap_key() -> tuple[subprocess.Popen, str]:
    log("Booting Electron dynamically to capture Ephemeral Hardware Key...")
    sign_electron()
    proc = subprocess.Popen(
        ["npx", "electron", "."],
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True
    )
    sep_pub_key = ""
    while True:
        line = proc.stdout.readline()
        if not line:
            break
        sys.stdout.write(f"  \033[90m[Electron]\033[0m {line}")
        if "---SEP_PUB_KEY---:" in line:
            sep_pub_key = line.split("---SEP_PUB_KEY---:")[1].strip()
            log("Volatile Secure Enclave Token captured successfully natively.")
            break
            
    if not sep_pub_key:
        log("Electron failed to emit Ephemeral Hardware Key natively.", "ERROR")
        sys.exit(1)
        
    import threading
    def drain():
        for l in proc.stdout:
            # sys.stdout.write(f"  \033[90m[Electron]\033[0m {l}")
            pass
    threading.Thread(target=drain, daemon=True).start()
    
    return proc, sep_pub_key

def start_server(python: Path, sep_pub_key: str) -> subprocess.Popen:
    log("Starting Gemma 4 E4B inference server (128K ctx) inside SECURE SANDBOX…")
    
    cmd = [str(python), str(SERVER_SCRIPT)]
    
    # [Layer 4: Agentic Autonomy Execution Sandboxing]
    if sys.platform == "darwin":
        sandbox_profile = str(ROOT / "monolith.sb")
        cmd = [
            "sandbox-exec", 
            "-D", f"PROJECT_DIR={str(ROOT)}", 
            "-D", f"VENV_DIR={str(VENV_DIR)}", 
            "-f", sandbox_profile
        ] + cmd
        log(f"  \033[90m↳ Enforcing Apple App Sandbox (monolith.sb with dynamic paths)\033[0m")
    elif sys.platform.startswith("linux"):
        # Bubblewrap pseudo-logic fallback
        cmd = [
            "bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc",
            "--tmpfs", "/tmp", "--bind", str(ROOT), str(ROOT),
            "--unshare-pid", "--unshare-ipc"
        ] + cmd
        log(f"  \033[90m↳ Enforcing Linux Bubblewrap (bwrap)\033[0m")

    safe_env = {}
    allowed_keys = {
        "PATH", "USER", "HOME", "LANG", "LC_ALL", "TMPDIR",
        "MODEL_PATH", "CONTEXT_SIZE", "GPU_LAYERS", "SERVER_PORT", "FLASH_ATTN"
    }

    safe_env["SEP_PUB_KEY"] = sep_pub_key

    proc = subprocess.Popen(
        cmd,
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=safe_env,
    )
    import threading

    def stream_output():
        if proc.stdout:
            for line in proc.stdout:
                print(f"  \033[90m[server]\033[0m {line}", end="", flush=True)

    threading.Thread(target=stream_output, daemon=True).start()
    return proc


def wait_for_server(server_proc: subprocess.Popen, sep_pub_key: str, timeout: int = 180) -> bool:
    """
    Poll the health endpoint until the server is ready.
    Loading the model + allocating 128K context KV cache takes 30-90s.
    """
    log(f"Waiting for server to be ready {SERVER_URL} (timeout: {timeout}s)…")
    start = time.time()
    ctx = ssl._create_unverified_context()
    while time.time() - start < timeout:
        if server_proc.poll() is not None:
            log(f"Server process abruptly terminated (exit code {server_proc.returncode})", "ERR")
            return False
            
        try:
            req = urllib.request.Request(HEALTH_URL)
            # The health endpoint might just require the pub key or basic presence
            req.add_header("Authorization", f"Bearer {sep_pub_key}")
            with urllib.request.urlopen(req, timeout=2, context=ctx) as resp:
                if resp.status == 200:
                    log("Inference server is ready", "OK")
                    return True
        except (urllib.error.HTTPError) as e:
            if e.code == 401:
                log("Server locked via IPC Secret — OK", "OK")
                return True
        except (urllib.error.URLError, ConnectionError, OSError) as _exc:
            with open("debug.log", "a") as f:
                f.write(f"URLError: {_exc}\\n")
            pass
        except Exception as _exc2:
            with open("debug.log", "a") as f:
                f.write(f"Exception: {_exc2}\\n")
            pass
        time.sleep(1)

    log(f"Server failed to start within {timeout}s", "ERR")
    return False

def generate_tls_certs() -> None:
    if not (ROOT / "key.pem").exists() or not (ROOT / "cert.pem").exists():
        log("Generating Ephemeral Self-Signed TLS Certificates…")
        run([
            "openssl", "req", "-x509", "-newkey", "rsa:4096", "-nodes",
            "-out", "cert.pem", "-keyout", "key.pem", "-days", "365",
            "-subj", "/CN=localhost"
        ])
    
    # Always generate fingerprint to ensure node receives latest hash mapping
    out = subprocess.check_output(["openssl", "x509", "-in", "cert.pem", "-noout", "-fingerprint", "-sha256"], cwd=str(ROOT))
    fingerprint = out.decode("utf-8").strip().split("=")[1]
    (ROOT / "cert_fingerprint.txt").write_text(fingerprint)


# ── Phase 3: Node.js / Electron ──────────────────────────────────────────────


def ensure_node_deps() -> None:
    if NODE_MODULES.exists() and (NODE_MODULES / ".package-lock.json").exists():
        log("Node dependencies already installed", "OK")
        return

    log("Installing Node dependencies via frozen lockfile…")
    result = run(["npm", "ci"])
    if result != 0:
        log("npm ci failed (try deleting node_modules and ensuring lockfile is synced)", "ERR")
        sys.exit(1)
    log("Node dependencies installed", "OK")


def start_vite() -> subprocess.Popen:
    log("Starting Vite dev server…")
    return subprocess.Popen(
        ["npx", "vite", "--port", "5173", "--strictPort"],
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def wait_for_vite(vite_proc: subprocess.Popen, timeout: int = 30) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        if vite_proc.poll() is not None:
            log(f"Vite process abruptly terminated (exit code {vite_proc.returncode})", "ERR")
            return False
            
        try:
            req = urllib.request.Request("http://localhost:5173")
            with urllib.request.urlopen(req, timeout=2):
                log("Vite dev server ready", "OK")
                return True
        except (urllib.error.URLError, ConnectionError, OSError):
            pass
        time.sleep(0.5)
    log("Vite dev server failed to start", "ERR")
    return False


def sign_electron() -> None:
    if not IS_APPLE_SILICON: return
    electron_app = NODE_MODULES / "electron" / "dist" / "Electron.app"
    entitlements = ROOT / "entitlements.mac.plist"
    if electron_app.exists() and entitlements.exists():
        log("Enforcing App Sandbox Entitlements on Electron binary…", "RUN")
        subprocess.run(["codesign", "--sign", "-", "--entitlements", str(entitlements), "--force", "--deep", str(electron_app)], capture_output=True)




def main() -> None:
    print()
    print("  \033[1m\033[35mGemma Chat\033[0m — Private Local AI")
    print("  ─────────────────────────────────")
    print("  Model:   Gemma 4 E4B (128K context)")
    print("  KV:      Q4_0 quantized (~4x compression)")
    print("  Backend: llama.cpp + Metal GPU")
    print()

    children: list[subprocess.Popen] = []

    def cleanup(*_):
        log("Shutting down…", "WARN")
        for p in reversed(children):
            try:
                p.terminate()
                p.wait(timeout=5)
            except Exception:
                p.kill()
        log("All processes stopped", "OK")

    atexit.register(cleanup)
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    # Phase 1: Environment Integration & Cryptography
    python = ensure_venv()
    generate_tls_certs()
    
    # Phase 2: Concurrent Dependency Bootstrapping
    import threading
    t1 = threading.Thread(target=install_python_deps, args=(python,))
    t2 = threading.Thread(target=ensure_node_deps)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    # Phase 3: Parallel Boot Sequence (Reversed for Hardware Context)
    vite_proc = start_vite()
    children.append(vite_proc)

    if not wait_for_vite(vite_proc):
        log("Aborting — Vite dev server failed", "ERR")
        sys.exit(1)

    # Extract volatile key via V8 natively bridged Driver mapping
    electron_proc, sep_pub_key = launch_electron_and_trap_key()
    children.append(electron_proc)
    
    server_proc = start_server(python, sep_pub_key)
    children.append(server_proc)

    if not wait_for_server(server_proc, sep_pub_key):
        log("Aborting — could not start inference server", "ERR")
        sys.exit(1)

    print()
    log("All systems running ✦", "OK")
    log(f"Server:   {SERVER_URL} (128K context · Q4_0 KV cache)")
    log(f"Frontend: http://localhost:5173")
    log("Close the Electron window to stop everything.")
    print()

    electron_proc.wait()
    log("Electron closed — cleaning up…", "WARN")


if __name__ == "__main__":
    main()
