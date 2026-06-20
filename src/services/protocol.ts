// Tipe pesan dari App ke ESP32
export type OutgoingMessage = 
  | { type: 'AUTH'; token: string }
  | { type: 'HEARTBEAT' }
  | { type: 'HB' }
  | { type: 'CMD'; lx: number; ly: number; rx: number; ry: number; dpad: string };

// Tipe pesan dari ESP32 ke App
export type IncomingMessage =
  | { type: 'ACK'; cmd: string; status: string }
  | { type: 'AUTH_REQUIRED' }
  | { type: 'AUTH_REQ' }
  | { type: 'AUTH'; ok: boolean }
  | { type: 'AUTH_STATUS'; status: 'OK' | 'FAILED' };

// Konstanta konfigurasi
export const CONFIG = {
  AUTH_TOKEN: 'secret123', // Harus sama dengan firmware
  HEARTBEAT_INTERVAL: 1000, // 1 detik
  
  // BLE UUIDs (Nordic UART Service)
  BLE_SERVICE_UUID: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  BLE_RX_UUID: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  BLE_TX_UUID: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
};

// Helper untuk membuat pesan
export const createAuthMessage = (): OutgoingMessage => ({
  type: 'AUTH',
  token: CONFIG.AUTH_TOKEN,
});

export const createHeartbeatMessage = (): OutgoingMessage => ({
  type: 'HEARTBEAT',
});

export const createBinaryHeartbeatMessage = () => ({
  type: 'HB' as const,
});

export const createCommandMessage = (
  lx: number,
  ly: number,
  rx: number = 0,
  ry: number = 0,
  dpad: string = ''
): OutgoingMessage => ({
  type: 'CMD',
  lx: Math.round(lx),
  ly: Math.round(ly),
  rx: Math.round(rx),
  ry: Math.round(ry),
  dpad,
});

/**
 * Packs gamepad control state into a 7-byte binary command struct
 * compliant with ESP32 BinaryCmd protocol.
 */
export const buildBinaryCommand = (
  lx: number,
  ly: number,
  rx: number = 0,
  ry: number = 0,
  dpad: string = ''
): Uint8Array => {
  const clamp = (val: number) => Math.max(-100, Math.min(100, Math.round(val)));
  const cLx = clamp(lx);
  const cLy = clamp(ly);
  const cRx = clamp(rx);
  const cRy = clamp(ry);

  // Map D-pad string to uint8: 0=None, 1=Up, 2=Down, 3=Left, 4=Right
  let dpadVal = 0;
  if (dpad === 'UP') dpadVal = 1;
  else if (dpad === 'DOWN') dpadVal = 2;
  else if (dpad === 'LEFT') dpadVal = 3;
  else if (dpad === 'RIGHT') dpadVal = 4;

  const buffer = new ArrayBuffer(7);
  const view = new DataView(buffer);

  view.setUint8(0, 0xAA);  // Header
  view.setInt8(1, cLx);    // Left X
  view.setInt8(2, cLy);    // Left Y
  view.setInt8(3, cRx);    // Right X
  view.setInt8(4, cRy);    // Right Y
  view.setUint8(5, dpadVal); // D-pad

  // XOR Checksum of bytes 0 to 5
  const checksum = (
    0xAA ^
    (cLx & 0xFF) ^
    (cLy & 0xFF) ^
    (cRx & 0xFF) ^
    (cRy & 0xFF) ^
    (dpadVal & 0xFF)
  ) & 0xFF;
  
  view.setUint8(6, checksum);

  return new Uint8Array(buffer);
};

// Parser untuk pesan masuk
export const parseIncomingMessage = (data: string): IncomingMessage | null => {
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === 'object' && parsed.type) {
      return parsed as IncomingMessage;
    }
    return null;
  } catch {
    // Ignore parse errors from malformed frames
    return null;
  }
};

export function validateConnectionSettings(settings: { host: string; port: number }) {
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
