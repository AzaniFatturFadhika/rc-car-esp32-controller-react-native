```markdown
# 📡 Dokumentasi Sinkronisasi Komunikasi Gamepad ↔ ESP32 RC Car

**Versi Dokumen:** 2.0  
**Target Hardware:** ESP32 (Arduino Core 3.x)  
**Arsitektur:** Dual-Core FreeRTOS dengan Closed-Loop PID  
**Terakhir Diperbarui:** 19 Juni 2026

---

## 📋 Daftar Isi
1. [Arsitektur Komunikasi](#1-arsitektur-komunikasi)
2. [Protokol Data (Payload JSON)](#2-protokol-data-payload-json)
3. [Channel Transmisi](#3-channel-transmisi)
4. [Mekanisme Sinkronisasi Data](#4-mekanisme-sinkronisasi-data)
5. [Alur Data (Data Flow)](#5-alur-data-data-flow)
6. [Fail-Safe & Watchdog](#6-fail-safe--watchdog)
7. [Parameter Kalibrasi](#7-parameter-kalibrasi)
8. [Contoh Implementasi Gamepad](#8-contoh-implementasi-gamepad)

---

## 1. Arsitektur Komunikasi

Sistem ini menggunakan arsitektur **Dual-Channel Redundancy**, di mana gamepad dapat terhubung melalui dua jalur secara bergantian:

```
┌─────────────────┐          ┌─────────────────────────────────────┐
│                 │  WiFi    │              ESP32                  │
│   GAMEPAD       │◄────────►│                                     │
│  (Smartphone/   │  WebSocket│  ┌─────────┐      ┌──────────┐    │
│   Web/Custom)   │  Port 81 │  │  Core 1 │      │  Core 0  │    │
│                 │          │  │ Network │─────►│ PID Loop │    │
│                 │   BLE    │  │  (Rx)   │Queue │ (Motor)  │    │
│                 │◄────────►│  └─────────┘      └──────────┘    │
└─────────────────┘  NimBLE  │                                     │
                            └─────────────────────────────────────┘
```

**Keunggulan Arsitektur:**
- **Core 1** hanya fokus menerima data jaringan (tidak terblokir oleh tugas motor)
- **Core 0** hanya fokus pada kontrol PID motor (tidak terganggu latency jaringan)
- **Queue Overwrite** menjamin data yang diproses selalu yang terbaru (zero-lag)

---

## 2. Protokol Data (Payload JSON)

Semua komunikasi menggunakan format **JSON** dengan struktur yang telah disepakati (kontrak data).

### 2.1 Format Payload

```json
{
  "LX": 0,
  "LY": 0,
  "DPAD": ""
}
```

### 2.2 Spesifikasi Field

| Field | Tipe Data | Range Nilai | Deskripsi |
|-------|-----------|-------------|-----------|
| `LX`  | Integer   | `-100` s/d `100` | Sumbu-X analog stick kiri. Negatif = kiri, Positif = kanan. `0` = tengah. |
| `LY`  | Integer   | `-100` s/d `100` | Sumbu-Y analog stick kiri. Negatif = atas (maju), Positif = bawah (mundur). `0` = tengah. |
| `DPAD`| String    | `"UP"`, `"DOWN"`, `"LEFT"`, `"RIGHT"`, `""` | Tombol D-Pad diskret. Jika ditekan, input analog stick **diabaikan**. |

### 2.3 Aturan Prioritas Input

1. **Prioritas Tertinggi: `DPAD`** — Jika field `DPAD` berisi string tidak kosong, maka nilai `LX` dan `LY` akan diabaikan oleh ESP32.
2. **Prioritas Kedua: Analog Stick** — Jika `DPAD` kosong, maka `LX` dan `LY` akan diproses menggunakan kinematika differential drive.
3. **Deadzone** — Nilai `LX` dan `LY` dengan absolut `< 15` akan dianggap `0` (mengatasi joystick drift).

### 2.4 Contoh Payload

**Maju Penuh (Analog):**
```json
{"LX": 0, "LY": -100, "DPAD": ""}
```

**Belok Kanan Halus (Analog):**
```json
{"LX": 50, "LY": -70, "DPAD": ""}
```

**Putar di Tempat Kiri (D-Pad):**
```json
{"LX": 0, "LY": 0, "DPAD": "LEFT"}
```

**Berhenti (Netral):**
```json
{"LX": 0, "LY": 0, "DPAD": ""}
```

---

## 3. Channel Transmisi

### 3.1 Channel A: WiFi (WebSocket)

| Parameter | Nilai |
|-----------|-------|
| Mode | SoftAP (Access Point) |
| SSID | `ESP32-Robot` |
| Password | `12345678` |
| IP Address ESP32 | `192.168.4.1` |
| Protocol | WebSocket |
| Port | `81` |
| Endpoint | `ws://192.168.4.1:81/` |
| Payload Format | Text (JSON String) |

