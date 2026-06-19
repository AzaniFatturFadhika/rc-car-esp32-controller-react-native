#include <WiFi.h>
#include <WebSocketsServer.h>
#include <NimBLEDevice.h> // POIN A: Beralih ke NimBLE (Jauh lebih ringan & stabil di Core 3.x)
#include <ArduinoJson.h>  // POIN B: Pastikan menggunakan ArduinoJson v7

// ============================================================
// DEFINISI & KONFIGURASI HARDWARE
// ============================================================
// Motor Driver Pins
#define ENA 14
#define ENB 13
#define IN1 27
#define IN2 26
#define IN3 25
#define IN4 33

// Encoder Pins (Quadrature Encoders)
#define ENC_L_A 18
#define ENC_L_B 19
#define ENC_R_A 21
#define ENC_R_B 22

// PWM Config
const int PWM_FREQ = 2000;       
const int PWM_RESOLUTION = 8;    // 0 - 255

// Kinematics & Control Config
const int DEADZONE = 15;         // POIN C: Deadzone untuk atasi joystick drift (0-100)
const float SMOOTHING_ALPHA = 0.15; // POIN D: Faktor smoothing (0.0 - 1.0). Lebih kecil = lebih halus tapi lambat respons.
const float MAX_TICKS_PER_SEC = 150.0; // Kalibrasi: Berapa ticks/detik pada PWM 100%? (Sesuaikan dengan motor Anda)

// PID Config (Tuning nilai ini sesuai karakteristik motor Anda)
const float KP = 1.5;  
const float KI = 3.0;  
const float KD = 0.05; 

// ============================================================
// STRUKTUR DATA & PID CONTROLLER
// ============================================================
struct GamepadCommand {
  int lx;
  int ly;
  char dpad[8];
};

// Implementasi PID Controller Manual (Lebih fleksibel & tanpa dependensi library eksternal)
struct PIDController {
    float Kp, Ki, Kd;
    float integral, prevError;
    float outMin, outMax;

    PIDController(float p, float i, float d, float min, float max) 
        : Kp(p), Ki(i), Kd(d), integral(0), prevError(0), outMin(min), outMax(max) {}

    float compute(float setpoint, float measurement, float dt) {
        if (dt <= 0) return 0;
        float error = setpoint - measurement;
        
        // Integrasi dengan Anti-Windup
        integral += error * dt;
        integral = constrain(integral, outMin / Ki, outMax / Ki); 
        
        // Derivatif
        float derivative = (error - prevError) / dt;
        prevError = error;
        
        // Hitung Output
        float output = Kp * error + Ki * integral + Kd * derivative;
        return constrain(output, outMin, outMax);
    }
    
    void reset() { integral = 0; prevError = 0; }
};

// FreeRTOS Queue Handle
QueueHandle_t commandQueue;

// Jaringan & BLE Global
WebSocketsServer webSocket(81);
NimBLEServer *pServer = NULL;

// Variabel Global untuk Encoder & PID
volatile int32_t encoderLeftTicks = 0;
volatile int32_t encoderRightTicks = 0;
PIDController pidLeft(KP, KI, KD, -255, 255);
PIDController pidRight(KP, KI, KD, -255, 255);

// ============================================================
// INTERRUPT SERVICE ROUTINES (ENCODER)
// ============================================================
void IRAM_ATTR readEncoderLeft() {
  // Baca state pin B saat pin A trigger (Rising edge)
  if (digitalRead(ENC_L_A) == digitalRead(ENC_L_B)) encoderLeftTicks++;
  else encoderLeftTicks--;
}

void IRAM_ATTR readEncoderRight() {
  if (digitalRead(ENC_R_A) == digitalRead(ENC_R_B)) encoderRightTicks++;
  else encoderRightTicks--;
}

// ============================================================
// DRIVER MOTOR & KINEMATIKA
// ============================================================
void initMotors() {
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  
  pinMode(ENC_L_A, INPUT_PULLUP); pinMode(ENC_L_B, INPUT_PULLUP);
  pinMode(ENC_R_A, INPUT_PULLUP); pinMode(ENC_R_B, INPUT_PULLUP);

  ledcAttach(ENA, PWM_FREQ, PWM_RESOLUTION);
  ledcAttach(ENB, PWM_FREQ, PWM_RESOLUTION);

  // Attach Interrupts untuk Encoder
  attachInterrupt(digitalPinToInterrupt(ENC_L_A), readEncoderLeft, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_R_A), readEncoderRight, CHANGE);
}

void setMotorSpeeds(float pwmL, float pwmR) {
  int dutyL = constrain(abs(pwmL), 0, 255);
  int dutyR = constrain(abs(pwmR), 0, 255);

  // Motor Kiri
  if (pwmL >= 0) { digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW); } 
  else { digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH); }
  ledcWrite(ENA, dutyL);

  // Motor Kanan
  if (pwmR >= 0) { digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW); } 
  else { digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH); }
  ledcWrite(ENB, dutyR);
}

