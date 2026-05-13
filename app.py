#!/usr/bin/env python3
import csv
import copy
import hashlib
import io
import json
import os
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "finance_assistant.db"
CONFIG_PATH = DATA_DIR / "config.json"
SAMPLES = {
    "orders": Path("/Users/djokoriwanto/Downloads/Order_20260506000116_165686.xlsx"),
    "settlement": Path("/Users/djokoriwanto/Downloads/DESEMBER.csv"),
    "sku": Path("/Users/djokoriwanto/Downloads/sku-template (1).csv"),
}
DEFAULT_STORES = ["ventura", "giftyours", "custombase"]
DEFAULT_STORE = "ventura"
OWNER_PIN_SALT = "pare-finance-dashboard"
AUDIT_FIELDS = {
    "status": "Status order",
    "order_amount": "Total order",
    "settlement_received": "Pencairan",
    "platform_fee": "Potongan platform",
    "refund_amount": "Refund",
    "tracking_id": "Resi",
    "quantity": "Qty",
}
NUMERIC_AUDIT_FIELDS = {"order_amount", "settlement_received", "platform_fee", "refund_amount", "quantity"}
SECRET_TOTAL_KEYS = {
    "platformFee", "platformDiscount", "hpp", "packing", "refund", "settlement", "profit",
    "profitBeforeAds", "adSpend", "margin", "finalProfit", "estimatedProfit", "finalProfitBeforeAds",
    "estimatedProfitBeforeAds", "finalAdSpend", "estimatedAdSpend", "finalMargin", "estimatedMargin",
    "sellerDiscount", "cancelledAmount",
    "bookPlatformFee", "bookHpp", "bookPacking", "bookSettlement", "bookProfit", "bookProfitBeforeAds",
    "bookAdSpend", "bookMargin", "bookCancelledAmount",
    "bookHeld",
}


def ensure_dirs():
    DATA_DIR.mkdir(exist_ok=True)
    UPLOAD_DIR.mkdir(exist_ok=True)


def now_iso():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def clean_col(value):
    return str(value).replace("\n", " ").strip()


def column_token(value):
    return "".join(ch for ch in clean_col(value).lower() if ch.isalnum())


def is_cancelled_status(status):
    return column_token(status) in {"dibatalkan", "cancellations", "cancelled", "canceled", "cancel", "returned", "returnrefund"}


def is_unpaid_status(status):
    return column_token(status) in {"unpaid", "belumbayar", "pendingpayment"}


def has_income_settlement(row):
    return column_token(row["source"] or "") == "incomestatement" or "income" in column_token(row["last_seen_file"] or "") or "settlementstatement" in column_token(row["last_seen_file"] or "")


def is_book_source(row):
    return column_token(row["source"] or "") in {"settlement", "incomestatement"} or has_income_settlement(row)


def actual_settlement_amount(row):
    return abs(float(row["settlement_received"] or 0)) if has_income_settlement(row) else 0


def normalize_order_id(value):
    return str(value or "").replace("\t", "").replace("'", "").replace(".0", "").strip()


def rupiah(value):
    try:
        return int(round(float(value or 0)))
    except Exception:
        return 0


def parse_dt(value):
    if pd.isna(value) or value == "":
        return None
    raw = value.strip() if isinstance(value, str) else value
    dayfirst = isinstance(raw, str) and "/" in raw and not raw[:4].isdigit()
    parsed = pd.to_datetime(raw, errors="coerce", dayfirst=dayfirst)
    if pd.isna(parsed):
        return None
    return parsed.strftime("%Y-%m-%d %H:%M:%S")


def read_config():
    if CONFIG_PATH.exists():
        config = json.loads(CONFIG_PATH.read_text())
    else:
        config = {
        "telegramBotToken": "",
        "telegramChatId": "",
        "morningTime": "07:30",
        "alertNegativeProfit": True,
        "alertMarginBelow": 12,
        "lastMorningSent": "",
        "ownerPinHash": "",
    }
    config.setdefault("stores", DEFAULT_STORES)
    config.setdefault("defaultStore", DEFAULT_STORE)
    config.setdefault("ownerPinHash", "")
    normalize_folder_monitors(config)
    return config


def write_config(config):
    normalize_folder_monitors(config)
    CONFIG_PATH.write_text(json.dumps(config, indent=2))


def hash_owner_pin(pin):
    pin = str(pin or "").strip()
    if not pin:
        return ""
    return hashlib.sha256(f"{OWNER_PIN_SALT}:{pin}".encode("utf-8")).hexdigest()


def owner_pin_enabled():
    return bool(read_config().get("ownerPinHash"))


def owner_pin_valid(pin):
    expected = read_config().get("ownerPinHash", "")
    if not expected:
        return True
    return hash_owner_pin(pin) == expected


def default_folder_monitor(store_name):
    return {
        "enabled": False,
        "path": "",
        "intervalMinutes": 10,
        "storeName": normalize_store(store_name),
        "kind": "auto",
        "lastRun": "",
        "lastMessage": "Belum berjalan",
        "fileState": {},
    }


def normalize_folder_monitors(config):
    stores = [normalize_store(s) for s in config.get("stores", DEFAULT_STORES)]
    config["stores"] = stores
    monitors = config.get("folderMonitors")
    if not isinstance(monitors, dict):
        monitors = {}
    legacy = config.get("folderMonitor")
    if isinstance(legacy, dict) and any(legacy.get(k) for k in ["path", "lastRun", "enabled"]):
        legacy_store = normalize_store(legacy.get("storeName", config.get("defaultStore", DEFAULT_STORE)))
        monitors.setdefault(legacy_store, legacy)
    normalized = {}
    for store in stores:
        monitor = {**default_folder_monitor(store), **(monitors.get(store) or {})}
        monitor["storeName"] = store
        monitor["intervalMinutes"] = int(monitor.get("intervalMinutes") or 10)
        monitor["kind"] = str(monitor.get("kind") or "auto")
        monitor["enabled"] = bool(monitor.get("enabled"))
        monitor["fileState"] = dict(monitor.get("fileState") or {})
        normalized[store] = monitor
    config["folderMonitors"] = normalized
    default_store = normalize_store(config.get("defaultStore", DEFAULT_STORE))
    config["folderMonitor"] = normalized.get(default_store, default_folder_monitor(default_store))


