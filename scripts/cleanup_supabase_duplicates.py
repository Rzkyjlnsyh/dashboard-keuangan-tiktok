#!/usr/bin/env python3
"""Cleanup duplicate order_lines di Supabase via API.
Menghapus duplikat line_key — keep 1 row dengan last_seen_at terbaru."""

import json
import os
import sys
from collections import defaultdict
from urllib.request import Request, urlopen

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
TABLE = "finance_order_lines"

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("ERROR: SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY harus diset di env.")
    sys.exit(1)

BASE = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{TABLE}"


def request(method, path="", body=None, params=""):
    url = f"{BASE}{path}?{params}" if params else f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    req = Request(url, data=data, method=method)
    req.add_header("apikey", SUPABASE_SERVICE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_SERVICE_KEY}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=minimal")
    try:
        with urlopen(req, timeout=30) as resp:
            text = resp.read().decode()
            return json.loads(text) if text else []
    except Exception as e:
        print(f"   ⚠️  {e}")
        return None


def get_all_lines():
    """Fetch ALL rows (handle pagination)."""
    rows = []
    page = 0
    limit = 1000
    while True:
        params = f"select=line_key,last_seen_at&order=line_key.asc&limit={limit}&offset={page * limit}"
        chunk = request("GET", params=params)
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < limit:
            break
        page += 1
    return rows


def delete_line(line_key):
    """Delete a specific line_key."""
    params = f"line_key=eq.{quote(line_key)}"
    request("DELETE", params=params)


def quote(s):
    return s.replace("'", "''").replace(" ", "%20").replace("|", "%7C").replace("(", "%28").replace(")", "%29")


def main():
    print("📡 Fetching semua data dari Supabase...")
    rows = get_all_lines()
    print(f"   Total {len(rows)} baris ditemukan.")

    # Group by line_key
    groups = defaultdict(list)
    for row in rows:
        groups[row["line_key"]].append(row)

    dups = {k: v for k, v in groups.items() if len(v) > 1}
    if not dups:
        print("✅ Tidak ada duplikat di Supabase.")
        return

    print(f"\n🔍 Ditemukan {len(dups)} line_key duplikat:")
    total_removed = 0
    for line_key, group in sorted(dups.items()):
        # Sort by last_seen_at descending, keep first
        sorted_group = sorted(group, key=lambda r: r.get("last_seen_at", "") or "", reverse=True)
        keep = sorted_group[0]
        to_delete = sorted_group[1:]
        print(f"   🗑️  {line_key[:60]}... — {len(to_delete)} duplikat (keep {keep.get('last_seen_at', 'N/A')})")
        for dup in to_delete:
            delete_line(dup["line_key"])
            total_removed += 1

    print(f"\n✅ Selesai! Total {total_removed} baris duplikat dihapus dari Supabase.")


if __name__ == "__main__":
    main()
