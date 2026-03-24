from http.server import BaseHTTPRequestHandler
import json, os, urllib.request, urllib.error

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
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            
            # 1. Check for Gemini API Key
            api_key = os.environ.get("GEMINI_API_KEY", "").strip()
            if not api_key:
                self._reply(500, {"error": "GEMINI_API_KEY missing in Vercel Environment Variables!"})
                return

            # 2. Convert standard messages to Gemini format
            messages = body.get("messages", [])
            gemini_messages = []
            for m in messages:
                # Gemini uses 'model' instead of 'assistant'
                role = "model" if m["role"] == "assistant" else "user"
                gemini_messages.append({
                    "role": role,
                    "parts": [{"text": m["content"]}]
                })

            # 3. Prepare the Payload
            payload = {"contents": gemini_messages}
            
            # Add System Prompt (Personality)
            if body.get("system"):
                payload["systemInstruction"] = {
                    "parts": [{"text": body.get("system")}]
                }

            # 4. Activate NATIVE Google Search if toggle is ON!
            if body.get("web_search"):
                payload["tools"] = [{"googleSearch": {}}]

            # 5. Make the call to Google's servers
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )

            with urllib.request.urlopen(req, timeout=30) as r:
                res_data = json.loads(r.read().decode("utf-8"))
            
            # 6. Extract the reply text and send it back to your UI
            reply_text = res_data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "No response from Gemini.")
            
            self._reply(200, {"reply": reply_text})

        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8")
            self._reply(e.code, {"error": f"API Error: {err}"})
        except Exception as e:
            self._reply(500, {"error": str(e)})

    def _reply(self, code, data):
        res = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(res)
