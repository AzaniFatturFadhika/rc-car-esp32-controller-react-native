# Controller React Native Agent Instructions

This repository is an Expo SDK v56 React Native app for an ESP32 robot gamepad
controller. Use these instructions for Codex, Claude, and other coding agents
working in this repo.

## Mandatory Expo Rule

Expo has changed. Before writing any code, read the exact versioned docs at:

https://docs.expo.dev/versions/v56.0.0/

Do not rely on memory for Expo APIs, Expo Router behavior, config plugin syntax,
permissions, or SDK package support. Verify the v56 docs first, then code.

## Local Skill

Use the local project skill whenever the task involves developing, debugging,
designing, or extending this app:

- Skill index: `.skills/SKILLS.md`
- Skill body: `.skills/esp32-gamepad-skill/SKILL.md`

Read the skill before changing gamepad UI, touch/gesture logic, networking,
BLE/Wi-Fi communication, protocol payloads, latency behavior, landscape layout,
or ESP32 integration details.

## Project Context

- App type: React Native app built with Expo SDK v56.
- Goal: turn a phone into a virtual gamepad controller for an ESP32-based robot.
- Target platforms: Android and iOS.
- Required orientation: landscape only.
- Latency target: under 50 ms touch-to-ESP32.
- Communication modes: BLE/Bluetooth and Wi-Fi via WebSocket or UDP.
- Main protocol shape: compact JSON with `LX`, `LY`, `RX`, `RY`, `BTN`, and
  `DPAD` fields.

## Implementation Guidelines

- Prefer the existing Expo Router and React Native patterns already present in
  `src/`.
- Keep gamepad controls isolated and memoized where practical; avoid rerendering
  the entire controller on every analog axis update.
- Apply a 5 percent analog deadzone before dispatching or transmitting stick
  updates.
- Cap high-frequency network sends to roughly one packet per frame, around
  16 ms, unless a task explicitly calls for a different strategy.
- Keep connection drivers behind a small abstraction so BLE and Wi-Fi can share
  status, reconnect, heartbeat, and payload formatting behavior.
- Store user-provided ESP32 connection settings instead of hardcoding addresses.
- Clean up timers, socket listeners, BLE listeners, gestures, and keep-awake
  handles in effects.

## Verification

After code changes, run the smallest useful check for the change. Prefer:

- `npm run lint`
- `npx tsc --noEmit` if TypeScript type coverage is relevant
- Expo start/build commands only when needed for the changed surface

If a check cannot run in the current environment, report that clearly.
