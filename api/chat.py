import os
import json
import urllib.request
import urllib.error


def _response(status, data, headers=None):
    base_headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    }
    if headers:
        base_headers.update(headers)
    return {
        "statusCode": status,
        "headers": base_headers,
        "body": json.dumps(data, ensure_ascii=False)
    }


def handler(request):
    try:
        method = request.get("method", "GET").upper() if isinstance(request, dict) else "GET"

        if method == "OPTIONS":
            return _response(200, {"ok": True})

        if method != "POST":
            return _response(405, {"error": "Method Not Allowed. Use POST."})

        body_raw = request.get("body", "{}") if isinstance(request, dict) else "{}"
        if request.get("isBase64Encoded") if isinstance(request, dict) else False:
            import base64
            body_raw = base64.b64decode(body_raw).decode("utf-8", errors="ignore")

        body = json.loads(body_raw or "{}")

        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            return _response(500, {"error": "ANTHROPIC_API_KEY not set in Vercel environment variables"})

        payload = {
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 4096 if body.get("code_mode") else 1024,
            "system": body.get("system", ""),
            "messages": body.get("messages", [])
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
            data = json.loads(r.read().decode("utf-8"))

        reply = "".join(
            block.get("text", "")
            for block in data.get("content", [])
            if block.get("type") == "text"
        )
        search_used = any(block.get("type") == "tool_use" for block in data.get("content", []))

        return _response(200, {"reply": reply or "No response.", "search_used": search_used})

    except urllib.error.HTTPError as e:
        try:
            err = e.read().decode("utf-8", errors="ignore")
        except Exception:
            err = str(e)
        return _response(getattr(e, "code", 500), {"error": err})
    except Exception as e:
        return _response(500, {"error": str(e)})
