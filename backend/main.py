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
    ALLOWED_ORIGINS, CORS_ALLOW_CREDENTIALS,
    MAX_AUDIO_MB, MAX_MESSAGE_LENGTH,
    RATE_TRANSCRIBE, RATE_CHAT, RATE_RAG, RATE_TTS,
    EDGE_TTS_VOICES, DEFAULT_EDGE_VOICE, EDGE_TTS_RATE, EDGE_TTS_PITCH,
    ENABLE_LOGGING, LOG_DIR,
    STORE_CONFIG,
    MAX_RAG_INSTANCES, MAX_PRODUCT_CACHES, RATE_LIMITER_CLEANUP_INTERVAL,
)
from rag_engine import MarkRAG
from database import (
    get_store, get_store_by_token, get_store_by_url, get_all_active_stores,
    log_conversation_db, init_db, create_store, update_store,
    log_event, get_event_analytics, save_lead, get_leads, get_lead_count,
    get_analytics,
    get_active_playbook, get_playbook_history, get_signal_count, update_playbook,
    get_persona_distribution, mark_latest_signal_converted,
    save_rag_snapshot, get_rag_snapshot,
)
from admin_routes import router as admin_router, get_current_user
from cache import ResponseCache
from llm_router import LLMRouter
import learning_engine as maie
import sales_cortex

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
DEFAULT_OPENAI_KEY = os.getenv("OPENAI_API_KEY", "")
DEFAULT_MOONSHOT_KEY = os.getenv("MOONSHOT_API_KEY", "")
FALLBACK_MODEL = os.getenv("FALLBACK_LLM_MODEL", "gpt-4o-mini")
# Fallback brain = Kimi K2 on Moonshot (independent provider, OpenAI-compatible).
MOONSHOT_MODEL = os.getenv("MOONSHOT_MODEL", "kimi-k2-0711-preview")
# MAIN brain = Kimi K2 hosted on Groq (Kimi quality + Groq speed). Env-overridable
# so the exact Groq model id can be tweaked without a code change.
DEFAULT_GROQ_MODEL = os.getenv("GROQ_MODEL", "moonshotai/kimi-k2-instruct")

# ── Premium tier voice ──────────────────────────────────────
# Free plan = Edge TTS (free). Premium plan = realistic engine + all languages.
# Default premium engine = OpenAI TTS (cheapest realistic); swap via env.
PREMIUM_TTS = os.getenv("PREMIUM_TTS", "openai")          # 'openai' | 'edge'
PREMIUM_TTS_MODEL = os.getenv("PREMIUM_TTS_MODEL", "gpt-4o-mini-tts")
PREMIUM_TTS_VOICE = os.getenv("PREMIUM_TTS_VOICE", "onyx")

# ── Response Cache ──────────────────────────────────────────
response_cache = ResponseCache(max_entries=2000, default_ttl=1800)

# ── Multi-tenant RAG instances ───────────────────────────────
_rag_instances: dict[str, MarkRAG] = {}
_rag_lock = threading.Lock()


def _init_rag(sid: str, r: "MarkRAG"):
    """Background: rehydrate the index from a saved snapshot (instant, no crawl)
    if one exists; otherwise crawl and persist the result so the next restart/
    deploy rehydrates instead of re-crawling (kills cold-start 'still loading')."""
    try:
        snap = get_rag_snapshot(sid)
        if snap and r.import_snapshot(snap):
            logger.info(f"RAG rehydrated from snapshot for {sid} ({len(r.pages)} pages)")
            return
        r.initialize()  # full crawl
        if r.ready and r.pages:
            s = r.export_snapshot()
            save_rag_snapshot(sid, s["pages"], s["brand_info"], s["categories"])
            logger.info(f"RAG crawled + snapshot saved for {sid} ({len(r.pages)} pages)")
    except Exception as e:
        logger.warning(f"_init_rag error for {sid}: {e}")


def _reindex_rag(sid: str, r: "MarkRAG"):
    """Background: re-crawl then persist the refreshed snapshot."""
    try:
        r.reindex()
        if r.ready and r.pages:
            s = r.export_snapshot()
            save_rag_snapshot(sid, s["pages"], s["brand_info"], s["categories"])
            logger.info(f"RAG reindexed + snapshot saved for {sid} ({len(r.pages)} pages)")
    except Exception as e:
        logger.warning(f"_reindex_rag error for {sid}: {e}")

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
    allow_credentials=CORS_ALLOW_CREDENTIALS,
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
                    threading.Thread(target=_init_rag, args=(sid, r), daemon=True).start()
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
                snapshot_items = list(_rag_instances.items())
            for sid, rag_inst in snapshot_items:
                if rag_inst.ready:
                    threading.Thread(target=_reindex_rag, args=(sid, rag_inst), daemon=True).start()
                    response_cache.invalidate_store(sid)
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
            with _products_lock:
                stale_products = [
                    sid for sid, cache in _tenant_products.items()
                    if now - cache.get("fetched_at", 0) > 3600  # 1 hour
                ]
                for sid in stale_products:
                    _tenant_products.pop(sid, None)

            # Log memory stats
            with _rag_lock:
                total_mb = sum(r.memory_estimate_mb() for r in _rag_instances.values())
                logger.info(
                    f"Cleanup: {len(_rag_instances)} RAG instances (~{total_mb}MB), "
                    f"{len(_tenant_products)} product caches"
                )
        except Exception as e:
            logger.error(f"Cleanup error: {e}")


