#!/usr/bin/env python3
"""
NayanSathi v4.0 — Fast, Real, Accurate Detection + Bluetooth TTS
- Confidence: 0.50 (sensitive but real)
- Stability:  2 frames (fast confirmation, no fake detections)
- TTS:        auto-routes to Bluetooth headphone
- Output:     [DET_JSON] for browser bounding box overlay
"""

import cv2, numpy as np, subprocess, threading, time, sys, os, signal, argparse, json, shutil
from collections import defaultdict

try:
    import onnxruntime as ort
    print(f"\033[32m[INFO] onnxruntime {ort.__version__}\033[0m")
except ImportError:
    print("\033[31m[ERROR] pip3 install onnxruntime --break-system-packages\033[0m"); sys.exit(1)

# ── Args ───────────────────────────────────────────────────────────────────
ap = argparse.ArgumentParser()
ap.add_argument('--cam',    default=None)
ap.add_argument('--model',  default=os.path.expanduser('~/NayanSathi/yolo11n.onnx'))
ap.add_argument('--conf',   type=float, default=0.50)   # 0.50 = good sensitivity
ap.add_argument('--iou',    type=float, default=0.40)
ap.add_argument('--skip',   type=int,   default=2)      # every 2nd frame
ap.add_argument('--stable', type=int,   default=2)      # 2 frames = confirmed
ap.add_argument('--cool',   type=float, default=4.0)    # re-announce every 4s
ap.add_argument('--size',   type=int,   default=640)
args = ap.parse_args()

CONF    = args.conf
IOU     = args.iou
SKIP    = args.skip
STABLE  = args.stable
COOL    = args.cool
SIZE    = args.size
MODEL   = args.model

# ── COCO 80 class names ────────────────────────────────────────────────────
NAMES = [
    'person','bicycle','car','motorcycle','airplane','bus','train','truck','boat',
    'traffic light','fire hydrant','stop sign','parking meter','bench','bird',
    'cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe',
    'backpack','umbrella','handbag','tie','suitcase','frisbee','skis','snowboard',
    'sports ball','kite','baseball bat','baseball glove','skateboard','surfboard',
    'tennis racket','bottle','wine glass','cup','fork','knife','spoon','bowl',
    'banana','apple','sandwich','orange','broccoli','carrot','hot dog','pizza',
    'donut','cake','chair','couch','potted plant','bed','dining table','toilet',
    'tv','laptop','mouse','remote','keyboard','cell phone','microwave','oven',
    'toaster','sink','refrigerator','book','clock','vase','scissors',
    'teddy bear','hair drier','toothbrush'
]
PRIORITY = {'person','car','motorcycle','truck','bus','bicycle',
            'dog','cat','stop sign','traffic light'}
COLORS = {
    'person':'#ef4444',
    'car':'#f59e0b','truck':'#f59e0b','bus':'#f59e0b',
    'motorcycle':'#f59e0b','bicycle':'#f59e0b',
    'dog':'#10b981','cat':'#10b981','bird':'#10b981',
    'stop sign':'#ef4444','traffic light':'#ef4444',
}

CAM_URLS = [u for u in [
    args.cam,
    'http://192.168.1.33:81/stream',
    'http://192.168.1.33/stream',
    'http://192.168.1.33/?action=stream',
    'http://192.168.1.33',
] if u]

