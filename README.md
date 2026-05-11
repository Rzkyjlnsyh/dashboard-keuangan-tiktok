# Asisten Keuangan TikTok

Aplikasi lokal untuk memantau omset, dana tertahan, potongan platform, HPP, profit per SKU, profit toko, dan ringkasan otomatis Telegram.

## Cara menjalankan

1. Buka Terminal di folder ini.
2. Jalankan:

```bash
/Users/djokoriwanto/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 app.py
```

Jika menjalankan di Python baru yang belum punya library spreadsheet, install dependency lokal:

```bash
pip install -r requirements-local.txt
```

3. Buka dashboard:

```text
http://127.0.0.1:8787
```

Jangan buka file `static/index.html` langsung dari Finder/browser, karena itu hanya file mentah dan tidak bisa membaca data dashboard. Jika ingin cara paling mudah, buka `run_dashboard.command`, lalu buka alamat dashboard di atas.

## Versi online Vercel + Supabase

Dashboard Vercel sekarang bisa memakai Supabase agar data upload, biaya iklan, summary owner/tim/TV, dan Telegram test berjalan online.

Setup sekali:

1. Buka Supabase SQL Editor, lalu jalankan isi file `supabase/schema.sql`.
2. Di Vercel Project Settings -> Environment Variables, isi:

```text
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Untuk testing cepat, jika belum mengambil `service_role`, env berikut juga bisa dipakai:

```text
SUPABASE_ANON_KEY=...
SUPABASE_PUBLISHABLE_KEY=...
```

Opsional untuk cron Telegram:

```text
CRON_SECRET=isi-random-yang-kuat
```

3. Deploy ulang dari GitHub/Vercel.
4. Buka link Vercel, masuk `Upload & Otomatis`, lalu upload file SKU/order/pencairan.

Catatan penting:

- `SUPABASE_SERVICE_ROLE_KEY` hanya boleh disimpan di Vercel Environment Variables, jangan dimasukkan ke frontend atau commit repo.
- `SUPABASE_ANON_KEY` boleh untuk uji cepat, tetapi akses tulisnya tergantung permission/RLS tabel Supabase. Untuk operasional serius, ganti ke `service_role` atau `sb_secret_...`.
- Upload manual dan biaya iklan sudah online lewat Supabase.
- Auto update folder tetap butuh worker lokal/server yang punya akses ke folder download Desty, karena Vercel tidak bisa membaca folder laptop secara langsung.

## Alur data

- Pilih toko saat upload: `ventura`, `giftyours`, atau `custombase`.
- Pilih jenis file: `Auto`, `SKU / HPP`, `Order Desty`, atau `Pencairan TikTok`.
- Mode `Auto` bisa menerima beberapa file sekaligus, misalnya SKU + order + pencairan.
- Upload `sku-template`: mengisi HPP dan biaya packing per SKU.
- Upload order Desty Excel: memperbarui status order, SKU, jumlah, total faktur, dan status pengiriman.
- Upload pencairan TikTok CSV: memperbarui status selesai/pencairan, potongan, refund, dan estimasi dana diterima.

Jika upload berikutnya berisi nomor order yang sama, data lama diperbarui berdasarkan kombinasi toko + order + SKU + variasi.

## Tampilan

- `Owner`: menampilkan profit, HPP, potongan platform, dana tertahan, SKU terbaik, dan SKU bermasalah.
- `Tim`: link aman `http://127.0.0.1:8787/team` untuk melihat order, omset, status, dan SKU tanpa profit/HPP/biaya rahasia.
- `Per Toko`: membandingkan performa semua toko.
- `TV Kantor`: tampilan aman untuk tim di link khusus `http://127.0.0.1:8787/tv`, menyembunyikan profit asli dan biaya rahasia.
- `Upload & Otomatis`: upload data, scan folder otomatis, dan simpan pengaturan ringkasan pagi Telegram.

Tab dashboard dipisahkan berdasarkan kebutuhan kerja:

- Owner fokus ke kesehatan finansial dan keputusan bisnis.
- Detail SKU fokus ke produk yang menghasilkan profit atau perlu diperbaiki.
- Per Toko fokus ke perbandingan performa antar toko.
- Tim dan TV fokus ke operasional yang aman dibagikan.
- Upload & Otomatis fokus ke import data, audit perubahan, folder monitor, dan pengaturan.

Filter yang tersedia:

- `All`
- `7 Hari`
- `14 Hari`
- `Bulan Ini`
- `Pilih Bulan`

## Auto update folder

Isi path folder hasil auto-download Desty, pilih toko, pilih interval 5 atau 10 menit, lalu aktifkan auto update. Aplikasi akan membaca file `.csv` dan `.xlsx` baru/berubah dari folder itu dan mengupdate dashboard.

Contoh folder:

```text
/Users/djokoriwanto/Downloads
```

## Telegram

Buat bot di BotFather, isi `Bot Token`, lalu isi `Chat ID`. Aplikasi akan mengirim ringkasan setiap pagi selama aplikasi lokal ini sedang berjalan.

## Biaya iklan

Masuk ke `Upload & Otomatis`, lalu isi panel `Update Biaya Iklan`. Biaya iklan dicatat per toko dan per tanggal, lalu otomatis mengurangi profit pada periode yang dipilih.

## Profit final vs estimasi

- `Profit Final`: order yang sudah punya pencairan atau sudah cancel/refund sehingga tidak menunggu cash-in berikutnya.
- `Profit Belum Final`: order aktif yang belum cair, sehingga angkanya masih estimasi dan perlu direkonsiliasi saat upload pencairan berikutnya.
- `Profit Total Estimasi`: gabungan final + belum final, sudah dikurangi biaya iklan periode yang dipilih.

## Akses owner dan tim

- Mode owner menampilkan profit, HPP, potongan, refund, biaya iklan, audit perubahan, dan rekomendasi finansial.
- Mode tim dan TV meredaksi data rahasia dari API dan tampilan.
- PIN Owner bisa diisi dari menu `Upload & Otomatis` pada panel Telegram. Jika PIN diaktifkan, akses owner akan meminta PIN.
