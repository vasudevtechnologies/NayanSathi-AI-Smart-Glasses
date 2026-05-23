# 🔧 Hardware

This folder contains all hardware-related files for **NayanSathi — AI Smart Glasses**.

## Contents
- Component datasheets (Raspberry Pi 4, ESP32-CAM, TP4056, etc.)
- Wiring diagrams
- 3D model files for glasses frame (.stl, .step)
- Bill of Materials (BOM)
- Assembly instructions
- Solar panel integration guide

## Bill of Materials (BOM)

| Component | Model | Specification | Cost (INR) |
|---|---|---|---|
| Raspberry Pi 4 | 4GB RAM | Quad-core ARM Cortex-A72 | Rs. 5,500 |
| ESP32-CAM | OV2640 | 2MP, Wi-Fi, MJPEG stream | Rs. 350 |
| Bluetooth Earbuds | boAt Airdopes 141 | A2DP, Bluetooth 5.0 | Rs. 700 |
| Li-Po Battery | 3000mAh 3.7V | Rechargeable, compact | Rs. 450 |
| Solar Panel | 5V / 1W Flexible | Magnetic clip-on design | Rs. 350 |
| TP4056 Module | Charge Controller | Overcharge protection | Rs. 30 |
| MT3608 Boost | 5V Boost Converter | 3.7V to 5V | Rs. 50 |
| 3D Printed Frame | Custom Design | PLA, glasses form factor | Rs. 400 |
| Custom PCB | KiCad Designed | ESP32 + Power circuit | Rs. 200 |
| MicroSD Card | 32GB Class 10 | OS + model storage | Rs. 200 |
| Misc (wires, etc.) | — | Jumper wires, resistors | Rs. 100 |
| **TOTAL** | | | **~Rs. 8,330** |

## Solar Panel Design
- **Attachment:** Magnetic pogo-pin connectors on glasses top bar
- **Daytime:** Snap-on → charges Li-Po via TP4056 (~100–200mA)
- **Nighttime:** Snap-off in 1 second — lightweight, no tools needed
- **Added weight:** ~20g when attached
