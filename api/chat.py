from http.server import BaseHTTPRequestHandler
import json, os, urllib.request, urllib.error

# Import DuckDuckGo for the actual web search
try:
    from duckduckgo_search import DDGS
except ImportError:
    DDGS = None

class handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self._cors(200)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length).decode("utf-8", "ignore")
            
            try:
                body = json.loads(raw or "{}")
            except Exception:
                return self._json(400, {"error": "Invalid JSON body"})

            api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
            if not api_key:
                return self._json(500, {"error": "ANTHROPIC_API_KEY not set in Vercel"})

            messages = body.get("messages", [])
            if not isinstance(messages, list):
                return self._json(400, {"error": "messages must be an array"})

            # Prepare the request for Claude (UPDATED MODEL NAME HERE)
            payload = {
                "model": "claude-3-5-sonnet-20240620", 
                "max_tokens": 4096 if body.get("code_mode") else 1024,
                "system": body.get("system", ""),
                "messages": messages
            }

            # If web search is ON, give Claude the search tool
            if body.get("web_search"):
                payload["tools"] = [{
                    "name": "search_web",
                    "description": "Search the web for current events, news, or specific real-time facts.",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "The search query to look up."}
                        },
                        "required": ["query"]
                    }
                }]

            # HELPER FUNCTION: Make the HTTP call to Anthropic
            def call_anthropic(current_payload):
                req = urllib.request.Request(
                    "https://api.anthropic.com/v1/messages",
                    data=json.dumps(current_payload).encode("utf-8"),
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json"
                    },
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=180) as r:
                    return json.loads(r.read().decode("utf-8", "ignore"))

            # --- 1ST API CALL ---
            data = call_anthropic(payload)
            search_used = False

            # Check if Claude wants to search the web
            tool_use_block = next((b for b in data.get("content", []) if b.get("type") == "tool_use"), None)
            
            if tool_use_block and tool_use_block.get("name") == "search_web":
                search_used = True
                query = tool_use_block["input"].get("query", "")
                
                # Perform the actual web search
                search_results = "No results."
                if DDGS:
                    try:
                        results = DDGS().text(query, max_results=3)
                        if results:
                            search_results = "\n\n".join([f"Title: {r['title']}\nInfo: {r['body']}" for r in results])
                    except Exception as e:
                        search_results = f"Search failed: {str(e)}"

                # Add Claude's tool request to history
                messages.append({"role": "assistant", "content": data["content"]})
                
                # Add the actual search results to history
                messages.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": tool_use_block["id"],
                        "content": search_results
                    }]
                })
                
                # --- 2ND API CALL --- (Claude reads results and generates final answer)
                payload["messages"] = messages
                data = call_anthropic(payload)

            # Extract final text
            reply = "".join(
                b.get("text", "")
                for b in data.get("content", [])
                if isinstance(b, dict) and b.get("type") == "text"
            ).strip()

            return self._json(200, {
                "reply": reply or "No response.",
                "search_used": search_used
            })

        except urllib.error.HTTPError as e:
            try:
                err = e.read().decode("utf-8", "ignore")
            except Exception:
                err = str(e)
            return self._json(getattr(e, "code", 500), {"error": err})

        except Exception as e:
            return self._json(500, {"error": str(e)})

    def do_GET(self):
        self._json(405, {"error": "Method GET not allowed. Use POST."})

    def _cors(self, code):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _json(self, code, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
