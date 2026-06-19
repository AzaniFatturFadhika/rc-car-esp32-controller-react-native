import { parseIncomingMessage, createAuthMessage, createHeartbeatMessage, createCommandMessage, validateConnectionSettings } from "../../src/services/protocol";

describe("Protocol Services", () => {
  it("creates correct AUTH message", () => {
    const msg = createAuthMessage();
    expect(msg).toEqual({
      type: "AUTH",
      token: "secret123",
    });
  });

  it("creates correct HEARTBEAT message", () => {
    const msg = createHeartbeatMessage();
    expect(msg).toEqual({
      type: "HEARTBEAT",
    });
  });

  it("creates correct CMD message", () => {
    const msg = createCommandMessage(50.4, -30.7, "UP");
    expect(msg).toEqual({
      type: "CMD",
      lx: 50,
      ly: -31,
      dpad: "UP",
    });
  });

  it("parses valid incoming telemetry", () => {
    const raw = '{"type":"TELEMETRY","speedL":120,"speedR":115,"battery":80,"mode":1}';
    const parsed = parseIncomingMessage(raw);
    expect(parsed).toEqual({
      type: "TELEMETRY",
      speedL: 120,
      speedR: 115,
      battery: 80,
      mode: 1,
    });
  });

  it("returns null for malformed json", () => {
    const raw = '{"type":"TELEMETRY",invalid}';
    const parsed = parseIncomingMessage(raw);
    expect(parsed).toBeNull();
  });

  it("validates connection settings correctly", () => {
    expect(validateConnectionSettings({ host: "", port: 81 })).toBe("Enter an ESP32 host or IP address.");
    expect(validateConnectionSettings({ host: "192.168.4.1", port: 99999 })).toBe("Port must be a number between 1 and 65535.");
    expect(validateConnectionSettings({ host: "192.168.4.1", port: 81 })).toBeNull();
  });
});
