#include <WiFi.h>
#include <WebSocketsServer.h>
#include <NimBLEDevice.h> 
#include <ArduinoJson.h>  
#include "driver/pulse_cnt.h" // API PCNT Modern untuk ESP32 Core 3.x (ESP-IDF 5.x)

// ============================================================
// 1. DEFINISI PIN & KONFIGURASI HARDWARE
// ============================================================
// Motor Driver Pins (L298N / TB6612)
#define ENA 14
#define ENB 13
#define IN1 27
#define IN2 26
#define IN3 25
#define IN4 33

// Encoder Pins (Quadrature)
#define ENC_L_A 18
#define ENC_L_B 19
#define ENC_R_A 21
#define ENC_R_B 22

// PWM Config
const int PWM_FREQ = 2000;       
const int PWM_RESOLUTION = 8;    // 0 - 255

// ============================================================
// 2. KONSTANTA KINEMATIKA & PID (Single Precision 'f')
// ============================================================
const int DEADZONE = 15;         // Deadzone joystick (0-100)
const float SMOOTHING_ALPHA = 0.15f; 
const float MAX_TICKS_PER_SEC = 150.0f; // Kalibrasi: Ticks/detik pada PWM 100%

// PID Gains (Tuning sesuai motor Anda)
const float KP = 1.5f;  
const float KI = 3.0f;  
const float KD = 0.05f; 

// Waktu siklus PID yang DIHARDCODE (Deterministik)
const float DT = 0.020f; // 20ms = 0.02 detik
const TickType_t PID_PERIOD_TICKS = pdMS_TO_TICKS(20);

// ============================================================
// 3. STRUKTUR DATA & PID CONTROLLER
// ============================================================
struct GamepadCommand {
  int lx;
  int ly;
  char dpad[8];
};

struct PIDController {
    float Kp, Ki, Kd;
    float integral, prevMeasurement;
    float outMin, outMax;

    PIDController(float p, float i, float d, float min, float max) 
        : Kp(p), Ki(i), Kd(d), integral(0.0f), prevMeasurement(0.0f), outMin(min), outMax(max) {}

    float compute(float setpoint, float measurement) {
        float error = setpoint - measurement;
        
        // Integrasi dengan Anti-Windup
        integral += error * DT;
        
        // PERBAIKAN: Cegah Division by Zero saat Ki = 0
        if (Ki != 0.0f) {
            integral = constrain(integral, outMin / Ki, outMax / Ki); 
        } else {
            integral = 0.0f; 
        }
        
        // PERBAIKAN: Derivative on Measurement (Mencegah Derivative Kick)
        float derivative = -(measurement - prevMeasurement) / DT; 
        prevMeasurement = measurement; 
        
        float output = (Kp * error) + (Ki * integral) + (Kd * derivative);
        return constrain(output, outMin, outMax);
    }
    
    void reset() { integral = 0.0f; prevMeasurement = 0.0f; }
};

// Global Variables
QueueHandle_t commandQueue;
WebSocketsServer webSocket(81);
NimBLEServer *pServer = NULL;

PIDController pidLeft(KP, KI, KD, -255.0f, 255.0f);
PIDController pidRight(KP, KI, KD, -255.0f, 255.0f);

// PCNT Handles (ESP-IDF 5.x)
pcnt_unit_handle_t pcnt_unit_L = NULL;
pcnt_unit_handle_t pcnt_unit_R = NULL;

