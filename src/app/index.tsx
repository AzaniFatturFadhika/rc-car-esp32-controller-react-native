/**
 * Full-screen landscape gamepad controller.
 *
 * Layout:
 *   [LeftPanel] [CenterPanel] [RightPanel]
 *
 * State is managed locally with useReducer. The payload is serialised once
 * per state change (via useMemo) and passed to useWifiTransport, which
 * throttles WebSocket sends to ~16 ms per frame.
 */

import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as ScreenOrientation from "expo-screen-orientation";
import {
    useCallback,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from "react";
import { StyleSheet, Text, View, Animated } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConnectionStatusBar } from "@/features/gamepad/connection-status-bar";
import {
    VerticalSlider,
    buttonIsActive,
    DigitalButton,
    DPad,
    getActionVariant
} from "@/features/gamepad/gamepad-controls";
import { SettingsSheet } from "@/features/gamepad/settings-sheet";
import { loadConnectionSettings } from "@/features/gamepad/settings-storage";
import type {
    ButtonId,
    ConnectionSettings,
    DPadDirection,
    GamepadState,
} from "@/features/gamepad/types";
import {
    DEFAULT_CONNECTION_SETTINGS,
    EMPTY_GAMEPAD_STATE,
} from "@/features/gamepad/types";
import { useConnectionStore } from "@/store/connectionStore";
import { buildBinaryCommand } from "@/services/protocol";
import { TelemetryDisplay } from "@/features/gamepad/telemetry-display";
import { MultiTouchProvider } from "@/hooks/useMultiTouch";

// ─── Tank Drive Mixer ────────────────────────────────────────────────────────

