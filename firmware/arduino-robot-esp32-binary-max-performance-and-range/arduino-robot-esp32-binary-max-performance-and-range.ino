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
#include "esp_bt.h"      
#include <atomic>        

static const char* TAG = "RC_CTRL";

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

const int PWM_FREQ = 2000; const int PWM_RES = 8;    

// ============================================================
// 2. NETWORK & SECURITY
// ============================================================
const char* WIFI_SSID = "ESP32-RC-Car";
const char* WIFI_PASS = "12345678";
const char* BLE_NAME  = "ESP32-RACE-GAMEPAD";
const char* AUTH_TOKEN = "secret123";  
const char* OTA_PASS   = "ota12345";

#define SERVICE_UUID   "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHAR_RX_UUID   "6e400002-b5a3-f393-e0a9-e50e24dcca9e"

const unsigned long WD_TIMEOUT = 500;     
const unsigned long HB_TIMEOUT = 2000;   
const unsigned long LOG_INTERVAL = 2000; 

// ============================================================
// 3. KINEMATICS & PID CONSTANTS
// ============================================================
const int DEADZONE = 15;         
const float SMOOTH_ALPHA = 0.2f; 
const float MAX_TICKS = 150.0f; 
const float KP = 1.5f, KI = 3.0f, KD = 0.05f; 
const float DT = 0.020f;
const TickType_t PID_TICKS = pdMS_TO_TICKS(20);

// ============================================================
// 4. STRICT DATA STRUCTURES
// ============================================================
#pragma pack(push, 1)
struct BinaryCmd { uint8_t header; int8_t lx, ly, rx, ry; uint8_t dpad; uint8_t checksum; };
#pragma pack(pop)

struct PID {
    float Kp, Ki, Kd, integral, prevErr, outMin, outMax;
    PID(float p, float i, float d, float min, float max) : Kp(p), Ki(i), Kd(d), integral(0), prevErr(0), outMin(min), outMax(max) {}
    
    // DIPERBAIKI: Hapus IRAM_ATTR untuk mencegah error 'l32r literal placed after use'
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
WebSocketsServer ws(81);
NimBLEServer *pServer = nullptr;

TaskHandle_t pidTaskHandle = nullptr;
TaskHandle_t connTaskHandle = nullptr;

PID pidL(KP, KI, KD, -255, 255), pidR(KP, KI, KD, -255, 255);
pcnt_unit_handle_t pcntL = nullptr, pcntR = nullptr;

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
    gpio_config_t io = { .pin_bit_mask = (1ULL<<IN1)|(1ULL<<IN2)|(1ULL<<IN3)|(1ULL<<IN4),
        .mode = GPIO_MODE_OUTPUT, .pull_up_en = GPIO_PULLUP_DISABLE, 
        .pull_down_en = GPIO_PULLDOWN_DISABLE, .intr_type = GPIO_INTR_DISABLE };
    gpio_config(&io);

    ledcAttach(ENA, PWM_FREQ, PWM_RES); ledcAttach(ENB, PWM_FREQ, PWM_RES);
    
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
    setupPcnt(&pcntL, ENC_L_A, ENC_L_B); setupPcnt(&pcntR, ENC_R_A, ENC_R_B);
}

// DIPERBAIKI: Hapus IRAM_ATTR
inline void setMotors(float pwmL, float pwmR) {
    int dL = constrain(abs((int)pwmL), 0, 255); int dR = constrain(abs((int)pwmR), 0, 255);
    gpio_set_level((gpio_num_t)IN1, pwmL >= 0); gpio_set_level((gpio_num_t)IN2, pwmL < 0);
    gpio_set_level((gpio_num_t)IN3, pwmR >= 0); gpio_set_level((gpio_num_t)IN4, pwmR < 0);
    ledcWrite(ENA, dL); ledcWrite(ENB, dR);
}

// ============================================================
// 7. KINEMATICS
// ============================================================
// DIPERBAIKI: Hapus IRAM_ATTR
inline float applyExpo(float v) { return (v * fabsf(v)) / 100.0f; }

