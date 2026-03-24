import time

def get_client_ip(headers):
    """Extract client IP from headers"""
    if "X-Forwarded-For" in headers:
        return headers["X-Forwarded-For"].split(",")[0].strip()
    if "CF-Connecting-IP" in headers:
        return headers["CF-Connecting-IP"]
    return "0.0.0.0"


def rate_limit_check(client_ip, rate_limit_store, max_requests=5, window_seconds=60):
    """Check rate limit"""
    now = time.time()
    
    if client_ip not in rate_limit_store:
        rate_limit_store[client_ip] = {
            "count": 1,
            "window_start": now,
            "reset_time": now + window_seconds
        }
        return {"allowed": True, "remaining": max_requests - 1, "reset_in": window_seconds}
    
    entry = rate_limit_store[client_ip]
    
    if now > entry["reset_time"]:
        entry["count"] = 1
        entry["window_start"] = now
        entry["reset_time"] = now + window_seconds
        return {"allowed": True, "remaining": max_requests - 1, "reset_in": window_seconds}
    
    if entry["count"] >= max_requests:
        reset_in = int(entry["reset_time"] - now)
        return {"allowed": False, "remaining": 0, "reset_in": reset_in}
    
    entry["count"] += 1
    remaining = max_requests - entry["count"]
    reset_in = int(entry["reset_time"] - now)
    
    return {"allowed": True, "remaining": remaining, "reset_in": reset_in}
