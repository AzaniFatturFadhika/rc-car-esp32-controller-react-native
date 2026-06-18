import { memo, useCallback, useEffect, useState } from 'react';
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
} from 'react-native';

import { validateConnectionSettings } from './protocol';
import { saveConnectionSettings } from './settings-storage';
import type { ConnectionSettings, ConnectionStatus } from './types';

type SettingsSheetProps = {
  visible: boolean;
  currentSettings: ConnectionSettings;
  status: ConnectionStatus;
  onConnect: (settings: ConnectionSettings) => void;
  onDisconnect: () => void;
  onClose: () => void;
};

export const SettingsSheet = memo(function SettingsSheet({
  visible,
  currentSettings,
  status,
  onConnect,
  onDisconnect,
  onClose,
}: SettingsSheetProps) {
  const [host, setHost] = useState(currentSettings.host);
  const [port, setPort] = useState(String(currentSettings.port));
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setHost(currentSettings.host);
      setPort(String(currentSettings.port));
      setValidationError(null);
    }
  }, [visible, currentSettings.host, currentSettings.port]);

  const isConnected = status === 'connected' || status === 'connecting' || status === 'reconnecting';

  const handleConnect = useCallback(() => {
    const settings: ConnectionSettings = {
      host: host.trim(),
      port: Number(port),
    };
    const err = validateConnectionSettings(settings);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    saveConnectionSettings(settings).catch(() => null);
    onConnect(settings);
    onClose();
  }, [host, port, onConnect, onClose]);

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
      statusBarTranslucent>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          style={styles.sheetWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            style={styles.sheet}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled">
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>Wi-Fi Connection</Text>
              <Pressable
                onPress={onClose}
                style={styles.closeButton}
                accessibilityLabel="Close settings"
                accessibilityRole="button">
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>

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

            {validationError ? (
              <Text style={styles.validationError}>{validationError}</Text>
            ) : null}

            <View style={styles.actions}>
              {isConnected ? (
                <Pressable
                  id="settings-disconnect-button"
                  style={({ pressed }) => [styles.actionButton, styles.disconnectButton, pressed && styles.actionButtonPressed]}
                  onPress={handleDisconnect}
                  accessibilityRole="button"
                  accessibilityLabel="Disconnect from ESP32">
                  <Text style={styles.actionButtonText}>Disconnect</Text>
                </Pressable>
              ) : (
                <Pressable
                  id="settings-connect-button"
                  style={({ pressed }) => [styles.actionButton, styles.connectButton, pressed && styles.actionButtonPressed]}
                  onPress={handleConnect}
                  accessibilityRole="button"
                  accessibilityLabel="Connect to ESP32">
                  <Text style={styles.actionButtonText}>Connect</Text>
                </Pressable>
              )}
            </View>

            <Text style={styles.hint}>
              The ESP32 must be running a WebSocket server on the configured port.
              Default AP address is 192.168.4.1, port 81.
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
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheetWrap: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  sheet: {
    backgroundColor: '#12122a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderColor: 'rgba(90,90,255,0.25)',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    maxHeight: 480,
  },
  sheetContent: {
    padding: 24,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: -4,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderRadius: 10,
    color: '#ffffff',
    fontSize: 16,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  validationError: {
    color: '#d14a3f',
    fontSize: 13,
    fontWeight: '500',
  },
  actions: {
    marginTop: 4,
  },
  actionButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.98 }],
  },
  connectButton: {
    backgroundColor: '#5a5aff',
  },
  disconnectButton: {
    backgroundColor: '#3a2030',
    borderColor: '#d14a3f',
    borderWidth: 1,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  hint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
  },
});
