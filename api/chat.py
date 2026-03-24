import json
import os
from utils import get_client_ip, rate_limit_check
from cache import CacheManager

cache = CacheManager()
rate_limit_store = {}

def handler(event, context):
    """Vercel Serverless Function Handler"""
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
            return _response(429, {"error": "Rate limited", "retry_in": rate_limit["reset_in"]})

        # 4. Do API-related work (fake for now)
        return _response(200, {
            "reply": f"Hello, {body['messages'][0]['content']}" if body.get("messages") else "Hello, world!",
        })
    except Exception as e:
        print(f"Server Error: {e}")
        return _response(500, {"error": "Server Error"})

def _response(status_code, body):
    """Format Vercel’s JSON response style"""
    return {
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
        },
        "body": json.dumps(body),
    }
