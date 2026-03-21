import os
import json
import base64
import urllib.request
import urllib.error


def _response(status_code, payload):
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


def _get_method(req):
    if not isinstance(req, dict):
        return "GET"
    return (req.get("method") or req.get("httpMethod") or "GET").upper()


def _get_json_body(req):
    if not isinstance(req, dict):
        return {}
    raw = req.get("body") or "{}"
    if req.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8", errors="ignore")
    try:
        return json.loads(raw or "{}")
    except Exception:
        return None


def handler(request):
    try:
        method = _get_method(request)

        if method == "OPTIONS":
            return _response(200, {"ok": True})

        if method != "POST":
            return _response(405, {"error": f"Method {method} not allowed. Use POST."})

        body = _get_json_body(request)
        if body is None:
            return _response(400, {"error": "Invalid JSON body"})

        api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not api_key:
            return _response(500, {"error": "ANTHROPIC_API_KEY not set in Vercel environment variables"})

        messages = body.get("messages", [])
        if not isinstance(messages, list):
            return _response(400, {"error": "messages must be an array"})

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

        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read().decode("utf-8", errors="ignore")

        try:
            data = json.loads(raw)
        except Exception:
            return _response(502, {"error": "Invalid JSON from Anthropic", "raw": raw[:500]})

        content = data.get("content", [])
        reply = "".join(
            b.get("text", "")
            for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        ).strip()

        search_used = any(
            isinstance(b, dict) and b.get("type") == "tool_use"
            for b in content
        )

        return _response(200, {
            "reply": reply or "No response.",
            "search_used": search_used
        })

    except urllib.error.HTTPError as e:
        try:
            err = e.read().decode("utf-8", errors="ignore")
        except Exception:
            err = str(e)
        return _response(getattr(e, "code", 500), {"error": err})
    except Exception as e:
        return _response(500, {"error": str(e)})
