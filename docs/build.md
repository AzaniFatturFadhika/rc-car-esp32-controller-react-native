# Panduan Build APK Lokal (Android)

Repositori ini menggunakan Expo SDK v56. Untuk menghasilkan file `.apk` secara lokal tanpa melakukan build di cloud Expo (EAS), Anda dapat menjalankan perintah build secara lokal.

Panduan ini mendokumentasikan kendala lingkungan lokal yang umum terjadi pada sistem Linux (seperti Arch Linux/CachyOS) dan bagaimana mengatasinya.

## Prasyarat Utama
Sebelum melakukan build, pastikan Anda memenuhi hal berikut:
1. **EAS CLI**: Pastikan Anda sudah login ke akun Expo Anda menggunakan perintah `npx eas-cli login`.
2. **Android SDK**: Terpasang di `$HOME/Android/Sdk` (default instalasi Android Studio).

---

## Masalah Environment & Solusinya

Build lokal ini mengonfigurasi beberapa variabel untuk mengatasi masalah umum berikut:

### 1. Konflik Versi Java (JDK)
* **Masalah**: Proyek React Native / Expo membutuhkan **JDK 17**. Jika sistem Anda menggunakan versi Java yang lebih baru secara default (seperti JDK 26), Gradle akan mengalami crash (`IBM_SEMERU` error).
* **Solusi**: Unduh JDK 17 portable ke dalam folder `.jdks/` di root proyek, lalu arahkan `JAVA_HOME` ke folder tersebut saat proses build berjalan.

### 2. Memori Temporary Penuh (`No space left on device`)
* **Masalah**: Direktori `/tmp` bawaan Linux biasanya menggunakan RAM disk (`tmpfs`) dengan ruang terbatas (misal 7.5 GB). Kompilasi C++ bawaan (seperti `react-native-reanimated` dan `expo-modules-core`) memerlukan penyimpanan temporer yang besar dan bisa menyebabkan build gagal karena kehabisan ruang.
* **Solusi**: Mengalihkan target folder temporary ke `/home/fadhika/eas-tmp` dengan mengatur `TMPDIR`, `TMP`, dan `TEMP`.

### 3. Koneksi IPv6 Timeout saat Download Dependensi
* **Masalah**: Gradle sering kali mengalami timeout saat mencoba mengunduh dependensi (seperti `bundletool`) melalui IPv6 pada beberapa jaringan lokal Linux.
* **Solusi**: Memaksa JVM menggunakan IPv4 stack dengan menambahkan parameter `-Djava.net.preferIPv4Stack=true` pada `GRADLE_OPTS` dan `JAVA_OPTS`.

---

## Cara Melakukan Build

### Menggunakan Script Cepat (Rekomendasi)
Jalankan perintah berikut di root direktori proyek Anda:

```bash
npm run build:apk
```

Perintah ini akan otomatis menyetel semua konfigurasi environment di atas dan menjalankan perintah build lokal:
```bash
eas build --platform android --local --profile preview
```

### Output File
Setelah proses build selesai, file `.apk` akan dihasilkan langsung di root folder proyek Anda dengan nama berkas seperti `build-xxxxxxxxxxxxx.apk`.