function mixTankDrive(L: number, R: number): { lx: number; ly: number; rx: number } {
  let lx = 0;
  let ly = 0;
  let rx = 0;

  if (L * R < 0) {
    // Opposite signs: Spin in place using rx
    rx = Math.round((L - R) / 2);
  } else {
    // Same signs (or one is zero)
    if (Math.abs(L) >= Math.abs(R)) {
      ly = -L;
      lx = L !== 0 ? Math.round(100 * (1 - R / L)) : 0;
    } else {
      ly = -R;
      lx = R !== 0 ? Math.round(100 * (L / R - 1)) : 0;
    }
  }

  return { lx, ly, rx };
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

type GamepadAction =
  | { type: "PRESS_BUTTON"; button: ButtonId }
  | { type: "RELEASE_BUTTON"; button: ButtonId }
  | { type: "MOVE_LEFT_STICK"; x: number; y: number }
  | { type: "RELEASE_LEFT_STICK" }
  | { type: "MOVE_RIGHT_STICK"; x: number; y: number }
  | { type: "RELEASE_RIGHT_STICK" }
  | { type: "SET_DPAD"; direction: DPadDirection | null };

function gamepadReducer(
  state: GamepadState,
  action: GamepadAction,
): GamepadState {
  switch (action.type) {
    case "PRESS_BUTTON":
      if (state.buttons.includes(action.button)) return state;
      return { ...state, buttons: [...state.buttons, action.button] };
    case "RELEASE_BUTTON":
      if (!state.buttons.includes(action.button)) return state;
      return {
        ...state,
        buttons: state.buttons.filter((b) => b !== action.button),
      };
    case "MOVE_LEFT_STICK":
      return { ...state, leftStick: { x: action.x, y: action.y } };
    case "RELEASE_LEFT_STICK":
      return { ...state, leftStick: { x: 0, y: 0 } };
    case "MOVE_RIGHT_STICK":
      return { ...state, rightStick: { x: action.x, y: action.y } };
    case "RELEASE_RIGHT_STICK":
      return { ...state, rightStick: { x: 0, y: 0 } };
    case "SET_DPAD":
      return { ...state, dpad: action.direction };
    default:
      return state;
  }
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function GamepadScreen() {
  const [gamepadState, dispatch] = useReducer(
    gamepadReducer,
    EMPTY_GAMEPAD_STATE,
  );
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [showPayload, setShowPayload] = useState(true);
  const [connectionSettings, setConnectionSettings] =
    useState<ConnectionSettings>(DEFAULT_CONNECTION_SETTINGS);

  // Session timer
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const sessionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Connect Zustand connectionStore
  const {
    connectionStatus: status,
    errorMessage,
    rssi,
    connectWiFi,
    connectBLE,
    disconnect,
    isBinaryProtocol
  } = useConnectionStore();

  // Serialise payload only when state changes.
  const payloadMessage = useMemo(() => {
    const L = Math.round(gamepadState.leftStick.y);
    const R = Math.round(gamepadState.rightStick.y);
    const dpad = gamepadState.dpad || "";

    const { lx, ly, rx } = mixTankDrive(L, R);

    if (isBinaryProtocol) {
      const cmd = buildBinaryCommand(lx, ly, rx, 0, dpad);
      const hex = Array.from(cmd)
        .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
        .join(" ");
      return `BIN: ${hex}`;
    }

    return JSON.stringify({
      type: "CMD",
      lx,
      ly,
      rx,
      ry: 0,
      dpad,
    });
  }, [
    gamepadState.leftStick.y,
    gamepadState.rightStick.y,
    gamepadState.dpad,
    isBinaryProtocol
  ]);

  // Throttled sender loop
  const lastSentAtRef = useRef(0);
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSendCommand = useCallback(() => {
    if (sendTimerRef.current) return;

    const elapsed = Date.now() - lastSentAtRef.current;
    const wait = Math.max(0, 16 - elapsed);

    sendTimerRef.current = setTimeout(() => {
      sendTimerRef.current = null;
      const L = gamepadState.leftStick.y;
      const R = gamepadState.rightStick.y;
      const dpad = gamepadState.dpad || '';

      const { lx, ly, rx } = mixTankDrive(L, R);

      useConnectionStore.getState().sendCommand(lx, ly, rx, 0, dpad);
      lastSentAtRef.current = Date.now();
    }, wait);
  }, [
    gamepadState.leftStick.y,
    gamepadState.rightStick.y,
    gamepadState.dpad
  ]);

  useEffect(() => {
    scheduleSendCommand();
  }, [scheduleSendCommand]);

  // Keep screen on while connected.
  useEffect(() => {
    if (status === "connected") {
      activateKeepAwakeAsync("gamepad-session").catch(() => null);
      return () => {
        deactivateKeepAwake("gamepad-session");
      };
    }
  }, [status]);

  // Session timer: start counting when connected, reset otherwise.
  useEffect(() => {
    if (sessionIntervalRef.current) {
      clearInterval(sessionIntervalRef.current);
      sessionIntervalRef.current = null;
    }

    if (status === "connected") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessionSeconds(0);
      sessionIntervalRef.current = setInterval(() => {
        setSessionSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setSessionSeconds(0);
    }

    return () => {
      if (sessionIntervalRef.current) {
        clearInterval(sessionIntervalRef.current);
        sessionIntervalRef.current = null;
      }
    };
  }, [status]);

  // Lock to landscape on mount.
  useEffect(() => {
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    ).catch(() => null);
    return () => {
      ScreenOrientation.unlockAsync().catch(() => null);
    };
  }, []);

  // Load persisted connection settings on mount.
  useEffect(() => {
    loadConnectionSettings()
      .then(setConnectionSettings)
      .catch(() => null);
  }, []);

  // Toast notification state and animation
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fadeAnim] = useState(() => new Animated.Value(0));

  const showToast = useCallback((message: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(message);

    // Fade In
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    toastTimeoutRef.current = setTimeout(() => {
      // Fade Out
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setToastMessage(null);
      });
      toastTimeoutRef.current = null;
    }, 3000);
  }, [fadeAnim]);

  // Trigger haptics and toast on status changes
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (status === prevStatusRef.current) return;

    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    if (status === "connected") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
      setTimeout(() => showToast("ESP32 Gamepad Connected successfully! 🚀"), 0);
    } else if (status === "reconnecting") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => null);
      setTimeout(() => showToast("Connection lost. Reconnecting... 🔄"), 0);
    } else if (status === "error") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => null);
      setTimeout(() => showToast(errorMessage || "Connection failed. Please check setup. ❌"), 0);
    } else if (status === "disconnected" && prev === "connected") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => null);
      setTimeout(() => showToast("Disconnected from ESP32."), 0);
    }
  }, [status, errorMessage, showToast]);

  // ─── Dispatcher helpers ───────────────────────────────────────────────────

  const handlePressButton = useCallback((button: ButtonId) => {
    dispatch({ type: "PRESS_BUTTON", button });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
  }, []);

  const handleReleaseButton = useCallback((button: ButtonId) => {
    dispatch({ type: "RELEASE_BUTTON", button });
  }, []);

  const handleLeftSliderMove = useCallback((value: number) => {
    dispatch({ type: "MOVE_LEFT_STICK", x: 0, y: value });
  }, []);

  const handleLeftSliderRelease = useCallback(() => {
    dispatch({ type: "RELEASE_LEFT_STICK" });
  }, []);

  const handleRightSliderMove = useCallback((value: number) => {
    dispatch({ type: "MOVE_RIGHT_STICK", x: 0, y: value });
  }, []);

  const handleRightSliderRelease = useCallback(() => {
    dispatch({ type: "RELEASE_RIGHT_STICK" });
  }, []);

  const handleDPadChange = useCallback((direction: DPadDirection | null) => {
    dispatch({ type: "SET_DPAD", direction });
  }, []);

  const handleConnect = useCallback(
    (settings: ConnectionSettings) => {
      setConnectionSettings(settings);
      if (settings.mode === "wifi") {
        connectWiFi(settings.host, settings.port);
      } else {
        connectBLE(settings.deviceId, settings.deviceName);
      }
    },
    [connectWiFi, connectBLE],
  );

  const togglePayloadDebug = useCallback(() => {
    setShowPayload((prev) => !prev);
  }, []);

  const openSettings = useCallback(() => {
    setSettingsVisible(true);
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      {toastMessage && (
        <Animated.View style={[styles.toastContainer, { opacity: fadeAnim }]}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}
      <MultiTouchProvider
        enabled={!settingsVisible}
        style={styles.background}
      >
        <SafeAreaView
          style={styles.safeArea}
          edges={["left", "right", "bottom"]}
        >
          {/* ── Left Panel ─────────────────────────────────── */}
          <View style={styles.panel}>
            <View style={styles.shoulderRow}>
              <DigitalButton
                label="LT"
                accessibilityLabel="Left trigger"
                variant="shoulder"
                wide
                active={buttonIsActive(gamepadState.buttons, "LT")}
                onPressIn={() => handlePressButton("LT")}
                onPressOut={() => handleReleaseButton("LT")}
              />
              <DigitalButton
                label="LB"
                accessibilityLabel="Left bumper"
                variant="shoulder"
                wide
                active={buttonIsActive(gamepadState.buttons, "LB")}
                onPressIn={() => handlePressButton("LB")}
                onPressOut={() => handleReleaseButton("LB")}
              />
            </View>

            <View style={styles.leftMiddle}>
              <DPad
                activeDirection={gamepadState.dpad}
                onDirectionChange={handleDPadChange}
              />
              <VerticalSlider
                label="L MOTOR"
                width={50}
                height={130}
                onMove={handleLeftSliderMove}
                onRelease={handleLeftSliderRelease}
              />
            </View>

            <View style={styles.stickClickRow}>
              <DigitalButton
                label="LS"
                accessibilityLabel="Left stick click"
                variant="center"
                active={buttonIsActive(gamepadState.buttons, "LS")}
                onPressIn={() => handlePressButton("LS")}
                onPressOut={() => handleReleaseButton("LS")}
              />
            </View>
          </View>

          {/* ── Center Panel ───────────────────────────────── */}
          <View style={styles.centerPanel}>
            <ConnectionStatusBar
              status={status}
              errorMessage={errorMessage}
              settings={connectionSettings}
              sessionSeconds={sessionSeconds}
              rssi={rssi}
            />

            <TelemetryDisplay />

            <View style={styles.centerButtons}>
              <DigitalButton
                label="VIEW"
                accessibilityLabel="Toggle payload debug"
                variant="center"
                onPressIn={togglePayloadDebug}
                onPressOut={() => undefined}
              />
              <DigitalButton
                label="⚙"
                accessibilityLabel="Settings"
                variant="center"
                onPressIn={openSettings}
                onPressOut={() => undefined}
              />
              <DigitalButton
                label="MENU"
                accessibilityLabel="Open settings menu"
                variant="center"
                onPressIn={openSettings}
                onPressOut={() => undefined}
              />
            </View>

            {showPayload ? (
              <Text style={styles.payloadDebug} numberOfLines={1}>
                {payloadMessage}
              </Text>
            ) : null}
          </View>

          {/* ── Right Panel ────────────────────────────────── */}
          <View style={styles.panel}>
            <View style={styles.shoulderRow}>
              <DigitalButton
                label="RT"
                accessibilityLabel="Right trigger"
                variant="shoulder"
                wide
                active={buttonIsActive(gamepadState.buttons, "RT")}
                onPressIn={() => handlePressButton("RT")}
                onPressOut={() => handleReleaseButton("RT")}
              />
              <DigitalButton
                label="RB"
                accessibilityLabel="Right bumper"
                variant="shoulder"
                wide
                active={buttonIsActive(gamepadState.buttons, "RB")}
                onPressIn={() => handlePressButton("RB")}
                onPressOut={() => handleReleaseButton("RB")}
              />
            </View>

            <View style={styles.rightMiddle}>
              <VerticalSlider
                label="R MOTOR"
                width={50}
                height={130}
                onMove={handleRightSliderMove}
                onRelease={handleRightSliderRelease}
              />

              {/* ABXY cluster */}
              <View style={styles.abxyCluster}>
                <View style={styles.abxyRow}>
                  <DigitalButton
                    label="Y"
                    accessibilityLabel="Y button"
                    variant={getActionVariant("Y")}
                    onPressIn={() => handlePressButton("Y")}
                    onPressOut={() => handleReleaseButton("Y")}
                    active={buttonIsActive(gamepadState.buttons, "Y")}
                  />
                </View>
                <View style={styles.abxyMiddleRow}>
                  <DigitalButton
                    label="X"
                    accessibilityLabel="X button"
                    variant={getActionVariant("X")}
                    onPressIn={() => handlePressButton("X")}
                    onPressOut={() => handleReleaseButton("X")}
                    active={buttonIsActive(gamepadState.buttons, "X")}
                  />
                  <DigitalButton
                    label="B"
                    accessibilityLabel="B button"
                    variant={getActionVariant("B")}
                    onPressIn={() => handlePressButton("B")}
                    onPressOut={() => handleReleaseButton("B")}
                    active={buttonIsActive(gamepadState.buttons, "B")}
                  />
                </View>
                <View style={styles.abxyRow}>
                  <DigitalButton
                    label="A"
                    accessibilityLabel="A button"
                    variant={getActionVariant("A")}
                    onPressIn={() => handlePressButton("A")}
                    onPressOut={() => handleReleaseButton("A")}
                    active={buttonIsActive(gamepadState.buttons, "A")}
                  />
                </View>
              </View>
            </View>

            <View style={styles.stickClickRow}>
              <DigitalButton
                label="RS"
                accessibilityLabel="Right stick click"
                variant="center"
                active={buttonIsActive(gamepadState.buttons, "RS")}
                onPressIn={() => handlePressButton("RS")}
                onPressOut={() => handleReleaseButton("RS")}
              />
            </View>
          </View>
        </SafeAreaView>
      </MultiTouchProvider>

      <SettingsSheet
        visible={settingsVisible}
        currentSettings={connectionSettings}
        status={status}
        onConnect={handleConnect}
        onDisconnect={disconnect}
        onClose={() => setSettingsVisible(false)}
      />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  background: {
    flex: 1,
    backgroundColor: "#0d0d1a",
  },
  safeArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
  },
  // ── Panels ────────────────────────────────────────────────────────────────
  panel: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  centerPanel: {
    width: 180,
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  // ── Shoulder buttons ─────────────────────────────────────────────────────
  shoulderRow: {
    flexDirection: "row",
    gap: 8,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  // ── Left middle (D-pad + left stick) ─────────────────────────────────────
  leftMiddle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    alignSelf: "stretch",
    gap: 8,
  },
  // ── Right middle (right stick + ABXY) ────────────────────────────────────
  rightMiddle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    alignSelf: "stretch",
    gap: 8,
  },
  // ── Stick click row ───────────────────────────────────────────────────────
  stickClickRow: {
    alignSelf: "stretch",
    alignItems: "center",
  },
  // ── Center buttons ────────────────────────────────────────────────────────
  centerButtons: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  // ── ABXY cluster ─────────────────────────────────────────────────────────
  abxyCluster: {
    alignItems: "center",
    gap: 4,
  },
  abxyRow: {
    flexDirection: "row",
    justifyContent: "center",
  },
  abxyMiddleRow: {
    flexDirection: "row",
    gap: 40,
    alignItems: "center",
  },
  // ── Debug payload strip ───────────────────────────────────────────────────
  payloadDebug: {
    color: "rgba(255,255,255,0.18)",
    fontSize: 9,
    fontFamily: "monospace",
    textAlign: "center",
    paddingHorizontal: 4,
  },
  // ── Toast Notifications ───────────────────────────────────────────────────
  toastContainer: {
    position: "absolute",
    top: 16,
    left: 150,
    right: 150,
    backgroundColor: "rgba(18, 18, 38, 0.92)",
    borderColor: "rgba(90, 90, 255, 0.35)",
    borderWidth: 1,
    borderRadius: 30,
    paddingVertical: 8,
    paddingHorizontal: 16,
    zIndex: 9999,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  toastText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
});
