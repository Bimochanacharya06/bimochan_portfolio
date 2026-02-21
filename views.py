import json
import time
import hashlib
from collections import defaultdict

import anthropic
from django.conf import settings
from django.http import JsonResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator

# ── PORTFOLIO CONTEXT ─────────────────────────────────────────────────────────
# Update this with Bimochan's real info. The agent uses this as its knowledge base.

SYSTEM_PROMPT = """You are Bimo — a friendly, knowledgeable AI assistant embedded in Bimochan Acharya's personal portfolio website. Your job is to help visitors learn about Bimochan, his skills, projects, and how to get in touch.

ABOUT BIMOCHAN:
- Full name: Bimochan Acharya
- Location: Sindupalchok / Kathmandu, Nepal 🇳🇵
- Role: Full Stack Developer
- Email: bimochan081b@asm.edu.np
- Phone: +977 9869667953
- Website: bimochanacharya.com.np
- GitHub: github.com/Bimochanacharya06
- LinkedIn: linkedin.com/in/bimochan-acharya-75a085370/

EDUCATION:
- Currently pursuing BIM (Bachelor in Information Management) at Asian School of Management & Technology, Kathmandu (2024–Present)
- Completed +2 (Higher Secondary) at Orient College (2022–2024)
- Secondary schooling (SEE) at Bansbari Secondary School (2009–2019)
- Self-taught developer since 2020 via YouTube, FreeCodeCamp, and official docs

SKILLS:
- Frontend: HTML5, CSS3, JavaScript, Bootstrap
- Backend: Python, Django, Flask, Django REST Framework
- Databases: MySQL, MongoDB, SQLite
- Tools: Git, GitHub, Linux

PROJECTS:
1. TaskFlow — Full-stack project management app (Django, REST API, SQLite, JS) — Featured
2. WeatherNow — Live weather dashboard (Flask, OpenWeather API, CSS3) — Live
3. Rock Paper Scissors — Browser game (HTML5, CSS3, JS) — Live at /game.html
4. BlogPy — Django blog CMS (Django, Bootstrap, SQLite) — New
5. SnapLink — URL shortener with analytics (Flask, SQLite, REST API) — New, deployed on PythonAnywhere

AVAILABILITY:
- Open to freelance work, collaborations, and full-time opportunities
- Responds to messages within 24 hours

PERSONALITY GUIDELINES:
- Be warm, concise, and enthusiastic — reflect Bimochan's passion for building
- Keep answers short (2–4 sentences max) unless asked for detail
- If asked about pricing/rates, say: "Bimochan prefers to discuss rates after understanding the project scope. Use the contact form to start that conversation!"
- If asked something you don't know: "I don't have that detail — reach out directly at bimochan081b@asm.edu.np and he'll answer personally."
- Never make up projects or skills not listed above
- Occasionally end with a helpful nudge: "Want to see his projects?" or "Feel free to reach out!"
- You are NOT a general-purpose AI — stay focused on portfolio topics only

SCOPE:
Only answer questions related to Bimochan, his work, skills, projects, education, or how to contact/hire him. For anything off-topic, politely redirect: "I'm here to help with questions about Bimochan's portfolio! Is there something about his work or background I can help with?"
"""

# ── SIMPLE IN-MEMORY RATE LIMITER ────────────────────────────────────────────
_rate_store = defaultdict(list)  # ip -> [timestamp, ...]

def _get_client_ip(request):
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if xff:
        return xff.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '0.0.0.0')

def _is_rate_limited(ip):
    now = time.time()
    window = settings.CHAT_RATE_LIMIT_WINDOW
    limit = settings.CHAT_RATE_LIMIT_PER_IP
    # Remove old entries
    _rate_store[ip] = [t for t in _rate_store[ip] if now - t < window]
    if len(_rate_store[ip]) >= limit:
        return True
    _rate_store[ip].append(now)
    return False


# ── VIEWS ─────────────────────────────────────────────────────────────────────

@method_decorator(csrf_exempt, name='dispatch')
class ChatView(View):
    """
    POST /api/chat/
    Body: { "message": "...", "history": [{"role":"user","content":"..."},  ...] }
    Response: { "reply": "...", "ok": true }
    """

    def post(self, request):
        ip = _get_client_ip(request)

        # Rate limit
        if _is_rate_limited(ip):
            return JsonResponse({
                'ok': False,
                'error': 'Too many messages. Please wait a moment before trying again.'
            }, status=429)

        # Parse body
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({'ok': False, 'error': 'Invalid JSON.'}, status=400)

        user_message = str(data.get('message', '')).strip()
        history = data.get('history', [])

        if not user_message:
            return JsonResponse({'ok': False, 'error': 'Message cannot be empty.'}, status=400)

        # Clamp message length
        max_len = settings.CHAT_MAX_MESSAGE_LENGTH
        if len(user_message) > max_len:
            user_message = user_message[:max_len]

        # Sanitize & truncate history
        clean_history = []
        for msg in history[-settings.CHAT_MAX_HISTORY:]:
            if isinstance(msg, dict) and msg.get('role') in ('user', 'assistant') and msg.get('content'):
                clean_history.append({
                    'role': msg['role'],
                    'content': str(msg['content'])[:1000]  # cap each history msg
                })

        # Build messages for Claude
        messages = clean_history + [{'role': 'user', 'content': user_message}]

        # Call Claude
        try:
            client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
            response = client.messages.create(
                model=settings.ANTHROPIC_MODEL,
                max_tokens=settings.ANTHROPIC_MAX_TOKENS,
                system=SYSTEM_PROMPT,
                messages=messages,
            )
            reply = response.content[0].text
        except anthropic.AuthenticationError:
            return JsonResponse({'ok': False, 'error': 'API configuration error.'}, status=500)
        except anthropic.RateLimitError:
            return JsonResponse({'ok': False, 'error': 'AI is busy right now, try again shortly.'}, status=503)
        except Exception as e:
            return JsonResponse({'ok': False, 'error': 'Something went wrong. Please try again.'}, status=500)

        return JsonResponse({'ok': True, 'reply': reply})


class HealthView(View):
    """GET /api/chat/health/ — simple uptime check"""
    def get(self, request):
        has_key = bool(settings.ANTHROPIC_API_KEY)
        return JsonResponse({
            'status': 'ok',
            'api_key_configured': has_key,
            'model': settings.ANTHROPIC_MODEL,
        })
