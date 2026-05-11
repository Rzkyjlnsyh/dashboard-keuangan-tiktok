#!/usr/bin/env python3
"""Push the local SQLite dashboard data to Supabase.

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/sync_local_to_supabase.py

The script never stores credentials. It reads them from environment variables and
upserts the operational tables used by the Vercel dashboard.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "finance_assistant.db"
CHUNK_SIZE = 500


def env_value(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if name.endswith("KEY") and value.startswith("xeyJ"):
        value = value[1:]
    return value


def supabase_request(table: str, rows: list[dict], conflict: str) -> None:
    if not rows:
        return
    url = env_value("SUPABASE_URL").rstrip("/")
    key = (
        env_value("SUPABASE_SERVICE_ROLE_KEY")
        or env_value("SUPABASE_SECRET_KEY")
        or env_value("SUPABASE_ANON_KEY")
        or env_value("SUPABASE_PUBLISHABLE_KEY")
    )
    if not url or not key:
        raise RuntimeError("Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY terlebih dahulu.")
    endpoint = f"{url}/rest/v1/{table}?on_conflict={conflict}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    for start in range(0, len(rows), CHUNK_SIZE):
        body = json.dumps(rows[start : start + CHUNK_SIZE], ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                if res.status not in {200, 201, 204}:
                    raise RuntimeError(f"Supabase menolak {table}: HTTP {res.status}")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase menolak {table}: HTTP {exc.code} {detail}") from exc


def rows_from_sql(conn: sqlite3.Connection, sql: str) -> list[dict]:
    conn.row_factory = sqlite3.Row
    return [dict(row) for row in conn.execute(sql).fetchall()]


def main() -> int:
    if not DB_PATH.exists():
        raise RuntimeError(f"Database lokal tidak ditemukan: {DB_PATH}")
    with sqlite3.connect(DB_PATH) as conn:
        order_lines = rows_from_sql(
            conn,
            """
            SELECT line_key, order_id, store_name, source, created_at, updated_at, status,
                   sku, product_name, variation, quantity, unit_price, gross_product,
                   seller_discount, platform_discount, platform_fee, refund_amount,
                   order_amount, settlement_received, payment_method, tracking_id,
                   last_seen_file, last_seen_at
            FROM order_lines
            """,
        )
        sku_costs = rows_from_sql(conn, "SELECT * FROM sku_costs")
        ad_spend = rows_from_sql(conn, "SELECT * FROM ad_spend")
        import_runs = rows_from_sql(
            conn,
            """
            SELECT id, filename, kind, store_name, rows_seen, inserted, updated,
                   unchanged, audit_count, notes AS message, created_at
            FROM import_runs
            """,
        )
        audit_events = rows_from_sql(
            conn,
            """
            SELECT id, import_run_id AS run_id, filename, kind, store_name, order_id,
                   sku, field_name, old_value, new_value, change_type, created_at
            FROM audit_events
            """,
        )

    jobs = [
        ("finance_sku_costs", sku_costs, "sku_key"),
        ("finance_order_lines", order_lines, "line_key"),
        ("finance_ad_spend", ad_spend, "id"),
        ("finance_import_runs", import_runs, "id"),
        ("finance_audit_events", audit_events, "id"),
    ]
    for table, rows, conflict in jobs:
        supabase_request(table, rows, conflict)
        print(f"{table}: {len(rows)} row terkirim")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