**Kapan Digunakan?**  
Untuk jarak dekat dengan bandwidth tinggi (streaming video + kontrol), atau ketika gamepad adalah browser web.

### 3.2 Channel B: Bluetooth Low Energy (NimBLE)

| Parameter | Nilai |
|-----------|-------|
| Device Name | `ESP32-Gamepad` |
| Service UUID | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` |
| RX Characteristic UUID | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` |
| Properties | `WRITE`, `WRITE_NR` (No Response) |
| MTU | Default (disarankan 128 bytes) |
| Payload Format | Byte Array (UTF-8 JSON) |

**Kapan Digunakan?**  
Untuk kontrol low-latency, hemat daya, dan jangkauan menengah. Gunakan `WRITE_NR` (Write No Response) untuk throughput maksimal.

---

## 4. Mekanisme Sinkronisasi Data

### 4.1 Mailbox Pattern (Queue Overwrite)

ESP32 menggunakan FreeRTOS Queue dengan kapasitas **1 slot** dan mode **Overwrite**:

```cpp
commandQueue = xQueueCreate(1, sizeof(GamepadCommand));
// ...
xQueueOverwrite(commandQueue, &cmd);
```

**Implikasi Sinkronisasi:**
- Gamepad boleh mengirim data secepat mungkin (misal 60Hz / setiap 16ms)
- ESP32 hanya memproses data **paling baru** setiap siklus 20ms
- **Tidak ada backlog** — paket lama otomatis dibuang
- Tidak ada delay akumulatif meski jaringan sempat lag

### 4.2 Periodic Sampling (50Hz)

Core 0 membaca queue secara periodik tepat setiap **20ms** menggunakan `vTaskDelayUntil`:

```cpp
const TickType_t xFrequency = pdMS_TO_TICKS(20); // 50Hz
// ...
vTaskDelayUntil(&xLastWakeTime, xFrequency);
```

**Keuntungan:**
- Nilai `dt` pada perhitungan PID selalu konstan (0.02 detik)
- Perilaku robot konsisten dan dapat diprediksi
- Tidak ada jitter pada kontrol motor

### 4.3 Thread Safety

- **Queue FreeRTOS** menjamin akses thread-safe antara Core 0 dan Core 1
- **Volatile variables** pada encoder counter menjamin visibilitas data antar-interrupt
- **Atomic read** pada ESP32 (32-bit) aman untuk `int32_t` tanpa mutex

---

## 5. Alur Data (Data Flow)

Berikut adalah urutan lengkap perjalanan data dari gamepad hingga menjadi gerakan motor:

