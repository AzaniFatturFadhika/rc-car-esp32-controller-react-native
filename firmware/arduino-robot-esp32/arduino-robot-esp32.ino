#include <WiFi.h>
#include <WebSocketsServer.h>
#include <NimBLEDevice.h> 
#include <ArduinoJson.h>  
#include <ArduinoOTA.h>
#include "driver/pulse_cnt.h"

// ============================================================
// 1. DEFINISI PIN & KONFIGURASI HARDWARE
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

#define BATTERY_PIN 34  // ADC pin untuk baca baterai (opsional)

const int PWM_FREQ = 2000;       
const int PWM_RESOLUTION = 8;    

// ============================================================
// 2. KONFIGURASI KOMUNIKASI & KEAMANAN
// ============================================================
const char* WIFI_SSID = "ESP32-RC-Car";
const char* WIFI_PASS = "12345678";
const char* BLE_NAME = "ESP32-Gamepad";
const char* AUTH_TOKEN = "secret123";  // GANTI DENGAN TOKEN UNIK ANDA
const char* OTA_PASSWORD = "ota12345";

// UUIDs (Nordic UART Service)
#define SERVICE_UUID        "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

// Timeouts
const unsigned long WATCHDOG_TIMEOUT = 500;     // Motor stop jika 500ms no CMD
const unsigned long HEARTBEAT_TIMEOUT = 2000;   // Disconnect jika 2s no heartbeat
const unsigned long PRIORITY_SWITCH_TIMEOUT = 5000;  // Auto-switch priority

// ============================================================
// 3. KONSTANTA KINEMATIKA & PID
// ============================================================
const int DEADZONE = 15;         
const float SMOOTHING_ALPHA = 0.15f; 
const float MAX_TICKS_PER_SEC = 150.0f; 

const float KP = 1.5f;  
const float KI = 3.0f;  
const float KD = 0.05f; 

const float DT = 0.020f;
const TickType_t PID_PERIOD_TICKS = pdMS_TO_TICKS(20);

// ============================================================
// 4. STRUKTUR DATA
// ============================================================
struct GamepadCommand {
  int lx;
  int ly;
  char dpad[8];
};

struct TelemetryData {
  float speedL;
  float speedR;
  int batteryPercent;
  uint32_t lastUpdate;
};

enum ConnectionMode { WIFI_ONLY, BLE_ONLY, DUAL_MODE };

struct PIDController {
    float Kp, Ki, Kd;
    float integral, prevMeasurement;
    float outMin, outMax;

    PIDController(float p, float i, float d, float min, float max) 
        : Kp(p), Ki(i), Kd(d), integral(0.0f), prevMeasurement(0.0f), outMin(min), outMax(max) {}

    float compute(float setpoint, float measurement) {
        float error = setpoint - measurement;
        integral += error * DT;
        
        if (Ki != 0.0f) {
            integral = constrain(integral, outMin / Ki, outMax / Ki); 
        } else {
            integral = 0.0f; 
        }
        
        float derivative = -(measurement - prevMeasurement) / DT; 
        prevMeasurement = measurement; 
        
        return constrain((Kp * error) + (Ki * integral) + (Kd * derivative), outMin, outMax);
    }
    
    void reset() { integral = 0.0f; prevMeasurement = 0.0f; }
};

// ============================================================
// 5. GLOBAL VARIABLES
// ============================================================
QueueHandle_t commandQueue;
WebSocketsServer webSocket(81);
NimBLEServer *pServer = NULL;
NimBLECharacteristic *pTxCharacteristic = NULL;

PIDController pidLeft(KP, KI, KD, -255.0f, 255.0f);
PIDController pidRight(KP, KI, KD, -255.0f, 255.0f);

pcnt_unit_handle_t pcnt_unit_L = NULL;
pcnt_unit_handle_t pcnt_unit_R = NULL;

// Telemetry & Connection State
volatile TelemetryData telemetryData = {0};
volatile ConnectionMode activeConnection = DUAL_MODE;
volatile uint32_t lastWifiActivity = 0;
volatile uint32_t lastBleActivity = 0;
volatile unsigned long lastHeartbeat = 0;
bool wsAuthenticated[5] = {false};  // Max 5 WebSocket clients

