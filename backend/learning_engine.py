# ============================================================
# MAIE — Mark Adaptive Intelligence Engine
# ------------------------------------------------------------
# A closed learning loop that makes Mark smarter from REAL
# conversations, per store, without LLM fine-tuning.
#
#   CAPTURE  -> filter/score sessions (PII-stripped)
#   DISTILL  -> a "Teacher" LLM turns winning/losing sessions
#               into a structured, versioned PLAYBOOK per store
#   DETECT   -> classify the live visitor's buyer-psychology persona
#   APPLY    -> inject the matching persona strategy + the store's
#               winning tactics into Mark's system prompt at runtime
#
# Design rules:
#   - Learning must NEVER break or slow the live chat path.
#     Hot-path functions (detect_persona, build_playbook_prompt_block)
#     are pure-Python and do zero network I/O.
#   - The expensive Teacher job runs OFF the request path (scheduler).
#   - Everything is a glass box: playbooks are human-readable and
#     editable by the store owner in the admin panel.
# ============================================================

import re
import json
import logging
from typing import Optional

import database as db

logger = logging.getLogger("mark.maie")


# ── Canonical buyer-psychology personas ──────────────────────
# These are the STARTING taxonomy. The Teacher refines per-store
# labels/strategy over time, but it anchors to these keys so the
# real-time detector and the playbook always speak the same language.
CANONICAL_PERSONAS = {
    "price_hunter": {
        "label": "Price Hunter",
        "summary": "Driven by value and deals. Compares, asks about cost, discounts, cheapest option.",
        "signals": ["price", "cost", "cheap", "discount", "deal", "coupon", "afford",
                    "expensive", "budget", "sale", "offer", "kitna", "sasta", "qeemat"],
    },
    "researcher": {
        "label": "Researcher",
        "summary": "Methodical. Wants specs, comparisons, proof, details before deciding.",
        "signals": ["how does", "what is the difference", "compare", "specs", "spec",
                    "material", "ingredients", "review", "vs", "details", "warranty",
                    "size", "dimensions", "fabric", "quality"],
    },
    "impulse_buyer": {
        "label": "Impulse Buyer",
        "summary": "Fast, emotional, ready to act. Reacts to trends, scarcity, looks.",
        "signals": ["want it", "love this", "buy now", "looks amazing", "cute", "cool",
                    "in stock", "ship", "today", "fast", "now", "want this", "le lo"],
    },
    "skeptic": {
        "label": "Skeptic",
        "summary": "Cautious, needs trust. Worries about returns, authenticity, being scammed.",
        "signals": ["real", "legit", "scam", "trust", "return", "refund", "guarantee",
                    "safe", "authentic", "fake", "sure", "genuine", "wapsi"],
    },
    "gift_buyer": {
        "label": "Gift Buyer",
        "summary": "Buying for someone else. Needs guidance, occasion-driven, less self-certain.",
        "signals": ["gift", "present", "for my", "birthday", "anniversary", "for her",
                    "for him", "surprise", "wife", "husband", "mom", "friend", "tohfa"],
    },
    "browser": {
        "label": "Casual Browser",
        "summary": "Just looking. Low intent, exploring, non-committal.",
        "signals": ["just looking", "browsing", "see", "show me", "what do you have",
                    "anything", "maybe", "not sure", "dekh"],
    },
}

DEFAULT_PERSONA = "browser"


# ── PII stripping ────────────────────────────────────────────
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
# Phone-ish: 7+ digits possibly with separators / leading +
_PHONE_RE = re.compile(r"(?<!\w)(\+?\d[\d\s\-().]{6,}\d)(?!\w)")
# Long digit runs (card / cnic / order numbers)
_LONGNUM_RE = re.compile(r"\b\d{6,}\b")
_URL_RE = re.compile(r"https?://\S+")


def strip_pii(text: str) -> str:
    """Remove emails, phone numbers, long digit runs, and URLs from text.
    Learning works on PATTERNS of conversation, never on personal data."""
    if not text:
        return ""
    text = _EMAIL_RE.sub("[email]", text)
    text = _PHONE_RE.sub("[phone]", text)
    text = _LONGNUM_RE.sub("[number]", text)
    text = _URL_RE.sub("[link]", text)
    return text.strip()


