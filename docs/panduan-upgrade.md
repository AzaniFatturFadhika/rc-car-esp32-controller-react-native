# 📱 Panduan Upgrade React Native Android untuk ESP32 RC Car

Panduan ini akan membantu Anda mengupgrade aplikasi React Native Android agar kompatibel dengan firmware ESP32 terbaru yang menggunakan **protokol terstruktur**, **dual-channel communication**, dan **security features**.

---

## 🎯 Overview Perubahan Firmware

### Protokol Komunikasi Baru
Firmware sekarang menggunakan **typed JSON protocol** untuk membedakan jenis pesan:

```json
// Dari App → ESP32:
{"type": "AUTH", "token": "secret123"}           // Autentikasi
{"type": "HEARTBEAT"}                             // Keep-alive
{"type": "CMD", "lx": 50, "ly": -30, "dpad": ""} // Perintah motor

// Dari ESP32 → App:
{"type": "TELEMETRY", "speedL": 120, "speedR": 118, "battery": 85, "mode": 2}
{"type": "ACK", "cmd": "AUTH", "status": "OK"}
{"type": "AUTH_REQUIRED"}
{"type": "AUTH_STATUS", "status": "OK"}
```

### Dual-Channel Support
- **WiFi WebSocket** (port 81) - Untuk kontrol jarak jauh
- **BLE** (Nordic UART Service) - Untuk kontrol jarak dekat, hemat daya

---

## 📦 Step 1: Install Dependencies

```bash
# WebSocket client
npm install react-native-websocket

# BLE (Pilih salah satu)
npm install react-native-ble-plx
# ATAU
npm install @craftzdog/react-native-ble-plx

# State management (opsional tapi disarankan)
npm install zustand

# Icons untuk UI
npm install react-native-vector-icons
```

### Konfigurasi Android (android/app/build.gradle)
```gradle
android {
    // ... existing config
    
    // Untuk BLE
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }
}

dependencies {
    // ... existing dependencies
    
    // BLE permissions
    implementation 'androidx.core:core:1.7.0'
}
```

### AndroidManifest.xml Permissions
```xml
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />
```

---

## 🔧 Step 2: Buat Service Layer

### `src/services/protocol.ts`
Definisikan semua tipe pesan dan helper functions:

```typescript
// Tipe pesan dari App ke ESP32
export type OutgoingMessage = 
  | { type: 'AUTH'; token: string }
  | { type: 'HEARTBEAT' }
  | { type: 'CMD'; lx: number; ly: number; dpad: string };

// Tipe pesan dari ESP32 ke App
export type IncomingMessage =
  | { type: 'TELEMETRY'; speedL: number; speedR: number; battery: number; mode: number }
  | { type: 'ACK'; cmd: string; status: string }
  | { type: 'AUTH_REQUIRED' }
  | { type: 'AUTH_STATUS'; status: 'OK' | 'FAILED' };

// Konstanta konfigurasi
export const CONFIG = {
  AUTH_TOKEN: 'secret123', // Harus sama dengan firmware
  HEARTBEAT_INTERVAL: 1000, // 1 detik
  WS_URL: 'ws://192.168.4.1:81', // IP default ESP32 SoftAP
  
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

export const createCommandMessage = (lx: number, ly: number, dpad: string = ''): OutgoingMessage => ({
  type: 'CMD',
  lx: Math.round(lx),
  ly: Math.round(ly),
  dpad,
});

// Parser untuk pesan masuk
export const parseIncomingMessage = (data: string): IncomingMessage | null => {
  try {
    const parsed = JSON.parse(data);
    if (parsed.type) {
      return parsed as IncomingMessage;
    }
    return null;
  } catch (error) {
    console.error('Failed to parse message:', error);
    return null;
  }
};
```

---

## 📡 Step 3: Implementasi Connection Manager

### `src/services/ConnectionManager.ts`
Class untuk mengelola koneksi dual-channel:

