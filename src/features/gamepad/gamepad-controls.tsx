import { memo, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMultiTouchContext } from "@/hooks/useMultiTouch";
import type { ActionButtonId, ButtonId, DPadDirection } from "./types";

type AnalogStickProps = {
  label: string;
  size: number;
  knobSize: number;
  deadzone?: number;
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

export const AnalogStick = memo(function AnalogStick({
  label,
  size,
  knobSize,
  deadzone = DEADZONE,
  onMove,
  onRelease,
}: AnalogStickProps) {
  const radius = (size - knobSize) / 2;
  const [knobOffset, setKnobOffset] = useState({ x: 0, y: 0 });

  const onMoveRef = useRef(onMove);
  const onReleaseRef = useRef(onRelease);

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    onReleaseRef.current = onRelease;
  }, [onRelease]);

  const containerRef = useRef<View>(null);
  const measureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [layout, setLayout] = useState<{
    pageX: number;
    pageY: number;
    width: number;
    height: number;
  } | null>(null);

  const onLayout = () => {
    let retries = 0;
    const doMeasure = () => {
      containerRef.current?.measure((x, y, width, height, pageX, pageY) => {
        if (
          typeof pageX === "number" && !isNaN(pageX) &&
          typeof pageY === "number" && !isNaN(pageY) &&
          typeof width === "number" && width > 0 &&
          typeof height === "number" && height > 0
        ) {
          setLayout({ pageX, pageY, width, height });
        } else if (retries < 10) {
          retries++;
          measureTimeoutRef.current = setTimeout(doMeasure, 50);
        }
      });
    };
    doMeasure();
  };

  useEffect(() => {
    return () => {
      if (measureTimeoutRef.current) {
        clearTimeout(measureTimeoutRef.current);
      }
    };
  }, []);

  const { registerZone } = useMultiTouchContext();

  useEffect(() => {
    if (!layout) return;

    const cx = layout.pageX + layout.width / 2;
    const cy = layout.pageY + layout.height / 2;

    let activeId: string | number | null = null;
    let lastAxis = { x: 0, y: 0 };

    const hitTest = (x: number, y: number) => {
      return (
        x >= layout.pageX &&
        x <= layout.pageX + layout.width &&
        y >= layout.pageY &&
        y <= layout.pageY + layout.height
      );
    };

    const handleStart = (id: string | number, x: number, y: number) => {
      if (activeId !== null) return;
      activeId = id;
      handleMove(id, x, y);
    };

    const handleMove = (id: string | number, x: number, y: number) => {
      if (activeId !== id) return;

      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.hypot(dx, dy);
      const limitedDistance = Math.min(distance, radius);

      let nextOffset = { x: 0, y: 0 };
      if (distance > 0) {
        nextOffset = {
          x: (dx / distance) * limitedDistance,
          y: (dy / distance) * limitedDistance,
        };
      }

      setKnobOffset(nextOffset);

      const nx = toAxis(nextOffset.x, radius);
      const ny = toAxis(nextOffset.y, radius);

      const ax = Math.abs(nx) >= deadzone ? nx : 0;
      const ay = Math.abs(ny) >= deadzone ? ny : 0;

      if (ax !== lastAxis.x || ay !== lastAxis.y) {
        lastAxis = { x: ax, y: ay };
        onMoveRef.current(ax, ay);
      }
    };

    const handleEnd = (id: string | number) => {
      if (activeId !== id) return;
      activeId = null;
      setKnobOffset({ x: 0, y: 0 });
      lastAxis = { x: 0, y: 0 };
      onReleaseRef.current();
    };

    const unsubscribe = registerZone({
      id: `analog-${label}`,
      hitTest,
      onStart: handleStart,
      onMove: handleMove,
      onEnd: handleEnd,
    });

    return unsubscribe;
  }, [layout, radius, deadzone, registerZone, label]);

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
      <View
        ref={containerRef}
        onLayout={onLayout}
        pointerEvents="none"
        accessible
        accessibilityHint="Drag to steer"
        accessibilityLabel={`${label} analog stick`}
        accessibilityRole="adjustable"
        style={[styles.stickTrack, dynamicStyles.track]}
      >
        <View style={[styles.stickKnob, dynamicStyles.knob]}>
          <Text style={styles.stickLabel}>{label}</Text>
        </View>
      </View>
    </View>
  );
});