# ── Real-time persona detection (hot path, no I/O) ───────────
def detect_persona(messages: list) -> str:
    """Classify the live visitor's buyer persona from their own messages.
    Pure heuristic keyword scoring — runs on the request path, must stay fast.
    `messages` is the chat history (list of {role, content})."""
    user_text = " ".join(
        (m.get("content") or "").lower()
        for m in messages
        if m.get("role") == "user" and not (m.get("content") or "").startswith("[")
    )
    if not user_text.strip():
        return DEFAULT_PERSONA

    scores: dict[str, int] = {}
    for key, spec in CANONICAL_PERSONAS.items():
        score = 0
        for sig in spec["signals"]:
            if sig in user_text:
                score += 1
        if score:
            scores[key] = score

    if not scores:
        return DEFAULT_PERSONA
    # Highest signal count wins; ties broken by taxonomy order.
    return max(scores, key=lambda k: (scores[k], -list(CANONICAL_PERSONAS).index(k)))


# ── Outcome classification + quality scoring ─────────────────
def classify_outcome(exchange_count: int, converted: bool, cta_clicked: bool,
                     negative_exit: bool = False) -> str:
    """Reduce a session to a single learnable outcome label."""
    if converted or cta_clicked:
        return "converted"
    if negative_exit:
        return "bounced"
    if exchange_count >= 3:
        return "engaged"
    if exchange_count <= 1:
        return "bounced"
    return "neutral"


def score_session(outcome: str, exchange_count: int) -> float:
    """Quality score in 0..1. Higher = more useful for learning.
    Clear wins and clear losses are the MOST useful; lukewarm sessions
    teach little, so they score low and are usually filtered out."""
    base = {
        "converted": 1.0,
        "bounced": 0.7,    # losses are valuable lessons
        "engaged": 0.5,
        "neutral": 0.2,
    }.get(outcome, 0.2)
    # A little depth bonus — longer conversations carry more signal.
    depth = min(exchange_count, 8) / 8.0 * 0.2
    return round(min(1.0, base + depth), 3)


def condense_transcript(messages: list, max_chars: int = 1500) -> str:
    """Build a compact, PII-stripped transcript for the Teacher to read."""
    lines = []
    for m in messages:
        role = m.get("role")
        content = (m.get("content") or "").strip()
        if not content or content.startswith("["):
            continue
        if role == "user":
            lines.append("Visitor: " + strip_pii(content))
        elif role == "assistant":
            lines.append("Mark: " + strip_pii(content))
    text = "\n".join(lines)
    return text[:max_chars]


# ── Capture: persist one session signal ──────────────────────
def capture_session_signal(store_id: str, visitor_hash: str, language: str,
                           messages: list, converted: bool = False,
                           cta_clicked: bool = False, negative_exit: bool = False) -> bool:
    """Filter + score + store one session as a learning signal.
    Safe to call fire-and-forget. Low-signal sessions are dropped here."""
    try:
        exchange_count = len([m for m in messages if m.get("role") == "user"
                              and not (m.get("content") or "").startswith("[")])
        if exchange_count == 0:
            return False

        outcome = classify_outcome(exchange_count, converted, cta_clicked, negative_exit)
        quality = score_session(outcome, exchange_count)

        # Filter gate: drop low-signal noise to keep the corpus clean.
        if quality < 0.4:
            return False

        persona = detect_persona(messages)
        transcript = condense_transcript(messages)
        if not transcript:
            return False

        # One evolving row per active session (avoid one signal per turn).
        db.clear_recent_unprocessed_signal(store_id, visitor_hash)

        return db.record_learning_signal(
            store_id=store_id, visitor_hash=visitor_hash, language=language,
            outcome=outcome, quality_score=quality, exchange_count=exchange_count,
            transcript=transcript, persona=persona,
        )
    except Exception as e:
        logger.warning(f"capture_session_signal failed: {e}")
        return False