// POIN C: Implementasi Deadzone di sini
void driveKinematics(int lx, int ly, const char* dpad, int &targetL, int &targetR) {
  // Terapkan Deadzone pada Analog Stick
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
// TASK CORE 0: REAL-TIME PID CONTROL LOOP
// ============================================================
void motorControlTask(void *pvParameters) {
  initMotors();
  setMotorSpeeds(0, 0);
  
  GamepadCommand receivedCmd;
  unsigned long lastCommandTime = millis();
  const unsigned long WATCHDOG_TIMEOUT = 500;

  // Variabel state untuk Smoothing & PID
  float smoothTargetL = 0, smoothTargetR = 0;
  int32_t lastTicksL = 0, lastTicksR = 0;
  
  // Setup Periodic Task (50Hz = setiap 20ms)
  TickType_t xLastWakeTime = xTaskGetTickCount();
  const TickType_t xFrequency = pdMS_TO_TICKS(20); 

  while (1) {
    // 1. Cek Queue (Non-blocking)
    if (xQueueReceive(commandQueue, &receivedCmd, 0) == pdTRUE) {
      lastCommandTime = millis();
    }

    // 2. Hitung Target Kinematika & Watchdog
    int rawTargetL = 0, rawTargetR = 0;
    if (millis() - lastCommandTime < WATCHDOG_TIMEOUT) {
      driveKinematics(receivedCmd.lx, receivedCmd.ly, receivedCmd.dpad, rawTargetL, rawTargetR);
    } else {
      // WATCHDOG: Putus koneksi, paksa berhenti & reset PID
      rawTargetL = 0; rawTargetR = 0;
      pidLeft.reset(); pidRight.reset(); 
    }

    // 3. POIN D: Smoothing (Exponential Moving Average)
    smoothTargetL += (rawTargetL - smoothTargetL) * SMOOTHING_ALPHA;
    smoothTargetR += (rawTargetR - smoothTargetR) * SMOOTHING_ALPHA;

    // 4. Konversi Target (%) ke Setpoint PID (Ticks/detik)
    float setpointL = smoothTargetL * (MAX_TICKS_PER_SEC / 100.0);
    float setpointR = smoothTargetR * (MAX_TICKS_PER_SEC / 100.0);

    // 5. Baca Actual Speed dari Encoder
    unsigned long currentTime = micros();
    static unsigned long lastTime = currentTime;
    float dt = (currentTime - lastTime) / 1000000.0; // dt dalam detik
    lastTime = currentTime;

    // Baca volatile variables (Aman di ESP32 32-bit)
    int32_t currentTicksL = encoderLeftTicks;
    int32_t currentTicksR = encoderRightTicks;
    
    float actualSpeedL = (currentTicksL - lastTicksL) / dt;
    float actualSpeedR = (currentTicksR - lastTicksR) / dt;
    
    lastTicksL = currentTicksL;
    lastTicksR = currentTicksR;

    // 6. Compute PID & Output ke Motor
    float pwmL = pidLeft.compute(setpointL, actualSpeedL, dt);
    float pwmR = pidRight.compute(setpointR, actualSpeedR, dt);

    setMotorSpeeds(pwmL, pwmR);

    // Tunggu hingga siklus 20ms berikutnya (Menjaga dt tetap konstan)
    vTaskDelayUntil(&xLastWakeTime, xFrequency);
  }
}

// ============================================================
// NETWORK INGESTION ENGINE (POIN B: ArduinoJson v7)
// ============================================================
void parseAndEnqueue(uint8_t* payload, size_t length) {
  JsonDocument doc; // Sintaks v7 (Otomatis alokasi stack)
  DeserializationError err = deserializeJson(doc, payload, length);
  
  if (!err) {
    GamepadCommand cmd;
    cmd.lx = doc["LX"] | 0;
    cmd.ly = doc["LY"] | 0;
    
    // Sintaks v7 yang aman untuk string
    const char* dpad = doc["DPAD"] | ""; 
    strlcpy(cmd.dpad, dpad, sizeof(cmd.dpad));
    
    xQueueOverwrite(commandQueue, &cmd);
  }
}

// ============================================================
// CALLBACKS RADIO (WI-FI & NimBLE)
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
    String rx = pChar->getValue();
    if (rx.length() > 0) {
      parseAndEnqueue((uint8_t*)rx.c_str(), rx.length());
    }
  }
};

class ServerCallbacks: public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* pServer) {}
  void onDisconnect(NimBLEServer* pServer) {
    GamepadCommand emptyCmd = {0, 0, ""};
    xQueueOverwrite(commandQueue, &emptyCmd);
    NimBLEDevice::startAdvertising(); // Auto-advertise ulang (Sintaks NimBLE)
  }
};

// ============================================================
// SETUP & LOOP
// ============================================================
void setup() {
  Serial.begin(115200);

  commandQueue = xQueueCreate(1, sizeof(GamepadCommand));

  // Lempar Task Kontrol Motor & PID ke CORE 0
  xTaskCreatePinnedToCore(motorControlTask, "MotorPIDTask", 4096, NULL, 5, NULL, 0);

  // Infrastruktur Radio di Core 1
  WiFi.softAP("ESP32-Robot", "12345678");
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);

  NimBLEDevice::init("ESP32-Gamepad");
  pServer = NimBLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  
  NimBLEService *pService = pServer->createService("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
  NimBLECharacteristic *pRx = pService->createCharacteristic(
                             "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
                             NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR // Sintaks NimBLE
                           );
  pRx->setCallbacks(new BleCallbacks());
  pService->start();
  
  NimBLEAdvertising *pAdvertising = NimBLEDevice::getAdvertising();
  pAdvertising->addServiceUUID("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
  pServer->startAdvertising();

  Serial.println("Arsitektur Dual-Core PID Aktif!");
}

void loop() {
  webSocket.loop();
  vTaskDelay(pdMS_TO_TICKS(1));
}