// DIPERBAIKI: Hapus IRAM_ATTR
void calcKinematics(int lx, int ly, int rx, int ry, uint8_t dpad, int &tL, int &tR) {
    if (abs(lx) < DEADZONE) lx = 0; else lx = applyExpo(lx);
    if (abs(ly) < DEADZONE) ly = 0; else ly = applyExpo(ly);
    if (abs(rx) < DEADZONE) rx = 0; else rx = applyExpo(rx);

    if (dpad == 1) { tL = 100; tR = 100; return; } if (dpad == 2) { tL = -100; tR = -100; return; }
    if (dpad == 3) { tL = -80; tR = 80; return; }  if (dpad == 4) { tL = 80; tR = -80; return; }

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
    esp_task_wdt_add(NULL); initHardware(); setMotors(0, 0);
    
    BinaryCmd cmd = {0};
    unsigned long lastCmdTime = millis();
    float smL = 0, smR = 0;
    int lastTickL = 0, lastTickR = 0;
    TickType_t wakeTime = xTaskGetTickCount();

    struct EncState { bool detected=false, invert=false, usePID=true; unsigned long zeroStart=0, mismatchStart=0; };
    EncState encL, encR;

    while (1) {
        esp_task_wdt_reset();
        uint64_t t_start = esp_timer_get_time(); 

        if (xQueueReceive(cmdQueue, &cmd, 0) == pdTRUE) lastCmdTime = millis();

        int rawL = 0, rawR = 0;
        if (millis() - lastCmdTime < WD_TIMEOUT) calcKinematics(cmd.lx, cmd.ly, cmd.rx, cmd.ry, cmd.dpad, rawL, rawR);
        else { pidL.reset(); pidR.reset(); }

        smL += (rawL - smL) * SMOOTH_ALPHA; smR += (rawR - smR) * SMOOTH_ALPHA;
        if (fabsf(smL) < 1.0f) smL = 0; if (fabsf(smR) < 1.0f) smR = 0;

        float spL = smL * (MAX_TICKS / 100.0f); float spR = smR * (MAX_TICKS / 100.0f);

        int cTickL, cTickR; 
        pcnt_unit_get_count(pcntL, &cTickL); pcnt_unit_get_count(pcntR, &cTickR);
        
        float actL = (float)(int16_t)(cTickL - lastTickL) / DT;
        float actR = (float)(int16_t)(cTickR - lastTickR) / DT;
        lastTickL = cTickL; lastTickR = cTickR;

        if (encL.invert) actL = -actL; if (encR.invert) actR = -actR;

        if (!encL.detected && actL != 0) encL.detected = true;
        if (!encR.detected && actR != 0) encR.detected = true;

        if (encL.detected && encL.usePID && rawL != 0 && fabsf(actL) > 10.0f) {
            if ((spL > 0 && actL < 0) || (spL < 0 && actL > 0)) {
                if (encL.mismatchStart == 0) encL.mismatchStart = millis();
                if (millis() - encL.mismatchStart > 250) { encL.invert = !encL.invert; actL = -actL; encL.mismatchStart = 0; }
            } else encL.mismatchStart = 0;
        } else encL.mismatchStart = 0;

        if (encR.detected && encR.usePID && rawR != 0 && fabsf(actR) > 10.0f) {
            if ((spR > 0 && actR < 0) || (spR < 0 && actR > 0)) {
                if (encR.mismatchStart == 0) encR.mismatchStart = millis();
                if (millis() - encR.mismatchStart > 250) { encR.invert = !encR.invert; actR = -actR; encR.mismatchStart = 0; }
            } else encR.mismatchStart = 0;
        } else encR.mismatchStart = 0;

        if (rawL != 0 && actL == 0) { if (encL.zeroStart == 0) encL.zeroStart = millis(); if (millis() - encL.zeroStart > 500) encL.usePID = false; } 
        else { encL.zeroStart = 0; if (rawL == 0) encL.usePID = true; }

        if (rawR != 0 && actR == 0) { if (encR.zeroStart == 0) encR.zeroStart = millis(); if (millis() - encR.zeroStart > 500) encR.usePID = false; } 
        else { encR.zeroStart = 0; if (rawR == 0) encR.usePID = true; }

        float pwmL = (encL.detected && encL.usePID) ? pidL.compute(spL, actL) : rawL * 2.55f;
        float pwmR = (encR.detected && encR.usePID) ? pidR.compute(spR, actR) : rawR * 2.55f;

        if (!(encL.detected && encL.usePID)) pidL.reset();
        if (!(encR.detected && encR.usePID)) pidR.reset();

        setMotors(pwmL, pwmR);

        uint32_t t_exec = esp_timer_get_time() - t_start;
        uint32_t prev_max = stats.pid_max_us.load();
        while (t_exec > prev_max && !stats.pid_max_us.compare_exchange_weak(prev_max, t_exec));

        vTaskDelayUntil(&wakeTime, PID_TICKS);
    }
}

