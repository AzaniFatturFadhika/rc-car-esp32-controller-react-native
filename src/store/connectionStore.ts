import { create } from 'zustand';
import { connectionManager, ConnectionType, ConnectionStatus } from '../services/ConnectionManager';
import { buildBinaryCommand } from '../services/protocol';

export interface TelemetryData {
  speedL: number;
  speedR: number;
}

interface ConnectionStoreState {
  // Connection states
  connectionType: ConnectionType;
  connectionStatus: ConnectionStatus;
  isAuthenticated: boolean;
  isBinaryProtocol: boolean;
  errorMessage: string | null;
  rssi: number | null;
  
  // Telemetry
  telemetry: TelemetryData;
  
  // Actions
  connectWiFi: (host: string, port: number) => Promise<void>;
  connectBLE: (deviceId: string, deviceName: string) => Promise<void>;
  disconnect: () => void;
  sendCommand: (lx: number, ly: number, rx?: number, ry?: number, dpad?: string) => void;
  clearError: () => void;
}

export const useConnectionStore = create<ConnectionStoreState>((set, get) => ({
  connectionType: 'none',
  connectionStatus: 'disconnected',
  isAuthenticated: false,
  isBinaryProtocol: false,
  errorMessage: null,
  rssi: null,
  telemetry: { speedL: 0, speedR: 0 },

  connectWiFi: async (host, port) => {
    set({ errorMessage: null });
    try {
      await connectionManager.connectWiFi(host, port);
    } catch (error: any) {
      console.warn('WiFi connect error handled in store:', error.message);
    }
  },

  connectBLE: async (deviceId, deviceName) => {
    set({ errorMessage: null });
    try {
      await connectionManager.connectBLE(deviceId, deviceName);
    } catch (error: any) {
      console.warn('BLE connect error handled in store:', error.message);
    }
  },

  disconnect: () => {
    connectionManager.disconnect();
    set({
      connectionType: 'none',
      connectionStatus: 'disconnected',
      isAuthenticated: false,
      isBinaryProtocol: false,
      rssi: null,
      telemetry: { speedL: 0, speedR: 0 }
    });
  },

  sendCommand: (lx, ly, rx = 0, ry = 0, dpad = '') => {
    const { isAuthenticated } = get();
    // Only allow commands if authenticated (or simulated connection)
    if (!isAuthenticated) {
      return;
    }
    
    if (connectionManager.isBinaryProtocol) {
      const binaryCmd = buildBinaryCommand(lx, ly, rx, ry, dpad);
      connectionManager.sendMessage(binaryCmd);
    } else {
      connectionManager.sendMessage({
        type: 'CMD',
        lx: Math.round(lx),
        ly: Math.round(ly),
        rx: Math.round(rx),
        ry: Math.round(ry),
        dpad,
      });
    }
  },

  clearError: () => {
    set({ errorMessage: null });
  }
}));

// Bind connectionManager callbacks to Zustand store set state
connectionManager.onStatusChange = (status, type) => {
  useConnectionStore.setState({
    connectionStatus: status,
    connectionType: type,
    isAuthenticated: connectionManager.isAuthenticated,
    isBinaryProtocol: connectionManager.isBinaryProtocol,
  });
};

connectionManager.onMessage = (message) => {
  if (message.type === 'TELEMETRY' || message.type === 'TEL') {
    const speedL = message.type === 'TEL' ? (message.l ?? 0) : (message.speedL ?? 0);
    const speedR = message.type === 'TEL' ? (message.r ?? 0) : (message.speedR ?? 0);
    useConnectionStore.setState({
      telemetry: {
        speedL,
        speedR,
      }
    });
  }
};

connectionManager.onError = (error) => {
  useConnectionStore.setState({ errorMessage: error });
};

connectionManager.onRssiChange = (rssi) => {
  useConnectionStore.setState({ rssi });
};
