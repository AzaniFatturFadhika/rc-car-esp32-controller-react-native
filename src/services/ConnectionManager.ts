import { BleManager, Device } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { CONFIG, createAuthMessage, createHeartbeatMessage } from './protocol';
import { Buffer } from 'buffer';

export async function requestBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  try {
    if (Platform.Version >= 31) {
      const scanGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        {
          title: "Bluetooth Scan Permission",
          message: "This app needs Bluetooth Scan access to discover your ESP32.",
          buttonNeutral: "Ask Later",
          buttonNegative: "Cancel",
          buttonPositive: "OK",
        }
      );
      const connectGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        {
          title: "Bluetooth Connect Permission",
          message: "This app needs Bluetooth Connect access to connect to your ESP32.",
          buttonNeutral: "Ask Later",
          buttonNegative: "Cancel",
          buttonPositive: "OK",
        }
      );
      const locationGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: "Location Permission",
          message: "Location access is required to scan for Bluetooth devices.",
          buttonNeutral: "Ask Later",
          buttonNegative: "Cancel",
          buttonPositive: "OK",
        }
      );

      return (
        scanGranted === PermissionsAndroid.RESULTS.GRANTED &&
        connectGranted === PermissionsAndroid.RESULTS.GRANTED &&
        locationGranted === PermissionsAndroid.RESULTS.GRANTED
      );
    } else {
      const locationGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: "Location Permission",
          message: "Location access is required to scan for Bluetooth devices.",
          buttonNeutral: "Ask Later",
          buttonNegative: "Cancel",
          buttonPositive: "OK",
        }
      );
      return locationGranted === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch (e) {
    console.error("Failed to request permissions", e);
    return false;
  }
}

export type ConnectionType = 'wifi' | 'ble' | 'none';
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'error';

export class ConnectionManager {
  private ws: WebSocket | null = null;
  private bleManager: BleManager | null = null;
  private bleDevice: Device | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private rssiInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  
  public connectionType: ConnectionType = 'none';
  public connectionStatus: ConnectionStatus = 'disconnected';
  public isAuthenticated: boolean = false;
  public isBleSupported: boolean = false;
  public isSimulatedBLE: boolean = false;
  
  private currentHost: string = '';
  private currentPort: number = 81;
  private currentDeviceId: string = '';
  private currentDeviceName: string = '';
  
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;
  private reconnectDelays = [250, 600, 1100];
  private missedHeartbeats: number = 0;
  private maxMissedHeartbeats: number = 3;

  // Callbacks
  public onMessage?: (message: any) => void;
  public onStatusChange?: (status: ConnectionStatus, type: ConnectionType) => void;
  public onError?: (error: string) => void;
  public onRssiChange?: (rssi: number | null) => void;

  constructor() {
    try {
      this.bleManager = new BleManager();
      this.isBleSupported = true;
    } catch {
      console.log('BLE is not supported on this platform/simulator. BLE will run in simulation mode.');
      this.isBleSupported = false;
    }
  }

  // ==================== WIFI CONNECTION ====================
  async connectWiFi(host: string, port: number, attempt = 0): Promise<void> {
    this.disconnect();
    this.currentHost = host;
    this.currentPort = port;
    this.connectionType = 'wifi';
    this.connectionStatus = attempt > 0 ? 'reconnecting' : 'connecting';
    this.onStatusChange?.(this.connectionStatus, this.connectionType);
    this.onRssiChange?.(null);

    return new Promise((resolve, reject) => {
      const url = host.startsWith('ws://') || host.startsWith('wss://') 
        ? host 
        : `ws://${host}:${port}`;
      
      console.log(`Connecting WebSocket to: ${url}`);
      
      let connectionTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        if (this.connectionStatus === 'connecting' || this.connectionStatus === 'reconnecting') {
          console.log('WebSocket connection timeout reached');
          if (this.ws) {
            this.ws.onopen = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.onmessage = null;
            this.ws.close();
            this.ws = null;
          }
          if (attempt === 0) {
            this.onError?.(`Connection timeout to ${host}:${port}`);
          }
          this.handleDisconnectOrFailure(reject);
        }
      }, 5000); // 5 seconds connection timeout

      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            connectionTimeout = null;
          }
          console.log('WebSocket connected, authenticating...');
          this.reconnectAttempts = 0;
          this.missedHeartbeats = 0;
          this.connectionStatus = 'authenticating';
          this.onStatusChange?.(this.connectionStatus, this.connectionType);
          
