#!/bin/bash
# NayanSathi YOLO Auto-Install Script for Raspberry Pi 4
# Run: bash install_yolo.sh

set -e
echo "================================================"
echo "  NayanSathi YOLO Install - Raspberry Pi 4"
echo "================================================"

# 1. System dependencies
echo "[1/5] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y python3-pip python3-opencv libopencv-dev python3-numpy \
    libatlas-base-dev libjasper-dev libhdf5-dev -q

# 2. Python packages
echo "[2/5] Installing Python packages..."
pip3 install --break-system-packages -q \
    ultralytics \
    websockets \
    opencv-python-headless \
    numpy

# 3. Copy files to ~/NayanSathi
echo "[3/5] Copying files..."
mkdir -p ~/NayanSathi
cp ~/NayanSathi/yolo_server.py ~/NayanSathi/ 2>/dev/null || true

# 4. Create systemd service
echo "[4/5] Creating systemd service..."
cat > /tmp/yolo_server.service << 'EOF'
[Unit]
Description=NayanSathi YOLO Detection Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/NayanSathi
ExecStart=/usr/bin/python3 /home/pi/NayanSathi/yolo_server.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo cp /tmp/yolo_server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable yolo_server

# 5. Test import
echo "[5/5] Testing YOLO import..."
python3 -c "from ultralytics import YOLO; print('  ultralytics OK')"
python3 -c "import websockets; print('  websockets OK')"
python3 -c "import cv2; print('  opencv OK', cv2.__version__)"

echo ""
echo "================================================"
echo "  INSTALL COMPLETE!"
echo "  Start: sudo systemctl start yolo_server"
echo "  Status: systemctl status yolo_server"
echo "  Logs: journalctl -u yolo_server -f"
echo "================================================"
