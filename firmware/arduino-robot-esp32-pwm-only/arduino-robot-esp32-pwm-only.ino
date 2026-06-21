#include <WiFi.h>
#include <WebSocketsServer.h>
#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "esp_log.h"
#include <atomic>

static const char* TAG = "RC_PWM";

#define ENA 14
#define ENB 13
#define IN1 27
#define IN2 26
#define IN3 25
#define IN4 33

const int PWM_FREQ = 2000;
const int PWM_RES = 8;

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

const int DEADZONE = 15;
const float EXPO_FACTOR = 2.0f;
const float SMOOTH_ALPHA = 0.2f;

#pragma pack(push, 1)
struct BinaryCmd {
    uint8_t header;
    int8_t lx, ly, rx, ry;
    uint8_t dpad;
    uint8_t checksum;
};
#pragma pack(pop)

QueueHandle_t cmdQueue;
WebSocketsServer ws(81);
NimBLEServer *pServer = nullptr;
NimBLECharacteristic *pTxChar = nullptr;

TaskHandle_t pidTaskHandle = nullptr;
TaskHandle_t netTaskHandle = nullptr;

uint32_t lastWifiAct = 0, lastBleAct = 0, lastHB = 0;
bool wsAuth[5] = {false};

struct SystemStats {
    std::atomic<uint32_t> cmd_rx{0};
    std::atomic<uint32_t> cmd_invalid{0};
    std::atomic<uint32_t> json_parse_err{0};
} stats;

void initHardware() {
    gpio_config_t io = {
        .pin_bit_mask = (1ULL<<IN1)|(1ULL<<IN2)|(1ULL<<IN3)|(1ULL<<IN4),
        .mode = GPIO_MODE_OUTPUT, .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE, .intr_type = GPIO_INTR_DISABLE
    };
    gpio_config(&io);

    ledcAttach(ENA, PWM_FREQ, PWM_RES);
    ledcAttach(ENB, PWM_FREQ, PWM_RES);

    ESP_LOGI(TAG, "Hardware initialized (PWM-only mode).");
}

inline void setMotors(int pwmL, int pwmR) {
    int dL = constrain(abs(pwmL), 0, 255);
    int dR = constrain(abs(pwmR), 0, 255);
    gpio_set_level((gpio_num_t)IN1, pwmL >= 0);
    gpio_set_level((gpio_num_t)IN2, pwmL < 0);
    gpio_set_level((gpio_num_t)IN3, pwmR >= 0);
    gpio_set_level((gpio_num_t)IN4, pwmR < 0);
    ledcWrite(ENA, dL);
    ledcWrite(ENB, dR);
}

inline float applyExpo(float v) {
    float n = v / 100.0f;
    return (n * powf(fabsf(n), EXPO_FACTOR - 1.0f)) * 100.0f;
}

void calcMotors(int lx, int ly, int rx, int ry, uint8_t dpad, int &mL, int &mR) {
    if (abs(lx) < DEADZONE) lx = 0; else lx = applyExpo(lx);
    if (abs(ly) < DEADZONE) ly = 0; else ly = applyExpo(ly);
    if (abs(rx) < DEADZONE) rx = 0; else rx = applyExpo(rx);

    if (dpad == 1) { mL = 100; mR = 100; return; }
    if (dpad == 2) { mL = -100; mR = -100; return; }
    if (dpad == 3) { mL = -80; mR = 80; return; }
    if (dpad == 4) { mL = 80; mR = -80; return; }

    if (rx != 0) { mL = rx; mR = -rx; }
    else if (lx != 0 || ly != 0) {
        int fwd = -ly;
        mL = (lx > 0) ? fwd : fwd * (100 + lx) / 100;
        mR = (lx < 0) ? fwd : fwd * (100 - lx) / 100;
    } else { mL = 0; mR = 0; }
}

