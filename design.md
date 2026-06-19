# Mark AI — Admin Panel · Design Brief & Architecture (v2)

> **How to use this file:** Upload it to Claude.ai (or give it to any designer) and say:
> *"Read this design.md fully, then design the Mark AI admin panel as ONE self-contained
> interactive HTML artifact (vanilla JS, no React/Tailwind). Start with Home."*
> Everything needed — brand, colors, architecture, the streamlined navigation, pages,
> components — is below. This v2 **removes the old cluttered/duplicated navigation** and
> reflects the real, current product.

---

## 1. What is Mark AI?

Mark AI is the **"World's First Digital Salesman"** — an AI **3D-robot chatbot** that
e-commerce stores install on their website. Mark greets visitors, talks (voice + text),
recommends products, handles objections, and captures leads — a real salesman, 24/7.

- **This doc = the ADMIN PANEL** (what the **store owner** sees to configure Mark, watch
  performance, train him). NOT the public chatbot widget.
- The owner is **non-technical** (a shop owner). The admin must be **simple, friendly,
  beautiful** — never intimidating, no engineer-speak.
- Positioning: **billion-dollar SaaS** polish (Stripe / Linear / Vercel), but warm.
- **Goal:** an *awesome, smooth, premium* admin — gorgeous visuals, buttery 150–300ms
  motion, zero clutter, instantly understandable.

---

## 2. Product reality the design MUST reflect (important context)

These shape what the UI shows — design to the real product, not a generic CRM:

- **Turnkey — NO API keys.** Owners never enter any API/Groq key. Mark's AI runs centrally
  on the backend. So there is **NO "API key" screen anywhere.** Setup = pure store config.
- **AI brain:** Kimi K2 (on Groq) with a Moonshot fallback — but the owner never sees model
  internals. Model/temperature settings exist only in a hidden **"Advanced"** area.
- **Freemium voice tiers:** `free` = basic Edge voice; `premium` = ultra-realistic voices +
  more languages. Premium is sold via an **Upgrade** flow (Stripe). Show a plan badge + an
  "Upgrade to Premium" CTA.
- **Mark learns (MAIE):** he auto-detects **buyer personas** — Price Hunter, Researcher,
  Impulse Buyer, Gift Buyer, Skeptic, Casual Browser — per store. Surface this as insight.
- **Sales engine (Cortex):** Mark follows a sales method (greet → discover → present →
  handle objection → close), adapts to first-time vs returning visitors.
- Mark is a **3D robot** widget (Three.js) that lives on the storefront; the admin can
  preview it and tune its size/voice/appearance.

---

## 3. Brand & Design System (website neon-cyan)

Palette = the live site **markai.shop** — **neon cyan on near-black**. Match it so the admin
feels like one product with the website.

### Color tokens
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#050507` | App background (near-black) |
| `--surface` | `#04181A` | Deep teal-black surface tint |
| `--accent` | `#2DE2E6` | Primary neon cyan (buttons, active, highlights) |
| `--accent-light` | `#5CF6FA` | Bright cyan (gradients, glows) |
| `--accent-deep` | `#06B6C7` | Deep cyan (gradient end, pressed) |
| `--accent-rgb` | `45,226,230` | for rgba() glows/borders |
| `--text` | `#F5F7FA` | Primary text (off-white) |
| `--text-secondary` | `#C7CDD4` | Secondary |
| `--text-muted` | `#9AA3AD` | Muted labels/hints |
| `--success` | `#4ade80` | Active/online/positive |
| `--danger` | `#ff7a7a` | Errors/destructive |

**Card / glass surface:**
`background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.022));`
`border: 1px solid rgba(45,226,230,0.16);`
`box-shadow: 0 12px 44px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.07);`
`border-radius: 18px; backdrop-filter: blur(18px);`

**Ambient background:** two big blurred cyan radial "orbs" floating slowly behind content
+ a faint top-right cyan glow. Keeps the dark bg alive, never flat.

### Typography
- Display + body: **Space Grotesk** (400/500/600/700).
- Numbers / mono: **JetBrains Mono**.
- Big stat numbers: **gradient text** `#FFFFFF → #5CF6FA`, weight 600, tight tracking.
- Hero headings: optional slow animated cyan gradient shine.
- Body 14–16px / line-height 1.5–1.6. Labels 11–13px uppercase, letter-spacing 0.08–0.1em.

