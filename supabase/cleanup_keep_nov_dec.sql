-- Jalankan di Supabase SQL Editor jika dashboard Vercel masih menampilkan bulan selain November/Desember.
-- Script ini hanya menghapus baris transaksi. Tabel SKU, biaya iklan, config, dan histori import tetap disimpan.

delete from public.finance_order_lines
where coalesce(left(created_at, 7), '') not in ('2025-11', '2025-12');

delete from public.finance_audit_events audit
where audit.order_id is not null
  and audit.order_id <> ''
  and not exists (
    select 1
    from public.finance_order_lines lines
    where lines.order_id = audit.order_id
      and coalesce(lines.store_name, '') = coalesce(audit.store_name, '')
  );
