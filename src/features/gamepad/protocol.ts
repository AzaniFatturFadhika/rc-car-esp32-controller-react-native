import type { ButtonId, ConnectionSettings, GamepadPayload, GamepadState } from './types';

const BUTTON_ORDER: ButtonId[] = ['A', 'B', 'X', 'Y', 'LT', 'RT', 'LB', 'RB', 'LS', 'RS'];

export function clampAxis(value: number) {
  return Math.max(-100, Math.min(100, Math.round(value)));
}

export function serializeGamepadPayload(state: GamepadState): GamepadPayload {
  const activeButtons = BUTTON_ORDER.filter((button) => state.buttons.includes(button));

  return {
    LX: clampAxis(state.leftStick.x),
    LY: clampAxis(state.leftStick.y),
    RX: clampAxis(state.rightStick.x),
    RY: clampAxis(state.rightStick.y),
    BTN: activeButtons,
    DPAD: state.dpad,
  };
}

export function encodeGamepadPayload(payload: GamepadPayload) {
  return JSON.stringify(payload);
}

export function buildWebSocketUrl(settings: ConnectionSettings) {
  const host = settings.host.trim();
  const hasScheme = host.startsWith('ws://') || host.startsWith('wss://');

  if (hasScheme) {
    return host;
  }

  return `ws://${host}:${settings.port}`;
}

export function validateConnectionSettings(settings: ConnectionSettings) {
  const host = settings.host.trim();
  const port = Number(settings.port);

  if (host.length === 0) {
    return 'Enter an ESP32 host or IP address.';
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 'Port must be a number between 1 and 65535.';
  }

  return null;
}
