# 📄 Documentation

This folder contains all project documentation for **NayanSathi — AI Smart Glasses**.

## Contents
- `Project_Report.pdf` — Full technical report
- `Abstract.pdf` — One-page project abstract
- `Presentation.pptx` — Slide deck for evaluation
- `User_Manual.pdf` — How to use the glasses
- `API_Docs.md` — REST API and WebSocket documentation
- `References.md` — Research papers and citations

## Project Abstract

**NayanSathi** ("Eye Companion") is an AI-powered wearable assistive device built as smart glasses for visually impaired individuals. Using a Raspberry Pi 4 + ESP32-CAM + YOLOv11n ONNX model, it provides real-time object detection with natural voice announcements delivered through Bluetooth earbuds via Piper TTS engine.

The system includes a full web dashboard for remote monitoring and control via SSH, a multi-layer camera fallback system, and an attachable solar panel using magnetic pogo-pin connectors for extended battery life.

## Key Specifications

| Specification | Value |
|---|---|
| Total Cost | ~Rs. 8,280 (~$100 USD) |
| Detection Speed | 8–15 FPS on Raspberry Pi 4 CPU |
| Voice Latency | ~800ms–1.2s end-to-end |
| Battery Life | 2.5–5 hours (3–5 with solar) |
| Object Classes | 80 COCO classes |
| Model Size | ~10.9 MB (YOLOv11 Nano) |
| Audio | Bluetooth A2DP (Piper TTS) |
| Remote Access | SSH + WebSocket + Cloudflare Tunnel |

## Comparison with Commercial Products

| Feature | NayanSathi | OrCam MyEye |
|---|---|---|
| Cost | Rs. 8,280 (~$100) | Rs. 2.9 lakh (~$3,500) |
| Open Source | Yes | No |
| Customizable | Yes (retrain model) | No |
| Solar Panel | Yes | No |
| Web Dashboard | Yes | No |
| Internet Remote | Yes | No |
| Edge AI | Yes | Yes |
