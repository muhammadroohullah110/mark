# ============================================================
# MARK LLM ROUTER — Multi-provider fallback chain
#   Groq key POOL (Kimi K2 on Groq) → Moonshot → Cerebras → Gemini → OpenAI
# Every credential has its own circuit breaker, so one bad/rate-limited key
# never disables the others. Designed so "lots of cheap/free use" scales by
# adding more Groq keys to the pool — NOT by making each store bring a key.
# ============================================================

import os
import logging
import time
import hashlib
import threading
from typing import Optional, Generator, List

logger = logging.getLogger("mark.llm")

# Breaker state keyed by "<provider>#<key-fingerprint>" so it isolates per
# credential. Module-level so all router instances (per request) share it.
_provider_failures: dict[str, list] = {}
_failures_lock = threading.Lock()
_FAILURE_WINDOW = 300   # 5 min, then retry
_FAILURE_TRIP = 3       # 3 failures in the window = unhealthy


def _key_fp(key: str) -> str:
    return hashlib.sha256((key or "").encode()).hexdigest()[:10] if key else "none"


def _healthy(bkey: str) -> bool:
    now = time.time()
    with _failures_lock:
        recent = [t for t in _provider_failures.get(bkey, []) if now - t < _FAILURE_WINDOW]
        _provider_failures[bkey] = recent
        return len(recent) < _FAILURE_TRIP


def _fail(bkey: str):
    with _failures_lock:
        _provider_failures.setdefault(bkey, []).append(time.time())


def _ok(bkey: str):
    with _failures_lock:
        _provider_failures[bkey] = []


class LLMRouter:
    """Routes through a Groq key pool, then OpenAI-compatible fallbacks.

        router = LLMRouter(groq_keys=["k1","k2"], moonshot_key="...", gemini_key="...")
        text = router.complete(messages, model="moonshotai/kimi-k2-instruct-0905")
        for chunk in router.stream(messages, model="..."): ...
    """

    def __init__(self, groq_keys: Optional[List[str]] = None, groq_key: str = "",
                 openai_key: str = "", moonshot_key: str = "",
                 moonshot_model: str = "kimi-k2-0905-preview",
                 fallback_model: str = "gpt-4o-mini",
                 cerebras_key: str = "", cerebras_model: str = "llama-3.3-70b",
                 gemini_key: str = "", gemini_model: str = "gemini-2.0-flash"):
        # ── Groq key pool ──────────────────────────────────────
        keys = list(groq_keys or [])
        if groq_key:
            keys.append(groq_key)
        seen = set()
        keys = [k for k in keys if k and not (k in seen or seen.add(k))]   # dedupe, keep order

        self._groq = []   # [{key, client, bkey}]
        if keys:
            try:
                from groq import Groq
                for k in keys:
                    try:
                        self._groq.append({"client": Groq(api_key=k), "bkey": f"groq#{_key_fp(k)}"})
                    except Exception as e:
                        logger.warning(f"Groq key init failed: {e}")
            except Exception as e:
                logger.warning(f"Groq SDK import failed: {e}")

        # ── OpenAI-compatible fallbacks, in order (cheap/free before paid OpenAI) ──
        # NOTE: free tiers (Cerebras/Gemini) may train on data → only a resilience
        # net behind the paid primary; keep customer-chat-sensitive traffic on Groq.
        self._fallbacks = []   # [{name, client, model, bkey}]
        for name, key, base_url, mdl in [
            ("moonshot", moonshot_key, "https://api.moonshot.ai/v1", moonshot_model),
            ("cerebras", cerebras_key, "https://api.cerebras.ai/v1", cerebras_model),
            ("gemini",   gemini_key,   "https://generativelanguage.googleapis.com/v1beta/openai/", gemini_model),
            ("openai",   openai_key,   None, fallback_model),
        ]:
            if not key:
                continue
            try:
                from openai import OpenAI
                client = OpenAI(api_key=key, base_url=base_url) if base_url else OpenAI(api_key=key)
                self._fallbacks.append({"name": name, "client": client, "model": mdl,
                                        "bkey": f"{name}#{_key_fp(key)}"})
            except Exception as e:
                logger.warning(f"{name} init failed: {e}")

        self.providers = [f"groq-pool({len(self._groq)})"] + [f["name"] for f in self._fallbacks]
        logger.info(f"LLM Router initialized: {self.providers}")

    # ── non-streaming ──────────────────────────────────────────
    def complete(self, messages: list, model: str = "moonshotai/kimi-k2-instruct-0905",
                 max_tokens: int = 200, temperature: float = 0.7) -> Optional[str]:
        for g in self._groq:
            if not _healthy(g["bkey"]):
                continue
            try:
                resp = g["client"].chat.completions.create(
                    model=model, messages=messages, max_tokens=max_tokens, temperature=temperature)
                _ok(g["bkey"])
                return resp.choices[0].message.content
            except Exception as e:
                logger.warning(f"Groq key failed: {e}")
                _fail(g["bkey"])

        for f in self._fallbacks:
            if not _healthy(f["bkey"]):
                continue
            try:
                resp = f["client"].chat.completions.create(
                    model=f["model"], messages=messages, max_tokens=max_tokens, temperature=temperature)
                _ok(f["bkey"])
                logger.info(f"Used fallback provider: {f['name']}")
                return resp.choices[0].message.content
            except Exception as e:
                logger.warning(f"Fallback {f['name']} failed: {e}")
                _fail(f["bkey"])

        return None

    # ── streaming ──────────────────────────────────────────────
    def stream(self, messages: list, model: str = "moonshotai/kimi-k2-instruct-0905",
               max_tokens: int = 200, temperature: float = 0.7) -> Generator[str, None, None]:
        def _run(client, mdl, bkey, label):
            try:
                s = client.chat.completions.create(
                    model=mdl, messages=messages, max_tokens=max_tokens,
                    temperature=temperature, stream=True)
                had = False
                for chunk in s:
                    delta = chunk.choices[0].delta
                    if delta and delta.content:
                        had = True
                        yield delta.content
                if had:
                    _ok(bkey)
                    if label:
                        logger.info(f"Used fallback provider (stream): {label}")
                    yield "__MARK_OK__"   # sentinel: this provider produced content
            except Exception as e:
                logger.warning(f"{label or 'Groq'} stream failed: {e}")
                _fail(bkey)

        for g in self._groq:
            if not _healthy(g["bkey"]):
                continue
            produced = False
            emitted = 0
            for piece in _run(g["client"], model, g["bkey"], ""):
                if piece == "__MARK_OK__":
                    produced = True
                    break
                emitted += 1
                yield piece
            if produced or emitted:   # emitted-but-not-produced = mid-stream fail; don't duplicate
                return

        for f in self._fallbacks:
            if not _healthy(f["bkey"]):
                continue
            produced = False
            emitted = 0
            for piece in _run(f["client"], f["model"], f["bkey"], f["name"]):
                if piece == "__MARK_OK__":
                    produced = True
                    break
                emitted += 1
                yield piece
            if produced or emitted:
                return
        # all failed → yield nothing (caller handles empty)

    def status(self) -> dict:
        now = time.time()
        out = {}
        for i, g in enumerate(self._groq):
            out[f"groq[{i}]"] = {"healthy": _healthy(g["bkey"])}
        for f in self._fallbacks:
            recent = len([t for t in _provider_failures.get(f["bkey"], []) if now - t < _FAILURE_WINDOW])
            out[f["name"]] = {"healthy": _healthy(f["bkey"]), "recent_failures": recent}
        return out