          // Send AUTH token
          this.sendMessage(createAuthMessage());
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleIncomingMessage(event.data);
        };

        this.ws.onerror = (error) => {
          if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            connectionTimeout = null;
          }
          console.log('WebSocket error:', error);
          if (attempt === 0) {
            this.onError?.(`Could not reach ${host}:${port}`);
          }
        };

        this.ws.onclose = (event) => {
          if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            connectionTimeout = null;
          }
          console.log(`WebSocket closed: code=${event.code}, reason=${event.reason}`);
          this.handleDisconnectOrFailure(reject);
        };
      } catch (error) {
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
          connectionTimeout = null;
        }
        console.error('Error creating WebSocket:', error);
        this.handleDisconnectOrFailure(reject);
      }
    });
  }

  // ==================== BLE CONNECTION ====================
  async connectBLE(deviceId: string, deviceName: string, attempt = 0): Promise<void> {
    this.disconnect();
    this.currentDeviceId = deviceId;
    this.currentDeviceName = deviceName || 'ESP32-Gamepad';
    this.connectionType = 'ble';
    this.connectionStatus = attempt > 0 ? 'reconnecting' : 'connecting';
    this.onStatusChange?.(this.connectionStatus, this.connectionType);
    this.onRssiChange?.(null);

    // Simulator fallback / No BLE support
    if (!this.isBleSupported || !deviceId) {
      this.isSimulatedBLE = true;
      console.log('Simulating BLE connection to:', deviceName);
      
      return new Promise((resolve) => {
        this.reconnectTimeout = setTimeout(() => {
          this.connectionStatus = 'authenticating';
          this.onStatusChange?.(this.connectionStatus, this.connectionType);
          this.onRssiChange?.(-65);
          
          this.reconnectTimeout = setTimeout(() => {
            this.isAuthenticated = true;
            this.connectionStatus = 'connected';
            this.onStatusChange?.(this.connectionStatus, this.connectionType);
            this.startHeartbeat();
            
            // Poll simulated RSSI
            this.rssiInterval = setInterval(() => {
              const simRssi = -65 + Math.floor(Math.random() * 9) - 4; // -61 to -69
              this.onRssiChange?.(simRssi);
            }, 2000);
            
            resolve();
          }, 500);
        }, 1000);
      });
    }

    this.isSimulatedBLE = false;
    try {
      console.log(`Connecting to BLE device: ${deviceId} (${deviceName})`);
      if (!this.bleManager) {
        throw new Error('BleManager not initialized');
      }

      this.bleDevice = await this.bleManager.connectToDevice(deviceId);
      console.log('BLE connected, discovering services...');
      
      await this.bleDevice.discoverAllServicesAndCharacteristics();
      
      // Setup listener on Nordic UART Service TX characteristic
      this.bleDevice.monitorCharacteristicForService(
        CONFIG.BLE_SERVICE_UUID,
        CONFIG.BLE_TX_UUID,
        (error, characteristic) => {
          if (error) {
            console.error('BLE monitor error:', error);
            this.handleDisconnectOrFailure();
            return;
          }
          if (characteristic?.value) {
            const data = Buffer.from(characteristic.value, 'base64').toString('utf-8');
            this.handleIncomingMessage(data);
          }
        }
      );

      console.log('BLE setup complete, authenticating...');
      this.reconnectAttempts = 0;
      this.missedHeartbeats = 0;
      this.connectionStatus = 'authenticating';
      this.onStatusChange?.(this.connectionStatus, this.connectionType);
      
      // Start RSSI polling
      this.startRssiPolling();

      // Send AUTH with a brief delay (500ms) to ensure notification subscription (CCCD write) is fully completed by the OS
      setTimeout(() => {
        if (this.connectionStatus === 'authenticating' && this.connectionType === 'ble') {
          console.log('Sending BLE AUTH message...');
          this.sendMessage(createAuthMessage());
        }
      }, 500);

    } catch (error) {
      console.error('BLE Connection error:', error);
      if (attempt === 0) {
        this.onError?.(`Failed to connect to BLE device ${deviceName}`);
      }
      this.handleDisconnectOrFailure();
    }
  }

  // ==================== DISCONNECT & RECOVERY ====================
  private handleDisconnectOrFailure(rejectPromise?: (reason?: any) => void) {
    this.stopHeartbeat();
    this.stopRssiPolling();

    // If it's a manual disconnect, just transition to disconnected
    if (this.connectionStatus === 'disconnected') {
      rejectPromise?.(new Error('Connection closed manually'));
      return;
    }

    // Attempt reconnection if under max reconnect attempts
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.reconnectDelays[this.reconnectAttempts] || 1000;
      console.log(`Reconnecting ${this.connectionType} in ${delay}ms (Attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
      
      this.reconnectAttempts++;
      this.connectionStatus = 'reconnecting';
      this.onStatusChange?.(this.connectionStatus, this.connectionType);

      this.reconnectTimeout = setTimeout(() => {
        if (this.connectionType === 'wifi') {
          this.connectWiFi(this.currentHost, this.currentPort, this.reconnectAttempts)
            .catch(() => {});
        } else if (this.connectionType === 'ble') {
          this.connectBLE(this.currentDeviceId, this.currentDeviceName, this.reconnectAttempts)
            .catch(() => {});
        }
      }, delay);
    } else {
      console.log('Max reconnect attempts reached. Transitioning to error state.');
      this.connectionStatus = 'error';
      this.onStatusChange?.(this.connectionStatus, this.connectionType);
      this.onError?.('Connection failed after multiple retries.');
      rejectPromise?.(new Error('Connection failed'));
    }
  }

  // ==================== MESSAGE HANDLING ====================
  private handleIncomingMessage(data: string) {
    try {
      const sanitized = data.replace(/\0/g, '').trim();
      const message = JSON.parse(sanitized);
      if (!message || typeof message !== 'object') return;
      
      // Handle AUTH responses
      if (message.type === 'AUTH_STATUS') {
        if (message.status === 'OK') {
          console.log('Authentication successful!');
          this.isAuthenticated = true;
          this.connectionStatus = 'connected';
          this.onStatusChange?.(this.connectionStatus, this.connectionType);
          this.startHeartbeat();
        } else {
          console.error('Authentication failed on ESP32');
          this.connectionStatus = 'error';
          this.onStatusChange?.(this.connectionStatus, this.connectionType);
          this.onError?.('Authentication failed');
          this.disconnect();
        }
        return;
      }

      // Handle AUTH_REQUIRED
      if (message.type === 'AUTH_REQUIRED') {
        this.sendMessage(createAuthMessage());
        return;
      }

      // Reset missed heartbeats on any valid response
      this.missedHeartbeats = 0;

      // Forward other messages (e.g. TELEMETRY, ACK) to callback
      this.onMessage?.(message);
    } catch {
      // Ignore parse errors from partial/malformed frames
    }
  }

  // ==================== SEND MESSAGE ====================
  sendMessage(message: any): boolean {
    try {
      const data = JSON.stringify(message);
      
      if (this.connectionType === 'wifi') {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(data);
          return true;
        }
        return false;
      } 
      
      if (this.connectionType === 'ble') {
        if (this.isSimulatedBLE) {
          // Log simulated transmissions quietly
          return true;
        }
        
        if (this.bleDevice) {
          const base64Data = Buffer.from(data).toString('base64');
          this.bleDevice.writeCharacteristicWithoutResponseForService(
            CONFIG.BLE_SERVICE_UUID,
            CONFIG.BLE_RX_UUID,
            base64Data
          ).catch((error) => {
            console.warn('BLE write error:', error);
          });
          return true;
        }
        return false;
      }

      return false;
    } catch (err) {
      console.warn('Error sending message:', err);
      return false;
    }
  }

  // ==================== HEARTBEAT ====================
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.connectionStatus !== 'connected') return;

      const sent = this.sendMessage(createHeartbeatMessage());
      if (!sent && !this.isSimulatedBLE) {
        this.missedHeartbeats++;
        if (this.missedHeartbeats >= this.maxMissedHeartbeats) {
          console.warn('Heartbeat limit reached, disconnecting');
          this.handleDisconnectOrFailure();
        }
      }
    }, CONFIG.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ==================== RSSI POLLING ====================
  private startRssiPolling() {
    this.stopRssiPolling();
    if (this.isSimulatedBLE || !this.bleDevice) return;

    this.rssiInterval = setInterval(async () => {
      if (this.connectionStatus !== 'connected' || !this.bleDevice) return;
      try {
        const device = await this.bleDevice.readRSSI();
        this.onRssiChange?.(device.rssi);
      } catch {
        // Safe to ignore transient RSSI read errors
      }
    }, 2000);
  }

  private stopRssiPolling() {
    if (this.rssiInterval) {
      clearInterval(this.rssiInterval);
      this.rssiInterval = null;
    }
  }

  // ==================== DISCONNECT ====================
  disconnect() {
    console.log('ConnectionManager disconnect called');
    this.stopHeartbeat();
    this.stopRssiPolling();
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      // Clear handlers first to avoid onclose triggering reconnect
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    
    if (this.bleDevice) {
      const device = this.bleDevice;
      this.bleDevice = null;
      device.cancelConnection().catch(() => {});
    }
    
    this.connectionType = 'none';
    this.connectionStatus = 'disconnected';
    this.isAuthenticated = false;
    this.isSimulatedBLE = false;
    this.reconnectAttempts = 0;
    this.missedHeartbeats = 0;
    
    this.onStatusChange?.(this.connectionStatus, this.connectionType);
    this.onRssiChange?.(null);
  }

  // ==================== CLEANUP ====================
  destroy() {
    this.disconnect();
  }
}

// Singleton instance
export const connectionManager = new ConnectionManager();
