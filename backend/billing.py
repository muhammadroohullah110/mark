"""Stripe billing for the premium voice tier.

Env-gated: if STRIPE_SECRET_KEY / STRIPE_PRICE_ID aren't set, billing is INERT
(is_configured() == False) and the plugin shows an "upgrade coming soon" state.
Stores never self-upgrade — `plan` flips to 'premium' ONLY via the Stripe webhook
(payment confirmed) or a manual platform action.
"""
import os
import json
import logging

logger = logging.getLogger("mark.billing")

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_PRICE_ID = os.getenv("STRIPE_PRICE_ID", "")            # premium subscription price id
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
BILLING_SUCCESS_URL = os.getenv("BILLING_SUCCESS_URL", "https://markai.shop/?upgrade=success")
BILLING_CANCEL_URL = os.getenv("BILLING_CANCEL_URL", "https://markai.shop/?upgrade=cancelled")


def is_configured() -> bool:
    return bool(STRIPE_SECRET_KEY and STRIPE_PRICE_ID)


def _stripe():
    import stripe
    stripe.api_key = STRIPE_SECRET_KEY
    return stripe


def create_checkout_session(store_id: str, store_name: str = "",
                            success_url: str = "", cancel_url: str = "") -> str:
    """Create a Stripe Checkout session for the premium subscription. Returns its URL."""
    s = _stripe()
    success = (success_url or BILLING_SUCCESS_URL)
    sep = "&" if "?" in success else "?"
    session = s.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": STRIPE_PRICE_ID, "quantity": 1}],
        success_url=f"{success}{sep}session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=(cancel_url or BILLING_CANCEL_URL),
        client_reference_id=str(store_id),
        metadata={"store_id": str(store_id), "store_name": store_name},
        subscription_data={"metadata": {"store_id": str(store_id)}},
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


def plan_change_from_event(event: dict):
    """Map a Stripe event → (store_id, new_plan, extra_fields) or None if irrelevant.

    Premium ON: checkout.session.completed / customer.subscription.created/updated(active)
    Premium OFF: customer.subscription.deleted / updated(canceled/unpaid)
    """
    etype = event.get("type", "")
    obj = (event.get("data", {}) or {}).get("object", {}) or {}
    meta = obj.get("metadata", {}) or {}
    store_id = meta.get("store_id") or obj.get("client_reference_id")

    if etype == "checkout.session.completed":
        return (store_id, "premium", {
            "stripe_customer_id": obj.get("customer", "") or "",
            "stripe_subscription_id": obj.get("subscription", "") or "",
        })
    if etype in ("customer.subscription.created", "customer.subscription.updated"):
        status = obj.get("status", "")
        new_plan = "premium" if status in ("active", "trialing") else "free"
        return (store_id, new_plan, {
            "stripe_customer_id": obj.get("customer", "") or "",
            "stripe_subscription_id": obj.get("id", "") or "",
        })
    if etype == "customer.subscription.deleted":
        return (store_id, "free", {})
    return None
