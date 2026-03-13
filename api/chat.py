import os, json
from http.server import BaseHTTPRequestHandler
import urllib.request, urllib.error

class handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length))

            api_key = os.environ.get("ANTHROPIC_API_KEY", "")
            if not api_key:
                self._json(500, {"error": "ANTHROPIC_API_KEY not set in Vercel environment variables"}); return

            payload = {
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 4096 if body.get("code_mode") else 1024,
                "system": body.get("system", ""),
                "messages": body.get("messages", []),
            }
            if body.get("web_search"):
                payload["tools"] = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}]

            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages",
                data=json.dumps(payload).encode(),
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req) as r:
                data = json.loads(r.read())

            reply = "".join(b["text"] for b in data.get("content", []) if b.get("type") == "text")
            search_used = any(b.get("type") == "tool_use" for b in data.get("content", []))
            self._json(200, {"reply": reply or "No response.", "search_used": search_used})

        except urllib.error.HTTPError as e:
            self._json(e.code, {"error": e.read().decode()})
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a): pass