// ============================================================
// 6. PCNT ENCODER (ESP-IDF 5.x)
// ============================================================
void setup_pcnt_unit(pcnt_unit_handle_t *unit, int pin_pulse, int pin_ctrl) {
    pcnt_unit_config_t unit_config;
    unit_config.low_limit = -32768;
    unit_config.high_limit = 32767;
    pcnt_new_unit(&unit_config, unit);

    pcnt_chan_config_t chan_A_cfg = {};
    chan_A_cfg.edge_gpio_num = pin_pulse; 
    chan_A_cfg.level_gpio_num = pin_ctrl; 
    pcnt_channel_handle_t chan_A; 
    pcnt_new_channel(*unit, &chan_A_cfg, &chan_A);
    
    pcnt_chan_config_t chan_B_cfg = {};
    chan_B_cfg.edge_gpio_num = pin_ctrl;
    chan_B_cfg.level_gpio_num = pin_pulse;
    pcnt_channel_handle_t chan_B; 
    pcnt_new_channel(*unit, &chan_B_cfg, &chan_B);

    pcnt_channel_set_edge_action(chan_A, PCNT_CHANNEL_EDGE_ACTION_INCREASE, PCNT_CHANNEL_EDGE_ACTION_DECREASE);
    pcnt_channel_set_level_action(chan_A, PCNT_CHANNEL_LEVEL_ACTION_KEEP, PCNT_CHANNEL_LEVEL_ACTION_INVERSE);
    
    pcnt_channel_set_edge_action(chan_B, PCNT_CHANNEL_EDGE_ACTION_DECREASE, PCNT_CHANNEL_EDGE_ACTION_INCREASE);
    pcnt_channel_set_level_action(chan_B, PCNT_CHANNEL_LEVEL_ACTION_KEEP, PCNT_CHANNEL_LEVEL_ACTION_INVERSE);

    pcnt_unit_enable(*unit);
    pcnt_unit_clear_count(*unit);
    pcnt_unit_start(*unit);
}

void initEncodersPCNT() {
    setup_pcnt_unit(&pcnt_unit_L, ENC_L_A, ENC_L_B);
    setup_pcnt_unit(&pcnt_unit_R, ENC_R_A, ENC_R_B);
}

int32_t get_pcnt_count(pcnt_unit_handle_t unit) {
    int pulse_count = 0;
    pcnt_unit_get_count(unit, &pulse_count);
    return pulse_count;
}

// ============================================================
// 7. DRIVER MOTOR & KINEMATIKA
// ============================================================
void initMotors() {
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  
  ledcAttach(ENA, PWM_FREQ, PWM_RESOLUTION);
  ledcAttach(ENB, PWM_FREQ, PWM_RESOLUTION);
  
  initEncodersPCNT();
}

void setMotorSpeeds(float pwmL, float pwmR) {
  int dutyL = constrain(abs((int)pwmL), 0, 255);
  int dutyR = constrain(abs((int)pwmR), 0, 255);

  if (pwmL >= 0) { digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW); } 
  else { digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH); }
  ledcWrite(ENA, dutyL);

  if (pwmR >= 0) { digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW); } 
  else { digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH); }
  ledcWrite(ENB, dutyR);
}

void driveKinematics(int lx, int ly, const char* dpad, int &targetL, int &targetR) {
  if (abs(lx) < DEADZONE) lx = 0;
  if (abs(ly) < DEADZONE) ly = 0;

  if (strlen(dpad) > 0) {
    if (strcmp(dpad, "UP") == 0)        { targetL = 100; targetR = 100; }
    else if (strcmp(dpad, "DOWN") == 0)  { targetL = -100; targetR = -100; }
    else if (strcmp(dpad, "LEFT") == 0)  { targetL = -80; targetR = 80; }
    else if (strcmp(dpad, "RIGHT") == 0) { targetL = 80; targetR = -80; }
    return;
  }

  if (lx != 0 || ly != 0) {
    int forward = -ly; 
    int turn = lx;     
    targetL = constrain(forward + turn, -100, 100);
    targetR = constrain(forward - turn, -100, 100);
  } else {
    targetL = 0; targetR = 0;
  }
}

