#include <WiFi.h>
#include <WebSocketsServer.h>
#include <NimBLEDevice.h> 
#include <ArduinoJson.h>  
#include <ArduinoOTA.h>
#include "driver/pulse_cnt.h"
#include "driver/gpio.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"   
#include "esp_log.h"     
#include <atomic>        

// ============================================================
// LOGGING CONFIGURATION
// ============================================================
static const char* TAG = "RC_SYS";

// ============================================================
// 1. HARDWARE & PIN CONFIGURATION
// ============================================================
#define ENA 14
#define ENB 13
#define IN1 27
#define IN2 26
#define IN3 25
#define IN4 33
#define ENC_L_A 18
#define ENC_L_B 19
#define ENC_R_A 21
#define ENC_R_B 22

const int PWM_FREQ = 2000;       
const int PWM_RES = 8;    

// ============================================================
// 2. NETWORK & SECURITY
// ============================================================
const char* WIFI_SSID = "ESP32-RC-Car";
const char* WIFI_PASS = "12345678";
const char* BLE_NAME  = "ESP32-Gamepad";
const char* AUTH_TOKEN = "secret123";  
const char* OTA_PASS   = "ota12345";

#define SERVICE_UUID   "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHAR_RX_UUID   "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define CHAR_TX_UUID   "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

const unsigned long WD_TIMEOUT = 500;     
const unsigned long HB_TIMEOUT = 2000;   
const unsigned long LOG_INTERVAL = 2000; 

// ============================================================
// 3. KINEMATICS & PID CONSTANTS
// ============================================================
const int DEADZONE = 15;         
const float SMOOTH_ALPHA = 0.2f; 
const float MAX_TICKS = 150.0f; 
const float EXPO_FACTOR = 2.0f;   
const float KP = 1.5f, KI = 3.0f, KD = 0.05f; 
const float DT = 0.020f;
const TickType_t PID_TICKS = pdMS_TO_TICKS(20);

// ============================================================
// 4. STRICT DATA STRUCTURES
// ============================================================
#pragma pack(push, 1)
struct BinaryCmd {
    uint8_t header; 
    int8_t lx, ly, rx, ry;
    uint8_t dpad;   
    uint8_t checksum;
};
#pragma pack(pop)

struct Telemetry { float speedL, speedR; uint32_t ts; };

struct PID {
    float Kp, Ki, Kd, integral, prevErr, outMin, outMax;
    PID(float p, float i, float d, float min, float max) 
        : Kp(p), Ki(i), Kd(d), integral(0), prevErr(0), outMin(min), outMax(max) {}
    float compute(float sp, float pv) {
        float err = sp - pv;
        integral = constrain(integral + err * DT, outMin / Ki, outMax / Ki);
        float deriv = -(pv - prevErr) / DT; prevErr = pv; 
        return constrain(Kp * err + Ki * integral + Kd * deriv, outMin, outMax);
    }
    void reset() { integral = 0; prevErr = 0; }
};

// ============================================================
// 5. GLOBAL STATE & DIAGNOSTICS
// ============================================================
QueueHandle_t cmdQueue;
SemaphoreHandle_t telMutex; 
WebSocketsServer ws(81);
NimBLEServer *pServer = nullptr;
NimBLECharacteristic *pTxChar = nullptr;

TaskHandle_t pidTaskHandle = nullptr;
TaskHandle_t netTaskHandle = nullptr;

PID pidL(KP, KI, KD, -255, 255), pidR(KP, KI, KD, -255, 255);
pcnt_unit_handle_t pcntL = nullptr, pcntR = nullptr;

Telemetry telemetry = {0};
uint32_t lastWifiAct = 0, lastBleAct = 0, lastHB = 0;
bool wsAuth[5] = {false};  

struct SystemStats {
    std::atomic<uint32_t> cmd_rx{0};
    std::atomic<uint32_t> cmd_invalid{0};
    std::atomic<uint32_t> pid_max_us{0};
    std::atomic<uint32_t> json_parse_err{0};
} stats;

