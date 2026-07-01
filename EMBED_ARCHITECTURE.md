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

## Shopify adapter — NEXT (scoped, needs a Partner app to build/test)
A Shopify app is just a **host** for the same core. Two thin pieces:
1. **Inject the loader** — a **Theme App Extension (app embed block)** or a `ScriptTag`
   that adds the exact `<script src=".../embed.js" data-site="{shop}.myshopify.com">`.
   OAuth install → we call `/api/embed/config` to provision the store. No new widget code.
2. **Catalog provider** — mirror the existing WooCommerce provider
   (`_normalize_products` / `_fetch_tenant_products_background`) with a
   `_fetch_shopify_products(shop, token)` that hits the Shopify **Storefront API**
   and returns the SAME flat shape `{name, price, description, stock_status, permalink}`.
   Drop it behind the same `format_products_context`. (This is the api-connector-builder
   move: a new *provider*, not a new architecture.)

Build order: (a) Shopify Partner app + OAuth + ScriptTag inject, (b) Storefront catalog
provider, (c) billing via Shopify's own billing API or keep Stripe. Test on a dev store.

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
