import time
from typing import Dict, Tuple

def get_client_ip(headers):
    """Extract client IP from headers (handles proxies)"""
    # Check for forwarded IP (from proxies/Vercel)
    if "X-Forwarded-For" in headers:
        return headers["X-Forwarded-For"].split(",")[0].strip()
    
    if "CF-Connecting-IP" in headers:  # Cloudflare
        return headers["CF-Connecting-IP"]
    
    # Fallback (shouldn't happen in BaseHTTPRequestHandler)
    return "0.0.0.0"


def rate_limit_check(client_ip: str, rate_limit_store: Dict, 
                     max_requests: int = 5, window_seconds: int = 60) -> Dict:
    """
    Check if client exceeded rate limit
    Returns: {"allowed": bool, "remaining": int, "reset_in": int}
    """
    now = time.time()
    
    if client_ip not in rate_limit_store:
        rate_limit_store[client_ip] = {
            "count": 1,
            "window_start": now,
            "reset_time": now + window_seconds
        }
        return {
            "allowed": True,
            "remaining": max_requests - 1,
            "reset_in": window_seconds
        }
    
    entry = rate_limit_store[client_ip]
    
    # Check if window expired
    if now > entry["reset_time"]:
        # Reset window
        entry["count"] = 1
        entry["window_start"] = now
        entry["reset_time"] = now + window_seconds
        return {
            "allowed": True,
            "remaining": max_requests - 1,
            "reset_in": window_seconds
        }
    
    # Still in window
    if entry["count"] >= max_requests:
        reset_in = int(entry["reset_time"] - now)
        return {
            "allowed": False,
            "remaining": 0,
            "reset_in": reset_in
        }
    
    # Increment counter
    entry["count"] += 1
    remaining = max_requests - entry["count"]
    reset_in = int(entry["reset_time"] - now)
    
    return {
        "allowed": True,
        "remaining": remaining,
        "reset_in": reset_in
    }


def sanitize_input(text: str, max_length: int = 2000) -> Tuple[str, bool]:
    """
    Sanitize user input
    Returns: (sanitized_text, is_valid)
    """
    if not text:
        return "", False
    
    # Truncate if too long
    if len(text) > max_length:
        text = text[:max_length]
    
    # Basic validation
    if len(text.strip()) == 0:
        return "", False
    
    return text.strip(), True


def categorize_error(error_code: int, error_message: str) -> Dict:
    """
    Categorize API errors for better user messages
    """
    categories = {
        400: {
            "type": "bad_request",
            "user_msg": "❌ Invalid request format",
            "recoverable": False
        },
        401: {
            "type": "auth_error",
            "user_msg": "❌ Authentication failed",
            "recoverable": False
        },
        403: {
            "type": "forbidden",
            "user_msg": "❌ Access denied",
            "recoverable": False
        },
        429: {
            "type": "rate_limit",
            "user_msg": "⏱️ Rate limited - please try again soon",
            "recoverable": True
        },
        500: {
            "type": "server_error",
            "user_msg": "🔄 Server error - retrying...",
            "recoverable": True
        },
        503: {
            "type": "service_unavailable",
            "user_msg": "🌐 Service temporarily unavailable",
            "recoverable": True
        },
    }
    
    return categories.get(error_code, {
        "type": "unknown",
        "user_msg": "❌ An error occurred",
        "recoverable": True
    })


def format_error_message(error_type: str, details: str = "") -> str:
    """Format error message for frontend display"""
    messages = {
        "timeout": "⏱️ Request timed out. Please try again.",
        "network": "🌐 Network error. Check your connection.",
        "api_key": "🔑 API key error. Admin: check GROQ_API_KEY.",
        "invalid_json": "📝 Invalid request format.",
        "rate_limit": "⏱️ Too many requests. Please wait a moment.",
        "server": "❌ Server error. Please try again."
    }
    
    message = messages.get(error_type, "❌ An error occurred")
    
    if details:
        message += f"\n\nDetails: {details[:100]}"
    
    return message


def estimate_tokens(text: str) -> int:
    """Rough estimate of tokens (1 token ≈ 4 chars)"""
    return len(text) // 4