// ============================================================
// 6. HARDWARE INIT
// ============================================================
void initHardware() {
    gpio_config_t io = {
        .pin_bit_mask = (1ULL<<IN1)|(1ULL<<IN2)|(1ULL<<IN3)|(1ULL<<IN4),
        .mode = GPIO_MODE_OUTPUT, .pull_up_en = GPIO_PULLUP_DISABLE, 
        .pull_down_en = GPIO_PULLDOWN_DISABLE, .intr_type = GPIO_INTR_DISABLE
    };
    gpio_config(&io);

    ledcAttach(ENA, PWM_FREQ, PWM_RES);
    ledcAttach(ENB, PWM_FREQ, PWM_RES);
    
    auto setupPcnt = [](pcnt_unit_handle_t *unit, int pA, int pB) {
        pcnt_unit_config_t uCfg = {.low_limit = -32768, .high_limit = 32767};
        pcnt_new_unit(&uCfg, unit);
        pcnt_chan_config_t cA = {.edge_gpio_num = pA, .level_gpio_num = pB};
        pcnt_chan_config_t cB = {.edge_gpio_num = pB, .level_gpio_num = pA};
        pcnt_channel_handle_t hA, hB;
        pcnt_new_channel(*unit, &cA, &hA); pcnt_new_channel(*unit, &cB, &hB);
        
        pcnt_channel_set_edge_action(hA, PCNT_CHANNEL_EDGE_ACTION_INCREASE, PCNT_CHANNEL_EDGE_ACTION_DECREASE);
        pcnt_channel_set_level_action(hA, PCNT_CHANNEL_LEVEL_ACTION_KEEP, PCNT_CHANNEL_LEVEL_ACTION_INVERSE);
        pcnt_channel_set_edge_action(hB, PCNT_CHANNEL_EDGE_ACTION_DECREASE, PCNT_CHANNEL_EDGE_ACTION_INCREASE);
        pcnt_channel_set_level_action(hB, PCNT_CHANNEL_LEVEL_ACTION_KEEP, PCNT_CHANNEL_LEVEL_ACTION_INVERSE);
        
        pcnt_unit_enable(*unit); pcnt_unit_clear_count(*unit); pcnt_unit_start(*unit);
    };
    setupPcnt(&pcntL, ENC_L_A, ENC_L_B);
    setupPcnt(&pcntR, ENC_R_A, ENC_R_B);
    ESP_LOGI(TAG, "Hardware initialized.");
}

inline void setMotors(float pwmL, float pwmR) {
    int dL = constrain(abs((int)pwmL), 0, 255);
    int dR = constrain(abs((int)pwmR), 0, 255);
    gpio_set_level((gpio_num_t)IN1, pwmL >= 0); gpio_set_level((gpio_num_t)IN2, pwmL < 0);
    gpio_set_level((gpio_num_t)IN3, pwmR >= 0); gpio_set_level((gpio_num_t)IN4, pwmR < 0);
    ledcWrite(ENA, dL); ledcWrite(ENB, dR);
}

// ============================================================
// 7. KINEMATICS
// ============================================================
inline float applyExpo(float v) {
    float n = v / 100.0f;
    return (n * powf(fabsf(n), EXPO_FACTOR - 1.0f)) * 100.0f;
}

void calcKinematics(int lx, int ly, int rx, int ry, uint8_t dpad, int &tL, int &tR) {
    if (abs(lx) < DEADZONE) lx = 0; else lx = applyExpo(lx);
    if (abs(ly) < DEADZONE) ly = 0; else ly = applyExpo(ly);
    if (abs(rx) < DEADZONE) rx = 0; else rx = applyExpo(rx);

    if (dpad == 1) { tL = 100; tR = 100; return; }
    if (dpad == 2) { tL = -100; tR = -100; return; }
    if (dpad == 3) { tL = -80; tR = 80; return; }
    if (dpad == 4) { tL = 80; tR = -80; return; }

    if (rx != 0) { tL = rx; tR = -rx; } 
    else if (lx != 0 || ly != 0) {
        int fwd = -ly; 
        tL = (lx > 0) ? fwd : fwd * (100 + lx) / 100;
        tR = (lx < 0) ? fwd : fwd * (100 - lx) / 100;
    } else { tL = 0; tR = 0; }
}