def connect():
    ensure_dirs()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sku_costs (
                sku_key TEXT PRIMARY KEY,
                store_name TEXT DEFAULT 'global',
                sku TEXT,
                product_name TEXT,
                hpp_per_unit REAL DEFAULT 0,
                packing_per_unit REAL DEFAULT 0,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS order_lines (
                line_key TEXT PRIMARY KEY,
                order_id TEXT,
                store_name TEXT,
                source TEXT,
                created_at TEXT,
                updated_at TEXT,
                status TEXT,
                sku TEXT,
                product_name TEXT,
                variation TEXT,
                quantity REAL DEFAULT 0,
                unit_price REAL DEFAULT 0,
                gross_product REAL DEFAULT 0,
                seller_discount REAL DEFAULT 0,
                platform_discount REAL DEFAULT 0,
                platform_fee REAL DEFAULT 0,
                refund_amount REAL DEFAULT 0,
                order_amount REAL DEFAULT 0,
                settlement_received REAL DEFAULT 0,
                payment_method TEXT,
                tracking_id TEXT,
                last_seen_file TEXT,
                last_seen_at TEXT
            );
            CREATE TABLE IF NOT EXISTS import_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT,
                kind TEXT,
                store_name TEXT,
                rows_seen INTEGER,
                inserted INTEGER,
                updated INTEGER,
                unchanged INTEGER DEFAULT 0,
                audit_count INTEGER DEFAULT 0,
                notes TEXT,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                import_run_id INTEGER,
                filename TEXT,
                kind TEXT,
                store_name TEXT,
                entity_type TEXT,
                entity_key TEXT,
                order_id TEXT,
                sku TEXT,
                change_type TEXT,
                field_name TEXT,
                old_value TEXT,
                new_value TEXT,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS ad_spend (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_name TEXT,
                spend_date TEXT,
                amount REAL DEFAULT 0,
                channel TEXT,
                campaign TEXT,
                note TEXT,
                created_at TEXT,
                updated_at TEXT
            );
            """
        )
        migrate_db(conn)


def table_columns(conn, table):
    return [row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def ensure_column(conn, table, name, ddl):
    if name not in table_columns(conn, table):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def normalize_store(value):
    raw = str(value or "").strip().lower()
    if not raw or raw in {"nan", "none", "tiktok", "pare custom", "pare digital custom", "tiktok - pare custom"}:
        return DEFAULT_STORE
    if "ventura" in raw:
        return "ventura"
    if "giftyours" in raw or "gift yours" in raw:
        return "giftyours"
    if "custombase" in raw or "custom base" in raw:
        return "custombase"
    for store in DEFAULT_STORES:
        if raw == store.lower():
            return store
    return raw.replace(" ", "-")


def migrate_db(conn):
    cols = table_columns(conn, "sku_costs")
    if "sku_key" not in cols:
        conn.execute(
            """
            CREATE TABLE sku_costs_new (
                sku_key TEXT PRIMARY KEY,
                store_name TEXT DEFAULT 'global',
                sku TEXT,
                product_name TEXT,
                hpp_per_unit REAL DEFAULT 0,
                packing_per_unit REAL DEFAULT 0,
                updated_at TEXT
            )
            """
        )
        for row in conn.execute("SELECT sku, product_name, hpp_per_unit, packing_per_unit, updated_at FROM sku_costs").fetchall():
            sku = str(row["sku"] or "").strip()
            if not sku:
                continue
            conn.execute(
                """
                INSERT OR REPLACE INTO sku_costs_new
                (sku_key, store_name, sku, product_name, hpp_per_unit, packing_per_unit, updated_at)
                VALUES (?, 'global', ?, ?, ?, ?, ?)
                """,
                (f"global|{sku.lower()}", sku, row["product_name"], row["hpp_per_unit"], row["packing_per_unit"], row["updated_at"]),
            )
        conn.execute("DROP TABLE sku_costs")
        conn.execute("ALTER TABLE sku_costs_new RENAME TO sku_costs")
    ensure_column(conn, "import_runs", "store_name", "TEXT")
    ensure_column(conn, "import_runs", "unchanged", "INTEGER DEFAULT 0")
    ensure_column(conn, "import_runs", "audit_count", "INTEGER DEFAULT 0")
    ensure_column(conn, "order_lines", "source_kind", "TEXT")
    conn.execute(
        """
        UPDATE order_lines
        SET store_name=?
        WHERE lower(COALESCE(store_name, '')) IN ('', 'nan', 'none', 'tiktok', 'tiktok - pare custom', 'pare custom', 'pare digital custom')
        """,
        (DEFAULT_STORE,),
    )
    for row in conn.execute("SELECT DISTINCT store_name FROM order_lines").fetchall():
        normalized = normalize_store(row["store_name"])
        if normalized != row["store_name"]:
            conn.execute("UPDATE order_lines SET store_name=? WHERE store_name=?", (normalized, row["store_name"]))
    for row in conn.execute("SELECT line_key, store_name, order_id, sku, variation FROM order_lines").fetchall():
        key = str(row["line_key"] or "")
        new_key = line_key(row["store_name"], row["order_id"], row["sku"], row["variation"])
        if new_key and new_key != key:
            exists = conn.execute("SELECT 1 FROM order_lines WHERE line_key=?", (new_key,)).fetchone()
            if exists:
                conn.execute("DELETE FROM order_lines WHERE line_key=?", (key,))
            else:
                conn.execute("UPDATE order_lines SET line_key=? WHERE line_key=?", (new_key, key))


def line_key(store_name, order_id, sku, variation):
    raw = f"{normalize_store(store_name)}|{order_id}|{sku}|{variation}"
    return raw.strip().lower()


def audit_value(field, value):
    if value is None:
        return ""
    if field in NUMERIC_AUDIT_FIELDS:
        return str(rupiah(value))
    return str(value or "").strip()


def log_audit_event(conn, run_id, filename, kind, row, change_type, field_name, old_value, new_value):
    conn.execute(
        """
        INSERT INTO audit_events
        (import_run_id, filename, kind, store_name, entity_type, entity_key, order_id, sku,
         change_type, field_name, old_value, new_value, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            run_id,
            filename,
            kind,
            normalize_store(row.get("store_name", DEFAULT_STORE)),
            "order_line",
            row.get("line_key"),
            row.get("order_id"),
            row.get("sku"),
            change_type,
            field_name,
            old_value,
            new_value,
            now_iso(),
        ),
    )


def start_import_run(conn, filename, kind, store_name):
    cur = conn.execute(
        """
        INSERT INTO import_runs
        (filename, kind, store_name, rows_seen, inserted, updated, unchanged, audit_count, notes, created_at)
        VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, ?)
        """,
        (Path(filename).name, kind, store_name, "Sedang diproses", now_iso()),
    )
    return cur.lastrowid


def finish_import_run(conn, run_id, rows_seen, inserted, updated, unchanged, audit_count, notes):
    conn.execute(
        """
        UPDATE import_runs
        SET rows_seen=?, inserted=?, updated=?, unchanged=?, audit_count=?, notes=?
        WHERE id=?
        """,
        (rows_seen, inserted, updated, unchanged, audit_count, notes, run_id),
    )


def upsert_line(conn, row, kind=None, filename=None, run_id=None, preserve_settlement=True):
    existing = conn.execute(
        "SELECT * FROM order_lines WHERE line_key=?",
        (row["line_key"],),
    ).fetchone()
    changes = []
    if existing is None:
        snapshot = (
            f"{row.get('status') or 'Tanpa status'} | "
            f"Order {audit_value('order_amount', row.get('order_amount'))} | "
            f"Pencairan {audit_value('settlement_received', row.get('settlement_received'))}"
        )
        changes.append(("inserted", "order", "", snapshot))
    else:
        for field in AUDIT_FIELDS:
            old_value = audit_value(field, existing[field])
            new_raw = row.get(field)
            if field == "settlement_received" and preserve_settlement:
                new_raw = max(float(existing[field] or 0), float(new_raw or 0))
            new_value = audit_value(field, new_raw)
            if old_value != new_value:
                changes.append(("updated", field, old_value, new_value))
    fields = [
        "line_key", "order_id", "store_name", "source", "created_at", "updated_at", "status", "sku",
        "product_name", "variation", "quantity", "unit_price", "gross_product", "seller_discount",
        "platform_discount", "platform_fee", "refund_amount", "order_amount", "settlement_received",
        "payment_method", "tracking_id", "last_seen_file", "last_seen_at",
    ]
    conn.execute(
        f"""
        INSERT INTO order_lines ({",".join(fields)})
        VALUES ({",".join(["?"] * len(fields))})
        ON CONFLICT(line_key) DO UPDATE SET
            store_name=excluded.store_name,
            source={"CASE WHEN order_lines.settlement_received > excluded.settlement_received AND lower(COALESCE(order_lines.source, ''))='income_statement' THEN order_lines.source ELSE excluded.source END" if preserve_settlement else "excluded.source"},
            created_at=COALESCE(order_lines.created_at, excluded.created_at),
            updated_at=COALESCE(excluded.updated_at, order_lines.updated_at),
            status=excluded.status,
            product_name=excluded.product_name,
            variation=excluded.variation,
            quantity=excluded.quantity,
            unit_price=excluded.unit_price,
            gross_product=excluded.gross_product,
            seller_discount=excluded.seller_discount,
            platform_discount=excluded.platform_discount,
            platform_fee=excluded.platform_fee,
            refund_amount=excluded.refund_amount,
            order_amount=excluded.order_amount,
            settlement_received={"MAX(order_lines.settlement_received, excluded.settlement_received)" if preserve_settlement else "excluded.settlement_received"},
            payment_method=excluded.payment_method,
            tracking_id=COALESCE(excluded.tracking_id, order_lines.tracking_id),
            last_seen_file={"CASE WHEN order_lines.settlement_received > excluded.settlement_received AND lower(COALESCE(order_lines.source, ''))='income_statement' THEN order_lines.last_seen_file ELSE excluded.last_seen_file END" if preserve_settlement else "excluded.last_seen_file"},
            last_seen_at=excluded.last_seen_at
        """,
        [row.get(field) for field in fields],
    )
    if run_id and filename and kind:
        for change_type, field_name, old_value, new_value in changes:
            log_audit_event(conn, run_id, Path(filename).name, kind, row, change_type, field_name, old_value, new_value)
    if existing is None:
        return "inserted", len(changes)
    if changes:
        return "updated", len(changes)
    return "unchanged", 0


def import_sku(path, store_name="global"):
    store_name = "global" if str(store_name or "").lower() in {"", "all", "semua", "global"} else normalize_store(store_name)
    df = pd.read_csv(path)
    df.columns = [clean_col(c) for c in df.columns]
    inserted = updated = 0
    with connect() as conn:
        run_id = start_import_run(conn, Path(path).name, "sku", store_name)
        for _, r in df.iterrows():
            sku = str(r.get("sku", "")).strip()
            if not sku:
                continue
            sku_key = f"{store_name}|{sku.lower()}"
            exists = conn.execute("SELECT 1 FROM sku_costs WHERE sku_key=?", (sku_key,)).fetchone()
            conn.execute(
                """
                INSERT INTO sku_costs (sku_key, store_name, sku, product_name, hpp_per_unit, packing_per_unit, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(sku_key) DO UPDATE SET
                    store_name=excluded.store_name,
                    sku=excluded.sku,
                    product_name=excluded.product_name,
                    hpp_per_unit=excluded.hpp_per_unit,
                    packing_per_unit=excluded.packing_per_unit,
                    updated_at=excluded.updated_at
                """,
                (
                    sku_key,
                    store_name,
                    sku,
                    str(r.get("productName", "")).strip(),
                    float(rupiah(r.get("hppPerUnit", 0))),
                    float(rupiah(r.get("packingPerUnit", 0))),
                    now_iso(),
                ),
            )
            if exists:
                updated += 1
            else:
                inserted += 1
        finish_import_run(conn, run_id, len(df), inserted, updated, 0, 0, "HPP dan packing diperbarui")
    return {"kind": "sku", "storeName": store_name, "rows": len(df), "inserted": inserted, "updated": updated, "unchanged": 0, "auditCount": 0}


def dedup_rows_by_line_key(rows):
    """Deduplikasi berdasarkan line_key, keep row terakhir dalam file (paling update)."""
    seen = {}
    for row in rows:
        key = row["line_key"]
        seen[key] = row  # Terakhir menang
    return list(seen.values()), len(rows) - len(seen)


