-- Jalankan sekali di Supabase SQL Editor sebelum memakai dashboard Vercel.
-- Service role key hanya disimpan di Vercel Environment Variables, jangan taruh di frontend/repo.

create table if not exists public.finance_order_lines (
  line_key text primary key,
  order_id text,
  store_name text not null default 'ventura',
  source text,
  created_at text,
  updated_at text,
  status text,
  sku text,
  product_name text,
  variation text,
  quantity numeric default 0,
  unit_price numeric default 0,
  gross_product numeric default 0,
  seller_discount numeric default 0,
  platform_discount numeric default 0,
  platform_fee numeric default 0,
  refund_amount numeric default 0,
  order_amount numeric default 0,
  settlement_received numeric default 0,
  payment_method text,
  tracking_id text,
  last_seen_file text,
  last_seen_at text
);

create index if not exists finance_order_lines_store_idx on public.finance_order_lines (store_name);
create index if not exists finance_order_lines_created_idx on public.finance_order_lines (created_at);
create index if not exists finance_order_lines_order_idx on public.finance_order_lines (order_id);
create index if not exists finance_order_lines_sku_idx on public.finance_order_lines (sku);

create table if not exists public.finance_sku_costs (
  sku_key text primary key,
  store_name text not null default 'global',
  sku text not null,
  product_name text,
  hpp_per_unit numeric default 0,
  packing_per_unit numeric default 0,
  updated_at text
);

create index if not exists finance_sku_costs_store_sku_idx on public.finance_sku_costs (store_name, sku);

create table if not exists public.finance_ad_spend (
  id bigserial primary key,
  store_name text not null default 'ventura',
  spend_date date not null,
  amount numeric not null default 0,
  channel text,
  campaign text,
  note text,
  created_at text,
  updated_at text
);

create index if not exists finance_ad_spend_store_date_idx on public.finance_ad_spend (store_name, spend_date);

-- Unique index untuk mencegah duplikasi: 1 baris per store+date+channel+campaign.
-- Pakai index expression karena campaign bisa null/kosong; aman dijalankan berulang.
create unique index if not exists finance_ad_spend_unique_row
  on public.finance_ad_spend (store_name, spend_date, coalesce(channel, ''), coalesce(campaign, ''));

create table if not exists public.finance_import_runs (
  id bigserial primary key,
  filename text,
  kind text,
  store_name text,
  rows_seen integer default 0,
  inserted integer default 0,
  updated integer default 0,
  unchanged integer default 0,
  audit_count integer default 0,
  message text,
  created_at text
);

create table if not exists public.finance_audit_events (
  id bigserial primary key,
  run_id bigint references public.finance_import_runs(id) on delete set null,
  filename text,
  kind text,
  store_name text,
  order_id text,
  sku text,
  field_name text,
  old_value text,
  new_value text,
  change_type text,
  created_at text
);

create index if not exists finance_audit_events_store_idx on public.finance_audit_events (store_name);
create index if not exists finance_audit_events_run_idx on public.finance_audit_events (run_id);

create table if not exists public.finance_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at text
);
