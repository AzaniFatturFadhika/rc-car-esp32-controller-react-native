import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_CONNECTION_SETTINGS, type ConnectionSettings } from './types';

const STORAGE_KEY = 'controller-react-native.connection-settings';

export async function loadConnectionSettings(): Promise<ConnectionSettings> {
  const rawSettings = await AsyncStorage.getItem(STORAGE_KEY);

  if (!rawSettings) {
    return DEFAULT_CONNECTION_SETTINGS;
  }

  try {
    const parsed = JSON.parse(rawSettings) as Partial<ConnectionSettings>;
    return {
      mode:
        parsed.mode === 'wifi' || parsed.mode === 'bluetooth'
          ? parsed.mode
          : DEFAULT_CONNECTION_SETTINGS.mode,
      host: typeof parsed.host === 'string' ? parsed.host : DEFAULT_CONNECTION_SETTINGS.host,
      port:
        typeof parsed.port === 'number' && Number.isFinite(parsed.port)
          ? parsed.port
          : DEFAULT_CONNECTION_SETTINGS.port,
      deviceId:
        typeof parsed.deviceId === 'string' ? parsed.deviceId : DEFAULT_CONNECTION_SETTINGS.deviceId,
      deviceName:
        typeof parsed.deviceName === 'string' ? parsed.deviceName : DEFAULT_CONNECTION_SETTINGS.deviceName,
    };
  } catch {
    return DEFAULT_CONNECTION_SETTINGS;
  }
}

export async function saveConnectionSettings(settings: ConnectionSettings) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
