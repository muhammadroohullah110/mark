# ============================================================
# MARK LLM ROUTER — Multi-provider fallback chain
# Groq (primary) → OpenAI (fallback) → error
# Ensures zero downtime when any single provider fails.
# ============================================================

import os
import logging
import time
import hashlib
import threading
from typing import Optional, Generator

logger = logging.getLogger("mark.llm")

# Provider availability tracking — keyed by provider + API-KEY fingerprint, so a
# breaker trips only for the specific credential that's failing. (Previously
# keyed by provider name alone, which meant one tenant's bad key disabled that
# provider for EVERY store. Stores sharing a key correctly share a breaker.)
_provider_failures: dict[str, list] = {}  # "provider:keyfp" -> [failure timestamps]
_failures_lock = threading.Lock()         # guards _provider_failures across request threads
_FAILURE_WINDOW = 300  # 5 min — after this, retry the provider


def _key_fp(key: str) -> str:
    """Short, non-reversible fingerprint of an API key for breaker bucketing."""
    return hashlib.sha256((key or "").encode()).hexdigest()[:10] if key else "none"


class LLMRouter:
    """Routes LLM requests through multiple providers with automatic fallback.

    Usage:
        router = LLMRouter(groq_key="...", openai_key="...")
        response = router.complete(messages, model="llama-3.3-70b-versatile", ...)
        # or streaming:
        for chunk in router.stream(messages, model="...", ...):
            yield chunk
    """

    def __init__(self, groq_key: str = "", openai_key: str = "",
                 moonshot_key: str = "", moonshot_model: str = "kimi-k2-0711-preview",
                 fallback_model: str = "gpt-4o-mini"):
        self.providers = []
        self._groq_client = None
        self._moonshot_client = None
        self._openai_client = None
        self.fallback_model = fallback_model
        self.moonshot_model = moonshot_model

        # Per-credential breaker buckets — isolate failures by API key.
        self._bkey = {
            "groq": f"groq:{_key_fp(groq_key)}",
            "moonshot": f"moonshot:{_key_fp(moonshot_key)}",
            "openai": f"openai:{_key_fp(openai_key)}",
        }

        # Primary: Groq (hosts Kimi K2 — Kimi quality at Groq speed)
        if groq_key:
            try:
                from groq import Groq
                self._groq_client = Groq(api_key=groq_key)
                self.providers.append("groq")
            except Exception as e:
                logger.warning(f"Groq init failed: {e}")

        # Fallback 1: Moonshot (Kimi K2, independent provider) — OpenAI-compatible API
        if moonshot_key:
            try:
                from openai import OpenAI
                self._moonshot_client = OpenAI(api_key=moonshot_key, base_url="https://api.moonshot.ai/v1")
                self.providers.append("moonshot")
            except Exception as e:
                logger.warning(f"Moonshot init failed: {e}")

        # Fallback 2: OpenAI (last resort)
        if openai_key:
            try:
                from openai import OpenAI
                self._openai_client = OpenAI(api_key=openai_key)
                self.providers.append("openai")
            except Exception as e:
                logger.warning(f"OpenAI init failed: {e}")

        logger.info(f"LLM Router initialized with providers: {self.providers}")

    def _is_provider_healthy(self, provider: str) -> bool:
        """Check if THIS credential has had too many recent failures."""
        bkey = self._bkey.get(provider, provider)
        now = time.time()
        with _failures_lock:
            recent = [t for t in _provider_failures.get(bkey, []) if now - t < _FAILURE_WINDOW]
            _provider_failures[bkey] = recent
            return len(recent) < 3  # 3 failures in 5 min = unhealthy

    def _record_failure(self, provider: str):
        bkey = self._bkey.get(provider, provider)
        with _failures_lock:
            _provider_failures.setdefault(bkey, []).append(time.time())

    def _record_success(self, provider: str):
        with _failures_lock:
            _provider_failures[self._bkey.get(provider, provider)] = []  # clear on success

    def complete(self, messages: list, model: str = "llama-3.3-70b-versatile",
                 max_tokens: int = 200, temperature: float = 0.7) -> Optional[str]:
        """Non-streaming completion. Returns response text or None."""

        # Try Groq first
        if "groq" in self.providers and self._is_provider_healthy("groq"):
            try:
                resp = self._groq_client.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
                text = resp.choices[0].message.content
                self._record_success("groq")
                return text
            except Exception as e:
                logger.warning(f"Groq failed: {e}")
                self._record_failure("groq")

        # Fallback 1: Moonshot (Kimi K2)
        if "moonshot" in self.providers and self._is_provider_healthy("moonshot"):
            try:
                resp = self._moonshot_client.chat.completions.create(
                    model=self.moonshot_model,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
                text = resp.choices[0].message.content
                self._record_success("moonshot")
                logger.info("Used Moonshot (Kimi) fallback successfully")
                return text
            except Exception as e:
                logger.warning(f"Moonshot fallback failed: {e}")
                self._record_failure("moonshot")

        # Fallback 2: OpenAI
        if "openai" in self.providers and self._is_provider_healthy("openai"):
            try:
                resp = self._openai_client.chat.completions.create(
                    model=self.fallback_model,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
                text = resp.choices[0].message.content
                self._record_success("openai")
                logger.info("Used OpenAI fallback successfully")
                return text
            except Exception as e:
                logger.warning(f"OpenAI fallback failed: {e}")
                self._record_failure("openai")

        return None  # all providers failed

    def stream(self, messages: list, model: str = "llama-3.3-70b-versatile",
               max_tokens: int = 200, temperature: float = 0.7) -> Generator[str, None, None]:
        """Streaming completion. Yields text chunks."""

        # Try Groq first
        if "groq" in self.providers and self._is_provider_healthy("groq"):
            try:
                stream = self._groq_client.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    stream=True,
                )
                had_content = False
                for chunk in stream:
                    delta = chunk.choices[0].delta
                    if delta and delta.content:
                        had_content = True
                        yield delta.content
                if had_content:
                    self._record_success("groq")
                    return
            except Exception as e:
                logger.warning(f"Groq stream failed: {e}")
                self._record_failure("groq")

        # Fallback 1: Moonshot (Kimi K2) streaming
        if "moonshot" in self.providers and self._is_provider_healthy("moonshot"):
            try:
                stream = self._moonshot_client.chat.completions.create(
                    model=self.moonshot_model,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    stream=True,
                )
                had_content = False
                for chunk in stream:
                    delta = chunk.choices[0].delta
                    if delta and delta.content:
                        had_content = True
                        yield delta.content
                if had_content:
                    self._record_success("moonshot")
                    logger.info("Used Moonshot (Kimi) stream fallback")
                    return
            except Exception as e:
                logger.warning(f"Moonshot stream fallback failed: {e}")
                self._record_failure("moonshot")

        # Fallback 2: OpenAI streaming
        if "openai" in self.providers and self._is_provider_healthy("openai"):
            try:
                stream = self._openai_client.chat.completions.create(
                    model=self.fallback_model,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    stream=True,
                )
                had_content = False
                for chunk in stream:
                    delta = chunk.choices[0].delta
                    if delta and delta.content:
                        had_content = True
                        yield delta.content
                if had_content:
                    self._record_success("openai")
                    logger.info("Used OpenAI stream fallback")
                    return
            except Exception as e:
                logger.warning(f"OpenAI stream fallback failed: {e}")
                self._record_failure("openai")

        # All failed — yield nothing (caller handles empty response)

    def status(self) -> dict:
        """Current provider status."""
        now = time.time()
        return {
            provider: {
                "available": self._is_provider_healthy(provider),
                "recent_failures": len([t for t in _provider_failures.get(self._bkey.get(provider, provider), []) if now - t < _FAILURE_WINDOW]),
            }
            for provider in self.providers
        }