```typescript
import { BleManager, Device, Characteristic } from 'react-native-ble-plx';
import { CONFIG, createAuthMessage, createHeartbeatMessage } from './protocol';

export type ConnectionType = 'wifi' | 'ble' | 'none';
export type ConnectionState = 'disconnected' | 'connecting' | 'authenticating' | 'connected';

export class ConnectionManager {
  private ws: WebSocket | null = null;
  private bleManager: BleManager;
  private bleDevice: Device | null = null;
  private bleRxCharacteristic: Characteristic | null = null;
  private bleTxCharacteristic: Characteristic | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  
  public connectionType: ConnectionType = 'none';
  public connectionState: ConnectionState = 'disconnected';
  public isAuthenticated: boolean = false;
  
  // Callbacks
  public onMessage?: (data: any) => void;
  public onStateChange?: (state: ConnectionState) => void;
  public onError?: (error: string) => void;

  constructor() {
    this.bleManager = new BleManager();
  }

  // ==================== WIFI CONNECTION ====================
  async connectWiFi(): Promise<void> {
    this.connectionState = 'connecting';
    this.onStateChange?.(this.connectionState);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(CONFIG.WS_URL);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.connectionType = 'wifi';
        this.connectionState = 'authenticating';
        this.onStateChange?.(this.connectionState);
        
        // Kirim AUTH
        this.sendMessage(createAuthMessage());
        resolve();
      };

      this.ws.onmessage = (event) => {
        this.handleIncomingMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.onError?.('WebSocket connection failed');
        this.disconnect();
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        this.disconnect();
      };
    });
  }

  // ==================== BLE CONNECTION ====================
  async connectBLE(): Promise<void> {
    this.connectionState = 'connecting';
    this.onStateChange?.(this.connectionState);

    try {
      // Scan untuk ESP32
      const device = await this.scanForDevice();
      if (!device) {
        throw new Error('ESP32 not found');
      }

      // Connect ke device
      this.bleDevice = await this.bleManager.connectToDevice(device.id);
      
      // Discover services
      await this.bleDevice.discoverAllServicesAndCharacteristics();
      
      // Get characteristics
      this.bleRxCharacteristic = await this.bleDevice.writeCharacteristicWithResponseForService(
        CONFIG.BLE_SERVICE_UUID,
        CONFIG.BLE_RX_UUID,
        '' // Dummy, hanya untuk check existence
      ).catch(() => null);

      this.bleTxCharacteristic = await this.bleDevice.readCharacteristicForService(
        CONFIG.BLE_SERVICE_UUID,
        CONFIG.BLE_TX_UUID
      ).catch(() => null);

      // Subscribe ke TX characteristic untuk terima data
      await this.bleDevice.monitorCharacteristicForService(
        CONFIG.BLE_SERVICE_UUID,
        CONFIG.BLE_TX_UUID,
        (error, characteristic) => {
          if (error) {
            console.error('BLE monitor error:', error);
            return;
          }
          if (characteristic?.value) {
            const data = Buffer.from(characteristic.value, 'base64').toString('utf-8');
            this.handleIncomingMessage(data);
          }
        }
      );

      this.connectionType = 'ble';
      this.connectionState = 'authenticating';
      this.onStateChange?.(this.connectionState);
      
      // Kirim AUTH
      this.sendMessage(createAuthMessage());

    } catch (error) {
      console.error('BLE connection error:', error);
      this.onError?.('BLE connection failed');
      this.disconnect();
      throw error;
    }
  }

  private async scanForDevice(): Promise<Device | null> {
    return new Promise((resolve) => {
      const subscription = this.bleManager.startDeviceScan(
        null,
        null,
        (error, device) => {
          if (error) {
            console.error('Scan error:', error);
            subscription.remove();
            resolve(null);
            return;
          }
          
          if (device?.name === 'ESP32-Gamepad') {
            subscription.remove();
            this.bleManager.stopDeviceScan();
            resolve(device);
          }
        }
      );

      // Timeout setelah 10 detik
      setTimeout(() => {
        subscription.remove();
        this.bleManager.stopDeviceScan();
        resolve(null);
      }, 10000);
    });
  }

  // ==================== MESSAGE HANDLING ====================
  private handleIncomingMessage(data: string) {
    const message = JSON.parse(data);
    
    // Handle AUTH responses
    if (message.type === 'AUTH_STATUS') {
      if (message.status === 'OK') {
        this.isAuthenticated = true;
        this.connectionState = 'connected';
        this.onStateChange?.(this.connectionState);
        this.startHeartbeat();
      } else {
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

    // Forward other messages to callback
    this.onMessage?.(message);
  }

  // ==================== SEND MESSAGE ====================
  sendMessage(message: any) {
    const data = JSON.stringify(message);
    
    if (this.connectionType === 'wifi' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else if (this.connectionType === 'ble' && this.bleDevice) {
      const base64Data = Buffer.from(data).toString('base64');
      this.bleDevice.writeCharacteristicWithResponseForService(
        CONFIG.BLE_SERVICE_UUID,
        CONFIG.BLE_RX_UUID,
        base64Data
      ).catch((error) => {
        console.error('BLE write error:', error);
      });
    }
  }

  // ==================== HEARTBEAT ====================
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.sendMessage(createHeartbeatMessage());
    }, CONFIG.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ==================== DISCONNECT ====================
  disconnect() {
    this.stopHeartbeat();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    if (this.bleDevice) {
      this.bleDevice.cancelConnection().catch(() => {});
      this.bleDevice = null;
    }
    
    this.connectionType = 'none';
    this.connectionState = 'disconnected';
    this.isAuthenticated = false;
    this.onStateChange?.(this.connectionState);
  }

  // ==================== CLEANUP ====================
  destroy() {
    this.disconnect();
    this.bleManager.destroy();
  }
}

// Singleton instance
export const connectionManager = new ConnectionManager();
```

