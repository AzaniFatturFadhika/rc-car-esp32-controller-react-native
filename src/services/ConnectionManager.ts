import { BleManager, Device } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { CONFIG, createAuthMessage, createHeartbeatMessage, createBinaryHeartbeatMessage } from './protocol';
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
  private rxBuffer: string = '';
  
  // Simulated telemetry properties
  private simTargetL: number = 0;
  private simTargetR: number = 0;
  private simCurrentL: number = 0;
  private simCurrentR: number = 0;
  private simTelemetryInterval: ReturnType<typeof setInterval> | null = null;
  
  public connectionType: ConnectionType = 'none';
  public connectionStatus: ConnectionStatus = 'disconnected';
  public isAuthenticated: boolean = false;
  public isBleSupported: boolean = false;
  public isSimulatedBLE: boolean = false;
  public isBinaryProtocol: boolean = false;
  
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
            this.startSimulatedTelemetry();
            
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
      
      // Request larger MTU and high connection priority on Android to prevent fragmentation and latency
      if (Platform.OS === 'android') {
        console.log('Requesting MTU size 512 for Android...');
        await this.bleDevice.requestMTU(512).catch(err => console.warn('MTU request failed:', err));

        console.log('Requesting high connection priority for Android...');
        await this.bleDevice.requestConnectionPriority(1).catch(err => console.warn('Connection priority request failed:', err));
      }
      
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

      // Send HB keep-alive and AUTH with a brief delay (150ms) to ensure notification subscription (CCCD write) is fully completed by the OS
      setTimeout(() => {
        if (this.connectionStatus === 'authenticating' && this.connectionType === 'ble') {
          console.log('Sending BLE HB keep-alive and AUTH message...');
          this.sendMessage({ type: 'HB' });
          this.sendMessage(createAuthMessage());
        }
      }, 150);

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
    this.rxBuffer += data.replace(/\0/g, '');

    while (true) {
      const firstBrace = this.rxBuffer.indexOf('{');
      if (firstBrace === -1) {
        this.rxBuffer = '';
        break;
      }

      let depth = 0;
      let matchIdx = -1;
      for (let i = firstBrace; i < this.rxBuffer.length; i++) {
        if (this.rxBuffer[i] === '{') depth++;
        else if (this.rxBuffer[i] === '}') {
          depth--;
          if (depth === 0) {
            matchIdx = i;
            break;
          }
        }
      }

      if (matchIdx === -1) {
        break;
      }

      const jsonStr = this.rxBuffer.substring(firstBrace, matchIdx + 1);
      this.rxBuffer = this.rxBuffer.substring(matchIdx + 1);

      try {
        const message = JSON.parse(jsonStr.trim());
        if (!message || typeof message !== 'object') continue;

        // Auto-detect binary protocol based on message shapes
        if (
          message.type === 'AUTH_REQ' ||
          message.type === 'TEL' ||
          (message.type === 'AUTH' && message.ok !== undefined)
        ) {
          if (!this.isBinaryProtocol) {
            console.log('Binary protocol detected from ESP32 payload.');
            this.isBinaryProtocol = true;
            this.onStatusChange?.(this.connectionStatus, this.connectionType);
          }
        } else if (
          message.type === 'AUTH_REQUIRED' ||
          message.type === 'AUTH_STATUS' ||
          message.type === 'TELEMETRY'
        ) {
          if (this.isBinaryProtocol) {
            console.log('Legacy protocol detected from ESP32 payload.');
            this.isBinaryProtocol = false;
            this.onStatusChange?.(this.connectionStatus, this.connectionType);
          }
        }
        
        // Handle AUTH responses
        if (message.type === 'AUTH_STATUS' || message.type === 'AUTH') {
          const isSuccess = message.type === 'AUTH_STATUS'
            ? message.status === 'OK'
            : message.ok === true;

          if (isSuccess) {
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
          continue;
        }

        // Handle AUTH_REQUIRED
        if (message.type === 'AUTH_REQUIRED' || message.type === 'AUTH_REQ') {
          this.sendMessage(createAuthMessage());
          continue;
        }

        // Reset missed heartbeats on any valid response
        this.missedHeartbeats = 0;

        // Forward other messages (e.g. TELEMETRY, TEL, ACK) to callback
        this.onMessage?.(message);
      } catch (err) {
        console.warn('JSON parse error on buffered string:', err);
      }
    }
  }

  // ==================== SEND MESSAGE ====================
  sendMessage(message: any): boolean {
    try {
      const isBinary = message instanceof ArrayBuffer || ArrayBuffer.isView(message);
      
      if (this.connectionType === 'wifi') {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          if (isBinary) {
            this.ws.send(message);
          } else {
            const data = JSON.stringify(message);
            this.ws.send(data);
          }
          return true;
        }
        return false;
      } 
      
      if (this.connectionType === 'ble') {
        if (this.isSimulatedBLE) {
          // Intercept simulated commands to update simulated telemetry speeds
          if (isBinary) {
            const bytes = message instanceof ArrayBuffer
              ? new Uint8Array(message)
              : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
            
            if (bytes[0] === 0xAA) {
              const lx = bytes[1] > 127 ? bytes[1] - 256 : bytes[1];
              const ly = bytes[2] > 127 ? bytes[2] - 256 : bytes[2];
              const rx = bytes[3] > 127 ? bytes[3] - 256 : bytes[3];
              
              let tL = 0, tR = 0;
              if (rx !== 0) {
                tL = rx; tR = -rx;
              } else if (lx !== 0 || ly !== 0) {
                const fwd = -ly;
                tL = lx > 0 ? fwd : fwd * (100 + lx) / 100;
                tR = lx < 0 ? fwd : fwd * (100 - lx) / 100;
              }
              this.simTargetL = tL * 1.5;
              this.simTargetR = tR * 1.5;
            }
          } else if (message && typeof message === 'object') {
            if (message.type === 'CMD') {
              const lx = message.lx ?? 0;
              const ly = message.ly ?? 0;
              const rx = message.rx ?? 0;
              
              let tL = 0, tR = 0;
              if (rx !== 0) {
                tL = rx; tR = -rx;
              } else if (lx !== 0 || ly !== 0) {
                const fwd = -ly;
                tL = lx > 0 ? fwd : fwd * (100 + lx) / 100;
                tR = lx < 0 ? fwd : fwd * (100 - lx) / 100;
              }
              this.simTargetL = tL * 1.5;
              this.simTargetR = tR * 1.5;
            }
          }
          return true;
        }
        
        if (this.bleDevice) {
          let base64Data: string;
          if (isBinary) {
            const bytes = message instanceof ArrayBuffer
              ? new Uint8Array(message)
              : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
            base64Data = Buffer.from(bytes).toString('base64');
            
            this.bleDevice.writeCharacteristicWithoutResponseForService(
              CONFIG.BLE_SERVICE_UUID,
              CONFIG.BLE_RX_UUID,
              base64Data
            ).catch((error) => {
              console.warn('BLE write error:', error);
            });
          } else {
            const data = JSON.stringify(message);
            base64Data = Buffer.from(data).toString('base64');
            
            // For AUTH messages (which are larger than standard MTU), write with response to ensure it isn't fragmented/truncated.
            if (message.type === 'AUTH') {
              this.bleDevice.writeCharacteristicWithResponseForService(
                CONFIG.BLE_SERVICE_UUID,
                CONFIG.BLE_RX_UUID,
                base64Data
              ).catch((error) => {
                console.warn('BLE write with response (AUTH) error:', error);
              });
            } else {
              this.bleDevice.writeCharacteristicWithoutResponseForService(
                CONFIG.BLE_SERVICE_UUID,
                CONFIG.BLE_RX_UUID,
                base64Data
              ).catch((error) => {
                console.warn('BLE write error:', error);
              });
            }
          }
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

    // Send an immediate heartbeat to keep the watchdog fresh
    if (this.connectionStatus === 'connected') {
      const hbMsg = this.isBinaryProtocol
        ? createBinaryHeartbeatMessage()
        : createHeartbeatMessage();
      this.sendMessage(hbMsg);
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.connectionStatus !== 'connected') return;

      const hbMsg = this.isBinaryProtocol
        ? createBinaryHeartbeatMessage()
        : createHeartbeatMessage();

      const sent = this.sendMessage(hbMsg);
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

  // ==================== SIMULATED TELEMETRY ====================
  private startSimulatedTelemetry() {
    this.stopSimulatedTelemetry();
    this.simTargetL = 0;
    this.simTargetR = 0;
    this.simCurrentL = 0;
    this.simCurrentR = 0;

    this.simTelemetryInterval = setInterval(() => {
      // Smoothly interpolate current speeds to target speeds
      this.simCurrentL += (this.simTargetL - this.simCurrentL) * 0.25;
      this.simCurrentR += (this.simTargetR - this.simCurrentR) * 0.25;

      // Add a tiny bit of noise/jitter when moving to look realistic
      const jitterL = Math.abs(this.simCurrentL) > 2 ? (Math.random() - 0.5) * 4 : 0;
      const jitterR = Math.abs(this.simCurrentR) > 2 ? (Math.random() - 0.5) * 4 : 0;

      this.onMessage?.({
        type: 'TEL',
        l: Math.round(this.simCurrentL + jitterL),
        r: Math.round(this.simCurrentR + jitterR),
      });
    }, 100);
  }

  private stopSimulatedTelemetry() {
    if (this.simTelemetryInterval) {
      clearInterval(this.simTelemetryInterval);
      this.simTelemetryInterval = null;
    }
  }

  // ==================== DISCONNECT ====================
  disconnect() {
    console.log('ConnectionManager disconnect called');
    this.stopHeartbeat();
    this.stopRssiPolling();
    this.stopSimulatedTelemetry();
    
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
    this.isBinaryProtocol = false;
    this.reconnectAttempts = 0;
    this.missedHeartbeats = 0;
    this.rxBuffer = '';
    
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
