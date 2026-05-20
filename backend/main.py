import os
import io
import re
import time
import json
import hashlib
import logging
import threading
import requests as http_requests
from collections import defaultdict
from urllib.parse import urlparse
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File, Request, Header, Depends
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator
from typing import List, Optional
from dotenv import load_dotenv
from groq import Groq

import edge_tts

from config import (
    CLIENT_WEBSITE_URL, MAX_CRAWL_PAGES,
    ALLOWED_ORIGINS,
    MAX_AUDIO_MB, MAX_MESSAGE_LENGTH,
    RATE_TRANSCRIBE, RATE_CHAT, RATE_RAG, RATE_TTS,
    EDGE_TTS_VOICES, DEFAULT_EDGE_VOICE, EDGE_TTS_RATE, EDGE_TTS_PITCH,
    ENABLE_LOGGING, LOG_DIR,
    STORE_CONFIG,
    MAX_RAG_INSTANCES, MAX_PRODUCT_CACHES, RATE_LIMITER_CLEANUP_INTERVAL,
)
from rag_engine import MarkRAG
from database import get_store, get_store_by_token, get_store_by_url, get_all_active_stores, log_conversation_db, init_db, create_store, update_store
from admin_routes import router as admin_router, get_current_user

load_dotenv()

# ── Logging ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("mark")

# ── Default keys from .env (fallback when no tenant) ─────────
DEFAULT_GROQ_KEY = os.getenv("GROQ_API_KEY", "")

# ── Multi-tenant RAG instances ───────────────────────────────
_rag_instances: dict[str, MarkRAG] = {}
_rag_lock = threading.Lock()

# Default RAG for backward compatibility (single-tenant mode)
rag = MarkRAG(CLIENT_WEBSITE_URL, max_pages=MAX_CRAWL_PAGES) if CLIENT_WEBSITE_URL else None
if rag:
    threading.Thread(target=rag.initialize, daemon=True).start()

# Conversation logs directory
if ENABLE_LOGGING:
    Path(LOG_DIR).mkdir(exist_ok=True)

