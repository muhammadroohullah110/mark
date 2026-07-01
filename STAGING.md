# Staging + CI — how Mark ships safely

**The problem this fixes:** one backend serves *all* stores. A single bad deploy
straight to `main` = every store down at once. Staging + CI put a gate between a
change and your live stores.

## The flow

```
feature work ──► push to `staging` branch ──► CI gate ──► staging Render deploys
                                                              │
                                                     smoke test on staging URL
                                                              │  (green?)
                                                              ▼
                                          merge staging ──► `main` ──► prod deploys
```

- **`staging` branch** → `mark-backend-staging` (own DB, test keys). Break things here.
- **`main` branch** → `mark-backend` (real stores). Only promote what passed staging.

## 1. CI gate (`.github/workflows/ci.yml`) — automatic

On every push/PR to `main` or `staging`, GitHub Actions runs:
- `py_compile` all backend Python + evals
- `node --check` all widget/admin JS
- `php -l` all plugin PHP
- **`run_cortex_eval.py`** — the sales-brain regression gate (must stay ≥90%, offline, no keys)

Red CI = the change is broken; fix before it goes further. No test infra to run locally — just `git push`.

## 2. Set up staging (once)

**Option A (recommended — IaC):** Render Dashboard → **New → Blueprint** → point at this repo. `render.yaml` provisions `mark-backend-staging` + `mark-db-staging` automatically. Set the `sync:false` secrets (use **Stripe test-mode** keys + a low-quota Groq key for staging).

**Option B (manual):** New Web Service → branch `staging`, root `backend`, start `uvicorn main:app --host 0.0.0.0 --port $PORT`, health path `/api/health`, a separate Postgres, `APP_ENV=staging`.

Your existing prod service keeps working untouched either way.

## 3. Smoke test on staging (after each staging deploy)

```bash
# health
curl -s https://mark-backend-staging.onrender.com/api/health

# behavior (no red flags: hedging/empty)
BACKEND=https://mark-backend-staging.onrender.com STORE_ID=<staging_store> \
  python backend/evals/run_certification.py

# full sales-quality score (>=90 to promote)
BACKEND=https://mark-backend-staging.onrender.com STORE_ID=<staging_store> \
  JUDGE_API_KEY=<key> python backend/evals/run_quality_eval.py
```

Green on all three → merge `staging` → `main`.

## 4. Rollback (if prod misbehaves)

- **Render:** service → *Deploys* → **Rollback** to the previous good deploy (instant), **or** `git revert <bad-sha> && git push` (redeploys clean).
- **DB migrations are additive-only** (`_STORE_MIGRATIONS` just ADD columns) → rolling back code never breaks the schema. Keep it that way.
- Env kill-switches for fast mitigation without a deploy: `SALES_CORTEX=0`, `SALES_BOOST=0`, `GLOBAL_MONTHLY_CAP=<n>`.

## 5. Pre-promote checklist

- [ ] CI green
- [ ] `/api/health` = healthy on staging
- [ ] `run_quality_eval.py` ≥ 90 on staging
- [ ] no new secret committed (scan the diff)
- [ ] migration is additive (no dropped/renamed columns)
- [ ] rollback path known (previous deploy is one click away)