---

## 🎨 Step 4: State Management dengan Zustand

### `src/store/connectionStore.ts`
```typescript
import { create } from 'zustand';
import { connectionManager, ConnectionType, ConnectionState } from '../services/ConnectionManager';

interface TelemetryData {
  speedL: number;
  speedR: number;
  battery: number;
  mode: number;
}

interface ConnectionState {
  // Connection state
  connectionType: ConnectionType;
  connectionState: ConnectionState;
  isAuthenticated: boolean;
  
  // Telemetry
  telemetry: TelemetryData;
  
  // Actions
  connectWiFi: () => Promise<void>;
  connectBLE: () => Promise<void>;
  disconnect: () => void;
  sendCommand: (lx: number, ly: number, dpad?: string) => void;
  
  // Internal
  _updateTelemetry: (data: TelemetryData) => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connectionType: 'none',
  connectionState: 'disconnected',
  isAuthenticated: false,
  telemetry: { speedL: 0, speedR: 0, battery: 0, mode: 0 },

  connectWiFi: async () => {
    try {
      await connectionManager.connectWiFi();
    } catch (error) {
      console.error('WiFi connection failed:', error);
    }
  },

  connectBLE: async () => {
    try {
      await connectionManager.connectBLE();
    } catch (error) {
      console.error('BLE connection failed:', error);
    }
  },

  disconnect: () => {
    connectionManager.disconnect();
    set({
      connectionType: 'none',
      connectionState: 'disconnected',
      isAuthenticated: false,
    });
  },

  sendCommand: (lx, ly, dpad = '') => {
    const { isAuthenticated } = get();
    if (!isAuthenticated) {
      console.warn('Not authenticated, cannot send command');
      return;
    }
    
    connectionManager.sendMessage({
      type: 'CMD',
      lx: Math.round(lx),
      ly: Math.round(ly),
      dpad,
    });
  },

  _updateTelemetry: (data) => {
    set({ telemetry: data });
  },
}));

// Setup connection manager callbacks
connectionManager.onStateChange = (state) => {
  useConnectionStore.setState({
    connectionState: state,
    connectionType: connectionManager.connectionType,
    isAuthenticated: connectionManager.isAuthenticated,
  });
};

connectionManager.onMessage = (message) => {
  if (message.type === 'TELEMETRY') {
    useConnectionStore.getState()._updateTelemetry({
      speedL: message.speedL,
      speedR: message.speedR,
      battery: message.battery,
      mode: message.mode,
    });
  }
};

connectionManager.onError = (error) => {
  console.error('Connection error:', error);
  // Bisa tambahkan notifikasi ke user di sini
};
```

---

## 🎮 Step 5: UI Components

### `src/components/ConnectionPanel.tsx`
Panel untuk memilih koneksi WiFi atau BLE:

