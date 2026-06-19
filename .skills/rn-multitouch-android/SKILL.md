---
name: rn-multitouch-android
description: >
  Skill untuk mengimplementasikan multi-touch (hingga 10 sentuhan simultan) di
  React Native Android. Gunakan skill ini kapanpun ada topik: raw touch events,
  onTouchStart/onTouchMove/onTouchEnd, nativeEvent.changedTouches, identifier
  per jari, zone-based dispatching, lock-to-zone, floating joystick, analog
  stick virtual, tombol gamepad simultan, D-pad multi-touch, "sentuhan kedua
  tidak terdeteksi", "PanResponder tidak support multi-touch", atau kontrol
  game mobile. Trigger juga saat ada permintaan membangun gamepad controller,
  virtual joystick, layar sentuh untuk robotik, atau sistem input real-time
  di React Native yang membutuhkan lebih dari satu jari bekerja bersamaan.
---

# Multi-Touch di React Native Android

## Masalah Inti: Mengapa PanResponder Tidak Cukup

React Native punya "Responder System" — hanya **satu responder aktif** sekaligus
di seluruh aplikasi. `PanResponder` adalah wrapper di atas sistem ini, sehingga
juga single-touch by design.

Akibatnya: jempol kiri memegang left-stick → jari kanan menekan tombol A → sistem
mengabaikan jari kedua atau mencabut responder dari jari pertama.

**Solusi**: gunakan raw touch events langsung pada `<View>`, yang mem-bypass
responder system dan memberikan akses ke `nativeEvent.changedTouches[]` berisi
semua jari yang berubah di frame itu, masing-masing dengan `.identifier` unik.

```tsx
<View
  onTouchStart={handleStart}
  onTouchMove={handleMove}
  onTouchEnd={handleEnd}
  onTouchCancel={handleEnd}  {/* WAJIB di Android — lihat section Android Quirks */}
/>
```

> **Kapan tetap pakai react-native-gesture-handler (RNGH)?**
> - Swipe navigasi antar screen → RNGH `Gesture.Pan()`
> - Pinch/zoom → RNGH `Gesture.Pinch()`
> - Gamepad / multi-touch ≥ 3 zona simultan → raw `onTouch*` (lebih andal)

---

## Tiga Konsep Inti

### 1. Zone-based Dispatching

Bagi layar menjadi "zone". Tiap zone mendefinisikan `hitTest`, `onStart`,
`onMove`, dan `onEnd`. Satu `<View>` root menangkap semua touch dan merutekan
ke zone yang tepat.

```ts
interface TouchZone {
  id:       string;
  hitTest:  (x: number, y: number) => boolean; // dipanggil hanya saat onStart
  onStart:  (identifier: number, x: number, y: number) => void;
  onMove:   (identifier: number, x: number, y: number) => void;
  onEnd:    (identifier: number) => void;
}
```

### 2. Lock-to-Zone

Saat `onTouchStart`, cari zone pemilik berdasarkan posisi. Simpan di
`Map<identifier, zone>`. Semua `onMove` dan `onEnd` untuk identifier itu
selalu dikirim ke zone asal — tidak peduli jari bergerak ke mana.

Efek: jempol tidak "nyasar" ke zona lain saat bergerak.

### 3. First-Touch-Wins (untuk analog stick)

Satu analog stick hanya menerima **satu identifier sekaligus**. Jika ada jari
kedua masuk ke zone stick yang sama, diabaikan sampai jari pertama lift.

---

## Hook useMultiTouch — Core Dispatcher

```ts
import { useRef, useCallback } from 'react';
import { GestureResponderEvent } from 'react-native';

export function useMultiTouch(zones: TouchZone[]) {
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

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd };
}
```

**Penggunaan:**
```tsx
const zones = useMemo(() => [leftStick, rightStick, buttons, dpad], [callbacks]);
const handlers = useMultiTouch(zones);

return <View style={StyleSheet.absoluteFill} {...handlers} />;
```

---

## Pola Zone yang Sering Dipakai

### Floating Analog Stick

Stik muncul di posisi jari pertama, bukan posisi tetap. Lebih natural untuk jempol.

