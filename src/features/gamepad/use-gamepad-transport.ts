import { useCallback, useEffect, useRef, useState } from "react";
import { NativeModules, NativeEventEmitter, Platform, PermissionsAndroid } from "react-native";
import { buildWebSocketUrl } from "./protocol";
import type { ConnectionSettings, ConnectionStatus } from "./types";

let BleManager: any = null;
let bleManagerEmitter: any = null;
let isBleAvailable = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BleManager = require("react-native-ble-manager").default;
  if (BleManager && typeof BleManager.start === "function") {
    const BleManagerModule = NativeModules.BleManager;
    bleManagerEmitter = new NativeEventEmitter(BleManagerModule);
    BleManager.start({ showAlert: false }).catch(() => null);
    isBleAvailable = true;
  }
} catch {
  console.log("react-native-ble-manager not available. Bluetooth connections will be simulated.");
}

const FRAME_SEND_MS = 16;
const HEARTBEAT_MS = 250;
const BLE_RSSI_POLL_MS = 2000;
const MAX_HEARTBEAT_MISSES = 3;
const RECONNECT_DELAYS_MS = [250, 600, 1100];

const NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_TX_CHARACTERISTIC_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

type TimeoutId = ReturnType<typeof setTimeout>;
type IntervalId = ReturnType<typeof setInterval>;

async function requestBluetoothPermissions(): Promise<boolean> {
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

const stringToBytes = (str: string): number[] => {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i));
  }
  return bytes;
};

