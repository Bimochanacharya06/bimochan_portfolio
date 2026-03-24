from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.request
import urllib.error
import time
import hashlib
from datetime import datetime, timedelta
from cache import CacheManager
from utils import (
    sanitize_input,
    categorize_error,
    format_error_message,
    rate_limit_check,
    get_client_ip
)

# Initialize cache (uses JSON file in /tmp or local)
cache = CacheManager()

# Rate limiting storage (IP -> {count, reset_time})
rate_limit_store = {}

class handler(BaseHTTPRequestHandler):
    """
    Upgraded Groq Chat Handler for Vercel
    - Smart caching for common queries
    - Retry logic with exponential backoff
    - Rate limiting per IP
    - Enhanced error handling
    - Model: Mixtral-8x7b (upgraded)
    """

    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self._cors(200)

    def do_POST(self):
        """Main chat endpoint"""
        try:
            # 1. Parse request
            client_ip = get_client_ip(self.headers)
            length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(length).decode("utf-8")
            body = json.loads(raw_body or "{}")

            # 2. Rate limiting check
            rate_limit_result = rate_limit_check(client_ip, rate_limit_store)
            if not rate_limit_result["allowed"]:
                return self._json(429, {
                    "error": f"Rate limited. Reset in {rate_limit_result['reset_in']}s",
                    "remaining": 0
                })

            # 3. Validate API key
            api_key = os.environ.get("GROQ_API_KEY", "").strip()
            if not api_key:
                return self._json(500, {
                    "error": "⚠️ Server Error: GROQ_API_KEY not configured",
                    "hint": "Admin: Set GROQ_API_KEY in Vercel environment"
                })

            # 4. Extract and sanitize messages
            system_prompt = body.get("system", "")
            user_messages = body.get("messages", [])
            
            # Build full prompt for caching key
            full_input = json.dumps({
                "system": system_prompt,
                "messages": user_messages
            })

            # 5. CHECK CACHE FIRST
            cache_key = hashlib.md5(full_input.encode()).hexdigest()
            cached_response = cache.get(cache_key)
            
            if cached_response:
                print(f"[CACHE HIT] {cache_key[:8]}... (saved API call)")
                return self._json(200, {
                    "reply": cached_response,
                    "source": "cache",
                    "model": "mixtral-8x7b-32768 (cached)",
                    "cached": True
                })

            # 6. Build Groq API request
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            
            for msg in user_messages:
                if msg.get("role") and msg.get("content"):
                    messages.append({
                        "role": msg["role"],
                        "content": msg["content"]
                    })

            payload = {
                "model": "mixtral-8x7b-32768",  # ✅ UPGRADED MODEL
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 2048
            }

            # 7. RETRY LOGIC with exponential backoff
            max_retries = 3
            retry_delays = [1, 2, 4]  # exponential backoff
            
            response_text = None
            last_error = None

            for attempt in range(max_retries):
                try:
                    response_text = self._call_groq_api(api_key, payload)
                    break  # Success! Exit retry loop
                    
                except urllib.error.HTTPError as e:
                    error_code = e.code
                    last_error = e
                    
                    # Don't retry certain errors
                    if error_code == 401:  # Invalid API key
                        return self._json(401, {
                            "error": "❌ Groq API Key Invalid",
                            "hint": "Check GROQ_API_KEY environment variable"
                        })
                    
                    if error_code == 429:  # Rate limited by Groq
                        if attempt < max_retries - 1:
                            wait = retry_delays[attempt]
                            print(f"[RETRY {attempt + 1}] Groq rate limited, waiting {wait}s...")
                            time.sleep(wait)
                        else:
                            return self._json(429, {
                                "error": "🚫 Groq API Rate Limited",
                                "hint": "Please try again in a moment"
                            })
                    
                    elif error_code == 500:  # Groq server error
                        if attempt < max_retries - 1:
                            wait = retry_delays[attempt]
                            print(f"[RETRY {attempt + 1}] Groq server error, retrying in {wait}s...")
                            time.sleep(wait)
                        else:
                            return self._json(502, {
                                "error": "🔄 Groq service temporarily unavailable",
                                "hint": "Please try again in a moment"
                            })
                    
                    else:  # Other errors
                        if attempt < max_retries - 1:
                            wait = retry_delays[attempt]
                            print(f"[RETRY {attempt + 1}] Error {error_code}, retrying...")
                            time.sleep(wait)
                        else:
                            err_text = e.read().decode("utf-8")
                            return self._json(e.code, {
                                "error": f"❌ Groq API Error",
                                "details": err_text[:200]
                            })
                
                except urllib.error.URLError as e:
                    last_error = e
                    if attempt < max_retries - 1:
                        wait = retry_delays[attempt]
                        print(f"[RETRY {attempt + 1}] Network error, retrying in {wait}s...")
                        time.sleep(wait)
                    else:
                        return self._json(503, {
                            "error": "🌐 Network/Timeout Error",
                            "hint": f"No response after {max_retries} attempts",
                            "details": str(e)[:150]
                        })

            if response_text is None:
                return self._json(500, {
                    "error": "❌ Failed to get response after retries",
                    "details": str(last_error)[:200]
                })

            # 8. CACHE the successful response
            cache.set(cache_key, response_text, ttl=3600)  # Cache for 1 hour

            # 9. Return success
            return self._json(200, {
                "reply": response_text,
                "source": "groq",
                "model": "mixtral-8x7b-32768",
                "cached": False,
                "timestamp": datetime.now().isoformat()
            })

        except json.JSONDecodeError:
            return self._json(400, {
                "error": "❌ Invalid JSON in request",
                "hint": "Check your request format"
            })
        except Exception as e:
            return self._json(500, {
                "error": f"❌ Server Error: {type(e).__name__}",
                "details": str(e)[:200]
            })

    def _call_groq_api(self, api_key, payload):
        """Call Groq API and return text response"""
        url = "https://api.groq.com/openai/v1/chat/completions"
        
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "Bimo-AI/4.0"
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                
                if "choices" not in res_data or len(res_data["choices"]) == 0:
                    raise ValueError("No choices in Groq response")
                
                reply = res_data["choices"][0]["message"]["content"]
                return reply
                
        except urllib.error.HTTPError as e:
            raise e
        except urllib.error.URLError as e:
            raise e

    def _cors(self, code):
        """Set CORS headers"""
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _json(self, code, body):
        """Send JSON response with CORS headers"""
        self._cors(code)
        data = json.dumps(body).encode("utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.wfile.write(data)