// ============================================================
// 8. CORE 0: HARD REAL-TIME PID TASK
// ============================================================
void motorTask(void*) {
    esp_task_wdt_add(NULL); 
    initHardware();
    setMotors(0, 0);
    
    BinaryCmd cmd = {0};
    unsigned long lastCmdTime = millis();
    float smL = 0, smR = 0;
    int lastTickL = 0, lastTickR = 0; // DIUBAH: Gunakan 'int' murni
    TickType_t wakeTime = xTaskGetTickCount();

    ESP_LOGI(TAG, "Core 0 PID Task started.");

    while (1) {
        esp_task_wdt_reset();
        uint64_t t_start = esp_timer_get_time(); 

        if (xQueueReceive(cmdQueue, &cmd, 0) == pdTRUE) lastCmdTime = millis();

        int rawL = 0, rawR = 0;
        if (millis() - lastCmdTime < WD_TIMEOUT) {
            calcKinematics(cmd.lx, cmd.ly, cmd.rx, cmd.ry, cmd.dpad, rawL, rawR);
        } else {
            pidL.reset(); pidR.reset(); 
        }

        smL += (rawL - smL) * SMOOTH_ALPHA;
        smR += (rawR - smR) * SMOOTH_ALPHA;
        if (fabsf(smL) < 1.0f) smL = 0; if (fabsf(smR) < 1.0f) smR = 0;

        float spL = smL * (MAX_TICKS / 100.0f);
        float spR = smR * (MAX_TICKS / 100.0f);

        // PERBAIKAN: Gunakan 'int' murni agar sesuai dengan signature ESP-IDF terbaru
        int cTickL, cTickR; 
        pcnt_unit_get_count(pcntL, &cTickL); 
        pcnt_unit_get_count(pcntR, &cTickR);
        
        float actL = (float)(int16_t)(cTickL - lastTickL) / DT;
        float actR = (float)(int16_t)(cTickR - lastTickR) / DT;
        lastTickL = cTickL; lastTickR = cTickR;

        // Auto-polarity/encoder detection state variables
        static bool encodersDetectedL = false;
        static bool encodersDetectedR = false;
        static bool invertEncoderL = false;
        static bool invertEncoderR = false;
        static unsigned long zeroTickStartL = 0;
        static unsigned long zeroTickStartR = 0;
        static unsigned long mismatchStartL = 0;
        static unsigned long mismatchStartR = 0;
        static bool usePID_L = true;
        static bool usePID_R = true;

        // Apply detected inversion
        if (invertEncoderL) actL = -actL;
        if (invertEncoderR) actR = -actR;

        if (xSemaphoreTake(telMutex, 0) == pdTRUE) {
            telemetry.speedL = actL; telemetry.speedR = actR; telemetry.ts = millis();
            xSemaphoreGive(telMutex);
        }

        // 1. Bootstrapping: Auto-detect encoder presence upon receiving the first ticks
        if (!encodersDetectedL && actL != 0) {
            encodersDetectedL = true;
            ESP_LOGI(TAG, "Left Encoder detected, enabling closed-loop.");
        }
        if (!encodersDetectedR && actR != 0) {
            encodersDetectedR = true;
            ESP_LOGI(TAG, "Right Encoder detected, enabling closed-loop.");
        }

        // 2. Polarity Correction: If encoders are present and in PID mode, verify rotation matches command
        if (encodersDetectedL && usePID_L && rawL != 0 && fabsf(actL) > 10.0f) {
            if ((spL > 0 && actL < 0) || (spL < 0 && actL > 0)) {
                if (mismatchStartL == 0) mismatchStartL = millis();
                if (millis() - mismatchStartL > 250) { // 250ms persistent mismatch
                    invertEncoderL = !invertEncoderL;
                    actL = -actL; // Apply immediately to current loop
                    ESP_LOGW(TAG, "Left Encoder direction mismatch detected! Auto-inverting feedback.");
                    mismatchStartL = 0;
                }
            } else {
                mismatchStartL = 0;
            }
        } else {
            mismatchStartL = 0;
        }

        if (encodersDetectedR && usePID_R && rawR != 0 && fabsf(actR) > 10.0f) {
            if ((spR > 0 && actR < 0) || (spR < 0 && actR > 0)) {
                if (mismatchStartR == 0) mismatchStartR = millis();
                if (millis() - mismatchStartR > 250) {
                    invertEncoderR = !invertEncoderR;
                    actR = -actR;
                    ESP_LOGW(TAG, "Right Encoder direction mismatch detected! Auto-inverting feedback.");
                    mismatchStartR = 0;
                }
            } else {
                mismatchStartR = 0;
            }
        } else {
            mismatchStartR = 0;
        }

        // 3. Failsafe: Fall back to open-loop if commanded to move but no encoder activity is received
        bool wrongFeedbackL = (rawL != 0 && actL == 0);
        if (wrongFeedbackL) {
            if (zeroTickStartL == 0) zeroTickStartL = millis();
            if (millis() - zeroTickStartL > 500) {
                if (usePID_L) {
                    ESP_LOGW(TAG, "Left encoder feedback timed out under load! Falling back to Open-Loop.");
                    usePID_L = false;
                }
            }
        } else {
            zeroTickStartL = 0;
            if (rawL == 0) {
                usePID_L = true; // Reset failsafe when motors stop
            }
        }

        bool wrongFeedbackR = (rawR != 0 && actR == 0);
        if (wrongFeedbackR) {
            if (zeroTickStartR == 0) zeroTickStartR = millis();
            if (millis() - zeroTickStartR > 500) {
                if (usePID_R) {
                    ESP_LOGW(TAG, "Right encoder feedback timed out under load! Falling back to Open-Loop.");
                    usePID_R = false;
                }
            }
        } else {
            zeroTickStartR = 0;
            if (rawR == 0) {
                usePID_R = true;
            }
        }

        // Determine control loop mode for this frame
        bool runPID_L = encodersDetectedL && usePID_L;
        bool runPID_R = encodersDetectedR && usePID_R;

        float pwmL = runPID_L ? pidL.compute(spL, actL) : rawL * 2.55f;
        float pwmR = runPID_R ? pidR.compute(spR, actR) : rawR * 2.55f;

        if (!runPID_L) pidL.reset();
        if (!runPID_R) pidR.reset();

        setMotors(pwmL, pwmR);

        uint32_t t_exec = esp_timer_get_time() - t_start;
        uint32_t prev_max = stats.pid_max_us.load();
        while (t_exec > prev_max && !stats.pid_max_us.compare_exchange_weak(prev_max, t_exec));

        vTaskDelayUntil(&wakeTime, PID_TICKS);
    }
}

