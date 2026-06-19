import { render, screen } from '@testing-library/react-native';
import { ConnectionStatusBar } from '@/features/gamepad/connection-status-bar';

const mockStatus = 'disconnected';
const mockError = 'Connection failed';
const mockSettings = {
  mode: 'wifi' as const,
  host: '192.168.4.1',
  port: 81,
  deviceId: '',
  deviceName: 'ESP32-Gamepad',
};
const mockSessionSeconds = 120;

describe('ConnectionStatusBar', () => {
  it('displays disconnected status', async () => {
    await render(
      <ConnectionStatusBar
        status={mockStatus}
        errorMessage={mockError}
        settings={mockSettings}
        sessionSeconds={mockSessionSeconds}
      />
    );

    expect(screen.getByText('DISCONNECTED')).toBeTruthy();
  });

  it('displays connecting status', async () => {
    await render(
      <ConnectionStatusBar
        status="connecting"
        errorMessage={mockError}
        settings={mockSettings}
        sessionSeconds={mockSessionSeconds}
      />
    );

    expect(screen.getByText('CONNECTING…')).toBeTruthy();
  });

  it('displays connected status', async () => {
    await render(
      <ConnectionStatusBar
        status="connected"
        errorMessage={mockError}
        settings={mockSettings}
        sessionSeconds={mockSessionSeconds}
      />
    );

    expect(screen.getByText('CONNECTED')).toBeTruthy();
    expect(screen.getByText('ws://192.168.4.1:81')).toBeTruthy();
    expect(screen.getByText('02:00')).toBeTruthy();
  });

  it('displays error status', async () => {
    await render(
      <ConnectionStatusBar
        status="error"
        errorMessage={mockError}
        settings={mockSettings}
        sessionSeconds={mockSessionSeconds}
      />
    );

    expect(screen.getByText('ERROR')).toBeTruthy();
    expect(screen.getByText(mockError)).toBeTruthy();
  });
});