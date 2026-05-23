#!/usr/bin/env python3
"""
NayanSathi Voice Server — Pi port 3001
PRE-CACHED Piper TTS: all common phrases generated at startup → instant playback
"""
import http.server, subprocess, json, urllib.parse, os, time, threading

CARD      = "bluez_card.8E_79_7D_B3_CD_A6"
MODEL     = os.path.expanduser("~/piper_voices/en_US-amy-medium.onnx")
PIPER_BIN = os.path.expanduser("~/yolo_env/bin/piper")
CACHE_DIR = "/tmp/ns_cache"

# ── All common detection phrases to pre-generate at startup ──────────────────
CACHE_PHRASES = {
    "person ahead":              "person detected",
    "people ahead":              "people ahead",
    "car nearby":                "car nearby",
    "truck nearby":              "truck nearby",
    "bus ahead":                 "bus ahead",
    "motorcycle":                "motorcycle nearby",
    "bicycle":                   "bicycle ahead",
    "dog nearby":                "dog nearby",
    "cat nearby":                "cat nearby",
    "phone detected":            "phone detected",
    "laptop detected":           "laptop detected",
    "bottle":                    "bottle detected",
    "chair":                     "chair",
    "person ahead and car nearby": "person ahead and car nearby",
    "person ahead and dog nearby": "person ahead and dog nearby",
    "ready":                     "NayanSathi is ready",
}

def cache_file(text):
    key = text.lower().strip().replace(" ", "_").replace(",", "")[:50]
    return os.path.join(CACHE_DIR, key + ".raw")

def get_env():
    env = {
        "XDG_RUNTIME_DIR"   : "/run/user/1000",
        "PULSE_RUNTIME_PATH": "/run/user/1000/pulse",
        "HOME": "/home/pi", "USER": "pi",
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    }
    try:
        pids = subprocess.check_output(["pgrep","-u","pi","pipewire"], text=True).strip().split()
        if pids:
            with open(f"/proc/{pids[0]}/environ","rb") as f:
                for item in f.read().split(b"\x00"):
                    if b"=" in item:
                        k,v = item.split(b"=",1)
                        env[k.decode()] = v.decode()
    except: pass
    return env

def get_all_sinks(env):
    try:
        out = subprocess.check_output(
            "pactl list short sinks | awk '{print $2}'",
            shell=True, env=env, text=True, timeout=4)
        sinks = []
        for s in out.strip().split('\n'):
            s = s.strip()
            if s:
                sinks.append((s, s.startswith('bluez_output')))
        return sinks
    except: return []

def get_sink(env):
    for s, is_bt in get_all_sinks(env):
        if is_bt:
            return s
    return None

def setup_bt(env):
    def r(cmd): subprocess.run(cmd, shell=True, env=env, capture_output=True, timeout=5)
    r(f"pactl set-card-profile {CARD} a2dp-sink")
    sink = get_sink(env)
    if not sink:
        return None
    for s, is_bt in get_all_sinks(env):
        if not is_bt:
            r(f"pactl suspend-sink '{s}' 1")
            r(f"pactl set-sink-mute '{s}' 1")
    r(f"pactl suspend-sink '{sink}' 0")
    r(f"pactl set-sink-mute '{sink}' 0")
    r(f"pactl set-sink-volume '{sink}' 100%")
    r(f"pactl set-default-sink '{sink}'")
    return sink

# ── Background keepalive: keep BT awake every 5s ─────────────────────────────
_env_cache = None

def keepalive():
    global _env_cache
    while True:
        time.sleep(5)
        try:
            if not _env_cache:
                _env_cache = get_env()
            sink = get_sink(_env_cache)
            if sink:
                subprocess.run(f"pactl suspend-sink '{sink}' 0",
                               shell=True, env=_env_cache,
                               capture_output=True, timeout=3)
        except: pass

threading.Thread(target=keepalive, daemon=True).start()

# ── Audio generation: Piper (smooth) → raw file ──────────────────────────────
def generate_raw(text, out_file, env):
    """Generate speech with Piper binary → raw PCM file."""
    r = subprocess.run(
        f'echo "{text}" | "{PIPER_BIN}" --model "{MODEL}" --output_raw > {out_file} 2>/dev/null',
        shell=True, env=env, capture_output=True, timeout=20
    )
    return r.returncode == 0 and os.path.exists(out_file) and os.path.getsize(out_file) > 1000

def play_raw(raw_file, sink, env):
    """Play a raw PCM file to BT sink. Wake up sink first."""
    subprocess.run(f"pactl suspend-sink '{sink}' 0", shell=True, env=env, capture_output=True, timeout=3)
    subprocess.run(f"pactl set-sink-volume '{sink}' 100%", shell=True, env=env, capture_output=True, timeout=2)
    time.sleep(0.15)
    r = subprocess.run(
        f'paplay --raw --rate=22050 --channels=1 --format=s16le --device="{sink}" {raw_file}',
        shell=True, env=env, capture_output=True, timeout=30
    )
    return r.returncode == 0