```typescript
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useConnectionStore } from '../store/connectionStore';
import Icon from 'react-native-vector-icons/MaterialIcons';

export const ConnectionPanel: React.FC = () => {
  const { connectionState, connectionType, connectWiFi, connectBLE, disconnect } = useConnectionStore();

  const handleConnect = async (type: 'wifi' | 'ble') => {
    try {
      if (type === 'wifi') {
        await connectWiFi();
      } else {
        await connectBLE();
      }
    } catch (error) {
      Alert.alert('Connection Failed', 'Could not connect to ESP32');
    }
  };

  const getStatusColor = () => {
    switch (connectionState) {
      case 'connected': return '#4CAF50';
      case 'connecting':
      case 'authenticating': return '#FFC107';
      default: return '#F44336';
    }
  };

  const getStatusText = () => {
    switch (connectionState) {
      case 'connected': return `Connected (${connectionType.toUpperCase()})`;
      case 'connecting': return 'Connecting...';
      case 'authenticating': return 'Authenticating...';
      default: return 'Disconnected';
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />
        <Text style={styles.statusText}>{getStatusText()}</Text>
      </View>

      {connectionState === 'disconnected' && (
        <View style={styles.buttonRow}>
          <TouchableOpacity 
            style={styles.button} 
            onPress={() => handleConnect('wifi')}
          >
            <Icon name="wifi" size={24} color="#fff" />
            <Text style={styles.buttonText}>WiFi</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.button} 
            onPress={() => handleConnect('ble')}
          >
            <Icon name="bluetooth" size={24} color="#fff" />
            <Text style={styles.buttonText}>BLE</Text>
          </TouchableOpacity>
        </View>
      )}

      {connectionState === 'connected' && (
        <TouchableOpacity 
          style={[styles.button, styles.disconnectButton]} 
          onPress={disconnect}
        >
          <Icon name="power-settings-new" size={24} color="#fff" />
          <Text style={styles.buttonText}>Disconnect</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2196F3',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  disconnectButton: {
    backgroundColor: '#F44336',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
```

### `src/components/TelemetryDisplay.tsx`
Komponen untuk menampilkan data telemetry:

```typescript
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useConnectionStore } from '../store/connectionStore';
import Icon from 'react-native-vector-icons/MaterialIcons';

export const TelemetryDisplay: React.FC = () => {
  const { telemetry, connectionState } = useConnectionStore();

  if (connectionState !== 'connected') {
    return null;
  }

  const getBatteryColor = () => {
    if (telemetry.battery > 60) return '#4CAF50';
    if (telemetry.battery > 30) return '#FFC107';
    return '#F44336';
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Icon name="speed" size={20} color="#2196F3" />
        <Text style={styles.label}>Speed L:</Text>
        <Text style={styles.value}>{telemetry.speedL.toFixed(1)}</Text>
      </View>

      <View style={styles.row}>
        <Icon name="speed" size={20} color="#2196F3" />
        <Text style={styles.label}>Speed R:</Text>
        <Text style={styles.value}>{telemetry.speedR.toFixed(1)}</Text>
      </View>

      <View style={styles.row}>
        <Icon name="battery-full" size={20} color={getBatteryColor()} />
        <Text style={styles.label}>Battery:</Text>
        <Text style={[styles.value, { color: getBatteryColor() }]}>
          {telemetry.battery}%
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
    flex: 1,
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
});
```

### `src/components/JoystickControl.tsx`
Komponen joystick untuk kontrol motor:

```typescript
import React, { useState } from 'react';
import { View, PanResponder, StyleSheet, Dimensions } from 'react-native';
import { useConnectionStore } from '../store/connectionStore';

const JOYSTICK_SIZE = 200;
const KNOB_SIZE = 80;
const MAX_DISTANCE = (JOYSTICK_SIZE - KNOB_SIZE) / 2;

export const JoystickControl: React.FC = () => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const { sendCommand, connectionState } = useConnectionStore();

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt, gestureState) => {
      updatePosition(gestureState.dx, gestureState.dy);
    },
    onPanResponderMove: (evt, gestureState) => {
      updatePosition(gestureState.dx, gestureState.dy);
    },
    onPanResponderRelease: () => {
      // Reset ke tengah
      setPosition({ x: 0, y: 0 });
      sendCommand(0, 0);
    },
  });

  const updatePosition = (dx: number, dy: number) => {
    // Batasi jarak dari tengah
    const distance = Math.sqrt(dx * dx + dy * dy);
    let x = dx;
    let y = dy;
    
    if (distance > MAX_DISTANCE) {
      const ratio = MAX_DISTANCE / distance;
      x = dx * ratio;
      y = dy * ratio;
    }

    setPosition({ x, y });

    // Konversi ke range -100 sampai 100
    const lx = (x / MAX_DISTANCE) * 100;
    const ly = (y / MAX_DISTANCE) * 100;

    // Kirim command jika terhubung
    if (connectionState === 'connected') {
      sendCommand(lx, ly);
    }
  };

  return (
    <View style={styles.container}>
      <View
        style={styles.joystickBase}
        {...panResponder.panHandlers}
      >
        <View
          style={[
            styles.joystickKnob,
            {
              transform: [
                { translateX: position.x },
                { translateY: position.y },
              ],
            },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  joystickBase: {
    width: JOYSTICK_SIZE,
    height: JOYSTICK_SIZE,
    borderRadius: JOYSTICK_SIZE / 2,
    backgroundColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  joystickKnob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: '#2196F3',
  },
});
```

