# Android Multi-Touch — Quirks, Debugging & Profiling

## Daftar Isi
1. [Quirks kritis Android](#quirks)
2. [pageX/pageY vs locationX/locationY](#koordinat)
3. [Pointer cancel & system interrupt](#cancel)
4. [Konflik dengan RNGH](#rngh-conflict)
5. [Testing checklist](#testing)
6. [Profiling performa](#profiling)
7. [Troubleshooting umum](#troubleshoot)

---

## 1. Quirks Kritis Android {#quirks}

### `ACTION_POINTER_DOWN` vs `ACTION_DOWN`

Di Android native, touch pertama menghasilkan `ACTION_DOWN`, touch berikutnya
menghasilkan `ACTION_POINTER_DOWN`. React Native memetakan keduanya ke `onTouchStart`
dengan memasukkan touch baru di `changedTouches`. Tidak perlu handle secara berbeda
di sisi JS — RN sudah abstraksi ini.

### Touch identifier reuse

Android menggunakan identifier integer (biasanya 0–9) yang **dapat dipakai ulang**
setelah touch berakhir. Jadi setelah jari index (id=0) lift, jari berikutnya bisa
dapat id=0 lagi. Pastikan `registry.delete(id)` selalu dipanggil di `onTouchEnd`
sebelum touch baru bisa klaim id yang sama.

### Jumlah touch simultan

Tergantung hardware. Sebagian besar device modern: 5–10 point simultan. Emulator
biasanya hanya 1 point. Selalu test di perangkat fisik.

### Touch coalescing

Android OS bisa menggabungkan (coalesce) beberapa event move menjadi satu ketika
sistem sedang sibuk. Artinya beberapa posisi intermediate mungkin dilewati.
Untuk gamepad ini masih acceptable — tidak perlu track setiap pixel.

---

## 2. pageX/pageY vs locationX/locationY {#koordinat}

```
pageX / pageY       → koordinat absolut dari pojok kiri atas LAYAR
locationX / locationY → koordinat relatif ke pojok kiri atas VIEW
```

**Selalu gunakan `pageX` / `pageY`** untuk hitTest dalam dispatcher.

`locationX/locationY` berubah jika View di-scroll atau di-transform. Karena
dispatcher kita adalah `View` yang cover seluruh layar, keduanya bisa sama —
tapi `pageX/pageY` lebih aman dan tidak bergantung pada posisi View.

```ts
// BENAR
zone.hitTest(t.pageX, t.pageY)

// BENAR hanya jika View = absoluteFill dan tidak di-transform
zone.hitTest(t.locationX, t.locationY)
```

---

## 3. Pointer Cancel & System Interrupt {#cancel}

`onTouchCancel` terjadi ketika Android memutus touch paksa:
- Notifikasi masuk + swipe bar muncul
- Permission dialog muncul
- App di-interrupt oleh sistem

Tanpa handler ini, semua `identifier` yang sedang aktif tidak akan pernah dapat
`onEnd`. Analog stick stuck di nilai terakhir, tombol stuck di pressed.

```ts
// WAJIB — onTouchCancel = perilaku sama dengan onTouchEnd
return {
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel: onTouchEnd, // JANGAN dihilangkan
};
```

**Cara test manual:**
1. Pegang analog stick dengan satu jari
2. Pull-down notification drawer dari atas layar
3. Tutup drawer
4. Robot harus berhenti (tidak lari terus)

---

## 4. Konflik dengan react-native-gesture-handler {#rngh-conflict}

Jika RNGH aktif di parent component (misalnya karena `NavigationContainer`
atau `GestureHandlerRootView`), gesture handler bisa "mencuri" touch dari
raw `onTouch*` kita.

**Solusi 1**: Pastikan root View dengan `onTouch*` ada di dalam `GestureHandlerRootView`
tapi tidak dibungkus `GestureDetector`.

**Solusi 2**: Jika ada `GestureDetector` di parent, tambahkan `simultaneousWithExternalGesture`:
```tsx
const nativeGesture = Gesture.Native();
<GestureDetector gesture={nativeGesture}>
  <View onTouchStart={...} onTouchMove={...} ... />
</GestureDetector>
```

**Solusi 3** (paling bersih): Pisahkan layer. RNGH untuk UI navigation,
raw touch `View` untuk GamePad layer di atasnya:
```tsx
<NavigationContainer> {/* RNGH di bawah */}
  <Stack.Screen ... />
</NavigationContainer>

{/* GamePad layer di atas, terpisah */}
<View style={[StyleSheet.absoluteFill, { zIndex: 999 }]} {...multiTouchHandlers}>
```

---

## 5. Testing Checklist {#testing}

### Setup perangkat fisik

- [ ] Nonaktifkan "Developer options → Pointer location" (visual lines, bukan bug)
- [ ] Aktifkan "Show touches" untuk debug visual jika perlu
- [ ] Test di minimum 2 device berbeda (chipset berbeda = touch controller berbeda)

### Test cases dasar

- [ ] Left stick + right stick bergerak **bersamaan** tanpa saling mengintervensi
- [ ] Left stick aktif + tekan tombol A → keduanya berfungsi
- [ ] Tekan 4 tombol (A+B+X+Y) **bersamaan** → semua terdaftar
- [ ] Left stick + D-pad aktif bersamaan
- [ ] Trigger (LT/RT) + stick bersamaan
- [ ] Pull-down notifikasi saat stick aktif → stick reset ke 0,0 (test onTouchCancel)
- [ ] Angkat semua jari → semua nilai reset ke 0
- [ ] Jari slide keluar zona stick → stick tetap di zona asalnya (lock-to-zone)

### Verifikasi payload di ESP32 terminal

```
ESP32 IP: 192.168.1.x
{"LX":45,"LY":-80,"RX":0,"RY":0,"BTN":["A","LT"],"DPAD":"UP"}
{"LX":45,"LY":-80,"RX":22,"RY":10,"BTN":["A","LT"],"DPAD":"UP"}
```

Kedua nilai LX/LY dan RX/RY harus bisa berubah bersamaan.

---

## 6. Profiling Performa {#profiling}

### Cara cek frame rate

1. Aktifkan React Native Perf Monitor: shake device → "Perf Monitor"
2. Target: UI thread 60fps saat semua 4 jari aktif

### Tanda-tanda masalah performa

| Gejala | Kemungkinan Penyebab |
|--------|---------------------|
| FPS turun saat multi-touch | Axis disimpan di `useState` → ganti ke `useRef` |
| Lag antara sentuhan dan respons | Throttle terlalu lama; coba 8ms (120fps) |
| Robot bergerak setelah jari diangkat | `onTouchCancel` tidak di-handle |
| Stick tidak reset ke 0 | `onEnd` tidak membersihkan `active` |
| Tombol stuck | `identifier` reuse — pastikan `registry.delete()` dipanggil |

### Cara profil dengan Flipper

1. Install Flipper + React Native plugin
2. Tab "Performance" → record saat multi-touch aktif
3. Cek "JS Thread" — tidak boleh spike > 16ms

---

## 7. Troubleshooting Umum {#troubleshoot}

### "Sentuhan kedua tidak terdeteksi"

Penyebab paling umum: masih pakai `PanResponder`.
Solusi: hapus PanResponder, ganti ke raw `onTouchStart/Move/End`.

### "Left stick mati saat tekan tombol A"

`onStartShouldSetResponder` atau komponen lain merebut responder.
Pastikan tidak ada `TouchableOpacity` / `Pressable` di dalam root View
yang sama — mereka menggunakan responder system dan akan konflik.

**Ganti semua button UI menjadi plain `View`** dengan handler di zone:
```tsx
// JANGAN — Pressable menggunakan responder system
<Pressable onPress={...} />

// BENAR — kontrol dari zone, tampilan saja
<View style={styles.btnA} pointerEvents="none" />
```

### "Stick drift saat jari hampir diam"

Naikkan `DEADZONE` dari 5 ke 8–10, atau tambah minimum threshold:
```ts
const MIN_DIST = 3; // px — ignore gerakan sangat kecil
if (dist < MIN_DIST) return; // di onMove, sebelum normalisasi
```

### "Identifier 0 muncul dua kali di registry"

Android merecycle identifier. Pastikan `registry.current.delete(t.identifier)`
dipanggil di `onTouchEnd` **sebelum** touch baru bisa claim ulang identifier itu.
Urutan event garanteeed: `END` dulu, baru `START` berikutnya dengan id yang sama.

### "Zone salah di-hit setelah rotasi layar"

`Dimensions.get('window')` hanya dijalankan sekali saat module load.
Kalau layar dirotasi, dimensi berubah tapi zone config tidak.
Solusi: hitung dimensi di dalam `useMemo` atau subscribe ke event rotasi:

```ts
import { useWindowDimensions } from 'react-native';

function GamePadScreen() {
  const { width: W, height: H } = useWindowDimensions(); // reactive
  const zones = useMemo(() => buildZones(W, H), [W, H]);
  // ...
}
```