# ============================================================
# MARK CONFIGURATION
# All settings configurable via environment variables
# ============================================================

import os

# ── Backend URL (for embed code generation) ─────────────────
BACKEND_URL = os.environ.get("BACKEND_URL", "https://mark-udfz.onrender.com")

# ── Database ─────────────────────────────────────────────────
# Set DATABASE_URL (postgres://...) in production for a persistent,
# managed PostgreSQL (e.g. Render Starter Postgres). When unset, the
# backend falls back to a local SQLite file (dev / zero-config).
# database.py reads this env var directly; exposed here for visibility.
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# ── Website URL (set via env var or admin panel per-store) ───
CLIENT_WEBSITE_URL = os.environ.get("CLIENT_WEBSITE_URL", "")
MAX_CRAWL_PAGES = int(os.environ.get("MAX_CRAWL_PAGES", "120"))

# ── CORS — restrict to actual origins in production ─────────
# The chat widget is embedded on arbitrary customer storefronts, so the public
# API must accept cross-origin requests. Auth is header-based (Bearer JWT +
# X-Store-Token), never cookies — so we deliberately keep credentials OFF when
# using the "*" wildcard, because "*" + allow_credentials=True is invalid per
# the CORS spec and is silently rejected by browsers.
_cors_env = os.environ.get("ALLOWED_ORIGINS", "")
if _cors_env:
    ALLOWED_ORIGINS = [o.strip() for o in _cors_env.split(",") if o.strip()]
    CORS_ALLOW_CREDENTIALS = True
else:
    # No allowlist configured → wildcard (required for embeddable widget),
    # credentials disabled to stay spec-compliant. Set ALLOWED_ORIGINS in
    # production to lock the admin surface to your own dashboard domain.
    ALLOWED_ORIGINS = ["*"]
    CORS_ALLOW_CREDENTIALS = False
    import logging as _logging
    _logging.getLogger("mark.config").warning(
        "ALLOWED_ORIGINS not set — CORS is open to all origins (credentials off). "
        "Set ALLOWED_ORIGINS in production to restrict the admin API."
    )

# ── Security Limits ──────────────────────────────────────────
MAX_AUDIO_MB = int(os.environ.get("MAX_AUDIO_MB", "10"))
MAX_MESSAGE_LENGTH = int(os.environ.get("MAX_MESSAGE_LENGTH", "2000"))

# ── Rate Limiting (per minute, per IP) ───────────────────────
RATE_TRANSCRIBE = int(os.environ.get("RATE_TRANSCRIBE", "15"))
RATE_CHAT = int(os.environ.get("RATE_CHAT", "30"))
RATE_RAG = int(os.environ.get("RATE_RAG", "40"))
RATE_TTS = int(os.environ.get("RATE_TTS", "20"))

# ── Edge TTS (FREE — no API key needed) ─────────────────────
EDGE_TTS_VOICES = {
    "en_male":   "en-GB-RyanNeural",
    "en_female": "en-US-AriaNeural",
    "ur_male":   "ur-PK-AsadNeural",
    "ur_female": "ur-PK-UzmaNeural",
    "hi_male":   "hi-IN-MadhurNeural",
    "hi_female": "hi-IN-SwaraNeural",
}
DEFAULT_EDGE_VOICE = "en-GB-RyanNeural"
EDGE_TTS_RATE = "+0%"
EDGE_TTS_PITCH = "+0Hz"

# ── Conversation Logging ────────────────────────────────────
ENABLE_LOGGING = os.environ.get("ENABLE_LOGGING", "true").lower() == "true"
LOG_DIR = os.environ.get("LOG_DIR", "logs")

# ── Store Customization ─────────────────────────────────────
STORE_CONFIG = {
    "assistant_name": "Mark",
    "personality": "friendly",
    "greeting_style": "casual",
    "languages": ["en", "ur"],
    "primary_language": "en",
    "idle_timeout": 10,
    "walking_enabled": True,
    "sound_effects": True,
}

# ── Memory Limits (for Render free tier 512MB) ──────────────
MAX_RAG_INSTANCES = int(os.environ.get("MAX_RAG_INSTANCES", "5"))
MAX_PRODUCT_CACHES = int(os.environ.get("MAX_PRODUCT_CACHES", "10"))
RATE_LIMITER_CLEANUP_INTERVAL = 300  # seconds

# ── WP Shared Secret (for RAG crawl auth from WordPress) ───
WP_SHARED_SECRET = os.environ.get("WP_SHARED_SECRET", "")
