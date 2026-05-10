# Asisten Keuangan TikTok

Aplikasi lokal untuk memantau omset, dana tertahan, potongan platform, HPP, profit per SKU, profit toko, dan ringkasan otomatis Telegram.

## Cara menjalankan

1. Buka Terminal di folder ini.
2. Jalankan:

```bash
/Users/djokoriwanto/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 app.py
```

3. Buka dashboard:

```text
http://127.0.0.1:8787
```

Jangan buka file `static/index.html` langsung dari Finder/browser, karena itu hanya file mentah dan tidak bisa membaca data dashboard. Jika ingin cara paling mudah, buka `run_dashboard.command`, lalu buka alamat dashboard di atas.

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
- `Per Toko`: membandingkan performa semua toko.
- `TV Kantor`: tampilan aman untuk tim di link khusus `http://127.0.0.1:8787/tv`, menyembunyikan profit asli dan biaya rahasia.
- `Upload & Otomatis`: upload data, scan folder otomatis, dan simpan pengaturan ringkasan pagi Telegram.

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
