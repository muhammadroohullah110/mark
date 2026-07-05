# Mark everywhere — one core, thin adapters

## The decision
Custom-site embed and Shopify are **not two integrations.** They are two *hosts*
that inject the **same** widget, provisioned by the **same** central backend —
exactly the pattern the WordPress plugin already uses. We did NOT invent a second
architecture; we generalized the one that exists.

```
                     ┌─────────────── shared core (built) ───────────────┐
  host adapter  ──►  embed.js loader  ──►  /api/embed/config (provision) ──►  same 3D widget  ──►  /api/chat, /api/tts
  (WP / custom / Shopify)                    get-or-create store by domain      (chatbot.js)         central backend
                     └────────────────────────────────────────────────────┘
```

The only per-host differences are: **how the script tag gets on the page** and
**where the product catalog comes from.** Everything else is shared.

## Shared core — DONE (commit adds these)
- **`GET /embed.js`** — universal loader. Reads `data-site`, fetches config, sets
  `window.markAIConfig`, injects `#mark-ai-chatbot-root` + the same widget assets
  (three.js, GLTFLoader, animator, rive, brain, chatbot, css) from `EMBED_ASSET_BASE`
  (default: this repo via jsDelivr CDN).
- **`GET /api/embed/config?site=<domain>`** — get-or-**auto-provision** a store for
  the domain (same as `/api/register`: create_store + background RAG crawl), returns
  the widget config. Turnkey: a site that loads the script just works.

### Custom (non-WP) site — install
```html
<script src="https://mark-udfz.onrender.com/embed.js" data-site="yourstore.com" async></script>
```
That's the whole "custom-site embed." Paste one line, Mark appears — no plugin, no key.

## Shopify adapter — WORKS TODAY (manual), Partner app = later polish
Key discovery: Shopify stores expose a **public, keyless** catalog at
`https://{shop}/products.json` — the exact analogue of the public WooCommerce
Store API the code already uses. So **no OAuth is required for the catalog.**

1. **Catalog provider — DONE.** `_fetch_tenant_products_background` now falls back
   to `products.json` when the WooCommerce endpoint isn't there, normalized by
   `_normalize_shopify_products` into the SAME flat shape
   `{name, price, description, stock_status, permalink}`. Auto-detects platform —
   zero config. (Caveat: stores with storefront password protection block this;
   those need the Partner-app path.)
2. **Inject the loader — manual today.** Shopify admin → Online Store → Themes →
   **Edit code** → `theme.liquid`, paste before `</body>`:
   ```html
   <script src="https://mark-udfz.onrender.com/embed.js" data-site="{{ shop.permanent_domain }}" async></script>
   ```
   Mark appears; the backend provisions + crawls + pulls the catalog automatically.
3. **Partner app — LATER (distribution upgrade, not a functional need).** One-click
   install (OAuth) + Theme App Extension that injects the same tag + optional
   Shopify Billing. Build when going for the App Store listing; needs a Partner
   account + dev store to test.

## Notes / trade-offs
- **CORS:** the widget runs on arbitrary customer domains, so the public endpoints
  (`/api/chat`, `/api/tts`, `/api/embed/config`, `/embed.js`) need `allow_origins=*`
  (credentials off — which is the default when `ALLOWED_ORIGINS` is unset). If you
  later restrict `ALLOWED_ORIGINS` to secure the admin API, split CORS so the public
  widget routes stay open (or the embed breaks on customer sites).
- **Assets:** default `EMBED_ASSET_BASE` = jsDelivr off this GitHub repo. For a
  branded/pinned setup, host `mark-ai-chatbot/public/` on your own CDN and set the env.
- **Provisioning by domain** is trust-on-first-use; the cost firewall (per-store quota +
  burst) already protects the shared key from an abusive embed.
- **Same widget everywhere** = one place to fix bugs / ship features. That's the payoff
  of refusing two architectures.
