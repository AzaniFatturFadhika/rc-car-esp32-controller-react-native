# 🤖 ESP32 Robot Firmware Guide

Panduan ini berisi informasi khusus untuk konfigurasi, pemetaan pin (pinout), kebutuhan pustaka (library), serta petunjuk pengunggahan kode ke **ESP32**.

---

## 📌 Pemetaan Pinout (Pinout Mapping)

Berikut adalah konfigurasi pin GPIO pada ESP32 yang digunakan untuk mengendalikan Driver Motor dan membaca sensor Enkoder Fisik:

### 1. Pin Driver Motor (L298N / BTS7960 / dll)
| Nama Pin (C++) | Pin GPIO ESP32 | Deskripsi Fungsi |
|----------------|----------------|------------------|
| **`ENA`**      | **GPIO 14**    | PWM Motor Kiri (Kecepatan) |
| **`ENB`**      | **GPIO 13**    | PWM Motor Kanan (Kecepatan) |
| **`IN1`**      | **GPIO 27**    | Arah Motor Kiri 1 |
| **`IN2`**      | **GPIO 26**    | Arah Motor Kiri 2 |
| **`IN3`**      | **GPIO 25**    | Arah Motor Kanan 1 |
| **`IN4`**      | **GPIO 33**    | Arah Motor Kanan 2 |

### 2. Pin Sensor Enkoder Fisik (Quadrature Encoder)
| Nama Pin (C++) | Pin GPIO ESP32 | Deskripsi Fungsi |
|----------------|----------------|------------------|
| **`ENC_L_A`**  | **GPIO 18**    | Sinyal Enkoder Kiri A |
| **`ENC_L_B`**  | **GPIO 19**    | Sinyal Enkoder Kiri B |
| **`ENC_R_A`**  | **GPIO 21**    | Sinyal Enkoder Kanan A |
| **`ENC_R_B`**  | **GPIO 22**    | Sinyal Enkoder Kanan B |

---

## 📦 Pustaka yang Dibutuhkan (Library Dependencies)

Sebelum melakukan kompilasi di Arduino IDE, pastikan pustaka-pustaka berikut sudah terinstal melalui **Library Manager** (Ctrl + Shift + I):

1. **`ArduinoJson`** (oleh Benoît Blanchon) — disarankan versi **v7.x** (atau v6.x).
2. **`NimBLE-Arduino`** (oleh h2zero) — versi **v2.x** (untuk optimasi memori dan kestabilan BLE).
3. **`WebSockets`** (oleh Links2004) — untuk penanganan koneksi WebSocket Wi-Fi.

---

## ⚙️ Pengaturan Board Arduino IDE

Untuk performa dan jangkauan sinyal maksimal, gunakan konfigurasi board berikut saat melakukan flash:
* **Board**: `ESP32 Dev Module` (atau sesuaikan dengan modul ESP32 fisik Anda).
* **CPU Frequency**: `240MHz (WiFi/BT)` (Wajib untuk performa kalkulasi FPU PID & kelancaran sistem operasi dual-core).
* **Flash Frequency**: `80MHz`.
* **Partition Scheme**: `Huge APP (3MB No OTA/1MB SPIFFS)` atau sesuaikan dengan ukuran flash untuk menampung NimBLE stack.

---

## 🚀 Langkah Unggah (Upload)
1. Sambungkan ESP32 ke komputer menggunakan kabel USB data berkualitas tinggi.
2. Buka berkas firmware utama: `firmware/arduinon-robot-esp32-binary/arduinon-robot-esp32-binary.ino`.
3. Pilih port COM yang sesuai di Arduino IDE.
4. Klik tombol **Upload** (panah kanan).
5. Buka **Serial Monitor** dengan Baud Rate **`115200`** untuk melihat proses booting, pencetakan alamat MAC BLE, dan status aktivitas koneksi.
