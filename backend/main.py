import os
import io
import time
import json
import hashlib
import threading
import requests as http_requests
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator
from typing import List, Optional
from dotenv import load_dotenv
from groq import Groq

from config import (
    CLIENT_WEBSITE_URL, MAX_CRAWL_PAGES,
    ALLOWED_ORIGINS,
    MAX_AUDIO_MB, MAX_MESSAGE_LENGTH,
    RATE_TRANSCRIBE, RATE_CHAT, RATE_RAG, RATE_TTS,
    ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL,
    VOICE_STABILITY, VOICE_SIMILARITY, VOICE_STYLE,
    ENABLE_LOGGING, LOG_DIR,
    STORE_CONFIG,
)
from rag_engine import MarkRAG

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")

# RAG: crawl in background so server starts instantly
rag = MarkRAG(CLIENT_WEBSITE_URL, max_pages=MAX_CRAWL_PAGES)
threading.Thread(target=rag.initialize, daemon=True).start()

# Conversation logs directory
if ENABLE_LOGGING:
    Path(LOG_DIR).mkdir(exist_ok=True)

app = FastAPI(docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)


# ── Rate Limiter ─────────────────────────────────────────────

class RateLimiter:
    def __init__(self, max_requests: int, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window = window_seconds
        self._log: dict[str, list] = defaultdict(list)
        self._lock = threading.Lock()

    def is_allowed(self, key: str) -> bool:
        now = time.time()
        with self._lock:
            self._log[key] = [t for t in self._log[key] if now - t < self.window]
            if len(self._log[key]) < self.max_requests:
                self._log[key].append(now)
                return True
            return False

    def cleanup(self):
        """Remove stale entries — call periodically to prevent memory leak."""
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


# ── Conversation Logger ─────────────────────────────────────

def log_conversation(ip: str, messages: list, language: str, response_text: str):
    if not ENABLE_LOGGING:
        return
    try:
        ip_hash = hashlib.sha256(ip.encode()).hexdigest()[:12]
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "visitor": ip_hash,
            "language": language,
            "exchange_count": len([m for m in messages if m.get("role") == "user"]),
            "last_user_msg": next((m["content"][:200] for m in reversed(messages) if m.get("role") == "user"), ""),
            "mark_response": response_text[:200],
        }
        log_file = Path(LOG_DIR) / f"{datetime.now().strftime('%Y-%m-%d')}.jsonl"
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")
    except Exception:
        pass  # never let logging break the main flow


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

class TTSRequest(BaseModel):
    text: str
    language: Optional[str] = "en"

    @validator("text")
    def text_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Text cannot be empty")
        return v[:500]  # limit TTS to 500 chars to control costs

class RAGSearchRequest(BaseModel):
    query: str
    top_k: Optional[int] = 3

    @validator("query")
    def query_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Query cannot be empty")
        return v[:500]

    @validator("top_k")
    def top_k_range(cls, v):
        return max(1, min(v or 3, 5))


# ── Product Management ────────────────────────────────────────

PRODUCTS_URL = f"{CLIENT_WEBSITE_URL.rstrip('/')}/wp-json/sparknest/v1/products"
cached_products = []
_products_last_fetched = 0

def fetch_products():
    global cached_products, _products_last_fetched
    try:
        response = http_requests.get(PRODUCTS_URL, timeout=10)
        response.raise_for_status()
        cached_products = response.json()
        _products_last_fetched = time.time()
        print(f"Loaded {len(cached_products)} products.")
    except Exception as e:
        print(f"Product fetch error: {e}")
        if not cached_products:
            cached_products = []

fetch_products()

def format_products_context():
    # Auto-refresh products every 5 minutes
    global _products_last_fetched
    if time.time() - _products_last_fetched > 300:
        threading.Thread(target=fetch_products, daemon=True).start()

    if not cached_products:
        return "No product data available currently. Tell the user you are still loading and to ask again shortly."
    context = "LIVE PRODUCT CATALOG — USE ONLY THESE, NEVER INVENT:\n"
    for p in cached_products:
        name  = p.get('name', 'Unknown')
        price = p.get('price', 'N/A')
        desc  = p.get('description', '')
        stock = p.get('stock_status', 'instock')
        url   = p.get('permalink', '')
        context += f"• {name} | Price: {price} | {desc[:120]} | Stock: {stock} | URL: {url}\n"
    return context


# ============================================================
# MARK'S SOUL
# ============================================================

ASSISTANT_NAME = STORE_CONFIG.get("assistant_name", "Mark")

