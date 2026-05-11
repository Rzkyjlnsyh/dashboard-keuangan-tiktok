from http.server import BaseHTTPRequestHandler
import json


class handler(BaseHTTPRequestHandler):
    def _send(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        folder_monitors = {
            store: {
                "enabled": False,
                "path": "",
                "intervalMinutes": 10,
                "storeName": store,
                "kind": "auto",
                "lastRun": "",
                "lastMessage": "Auto update folder hanya tersedia di versi lokal.",
                "fileState": {},
            }
            for store in ["ventura", "giftyours", "custombase"]
        }
        self._send(
            {
                "telegramBotToken": "",
                "telegramChatId": "",
                "morningTime": "07:30",
                "alertNegativeProfit": True,
                "alertMarginBelow": 12,
                "lastMorningSent": "",
                "ownerPinEnabled": False,
                "ownerPin": "",
                "stores": ["ventura", "giftyours", "custombase"],
                "defaultStore": "ventura",
                "folderMonitors": folder_monitors,
                "folderMonitor": folder_monitors["ventura"],
            }
        )

    def do_POST(self):
        self._send({"ok": False, "error": "Pengaturan cloud preview tidak disimpan. Gunakan versi lokal."}, 400)
