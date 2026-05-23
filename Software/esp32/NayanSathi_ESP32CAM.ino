/*
 ╔══════════════════════════════════════════════════════════════╗
 ║  NayanSathi ESP32-CAM  ·  Multi-Client Stable Streaming     ║
 ║  v3 — Browser + Pi YOLO simultaneous, no crash, no lag      ║
 ╠══════════════════════════════════════════════════════════════╣
 ║  WIRING:                                                     ║
 ║    5V power  → ESP32-CAM 5V  (MUST be 5V/500mA+)           ║
 ║    GND       → ESP32-CAM GND                                ║
 ║    Programmer TX → U0R   (for flashing only)                ║
 ║    Programmer RX → U0T   (for flashing only)                ║
 ║    IO0 → GND during flash, REMOVE for run                   ║
 ║                                                             ║
 ║  ENDPOINTS:                                                 ║
 ║    http://192.168.1.36:81/stream   ← browser dashboard      ║
 ║    http://192.168.1.36:82/stream   ← Raspberry Pi YOLO      ║
 ║    http://192.168.1.36/snap        ← single JPEG snapshot   ║
 ║    http://192.168.1.36/status      ← JSON status            ║
 ║    http://192.168.1.36/control     ← camera settings        ║
 ╚══════════════════════════════════════════════════════════════╝
*/

#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_http_server.h"
#include "freertos/semphr.h"

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION  — edit these
// ═══════════════════════════════════════════════════════════════
const char* SSID = "Thakre";
const char* PASS = "KRISHNA2277";

IPAddress IP (192,168,1,36);   // ESP32-CAM static IP
IPAddress GW (192,168,1, 1);   // Router gateway
IPAddress SN (255,255,255,0);  // Subnet mask

const char* PI_SERVER = "http://192.168.1.33:3000/api/cam-register";


// ═══════════════════════════════════════════════════════════════
// AI-THINKER PIN MAP (do not change)
// ═══════════════════════════════════════════════════════════════
#define PWDN  32
#define RESET -1
#define XCLK   0
#define SDA   26
#define SCL   27
#define D7    35
#define D6    34
#define D5    39
#define D4    36
#define D3    21
#define D2    19
#define D1    18
#define D0     5
#define VSYNC 25
#define HREF  23
#define PCLK  22
#define LED    4   // Flash LED

// ═══════════════════════════════════════════════════════════════
// MJPEG STREAM CONSTANTS
// ═══════════════════════════════════════════════════════════════
#define BOUNDARY  "gc0p4Jq0M2Yt08jU534c0p"
static const char* CT    = "multipart/x-mixed-replace;boundary=" BOUNDARY;
static const char* BOUND = "\r\n--" BOUNDARY "\r\n";
static const char* PART  = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

// HTTP server handles
static httpd_handle_t stream_server1 = NULL;  // port 81 — browser
static httpd_handle_t stream_server2 = NULL;  // port 82 — Pi YOLO
static httpd_handle_t ctrl_server    = NULL;  // port 80 — control

// Frame access semaphore (prevents torn reads)
SemaphoreHandle_t fb_mutex;

// ═══════════════════════════════════════════════════════════════
// SHARED STREAM HANDLER  (used by both port 81 and port 82)
// Each runs in its OWN httpd task — truly parallel!
// ═══════════════════════════════════════════════════════════════
static esp_err_t stream_handler(httpd_req_t* req) {
    char buf[64];
    esp_err_t res;

    httpd_resp_set_type(req, CT);
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache, no-store, must-revalidate");
    httpd_resp_set_hdr(req, "X-Source", "NayanSathi-ESP32CAM");

    uint32_t last_frame_ms = 0;
    const uint32_t MIN_FRAME_MS = 66;  // ~15fps max per client

    while (true) {
        // Rate-limit per client
        uint32_t now = millis();
        if (now - last_frame_ms < MIN_FRAME_MS) {
            vTaskDelay(pdMS_TO_TICKS(5));
            continue;
        }

        // Grab frame (with mutex to avoid PSRAM conflicts)
        if (xSemaphoreTake(fb_mutex, pdMS_TO_TICKS(200)) != pdTRUE) continue;
        camera_fb_t* fb = esp_camera_fb_get();
        xSemaphoreGive(fb_mutex);

        if (!fb) {
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }

        last_frame_ms = millis();

        // Boundary
        res = httpd_resp_send_chunk(req, BOUND, strlen(BOUND));
        if (res != ESP_OK) { esp_camera_fb_return(fb); break; }

        // Part header
        int hlen = snprintf(buf, sizeof(buf), PART, fb->len);
        res = httpd_resp_send_chunk(req, buf, hlen);
        if (res != ESP_OK) { esp_camera_fb_return(fb); break; }

        // JPEG data
        res = httpd_resp_send_chunk(req, (const char*)fb->buf, fb->len);
        esp_camera_fb_return(fb);
        if (res != ESP_OK) break;
    }

    httpd_resp_send_chunk(req, NULL, 0);  // end
    return ESP_OK;
}

