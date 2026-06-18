# Wi-Fi MVP Gamepad Implementation

## Summary
Build the first real app version as a landscape ESP32 gamepad controller. Replace the Expo starter tabs with a full-screen controller, implement local gamepad state and JSON payload generation, add a connection setup sheet, and support Wi-Fi WebSocket sending to ESP32. BLE and UDP are explicitly deferred.

Docs checked for Expo SDK v56: https://docs.expo.dev/versions/v56.0.0/, app config orientation, `expo-screen-orientation`, `expo-keep-awake`, `expo-haptics`, and Async Storage.

## Key Changes
- Replace starter navigation with a single full-screen app surface:
  - Update `_layout.tsx` to remove tab UI and render the controller route directly.
  - Replace `index.tsx` starter content with the gamepad screen.
  - Remove or stop using `explore.tsx` and starter tab components.
- Configure landscape:
  - Set `app.json` `orientation` to `"landscape"`.
  - Add `expo-screen-orientation` and lock `OrientationLock.LANDSCAPE` on mount.
- Add gamepad UI:
  - Left: LT, LB, D-pad, left analog stick.
  - Center: View/settings, status/home, Menu, L3/R3.
  - Right: RT, RB, A/B/X/Y, right analog stick.
  - Use `Pressable` for digital controls and `PanResponder` for analog sticks.
- Add state/protocol layer:
  - Types: `ButtonId`, `DPadDirection`, `StickState`, `GamepadState`, `GamepadPayload`.
  - Serialize payload as `{ LX, LY, RX, RY, BTN, DPAD }`.
  - Apply 5 percent analog deadzone and reset sticks to `0,0` on release.
- Add Wi-Fi WebSocket connection:
  - Settings sheet fields: ESP32 IP/host and port, default port `81`.
  - Persist last-used settings with `@react-native-async-storage/async-storage`.
  - Use native `WebSocket`; no extra WebSocket package.
  - Send payload on state changes while connected, capped to roughly every 16 ms.
  - Heartbeat every 1 second; after 3 missed/failed heartbeats, mark disconnected and attempt reconnect.
- Add device UX:
  - Use `expo-keep-awake` while connected.
  - Use `expo-haptics` light feedback for button press where available.
  - Show connection status: disconnected, connecting, connected, reconnecting, error.

## Public Interfaces
- `GamepadState`: source of truth for sticks, active buttons, D-pad, and connection status.
- `serializeGamepadPayload(state)`: returns the ESP32 JSON payload.
- `createWebSocketTransport(settings)`: connect, disconnect, send payload, heartbeat, reconnect hooks.
- Connection settings shape: `{ host: string; port: number }`.

## Test Plan
- Run `npm run lint`.
- Run `npx tsc --noEmit`.
- Manually verify:
  - App opens directly to landscape gamepad screen.
  - Press/release buttons updates active `BTN`.
  - D-pad allows one active direction and returns `null` on release.
  - Analog sticks clamp to `-100..100`, respect deadzone, and reset on release.
  - Payload preview or logs match ESP32 protocol.
  - WebSocket connects to `ws://host:port`, sends state changes, handles disconnect/reconnect.
  - Settings persist after reload.

## Assumptions
- MVP transport is WebSocket only; UDP and BLE are later phases.
- Default ESP32 WebSocket port is `81`.
- Starter tabs are removed from the user-facing app.
- Dependencies to install via Expo-compatible versions: `expo-screen-orientation`, `expo-keep-awake`, `expo-haptics`, and `@react-native-async-storage/async-storage`.
