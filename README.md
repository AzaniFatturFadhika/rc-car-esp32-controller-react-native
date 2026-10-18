# 🎮 ESP32 RC Car Controller - React Native (Expo SDK v56)

Repositori ini berisi kode lengkap untuk sistem kontrol robot / mobil RC berbasis ESP32 menggunakan smartphone sebagai virtual gamepad controller. Sistem ini mengintegrasikan aplikasi mobile modern dengan firmware berbasis FreeRTOS pada ESP32 untuk menghasilkan kontrol dengan latensi sangat rendah (di bawah 50ms).

---

## 📡 Fitur & Keunggulan Sistem

1. **Dual-Channel Connectivity**: Koneksi nirkabel fleksibel menggunakan **Wi-Fi (UDP)** untuk bandwidth tinggi dan latensi minimal, atau **BLE (Bluetooth Low Energy)** untuk konsumsi daya rendah tanpa perlu router.
2. **Dual-Core FreeRTOS Firmware**:
   * **Core 0**: Real-time open-loop PWM motor controller pada frekuensi 50Hz (jeda 20ms) dengan smoothing dan exponential curve.
   * **Core 1**: Penanganan jaringan (UDP + BLE), autentikasi, dan watchdog koneksi secara asinkron.
3. **Dual Protocol WiFi**: Mendukung **UDP** (latensi terendah, direkomendasikan) dan **WebSocket** (legacy). Pilih varian firmware sesuai kebutuhan.
4. **Binary Command Protocol**: Paket perintah 7-byte dengan header, sumbu joystick, dan checksum untuk efisiensi bandwidth maksimal.
5. **BLE Rx Buffering**: Mencegah kegagalan otentikasi/koneksi akibat fragmentasi paket data BLE pada batasan standar MTU 20-byte.
6. **Throttled Input dengan Rem Instan**: Transmisi input dibatasi pada jeda 30ms untuk mencegah penumpukan data pada antrean ponsel, namun perintah stop (`0`) dikirimkan secara instan demi keamanan pengereman robot.

---

## 📂 Struktur Proyek

* **`src/`**: Kode sumber aplikasi mobile React Native (Expo Router v3).
* **`firmware/`**: Berkas firmware ESP32 untuk diunggah menggunakan Arduino IDE.
  * **`arduino-robot-esp32-udp/`** **(Direkomendasikan)**: Firmware PWM-only + UDP + BLE, tanpa encoder, latensi terendah.
  * **`arduino-robot-esp32-pwm-only/`**: Firmware PWM-only + WebSocket + BLE, tanpa encoder.
  * **`arduinon-robot-esp32-binary/`**: Firmware lengkap dengan PID + encoder + WebSocket + BLE.
  * **`arduino-robot-esp32-binary-max-performance-and-range/`**: Firmware alternatif PID + encoder dengan optimasi performa ekstra.
* **`docs/`**: Panduan teknis arsitektur sistem, skema data, dan panduan build APK lokal.

---

## 🚀 Panduan Memulai (Quick Start)

### 1. Persiapan & Unggah Firmware
1. Buka **Arduino IDE** (versi 2.x ke atas).
2. Install board package **ESP32 oleh Espressif** (direkomendasikan versi terbaru berbasis ESP-IDF v5).
3. Install library berikut melalui Library Manager:
   * **`ArduinoJson`** (oleh Benoît Blanchon)
   * **`NimBLE-Arduino`** (oleh h2zero) - untuk optimasi memori BLE v2.x.
4. Buka berkas [arduino-robot-esp32-udp.ino](firmware/arduino-robot-esp32-udp/arduino-robot-esp32-udp.ino) di Arduino IDE (direkomendasikan) atau pilih varian firmware lain sesuai kebutuhan (lihat [firmware/README.md](firmware/README.md)).
5. Sesuaikan pin motor di bagian konfigurasi pin jika diperlukan.
6. Unggah kode ke papan ESP32 Anda.

### 2. Jalankan Aplikasi Mobile (Lokal)
1. Pastikan Anda memiliki Node.js LTS terinstal.
2. Install dependensi proyek di direktori utama:
   ```bash
   npm install
   ```
3. Jalankan server Metro bundler:
   ```bash
   npx expo start
   ```
4. Pindai kode QR yang muncul di terminal menggunakan aplikasi Expo Go pada Android atau iOS untuk membuka aplikasi.

---

## ⚙️ Cara Menghubungkan Gamepad ke Robot

### A. Melalui Wi-Fi (UDP)
1. Hubungkan Wi-Fi ponsel Anda ke Access Point robot (Default SSID: **`ESP32-RC-Car`**, Password: **`12345678`**).
2. Buka aplikasi di ponsel.
3. Tekan tombol **SETTINGS** di tengah layar, pastikan Host adalah `192.168.4.1` dan Port `12345`.
4. Tekan **WiFi Connect**. Status akan berubah menjadi **🟢 Connected**.

### B. Melalui Bluetooth (BLE)
1. Aktifkan Bluetooth pada ponsel Anda.
2. Buka aplikasi di ponsel.
3. Tekan tombol **SETTINGS** di tengah layar.
4. Tekan **BLE Connect**. Aplikasi akan mencari perangkat bernama **`ESP32-Gamepad`** dan melakukan otentikasi otomatis.

---

## 🛡️ Fitur Failsafe Utama
* **Watchdog Koneksi (500ms)**: Jika ESP32 tidak menerima paket perintah dari ponsel selama 500ms, motor langsung dimatikan demi keamanan.
* **Heartbeat Timeout (2 detik)**: Jika tidak ada paket sama sekali selama 2 detik, client UDP di-deauthorize — harus autentikasi ulang untuk mengontrol robot.
* **Auto-Stop on BLE Disconnect**: Koneksi BLE yang terputus langsung menghentikan motor.

---

## 🛠️ Informasi Detail
Untuk rincian arsitektur sistem, format data biner, dan alur data FreeRTOS, silakan baca berkas panduan teknis mendalam di:
👉 **[TECHNICAL_SYSTEM.md](docs/TECHNICAL_SYSTEM.md)**

Panduan pinout, wiring, dan pemilihan varian firmware:
👉 **[firmware/README.md](firmware/README.md)**
