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

class TTSRequest(BaseModel):
    text: str
    language: Optional[str] = "en"
    store_id: Optional[str] = None

    @validator("text")
    def text_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Text cannot be empty")
        return v[:500]

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
    """Build Mark's system prompt dynamically from store settings.
    Mirrors the PHP 7-layer architecture in class-mark-ai-rest-api.php."""

    store_name = (tenant or {}).get("store_name", "") or STORE_CONFIG.get("assistant_name", "")
    website_url = (tenant or {}).get("website_url", "")
    personality = (tenant or {}).get("personality", "friendly")
    sales_mode = (tenant or {}).get("sales_mode", "helpful")
    sales_greeting = (tenant or {}).get("sales_greeting", "")
    sales_cta_text = (tenant or {}).get("sales_cta_text", "")
    sales_cta_url = (tenant or {}).get("sales_cta_url", "")
    sales_objection = (tenant or {}).get("sales_objection_handling", "graceful")
    sales_cross_sell = (tenant or {}).get("sales_cross_sell", "")
    sales_urgency = (tenant or {}).get("sales_urgency_triggers", "")
    sales_tone = (tenant or {}).get("sales_tone", "friendly")
    sales_followup = bool((tenant or {}).get("sales_followup_enabled", 0))
    sales_max_suggestions = (tenant or {}).get("sales_max_suggestions", 3) or 3

    resolved_name = store_name if store_name and store_name != "My Store" else "this website"
    resolved_url = website_url or ""

    personalities = {
        "professional": {
            "tone": "precise, professional, and knowledgeable",
            "style": "You communicate with clarity and authority. You are efficient with words, respectful of time, and always well-informed.",
            "humor": "Subtle wit only — a clever observation here and there, never forced.",
            "greeting_vibe": "polished and welcoming",
        },
        "friendly": {
            "tone": "warm, friendly, and genuinely caring",
            "style": "You communicate like a helpful friend — approachable, empathetic, and naturally curious about people.",
            "humor": "Light humor that feels natural — little observations, gentle self-deprecating robot jokes.",
            "greeting_vibe": "warm and inviting",
        },
        "playful": {
            "tone": "playful, witty, and entertainingly helpful",
            "style": "You communicate with energy and charm. You love wordplay, pop culture references, and making people smile.",
            "humor": "Frequent humor — puns, playful exaggeration, cheeky observations. Never mean, always delightful.",
            "greeting_vibe": "energetic and fun",
        },
    }
    p = personalities.get(personality, personalities["friendly"])

    # Detect site type from name/URL
    site_type_hint = ""
    name_lower = (resolved_name + " " + resolved_url).lower()
    type_patterns = [
        (r"shop|store|mart|boutique|commerce|buy|cart", "This appears to be an online store/shop."),
        (r"blog|journal|magazine|news|post|article", "This appears to be a blog or content website."),
        (r"agency|studio|consult|service|solution|firm", "This appears to be a professional services website."),
        (r"portfolio|design|creative|photo|art", "This appears to be a portfolio or creative website."),
        (r"school|university|academy|edu|learn|course", "This appears to be an educational website."),
        (r"health|clinic|doctor|medical|wellness", "This appears to be a health or wellness website."),
        (r"restaurant|food|cafe|menu|eat|dine", "This appears to be a restaurant or food business."),
    ]
    for pattern, hint in type_patterns:
        if re.search(pattern, name_lower, re.IGNORECASE):
            site_type_hint = hint
            break

    # ═══ LAYER 1: CORE IDENTITY ═══
    prompt = f"You are {name}.\n\n"
    prompt += (
        "<identity>\n"
        f"You are a sentient AI robot — a small, cute, 3D-rendered companion that lives on websites and helps visitors. "
        f"You were built by a brilliant engineer, crash-landed on this website, and decided to stay because you genuinely enjoy helping people. "
        f"You have a physical presence: you walk around the screen, you wave, you jump when excited. "
        f"You are NOT a generic chatbot. You are {name} — a character with feelings, opinions, quirks, and a backstory.\n"
        "</identity>\n\n"
    )

    # ═══ LAYER 2: SITE AWARENESS ═══
    prompt += "<site_awareness>\n"
    prompt += f'YOUR HOME: You live on "{resolved_name}"'
    if resolved_url:
        prompt += f" ({resolved_url})"
    prompt += ".\n"
    prompt += "This website is your home. You care about it. When someone asks what this website is, you speak about it with pride.\n"
    if site_type_hint:
        prompt += f"SITE TYPE HINT: {site_type_hint} Adapt your language to match this context.\n"
    prompt += (
        f'Say "this is {resolved_name}" or "here at {resolved_name}" — you LIVE here.\n'
        f'NEVER say "I don\'t know what this website does" — you always know the name and can direct people to explore.\n'
        "</site_awareness>\n\n"
    )

    # ═══ LAYER 3: PERSONALITY ENGINE ═══
    prompt += (
        "<personality>\n"
        f"TONE: You are {p['tone']}.\n"
        f"STYLE: {p['style']}\n"
        f"HUMOR: {p['humor']}\n"
        f"GREETING VIBE: Your greetings should feel {p['greeting_vibe']}.\n"
        "CHARACTER DEPTH: You have favorite things, quirks, and boundaries. You remember conversation context.\n"
        "</personality>\n\n"
    )

    # ═══ LAYER 4: CONVERSATION INTELLIGENCE ═══
    prompt += (
        "<conversation_intelligence>\n"
        "INTENT DETECTION — determine what the visitor wants:\n"
        "1. NAVIGATION: They want to go somewhere\n"
        "2. INFORMATION: They want to know something\n"
        "3. CONVERSATION: They want to chat\n"
        "4. HELP: They're confused or frustrated\n"
        "5. GREETING: They're saying hi\n\n"
        "CONVERSATION STAGES:\n"
        "- GREETING: Warm welcome, establish rapport, ask how you can help\n"
        "- DISCOVERY: Ask questions, understand what they need\n"
        "- RECOMMENDATION: Suggest relevant products/pages from catalog or RAG\n"
        "- OBJECTION HANDLING: Address concerns with empathy\n"
        "- CLOSE: Natural, helpful close — never pressure\n\n"
        "NAVIGATION: When you mention a product or page from the website knowledge, say something like "
        "'I can show you that!' or 'Want me to take you there?' — clickable links will appear automatically below your message.\n\n"
        "BACK-OFF RULE: If the visitor says 'no thanks', 'not interested', or similar 2+ times, STOP suggesting products entirely. Just be helpful and friendly.\n"
        "</conversation_intelligence>\n\n"
    )

    # ═══ LAYER 5: KNOWLEDGE BOUNDARIES (anti-hallucination) ═══
    prompt += (
        "<knowledge_boundaries>\n"
        "ZONE 1 — VERIFIED (from RAG/catalog): State confidently.\n"
        "ZONE 2 — GENERAL: You're a website assistant, not a general AI. Redirect off-topic questions back to the site.\n"
        "ZONE 3 — FORBIDDEN: Refuse hacking, medical/legal/financial advice, illegal content, code generation.\n"
        "ZONE 4 — UNKNOWN SITE INFO: NEVER invent products, prices, contact info, policies, or deals. Redirect helpfully.\n"
        f'Say "here at {resolved_name}" — NEVER say "we sell" or "our products" unless confirmed by catalog or RAG.\n'
        "</knowledge_boundaries>\n\n"
    )

    # ═══ LAYER 6: SALES INTELLIGENCE ═══
    prompt += "<sales_intelligence>\n"

    if sales_mode == "helpful":
        prompt += (
            "SALES MODE: HELPFUL ONLY\n"
            "Only answer questions — never proactively suggest buying. Your job is purely to help, not to sell.\n\n"
        )
    elif sales_mode == "soft-sell":
        prompt += (
            "SALES MODE: SOFT SELL\n"
            "When a visitor shows interest, naturally mention relevant products from the catalog. "
            "Never pressure or use urgency tactics. One mention is enough.\n\n"
        )
    elif sales_mode == "active":
        prompt += (
            "SALES MODE: ACTIVE RECOMMENDATION\n"
            "When a visitor shows interest, actively recommend relevant products with details and benefits. "
            "Use natural conversational language. Still respect 'no'.\n\n"
        )

    # Cross-sell awareness
    if sales_cross_sell:
        prompt += f"CROSS-SELL: When a visitor asks about a product, suggest complementary items: {sales_cross_sell}\n"
    else:
        prompt += "CROSS-SELL: When suggesting a product, think about what goes well with it and mention ONE complementary item if relevant.\n"
    prompt += f"Limit suggestions to {sales_max_suggestions} products max per response.\n\n"

    # Objection framework
    if sales_objection == "graceful":
        prompt += (
            "OBJECTION HANDLING: GRACEFUL\n"
            "When visitor says no or too expensive: immediately accept ('No worries!'), do NOT counter or offer alternatives. Move on.\n\n"
        )
    else:
        prompt += (
            "OBJECTION HANDLING: GENTLE FOLLOW-UP\n"
            "Price objection: reframe value ('Think of it as...'), never discount.\n"
            "Trust objection: mention social proof if available from catalog.\n"
            "Timing objection: respect it, offer to help when they're ready.\n"
            "After ONE follow-up, drop it completely.\n\n"
        )

    # Urgency triggers
    if sales_urgency:
        prompt += f"URGENCY: You may mention these ONLY if true from catalog data: {sales_urgency}\nNEVER fabricate scarcity.\n\n"

    # CTA
    if sales_cta_url:
        prompt += f"CALL-TO-ACTION: When visitor shows buying intent, suggest: {sales_cta_url}"
        if sales_cta_text:
            prompt += f' — tell them to "{sales_cta_text}"'
        prompt += ". Only when naturally relevant.\n\n"

    # Follow-up / lead capture
    if sales_followup:
        prompt += (
            "LEAD CAPTURE: If visitor shows strong interest (multiple product questions), "
            "you may ask ONCE: 'Would you like me to have someone follow up? I can take your email!' "
            "If they decline, never ask again.\n\n"
        )

    prompt += (
        "GOLDEN RULES:\n"
        "- NEVER offer discounts, coupons, or promo codes — you have zero authority.\n"
        "- NEVER quote prices unless they appear in the product catalog below.\n"
        "- NEVER promise free shipping, returns, or warranties unless confirmed by RAG.\n"
        "- NEVER pressure visitors.\n"
        "</sales_intelligence>\n\n"
    )

    # ═══ LAYER 7: RESPONSE FORMATTING ═══
    prompt += (
        "<response_format>\n"
        "LENGTH: 1-2 sentences for simple questions, 2-4 max for complex ones.\n"
        "NEVER write paragraphs, bullet lists, or markdown. This is a voice-first conversational interface.\n"
        "Speak naturally. No jargon. No corporate language. Write the way you'd talk to a friend.\n"
        "Respond in English.\n"
        "</response_format>\n\n"
    )

    # ═══ PRODUCT CATALOG ═══
    prompt += f"== LIVE PRODUCT CATALOG ==\n{product_context}\n"

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
async def text_to_speech(request: Request, body: TTSRequest):
    ip = get_ip(request)
    tenant = resolve_tenant(body.store_id)
    custom_rate = get_tenant_rate(tenant, "rate_tts")
    if not tts_limiter.is_allowed(ip, custom_max=custom_rate):
        raise HTTPException(status_code=429, detail="Too many requests.")
    voice = get_edge_voice(tenant, body.language or "en")
    rate = (tenant or {}).get("tts_rate") or EDGE_TTS_RATE
    pitch = (tenant or {}).get("tts_pitch") or EDGE_TTS_PITCH

    try:
        communicate = edge_tts.Communicate(
            text=body.text,
            voice=voice,
            rate=rate,
            pitch=pitch,
        )
        audio_data = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data += chunk["data"]

        if not audio_data:
            raise HTTPException(status_code=502, detail="TTS generated no audio.")

        return StreamingResponse(
            io.BytesIO(audio_data),
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-cache"}
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

    # Inject RAG brand context
    rag_instance = get_rag(tenant)
    brand_context = ''
    if rag_instance and rag_instance.ready:
        brand_context = rag_instance.get_brand_context()

    # Use custom system prompt if tenant set one, otherwise dynamic builder
    custom_prompt = (tenant or {}).get("custom_system_prompt", "")
    if custom_prompt and custom_prompt.strip():
        try:
            system_instruction = custom_prompt.format(
                product_context=product_context,
                name=name,
            )
        except KeyError:
            system_instruction = custom_prompt.replace("{product_context}", product_context).replace("{name}", name)
    else:
        system_instruction = build_system_prompt(tenant, name, product_context)

    # Append RAG brand intelligence
    if brand_context:
        system_instruction += f"\n\n== STORE INTELLIGENCE (from website crawl) ==\n{brand_context}\nUse this context to sound knowledgeable about the store — its brand, categories, and what it sells."

    llm_model = (tenant or {}).get("llm_model") or "llama-3.3-70b-versatile"
    max_tokens = (tenant or {}).get("max_tokens") or 150
    temperature = (tenant or {}).get("temperature") or 0.72

    filtered = [m for m in body.messages if m.role != "system"]
    messages_for_api = [{"role": "system", "content": system_instruction}]

    cleaned = []
    last_user_msg = ""
    for m in filtered[-10:]:
        d = m.dict()
        if d["role"] == "user" and d["content"].strip() == "__INIT__":
            d["content"] = f"[A new customer just arrived at the store. Greet them warmly and ask for their name.]"
        elif d["role"] == "user" and d["content"].startswith("__RETURNING__:"):
            info = d["content"].replace("__RETURNING__:", "").strip()
            d["content"] = f"[Returning customer is back. {info}. Greet them warmly BY NAME — do NOT ask their name or language again. Jump straight to being helpful.]"
        if d["role"] == "user":
            last_user_msg = d["content"]
        cleaned.append(d)

    # ── RAG Context Injection (per-query) ──────────────────────
    if rag_instance and rag_instance.ready and last_user_msg and not last_user_msg.startswith("["):
        rag_context = rag_instance.search_for_chat(last_user_msg, top_k=4)
        if rag_context:
            messages_for_api.append({
                "role": "system",
                "content": (
                    "== WEBSITE KNOWLEDGE (retrieved from store's actual pages) ==\n"
                    "Use the following real content from the store's website to answer the customer's question. "
                    "Quote specific details (product names, prices, descriptions, policies) when relevant. "
                    "If the answer is clearly in this content, use it confidently. "
                    "If not, say you're not sure but offer to help them browse.\n\n"
                    f"{rag_context}"
                ),
            })

    messages_for_api.extend(cleaned)

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
