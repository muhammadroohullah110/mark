# ============================================================
# MARK CONFIGURATION
#
# New client? Change ONLY the values in this file.
# Everything else is automatic.
# ============================================================

# ── Website URL ──────────────────────────────────────────────
CLIENT_WEBSITE_URL = "https://sparknest.com"
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

# ── ElevenLabs TTS ───────────────────────────────────────────
# Voice ID: use ElevenLabs dashboard to pick a voice
# Default "Adam" = warm, friendly male — perfect for Mark
ELEVENLABS_VOICE_ID = "pNInz6obpgDQGcFmaJgB"
ELEVENLABS_MODEL = "eleven_multilingual_v2"

# Voice tuning (0.0 to 1.0)
VOICE_STABILITY = 0.50      # lower = more expressive, higher = more stable
VOICE_SIMILARITY = 0.78     # how close to the original voice
VOICE_STYLE = 0.35          # style exaggeration (multilingual v2 only)

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
