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
            
            api_key = os.environ.get("GROQ_API_KEY", "").strip()
            if not api_key:
                return self._json(500, {"error": "GROQ_API_KEY missing in Vercel!"})

            # Format the messages cleanly
            messages = []
            if body.get("system"):
                messages.append({"role": "system", "content": body.get("system")})
                
            for m in body.get("messages", []):
                messages.append({"role": m["role"], "content": m["content"]})

            # Standard, clean payload
            payload = {
                "model": "llama3-8b-8192", 
                "messages": messages
            }

            url = "https://api.groq.com/openai/v1/chat/completions"
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" # <-- This bypasses Cloudflare 1010 error!
                },
                method="POST"
            )

            with urllib.request.urlopen(req, timeout=30) as r:
                res_data = json.loads(r.read().decode("utf-8"))
            
            # Extract the response
            reply_text = res_data["choices"][0]["message"]["content"]
            return self._json(200, {"reply": reply_text})

        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8")
            return self._json(e.code, {"error": f"Groq API Error: {err}"})
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