---

## 🎯 Step 6: Main Screen

### `src/screens/ControlScreen.tsx`
Halaman utama untuk kontrol robot:

```typescript
import React, { useEffect } from 'react';
import { View, StyleSheet, SafeAreaView } from 'react-native';
import { ConnectionPanel } from '../components/ConnectionPanel';
import { TelemetryDisplay } from '../components/TelemetryDisplay';
import { JoystickControl } from '../components/JoystickControl';
import { connectionManager } from '../services/ConnectionManager';

export const ControlScreen: React.FC = () => {
  useEffect(() => {
    // Cleanup saat component unmount
    return () => {
      connectionManager.destroy();
    };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <ConnectionPanel />
        <TelemetryDisplay />
        <JoystickControl />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  content: {
    flex: 1,
    padding: 16,
  },
});
```

---

## ✅ Step 7: Testing Checklist

### Functional Testing
- [ ] Koneksi WiFi berhasil
- [ ] Koneksi BLE berhasil
- [ ] Autentikasi berhasil (cek console log)
- [ ] Heartbeat terkirim setiap 1 detik (cek Serial Monitor ESP32)
- [ ] Joystick mengirim command dengan benar
- [ ] Telemetry ditampilkan (speed, battery)
- [ ] Disconnect berfungsi
- [ ] Reconnect setelah disconnect

### Edge Cases
- [ ] ESP32 restart saat terhubung → App harus reconnect otomatis
- [ ] App di-background → Heartbeat tetap jalan
- [ ] Battery low → Warning muncul di UI
- [ ] WiFi/BLE out of range → Error handling yang baik

### Performance
- [ ] Joystick responsif (latency < 50ms)
- [ ] Telemetry update smooth (10Hz)
- [ ] Tidak ada memory leak setelah 10 menit pemakaian

---

## 🔧 Troubleshooting

### Error: "WebSocket connection failed"
**Solusi:**
- Pastikan ESP32 menyala dan WiFi AP aktif
- Cek IP address ESP32 (default: 192.168.4.1)
- Pastikan port 81 tidak diblokir firewall

### Error: "BLE connection failed"
**Solusi:**
- Pastikan Bluetooth HP aktif
- Izinkan location permission (wajib untuk BLE scan di Android)
- Cek nama device ESP32 (harus "ESP32-Gamepad")

### Error: "Authentication failed"
**Solusi:**
- Pastikan `AUTH_TOKEN` di app sama dengan di firmware
- Cek Serial Monitor ESP32 untuk log autentikasi

### Telemetry tidak muncul
**Solusi:**
- Cek apakah `HEARTBEAT` terkirim (harus setiap 1 detik)
- Cek Serial Monitor ESP32, apakah telemetry dikirim
- Pastikan callback `onMessage` di-setup dengan benar

---

## 📚 Next Steps

Setelah implementasi dasar selesai, Anda bisa menambahkan:

1. **D-Pad Control** - Tombol arah diskret (UP, DOWN, LEFT, RIGHT)
2. **Speed Control** - Slider untuk max speed
3. **Camera Streaming** - Jika ESP32 punya kamera
4. **Map/Navigation** - Visualisasi posisi robot
5. **Settings Screen** - Konfigurasi PID, token, dll
6. **OTA Update** - Update firmware dari app

---

Dengan panduan ini, aplikasi React Native Anda sekarang **100% kompatibel** dengan firmware ESP32 terbaru dan siap untuk produksi! 🚀