// ============================================================
// 4. HARDWARE ENCODER (PCNT - API ESP-IDF 5.x / Core 3.x)
// ============================================================
void setup_pcnt_unit(pcnt_unit_handle_t *unit, int pin_pulse, int pin_ctrl) {
    pcnt_unit_config_t unit_config = {
        .high_limit = 32767,
        .low_limit = -32768,
    };
    pcnt_new_unit(&unit_config, unit);

    // Channel A
    pcnt_chan_config_t chan_A_cfg = {};
    chan_A_cfg.pulse_gpio_num = pin_pulse; // PERBAIKAN: pulse_gpio_num
    chan_A_cfg.ctrl_gpio_num = pin_ctrl;   // PERBAIKAN: ctrl_gpio_num
    pcnt_channel_handle_t chan_A;          // PERBAIKAN: pcnt_channel_handle_t
    pcnt_new_channel(*unit, &chan_A_cfg, &chan_A);
    
    // Channel B
    pcnt_chan_config_t chan_B_cfg = {};
    chan_B_cfg.pulse_gpio_num = pin_ctrl;
    chan_B_cfg.ctrl_gpio_num = pin_pulse;
    pcnt_channel_handle_t chan_B;          // PERBAIKAN: pcnt_channel_handle_t
    pcnt_new_channel(*unit, &chan_B_cfg, &chan_B);

    // Logika Quadrature 4x
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
// 5. DRIVER MOTOR & KINEMATIKA
// ============================================================
void initMotors() {
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  
  // Sintaks Modern ESP32 Core 3.x
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
  // Deadzone
  if (abs(lx) < DEADZONE) lx = 0;
  if (abs(ly) < DEADZONE) ly = 0;

  // Prioritas D-Pad
  if (strlen(dpad) > 0) {
    if (strcmp(dpad, "UP") == 0)        { targetL = 100; targetR = 100; }
    else if (strcmp(dpad, "DOWN") == 0)  { targetL = -100; targetR = -100; }
    else if (strcmp(dpad, "LEFT") == 0)  { targetL = -80; targetR = 80; }
    else if (strcmp(dpad, "RIGHT") == 0) { targetL = 80; targetR = -80; }
    return;
  }

  // Analog Stick (Differential Drive)
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
// 6. TASK CORE 0: REAL-TIME PID CONTROL LOOP
// ============================================================
void motorControlTask(void *pvParameters) {
  initMotors();
  setMotorSpeeds(0.0f, 0.0f);
  
  GamepadCommand receivedCmd;
  unsigned long lastCommandTime = millis();
  const unsigned long WATCHDOG_TIMEOUT = 500;

  float smoothTargetL = 0.0f, smoothTargetR = 0.0f;
  int16_t lastTicksL = 0, lastTicksR = 0;
  TickType_t xLastWakeTime = xTaskGetTickCount();

  while (1) {
    // 1. Cek Queue (Non-blocking)
    if (xQueueReceive(commandQueue, &receivedCmd, 0) == pdTRUE) {
      lastCommandTime = millis();
    }

    // 2. Hitung Target & Watchdog
    int rawTargetL = 0, rawTargetR = 0;
    if (millis() - lastCommandTime < WATCHDOG_TIMEOUT) {
      driveKinematics(receivedCmd.lx, receivedCmd.ly, receivedCmd.dpad, rawTargetL, rawTargetR);
    } else {
      rawTargetL = 0; rawTargetR = 0;
      pidLeft.reset(); pidRight.reset(); 
    }

    // 3. Smoothing (Exponential Moving Average)
    smoothTargetL += (rawTargetL - smoothTargetL) * SMOOTHING_ALPHA;
    smoothTargetR += (rawTargetR - smoothTargetR) * SMOOTHING_ALPHA;
    
    // Snap-to-zero untuk mencegah motor berdengung saat idle
    if (abs(smoothTargetL) < 1.0f) smoothTargetL = 0.0f;
    if (abs(smoothTargetR) < 1.0f) smoothTargetR = 0.0f;

    // 4. Konversi Target (%) ke Setpoint PID (Ticks/detik)
    float setpointL = smoothTargetL * (MAX_TICKS_PER_SEC / 100.0f);
    float setpointR = smoothTargetR * (MAX_TICKS_PER_SEC / 100.0f);

    // 5. Baca Actual Speed dari PCNT (Hardware)
    int32_t currentTicksL = get_pcnt_count(pcnt_unit_L);
    int32_t currentTicksR = get_pcnt_count(pcnt_unit_R);
    
    // PERBAIKAN: Delta int16_t menangani 16-bit wrap-around secara natural
    int16_t deltaL = (int16_t)currentTicksL - lastTicksL;
    int16_t deltaR = (int16_t)currentTicksR - lastTicksR;
    
    float actualSpeedL = (float)deltaL / DT;
    float actualSpeedR = (float)deltaR / DT;
    
    lastTicksL = (int16_t)currentTicksL;
    lastTicksR = (int16_t)currentTicksR;

    // 6. Compute PID & Output ke Motor
    float pwmL = pidLeft.compute(setpointL, actualSpeedL);
    float pwmR = pidRight.compute(setpointR, actualSpeedR);

    setMotorSpeeds(pwmL, pwmR);

    // 7. Tunggu siklus 20ms berikutnya (Menjaga DT tetap eksak)
    vTaskDelayUntil(&xLastWakeTime, PID_PERIOD_TICKS);
  }
}

// ============================================================
// 7. NETWORK INGESTION (Zero-Alloc & JSON v7)
// ============================================================
void parseAndEnqueue(uint8_t* payload, size_t length) {
  JsonDocument doc; // Sintaks ArduinoJson v7
  DeserializationError err = deserializeJson(doc, payload, length);
  
  if (!err) {
    GamepadCommand cmd;
    cmd.lx = doc["LX"] | 0;
    cmd.ly = doc["LY"] | 0;
    const char* dpad = doc["DPAD"] | ""; 
    strlcpy(cmd.dpad, dpad, sizeof(cmd.dpad));
    xQueueOverwrite(commandQueue, &cmd);
  }
}

// ============================================================
// 8. CALLBACKS RADIO (Zero-Heap BLE)
// ============================================================
void webSocketEvent(uint8_t client_num, WStype_t type, uint8_t * payload, size_t length) {
  if (type == WStype_TEXT) {
    parseAndEnqueue(payload, length);
  } else if (type == WStype_DISCONNECTED) {
    GamepadCommand emptyCmd = {0, 0, ""};
    xQueueOverwrite(commandQueue, &emptyCmd);
  }
}

class BleCallbacks: public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pChar) {
    // PERBAIKAN: API NimBLE terbaru mengembalikan objek NimBLEAttValue
    NimBLEAttValue val = pChar->getValue();
    
    if (val.length() > 0) {
      // val.data() mengambil pointer data, val.length() mengambil ukuran
      parseAndEnqueue((uint8_t*)val.data(), val.length());
    }
  }
};

