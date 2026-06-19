import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useConnectionStore } from '../../store/connectionStore';

const MAX_TICKS_PER_SEC = 150; // Sesuai batasan firmware ESP32

export const TelemetryDisplay: React.FC = () => {
  const { telemetry, connectionStatus } = useConnectionStore();

  if (connectionStatus !== 'connected') {
    return null;
  }

  // Batasi agar tidak melewati batas fisik/kontrol yang ditetapkan firmware
  const speedL = Math.max(-MAX_TICKS_PER_SEC, Math.min(MAX_TICKS_PER_SEC, telemetry.speedL));
  const speedR = Math.max(-MAX_TICKS_PER_SEC, Math.min(MAX_TICKS_PER_SEC, telemetry.speedR));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>TELEMETRY</Text>
      
      <View style={styles.row}>
        <Text style={styles.label}>MOTOR L</Text>
        <Text style={styles.value}>{Math.round(speedL)} T/s</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>MOTOR R</Text>
        <Text style={styles.value}>{Math.round(speedR)} T/s</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 160,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 6,
    alignItems: 'stretch',
  },
  title: {
    fontSize: 9,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.2,
    textAlign: 'center',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
  },
  value: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
    fontFamily: 'monospace',
  },
});
