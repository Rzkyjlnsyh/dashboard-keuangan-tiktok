from http.server import BaseHTTPRequestHandler
import json
from datetime import datetime


EMPTY_SUMMARY = {
    "generatedAt": "",
    "totals": {
        "orders": 0,
        "lines": 0,
        "qty": 0,
        "gross": 0,
        "omzet": 0,
        "platformFee": 0,
        "platformDiscount": 0,
        "hpp": 0,
        "packing": 0,
        "refund": 0,
        "settlement": 0,
        "held": 0,
        "profit": 0,
        "profitBeforeAds": 0,
        "adSpend": 0,
        "todayOrders": 0,
        "margin": 0,
        "finalProfit": 0,
        "estimatedProfit": 0,
        "finalProfitBeforeAds": 0,
        "estimatedProfitBeforeAds": 0,
        "finalAdSpend": 0,
        "estimatedAdSpend": 0,
        "finalOmzet": 0,
        "estimatedOmzet": 0,
        "finalOrders": 0,
        "estimatedOrders": 0,
        "heldOrders": 0,
        "finalMargin": 0,
        "estimatedMargin": 0,
    },
    "daily": [],
    "topSku": [],
    "weakSku": [],
    "skuDetails": [],
    "skuSummary": {
        "total": 0,
        "profitable": 0,
        "watch": 0,
        "bad": 0,
        "missingCost": 0,
        "best": None,
        "weakest": None,
    },
    "stores": [
        {"store": "ventura", "orders": 0, "omzet": 0, "profit": 0},
        {"store": "giftyours", "orders": 0, "omzet": 0, "profit": 0},
        {"store": "custombase", "orders": 0, "omzet": 0, "profit": 0},
    ],
    "status": [],
    "missingCost": [],
    "alerts": [
        {
            "level": "warn",
            "title": "Mode preview cloud",
            "body": "Data real tidak disertakan di Vercel. Jalankan versi lokal untuk membaca database dan folder download.",
        }
    ],
    "assistant": {
        "score": 0,
        "health": "Menunggu Data",
        "forecast30Omzet": 0,
        "forecast30Profit": 0,
        "accounting": {
            "pendapatan": 0,
            "hppPacking": 0,
            "potonganPlatform": 0,
            "biayaIklan": 0,
            "refund": 0,
            "profitEstimasi": 0,
            "profitFinal": 0,
            "profitBelumFinal": 0,
            "omsetFinal": 0,
            "omsetBelumFinal": 0,
        },
        "insights": ["Preview Vercel tidak membawa database lokal agar data toko tetap aman."],
        "actions": ["Gunakan dashboard lokal untuk data real, atau lanjutkan fase cloud upload/storage."],
    },
    "filters": {"preset": "all", "month": "", "store": "all", "startDate": "", "endDate": ""},
    "availableMonths": [],
    "availableStores": ["ventura", "giftyours", "custombase"],
    "adSpendRows": [],
    "runs": [],
    "auditEvents": [],
    "accessRole": "team",
}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        payload = dict(EMPTY_SUMMARY)
        payload["generatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