// ============================================================
// 8. COMMUNICATION HELPERS
// ============================================================
void sendToClients(const char* json, size_t len, uint8_t source) {
  if (source == 0 || source == 2) { // WiFi or broadcast
    webSocket.broadcastTXT((uint8_t*)json, len);
  }
  if (source == 1 || source == 2) { // BLE or broadcast
    if (pTxCharacteristic && pServer->getConnectedCount() > 0) {
      pTxCharacteristic->setValue((uint8_t*)json, len);
      pTxCharacteristic->notify();
    }
  }
}

void sendAck(uint8_t source, const char* cmdType, const char* status) {
  JsonDocument doc;
  doc["type"] = "ACK";
  doc["cmd"] = cmdType;
  doc["status"] = status;
  
  char buffer[128];
  size_t len = serializeJson(doc, buffer);
  sendToClients(buffer, len, source);
}

void sendTelemetry() {
  JsonDocument doc;
  doc["type"] = "TELEMETRY";
  doc["speedL"] = telemetryData.speedL;
  doc["speedR"] = telemetryData.speedR;
  doc["battery"] = telemetryData.batteryPercent;
  doc["mode"] = (int)activeConnection;
  
  char buffer[128];
  size_t len = serializeJson(doc, buffer);
  sendToClients(buffer, len, 2); // Broadcast ke semua
}

int readBatteryPercent() {
  // Implementasi sesuai hardware Anda
  // Contoh: analogRead(BATTERY_PIN) dengan voltage divider
  int raw = analogRead(BATTERY_PIN);
  float voltage = raw * (3.3f / 4095.0f) * 2.0f;  // Voltage divider 2x
  // Asumsi baterai LiPo 1S (4.2V full, 3.3V empty)
  int percent = constrain(map(voltage * 100, 330, 420, 0, 100), 0, 100);
  return percent;
}

void updateConnectionPriority() {
  uint32_t now = millis();
  bool wifiActive = (now - lastWifiActivity) < PRIORITY_SWITCH_TIMEOUT;
  bool bleActive = (now - lastBleActivity) < PRIORITY_SWITCH_TIMEOUT;
  
  if (wifiActive && bleActive) {
    activeConnection = DUAL_MODE;
  } else if (wifiActive) {
    activeConnection = WIFI_ONLY;
  } else if (bleActive) {
    activeConnection = BLE_ONLY;
  }
}

void disconnectAllClients() {
  Serial.println("Heartbeat timeout - Disconnecting all clients");
  
  // 1. Disconnect WebSocket Clients
  for (uint8_t i = 0; i < 5; i++) {
    webSocket.disconnect(i);
    wsAuthenticated[i] = false;
  }
  
  // 2. Disconnect BLE Clients (API NimBLE Terbaru)
  if (pServer) {
    // PERBAIKAN: getPeerDevices() v1.4+ TIDAK menerima parameter
    auto peers = pServer->getPeerDevices(); 
    
    // Iterasi dan disconnect setiap connection ID
    for (uint16_t conn_id : peers) {
      pServer->disconnect(conn_id);
    }
  }
}

