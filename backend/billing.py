"""Stripe billing for Mark's paid plans.

Env-gated: if STRIPE_SECRET_KEY plus at least one price aren't set, billing is
INERT (is_configured() == False) and the plugin shows an "upgrade coming soon"
state. Stores never self-upgrade — `plan` flips ONLY via the Stripe webhook
(payment confirmed) or a manual platform action.

MULTI-TIER: one `plan` field drives BOTH quota and premium voice. A price id maps
to a plan via `STRIPE_PRICE_TIERS` (JSON {price_id: plan}); the legacy single
`STRIPE_PRICE_ID` is folded in as -> 'premium' so old setups keep working. The
target plan rides in checkout metadata, so the webhook never has to guess.
"""
import os
import json
import logging

logger = logging.getLogger("mark.billing")

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_PRICE_ID = os.getenv("STRIPE_PRICE_ID", "")            # legacy single premium price id
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
BILLING_SUCCESS_URL = os.getenv("BILLING_SUCCESS_URL", "https://markai.shop/?upgrade=success")
BILLING_CANCEL_URL = os.getenv("BILLING_CANCEL_URL", "https://markai.shop/?upgrade=cancelled")

_PAID_PLANS = ("starter", "pro", "business", "premium")


def _price_tiers() -> dict:
    """{price_id: plan}. Merges STRIPE_PRICE_TIERS (JSON) + legacy STRIPE_PRICE_ID."""
    tiers = {}
    raw = os.getenv("STRIPE_PRICE_TIERS", "").strip()
    if raw:
        try:
            for pid, plan in (json.loads(raw) or {}).items():
                if plan in _PAID_PLANS:
                    tiers[str(pid)] = plan
        except Exception as e:
            logger.error(f"STRIPE_PRICE_TIERS is not valid JSON, ignoring: {e}")
    if STRIPE_PRICE_ID and STRIPE_PRICE_ID not in tiers:
        tiers[STRIPE_PRICE_ID] = "premium"
    return tiers


def price_for_plan(plan: str) -> str:
    """Reverse lookup: the Stripe price id that grants `plan` (or '')."""
    for pid, p in _price_tiers().items():
        if p == plan:
            return pid
    return ""


def _plan_for_price(price_id: str) -> str:
    """A subscription's price id -> plan. Unknown active price -> 'premium' (safe default)."""
    if not price_id:
        return "premium"
    return _price_tiers().get(str(price_id), "premium")


def is_configured() -> bool:
    return bool(STRIPE_SECRET_KEY and (STRIPE_PRICE_ID or _price_tiers()))


def _stripe():
    import stripe
    stripe.api_key = STRIPE_SECRET_KEY
    return stripe


def create_checkout_session(store_id: str, store_name: str = "", plan: str = "premium",
                            success_url: str = "", cancel_url: str = "") -> str:
    """Create a Stripe Checkout session for a paid plan. Returns its URL.

    The target `plan` is stamped into metadata so the webhook applies it directly
    instead of inferring it from the price (no extra API round-trip, no ambiguity).
    """
    plan = plan if plan in _PAID_PLANS else "premium"
    price_id = price_for_plan(plan) or STRIPE_PRICE_ID
    if not price_id:
        raise RuntimeError(f"No Stripe price configured for plan '{plan}'")
    s = _stripe()
    success = (success_url or BILLING_SUCCESS_URL)
    sep = "&" if "?" in success else "?"
    session = s.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"{success}{sep}session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=(cancel_url or BILLING_CANCEL_URL),
        client_reference_id=str(store_id),
        metadata={"store_id": str(store_id), "store_name": store_name, "plan": plan},
        subscription_data={"metadata": {"store_id": str(store_id), "plan": plan}},
        allow_promotion_codes=True,
    )
    return session.url


def parse_event(payload: bytes, sig_header: str):
    """Verify and parse a Stripe webhook event.

    FAIL-CLOSED: without STRIPE_WEBHOOK_SECRET we REFUSE the webhook. Previously
    this fell back to json.loads() on UNSIGNED input — meaning anyone could POST
    a fake 'payment succeeded' event and flip any store to premium for free.
    Plan changes must come from a Stripe-signed event, never raw JSON.
    """
    if not STRIPE_WEBHOOK_SECRET:
        raise RuntimeError("STRIPE_WEBHOOK_SECRET not configured — refusing unsigned webhook")
    s = _stripe()
    return s.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)


def _price_id_from_subscription(obj: dict) -> str:
    """First line-item price id off a subscription object (Stripe nests it deep)."""
    try:
        return ((obj.get("items", {}) or {}).get("data", []) or [{}])[0].get("price", {}).get("id", "") or ""
    except Exception:
        return ""


def plan_change_from_event(event: dict):
    """Map a Stripe event → (store_id, new_plan, extra_fields) or None if irrelevant.

    UPGRADE: checkout.session.completed uses the plan stamped in metadata;
    customer.subscription.created/updated(active) resolves the plan from its price id
    (so plan changes made in the Stripe customer portal apply too).
    DOWNGRADE: customer.subscription.deleted / updated(canceled/unpaid) → 'free'.
    """
    etype = event.get("type", "")
    obj = (event.get("data", {}) or {}).get("object", {}) or {}
    meta = obj.get("metadata", {}) or {}
    store_id = meta.get("store_id") or obj.get("client_reference_id")

    if etype == "checkout.session.completed":
        plan = meta.get("plan") if meta.get("plan") in _PAID_PLANS else "premium"
        return (store_id, plan, {
            "stripe_customer_id": obj.get("customer", "") or "",
            "stripe_subscription_id": obj.get("subscription", "") or "",
        })
    if etype in ("customer.subscription.created", "customer.subscription.updated"):
        status = obj.get("status", "")
        if status in ("active", "trialing"):
            new_plan = meta.get("plan") if meta.get("plan") in _PAID_PLANS \
                else _plan_for_price(_price_id_from_subscription(obj))
        else:
            new_plan = "free"
        return (store_id, new_plan, {
            "stripe_customer_id": obj.get("customer", "") or "",
            "stripe_subscription_id": obj.get("id", "") or "",
        })
    if etype == "customer.subscription.deleted":
        return (store_id, "free", {})
    return None
