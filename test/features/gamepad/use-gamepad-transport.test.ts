import { renderHook, act } from "@testing-library/react-native";
import { useGamepadTransport } from "@/features/gamepad/use-gamepad-transport";

const mockPayload = '{"LX":0,"LY":0,"RX":0,"RY":0,"BTN":[],"DPAD":null}';

const mockWifiSettings = {
  mode: "wifi" as const,
  host: "192.168.4.1",
  port: 81,
  deviceId: "",
  deviceName: "",
};

const mockBleSettings = {
  mode: "bluetooth" as const,
  host: "",
  port: 0,
  deviceId: "12:34:56:AB:CD:EF",
  deviceName: "ESP32-Gamepad",
};

describe("useGamepadTransport", () => {
  it("initializes with disconnected status", async () => {
    const { result } = await renderHook(() => useGamepadTransport(mockPayload));
    expect(result.current.status).toBe("disconnected");
    expect(result.current.rssi).toBeNull();
  });

  it("connects to wifi successfully", async () => {
    const { result } = await renderHook(() => useGamepadTransport(mockPayload));

    await act(async () => {
      result.current.connect(mockWifiSettings);
    });

    expect(result.current.status).toBe("connecting");
  });

  it("connects to simulated bluetooth successfully", async () => {
    const { result } = await renderHook(() => useGamepadTransport(mockPayload));

    // Enable fake timers after renderHook so useEffect can commit initially
    jest.useFakeTimers();

    await act(async () => {
      result.current.connect(mockBleSettings);
    });

    expect(result.current.status).toBe("connecting");

    // Fast-forward simulated connection timeout (1000ms)
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(result.current.status).toBe("connected");
    expect(result.current.rssi).toBe(-65);

    jest.useRealTimers();
  });

  it("handles disconnection", async () => {
    const { result } = await renderHook(() => useGamepadTransport(mockPayload));

    await act(async () => {
      result.current.disconnect();
    });

    expect(result.current.status).toBe("disconnected");
  });
});