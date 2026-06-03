# ============================================================
# ADMIN PANEL — API Routes
# All admin endpoints: auth, store CRUD, analytics, embed code
# ============================================================

import os
import time
import secrets
import hashlib
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, validator
from typing import Optional, List

from database import (
    create_admin, verify_admin, admin_exists,
    create_store, get_store, get_stores_by_owner, update_store, delete_store,
    get_analytics, hash_password,
)
router = APIRouter(prefix="/admin", tags=["admin"])

# ── Simple token-based auth (no JWT dependency needed) ───────
# In production, use proper JWT. This is secure enough for v1.
_sessions: dict[str, dict] = {}  # token -> {user_id, username, expires}

SESSION_TTL = 86400  # 24 hours


class LoginRequest(BaseModel):
    username: str
    password: str

    @validator("username")
    def username_valid(cls, v):
        if not v or len(v) < 3:
            raise ValueError("Username must be at least 3 characters")
        return v.strip().lower()

    @validator("password")
    def password_valid(cls, v):
        if not v or len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v


class StoreCreateRequest(BaseModel):
    store_name: str
    website_url: str
    assistant_name: Optional[str] = "Mark"
    groq_api_key: Optional[str] = ""


class StoreUpdateRequest(BaseModel):
    store_name: Optional[str] = None
    website_url: Optional[str] = None
    assistant_name: Optional[str] = None
    personality: Optional[str] = None
    greeting_style: Optional[str] = None
    primary_language: Optional[str] = None
    supported_languages: Optional[str] = None
    max_crawl_pages: Optional[int] = None
    idle_timeout: Optional[int] = None
    walking_enabled: Optional[bool] = None
    sound_effects: Optional[bool] = None

    # Voice (Edge TTS — free)
    tts_voice: Optional[str] = None
    tts_voice_urdu: Optional[str] = None
    tts_rate: Optional[str] = None
    tts_pitch: Optional[str] = None

    # AI
    groq_api_key: Optional[str] = None
    llm_model: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None

    # Limits
    rate_chat: Optional[int] = None
    rate_tts: Optional[int] = None
    rate_transcribe: Optional[int] = None

    # Custom prompt
    custom_system_prompt: Optional[str] = None

    # Sales intelligence
    sales_mode: Optional[str] = None
    sales_greeting: Optional[str] = None
    sales_cta_text: Optional[str] = None
    sales_cta_url: Optional[str] = None
    sales_objection_handling: Optional[str] = None
    sales_cross_sell: Optional[str] = None
    sales_urgency_triggers: Optional[str] = None
    sales_tone: Optional[str] = None
    sales_followup_enabled: Optional[bool] = None
    sales_max_suggestions: Optional[int] = None

    # Status
    is_active: Optional[bool] = None


