#!/usr/bin/env python3
"""Cleanup duplicate order_lines and audit_events in SQLite.
Menghapus duplikat line_key — keep 1 row dengan last_seen_at terbaru.
Juga cleanup audit_events yang orphan (nggak ada order_lines nya)."""

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "finance_assistant.db"


def cleanup_order_lines(conn):
    """Hapus duplikat line_key, keep row dengan last_seen_at terbaru."""
    dups = conn.execute("""
        SELECT line_key, COUNT(*) as cnt
        FROM order_lines
        GROUP BY line_key
        HAVING cnt > 1
    """).fetchall()

    if not dups:
        print("✅ Tidak ada duplikat order_lines.")
        return 0

    total_removed = 0
    for (line_key, cnt) in dups:
        # Ambil semua row untuk line_key ini, urut dari terbaru
        rows = conn.execute("""
            SELECT rowid, last_seen_at
            FROM order_lines
            WHERE line_key = ?
            ORDER BY last_seen_at DESC
        """, (line_key,)).fetchall()

        # Keep row pertama (terbaru), hapus sisanya
        keep_rowid = rows[0][0]
        for rowid, _ in rows[1:]:
            conn.execute("DELETE FROM order_lines WHERE rowid = ?", (rowid,))
            total_removed += 1

        print(f"   🗑️  {line_key[:60]}... — {cnt - 1} duplikat dihapus (keep rowid {keep_rowid})")

    return total_removed


def cleanup_orphan_audit(conn):
    """Hapus audit_events yang line_key-nya tidak ada di order_lines."""
    orphans = conn.execute("""
        SELECT COUNT(*) FROM audit_events ae
        WHERE NOT EXISTS (
            SELECT 1 FROM order_lines ol
            WHERE ol.line_key = ae.entity_key
        )
    """).fetchone()[0]

    if orphans:
        conn.execute("""
            DELETE FROM audit_events
            WHERE entity_type = 'order_line'
            AND NOT EXISTS (
                SELECT 1 FROM order_lines ol
                WHERE ol.line_key = audit_events.entity_key
            )
        """)
        print(f"   🗑️  {orphans} audit_events orphan dihapus")
    else:
        print("✅ Tidak ada audit_events orphan.")

    return orphans


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    print("🔍 Cek duplikat di order_lines...")
    removed = cleanup_order_lines(conn)

    print("\n🔍 Cek orphan audit_events...")
    orphan_count = cleanup_orphan_audit(conn)

    conn.commit()

    total = removed + orphan_count
    if total:
        print(f"\n✅ Selesai! Total {total} baris dibersihkan.")
    else:
        print("\n✅ Database sudah bersih, tidak ada yang perlu dibersihkan.")

    # Verify
    remaining = conn.execute("""
        SELECT COUNT(*) FROM (
            SELECT line_key FROM order_lines GROUP BY line_key HAVING COUNT(*) > 1
        )
    """).fetchone()[0]
    if remaining:
        print(f"⚠️  Masih ada {remaining} line_key duplikat — jalankan ulang.")
    else:
        print("✅ Verifikasi: tidak ada duplikat tersisa.")

    conn.close()


if __name__ == "__main__":
    main()
