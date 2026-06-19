// Tipe pesan dari App ke ESP32
export type OutgoingMessage = 
  | { type: 'AUTH'; token: string }
  | { type: 'HEARTBEAT' }
  | { type: 'CMD'; lx: number; ly: number; rx: number; ry: number; dpad: string };

// Tipe pesan dari ESP32 ke App
export type IncomingMessage =
  | { type: 'TELEMETRY'; speedL: number; speedR: number }
  | { type: 'ACK'; cmd: string; status: string }
  | { type: 'AUTH_REQUIRED' }
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