def import_order_excel(path, store_name=None):
    selected_store = normalize_store(store_name) if store_name else None
    df = pd.read_excel(path, sheet_name="Daftar Pesanan")
    df.columns = [clean_col(c) for c in df.columns]
    inserted = updated = unchanged = audit_count = 0
    with connect() as conn:
        run_id = start_import_run(conn, Path(path).name, "orders", selected_store or "sesuai file")
        # Build all rows first, then dedup
        all_rows = []
        for _, r in df.iterrows():
            order_id = normalize_order_id(r.get("Nomor Pesanan (di Marketplace)", ""))
            sku = str(r.get("SKU Marketplace", "")).strip()
            if not order_id or not sku:
                continue
            qty = float(rupiah(r.get("Jumlah", 0)))
            unit_price = float(rupiah(r.get("Harga Satuan", 0)))
            row_store = selected_store or normalize_store(r.get("Channel - Nama Toko", DEFAULT_STORE))
            row = {
                "line_key": line_key(row_store, order_id, sku, r.get("Varian Produk", "")),
                "order_id": order_id,
                "store_name": row_store,
                "source": "desty_order",
                "created_at": parse_dt(r.get("Tanggal Pesanan Dibuat")),
                "updated_at": parse_dt(r.get("Waktu Pesanan (Update)")),
                "status": str(r.get("Status Pesanan", "")).strip(),
                "sku": sku,
                "product_name": str(r.get("Nama Produk", "")).strip(),
                "variation": str(r.get("Varian Produk", "")).strip(),
                "quantity": qty,
                "unit_price": unit_price,
                "gross_product": float(rupiah(r.get("Subtotal Produk", unit_price * qty))),
                "seller_discount": abs(float(rupiah(r.get("Diskon Penjual", 0)))),
                "platform_discount": 0,
                "platform_fee": abs(float(rupiah(r.get("Biaya Layanan", 0)))) + abs(float(rupiah(r.get("Pajak", 0)))),
                "refund_amount": abs(float(rupiah(r.get("Refund", 0)))),
                "order_amount": float(rupiah(r.get("Total Faktur", 0) or r.get("Total Penjualan", 0))),
                "settlement_received": 0,
                "payment_method": str(r.get("Metode Pembayaran", "")).strip(),
                "tracking_id": str(r.get("Nomor AWB/Resi", "")).strip(),
                "last_seen_file": Path(path).name,
                "last_seen_at": now_iso(),
            }
            all_rows.append(row)
        # Dedup before upsert
        deduped_rows, dup_count = dedup_rows_by_line_key(all_rows)
        if dup_count:
            print(f"   ⚠️  {dup_count} baris duplikat dalam file di-dedup (keep baris terakhir)")
        for row in deduped_rows:
            action, changes = upsert_line(conn, row, "orders", Path(path).name, run_id)
            inserted += action == "inserted"
            updated += action == "updated"
            unchanged += action == "unchanged"
            audit_count += changes
        finish_import_run(conn, run_id, len(all_rows), inserted, updated, unchanged, audit_count, "Order Desty diperbarui")
    return {"kind": "orders", "storeName": selected_store or "sesuai file", "rows": len(all_rows), "inserted": inserted, "updated": updated, "unchanged": unchanged, "auditCount": audit_count}


def import_settlement_csv(path, store_name=None):
    selected_store = normalize_store(store_name) if store_name else DEFAULT_STORE
    df = pd.read_csv(path)
    df.columns = [clean_col(c) for c in df.columns]
    inserted = updated = unchanged = audit_count = 0
    with connect() as conn:
        run_id = start_import_run(conn, Path(path).name, "settlement", selected_store)
        # Build all rows first, then dedup
        all_rows = []
        for _, r in df.iterrows():
            order_id = normalize_order_id(r.get("Order ID", ""))
            sku = str(r.get("Seller SKU", "")).strip()
            if not order_id or not sku:
                continue
            qty = float(rupiah(r.get("Quantity", 0)))
            unit_price = float(rupiah(r.get("SKU Unit Original Price", 0)))
            platform_fee = (
                abs(float(rupiah(r.get("Buyer Service Fee", 0))))
                + abs(float(rupiah(r.get("Handling Fee", 0))))
                + abs(float(rupiah(r.get("Shipping Insurance", 0))))
                + abs(float(rupiah(r.get("Item Insurance", 0))))
            )
            status = str(r.get("Order Status", "")).strip()
            row_store = selected_store or normalize_store(r.get("Warehouse Name", DEFAULT_STORE))
            row = {
                "line_key": line_key(row_store, order_id, sku, r.get("Variation", "")),
                "order_id": order_id,
                "store_name": row_store,
                "source": "settlement",
                "created_at": parse_dt(r.get("Created Time")),
                "updated_at": parse_dt(r.get("Delivered Time") or r.get("Paid Time")),
                "status": status,
                "sku": sku,
                "product_name": str(r.get("Product Name", "")).strip(),
                "variation": str(r.get("Variation", "")).strip(),
                "quantity": qty,
                "unit_price": unit_price,
                "gross_product": float(rupiah(r.get("SKU Subtotal Before Discount", 0))),
                "seller_discount": float(rupiah(r.get("SKU Seller Discount", 0))),
                "platform_discount": float(rupiah(r.get("SKU Platform Discount", 0))) + float(rupiah(r.get("Payment platform discount", 0))),
                "platform_fee": platform_fee,
                "refund_amount": abs(float(rupiah(r.get("Order Refund Amount", 0)))),
                "order_amount": float(rupiah(r.get("SKU Subtotal Before Discount", 0))) - float(rupiah(r.get("SKU Seller Discount", 0))),
                "settlement_received": 0,
                "payment_method": str(r.get("Payment Method", "")).strip(),
                "tracking_id": str(r.get("Tracking ID", "")).strip(),
                "last_seen_file": Path(path).name,
                "last_seen_at": now_iso(),
            }
            all_rows.append(row)
        # Dedup before upsert
        deduped_rows, dup_count = dedup_rows_by_line_key(all_rows)
        if dup_count:
            print(f"   ⚠️  {dup_count} baris duplikat dalam file settlement di-dedup")
        for row in deduped_rows:
            action, changes = upsert_line(conn, row, "settlement", Path(path).name, run_id)
            inserted += action == "inserted"
            updated += action == "updated"
            unchanged += action == "unchanged"
            audit_count += changes
        finish_import_run(conn, run_id, len(all_rows), inserted, updated, unchanged, audit_count, "Pencairan/status marketplace diperbarui")
    return {"kind": "settlement", "storeName": selected_store, "rows": len(all_rows), "inserted": inserted, "updated": updated, "unchanged": unchanged, "auditCount": audit_count}


def import_income_excel(path, store_name=None):
    selected_store = normalize_store(store_name or DEFAULT_STORE)
    df = pd.read_excel(path)
    df.columns = [clean_col(c) for c in df.columns]
    inserted = updated = unchanged = skipped = audit_count = 0
    with connect() as conn:
        run_id = start_import_run(conn, Path(path).name, "income", selected_store)
        existing_rows = conn.execute("SELECT * FROM order_lines").fetchall()
        by_order = {}
        for row in existing_rows:
            by_order.setdefault(str(row["order_id"] or "").strip(), []).append(dict(row))
        for _, r in df.iterrows():
            transaction_id = normalize_order_id(r.get("Order/adjustment ID", r.get("Order adjustment ID", "")))
            related_order = normalize_order_id(r.get("Related order ID", ""))
            order_id = related_order if related_order and related_order != "/" else transaction_id
            if not order_id:
                continue
            existing_group = by_order.get(order_id, [])
            if not existing_group:
                skipped += 1
                continue
            income_type = str(r.get("Type", "")).strip()
            settlement = float(rupiah(r.get("Total settlement amount", 0)))
            total_revenue = float(rupiah(r.get("Total Revenue", 0)))
            after_discount = float(rupiah(r.get("Subtotal after seller discounts", 0)))
            before_discount = float(rupiah(r.get("Subtotal before discounts", 0)))
            seller_discount = abs(float(rupiah(r.get("Seller discounts", 0))))
            refund = abs(float(rupiah(r.get("Refund subtotal after seller discounts", 0))))
            total_fees = abs(float(rupiah(r.get("Total Fees", 0))))
            adjustment = float(rupiah(r.get("Ajustment amount", r.get("Adjustment amount", 0))))
            income_settlement = max(0, settlement)
            order_amount = abs(after_discount or total_revenue or before_discount)
            income_fee = total_fees or (max(order_amount - income_settlement, 0) if income_settlement else 0) or (abs(settlement) if settlement < 0 else 0) or (abs(adjustment) if adjustment < 0 else 0)
            gross_base = sum(abs(float(row.get("gross_product") or 0)) for row in existing_group) or abs(before_discount or after_discount or total_revenue) or len(existing_group) or 1
            refund_only = bool(refund and not income_settlement and not total_revenue)
            for current in existing_group:
                current_gross = abs(float(current.get("gross_product") or 0))
                current_discount = abs(float(current.get("seller_discount") or 0))
                share = current_gross / gross_base if current_gross and gross_base else 1 / max(len(existing_group), 1)
                row = dict(current)
                row.update(
                        {
                        "source": "income_statement",
                        "updated_at": parse_dt(r.get("Order settled time")) or row.get("updated_at"),
                        "status": (row.get("status") or "Dibatalkan") if is_cancelled_status(row.get("status")) or refund_only else ("Selesai" if column_token(income_type) == "order" and parse_dt(r.get("Order settled time")) else income_type or row.get("status") or "Income"),
                        "gross_product": current_gross or abs(before_discount or after_discount or total_revenue) * share,
                        "seller_discount": current_discount,
                        "platform_fee": income_fee * share if income_fee else float(row.get("platform_fee") or 0),
                        "refund_amount": refund or float(row.get("refund_amount") or 0),
                        "order_amount": max(current_gross - current_discount, 0) if current_gross else (order_amount * share if order_amount else float(row.get("order_amount") or 0)),
                        "settlement_received": income_settlement or float(row.get("settlement_received") or 0),
                        "last_seen_file": Path(path).name,
                        "last_seen_at": now_iso(),
                    }
                )
                action, changes = upsert_line(conn, row, "income", Path(path).name, run_id, preserve_settlement=False)
                inserted += action == "inserted"
                updated += action == "updated"
                unchanged += action == "unchanged"
                audit_count += changes
        finish_import_run(conn, run_id, len(df), inserted, updated, unchanged + skipped, audit_count, f"Income statement diperbarui; {skipped} baris tanpa order lama dilewati" if skipped else "Income statement diperbarui")
    return {"kind": "income", "storeName": selected_store, "rows": len(df), "inserted": inserted, "updated": updated, "unchanged": unchanged + skipped, "skipped": skipped, "auditCount": audit_count}