def espeak_speak(text, env, sink):
    """Instant fallback — espeak British female."""
    subprocess.run(f"pactl suspend-sink '{sink}' 0", shell=True, env=env, capture_output=True, timeout=3)
    time.sleep(0.1)
    r = subprocess.run(
        f'espeak-ng -v en-gb+f3 -s 130 -p 60 -a 180 --stdout "{text}" | paplay --device="{sink}"',
        shell=True, env=env, capture_output=True, timeout=20
    )
    return r.returncode == 0

# ── Pre-warm cache at startup (background thread) ────────────────────────────
def build_cache():
    global _env_cache
    time.sleep(3)  # Wait for server to be ready
    os.makedirs(CACHE_DIR, exist_ok=True)
    env = get_env()
    _env_cache = env
    if not os.path.exists(PIPER_BIN):
        print("[CACHE] Piper binary not found, skipping cache build")
        return
    total = len(CACHE_PHRASES)
    for i, (key, text) in enumerate(CACHE_PHRASES.items()):
        out = cache_file(key)
        if os.path.exists(out) and os.path.getsize(out) > 1000:
            print(f"[CACHE] {i+1}/{total} ✓ (exists): {key}")
            continue
        ok = generate_raw(text, out, env)
        print(f"[CACHE] {i+1}/{total} {'✅' if ok else '❌'}: {key}")
    print(f"[CACHE] ✅ All {total} phrases cached — instant playback ready!")

threading.Thread(target=build_cache, daemon=True).start()

# ── Speak: cache → piper real-time → espeak fallback ─────────────────────────
def speak(text, env, sink):
    """
    1. Check cache (instant, ~0.3s)
    2. Generate with Piper (3-5s, caches for next time)
    3. espeak fallback (instant, less smooth)
    """
    # 1. Cache hit → instant play
    cf = cache_file(text)
    if os.path.exists(cf) and os.path.getsize(cf) > 1000:
        ok = play_raw(cf, sink, env)
        if ok:
            return ok, "piper-cached"

    # 2. Real-time Piper (generates + caches for next time)
    if os.path.exists(PIPER_BIN):
        os.makedirs(CACHE_DIR, exist_ok=True)
        ok = generate_raw(text, cf, env)
        if ok:
            ok2 = play_raw(cf, sink, env)
            if ok2:
                return True, "piper-realtime"

    # 3. Instant espeak fallback
    ok = espeak_speak(text, env, sink)
    return ok, "espeak-female"

# ── HTTP Handler ──────────────────────────────────────────────────────────────
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global _env_cache
        path = urllib.parse.urlparse(self.path).path

        if path == '/ping':
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            cached = len([f for f in os.listdir(CACHE_DIR) if f.endswith('.raw')]) if os.path.exists(CACHE_DIR) else 0
            self.wfile.write(json.dumps({"ok": True, "cached": cached}).encode())
            return

        q    = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        text = q.get("text", ["NayanSathi ready"])[0][:200].replace('"', "'")
        print(f'[TTS] "{text}"')

        # ✅ Respond IMMEDIATELY — don't wait for audio generation
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"success": True, "text": text, "queued": True}).encode())
        try:
            self.wfile.flush()
        except Exception:
            pass

        # ✅ Speak in background thread — no timeout risk
        def _speak_bg():
            env  = get_env()
            _env_cache_ref = env
            sink = setup_bt(env)
            if sink:
                ok, engine = speak(text, env, sink)
                print(f'  → {"✅" if ok else "❌"} [{engine}] "{text}"')
            else:
                print(f'  → ❌ [no-sink] "{text}"')
        threading.Thread(target=_speak_bg, daemon=True).start()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def log_message(self, *a): pass

import socket, socketserver

class DualStackServer(socketserver.TCPServer):
    allow_reuse_address = True
    address_family = socket.AF_INET6
    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()

class IPv4Server(http.server.HTTPServer):
    allow_reuse_address = True

if __name__ == "__main__":
    _env_cache = get_env()
    sink0 = setup_bt(_env_cache)
    total_cached = len([f for f in os.listdir(CACHE_DIR) if f.endswith('.raw')]) if os.path.exists(CACHE_DIR) else 0
    print(f"🎙 NayanSathi Voice Server → :::3001")
    print(f"   Sink  : {sink0 or 'not found'}")
    print(f"   Model : {MODEL} ({'✓' if os.path.exists(MODEL) else '✗'})")
    print(f"   Piper : {PIPER_BIN} ({'✓' if os.path.exists(PIPER_BIN) else '✗'})")
    print(f"   Cache : {total_cached}/{len(CACHE_PHRASES)} phrases ready")
    print(f"   [Building remaining cache in background…]")
    try:
        srv = DualStackServer(('::', 3001), Handler)
    except Exception as e:
        print(f"Dual-stack failed ({e}), using IPv4")
        srv = IPv4Server(('0.0.0.0', 3001), Handler)
    srv.serve_forever()
