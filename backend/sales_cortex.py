"""Project Cortex — Phase 3: Sales Cortex runtime.

Loads the compiled doctrine (doctrine_v1.json) and, per chat turn, builds ONE
compact <sales_doctrine> block to inject into Mark's system prompt:

    CORE  +  current STAGE  +  detected PERSONA  +  matched OBJECTION (if any)

All detection is pure-Python heuristics on the hot path — ZERO extra LLM calls,
negligible latency. Global kill-switch via env SALES_CORTEX (default on); set
SALES_CORTEX=0 to instantly fall back to pre-Cortex behaviour.
"""
import os
import json
import logging

logger = logging.getLogger("mark.cortex")

ENABLED = os.environ.get("SALES_CORTEX", "1").strip() not in ("0", "false", "False", "")
_DOCTRINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "knowledge", "doctrine_v1.json")


def _load_doctrine():
    try:
        with open(_DOCTRINE_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as e:
        logger.warning(f"Sales Cortex: doctrine load failed ({e}) — Cortex disabled")
        return None


DOCTRINE = _load_doctrine()


# ── helpers ──────────────────────────────────────────────────
def _user_messages(messages):
    return [m for m in messages
            if m.get("role") == "user" and not (m.get("content") or "").startswith("[")]


def _last_user_text(messages):
    for m in reversed(messages):
        if m.get("role") == "user":
            c = m.get("content") or ""
            if not c.startswith("["):
                return c
    return ""


def _hit(text: str, keywords) -> bool:
    return any(k in text for k in keywords)


# ── stage machine (heuristic) ────────────────────────────────
def detect_stage(messages, signals) -> str:
    users = _user_messages(messages)
    n = len(users)
    last = (_last_user_text(messages) or "").lower()
    bare = last.strip().strip("!.?, ")

    if n == 0:
        return "GREET"
    # An objection takes priority — resolve before anything else. Enter OBJECTION
    # on either the objection signal lexicon OR a concrete objection-card match
    # (e.g. "difference"/"size" live only in the cards, not the lexicon).
    if _hit(last, signals["objection"]) or (DOCTRINE and match_objection(last, DOCTRINE)):
        return "OBJECTION"
    # Explicit purchase intent OR a bare "yes/haan" after an offer → close.
    if _hit(last, signals["buying_high"]) or bare in signals["affirmation"]:
        return "CLOSE"
    if n == 1:
        return "DISCOVER"
    return "PRESENT"


def match_objection(text, doctrine):
    t = (text or "").lower()
    for o in doctrine["objections"]:
        if _hit(t, o["triggers"]):
            return o
    return None


def has_buying_signal(messages) -> bool:
    """Exposed for callers (e.g. analytics): did the visitor show purchase intent?"""
    if not DOCTRINE:
        return False
    t = (_last_user_text(messages) or "").lower()
    return _hit(t, DOCTRINE["signals"]["buying_high"])


# ── the one function chat_endpoint calls ─────────────────────
def build_cortex_block(messages, persona: str) -> str:
    """Return a compact <sales_doctrine> block for THIS turn, or '' if disabled."""
    if not ENABLED or not DOCTRINE:
        return ""
    try:
        signals = DOCTRINE["signals"]
        last = _last_user_text(messages)
        stage = detect_stage(messages, signals)

        parts = ["<sales_doctrine>", DOCTRINE["core"]]

        stage_block = DOCTRINE["stages"].get(stage)
        if stage_block:
            parts.append(stage_block)

        persona_block = DOCTRINE["personas"].get(persona)
        if persona_block:
            parts.append(persona_block)

        if stage == "OBJECTION":
            obj = match_objection(last, DOCTRINE)
            if obj:
                ex = obj.get("example_en", "")
                parts.append(f"OBJECTION [{obj['category']}]: {obj['reframe']}"
                             + (f" e.g. \"{ex}\"" if ex else ""))

        parts.append("</sales_doctrine>")
        return "\n".join(parts) + "\n"
    except Exception as e:
        logger.warning(f"build_cortex_block failed: {e}")
        return ""


def debug_trace(messages, persona: str) -> dict:
    """For evals/tests: what did Cortex decide this turn?"""
    if not DOCTRINE:
        return {"enabled": ENABLED, "doctrine": False}
    last = _last_user_text(messages)
    stage = detect_stage(messages, DOCTRINE["signals"])
    obj = match_objection(last, DOCTRINE) if stage == "OBJECTION" else None
    return {
        "enabled": ENABLED,
        "stage": stage,
        "persona": persona,
        "objection": obj["id"] if obj else None,
        "buying_signal": has_buying_signal(messages),
    }
