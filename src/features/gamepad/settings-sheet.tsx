import { memo, useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import { BleManager } from "react-native-ble-plx";

import { validateConnectionSettings } from "../../services/protocol";
import { saveConnectionSettings } from "./settings-storage";
import type { ConnectionMode, ConnectionSettings, ConnectionStatus } from "./types";
import { requestBluetoothPermissions } from "../../services/ConnectionManager";

let localBleManager: BleManager | null = null;
let isBleAvailable = false;

try {
  localBleManager = new BleManager();
  isBleAvailable = true;
} catch {
  // Safe fail for non-native environments
}

type SettingsSheetProps = {
  visible: boolean;
  currentSettings: ConnectionSettings;
  status: ConnectionStatus;
  onConnect: (settings: ConnectionSettings) => void;
  onDisconnect: () => void;
  onClose: () => void;
};

interface DiscoveredDevice {
  id: string;
  name: string;
}

export const SettingsSheet = memo(function SettingsSheet({
  visible,
  currentSettings,
  status,
  onConnect,
  onDisconnect,
  onClose,
}: SettingsSheetProps) {
  const [mode, setMode] = useState<ConnectionMode>(currentSettings.mode);

  // Wi-Fi fields
  const [host, setHost] = useState(currentSettings.host);
  const [port, setPort] = useState(String(currentSettings.port));

  // Bluetooth fields
  const [deviceId, setDeviceId] = useState(currentSettings.deviceId);
  const [deviceName, setDeviceName] = useState(currentSettings.deviceName);
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);

  const [validationError, setValidationError] = useState<string | null>(null);

  const isConnected =
    status === "connected" || status === "connecting" || status === "reconnecting" || status === "authenticating";

  // Sync settings when sheet opens
  useEffect(() => {
    if (visible) {
      setMode(currentSettings.mode);
      setHost(currentSettings.host);
      setPort(String(currentSettings.port));
      setDeviceId(currentSettings.deviceId);
      setDeviceName(currentSettings.deviceName);
      setValidationError(null);
      setDevices([]);
      setScanning(false);
    }
  }, [visible, currentSettings]);

  // Stop device scan when closing/unmounting
  useEffect(() => {
    return () => {
      if (localBleManager) {
        try {
          localBleManager.stopDeviceScan();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const handleStartScan = useCallback(async () => {
    if (scanning) return;
    setDevices([]);
    setScanning(true);

    if (!isBleAvailable || !localBleManager) {
      // Simulate Bluetooth scanning in non-native environments
      setTimeout(() => {
        setDevices([
          { id: "24:6F:28:1A:3B:5C", name: "ESP32-Robot-Controller" },
          { id: "AC:67:B2:8E:E1:9F", name: "ESP32-Rover-Arm" },
        ]);
        setScanning(false);
      }, 1500);
      return;
    }

    // Request permissions before starting scan on Android
    const hasPermission = await requestBluetoothPermissions();
    if (!hasPermission) {
      setScanning(false);
      setValidationError("Bluetooth scanning permissions were denied.");
      return;
    }

    console.log("BLE Scan started successfully");
    try {
      localBleManager.startDeviceScan(null, null, (error, device) => {
        if (error) {
          console.error("BLE Scan error:", error);
          setScanning(false);
          setValidationError("Could not scan for Bluetooth devices.");
          return;
        }

        if (device) {
          const displayName = device.name || device.localName || `Unknown Device (${device.id})`;
          setDevices((prev) => {
            if (prev.some((d) => d.id === device.id)) return prev;
            return [...prev, { id: device.id, name: displayName }];
          });
        }
      });
    } catch (err) {
      console.error("Failed to start device scan:", err);
      setScanning(false);
      setValidationError("Failed to start Bluetooth scanner.");
    }

    // Timeout scanning after 5 seconds
    setTimeout(() => {
      if (localBleManager) {
        try {
          localBleManager.stopDeviceScan();
        } catch {
          // ignore
        }
      }
      setScanning(false);
    }, 5000);
  }, [scanning]);

  const handleSelectDevice = useCallback((device: DiscoveredDevice) => {
    setDeviceId(device.id);
    setDeviceName(device.name);
  }, []);

  const handleConnect = useCallback(() => {
    const settings: ConnectionSettings = {
      mode,
      host: host.trim(),
      port: Number(port),
      deviceId,
      deviceName,
    };

    if (mode === "wifi") {
      const err = validateConnectionSettings(settings);
      if (err) {
        setValidationError(err);
        return;
      }
    } else {
      if (!deviceId) {
        setValidationError("Please select an ESP32 Bluetooth device.");
        return;
      }
    }

    setValidationError(null);
    saveConnectionSettings(settings).catch(() => null);
    onConnect(settings);
    onClose();
  }, [mode, host, port, deviceId, deviceName, onConnect, onClose]);

  const handleDisconnect = useCallback(() => {
    onDisconnect();
    onClose();
  }, [onDisconnect, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          style={styles.sheetWrap}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            style={styles.sheet}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>Connection Setup</Text>
              <Pressable
                onPress={onClose}
                style={styles.closeButton}
                accessibilityLabel="Close settings"
                accessibilityRole="button"
              >
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>

            {/* Mode Switcher */}
            <View style={styles.modeTabs}>
              <Pressable
                style={[styles.modeTab, mode === "wifi" && styles.modeTabActive]}
                disabled={isConnected}
                onPress={() => setMode("wifi")}
              >
                <Text style={[styles.modeTabText, mode === "wifi" && styles.modeTabTextActive]}>
                  Wi-Fi WebSocket
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeTab, mode === "bluetooth" && styles.modeTabActive]}
                disabled={isConnected}
                onPress={() => setMode("bluetooth")}
              >
                <Text
                  style={[styles.modeTabText, mode === "bluetooth" && styles.modeTabTextActive]}
                >
                  Bluetooth (BLE)
                </Text>
              </Pressable>
            </View>

            {/* Wi-Fi Configuration */}
            {mode === "wifi" && (
              <View style={styles.tabContent}>
                <Text style={styles.sectionLabel}>ESP32 HOST / IP ADDRESS</Text>
                <TextInput
                  id="settings-host-input"
                  value={host}
                  onChangeText={setHost}
                  style={styles.input}
                  placeholder="192.168.4.1"
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="next"
                  editable={!isConnected}
                />

                <Text style={styles.sectionLabel}>PORT</Text>
                <TextInput
                  id="settings-port-input"
                  value={port}
                  onChangeText={setPort}
                  style={styles.input}
                  placeholder="81"
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  keyboardType="number-pad"
                  returnKeyType="done"
                  editable={!isConnected}
                />
              </View>
            )}

            {/* Bluetooth Configuration */}
            {mode === "bluetooth" && (
              <View style={styles.tabContent}>
                <Text style={styles.sectionLabel}>SELECTED ESP32 ROBOT</Text>
                <View style={styles.selectedDeviceCard}>
                  {deviceId ? (
                    <View>
                      <Text style={styles.deviceNameText}>{deviceName}</Text>
                      <Text style={styles.deviceIdText}>{deviceId}</Text>
                    </View>
                  ) : (
                    <Text style={styles.noDeviceText}>No Bluetooth device selected</Text>
                  )}
                </View>

                {!isConnected && (
                  <>
                    <Pressable
                      style={({ pressed }) => [
                        styles.scanButton,
                        pressed && styles.actionButtonPressed,
                      ]}
                      onPress={handleStartScan}
                      disabled={scanning}
                    >
                      {scanning ? (
                        <View style={styles.scanRow}>
                          <ActivityIndicator size="small" color="#ffffff" />
                          <Text style={styles.scanButtonText}>Scanning...</Text>
                        </View>
                      ) : (
                        <Text style={styles.scanButtonText}>Scan for ESP32 Gamepad</Text>
                      )}
                    </Pressable>

                    <Text style={styles.sectionLabel}>DISCOVERED DEVICES</Text>
                    <View style={styles.deviceListWrap}>
                      {devices.length === 0 ? (
                        <Text style={styles.emptyListText}>
                          {scanning ? "Searching..." : "No devices found. Tap Scan above."}
                        </Text>
                      ) : (
                        devices.map((device) => {
                          const isSelected = device.id === deviceId;
                          return (
                            <Pressable
                              key={device.id}
                              style={[
                                styles.deviceListItem,
                                isSelected && styles.deviceListItemSelected,
                              ]}
                              onPress={() => handleSelectDevice(device)}
                            >
                              <Text
                                style={[
                                  styles.deviceItemName,
                                  isSelected && styles.deviceItemNameSelected,
                                ]}
                              >
                                {device.name}
                              </Text>
                              <Text style={styles.deviceItemMac}>{device.id}</Text>
                            </Pressable>
                          );
                        })
                      )}
                    </View>
                  </>
                )}
              </View>
            )}

            {validationError ? (
              <Text style={styles.validationError}>{validationError}</Text>
            ) : null}

            {/* Actions */}
            <View style={styles.actions}>
              {isConnected ? (
                <Pressable
                  id="settings-disconnect-button"
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.disconnectButton,
                    pressed && styles.actionButtonPressed,
                  ]}
                  onPress={handleDisconnect}
                  accessibilityRole="button"
                  accessibilityLabel="Disconnect from ESP32"
                >
                  <Text style={styles.actionButtonText}>Disconnect</Text>
                </Pressable>
              ) : (
                <Pressable
                  id="settings-connect-button"
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.connectButton,
                    pressed && styles.actionButtonPressed,
                  ]}
                  onPress={handleConnect}
                  accessibilityRole="button"
                  accessibilityLabel="Connect to ESP32"
                >
                  <Text style={styles.actionButtonText}>Connect</Text>
                </Pressable>
              )}
            </View>

            <Text style={styles.hint}>
              {mode === "wifi"
                ? "The ESP32 must run a WebSocket server on the configured port. Default: 192.168.4.1:81"
                : "Ensure Bluetooth is enabled. For real-world use, your ESP32 must run a BLE UART service."}
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  sheetWrap: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    maxHeight: "88%",
  },
  sheet: {
    backgroundColor: "#12122a",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderColor: "rgba(90,90,255,0.25)",
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  sheetContent: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontWeight: "600",
  },
  modeTabs: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 10,
    padding: 4,
    marginBottom: 4,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  modeTabActive: {
    backgroundColor: "#5a5aff",
  },
  modeTabText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
    fontWeight: "700",
  },
  modeTabTextActive: {
    color: "#ffffff",
  },
  tabContent: {
    gap: 12,
  },
  sectionLabel: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: -4,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderRadius: 10,
    color: "#ffffff",
    fontSize: 16,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectedDeviceCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  noDeviceText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 14,
    fontStyle: "italic",
  },
  deviceNameText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  deviceIdText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    fontFamily: "monospace",
    marginTop: 2,
  },
  scanButton: {
    backgroundColor: "rgba(90,90,255,0.15)",
    borderColor: "rgba(90,90,255,0.35)",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  scanRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  scanButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  deviceListWrap: {
    backgroundColor: "rgba(0,0,0,0.2)",
    borderColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderRadius: 10,
    maxHeight: 90,
    overflow: "hidden",
  },
  emptyListText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 20,
    fontStyle: "italic",
  },
  deviceListItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomColor: "rgba(255,255,255,0.05)",
    borderBottomWidth: 1,
  },
  deviceListItemSelected: {
    backgroundColor: "rgba(90,90,255,0.25)",
  },
  deviceItemName: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    fontWeight: "600",
  },
  deviceItemNameSelected: {
    color: "#ffffff",
  },
  deviceItemMac: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 11,
    fontFamily: "monospace",
    marginTop: 2,
  },
  validationError: {
    color: "#d14a3f",
    fontSize: 13,
    fontWeight: "500",
  },
  actions: {
    marginTop: 4,
  },
  actionButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.98 }],
  },
  connectButton: {
    backgroundColor: "#5a5aff",
  },
  disconnectButton: {
    backgroundColor: "#3a2030",
    borderColor: "#d14a3f",
    borderWidth: 1,
  },
  actionButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  hint: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 4,
  },
});
