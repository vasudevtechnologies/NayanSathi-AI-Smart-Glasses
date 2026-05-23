#!/usr/bin/env python3
"""
NayanSathi — Real Object Detection Server  v8-CLEAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Architecture (3 independent threads — nothing blocks anything):
  Thread-1  Camera grabber   → always keeps the LATEST JPEG frame
  Thread-2  YOLO inference   → reads latest frame, runs model, stores results
  Asyncio   WebSocket server → broadcasts results to browser at target FPS

Detection policy:
  • conf = 0.45  (only real, confident detections)
  • REAL_CLASSES whitelist  (blocks airplane, train, boat — impossible while walking)
  • Per-class lower threshold for small objects (bottle, cup, phone)
  • Min box area 0.4%  (eliminates pixel-noise false positives)
  • No CLAHE, no preprocessing  (YOLO handles it internally)
"""

import asyncio, websockets, json, time, threading
import numpy as np, cv2, traceback
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
CAM_URL  = 'http://192.168.137.36:82/stream'
WS_PORT  = 8765
BASE_CONF= 0.45    # default confidence — real objects only, no fakes
IMGSZ    = 480     # 480px: best speed/accuracy balance on Pi 4
TARGET_FPS = 6     # broadcast rate to browser

# ── COCO 80 class names ───────────────────────────────────────────────────────
COCO = [
    'person','bicycle','car','motorcycle','airplane','bus','train','truck','boat',
    'traffic light','fire hydrant','stop sign','parking meter','bench','bird','cat',
    'dog','horse','sheep','cow','elephant','bear','zebra','giraffe','backpack',
    'umbrella','handbag','tie','suitcase','frisbee','skis','snowboard','sports ball',
    'kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket',
    'bottle','wine glass','cup','fork','knife','spoon','bowl','banana','apple',
    'sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake',
    'chair','couch','potted plant','bed','dining table','toilet','tv','laptop',
    'mouse','remote','keyboard','cell phone','microwave','oven','toaster','sink',
    'refrigerator','book','clock','vase','scissors','teddy bear','hair drier','toothbrush'
]

# ── Whitelist: only objects you can encounter while walking ───────────────────
# Blocked: airplane, boat, train, horse, cow, sheep, elephant, bear, zebra,
#          giraffe, skis, snowboard — never seen indoors/normal street
REAL_CLASSES = {
    'person','bicycle','car','motorcycle','bus','truck',
    'traffic light','fire hydrant','stop sign','bench',
    'bird','cat','dog',
    'backpack','umbrella','handbag','suitcase',
    'bottle','wine glass','cup','bowl',
    'fork','knife','spoon',
    'chair','couch','potted plant','bed','dining table','toilet',
    'tv','laptop','mouse','remote','keyboard','cell phone',
    'microwave','oven','sink','refrigerator',
    'book','clock','vase','scissors','teddy bear','toothbrush',
    'sports ball','skateboard','surfboard','tennis racket',
    'banana','apple','orange',
}

# ── Per-class confidence (small/hard objects need lower threshold) ─────────────
CLASS_CONF = {
    # Strict (high risk of false positive on ESP32-CAM)
    'traffic light': 0.65,
    'stop sign':     0.60,
    'fire hydrant':  0.58,
    # Normal
    'person':        0.45,
    'bicycle':       0.45,
    'car':           0.45,
    'motorcycle':    0.45,
    'bus':           0.45,
    'truck':         0.45,
    # Small objects — lower threshold so they're not missed
    'bottle':        0.32,
    'cup':           0.32,
    'cell phone':    0.35,
    'laptop':        0.38,
    'book':          0.38,
    'remote':        0.35,
    'mouse':         0.35,
    'scissors':      0.38,
    'keyboard':      0.40,
    'clock':         0.38,
    'tv':            0.40,
    'chair':         0.42,
    'couch':         0.42,
}

