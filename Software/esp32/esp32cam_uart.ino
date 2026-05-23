/*
 * NayanSathi — ESP32-CAM UART Frame Streamer
 * Sends JPEG frames directly to Raspberry Pi via UART
 * 
 * Hardware:
 *   ESP32-CAM GPIO1 (TX) → Pi GPIO15 (RXD, Pin 10)
 *   ESP32-CAM GND        → Pi GND
 *   ESP32-CAM 5V         → Pi Pin 2 (5V)
 *
 * Frame Protocol:
 *   [0xAA 0xBB 0xCC 0xDD] [4-byte length LE] [JPEG bytes]
 */

#include "esp_camera.h"

// ── Camera model: AI-Thinker ESP32-CAM ──────────────────────
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// ── Config ───────────────────────────────────────────────────
#define BAUD_RATE     1500000   // 1.5 Mbps — fast but stable on Pi
#define FRAME_MAGIC_1 0xAA
#define FRAME_MAGIC_2 0xBB
#define FRAME_MAGIC_3 0xCC
#define FRAME_MAGIC_4 0xDD
#define TARGET_FPS    8         // target FPS (Pi YOLO will process at its own rate)

// ── LED flash (GPIO4 on AI-Thinker) ─────────────────────────
#define FLASH_LED_PIN 4

void setup() {
  // UART0 to Raspberry Pi
  Serial.begin(BAUD_RATE);
  while (!Serial) delay(10);

  // Flash LED setup
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  // Camera config
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode    = CAMERA_GRAB_LATEST;  // always grab latest frame
  config.fb_location  = CAMERA_FB_IN_PSRAM;

  // Lower resolution = faster serial transfer + lower latency
  // QVGA(320x240) or CIF(400x296) recommended for UART
  if (psramFound()) {
    config.frame_size   = FRAMESIZE_VGA;   // 640x480
    config.jpeg_quality = 15;              // 0=best, 63=worst
    config.fb_count     = 2;
  } else {
    config.frame_size   = FRAMESIZE_CIF;   // 400x296
    config.jpeg_quality = 20;
    config.fb_count     = 1;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    // Signal error via LED blink
    for (int i = 0; i < 10; i++) {
      digitalWrite(FLASH_LED_PIN, HIGH); delay(200);
      digitalWrite(FLASH_LED_PIN, LOW);  delay(200);
    }
    ESP.restart();
  }

  // Optimise sensor settings
  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, 1);      // slight brightness boost
    s->set_saturation(s, 0);
    s->set_sharpness(s, 1);
    s->set_gainceiling(s, (gainceiling_t)4);
    s->set_awb_gain(s, 1);
    s->set_wb_mode(s, 0);         // auto white balance
    s->set_ae_level(s, 0);
    s->set_aec2(s, 0);
  }

  // Brief flash to signal ready
  digitalWrite(FLASH_LED_PIN, HIGH); delay(100);
  digitalWrite(FLASH_LED_PIN, LOW);
}

void loop() {
  unsigned long t0 = millis();

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    delay(50);
    return;
  }

  // Send frame magic header + 4-byte length + JPEG payload
  uint32_t len = fb->len;
  uint8_t header[8];
  header[0] = FRAME_MAGIC_1;
  header[1] = FRAME_MAGIC_2;
  header[2] = FRAME_MAGIC_3;
  header[3] = FRAME_MAGIC_4;
  header[4] = (len      ) & 0xFF;  // length little-endian
  header[5] = (len >>  8) & 0xFF;
  header[6] = (len >> 16) & 0xFF;
  header[7] = (len >> 24) & 0xFF;

  Serial.write(header, 8);
  Serial.write(fb->buf, fb->len);
  Serial.flush();

  esp_camera_fb_return(fb);

  // Throttle to target FPS
  unsigned long elapsed = millis() - t0;
  unsigned long frame_ms = 1000 / TARGET_FPS;
  if (elapsed < frame_ms) delay(frame_ms - elapsed);
}