### Shape · spacing · motion
- Radius: cards 18–20px, inputs/buttons 10–12px, pills 9999px.
- Spacing: 4 / 8 / 16 / 24 / 32 / 40.
- Icon chips: rounded 12px, cyan gradient fill, dark icon — beside labels/stats.
- **Motion (this is the "smooth/awesome"):** all transitions 150–300ms,
  `cubic-bezier(0.16,1,0.3,1)`. Hover-lift cards (`translateY(-4px)` + cyan glow). Staggered
  entrance (40–60ms apart). Animated gradient headings. Press `scale(0.97)`. Cyan focus ring.
  Respect `prefers-reduced-motion`.

---

## 4. Technical architecture (so the design is buildable)

> The design MUST be implementable **without a build step.**

- **Admin = a vanilla-JS single-page app** injected into a WordPress admin page. **No React,
  no Tailwind, no bundler.** Styling = inline styles from a JS design-token object (`T`) +
  injected `@keyframes`. So deliver **plain HTML + CSS + vanilla JS.**
- **Icons:** Google **Material Symbols Outlined** (CDN). **Never emojis as icons.**
- **Fonts:** Google Fonts CDN (Space Grotesk + JetBrains Mono).
- **Charts:** Chart.js (CDN) or CSS bars — lightweight.
- **Backend:** separate FastAPI service; admin pulls live data via REST (analytics,
  conversations, personas, training, billing). Design needs **skeleton loaders** + **empty
  states** for async data.
- **Output for the artifact:** ONE self-contained `.html` — inline CSS, vanilla JS, CDN
  fonts+icons — runs on open, responsive, with a working sidebar that switches pages.

---

## 5. Information Architecture — STREAMLINED (this replaces the old 10-item mess)

The old admin had **10 sidebar items with duplicated navigation** (a "My Store" page whose
tabs repeated the sidebar) and an over-technical "AI Config". **v2 collapses this to 6 clean,
owner-friendly destinations** + a hidden Advanced area.

**Sidebar (icon + label, active item highlighted cyan; persistent on desktop, drawer on mobile):**

1. **Home** — the "Command Center" overview. *(was "Dashboard")*
2. **Mark's Brain** — everything about how Mark sells, in ONE page with 3 sections:
   *Train* (brand info, priority products, seasonal) · *Sales style* (mode, CTA, objections) ·
   *What Mark learned* (buyer-persona mix, playbook, retrain). *(merges old Auto-Learning +
   Mark Training + Sales Skills)*
3. **Voice** — voice + speed + the **free/premium tier** with Upgrade CTA + premium voice picker.
4. **Conversations** — visitor chat logs.
5. **Appearance** — store profile (store name, website, salesman name, personality, status) +
   widget look (accent color, position, greeting, name-celebration, robot size) + **where Mark
   appears** (page rules). *(merges old My Store basics + global Settings)*
6. **Plan** — current tier badge, what premium unlocks, upgrade/billing.

