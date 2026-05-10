from http.server import BaseHTTPRequestHandler
import json


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.dumps(
            {"ok": False, "error": "Upload cloud belum diaktifkan. Versi ini menjaga data real tetap lokal."},
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(400)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

