# 🎮 ESP32 RC Car Controller - React Native (Expo SDK v56)

Repositori ini berisi kode lengkap untuk sistem kontrol robot / mobil RC berbasis ESP32 menggunakan smartphone sebagai virtual gamepad controller. Sistem ini mengintegrasikan aplikasi mobile modern dengan firmware berbasis FreeRTOS pada ESP32 untuk menghasilkan kontrol dengan latensi sangat rendah (di bawah 50ms).

---

## 📡 Fitur & Keunggulan Sistem

1. **Dual-Channel Connectivity**: Koneksi nirkabel fleksibel menggunakan **Wi-Fi (WebSocket)** untuk bandwidth tinggi, atau **BLE (Bluetooth Low Energy)** untuk konsumsi daya rendah dan latensi minimal.
2. **Dual-Core FreeRTOS Firmware**:
   * **Core 0**: Real-time closed-loop PID motor controller yang berjalan ketat pada frekuensi 50Hz (jeda 20ms).
   * **Core 1**: Penanganan jaringan, negosiasi keamanan, dan pengiriman telemetri secara asinkron.
3. **Smart Bootstrapping & Fallback**: Robot dapat berjalan lancar menggunakan kendali **Open-Loop PWM** jika enkoder roda tidak terpasang/tidak terdeteksi, dan otomatis beralih ke **Closed-Loop PID** setelah putaran roda pertama terdeteksi.
4. **Auto-Polarity Correction**: Secara otomatis mendeteksi arah putaran enkoder yang terbalik (mismatch arah roda vs perintah), dan membalik pembacaan polaritas umpan balik secara cerdas setelah 250ms untuk menghindari PID runaway.
5. **BLE Rx Buffering**: Mencegah kegagalan otentikasi/koneksi akibat fragmentasi paket data BLE pada batasan standar MTU 20-byte.
6. **Throttled Input dengan Rem Instan**: Transmisi input dibatasi pada jeda 30ms untuk mencegah penumpukan data pada antrean ponsel, namun perintah stop (`0`) dikirimkan secara instan demi keamanan pengereman robot.

---

## 📂 Struktur Proyek

* **`src/`**: Kode sumber aplikasi mobile React Native (Expo Router v3).
* **`firmware/`**: Berkas firmware ESP32 untuk diunggah menggunakan Arduino IDE.
  * **`arduinon-robot-esp32-binary/`**: Firmware biner berkinerja tinggi (Sangat Disarankan).
  * **`arduino-robot-esp32-binary-max-performance-and-range/`**: Firmware alternatif dengan optimasi performa ekstra.
* **`docs/`**: Panduan teknis arsitektur sistem, skema data, dan panduan build APK lokal.

---

## 🚀 Panduan Memulai (Quick Start)

### 1. Persiapan & Unggah Firmware
1. Buka **Arduino IDE** (versi 2.x ke atas).
2. Install board package **ESP32 oleh Espressif** (direkomendasikan versi terbaru berbasis ESP-IDF v5).
3. Install library berikut melalui Library Manager:
   * **`ArduinoJson`** (oleh Benoît Blanchon)
   * **`NimBLE-Arduino`** (oleh h2zero) - untuk optimasi memori BLE v2.x.
   * **`WebSockets`** (oleh Links2004) - untuk koneksi WebSocket.
4. Buka berkas [arduinon-robot-esp32-binary.ino](firmware/arduinon-robot-esp32-binary/arduinon-robot-esp32-binary.ino) di Arduino IDE.
5. Sesuaikan pin motor dan enkoder kuadratur di bagian konfigurasi pin jika diperlukan.
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

### A. Melalui Wi-Fi (WebSocket)
1. Hubungkan Wi-Fi ponsel Anda ke Access Point robot (Default SSID: **`ESP32-RC-Car`**, Password: **`12345678`**).
2. Buka aplikasi di ponsel.
3. Tekan tombol **SETTINGS** di tengah layar, pastikan Host adalah `192.168.4.1` dan Port `81`.
4. Tekan **WiFi Connect**. Status akan berubah menjadi **🟢 Connected**.

### B. Melalui Bluetooth (BLE)
1. Aktifkan Bluetooth pada ponsel Anda.
2. Buka aplikasi di ponsel.
3. Tekan tombol **SETTINGS** di tengah layar.
4. Tekan **BLE Connect**. Aplikasi akan mencari perangkat bernama **`ESP32-Gamepad`** dan melakukan otentikasi otomatis.

---

## 🛡️ Fitur Failsafe Utama
* **Watchdog Timeout (500ms)**: Jika koneksi ponsel terputus mendadak atau aplikasi mengalami crash, robot secara otomatis mematikan semua motor dalam waktu 500ms demi menghindari tabrakan.
* **Watchdog Enkoder (500ms)**: Jika motor diperintahkan bergerak namun pembacaan enkoder fisik macet di angka `0` selama 500ms (misal karena roda tersangkut), firmware akan menurunkan mode PID ke PWM biasa untuk mencegah kerusakan komponen.

---

## 🛠️ Informasi Detail
Untuk rincian arsitektur sistem, format data biner, alur data FreeRTOS, dan parameter PID, silakan baca berkas panduan teknis mendalam di:
👉 **[TECHNICAL_SYSTEM.md](docs/TECHNICAL_SYSTEM.md)**