- **Advanced** (NOT a primary nav item — a collapsible section, e.g. at the bottom of
  Mark's Brain or behind a small "Advanced" link): AI model, creativity (temperature),
  custom system prompt, max crawl pages, **Health Check**. Hidden from normal owners.
- **REMOVED:** the standalone "AI Config" page, the duplicated My-Store-tabs vs sidebar,
  any "API key" UI, and the separate global "Settings" page (folded into Appearance/Advanced).

---

## 6. Page-by-page spec

### 1) Home — "Command Center" (bento, the flagship)
- **Agent hero bar (full width):** robot avatar (cyan gradient chip) + **"Mark · Live ·
  store.com"** with a pulsing green dot + a one-line **daily briefing** ("Today Mark handled
  326 chats, captured 12 leads, busiest 8–9 PM.") + buttons *Preview widget*, *Train Mark*.
- **Bento grid (mixed-size tiles, responsive 4→2→1 col):**
  - **Sales funnel** (big): Visitors → Chats → Leads → Sales with conversion % (cyan gradient bars).
  - **KPI tiles:** Chats today, All-time chats, Visitors, Leads — gradient numbers + icon chips + delta/sparkline.
  - **Who's shopping:** buyer-persona bars (Price Hunter 32%…).
  - **Recent chats:** live feed (visitor line + persona tag + time).
  - **Mark's tip:** cyan-gradient card with one actionable AI insight + a button.
- Plain words ("Chats", not "Conversations"). Skeletons while loading; friendly empty states.

### 2) Mark's Brain (one page, 3 sections via sub-tabs or stacked blocks)
- **Train:** Brand description, Priority products, Seasonal context (big textareas w/ helpful
  placeholders) + a "Sync products" action.
- **Sales style:** Sales mode (off / gentle / active), CTA text + URL, objection handling,
  cross-sell — framed "smart, not pushy".
- **What Mark learned:** persona distribution + win-rate, status (signals collected, last
  trained, playbook version), **Retrain** button. Empty state if not enough data yet.

### 3) Voice
- **Free user:** gradient **"Upgrade to Premium"** banner (unlock ultra-realistic voices +
  more languages) → Upgrade.
- **Premium user:** "Premium active" badge + **premium voice picker** (realistic voices).
- Always: voice picker + **Voice Speed** + Pitch + **Test Voice** preview.

### 4) Conversations
List of recent chats: visitor id, language pill, time, "Visitor: …" / "Mark: …" lines.
Empty: "No chats yet — once visitors talk to Mark, they show here."

### 5) Appearance
- **Store profile:** Store name, Website URL, Salesman (assistant) name, Personality
  (Professional/Friendly/Playful), Status.
- **Widget look:** accent color picker, position, greeting text, name-celebration text,
  **robot size** sliders (desktop + mobile, live value).
- **Where Mark appears:** All pages / only selected / all except selected (page checklist).

### 6) Plan
- Current plan badge (Free / Premium). What premium unlocks (realistic voices, languages,
  future: voice cloning). Upgrade button → checkout. For premium: manage/portal.

### Advanced (hidden / collapsible)
AI model dropdown, creativity slider, max length, custom system prompt, max crawl pages,
**Health Check** ("Make sure Mark's AI is responding"). Clearly labeled "advanced — optional".

---

## 7. Component library (style once, reuse)

Sidebar nav item (icon+label, active=cyan indicator) · glass card (+hover-lift variant) ·
**stat card** (uppercase label + gradient number + icon chip + cyan top-hairline on hover) ·
buttons (Primary: cyan gradient fill, dark text, cyan glow · Secondary/ghost: cyan border ·
Danger: subtle red) · inputs/selects/textareas (dark translucent, cyan focus ring) · toggle
(cyan on) · badge/pill (Active w/ pulsing dot · Premium gradient) · table/list rows (hover
highlight, sortable) · charts (cyan series, subtle grid, tooltips, empty+loading) · modal
(dark glass, 40–60% scrim, animates from trigger) · toast (auto-dismiss 3–5s, no focus steal) ·
skeleton shimmer · empty state (icon + friendly line + action).

---

## 8. Responsive & Accessibility (non-negotiable)
- Gorgeous on **desktop AND mobile**: sidebar → drawer, bento 4→2→1, no horizontal scroll.
- Touch targets ≥44px; mobile body/input ≥16px.
- Contrast ≥4.5:1 (mind cyan-on-dark for small text — use lighter cyan/white for body).
- Visible focus rings, aria-labels on icon-only buttons, logical headings.
- Respect `prefers-reduced-motion`.

---

## 9. Anti-patterns (do NOT do)
- ❌ Emojis as icons (use Material Symbols).
- ❌ The old 10-item duplicated nav — use the **6-item streamlined IA**.
- ❌ API-key screens (turnkey product).
- ❌ Surfacing AI model/temperature to normal owners (Advanced only).
- ❌ Generic "4 stat cards + 2 charts" — use the **bento Command Center**.
- ❌ Jargon ("Conversations/Tokens") — prefer plain words ("Chats").
- ❌ Flat dead black (keep glass + cyan orbs) · instant or >500ms animations · inconsistent
  radius/shadows/spacing.

---

## 10. Deliverable
One self-contained **interactive HTML** file: working sidebar (6 items), all pages (Home
first, fully built), exact brand colors + fonts above, smooth motion, responsive, accessible.
Make it feel **alive and expensive.**

> **Palette note:** This brief uses the **markai.shop brand (neon cyan on dark)**. If a light
> variant is ever wanted, only the **Color tokens (§3)** change — architecture, IA, pages,
> components, and motion stay identical.
