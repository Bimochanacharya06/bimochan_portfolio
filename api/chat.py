import os
import json
from http.server import BaseHTTPRequestHandler
import urllib.request
import urllib.error


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
            raw = self.rfile.read(length) if length > 0 else b"{}"
            body = json.loads(raw)

            api_key = os.environ.get("ANTHROPIC_API_KEY", "")
            if not api_key:
                self._json(500, {"error": "ANTHROPIC_API_KEY not set in Vercel environment variables"})
                return

            wants_stream = bool(body.get("stream"))

            payload = {
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 4096 if body.get("code_mode") else 1024,
                "system": body.get("system", ""),
                "messages": body.get("messages", []),
            }

            if body.get("web_search"):
                payload["tools"] = [{
                    "type": "web_search_20250305",
                    "name": "web_search",
                    "max_uses": 3
                }]

            if wants_stream:
                self._stream_anthropic(api_key, payload)
            else:
                self._json_anthropic(api_key, payload)

        except urllib.error.HTTPError as e:
            try:
                err = e.read().decode("utf-8", errors="ignore")
            except Exception:
                err = str(e)
            self._json(getattr(e, "code", 500), {"error": err})
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _json_anthropic(self, api_key, payload):
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            },
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read().decode("utf-8"))

        reply = "".join(
            block.get("text", "")
            for block in data.get("content", [])
            if block.get("type") == "text"
        )
        search_used = any(block.get("type") == "tool_use" for block in data.get("content", []))
        self._json(200, {"reply": reply or "No response.", "search_used": search_used})

    def _stream_anthropic(self, api_key, payload):
        # Enable Anthropic streaming
        stream_payload = dict(payload)
        stream_payload["stream"] = True

        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(stream_payload).encode("utf-8"),
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
                "accept": "text/event-stream"
            },
            method="POST"
        )

        # Return NDJSON stream to browser
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "keep-alive")
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.end_headers()

        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                for raw_line in r:
                    line = raw_line.decode("utf-8", errors="ignore").strip()
                    if not line:
                        continue

                    # Anthropic SSE lines are like: "data: {...}"
                    if not line.startswith("data: "):
                        continue

                    data_str = line[6:].strip()
                    if data_str == "[DONE]":
                        self._write_ndjson({"type": "done"})
                        break

                    try:
                        evt = json.loads(data_str)
                    except Exception:
                        continue

                    evt_type = evt.get("type")

                    # token/text delta
                    if evt_type == "content_block_delta":
                        delta = evt.get("delta", {})
                        text = delta.get("text", "")
                        if text:
                            self._write_ndjson({"type": "delta", "text": text})

                    # end event
                    elif evt_type == "message_stop":
                        self._write_ndjson({"type": "done"})

        except BrokenPipeError:
            # client aborted (Stop button)
            return
        except Exception as e:
            try:
                self._write_ndjson({"type": "error", "error": str(e)})
            except Exception:
                pass

    def _write_ndjson(self, obj):
        chunk = (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
        self.wfile.write(chunk)
        self.wfile.flush()

    def _json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
