# 💻 Software

This folder contains all software source files for **NayanSathi — AI Smart Glasses**.

## Folder Structure
```
Software/
├── pi_scripts/
│   ├── nayansathi.py        # Main Pi orchestration script
│   ├── yolo_server.py       # YOLOv11 ONNX inference + WebSocket (port 8765)
│   ├── pi_voice_server.py   # Piper TTS HTTP server (port 3001)
│   ├── setup.sh             # Pi environment setup script
│   └── install_yolo.sh      # ONNX Runtime + dependencies installer
├── server/
│   ├── server.js            # Node.js backend (REST + WebSocket + SSH proxy)
│   └── package.json         # Node.js dependencies
├── esp32/
│   └── esp32cam_uart.ino    # Arduino firmware for ESP32-CAM
└── dashboard/
    ├── index.html           # Main dashboard UI
    └── bt_voice.html        # Bluetooth voice control panel
```

## Tech Stack
| Layer | Technology |
|---|---|
| AI Inference | Python + ONNX Runtime |
| Voice Output | Piper TTS (Indian English) |
| Backend Server | Node.js + Express + WebSocket |
| Frontend | HTML + CSS + JavaScript |
| Camera Firmware | Arduino C++ (ESP32-CAM) |
| SSH Terminal | xterm.js |
| Browser Detection | TensorFlow.js COCO-SSD |

## Quick Start
```bash
# 1. On Raspberry Pi
pip install onnxruntime piper-tts opencv-python websockets
python yolo_server.py &
python pi_voice_server.py &

# 2. On Laptop/PC
npm install
node server.js

# 3. Open browser
# http://localhost:3000
```