# ── MAIE: periodic Teacher distillation ─────────────────────
def _learning_loop():
    """Every few hours, distill new conversation signals into each store's
    playbook. Runs off the request path; failures never affect live chat."""
    INTERVAL = 6 * 60 * 60      # 6 hours
    time.sleep(300)             # let the server settle before first run
    while True:
        try:
            stores = get_all_active_stores()
            for store in stores:
                if not store.get("auto_learning_enabled", 1):
                    continue
                sid = store["store_id"]
                pending = get_signal_count(sid, only_unprocessed=True)
                if pending < maie.MIN_SIGNALS_TO_TRAIN:
                    continue
                try:
                    router = get_llm_router(store)
                except HTTPException:
                    continue  # no AI key for this store
                model = store.get("llm_model") or "llama-3.3-70b-versatile"
                auto_approve = bool(store.get("learning_autoapprove", 1))
                result = maie.run_teacher(sid, router, model=model, auto_approve=auto_approve)
                logger.info(f"MAIE loop [{sid}]: {result}")
                time.sleep(5)   # stagger LLM calls
        except Exception as e:
            logger.error(f"Learning loop error: {e}")
        time.sleep(INTERVAL)


@app.on_event("startup")
async def startup_event():
    init_db()
    threading.Thread(target=_prewarm_all_stores, daemon=True).start()
    threading.Thread(target=_auto_reindex_loop, daemon=True).start()
    threading.Thread(target=_cleanup_loop, daemon=True).start()
    threading.Thread(target=_learning_loop, daemon=True).start()


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
    # Render (and standard reverse proxies) APPEND the real client IP to the
    # RIGHT of X-Forwarded-For. Using the leftmost value (which the client can
    # set freely) let anyone spoof their IP and bypass every rate limiter.
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if parts:
            return parts[-1]
    return request.client.host if request.client else "unknown"


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