// ============================================================
// 9. TASK CORE 0: REAL-TIME PID CONTROL LOOP
// ============================================================
void motorControlTask(void *pvParameters) {
  initMotors();
  setMotorSpeeds(0.0f, 0.0f);
  
  GamepadCommand receivedCmd;
  unsigned long lastCommandTime = millis();

  float smoothTargetL = 0.0f, smoothTargetR = 0.0f;
  int16_t lastTicksL = 0, lastTicksR = 0;
  TickType_t xLastWakeTime = xTaskGetTickCount();

  while (1) {
    if (xQueueReceive(commandQueue, &receivedCmd, 0) == pdTRUE) {
      lastCommandTime = millis();
    }

    int rawTargetL = 0, rawTargetR = 0;
    if (millis() - lastCommandTime < WATCHDOG_TIMEOUT) {
      driveKinematics(receivedCmd.lx, receivedCmd.ly, receivedCmd.dpad, rawTargetL, rawTargetR);
    } else {
      rawTargetL = 0; rawTargetR = 0;
      pidLeft.reset(); pidRight.reset(); 
    }

    smoothTargetL += (rawTargetL - smoothTargetL) * SMOOTHING_ALPHA;
    smoothTargetR += (rawTargetR - smoothTargetR) * SMOOTHING_ALPHA;
    
    if (abs(smoothTargetL) < 1.0f) smoothTargetL = 0.0f;
    if (abs(smoothTargetR) < 1.0f) smoothTargetR = 0.0f;

    float setpointL = smoothTargetL * (MAX_TICKS_PER_SEC / 100.0f);
    float setpointR = smoothTargetR * (MAX_TICKS_PER_SEC / 100.0f);

    int32_t currentTicksL = get_pcnt_count(pcnt_unit_L);
    int32_t currentTicksR = get_pcnt_count(pcnt_unit_R);
    
    int16_t deltaL = (int16_t)currentTicksL - lastTicksL;
    int16_t deltaR = (int16_t)currentTicksR - lastTicksR;
    
    float actualSpeedL = (float)deltaL / DT;
    float actualSpeedR = (float)deltaR / DT;
    
    lastTicksL = (int16_t)currentTicksL;
    lastTicksR = (int16_t)currentTicksR;

    // Update telemetry data (thread-safe via volatile)
    telemetryData.speedL = actualSpeedL;
    telemetryData.speedR = actualSpeedR;
    telemetryData.lastUpdate = millis();

    float pwmL = pidLeft.compute(setpointL, actualSpeedL);
    float pwmR = pidRight.compute(setpointR, actualSpeedR);

    setMotorSpeeds(pwmL, pwmR);

    vTaskDelayUntil(&xLastWakeTime, PID_PERIOD_TICKS);
  }
}

// ============================================================
// 10. TASK CORE 1: TELEMETRY & CONNECTION MANAGER
// ============================================================
void telemetryTask(void *pvParameters) {
  TickType_t xLastWakeTime = xTaskGetTickCount();
  const TickType_t xFrequency = pdMS_TO_TICKS(100); // 10Hz
  
  while (1) {
    // Update battery (setiap 1 detik = setiap 10 loop)
    static uint8_t counter = 0;
    if (++counter >= 10) {
      telemetryData.batteryPercent = readBatteryPercent();
      counter = 0;
    }
    
    // Send telemetry
    sendTelemetry();
    
    // Update connection priority
    updateConnectionPriority();
    
    // Check heartbeat timeout
    if (millis() - lastHeartbeat > HEARTBEAT_TIMEOUT && lastHeartbeat > 0) {
      disconnectAllClients();
      lastHeartbeat = 0;
    }
    
    vTaskDelayUntil(&xLastWakeTime, xFrequency);
  }
}

// ============================================================
// 11. NETWORK INGESTION (dengan Schema Validation)
// ============================================================
void parseAndEnqueue(uint8_t* payload, size_t length, uint8_t source) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) {
    Serial.println("JSON parse error");
    return;
  }
  
  const char* type = doc["type"] | "";
  
  // Heartbeat
  if (strcmp(type, "HEARTBEAT") == 0) {
    lastHeartbeat = millis();
    if (source == 0) lastWifiActivity = millis();
    else if (source == 1) lastBleActivity = millis();
    return;
  }
  
  // Command
  if (strcmp(type, "CMD") == 0) {
    // Schema validation
    if (!doc.containsKey("lx") && !doc.containsKey("ly") && !doc.containsKey("dpad")) {
      sendAck(source, "CMD", "ERROR: Missing lx/ly/dpad");
      return;
    }
    
    GamepadCommand cmd;
    cmd.lx = doc["lx"] | 0;
    cmd.ly = doc["ly"] | 0;
    const char* dpad = doc["dpad"] | "";
    strlcpy(cmd.dpad, dpad, sizeof(cmd.dpad));
    
    xQueueOverwrite(commandQueue, &cmd);
    
    // Update activity timestamp
    if (source == 0) lastWifiActivity = millis();
    else if (source == 1) lastBleActivity = millis();
    lastHeartbeat = millis();
    
    return;
  }
  
  // Unknown type
  Serial.printf("Unknown command type: %s\n", type);
}

