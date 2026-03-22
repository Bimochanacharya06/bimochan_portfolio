import os, json, base64, urllib.request, urllib.error

def _resp(code, body):
    return {
        "statusCode": code,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        "body": json.dumps(body, ensure_ascii=False)
    }

def _method(req):
    if isinstance(req, dict):
        return (req.get("method") or req.get("httpMethod") or "GET").upper()
    return "GET"

def _body(req):
    if not isinstance(req, dict):
        return {}
    raw = req.get("body") or "{}"
    if req.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8", "ignore")
    try:
        return json.loads(raw or "{}")
    except Exception:
        return None

def handler(request):
    try:
        m = _method(request)
        if m == "OPTIONS":
            return _resp(200, {"ok": True})
        if m != "POST":
            return _resp(405, {"error": f"Method {m} not allowed. Use POST."})

        body = _body(request)
        if body is None:
            return _resp(400, {"error": "Invalid JSON body"})

        api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not api_key:
            return _resp(500, {"error": "ANTHROPIC_API_KEY not set"})

        messages = body.get("messages", [])
        if not isinstance(messages, list):
            return _resp(400, {"error": "messages must be an array"})

        payload = {
            "model": "claude-3-5-sonnet-latest",
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
            data = json.loads(r.read().decode("utf-8", "ignore"))

        reply = "".join(
            b.get("text", "")
            for b in data.get("content", [])
            if isinstance(b, dict) and b.get("type") == "text"
        ).strip()

        search_used = any(
            isinstance(b, dict) and b.get("type") == "tool_use"
            for b in data.get("content", [])
        )

        return _resp(200, {"reply": reply or "No response.", "search_used": search_used})

    except urllib.error.HTTPError as e:
        try: err = e.read().decode("utf-8", "ignore")
        except Exception: err = str(e)
        return _resp(getattr(e, "code", 500), {"error": err})
    except Exception as e:
        return _resp(500, {"error": str(e)})
