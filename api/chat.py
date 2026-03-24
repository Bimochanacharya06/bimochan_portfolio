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
            for i, m in enumerate(messages):
                role = "model" if m["role"] == "assistant" else "user"
                content = m["content"]
                
                # INJECT THE SYSTEM PROMPT INTO THE FIRST MESSAGE
                # This perfectly bypasses Google's broken system instruction field!
                if i == 0 and body.get("system"):
                    content = f"System Instructions: {body.get('system')}\n\nUser Message: {content}"
                
                gemini_messages.append({
                    "role": role,
                    "parts": [{"text": content}]
                })

            payload = {"contents": gemini_messages}

            # 100% Stable v1 endpoint (No systemInstruction field in payload)
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
