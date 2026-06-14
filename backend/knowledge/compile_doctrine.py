"""Project Cortex — Phase 2: Doctrine Compiler.

Reads the human-authored corpus cards (corpus/*.json) and compiles them into ONE
compact runtime artifact `doctrine_v1.json` that the Sales Cortex (Phase 3) injects
into Mark's prompt. Design goals:
  - A small always-on CORE block (~one paragraph).
  - One compact block PER STAGE and PER PERSONA, injected dynamically (only the
    current stage + detected persona block is added per request → low tokens).
  - A flat objection index (trigger keyword -> compact reframe) for the matcher.
  - The signal lexicon for the detector.

Run:  python backend/knowledge/compile_doctrine.py
Output: backend/knowledge/doctrine_v1.json  (+ prints a token-budget report)
"""
import json
import glob
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus")
OUT = os.path.join(HERE, "doctrine_v1.json")

# rough token estimate (≈ chars/4) — good enough for a budget gate
def toks(s: str) -> int:
    return max(1, round(len(s) / 4))


def load(name: str) -> dict:
    with open(os.path.join(CORPUS, f"{name}.json"), "r", encoding="utf-8") as fh:
        return json.load(fh)


# ── CORE doctrine (always on) — distilled from the corpus principles ──
CORE = (
    "You are a master digital salesman for this store. Move the shopper toward a confident "
    "purchase, ethically and warmly. "
    "HARD RULES: never invent prices, stock, discounts, guarantees, delivery times or policies — "
    "state ONLY what the catalog/website data shows; if unknown, point to the page. "
    "Keep replies 1-3 short sentences (voice-first). Always reply in clear, natural English "
    "(even if the visitor writes in another language). Ask one question at a time. "
    "FLOW: greet → understand the need → recommend 2-4 real products with price + link → "
    "handle objections with LAER (Listen, Acknowledge, Explore, Respond) → close on a buying signal → reassure. "
    "NEVER hedge ('still loading'), never repeat an offer they already accepted, never hard-sell a browser."
)

# ── PERSONA playbooks (MAIE persona key -> selling emphasis), grounded in psychology+objections ──
PERSONAS = {
    "price_hunter": "PRICE HUNTER: lead with value and the best-priced fit; anchor on what they get; "
                    "offer a cheaper catalog option if they balk; NEVER invent a discount.",
    "researcher":   "RESEARCHER: give concrete specifics from the catalog; compare at most 2 options on "
                    "what they care about, then recommend ONE (avoid choice overload).",
    "impulse_buyer":"IMPULSE BUYER: be fast and decisive — one great pick + link now; light, genuine urgency only.",
    "skeptic":      "SKEPTIC: build trust first — popularity/returns/quality from data, be specific, no overclaiming; "
                    "reassure before closing.",
    "gift_buyer":   "GIFT BUYER: ask who it's for and the occasion; suggest a confident pick; help them picture gifting it.",
    "browser":      "CASUAL BROWSER: low pressure; surface popular picks; plant ONE link; invite, don't push.",
}


def build():
    stages_card = load("stages")
    objections_card = load("objections")
    signals_card = load("buying_signals")

    # Per-stage compact blocks from the stage card's goal + moves
    stage_blocks = {}
    for st in stages_card["stages"]:
        moves = "; ".join(st.get("moves", []))
        stage_blocks[st["id"]] = f"STAGE {st['id']} — {st['goal']} Do: {moves}."

    # Flat objection index: trigger keyword -> compact reframe (acknowledge + respond + 1 example)
    objection_index = []
    for o in objections_card["items"]:
        line = o.get("acknowledge") or ""
        reframe = (line + " " + o.get("respond", "")).strip()
        objection_index.append({
            "id": o["id"],
            "category": o["category"],
            "triggers": o["triggers"],
            "personas": o.get("persona_fit", []),
            "reframe": reframe[:240],
            "example_en": o.get("example_en", ""),
            "example_ur": o.get("example_ur", ""),
        })

    doctrine = {
        "version": 1,
        "compiled_from": sorted(os.path.basename(p) for p in glob.glob(os.path.join(CORPUS, "*.json"))),
        "core": CORE,
        "stages": stage_blocks,
        "personas": PERSONAS,
        "objections": objection_index,
        "signals": {
            "buying_high": signals_card["buying"]["high"],
            "buying_medium": signals_card["buying"]["medium"],
            "objection": signals_card["objection"],
            "affirmation": signals_card["affirmation"],
            "negative_exit": signals_card.get("negative_exit", []),
        },
    }
    return doctrine


def report(d: dict):
    core_t = toks(d["core"])
    stage_t = {k: toks(v) for k, v in d["stages"].items()}
    persona_t = {k: toks(v) for k, v in d["personas"].items()}
    max_stage = max(stage_t.values())
    max_persona = max(persona_t.values())
    # Worst-case per-request injection = core + 1 stage + 1 persona + (avg objection reframe)
    worst_obj = max((toks(o["reframe"] + o["example_en"]) for o in d["objections"]), default=0)
    per_request = core_t + max_stage + max_persona + worst_obj

    print("-- Doctrine token budget --")
    print(f"core:                 {core_t} tokens")
    print(f"max stage block:      {max_stage}")
    print(f"max persona block:    {max_persona}")
    print(f"worst objection card: {worst_obj}")
    print(f"WORST-CASE per request injection: ~{per_request} tokens")
    print(f"objections indexed:   {len(d['objections'])}")
    # Gates (from the Phase 2 plan: <= ~800 extra tokens/request)
    assert core_t <= 450, f"core too big: {core_t}"
    assert max_stage <= 160, f"stage block too big: {max_stage}"
    assert max_persona <= 160, f"persona block too big: {max_persona}"
    assert per_request <= 800, f"per-request injection too big: {per_request}"
    print("GATE PASS (<=800 tokens/request)")


if __name__ == "__main__":
    d = build()
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(d, fh, ensure_ascii=False, indent=2)
    print(f"Compiled -> {os.path.relpath(OUT)}")
    report(d)