def get_current_user(request: Request) -> dict:
    """Extract and validate session token from Authorization header."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = auth[7:]
    session = _sessions.get(token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    if time.time() > session["expires"]:
        del _sessions[token]
        raise HTTPException(status_code=401, detail="Session expired")

    return session


# ── Auth Endpoints ───────────────────────────────────────────

@router.post("/setup")
def admin_setup(body: LoginRequest):
    """First-time setup — create the admin account. Only works once."""
    if admin_exists():
        raise HTTPException(status_code=400, detail="Admin already exists. Use /admin/login instead.")

    success = create_admin(body.username, body.password)
    if not success:
        raise HTTPException(status_code=400, detail="Could not create admin account.")

    return {"message": "Admin account created! You can now login.", "username": body.username}


@router.post("/login")
def admin_login(body: LoginRequest):
    """Login and get a session token."""
    user = verify_admin(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = secrets.token_hex(32)
    _sessions[token] = {
        "user_id": user["id"],
        "username": user["username"],
        "expires": time.time() + SESSION_TTL,
    }

    # Clean expired sessions
    now = time.time()
    expired = [k for k, v in _sessions.items() if now > v["expires"]]
    for k in expired:
        del _sessions[k]

    return {
        "token": token,
        "username": user["username"],
        "expires_in": SESSION_TTL,
    }


@router.post("/logout")
def admin_logout(request: Request):
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        _sessions.pop(auth[7:], None)
    return {"message": "Logged out"}


@router.get("/me")
def admin_me(user: dict = Depends(get_current_user)):
    return {"username": user["username"], "user_id": user["user_id"]}


@router.get("/check-setup")
def check_setup():
    """Check if admin account exists (for first-time setup flow)."""
    return {"admin_exists": admin_exists()}


# ── Store CRUD ───────────────────────────────────────────────

@router.post("/stores")
def create_store_endpoint(body: StoreCreateRequest, user: dict = Depends(get_current_user)):
    """Create a new store (tenant)."""
    store_id = create_store(
        owner_id=user["user_id"],
        store_name=body.store_name,
        website_url=body.website_url,
        assistant_name=body.assistant_name or "Mark",
        groq_api_key=body.groq_api_key or "",
    )
    return {"store_id": store_id, "message": "Store created!"}


@router.get("/stores")
def list_stores(user: dict = Depends(get_current_user)):
    """List all stores owned by this admin."""
    stores = get_stores_by_owner(user["user_id"])
    # Mask sensitive keys
    for s in stores:
        if s.get("groq_api_key"):
            s["groq_api_key"] = s["groq_api_key"][:8] + "..." + s["groq_api_key"][-4:]
    return {"stores": stores}


@router.get("/stores/{store_id}")
def get_store_endpoint(store_id: str, user: dict = Depends(get_current_user)):
    """Get full store details."""
    store = get_store(store_id)
    if not store or store["owner_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Store not found")
    if store.get("groq_api_key"):
        key = store["groq_api_key"]
        store["groq_api_key_masked"] = key[:8] + "..." + key[-4:] if len(key) > 12 else "***"
        store["groq_api_key"] = ""
    return {"store": store}


@router.put("/stores/{store_id}")
def update_store_endpoint(store_id: str, body: StoreUpdateRequest, user: dict = Depends(get_current_user)):
    """Update store settings."""
    store = get_store(store_id)
    if not store or store["owner_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Store not found")

    updates = {k: v for k, v in body.dict().items() if v is not None}

    # Convert booleans to int for SQLite
    for key in ["walking_enabled", "sound_effects", "is_active", "sales_followup_enabled"]:
        if key in updates:
            updates[key] = 1 if updates[key] else 0

    if updates:
        update_store(store_id, **updates)

    return {"message": "Store updated!", "store_id": store_id}


@router.delete("/stores/{store_id}")
def delete_store_endpoint(store_id: str, user: dict = Depends(get_current_user)):
    """Delete a store and all its data."""
    store = get_store(store_id)
    if not store or store["owner_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Store not found")

    delete_store(store_id)
    return {"message": "Store deleted", "store_id": store_id}


# ── Analytics ────────────────────────────────────────────────

@router.get("/stores/{store_id}/analytics")
def store_analytics(store_id: str, user: dict = Depends(get_current_user)):
    """Get analytics for a specific store."""
    store = get_store(store_id)
    if not store or store["owner_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Store not found")

    analytics = get_analytics(store_id)
    return analytics


# ── Dashboard Summary ───────────────────────────────────────

@router.get("/dashboard")
def admin_dashboard(user: dict = Depends(get_current_user)):
    """Get overall dashboard stats across all stores."""
    stores = get_stores_by_owner(user["user_id"])
    total_stores = len(stores)
    active_stores = sum(1 for s in stores if s.get("is_active"))

    total_convos = 0
    today_convos = 0
    all_languages = {}

    for s in stores:
        analytics = get_analytics(s["store_id"])
        total_convos += analytics["total_conversations"]
        today_convos += analytics["today"]
        for lang, count in analytics["languages"].items():
            all_languages[lang] = all_languages.get(lang, 0) + count

    return {
        "total_stores": total_stores,
        "active_stores": active_stores,
        "total_conversations": total_convos,
        "today_conversations": today_convos,
        "languages": all_languages,
        "stores": [
            {
                "store_id": s["store_id"],
                "store_name": s["store_name"],
                "website_url": s["website_url"],
                "assistant_name": s["assistant_name"],
                "is_active": bool(s["is_active"]),
            }
            for s in stores
        ],
    }