```
┌──────────────────────────────────────────────────────────────────────┐
│                         GAMEPAD (Pengirim)                           │
│  1. Baca posisi analog stick & tombol D-Pad                          │
│  2. Terapkan deadzone lokal (opsional)                               │
│  3. Serialize ke JSON string                                         │
│  4. Kirim via WebSocket ATAU BLE Write (periodik 30-60Hz)            │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│              CORE 1 ESP32 (Network Ingestion)                        │
│  5. webSocket.loop() / BLE onWrite() menerima payload                │
│  6. parseAndEnqueue() → deserialize JSON                             │
│  7. xQueueOverwrite() → Masukkan ke mailbox (timpa data lama)        │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ (FreeRTOS Queue - Thread Safe)
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│              CORE 0 ESP32 (Real-Time PID Loop @ 50Hz)                │
│  8. xQueueReceive() → Ambil data terbaru (non-blocking)              │
│  9. driveKinematics() → Terapkan deadzone + hitung target L/R        │
│ 10. Smoothing (EMA) → Haluskan transisi target                       │
│ 11. Konversi % → Ticks/detik (setpoint PID)                         │
│ 12. Baca encoder → Hitung actual speed                               │
│ 13. PID Compute → Output PWM -255 s/d 255                            │
│ 14. setMotorSpeeds() → Tulis ke GPIO + LEDC PWM                      │
│ 15. vTaskDelayUntil() → Tunggu siklus 20ms berikutnya                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 6. Fail-Safe & Watchdog

Sistem memiliki 3 lapis keamanan untuk mencegah robot berjalan tanpa kendali:

### 6.1 Lapis 1: Watchdog Timeout (500ms)

```cpp
const unsigned long WATCHDOG_TIMEOUT = 500;
```

Jika Core 0 tidak menerima data baru dari queue selama **500ms**, maka:
- Target kecepatan dipaksa ke `0`
- PID controller di-**reset** (integral & error dihapus)
- Motor langsung berhenti

**Pemicu:** Gamepad crash, baterai HP habis, atau ESP32 kehilangan koneksi.

### 6.2 Lapis 2: Auto-Stop on Disconnect

**WebSocket:**
```cpp
if (type == WStype_DISCONNECTED) {
    GamepadCommand emptyCmd = {0, 0, ""};
    xQueueOverwrite(commandQueue, &emptyCmd);
}
```

**BLE:**
```cpp
void onDisconnect(NimBLEServer* pServer) {
    GamepadCommand emptyCmd = {0, 0, ""};
    xQueueOverwrite(commandQueue, &emptyCmd);
    NimBLEDevice::startAdvertising(); // Siap dihubungi lagi
}
```

Begitu koneksi terputus di level protokol, perintah berhenti langsung dikirim ke queue tanpa menunggu watchdog.

### 6.3 Lapis 3: Auto-Reconnect (BLE Only)

BLE akan otomatis memulai advertising kembali setelah client terputus, sehingga gamepad bisa menyambung ulang tanpa perlu restart ESP32.

---

## 7. Parameter Kalibrasi

Parameter berikut harus **disinkronkan** antara konfigurasi gamepad dan ESP32:

### 7.1 Parameter yang Harus Sama di Kedua Sisi

| Parameter | Gamepad | ESP32 |
|-----------|---------|-------|
| Range Analog Stick | `-100` s/d `100` | `-100` s/d `100` |
| Deadzone | `≥ 15` (direkomendasikan) | `15` (hardcoded) |
| Format JSON | Sesuai kontrak | Sesuai kontrak |
| Frekuensi Kirim | `30-60 Hz` | Sampling `50 Hz` |

### 7.2 Parameter Khusus ESP32 (Perlu Kalibrasi Fisik)

| Parameter | Nilai Default | Cara Kalibrasi |
|-----------|---------------|----------------|
| `MAX_TICKS_PER_SEC` | `150.0` | Berikan PWM 100% tanpa PID, hitung ticks encoder per detik |
| `KP` | `1.5` | Naikkan hingga respons cepat tapi tidak berosilasi |
| `KI` | `3.0` | Naikkan perlahan untuk menghilangkan error steady-state |
| `KD` | `0.05` | Naikkan jika respons motor terlalu "hentakan" |
| `SMOOTHING_ALPHA` | `0.15` | Perkecil untuk gerakan lebih halus, perbesar untuk respons lebih cepat |
| `WATCHDOG_TIMEOUT` | `500 ms` | Sesuaikan dengan latency jaringan yang diizinkan |

---

## 8. Contoh Implementasi Gamepad

### 8.1 Web Gamepad (JavaScript + WebSocket)

```javascript
// Koneksi ke ESP32
const ws = new WebSocket('ws://192.168.4.1:81/');

// Kirim data setiap 33ms (~30Hz)
setInterval(() => {
    const lx = Math.round(getLeftStickX() * 100); // -100 s/d 100
    const ly = Math.round(getLeftStickY() * 100); // -100 s/d 100
    const dpad = getDpadState(); // "UP", "DOWN", "LEFT", "RIGHT", atau ""
    
    const payload = JSON.stringify({ LX: lx, LY: ly, DPAD: dpad });
    
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
    }
}, 33);