void motorTask(void*) {
    esp_task_wdt_add(NULL);
    initHardware();
    setMotors(0, 0);

    BinaryCmd cmd = {0};
    unsigned long lastCmdTime = millis();
    float smL = 0, smR = 0;
    TickType_t wakeTime = xTaskGetTickCount();

    while (1) {
        esp_task_wdt_reset();
        uint64_t t_start = esp_timer_get_time();

        if (xQueueReceive(cmdQueue, &cmd, 0) == pdTRUE) lastCmdTime = millis();

        int rawL = 0, rawR = 0;
        if (millis() - lastCmdTime < WD_TIMEOUT) {
            calcMotors(cmd.lx, cmd.ly, cmd.rx, cmd.ry, cmd.dpad, rawL, rawR);
        }

        smL += (rawL - smL) * SMOOTH_ALPHA;
        smR += (rawR - smR) * SMOOTH_ALPHA;
        if (fabsf(smL) < 1.0f) smL = 0;
        if (fabsf(smR) < 1.0f) smR = 0;

        int pwmL = (int)(smL * 2.55f);
        int pwmR = (int)(smR * 2.55f);

        setMotors(pwmL, pwmR);

        vTaskDelayUntil(&wakeTime, pdMS_TO_TICKS(20));
    }
}

void netTask(void*) {
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
            uint8_t wsCount = 0;
            for(int i=0; i<5; i++) if(wsAuth[i]) wsCount++;

            ESP_LOGI(TAG, "[SYS] Heap: %luB (Min: %luB) | Up: %lus",
                     ESP.getFreeHeap(), ESP.getMinFreeHeap(), millis() / 1000);
            ESP_LOGI(TAG, "[PWM] Rx: %lu | Drop: %lu | JErr: %lu",
                     stats.cmd_rx.load(), stats.cmd_invalid.load(), stats.json_parse_err.load());
            ESP_LOGI(TAG, "[NET] WS: %d | BLE: %d", wsCount, pServer ? pServer->getConnectedCount() : 0);

            if (pidTaskHandle && netTaskHandle) {
                ESP_LOGI(TAG, "[STK] MOTOR: %luB | NET: %luB",
                         uxTaskGetStackHighWaterMark(pidTaskHandle),
                         uxTaskGetStackHighWaterMark(netTaskHandle));
            }

            stats.cmd_rx = 0;
            stats.cmd_invalid = 0;
            stats.json_parse_err = 0;
            lastLogTime = millis();
        }

        vTaskDelayUntil(&wakeTime, freq);
    }
}

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

std::string bleRxBuf = "";

class BleCharCB : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pChar, NimBLEConnInfo& connInfo) override {
        NimBLEAttValue val = pChar->getValue();
        if (val.length() > 0) {
            if (val.length() == 7 && val.data()[0] == 0xAA) {
                processPayload((uint8_t*)val.data(), val.length(), 1);
                return;
            }

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
};

class BleServCB : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) override {
        ESP_LOGI(TAG, "BLE Client Connected.");
        lastBleAct = lastHB = millis();
    }
    void onDisconnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo, int reason) override {
        ESP_LOGW(TAG, "BLE Disconnected. Reason: %d", reason);
        bleRxBuf = "";
        NimBLEDevice::startAdvertising();
    }
};

void setup() {
    Serial.begin(115200);
    delay(500);

    ESP_LOGI(TAG, "=== ESP32 RC CAR (PWM-ONLY) BOOTING ===");

    cmdQueue = xQueueCreate(1, sizeof(BinaryCmd));

    xTaskCreatePinnedToCore(motorTask, "MOTOR", 2048, nullptr, 5, &pidTaskHandle, 0);

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

    xTaskCreatePinnedToCore(netTask, "NET", 3072, nullptr, 2, &netTaskHandle, 1);

    ESP_LOGI(TAG, "=== SYSTEM OPERATIONAL (PWM-ONLY) ===");
}

void loop() {
    ws.loop();
    ArduinoOTA.handle();
    vTaskDelay(pdMS_TO_TICKS(1));
}
