import json
import os
from utils import get_client_ip, rate_limit_check
from cache import CacheManager

cache = CacheManager()
rate_limit_store = {}

def handler(request):
    """Vercel Adapter -> Your existing logic"""
    try:
        # Convert Vercel request → AWS-style event
        event = {
            "httpMethod": request.method,
            "headers": dict(request.headers),
            "body": request.get_data(as_text=True)
        }

        # Call your original logic
        return main_handler(event)

    except Exception as e:
        print(f"Adapter Error: {e}")
        return _response(500, {"error": "Server Error"})


# ✅ YOUR ORIGINAL LOGIC (unchanged concept)
def main_handler(event):
    try:
        # 1. Only allow POST requests
        if event['httpMethod'] != "POST":
            return _response(405, {"error": "Method Not Allowed"})

        # 2. Parse the request body
        try:
            body = json.loads(event['body'])
        except json.JSONDecodeError:
            return _response(400, {"error": "Invalid JSON"})

        # 3. Rate-limit checks
        client_ip = get_client_ip(event['headers'])
        rate_limit = rate_limit_check(client_ip, rate_limit_store)
        if not rate_limit["allowed"]:
            return _response(429, {
                "error": "Rate limited",
                "retry_in": rate_limit["reset_in"]
            })

        # 4. Your logic
        return _response(200, {
            "reply": f"Hello, {body['messages'][0]['content']}" if body.get("messages") else "Hello, world!",
        })

    except Exception as e:
        print(f"Server Error: {e}")
        return _response(500, {"error": "Server Error"})


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
        },
        "body": json.dumps(body),
    }
