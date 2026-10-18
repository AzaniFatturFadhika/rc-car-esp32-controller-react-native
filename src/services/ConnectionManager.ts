import { createSocket } from 'react-native-udp';
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
  private udpSocket: any = null;
  private bleManager: BleManager | null = null;
  private bleDevice: Device | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private rssiInterval: ReturnType<typeof setInterval> | null = null;
  private authTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private rxBuffer: string = '';

  public connectionType: ConnectionType = 'none';
  public connectionStatus: ConnectionStatus = 'disconnected';
  public isAuthenticated: boolean = false;
  public isBleSupported: boolean = false;
  public isSimulatedBLE: boolean = false;
  public isBinaryProtocol: boolean = false;

  private currentHost: string = '';
  private currentPort: number = CONFIG.UDP_PORT;

  private currentDeviceId: string = '';
  private currentDeviceName: string = '';

  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;
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

  // ==================== UDP CONNECTION ====================
  async connectUDP(host: string, port: number = CONFIG.UDP_PORT, attempt = 0): Promise<void> {
    this.disconnect();
    this.currentHost = host;
    this.currentPort = port;
    this.connectionType = 'wifi';
    this.connectionStatus = attempt > 0 ? 'reconnecting' : 'connecting';
    this.onStatusChange?.(this.connectionStatus, this.connectionType);
    this.onRssiChange?.(null);

    console.log(`Connecting UDP to ${host}:${port}`);

    const socket = createSocket('udp4');
    this.udpSocket = socket;

    return new Promise((resolve, reject) => {
      const onMessage = (data: Buffer, rinfo: { address: string; port: number }) => {
        const text = data.toString('utf-8');
        console.log(`UDP recv from ${rinfo.address}:${rinfo.port}: ${text}`);
        this.handleIncomingMessage(text);
      };

      const onError = (err: Error) => {
        console.error('UDP socket error:', err);
        if (attempt === 0) {
          this.onError?.(`UDP error: ${err.message}`);
        }
      };

      socket.on('message', onMessage);
      socket.on('error', onError);

      socket.bind(0, () => {
        console.log(`UDP socket bound, sending AUTH to ${host}:${port}`);
        this.connectionStatus = 'authenticating';
        this.onStatusChange?.(this.connectionStatus, this.connectionType);

        // Send AUTH message
        const authMsg = JSON.stringify(createAuthMessage());
        const buf = Buffer.from(authMsg);
        socket.send(buf, 0, buf.length, port, host, (err?: Error) => {
          if (err) {
            console.error('UDP AUTH send error:', err);
            this.handleDisconnectOrFailure(reject);
            return;
          }
          resolve();
        });

        // Auth timeout
        this.authTimeout = setTimeout(() => {
          if (this.connectionStatus === 'authenticating' || this.connectionStatus === 'connecting') {
            console.log('UDP auth timeout reached');
            if (attempt === 0) {
              this.onError?.(`Auth timeout connecting to ${host}:${port}`);
            }
            this.handleDisconnectOrFailure(reject);
          }
        }, CONFIG.UDP_AUTH_TIMEOUT);
      });
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

            this.rssiInterval = setInterval(() => {
              const simRssi = -65 + Math.floor(Math.random() * 9) - 4;
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

      if (Platform.OS === 'android') {
        console.log('Requesting MTU size 512 for Android...');
        await this.bleDevice.requestMTU(512).catch(err => console.warn('MTU request failed:', err));

        console.log('Requesting high connection priority for Android...');
        await this.bleDevice.requestConnectionPriority(1).catch(err => console.warn('Connection priority request failed:', err));
      }

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

      this.startRssiPolling();

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

    if (this.connectionStatus === 'disconnected') {
      rejectPromise?.(new Error('Connection closed manually'));
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = CONFIG.UDP_RECONNECT_DELAYS[this.reconnectAttempts] || 1000;
      console.log(`Reconnecting ${this.connectionType} in ${delay}ms (Attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);

      this.reconnectAttempts++;
      this.connectionStatus = 'reconnecting';
      this.onStatusChange?.(this.connectionStatus, this.connectionType);

      this.reconnectTimeout = setTimeout(() => {
        if (this.connectionType === 'wifi') {
          this.connectUDP(this.currentHost, this.currentPort, this.reconnectAttempts)
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
          (message.type === 'AUTH' && message.ok !== undefined)
        ) {
          if (!this.isBinaryProtocol) {
            console.log('Binary protocol detected from ESP32 payload.');
            this.isBinaryProtocol = true;
            this.onStatusChange?.(this.connectionStatus, this.connectionType);
          }
        } else if (
          message.type === 'AUTH_REQUIRED' ||
          message.type === 'AUTH_STATUS'
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
            if (this.authTimeout) {
              clearTimeout(this.authTimeout);
              this.authTimeout = null;
            }
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

        // Forward other messages to callback
        this.onMessage?.(message);
      } catch (err) {
        console.warn('JSON parse error on buffered string:', err);
      }
    }
  }

  // ==================== SEND MESSAGE ====================
  sendMessage(message: any): boolean {
    try {
      if (this.connectionType === 'wifi') {
        if (!this.udpSocket) return false;

        const isBinary = message instanceof Uint8Array || message instanceof ArrayBuffer;

        if (isBinary) {
          const bytes = message instanceof Uint8Array
            ? message
            : new Uint8Array(message);
          const buf = Buffer.from(bytes);
          this.udpSocket.send(buf, 0, buf.length, this.currentPort, this.currentHost, (err?: Error) => {
            if (err) console.warn('UDP send error:', err);
          });
        } else {
          const data = JSON.stringify(message);
          const buf = Buffer.from(data);
          this.udpSocket.send(buf, 0, buf.length, this.currentPort, this.currentHost, (err?: Error) => {
            if (err) console.warn('UDP send error:', err);
          });
        }
        return true;
      }

      if (this.connectionType === 'ble') {
        if (this.isSimulatedBLE) {
          return true;
        }

        if (this.bleDevice) {
          let base64Data: string;
          const isBinary = message instanceof Uint8Array || message instanceof ArrayBuffer;

          if (isBinary) {
            const bytes = message instanceof Uint8Array
              ? message
              : new Uint8Array(message);
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

    if (this.connectionStatus === 'connected') {
      this.sendMessage(createHeartbeatMessage());
    }

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

    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.udpSocket) {
      try {
        this.udpSocket.removeAllListeners?.('message');
        this.udpSocket.removeAllListeners?.('error');
        this.udpSocket.close();
      } catch (e) {
        console.warn('Error closing UDP socket:', e);
      }
      this.udpSocket = null;
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
