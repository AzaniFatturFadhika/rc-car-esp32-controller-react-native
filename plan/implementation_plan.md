# Fix Audit Findings — Bugs, Missing Features, & Technical Debt

Menyelesaikan semua temuan dari audit progress: 3 bug, 2 fitur yang belum ada, 1 dead code, dan 3 pre-existing ESLint errors.

## Proposed Changes

### 🔴 Bug Fixes

---

#### [MODIFY] [gamepad-controls.tsx](file:///home/fadhika/Documents/GitHub/controller-react-native/src/features/gamepad/gamepad-controls.tsx)

**Bug #2: D-Pad label salah — LEFT = "LT", RIGHT = "RT"**

Ganti label agar tidak ambigu dengan shoulder buttons:
- `"LT"` → `"◄"` (direction LEFT)
- `"RT"` → `"►"` (direction RIGHT)
- `"DN"` → `"▼"` (direction DOWN, konsistensi)
- `"UP"` → `"▲"` (direction UP, konsistensi)

**Bug #5 (ESLint): `react-hooks/refs` — PanResponder.create dalam useMemo**

Ganti `useMemo` → `useRef` + init pattern untuk PanResponder, agar ref access tidak terjadi di dalam render memo. Pattern:

```tsx
const panResponderRef = useRef<PanResponderInstance | null>(null);
if (!panResponderRef.current) {
  panResponderRef.current = PanResponder.create({ ... });
}
```

Karena PanResponder hanya perlu dibuat sekali dan callback-nya sudah membaca state dari ref, ini aman.

---

#### [MODIFY] [index.tsx](file:///home/fadhika/Documents/GitHub/controller-react-native/src/app/index.tsx)

**Bug #1: VIEW & MENU button dispatch LS/RS — seharusnya terpisah**

VIEW dan MENU bukan gamepad button yang dikirim ke ESP32 — mereka adalah UI action button. Fix:
- **VIEW** → toggle payload debug visibility (atau no-op untuk sekarang). Hilangkan `onPressIn: () => handlePressButton('LS')`.
- **MENU** → sama dengan ⚙ settings, atau no-op. Hilangkan `onPressIn: () => handlePressButton('RS')`.

Alternatif yang lebih baik: jadikan VIEW untuk toggle payload debug, MENU untuk toggle settings sheet (sama seperti ⚙). Ini memberi keduanya fungsi yang berguna.

> [!IMPORTANT]
> VIEW dan MENU tidak perlu mengirim data ke ESP32 — mereka murni UI control. LS/RS click tetap di tempatnya sendiri di bawah stick.

---

### 🟡 Missing Features

---

#### [MODIFY] [connection-status-bar.tsx](file:///home/fadhika/Documents/GitHub/controller-react-native/src/features/gamepad/connection-status-bar.tsx)

**Bug #3: Pulse animation tidak ada**

Tambah Reanimated `useSharedValue` + `useAnimatedStyle` untuk opacity pulse saat `connecting` atau `reconnecting`. Pattern:

```tsx
// Shared value oscillates 0.3 → 1.0 → 0.3 setiap 800ms
const pulseOpacity = useSharedValue(1);

useEffect(() => {
  if (config.pulse) {
    pulseOpacity.value = withRepeat(
      withTiming(0.3, { duration: 800 }),
      -1, // infinite
      true  // reverse
    );
  } else {
    cancelAnimation(pulseOpacity);
    pulseOpacity.value = 1;
  }
}, [config.pulse]);
```

Dot menggunakan `Animated.View` dengan `useAnimatedStyle({ opacity: pulseOpacity.value })`.

**Session timer**

Tambah prop `connectedSince: number | null` (timestamp saat connected). Render `MM:SS` di bawah status label. Timer di-tick dari `index.tsx` via `useEffect` + `setInterval` 1 detik saat status connected.

---

#### [MODIFY] [index.tsx](file:///home/fadhika/Documents/GitHub/controller-react-native/src/app/index.tsx) (lanjutan)

**Session timer state**

- Tambah `const [connectedAt, setConnectedAt] = useState<number | null>(null)` dan `const [sessionSeconds, setSessionSeconds] = useState(0)`.
- Saat `status === 'connected'`, set `connectedAt = Date.now()` dan start interval 1s yang increment `sessionSeconds`.
- Saat bukan connected, clear interval dan reset.
- Pass `sessionSeconds` ke `ConnectionStatusBar`.

**Payload debug toggle**

