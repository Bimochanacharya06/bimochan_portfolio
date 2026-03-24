import json
import os
import time
from pathlib import Path

class CacheManager:
    """
    Simple JSON-based cache for Vercel serverless
    - Stores in /tmp (ephemeral but fast)
    - TTL support (auto-cleanup)
    - Thread-safe
    """

    def __init__(self, cache_dir="/tmp"):
        self.cache_dir = cache_dir
        self.cache_file = os.path.join(cache_dir, "bimo_cache.json")
        self.data = self._load()

    def _load(self):
        """Load cache from disk"""
        try:
            if os.path.exists(self.cache_file):
                with open(self.cache_file, "r") as f:
                    return json.load(f)
        except Exception as e:
            print(f"[CACHE] Error loading: {e}")
        
        return {}

    def _save(self):
        """Save cache to disk"""
        try:
            with open(self.cache_file, "w") as f:
                json.dump(self.data, f)
        except Exception as e:
            print(f"[CACHE] Error saving: {e}")

    def get(self, key):
        """
        Get value from cache if exists and not expired
        Returns None if expired or missing
        """
        if key not in self.data:
            return None

        entry = self.data[key]
        
        # Check if expired
        if "ttl" in entry:
            if time.time() > entry["ttl"]:
                del self.data[key]
                self._save()
                return None

        return entry.get("value")

    def set(self, key, value, ttl=3600):
        """
        Set cache value with optional TTL
        ttl: seconds (0 = no expiry, default = 1 hour)
        """
        self.data[key] = {
            "value": value,
            "created": time.time(),
            "ttl": time.time() + ttl if ttl > 0 else 0
        }
        self._save()

    def clear(self):
        """Clear all cache"""
        self.data = {}
        self._save()

    def cleanup_expired(self):
        """Remove expired entries"""
        now = time.time()
        expired_keys = [
            k for k, v in self.data.items()
            if v.get("ttl") > 0 and now > v["ttl"]
        ]
        
        for key in expired_keys:
            del self.data[key]
        
        if expired_keys:
            print(f"[CACHE] Cleaned {len(expired_keys)} expired entries")
            self._save()

    def stats(self):
        """Get cache statistics"""
        self.cleanup_expired()
        return {
            "total_entries": len(self.data),
            "file_size": os.path.getsize(self.cache_file) if os.path.exists(self.cache_file) else 0
        }