# ── Bluetooth Audio Setup ──────────────────────────────────────────────────
def setup_bluetooth_audio():
    """Find BT headphone sink and set it as default for PulseAudio."""
    try:
        result = subprocess.run(['pactl', 'list', 'short', 'sinks'],
                                capture_output=True, text=True)
        lines = result.stdout.strip().split('\n')
        bt_sink = None
        for line in lines:
            if 'bluez' in line.lower() or 'bluetooth' in line.lower():
                bt_sink = line.split()[1]
                break
        if bt_sink:
            subprocess.run(['pactl', 'set-default-sink', bt_sink], capture_output=True)
            # Also set BT card to A2DP for high quality
            cards = subprocess.run(['pactl', 'list', 'short', 'cards'],
                                   capture_output=True, text=True).stdout
            for card_line in cards.strip().split('\n'):
                if 'bluez' in card_line.lower():
                    card = card_line.split()[1]
                    subprocess.run(['pactl', 'set-card-profile', card, 'a2dp-sink'],
                                  capture_output=True)
                    print(f"\033[32m[BT] A2DP stereo set for {card}\033[0m")
                    break
            print(f"\033[32m[BT] Audio → {bt_sink}\033[0m")
            return bt_sink
        else:
            print("\033[33m[BT] No BT headphone found — using default audio\033[0m")
            return None
    except Exception as e:
        print(f"\033[33m[BT] Audio setup skipped: {e}\033[0m")
        return None

BT_SINK = setup_bluetooth_audio()

# ── TTS Engine ─────────────────────────────────────────────────────────────
def _find_tts():
    for e in ['flite', 'espeak-ng', 'espeak']:
        if shutil.which(e):
            print(f"\033[32m[TTS] Engine: {e}\033[0m"); return e
    print("\033[31m[TTS] No engine — sudo apt install flite -y\033[0m"); return None

TTS_ENG = _find_tts()
_tts_q  = []
_tts_p  = None

def _tts_cmd(text):
    """Build TTS command, routing to BT sink if available."""
    if TTS_ENG == 'flite':
        # flite output to play (uses PulseAudio default = BT if we set it above)
        return ['flite', '-voice', 'slt', '-t', text, '-o', 'play']
    elif TTS_ENG == 'espeak-ng':
        cmd = ['espeak-ng', '-v', 'en-us', '-s', '140', '-a', '200']
        if BT_SINK:
            # Route espeak to BT via paplay pipe trick
            return ['bash', '-c',
                    f'espeak-ng -v en-us -s 140 -a 200 --stdout -- "{text}" | paplay --device={BT_SINK}']
        cmd += ['--', text]; return cmd
    else:
        cmd = ['espeak', '-v', 'en', '-s', '140', '-a', '200']
        if BT_SINK:
            return ['bash', '-c',
                    f'espeak -v en -s 140 -a 200 --stdout -- "{text}" | paplay --device={BT_SINK}']
        cmd += ['--', text]; return cmd

def _tts_worker():
    global _tts_p
    while True:
        if _tts_q and TTS_ENG:
            text = _tts_q.pop(0)
            try:
                if _tts_p and _tts_p.poll() is None:
                    _tts_p.terminate(); _tts_p.wait(0.5)
                _tts_p = subprocess.Popen(
                    _tts_cmd(text),
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                _tts_p.wait()
            except Exception as ex:
                print(f"[TTS] Error: {ex}")
        time.sleep(0.04)

def speak(text):
    """Queue speech — drops old queued phrases, always speaks newest."""
    while len(_tts_q) > 1: _tts_q.pop(0)
    _tts_q.append(text)
    print(f"\033[35m[TTS] ▶ {text}\033[0m", flush=True)

threading.Thread(target=_tts_worker, daemon=True).start()

# ── Stability Tracker ──────────────────────────────────────────────────────
_track     = defaultdict(int)
_track_now = set()

def track_update(key):
    _track_now.add(key)
    _track[key] = min(_track[key] + 1, 10)  # cap at 10
    return _track[key] >= STABLE

def track_frame_end():
    for k in list(_track):
        if k not in _track_now:
            _track[k] = max(0, _track[k] - 1)
            if _track[k] == 0: del _track[k]
    _track_now.clear()

# ── Speech cooldown ────────────────────────────────────────────────────────
_last_spoken  = defaultdict(float)
_detect_count = defaultdict(int)

def should_speak(key, cd):
    now = time.time()
    if now - _last_spoken[key] >= cd:
        _last_spoken[key] = now; return True
    return False

# ── Direction / Distance ───────────────────────────────────────────────────
def direction(nx):                 # nx = normalized x center (0-1)
    if nx < 0.30: return "left"
    if nx > 0.70: return "right"
    return "ahead"

def distance_hint(nw, nh):
    a = nw * nh
    if a > 0.28: return "very close"
    if a > 0.07: return "nearby"
    return ""

# ── ONNX Model ─────────────────────────────────────────────────────────────
def load_model():
    if not os.path.exists(MODEL):
        print(f"\033[31m[ERROR] Model not found: {MODEL}\033[0m")
        print("  → Deploy from dashboard or check path"); sys.exit(1)
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 4
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess = ort.InferenceSession(MODEL, sess_options=opts,
                                providers=['CPUExecutionProvider'])
    print(f"\033[32m[INFO] ✓ {os.path.basename(MODEL)} loaded\033[0m")
    return sess, sess.get_inputs()[0].name, sess.get_outputs()[0].name

# ── Image Preprocessing ────────────────────────────────────────────────────
def preprocess(frame):
    h, w  = frame.shape[:2]
    scale = SIZE / max(h, w)
    nh, nw = int(h*scale), int(w*scale)
    resized = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_LINEAR)
    pad = np.full((SIZE, SIZE, 3), 114, np.uint8)
    pad[:nh, :nw] = resized
    blob = (pad.astype(np.float32) / 255.0).transpose(2, 0, 1)[np.newaxis]
    return blob, scale, h, w

