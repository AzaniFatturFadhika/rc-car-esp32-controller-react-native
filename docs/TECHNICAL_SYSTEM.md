# 📄 Dokumentasi Teknis Sistem Kontrol Gamepad & ESP32

Dokumentasi ini menjelaskan secara mendetail arsitektur sistem, alur data, protokol komunikasi, dan konfigurasi teknis antara aplikasi mobile **Controller React Native (Expo SDK v56)** dan firmware **ESP32**.

---

## 📋 Daftar Isi
1. [Arsitektur Sistem](#1-arsitektur-sistem)
2. [Aplikasi Gamepad (React Native)](#2-aplikasi-gamepad-react-native)
3. [Firmware ESP32 (Core 0 & Core 1)](#3-firmware-esp32-core-0--core-1)
4. [Protokol Komunikasi (JSON & Biner)](#4-protokol-komunikasi-json--biner)
5. [Mekanisme Transmisi & Sinkronisasi](#5-mekanisme-transmisi--sinkronisasi)
6. [Fitur Keamanan & Failsafe](#6-fitur-keamanan--failsafe)

---

## 1. Arsitektur Sistem

Sistem dirancang dengan model **Dual-Channel Redundancy** dan pemisahan tugas (**Separation of Concerns**) menggunakan sistem dual-core pada ESP32.

```
┌─────────────────────────────────┐               ┌─────────────────────────────────────┐
│                                 │   Wi-Fi AP    │              ESP32                  │
│       GAMEPAD CONTROLLER        │◄─────────────►│                                     │
│  - React Native (Expo SDK v56)  │   WebSocket   │  ┌─────────┐      ┌──────────┐      │
│  - Multi-touch Gestures         │               │  │  Core 1 │      │  Core 0  │      │
│  - Throttled Transmission       │      BLE      │  │ Network │─────►│ PID Loop │      │
│                                 │◄─────────────►│  │  (Rx)   │Queue │ (Motor)  │      │
│                                 │  Nordic UART  │  └─────────┘      └──────────┘      │
└─────────────────────────────────┘               └─────────────────────────────────────┘
```

* **Gamepad Controller** mengumpulkan input sentuhan pengguna secara real-time, memprosesnya melalui filter kinematis, dan mengirimkannya ke ESP32 secara periodik.
* **Core 1 ESP32** bertanggung jawab atas konektivitas jaringan (Wi-Fi WebSocket & BLE), menerima payload perintah, merekonstruksi fragmen data, dan mengidentifikasi jenis protokol.
* **Core 0 ESP32** berjalan secara independen untuk melakukan kendali real-time closed-loop PID pada motor DC menggunakan sensor enkoder fisik dengan periodisasi ketat 50Hz (20ms).

---

## 2. Aplikasi Gamepad (React Native)

Aplikasi dibangun menggunakan **React Native** dengan **Expo SDK v56** dan dioptimalkan untuk jangkauan serta latensi rendah (target di bawah 50ms).

### A. Polling Input & Kompresi Transmisi
* **Pengumpulan Data**: Perubahan posisi slider dibaca dengan frekuensi tinggi (60Hz / ~16.6ms) untuk menjaga kehalusan antarmuka.
* **Pengiriman Throttled (30ms)**: Data kendali dikirimkan ke robot dengan jeda minimal **30ms** untuk mencegah saturasi antrean pengiriman BLE pada sistem operasi Android/iOS.
* **Instant Stop (Rem Instan)**: Ketika pengguna melepaskan slider dan kembali ke posisi tengah (`0`), pembatasan 30ms langsung dilewati (**bypassed**). Perintah stop (`0`) dikirimkan seketika demi faktor keselamatan respons mekanis robot.

### B. Arsitektur State & Connection Manager
* **Zustand Store (`connectionStore.ts`)**: Menyimpan status koneksi, jenis protokol aktif, serta autentikasi dari robot.
* **Connection Manager (`ConnectionManager.ts`)**:
  * **Koneksi Wi-Fi**: Menggunakan WebSocket klien standar pada port `81`.
  * **Koneksi BLE**: Menggunakan library `react-native-ble-plx` untuk berinteraksi dengan Nordic UART Service (NUS) pada ESP32.
  * **Auto-MTU (Android)**: Meminta MTU berukuran 512 byte segera setelah tersambung pada perangkat Android untuk meminimalisasi fragmentasi paket.
  * **High Connection Priority**: Mengatur prioritas koneksi BLE ke tingkat tinggi (High Priority) guna mendapatkan interval koneksi tercepat (11.25ms).

---

## 3. Firmware ESP32 (Core 0 & Core 1)

Firmware diimplementasikan dalam bahasa C++ menggunakan FreeRTOS untuk membagi beban tugas secara asinkron.

### A. Core 0: Real-time PID Task (50Hz)
Tugas ini memiliki prioritas tertinggi (Priority 5) untuk menjamin stabilitas perhitungan integral dan diferensial motor:
* **Pembacaan Enkoder (PCNT)**: Menggunakan driver perangkat keras Pulse Counter (PCNT) bawaan ESP32 untuk membaca enkoder kuadratur pada pin GPIO 18/19 (kiri) dan 21/22 (kanan).
* **Bootstrapping Open-Loop**: Pada awal start, kendali motor berjalan pada mode **Open-Loop** (PWM langsung). Begitu pulsa enkoder pertama kali terdeteksi, sistem secara otomatis mengaktifkan mode **Closed-Loop PID**. Hal ini membuat robot tanpa enkoder tetap dapat berjalan dengan lancar.
* **Auto-Polarity Correction**: Jika mendeteksi bahwa arah putaran roda (umpan balik enkoder) berlawanan dengan arah perintah gerak (akibat salah kabel/terbalik), firmware secara otomatis membalik polaritas enkoder setelah **250ms** untuk menghindari malfungsi PID runaway.
* **Failsafe Enkoder**: Jika motor diperintahkan bergerak namun pembacaan enkoder bernilai `0` selama **500ms** berturut-turut (misalnya karena roda macet atau kabel enkoder copot saat berjalan), sistem menurunkan kendali ke mode Open-Loop guna mencegah lonjakan integrasi PID (*windup*).

### B. Core 1: Network & Connection Watchdog Task
Tugas ini berjalan pada prioritas lebih rendah (Priority 2) di Core 1 untuk memproses komunikasi data:
* **Connection Watchdog**: Memantau waktu aktivitas masuk dari heartbeat keep-alive klien dan memutus koneksi serta mereset motor jika terjadi kegagalan/timeout.
* **NimBLE-Arduino Integration**: Menggunakan pustaka NimBLE yang dioptimalkan untuk meminimalkan penggunaan RAM dan meningkatkan throughput BLE.

---

## 4. Protokol Komunikasi (JSON & Biner)

Aplikasi secara dinamis mendeteksi jenis protokol yang didukung oleh robot dan menyesuaikan payload yang dikirimkan.

### A. Protokol JSON (Default / Legacy)
Mengirimkan data dalam format string JSON tekstual. Sangat fleksibel untuk pengembangan.
* **Payload Perintah (App → ESP32)**:
  ```json
  {"type": "CMD", "lx": 0, "ly": 80, "rx": 0, "ry": 0, "dpad": ""}
  ```


### B. Protokol Biner (Kinerja Maksimal)
Menggunakan struktur byte padat untuk meminimalkan bandwidth transmisi BLE (sangat penting untuk kestabilan BLE tanpa fragmentasi).
* **Payload Perintah (App → ESP32)** — Ukuran **7 Byte**:
  ```
  [0xAA] [LX] [LY] [RX] [RY] [DPAD] [CHECKSUM]
  ```
  * `0xAA`: Byte header awal (170 desimal).
  * `LX`, `LY`, `rx`, `ry`: Nilai sumbu stick/slider (-100 s/d 100, bertipe data signed byte `int8_t`).
  * `DPAD`: Representasi tombol DPAD (uint8_t).
  * `CHECKSUM`: Hasil operasi XOR antara byte 1 s/d byte 5.


---

## 5. Mekanisme Transmisi & Sinkronisasi

### A. BLE Rx Buffering pada ESP32
Untuk mengantisipasi fragmentasi paket akibat pembatasan MTU BLE default (20 byte) pada ponsel pintar klien:
1. Firmware mengalokasikan string buffer `bleRxBuf` untuk koneksi BLE.
2. Ketika data masuk ke karakteristik RX, firmware memeriksa apakah itu paket biner (panjang tepat 7 byte dan dimulai dengan byte `0xAA`). Jika ya, paket langsung diproses demi latensi minimal.
3. Jika bukan paket biner, data dianggap string JSON. Setiap karakter dimasukkan ke dalam `bleRxBuf` hingga mendeteksi karakter penutup `}`.
4. Setelah paket JSON utuh terkonstruksi, barulah `deserializeJson` dipanggil untuk parsing data. Hal ini mencegah kegagalan otentikasi koneksi akibat fragmentasi paket.



---

## 6. Fitur Keamanan & Failsafe

Sistem kontrol ini dirancang dengan tingkat keamanan berlapis guna mencegah kerusakan mekanis atau robot berjalan tanpa kendali:

1. **Watchdog Konektivitas (500ms)**: Jika ESP32 tidak menerima paket perintah baru dari aplikasi ponsel selama **500ms**, loop kontrol motor secara otomatis mematikan PWM (`setMotors(0, 0)`) dan mereset status integrator PID.
2. **Auto-Stop on Disconnect**: Begitu event pemutusan koneksi terdeteksi pada tingkat driver (baik WebSocket ditutup atau BLE putus), perintah stop secara instan ditulis ke antrean perintah motor tanpa menunggu timeout watchdog habis.
3. **Heartbeat Keep-Alive**: Aplikasi mengirimkan paket heartbeat (`{"type":"HB"}`) secara periodik setiap 1 detik selama kondisi idle untuk memberi tahu robot bahwa aplikasi masih aktif dan terkoneksi.
