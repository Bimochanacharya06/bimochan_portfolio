import json
import os
import urllib.request
import urllib.error

def handler(request):
    try:
        # ✅ Handle CORS
        if request.method == "OPTIONS":
            return _response(200, {"ok": True})

        # ✅ Only POST
        if request.method != "POST":
            return _response(405, {"error": "Method Not Allowed"})

        # ✅ Parse JSON body
        try:
            body = request.get_json()
        except Exception:
            return _response(400, {"error": "Invalid JSON"})

        messages = body.get("messages", [])

        if not isinstance(messages, list):
            return _response(400, {"error": "messages must be an array"})

        # ✅ API key
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return _response(500, {"error": "Missing ANTHROPIC_API_KEY"})

        # ✅ Build request payload
        payload = {
            "model": "claude-3-5-sonnet-latest",
            "max_tokens": 1024,
            "messages": messages
        }

        # ✅ Call Anthropic API
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

        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode("utf-8")

        data = json.loads(raw)

        # ✅ Extract reply
        reply = ""
        for block in data.get("content", []):
            if block.get("type") == "text":
                reply += block.get("text", "")

        return _response(200, {
            "reply": reply.strip() or "No response"
        })

    except urllib.error.HTTPError as e:
        try:
            err = e.read().decode("utf-8")
        except:
            err = str(e)
        return _response(e.code, {"error": err})

    except Exception as e:
        return _response(500, {"error": str(e)})


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Content-Type": "application/json"
        },
        "body": json.dumps(body)
    }