# ── Postprocessing ─────────────────────────────────────────────────────────
def postprocess(raw, scale, orig_h, orig_w):
    out    = raw[0].T               # [N, 84]
    boxes  = out[:, :4]             # cx, cy, w, h  in SIZE-space
    scores = out[:, 4:]
    cls    = np.argmax(scores, 1)
    conf   = scores[np.arange(len(scores)), cls]

    mask = conf >= CONF
    boxes, conf, cls = boxes[mask], conf[mask], cls[mask]
    if not len(boxes): return []

    # cx,cy,w,h  (SIZE) → x,y,w,h (orig pixels)
    x  = np.clip((boxes[:,0] - boxes[:,2]/2) / scale, 0, orig_w)
    y  = np.clip((boxes[:,1] - boxes[:,3]/2) / scale, 0, orig_h)
    bw = np.clip(boxes[:,2] / scale, 0, orig_w - x)
    bh = np.clip(boxes[:,3] / scale, 0, orig_h - y)

    idx = cv2.dnn.NMSBoxes(
        np.stack([x, y, bw, bh], 1).tolist(),
        conf.tolist(), CONF, IOU)

    out_list = []
    for i in (idx.flatten() if len(idx) else []):
        # normalized center + size for browser
        nx = float((x[i] + bw[i]/2) / orig_w)
        ny = float((y[i] + bh[i]/2) / orig_h)
        nw_ = float(bw[i] / orig_w)
        nh_ = float(bh[i] / orig_h)
        out_list.append({
            'label': NAMES[cls[i]], 'conf': float(conf[i]),
            'nx': nx, 'ny': ny, 'nw': nw_, 'nh': nh_
        })
    return out_list

# ── Camera Connection ──────────────────────────────────────────────────────
def connect_cam():
    for url in CAM_URLS:
        print(f"\033[33m[CAM] → {url}\033[0m")
        cap = cv2.VideoCapture(url)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if cap.isOpened():
            ret, _ = cap.read()
            if ret:
                print(f"\033[32m[CAM] ✓ Connected: {url}\033[0m")
                return cap, url
        cap.release()
    return None, None

# ── Signal ─────────────────────────────────────────────────────────────────
running = True
def on_exit(s, f):
    global running; running = False
signal.signal(signal.SIGINT, on_exit)
signal.signal(signal.SIGTERM, on_exit)