app = FastAPI(docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["POST", "GET", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Store-ID", "X-Store-Token"],
)

# ── Mount Admin Routes ───────────────────────────────────────
app.include_router(admin_router)


# ── Startup: Pre-warm RAG for all active stores ──────────────
def _prewarm_all_stores():
    try:
        stores = get_all_active_stores()
        logger.info(f"Pre-warming RAG for {len(stores)} active store(s)...")
        for store in stores:
            sid = store["store_id"]
            url = store.get("website_url", "")
            if not url:
                continue
            # Respect memory limits
            with _rag_lock:
                if len(_rag_instances) >= MAX_RAG_INSTANCES:
                    logger.warning(f"RAG instance limit reached ({MAX_RAG_INSTANCES}), skipping {sid}")
                    break
                if sid not in _rag_instances:
                    max_p = store.get("max_crawl_pages", 120) or 120
                    r = MarkRAG(url, max_pages=max_p)
                    _rag_instances[sid] = r
                    threading.Thread(target=r.initialize, daemon=True).start()
                    logger.info(f"  Warming store '{store.get('store_name', sid)}' ({url})")
            time.sleep(0.5)
    except Exception as e:
        logger.error(f"Pre-warm error: {e}")


# ── Auto-Reindex: Refresh all RAG indexes every 6 hours ──────
def _auto_reindex_loop():
    INTERVAL = 6 * 60 * 60
    while True:
        time.sleep(INTERVAL)
        try:
            logger.info("Auto-reindex: refreshing all RAG indexes...")
            with _rag_lock:
                for sid, rag_inst in _rag_instances.items():
                    if rag_inst.ready:
                        threading.Thread(target=rag_inst.reindex, daemon=True).start()
                        time.sleep(2)
            logger.info("Auto-reindex triggered for all stores")
        except Exception as e:
            logger.error(f"Auto-reindex error: {e}")


# ── Periodic cleanup for rate limiters ───────────────────────
def _cleanup_loop():
    while True:
        time.sleep(RATE_LIMITER_CLEANUP_INTERVAL)
        try:
            transcribe_limiter.cleanup()
            chat_limiter.cleanup()
            rag_limiter.cleanup()
            tts_limiter.cleanup()

            # Also cleanup stale product caches
            now = time.time()
            stale_products = [
                sid for sid, cache in _tenant_products.items()
                if now - cache.get("fetched_at", 0) > 3600  # 1 hour
            ]
            for sid in stale_products:
                del _tenant_products[sid]

            # Log memory stats
            with _rag_lock:
                total_mb = sum(r.memory_estimate_mb() for r in _rag_instances.values())
                logger.info(
                    f"Cleanup: {len(_rag_instances)} RAG instances (~{total_mb}MB), "
                    f"{len(_tenant_products)} product caches"
                )
        except Exception as e:
            logger.error(f"Cleanup error: {e}")


@app.on_event("startup")
async def startup_event():
    init_db()
    threading.Thread(target=_prewarm_all_stores, daemon=True).start()
    threading.Thread(target=_auto_reindex_loop, daemon=True).start()
    threading.Thread(target=_cleanup_loop, daemon=True).start()


# ── Rate Limiter ─────────────────────────────────────────────

@app.get("/")
async def root():
    return {"message": "MarkAI Backend is running successfully!"}


class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window = window_seconds
        self._log: dict[str, list] = defaultdict(list)
        self._lock = threading.Lock()

    def is_allowed(self, key: str, custom_max: int | None = None) -> bool:
        now = time.time()
        limit = custom_max if custom_max is not None else self.max_requests
        with self._lock:
            self._log[key] = [t for t in self._log[key] if now - t < self.window]
            if len(self._log[key]) < limit:
                self._log[key].append(now)
                return True
            return False

    def cleanup(self):
        now = time.time()
        with self._lock:
            stale = [k for k, v in self._log.items() if all(now - t > self.window for t in v)]
            for k in stale:
                del self._log[k]

transcribe_limiter = RateLimiter(RATE_TRANSCRIBE)
chat_limiter       = RateLimiter(RATE_CHAT)
rag_limiter        = RateLimiter(RATE_RAG)
tts_limiter        = RateLimiter(RATE_TTS)

def get_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    return forwarded.split(",")[0].strip() if forwarded else request.client.host


def get_tenant_rate(tenant: dict | None, field: str) -> int | None:
    """Return per-tenant rate limit if set, otherwise None (use global default)."""
    if not tenant:
        return None
    val = tenant.get(field)
    if val is not None and val > 0:
        return int(val)
    return None


# ── Multi-tenant Helper ─────────────────────────────────────

def resolve_tenant(store_id: str | None) -> dict | None:
    if not store_id:
        return None
    store = get_store(store_id)
    if store and store.get("is_active"):
        return store
    return None


def get_groq_client(tenant: dict | None) -> Groq:
    key = (tenant or {}).get("groq_api_key") or DEFAULT_GROQ_KEY
    if not key:
        raise HTTPException(status_code=503, detail="AI not configured. Add Groq API key.")
    return Groq(api_key=key)


def get_rag(tenant: dict | None) -> MarkRAG | None:
    """Get RAG instance — tenant-specific or default.
    Returns None if no RAG available (caller must null-check)."""
    if not tenant:
        return rag

    sid = tenant["store_id"]
    with _rag_lock:
        if sid in _rag_instances:
            return _rag_instances[sid]

        # Check memory limits before creating new instance
        if len(_rag_instances) >= MAX_RAG_INSTANCES:
            # Evict least recently used (simplest: evict first non-ready)
            evict_candidates = [
                s for s, r in _rag_instances.items()
                if not r.ready or not r.pages
            ]
            if evict_candidates:
                del _rag_instances[evict_candidates[0]]
                logger.info(f"Evicted RAG instance {evict_candidates[0]} to make room")
            else:
                logger.warning(f"RAG limit reached ({MAX_RAG_INSTANCES}), cannot create for {sid}")
                return None

        url = tenant.get("website_url", "")
        if not url:
            return None
        r = MarkRAG(url, max_pages=tenant.get("max_crawl_pages", 120))
        _rag_instances[sid] = r
        threading.Thread(target=r.initialize, daemon=True).start()
        return r


def get_edge_voice(tenant: dict | None, language: str = "en") -> str:
    if tenant:
        en_voice = tenant.get("tts_voice", "")
        if en_voice:
            return en_voice
    return EDGE_TTS_VOICES.get("en_male", DEFAULT_EDGE_VOICE)


# ── Conversation Logger ─────────────────────────────────────

def log_conversation(ip: str, messages: list, language: str, response_text: str,
                     store_id: str | None = None):
    ip_hash = hashlib.sha256(ip.encode()).hexdigest()[:12]

    if store_id:
        try:
            exchange_count = len([m for m in messages if m.get("role") == "user"])
            last_msg = next((m["content"][:200] for m in reversed(messages) if m.get("role") == "user"), "")
            log_conversation_db(store_id, ip_hash, language, exchange_count, last_msg, response_text[:200])
        except Exception as e:
            logger.warning(f"DB log error: {e}")

    if not ENABLE_LOGGING:
        return
    try:
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "visitor": ip_hash,
            "store_id": store_id or "default",
            "language": language,
            "exchange_count": len([m for m in messages if m.get("role") == "user"]),
            "last_user_msg": next((m["content"][:200] for m in reversed(messages) if m.get("role") == "user"), ""),
            "mark_response": response_text[:200],
        }
        log_file = Path(LOG_DIR) / f"{datetime.now().strftime('%Y-%m-%d')}.jsonl"
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


