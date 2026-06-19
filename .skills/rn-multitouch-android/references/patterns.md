# Pola Kode Multi-Touch React Native Android

## Daftar Isi
1. [useMultiTouch — hook utama](#usemultitouch)
2. [createAnalogStickZone — floating joystick](#analog-stick)
3. [createButtonZone — tombol simultan](#button-zone)
4. [createDpadZone — D-pad](#dpad)
5. [Zustand store gamepad](#zustand)
6. [GamePadScreen — integrasi penuh](#gamepadscreen)
7. [Throttle helper](#throttle)

---

## 1. useMultiTouch — Hook Utama {#usemultitouch}

```typescript
// hooks/useMultiTouch.ts

import { useRef, useCallback } from 'react';
import { GestureResponderEvent } from 'react-native';

export interface TouchZone {
  id:      string;
  hitTest: (x: number, y: number) => boolean;
  onStart: (identifier: number, x: number, y: number) => void;
  onMove:  (identifier: number, x: number, y: number) => void;
  onEnd:   (identifier: number) => void;
}

export function useMultiTouch(zones: TouchZone[]) {
  // Map<touch.identifier → zone pemilik touch itu>
  const registry = useRef(new Map<number, TouchZone>());

  const onTouchStart = useCallback((e: GestureResponderEvent) => {
    for (const t of e.nativeEvent.changedTouches) {
      const zone = zones.find(z => z.hitTest(t.pageX, t.pageY));
      if (zone) {
        registry.current.set(t.identifier, zone);
        zone.onStart(t.identifier, t.pageX, t.pageY);
      }
    }
  }, [zones]);

  const onTouchMove = useCallback((e: GestureResponderEvent) => {
    for (const t of e.nativeEvent.changedTouches) {
      registry.current.get(t.identifier)?.onMove(t.identifier, t.pageX, t.pageY);
    }
  }, []);

  const onTouchEnd = useCallback((e: GestureResponderEvent) => {
    for (const t of e.nativeEvent.changedTouches) {
      registry.current.get(t.identifier)?.onEnd(t.identifier);
      registry.current.delete(t.identifier);
    }
  }, []);

  // onTouchCancel: Android system interrupt (notifikasi, popup, dll.)
  // WAJIB di-handle — sama persis dengan onTouchEnd
  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: onTouchEnd,
  };
}
```

---

## 2. createAnalogStickZone — Floating Joystick {#analog-stick}

```typescript
// zones/analogStickZone.ts

import { Dimensions } from 'react-native';
import { TouchZone } from '../hooks/useMultiTouch';

const { width: SCREEN_W } = Dimensions.get('window');

const RADIUS   = 64;  // px — drag ini untuk capai nilai ±100
const DEADZONE = 5;   // unit — suppress drift saat jari hampir diam

interface StickVisual {
  knobX:    number | null;  // null = sembunyikan visual
  knobY:    number | null;
  originX:  number;
  originY:  number;
}

type OnAxis   = (x: number, y: number) => void;
type OnVisual = (v: StickVisual) => void;

export function createAnalogStickZone(
  side: 'left' | 'right',
  onAxis:   OnAxis,
  onVisual?: OnVisual,
): TouchZone {

  const zoneLeft  = side === 'left' ? 0              : SCREEN_W * 0.50;
  const zoneRight = side === 'left' ? SCREEN_W * 0.50 : SCREEN_W;

  // Internal state — BUKAN React state, tidak trigger re-render
  let active: { ownerId: number; ox: number; oy: number } | null = null;

  return {
    id: `${side}-stick`,

    hitTest(x) {
      return x >= zoneLeft && x < zoneRight;
    },

    onStart(id, x, y) {
      if (active) return;  // first-touch-wins
      active = { ownerId: id, ox: x, oy: y };
      onVisual?.({ knobX: x, knobY: y, originX: x, originY: y });
      onAxis(0, 0);
    },

    onMove(id, x, y) {
      if (!active || active.ownerId !== id) return;

      const dx    = x - active.ox;
      const dy    = y - active.oy;
      const dist  = Math.sqrt(dx * dx + dy * dy);
      const scale = dist > RADIUS ? RADIUS / dist : 1;

      const nx = Math.round((dx * scale / RADIUS) * 100);
      const ny = Math.round((dy * scale / RADIUS) * 100);

      onVisual?.({
        knobX:   active.ox + dx * scale,
        knobY:   active.oy + dy * scale,
        originX: active.ox,
        originY: active.oy,
      });

      onAxis(
        Math.abs(nx) >= DEADZONE ? nx : 0,
        Math.abs(ny) >= DEADZONE ? ny : 0,
      );
    },

    onEnd(id) {
      if (active?.ownerId !== id) return;
      active = null;
      onVisual?.({ knobX: null, knobY: null, originX: 0, originY: 0 });
      onAxis(0, 0);
    },
  };
}
```

**Varian: Fixed Stick** (posisi tetap, bukan floating):
```typescript
// Ganti onStart menjadi:
onStart(id, _x, _y) {
  if (active) return;
  // ox/oy selalu di tengah grafis stik, bukan posisi jari
  active = { ownerId: id, ox: STICK_CENTER_X, oy: STICK_CENTER_Y };
  onAxis(0, 0);
},
```

---

## 3. createButtonZone — Tombol Simultan {#button-zone}

```typescript
// zones/buttonZone.ts

import { TouchZone } from '../hooks/useMultiTouch';

export interface CircleButton {
  id: string; cx: number; cy: number; r: number;
}

export interface RectButton {
  id: string; x: number; y: number; w: number; h: number;
}

type AnyButton = CircleButton | RectButton;

function isCircle(b: AnyButton): b is CircleButton { return 'cx' in b; }

function hit(b: AnyButton, x: number, y: number): boolean {
  if (isCircle(b)) {
    return Math.sqrt((x - b.cx) ** 2 + (y - b.cy) ** 2) <= b.r;
  }
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

export function createButtonZone(
  buttons: AnyButton[],
  onChange: (id: string, pressed: boolean) => void,
): TouchZone {
  const pressed = new Map<number, string>(); // identifier → button id

  return {
    id: 'buttons',

    hitTest(x, y) { return buttons.some(b => hit(b, x, y)); },

    onStart(id, x, y) {
      const btn = buttons.find(b => hit(b, x, y));
      if (!btn) return;
      pressed.set(id, btn.id);
      onChange(btn.id, true);
    },

    onMove() {
      // Tombol tidak bereaksi terhadap gerakan.
      // Jika ingin "slide to cancel" (lepas tombol saat jari geser keluar),
      // bandingkan posisi baru dengan btn yang tersimpan di pressed.
    },

    onEnd(id) {
      const btnId = pressed.get(id);
      if (btnId !== undefined) {
        onChange(btnId, false);
        pressed.delete(id);
      }
    },
  };
}
```

---

## 4. createDpadZone — D-Pad {#dpad}

```typescript
// zones/dpadZone.ts

import { TouchZone } from '../hooks/useMultiTouch';

export type DpadDir = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | null;

function detectDir(x: number, y: number, cx: number, cy: number): DpadDir {
  const dx = x - cx, dy = y - cy;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'RIGHT' : 'LEFT';
  return dy > 0 ? 'DOWN' : 'UP';
}

export function createDpadZone(
  cx: number, cy: number, halfSize: number,
  onDir: (dir: DpadDir) => void,
): TouchZone {
  const active = new Map<number, DpadDir>(); // identifier → arah aktif

  return {
    id: 'dpad',

    hitTest(x, y) {
      return Math.abs(x - cx) <= halfSize && Math.abs(y - cy) <= halfSize;
    },

    onStart(id, x, y) {
      const dir = detectDir(x, y, cx, cy);
      active.set(id, dir);
      onDir(dir);
    },

    onMove(id, x, y) {
      const newDir = detectDir(x, y, cx, cy);
      if (active.get(id) !== newDir) {
        active.set(id, newDir);
        onDir(newDir);
      }
    },

    onEnd(id) {
      active.delete(id);
      if (active.size === 0) onDir(null);
    },
  };
}
```

---

## 5. Zustand Store Gamepad {#zustand}

```typescript
// store/gamepadStore.ts

import { create } from 'zustand';

interface GamepadState {
  LX: number; LY: number;
  RX: number; RY: number;
  DPAD: string | null;
  buttons: Set<string>;

  setLeftAxis:  (x: number, y: number) => void;
  setRightAxis: (x: number, y: number) => void;
  setDpad:      (dir: string | null)   => void;
  setButton:    (id: string, on: boolean) => void;
}

export const useGamepadStore = create<GamepadState>((set) => ({
  LX: 0, LY: 0, RX: 0, RY: 0, DPAD: null, buttons: new Set(),

  setLeftAxis:  (x, y) => set({ LX: x, LY: y }),
  setRightAxis: (x, y) => set({ RX: x, RY: y }),
  setDpad:      (dir)  => set({ DPAD: dir }),

  setButton: (id, on) => set(s => {
    const buttons = new Set(s.buttons);
    on ? buttons.add(id) : buttons.delete(id);
    return { buttons };
  }),
}));
```

> **Catatan performa**: Untuk nilai axis yang berubah 60+×/detik, lebih baik
> pakai `useRef` di dalam zone + satu scheduler timer, dan hanya panggil
> Zustand saat throttle timer firing. Lihat [Throttle Helper](#throttle).

---

## 6. GamePadScreen — Integrasi Penuh {#gamepadscreen}

```typescript
// screens/GamePadScreen.tsx

import React, { useMemo, useRef, useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { useMultiTouch }       from '../hooks/useMultiTouch';
import { createAnalogStickZone } from '../zones/analogStickZone';
import { createButtonZone }    from '../zones/buttonZone';
import { createDpadZone }      from '../zones/dpadZone';

const { width: W, height: H } = Dimensions.get('window');

const ACTION_BTNS = [
  { id: 'Y', cx: W - 100, cy: H * 0.30, r: 30 },
  { id: 'X', cx: W - 145, cy: H * 0.50, r: 30 },
  { id: 'B', cx: W - 55,  cy: H * 0.50, r: 30 },
  { id: 'A', cx: W - 100, cy: H * 0.70, r: 30 },
];

const TRIGGERS = [
  { id: 'LT', x: 20,     y: 0, w: 72, h: 36 },
  { id: 'LB', x: 20,     y: 44, w: 72, h: 32 },
  { id: 'RT', x: W - 92, y: 0, w: 72, h: 36 },
  { id: 'RB', x: W - 92, y: 44, w: 72, h: 32 },
];

export function GamePadScreen({ driver }: { driver: { send: (p: object) => void } }) {
  // Semua nilai axis di ref — tidak trigger re-render
  const state = useRef({ LX: 0, LY: 0, RX: 0, RY: 0, DPAD: null as string | null, BTN: new Set<string>() });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flush() {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const s = state.current;
      driver.send({ LX: s.LX, LY: s.LY, RX: s.RX, RY: s.RY, DPAD: s.DPAD, BTN: [...s.BTN] });
    }, 16);
  }

  const zones = useMemo(() => [
    createAnalogStickZone('left',  (x, y) => { state.current.LX = x; state.current.LY = y; flush(); }),
    createAnalogStickZone('right', (x, y) => { state.current.RX = x; state.current.RY = y; flush(); }),
    createButtonZone(ACTION_BTNS,  (id, on) => { on ? state.current.BTN.add(id) : state.current.BTN.delete(id); flush(); }),
    createButtonZone(TRIGGERS,     (id, on) => { on ? state.current.BTN.add(id) : state.current.BTN.delete(id); flush(); }),
    createDpadZone(130, H * 0.65, 55, (dir) => { state.current.DPAD = dir; flush(); }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []); // deps kosong: callbacks captured via ref, zones stabil selamanya

  const handlers = useMultiTouch(zones);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <View style={StyleSheet.absoluteFill} {...handlers}>
      {/* Render visual stik, tombol, dpad di sini */}
    </View>
  );
}
```

---

## 7. Throttle Helper {#throttle}

```typescript
// utils/throttle.ts

/**
 * Membuat fungsi throttle yang hanya memanggil fn maksimal
 * satu kali per `intervalMs`.
 * Berguna untuk membatasi frekuensi pengiriman payload gamepad.
 */
export function makeThrottle(intervalMs: number) {
  let pending: ReturnType<typeof setTimeout> | null = null;

  return function schedule(fn: () => void) {
    if (pending !== null) return;
    pending = setTimeout(() => {
      pending = null;
      fn();
    }, intervalMs);
  };
}

// Penggunaan:
// const schedule = makeThrottle(16); // cap 60fps
// schedule(() => driver.send(payload));
```