// ── Snapshot ──────────────────────────────────────────────────
static esp_err_t snap_handler(httpd_req_t* req) {
    if (xSemaphoreTake(fb_mutex, pdMS_TO_TICKS(300)) != pdTRUE) {
        httpd_resp_send_500(req); return ESP_FAIL;
    }
    camera_fb_t* fb = esp_camera_fb_get();
    xSemaphoreGive(fb_mutex);
    if (!fb) { httpd_resp_send_500(req); return ESP_FAIL; }
    httpd_resp_set_type(req, "image/jpeg");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
    httpd_resp_send(req, (const char*)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    return ESP_OK;
}

// ── Control endpoint ──────────────────────────────────────────
static esp_err_t ctrl_handler(httpd_req_t* req) {
    char buf[128], k[32], v[16];
    httpd_req_get_url_query_str(req, buf, sizeof(buf));
    httpd_query_key_value(buf, "var", k, sizeof(k));
    httpd_query_key_value(buf, "val", v, sizeof(v));
    int val = atoi(v);
    sensor_t* s = esp_camera_sensor_get();
    if      (!strcmp(k,"framesize"))  s->set_framesize(s,(framesize_t)val);
    else if (!strcmp(k,"quality"))    s->set_quality(s,val);
    else if (!strcmp(k,"brightness")) s->set_brightness(s,val);
    else if (!strcmp(k,"contrast"))   s->set_contrast(s,val);
    else if (!strcmp(k,"saturation")) s->set_saturation(s,val);
    else if (!strcmp(k,"hmirror"))    s->set_hmirror(s,val);
    else if (!strcmp(k,"vflip"))      s->set_vflip(s,val);
    else if (!strcmp(k,"flash"))      digitalWrite(LED,val?HIGH:LOW);
    httpd_resp_set_hdr(req,"Access-Control-Allow-Origin","*");
    httpd_resp_sendstr(req,"OK");
    return ESP_OK;
}

// ── Status JSON ───────────────────────────────────────────────
static esp_err_t status_handler(httpd_req_t* req) {
    sensor_t* s = esp_camera_sensor_get();
    char json[400];
    snprintf(json, sizeof(json),
        "{\"ip\":\"%s\","
        "\"browser_stream\":\"http://%s:81/stream\","
        "\"pi_stream\":\"http://%s:82/stream\","
        "\"snap\":\"http://%s/snap\","
        "\"framesize\":%d,\"quality\":%d,"
        "\"psram\":%s,\"free_heap\":%lu}",
        WiFi.localIP().toString().c_str(),
        WiFi.localIP().toString().c_str(),
        WiFi.localIP().toString().c_str(),
        WiFi.localIP().toString().c_str(),
        s->status.framesize, s->status.quality,
        psramFound()?"true":"false",
        esp_get_free_heap_size());
    httpd_resp_set_type(req,"application/json");
    httpd_resp_set_hdr(req,"Access-Control-Allow-Origin","*");
    httpd_resp_send(req,json,strlen(json));
    return ESP_OK;
}

// ═══════════════════════════════════════════════════════════════
// SERVER STARTUP FUNCTIONS
// ═══════════════════════════════════════════════════════════════

void startStream(uint16_t port, httpd_handle_t* handle) {
    if (*handle) { httpd_stop(*handle); *handle = NULL; delay(100); }

    httpd_config_t cfg       = HTTPD_DEFAULT_CONFIG();
    cfg.server_port          = port;
    cfg.ctrl_port            = (port == 81) ? 32768 : 32769;
    cfg.stack_size           = 8192;           // larger stack for streaming
    cfg.max_uri_handlers     = 4;
    cfg.max_resp_headers     = 8;
    cfg.backlog_conn         = 2;              // queue max 2 pending
    cfg.lru_purge_enable     = true;           // auto-close idle slots
    cfg.recv_wait_timeout    = 5;
    cfg.send_wait_timeout    = 10;

    httpd_uri_t uri = {"/stream", HTTP_GET, stream_handler, NULL};

    if (httpd_start(handle, &cfg) == ESP_OK) {
        httpd_register_uri_handler(*handle, &uri);
        Serial.printf("[HTTP] Stream server on port %d ✓\n", port);
    } else {
        Serial.printf("[HTTP] Failed to start port %d\n", port);
    }
}

void startControl() {
    if (ctrl_server) { httpd_stop(ctrl_server); ctrl_server = NULL; delay(100); }

    httpd_config_t cfg    = HTTPD_DEFAULT_CONFIG();
    cfg.server_port       = 80;
    cfg.ctrl_port         = 32770;
    cfg.stack_size        = 4096;
    cfg.max_uri_handlers  = 8;
    cfg.lru_purge_enable  = true;

    httpd_uri_t u_ctrl   = {"/control", HTTP_GET, ctrl_handler,   NULL};
    httpd_uri_t u_snap   = {"/snap",    HTTP_GET, snap_handler,   NULL};
    httpd_uri_t u_status = {"/status",  HTTP_GET, status_handler, NULL};

    if (httpd_start(&ctrl_server, &cfg) == ESP_OK) {
        httpd_register_uri_handler(ctrl_server, &u_ctrl);
        httpd_register_uri_handler(ctrl_server, &u_snap);
        httpd_register_uri_handler(ctrl_server, &u_status);
        Serial.println("[HTTP] Control server on port 80 ✓");
    }
}

// ── LED blink helper ──────────────────────────────────────────
void blink(int n, int ms=150) {
    for (int i=0; i<n; i++) {
        digitalWrite(LED,HIGH); delay(ms);
        digitalWrite(LED,LOW);  delay(ms);
    }
}

// ── Announce to dashboard ─────────────────────────────────────
void announceToServer() {
    String myIP  = WiFi.localIP().toString();
    String mac   = WiFi.macAddress();
    HTTPClient http;
    http.begin(PI_SERVER);
    http.setTimeout(3000);
    http.addHeader("Content-Type","application/json");
    String body = "{\"ip\":\"" + myIP + "\","
                  "\"stream\":\"http://" + myIP + ":81/stream\","
                  "\"pi_stream\":\"http://" + myIP + ":82/stream\","
                  "\"snap\":\"http://" + myIP + "/snap\","
                  "\"mac\":\"" + mac + "\","
                  "\"status\":\"online\"}";
    int code = http.POST(body);
    Serial.printf("[REG] Dashboard response: %d\n", code);
    http.end();
}

// ═══════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════
void setup() {
    Serial.begin(115200);
    Serial.println("\n╔══════════════════════════════╗");
    Serial.println("║  NayanSathi ESP32-CAM v3     ║");
    Serial.println("╚══════════════════════════════╝");

    pinMode(LED, OUTPUT);
    digitalWrite(LED, LOW);
    blink(1, 80);

    // Create frame mutex
    fb_mutex = xSemaphoreCreateMutex();

    // ── Camera config ─────────────────────────────────────────
    camera_config_t cfg;
    cfg.ledc_channel = LEDC_CHANNEL_0;
    cfg.ledc_timer   = LEDC_TIMER_0;
    cfg.pin_d0=D0; cfg.pin_d1=D1; cfg.pin_d2=D2; cfg.pin_d3=D3;
    cfg.pin_d4=D4; cfg.pin_d5=D5; cfg.pin_d6=D6; cfg.pin_d7=D7;
    cfg.pin_xclk=XCLK; cfg.pin_pclk=PCLK;
    cfg.pin_vsync=VSYNC; cfg.pin_href=HREF;
    cfg.pin_sscb_sda=SDA; cfg.pin_sscb_scl=SCL;
    cfg.pin_pwdn=PWDN; cfg.pin_reset=RESET;
    cfg.pixel_format = PIXFORMAT_JPEG;
    cfg.grab_mode    = CAMERA_GRAB_LATEST;   // always latest frame, no queue
    cfg.xclk_freq_hz = 20000000;             // 20MHz = faster capture

    if (psramFound()) {
        // PSRAM available — SVGA quality
        cfg.frame_size   = FRAMESIZE_SVGA;   // 800×600
        cfg.jpeg_quality = 12;               // 0=best, 63=worst
        cfg.fb_count     = 2;                // 2 frame buffers
        cfg.fb_location  = CAMERA_FB_IN_PSRAM;
        Serial.println("[CAM] PSRAM found → SVGA 800×600, q=12");
    } else {
        // No PSRAM — use smaller buffer
        cfg.frame_size   = FRAMESIZE_VGA;    // 640×480
        cfg.jpeg_quality = 15;
        cfg.fb_count     = 1;
        cfg.fb_location  = CAMERA_FB_IN_DRAM;
        Serial.println("[CAM] No PSRAM → VGA 640×480, q=15");
    }

    if (esp_camera_init(&cfg) != ESP_OK) {
        Serial.println("[CAM] ❌ INIT FAILED — check 5V power supply!");
        blink(10, 80);
        delay(3000);
        ESP.restart();
    }
    Serial.println("[CAM] ✅ Camera OK");

    // ── Sensor tuning ─────────────────────────────────────────
    sensor_t* s = esp_camera_sensor_get();
    s->set_quality(s, 12);
    s->set_brightness(s, 1);       // +1 brightness (indoor)
    s->set_saturation(s, 0);       // neutral saturation
    s->set_sharpness(s, 1);        // slight sharpening
    s->set_whitebal(s, 1);         // auto white balance ON
    s->set_exposure_ctrl(s, 1);    // auto exposure ON
    s->set_gain_ctrl(s, 1);        // auto gain ON
    s->set_aec2(s, 1);             // AEC2 ON (better exposure)
    s->set_ae_level(s, 0);
    s->set_awb_gain(s, 1);
    s->set_vflip(s, 1);            // camera mounted upside-down
    s->set_hmirror(s, 1);

    // ── WiFi ─────────────────────────────────────────────────
    WiFi.mode(WIFI_STA);
    WiFi.config(IP, GW, SN);
    WiFi.setAutoReconnect(true);
    WiFi.persistent(true);
    WiFi.begin(SSID, PASS);

    Serial.print("[WiFi] Connecting");
    int t = 0;
    while (WiFi.status() != WL_CONNECTED && t++ < 40) {
        delay(500); Serial.print(".");
    }

    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("\n[WiFi] FAILED — restarting in 2s");
        delay(2000); ESP.restart();
    }

    Serial.printf("\n[WiFi] ✅ Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[Stream-Browser] http://%s:81/stream\n", WiFi.localIP().toString().c_str());
    Serial.printf("[Stream-Pi]      http://%s:82/stream\n", WiFi.localIP().toString().c_str());
    Serial.printf("[Snap]           http://%s/snap\n",      WiFi.localIP().toString().c_str());

    // ── Start all servers ─────────────────────────────────────
    startStream(81, &stream_server1);   // browser client
    startStream(82, &stream_server2);   // Raspberry Pi YOLO
    startControl();                      // port 80 control/snap/status

    blink(3, 150);  // 3 blinks = all good
    Serial.println("[NayanSathi] ✅ Ready!");

    announceToServer();
}