// ============================================================
// 9. CORE 1: TELEMETRY, NETWORK & DIAGNOSTICS
// ============================================================
void netTask(void*) {
    TickType_t wakeTime = xTaskGetTickCount();
    const TickType_t freq = pdMS_TO_TICKS(100); 
    unsigned long lastLogTime = 0;
    
    ESP_LOGI(TAG, "Core 1 Network Task started.");

    while (1) {
        float sL, sR;
        if (xSemaphoreTake(telMutex, pdMS_TO_TICKS(5)) == pdTRUE) {
            sL = telemetry.speedL; sR = telemetry.speedR;
            xSemaphoreGive(telMutex);
        }
        
        JsonDocument doc;
        doc["type"] = "TEL"; doc["l"] = sL; doc["r"] = sR;
        char buf[64]; size_t len = serializeJson(doc, buf);
        ws.broadcastTXT((uint8_t*)buf, len);
        if (pTxChar && pServer->getConnectedCount() > 0) {
            pTxChar->setValue((uint8_t*)buf, len); pTxChar->notify();
        }

        if (millis() - lastHB > HB_TIMEOUT && lastHB > 0) {
            ESP_LOGW(TAG, "Heartbeat timeout! Disconnecting all.");
            for (int i=0; i<5; i++) { ws.disconnect(i); wsAuth[i]=false; }
            if (pServer) for (uint16_t id : pServer->getPeerDevices()) pServer->disconnect(id);
            lastHB = 0;
        }

        if (millis() - lastLogTime > LOG_INTERVAL) {
            uint8_t wsCount = 0;
            for(int i=0; i<5; i++) if(wsAuth[i]) wsCount++;

            ESP_LOGI(TAG, "[SYS] Heap: %luB (Min: %luB) | Up: %lus", 
                     ESP.getFreeHeap(), ESP.getMinFreeHeap(), millis() / 1000);
            ESP_LOGI(TAG, "[RT ] PID Max: %luus | Rx: %lu | Drop: %lu | JErr: %lu", 
                     stats.pid_max_us.load(), stats.cmd_rx.load(), stats.cmd_invalid.load(), stats.json_parse_err.load());
            ESP_LOGI(TAG, "[NET] WS: %d | BLE: %d", wsCount, pServer ? pServer->getConnectedCount() : 0);

            if (pidTaskHandle && netTaskHandle) {
                ESP_LOGI(TAG, "[STK] PID: %luB | NET: %luB", 
                         uxTaskGetStackHighWaterMark(pidTaskHandle), uxTaskGetStackHighWaterMark(netTaskHandle));
            }

            stats.pid_max_us = 0; 
            lastLogTime = millis();
        }

        vTaskDelayUntil(&wakeTime, freq);
    }
}

