import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useConnectionStore } from '../../store/connectionStore';

export const TelemetryDisplay: React.FC = () => {
  const { telemetry, connectionStatus } = useConnectionStore();

  if (connectionStatus !== 'connected') {
    return null;
  }

  const getBatteryColor = () => {
    if (telemetry.battery > 60) return '#00a960'; // Green
    if (telemetry.battery > 30) return '#f1c84b'; // Yellow
    return '#d14a3f'; // Red
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>TELEMETRY</Text>
      
      <View style={styles.row}>
        <Text style={styles.label}>MOTOR L</Text>
        <Text style={styles.value}>{Math.round(telemetry.speedL)} RPM</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>MOTOR R</Text>
        <Text style={styles.value}>{Math.round(telemetry.speedR)} RPM</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>BATTERY</Text>
        <Text style={[styles.value, { color: getBatteryColor(), fontWeight: 'bold' }]}>
          {telemetry.battery}%
        </Text>
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
