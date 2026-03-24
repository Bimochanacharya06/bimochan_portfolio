from http.server import BaseHTTPRequestHandler
import json, os, urllib.request, urllib.error

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._cors(200)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(length).decode("utf-8")
            body = json.loads(raw_body or "{}")
            
            api_key = os.environ.get("GEMINI_API_KEY", "").strip()
            if not api_key:
                return self._json(500, {"error": "GEMINI_API_KEY missing in Vercel!"})

            messages = body.get("messages", [])
            gemini_messages = []
            
            # Format history for Gemini
            for m in messages:
                role = "model" if m["role"] == "assistant" else "user"
                gemini_messages.append({
                    "role": role,
                    "parts": [{"text": m["content"]}]
                })

            payload = {"contents": gemini_messages}
            
            if body.get("system"):
                payload["system_instruction"] = {
                    "parts": [{"text": body.get("system")}]
                }

            # THE FIX: Using the official 'v1' stable endpoint and exact model name
            url = f"https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key={api_key}"
            
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )

            with urllib.request.urlopen(req, timeout=30) as r:
                res_data = json.loads(r.read().decode("utf-8"))
            
            # Safely extract the text response
            try:
                reply_text = res_data["candidates"][0]["content"]["parts"][0]["text"]
            except (KeyError, IndexError):
                reply_text = "No response from Gemini."
                
            return self._json(200, {"reply": reply_text})

        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8")
            return self._json(e.code, {"error": f"Google API Error: {err}"})
        except Exception as e:
            return self._json(500, {"error": f"Backend Error: {str(e)}"})

    def _cors(self, code):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _json(self, code, body):
        self._cors(code)
        data = json.dumps(body).encode("utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.wfile.write(data)
