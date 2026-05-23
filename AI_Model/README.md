# 🤖 AI_Model

This folder contains all AI/ML model files for **NayanSathi — AI Smart Glasses**.

## Primary Model: YOLOv11n (ONNX)

| Property | Detail |
|---|---|
| File | `yolo11n.onnx` |
| Size | ~10.9 MB |
| Format | ONNX (Open Neural Network Exchange) |
| Framework | Ultralytics YOLOv11 → ONNX Runtime |
| Input Size | 640 × 640 pixels |
| Classes | 80 COCO classes |
| Inference | ONNX Runtime on Raspberry Pi 4 ARM CPU |
| Speed | 8–15 FPS on Pi 4 (CPU only) |
| Confidence | 0.55 default threshold (tunable per class) |

## Training Pipeline

```
Step 1 ── Dataset
         COCO 2017: 118,000 images, 80 pre-labeled classes

Step 2 ── Base Model
         Download: yolo11n.pt (Ultralytics pretrained on COCO)

Step 3 ── Fine-Tuning (custom objects)
         Label: Roboflow or LabelImg
         Train: python train.py --model yolo11n.pt --data custom.yaml --epochs 50
         GPU:   Google Colab T4 (free, ~1 hour for 50 epochs)

Step 4 ── Export to ONNX
         from ultralytics import YOLO
         model = YOLO('yolo11n.pt')
         model.export(format='onnx', imgsz=640, simplify=True)

Step 5 ── Deploy to Pi
         SFTP yolo11n.onnx → /home/pi/NayanSathi/
         pip install onnxruntime
         python yolo_server.py
```

## 80 COCO Classes Detected
person, bicycle, car, motorcycle, airplane, bus, train, truck, boat, traffic light, fire hydrant, stop sign, parking meter, bench, bird, cat, dog, horse, sheep, cow, elephant, bear, zebra, giraffe, backpack, umbrella, handbag, tie, suitcase, frisbee, skis, snowboard, sports ball, kite, baseball bat, baseball glove, skateboard, surfboard, tennis racket, bottle, wine glass, cup, fork, knife, spoon, bowl, banana, apple, sandwich, orange, broccoli, carrot, hot dog, pizza, donut, cake, chair, couch, potted plant, bed, dining table, toilet, tv, laptop, mouse, remote, keyboard, cell phone, microwave, oven, toaster, sink, refrigerator, book, clock, vase, scissors, teddy bear, hair drier, toothbrush

## Other Models in System

| Model | Purpose | Framework | Status |
|---|---|---|---|
| TF.js COCO-SSD | Browser webcam fallback | TensorFlow.js | Active |
| XGBoost | Anomaly / theft detection | scikit-learn | Active |
| MobileNet SSD | Lightweight Pi backup | TF Lite | Planned |
| Whisper (tiny) | Voice command input | OpenAI Whisper | Planned |
| DepthAnything | Monocular depth estimation | PyTorch | Planned |
| DeepFace/FaceNet | Face recognition | TF / OpenCV | Planned |
| EasyOCR | Text/sign/currency reading | PyTorch | Planned |

## Voice Priority System
```python
PRIORITY = {
    'person': 10,  # Always announce first
    'car': 8, 'truck': 8, 'bus': 8,
    'motorcycle': 7, 'bicycle': 7,
    'dog': 6, 'cat': 6,
    'phone': 5,
    'bottle': 3, 'cup': 3
}
COOLDOWN = 6000  # ms — no repeat within 6 seconds per class
```
