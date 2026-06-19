# ESP32 GamePad Controller — Progress & Roadmap

> Last updated: 2026-06-19

---

## Current Status: Protocol & BLE Upgrade Refactoring ✅ Complete

The app has been upgraded to align with the new ESP32 firmware protocol, dual-channel communication (WiFi WebSocket + BLE using `react-native-ble-plx`), authentication, keep-alive heartbeats, state management with Zustand, and telemetry support as detailed in [panduan-upgrade.md](file:///home/fadhika/Documents/GitHub/controller-react-native/docs/panduan-upgrade.md).

### ⚠️ Scope Boundaries & Constraints
- **Functionality**: The app functions *strictly* as a remote controller and telemetry display.
- **Hardware Profile**: Designed only for an ESP32 RC car with two motors (Left and Right) and no additional sensors or actuators.
- **No Unnecessary Features**: Advanced features like UDP streaming, custom button remapping, analog stick calibration screens, camera streaming, navigation maps, and OTA firmware updates are excluded from this project.

---

## Codebase Structure

```
src/
├── app/
│   ├── _layout.tsx              # Stack navigator, status bar hidden
│   └── index.tsx                # Main GamePad screen (3-panel layout)
│
├── hooks/
│   └── useMultiTouch.tsx        # Multi-touch gesture dispatcher
│
└── features/gamepad/
    ├── types.ts                 # GamepadState, ButtonId, ConnectionSettings, ConnectionMode
    ├── protocol.ts              # serialize, encode, validate, buildWebSocketUrl
    ├── settings-storage.ts      # AsyncStorage load/save
    ├── use-gamepad-transport.ts # Unified WebSocket & BLE hook (throttle, heartbeat, reconnect)
    ├── gamepad-controls.tsx     # AnalogStick, DigitalButton, DPad (zone registrations)
    ├── connection-status-bar.tsx # Status dot + pulse animation + session timer + RSSI signal
    └── settings-sheet.tsx       # Modal: host/port/BLE scanner, connect/disconnect
```

---

## Completed Features

### Platform & Config
- [x] Landscape-only (`app.json` + runtime lock via `expo-screen-orientation`)
- [x] Dark mode UI
- [x] React Compiler enabled
- [x] Status bar hidden

### Data Layer
- [x] Type definitions: `GamepadState`, `GamepadPayload`, `ConnectionSettings`, `ConnectionStatus`
- [x] JSON payload serialization: `{ LX, LY, RX, RY, BTN, DPAD }`
- [x] Input validation (host/port)
- [x] Axis clamping (−100…100)
- [x] AsyncStorage persistence for connection settings
- [x] Default ESP32 AP settings: `192.168.4.1:81`

### Transport (Wi-Fi WebSocket)
- [x] WebSocket connect / disconnect
- [x] Throttled send (~16ms per frame, ~60fps cap)
- [x] Heartbeat ping every 1 second
- [x] 3 missed heartbeats → auto-disconnect
- [x] Auto-reconnect 3× with backoff (250 → 600 → 1100 ms)
- [x] 5 connection states: disconnected / connecting / connected / reconnecting / error

### Transport (Bluetooth BLE)
- [x] Add `react-native-ble-manager` dependency
- [x] Android permissions: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `ACCESS_FINE_LOCATION` (API 31+ splits)
- [x] iOS permissions: `NSBluetoothAlwaysUsageDescription`
- [x] BLE scanning and discovery in settings sheet (filtering and listing discovered devices)
- [x] BLE connect / pair / retrieve services
- [x] BLE MTU negotiation (request 512 bytes)
- [x] BLE keepalive (poll RSSI every 2 seconds, warn user if RSSI < -80 dBm)
- [x] BLE auto-reconnect 3× with exponential backoff (250ms → 600ms → 1100ms)
- [x] Simulator fallback mode for non-native/emulator testing
- [x] Unified connection driver interface (`useGamepadTransport`) for Wi-Fi and BLE

### UI Controls
- [x] Left & Right Analog Sticks (PanResponder, radius clamp, 5% deadzone)
- [x] D-Pad (4 directions, arrow labels ▲◄►▼)
- [x] Action buttons A/B/X/Y (color-coded: green/red/blue/yellow)
- [x] Shoulder buttons LT/RT/LB/RB
- [x] Stick click buttons LS/RS
- [x] Minimum 44pt touch targets
- [x] Active state visual feedback

### Screen & Layout
- [x] 3-panel landscape layout (Left / Center / Right)
- [x] `useReducer` for gamepad state (minimal re-renders)
- [x] `useMemo` payload serialization
- [x] Keep-awake while connected (`expo-keep-awake`)
- [x] Haptic feedback on button press (`expo-haptics`)
- [x] VIEW button → toggle payload debug strip
- [x] MENU button → open settings sheet

### Connection UI
- [x] Status bar with colored dot + label + ws://address
- [x] Pulse animation on dot (connecting / reconnecting) via Reanimated
- [x] Session timer MM:SS while connected
- [x] Settings sheet (host/port input, validation, connect/disconnect)

### Code Quality
- [x] ESLint `src/` — 0 errors, 0 warnings
- [x] TypeScript `tsc --noEmit` — 0 errors
- [x] No dead code, no orphaned starter files
- [x] React Compiler compatible (all hooks rules satisfied)
- [x] Jest Unit Testing — 14/14 tests passing successfully

---

## Roadmap — Future Phases

### Phase 2: BLE & WiFi Protocol Refactoring (Upgrade Guide) ✅ Complete

Refactor the networking and BLE stack to match the new firmware spec with structured authentication, heartbeat telemetry, and Zustand state.

- [x] Install upgrade dependencies (`zustand`, `@craftzdog/react-native-ble-plx`)
- [x] Configure `@craftzdog/react-native-ble-plx` plugin in `app.json`
- [x] Implement typed JSON protocol schemas (`src/services/protocol.ts`)
- [x] Implement dual-channel `ConnectionManager` (`src/services/ConnectionManager.ts`) using `react-native-ble-plx` and WebSockets
- [x] Implement Zustand state store (`src/store/connectionStore.ts`) to manage connection state and telemetry
- [x] Refactor Gamepad Screen (`src/app/index.tsx`):
  - [x] Add real-time `TelemetryDisplay` component to Center Panel (speedL, speedR, battery)
  - [x] Replace `use-gamepad-transport` with Zustand-backed `ConnectionManager`
  - [x] Update D-Pad, Buttons, and Sticks to dispatch commands via Zustand
- [x] Verify WiFi & BLE auth handshake, keep-alive, RSSI monitoring, and simulated fallback modes

### Phase 3: Polish & UX ✅ Complete

- [x] Toast notification on connection lost / reconnect failed
- [x] Vibration patterns for connect, disconnect, and error feedback

### Phase 4: Build & Deploy

- [ ] EAS Build configuration for Android APK / iOS IPA
- [ ] App icon and splash screen assets

---

## Technical Notes

### ESP32 Protocol
- Outgoing JSON messages:
  - `{"type": "AUTH", "token": "secret123"}`
  - `{"type": "HEARTBEAT"}`
  - `{"type": "CMD", "lx": number, "ly": number, "dpad": string}`
- Incoming JSON messages:
  - `{"type": "TELEMETRY", "speedL": number, "speedR": number, "battery": number, "mode": number}`
  - `{"type": "ACK", "cmd": string, "status": "OK"}`
  - `{"type": "AUTH_REQUIRED"}`
  - `{"type": "AUTH_STATUS", "status": "OK" | "FAILED"}`
- WebSocket port: 81 (configurable)
- ESP32 watchdog: expects packet every 500ms, stops motors on timeout

### Performance Constraints
- Analog throttle: only dispatch if |ΔX| > 5 or |ΔY| > 5
- Network send cap: 1 packet per 16ms (~60fps)
- Each control is `React.memo` — no cascading re-renders
- Latency target: < 50ms touch-to-ESP32

### Key Dependencies
- Expo SDK v56
- `@craftzdog/react-native-ble-plx` (BLE Client)
- `zustand` (State Management)
- `expo-router` (Stack navigation)
- `expo-screen-orientation` (landscape lock)
- `expo-keep-awake` (screen on while connected)
- `expo-haptics` (button feedback)
- `react-native-reanimated` (pulse animation)
- `react-native-gesture-handler` (GestureHandlerRootView)
- `react-native-safe-area-context` (SafeAreaView)
- `@react-native-async-storage/async-storage` (settings persistence)
