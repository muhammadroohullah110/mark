# Mark AI — Architecture Audit & Correction Plan
*Team-lead review · 2026-06-20 · v1.9.x*

Honest, prioritized review of Mark's core. Mark = **WordPress plugin** (admin SPA + 3D widget) ⇄ **FastAPI backend** (LLM / TTS / STT / RAG / learning / billing) on **Render + Postgres**, positioned as the "World's First Digital Salesman."

---

## 0. System map (so we agree on the surface)
```
Visitor → Widget (chatbot.js, Three.js robot)
   ├─ HEARING : browser SpeechRecognition (en-US)  | backend Whisper /api/transcribe
   ├─ THINKING: backend /api/chat → LLMRouter (Kimi-on-Groq → Moonshot → OpenAI)
   │             + system prompt + MAIE playbook + Sales Cortex doctrine
   └─ SPEAKING: backend /api/tts (Edge free | OpenAI/Cartesia premium)
Owner → Admin SPA (admin.js ~110KB, inline-token design system)
   └─ 6-page IA: Home · Mark's Brain · Voice · Conversations · Appearance · Plan
Backend: FastAPI + Postgres, MAIE learning loop, Stripe billing, RAG (TF-IDF)
```

---

## 1. BUGS (severity-ranked)

### P0 — correctness / trust / security
| # | Bug | Status |
|---|---|---|
| 1 | **Recent-chat date shows `1/21/1970`** — `created_at` is Unix **seconds**, parsed as **ms**. | ✅ FIXED (formatDate seconds→ms) |
| 2 | **Dual data path** — chats log to the **backend**, but the WP `/dashboard` mirror is empty, so admin KPIs read 0 while backend tiles read real numbers (the "8 vs 0"). | 🟡 Partly fixed (KPIs now read backend); WP mirror should be deprecated as a source of truth. |
| 3 | **False name capture** — "I'm sorry" → name "Sorry" → wrong "Welcome back" + celebration; cached in localStorage. | ✅ FIXED (looksLikeName + NOT_A_NAME + auto-heal) |
| 4 | **SECURITY: a live Google API key was pasted in chat history** (`AQ.Ab8RN6Km…`). Must be **rotated** — assume compromised. | ✅ Repo scan clean (no live secret committed); rotation still owner action |
| 4b | **Admin password hashing was SHA-256 + a FIXED salt** (no per-user salt; graph-surfaced, `database.py`). Fast hash + shared salt → rainbow-table / brute-force risk if DB leaks. | ✅ FIXED — PBKDF2-HMAC-SHA256, 200k iters, per-user random salt; legacy hashes verified + auto-migrated on login (no lockout) |

### P1 — reliability / consistency
| # | Bug | Fix |
|---|---|---|
| 5 | ~~Render free-tier cold-start~~ | ✅ RESOLVED — owner upgraded to **Render Pro** (warm instance, no spin-down) |
| 6 | **Assistant-name sync gap** — admin renamed Mark via `PUT stores/{id}` → `update_store`, which never synced to the backend tenant, so Mark's **replies** kept the old name (only the widget label updated). | ✅ FIXED — `update_store` now calls `sync_profile_to_backend()` (name/personality/sales → `/api/sync-settings`), turnkey-safe (not gated on a Groq key) |
| 7 | **Visitor identity = localStorage** — clearing it makes one tester look like many visitors (inflated counts) and loses "returning". | Move durable visitor id to a 1st-party cookie + backend visitor row. |
| 8 | **Dead code** — legacy `loadStorePage/renderStoreDetail/renderTab` + old tab system unused after the 6-page redesign. | Delete after confirming `openStore`/delete paths are rewired. |

