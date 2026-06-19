#include <WiFi.h>
#include <WebSocketsServer.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ArduinoJson.h>

// ============================================================
// KONFIGURASI WI-FI (Access Point)
// ============================================================
const char* AP_SSID     = "ESP32-Robot";
const char* AP_PASSWORD = "12345678"; // Minimal 8 karakter
const int WS_PORT = 81;

// ============================================================
// KONFIGURASI BLUETOOTH BLE (Nordic UART Service)
// ============================================================
#define BLE_DEVICE_NAME        "ESP32-Gamepad"
#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e" // NUS Service
#define RX_CHARACTERISTIC_UUID "6e400002-b5a3-f393-e0a9-e50e24dcca9e" // Writable (Phone to Robot)

// ============================================================
// KONFIGURASI MOTOR PINS (L298N)
// ============================================================
#define ENA 14
#define ENB 13
#define IN1 27
#define IN2 26
#define IN3 25
#define IN4 33

const unsigned long WATCHDOG_TIMEOUT_MS = 500;

// ============================================================
// VARIABEL GLOBAL
// ============================================================
WebSocketsServer webSocket(WS_PORT);
BLEServer *pServer = NULL;
bool wifiClientConnected = false;
bool bleClientConnected = false;
unsigned long lastPacketMs = 0;

// ============================================================
// FUNGSI MOTOR
// ============================================================
void setupMotors() {
  pinMode(ENA, OUTPUT);
  pinMode(ENB, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
}

// Fungsi dasar motor dengan input kecepatan PWM (-255 s/d 255)
void setMotor(int speedL, int speedR) {
  // Motor Kiri
  if (speedL >= 0) {
    digitalWrite(IN1, HIGH);
    digitalWrite(IN2, LOW);
    analogWrite(ENA, speedL);
  } else {
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, HIGH);
    analogWrite(ENA, abs(speedL));
  }

  // Motor Kanan
  if (speedR >= 0) {
    digitalWrite(IN3, HIGH);
    digitalWrite(IN4, LOW);
    analogWrite(ENB, speedR);
  } else {
    digitalWrite(IN3, LOW);
    digitalWrite(IN4, HIGH);
    analogWrite(ENB, abs(speedR));
  }
}

void applyMotorControl(int lx, int ly) {
  // Differential drive (tank steering):
  // LY = maju/mundur (karena di layar negatif = atas, maka kita invert)
  // LX = belok kiri/kanan (positif = kanan)
  int forward = -ly; 
  int turn = lx;     
  
  int leftSpeed  = constrain(forward + turn, -100, 100);
  int rightSpeed = constrain(forward - turn, -100, 100);

  // Konversi -100...100 ke PWM -255...255
  int leftPwm  = map(leftSpeed,  -100, 100, -255, 255);
  int rightPwm = map(rightSpeed, -100, 100, -255, 255);

  setMotor(leftPwm, rightPwm);
}

void stopAllMotors() {
  setMotor(0, 0);
}

// ============================================================
// HANDLER D-PAD (Gerak diskret)
// ============================================================
void applyDpad(const char* dpad) {
  if (strcmp(dpad, "UP") == 0) {
    setMotor(255, 255);
  } else if (strcmp(dpad, "DOWN") == 0) {
    setMotor(-255, -255);
  } else if (strcmp(dpad, "LEFT") == 0) {
    setMotor(-200, 200);
  } else if (strcmp(dpad, "RIGHT") == 0) {
    setMotor(200, -200);
  }
}

// ============================================================
// PARSER PAYLOAD GAMEPAD UNTUK WI-FI & BLE
// ============================================================
void processGamepadCommand(uint8_t* payload, size_t length, const char* source) {
  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, payload, length);

  if (err) {
    Serial.printf("[%s] JSON error: %s\n", source, err.c_str());
    return;
  }

  lastPacketMs = millis();

  int lx = doc["LX"] | 0;
  int ly = doc["LY"] | 0;

  // Prioritas 1: Kontrol analog jika stick digerakkan
  if (lx != 0 || ly != 0) {
    applyMotorControl(lx, ly);
  } 
  // Prioritas 2: D-Pad jika stick analog sedang di tengah
  else if (doc.containsKey("DPAD") && !doc["DPAD"].isNull()) {
    const char* dpad = doc["DPAD"];
    applyDpad(dpad);
  } 
  // Jika keduanya tidak disentuh, stop
  else {
    stopAllMotors();
  }
}

// ============================================================
// CALLBACKS WEBSOCKET
// ============================================================
void webSocketEvent(uint8_t clientNum, WStype_t type,
                    uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wifiClientConnected = true;
      Serial.printf("[Wi-Fi WS] Client #%u terhubung\n", clientNum);
      break;

    case WStype_DISCONNECTED:
      wifiClientConnected = false;
      stopAllMotors();
      Serial.printf("[Wi-Fi WS] Client #%u terputus\n", clientNum);
      break;

    case WStype_TEXT:
      processGamepadCommand(payload, length, "Wi-Fi WS");
      break;

    default:
      break;
  }
}

// ============================================================
// CALLBACKS BLUETOOTH BLE
// ============================================================
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      bleClientConnected = true;
      Serial.println("[BLE NUS] Client terhubung");
    };

    void onDisconnect(BLEServer* pServer) {
      bleClientConnected = false;
      stopAllMotors();
      Serial.println("[BLE NUS] Client terputus");
      pServer->getAdvertising()->start(); // Mulai advertising kembali agar bisa di-scan ulang
    }
};

class BleRxCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      String rxValue = pCharacteristic->getValue();
      if (rxValue.length() > 0) {
        processGamepadCommand((uint8_t*)rxValue.c_str(), rxValue.length(), "BLE NUS");
      }
    }
};

// ============================================================
// SETUP & LOOP
// ============================================================
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== ESP32 Robot Dual-Mode GamePad (Wi-Fi + BLE) ===");

  setupMotors();
  stopAllMotors();

  // 1. Inisialisasi Wi-Fi Access Point & WebSocket
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  Serial.printf("[Wi-Fi] AP aktif: %s\n", AP_SSID);
  Serial.print("[Wi-Fi] ESP32 IP: ");
  Serial.println(WiFi.softAPIP());

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.printf("[Wi-Fi] WebSocket server port: %d\n", WS_PORT);

  // 2. Inisialisasi Bluetooth BLE (NUS Service)
  BLEDevice::init(BLE_DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);
  
  BLECharacteristic *pRxCharacteristic = pService->createCharacteristic(
                                         RX_CHARACTERISTIC_UUID,
                                         BLECharacteristic::PROPERTY_WRITE |
                                         BLECharacteristic::PROPERTY_WRITE_NR
                                       );
  pRxCharacteristic->setCallbacks(new BleRxCallbacks());
  pRxCharacteristic->addDescriptor(new BLE2902());

  pService->start();
  pServer->getAdvertising()->start();
  Serial.printf("[BLE] Server '%s' siap di-scan...\n", BLE_DEVICE_NAME);
}

void loop() {
  webSocket.loop();

  // Watchdog: hentikan motor jika ada client terhubung (Wi-Fi atau BLE) 
  // tetapi tidak menerima paket dalam batas timeout WATCHDOG_TIMEOUT_MS (500ms)
  bool anyClientConnected = wifiClientConnected || bleClientConnected;
  if (anyClientConnected && (millis() - lastPacketMs > WATCHDOG_TIMEOUT_MS)) {
    stopAllMotors();
  }
}