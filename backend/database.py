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
        # Also add api_token if missing
        all_migrations = {**sales_columns, "api_token": "TEXT DEFAULT ''"}
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


# ── Initialize on import ────────────────────────────────────
init_db()