def detect_and_import(path, kind="auto", store_name=DEFAULT_STORE):
    kind = str(kind or "auto")
    if kind == "sku":
        return import_sku(path, store_name)
    if kind in {"order", "orders"}:
        return import_order_excel(path, store_name)
    if kind in {"settlement", "pencairan"}:
        return import_settlement_csv(path, store_name)
    if kind == "income":
        return import_income_excel(path, store_name)
    suffix = Path(path).suffix.lower()
    if suffix == ".xlsx":
        sample = pd.read_excel(path, nrows=1)
        cols = set(clean_col(c) for c in sample.columns)
        if {"Order/adjustment ID", "Total settlement amount"}.issubset(cols):
            return import_income_excel(path, store_name)
        return import_order_excel(path, store_name)
    df = pd.read_csv(path, nrows=1)
    cols = set(clean_col(c) for c in df.columns)
    if {"sku", "hppPerUnit", "packingPerUnit"}.issubset(cols):
        return import_sku(path, store_name)
    if "Order ID" in cols and "Seller SKU" in cols:
        return import_settlement_csv(path, store_name)
    raise ValueError("Format file belum dikenal. Upload order Desty, pencairan TikTok, atau template SKU.")


def import_samples(store_name=DEFAULT_STORE):
    results = []
    for path in [SAMPLES["sku"], SAMPLES["orders"], SAMPLES["settlement"]]:
        if path.exists():
            results.append(detect_and_import(path, "auto", store_name))
    return results


def fetch_rows(store_name="all"):
    store_name = normalize_store(store_name) if store_name and store_name != "all" else "all"
    where = ""
    params = []
    if store_name != "all":
        where = "WHERE lower(l.store_name)=lower(?)"
        params.append(store_name)
    with connect() as conn:
        return conn.execute(
            f"""
            SELECT
                l.*,
                COALESCE(c_store.hpp_per_unit, c_global.hpp_per_unit, 0) hpp_per_unit,
                COALESCE(c_store.packing_per_unit, c_global.packing_per_unit, 0) packing_per_unit
            FROM order_lines l
            LEFT JOIN sku_costs c_store
                ON lower(c_store.store_name)=lower(l.store_name)
                AND lower(c_store.sku)=lower(l.sku)
            LEFT JOIN sku_costs c_global
                ON lower(c_global.store_name)='global'
                AND lower(c_global.sku)=lower(l.sku)
            {where}
            """,
            params,
        ).fetchall()