// ============================================================
// 12. CALLBACKS RADIO (dengan Authentication)
// ============================================================
void webSocketEvent(uint8_t client_num, WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_CONNECTED) {
    wsAuthenticated[client_num] = false;
    webSocket.sendTXT(client_num, "{\"type\":\"AUTH_REQUIRED\"}");
    Serial.printf("WebSocket client %u connected\n", client_num);
  } 
  else if (type == WStype_DISCONNECTED) {
    wsAuthenticated[client_num] = false;
    Serial.printf("WebSocket client %u disconnected\n", client_num);
  }
  else if (type == WStype_TEXT) {
    // Authentication check
    if (!wsAuthenticated[client_num]) {
      JsonDocument doc;
      if (!deserializeJson(doc, payload, length)) {
        if (strcmp(doc["type"] | "", "AUTH") == 0) {
          if (strcmp(doc["token"] | "", AUTH_TOKEN) == 0) {
            wsAuthenticated[client_num] = true;
            webSocket.sendTXT(client_num, "{\"type\":\"AUTH_STATUS\",\"status\":\"OK\"}");
            lastWifiActivity = millis();
            lastHeartbeat = millis();
            Serial.printf("Client %u authenticated\n", client_num);
          } else {
            webSocket.sendTXT(client_num, "{\"type\":\"AUTH_STATUS\",\"status\":\"FAILED\"}");
            webSocket.disconnect(client_num);
          }
        }
      }
      return;
    }
    
    // Process authenticated command
    parseAndEnqueue(payload, length, 0);
  }
}

class BleCallbacks: public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pChar) {
    NimBLEAttValue val = pChar->getValue();
    if (val.length() > 0) {
      parseAndEnqueue((uint8_t*)val.data(), val.length(), 1);
    }
  }
};

class ServerCallbacks: public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* pServer, ble_gap_conn_desc* desc) {
    Serial.println("BLE client connected");
    lastBleActivity = millis();
    lastHeartbeat = millis();
  }
  
  void onDisconnect(NimBLEServer* pServer) {
    Serial.println("BLE client disconnected");
    NimBLEDevice::startAdvertising();
  }
};

// ============================================================
// 13. SETUP & LOOP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  commandQueue = xQueueCreate(1, sizeof(GamepadCommand));

  // Core 0: Real-Time PID Task
  xTaskCreatePinnedToCore(motorControlTask, "MotorPIDTask", 4096, NULL, 5, NULL, 0);

  // Core 1: Network & Telemetry
  WiFi.softAP(WIFI_SSID, WIFI_PASS);
  Serial.printf("WiFi AP Started: %s\n", WIFI_SSID);
  
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);

  // BLE Setup dengan Security
  NimBLEDevice::init(BLE_NAME);
  NimBLEDevice::setSecurityAuth(true, true, true);  // Bonding, MITM, SC
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
  
  pServer = NimBLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  
  NimBLEService *pService = pServer->createService(SERVICE_UUID);
  
  // RX Characteristic
  NimBLECharacteristic *pRx = pService->createCharacteristic(
    CHARACTERISTIC_UUID_RX,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
  );
  pRx->setCallbacks(new BleCallbacks());
  
  // TX Characteristic (untuk telemetry balik)
  pTxCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID_TX,
    NIMBLE_PROPERTY::NOTIFY
  );
  
  pService->start();
  NimBLEDevice::getAdvertising()->start();
  
  // OTA Setup
  ArduinoOTA.setHostname(WIFI_SSID);
  ArduinoOTA.setPassword(OTA_PASSWORD);
  ArduinoOTA.onStart([]() {
    Serial.println("OTA Start - Stopping motors");
    setMotorSpeeds(0, 0);
  });
  ArduinoOTA.begin();
  
  // Telemetry Task (Core 1)
  xTaskCreatePinnedToCore(telemetryTask, "TelemetryTask", 4096, NULL, 2, NULL, 1);

  Serial.println("=== SISTEM PRODUCTION-READY AKTIF ===");
  Serial.printf("Auth Token: %s\n", AUTH_TOKEN);
  Serial.printf("OTA Password: %s\n", OTA_PASSWORD);
}

void loop() {
  webSocket.loop();
  ArduinoOTA.handle();
  vTaskDelay(pdMS_TO_TICKS(1));
}