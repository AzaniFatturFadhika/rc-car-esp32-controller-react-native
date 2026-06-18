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
import { StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConnectionStatusBar } from "@/features/gamepad/connection-status-bar";
import {
    AnalogStick,
    buttonIsActive,
    DigitalButton,
    DPad,
    getActionVariant,
    useDualStickGestures
} from "@/features/gamepad/gamepad-controls";
import {
    encodeGamepadPayload,
    serializeGamepadPayload,
} from "@/features/gamepad/protocol";
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
import { useWifiTransport } from "@/features/gamepad/use-wifi-transport";

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

  // Two linked pan gestures for simultaneous dual-stick multi-touch on Android.
  const stickGestures = useDualStickGestures();

  // Session timer
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const sessionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Serialise payload only when state changes.
  const payloadMessage = useMemo(
    () => encodeGamepadPayload(serializeGamepadPayload(gamepadState)),
    [gamepadState],
  );

  const { status, errorMessage, connect, disconnect } =
    useWifiTransport(payloadMessage);

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

  // ─── Dispatcher helpers ───────────────────────────────────────────────────

  const handlePressButton = useCallback((button: ButtonId) => {
    dispatch({ type: "PRESS_BUTTON", button });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
  }, []);

  const handleReleaseButton = useCallback((button: ButtonId) => {
    dispatch({ type: "RELEASE_BUTTON", button });
  }, []);

  const handleLeftStickMove = useCallback((x: number, y: number) => {
    dispatch({ type: "MOVE_LEFT_STICK", x, y });
  }, []);

  const handleLeftStickRelease = useCallback(() => {
    dispatch({ type: "RELEASE_LEFT_STICK" });
  }, []);

  const handleRightStickMove = useCallback((x: number, y: number) => {
    dispatch({ type: "MOVE_RIGHT_STICK", x, y });
  }, []);

  const handleRightStickRelease = useCallback(() => {
    dispatch({ type: "RELEASE_RIGHT_STICK" });
  }, []);

  const handleDPadChange = useCallback((direction: DPadDirection | null) => {
    dispatch({ type: "SET_DPAD", direction });
  }, []);

  const handleConnect = useCallback(
    (settings: ConnectionSettings) => {
      setConnectionSettings(settings);
      connect(settings);
    },
    [connect],
  );

  const togglePayloadDebug = useCallback(() => {
    setShowPayload((prev) => !prev);
  }, []);

  const openSettings = useCallback(() => {
    setSettingsVisible(true);
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.background}>
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
              <AnalogStick
                label="L"
                size={120}
                knobSize={52}
                onMove={handleLeftStickMove}
                onRelease={handleLeftStickRelease}
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
              host={connectionSettings.host}
              port={connectionSettings.port}
              sessionSeconds={sessionSeconds}
            />

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
              <AnalogStick
                label="R"
                size={120}
                knobSize={52}
                onMove={handleRightStickMove}
                onRelease={handleRightStickRelease}
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
    </View>

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
});
