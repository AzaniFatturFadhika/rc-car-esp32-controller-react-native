# GamePad UI Components Reference

## Layout Container

```
┌─────────────────────────────────────────────────────────┐
│  LT   LB      ┌───────────────────┐      RB   RT       │
│               │  VIEW  ⬡  MENU    │                     │
│  ↑            │    LS     RS      │          Y          │
│ ←↓→           └───────────────────┘      X       B      │
│                                              A          │
│        ◉ LEFT                      RIGHT ◉             │
│          STICK                      STICK               │
└─────────────────────────────────────────────────────────┘
```

All elements use `position: 'absolute'` inside a `View` that fills the screen width.
Enable with `flex: 1` on the root + `StyleSheet.absoluteFill` approach.

---

## AnalogStick Component

### Props

| Prop        | Type                             | Description                                                  |
| ----------- | -------------------------------- | ------------------------------------------------------------ |
| `size`      | `number`                         | Outer ring diameter (px). Suggested: 160 (left), 140 (right) |
| `knobSize`  | `number`                         | Draggable knob diameter. Suggested: 60                       |
| `deadzone`  | `number`                         | Min axis value to emit (default 5)                           |
| `onMove`    | `(x: number, y: number) => void` | Called when axis changes beyond deadzone                     |
| `onRelease` | `() => void`                     | Called when touch released (resets to 0,0)                   |

### State shape

```ts
type StickState = { x: number; y: number }; // -100 to 100
```

### Gesture setup (PanResponder)

```ts
const panResponder = PanResponder.create({
  onStartShouldSetPanResponder: () => true,
  onPanResponderMove: (_, g) => {
    const nx = toAxis(g.dx, radius);
    const ny = toAxis(g.dy, radius);
    if (
      Math.abs(nx - lastX.current) >= deadzone ||
      Math.abs(ny - lastY.current) >= deadzone
    ) {
      lastX.current = nx;
      lastY.current = ny;
      onMove(nx, ny);
    }
  },
  onPanResponderRelease: () => {
    lastX.current = 0;
    lastY.current = 0;
    onRelease();
  },
});
```

---

## DPad Component

Four directional press zones arranged in a plus (+) shape.  
Each direction emits a discrete boolean (pressed / released).

### Props

| Prop                | Type                                                 | Description                                  |
| ------------------- | ---------------------------------------------------- | -------------------------------------------- |
| `size`              | `number`                                             | Total bounding box size (px). Suggested: 130 |
| `onDirectionChange` | `(dir: 'UP'\|'DOWN'\|'LEFT'\|'RIGHT'\|null) => void` | Direction change handler                     |

Only one direction active at a time (first-touch wins).

---

## ActionButton Component

Circular buttons: **A** (green), **B** (red), **X** (blue), **Y** (yellow).

### Props

| Prop         | Type                 | Description                  |
| ------------ | -------------------- | ---------------------------- |
| `label`      | `'A'\|'B'\|'X'\|'Y'` | Button identity              |
| `size`       | `number`             | Diameter (px). Suggested: 56 |
| `onPressIn`  | `() => void`         | Button down                  |
| `onPressOut` | `() => void`         | Button up                    |

Use `onPressIn` / `onPressOut` (not `onPress`) for real-time hold detection.

---

## Trigger / Bumper Buttons

### LT / RT (Triggers — analog in real pads, digital here)

Rectangular button, height 44 px, width 72 px.  
Emit `1` on press, `0` on release. Future: could use a Slider for analog depth.

### LB / RB (Bumpers)

Smaller rectangular button, height 36 px, width 64 px.  
Same digital emit as triggers.

---

## Center Panel

| Element                 | Description                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| **View Button**         | Two overlapping square icon. Opens BLE/Wi-Fi settings sheet.                                               |
| **Home/Status**         | Xbox-style circle. Shows connection dot (green/yellow/red). Shows session timer text below when connected. |
| **Menu Button**         | Hamburger (three lines). Opens button remapping / calibration screen.                                      |
| **LS Click / RS Click** | Small circular buttons labelled L3 / R3. Emit discrete events.                                             |

---

## Styling Tokens

```ts
export const GamePadTheme = {
  bg: "#1a1a2e", // Dark navy game background
  panelBg: "rgba(255,255,255,0.05)", // Translucent panel
  stickTrack: "#2d2d44",
  stickKnob: "#5a5aff",
  btnA: "#00b050",
  btnB: "#c00000",
  btnX: "#0070c0",
  btnY: "#ffc000",
  triggerBg: "#3a3a5c",
  statusGreen: "#00ff88",
  statusYellow: "#ffcc00",
  statusRed: "#ff4444",
  textPrimary: "#ffffff",
  textSecondary: "#aaaacc",
};
```

---

## Z-Index Layering

```
0 — Background gradient
1 — Panel containers (left, center, right)
2 — Stick track circles
3 — D-pad, bumpers, triggers
4 — Stick knobs (draggable, on top of track)
5 — Center status overlay
```

---

## Accessibility Notes

- All buttons should have `accessible={true}` and `accessibilityLabel`.
- Analog sticks: provide `accessibilityHint="Drag to steer"`.
- Ensure minimum touch target of 44×44 pt per Apple HIG / Material guidelines.