// ============================================================
// 10. STRICT BINARY INGESTION
// ============================================================
void processPayload(uint8_t* payload, size_t len, uint8_t src) {
    if (len == sizeof(BinaryCmd) && payload[0] == 0xAA) {
        BinaryCmd* b = (BinaryCmd*)payload;
        uint8_t calc = (0xAA ^ b->lx ^ b->ly ^ b->rx ^ b->ry ^ b->dpad) & 0xFF;
        if (b->checksum == calc) {
            xQueueOverwrite(cmdQueue, b);
            stats.cmd_rx++;
            if (src == 0) lastWifiAct = millis(); else lastBleAct = millis();
            lastHB = millis();
        } else {
            stats.cmd_invalid++;
        }
        return; 
    }

    if (len < 10 || payload[0] != '{') return; 
    
    JsonDocument doc;
    if (deserializeJson(doc, payload, len)) {
        stats.json_parse_err++;
        return;
    }
    
    const char* type = doc["type"] | "";
    if (strcmp(type, "AUTH") == 0) {
        bool ok = strcmp(doc["token"] | "", AUTH_TOKEN) == 0;
        JsonDocument resp; resp["type"] = "AUTH"; resp["ok"] = ok;
        char buf[32]; size_t l = serializeJson(resp, buf);
        if (src == 0) ws.broadcastTXT((uint8_t*)buf, l);
        else if (pTxChar && pServer->getConnectedCount() > 0) { pTxChar->setValue((uint8_t*)buf, l); pTxChar->notify(); }
    } 
    else if (strcmp(type, "HB") == 0) {
        lastHB = millis();
        if (src == 0) lastWifiAct = millis(); else lastBleAct = millis();
    }
}

// ============================================================
// 11. RADIO CALLBACKS
// ============================================================
void wsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t len) {
    if (type == WStype_CONNECTED) { wsAuth[num] = false; ws.sendTXT(num, "{\"type\":\"AUTH_REQ\"}"); } 
    else if (type == WStype_DISCONNECTED) { wsAuth[num] = false; }
    else if (type == WStype_TEXT || type == WStype_BIN) {
        if (!wsAuth[num]) {
            if (type == WStype_TEXT) {
                JsonDocument d;
                if (!deserializeJson(d, payload, len) && strcmp(d["type"]|"","AUTH")==0 && strcmp(d["token"]|"",AUTH_TOKEN)==0) {
                    wsAuth[num] = true; ws.sendTXT(num, "{\"type\":\"AUTH\",\"ok\":true}");
                    lastWifiAct = lastHB = millis();
                } else ws.disconnect(num);
            }
            return;
        }
        processPayload(payload, len, 0);
    }
}

#if __has_include("NimBLECppVersion.h")
#include "NimBLECppVersion.h"
#endif

std::string bleRxBuf = "";