# ── Main ───────────────────────────────────────────────────────────────────
def main():
    print("\033[36m")
    print("╔══════════════════════════════════════════════════════╗")
    print("║   👁️  NayanSathi v4.0  —  Smart Object Detection   ║")
    print(f"║   conf={CONF}  stable={STABLE}f  skip={SKIP}  cool={COOL}s       ║")
    print("╚══════════════════════════════════════════════════════╝\033[0m\n")

    sess, inp_name, out_name = load_model()

    cap, url = connect_cam()
    if not cap:
        print("\033[31m[ERROR] Cannot reach ESP32-CAM!\033[0m")
        print("  Try: python3 nayansathi.py --cam http://192.168.1.33:81/stream")
        sys.exit(1)

    speak("NayanSathi ready")
    print("\n\033[32m[RUNNING] Detecting objects... Ctrl+C to stop\033[0m\n")

    frame_n = 0; fps_f = 0; fps_t = time.time(); reconn = 0

    while running:
        ret, frame = cap.read()
        if not ret:
            reconn += 1
            print(f"\033[33m[WARN] No frame #{reconn} — reconnecting...\033[0m")
            cap.release(); time.sleep(2)
            cap, url = connect_cam()
            if not cap:
                time.sleep(5); cap, url = connect_cam()
                if not cap: break
            continue

        reconn = 0; frame_n += 1; fps_f += 1

        if frame_n % SKIP != 0:
            continue

        orig_h, orig_w = frame.shape[:2]
        blob, scale, oh, ow = preprocess(frame)

        try:
            raw = sess.run([out_name], {inp_name: blob})[0]
        except Exception as e:
            print(f"\033[31m[ERROR] Inference: {e}\033[0m"); continue

        dets = postprocess(raw, scale, oh, ow)

        # ── Stability check ────────────────────────────────────────────────
        stable_dets = []
        spoken_this = set()

        # Priority objects first, then by confidence
        dets.sort(key=lambda d: (d['label'] not in PRIORITY, -d['conf']))

        for d in dets:
            label = d['label']
            conf  = d['conf']
            nx, ny, nw_, nh_ = d['nx'], d['ny'], d['nw'], d['nh']
            dir_  = direction(nx)
            dist  = distance_hint(nw_, nh_)
            key   = f"{label}_{dir_}"
            stable = track_update(key)

            # Color coding for terminal
            c_stable = '\033[32m' if stable else '\033[33m'
            sym = '✓' if stable else '·'
            dist_str = f" ({dist})" if dist else ""
            print(f"{c_stable}[{'DETECT' if stable else 'weak  '}]\033[0m "
                  f"{sym} {label:<18} {conf:.0%}  {dir_:<6}{dist_str}", flush=True)

            if stable:
                stable_dets.append({
                    'l':   label,
                    'c':   round(conf, 2),
                    'nx':  round(nx, 4), 'ny': round(ny, 4),
                    'nw':  round(nw_, 4), 'nh': round(nh_, 4),
                    'dir': dir_,
                    'col': COLORS.get(label, '#00d4ff')
                })
                _detect_count[label] += 1

                # Speak if cooldown has passed
                cd = 2.5 if label in PRIORITY else COOL
                if key not in spoken_this and should_speak(key, cd):
                    spoken_this.add(key)
                    if dist:
                        msg = f"{label} {dist}, {dir_}"
                    else:
                        msg = f"{label} {dir_}"
                    speak(msg)

        track_frame_end()

        # ── Send to browser for bounding box overlay ───────────────────────
        jout = json.dumps({'t': int(time.time()*1000), 'dets': stable_dets},
                          separators=(',', ':'))
        print(f"[DET_JSON]{jout}", flush=True)

        # ── FPS stats every 8s ─────────────────────────────────────────────
        elapsed = time.time() - fps_t
        if elapsed >= 8.0:
            print(f"\n\033[34m[FPS] {fps_f/elapsed:.2f} fps  |  "
                  f"Total detected: {sum(_detect_count.values())}\033[0m\n", flush=True)
            fps_t = time.time(); fps_f = 0

    cap.release()
    speak("NayanSathi stopped")
    time.sleep(1.5)
    print("\n\033[36mTop objects:\033[0m")
    for obj, n in sorted(_detect_count.items(), key=lambda x: -x[1])[:10]:
        print(f"  {obj:<22} {n:>4}x")

if __name__ == '__main__':
    main()