```ts
// Konstanta
const RADIUS   = 64;  // px — seberapa jauh drag untuk nilai ±100
const DEADZONE = 5;   // unit 0–100 — suppress drift mikro

let active: { ownerId: number; ox: number; oy: number } | null = null;

const leftStickZone: TouchZone = {
  id: 'left-stick',
  hitTest: (x) => x < SCREEN_W * 0.50,

  onStart(id, x, y) {
    if (active) return;                      // first-touch-wins
    active = { ownerId: id, ox: x, oy: y };
    onAxis(0, 0);
  },

  onMove(id, x, y) {
    if (!active || active.ownerId !== id) return;
    const dx = x - active.ox;
    const dy = y - active.oy;
    const dist  = Math.sqrt(dx * dx + dy * dy);
    const scale = dist > RADIUS ? RADIUS / dist : 1;
    const nx = Math.round((dx * scale / RADIUS) * 100);
    const ny = Math.round((dy * scale / RADIUS) * 100);
    onAxis(
      Math.abs(nx) >= DEADZONE ? nx : 0,
      Math.abs(ny) >= DEADZONE ? ny : 0,
    );
  },

  onEnd(id) {
    if (active?.ownerId !== id) return;
    active = null;
    onAxis(0, 0);
  },
};
```

### Tombol Simultan (A/B/X/Y)

Setiap jari menekan tombol berbeda secara independen.

```ts
const pressed = new Map<number, string>(); // identifier → button id

const buttonZone: TouchZone = {
  id: 'buttons',
  hitTest: (x, y) => buttons.some(b => hitCircle(b, x, y)),

  onStart(id, x, y) {
    const btn = buttons.find(b => hitCircle(b, x, y));
    if (!btn) return;
    pressed.set(id, btn.id);
    onButtonChange(btn.id, true);
  },

  onMove() {},  // tombol tidak respond gerakan

  onEnd(id) {
    const btnId = pressed.get(id);
    if (btnId) { onButtonChange(btnId, false); pressed.delete(id); }
  },
};

function hitCircle(btn: {cx:number; cy:number; r:number}, x:number, y:number) {
  return Math.sqrt((x - btn.cx) ** 2 + (y - btn.cy) ** 2) <= btn.r;
}
```

### D-Pad (4 Arah)

```ts
function detectDir(x: number, y: number, cx: number, cy: number) {
  const dx = x - cx, dy = y - cy;
  return Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? 'RIGHT' : 'LEFT')
    : (dy > 0 ? 'DOWN'  : 'UP');
}
```

---

## Aturan Performa (Wajib)

| Aturan | Alasan |
|--------|--------|
| Nilai axis → `useRef`, bukan `useState` | `useState` → re-render 60+×/detik = dropped frames |
| Throttle pengiriman payload: cap 16 ms | 60 fps cukup; kurangi beban network/BLE |
| Deadzone 5 unit sebelum dispatch | Kurangi packet flood saat jari hampir diam |
| `useMemo` untuk array `zones` | Hindari zones dibuat ulang tiap render |
| Spread `handlers` hanya ke **satu** root View | Satu capture point = tidak ada konflik handler |

```ts
// BENAR — axis di ref, dispatch throttled
const lx = useRef(0), ly = useRef(0);
const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

function schedulePayload() {
  if (sendTimer.current) return;
  sendTimer.current = setTimeout(() => {
    sendTimer.current = null;
    driver.send({ LX: lx.current, LY: ly.current, /* ... */ });
  }, 16);
}

// SALAH — jangan ini
const [lx, setLx] = useState(0); // re-render setiap frame → lag
```

---

## Android Quirks — Baca Sebelum Debug

Lihat `references/android-notes.md` untuk detail. Ringkasan kritis:

- **`onTouchCancel` wajib disertakan** — terjadi saat system interrupt (notifikasi,
  dialog). Tanpa ini, touch stuck di registry → zona tidak pernah di-reset.
- **Pakai `pageX/pageY`**, bukan `locationX/locationY` — koordinat absolut layar.
- **Test di perangkat fisik** — emulator biasanya hanya support 1 touch point.
- **Jangan campur PanResponder + raw touch** di View yang sama — konflik responder.
- **`collisionMask`** — jika RNGH aktif di parent, tambahkan `simultaneousHandlers`
  agar touch tidak dicuri.

---

## Referensi Kode Lengkap

- `references/patterns.md` — Implementasi penuh `useMultiTouch`, semua zone factory,
  integrasi Zustand, contoh GamePadScreen lengkap.
- `references/android-notes.md` — Android-specific quirks, debugging checklist,
  cara profil performa, penanganan pointer cancel.

Baca referensi ini saat membutuhkan kode siap pakai atau troubleshooting.