// ═══════════════════════════════════════════════════════════════
// LOOP — WiFi watchdog only
// ═══════════════════════════════════════════════════════════════
uint32_t last_wifi_check = 0;
uint32_t last_announce   = 0;

void loop() {
    uint32_t now = millis();

    // Check WiFi every 10s (not 5s — reduces interrupt load)
    if (now - last_wifi_check > 10000) {
        last_wifi_check = now;

        if (WiFi.status() != WL_CONNECTED) {
            Serial.println("[WiFi] ⚠️ Lost — reconnecting...");

            WiFi.disconnect(true);
            delay(500);
            WiFi.mode(WIFI_STA);
            WiFi.config(IP, GW, SN);
            WiFi.begin(SSID, PASS);

            int t = 0;
            while (WiFi.status() != WL_CONNECTED && t++ < 20) {
                delay(500); Serial.print(".");
            }

            if (WiFi.status() == WL_CONNECTED) {
                Serial.printf("\n[WiFi] ✅ Reconnected: %s\n",
                              WiFi.localIP().toString().c_str());
                // Restart servers only if needed
                if (!stream_server1) startStream(81, &stream_server1);
                if (!stream_server2) startStream(82, &stream_server2);
                if (!ctrl_server)    startControl();
            } else {
                Serial.println("\n[WiFi] ❌ Failed — restarting");
                delay(1000);
                ESP.restart();
            }
        }

        // Re-announce every 60s (server marks offline after 120s)
        if (WiFi.status() == WL_CONNECTED && now - last_announce > 60000) {
            last_announce = now;
            announceToServer();
        }
    }

    delay(100);  // yield to FreeRTOS tasks
}