type VerticalSliderProps = {
  label: string;
  width: number;
  height: number;
  onMove: (value: number) => void;
  onRelease: () => void;
};

export const VerticalSlider = memo(function VerticalSlider({
  label,
  width,
  height,
  onMove,
  onRelease,
}: VerticalSliderProps) {
  const [knobY, setKnobY] = useState(0); // offset from center, range: -halfHeight to halfHeight
  const halfHeight = height / 2;
  const knobSize = 40;
  const trackRange = halfHeight - knobSize / 2;

  const onMoveRef = useRef(onMove);
  const onReleaseRef = useRef(onRelease);

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    onReleaseRef.current = onRelease;
  }, [onRelease]);

  const containerRef = useRef<View>(null);
  const measureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [layout, setLayout] = useState<{
    pageX: number;
    pageY: number;
    width: number;
    height: number;
  } | null>(null);

  const onLayout = () => {
    let retries = 0;
    const doMeasure = () => {
      containerRef.current?.measure((x, y, w, h, pageX, pageY) => {
        if (
          typeof pageX === "number" && !isNaN(pageX) &&
          typeof pageY === "number" && !isNaN(pageY) &&
          typeof w === "number" && w > 0 &&
          typeof h === "number" && h > 0
        ) {
          setLayout({ pageX, pageY, width: w, height: h });
        } else if (retries < 10) {
          retries++;
          measureTimeoutRef.current = setTimeout(doMeasure, 50);
        }
      });
    };
    doMeasure();
  };

  useEffect(() => {
    return () => {
      if (measureTimeoutRef.current) {
        clearTimeout(measureTimeoutRef.current);
      }
    };
  }, []);

  const { registerZone } = useMultiTouchContext();

  useEffect(() => {
    if (!layout) return;

    const cy = layout.pageY + layout.height / 2;
    let activeId: string | number | null = null;
    let lastValue = 0;

    const hitTest = (x: number, y: number) => {
      return (
        x >= layout.pageX &&
        x <= layout.pageX + layout.width &&
        y >= layout.pageY &&
        y <= layout.pageY + layout.height
      );
    };

    const handleStart = (id: string | number, x: number, y: number) => {
      if (activeId !== null) return;
      activeId = id;
      handleMove(id, x, y);
    };

    const handleMove = (id: string | number, x: number, y: number) => {
      if (activeId !== id) return;

      const dy = y - cy;
      const limitedDy = clamp(dy, -trackRange, trackRange);

      setKnobY(limitedDy);

      // Invert so dragging UP produces positive values, DOWN produces negative values
      // -100 to 100
      const rawVal = Math.round((-limitedDy / trackRange) * 100);
      const val = Math.abs(rawVal) >= 5 ? rawVal : 0; // deadzone

      if (val !== lastValue) {
        lastValue = val;
        onMoveRef.current(val);
      }
    };

    const handleEnd = (id: string | number) => {
      if (activeId !== id) return;
      activeId = null;
      setKnobY(0);
      lastValue = 0;
      onReleaseRef.current();
    };

    const unsubscribe = registerZone({
      id: `slider-${label}`,
      hitTest,
      onStart: handleStart,
      onMove: handleMove,
      onEnd: handleEnd,
    });

    return unsubscribe;
  }, [layout, trackRange, registerZone, label]);

  const dynamicStyles = useMemo(
    () => ({
      track: { width, height, borderRadius: 10 },
      knob: {
        width: width - 4,
        height: knobSize,
        borderRadius: 8,
        transform: [{ translateY: knobY }],
      },
    }),
    [knobY, width, height]
  );

  return (
    <View style={styles.stickWrap}>
      <View
        ref={containerRef}
        onLayout={onLayout}
        pointerEvents="none"
        accessible
        accessibilityLabel={`${label} slider`}
        accessibilityRole="adjustable"
        style={[styles.stickTrack, dynamicStyles.track, { backgroundColor: '#1d2136' }]}
      >
        {/* Zero Center Line */}
        <View style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: 'rgba(255, 255, 255, 0.15)',
        }} />
        <View style={[styles.stickKnob, dynamicStyles.knob]} />
      </View>
    </View>
  );
});

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
      width: wide ? size * 2.4 : size,
      height: size,
      borderRadius: wide ? 12 : size / 2,
    }),
    [size, wide]
  );

  const containerRef = useRef<View>(null);
  const measureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [layout, setLayout] = useState<{
    pageX: number;
    pageY: number;
    width: number;
    height: number;
  } | null>(null);

  const onLayout = () => {
    let retries = 0;
    const doMeasure = () => {
      containerRef.current?.measure((x, y, width, height, pageX, pageY) => {
        if (
          typeof pageX === "number" && !isNaN(pageX) &&
          typeof pageY === "number" && !isNaN(pageY) &&
          typeof width === "number" && width > 0 &&
          typeof height === "number" && height > 0
        ) {
          setLayout({ pageX, pageY, width, height });
        } else if (retries < 10) {
          retries++;
          measureTimeoutRef.current = setTimeout(doMeasure, 50);
        }
      });
    };
    doMeasure();
  };

  useEffect(() => {
    return () => {
      if (measureTimeoutRef.current) {
        clearTimeout(measureTimeoutRef.current);
      }
    };
  }, []);

  const onPressInRef = useRef(onPressIn);
  const onPressOutRef = useRef(onPressOut);

  useEffect(() => {
    onPressInRef.current = onPressIn;
  }, [onPressIn]);

  useEffect(() => {
    onPressOutRef.current = onPressOut;
  }, [onPressOut]);

  const { registerZone } = useMultiTouchContext();

  useEffect(() => {
    if (!layout) return;

    let activeId: string | number | null = null;

    const hitTest = (x: number, y: number) => {
      return (
        x >= layout.pageX &&
        x <= layout.pageX + layout.width &&
        y >= layout.pageY &&
        y <= layout.pageY + layout.height
      );
    };

    const handleStart = (id: string | number) => {
      if (activeId !== null) return;
      activeId = id;
      onPressInRef.current();
    };

    const handleEnd = (id: string | number) => {
      if (activeId !== id) return;
      activeId = null;
      onPressOutRef.current();
    };

    const unsubscribe = registerZone({
      id: `btn-${label}-${variant}-${accessibilityLabel}`,
      hitTest,
      onStart: handleStart,
      onMove: () => {},
      onEnd: handleEnd,
    });

    return unsubscribe;
  }, [layout, registerZone, label, variant, accessibilityLabel]);

  return (
    <View
      ref={containerRef}
      onLayout={onLayout}
      pointerEvents="none"
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={[
        styles.button,
        dynamicStyle,
        styles[variant],
        active && styles.buttonActive,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          variant === "actionY" && styles.darkButtonText,
          label.length > 2 && { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
        ]}
      >
        {label}
      </Text>
    </View>
  );
});

