---
name: esp32-gamepad-rn
description: >
  AI coding assistant skill for the ESP32 Robot GamePad Controller React Native project.
  Use this skill whenever the user asks about developing, debugging, designing, or extending
  the GamePad Controller app — including tasks like: building analog stick components,
  BLE/Wi-Fi connectivity with ESP32, WebSocket/UDP data transmission, D-pad or action button
  layouts, latency optimisation, auto-reconnect logic, battery-saving state management,
  Expo SDK v56 APIs, or any feature described in the GamePad PRD.
  Also trigger when the user asks about React Native touch events, gesture handlers, landscape
  layouts, or mobile-to-microcontroller communication in this project context.
---

# ESP32 GamePad Controller — React Native Project Skill

## Project Overview

This is a **React Native (Expo SDK v56) mobile app** that turns a smartphone into a virtual
gamepad controller for an **ESP32-based robot**. Communication runs over either
**Bluetooth Low Energy (BLE) / Bluetooth Classic** or **Wi-Fi (WebSocket / UDP)**.

Target platforms: Android & iOS.  
Required layout: **Landscape only**.  
Latency target: **< 50 ms** touch-to-ESP32.

---

## ⚠️ Critical Rule — Always Check Expo Docs First

> **Before writing ANY code**, read the exact versioned Expo docs at:
> **https://docs.expo.dev/versions/v56.0.0/**
>
> Expo APIs change between versions. Do not rely on memory for API names, hook signatures,
> plugin configs, or permissions setup — verify against v56 docs every time.

Key areas to verify in v56 before coding:

- `expo-sensors`, `expo-haptics`, `expo-keep-awake`
- `expo-router` (if routing is used)
- `app.json` / `app.config.js` plugin configuration
- EAS Build config for BLE & network permissions
- `react-native-ble-manager` or `expo-bluetooth` compatibility shims

---

## Architecture

```
[React Native App (Expo v56)]
        │
        ├── UI Layer (Landscape GamePad overlay)
        │     ├── LeftPanel  (D-pad, LT, LB, Left Analog Stick)
        │     ├── CenterPanel (View, Home/Status, Menu, Stick Clicks)
        │     └── RightPanel (A/B/X/Y, RT, RB, Right Analog Stick)
        │
        ├── Input Layer (Touch → State)
        │     ├── Analog Stick (PanResponder / Gesture Handler)
        │     └── Digital Buttons (onPress / onPressIn / onPressOut)
        │
        ├── State Manager (Zustand / useReducer)
        │     └── Deadzone filter: suppress updates < 5% axis change
        │
        └── Communication Layer (Driver abstraction)
              ├── BLE Driver   (react-native-ble-manager)
              └── Wi-Fi Driver (WebSocket / UDP)
```

---

## Gamepad UI Layout

Reference `references/ui-components.md` for detailed component specs.

| Zone   | Components                                    | Data                                                                           |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------ |
| Left   | LT, LB, D-pad (4 dirs), Left Analog Stick     | Stick: X/Y −100…100, D-pad: `"UP"/"DOWN"/"LEFT"/"RIGHT"/null`, buttons: 0 or 1 |
| Center | View, Home (status), Menu, LS Click, RS Click | Mode switcher, session timer, settings                                         |
| Right  | RT, RB, A/B/X/Y buttons, Right Analog Stick   | Stick: X/Y −100…100, buttons: active list                                      |

### Analog Stick Implementation Pattern