# ── Voice / priority guide ────────────────────────────────────────────────────
INFO = {
    'person':       (1, 'person ahead'),
    'bicycle':      (1, 'bicycle nearby'),
    'car':          (1, 'car nearby'),
    'motorcycle':   (1, 'motorcycle nearby'),
    'bus':          (1, 'bus ahead'),
    'truck':        (1, 'truck ahead'),
    'traffic light':(1, 'traffic light'),
    'stop sign':    (1, 'stop sign'),
    'fire hydrant': (2, 'fire hydrant on path'),
    'bench':        (2, 'bench ahead'),
    'dog':          (2, 'dog nearby'),
    'cat':          (3, 'cat nearby'),
    'bird':         (3, 'bird nearby'),
    'knife':        (2, 'sharp object nearby'),
    'scissors':     (2, 'scissors nearby'),
    'skateboard':   (2, 'skateboard'),
    'chair':        (3, 'chair ahead'),
    'couch':        (3, 'couch ahead'),
    'bed':          (3, 'bed ahead'),
    'dining table': (3, 'table ahead'),
    'toilet':       (3, 'toilet ahead'),
    'suitcase':     (3, 'suitcase on floor'),
    'potted plant': (3, 'plant ahead'),
    'tv':           (4, 'TV screen'),
    'laptop':       (4, 'laptop'),
    'cell phone':   (4, 'phone'),
    'backpack':     (4, 'backpack'),
    'bottle':       (5, 'bottle'),
    'cup':          (5, 'cup'),
    'umbrella':     (5, 'umbrella'),
    'handbag':      (5, 'bag'),
    'book':         (5, 'book'),
    'remote':       (5, 'remote'),
    'mouse':        (5, 'computer mouse'),
    'keyboard':     (5, 'keyboard'),
    'clock':        (5, 'clock'),
    'refrigerator': (4, 'fridge ahead'),
    'microwave':    (5, 'microwave'),
    'sink':         (4, 'sink ahead'),
    'sports ball':  (3, 'ball on ground'),
}

COLS = ['#00d4ff','#f59e0b','#ef4444','#f472b6','#10b981',
        '#818cf8','#34d399','#fb923c','#a78bfa','#38bdf8']

# ── Shared state ──────────────────────────────────────────────────────────────
_latest_frame = None
_frame_lock   = threading.Lock()
_latest_dets  = []
_dets_lock    = threading.Lock()
_new_frame    = threading.Event()
_clients      = set()
_model        = None
_model_ready  = threading.Event()

# ── Model loader ──────────────────────────────────────────────────────────────
def load_model():
    global _model
    print('[MODEL] Loading…', flush=True)
    try:
        from ultralytics import YOLO
        onnx = Path(__file__).parent / 'yolo11n.onnx'
        if onnx.exists():
            _model = YOLO(str(onnx), task='detect')
            print(f'[MODEL] ✅ yolo11n.onnx', flush=True)
        else:
            for n in ['yolo11n.pt', 'yolov8n.pt']:
                try:
                    _model = YOLO(n)
                    print(f'[MODEL] ✅ {n}', flush=True)
                    break
                except: pass
        if _model:
            # Warm-up run (eliminates first-frame latency)
            dummy = np.zeros((IMGSZ, IMGSZ, 3), np.uint8)
            _model.predict(dummy, conf=0.5, imgsz=IMGSZ,
                           verbose=False, device='cpu')
            print('[MODEL] 🔥 Warmed up', flush=True)
        _model_ready.set()
    except Exception as e:
        print(f'[MODEL] ❌ {e}', flush=True)
        _model_ready.set()   # unblock inference thread even on failure

