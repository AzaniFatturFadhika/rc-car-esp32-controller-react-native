# ESP32 Protocol & Firmware Reference

## Packet Format (Mobile → ESP32)

### JSON Payload

```json
{
  "LX": 45,
  "LY": -80,
  "RX": 0,
  "RY": 0,
  "BTN": ["A", "LB"],
  "DPAD": "UP"
}
```

### Field Reference

| Field  | Type         | Range      | Notes                                                                                      |
| ------ | ------------ | ---------- | ------------------------------------------------------------------------------------------ |
| `LX`   | int          | −100 … 100 | Left stick horizontal. Positive = right.                                                   |
| `LY`   | int          | −100 … 100 | Left stick vertical. Positive = down (screen).                                             |
| `RX`   | int          | −100 … 100 | Right stick horizontal.                                                                    |
| `RY`   | int          | −100 … 100 | Right stick vertical.                                                                      |
| `BTN`  | string[]     | —          | Active buttons: `"A"`, `"B"`, `"X"`, `"Y"`, `"LT"`, `"RT"`, `"LB"`, `"RB"`, `"LS"`, `"RS"` |
| `DPAD` | string\|null | —          | `"UP"`, `"DOWN"`, `"LEFT"`, `"RIGHT"`, or `null`                                           |

---

## Transport Options

### WebSocket (Recommended for commands)

- ESP32 runs `WebSocketsServer` library (e.g., `arduinoWebSockets` by Links2004).
- Port: configurable, default **81**.
- Client sends text frames (UTF-8 JSON string).
- Server sends ACK or telemetry back (optional).

```cpp
// ESP32 firmware sketch (pseudo)
#include <WebSocketsServer.h>
#include <ArduinoJson.h>

WebSocketsServer webSocket(81);

void webSocketEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_TEXT) {
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, payload);
    if (!err) {
      int lx = doc["LX"] | 0;
      int ly = doc["LY"] | 0;
      const char* dpad = doc["DPAD"] | "";
      // Map lx/ly → PWM motor values, dpad → discrete direction
      applyMotorControl(lx, ly);
      applyDpad(dpad);
    }
  }
}
```

### UDP (Recommended for analog stick streaming)

- ESP32 listens on UDP port (default **8888**).
- No ACK — fire-and-forget for low latency.
- Same JSON payload, sent as raw bytes.

```cpp
#include <WiFiUdp.h>
WiFiUDP udp;
// udp.begin(8888) in setup()
// In loop: read packet → deserializeJson → apply
```

---

## Axis → Motor Mapping (Example)

Left stick controls differential drive (tank steering):

```cpp
void applyMotorControl(int lx, int ly) {
  // Mix: forward/back = LY, rotation = LX
  int left  = constrain(ly - lx, -100, 100);
  int right = constrain(ly + lx, -100, 100);

  // Map -100…100 to PWM range (0…255)
  int leftPwm  = map(abs(left),  0, 100, 0, 255);
  int rightPwm = map(abs(right), 0, 100, 0, 255);

  // Set direction pins + PWM
  digitalWrite(LEFT_DIR,  left  >= 0 ? HIGH : LOW);
  digitalWrite(RIGHT_DIR, right >= 0 ? HIGH : LOW);
  analogWrite(LEFT_PWM,  leftPwm);
  analogWrite(RIGHT_PWM, rightPwm);
}
```

Right stick → servo / gimbal:

```cpp
void applyGimbal(int rx, int ry) {
  int panAngle  = map(rx, -100, 100, 0, 180);
  int tiltAngle = map(ry, -100, 100, 0, 180);
  panServo.write(panAngle);
  tiltServo.write(tiltAngle);
}
```

---

## BLE (Alternative Transport)

- ESP32 acts as BLE peripheral with a custom GATT service.
- Recommended service UUID: custom 128-bit UUID agreed with the app.
- Characteristic: writable, max 20 bytes (classic BLE) or 512 bytes (BLE 5 with DLE).
- For compact payloads over BLE, consider a binary format instead of JSON:

```
[1 byte flags][1 byte LX+100][1 byte LY+100][1 byte RX+100][1 byte RY+100][1 byte DPAD][2 bytes BTN bitmask]
```

This fits in 7 bytes — well within the 20-byte BLE 4.x limit with no fragmentation.

### BLE Binary Button Bitmask

| Bit | Button  |
| --- | ------- |
| 0   | A       |
| 1   | B       |
| 2   | X       |
| 3   | Y       |
| 4   | LT      |
| 5   | RT      |
| 6   | LB      |
| 7   | RB      |
| 8   | LS (L3) |
| 9   | RS (R3) |

### DPAD Byte

| Value | Direction |
| ----- | --------- |
| 0     | None      |
| 1     | UP        |
| 2     | DOWN      |
| 3     | LEFT      |
| 4     | RIGHT     |

---

## Heartbeat / Watchdog

ESP32 should implement a software watchdog:

- If no packet received in **500 ms**, treat as disconnected → stop motors.
- Resume on next valid packet.

This prevents the robot from driving away if the phone disconnects unexpectedly.

```cpp
unsigned long lastPacketMs = 0;
const unsigned long WATCHDOG_MS = 500;

void loop() {
  // ...
  if (millis() - lastPacketMs > WATCHDOG_MS) {
    stopAllMotors();  // Safety halt
  }
}
```

---

## ESP32 Wi-Fi Setup Checklist

1. Connect ESP32 to the same Wi-Fi network as the phone **or** run ESP32 as an AP.
2. Assign a static IP to ESP32 (easier for the app to target).
3. Open firewall/router port for WebSocket (81) and UDP (8888).
4. Print the IP to Serial on boot so you can read it during development.

```cpp
Serial.print("ESP32 IP: ");
Serial.println(WiFi.localIP());
```
