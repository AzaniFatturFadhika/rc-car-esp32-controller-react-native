# ESP32 GamePad Controller — Progress & Roadmap

> Last updated: 2026-06-19

---

## Current Status: BLE Transport & Multi-Touch Fixes ✅ Complete

The app is a fully functional landscape gamepad controller that communicates with an ESP32 over either Wi-Fi WebSocket or Bluetooth BLE. All core features are implemented, audited, verified with unit tests (14/14 tests pass), linted, and typechecked.

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

### Phase 2: BLE Transport 🔴 Complete
- [x] Add `react-native-ble-manager` dependency
- [x] Android permissions: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` (API 31+)
- [x] iOS permissions: `NSBluetoothAlwaysUsageDescription`
- [x] BLE scan screen — filter by ESP32 device name / service UUID
- [x] BLE connect / pair — show RSSI, handle bonding
- [x] BLE keepalive — poll RSSI every 2s, warn if < −80 dBm
- [x] Auto-reconnect with exponential backoff (same as Wi-Fi)
- [x] Binary payload format (7 bytes) for BLE 4.x 20-byte limit (Optional / JSON implemented)
- [x] Connection driver abstraction — shared interface for BLE and Wi-Fi
- [x] Connection mode selector UI (BLE vs Wi-Fi)
- [x] Mode label on status bar ("BLE" / "Wi-Fi")

### Phase 3: UDP Transport 🟡 Medium

Add UDP for ultra-low-latency analog stick streaming (fire-and-forget, no ACK).

- [ ] Add `react-native-udp` dependency
- [ ] UDP send for analog stick data (port 8888 default)
- [ ] Split transport: analog via UDP, buttons via WebSocket
- [ ] UDP-specific settings in settings sheet (port config)

### Phase 4: Polish & UX 🟢 Small–Medium

- [ ] Toast notification on connection lost / reconnect failed
- [ ] Button remapping screen (custom mapping, saved to AsyncStorage)
- [ ] Analog stick calibration / testing screen
- [ ] Vibration patterns for different events (connect, disconnect, error)
- [ ] Connection history (recent ESP32 devices)

### Phase 5: Build & Deploy

- [ ] EAS Build configuration for Android APK / iOS IPA
- [ ] App icon and splash screen customization
- [ ] OTA update setup (EAS Update)

---

## Technical Notes

### ESP32 Protocol
- JSON payload: `{ LX, LY, RX, RY, BTN, DPAD }`
- WebSocket port: configurable (default 81)
- UDP port: configurable (default 8888)
- ESP32 watchdog: expects packet every 500ms, stops motors on timeout
- See: `.skills/esp32-gamepad-skill/references/esp32-protocol.md`

### Performance Constraints
- Analog throttle: only dispatch if |ΔX| > 5 or |ΔY| > 5
- Network send cap: 1 packet per 16ms (~60fps)
- Each control is `React.memo` — no cascading re-renders
- Latency target: < 50ms touch-to-ESP32

### Key Dependencies
- Expo SDK v56
- `expo-router` (Stack navigation)
- `expo-screen-orientation` (landscape lock)
- `expo-keep-awake` (screen on while connected)
- `expo-haptics` (button feedback)
- `react-native-reanimated` (pulse animation)
- `react-native-gesture-handler` (GestureHandlerRootView)
- `react-native-safe-area-context` (SafeAreaView)
- `@react-native-async-storage/async-storage` (settings persistence)
