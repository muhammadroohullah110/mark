# ============================================================
# MARK CONFIGURATION
# All settings configurable via environment variables
# ============================================================

import os

# ── Website URL (set via env var or admin panel per-store) ───
CLIENT_WEBSITE_URL = os.environ.get("CLIENT_WEBSITE_URL", "")
MAX_CRAWL_PAGES = int(os.environ.get("MAX_CRAWL_PAGES", "120"))

# ── CORS — restrict to actual origins in production ─────────
_cors_env = os.environ.get("ALLOWED_ORIGINS", "")
if _cors_env:
    ALLOWED_ORIGINS = [o.strip() for o in _cors_env.split(",") if o.strip()]
else:
    # Fallback: allow all for local dev, but warn
    ALLOWED_ORIGINS = ["*"]

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
    "en_male":   "en-US-GuyNeural",
    "en_female": "en-US-AriaNeural",
    "ur_male":   "ur-PK-AsadNeural",
    "ur_female": "ur-PK-UzmaNeural",
    "hi_male":   "hi-IN-MadhurNeural",
    "hi_female": "hi-IN-SwaraNeural",
}
DEFAULT_EDGE_VOICE = "en-US-GuyNeural"
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