### P2 — quality / maintainability
| # | Issue | Fix |
|---|---|---|
| 9 | **No automated tests / evals** — risky for an AI-generated codebase (AI-first principle: evals > anecdotes). | Add the Cortex buyer-sim eval + smoke tests for widget chat, name capture, TTS gate, billing webhook. |
| 10 | **Edge TTS is an *unofficial* API** — fine for free tier, but fragile/ToS-grey for a commercial product at scale. | Keep as free fallback; make a paid/cheap official TTS the default once revenue starts. |
| 11 | **Admin SPA = 110KB inline-style monolith** — hard to maintain; per-page renders reuse old forms not yet pixel-matched to Stitch. | Continue Stitch per-page rebuild; consider extracting a small component layer (still no-build). |
| 12 | **Stripe billing built but untested**; **Rive inert** (no `.riv`); **3D model from CDN** (single point of failure). | Test billing end-to-end; commission `.riv`; self-host/bundle the glb with CDN fallback. |

---

## 2. TECH-STACK / DECISIONS to reconsider
| Decision | Why it's risky | Correction |
|---|---|---|
| **Render free tier** | Cold starts (30–60s) → the widget's worst moment is the *first* chat. | Paid warm instance OR keep-alive cron; this is the single highest-ROI reliability fix. |
| **One shared Groq key (turnkey)** | Groq free-tier rate-limits one key across ALL stores → throttling at scale. | **Key pool** (rotate N keys by load) + paid tier; per-store usage caps. |
| **localStorage as visitor memory** | Not durable; inflates analytics; loses "returning". | 1st-party cookie + backend identity. |
| **Dual WP-mirror / backend analytics** | Two sources of truth → the "8 vs 0" class of bug. | **Backend = single source of truth** for all analytics; WP mirror read-through only. |
| **TF-IDF RAG** | Cheap + dependency-light (good call early), but weak for semantic recall. | Fine for now; revisit embeddings when budget allows. |
| **No eval/test harness** | AI-generated code + rapid changes = silent regressions. | Add evals + CI smoke tests (highest long-term ROI). |

**Decisions that were RIGHT (keep):** turnkey no-key model; Kimi-on-Groq + Moonshot fallback (speed + resilience); freemium voice tier (monetization + cost-cover); vanilla-JS no-build admin (portability); Sales Cortex + MAIE (real differentiation); dialect-agnostic DB layer.

---

## 3. PLAN (prioritized, shippable)

**Phase 0 — trust (this week)**
- [x] Fix the `1/21/1970` date.
- [x] Scan repo for committed secrets — clean. **(Owner: still rotate the leaked Google key.)**
- [x] Upgrade admin password hashing to PBKDF2 (graph-surfaced).
- [ ] Make backend the single analytics source (finish the "8 vs 0" cleanup; deprecate WP-mirror counts).

**Phase 1 — reliability (next)**
- [x] ~~Warm the backend~~ — owner upgraded to **Render Pro** (cold-start gone).
- [x] Wire assistant-name + profile sync to the backend tenant.
- [ ] Durable visitor identity (cookie + backend) → honest counts. *(already localStorage-durable; cookie fallback is the remaining nicety)*
- [ ] Delete dead admin code (legacy store-tab system).

**Phase 2 — quality**
- [ ] Eval harness: Cortex buyer-sim (Phase 4/5, the "110% ready" proof) + smoke tests (chat, name, TTS gate, Stripe webhook).
- [ ] End-to-end Stripe billing test; premium-voice verification.
- [ ] Finish per-page Stitch layouts (Voice/Conversations/Appearance/Plan/Tutorial).

**Phase 3 — scale & growth**
- [ ] Groq key pool + per-store usage caps.
- [ ] Shopify app + custom-site embed (turnkey, same central backend).
- [ ] Commission the Mark `.riv` (real designer-authored 3D motion).
- [ ] Voice cloning (premium add-on).

---

## 4. Definition of done (raise the bar)
For every touched domain: a regression assertion, an edge-case check (empty store, cold backend, junk name, free vs premium), and a manual smoke on a real store. No secret in the repo. Analytics consistent across every surface.
