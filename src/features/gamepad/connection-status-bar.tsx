import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { ConnectionStatus } from './types';

type ConnectionStatusBarProps = {
  status: ConnectionStatus;
  errorMessage: string | null;
  host: string;
  port: number;
  sessionSeconds: number;
};

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { label: string; color: string; pulse: boolean }
> = {
  disconnected: { label: 'DISCONNECTED', color: '#555577', pulse: false },
  connecting: { label: 'CONNECTING…', color: '#f1c84b', pulse: true },
  connected: { label: 'CONNECTED', color: '#00a960', pulse: false },
  reconnecting: { label: 'RECONNECTING…', color: '#f1943a', pulse: true },
  error: { label: 'ERROR', color: '#d14a3f', pulse: false },
};

function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const ConnectionStatusBar = memo(function ConnectionStatusBar({
  status,
  errorMessage,
  host,
  port,
  sessionSeconds,
}: ConnectionStatusBarProps) {
  const config = STATUS_CONFIG[status];

  // Pulse animation for the dot
  const dotOpacity = useSharedValue(1);

  useEffect(() => {
    if (config.pulse) {
      dotOpacity.value = withRepeat(
        withTiming(0.25, { duration: 700 }),
        -1,
        true
      );
    } else {
      cancelAnimation(dotOpacity);
      dotOpacity.value = 1;
    }
  }, [config.pulse, dotOpacity]);

  const dotAnimatedStyle = useAnimatedStyle(() => ({
    opacity: dotOpacity.value,
  }));

  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.dot, { backgroundColor: config.color }, dotAnimatedStyle]}
      />
      <Text style={[styles.statusText, { color: config.color }]}>{config.label}</Text>
      {status === 'connected' && (
        <>
          <Text style={styles.addressText}>
            ws://{host}:{port}
          </Text>
          <Text style={styles.timerText}>{formatTime(sessionSeconds)}</Text>
        </>
      )}
      {errorMessage && status !== 'connected' ? (
        <Text style={styles.errorText} numberOfLines={1}>
          {errorMessage}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  addressText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: 'monospace',
    marginLeft: 2,
  },
  timerText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  errorText: {
    fontSize: 11,
    color: '#d14a3f',
    flexShrink: 1,
  },
});