// ============================================================
// 9. CORE 1: CONNECTION MANAGER (NO TELEMETRY)
// ============================================================
void connManagerTask(void*) {
    TickType_t wakeTime = xTaskGetTickCount();
    const TickType_t freq = pdMS_TO_TICKS(100); 
    unsigned long lastLogTime = 0;
    
    while (1) {
        if (millis() - lastHB > HB_TIMEOUT && lastHB > 0) {
            ESP_LOGW(TAG, "Heartbeat timeout! Disconnecting all.");
            for (int i=0; i<5; i++) { ws.disconnect(i); wsAuth[i]=false; }
            if (pServer) for (uint16_t id : pServer->getPeerDevices()) pServer->disconnect(id);
            lastHB = 0;
        }

        if (millis() - lastLogTime > LOG_INTERVAL) {
            uint8_t wsCount = 0; for(int i=0; i<5; i++) if(wsAuth[i]) wsCount++;
            ESP_LOGI(TAG, "[SYS] Heap: %luB | Up: %lus", ESP.getFreeHeap(), millis() / 1000);
            ESP_LOGI(TAG, "[RT ] PID Max: %luus | Rx: %lu | Drop: %lu", 
                     stats.pid_max_us.load(), stats.cmd_rx.load(), stats.cmd_invalid.load());
            ESP_LOGI(TAG, "[NET] WS: %d | BLE: %d", wsCount, pServer ? pServer->getConnectedCount() : 0);
            
            if (pidTaskHandle && connTaskHandle) {
                ESP_LOGI(TAG, "[STK] PID: %luB | CONN: %luB", 
                         uxTaskGetStackHighWaterMark(pidTaskHandle), uxTaskGetStackHighWaterMark(connTaskHandle));
            }
            
            stats.pid_max_us = 0; 
            lastLogTime = millis();
        }
        vTaskDelayUntil(&wakeTime, freq);
    }
}

// ============================================================
// 10. INGESTION (COMMANDS ONLY)
// ============================================================
void processPayload(uint8_t* payload, size_t len, uint8_t src) {
    if (len == sizeof(BinaryCmd) && payload[0] == 0xAA) {
        BinaryCmd* b = (BinaryCmd*)payload;
        if (b->checksum == ((0xAA ^ b->lx ^ b->ly ^ b->rx ^ b->ry ^ b->dpad) & 0xFF)) {
            xQueueOverwrite(cmdQueue, b); stats.cmd_rx++;
            if (src == 0) lastWifiAct = millis(); else lastBleAct = millis();
            lastHB = millis();
        } else stats.cmd_invalid++;
        return; 
    }

    if (len < 10 || payload[0] != '{') return; 
    JsonDocument doc;
    if (deserializeJson(doc, payload, len)) { stats.json_parse_err++; return; }
    
    const char* type = doc["type"] | "";
    if (strcmp(type, "HB") == 0) {
        lastHB = millis(); 
        if (src == 0) lastWifiAct = millis(); else lastBleAct = millis();
    }
}

