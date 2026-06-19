# Changelog

All notable progress on the ESP32 GamePad Controller app.

## 2026-06-19 — BLE Transport & Multi-Touch Fixes Complete

### Implemented
- **Bluetooth BLE Transport** — Fully integrated `react-native-ble-manager` with support for scanning, device listing, connection, and services retrieval.
- **Unified Gamepad Transport** — Refactored Wi-Fi and BLE modes behind a shared hook (`useGamepadTransport`) supporting state indicators, heartbeat, and reconnection logic.
- **BLE keepalive & RSSI polling** — RSSI checks every 2s with UI warnings for signal quality (< -80 dBm).
- **Emulator / BLE Simulation Mode** — Simulator fallback when running on Expo Go or devices without native BLE, printing payloads and simulating signal quality.
- **Automatic Android Permissions** — Automated scanning, connection, and location permission requests on Android API 31+.
- **Touch state cleanup** — Added cleanup mechanisms to prevent stuck inputs when disabling gamepad controls or opening panels.
- **Unit Testing Suite** — Restructured and added 14 unit tests covering hooks and components under React 19 testing library, setting up native Worklets/Reanimated mock bypasses.

### Fixed
- Fixed missing native module crash on `NativeEventEmitter` initialization when BLE is unavailable or mocked.
- Removed premature disconnect trigger from throttled BLE write-without-response failures.
- Fixed properties typing bug in `ConnectionStatusBar` unit tests.
- Downgraded `@react-native/jest-preset` to resolve dependency conflicts.

## 2026-06-18 — Wi-Fi MVP Complete

### Implemented
- **Landscape gamepad layout** — 3-panel (Left/Center/Right) full-screen controller
- **Analog sticks** — PanResponder-based with radius clamp and 5% deadzone
- **D-Pad** — 4-direction with arrow labels (▲◄►▼)
- **Action buttons** — A (green), B (red), X (blue), Y (yellow) with color variants
- **Shoulder buttons** — LT/RT/LB/RB with shoulder variant styling
- **Stick clicks** — LS/RS buttons below each analog stick
- **WebSocket transport** — connect, throttle (16ms), heartbeat (1s), auto-reconnect (3×)
- **Connection settings** — host/port modal with validation, persisted via AsyncStorage
- **Connection status bar** — colored dot, label, address display
- **Pulse animation** — Reanimated opacity pulse on connecting/reconnecting states
- **Session timer** — MM:SS counter while connected
- **VIEW button** — toggles payload debug strip visibility
- **MENU button** — opens settings sheet
- **Keep-awake** — screen stays on while connected
- **Haptics** — light impact feedback on button press

### Fixed
- D-Pad labels no longer collide with shoulder button names (was LT/RT, now ◄/►)
- VIEW/MENU buttons no longer incorrectly dispatch LS/RS gamepad inputs
- PanResponder ESLint compatibility with React Compiler (useState lazy init pattern)
- WebSocket `openSocket` circular dependency (useEffect ref sync pattern)
- Removed dead `settingsRef` code from transport hook

### Cleaned Up
- Deleted 17 orphaned starter template files (explore.tsx, app-tabs, animated-icon, themed-text/view, use-color-scheme, use-theme, global.css, theme.ts, etc.)
- ESLint: 0 errors, 0 warnings on full `src/`
- TypeScript: 0 errors on `tsc --noEmit`
