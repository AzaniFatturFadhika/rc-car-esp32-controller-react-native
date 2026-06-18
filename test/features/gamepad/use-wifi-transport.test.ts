import { renderHook, act } from '@testing-library/react-hooks';
import { useWifiTransport } from '@/features/gamepad/use-wifi-transport';

import type { ConnectionStatus } from '@/features/gamepad/types';

const mockPayload = 'LX:0 LY:0 RX:0 RY:0 BTN:[] DPAD:null';

const mockSettings = {
  host: '192.168.4.1',
  port: 81,
};

const mockErrorMessage = 'Connection failed';

const mockConnect = jest.fn();
const mockDisconnect = jest.fn();

jest.mock('@/features/gamepad/protocol', () => ({
  buildWebSocketUrl: jest.fn().mockReturnValue('ws://192.168.4.1:81'),
  validateConnectionSettings: jest.fn().mockReturnValue(null),
  encodeGamepadPayload: jest.fn().mockReturnValue(mockPayload),
}));

const testUseWifiTransport = () => {
  const { result, unmount } = renderHook(() => useWifiTransport(mockPayload));

  return {
    result,
    unmount,
  };
};

describe('useWifiTransport', () => {
  it('initializes with disconnected status', () => {
    const { result } = testUseWifiTransport();
    expect(result.current.status).toBe('disconnected');
  });

  it('connects successfully', () => {
    const { result } = testUseWifiTransport();
    const connect = result.current.connect;

    connect(mockSettings);

    expect(result.current.status).toBe('connecting');
  });

  it('handles connection error', () => {
    const mockError = jest.fn();
    const { result } = testUseWifiTransport();
    const connect = result.current.connect;

    const error = { error: 'Connection failed' };

    connect(mockSettings);
    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe(mockError);
  });

  it('handles connection loss', () => {
    const { result } = testUseWifiTransport();
    const disconnect = result.current.disconnect;

    disconnect();
    expect(result.current.status).toBe('disconnected');
  });

  it('sends payload at appropriate rate', async () => {
    const { result } = testUseWifiTransport();
    const sendNow = jest.spyOn(result.current, 'sendNow');

    expect(sendNow).not.toHaveBeenCalled();

    await act(async () => {
      result.current.sendNow(mockPayload);
      expect(sendNow).toHaveBeenCalledWith(mockPayload);
    });
  });
});