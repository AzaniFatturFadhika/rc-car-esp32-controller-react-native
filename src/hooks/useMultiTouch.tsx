import React, { createContext, useContext, useRef, useCallback, useEffect } from "react";
import { View, StyleSheet, GestureResponderEvent, ViewProps } from "react-native";

export interface TouchZone {
  id: string;
  hitTest: (x: number, y: number) => boolean;
  onStart: (identifier: number | string, x: number, y: number) => void;
  onMove: (identifier: number | string, x: number, y: number) => void;
  onEnd: (identifier: number | string) => void;
}

interface MultiTouchContextProps {
  registerZone: (zone: TouchZone) => () => void;
}

const MultiTouchContext = createContext<MultiTouchContextProps | null>(null);

export function useMultiTouchContext() {
  const ctx = useContext(MultiTouchContext);
  if (!ctx) {
    throw new Error("useMultiTouchContext must be used within a MultiTouchProvider");
  }
  return ctx;
}

interface MultiTouchProviderProps extends ViewProps {
  children: React.ReactNode;
  enabled?: boolean;
}

export function MultiTouchProvider({
  children,
  enabled = true,
  style,
  ...props
}: MultiTouchProviderProps) {
  const zonesRef = useRef<TouchZone[]>([]);
  const registry = useRef(new Map<number | string, TouchZone>());

  const registerZone = useCallback((zone: TouchZone) => {
    zonesRef.current.push(zone);
    return () => {
      zonesRef.current = zonesRef.current.filter((z) => z.id !== zone.id);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      registry.current.forEach((zone, identifier) => {
        zone.onEnd(identifier);
      });
      registry.current.clear();
    }
  }, [enabled]);

  const onTouchStart = useCallback(
    (e: GestureResponderEvent) => {
      if (!enabled) return;
      for (const t of e.nativeEvent.changedTouches) {
        // Use pageX/pageY for absolute coordinates
        const zone = zonesRef.current.find((z) => z.hitTest(t.pageX, t.pageY));
        if (zone) {
          registry.current.set(t.identifier, zone);
          zone.onStart(t.identifier, t.pageX, t.pageY);
        }
      }
    },
    [enabled]
  );

  const onTouchMove = useCallback(
    (e: GestureResponderEvent) => {
      if (!enabled) return;
      for (const t of e.nativeEvent.changedTouches) {
        registry.current.get(t.identifier)?.onMove(t.identifier, t.pageX, t.pageY);
      }
    },
    [enabled]
  );

  const onTouchEnd = useCallback(
    (e: GestureResponderEvent) => {
      if (!enabled) return;
      for (const t of e.nativeEvent.changedTouches) {
        const zone = registry.current.get(t.identifier);
        if (zone) {
          zone.onEnd(t.identifier);
          registry.current.delete(t.identifier);
        }
      }
    },
    [enabled]
  );

  return (
    <MultiTouchContext.Provider value={{ registerZone }}>
      <View
        style={[styles.container, style]}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd} // Handle system interrupts identically to touch end
        onStartShouldSetResponder={() => enabled}
        onMoveShouldSetResponder={() => enabled}
        {...props}
      >
        {children}
      </View>
    </MultiTouchContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