# ── The Teacher: distill signals into a playbook ─────────────
TEACHER_SYSTEM = """You are a master e-commerce sales psychologist and conversation analyst.
You are given a batch of REAL (anonymized) chat transcripts between an AI shop assistant named Mark and visitors of ONE specific online store, each tagged with an outcome (converted / engaged / bounced).

Your job: distill a concise, ACTIONABLE PLAYBOOK that teaches Mark how the people who shop at THIS store behave psychologically, and how to talk to them and sell to them more effectively.

Anchor every persona to one of these canonical keys: price_hunter, researcher, impulse_buyer, skeptic, gift_buyer, browser. Only include personas you actually see evidence for in the transcripts.

Return ONLY valid minified JSON (no markdown, no commentary) with this exact shape:
{
  "personas": [
    {
      "key": "<one canonical key>",
      "label": "<short human label>",
      "psychology": "<1 sentence: what drives this buyer at this store>",
      "how_to_talk": "<1 sentence: tone/approach that works>",
      "how_to_sell": "<1 sentence: the move that converts them>",
      "winning_phrases": ["<short phrasing that worked>", "..."],
      "avoid": ["<phrasing/behavior that lost them>", "..."]
    }
  ],
  "winning_tactics": ["<store-wide tactic that correlated with conversions>", "..."],
  "losing_patterns": ["<store-wide pattern that correlated with bounces>", "..."],
  "summary": "<2 sentence overview of this store's buyers and what wins>"
}

Rules: Base EVERYTHING on the transcripts provided — never invent generic advice. Keep each string under 160 characters. Max 5 personas, max 6 winning_tactics, max 6 losing_patterns. If evidence is thin, return fewer items rather than guessing."""


def _format_signals_for_teacher(signals: list, max_chars: int = 12000) -> str:
    """Build the user message: outcome-tagged transcripts, budget-bounded."""
    blocks = []
    total = 0
    for s in signals:
        block = (f"--- SESSION (outcome={s['outcome']}, persona_guess={s.get('persona') or '?'}, "
                 f"lang={s.get('language','en')}) ---\n{s['transcript']}\n")
        if total + len(block) > max_chars:
            break
        blocks.append(block)
        total += len(block)
    return "\n".join(blocks)


def _safe_json_parse(text: str) -> Optional[dict]:
    """Parse Teacher output, tolerating accidental markdown fences/prose."""
    if not text:
        return None
    text = text.strip()
    # Strip ```json ... ``` fences if present.
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    # Grab the outermost {...} if there is leading/trailing prose.
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start:end + 1]
    try:
        return json.loads(text)
    except Exception as e:
        logger.warning(f"Teacher JSON parse failed: {e}")
        return None


def _sanitize_playbook(data: dict) -> dict:
    """Clamp/validate the Teacher's JSON to the expected shape and limits."""
    valid_keys = set(CANONICAL_PERSONAS.keys())
    personas = []
    for p in (data.get("personas") or [])[:5]:
        key = p.get("key", "")
        if key not in valid_keys:
            continue
        personas.append({
            "key": key,
            "label": str(p.get("label", CANONICAL_PERSONAS[key]["label"]))[:60],
            "psychology": str(p.get("psychology", ""))[:200],
            "how_to_talk": str(p.get("how_to_talk", ""))[:200],
            "how_to_sell": str(p.get("how_to_sell", ""))[:200],
            "winning_phrases": [str(x)[:160] for x in (p.get("winning_phrases") or [])][:4],
            "avoid": [str(x)[:160] for x in (p.get("avoid") or [])][:4],
        })
    winning = [str(x)[:160] for x in (data.get("winning_tactics") or [])][:6]
    losing = [str(x)[:160] for x in (data.get("losing_patterns") or [])][:6]
    summary = str(data.get("summary", ""))[:600]
    return {"personas": personas, "winning_tactics": winning,
            "losing_patterns": losing, "summary": summary}


# Minimum signals before the Teacher is allowed to (re)write a playbook.
MIN_SIGNALS_TO_TRAIN = 12