class BleCharCB : public NimBLECharacteristicCallbacks {
    void handleWrite(NimBLECharacteristic* pChar) {
        NimBLEAttValue val = pChar->getValue();
        if (val.length() > 0) {
            // Jika paket adalah command biner utuh (header 0xAA dan panjang 7 byte), bypass buffer
            if (val.length() == 7 && val.data()[0] == 0xAA) {
                processPayload((uint8_t*)val.data(), val.length(), 1);
                return;
            }

            // Gabungkan potongan paket JSON (misal AUTH/HB)
            for (size_t i = 0; i < val.length(); i++) {
                char c = (char)val[i];
                bleRxBuf += c;
                if (c == '}') {
                    processPayload((uint8_t*)bleRxBuf.c_str(), bleRxBuf.length(), 1);
                    bleRxBuf = "";
                }
            }
        }
    }

#if defined(NIMBLE_CPP_VER_MAJOR) && NIMBLE_CPP_VER_MAJOR >= 2
    void onWrite(NimBLECharacteristic* pChar, NimBLEConnInfo& connInfo) override {
        handleWrite(pChar);
    }
#else
    void onWrite(NimBLECharacteristic* pChar) override {
        handleWrite(pChar);
    }
#endif
};

class BleServCB : public NimBLEServerCallbacks {
#if defined(NIMBLE_CPP_VER_MAJOR) && NIMBLE_CPP_VER_MAJOR >= 2
    void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) override { 
        ESP_LOGI(TAG, "BLE Client Connected.");
        lastBleAct = lastHB = millis(); 
    }
    void onDisconnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo, int reason) override { 
        ESP_LOGW(TAG, "BLE Disconnected. Reason: %d", reason);
        bleRxBuf = "";
        NimBLEDevice::startAdvertising(); 
    }
#else
    void onConnect(NimBLEServer* pServer, ble_gap_conn_desc* desc) override { 
        ESP_LOGI(TAG, "BLE Client Connected.");
        lastBleAct = lastHB = millis(); 
    }
    void onDisconnect(NimBLEServer* pServer) override { 
        ESP_LOGW(TAG, "BLE Disconnected.");
        bleRxBuf = "";
        NimBLEDevice::startAdvertising(); 
    }
#endif
};

// ============================================================
// 12. SETUP & LOOP
// ============================================================
void setup() {
    Serial.begin(115200);
    delay(500); 
    
    ESP_LOGI(TAG, "=== ESP32 RC CAR BOOTING ===");

    cmdQueue = xQueueCreate(1, sizeof(BinaryCmd));
    telMutex = xSemaphoreCreateMutex();

    xTaskCreatePinnedToCore(motorTask, "PID", 4096, nullptr, 5, &pidTaskHandle, 0);
    
    // PERBAIKAN: esp_task_wdt_init sekarang hanya menerima 1 parameter (struct config)
    esp_task_wdt_config_t twdt = { 
        .timeout_ms = 1000, 
        .idle_core_mask = 0, 
        .trigger_panic = true 
    };
    esp_task_wdt_init(&twdt);

    WiFi.softAP(WIFI_SSID, WIFI_PASS);
    ESP_LOGI(TAG, "WiFi AP: %s (IP: %s)", WIFI_SSID, WiFi.softAPIP().toString().c_str());
    
    ws.begin(); ws.onEvent(wsEvent);

    NimBLEDevice::init(BLE_NAME);
    NimBLEDevice::setSecurityAuth(true, true, true);
    NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
    
    pServer = NimBLEDevice::createServer();
    pServer->setCallbacks(new BleServCB());
    
    auto pSvc = pServer->createService(SERVICE_UUID);
    auto pRx = pSvc->createCharacteristic(CHAR_RX_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
    pRx->setCallbacks(new BleCharCB());
    pTxChar = pSvc->createCharacteristic(CHAR_TX_UUID, NIMBLE_PROPERTY::NOTIFY);
    pSvc->start();
    
    NimBLEDevice::getAdvertising()->addServiceUUID(SERVICE_UUID);
    NimBLEDevice::getAdvertising()->start();
    ESP_LOGI(TAG, "BLE MAC: %s", NimBLEDevice::getAddress().toString().c_str());

    ArduinoOTA.setHostname(WIFI_SSID); ArduinoOTA.setPassword(OTA_PASS);
    ArduinoOTA.onStart([]() { setMotors(0, 0); });
    ArduinoOTA.begin();

    xTaskCreatePinnedToCore(netTask, "NET", 4096, nullptr, 2, &netTaskHandle, 1);
    
    ESP_LOGI(TAG, "=== SYSTEM OPERATIONAL ===");
}

void loop() {
    ws.loop();
    ArduinoOTA.handle();
    vTaskDelay(pdMS_TO_TICKS(1));
}