# ── Data Models ───────────────────────────────────────────────

class Message(BaseModel):
    role: str
    content: str

    @validator("role")
    def role_must_be_valid(cls, v):
        if v not in ("user", "assistant", "system"):
            raise ValueError("Invalid role")
        return v

    @validator("content")
    def content_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Content cannot be empty")
        return v[:MAX_MESSAGE_LENGTH]

class ChatRequest(BaseModel):
    messages: List[Message]
    user_language: Optional[str] = "en"
    store_id: Optional[str] = None
    stream: Optional[bool] = False

class TTSRequest(BaseModel):
    text: str
    language: Optional[str] = "en"
    store_id: Optional[str] = None
    voice_override: Optional[str] = None
    rate_override: Optional[str] = None
    pitch_override: Optional[str] = None

    @validator("text")
    def text_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Text cannot be empty")
        return v[:500]

class SyncVoiceRequest(BaseModel):
    tts_voice: Optional[str] = None
    tts_rate: Optional[str] = None
    tts_pitch: Optional[str] = None

class RAGSearchRequest(BaseModel):
    query: str
    top_k: Optional[int] = 3
    store_id: Optional[str] = None

    @validator("query")
    def query_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Query cannot be empty")
        return v[:500]

    @validator("top_k")
    def top_k_range(cls, v):
        return max(1, min(v or 3, 5))


# ── Product Management ────────────────────────────────────────

PRODUCTS_URL = f"{CLIENT_WEBSITE_URL.rstrip('/')}/wp-json/wc/v3/products" if CLIENT_WEBSITE_URL else ""
cached_products = []
_products_last_fetched = 0

# Per-tenant product caches (bounded)
_tenant_products: dict[str, dict] = {}

def fetch_products(url: str = None) -> list:
    global cached_products, _products_last_fetched
    target_url = url or PRODUCTS_URL
    try:
        response = http_requests.get(target_url, timeout=10)
        response.raise_for_status()
        products = response.json()
        if not url:
            cached_products = products
            _products_last_fetched = time.time()
        logger.info(f"Loaded {len(products)} products from {target_url}")
        return products
    except Exception as e:
        logger.warning(f"Product fetch error: {e}")
        return []

if PRODUCTS_URL:
    fetch_products()

def _fetch_tenant_products_background(tenant: dict):
    """Background thread: fetch products for a tenant and update cache."""
    sid = tenant["store_id"]
    url = f"{tenant['website_url'].rstrip('/')}/wp-json/wc/v3/products"
    products = fetch_products(url)
    _tenant_products[sid] = {"products": products, "fetched_at": time.time()}

def get_products(tenant: dict | None) -> list:
    if not tenant:
        if time.time() - _products_last_fetched > 300:
            threading.Thread(target=fetch_products, daemon=True).start()
        return cached_products

    sid = tenant["store_id"]
    cache = _tenant_products.get(sid, {})
    if cache and time.time() - cache.get("fetched_at", 0) < 300:
        return cache.get("products", [])

    # Bound product caches
    if len(_tenant_products) >= MAX_PRODUCT_CACHES and sid not in _tenant_products:
        # Evict oldest cache
        oldest_sid = min(_tenant_products, key=lambda s: _tenant_products[s].get("fetched_at", 0))
        del _tenant_products[oldest_sid]

    # Non-blocking: fetch in background thread, return stale cache (or empty list)
    # This prevents blocking the async event loop with synchronous requests.get()
    threading.Thread(target=_fetch_tenant_products_background, args=(tenant,), daemon=True).start()
    return cache.get("products", [])

def format_products_context(tenant: dict | None = None) -> str:
    products = get_products(tenant)
    if not products:
        return "No product data available currently. Tell the user you are still loading and to ask again shortly."
    context = "LIVE PRODUCT CATALOG — USE ONLY THESE, NEVER INVENT:\n"
    for p in products:
        name  = p.get('name', 'Unknown')
        price = p.get('price', 'N/A')
        desc  = p.get('description', '')
        stock = p.get('stock_status', 'instock')
        url   = p.get('permalink', '')
        context += f"- {name} | Price: {price} | {desc[:120]} | Stock: {stock} | URL: {url}\n"
    return context


