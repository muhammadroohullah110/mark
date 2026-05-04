# ============================================================
# MARK CONFIGURATION
#
# New client? Change ONLY the values in this file.
# Everything else is automatic.
# ============================================================

# ── Website URL ──────────────────────────────────────────────
CLIENT_WEBSITE_URL = "https://webnsoft.com"
MAX_CRAWL_PAGES = 120

# ── CORS ─────────────────────────────────────────────────────
ALLOWED_ORIGINS = ["*"]

# ── Security Limits ──────────────────────────────────────────
MAX_AUDIO_MB = 10
MAX_MESSAGE_LENGTH = 2000

# ── Rate Limiting (per minute, per IP) ───────────────────────
RATE_TRANSCRIBE = 15
RATE_CHAT = 30
RATE_RAG = 40
RATE_TTS = 20

# ── Edge TTS (FREE — no API key needed) ─────────────────────
# Uses Microsoft Edge's Read Aloud voices — high quality, multilingual
# Voice list: https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list
EDGE_TTS_VOICES = {
    "en_male":   "en-US-GuyNeural",        # Warm, natural male (default for Mark)
    "en_female": "en-US-AriaNeural",        # Natural female
    "ur_male":   "ur-PK-AsadNeural",        # Urdu male — very natural
    "ur_female": "ur-PK-UzmaNeural",        # Urdu female
    "hi_male":   "hi-IN-MadhurNeural",      # Hindi male
    "hi_female": "hi-IN-SwaraNeural",       # Hindi female
}
DEFAULT_EDGE_VOICE = "en-US-GuyNeural"      # Mark's default voice
EDGE_TTS_RATE = "+0%"                        # Speed: -50% to +100%
EDGE_TTS_PITCH = "+0Hz"                      # Pitch adjustment

# ── Conversation Logging ────────────────────────────────────
ENABLE_LOGGING = True        # log conversations for analytics
LOG_DIR = "logs"             # directory for conversation logs

# ── Store Customization (for future admin panel) ────────────
STORE_CONFIG = {
    "assistant_name": "Mark",
    "personality": "friendly",       # friendly | professional | playful
    "greeting_style": "casual",      # casual | formal
    "languages": ["en", "ur"],       # supported languages
    "primary_language": "en",
    "idle_timeout": 10,              # seconds before returning to widget
    "walking_enabled": True,
    "sound_effects": True,
}
