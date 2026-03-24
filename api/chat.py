import json
import os
import urllib.request
import urllib.error
import time
import hashlib
from datetime import datetime
from cache import CacheManager
from utils import (
    sanitize_input,
    categorize_error,
    format_error_message,
    rate_limit_check,
    get_client_ip
)

# Initialize cache
cache = CacheManager()

# Rate limiting storage
rate_limit_store = {}

def handler(request):
    """
    Vercel Serverless Function Handler
    - Handles POST requests for chat
    - No BaseHTTPRequestHandler (doesn't work on Vercel!)
    - Uses proper Vercel request/response pattern
    """
    
    try:
        # 1. Handle preflight (CORS OPTIONS)
        if request.method == "OPTIONS":
            return _cors_response(200, {})

        # 2. Only allow POST
        if request.method != "POST":
            return _cors_response(405, {"error": "Method not allowed"})

        # 3. Get client IP
        client_ip = get_client_ip(request.headers)

        # 4. Parse body
        try:
            body = json.loads(request.body.decode("utf-8") if isinstance(request.body, bytes) else request.body)
        except:
            return _cors_response(400, {"error": "❌ Invalid JSON"})

        # 5. Check API key
        api_key = os.environ.get("GROQ_API_KEY", "").strip()
        if not api_key:
            return _cors_response(500, {
                "error": "⚠️ Server Error: GROQ_API_KEY not configured",
                "hint": "Admin: Set GROQ_API_KEY in Vercel environment"
            })

        # 6. Rate limiting
        rate_limit_result = rate_limit_check(client_ip, rate_limit_store)
        if not rate_limit_result["allowed"]:
            return _cors_response(429, {
                "error": f"Rate limited. Reset in {rate_limit_result['reset_in']}s",
                "remaining": 0
            })

        # 7. Extract messages
        system_prompt = body.get("system", "")
        user_messages = body.get("messages", [])

        # 8. Check cache
        full_input = json.dumps({
            "system": system_prompt,
            "messages": user_messages
        })
        cache_key = hashlib.md5(full_input.encode()).hexdigest()
        cached_response = cache.get(cache_key)

        if cached_response:
            print(f"[CACHE HIT] {cache_key[:8]}...")
            return _cors_response(200, {
                "reply": cached_response,
                "source": "cache",
                "model": "mixtral-8x7b-32768 (cached)",
                "cached": True
            })

        # 9. Build Groq payload
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
            "model": "mixtral-8x7b-32768",
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 2048
        }

        # 10. Call Groq with retry logic
        response_text = None
        for attempt in range(3):
            try:
                response_text = _call_groq_api(api_key, payload)
                break
            except urllib.error.HTTPError as e:
                if attempt < 2:
                    time.sleep(2 ** attempt)  # Exponential backoff
                else:
                    return _cors_response(e.code, {
                        "error": f"❌ Groq API Error",
                        "details": str(e)[:100]
                    })
            except Exception as e:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                else:
                    return _cors_response(500, {
                        "error": f"❌ Server Error",
                        "details": str(e)[:100]
                    })

        if not response_text:
            return _cors_response(500, {"error": "❌ No response from API"})

        # 11. Cache and return
        cache.set(cache_key, response_text, ttl=3600)

        return _cors_response(200, {
            "reply": response_text,
            "source": "groq",
            "model": "mixtral-8x7b-32768",
            "cached": False,
            "timestamp": datetime.now().isoformat()
        })

    except Exception as e:
        return _cors_response(500, {
            "error": f"❌ Server Error: {type(e).__name__}",
            "details": str(e)[:100]
        })


def _call_groq_api(api_key, payload):
    """Call Groq API"""
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

    with urllib.request.urlopen(req, timeout=30) as response:
        res_data = json.loads(response.read().decode("utf-8"))
        
        if "choices" not in res_data or len(res_data["choices"]) == 0:
            raise ValueError("No choices in Groq response")
        
        return res_data["choices"][0]["message"]["content"]


def _cors_response(status_code, body):
    """Return response with CORS headers"""
    return {
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Content-Type": "application/json"
        },
        "body": json.dumps(body)
    }
