# ESP32 GamePad Controller — Progress & Roadmap

> Last updated: 2026-06-18

---

## Current Status: Wi-Fi MVP ✅ Complete

The app is a fully functional landscape gamepad controller that communicates
with an ESP32 over Wi-Fi WebSocket. All core features are implemented, tested
(lint + tsc clean), and the codebase has zero dead code.

---

## Codebase Structure

```
src/
├── app/
│   ├── _layout.tsx              # Stack navigator, status bar hidden
│   └── index.tsx                # Main GamePad screen (3-panel layout)
│
└── features/gamepad/
    ├── types.ts                 # GamepadState, ButtonId, ConnectionSettings
    ├── protocol.ts              # serialize, encode, validate, buildWebSocketUrl
    ├── settings-storage.ts      # AsyncStorage load/save
    ├── use-wifi-transport.ts    # WebSocket hook (throttle, heartbeat, reconnect)
    ├── gamepad-controls.tsx     # AnalogStick, DigitalButton, DPad
    ├── connection-status-bar.tsx # Status dot + pulse animation + session timer
    └── settings-sheet.tsx       # Modal: host/port input, connect/disconnect
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

---

## Roadmap — Future Phases

### Phase 2: BLE Transport 🔴 Large

Add Bluetooth Low Energy as an alternative transport for cable-free operation
without Wi-Fi dependency.

- [ ] Add `react-native-ble-manager` dependency
- [ ] Android permissions: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` (API 31+)
- [ ] iOS permissions: `NSBluetoothAlwaysUsageDescription`
- [ ] BLE scan screen — filter by ESP32 device name / service UUID
- [ ] BLE connect / pair — show RSSI, handle bonding
- [ ] BLE keepalive — poll RSSI every 2s, warn if < −80 dBm
- [ ] Auto-reconnect with exponential backoff (same as Wi-Fi)
- [ ] Binary payload format (7 bytes) for BLE 4.x 20-byte limit
- [ ] Connection driver abstraction — shared interface for BLE and Wi-Fi
- [ ] Connection mode selector UI (BLE vs Wi-Fi)
- [ ] Mode label on status bar ("BLE" / "Wi-Fi")

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
