import os
import json
import base64
import urllib.request
import urllib.error


def _response(status_code, payload):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        "body": json.dumps(payload)
    }


def handler(request):
    try:
        # ✅ safer method detection
        method = getattr(request, "method", None)
        if not method and isinstance(request, dict):
            method = request.get("method") or request.get("httpMethod")
        method = (method or "GET").upper()

        if method == "OPTIONS":
            return _response(200, {"ok": True})

        if method != "POST":
            return _response(405, {"error": f"Method {method} not allowed"})

        # ✅ safer body parsing
        raw_body = None
        if hasattr(request, "body"):
            raw_body = request.body
        elif isinstance(request, dict):
            raw_body = request.get("body")

        if isinstance(raw_body, bytes):
            raw_body = raw_body.decode("utf-8")

        if isinstance(request, dict) and request.get("isBase64Encoded"):
            raw_body = base64.b64decode(raw_body).decode("utf-8")

        try:
            body = json.loads(raw_body or "{}")
        except Exception:
            return _response(400, {"error": "Invalid JSON body"})

        # ✅ API key check
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return _response(500, {"error": "Missing ANTHROPIC_API_KEY"})

        messages = body.get("messages", [])
        if not isinstance(messages, list):
            return _response(400, {"error": "messages must be array"})

        # ✅ safer model
        payload = {
            "model": "claude-3-5-sonnet-latest",
            "max_tokens": 1024,
            "messages": messages
        }

        # optional system prompt
        if body.get("system"):
            payload["system"] = body["system"]

        # API request
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            },
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode("utf-8")

        data = json.loads(raw)

        reply = ""
        for block in data.get("content", []):
            if block.get("type") == "text":
                reply += block.get("text", "")

        return _response(200, {"reply": reply.strip(), "search_used": False})

    except urllib.error.HTTPError as e:
        return _response(e.code, {"error": e.read().decode("utf-8")})
    except Exception as e:
        return _response(500, {"error": str(e)})
