import os
import json
import base64
import urllib.request
import urllib.error


def _resp(status_code, payload):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        "body": json.dumps(payload, ensure_ascii=False)
    }


def _extract_request(request):
    """
    Supports Vercel Python request shapes (dict-like),
    and gracefully handles missing fields.
    """
    if isinstance(request, dict):
        method = (request.get("method") or request.get("httpMethod") or "GET").upper()
        body_raw = request.get("body") or "{}"
        is_b64 = bool(request.get("isBase64Encoded"))
        return method, body_raw, is_b64
    # Fallback
    return "GET", "{}", False


def handler(request):
    try:
        method, body_raw, is_b64 = _extract_request(request)

        # CORS preflight
        if method == "OPTIONS":
            return _resp(200, {"ok": True})

        # Only POST supported
        if method != "POST":
            return _resp(405, {"error": "Method Not Allowed. Use POST."})

        if is_b64:
            body_raw = base64.b64decode(body_raw).decode("utf-8", errors="ignore")

        try:
            body = json.loads(body_raw or "{}")
        except Exception:
            return _resp(400, {"error": "Invalid JSON body"})

        api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not api_key:
            return _resp(500, {"error": "ANTHROPIC_API_KEY not set in Vercel environment variables"})

        messages = body.get("messages", [])
        if not isinstance(messages, list):
            return _resp(400, {"error": "messages must be an array"})

        payload = {
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 4096 if body.get("code_mode") else 1024,
            "system": body.get("system", ""),
            "messages": messages
        }

        if body.get("web_search"):
            payload["tools"] = [{
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": 3
            }]

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

        with urllib.request.urlopen(req, timeout=180) as response:
            raw = response.read().decode("utf-8", errors="ignore")

        try:
            data = json.loads(raw)
        except Exception:
            return _resp(502, {"error": "Invalid JSON from Anthropic", "raw": raw[:500]})

        content = data.get("content", [])
        reply = "".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        ).strip()

        search_used = any(
            isinstance(block, dict) and block.get("type") == "tool_use"
            for block in content
        )

        return _resp(200, {
            "reply": reply or "No response.",
            "search_used": search_used
        })

    except urllib.error.HTTPError as e:
        try:
            err = e.read().decode("utf-8", errors="ignore")
        except Exception:
            err = str(e)
        return _resp(getattr(e, "code", 500), {"error": err})

    except Exception as e:
        return _resp(500, {"error": str(e)})
