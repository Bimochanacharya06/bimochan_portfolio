from http.server import BaseHTTPRequestHandler
import json, os
import google.generativeai as genai

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        try:
            # 1. Read the frontend request
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            
            # 2. Authenticate securely
            api_key = os.environ.get("GEMINI_API_KEY", "").strip()
            if not api_key:
                self._reply(500, {"error": "GEMINI_API_KEY is missing in Vercel settings."})
                return

            genai.configure(api_key=api_key)
            
            # 3. Format the chat history for Gemini
            messages = body.get("messages", [])
            if not messages:
                self._reply(400, {"error": "No messages provided."})
                return

            history = []
            for m in messages[:-1]: # Take all messages except the last one
                role = "model" if m.get("role") == "assistant" else "user"
                history.append({"role": role, "parts": [m.get("content", "")]})
            
            last_msg = messages[-1].get("content", "")
            sys_inst = body.get("system", "")

            # 4. Initialize the official Model
            model = genai.GenerativeModel(
                model_name="gemini-1.5-flash",
                system_instruction=sys_inst if sys_inst else None
            )

            # 5. Send message and get reply
            chat = model.start_chat(history=history)
            response = chat.send_message(last_msg)

            # 6. Send the reply back to your HTML frontend
            self._reply(200, {"reply": response.text})

        except Exception as e:
            # Catch any actual errors cleanly
            self._reply(500, {"error": f"Backend Error: {str(e)}"})

    def _reply(self, code, data):
        res = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(res)