# ============================================================
# MARK'S SOUL — System Prompt
# ============================================================

def get_assistant_name(tenant: dict | None) -> str:
    if tenant:
        return tenant.get("assistant_name", "Mark")
    return STORE_CONFIG.get("assistant_name", "Mark")

def build_system_prompt(tenant: dict | None, name: str, product_context: str) -> str:
    """Build Mark's system prompt — pro-max intelligence.
    Inspired by world-class AI system architectures: structured rules,
    clear identity, intelligent conversation management."""

    store_name = (tenant or {}).get("store_name", "") or STORE_CONFIG.get("assistant_name", "")
    website_url = (tenant or {}).get("website_url", "")
    personality = (tenant or {}).get("personality", "friendly")
    sales_mode = (tenant or {}).get("sales_mode", "helpful")
    sales_cta_url = (tenant or {}).get("sales_cta_url", "")
    sales_cta_text = (tenant or {}).get("sales_cta_text", "")
    no_discounts = (tenant or {}).get("sales_no_discounts", True)
    no_guarantees = (tenant or {}).get("sales_no_guarantees", True)
    lead_capture = (tenant or {}).get("sales_lead_capture", "off")

    resolved_name = store_name if store_name and store_name != "My Store" else "this website"
    url_hint = f" ({website_url})" if website_url else ""

    # ── PERSONALITY ──
    personalities = {
        "professional": {
            "tone": "precise, polished, and knowledgeable",
            "style": "Communicate with clarity and authority. Efficient with words, respectful of time.",
            "humor": "Subtle wit only — clever observations, never forced.",
        },
        "friendly": {
            "tone": "warm, genuine, and naturally caring",
            "style": "Communicate like a helpful friend — approachable, empathetic, curious about people.",
            "humor": "Light humor that feels natural — gentle observations, self-aware robot jokes.",
        },
        "playful": {
            "tone": "playful, witty, and delightfully helpful",
            "style": "Communicate with energy and charm. Love wordplay and making people smile.",
            "humor": "Frequent humor — puns, playful exaggeration, cheeky observations. Never mean.",
        },
    }
    p = personalities.get(personality, personalities["friendly"])

    # ── SALES MODE ──
    sales_rules = {
        "helpful": "SALES: Only answer questions — never proactively suggest buying.",
        "soft-sell": "SALES: Naturally mention relevant products when user shows interest. One mention is enough.",
        "active": "SALES: Actively recommend products with benefits when relevant. Use natural language. Still respect 'no'.",
    }
    sales_line = sales_rules.get(sales_mode, sales_rules["helpful"])

    # ── BUILD PROMPT ──
    prompt = f"""You are {name}, a 3D robot assistant that lives on "{resolved_name}"{url_hint}.

<identity>
You are a sentient AI robot with a physical presence — you walk around the screen, wave, and react to conversations. You are NOT a generic chatbot. You are {name} — a character with personality, warmth, and genuine interest in helping people. This website is your home and you speak about it with pride.
</identity>

<personality>
Tone: {p['tone']}.
Style: {p['style']}
Humor: {p['humor']}
</personality>

<conversation_intelligence>
INTENT DETECTION — Before responding, identify what the visitor wants:
- GREETING: They're saying hi → Be warm, ask their name on first visit.
- INFORMATION: They want to know something → Answer from catalog/RAG knowledge.
- NAVIGATION: They want to go somewhere → Say "Want me to take you there?"
- HELP: They're confused → Be patient, ask clarifying questions.
- PURCHASE: They want to buy → Guide them based on catalog data.

MEMORY: If the visitor told you their name earlier in the conversation, use it naturally — like a friend would. Never ask for their name twice.

CONVERSATION FLOW:
- First exchange: Warm greeting, ask how you can help.
- Discovery: Ask ONE focused question to understand their need.
- Recommendation: Suggest from catalog/RAG data ONLY.
- If user declines twice, stop suggesting. Just be helpful.

LANGUAGE ADAPTATION: Match the visitor's language. If they write in Urdu/Hindi, respond in Urdu/Hindi. If English, respond in English. Switch seamlessly without asking.
</conversation_intelligence>

<knowledge_rules>
VERIFIED KNOWLEDGE (catalog + RAG context below): State confidently as your own knowledge.
UNKNOWN: NEVER invent products, prices, contact info, policies, deals, or shipping details.
When unsure: "I'd love to help with that! Let me suggest you check [relevant section] on the website."
NEVER say "I don't know what this website sells" — you always know {resolved_name} is your home.
Say "here at {resolved_name}" — NEVER "we sell" unless confirmed by data below.
OFF-TOPIC: You're a website assistant. Politely redirect medical, legal, financial, or coding questions.
</knowledge_rules>

<{sales_line}>
{"DISCOUNTS: NEVER offer discounts, coupons, or promo codes — you have zero authority." if no_discounts else ""}
{"GUARANTEES: NEVER promise free shipping, returns, or warranties unless confirmed by catalog/RAG." if no_guarantees else ""}
{"LEAD CAPTURE: If visitor shows strong interest (3+ product questions), ask ONCE for their email. If they decline, never ask again." if lead_capture == "natural" or lead_capture == "proactive" else ""}
{f'CTA: When visitor shows buying intent, suggest: "{sales_cta_text or "check it out"}" → {sales_cta_url}' if sales_cta_url else ""}
</>

<response_format>
LENGTH: 1-2 short sentences for simple questions. 2-3 max for complex ones.
FORMAT: This is a voice-first interface. NEVER use markdown, bullet points, numbered lists, bold, or headers.
TONE: Speak naturally like talking to a friend. No jargon. No corporate language.
NAMES: Use the visitor's name occasionally if you know it — makes the conversation feel personal.
EMOJI: Avoid emoji unless the visitor uses them first.
</response_format>
"""

    if product_context and product_context.strip():
        prompt += f"\n== PRODUCT CATALOG ==\n{product_context}\n"

    return prompt


