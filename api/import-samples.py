from http.server import BaseHTTPRequestHandler
import json


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.dumps(
            {"ok": False, "error": "Data contoh lokal tidak disertakan di Vercel preview demi keamanan."},
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(400)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