# ── Camera thread (JPEG ring buffer) ─────────────────────────────────────────
def camera_thread():
    global _latest_frame
    import urllib.request
    SOI, EOI = b'\xff\xd8', b'\xff\xd9'
    retry = 2
    print(f'[CAM] → {CAM_URL}', flush=True)
    while True:
        try:
            req = urllib.request.urlopen(CAM_URL, timeout=15)
            buf = b''
            print('[CAM] ✅ Connected', flush=True)
            retry = 2
            while True:
                chunk = req.read(32768)
                if not chunk: break
                buf += chunk
                # Drain all complete JPEGs — keep only the newest
                while True:
                    s = buf.find(SOI)
                    if s == -1: break
                    e = buf.find(EOI, s + 2)
                    if e == -1: break
                    jpg = buf[s:e+2]
                    buf = buf[e+2:]
                    img = cv2.imdecode(
                        np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
                    if img is not None:
                        with _frame_lock:
                            _latest_frame = img
                        _new_frame.set()   # signal inference thread
                # Drop buffer if too large (stream stall)
                if len(buf) > 150000:
                    buf = buf[-2048:]
        except Exception as ex:
            print(f'[CAM] {ex} — retry {retry}s', flush=True)
            time.sleep(retry)
            retry = min(retry * 2, 20)

# ── Inference thread ──────────────────────────────────────────────────────────
def inference_thread():
    global _latest_dets
    print('[INF] Waiting for model…', flush=True)
    _model_ready.wait(timeout=120)
    if not _model:
        print('[INF] No model — detection disabled', flush=True)
        return
    print(f'[INF] ✅ Running  conf={BASE_CONF}  imgsz={IMGSZ}', flush=True)

    cnt = 0; t0 = time.time()
    while True:
        # Wait until a fresh frame arrives (non-busy wait)
        _new_frame.wait(timeout=1.0)
        _new_frame.clear()

        frame = None
        with _frame_lock:
            if _latest_frame is not None:
                frame = _latest_frame.copy()
        if frame is None:
            continue

        h, w = frame.shape[:2]
        try:
            res = _model.predict(
                frame,
                conf   = min(CLASS_CONF.values()),  # let everything through; we filter below
                iou    = 0.45,
                imgsz  = IMGSZ,
                verbose= False,
                device = 'cpu',
                half   = False,
                augment= False,
                max_det= 30,
            )
        except Exception as e:
            print(f'[INF] predict error: {e}', flush=True)
            continue

        dets = []
        for r in res:
            for box in r.boxes:
                cls  = int(box.cls[0])
                cf   = float(box.conf[0])
                lbl  = COCO[cls] if cls < len(COCO) else f'obj{cls}'

                # ── Filter: real class + confidence + size ────────────────
                # 1. Must be a realistic walkable-world object
                if lbl not in REAL_CLASSES:
                    continue
                # 2. Per-class confidence threshold
                if cf < CLASS_CONF.get(lbl, BASE_CONF):
                    continue
                # 3. Box size filter
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                area = ((x2-x1)/w) * ((y2-y1)/h)
                # Small objects (bottle/cup/phone) allowed at 0.15% area
                small = lbl in ('bottle','wine glass','cup','cell phone',
                                'remote','mouse','toothbrush','scissors')
                if area < (0.0015 if small else 0.004):
                    continue

                cx  = ((x1+x2)/2) / w
                inf = INFO.get(lbl, (5, lbl))
                pri, voice = inf[0], inf[1]

                # Traffic light color
                tlc = None
                if lbl == 'traffic light':
                    roi = frame[max(0,int(y1)):min(h,int(y2)),
                                max(0,int(x1)):min(w,int(x2))]
                    if roi.size > 0:
                        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
                        r_  = cv2.countNonZero(cv2.inRange(hsv,(0,120,80),(10,255,255))) + \
                              cv2.countNonZero(cv2.inRange(hsv,(160,120,80),(180,255,255)))
                        g_  = cv2.countNonZero(cv2.inRange(hsv,(40,80,80),(90,255,255)))
                        y_  = cv2.countNonZero(cv2.inRange(hsv,(20,100,100),(35,255,255)))
                        best= max(('red',r_),('green',g_),('yellow',y_), key=lambda x:x[1])
                        if best[1] > 25:
                            tlc = best[0]
                            voice = {'red':'red light stop','green':'green light go',
                                     'yellow':'yellow light slow'}.get(tlc, voice)

                prox = ('very close' if area>.30 else 'close' if area>.10
                        else 'nearby' if area>.03 else 'far')
                pos  = ('left' if cx<.35 else 'right' if cx>.65 else 'ahead')

                dets.append({
                    'label'    : lbl,
                    'voice'    : voice,
                    'priority' : pri,
                    'conf'     : round(cf, 2),
                    'x'        : round(x1/w, 4),
                    'y'        : round(y1/h, 4),
                    'w'        : round((x2-x1)/w, 4),
                    'h'        : round((y2-y1)/h, 4),
                    'cx'       : round(cx, 3),
                    'area'     : round(area, 4),
                    'proximity': prox,
                    'position' : pos,
                    'tl_color' : tlc,
                    'color'    : COLS[cls % len(COLS)],
                    'frameW'   : w,
                    'frameH'   : h,
                })

        dets.sort(key=lambda d: (d['priority'], -d['area']))
        with _dets_lock:
            _latest_dets = dets

        cnt += 1
        if cnt % 15 == 0:
            fps = 15 / (time.time() - t0 + .001)
            t0  = time.time()
            lbls = [d['label'] for d in dets[:4]]
            print(f'[INF] #{cnt}  {fps:.1f}fps  {len(dets)} objs  {lbls}', flush=True)

# ── WebSocket handler ─────────────────────────────────────────────────────────
async def ws_handler(ws, path=None):
    _clients.add(ws)
    print(f'[WS] +client ({len(_clients)} total)', flush=True)
    try:
        await ws.send(json.dumps({
            'type'   : 'yolo-ready',
            'version': 'v8-CLEAN',
            'conf'   : BASE_CONF,
            'imgsz'  : IMGSZ,
            'classes': len(REAL_CLASSES),
        }))
        async for _ in ws:
            pass
    except:
        pass
    finally:
        _clients.discard(ws)
        print(f'[WS] -client ({len(_clients)} total)', flush=True)

# ── Broadcast loop ────────────────────────────────────────────────────────────
async def broadcast_loop():
    interval = 1.0 / TARGET_FPS
    while True:
        t0 = time.time()
        if _clients:
            with _dets_lock:
                dets = list(_latest_dets)
            fw = dets[0]['frameW'] if dets else 640
            fh = dets[0]['frameH'] if dets else 480
            msg = json.dumps({
                'type'      : 'yolo-detections',
                'source'    : 'pi',
                'count'     : len(dets),
                'detections': dets,
                'frameW'    : fw,
                'frameH'    : fh,
                'fps'       : TARGET_FPS,
                'ts'        : time.time(),
            })
            dead = set()
            for ws in list(_clients):
                try:
                    await ws.send(msg)
                except:
                    dead.add(ws)
            _clients.difference_update(dead)
        await asyncio.sleep(max(0, interval - (time.time() - t0)))

# ── Main ──────────────────────────────────────────────────────────────────────
async def main():
    try:
        async with websockets.serve(ws_handler, '0.0.0.0', WS_PORT):
            print(f'[WS]  ✅ ws://0.0.0.0:{WS_PORT}', flush=True)
            await broadcast_loop()
    except TypeError:
        # older websockets API
        await websockets.serve(ws_handler, '0.0.0.0', WS_PORT)
        await broadcast_loop()

if __name__ == '__main__':
    print('=' * 56, flush=True)
    print('  NayanSathi v8-CLEAN  Real Object Detection', flush=True)
    print(f'  cam={CAM_URL}', flush=True)
    print(f'  conf={BASE_CONF}  imgsz={IMGSZ}  fps={TARGET_FPS}', flush=True)
    print(f'  classes={len(REAL_CLASSES)} real-world objects', flush=True)
    print('=' * 56, flush=True)

    threading.Thread(target=load_model,      daemon=True, name='model').start()
    threading.Thread(target=camera_thread,   daemon=True, name='cam').start()
    threading.Thread(target=inference_thread,daemon=True, name='inf').start()

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('[MAIN] Stopped', flush=True)
    except Exception as e:
        print(f'[MAIN] CRASH: {e}', flush=True)
        traceback.print_exc()
