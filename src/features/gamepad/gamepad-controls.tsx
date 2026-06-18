import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
    Gesture,
    GestureDetector,
    type PanGesture,
} from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import type { ActionButtonId, ButtonId, DPadDirection } from "./types";

type AnalogStickProps = {
  label: string;
  size: number;
  knobSize: number;
  deadzone?: number;
  /** Pre-built pan gesture with simultaneous multi-touch already configured. */
  gesture: PanGesture;
  onMove: (x: number, y: number) => void;
  onRelease: () => void;
};

type DigitalButtonProps = {
  label: string;
  accessibilityLabel: string;
  active?: boolean;
  variant?:
    | "actionA"
    | "actionB"
    | "actionX"
    | "actionY"
    | "shoulder"
    | "center";
  size?: number;
  wide?: boolean;
  onPressIn: () => void;
  onPressOut: () => void;
};

type DPadProps = {
  activeDirection: DPadDirection | null;
  onDirectionChange: (direction: DPadDirection | null) => void;
};

const DEADZONE = 5;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toAxis(delta: number, radius: number) {
  return Math.round(clamp((delta / radius) * 100, -100, 100));
}

function usePressHandlers(onPressIn: () => void, onPressOut: () => void) {
  return {
    onPressIn,
    onPressOut,
    onPressOutCapture: onPressOut,
  };
}

export const AnalogStick = memo(function AnalogStick({
  label,
  size,
  knobSize,
  deadzone = DEADZONE,
  gesture,
  onMove,
  onRelease,
}: AnalogStickProps) {
  const radius = (size - knobSize) / 2;
  const [knobOffset, setKnobOffset] = useState({ x: 0, y: 0 });
  const lastAxisRef = useRef({ x: 0, y: 0 });

  const onMoveShared = useSharedValue(onMove);
  const onReleaseShared = useSharedValue(onRelease);

  useEffect(() => {
    onMoveShared.value = onMove;
    onReleaseShared.value = onRelease;
  }, [onMove, onRelease]);

  // Rebind gesture callbacks whenever move/release or size changes.
  // The gesture identity stays stable (same object reference) so
  // GestureDetector does not remount, but RNGH reads the latest
  // shared values on every event.
  useEffect(() => {
    gesture
      .onUpdate((e) => {
        const distance = Math.hypot(e.translationX, e.translationY);
        const limitedDistance = Math.min(distance, radius);
        const angle = Math.atan2(e.translationY, e.translationX);
        const nextOffset = {
          x: Math.cos(angle) * limitedDistance,
          y: Math.sin(angle) * limitedDistance,
        };
        const nextAxis = {
          x: toAxis(nextOffset.x, radius),
          y: toAxis(nextOffset.y, radius),
        };

        setKnobOffset(nextOffset);

        if (
          Math.abs(nextAxis.x - lastAxisRef.current.x) >= deadzone ||
          Math.abs(nextAxis.y - lastAxisRef.current.y) >= deadzone
        ) {
          lastAxisRef.current = nextAxis;
          scheduleOnRN(onMoveShared.value, nextAxis.x, nextAxis.y);
        }
      })
      .onEnd(() => {
        lastAxisRef.current = { x: 0, y: 0 };
        setKnobOffset({ x: 0, y: 0 });
        scheduleOnRN(onReleaseShared.value);
      })
      .onFinalize(() => {
        lastAxisRef.current = { x: 0, y: 0 };
        setKnobOffset({ x: 0, y: 0 });
        scheduleOnRN(onReleaseShared.value);
      });
  }, [gesture, radius, deadzone, onMoveShared, onReleaseShared]);

  const dynamicStyles = useMemo(
    () => ({
      track: { width: size, height: size, borderRadius: size / 2 },
      knob: {
        width: knobSize,
        height: knobSize,
        borderRadius: knobSize / 2,
        transform: [{ translateX: knobOffset.x }, { translateY: knobOffset.y }],
      },
    }),
    [knobOffset.x, knobOffset.y, knobSize, size]
  );

  return (
    <View style={styles.stickWrap}>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityHint="Drag to steer"
          accessibilityLabel={`${label} analog stick`}
          accessibilityRole="adjustable"
          style={[styles.stickTrack, dynamicStyles.track]}>
          <View style={[styles.stickKnob, dynamicStyles.knob]}>
            <Text style={styles.stickLabel}>{label}</Text>
          </View>
        </View>
      </GestureDetector>
    </View>
  );
});

/**
 * Create two linked pan gestures that recognize touches simultaneously
 * on Android. Call once at the parent level (not inside a child component)
 * so both gestures exist before `.simultaneousWithExternalGesture()` runs.
 */
export function useDualStickGestures() {
  const pairRef = useRef<{ left: PanGesture; right: PanGesture } | null>(null);

  if (!pairRef.current) {
    const left = Gesture.Pan()
      .minPointers(1)
      .maxPointers(1)
      .shouldCancelWhenOutside(false)
      .activeOffsetX(-Number.MIN_VALUE) // activate immediately on any movement
      .activeOffsetY(-Number.MIN_VALUE);

    const right = Gesture.Pan()
      .minPointers(1)
      .maxPointers(1)
      .shouldCancelWhenOutside(false)
      .activeOffsetX(-Number.MIN_VALUE)
      .activeOffsetY(-Number.MIN_VALUE);

    // Bidirectional simultaneous recognition — this is the key to
    // multi-touch on Android's single-responder system.
    left.simultaneousWithExternalGesture(right);
    right.simultaneousWithExternalGesture(left);

    pairRef.current = { left, right };
  }

  return pairRef.current;
}

