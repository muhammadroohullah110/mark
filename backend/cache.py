# ============================================================
# MARK RESPONSE CACHE — Thread-safe LRU with TTL
# Caches LLM responses for repeated questions.
# Saves API calls + reduces latency to near-zero for common Qs.
# ============================================================

import time
import hashlib
import threading
import logging
from collections import OrderedDict

logger = logging.getLogger("mark.cache")


class ResponseCache:
    """Thread-safe LRU cache with per-entry TTL.

    Usage:
        cache = ResponseCache(max_entries=2000, default_ttl=1800)

        # Check cache
        cached = cache.get(store_id, user_msg, rag_snippet)
        if cached:
            return cached  # instant response

        # After LLM call
        cache.set(store_id, user_msg, rag_snippet, response_text)

        # On RAG reindex
        cache.invalidate_store(store_id)
    """

    def __init__(self, max_entries: int = 2000, default_ttl: int = 1800):
        self.max_entries = max_entries
        self.default_ttl = default_ttl
        self._cache: OrderedDict[str, dict] = OrderedDict()
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0

    def _make_key(self, store_id: str, user_msg: str, rag_snippet: str = "",
                  persona: str = "", ctx: str = "") -> str:
        """Hash(store + normalized message + rag context + persona + ctx) = cache key.

        Persona is part of the key so MAIE's per-persona personalization is
        preserved on cache hits — a price_hunter and a skeptic asking the same
        question get different cached answers instead of colliding.

        `ctx` carries a cheap signal of the CONVERSATION context (e.g. the
        previous user turn + new/returning flag). Without it, a context-dependent
        follow-up like "do you have it in red?" would collide across totally
        different conversations and serve a wrong cached answer.
        """
        normalized = user_msg.strip().lower()[:300]
        raw = f"{store_id}|{normalized}|{rag_snippet[:200]}|{persona}|{ctx[:160]}"
        return hashlib.md5(raw.encode()).hexdigest()

    def get(self, store_id: str, user_msg: str, rag_snippet: str = "",
            persona: str = "", ctx: str = "") -> str | None:
        """Return cached response or None."""
        key = self._make_key(store_id, user_msg, rag_snippet, persona, ctx)
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                self._misses += 1
                return None
            if time.time() > entry["expires"]:
                del self._cache[key]
                self._misses += 1
                return None
            # Move to end (most recently used)
            self._cache.move_to_end(key)
            self._hits += 1
            return entry["response"]

    def set(self, store_id: str, user_msg: str, rag_snippet: str, response: str,
            ttl: int = None, persona: str = "", ctx: str = ""):
        """Cache a response."""
        key = self._make_key(store_id, user_msg, rag_snippet, persona, ctx)
        expires = time.time() + (ttl or self.default_ttl)
        with self._lock:
            self._cache[key] = {"response": response, "expires": expires, "store_id": store_id}
            self._cache.move_to_end(key)
            # Evict oldest if over limit
            while len(self._cache) > self.max_entries:
                self._cache.popitem(last=False)

    def invalidate_store(self, store_id: str):
        """Clear all cached responses for a specific store (on RAG reindex)."""
        with self._lock:
            keys_to_remove = [k for k, v in self._cache.items() if v.get("store_id") == store_id]
            for k in keys_to_remove:
                del self._cache[k]
            if keys_to_remove:
                logger.info(f"Cache invalidated {len(keys_to_remove)} entries for store {store_id}")

    def clear(self):
        """Clear entire cache."""
        with self._lock:
            self._cache.clear()
            self._hits = 0
            self._misses = 0

    def stats(self) -> dict:
        """Cache performance stats."""
        with self._lock:
            total = self._hits + self._misses
            hit_rate = (self._hits / total * 100) if total > 0 else 0
            return {
                "entries": len(self._cache),
                "max_entries": self.max_entries,
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate_pct": round(hit_rate, 1),
            }