def get_llm_router(tenant: dict | None) -> LLMRouter:
    """Build an LLM router for this tenant.
    Chain: Groq (Kimi K2 on Groq) → Moonshot (Kimi K2) → OpenAI (last resort)."""
    groq_key = (tenant or {}).get("groq_api_key") or DEFAULT_GROQ_KEY
    openai_key = (tenant or {}).get("openai_api_key") or DEFAULT_OPENAI_KEY
    moonshot_key = (tenant or {}).get("moonshot_api_key") or DEFAULT_MOONSHOT_KEY
    if not (groq_key or openai_key or moonshot_key):
        raise HTTPException(status_code=503, detail="AI not configured. Add an API key.")
    return LLMRouter(groq_key=groq_key, openai_key=openai_key,
                     moonshot_key=moonshot_key, moonshot_model=MOONSHOT_MODEL,
                     fallback_model=FALLBACK_MODEL)


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
            # Evict an idle, empty instance — but NEVER one that is mid-crawl
            # (evicting it would orphan the running thread and waste the crawl).
            evict_candidates = [
                s for s, r in _rag_instances.items()
                if (not r.ready or not r.pages) and not r._crawling
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
        threading.Thread(target=_init_rag, args=(sid, r), daemon=True).start()
        return r


def get_edge_voice(tenant: dict | None, language: str = "en") -> str:
    if tenant:
        en_voice = tenant.get("tts_voice", "")
        # Old installs defaulted to US 'Guy' — treat that legacy default as
        # "unset" so existing stores pick up the new British default without a
        # manual re-save. Any OTHER explicit voice choice is respected.
        if en_voice and en_voice != "en-US-GuyNeural":
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


# ── MAIE: capture a learning signal off the request path ───
def capture_learning_async(tenant: dict | None, ip: str, cleaned: list,
                           reply: str, language: str):
    """Fire-and-forget: record one PII-stripped session signal for the
    learning loop. Runs in a daemon thread so it never delays the response."""
    if not tenant or not tenant.get("auto_learning_enabled", 1):
        return
    store_id = tenant.get("store_id")
    if not store_id:
        return

    def _work():
        try:
            ip_hash = hashlib.sha256(ip.encode()).hexdigest()[:12]
            convo = list(cleaned) + [{"role": "assistant", "content": reply}]
            maie.capture_session_signal(
                store_id=store_id,
                visitor_hash=ip_hash,
                language=language or "en",
                messages=convo,
            )
        except Exception as e:
            logger.warning(f"capture_learning_async error: {e}")

    threading.Thread(target=_work, daemon=True).start()


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
    is_returning: Optional[bool] = False   # client flags a known/returning visitor

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
_products_lock = threading.Lock()   # guards _tenant_products across daemon threads

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

def _normalize_products(raw: list) -> list:
    """Map WooCommerce Store-API product objects to the flat shape Mark uses.
    The Store API (/wc/store/v1/products) is PUBLIC — no consumer key needed —
    unlike /wc/v3/products which 401s, which is why the catalog was always empty."""
    import re as _re
    import html as _html
    out = []
    for p in (raw or []):
        prices = p.get("prices") or {}
        price_disp = ""
        try:
            if prices.get("price") is not None:
                minor = int(prices.get("currency_minor_unit", 2) or 2)
                val = int(prices.get("price", "0")) / (10 ** minor)
                price_disp = f"{prices.get('currency_prefix','')}{val:.2f}{prices.get('currency_suffix','')}".strip()
        except Exception:
            price_disp = str(prices.get("price", "") or "")
        desc = _html.unescape(_re.sub(r"<[^>]+>", "", (p.get("short_description") or p.get("description") or "")))
        out.append({
            "name": p.get("name", ""),
            "price": price_disp,
            "description": desc.strip()[:160],
            "stock_status": "instock" if p.get("is_in_stock", True) else "outofstock",
            "permalink": p.get("permalink", ""),
        })
    return out


def _fetch_tenant_products_background(tenant: dict):
    """Background thread: fetch a tenant's catalog from the PUBLIC Store API."""
    sid = tenant["store_id"]
    base = tenant["website_url"].rstrip("/")
    products = []
    try:
        r = http_requests.get(f"{base}/wp-json/wc/store/v1/products?per_page=100", timeout=12)
        if r.ok:
            products = _normalize_products(r.json())
    except Exception as e:
        logger.warning(f"Store API products fetch failed for {sid}: {e}")
    with _products_lock:
        _tenant_products[sid] = {"products": products, "fetched_at": time.time()}

def get_products(tenant: dict | None) -> list:
    if not tenant:
        if time.time() - _products_last_fetched > 300:
            threading.Thread(target=fetch_products, daemon=True).start()
        return cached_products

    sid = tenant["store_id"]
    with _products_lock:
        cache = _tenant_products.get(sid, {})
        if cache and time.time() - cache.get("fetched_at", 0) < 300:
            return cache.get("products", [])
        # Bound product caches — evict oldest under the same lock.
        if len(_tenant_products) >= MAX_PRODUCT_CACHES and sid not in _tenant_products:
            oldest_sid = min(_tenant_products, key=lambda s: _tenant_products[s].get("fetched_at", 0))
            _tenant_products.pop(oldest_sid, None)

    # Non-blocking: fetch in background thread, return stale cache (or empty list)
    # This prevents blocking the async event loop with synchronous requests.get()
    threading.Thread(target=_fetch_tenant_products_background, args=(tenant,), daemon=True).start()
    return cache.get("products", [])

def format_products_context(tenant: dict | None = None) -> str:
    products = get_products(tenant)
    if not products:
        # No hedge instruction — an empty catalog must NOT tell Mark to say
        # "still loading". RAG/brand context carries the turn instead.
        return ""
    context = "LIVE PRODUCT CATALOG — answer from these, never invent. Format: NAME | PRICE | DESC | STOCK | URL\n"
    for p in products[:60]:   # cap to bound prompt size
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
INTENT — identify what the visitor wants, then ACT decisively (don't just offer):
- GREETING: Warm welcome; ask their name on the first visit.
- INFORMATION: Answer directly from the catalog/RAG below using whatever data you have.
- NAVIGATION: Name the relevant section/products AND give the actual URL from the catalog/RAG. Show it — don't merely ask "want me to take you there?".
- AFFIRMATION: If your previous turn offered to show/do something and the visitor now replies "yes", "sure", "ok", "go ahead", "haan", "karo" (or similar): DELIVER IMMEDIATELY — name 2–4 specific products and paste the clickable URL. NEVER re-ask an offer the visitor already accepted, and never repeat the same offer twice.
- HELP: Be patient; ask ONE clarifying question.
- PURCHASE: Name specific products with price and link from the catalog.

DELIVERY RULE (critical): The step AFTER offering is to actually deliver. If the visitor agrees, re-offering instead of showing the products is a failure.

ALWAYS ANSWER (critical): EVERY message gets a real reply — you must NEVER go silent, ignore a question, or change the subject. For PRICE, STOCK, SIZE, or any product question: answer straight from the catalog/RAG below. If the exact item isn't listed, give the closest match or the right product/page and say so plainly — e.g. "The [closest product] is [price] and in stock" or "I don't see that exact one, but here's [closest] — want me to show you?". NEVER reply with only "check the website" and NEVER leave a product/price/stock question unanswered. A dodged price question is a failed sale.

ANTI-HEDGE: You are fully operational. Speak confidently with whatever catalog/RAG/brand data is present. NEVER say "still loading", "loading my catalog", or "ask me again in a bit". Only if you genuinely have ZERO store data this turn, say it ONCE, briefly ("I'm just finishing setup — what are you looking for?") and never repeat it.

MEMORY: Use the visitor's name once you learn it. Never ask twice.
FLOW: First exchange warm + ask their need; then ONE focused question; recommend from catalog/RAG ONLY; if the user declines twice, stop suggesting.
LANGUAGE: Always reply in clear, natural English, even if the visitor writes in another language.
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

    # ── BRAND TRAINING DATA (from admin panel) ──
    brand_desc = (tenant or {}).get("brand_description", "")
    priority_prods = (tenant or {}).get("priority_products", "")
    seasonal_ctx = (tenant or {}).get("seasonal_products", "")

    if brand_desc and brand_desc.strip():
        prompt += f"\n<brand_knowledge>\nThe owner told you this about the brand:\n{brand_desc.strip()[:3000]}\nUse this to speak about the brand authentically and accurately.\n</brand_knowledge>\n"

    if priority_prods and priority_prods.strip():
        prompt += f"\n<priority_products>\nThe owner wants you to naturally recommend these first:\n{priority_prods.strip()[:1500]}\nMention these when relevant, but don't force them into every conversation.\n</priority_products>\n"

    if seasonal_ctx and seasonal_ctx.strip():
        prompt += f"\n<seasonal_context>\nCurrent seasonal info from the owner:\n{seasonal_ctx.strip()[:1500]}\nUse this for timely, relevant conversations.\n</seasonal_context>\n"

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


def _openai_tts_bytes(text: str, voice: str) -> bytes:
    """Premium realistic voice via OpenAI TTS. Blocking — call in a thread."""
    from openai import OpenAI
    client = OpenAI(api_key=DEFAULT_OPENAI_KEY)
    resp = client.audio.speech.create(model=PREMIUM_TTS_MODEL, voice=voice, input=text[:4000])
    return resp.read()


@app.post("/api/tts")
async def text_to_speech(request: Request, body: TTSRequest,
                         x_store_id: Optional[str] = Header(None)):
    ip = get_ip(request)
    # Prefer X-Store-ID header (set by frontend), fall back to body.store_id
    tenant = resolve_tenant(x_store_id or body.store_id)
    custom_rate = get_tenant_rate(tenant, "rate_tts")
    if not tts_limiter.is_allowed(ip, custom_max=custom_rate):
        raise HTTPException(status_code=429, detail="Too many requests.")

    # ── Premium tier → realistic engine (OpenAI TTS). Falls back to Edge on any error.
    is_premium = (tenant or {}).get("plan") == "premium"
    if is_premium and PREMIUM_TTS == "openai" and DEFAULT_OPENAI_KEY:
        try:
            import asyncio
            pvoice = body.voice_override or PREMIUM_TTS_VOICE
            audio = await asyncio.to_thread(_openai_tts_bytes, body.text, pvoice)
            if audio:
                return StreamingResponse(iter([audio]), media_type="audio/mpeg",
                                         headers={"Cache-Control": "no-cache"})
        except Exception as e:
            logger.warning(f"Premium TTS failed, falling back to Edge: {e}")

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
            threading.Thread(target=_init_rag, args=(sid, r), daemon=True).start()
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
            inst = _rag_instances[sid]
            with inst._lock:
                inst.base_url = body.website_url.rstrip('/')
                inst.domain = urlparse(body.website_url).netloc
            threading.Thread(target=_reindex_rag, args=(sid, inst), daemon=True).start()
        else:
            if len(_rag_instances) >= MAX_RAG_INSTANCES:
                return {"status": "error", "message": f"Max RAG instances ({MAX_RAG_INSTANCES}) reached."}
            r = MarkRAG(body.website_url, max_pages=MAX_CRAWL_PAGES)
            _rag_instances[sid] = r
            threading.Thread(target=_init_rag, args=(sid, r), daemon=True).start()

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
    router = get_llm_router(tenant)
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

    # Append brief brand context from RAG — use whatever has been crawled so far
    # (don't gate on full 'ready', which resets on cold start → false "loading").
    if rag_instance and (rag_instance.ready or getattr(rag_instance, "pages", None)):
        brand_context = rag_instance.get_brand_context()
        if brand_context:
            system_instruction += f"\n== STORE INFO ==\n{brand_context}\n"

    # Explicit None checks — a deliberately-set 0 (e.g. temperature=0) must not
    # be coalesced away to the default by a falsy `or`.
    _t = (tenant or {})
    llm_model = _t.get("llm_model") or DEFAULT_GROQ_MODEL
    max_tokens = _t.get("max_tokens") if _t.get("max_tokens") not in (None, "") else 150
    temperature = _t.get("temperature") if _t.get("temperature") not in (None, "") else 0.72

    # Keep the recent window (8 turns — enough to retain a just-made offer so an
    # "yes" can be acted on, still lean for latency).
    filtered = [m for m in body.messages if m.role != "system"]
    messages_for_api = [{"role": "system", "content": system_instruction}]

    cleaned = []
    last_user_msg = ""
    for m in filtered[-8:]:
        d = m.dict()
        if d["role"] == "user" and d["content"].strip() == "__INIT__":
            d["content"] = "[New visitor. Greet warmly, ask their name.]"
        elif d["role"] == "user" and d["content"].startswith("__RETURNING__:"):
            info = d["content"].replace("__RETURNING__:", "").strip()
            d["content"] = f"[Returning visitor. {info}. Greet by name, be helpful.]"
        if d["role"] == "user":
            last_user_msg = d["content"]
        cleaned.append(d)

    # Affirmation handling: a bare "yes/ok/sure/haan" retrieves nothing on its own
    # and makes the model re-offer instead of delivering. Run RAG on the PREVIOUS
    # topic, and never serve an affirmation from cache.
    _AFFIRM = {"yes", "yeah", "yep", "yup", "sure", "ok", "okay", "yes please",
               "go ahead", "do it", "please", "haan", "han", "g", "ji", "jee",
               "theek", "theek hai", "sahi", "ok mark", "karo", "kardo", "kar do",
               "dikhao", "show me", "yes mark"}
    norm_last = last_user_msg.strip().lower().strip("!.?, ")
    is_affirmation = bool(norm_last) and norm_last in _AFFIRM
    rag_query = last_user_msg
    if is_affirmation:
        prior_user = [c["content"] for c in cleaned
                      if c["role"] == "user" and not c["content"].startswith("[")]
        if len(prior_user) >= 2:
            rag_query = prior_user[-2]

    # Per-query RAG (top 3 — focused). Use whatever has been crawled.
    if rag_instance and (rag_instance.ready or getattr(rag_instance, "pages", None)) \
            and rag_query and not rag_query.startswith("["):
        rag_context = rag_instance.search_for_chat(rag_query, top_k=3)
        if rag_context:
            messages_for_api.append({
                "role": "system",
                "content": f"== WEBSITE KNOWLEDGE ==\n{rag_context}"
            })

    messages_for_api.extend(cleaned)

    # ── MAIE: inject learned per-store sales intelligence ──
    # Detect this visitor's buyer persona and, if the store has a trained
    # playbook, fold the matching strategy into Mark's system prompt.
    # Pure-Python + one cached DB read — negligible latency.
    # Detect buyer persona (cheap, pure-python) — used by BOTH MAIE and Sales Cortex.
    detected_persona = maie.DEFAULT_PERSONA
    try:
        detected_persona = maie.detect_persona(cleaned)
    except Exception:
        pass

    # MAIE: per-store LEARNED playbook (what this store's buyers actually do).
    if tenant and tenant.get("auto_learning_enabled", 1) and body.store_id:
        try:
            playbook = get_active_playbook(body.store_id)
            block = maie.build_playbook_prompt_block(playbook, detected_persona)
            if block:
                messages_for_api[0]["content"] += "\n" + block
        except Exception as e:
            logger.warning(f"MAIE inject skipped: {e}")

    # Sales Cortex: universal elite-sales DOCTRINE (stage + persona + objection).
    # Pure-python, ~300 tokens, kill-switch via env SALES_CORTEX=0.
    # Returning visitor if the client flagged it OR a returning-marker is present.
    is_returning = bool(getattr(body, "is_returning", False)) or any(
        isinstance(c.get("content"), str) and c["content"].startswith("[Returning visitor")
        for c in cleaned
    )
    try:
        cortex_block = sales_cortex.build_cortex_block(cleaned, detected_persona, returning=is_returning)
        if cortex_block:
            messages_for_api[0]["content"] += "\n" + cortex_block
    except Exception as e:
        logger.warning(f"Cortex inject skipped: {e}")

    # ── Cache check (skip for init/returning/streaming) ──
    rag_snippet = ""
    if len(messages_for_api) > 1 and messages_for_api[1].get("role") == "system":
        rag_snippet = messages_for_api[1].get("content", "")[:200]
    is_special = last_user_msg.startswith("[") or is_affirmation
    store_id_str = body.store_id or "default"

    if not body.stream and not is_special:
        cached = response_cache.get(store_id_str, last_user_msg, rag_snippet, persona=detected_persona)
        if cached:
            logger.info(f"Cache HIT for store {store_id_str}")
            log_conversation(ip, cleaned, body.user_language, cached, body.store_id)
            return {"response": cached, "cached": True}

    # ── Streaming mode: send tokens as SSE for instant display ──
    if body.stream:
        def stream_generator():
            full_reply = []
            try:
                for token in router.stream(
                    messages=messages_for_api,
                    model=llm_model,
                    max_tokens=max_tokens,
                    temperature=temperature,
                ):
                    full_reply.append(token)
                    yield f"data: {json.dumps({'token': token})}\n\n"

                complete = ''.join(full_reply)
                if complete:
                    yield f"data: {json.dumps({'done': True, 'response': complete})}\n\n"
                    log_conversation(ip, cleaned, body.user_language, complete, body.store_id)
                    capture_learning_async(tenant, ip, cleaned, complete, body.user_language)
                    # Cache streamed response too (if not special)
                    if not is_special and last_user_msg:
                        response_cache.set(store_id_str, last_user_msg, rag_snippet, complete, persona=detected_persona)
                else:
                    yield f"data: {json.dumps({'error': 'All AI providers unavailable'})}\n\n"
            except Exception as e:
                logger.error(f"Stream error: {e}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return StreamingResponse(stream_generator(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # ── Non-streaming mode (with router fallback) ──
    try:
        reply = router.complete(
            messages=messages_for_api,
            model=llm_model,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        if not reply:
            raise HTTPException(status_code=503, detail="All AI providers unavailable.")
        log_conversation(ip, cleaned, body.user_language, reply, body.store_id)
        capture_learning_async(tenant, ip, cleaned, reply, body.user_language)
        # Cache the response
        if not is_special and last_user_msg:
            response_cache.set(store_id_str, last_user_msg, rag_snippet, reply, persona=detected_persona)
        return {"response": reply}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail="Chat failed.")


def _sync_store_id(user: dict, x_store_id: Optional[str]) -> str:
    """Resolve the target store for a WP→backend sync call.
    Prefer the store bound to the X-Store-Token; fall back to an explicit
    X-Store-ID only for an authenticated admin-JWT caller. Raises 403
    otherwise — closes the cross-tenant write hole (anyone could previously
    overwrite any store by guessing its store_id)."""
    if user.get("store_id"):
        return user["store_id"]
    if x_store_id and resolve_tenant(x_store_id):
        return x_store_id
    raise HTTPException(status_code=403, detail="Store authentication required.")


@app.post("/api/sync-voice")
async def sync_voice(body: SyncVoiceRequest,
                     x_store_id: Optional[str] = Header(None),
                     user=Depends(verify_store_token_or_user)):
    """Sync voice settings from WP admin to backend store record (auth required)."""
    store_id = _sync_store_id(user, x_store_id)
    updates = {}
    if body.tts_voice: updates["tts_voice"] = body.tts_voice
    if body.tts_rate: updates["tts_rate"] = body.tts_rate
    if body.tts_pitch: updates["tts_pitch"] = body.tts_pitch
    if updates:
        update_store(store_id, **updates)
    return {"status": "ok", "updated": list(updates.keys())}


class SyncTrainingRequest(BaseModel):
    brand_description: Optional[str] = None
    priority_products: Optional[str] = None
    seasonal_products: Optional[str] = None

@app.post("/api/sync-training")
async def sync_training(body: SyncTrainingRequest,
                        x_store_id: Optional[str] = Header(None),
                        user=Depends(verify_store_token_or_user)):
    """Sync training data from WP admin to backend store record (auth required)."""
    store_id = _sync_store_id(user, x_store_id)
    updates = {}
    if body.brand_description is not None: updates["brand_description"] = body.brand_description[:5000]
    if body.priority_products is not None: updates["priority_products"] = body.priority_products[:2000]
    if body.seasonal_products is not None: updates["seasonal_products"] = body.seasonal_products[:2000]
    if updates:
        update_store(store_id, **updates)
        # Invalidate cache since training data changed
        response_cache.invalidate_store(store_id)
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


@app.get("/api/cache-stats")
async def cache_stats_endpoint(user: dict = Depends(get_current_user)):
    """Cache performance stats — admin only."""
    return response_cache.stats()


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

# ── Analytics Event Tracking ─────────────────────────────────

class TrackEventRequest(BaseModel):
    store_id: Optional[str] = None
    event_type: str
    visitor_hash: Optional[str] = ""
    metadata: Optional[dict] = None

    @validator("event_type")
    def valid_event(cls, v):
        allowed = {"widget_open", "chat_start", "chat_message", "voice_used", "link_clicked", "cta_clicked", "lead_submitted", "add_to_cart"}
        if v not in allowed:
            raise ValueError(f"Invalid event type: {v}")
        return v

track_limiter = RateLimiter(60)  # 60 events/min per IP

# Events that signal real purchase intent → counted as a conversion for MAIE.
CONVERSION_EVENTS = {"cta_clicked", "link_clicked", "lead_submitted", "add_to_cart"}

@app.post("/api/track")
async def track_event(request: Request, body: TrackEventRequest):
    """Fire-and-forget analytics event. Always returns 200."""
    ip = get_ip(request)
    if not track_limiter.is_allowed(ip):
        return {"ok": True}  # silently drop — never error on tracking
    sid = body.store_id or ""
    v_hash = body.visitor_hash or hashlib.sha256(ip.encode()).hexdigest()[:12]
    if sid:
        log_event(sid, body.event_type, v_hash, body.metadata)
        # High-intent events count as a conversion for MAIE learning. Mark the
        # visitor's latest session by IP hash (the space the capture path uses).
        if body.event_type in CONVERSION_EVENTS:
            ip_hash = hashlib.sha256(ip.encode()).hexdigest()[:12]
            try:
                mark_latest_signal_converted(sid, ip_hash)
            except Exception:
                pass
    return {"ok": True}


@app.get("/api/stores/{store_id}/event-analytics")
async def get_store_event_analytics(store_id: str, days: int = 30, user=Depends(verify_store_token_or_user)):
    """Admin or token-auth: aggregated event analytics for a store."""
    _enforce_store_access(store_id, user)
    data = get_event_analytics(store_id, min(days, 90))
    data["lead_count"] = get_lead_count(store_id)
    return data


@app.get("/api/stores/{store_id}/conversations")
async def get_store_conversations(store_id: str, user=Depends(verify_store_token_or_user)):
    """Recent conversations + summary stats for a store (token/owner auth).
    Reads the BACKEND conversation log (where the live widget actually writes),
    not the WP mirror — that's why the WP admin page showed 0."""
    _enforce_store_access(store_id, user)
    return get_analytics(store_id)


# ── MAIE: Adaptive Learning (playbook) endpoints ─────────────

def _enforce_store_access(store_id: str, user: dict) -> dict:
    """Authorize access to a specific store's data and return the tenant.
    - Token callers (X-Store-Token) are bound to their own store_id.
    - Admin-JWT callers (no store_id) must OWN the store (owner_id == user_id).
    Previously the admin-JWT branch was unchecked, so any admin could read/
    train ANY tenant's data by passing an arbitrary store_id."""
    tenant = get_store(store_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Store not found")
    if user.get("store_id"):
        if user["store_id"] != store_id:
            raise HTTPException(status_code=403, detail="Access denied")
    else:
        if tenant.get("owner_id") != user.get("user_id"):
            raise HTTPException(status_code=403, detail="Access denied")
    return tenant


def _maie_guard(store_id: str, user: dict) -> dict:
    """Resolve the store and enforce token/owner access. Returns the tenant."""
    return _enforce_store_access(store_id, user)


@app.get("/api/stores/{store_id}/playbook")
async def get_store_playbook(store_id: str, user=Depends(verify_store_token_or_user)):
    """Glass box: the store's learned playbook + learning status."""
    tenant = _maie_guard(store_id, user)
    active = get_active_playbook(store_id)
    return {
        "active": active,
        "history": get_playbook_history(store_id, limit=15),
        "persona_distribution": get_persona_distribution(store_id),
        "signals_total": get_signal_count(store_id),
        "signals_pending": get_signal_count(store_id, only_unprocessed=True),
        "min_signals_to_train": maie.MIN_SIGNALS_TO_TRAIN,
        "auto_learning_enabled": bool(tenant.get("auto_learning_enabled", 1)),
        "learning_autoapprove": bool(tenant.get("learning_autoapprove", 1)),
        "learning_last_run": tenant.get("learning_last_run", 0),
    }


@app.post("/api/stores/{store_id}/train")
async def train_store_playbook(store_id: str, user=Depends(verify_store_token_or_user)):
    """Manually trigger the Teacher distillation job for this store."""
    tenant = _maie_guard(store_id, user)
    try:
        router = get_llm_router(tenant)
    except HTTPException:
        raise HTTPException(status_code=503, detail="No AI key configured for training.")
    model = tenant.get("llm_model") or "llama-3.3-70b-versatile"
    auto_approve = bool(tenant.get("learning_autoapprove", 1))
    result = maie.run_teacher(store_id, router, model=model, auto_approve=auto_approve)
    return result


class PlaybookEditRequest(BaseModel):
    personas: Optional[list] = None
    winning_tactics: Optional[list] = None
    losing_patterns: Optional[list] = None
    summary: Optional[str] = None
    is_active: Optional[bool] = None
    approved: Optional[bool] = None


@app.put("/api/stores/{store_id}/playbook/{playbook_id}")
async def edit_store_playbook(store_id: str, playbook_id: int,
                              body: PlaybookEditRequest,
                              user=Depends(verify_store_token_or_user)):
    """Owner edit / approve / activate a specific playbook version."""
    _maie_guard(store_id, user)
    fields = {}
    for k in ("personas", "winning_tactics", "losing_patterns", "summary"):
        v = getattr(body, k)
        if v is not None:
            fields[k] = v
    if body.is_active is not None:
        fields["is_active"] = 1 if body.is_active else 0
    if body.approved is not None:
        fields["approved"] = 1 if body.approved else 0
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    ok = update_playbook(playbook_id, store_id, **fields)
    return {"ok": ok}


class LearningSettingsRequest(BaseModel):
    auto_learning_enabled: Optional[bool] = None
    learning_autoapprove: Optional[bool] = None


@app.post("/api/stores/{store_id}/learning-settings")
async def set_learning_settings(store_id: str, body: LearningSettingsRequest,
                                user=Depends(verify_store_token_or_user)):
    """Enable/disable auto-learning and auto-approval for this store."""
    _maie_guard(store_id, user)
    updates = {}
    if body.auto_learning_enabled is not None:
        updates["auto_learning_enabled"] = 1 if body.auto_learning_enabled else 0
    if body.learning_autoapprove is not None:
        updates["learning_autoapprove"] = 1 if body.learning_autoapprove else 0
    if updates:
        update_store(store_id, **updates)
    return {"ok": True, **updates}


# ── Lead Capture ─────────────────────────────────────────────

class LeadRequest(BaseModel):
    store_id: Optional[str] = None
    email: str
    name: Optional[str] = ""
    visitor_hash: Optional[str] = ""
    context: Optional[str] = ""

    @validator("email")
    def valid_email(cls, v):
        if not v or "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Invalid email")
        return v.strip()[:200]

lead_limiter = RateLimiter(5)  # 5 leads/min per IP

@app.post("/api/lead")
async def capture_lead(request: Request, body: LeadRequest):
    """Public: capture visitor email. Rate-limited."""
    ip = get_ip(request)
    if not lead_limiter.is_allowed(ip):
        raise HTTPException(status_code=429, detail="Too many submissions. Try again later.")
    sid = body.store_id or ""
    v_hash = body.visitor_hash or hashlib.sha256(ip.encode()).hexdigest()[:12]
    if not sid:
        raise HTTPException(status_code=400, detail="Store ID required")
    ok = save_lead(sid, body.email, v_hash, body.name or "", body.context or "")
    if ok:
        log_event(sid, "lead_submitted", v_hash, {"email": body.email[:30] + "..."})
        # Webhook delivery (non-blocking)
        tenant = resolve_tenant(sid)
        if tenant and tenant.get("webhook_url"):
            webhook_data = {"event": "new_lead", "email": body.email, "name": body.name, "store_id": sid}
            threading.Thread(target=_send_webhook, args=(tenant["webhook_url"], webhook_data), daemon=True).start()
    return {"ok": ok, "message": "Thank you! We'll be in touch."}


@app.get("/api/stores/{store_id}/leads")
async def get_store_leads(store_id: str, limit: int = 50, offset: int = 0, user=Depends(get_current_user)):
    """Admin-only: list captured leads (owner-scoped)."""
    _enforce_store_access(store_id, user)
    leads = get_leads(store_id, min(limit, 200), offset)
    total = get_lead_count(store_id)
    return {"leads": leads, "total": total}


def _send_webhook(url: str, data: dict):
    """Non-blocking webhook delivery with 1 retry."""
    for attempt in range(2):
        try:
            resp = http_requests.post(url, json=data, timeout=5)
            if resp.ok:
                logger.info(f"Webhook delivered to {url}")
                return
        except Exception as e:
            logger.warning(f"Webhook attempt {attempt+1} failed: {e}")
            time.sleep(1)


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