// Deteksi putus koneksi
ws.onclose = () => {
    console.log('Koneksi terputus. Robot akan berhenti otomatis dalam 500ms.');
};
```

### 8.2 Mobile App (BLE dengan NimBLE Compatible UUID)

```kotlin
// Android Kotlin contoh menggunakan Nordik Semiconductor UUID
val SERVICE_UUID = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
val RX_UUID = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e")

fun sendCommand(lx: Int, ly: Int, dpad: String) {
    val json = """{"LX":$lx,"LY":$ly,"DPAD":"$dpad"}"""
    val rxChar = device.getService(SERVICE_UUID)
                        .getCharacteristic(RX_UUID)
    
    // Write No Response untuk throughput maksimal
    device.writeCharacteristic(
        rxChar, 
        json.toByteArray(Charsets.UTF_8),
        BluetoothGatt.WRITE_TYPE_NO_RESPONSE
    )
}
```

### 8.3 Rekomendasi Frekuensi Pengiriman

| Skenario | Frekuensi Kirim | Alasan |
|----------|-----------------|--------|
| Kontrol presisi (balap) | 60 Hz (16ms) | Respons maksimal |
| Kontrol umum | 30 Hz (33ms) | Cukup halus, hemat baterai |
| Hemat daya (BLE) | 20 Hz (50ms) | Sinkron dengan loop PID ESP32 |
| **Jangan kurang dari** | **10 Hz (100ms)** | Agar watchdog 500ms tidak terpicu |

---

## 📝 Catatan Penting untuk Developer Gamepad

1. **Jangan Blocking Send** — Pastikan pengiriman data tidak memblokir UI thread gamepad.
2. **Kirim State, Bukan Event** — Kirim posisi stick *saat ini* setiap frame, BUKAN event "stick digeser". Ini sesuai dengan pola *Queue Overwrite* ESP32.
3. **Kirim Data Netral Saat Idle** — Meski stick tidak disentuh, tetap kirim `{"LX":0,"LY":0,"DPAD":""}` secara periodik untuk menjaga watchdog tetap happy.
4. **Hindari String Kosong pada DPAD** — Jika D-Pad tidak ditekan, kirim string kosong `""` atau hilangkan field `DPAD` sama sekali.
5. **Integer Only** — Pastikan `LX` dan `LY` dikirim sebagai integer, bukan float, untuk menghemat bandwidth dan menghindari parsing error.

---

## 🔧 Troubleshooting Komunikasi

| Gejala | Kemungkinan Penyebab | Solusi |
|--------|----------------------|--------|
| Robot bergerak patah-patah | Frekuensi kirim gamepad terlalu rendah | Naikkan ke minimal 30Hz |
| Robot terlambat merespons | Queue backlog (jarang terjadi) | Pastikan pakai `xQueueOverwrite` |
| Robot berhenti tiba-tiba | Watchdog terpicu | Cek koneksi, pastikan kirim data < 500ms interval |
| Motor bergetar di tempat | Joystick drift melewati deadzone | Perbesar `DEADZONE` di ESP32 atau gamepad |
| JSON parse error | Format payload tidak sesuai | Validasi JSON di gamepad, pastikan integer |
| BLE tidak terkoneksi | Advertising tidak aktif | Cek `onDisconnect` sudah memanggil `startAdvertising()` |

---

**Dokumen ini adalah kontrak teknis antara tim Gamepad dan tim ESP32. Setiap perubahan pada format payload atau UUID harus didiskusikan dan disinkronkan di kedua sisi.**
```

Dokumen di atas sudah saya buat lengkap dengan:
- ✅ Spesifikasi protokol JSON yang sesuai dengan kode
- ✅ Detail kedua channel (WebSocket & NimBLE) dengan UUID yang sama persis dengan kode
- ✅ Penjelasan mekanisme sinkronisasi (Queue Overwrite, Periodic Sampling, Thread Safety)
- ✅ Diagram alur data dari gamepad sampai ke motor
- ✅ Mekanisme fail-safe (watchdog, auto-stop, auto-reconnect)
- ✅ Parameter kalibrasi yang harus disinkronkan
- ✅ Contoh implementasi gamepad (Web JS & Android Kotlin)
- ✅ Troubleshooting table

Anda bisa langsung menyimpannya sebagai `KOMUNIKASI_GAMEPAD_ESP32.md` dan menggunakannya sebagai referensi bersama tim atau dokumentasi proyek.