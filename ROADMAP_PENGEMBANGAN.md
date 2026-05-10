# Kerangka Kerja Pengembangan Asisten Keuangan TikTok

Tujuan aplikasi ini adalah menjadi asisten keuangan harian untuk multi toko TikTok: membaca data order, pencairan, HPP, biaya, profit, cashflow, dan risiko bisnis; lalu memberi ringkasan yang mudah dipahami owner dan tampilan aman untuk tim.

## Prinsip Utama

1. Data harus bisa diaudit.
   Setiap angka profit harus bisa ditelusuri ke order, SKU, biaya, pencairan, refund, dan file upload asalnya.

2. Owner view dan TV view harus dipisah.
   TV hanya menampilkan metrik aman: order, omset, status, produk bergerak, target harian. Profit, HPP, potongan, dan rekomendasi sensitif hanya untuk owner.

3. Multi toko dari awal.
   Semua data wajib punya `store_name`: `ventura`, `giftyours`, atau `custombase`. Nomor order yang sama di toko berbeda tidak boleh tercampur.

4. Upload manual dan auto update harus memakai mesin yang sama.
   Baik upload dari dashboard maupun scan folder otomatis harus masuk ke proses validasi, update, audit, dan alert yang sama.

5. Profit harus konservatif.
   Jika HPP belum ada, biaya belum lengkap, atau pencairan belum final, aplikasi harus memberi label estimasi dan alert, bukan menganggap angka sudah final.

## Fase 1 - Fondasi Data

- Rapikan master SKU per toko dan global.
- Tambahkan status kualitas data:
  - SKU tanpa HPP
  - order tanpa pencairan
  - pencairan tanpa order
  - order cancel/refund
  - data duplikat
- Tambahkan biaya iklan per toko/per tanggal sebagai biaya operasional yang mengurangi profit.
- Buat detail drilldown dari KPI ke daftar order/SKU penyusunnya.
- Tambahkan audit perubahan:
  - status lama -> status baru
  - pencairan lama -> pencairan baru
  - file mana yang mengubah data

## Fase 2 - Dashboard Owner dan TV

- Owner dashboard:
  - profit bersih estimasi
  - dana tertahan
  - refund
  - potongan platform
  - HPP + packing
  - biaya iklan
  - SKU paling profit
  - SKU paling merugikan
  - tren harian dan bulanan
- TV dashboard:
  - order hari ini
  - order proses/kirim/selesai
  - omset aman
  - produk/SKU ramai
  - target harian
  - alert operasional tanpa membocorkan profit
- Per toko:
  - ventura
  - giftyours
  - custombase
  - global semua toko

## Fase 3 - Auto Update

- Pilih folder download Desty per toko.
- Scan setiap 5 atau 10 menit.
- Hindari proses ulang file yang belum berubah.
- Tampilkan log mudah copy-paste:
  - jam scan
  - file ditemukan
  - file diproses
  - order baru
  - order update
  - error
- Tambahkan tombol `Scan Sekarang`.

## Fase 4 - Asisten Keuangan

Asisten harus memberi laporan seperti finance manager, tapi bahasanya tetap mudah:

- Kondisi bisnis hari ini: sehat / perlu dipantau / butuh tindakan.
- Penyebab utama perubahan profit.
- SKU yang harus dinaikkan, ditahan, atau dievaluasi.
- Order atau refund yang mencurigakan.
- Dana tertahan yang berisiko mengganggu cashflow.
- Rekomendasi tindakan harian.

Contoh output:

> Margin ventura bulan ini kuat, tapi dana tertahan tinggi. Fokus hari ini adalah mempercepat order In Delivery dan melengkapi HPP untuk SKU yang belum punya biaya.

## Fase 5 - Telegram

- Ringkasan pagi otomatis:
  - omset kemarin/bulan ini
  - profit estimasi
  - dana tertahan
  - SKU terbaik
  - SKU perlu perhatian
  - alert penting
- Alert urgent:
  - margin turun tajam
  - refund naik
  - dana tertahan terlalu tinggi
  - SKU besar belum punya HPP
  - pencairan tidak masuk padahal order selesai

## Fase 6 - Forecasting dan Akuntansi

- Forecast omset 7/14/30 hari.
- Forecast profit.
- Target vs realisasi.
- Laporan sederhana:
  - pendapatan
  - HPP
  - biaya platform
  - refund
  - laba kotor
  - estimasi laba bersih
  - cash masuk
  - cash tertahan
- Siapkan kategori biaya tambahan:
  - iklan
  - gaji
  - sewa
  - bahan produksi
  - operasional

## Masukan Terbaik Untuk Pengembangan

1. Jangan buru-buru membuat AI terlalu bebas.
   AI harus membaca angka dari mesin analisis yang jelas, lalu menjelaskan dan memberi rekomendasi. Angka tetap harus berasal dari data dan rumus yang bisa diaudit.

2. Prioritaskan rekonsiliasi order dan pencairan.
   Ini inti kesehatan cashflow. Profit yang bagus tapi pencairan tertahan tinggi bisa membuat bisnis tetap terasa sesak.

3. Jadikan HPP sebagai data sakral.
   SKU tanpa HPP harus selalu diberi alert karena bisa membuat profit terlihat lebih bagus dari realita.

4. Pisahkan profit estimasi dan profit final.
   Order belum cair sebaiknya masuk profit estimasi, sedangkan order selesai dan sudah cair masuk profit final.

5. Buat halaman drilldown sebelum menambah grafik terlalu banyak.
   Owner perlu bisa klik angka lalu melihat order/SKU penyebabnya.

6. Setelah data stabil, baru tambah target, budgeting, dan rekomendasi iklan.
   Keputusan iklan harus berdasarkan profit SKU, bukan omset saja.

## Urutan Pengerjaan Berikutnya

1. Detail order dan detail SKU per toko.
2. Audit perubahan order dari upload berikutnya.
3. Profit estimasi vs profit final.
4. Setting folder auto-update per toko.
5. Laporan Telegram yang lebih tajam.
6. Input biaya tambahan selain HPP, platform, dan iklan.
7. Forecast dan target bisnis.
8. Role akses owner vs tim.

## Prioritas Maksimal Berikutnya

Mulai dari `Detail Order + Detail SKU + Audit Perubahan`. Alasannya sederhana: semua insight besar berasal dari sana. Owner harus bisa klik angka besar seperti dana tertahan, refund, profit SKU, atau biaya iklan, lalu langsung melihat order dan SKU penyebabnya.

Output fase ini:

- Klik KPI `Dana Tertahan` -> daftar order belum cair.
- Klik KPI `Refund` -> daftar order refund/cancel.
- Klik SKU profit terbesar/lemah -> detail order, quantity, HPP, iklan, refund, dan margin.
- Setiap upload baru menampilkan perubahan:
  - order baru
  - status berubah
  - pencairan masuk
  - refund berubah
  - SKU/HPP belum lengkap

Setelah ini rapi, AI assistant bisa memberi saran yang jauh lebih tajam karena dia bisa menunjuk penyebabnya, bukan hanya memberi ringkasan umum.
