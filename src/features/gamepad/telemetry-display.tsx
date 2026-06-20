import { StyleSheet, Text, View, DimensionValue } from 'react-native';
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

  const renderBar = (speed: number) => {
    const pct = (speed / MAX_TICKS_PER_SEC) * 100;
    const isPositive = pct >= 0;
    const widthStr = `${Math.min(100, Math.abs(pct))}%` as DimensionValue;

    return (
      <View style={styles.barTrack}>
        <View style={styles.zeroLine} />
        <View
          style={[
            styles.barValue,
            isPositive
              ? { left: '50%', width: widthStr, borderTopRightRadius: 4, borderBottomRightRadius: 4 }
              : { right: '50%', width: widthStr, borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
            {
              backgroundColor: isPositive ? '#00f2fe' : '#ff4b2b',
            },
          ]}
        />
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>LIVE TELEMETRY</Text>
      
      <View style={styles.motorSection}>
        <View style={styles.row}>
          <Text style={styles.label}>MOTOR LEFT</Text>
          <Text style={[styles.value, { color: speedL >= 0 ? '#00f2fe' : '#ff4b2b' }]}>
            {Math.round(speedL)} <Text style={styles.unit}>T/s</Text>
          </Text>
        </View>
        {renderBar(speedL)}
      </View>

      <View style={styles.motorSection}>
        <View style={styles.row}>
          <Text style={styles.label}>MOTOR RIGHT</Text>
          <Text style={[styles.value, { color: speedR >= 0 ? '#00f2fe' : '#ff4b2b' }]}>
            {Math.round(speedR)} <Text style={styles.unit}>T/s</Text>
          </Text>
        </View>
        {renderBar(speedR)}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 170,
    backgroundColor: 'rgba(20, 24, 46, 0.75)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 12,
    gap: 12,
    alignItems: 'stretch',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  title: {
    fontSize: 9,
    fontWeight: '900',
    color: '#a0aec0',
    letterSpacing: 1.5,
    textAlign: 'center',
    marginBottom: 2,
  },
  motorSection: {
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  label: {
    fontSize: 9,
    fontWeight: '800',
    color: '#718096',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 13,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  unit: {
    fontSize: 8,
    fontWeight: '500',
    color: '#718096',
  },
  barTrack: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 3,
    position: 'relative',
    overflow: 'hidden',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 0.5,
  },
  zeroLine: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    zIndex: 2,
  },
  barValue: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    zIndex: 1,
  },
});