export function useGamepadTransport(payloadMessage: string) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rssi, setRssi] = useState<number | null>(null);

  const currentSettingsRef = useRef<ConnectionSettings | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const bleConnectedIdRef = useRef<string | null>(null);
  const isSimulatedRef = useRef<boolean>(false);

  const payloadRef = useRef(payloadMessage);
  const manualDisconnectRef = useRef(false);
  const sendTimerRef = useRef<TimeoutId | null>(null);
  const heartbeatRef = useRef<IntervalId | null>(null);
  const reconnectTimerRef = useRef<TimeoutId | null>(null);
  const lastSentAtRef = useRef(0);
  const missedHeartbeatRef = useRef(0);

  const openConnectionRef = useRef<
    (settings: ConnectionSettings, attempt?: number) => void
  >(() => undefined);

  const clearTimers = useCallback(() => {
    if (sendTimerRef.current) {
      clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const sendNow = useCallback((message: string) => {
    const settings = currentSettingsRef.current;
    if (!settings) return false;

    // ─── Wi-Fi WebSocket Send ────────────────────────────────────────────────
    if (settings.mode === "wifi") {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        missedHeartbeatRef.current += 1;
        return false;
      }
      socket.send(message);
      lastSentAtRef.current = Date.now();
      missedHeartbeatRef.current = 0;
      return true;
    }

    // ─── Bluetooth BLE Send ──────────────────────────────────────────────────
    if (settings.mode === "bluetooth") {
      if (isSimulatedRef.current) {
        console.log(`[SIMULATED BLE SEND]: ${message}`);
        lastSentAtRef.current = Date.now();
        return true;
      }

      const deviceId = bleConnectedIdRef.current;
      if (!deviceId || !isBleAvailable) {
        missedHeartbeatRef.current += 1;
        return false;
      }

      const bytes = stringToBytes(message);
      BleManager.writeWithoutResponse(
        deviceId,
        NUS_SERVICE_UUID,
        NUS_TX_CHARACTERISTIC_UUID,
        bytes
      )
        .then(() => {
          lastSentAtRef.current = Date.now();
          missedHeartbeatRef.current = 0;
        })
        .catch((err: any) => {
          console.error("BLE Write error:", err);
        });

      return true;
    }

    return false;
  }, []);

  const schedulePayloadSend = useCallback(() => {
    if (sendTimerRef.current) return;

    const settings = currentSettingsRef.current;
    if (!settings) return;

    if (settings.mode === "wifi") {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
    } else if (settings.mode === "bluetooth") {
      if (!isSimulatedRef.current && (!bleConnectedIdRef.current || !isBleAvailable)) return;
    }

    const elapsedMs = Date.now() - lastSentAtRef.current;
    const waitMs = Math.max(0, FRAME_SEND_MS - elapsedMs);

    sendTimerRef.current = setTimeout(() => {
      sendTimerRef.current = null;
      sendNow(payloadRef.current);
    }, waitMs);
  }, [sendNow]);

  const handleBleDisconnect = useCallback(() => {
    const settings = currentSettingsRef.current;

    bleConnectedIdRef.current = null;
    setRssi(null);

    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    if (manualDisconnectRef.current || !settings) {
      setStatus("disconnected");
      return;
    }

    setStatus("reconnecting");
    reconnectTimerRef.current = setTimeout(() => {
      openConnectionRef.current(settings, 1);
    }, RECONNECT_DELAYS_MS[0]);
  }, []);

  const openConnection = useCallback(
    async (settings: ConnectionSettings, attempt = 0) => {
      clearTimers();
      missedHeartbeatRef.current = 0;
      setStatus(attempt > 0 ? "reconnecting" : "connecting");
      setErrorMessage(null);
      setRssi(null);

      // ─── Wi-Fi (WebSocket) Mode ───────────────────────────────────────────
      if (settings.mode === "wifi") {
        isSimulatedRef.current = false;
        const socket = new WebSocket(buildWebSocketUrl(settings));
        socketRef.current = socket;

        socket.onopen = () => {
          setStatus("connected");
          sendNow(payloadRef.current);

          heartbeatRef.current = setInterval(() => {
            const sent = sendNow(payloadRef.current);
            if (!sent && missedHeartbeatRef.current >= MAX_HEARTBEAT_MISSES) {
              socket.close();
            }
          }, HEARTBEAT_MS);
        };

        socket.onmessage = () => {
          missedHeartbeatRef.current = 0;
        };

        socket.onerror = () => {
          setErrorMessage(`Could not reach ${settings.host}:${settings.port}.`);
        };

        socket.onclose = () => {
          if (socketRef.current === socket) {
            socketRef.current = null;
          }
          if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
          }

          if (manualDisconnectRef.current) {
            setStatus("disconnected");
            return;
          }

          if (attempt < RECONNECT_DELAYS_MS.length) {
            setStatus("reconnecting");
            reconnectTimerRef.current = setTimeout(() => {
              openConnectionRef.current(settings, attempt + 1);
            }, RECONNECT_DELAYS_MS[attempt]);
            return;
          }

          setStatus("error");
          setErrorMessage(
            `Connection lost after ${RECONNECT_DELAYS_MS.length} retries.`
          );
        };
        return;
      }

      // ─── Bluetooth (BLE) Mode ──────────────────────────────────────────────
      if (settings.mode === "bluetooth") {
        if (!settings.deviceId) {
          setStatus("error");
          setErrorMessage("No Bluetooth device selected.");
          return;
        }

        const hasPermissions = await requestBluetoothPermissions();
        if (!hasPermissions) {
          setStatus("error");
          setErrorMessage("Bluetooth/Location permissions denied.");
          return;
        }

        if (!isBleAvailable) {
          isSimulatedRef.current = true;
          reconnectTimerRef.current = setTimeout(() => {
            setStatus("connected");
            setRssi(-65);
            sendNow(payloadRef.current);

            heartbeatRef.current = setInterval(() => {
              sendNow(payloadRef.current);
              setRssi((prev) => (prev ? prev + Math.floor(Math.random() * 5) - 2 : -65));
            }, BLE_RSSI_POLL_MS);
          }, 1000);
          return;
        }

        isSimulatedRef.current = false;
        try {
          await BleManager.connect(settings.deviceId);
          bleConnectedIdRef.current = settings.deviceId;
          setStatus("connected");

          await BleManager.retrieveServices(settings.deviceId);

          try {
            await BleManager.requestMTU(settings.deviceId, 512);
          } catch {
            console.log("MTU negotiation failed or not supported, using default");
          }

          heartbeatRef.current = setInterval(async () => {
            try {
              const currentRssi = await BleManager.readRSSI(settings.deviceId);
              setRssi(currentRssi);
              missedHeartbeatRef.current = 0;
            } catch {
              missedHeartbeatRef.current += 1;
              if (missedHeartbeatRef.current >= MAX_HEARTBEAT_MISSES) {
                handleBleDisconnect();
              }
            }
          }, BLE_RSSI_POLL_MS);

        } catch (err: any) {
          console.error("BLE Connect failed:", err);

          if (manualDisconnectRef.current) {
            setStatus("disconnected");
            return;
          }

          if (attempt < RECONNECT_DELAYS_MS.length) {
            setStatus("reconnecting");
            reconnectTimerRef.current = setTimeout(() => {
              openConnectionRef.current(settings, attempt + 1);
            }, RECONNECT_DELAYS_MS[attempt]);
          } else {
            setStatus("error");
            setErrorMessage(`Failed to connect to BLE device ${settings.deviceName}.`);
          }
        }
      }
    },
    [clearTimers, sendNow, handleBleDisconnect]
  );

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    clearTimers();
    setRssi(null);

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    const deviceId = bleConnectedIdRef.current;
    if (deviceId && isBleAvailable && !isSimulatedRef.current) {
      BleManager.disconnect(deviceId).catch(() => null);
    }
    bleConnectedIdRef.current = null;
    isSimulatedRef.current = false;

    missedHeartbeatRef.current = 0;
    setStatus("disconnected");
  }, [clearTimers]);

  useEffect(() => {
    if (!isBleAvailable) return;

    const disconnectListener = bleManagerEmitter.addListener(
      "BleManagerDisconnectPeripheral",
      (data: { peripheral: string }) => {
        if (data.peripheral === bleConnectedIdRef.current) {
          console.log("BLE peripheral disconnected natively:", data.peripheral);
          handleBleDisconnect();
        }
      }
    );

    return () => {
      disconnectListener.remove();
    };
  }, [handleBleDisconnect]);

  useEffect(() => {
    openConnectionRef.current = openConnection;
  }, [openConnection]);

  const connect = useCallback(
    (settings: ConnectionSettings) => {
      currentSettingsRef.current = settings;
      manualDisconnectRef.current = false;

      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      const deviceId = bleConnectedIdRef.current;
      if (deviceId && isBleAvailable && !isSimulatedRef.current) {
        BleManager.disconnect(deviceId).catch(() => null);
      }
      bleConnectedIdRef.current = null;
      isSimulatedRef.current = false;

      openConnection(settings);
      return true;
    },
    [openConnection]
  );

  useEffect(() => {
    payloadRef.current = payloadMessage;
    schedulePayloadSend();
  }, [payloadMessage, schedulePayloadSend]);

  useEffect(
    () => () => {
      manualDisconnectRef.current = true;
      clearTimers();
      if (socketRef.current) {
        socketRef.current.close();
      }
      const deviceId = bleConnectedIdRef.current;
      if (deviceId && isBleAvailable && !isSimulatedRef.current) {
        BleManager.disconnect(deviceId).catch(() => null);
      }
    },
    [clearTimers]
  );

  return {
    status,
    errorMessage,
    rssi,
    connect,
    disconnect,
  };
}