- Tambah `const [showPayload, setShowPayload] = useState(true)`.
- VIEW button → `onPressIn: () => setShowPayload(prev => !prev)`.
- Payload debug `<Text>` hanya render saat `showPayload === true`.

---

### 🔵 Technical Debt Cleanup

---

#### [MODIFY] [use-wifi-transport.ts](file:///home/fadhika/Documents/GitHub/controller-react-native/src/features/gamepad/use-wifi-transport.ts)

**Dead code: `settingsRef` tidak dipakai**

Hapus `settingsRef` (line 21) dan assignment-nya di `connect` (line 151). Reconnect sudah menerima settings via closure di `openSocket`.

**ESLint: `react-hooks/immutability` — `openSocket` diakses sebelum deklarasi**

Refactor: pindahkan `openSocket` ke sebelum `disconnect`, atau ganti recursive call menjadi ref-based approach:

```tsx
const openSocketRef = useRef<(...) => void>();
// ... define openSocket ...
openSocketRef.current = openSocket;
// di reconnect callback: openSocketRef.current?.(settings, attempt + 1);
```

Ini menghilangkan masalah circular dependency tanpa mengubah behavior.

---

#### [DELETE] [explore.tsx](file:///home/fadhika/Documents/GitHub/controller-react-native/src/app/explore.tsx)

File starter Expo yang tidak digunakan lagi setelah tab navigator dihapus. 6.5KB dead code.

---

#### [MODIFY] Orphaned starter components (opsional)

File-file berikut adalah sisa dari Expo starter template dan tidak digunakan oleh gamepad:

- [app-tabs.tsx](file:///home/fadhika/Documents/GitHub/controller-react-native/src/components/app-tabs.tsx) — NativeTabs yang sudah dihapus dari layout
- [app-tabs.web.tsx](file:///home/fadhika/Documents/GitHub/controller-react-native/src/components/app-tabs.web.tsx) — idem
- [animated-icon.tsx](file:///home/fadhika/Documents/GitHub/controller-react-native/src/components/animated-icon.tsx) — splash icon, tidak di-render lagi
- [animated-icon.web.tsx](file:///home/fadhika/Documents/GitHub/controller-react-native/src/components/animated-icon.web.tsx) — idem (juga sumber tsc error)
- [hint-row.tsx](file:///home/fadhika/Documents/GitHub/controller-react-native/src/components/hint-row.tsx) — starter component
- [web-badge.tsx](file:///home/fadhika/Documents/GitHub/controller-react-native/src/components/web-badge.tsx) — starter component
- [external-link.tsx](file:///home/fadhika/Documents/GitHub/controller-react-native/src/components/external-link.tsx) — starter component
- [themed-text.tsx](file:///home/fadhika/Documents/GitHub/controller-react-native/src/components/themed-text.tsx) — starter component
- [themed-view.tsx](file:///home/fadhika/Documents/GitHub/controller-react-native/src/components/themed-view.tsx) — starter component

> [!WARNING]
> Menghapus file ini akan menghilangkan semua tsc dan ESLint error yang berasal dari starter template (`animated-icon.web.tsx`, `use-color-scheme.web.ts`). Tapi kalau ada plan untuk memakainya kembali, kita bisa simpan dulu.

---

## Open Questions

> [!IMPORTANT]
> **Hapus starter components?** File seperti `app-tabs.tsx`, `animated-icon.tsx`, `hint-row.tsx`, dll. sudah tidak dipakai setelah layout diganti. Mau dihapus sekarang atau disimpan untuk referensi?

> [!IMPORTANT]
> **VIEW button fungsi apa?** Saya usulkan toggle payload debug — tapi kalau ada preferensi lain (misal: toggle fullscreen, toggle overlay info), bisa diubah.

---

## Verification Plan

### Automated Tests
```bash
npx eslint src/app/index.tsx src/features/gamepad/ --max-warnings 0
npx tsc --noEmit
```

### Manual Verification
- D-Pad label tampil ▲/◄/►/▼ (bukan UP/LT/RT/DN)
- VIEW button toggle payload debug visibility
- MENU button buka settings sheet
- LS/RS click button tetap berfungsi mengirim ke ESP32
- Saat connecting: dot kuning pulsing (animasi opacity)
- Saat connected: session timer MM:SS berjalan di center panel
- Saat disconnected: timer reset ke 00:00
- `npm run lint` dan `npx tsc --noEmit` clean (0 errors)