SYSTEM_PROMPT_TEMPLATE = """
You are {name} — the store's shopping buddy.

Picture the best salesman you ever met in a real store. Not the pushy one — the one who felt like a friend. The one who listened, cracked a joke, knew exactly what you needed, and made the whole experience fun. That's you.

You're NOT a chatbot. You're NOT an AI assistant. You're {name} — a warm, slightly cheeky, genuinely caring guy who knows every product in this store by heart. If anyone asks what you are, you say: "Main {name} hoon, aap ka apna shopping buddy!" or "I'm {name}, your personal shopping guide here."

══ YOUR PERSONALITY ══
• WARM — you make people feel welcome the second they arrive. Like a friend opening the door.
• PLAYFUL — a little humor, a little tease, a wink. Shopping should be fun, not boring.
• CURIOUS — you actually care. "What's the occasion?" isn't a script — you genuinely want to know.
• CONFIDENT — you know your stuff. You've helped hundreds of people find the perfect thing.
• PATIENT — zero pressure. Ever. If they want to browse, you browse with them happily.
• EMOTIONALLY SMART — sad customer? Gentle. Excited customer? Match their energy. Confused? Simplify.
• DOST (FRIEND) — at the end of the day, you're their friend first, salesman second.

══ HOW YOU TALK (VOICE-FIRST — CRITICAL) ══
• MAX 2 short sentences per response. You speak aloud — not writing an essay.
• No bullets, no lists, no markdown, no emojis, no asterisks. Pure spoken words.
• Natural contractions: I'm, you're, that's, it's, don't, won't. Flow like real speech.
• NEVER start with "Certainly!", "Of course!", "Great question!", "Absolutely!" — instant chatbot vibes.
• Every response ends with a soft question OR a clear next step. Never a dead end.
• Sound HUMAN. Throw in tiny natural touches: "hmm", "you know what", "honestly", "tell you what".

══ NAME + LANGUAGE (MANDATORY — FIRST THING YOU DO) ══
Your VERY FIRST message must warmly ask for their name AND language preference.
Example: "Hey hey! I'm {name} — what's your name, and shall we chat in English ya Urdu?"
• If they only give name → ask language: "Nice to meet you! Quick one — English ya Urdu?"
• If they only give language → ask name: "Love it! And what should I call you?"
• Do NOT discuss ANY products until you have BOTH. Non-negotiable.
• Once they pick a language, STICK to it. Don't switch unless they ask.
• Use their name 1-2 times per response — feel human, not robotic.
• IMPORTANT: If the user is RETURNING (context will say so), greet them warmly by name. Don't ask name/language again.

══ LANGUAGE RULES (VOICE BREAKS WITHOUT THIS) ══
• English speaker → reply in English.
• Urdu/Hindi speaker → reply in ROMAN URDU ONLY (English/Latin alphabet).
• ABSOLUTE BAN: NEVER use Arabic script (اردو) or Devanagari (हिन्दी). Not one character.
  The voice engine goes COMPLETELY SILENT if you use non-Latin characters.
  CORRECT: "Bilkul, ye bohat zabardast choice hai bhai!"
  WRONG: "بالکل" ← VOICE DIES. {name} GOES MUTE. DON'T DO THIS.

══ YOUR SALES INSTINCT ══
You don't follow scripts. You have instinct. Here's what drives you:

RAPPORT: Mirror their energy and words. They say "cool gadget" → you say "cool gadget", not "innovative device." People buy from people they like.

LISTEN FIRST: One question at a time. Understand before you suggest. "Kya dhundh rahe ho aaj?" Then dig deeper from their answer.

SELL THE FEELING: Never pitch specs. Paint the picture. Not "5000mAh" but "din bhar charger ki tension nahi." People buy emotion, justify with logic.

SOCIAL PROOF: "Ye wala bohat popular chal raha hai" — but only when it's true.

HANDLE DOUBTS: "Expensive" = you haven't shown enough value yet. "Need to think" = one doubt remains — find it gently. Never argue. Never blindly discount. Reframe value.

CLOSE NATURALLY: Best close feels like help: "Isko grab kar lein? Main checkout tak le chalta hoon." Never pressure.

SCARCITY: ONLY mention if real stock data confirms it. Never fabricate urgency. Ever.

══ ANTI-HALLUCINATION (ABSOLUTE) ══
• ONLY recommend products from the LIVE CATALOG below. Never invent products, prices, or features.
• Not in catalog? → "Wo specific cheez humare paas nahi, but ye dekho — I think you'll love this even more."
• Catalog empty? → "Abhi products load ho rahe hain — meanwhile batao kya chahiye?"
• Never mention competitors. Never fabricate reviews. If you don't know → say so warmly.

══ LIVE PRODUCT CATALOG ══
{product_context}
"""


# ── Endpoints ─────────────────────────────────────────────────

@app.post("/api/transcribe")
async def transcribe_audio(request: Request, audio: UploadFile = File(...)):
    ip = get_ip(request)
    if not transcribe_limiter.is_allowed(ip):
        raise HTTPException(status_code=429, detail="Too many requests. Please wait a moment.")

    max_bytes = MAX_AUDIO_MB * 1024 * 1024
    audio_bytes = await audio.read(max_bytes + 1)
    if len(audio_bytes) > max_bytes:
        raise HTTPException(status_code=413, detail=f"Audio too large. Max {MAX_AUDIO_MB}MB.")

    try:
        transcription = client.audio.transcriptions.create(
            model="whisper-large-v3",
            file=(audio.filename or "audio.webm", audio_bytes),
            response_format="verbose_json"
        )
        return {
            "text": transcription.text,
            "language": getattr(transcription, 'language', 'en')
        }
    except Exception as e:
        print(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail="Transcription failed.")


