export type StickState = {
  x: number;
  y: number;
};

export type ActionButtonId = 'A' | 'B' | 'X' | 'Y';
export type ShoulderButtonId = 'LT' | 'RT' | 'LB' | 'RB';
export type StickButtonId = 'LS' | 'RS';
export type ButtonId = ActionButtonId | ShoulderButtonId | StickButtonId;
export type DPadDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export type GamepadState = {
  leftStick: StickState;
  rightStick: StickState;
  buttons: ButtonId[];
  dpad: DPadDirection | null;
};

export type GamepadPayload = {
  LX: number;
  LY: number;
  RX: number;
  RY: number;
  BTN: ButtonId[];
  DPAD: DPadDirection | null;
};

export type ConnectionMode = 'wifi' | 'bluetooth';

export type ConnectionSettings = {
  mode: ConnectionMode;
  host: string;
  port: number;
  deviceId: string;
  deviceName: string;
};

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export const EMPTY_GAMEPAD_STATE: GamepadState = {
  leftStick: { x: 0, y: 0 },
  rightStick: { x: 0, y: 0 },
  buttons: [],
  dpad: null,
};

export const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings = {
  mode: 'wifi',
  host: '192.168.4.1',
  port: 81,
  deviceId: '',
  deviceName: 'ESP32-Gamepad',
};
