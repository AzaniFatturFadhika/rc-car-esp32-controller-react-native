# 🤖 ESP32 Robot Firmware Guide

Panduan ini berisi informasi khusus untuk konfigurasi, pemetaan pin (pinout), kebutuhan pustaka (library), serta petunjuk pengunggahan kode ke **ESP32**.

---

## 📌 Pemetaan Pinout & Wiring Diagram

Berikut adalah panduan koneksi fisik (wiring) dari ESP32 ke Driver Motor L298N dan Sensor Enkoder motor DC:

### 1. Koneksi ESP32 ➔ Driver Motor L298N

| Sisi L298N | Sisi ESP32 | Deskripsi Fungsi | Catatan Penting |
| :--- | :--- | :--- | :--- |
| **`ENA`** | **GPIO 14** | PWM Motor Kiri (Kecepatan) | **Cabut jumper hitam** bawaan ENA L298N sebelum disambungkan ke ESP32. |
| **`ENB`** | **GPIO 13** | PWM Motor Kanan (Kecepatan) | **Cabut jumper hitam** bawaan ENB L298N sebelum disambungkan ke ESP32. |
| **`IN1`** | **GPIO 27** | Arah Motor Kiri 1 | Mengontrol arah putaran Motor Kiri. |
| **`IN2`** | **GPIO 26** | Arah Motor Kiri 2 | Mengontrol arah putaran Motor Kiri. |
| **`IN3`** | **GPIO 25** | Arah Motor Kanan 1 | Mengontrol arah putaran Motor Kanan. |
| **`IN4`** | **GPIO 33** | Arah Motor Kanan 2 | Mengontrol arah putaran Motor Kanan. |
| **`GND`** | **GND** | Ground Bersama | **WAJIB dihubungkan!** GND ESP32 dan GND L298N harus menyatu agar sinyal stabil. |

> [!WARNING]
> Jangan memberi daya driver L298N langsung dari pin 5V/3.3V ESP32 untuk memutar motor. Hubungkan catu daya eksternal (baterai LiPo 7.4V/11.1V atau 18650) ke terminal **12V** dan **GND** pada driver L298N.

---

### 2. (Opsional) Koneksi Sensor Enkoder Motor DC (6-Pin Connector)

> Jika Anda menggunakan firmware PWM-only atau UDP, enkoder **tidak diperlukan**. Pin enkoder pada ESP32 bisa dibiarkan kosong.
> Bagian ini hanya relevan untuk firmware `arduinon-robot-esp32-binary` yang menggunakan closed-loop PID.

Biasanya, motor DC dengan enkoder (seperti tipe JGB37 atau motor kuning DC gear) menggunakan konektor 6-pin. Berikut adalah konfigurasi penyambungannya:

#### **Motor Kiri (Left Motor & Encoder)**
| Nama Pin Motor | Hubungkan ke | Deskripsi |
| :--- | :--- | :--- |
| **`M1 / Motor +`** | **OUT1** (L298N) | Daya Motor Kiri |
| **`GND (Encoder)`** | **GND** (ESP32) | Ground Sensor |
| **`C1 / Encoder A`**| **GPIO 18** (ESP32) | Sinyal Enkoder Kiri A (`ENC_L_A`) |
| **`C2 / Encoder B`**| **GPIO 19** (ESP32) | Sinyal Enkoder Kiri B (`ENC_L_B`) |
| **`VCC (Encoder)`** | **3.3V** (ESP32) | Daya Sensor (Sangat disarankan **3.3V** agar sinyal aman untuk GPIO ESP32) |
| **`M2 / Motor -`** | **OUT2** (L298N) | Daya Motor Kiri |

#### **Motor Kanan (Right Motor & Encoder)**
| Nama Pin Motor | Hubungkan ke | Deskripsi |
| :--- | :--- | :--- |
| **`M1 / Motor +`** | **OUT3** (L298N) | Daya Motor Kanan |
| **`GND (Encoder)`** | **GND** (ESP32) | Ground Sensor |
| **`C1 / Encoder A`**| **GPIO 21** (ESP32) | Sinyal Enkoder Kanan A (`ENC_R_A`) |
| **`C2 / Encoder B`**| **GPIO 22** (ESP32) | Sinyal Enkoder Kanan B (`ENC_R_B`) |
| **`VCC (Encoder)`** | **3.3V** (ESP32) | Daya Sensor (Sangat disarankan **3.3V** agar sinyal aman untuk GPIO ESP32) |
| **`M2 / Motor -`** | **OUT2** (L298N) | Daya Motor Kanan |

---

## 📦 Pustaka yang Dibutuhkan (Library Dependencies)

Sebelum melakukan kompilasi di Arduino IDE, pastikan pustaka-pustaka berikut sudah terinstal melalui **Library Manager** (Ctrl + Shift + I):

### Untuk semua varian firmware:
1. **`ArduinoJson`** (oleh Benoît Blanchon) — disarankan versi **v7.x** (atau v6.x).
2. **`NimBLE-Arduino`** (oleh h2zero) — versi **v2.x** (untuk optimasi memori dan kestabilan BLE).

### Untuk firmware berbasis WebSocket (`arduinon-robot-esp32-binary`):
3. **`WebSockets`** (oleh Links2004) — untuk penanganan koneksi WebSocket Wi-Fi.

> **Catatan:** Firmware **UDP** (`arduino-robot-esp32-udp`) dan **PWM-only** (`arduino-robot-esp32-pwm-only`) **tidak memerlukan** library `WebSockets`. Mereka menggunakan `WiFiUdp` (built-in ESP32) untuk komunikasi UDP.

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
2. Pilih varian firmware yang sesuai dengan kebutuhan Anda:
   * **`firmware/arduinon-robot-esp32-binary/`** — Firmware lengkap dengan PID + encoder + WebSocket (kompatibel dengan app versi lama).
   * **`firmware/arduino-robot-esp32-pwm-only/`** — Firmware PWM-only tanpa encoder, komunikasi **WebSocket**.
   * **`firmware/arduino-robot-esp32-udp/`** — Firmware PWM-only tanpa encoder, komunikasi **UDP** (direkomendasikan untuk latensi terendah).
3. Buka berkas `.ino` yang sesuai di Arduino IDE.
4. Pilih port COM yang sesuai.
5. Klik tombol **Upload** (panah kanan).
6. Buka **Serial Monitor** dengan Baud Rate **`115200`** untuk melihat proses booting, pencetakan alamat MAC BLE, dan status aktivitas koneksi.