export const DPad = memo(function DPad({
  activeDirection,
  onDirectionChange,
}: DPadProps) {
  const containerRef = useRef<View>(null);
  const measureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [layout, setLayout] = useState<{
    pageX: number;
    pageY: number;
    width: number;
    height: number;
  } | null>(null);

  const onLayout = () => {
    let retries = 0;
    const doMeasure = () => {
      containerRef.current?.measure((x, y, width, height, pageX, pageY) => {
        if (
          typeof pageX === "number" && !isNaN(pageX) &&
          typeof pageY === "number" && !isNaN(pageY) &&
          typeof width === "number" && width > 0 &&
          typeof height === "number" && height > 0
        ) {
          setLayout({ pageX, pageY, width, height });
        } else if (retries < 10) {
          retries++;
          measureTimeoutRef.current = setTimeout(doMeasure, 50);
        }
      });
    };
    doMeasure();
  };

  useEffect(() => {
    return () => {
      if (measureTimeoutRef.current) {
        clearTimeout(measureTimeoutRef.current);
      }
    };
  }, []);

  const onDirectionChangeRef = useRef(onDirectionChange);

  useEffect(() => {
    onDirectionChangeRef.current = onDirectionChange;
  }, [onDirectionChange]);

  const { registerZone } = useMultiTouchContext();

  useEffect(() => {
    if (!layout) return;

    const cx = layout.pageX + layout.width / 2;
    const cy = layout.pageY + layout.height / 2;

    let activeId: string | number | null = null;
    let lastDirection: DPadDirection | null = null;

    const hitTest = (x: number, y: number) => {
      return (
        x >= layout.pageX &&
        x <= layout.pageX + layout.width &&
        y >= layout.pageY &&
        y <= layout.pageY + layout.height
      );
    };

    const detectDirection = (x: number, y: number): DPadDirection | null => {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);

      if (dist < 15) return null;

      if (Math.abs(dx) > Math.abs(dy)) {
        return dx > 0 ? "RIGHT" : "LEFT";
      } else {
        return dy > 0 ? "DOWN" : "UP";
      }
    };

    const handleStart = (id: string | number, x: number, y: number) => {
      if (activeId !== null) return;
      activeId = id;
      const dir = detectDirection(x, y);
      lastDirection = dir;
      onDirectionChangeRef.current(dir);
    };

    const handleMove = (id: string | number, x: number, y: number) => {
      if (activeId !== id) return;
      const dir = detectDirection(x, y);
      if (dir !== lastDirection) {
        lastDirection = dir;
        onDirectionChangeRef.current(dir);
      }
    };

    const handleEnd = (id: string | number) => {
      if (activeId !== id) return;
      activeId = null;
      lastDirection = null;
      onDirectionChangeRef.current(null);
    };

    const unsubscribe = registerZone({
      id: "dpad",
      hitTest,
      onStart: handleStart,
      onMove: handleMove,
      onEnd: handleEnd,
    });

    return unsubscribe;
  }, [layout, registerZone]);

  return (
    <View
      ref={containerRef}
      onLayout={onLayout}
      pointerEvents="none"
      accessible
      accessibilityLabel="D-pad"
      style={styles.dpad}
    >
      <DPadButton
        direction="UP"
        label="▲"
        activeDirection={activeDirection}
        style={styles.dpadUp}
      />
      <DPadButton
        direction="LEFT"
        label="◄"
        activeDirection={activeDirection}
        style={styles.dpadLeft}
      />
      <DPadButton
        direction="RIGHT"
        label="►"
        activeDirection={activeDirection}
        style={styles.dpadRight}
      />
      <DPadButton
        direction="DOWN"
        label="▼"
        activeDirection={activeDirection}
        style={styles.dpadDown}
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
}: {
  direction: DPadDirection;
  label: string;
  activeDirection: DPadDirection | null;
  style: object;
}) {
  const isActive = activeDirection === direction;
  return (
    <View
      accessible
      accessibilityLabel={`${direction.toLowerCase()} D-pad`}
      accessibilityRole="button"
      style={[
        styles.dpadButton,
        style,
        isActive && styles.dpadButtonActive,
      ]}
    >
      <Text style={styles.dpadText}>{label}</Text>
    </View>
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
    opacity: 0.82,
    transform: [{ scale: 0.96 }],
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderColor: "rgba(255, 255, 255, 0.32)",
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
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
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
