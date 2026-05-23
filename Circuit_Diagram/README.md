# ⚡ Circuit_Diagram

This folder contains all circuit schematics and PCB design files for **NayanSathi — AI Smart Glasses**.

## Contents
- `esp32_multi_sensor.kicad_pcb` — Main KiCad PCB design
- `schematic.pdf` — Printable full circuit schematic
- `wiring_diagram.png` — Complete wiring connection diagram
- `power_circuit.png` — Solar + battery power circuit
- `pcb_gerber/` — Gerber files for PCB manufacturing

## Power Circuit

```
☀️ Solar Panel (5V, 1W)
         │
         ▼
   ┌─────────────┐
   │   TP4056    │  ← Charge Controller (overcharge protected)
   │   Module    │
   └──────┬──────┘
          │
          ▼
   Li-Po Battery (3.7V, 3000mAh)
          │
          ▼
   ┌─────────────┐
   │   MT3608    │  ← Boost Converter (3.7V → 5V)
   │   Boost     │
   └──────┬──────┘
          │
     ┌────┴────┐
     ▼         ▼
Raspberry Pi 4  ESP32-CAM
  (USB-C 5V)   (5V Pin)
```

## Pin Connections

| From | Pin | To | Pin | Signal |
|---|---|---|---|---|
| ESP32-CAM | GPIO 1 (TX) | Raspberry Pi | GPIO 15 (RX) | UART |
| ESP32-CAM | 5V | MT3608 OUT | 5V | Power |
| ESP32-CAM | GND | Common GND | GND | Ground |
| Solar Panel | + | TP4056 | IN+ | 5V Solar Input |
| Solar Panel | - | TP4056 | IN- | Ground |
| TP4056 | BAT+ | Li-Po | + | Battery Charge |
| Li-Po | + | MT3608 | IN+ | 3.7V Input |
| MT3608 | OUT+ | Pi USB-C | + | 5V Output |
| Voltage Divider | OUT | Pi | GPIO ADC | Battery % |

## PCB Features (KiCad Design)
- ESP32-CAM mounting pads with castellated holes
- TP4056 solar charge controller footprint
- MT3608 boost converter section
- Voltage divider circuit (100kΩ + 100kΩ) for battery ADC monitoring
- I2C header (SDA/SCL) for optional IMU / barometer sensor
- Push button (GPIO 17) for mode switching
- 3x LED indicators: Power (Green), Bluetooth (Blue), Detection (Cyan)
- Magnetic pogo-pin pads for solar panel connector

## PCB Dimensions
- Size: ~45mm × 30mm (fits inside glasses frame)
- Layers: 2-layer PCB
- Thickness: 1.6mm standard FR4