export const DigitalButton = memo(function DigitalButton({
  label,
  accessibilityLabel,
  active = false,
  variant = "center",
  size = 56,
  wide = false,
  onPressIn,
  onPressOut,
}: DigitalButtonProps) {
  const dynamicStyle = useMemo(
    () => ({
      width: wide ? size * 1.65 : size,
      height: size,
      borderRadius: wide ? 10 : size / 2,
    }),
    [size, wide],
  );
  const handlers = usePressHandlers(onPressIn, onPressOut);

  return (
    <Pressable
      {...handlers}
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        dynamicStyle,
        styles[variant],
        (pressed || active) && styles.buttonActive,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          variant === "actionY" && styles.darkButtonText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
});

export const DPad = memo(function DPad({
  activeDirection,
  onDirectionChange,
}: DPadProps) {
  const pressDirection = (direction: DPadDirection) => () =>
    onDirectionChange(direction);
  const releaseDirection = (direction: DPadDirection) => () => {
    if (activeDirection === direction) {
      onDirectionChange(null);
    }
  };

  return (
    <View accessible accessibilityLabel="D-pad" style={styles.dpad}>
      <DPadButton
        direction="UP"
        label="▲"
        activeDirection={activeDirection}
        style={styles.dpadUp}
        onPressIn={pressDirection("UP")}
        onPressOut={releaseDirection("UP")}
      />
      <DPadButton
        direction="LEFT"
        label="◄"
        activeDirection={activeDirection}
        style={styles.dpadLeft}
        onPressIn={pressDirection("LEFT")}
        onPressOut={releaseDirection("LEFT")}
      />
      <DPadButton
        direction="RIGHT"
        label="►"
        activeDirection={activeDirection}
        style={styles.dpadRight}
        onPressIn={pressDirection("RIGHT")}
        onPressOut={releaseDirection("RIGHT")}
      />
      <DPadButton
        direction="DOWN"
        label="▼"
        activeDirection={activeDirection}
        style={styles.dpadDown}
        onPressIn={pressDirection("DOWN")}
        onPressOut={releaseDirection("DOWN")}
      />
      <View style={styles.dpadCenter} />
    </View>
  );
});

function DPadButton({
  direction,
  label,
  activeDirection,
  style,
  onPressIn,
  onPressOut,
}: {
  direction: DPadDirection;
  label: string;
  activeDirection: DPadDirection | null;
  style: object;
  onPressIn: () => void;
  onPressOut: () => void;
}) {
  const isActive = activeDirection === direction;
  return (
    <Pressable
      accessible
      accessibilityLabel={`${direction.toLowerCase()} D-pad`}
      accessibilityRole="button"
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => [
        styles.dpadButton,
        style,
        (pressed || isActive) && styles.dpadButtonActive,
      ]}
    >
      <Text style={styles.dpadText}>{label}</Text>
    </Pressable>
  );
}

export function getActionVariant(button: ActionButtonId) {
  const variants = {
    A: "actionA",
    B: "actionB",
    X: "actionX",
    Y: "actionY",
  } satisfies Record<
    ActionButtonId,
    NonNullable<DigitalButtonProps["variant"]>
  >;

  return variants[button];
}

export function buttonIsActive(buttons: ButtonId[], button: ButtonId) {
  return buttons.includes(button);
}

const styles = StyleSheet.create({
  stickWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  stickTrack: {
    alignItems: "center",
    backgroundColor: "#24283d",
    borderColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    justifyContent: "center",
  },
  stickKnob: {
    alignItems: "center",
    backgroundColor: "#5a5aff",
    borderColor: "rgba(255,255,255,0.36)",
    borderWidth: 1,
    elevation: 5,
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
  },
  stickLabel: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },
  button: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
  },
  buttonActive: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  darkButtonText: {
    color: "#251b00",
  },
  actionA: {
    backgroundColor: "#00a960",
  },
  actionB: {
    backgroundColor: "#d14a3f",
  },
  actionX: {
    backgroundColor: "#287bd8",
  },
  actionY: {
    backgroundColor: "#f1c84b",
  },
  shoulder: {
    backgroundColor: "#3a3a5c",
  },
  center: {
    backgroundColor: "rgba(255,255,255,0.09)",
  },
  dpad: {
    height: 132,
    position: "relative",
    width: 132,
  },
  dpadButton: {
    alignItems: "center",
    backgroundColor: "#343851",
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 10,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    position: "absolute",
    width: 44,
  },
  dpadButtonActive: {
    backgroundColor: "#5a5aff",
  },
  dpadText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
  },
  dpadUp: {
    left: 44,
    top: 0,
  },
  dpadLeft: {
    left: 0,
    top: 44,
  },
  dpadRight: {
    right: 0,
    top: 44,
  },
  dpadDown: {
    bottom: 0,
    left: 44,
  },
  dpadCenter: {
    backgroundColor: "#343851",
    borderRadius: 10,
    height: 44,
    left: 44,
    position: "absolute",
    top: 44,
    width: 44,
  },
});
