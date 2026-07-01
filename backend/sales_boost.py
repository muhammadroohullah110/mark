"""Mark Sales Boost — the whole "make Mark a closer" upgrade in one small box.

Two pieces:
  1) sales_directive(): ONE compact prompt block that fuses Alex Hormozi
     (sell the OUTCOME × proof ÷ time × effort) + Andy Elliott (micro-commitment
     yes-ladder, confident close, stall-breakers, value-anchoring) + ETHICAL
     real-stock scarcity. ~130 tokens — persuasion, not bloat.
  2) scrub(): a narrow, precise code-side safety net that NEUTRALIZES fabricated
     coupon codes / %-off offers Mark has no authority to invent — unless the
     store actually configured that offer. Selling that physically can't lie.

Kill-switch: env SALES_BOOST=0.
"""
import os
import re
import logging

logger = logging.getLogger("mark.sales")

ENABLED = os.environ.get("SALES_BOOST", "1").strip() not in ("0", "false", "False", "")

SALES_BLOCK = (
    "<sales_boost>\n"
    "SELL THE OUTCOME, not the spec. For each recommendation: lead with the RESULT the buyer "
    "gets, add quick proof (bestseller / loved by customers), and make it feel easy (fast, simple). "
    "Earn a small yes (\"want me to show you?\") before asking for the sale.\n"
    "CLOSE confidently once there's interest: name the product + price, then ONE real reason to act "
    "now (genuinely low stock or a seasonal moment). For \"let me think about it\" -> ask warmly what's "
    "holding them back, then resolve that ONE thing. For \"best price?\" -> anchor the value, never "
    "apologize for the price.\n"
    "HARD RULE: NEVER invent discounts, coupon codes, %-off, prices, stock, or guarantees — you have "
    "zero authority to create offers. If pushed for a discount, hold the value warmly and steer to the "
    "best-fit product instead.\n"
    "</sales_boost>"
)


def sales_directive(tenant: dict | None = None) -> str:
    """The compact persuasion block to append to Mark's system prompt."""
    return SALES_BLOCK if ENABLED else ""


# ── Safety net: kill FABRICATED money-offers (secondary to the prompt rule) ──
_CODE_RE = re.compile(r"\bcode[:\s]+([A-Z0-9]{4,})\b", re.I)
_PCT_RE = re.compile(r"\b\d{1,3}\s?%\s*(?:off|discount)\b", re.I)


def _configured_offers(tenant: dict | None) -> str:
    t = tenant or {}
    return " ".join(str(t.get(k, "") or "") for k in
                    ("offers", "sales_cta_text", "seasonal_products", "priority_products", "brand_description")).lower()


def scrub(text: str, tenant: dict | None = None) -> str:
    """Neutralize invented coupon codes / %-off Mark isn't authorized to give.
    Precise: a code or %-off that the STORE actually configured is left untouched;
    anything Mark made up is softened. Conservative + logged."""
    if not text or not ENABLED:
        return text
    offers = _configured_offers(tenant)
    cleaned = text

    # Fabricated coupon codes (not present in the store's configured offers)
    for code in set(_CODE_RE.findall(text)):
        if code.lower() not in offers:
            cleaned = re.sub(rf"\bcode[:\s]+{re.escape(code)}\b",
                             "our current offers (ask me!)", cleaned, flags=re.I)

    # Fabricated %-off (only scrub when the store configured NO discount at all)
    if _PCT_RE.search(text) and not _PCT_RE.search(offers):
        cleaned = _PCT_RE.sub("great value", cleaned)

    if cleaned != text:
        logger.warning("sales_boost.scrub: neutralized a fabricated offer in Mark's reply")
    return cleaned