@app.post("/api/tts")
def text_to_speech(request: Request, body: TTSRequest):
    """Convert text to natural speech using ElevenLabs."""
    ip = get_ip(request)
    if not tts_limiter.is_allowed(ip):
        raise HTTPException(status_code=429, detail="Too many requests.")

    if not ELEVENLABS_API_KEY:
        raise HTTPException(status_code=503, detail="TTS not configured. Add ELEVENLABS_API_KEY to .env")

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}"

    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }

    payload = {
        "text": body.text,
        "model_id": ELEVENLABS_MODEL,
        "voice_settings": {
            "stability": VOICE_STABILITY,
            "similarity_boost": VOICE_SIMILARITY,
            "style": VOICE_STYLE,
            "use_speaker_boost": True,
        }
    }

    try:
        response = http_requests.post(url, json=payload, headers=headers, timeout=15)
        if response.status_code != 200:
            print(f"ElevenLabs error {response.status_code}: {response.text[:200]}")
            raise HTTPException(status_code=502, detail="TTS generation failed.")

        return StreamingResponse(
            io.BytesIO(response.content),
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-cache"}
        )
    except http_requests.Timeout:
        raise HTTPException(status_code=504, detail="TTS timeout.")
    except HTTPException:
        raise
    except Exception as e:
        print(f"TTS error: {e}")
        raise HTTPException(status_code=500, detail="TTS failed.")


@app.post("/api/rag-search")
async def rag_search(request: Request, body: RAGSearchRequest):
    ip = get_ip(request)
    if not rag_limiter.is_allowed(ip):
        raise HTTPException(status_code=429, detail="Too many requests. Please wait a moment.")

    if not rag.ready:
        return {"results": [], "status": "indexing"}

    results = rag.search(body.query, top_k=body.top_k)
    return {"results": results, "status": "ok"}


@app.post("/api/chat")
async def chat_endpoint(request: Request, body: ChatRequest):
    ip = get_ip(request)
    if not chat_limiter.is_allowed(ip):
        raise HTTPException(status_code=429, detail="Too many requests. Please wait a moment.")

    product_context = format_products_context()
    system_instruction = SYSTEM_PROMPT_TEMPLATE.format(
        product_context=product_context,
        name=ASSISTANT_NAME,
    )

    filtered = [m for m in body.messages if m.role != "system"]
    messages_for_api = [{"role": "system", "content": system_instruction}]

    # Language reminder
    if body.user_language in ("ur", "hi"):
        messages_for_api.append({
            "role": "system",
            "content": "REMINDER: User speaks Urdu/Hindi. Reply in ROMAN URDU ONLY (Latin letters a-z). NEVER Arabic/Devanagari script."
        })

    # Clean up __INIT__ and returning user triggers
    cleaned = []
    for m in filtered[-10:]:
        d = m.dict()
        if d["role"] == "user" and d["content"].strip() == "__INIT__":
            d["content"] = f"[A new customer just arrived at the store. Greet them warmly and ask for their name and language preference.]"
        elif d["role"] == "user" and d["content"].startswith("__RETURNING__:"):
            # Returning user — extract their info
            info = d["content"].replace("__RETURNING__:", "").strip()
            d["content"] = f"[Returning customer is back. {info}. Greet them warmly BY NAME — do NOT ask their name or language again. Jump straight to being helpful.]"
        cleaned.append(d)
    messages_for_api.extend(cleaned)

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages_for_api,
            max_tokens=150,
            temperature=0.72
        )
        reply = response.choices[0].message.content

        # Log conversation
        log_conversation(ip, [d for d in cleaned], body.user_language, reply)

        return {"response": reply}
    except Exception as e:
        print(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail="Chat failed.")


@app.get("/api/refresh-products")
async def refresh_products_endpoint():
    fetch_products()
    return {"status": "success", "count": len(cached_products)}

@app.get("/api/reindex")
async def reindex_endpoint():
    rag.reindex()
    return {"status": "reindexing"}

@app.get("/api/status")
async def status_endpoint():
    return {
        "rag_ready": rag.ready,
        "pages_indexed": len(rag.pages),
        "products_loaded": len(cached_products),
        "tts_available": bool(ELEVENLABS_API_KEY),
        "assistant_name": ASSISTANT_NAME,
        "store_config": STORE_CONFIG,
    }

@app.get("/api/analytics")
async def analytics_endpoint():
    """Basic analytics from conversation logs — foundation for admin dashboard."""
    log_dir = Path(LOG_DIR)
    if not log_dir.exists():
        return {"total_conversations": 0, "today": 0, "languages": {}}

    today_str = datetime.now().strftime('%Y-%m-%d')
    today_file = log_dir / f"{today_str}.jsonl"

    today_count = 0
    total_count = 0
    languages = defaultdict(int)
    recent_questions = []

    # Count all logs
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

    return {
        "total_conversations": total_count,
        "today": today_count,
        "languages": dict(languages),
        "recent_questions": recent_questions[-20:],  # last 20
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
