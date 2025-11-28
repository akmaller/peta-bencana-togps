Sumatera Disaster Monitor - Deployment Guide

Panduan ini akan membantu Anda menginstal dan menjalankan aplikasi pemantauan bencana ini di server cloud (VPS) berbasis Linux (Ubuntu/Debian/CentOS).

1. Persiapan Server (Prerequisites)

Pastikan server Anda sudah terinstall Node.js (versi 18 atau lebih baru).

# Cek versi node
node -v
# Jika belum ada, install via nvm atau package manager distro Anda


2. Struktur Folder

Buat folder baru di server Anda, lalu upload/buat file-file yang telah disediakan ke dalam struktur folder berikut:

/sumatera-monitor
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   └── index.css


3. Instalasi Dependensi

Masuk ke folder proyek dan jalankan perintah berikut untuk mengunduh semua library yang dibutuhkan (React, Vite, Tailwind, dll):

cd sumatera-monitor
npm install


4. Menjalankan Mode Development (Uji Coba)

Jika Anda ingin menguji apakah aplikasi berjalan (biasanya di port 3000):

npm run dev


5. Build untuk Production (Wajib untuk Server)

Untuk performa terbaik di server, kita harus mengubah kode React menjadi file statis (HTML/CSS/JS murni).

npm run build


Perintah ini akan membuat folder baru bernama dist/.

6. Menjalankan Aplikasi (Deployment)

Ada dua cara umum untuk menjalankan hasil build di server:

Opsi A: Menggunakan serve (Paling Mudah)

Paket ini sudah saya masukkan di package.json. Ini adalah web server ringan untuk Node.js.

# Jalankan server di port 3000
npm run serve


Agar aplikasi tetap berjalan meskipun Anda menutup terminal (SSH), gunakan nohup atau pm2:

# Menggunakan nohup (background process)
nohup npm run serve > log.txt 2>&1 &


Opsi B: Menggunakan Nginx (Disarankan untuk Production)

Jika Anda menggunakan Nginx sebagai reverse proxy.

Copy isi folder dist/ ke /var/www/html atau folder web server Anda.

Konfigurasi Nginx agar mengarah ke folder tersebut.

Catatan Keamanan:
Password admin default adalah 08080808 (sesuai kode sumber).