Use `PanResponder` (or `react-native-gesture-handler`'s `Pan` gesture) on a circular
track, clamping the knob within radius `R`, then normalise to −100…100:

```ts
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
const toAxis = (delta: number, radius: number) =>
  Math.round(clamp((delta / radius) * 100, -100, 100));
```

Apply a **deadzone** of 5 % (≈ 5 units) before dispatching state changes to reduce
unnecessary renders and BLE/UDP packet floods.

---

## Data Protocol — Payload Format

Every state update is transmitted as a compact JSON packet:

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

- **LX / LY**: Left stick axes, integer −100 to 100.
- **RX / RY**: Right stick axes, integer −100 to 100.
- **BTN**: Array of currently-pressed discrete buttons (empty array = no buttons).
- **DPAD**: Active direction string, or `null` when centred.

For performance-critical analog updates use **UDP** (no ACK overhead).  
For reliable command/button delivery use **WebSocket** (full-duplex, auto-framing).

Reference `references/esp32-protocol.md` for ESP32 firmware parsing notes.

---

## Connectivity Module

### BLE Driver

Library: `react-native-ble-manager`  
Permissions required (declare in `app.json` / `AndroidManifest`):

- Android 12+: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`
- iOS: `NSBluetoothAlwaysUsageDescription`

Required features:

1. **Scan** — filter by ESP32 device name / service UUID.
2. **Connect / Pair** — show RSSI, handle bonding.
3. **Keepalive** — poll RSSI every 2 s; warn user if RSSI < −80 dBm.
4. **Auto-reconnect** — on disconnect, retry with exponential back-off, max 3 attempts in 2 s window.

### Wi-Fi / WebSocket Driver

User inputs: **IP Address** + **Port** of ESP32 server.  
Use `WebSocket` native API (built into RN) or a library like `ws` for advanced options.  
For raw UDP: use `react-native-udp`.

Required features:

1. Input validation for IP/port before connecting.
2. Heartbeat ping every 1 s; treat 3 consecutive timeouts as disconnected.
3. Same auto-reconnect logic as BLE (< 2 s).

### Connection Status UI

- 🔴 Disconnected — grey indicator + "Connect" prompt.
- 🟡 Connecting — animated pulse.
- 🟢 Connected — solid green; show session timer.
- Mode label visible at all times (BLE / Wi-Fi).

---

## Performance & Battery Optimisation

| Concern           | Rule                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- | --- | ------- | --- | -------------------- |
| Analog throttle   | Only dispatch if `                                                                     | ΔX  | > 5`or` | ΔY  | > 5` since last send |
| Render isolation  | Each control is a `React.memo` component; avoid lifting raw axis values to root state  |
| UDP burst control | Cap at one UDP packet per 16 ms (≈ 60 fps max)                                         |
| Screen-on         | Use `expo-keep-awake` `activateKeepAwakeAsync()` while connected                       |
| Haptics           | Light haptic on button press via `expo-haptics` (iOS) / `Vibration` API (Android)      |
| Landscape lock    | Set `orientation: "landscape"` in `app.json` and enforce via `expo-screen-orientation` |

---

## User Flow

1. App opens → **Landscape** layout shown immediately.
2. Menu button (centre) → **Connection Setup sheet** slides up.
3. User selects **BLE** or **Wi-Fi**, enters credentials / selects device.
4. Status indicator turns green → **GamePad active**.
5. All controls send live data to ESP32.
6. Drop in connection → auto-reconnect; if failed, indicator turns red + toast.

---

## Reference Files

- `references/ui-components.md` — Detailed component specs, props, and styling notes.
- `references/esp32-protocol.md` — ESP32-side parsing guide and example firmware snippets.

Read these files when you need deep detail on a specific area rather than loading them all upfront.

---

## Common Pitfalls to Avoid

- **Don't use deprecated Expo APIs** — always verify in v56 docs before use.
- **Don't render the full gamepad state in a single component** — will cause full re-renders on every axis tick.
- **Don't forget Android BLE permissions split in API 31+** — the old `BLUETOOTH` / `BLUETOOTH_ADMIN` permissions are insufficient.
- **Don't use `setInterval` for UDP heartbeats** — use `useRef` + cleanup in `useEffect` to avoid memory leaks.
- **Don't hardcode ESP32 IP** — persist last-used IP/port with `AsyncStorage` (or `expo-secure-store` if security matters).
