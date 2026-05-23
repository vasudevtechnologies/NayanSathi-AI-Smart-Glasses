#!/bin/bash
# ══════════════════════════════════════════════════════════════
#   NayanSathi Smart Glasses - One-Click Setup Script
#   Run this on your Raspberry Pi 4
# ══════════════════════════════════════════════════════════════
set -e

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   NayanSathi Setup - Raspberry Pi 4         ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Update system
echo "[1/6] Updating system packages..."
sudo apt-get update -q
sudo apt-get install -y espeak espeak-data libespeak-dev python3-pip python3-dev \
    libopencv-dev libportaudio2 pulseaudio bluetooth bluez -q

# Upgrade pip
echo "[2/6] Upgrading pip..."
pip3 install --upgrade pip

# Install Python dependencies
echo "[3/6] Installing Python packages..."
pip3 install --upgrade \
    ultralytics \
    pyttsx3 \
    opencv-python-headless \
    numpy \
    --break-system-packages 2>/dev/null || \
pip3 install --upgrade \
    ultralytics \
    pyttsx3 \
    opencv-python-headless \
    numpy

# Create project directory
echo "[4/6] Creating project folder..."
mkdir -p ~/NayanSathi
mkdir -p ~/NayanSathi/models
mkdir -p ~/NayanSathi/logs

# Copy script
echo "[5/6] Installing NayanSathi script..."
cp "$(dirname "$0")/nayansathi.py" ~/NayanSathi/
chmod +x ~/NayanSathi/nayansathi.py

# Pre-download YOLOv8n model
echo "[6/6] Downloading YOLOv8 nano model..."
cd ~/NayanSathi
python3 -c "from ultralytics import YOLO; YOLO('yolov8n.pt')" && echo "Model downloaded!"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   ✅ Setup Complete!                         ║"
echo "╠══════════════════════════════════════════════╣"
echo "║   Run: python3 ~/NayanSathi/nayansathi.py   ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
