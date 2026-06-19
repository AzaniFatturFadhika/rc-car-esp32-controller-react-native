import { render, screen } from '@testing-library/react-native';
import { ConnectionStatusBar } from '@/features/gamepad/connection-status-bar';

const mockStatus = 'disconnected';
const mockError = 'Connection failed';
const mockHost = '192.168.4.1';
const mockPort = 81;
const mockSessionSeconds = 120;

describe('ConnectionStatusBar', () => {
  it('displays disconnected status', () => {
    render(
      <ConnectionStatusBar
        status={mockStatus}
        errorMessage={mockError}
        host={mockHost}
        port={mockPort}
        sessionSeconds={mockSessionSeconds}
      />
    );

    expect(screen.getByText('DISCONNECTED')).toBeTruthy();
    expect(screen.getByText('ws://192.168.4.1:81')).toBeTruthy();
    expect(screen.getByText('02:00')).toBeTruthy();
  });

  it('displays connecting status', () => {
    render(
      <ConnectionStatusBar
        status="connecting"
        errorMessage={mockError}
        host={mockHost}
        port={mockPort}
        sessionSeconds={mockSessionSeconds}
      />
    );

    expect(screen.getByText('CONNECTING…')).toBeTruthy();
    expect(screen.getByText('ws://192.168.4.1:81')).toBeTruthy();
  });

  it('displays connected status', () => {
    render(
      <ConnectionStatusBar
        status="connected"
        errorMessage={mockError}
        host={mockHost}
        port={mockPort}
        sessionSeconds={mockSessionSeconds}
      />
    );

    expect(screen.getByText('CONNECTED')).toBeTruthy();
    expect(screen.getByText('ws://192.168.4.1:81')).toBeTruthy();
    expect(screen.getByText('02:00')).toBeTruthy();
  });

  it('displays error status', () => {
    render(
      <ConnectionStatusBar
        status="error"
        errorMessage={mockError}
        host={mockHost}
        port={mockPort}
        sessionSeconds={mockSessionSeconds}
      />
    );

    expect(screen.getByText('ERROR')).toBeTruthy();
    expect(screen.getByText(mockError)).toBeTruthy();
  });
});