// ============================================================
// 11. RADIO CALLBACKS
// ============================================================
void wsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t len) {
    if (type == WStype_CONNECTED) { wsAuth[num] = false; } 
    else if (type == WStype_DISCONNECTED) { wsAuth[num] = false; }
    else if (type == WStype_TEXT || type == WStype_BIN) {
        if (!wsAuth[num]) {
            if (type == WStype_TEXT) {
                JsonDocument d;
                if (!deserializeJson(d, payload, len) && strcmp(d["type"]|"","AUTH")==0 && strcmp(d["token"]|"",AUTH_TOKEN)==0) {
                    wsAuth[num] = true; 
                    lastWifiAct = lastHB = millis();
                } else ws.disconnect(num);
            } return;
        }
        processPayload(payload, len, 0);
    }
}

class BleCharCB : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pChar, NimBLEConnInfo& connInfo) override {
        NimBLEAttValue val = pChar->getValue();
        if (val.length() > 0) {
            if (val.length() == 7 && val.data()[0] == 0xAA) {
                processPayload((uint8_t*)val.data(), val.length(), 1); return;
            }
            static char jsonBuf[128]; static size_t jsonLen = 0;
            for(size_t i=0; i<val.length(); i++) {
                if(jsonLen < sizeof(jsonBuf)-1) {
                    jsonBuf[jsonLen++] = val[i];
                    if(val[i] == '}') {
                        jsonBuf[jsonLen] = '\0';
                        processPayload((uint8_t*)jsonBuf, jsonLen, 1);
                        jsonLen = 0;
                    }
                }
            }
        }
    }
};

class BleServCB : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) override { 
        ESP_LOGI(TAG, "BLE Connected. Max TX Power Active.");
        lastBleAct = lastHB = millis(); 
    }
    
    void onDisconnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo, int reason) override { 
        ESP_LOGW(TAG, "BLE Disconnected. Reason: %d", reason);
        NimBLEDevice::startAdvertising(); 
    }
};

// ============================================================
// 12. SETUP & LOOP
// ============================================================
void setup() {
    Serial.begin(115200); delay(500); 
    
    setCpuFrequencyMhz(240); 

    cmdQueue = xQueueCreate(1, sizeof(BinaryCmd));
    xTaskCreatePinnedToCore(motorTask, "PID", 4096, nullptr, 10, &pidTaskHandle, 0);
    
    esp_task_wdt_config_t twdt = { .timeout_ms = 1000, .idle_core_mask = 0, .trigger_panic = true };
    esp_task_wdt_init(&twdt);

    // WiFi Setup (Standard)
    WiFi.softAP(WIFI_SSID, WIFI_PASS);
    ws.begin(); ws.onEvent(wsEvent);
    ESP_LOGI(TAG, "WiFi AP Started.");

    // BLE Setup (Max Range - Receive Only)
    NimBLEDevice::init(BLE_NAME);

    // PAKSA TX POWER MAKSIMUM (9 dBm) - FAKTOR UTAMA PENAMBAH JARAK
    esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, ESP_PWR_LVL_P9);
    esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_SCAN, ESP_PWR_LVL_P9);
    esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_DEFAULT, ESP_PWR_LVL_P9);

    NimBLEDevice::setSecurityAuth(true, true, true);
    NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
    
    pServer = NimBLEDevice::createServer();
    pServer->setCallbacks(new BleServCB());
    
    auto pSvc = pServer->createService(SERVICE_UUID);
    auto pRx = pSvc->createCharacteristic(CHAR_RX_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
    pRx->setCallbacks(new BleCharCB());
    pSvc->start();
    
    NimBLEAdvertising* pAdv = NimBLEDevice::getAdvertising();
    pAdv->addServiceUUID(SERVICE_UUID);
    pAdv->setAdvertisingInterval(200);
    pAdv->start();

    ArduinoOTA.setHostname(WIFI_SSID); ArduinoOTA.setPassword(OTA_PASS);
    ArduinoOTA.onStart([]() { setMotors(0, 0); }); ArduinoOTA.begin();

    xTaskCreatePinnedToCore(connManagerTask, "CONN", 4096, nullptr, 2, &connTaskHandle, 1);
    
    ESP_LOGI(TAG, "=== CONTROL-ONLY MODE ACTIVE (Max BLE TX Power 9dBm) ===");
}

void loop() {
    ws.loop(); ArduinoOTA.handle();
    vTaskDelay(pdMS_TO_TICKS(1));
}