def run_teacher(store_id: str, router, model: str = "llama-3.3-70b-versatile",
                min_signals: int = MIN_SIGNALS_TO_TRAIN, auto_approve: bool = True) -> dict:
    """Distill unprocessed signals for one store into a new playbook version.
    Returns a result dict {trained: bool, reason, version?, sample_size?}.
    Runs OFF the request path. `router` is an LLMRouter instance."""
    signals = db.get_unprocessed_signals(store_id, limit=200, min_quality=0.4)
    if len(signals) < min_signals:
        return {"trained": False, "reason": f"not_enough_signals ({len(signals)}/{min_signals})"}

    user_msg = _format_signals_for_teacher(signals)
    if not user_msg.strip():
        return {"trained": False, "reason": "empty_corpus"}

    try:
        raw = router.complete(
            messages=[
                {"role": "system", "content": TEACHER_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            model=model,
            max_tokens=1400,
            temperature=0.3,   # low temp — we want stable, factual distillation
        )
    except Exception as e:
        logger.warning(f"Teacher LLM call failed for {store_id}: {e}")
        return {"trained": False, "reason": f"llm_error: {e}"}

    parsed = _safe_json_parse(raw or "")
    if not parsed:
        return {"trained": False, "reason": "unparseable_output"}

    pb = _sanitize_playbook(parsed)
    if not pb["personas"] and not pb["winning_tactics"]:
        return {"trained": False, "reason": "no_usable_content"}

    version = db.save_playbook(
        store_id=store_id,
        personas=pb["personas"],
        winning_tactics=pb["winning_tactics"],
        losing_patterns=pb["losing_patterns"],
        summary=pb["summary"],
        sample_size=len(signals),
        approved=auto_approve,
    )
    db.mark_signals_processed([s["id"] for s in signals])
    db.set_learning_last_run(store_id)
    db.prune_old_signals(store_id, keep_days=90)

    logger.info(f"MAIE: trained playbook v{version} for {store_id} "
                f"from {len(signals)} signals (approved={auto_approve})")
    return {"trained": True, "reason": "ok", "version": version,
            "sample_size": len(signals), "approved": auto_approve}


# ── Apply: inject playbook into the live system prompt ───────
def build_playbook_prompt_block(playbook: Optional[dict], detected_persona: str) -> str:
    """Render the active playbook into a compact system-prompt block, focused
    on the persona we detected for THIS visitor. Hot path — no I/O.
    Returns '' when there is nothing learned yet."""
    if not playbook:
        return ""

    personas = playbook.get("personas") or []
    matched = next((p for p in personas if p.get("key") == detected_persona), None)

    parts = ["<learned_intelligence>",
             "This store has learned the following from real past conversations. "
             "Use it to adapt naturally — never mention that you are 'trained' or reference this data."]

    if matched:
        parts.append(
            f"CURRENT VISITOR likely fits: {matched.get('label', detected_persona)} — "
            f"{matched.get('psychology', '')}".rstrip(" —"))
        if matched.get("how_to_talk"):
            parts.append(f"HOW TO TALK: {matched['how_to_talk']}")
        if matched.get("how_to_sell"):
            parts.append(f"HOW TO SELL: {matched['how_to_sell']}")
        if matched.get("winning_phrases"):
            parts.append("PHRASING THAT WORKS: " + " | ".join(matched["winning_phrases"][:3]))
        if matched.get("avoid"):
            parts.append("AVOID: " + " | ".join(matched["avoid"][:3]))

    winning = playbook.get("winning_tactics") or []
    if winning:
        parts.append("WINNING TACTICS HERE: " + " ".join(f"({i+1}) {t}" for i, t in enumerate(winning[:4])))

    losing = playbook.get("losing_patterns") or []
    if losing:
        parts.append("DO NOT: " + " ".join(f"({i+1}) {t}" for i, t in enumerate(losing[:4])))

    parts.append("</learned_intelligence>")
    # If we only emitted the header + closing, there's nothing useful.
    if len(parts) <= 3:
        return ""
    return "\n".join(parts) + "\n"