class ServerCallbacks: public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* pServer) {}
  void onDisconnect(NimBLEServer* pServer) {
    GamepadCommand emptyCmd = {0, 0, ""};
    xQueueOverwrite(commandQueue, &emptyCmd);
    NimBLEDevice::startAdvertising(); 
  }
};

// ============================================================
// 9. SETUP & LOOP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500); // Tunggu serial monitor stabil

  // 1. Inisialisasi Queue
  commandQueue = xQueueCreate(1, sizeof(GamepadCommand));

  // 2. Core 0: Real-Time PID Task
  xTaskCreatePinnedToCore(motorControlTask, "MotorPIDTask", 4096, NULL, 5, NULL, 0);

  // 3. Core 1: Network Infrastructure
  WiFi.softAP("ESP32-RC-Car", "12345678");
  Serial.println("WiFi AP Started: ESP32-RC-Car");
  
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);

  // BLE Setup (NimBLE)
  NimBLEDevice::init("ESP32-Gamepad");
  pServer = NimBLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  
  NimBLEService *pService = pServer->createService("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
  NimBLECharacteristic *pRx = pService->createCharacteristic(
                             "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
                             NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
                           );
  pRx->setCallbacks(new BleCallbacks());
  pService->start();
  
  NimBLEDevice::getAdvertising()->start();
  Serial.println("Sistem PID Deterministik & PCNT Aktif!");
}

void loop() {
  // Core 1 hanya fokus mendengarkan WebSocket
  webSocket.loop();
  vTaskDelay(pdMS_TO_TICKS(1));
}