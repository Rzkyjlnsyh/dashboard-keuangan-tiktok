# Kerangka Pengembangan Lanjutan

Dokumen ini menjadi arah kerja setelah fondasi awal selesai: upload multi toko, audit perubahan, auto update folder per toko, profit final vs estimasi, dan akses owner/tim.

## Fokus Per Tab

### Owner

Tujuan: pusat keputusan finansial owner.

- Profit total estimasi, profit final, dan profit belum final.
- Dana tertahan dan pencairan.
- HPP, packing, potongan platform, refund, biaya iklan.
- AI finance assistant dan rekomendasi tindakan.
- SKU terbaik dan SKU yang menggerus margin.

Pengembangan berikutnya:

- Klik KPI untuk membuka daftar order penyebab angka tersebut.
- Pisahkan laba kotor, laba operasional, dan cash masuk.
- Tambahkan target harian/bulanan dan selisih target vs realisasi.

### Detail SKU

Tujuan: keputusan produk, pricing, stok, dan iklan berbasis profit.

- Semua SKU dengan status: penghasil, perlu dipantau, rugi, HPP belum lengkap.
- Sort profit, margin, omset, qty, refund, dan iklan.
- Audit SKU yang sering refund/cancel.

Pengembangan berikutnya:

- Klik SKU untuk melihat detail order penyusunnya.
- Tambahkan rekomendasi: naikkan iklan, tahan iklan, revisi harga, atau lengkapi HPP.
- Tambahkan tren per SKU per minggu/bulan.

### Per Toko

Tujuan: membandingkan performa `ventura`, `giftyours`, dan `custombase`.

- Order, omset, profit, margin, AOV per toko.
- Filter toko tetap berlaku ke seluruh dashboard.
- Memisahkan nomor order yang sama antar toko.

Pengembangan berikutnya:

- Target per toko.
- Ranking toko berdasarkan profit final, cash tertahan, dan kualitas data.
- Alert toko yang margin turun atau dana tertahan naik tidak normal.

### Tim dan TV

Tujuan: transparansi operasional tanpa membocorkan data rahasia.

- Order, omset, status order, SKU ramai.
- Tidak mengirim profit, HPP, refund, potongan, biaya iklan, audit finansial, atau rekomendasi owner dari API.
- Link aman: `/team` dan `/tv`.

Pengembangan berikutnya:

- Target order harian untuk TV.
- Daftar SKU/order yang harus diproses cepat.
- Tampilan auto-rotasi untuk TV kantor.

### Upload dan Otomatis

Tujuan: pusat ingest data dan audit perubahan.

- Upload SKU/HPP, order, dan pencairan.
- Auto scan folder per toko.
- Audit perubahan status, pencairan, refund, fee, dan order baru.
- Konfigurasi Telegram dan PIN owner.

Pengembangan berikutnya:

- Log scan yang bisa dicopy paste.
- Validasi kualitas file sebelum import.
- Halaman rekonsiliasi: order tanpa pencairan, pencairan tanpa order, SKU tanpa HPP.

## Urutan Prioritas Berikutnya

1. Detail order dan drilldown KPI.
2. Rekonsiliasi order vs pencairan.
3. Data quality center untuk HPP kosong, duplikat, dan mismatch.
4. Target dan budgeting per toko.
5. Telegram alert cerdas untuk kondisi urgent.
6. Forecast 7/14/30 hari berbasis tren real.
7. Laporan akuntansi sederhana yang bisa diekspor.
8. Cloud/storage aman jika ingin dashboard bisa online penuh tanpa laptop lokal.

## Standar Keputusan Finansial

- Profit final dipakai untuk keputusan cash yang sudah pasti.
- Profit belum final dipakai untuk forecast dan peringatan, bukan untuk merasa uang sudah masuk.
- SKU tanpa HPP tidak boleh dianggap sehat walaupun omsetnya besar.
- Iklan sebaiknya dinaikkan hanya untuk SKU yang profit final atau margin estimasinya sehat.
- Toko dengan dana tertahan tinggi perlu diprioritaskan dalam monitoring order selesai/pencairan.

## Catatan Arsitektur

- Versi online memakai Supabase untuk data upload manual, biaya iklan, summary owner/tim/TV, audit, dan Telegram test.
- Vercel tidak bisa membaca folder laptop secara langsung; auto update folder perlu worker lokal/server kecil yang membaca folder Desty lalu mengirim data ke Supabase.
- Fase berikutnya: autentikasi owner/tim yang lebih kuat, worker auto-folder, dan rekonsiliasi order/pencairan berbasis data cloud.
