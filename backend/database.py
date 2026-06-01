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

            -- ============================================================
            -- MAIE: Mark Adaptive Intelligence Engine
            -- Closed learning loop — Mark learns per-store sales psychology
            -- from real conversations (no LLM fine-tuning; prompt evolution).
            -- ============================================================

            -- One row per meaningful visitor session. Raw material the
            -- "Teacher" job distills into playbooks. PII is stripped before storage.
            CREATE TABLE IF NOT EXISTS learning_signals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id TEXT NOT NULL REFERENCES stores(store_id),
                visitor_hash TEXT NOT NULL,
                language TEXT DEFAULT 'en',
                persona TEXT DEFAULT '',
                sentiment TEXT DEFAULT '',
                outcome TEXT DEFAULT 'neutral',     -- converted | engaged | bounced | neutral
                quality_score REAL DEFAULT 0,        -- 0..1, set by the filter/scorer
                exchange_count INTEGER DEFAULT 0,
                transcript TEXT DEFAULT '',          -- PII-stripped condensed transcript
                processed INTEGER DEFAULT 0,         -- 0 = not yet distilled into a playbook
                created_at REAL DEFAULT (strftime('%s','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_signals_store ON learning_signals(store_id);
            CREATE INDEX IF NOT EXISTS idx_signals_processed ON learning_signals(processed);
            CREATE INDEX IF NOT EXISTS idx_signals_created ON learning_signals(created_at);

            -- The evolving, versioned per-store playbook. Glass box — owner can
            -- read/edit. Only one active version per store at a time.
            CREATE TABLE IF NOT EXISTS store_playbooks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id TEXT NOT NULL REFERENCES stores(store_id),
                version INTEGER NOT NULL DEFAULT 1,
                personas TEXT DEFAULT '[]',          -- JSON: [{key,label,psychology,how_to_talk,how_to_sell,winning_phrases,avoid}]
                winning_tactics TEXT DEFAULT '[]',   -- JSON array of strings
                losing_patterns TEXT DEFAULT '[]',   -- JSON array of strings
                summary TEXT DEFAULT '',
                sample_size INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                approved INTEGER DEFAULT 1,           -- owner approval gate
                generated_at REAL DEFAULT (strftime('%s','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_playbook_store ON store_playbooks(store_id);
            CREATE INDEX IF NOT EXISTS idx_playbook_active ON store_playbooks(store_id, is_active);
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
        # Also add api_token, webhook_url, and MAIE learning columns if missing
        all_migrations = {
            **sales_columns,
            "api_token": "TEXT DEFAULT ''",
            "webhook_url": "TEXT DEFAULT ''",
            # MAIE: auto-learning controls
            "auto_learning_enabled": "INTEGER DEFAULT 1",   # master on/off per store
            "learning_autoapprove": "INTEGER DEFAULT 1",    # apply new playbooks without manual approval
            "learning_last_run": "REAL DEFAULT 0",          # last Teacher-job timestamp
        }
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
    "auto_learning_enabled", "learning_autoapprove", "learning_last_run",
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


# ── MAIE: Learning Signals ──────────────────────────────────

def record_learning_signal(store_id: str, visitor_hash: str, language: str,
                           outcome: str, quality_score: float, exchange_count: int,
                           transcript: str, persona: str = "", sentiment: str = "") -> bool:
    """Store one distilled, PII-stripped session signal for later distillation.
    Never throws — learning must never break the live chat path."""
    try:
        with get_db() as db:
            db.execute(
                """INSERT INTO learning_signals
                   (store_id, visitor_hash, language, persona, sentiment,
                    outcome, quality_score, exchange_count, transcript)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (store_id, visitor_hash, language, persona, sentiment,
                 outcome, quality_score, exchange_count, transcript[:4000])
            )
        return True
    except Exception as e:
        logger.warning(f"Learning signal error: {e}")
        return False


def clear_recent_unprocessed_signal(store_id: str, visitor_hash: str,
                                    within_seconds: int = 7200) -> None:
    """Drop a visitor's recent un-distilled signal so an ongoing session
    is represented by ONE evolving row instead of one row per turn."""
    cutoff = time.time() - within_seconds
    try:
        with get_db() as db:
            db.execute(
                """DELETE FROM learning_signals
                   WHERE store_id = ? AND visitor_hash = ? AND processed = 0 AND created_at >= ?""",
                (store_id, visitor_hash, cutoff)
            )
    except Exception as e:
        logger.warning(f"clear_recent_unprocessed_signal error: {e}")


def get_unprocessed_signals(store_id: str, limit: int = 200,
                            min_quality: float = 0.0) -> list:
    """Fetch signals not yet folded into a playbook, highest quality first."""
    with get_db() as db:
        rows = db.execute(
            """SELECT * FROM learning_signals
               WHERE store_id = ? AND processed = 0 AND quality_score >= ?
               ORDER BY quality_score DESC, created_at DESC LIMIT ?""",
            (store_id, min_quality, limit)
        ).fetchall()
        return [dict(r) for r in rows]


def mark_signals_processed(signal_ids: list) -> None:
    if not signal_ids:
        return
    with get_db() as db:
        placeholders = ",".join("?" * len(signal_ids))
        db.execute(
            f"UPDATE learning_signals SET processed = 1 WHERE id IN ({placeholders})",
            list(signal_ids)
        )


def get_signal_count(store_id: str, only_unprocessed: bool = False) -> int:
    q = "SELECT COUNT(*) as cnt FROM learning_signals WHERE store_id = ?"
    if only_unprocessed:
        q += " AND processed = 0"
    with get_db() as db:
        return db.execute(q, (store_id,)).fetchone()["cnt"]


def get_persona_distribution(store_id: str) -> list:
    """Who actually shops here: per-persona share, win-rate and engagement,
    computed from captured learning signals. Powers the owner-facing
    'What Mark Learned' insight. Returns highest-volume persona first."""
    with get_db() as db:
        rows = db.execute(
            """SELECT persona,
                      COUNT(*) AS total,
                      SUM(CASE WHEN outcome = 'converted' THEN 1 ELSE 0 END) AS converted,
                      SUM(CASE WHEN outcome IN ('converted','engaged') THEN 1 ELSE 0 END) AS engaged,
                      AVG(quality_score) AS avg_quality
               FROM learning_signals
               WHERE store_id = ? AND persona IS NOT NULL AND persona != ''
               GROUP BY persona
               ORDER BY total DESC""",
            (store_id,)
        ).fetchall()
    result = []
    for r in rows:
        total = r["total"] or 0
        converted = r["converted"] or 0
        engaged = r["engaged"] or 0
        result.append({
            "persona": r["persona"],
            "total": total,
            "converted": converted,
            "win_rate": round(converted / total, 3) if total else 0.0,
            "engage_rate": round(engaged / total, 3) if total else 0.0,
            "avg_quality": round(r["avg_quality"] or 0.0, 3),
        })
    return result


def prune_old_signals(store_id: str, keep_days: int = 90) -> int:
    """Delete processed signals older than keep_days to bound storage."""
    cutoff = time.time() - keep_days * 86400
    with get_db() as db:
        cur = db.execute(
            "DELETE FROM learning_signals WHERE store_id = ? AND processed = 1 AND created_at < ?",
            (store_id, cutoff)
        )
        return cur.rowcount


# ── MAIE: Store Playbooks ───────────────────────────────────

def save_playbook(store_id: str, personas: list, winning_tactics: list,
                  losing_patterns: list, summary: str, sample_size: int,
                  approved: bool = True) -> int:
    """Insert a new playbook version and make it the active one (if approved).
    Returns the new version number."""
    with get_db() as db:
        prev = db.execute(
            "SELECT MAX(version) as v FROM store_playbooks WHERE store_id = ?",
            (store_id,)
        ).fetchone()
        version = (prev["v"] or 0) + 1
        # Only the newly approved playbook should be active.
        if approved:
            db.execute(
                "UPDATE store_playbooks SET is_active = 0 WHERE store_id = ?",
                (store_id,)
            )
        db.execute(
            """INSERT INTO store_playbooks
               (store_id, version, personas, winning_tactics, losing_patterns,
                summary, sample_size, is_active, approved)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (store_id, version,
             json.dumps(personas, ensure_ascii=False),
             json.dumps(winning_tactics, ensure_ascii=False),
             json.dumps(losing_patterns, ensure_ascii=False),
             summary[:4000], sample_size,
             1 if approved else 0, 1 if approved else 0)
        )
        return version


def _hydrate_playbook(row: dict) -> dict:
    """Parse JSON columns into Python objects."""
    def _load(s, default):
        try:
            return json.loads(s) if s else default
        except Exception:
            return default
    row["personas"] = _load(row.get("personas"), [])
    row["winning_tactics"] = _load(row.get("winning_tactics"), [])
    row["losing_patterns"] = _load(row.get("losing_patterns"), [])
    return row


def get_active_playbook(store_id: str) -> dict | None:
    with get_db() as db:
        row = db.execute(
            """SELECT * FROM store_playbooks
               WHERE store_id = ? AND is_active = 1 AND approved = 1
               ORDER BY version DESC LIMIT 1""",
            (store_id,)
        ).fetchone()
        return _hydrate_playbook(dict(row)) if row else None


def get_playbook_history(store_id: str, limit: int = 20) -> list:
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM store_playbooks WHERE store_id = ? ORDER BY version DESC LIMIT ?",
            (store_id, limit)
        ).fetchall()
        return [_hydrate_playbook(dict(r)) for r in rows]


def update_playbook(playbook_id: int, store_id: str, **fields) -> bool:
    """Owner edit/approve of a playbook. Whitelisted fields only."""
    allowed = {"personas", "winning_tactics", "losing_patterns", "summary",
               "is_active", "approved"}
    safe = {}
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k in ("personas", "winning_tactics", "losing_patterns") and not isinstance(v, str):
            v = json.dumps(v, ensure_ascii=False)
        safe[k] = v
    if not safe:
        return False
    with get_db() as db:
        # If activating this one, deactivate siblings first.
        if safe.get("is_active"):
            db.execute("UPDATE store_playbooks SET is_active = 0 WHERE store_id = ?", (store_id,))
        sets = ", ".join(f"{k} = ?" for k in safe)
        vals = list(safe.values()) + [playbook_id, store_id]
        db.execute(
            f"UPDATE store_playbooks SET {sets} WHERE id = ? AND store_id = ?", vals
        )
    return True


def set_learning_last_run(store_id: str) -> None:
    with get_db() as db:
        db.execute("UPDATE stores SET learning_last_run = ? WHERE store_id = ?",
                   (time.time(), store_id))


# ── Initialize on import ────────────────────────────────────
init_db()