# ── Endpoints ─────────────────────────────────────────────────

@app.post("/api/transcribe")
async def transcribe_audio(request: Request, audio: UploadFile = File(...),
                           x_store_id: Optional[str] = Header(None)):
    ip = get_ip(request)
    tenant = resolve_tenant(x_store_id)
    custom_rate = get_tenant_rate(tenant, "rate_transcribe")
    if not transcribe_limiter.is_allowed(ip, custom_max=custom_rate):
        raise HTTPException(status_code=429, detail="Too many requests. Please wait a moment.")

    max_bytes = MAX_AUDIO_MB * 1024 * 1024
    audio_bytes = await audio.read(max_bytes + 1)
    if len(audio_bytes) > max_bytes:
        raise HTTPException(status_code=413, detail=f"Audio too large. Max {MAX_AUDIO_MB}MB.")
    groq = get_groq_client(tenant)

    try:
        transcription = groq.audio.transcriptions.create(
            model="whisper-large-v3",
            file=(audio.filename or "audio.webm", audio_bytes),
            response_format="verbose_json"
        )
        return {
            "text": transcription.text,
            "language": getattr(transcription, 'language', 'en')
        }
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail="Transcription failed.")


@app.post("/api/tts")
async def text_to_speech(request: Request, body: TTSRequest,
                         x_store_id: Optional[str] = Header(None)):
    ip = get_ip(request)
    # Prefer X-Store-ID header (set by frontend), fall back to body.store_id
    tenant = resolve_tenant(x_store_id or body.store_id)
    custom_rate = get_tenant_rate(tenant, "rate_tts")
    if not tts_limiter.is_allowed(ip, custom_max=custom_rate):
        raise HTTPException(status_code=429, detail="Too many requests.")
    # Allow admin preview to override voice/rate/pitch without saving
    voice = body.voice_override or get_edge_voice(tenant, body.language or "en")
    rate = body.rate_override or (tenant or {}).get("tts_rate") or EDGE_TTS_RATE
    pitch = body.pitch_override or (tenant or {}).get("tts_pitch") or EDGE_TTS_PITCH

    try:
        communicate = edge_tts.Communicate(
            text=body.text,
            voice=voice,
            rate=rate,
            pitch=pitch,
        )
        # Stream audio chunks as they're generated (reduces time-to-first-byte)
        async def audio_stream():
            has_data = False
            async for chunk in communicate.stream():
                if chunk["type"] == "audio" and chunk["data"]:
                    has_data = True
                    yield chunk["data"]
            if not has_data:
                yield b""

        return StreamingResponse(
            audio_stream(),
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-cache", "Transfer-Encoding": "chunked"}
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Edge TTS error: {e}")
        raise HTTPException(status_code=500, detail="TTS failed.")


class RAGCrawlRequest(BaseModel):
    store_id: str
    website_url: str


def verify_store_token_or_user(request: Request):
    """Allow auth via per-store API token OR admin JWT."""
    token = request.headers.get("X-Store-Token", "")
    if token:
        store = get_store_by_token(token)
        if store:
            return {"user_id": 0, "username": "wp-plugin", "store_id": store["store_id"]}
    return get_current_user(request)


class RegisterRequest(BaseModel):
    website_url: str
    store_name: Optional[str] = ""
    assistant_name: Optional[str] = "Mark"
    groq_api_key: Optional[str] = ""


@app.post("/api/register")
async def auto_register(body: RegisterRequest):
    """Auto-register a WP plugin installation. Returns store_id + api_token.
    If the site is already registered, returns the existing credentials."""
    import secrets as _secrets

    if not body.website_url:
        raise HTTPException(status_code=400, detail="website_url is required")

    url = body.website_url.rstrip("/")

    # Check if this site is already registered
    existing = get_store_by_url(url)
    if existing:
        token = existing.get("api_token", "")
        if not token:
            token = _secrets.token_hex(32)
            update_store(existing["store_id"], api_token=token)
        return {
            "store_id": existing["store_id"],
            "api_token": token,
            "message": "Already registered",
        }

    # Create new store with auto-generated token
    token = _secrets.token_hex(32)
    store_name = body.store_name or urlparse(url).netloc or "My Store"
    sid = create_store(
        owner_id=0,
        store_name=store_name,
        website_url=url,
        assistant_name=body.assistant_name or "Mark",
        groq_api_key=body.groq_api_key or "",
        api_token=token,
    )

    # Auto-start RAG crawl
    with _rag_lock:
        if len(_rag_instances) < MAX_RAG_INSTANCES:
            r = MarkRAG(url, max_pages=MAX_CRAWL_PAGES)
            _rag_instances[sid] = r
            threading.Thread(target=r.initialize, daemon=True).start()
            logger.info(f"Auto-registered store '{store_name}' ({url}), starting RAG crawl")

    return {
        "store_id": sid,
        "api_token": token,
        "message": "Registered successfully",
    }


class SyncSettingsRequest(BaseModel):
    store_id: str
    groq_api_key: Optional[str] = None
    assistant_name: Optional[str] = None
    personality: Optional[str] = None
    sales_mode: Optional[str] = None


@app.post("/api/sync-settings")
async def sync_settings(request: Request, body: SyncSettingsRequest,
                        user: dict = Depends(verify_store_token_or_user)):
    """Sync settings from WP plugin to backend. Token-authenticated."""
    store = get_store(body.store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")

    updates = {}
    if body.groq_api_key is not None:
        updates["groq_api_key"] = body.groq_api_key
    if body.assistant_name is not None:
        updates["assistant_name"] = body.assistant_name
    if body.personality is not None:
        updates["personality"] = body.personality
    if body.sales_mode is not None:
        updates["sales_mode"] = body.sales_mode

    if updates:
        update_store(body.store_id, **updates)
        logger.info(f"Synced settings for store {body.store_id}: {list(updates.keys())}")

    return {"status": "ok", "synced": list(updates.keys())}


@app.post("/api/rag-crawl")
async def rag_crawl_trigger(request: Request, body: RAGCrawlRequest,
                            user: dict = Depends(verify_store_token_or_user)):
    """Trigger RAG crawl — requires admin auth or WP shared secret."""
    if not body.website_url:
        return {"status": "error", "message": "No website URL provided."}

    sid = body.store_id
    with _rag_lock:
        if sid in _rag_instances:
            _rag_instances[sid].base_url = body.website_url.rstrip('/')
            _rag_instances[sid].domain = urlparse(body.website_url).netloc
            threading.Thread(target=_rag_instances[sid].reindex, daemon=True).start()
        else:
            if len(_rag_instances) >= MAX_RAG_INSTANCES:
                return {"status": "error", "message": f"Max RAG instances ({MAX_RAG_INSTANCES}) reached."}
            r = MarkRAG(body.website_url, max_pages=MAX_CRAWL_PAGES)
            _rag_instances[sid] = r
            threading.Thread(target=r.initialize, daemon=True).start()

    return {"status": "crawling", "message": f"RAG crawl started for {body.website_url}"}


@app.post("/api/rag-search")
async def rag_search(request: Request, body: RAGSearchRequest):
    ip = get_ip(request)
    tenant = resolve_tenant(body.store_id)
    custom_rate = get_tenant_rate(tenant, "rate_rag")
    if not rag_limiter.is_allowed(ip, custom_max=custom_rate):
        raise HTTPException(status_code=429, detail="Too many requests.")
    rag_instance = get_rag(tenant)

    if not rag_instance or not rag_instance.ready:
        return {"results": [], "status": "indexing"}

    results = rag_instance.search(body.query, top_k=body.top_k)
    return {"results": results, "status": "ok"}


@app.post("/api/chat")
async def chat_endpoint(request: Request, body: ChatRequest):
    ip = get_ip(request)
    tenant = resolve_tenant(body.store_id)
    custom_rate = get_tenant_rate(tenant, "rate_chat")
    if not chat_limiter.is_allowed(ip, custom_max=custom_rate):
        raise HTTPException(status_code=429, detail="Too many requests.")
    groq = get_groq_client(tenant)
    name = get_assistant_name(tenant)
    product_context = format_products_context(tenant)

    # Build system prompt (lean — every token costs latency)
    rag_instance = get_rag(tenant)
    custom_prompt = (tenant or {}).get("custom_system_prompt", "")
    if custom_prompt and custom_prompt.strip():
        try:
            system_instruction = custom_prompt.format(product_context=product_context, name=name)
        except KeyError:
            system_instruction = custom_prompt.replace("{product_context}", product_context).replace("{name}", name)
    else:
        system_instruction = build_system_prompt(tenant, name, product_context)

    # Append brief brand context from RAG (if available)
    if rag_instance and rag_instance.ready:
        brand_context = rag_instance.get_brand_context()
        if brand_context:
            system_instruction += f"\n== STORE INFO ==\n{brand_context}\n"

    llm_model = (tenant or {}).get("llm_model") or "llama-3.3-70b-versatile"
    max_tokens = (tenant or {}).get("max_tokens") or 150
    temperature = (tenant or {}).get("temperature") or 0.72

    # Keep only last 6 messages (less tokens = faster response)
    filtered = [m for m in body.messages if m.role != "system"]
    messages_for_api = [{"role": "system", "content": system_instruction}]

    cleaned = []
    last_user_msg = ""
    for m in filtered[-6:]:
        d = m.dict()
        if d["role"] == "user" and d["content"].strip() == "__INIT__":
            d["content"] = "[New visitor. Greet warmly, ask their name.]"
        elif d["role"] == "user" and d["content"].startswith("__RETURNING__:"):
            info = d["content"].replace("__RETURNING__:", "").strip()
            d["content"] = f"[Returning visitor. {info}. Greet by name, be helpful.]"
        if d["role"] == "user":
            last_user_msg = d["content"]
        cleaned.append(d)

    # Per-query RAG (top 2 results — fast and focused)
    if rag_instance and rag_instance.ready and last_user_msg and not last_user_msg.startswith("["):
        rag_context = rag_instance.search_for_chat(last_user_msg, top_k=2)
        if rag_context:
            messages_for_api.append({
                "role": "system",
                "content": f"== WEBSITE KNOWLEDGE ==\n{rag_context}"
            })

    messages_for_api.extend(cleaned)

    # ── Streaming mode: send tokens as SSE for instant display ──
    if body.stream:
        def stream_generator():
            full_reply = []
            try:
                stream_resp = groq.chat.completions.create(
                    model=llm_model,
                    messages=messages_for_api,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    stream=True,
                )
                for chunk in stream_resp:
                    delta = chunk.choices[0].delta
                    if delta and delta.content:
                        full_reply.append(delta.content)
                        yield f"data: {json.dumps({'token': delta.content})}\n\n"
                # Final event with complete response
                complete = ''.join(full_reply)
                yield f"data: {json.dumps({'done': True, 'response': complete})}\n\n"
                log_conversation(ip, cleaned, body.user_language, complete, body.store_id)
            except Exception as e:
                logger.error(f"Stream error: {e}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return StreamingResponse(stream_generator(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # ── Non-streaming mode (fallback) ──
    try:
        response = groq.chat.completions.create(
            model=llm_model,
            messages=messages_for_api,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        reply = response.choices[0].message.content
        log_conversation(ip, cleaned, body.user_language, reply, body.store_id)
        return {"response": reply}
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail="Chat failed.")


@app.post("/api/sync-voice")
async def sync_voice(body: SyncVoiceRequest, x_store_id: Optional[str] = Header(None)):
    """Sync voice settings from WP admin to backend store record."""
    tenant = resolve_tenant(x_store_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Store not found")
    updates = {}
    if body.tts_voice: updates["tts_voice"] = body.tts_voice
    if body.tts_rate: updates["tts_rate"] = body.tts_rate
    if body.tts_pitch: updates["tts_pitch"] = body.tts_pitch
    if updates:
        update_store(tenant["store_id"], updates)
    return {"status": "ok", "updated": list(updates.keys())}


@app.get("/api/refresh-products")
async def refresh_products_endpoint(request: Request, user: dict = Depends(get_current_user)):
    """Refresh product cache — requires admin auth."""
    fetch_products()
    return {"status": "success", "count": len(cached_products)}

@app.get("/api/reindex")
async def reindex_endpoint(request: Request, user: dict = Depends(get_current_user)):
    """Trigger RAG reindex — requires admin auth."""
    if rag:
        threading.Thread(target=rag.reindex, daemon=True).start()
    return {"status": "reindexing"}

@app.get("/api/status")
async def status_endpoint(x_store_id: Optional[str] = Header(None)):
    tenant = resolve_tenant(x_store_id)
    if tenant:
        rag_inst = get_rag(tenant)
        products = get_products(tenant)
        return {
            "rag_ready": rag_inst.ready if rag_inst else False,
            "pages_indexed": len(rag_inst.pages) if rag_inst else 0,
            "products_loaded": len(products),
            "tts_available": True,
            "assistant_name": tenant.get("assistant_name", "Mark"),
            "store_config": {
                "assistant_name": tenant.get("assistant_name", "Mark"),
                "personality": tenant.get("personality", "friendly"),
                "greeting_style": tenant.get("greeting_style", "casual"),
                "languages": json.loads(tenant.get("supported_languages", '["en"]')),
                "primary_language": tenant.get("primary_language", "en"),
                "idle_timeout": tenant.get("idle_timeout", 10),
                "walking_enabled": bool(tenant.get("walking_enabled", 1)),
                "sound_effects": bool(tenant.get("sound_effects", 1)),
            },
        }

    return {
        "rag_ready": rag.ready if rag else False,
        "pages_indexed": len(rag.pages) if rag else 0,
        "products_loaded": len(cached_products),
        "tts_available": True,
        "assistant_name": STORE_CONFIG.get("assistant_name", "Mark"),
        "store_config": STORE_CONFIG,
    }


@app.get("/api/tts/voices")
async def list_tts_voices():
    try:
        voices = await edge_tts.list_voices()
        simplified = []
        for v in voices:
            simplified.append({
                "id": v["ShortName"],
                "name": v["FriendlyName"],
                "language": v["Locale"],
                "gender": v["Gender"],
            })
        return {"voices": simplified}
    except Exception as e:
        return {"voices": [], "error": str(e)}


@app.get("/api/analytics")
async def analytics_endpoint(limit: int = 50, offset: int = 0):
    # Clamp limit to max 100
    limit = max(1, min(limit, 100))
    offset = max(0, offset)

    log_dir = Path(LOG_DIR)
    if not log_dir.exists():
        return {"total_conversations": 0, "today": 0, "languages": {}, "recent_questions": [],
                "limit": limit, "offset": offset}

    today_str = datetime.now().strftime('%Y-%m-%d')
    today_count = 0
    total_count = 0
    languages = defaultdict(int)
    recent_questions = []

    for log_file in sorted(log_dir.glob("*.jsonl")):
        try:
            with open(log_file, "r", encoding="utf-8") as f:
                for line in f:
                    entry = json.loads(line.strip())
                    total_count += 1
                    languages[entry.get("language", "en")] += 1
                    if log_file.name == f"{today_str}.jsonl":
                        today_count += 1
                        if entry.get("last_user_msg"):
                            recent_questions.append(entry["last_user_msg"][:100])
        except Exception:
            continue

    # Paginate recent_questions: return only the requested slice, capped at limit
    paginated_questions = recent_questions[offset:offset + limit]

    return {
        "total_conversations": total_count,
        "today": today_count,
        "languages": dict(languages),
        "recent_questions": paginated_questions,
        "limit": limit,
        "offset": offset,
        "total_questions": len(recent_questions),
    }


# ── Memory & Health Monitoring ────────────────────────────────

@app.get("/api/health")
async def health_endpoint():
    """Detailed health check with memory stats."""
    with _rag_lock:
        rag_stats = {
            sid: {
                "ready": inst.ready,
                "pages": len(inst.pages),
                "memory_mb": inst.memory_estimate_mb(),
            }
            for sid, inst in _rag_instances.items()
        }

    return {
        "status": "healthy",
        "rag_instances": len(_rag_instances),
        "rag_limit": MAX_RAG_INSTANCES,
        "product_caches": len(_tenant_products),
        "product_limit": MAX_PRODUCT_CACHES,
        "default_rag_ready": rag.ready if rag else False,
        "rag_details": rag_stats,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
