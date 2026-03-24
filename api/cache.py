import json
import os
import time

class CacheManager:
    """Simple JSON-based cache"""

    def __init__(self, cache_dir="/tmp"):
        self.cache_dir = cache_dir
        self.cache_file = os.path.join(cache_dir, "bimo_cache.json")
        self.data = self._load()

    def _load(self):
        try:
            if os.path.exists(self.cache_file):
                with open(self.cache_file, "r") as f:
                    return json.load(f)
        except:
            pass
        return {}

    def _save(self):
        try:
            with open(self.cache_file, "w") as f:
                json.dump(self.data, f)
        except:
            pass

    def get(self, key):
        if key not in self.data:
            return None
        entry = self.data[key]
        if "ttl" in entry:
            if time.time() > entry["ttl"]:
                del self.data[key]
                self._save()
                return None
        return entry.get("value")

    def set(self, key, value, ttl=3600):
        self.data[key] = {
            "value": value,
            "created": time.time(),
            "ttl": time.time() + ttl if ttl > 0 else 0
        }
        self._save()