def available_months():
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT month FROM (
                SELECT substr(created_at, 1, 7) month
                FROM order_lines
                WHERE created_at IS NOT NULL AND created_at != ''
            )
            GROUP BY month
            ORDER BY month DESC
            """
        ).fetchall()
    months = [r["month"] for r in rows if r["month"]]
    years = sorted({m[:4] for m in months if len(m) >= 4}, reverse=True)
    if not years:
        years = [str(date.today().year)]
    return [f"{year}-{month:02d}" for year in years for month in range(12, 0, -1)]


def recent_audit_events(filters=None, limit=40):
    filters = filters or {}
    store_name = filters.get("store", "all")
    where = []
    params = []
    if store_name != "all":
        where.append("lower(store_name)=lower(?)")
        params.append(normalize_store(store_name))
    sql = "SELECT * FROM audit_events"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with connect() as conn:
        return [dict(row) for row in conn.execute(sql, params).fetchall()]


def filtered_ad_spend(filters, start_date=None, end_date=None):
    store_name = filters.get("store", "all")
    where = []
    params = []
    if store_name != "all":
        where.append("lower(store_name)=lower(?)")
        params.append(normalize_store(store_name))
    if start_date:
        where.append("spend_date BETWEEN ? AND ?")
        params.extend([start_date.isoformat(), end_date.isoformat()])
    sql = "SELECT * FROM ad_spend"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY spend_date DESC, id DESC"
    with connect() as conn:
        rows = [dict(row) for row in conn.execute(sql, params).fetchall()]
    return rows


def save_ad_spend(data):
    store_name = normalize_store(data.get("storeName", DEFAULT_STORE))
    spend_date = str(data.get("spendDate") or date.today().isoformat())[:10]
    amount = abs(float(rupiah(data.get("amount", 0))))
    if amount <= 0:
        raise ValueError("Nominal biaya iklan harus lebih dari 0.")
    channel = str(data.get("channel", "TikTok Ads")).strip() or "TikTok Ads"
    campaign = str(data.get("campaign", "")).strip()
    note = str(data.get("note", "")).strip()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO ad_spend (store_name, spend_date, amount, channel, campaign, note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (store_name, spend_date, amount, channel, campaign, note, now_iso(), now_iso()),
        )
    return {"storeName": store_name, "spendDate": spend_date, "amount": amount, "channel": channel, "campaign": campaign}


def delete_ad_spend(entry_id):
    with connect() as conn:
        conn.execute("DELETE FROM ad_spend WHERE id=?", (entry_id,))
    return {"deleted": entry_id}


def date_range_from_filters(filters):
    preset = filters.get("preset", "all")
    today = date.today()
    if preset == "last7":
        return today - timedelta(days=6), today
    if preset == "last14":
        return today - timedelta(days=13), today
    if preset == "thisMonth":
        return today.replace(day=1), today
    if preset == "month" and filters.get("month"):
        year, month = [int(part) for part in filters["month"].split("-")[:2]]
        start = date(year, month, 1)
        end = date(year + (month == 12), 1 if month == 12 else month + 1, 1) - timedelta(days=1)
        return start, end
    return None, None


def build_filters(query=None):
    query = query or {}
    preset = query.get("preset", ["all"])[0] if isinstance(query.get("preset"), list) else query.get("preset", "all")
    month = query.get("month", [""])[0] if isinstance(query.get("month"), list) else query.get("month", "")
    store_name = query.get("store", ["all"])[0] if isinstance(query.get("store"), list) else query.get("store", "all")
    if preset not in {"all", "last7", "last14", "thisMonth", "month"}:
        preset = "all"
    return {"preset": preset, "month": month, "store": normalize_store(store_name) if store_name != "all" else "all"}


def compute_summary(filters=None):
    filters = filters or {"preset": "all", "month": "", "store": "all"}
    rows = fetch_rows(filters.get("store", "all"))
    start_date, end_date = date_range_from_filters(filters)
    groups = {}
    for r in rows:
        groups.setdefault(r["order_id"] or r["line_key"], []).append(r)
    sku = {}
    daily = {}
    stores = {}
    status = {}
    missing_cost = set()
    totals = {
        "orders": set(), "lines": 0, "qty": 0, "gross": 0, "sellerDiscount": 0, "omzet": 0, "platformFee": 0,
        "platformDiscount": 0, "hpp": 0, "packing": 0, "refund": 0, "settlement": 0, "held": 0,
        "cancelledAmount": 0, "profit": 0, "profitBeforeAds": 0, "adSpend": 0, "todayOrders": 0,
        "finalProfit": 0, "estimatedProfit": 0, "finalProfitBeforeAds": 0, "estimatedProfitBeforeAds": 0,
        "finalAdSpend": 0, "estimatedAdSpend": 0, "finalOmzet": 0, "estimatedOmzet": 0,
        "finalOrders": set(), "estimatedOrders": set(), "heldOrders": set(), "cancelledOrders": set(),
        "bookGross": 0, "bookSellerDiscount": 0, "bookOmzet": 0, "bookPlatformFee": 0,
        "bookSettlement": 0, "bookHpp": 0, "bookPacking": 0, "bookRefund": 0,
        "bookCancelledAmount": 0, "bookHeld": 0, "bookProfitBeforeAds": 0, "bookProfit": 0, "bookAdSpend": 0,
        "bookOrders": set(), "bookCancelledOrders": set(),
    }
    book_missing_cost = set()
    today = date.today().isoformat()
    for order_id, order_rows in groups.items():
        basis_rows = [r for r in order_rows if is_book_source(r)] or order_rows
        first = basis_rows[0]
        created_day = (first["created_at"] or "")[:10] or "Tanpa tanggal"
        if start_date and created_day != "Tanpa tanggal":
            current_day = datetime.strptime(created_day, "%Y-%m-%d").date()
            if current_day < start_date or current_day > end_date:
                continue
        if start_date and created_day == "Tanpa tanggal":
            continue
        gross_sum = sum(abs(float(r["gross_product"] or 0)) for r in basis_rows)
        seller_discount_total = sum(abs(float(r["seller_discount"] or 0)) for r in basis_rows)
        product_net_total = max(gross_sum - seller_discount_total, 0)
        line_order_total = sum(abs(float(r["order_amount"] or 0)) for r in basis_rows)
        max_order_amount = max(abs(float(r["order_amount"] or 0)) for r in basis_rows)
        order_total = product_net_total if gross_sum else (max_order_amount or line_order_total or gross_sum)
        settlement_total = max(actual_settlement_amount(r) for r in basis_rows)
        refund_total = max(abs(float(r["refund_amount"] or 0)) for r in basis_rows)
        raw_platform_fee_total = sum(abs(float(r["platform_fee"] or 0)) for r in basis_rows)
        derived_platform_fee = max(order_total - settlement_total, 0) if settlement_total else 0
        platform_fee_total = max(raw_platform_fee_total, derived_platform_fee)
        platform_discount_total = sum(abs(float(r["platform_discount"] or 0)) for r in basis_rows)
        packing_total = max((float(r["packing_per_unit"] or 0) for r in basis_rows if float(r["quantity"] or 0) > 0), default=0)
        cancelled = any(is_cancelled_status(r["status"]) for r in basis_rows)
        unpaid = any(is_unpaid_status(r["status"]) for r in basis_rows)
        excluded = cancelled or unpaid
        is_final = bool(settlement_total) and not excluded
        is_estimated = not settlement_total and not excluded
        totals["orders"].add(order_id)
        totals["lines"] += len(basis_rows)
        if created_day == today:
            totals["todayOrders"] += 1
        daily.setdefault(created_day, {"date": created_day, "orders": set(), "omzet": 0, "profit": 0})
        daily[created_day]["orders"].add(order_id)
        store = first["store_name"] or "TikTok"
        stores.setdefault(store, {"store": store, "orders": set(), "omzet": 0, "profit": 0})
        stores[store]["orders"].add(order_id)
        for r in basis_rows:
            status[r["status"] or "Tanpa status"] = status.get(r["status"] or "Tanpa status", 0) + 1
        if excluded:
            cancelled_value = refund_total or order_total
            totals["refund"] += cancelled_value
            totals["cancelledAmount"] += cancelled_value
            totals["cancelledOrders"].add(order_id)
            if any(is_book_source(r) for r in basis_rows):
                totals["bookRefund"] += cancelled_value
                totals["bookCancelledAmount"] += cancelled_value
                totals["bookCancelledOrders"].add(order_id)
            continue
        totals["omzet"] += order_total
        if is_final:
            totals["finalOrders"].add(order_id)
            totals["finalOmzet"] += order_total
        elif is_estimated:
            totals["estimatedOrders"].add(order_id)
            totals["estimatedOmzet"] += order_total
        totals["gross"] += gross_sum
        totals["sellerDiscount"] += seller_discount_total
        totals["platformFee"] += platform_fee_total
        totals["platformDiscount"] += platform_discount_total
        totals["refund"] += refund_total
        totals["settlement"] += settlement_total
        if not settlement_total:
            totals["held"] += order_total
            totals["heldOrders"].add(order_id)
        daily[created_day]["omzet"] += order_total
        stores[store]["omzet"] += order_total
        book_order = any(is_book_source(r) for r in basis_rows)
        if book_order:
            totals["bookOrders"].add(order_id)
            totals["bookGross"] += gross_sum
            totals["bookSellerDiscount"] += seller_discount_total
            totals["bookOmzet"] += order_total
            totals["bookPlatformFee"] += platform_fee_total
            totals["bookSettlement"] += settlement_total
        for r in basis_rows:
            qty = float(r["quantity"] or 0)
            line_gross = abs(float(r["gross_product"] or 0))
            share = (line_gross / gross_sum) if gross_sum else (1 / len(order_rows))
            omzet = order_total * share
            platform_fee = platform_fee_total * share
            refund = refund_total * share
            hpp = qty * float(r["hpp_per_unit"] or 0)
            packing = packing_total * share
            profit = omzet - platform_fee - refund - hpp - packing
            totals["qty"] += qty
            totals["hpp"] += hpp
            totals["packing"] += packing
            totals["profit"] += profit
            if book_order:
                totals["bookHpp"] += hpp
                totals["bookPacking"] += packing
                totals["bookProfitBeforeAds"] += profit
            if is_final:
                totals["finalProfitBeforeAds"] += profit
            elif is_estimated:
                totals["estimatedProfitBeforeAds"] += profit
            daily[created_day]["profit"] += profit
            stores[store]["profit"] += profit
            if qty and not (r["hpp_per_unit"] or r["packing_per_unit"]):
                missing_cost.add(r["sku"])
                if book_order:
                    book_missing_cost.add(r["sku"])
            key = r["sku"] or "Tanpa SKU"
            sku.setdefault(
                key,
                {
                    "sku": key,
                    "product": r["product_name"],
                    "qty": 0,
                    "orders": set(),
                    "stores": set(),
                    "omzet": 0,
                    "profit": 0,
                    "profitBeforeAds": 0,
                    "hpp": 0,
                    "packing": 0,
                    "platformFee": 0,
                    "refund": 0,
                    "adSpend": 0,
                    "missingCost": False,
                },
            )
            sku[key]["qty"] += qty
            sku[key]["orders"].add(order_id)
            sku[key]["stores"].add(store)
            sku[key]["omzet"] += omzet
            sku[key]["profit"] += profit
            sku[key]["hpp"] += hpp
            sku[key]["packing"] += packing
            sku[key]["platformFee"] += platform_fee
            sku[key]["refund"] += refund
            if qty and not (r["hpp_per_unit"] or r["packing_per_unit"]):
                sku[key]["missingCost"] = True
    ad_rows = filtered_ad_spend(filters, start_date, end_date)
    ad_by_store = {}
    for expense in ad_rows:
        amount = float(expense["amount"] or 0)
        totals["adSpend"] += amount
        spend_day = expense["spend_date"] or "Tanpa tanggal"
        daily.setdefault(spend_day, {"date": spend_day, "orders": set(), "omzet": 0, "profit": 0})
        daily[spend_day]["profit"] -= amount
        store = expense["store_name"] or DEFAULT_STORE
        stores.setdefault(store, {"store": store, "orders": set(), "omzet": 0, "profit": 0})
        stores[store]["profit"] -= amount
        ad_by_store[store] = ad_by_store.get(store, 0) + amount
    totals["profitBeforeAds"] = totals["profit"]
    totals["bookAdSpend"] = totals["adSpend"]
    totals["bookHeld"] = max(totals["bookOmzet"] - totals["bookPlatformFee"] - totals["bookSettlement"], 0)
    totals["bookProfit"] = totals["bookProfitBeforeAds"] - totals["bookAdSpend"]
    if totals["omzet"]:
        totals["finalAdSpend"] = totals["adSpend"] * (totals["finalOmzet"] / totals["omzet"])
        totals["estimatedAdSpend"] = totals["adSpend"] - totals["finalAdSpend"]
    totals["finalProfit"] = totals["finalProfitBeforeAds"] - totals["finalAdSpend"]
    totals["estimatedProfit"] = totals["estimatedProfitBeforeAds"] - totals["estimatedAdSpend"]
    totals["profit"] -= totals["adSpend"]
    order_count = len(totals["orders"])
    final_order_count = len(totals["finalOrders"])
    estimated_order_count = len(totals["estimatedOrders"])
    held_order_count = len(totals["heldOrders"])
    cancelled_order_count = len(totals["cancelledOrders"])
    book_order_count = len(totals["bookOrders"])
    book_cancelled_order_count = len(totals["bookCancelledOrders"])
    margin = (totals["profit"] / totals["omzet"] * 100) if totals["omzet"] else 0
    final_margin = (totals["finalProfit"] / totals["finalOmzet"] * 100) if totals["finalOmzet"] else 0
    estimated_margin = (totals["estimatedProfit"] / totals["estimatedOmzet"] * 100) if totals["estimatedOmzet"] else 0
    book_margin = (totals["bookProfit"] / totals["bookOmzet"] * 100) if totals["bookOmzet"] else 0
    primary_margin = book_margin if book_order_count else margin
    daily_list = []
    for item in daily.values():
        item["orders"] = len(item["orders"])
        daily_list.append(item)
    store_list = []
    for item in stores.values():
        item["orders"] = len(item["orders"])
        store_list.append(item)
    for store in read_config().get("stores", DEFAULT_STORES):
        if not any(item["store"] == store for item in store_list):
            store_list.append({"store": store, "orders": 0, "omzet": 0, "profit": 0})
    sku_details = []
    for item in sku.values():
        item["orders"] = len(item["orders"])
        item["stores"] = sorted(item["stores"])
        item["profitBeforeAds"] = item["profit"]
        item["adSpend"] = (totals["adSpend"] * item["omzet"] / totals["omzet"]) if totals["omzet"] else 0
        item["profit"] = item["profitBeforeAds"] - item["adSpend"]
        item["costTotal"] = item["hpp"] + item["packing"] + item["platformFee"] + item["refund"] + item["adSpend"]
        item["margin"] = (item["profit"] / item["omzet"] * 100) if item["omzet"] else 0
        item["aov"] = (item["omzet"] / item["orders"]) if item["orders"] else 0
        if item["missingCost"]:
            item["status"] = "HPP belum lengkap"
            item["statusLevel"] = "warn"
        elif item["profit"] < 0:
            item["status"] = "Rugi"
            item["statusLevel"] = "bad"
        elif item["margin"] < 10:
            item["status"] = "Kurang bagus"
            item["statusLevel"] = "bad"
        elif item["margin"] < 20:
            item["status"] = "Perlu dipantau"
            item["statusLevel"] = "watch"
        else:
            item["status"] = "Penghasil"
            item["statusLevel"] = "good"
        sku_details.append(item)
    reliable_sku = [item for item in sku_details if not item["missingCost"]]
    top_sku = sorted(reliable_sku or sku_details, key=lambda x: x["profit"], reverse=True)[:12]
    weak_priority = {"bad": 0, "warn": 1, "watch": 2, "good": 3}
    weak_sku = sorted(sku_details, key=lambda x: (weak_priority.get(x["statusLevel"], 4), x["profit"]))[:8]
    sku_summary = {
        "total": len(sku_details),
        "profitable": sum(1 for item in sku_details if item["statusLevel"] == "good"),
        "watch": sum(1 for item in sku_details if item["statusLevel"] == "watch"),
        "bad": sum(1 for item in sku_details if item["statusLevel"] == "bad"),
        "missingCost": sum(1 for item in sku_details if item["missingCost"]),
        "best": top_sku[0] if top_sku else None,
        "weakest": weak_sku[0] if weak_sku else None,
    }
    recent_runs = []
    with connect() as conn:
        for r in conn.execute("SELECT * FROM import_runs ORDER BY id DESC LIMIT 8").fetchall():
            recent_runs.append(dict(r))
    alerts = []
    primary_profit = totals["bookProfit"] if book_order_count else totals["profit"]
    if primary_profit < 0:
        alerts.append({"level": "danger", "title": "Profit total negatif", "body": "Perlu cek HPP, potongan, dan SKU rugi."})
    primary_omzet = totals["bookOmzet"] if book_order_count else totals["omzet"]
    if primary_omzet and primary_margin < 12:
        margin_text = f"{primary_margin:.2f}" if 0 < abs(primary_margin) < 1 else f"{primary_margin:.1f}"
        alerts.append({"level": "warn", "title": "Margin tipis", "body": f"Margin bersih sementara {margin_text}%."})
    if totals["adSpend"] and primary_omzet and totals["adSpend"] / primary_omzet > 0.2:
        alerts.append({"level": "warn", "title": "Biaya iklan tinggi", "body": "Biaya iklan lebih dari 20% omset periode ini."})
    missing_for_alert = book_missing_cost if len(totals["bookOrders"]) else missing_cost
    if missing_for_alert:
        alerts.append({"level": "warn", "title": "Ada SKU tanpa HPP", "body": f"{len(missing_for_alert)} SKU belum punya HPP/packing."})
    assistant = build_assistant(totals, primary_margin, top_sku, weak_sku, missing_for_alert, daily_list)
    return {
        "generatedAt": now_iso(),
        "totals": {
            **totals,
            "orders": order_count,
            "finalOrders": final_order_count,
            "estimatedOrders": estimated_order_count,
            "heldOrders": held_order_count,
            "cancelledOrders": cancelled_order_count,
            "bookOrders": book_order_count,
            "bookCancelledOrders": book_cancelled_order_count,
            "margin": margin,
            "finalMargin": final_margin,
            "estimatedMargin": estimated_margin,
            "bookMargin": book_margin,
        },
        "daily": sorted(daily_list, key=lambda x: x["date"])[-30:],
        "topSku": top_sku,
        "weakSku": weak_sku,
        "skuDetails": sorted(sku_details, key=lambda x: x["profit"], reverse=True),
        "skuSummary": sku_summary,
        "stores": sorted(store_list, key=lambda x: x["omzet"], reverse=True),
        "status": [{"status": k, "count": v} for k, v in sorted(status.items(), key=lambda x: x[1], reverse=True)],
        "missingCost": sorted(missing_cost)[:30],
        "alerts": alerts,
        "assistant": assistant,
        "filters": {
            **filters,
            "startDate": start_date.isoformat() if start_date else "",
            "endDate": end_date.isoformat() if end_date else "",
        },
        "availableMonths": available_months(),
        "availableStores": read_config().get("stores", DEFAULT_STORES),
        "adSpendRows": ad_rows[:12],
        "runs": recent_runs,
        "auditEvents": recent_audit_events(filters),
    }


def redact_summary(summary, role="team"):
    safe = copy.deepcopy(summary)
    safe["accessRole"] = role
    for key in SECRET_TOTAL_KEYS:
        if key in safe.get("totals", {}):
            safe["totals"][key] = 0
    for row in safe.get("daily", []):
        row["profit"] = 0
    for row in safe.get("stores", []):
        row.pop("profit", None)
    public_sku = []
    for row in safe.get("topSku", []):
        public_sku.append(
            {
                "sku": row.get("sku"),
                "product": row.get("product"),
                "qty": row.get("qty", 0),
                "orders": row.get("orders", 0),
                "omzet": row.get("omzet", 0),
            }
        )
    safe["topSku"] = public_sku
    safe["weakSku"] = []
    safe["skuDetails"] = []
    safe["skuSummary"] = {
        "total": safe.get("skuSummary", {}).get("total", 0),
        "profitable": 0,
        "watch": 0,
        "bad": 0,
        "missingCost": 0,
        "best": public_sku[0] if public_sku else None,
        "weakest": None,
    }
    safe["alerts"] = [
        {
            "level": "warn",
            "title": "Mode tim aktif",
            "body": "Profit, HPP, pencairan, refund, potongan, biaya iklan, dan audit sensitif disembunyikan.",
        }
    ]
    safe["assistant"] = {
        "score": 0,
        "health": "Mode Tim",
        "forecast30Omzet": safe.get("assistant", {}).get("forecast30Omzet", 0),
        "forecast30Profit": 0,
        "accounting": {
            "pendapatan": safe.get("totals", {}).get("omzet", 0),
            "omzetKotor": 0,
            "diskonSeller": 0,
            "omzetNet": safe.get("totals", {}).get("omzet", 0),
            "settlementCair": 0,
            "hppPacking": 0,
            "hpp": 0,
            "packing": 0,
            "potonganPlatform": 0,
            "biayaIklan": 0,
            "totalBiaya": 0,
            "danaTertahan": 0,
            "refund": 0,
            "returCancel": 0,
            "profitBersih": 0,
            "profitEstimasi": 0,
            "profitFinal": 0,
            "profitBelumFinal": 0,
            "omsetFinal": 0,
            "omsetBelumFinal": 0,
        },
        "insights": ["Mode tim hanya menampilkan data operasional yang aman untuk dibagikan."],
        "actions": ["Gunakan akses owner untuk melihat profit, biaya, pencairan, dan rekomendasi finansial lengkap."],
    }
    safe["adSpendRows"] = []
    safe["auditEvents"] = []
    safe["runs"] = []
    return safe


def build_assistant(totals, margin, top_sku, weak_sku, missing_cost, daily_list):
    profit = float(totals["profit"] or 0)
    hpp_total = float(totals["hpp"] or 0) + float(totals["packing"] or 0)
    ad_spend = float(totals["adSpend"] or 0)
    final_profit = float(totals.get("finalProfit", 0) or 0)
    estimated_profit = float(totals.get("estimatedProfit", 0) or 0)
    final_omzet = float(totals.get("finalOmzet", 0) or 0)
    estimated_omzet = float(totals.get("estimatedOmzet", 0) or 0)
    book_orders_raw = totals.get("bookOrders", 0) or 0
    book_orders_count = len(book_orders_raw) if isinstance(book_orders_raw, set) else float(book_orders_raw or 0)
    has_book = book_orders_count > 0 or float(totals.get("bookOmzet", 0) or 0) > 0
    omzet = float(totals.get("bookOmzet", 0) or 0) if has_book else float(totals["omzet"] or 0)
    held = float(totals.get("bookHeld", 0) or 0) if has_book else float(totals["held"] or 0)
    refund = float(totals.get("bookCancelledAmount", 0) or 0) if has_book else float(totals["refund"] or 0)
    platform_fee = float(totals.get("bookPlatformFee", 0) or 0) if has_book else float(totals["platformFee"] or 0)
    accounting_omzet = float(totals.get("bookOmzet", 0) or 0) if has_book else omzet
    accounting_profit = float(totals.get("bookProfit", 0) or 0) if has_book else profit
    held_ratio = held / omzet * 100 if omzet else 0
    refund_ratio = refund / omzet * 100 if omzet else 0
    fee_ratio = platform_fee / omzet * 100 if omzet else 0
    ad_ratio = ad_spend / omzet * 100 if omzet else 0
    score = 70
    if margin >= 30:
        score += 15
    elif margin < 15:
        score -= 20
    if held_ratio > 40:
        score -= 12
    if refund_ratio > 10:
        score -= 10
    if ad_ratio > 20:
        score -= 10
    if missing_cost:
        score -= 12
    score = max(0, min(100, score))
    avg_daily = sum(float(d.get("omzet", 0)) for d in daily_list[-14:]) / max(len(daily_list[-14:]), 1)
    forecast_30 = avg_daily * 30
    forecast_profit = forecast_30 * (margin / 100) if omzet else 0
    insights = []
    actions = []
    margin_text = f"{margin:.2f}" if 0 < abs(margin) < 1 else f"{margin:.1f}"
    if margin >= 30:
        insights.append(f"Margin bersih kuat di {margin_text}%. Bisnis terlihat sehat, selama HPP semua SKU sudah lengkap.")
    elif margin >= 15:
        insights.append(f"Margin bersih sedang di {margin_text}%. Masih sehat, tapi ruang salah harga dan promo mulai sempit.")
    else:
        insights.append(f"Margin bersih tipis di {margin_text}%. Ini perlu dipantau sebelum menaikkan budget iklan atau diskon.")
    if held_ratio > 30:
        insights.append(f"Dana tertahan sekitar {held_ratio:.1f}% dari omset terdata. Arus kas perlu dicek dari order yang belum cair.")
        actions.append("Prioritaskan cek order belum selesai/cair supaya kas harian tidak terlihat semu.")
    if refund_ratio > 8:
        insights.append(f"Refund cukup tinggi, sekitar {refund_ratio:.1f}% dari omset. Ini bisa menggerus profit nyata.")
        actions.append("Audit SKU dengan refund tertinggi dan cek penyebab retur/cancel.")
    if fee_ratio > 8:
        actions.append("Cek potongan platform dan promo, terutama jika biaya platform naik tanpa kenaikan order.")
    if ad_spend:
        insights.append(f"Biaya iklan tercatat {ad_ratio:.1f}% dari omset periode ini.")
        if ad_ratio > 20:
            actions.append("Turunkan atau evaluasi campaign iklan yang ROAS/profit SKU-nya belum jelas.")
    if missing_cost:
        actions.append(f"Lengkapi HPP untuk {len(missing_cost)} SKU agar profit tidak terlalu optimistis.")
    if not has_book and estimated_omzet > final_omzet:
        insights.append("Porsi profit estimasi masih lebih besar dari profit final, jadi keputusan cashflow sebaiknya menunggu pencairan berikutnya.")
        actions.append("Pantau daftar order belum cair dan bandingkan dengan pencairan upload berikutnya.")
    if top_sku:
        actions.append(f"SKU {top_sku[0]['sku']} paling produktif. Pastikan stok, bahan, dan kapasitas produksi aman.")
    if weak_sku:
        actions.append(f"SKU {weak_sku[0]['sku']} perlu dicek harga, HPP, promo, atau kualitas traffic.")
    return {
        "score": score,
        "health": "Sehat" if score >= 75 else "Perlu Dipantau" if score >= 55 else "Butuh Tindakan",
        "forecast30Omzet": forecast_30,
        "forecast30Profit": forecast_profit,
        "accounting": {
            "pendapatan": accounting_omzet,
            "omzetKotor": float(totals.get("bookGross" if has_book else "gross", 0) or 0),
            "diskonSeller": float(totals.get("bookSellerDiscount" if has_book else "sellerDiscount", 0) or 0),
            "omzetNet": accounting_omzet,
            "settlementCair": float(totals.get("bookSettlement" if has_book else "settlement", 0) or 0),
            "hppPacking": (float(totals.get("bookHpp", 0) or 0) + float(totals.get("bookPacking", 0) or 0)) if has_book else hpp_total,
            "hpp": float(totals.get("bookHpp" if has_book else "hpp", 0) or 0),
            "packing": float(totals.get("bookPacking" if has_book else "packing", 0) or 0),
            "potonganPlatform": float(totals.get("bookPlatformFee" if has_book else "platformFee", 0) or 0),
            "biayaIklan": ad_spend,
            "totalBiaya": ((float(totals.get("bookHpp", 0) or 0) + float(totals.get("bookPacking", 0) or 0)) if has_book else hpp_total) + ad_spend,
            "danaTertahan": float(totals.get("bookHeld" if has_book else "held", 0) or 0),
            "refund": float(totals.get("bookCancelledAmount", 0) or 0) if has_book else refund,
            "returCancel": float(totals.get("bookCancelledAmount" if has_book else "cancelledAmount", 0) or 0),
            "profitBersih": accounting_profit,
            "profitEstimasi": accounting_profit,
            "profitFinal": accounting_profit if has_book else final_profit,
            "profitBelumFinal": estimated_profit,
            "omsetFinal": accounting_omzet if has_book else final_omzet,
            "omsetBelumFinal": estimated_omzet,
        },
        "insights": insights,
        "actions": actions[:6],
    }


def telegram_message(summary):
    t = summary["totals"]
    top = summary["topSku"][0] if summary["topSku"] else {"sku": "-", "profit": 0}
    weak = summary["weakSku"][0] if summary["weakSku"] else {"sku": "-", "profit": 0}
    alerts = "\n".join([f"- {a['title']}: {a['body']}" for a in summary["alerts"]]) or "- Tidak ada alert besar"
    has_book = float(t.get("bookOrders", 0) or 0) > 0 or float(t.get("bookOmzet", 0) or 0) > 0
    accounting_omzet = t.get("bookOmzet") if has_book else t.get("omzet")
    accounting_profit = t.get("bookProfit") if has_book else t.get("finalProfit")
    accounting_margin = t.get("bookMargin") if has_book else t.get("finalMargin")
    return (
        "Ringkasan Keuangan TikTok\n"
        f"Waktu: {summary['generatedAt']}\n\n"
        f"Order unik: {t['orders']}\n"
        f"Omzet net: Rp{rupiah(accounting_omzet):,}\n"
        f"Dana tertahan: Rp{rupiah(t.get('bookHeld') if has_book else t.get('held')):,}\n"
        f"Settlement cair: Rp{rupiah(t.get('bookSettlement') if has_book else t.get('settlement')):,}\n"
        f"Potongan platform: Rp{rupiah(t.get('bookPlatformFee') if has_book else t.get('platformFee')):,}\n"
        f"HPP + packing: Rp{rupiah((t.get('bookHpp', 0) + t.get('bookPacking', 0)) if has_book else (t['hpp'] + t['packing'])):,}\n"
        f"Biaya iklan: Rp{rupiah(t.get('adSpend', 0)):,}\n"
        f"Profit bersih: Rp{rupiah(accounting_profit):,} ({accounting_margin:.1f}%)\n"
        f"Profit estimasi operasional: Rp{rupiah(t['profit']):,} ({t['margin']:.1f}%)\n\n"
        f"SKU profit tertinggi: {top['sku']} Rp{rupiah(top['profit']):,}\n"
        f"SKU perlu dicek: {weak['sku']} Rp{rupiah(weak['profit']):,}\n\n"
        f"Alert:\n{alerts}"
    ).replace(",", ".")


def send_telegram(text):
    cfg = read_config()
    token = cfg.get("telegramBotToken", "").strip()
    chat_id = cfg.get("telegramChatId", "").strip()
    if not token or not chat_id:
        raise ValueError("Telegram Bot Token dan Chat ID belum diisi.")
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode()
    with urllib.request.urlopen(url, data=data, timeout=15) as resp:
        return json.loads(resp.read().decode())


def scan_folder_once(folder_config):
    raw_path = str(folder_config.get("path", "") or "").strip()
    if not raw_path:
        folder_config["lastMessage"] = "Folder belum diisi"
        return {"ok": False, "message": "Folder belum diisi.", "results": [], "errors": []}
    folder = Path(raw_path).expanduser()
    if not folder.exists() or not folder.is_dir():
        return {"ok": False, "message": "Folder tidak ditemukan.", "results": []}
    state = dict(folder_config.get("fileState") or {})
    results = []
    errors = []
    for path in sorted(folder.iterdir()):
        if path.suffix.lower() not in {".csv", ".xlsx"} or path.name.startswith("~$"):
            continue
        stat = path.stat()
        signature = f"{int(stat.st_mtime)}:{stat.st_size}"
        if state.get(str(path)) == signature:
            continue
        try:
            results.append(detect_and_import(path, folder_config.get("kind", "auto"), folder_config.get("storeName", DEFAULT_STORE)))
            state[str(path)] = signature
        except Exception as exc:
            errors.append({"file": path.name, "error": str(exc)})
    folder_config["fileState"] = state
    folder_config["lastRun"] = now_iso()
    if results and errors:
        folder_config["lastMessage"] = f"{len(results)} file diproses, {len(errors)} error"
    elif results:
        folder_config["lastMessage"] = f"{len(results)} file baru/berubah diproses"
    elif errors:
        folder_config["lastMessage"] = f"{len(errors)} file gagal diproses"
    else:
        folder_config["lastMessage"] = "Tidak ada file baru"
    return {"ok": not errors, "message": folder_config["lastMessage"], "results": results, "errors": errors}


def run_folder_monitor(store_name=None, force=False):
    cfg = read_config()
    monitors = cfg.get("folderMonitors", {})
    if store_name and store_name != "all":
        targets = [normalize_store(store_name)]
    else:
        targets = list(monitors.keys())
    all_results = []
    all_errors = []
    store_results = []
    for store in targets:
        monitor = monitors.get(store) or default_folder_monitor(store)
        if not force and not monitor.get("enabled"):
            store_results.append({"storeName": store, "ok": True, "message": "Monitor folder belum aktif", "results": [], "errors": []})
            continue
        last_run = monitor.get("lastRun")
        interval = int(monitor.get("intervalMinutes") or 10)
        if not force and last_run:
            last_dt = datetime.strptime(last_run, "%Y-%m-%d %H:%M:%S")
            if datetime.now() - last_dt < timedelta(minutes=interval):
                store_results.append({"storeName": store, "ok": True, "message": "Belum waktunya scan berikutnya", "results": [], "errors": []})
                continue
        result = scan_folder_once(monitor)
        result["storeName"] = store
        monitors[store] = monitor
        all_results.extend(result.get("results", []))
        all_errors.extend(result.get("errors", []))
        store_results.append(result)
    cfg["folderMonitors"] = monitors
    cfg["folderMonitor"] = monitors.get(normalize_store(cfg.get("defaultStore", DEFAULT_STORE)), default_folder_monitor(DEFAULT_STORE))
    write_config(cfg)
    if all_results or all_errors:
        message = f"{len(all_results)} file diproses, {len(all_errors)} error"
    elif len(store_results) == 1 and not store_results[0].get("ok"):
        message = store_results[0].get("message", "Folder belum siap")
    elif any(not r.get("ok") for r in store_results):
        message = f"{sum(1 for r in store_results if not r.get('ok'))} toko belum punya folder siap scan"
    elif any("file" in r.get("message", "").lower() for r in store_results):
        message = "Tidak ada file baru"
    else:
        message = "Belum ada monitor folder yang perlu discan"
    return {"ok": not all_errors, "message": message, "results": all_results, "errors": all_errors, "stores": store_results}


def scheduler_loop():
    while True:
        try:
            cfg = read_config()
            current = datetime.now().strftime("%H:%M")
            today = date.today().isoformat()
            run_folder_monitor(force=False)
            if current == cfg.get("morningTime", "07:30") and cfg.get("lastMorningSent") != today:
                summary = compute_summary()
                send_telegram(telegram_message(summary))
                cfg["lastMorningSent"] = today
                write_config(cfg)
            time.sleep(30)
        except Exception:
            time.sleep(60)


class AppHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def send_json(self, data, status=200):
        payload = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_file(self, path, content_type):
        payload = Path(path).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def owner_pin(self):
        return self.headers.get("X-Owner-Pin", "").strip()

    def require_owner(self):
        if owner_pin_valid(self.owner_pin()):
            return True
        self.send_json({"ok": False, "ownerLocked": True, "error": "PIN Owner diperlukan."}, 401)
        return False

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        route = parsed.path
        query = urllib.parse.parse_qs(parsed.query)
        if route in {"/", "/owner", "/team", "/tv", "/static/index.html"}:
            return self.send_file(ROOT / "static" / "index.html", "text/html; charset=utf-8")
        if route == "/static/styles.css":
            return self.send_file(ROOT / "static" / "styles.css", "text/css; charset=utf-8")
        if route == "/static/app.js":
            return self.send_file(ROOT / "static" / "app.js", "application/javascript; charset=utf-8")
        if route == "/api/summary":
            role = query.get("role", ["owner"])[0] if isinstance(query.get("role"), list) else query.get("role", "owner")
            role = role if role in {"owner", "team", "tv"} else "owner"
            if role == "owner" and not owner_pin_valid(self.owner_pin()):
                return self.send_json({"ok": False, "ownerLocked": True, "error": "PIN Owner diperlukan."}, 401)
            summary = compute_summary(build_filters(query))
            summary["accessRole"] = role
            if role != "owner":
                summary = redact_summary(summary, role)
            return self.send_json(summary)
        if route == "/api/config":
            cfg = read_config()
            cfg["telegramBotToken"] = "••••••" if cfg.get("telegramBotToken") else ""
            cfg["telegramChatId"] = "••••••" if cfg.get("telegramChatId") else ""
            cfg["ownerPinEnabled"] = bool(cfg.get("ownerPinHash"))
            cfg["ownerPin"] = "••••••" if cfg.get("ownerPinHash") else ""
            cfg.pop("ownerPinHash", None)
            return self.send_json(cfg)
        self.send_error(404)

    def do_POST(self):
        route = urllib.parse.urlparse(self.path).path
        try:
            if route == "/api/import-samples":
                if not self.require_owner():
                    return
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode() or "{}") if length else {}
                store_name = body.get("storeName", DEFAULT_STORE)
                return self.send_json({"ok": True, "results": import_samples(store_name), "summary": compute_summary()})
            if route == "/api/config":
                if not self.require_owner():
                    return
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode())
                current = read_config()
                for key in ["morningTime", "alertNegativeProfit", "alertMarginBelow", "defaultStore", "stores"]:
                    if key in body:
                        current[key] = body[key]
                if body.get("telegramChatId") and body.get("telegramChatId") != "••••••":
                    current["telegramChatId"] = body["telegramChatId"]
                if body.get("telegramBotToken") and body.get("telegramBotToken") != "••••••":
                    current["telegramBotToken"] = body["telegramBotToken"]
                if body.get("ownerPin") and body.get("ownerPin") != "••••••":
                    current["ownerPinHash"] = hash_owner_pin(body["ownerPin"])
                if body.get("clearOwnerPin"):
                    current["ownerPinHash"] = ""
                write_config(current)
                return self.send_json({"ok": True})
            if route == "/api/folder-monitor":
                if not self.require_owner():
                    return
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode())
                current = read_config()
                store_name = normalize_store(body.get("storeName", current.get("defaultStore", DEFAULT_STORE)))
                monitors = current.get("folderMonitors", {})
                monitor = monitors.get(store_name) or default_folder_monitor(store_name)
                previous_path = monitor.get("path")
                previous_kind = monitor.get("kind")
                for key in ["enabled", "path", "intervalMinutes", "storeName", "kind"]:
                    if key in body:
                        monitor[key] = body[key]
                monitor["storeName"] = store_name
                monitor["intervalMinutes"] = int(monitor.get("intervalMinutes") or 10)
                if previous_path != monitor.get("path") or previous_kind != monitor.get("kind"):
                    monitor["fileState"] = {}
                    monitor["lastMessage"] = "Pengaturan folder diperbarui"
                    monitor["lastRun"] = ""
                monitors[store_name] = monitor
                current["folderMonitors"] = monitors
                current["folderMonitor"] = monitor
                write_config(current)
                return self.send_json({"ok": True, "folderMonitor": monitor, "folderMonitors": current.get("folderMonitors", {})})
            if route == "/api/folder-run":
                if not self.require_owner():
                    return
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode() or "{}") if length else {}
                result = run_folder_monitor(body.get("storeName"), force=True)
                return self.send_json({"ok": True, **result, "summary": compute_summary()})
            if route == "/api/ad-spend":
                if not self.require_owner():
                    return
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode())
                result = save_ad_spend(body)
                return self.send_json({"ok": True, "result": result, "summary": compute_summary()})
            if route == "/api/telegram-test":
                if not self.require_owner():
                    return
                summary = compute_summary()
                result = send_telegram(telegram_message(summary))
                return self.send_json({"ok": True, "result": result})
            if route == "/api/upload":
                if not self.require_owner():
                    return
                return self.handle_upload()
            self.send_error(404)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, 500)

    def handle_upload(self):
        content_type = self.headers.get("Content-Type", "")
        boundary = content_type.split("boundary=")[-1].encode()
        if not boundary or b"multipart/form-data" not in content_type.encode():
            raise ValueError("Upload harus multipart/form-data.")
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        marker = b"--" + boundary
        results = []
        fields = {}
        files = []
        for part in raw.split(marker):
            if b"Content-Disposition" not in part or b"\r\n\r\n" not in part:
                continue
            header, filedata = part.split(b"\r\n\r\n", 1)
            filedata = filedata.rsplit(b"\r\n", 1)[0]
            header_text = header.decode(errors="ignore")
            name = header_text.split('name="', 1)[1].split('"', 1)[0] if 'name="' in header_text else ""
            if "filename=" not in header_text:
                fields[name] = filedata.decode(errors="ignore")
                continue
            filename = header_text.split('filename="', 1)[1].split('"', 1)[0]
            if not filename:
                continue
            safe_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{Path(filename).name}"
            dest = UPLOAD_DIR / safe_name
            dest.write_bytes(filedata)
            files.append(dest)
        kind = fields.get("kind", "auto")
        store_name = fields.get("storeName", DEFAULT_STORE)
        for dest in files:
            results.append(detect_and_import(dest, kind, store_name))
        return self.send_json({"ok": True, "results": results, "summary": compute_summary()})


def main():
    ensure_dirs()
    init_db()
    if not CONFIG_PATH.exists():
        write_config(read_config())
    threading.Thread(target=scheduler_loop, daemon=True).start()
    port = int(os.environ.get("PORT", "8787"))
    server = ThreadingHTTPServer(("127.0.0.1", port), AppHandler)
    print(f"Dashboard siap: http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
