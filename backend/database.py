# ============================================================
# MARK DATABASE — Multi-tenant Store Management
# SQLite-based — zero external dependencies
# ============================================================

import sqlite3
import uuid
import hashlib
import json
import time
import logging
from pathlib import Path
from contextlib import contextmanager

logger = logging.getLogger("mark.db")

DB_PATH = Path(__file__).parent / "mark.db"


@contextmanager
def get_db():
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Create tables if they don't exist."""
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS admin_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at REAL DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS stores (
                store_id TEXT PRIMARY KEY,
                store_name TEXT NOT NULL DEFAULT 'My Store',
                website_url TEXT NOT NULL,
                assistant_name TEXT NOT NULL DEFAULT 'Mark',
                personality TEXT NOT NULL DEFAULT 'friendly',
                greeting_style TEXT NOT NULL DEFAULT 'casual',
                primary_language TEXT NOT NULL DEFAULT 'en',
                supported_languages TEXT NOT NULL DEFAULT '["en","ur"]',
                max_crawl_pages INTEGER NOT NULL DEFAULT 120,
                idle_timeout INTEGER NOT NULL DEFAULT 10,
                walking_enabled INTEGER NOT NULL DEFAULT 1,
                sound_effects INTEGER NOT NULL DEFAULT 1,

                -- Voice settings (Edge TTS — free, no API key needed)
                tts_voice TEXT DEFAULT 'en-US-GuyNeural',
                tts_voice_urdu TEXT DEFAULT 'ur-PK-AsadNeural',
                tts_rate TEXT DEFAULT '+0%',
                tts_pitch TEXT DEFAULT '+0Hz',

                -- Groq settings
                groq_api_key TEXT DEFAULT '',
                llm_model TEXT DEFAULT 'llama-3.3-70b-versatile',
                max_tokens INTEGER DEFAULT 150,
                temperature REAL DEFAULT 0.72,

                -- Limits
                max_audio_mb INTEGER DEFAULT 10,
                max_message_length INTEGER DEFAULT 2000,
                rate_transcribe INTEGER DEFAULT 15,
                rate_chat INTEGER DEFAULT 30,
                rate_rag INTEGER DEFAULT 40,
                rate_tts INTEGER DEFAULT 20,

                -- System prompt override (optional — blank = use default)
                custom_system_prompt TEXT DEFAULT '',

                -- Sales intelligence
                sales_mode TEXT DEFAULT 'helpful',
                sales_greeting TEXT DEFAULT '',
                sales_cta_text TEXT DEFAULT '',
                sales_cta_url TEXT DEFAULT '',
                sales_objection_handling TEXT DEFAULT 'graceful',
                sales_cross_sell TEXT DEFAULT '',
                sales_urgency_triggers TEXT DEFAULT '',
                sales_tone TEXT DEFAULT 'friendly',
                sales_followup_enabled INTEGER DEFAULT 0,
                sales_max_suggestions INTEGER DEFAULT 3,

                -- Mark Training data (brand knowledge)
                brand_description TEXT DEFAULT '',
                priority_products TEXT DEFAULT '',
                seasonal_products TEXT DEFAULT '',

                -- Auto-registration token (WP plugin auth)
                api_token TEXT DEFAULT '',

                -- Status
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at REAL DEFAULT (strftime('%s','now')),
                updated_at REAL DEFAULT (strftime('%s','now')),

                -- Owner (NULL for auto-registered WP stores)
                owner_id INTEGER DEFAULT NULL
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id TEXT NOT NULL REFERENCES stores(store_id),
                visitor_hash TEXT NOT NULL,
                language TEXT DEFAULT 'en',
                exchange_count INTEGER DEFAULT 0,
                last_user_msg TEXT DEFAULT '',
                mark_response TEXT DEFAULT '',
                created_at REAL DEFAULT (strftime('%s','now'))
            );

            CREATE INDEX IF NOT EXISTS idx_conv_store ON conversations(store_id);
            CREATE INDEX IF NOT EXISTS idx_conv_created ON conversations(created_at);

            CREATE TABLE IF NOT EXISTS analytics_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id TEXT NOT NULL REFERENCES stores(store_id),
                event_type TEXT NOT NULL,
                visitor_hash TEXT NOT NULL,
                metadata TEXT DEFAULT '{}',
                created_at REAL DEFAULT (strftime('%s','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_events_store ON analytics_events(store_id);
            CREATE INDEX IF NOT EXISTS idx_events_type ON analytics_events(event_type);
            CREATE INDEX IF NOT EXISTS idx_events_created ON analytics_events(created_at);

            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id TEXT NOT NULL REFERENCES stores(store_id),
                email TEXT NOT NULL,
                name TEXT DEFAULT '',
                visitor_hash TEXT NOT NULL,
                context TEXT DEFAULT '',
                created_at REAL DEFAULT (strftime('%s','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_leads_store ON leads(store_id);
        """)

        # Migration: add sales columns to existing stores table
        sales_columns = {
            "sales_mode": "TEXT DEFAULT 'helpful'",
            "sales_greeting": "TEXT DEFAULT ''",
            "sales_cta_text": "TEXT DEFAULT ''",
            "sales_cta_url": "TEXT DEFAULT ''",
            "sales_objection_handling": "TEXT DEFAULT 'graceful'",
            "sales_cross_sell": "TEXT DEFAULT ''",
            "sales_urgency_triggers": "TEXT DEFAULT ''",
            "sales_tone": "TEXT DEFAULT 'friendly'",
            "sales_followup_enabled": "INTEGER DEFAULT 0",
            "sales_max_suggestions": "INTEGER DEFAULT 3",
        }
        # Also add api_token and webhook_url if missing
        all_migrations = {**sales_columns, "api_token": "TEXT DEFAULT ''", "webhook_url": "TEXT DEFAULT ''"}
        existing = {row[1] for row in db.execute("PRAGMA table_info(stores)").fetchall()}
        for col, typedef in all_migrations.items():
            if col not in existing:
                db.execute(f"ALTER TABLE stores ADD COLUMN {col} {typedef}")
                logger.info(f"Migrated stores table: added {col}")


def hash_password(password: str) -> str:
    """Hash password with SHA-256 + salt for security.
    Uses a fixed prefix salt — upgrade to bcrypt when adding the dependency."""
    salted = f"mark_ai_salt_{password}_v1"
    return hashlib.sha256(salted.encode()).hexdigest()


def verify_password_compat(password: str, stored_hash: str) -> bool:
    """Verify password — supports both old (unsalted) and new (salted) hashes."""
    # Try new salted hash first
    if hash_password(password) == stored_hash:
        return True
    # Fallback: old unsalted hash (for existing users before upgrade)
    if hashlib.sha256(password.encode()).hexdigest() == stored_hash:
        return True
    return False


# ── Admin Users ──────────────────────────────────────────────

def create_admin(username: str, password: str) -> bool:
    try:
        with get_db() as db:
            db.execute(
                "INSERT INTO admin_users (username, password_hash) VALUES (?, ?)",
                (username, hash_password(password))
            )
        return True
    except sqlite3.IntegrityError:
        return False


def verify_admin(username: str, password: str) -> dict | None:
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM admin_users WHERE username = ?",
            (username,)
        ).fetchone()
        if row and verify_password_compat(password, row["password_hash"]):
            # Upgrade hash if using old format
            new_hash = hash_password(password)
            if row["password_hash"] != new_hash:
                db.execute(
                    "UPDATE admin_users SET password_hash = ? WHERE id = ?",
                    (new_hash, row["id"])
                )
            return dict(row)
        return None


def admin_exists() -> bool:
    with get_db() as db:
        row = db.execute("SELECT COUNT(*) as cnt FROM admin_users").fetchone()
        return row["cnt"] > 0


# ── Store CRUD ───────────────────────────────────────────────

# Whitelist of allowed store fields to prevent SQL injection via kwargs
STORE_FIELDS = {
    "store_id", "owner_id", "store_name", "website_url", "assistant_name",
    "personality", "greeting_style", "primary_language", "supported_languages",
    "max_crawl_pages", "idle_timeout", "walking_enabled", "sound_effects",
    "tts_voice", "tts_voice_urdu", "tts_rate", "tts_pitch",
    "groq_api_key", "llm_model", "max_tokens", "temperature",
    "max_audio_mb", "max_message_length", "rate_transcribe", "rate_chat",
    "rate_rag", "rate_tts", "custom_system_prompt", "is_active", "updated_at",
    "api_token",
    "sales_mode", "sales_greeting", "sales_cta_text", "sales_cta_url",
    "sales_objection_handling", "sales_cross_sell", "sales_urgency_triggers",
    "sales_tone", "sales_followup_enabled", "sales_max_suggestions",
    "brand_description", "priority_products", "seasonal_products",
}


def create_store(owner_id: int, store_name: str, website_url: str, **kwargs) -> str:
    store_id = uuid.uuid4().hex[:16]
    fields = {
        "store_id": store_id,
        "owner_id": owner_id,
        "store_name": store_name,
        "website_url": website_url,
    }
    # Only allow whitelisted fields
    for k, v in kwargs.items():
        if k in STORE_FIELDS:
            fields[k] = v

    with get_db() as db:
        cols = ", ".join(fields.keys())
        placeholders = ", ".join(["?"] * len(fields))
        db.execute(f"INSERT INTO stores ({cols}) VALUES ({placeholders})", list(fields.values()))
    return store_id


def get_store(store_id: str) -> dict | None:
    with get_db() as db:
        row = db.execute("SELECT * FROM stores WHERE store_id = ?", (store_id,)).fetchone()
        return dict(row) if row else None


def get_store_by_token(token: str) -> dict | None:
    if not token:
        return None
    with get_db() as db:
        row = db.execute("SELECT * FROM stores WHERE api_token = ?", (token,)).fetchone()
        return dict(row) if row else None


def get_store_by_url(url: str) -> dict | None:
    if not url:
        return None
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM stores WHERE website_url = ? AND is_active = 1", (url,)
        ).fetchone()
        return dict(row) if row else None


def get_all_active_stores() -> list:
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM stores WHERE is_active = 1 AND website_url IS NOT NULL AND website_url != ''",
        ).fetchall()
        return [dict(r) for r in rows]


def get_stores_by_owner(owner_id: int) -> list:
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM stores WHERE owner_id = ? ORDER BY created_at DESC",
            (owner_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def update_store(store_id: str, **kwargs) -> bool:
    if not kwargs:
        return False
    # Filter to whitelisted fields only
    safe_kwargs = {k: v for k, v in kwargs.items() if k in STORE_FIELDS}
    if not safe_kwargs:
        return False
    safe_kwargs["updated_at"] = time.time()
    with get_db() as db:
        sets = ", ".join(f"{k} = ?" for k in safe_kwargs.keys())
        vals = list(safe_kwargs.values()) + [store_id]
        db.execute(f"UPDATE stores SET {sets} WHERE store_id = ?", vals)
    return True


def delete_store(store_id: str) -> bool:
    with get_db() as db:
        db.execute("DELETE FROM conversations WHERE store_id = ?", (store_id,))
        db.execute("DELETE FROM stores WHERE store_id = ?", (store_id,))
    return True


# ── Conversations ────────────────────────────────────────────

def log_conversation_db(store_id: str, visitor_hash: str, language: str,
                        exchange_count: int, last_user_msg: str, mark_response: str):
    with get_db() as db:
        db.execute(
            """INSERT INTO conversations
               (store_id, visitor_hash, language, exchange_count, last_user_msg, mark_response)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (store_id, visitor_hash, language, exchange_count, last_user_msg[:500], mark_response[:500])
        )


def get_analytics(store_id: str) -> dict:
    with get_db() as db:
        total = db.execute(
            "SELECT COUNT(*) as cnt FROM conversations WHERE store_id = ?",
            (store_id,)
        ).fetchone()["cnt"]

        today_start = time.time() - (time.time() % 86400)
        today = db.execute(
            "SELECT COUNT(*) as cnt FROM conversations WHERE store_id = ? AND created_at >= ?",
            (store_id, today_start)
        ).fetchone()["cnt"]

        week_start = time.time() - 7 * 86400
        week = db.execute(
            "SELECT COUNT(*) as cnt FROM conversations WHERE store_id = ? AND created_at >= ?",
            (store_id, week_start)
        ).fetchone()["cnt"]

        lang_rows = db.execute(
            "SELECT language, COUNT(*) as cnt FROM conversations WHERE store_id = ? GROUP BY language",
            (store_id,)
        ).fetchall()
        languages = {r["language"]: r["cnt"] for r in lang_rows}

        recent = db.execute(
            """SELECT visitor_hash, language, last_user_msg, mark_response, created_at
               FROM conversations WHERE store_id = ?
               ORDER BY created_at DESC LIMIT 30""",
            (store_id,)
        ).fetchall()

        unique = db.execute(
            "SELECT COUNT(DISTINCT visitor_hash) as cnt FROM conversations WHERE store_id = ?",
            (store_id,)
        ).fetchone()["cnt"]

        return {
            "total_conversations": total,
            "today": today,
            "this_week": week,
            "unique_visitors": unique,
            "languages": languages,
            "recent": [dict(r) for r in recent],
        }


# ── Analytics Events ────────────────────────────────────────

def log_event(store_id: str, event_type: str, visitor_hash: str, metadata: dict = None):
    """Fire-and-forget event logging. Never throws."""
    try:
        meta_json = json.dumps(metadata or {}, ensure_ascii=False)
        with get_db() as db:
            db.execute(
                "INSERT INTO analytics_events (store_id, event_type, visitor_hash, metadata) VALUES (?, ?, ?, ?)",
                (store_id, event_type, visitor_hash, meta_json)
            )
    except Exception as e:
        logger.warning(f"Event log error: {e}")


def get_event_analytics(store_id: str, days: int = 30) -> dict:
    """Aggregate event counts by type and day for the last N days."""
    since = time.time() - days * 86400
    with get_db() as db:
        # Total counts by type
        type_rows = db.execute(
            "SELECT event_type, COUNT(*) as cnt FROM analytics_events WHERE store_id = ? AND created_at >= ? GROUP BY event_type",
            (store_id, since)
        ).fetchall()
        totals = {r["event_type"]: r["cnt"] for r in type_rows}

        # Daily breakdown (last 14 days for charts)
        daily_since = time.time() - 14 * 86400
        daily_rows = db.execute(
            """SELECT date(created_at, 'unixepoch') as day, event_type, COUNT(*) as cnt
               FROM analytics_events WHERE store_id = ? AND created_at >= ?
               GROUP BY day, event_type ORDER BY day""",
            (store_id, daily_since)
        ).fetchall()
        daily = {}
        for r in daily_rows:
            d = r["day"]
            if d not in daily:
                daily[d] = {}
            daily[d][r["event_type"]] = r["cnt"]

        # Unique visitors (by hash)
        unique = db.execute(
            "SELECT COUNT(DISTINCT visitor_hash) as cnt FROM analytics_events WHERE store_id = ? AND created_at >= ?",
            (store_id, since)
        ).fetchone()["cnt"]

        return {"totals": totals, "daily": daily, "unique_visitors": unique, "days": days}


# ── Leads ──────────────────────────────────────────────────

def save_lead(store_id: str, email: str, visitor_hash: str, name: str = "", context: str = ""):
    try:
        with get_db() as db:
            db.execute(
                "INSERT INTO leads (store_id, email, name, visitor_hash, context) VALUES (?, ?, ?, ?, ?)",
                (store_id, email[:200], name[:100], visitor_hash, context[:1000])
            )
        return True
    except Exception as e:
        logger.warning(f"Lead save error: {e}")
        return False


def get_leads(store_id: str, limit: int = 50, offset: int = 0) -> list:
    with get_db() as db:
        rows = db.execute(
            "SELECT id, email, name, context, created_at FROM leads WHERE store_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (store_id, limit, offset)
        ).fetchall()
        return [dict(r) for r in rows]


def get_lead_count(store_id: str) -> int:
    with get_db() as db:
        return db.execute(
            "SELECT COUNT(*) as cnt FROM leads WHERE store_id = ?", (store_id,)
        ).fetchone()["cnt"]


# ── Initialize on import ────────────────────────────────────
init_db()
