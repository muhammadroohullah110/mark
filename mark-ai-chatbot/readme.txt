=== Mark AI -- Website Companion ===
Contributors: muhammadroohullah
Tags: chatbot, ai, voice, 3d-robot, assistant
Requires at least: 5.8
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.9.7
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

AI-powered 3D robot website companion with voice chat, intelligent navigation, and a beautiful admin dashboard.

== Description ==

Mark AI is a friendly 3D robot assistant that lives on your website and helps visitors through voice and text chat. Powered by Groq's free LLM API, Mark can answer questions, guide navigation, and create a memorable visitor experience.

**Key Features:**

* 3D animated robot character (Three.js) that walks around your site
* Voice-first interaction (speech-to-text + text-to-speech)
* RAG-based intelligent content awareness and page navigation
* Free Groq API for blazing-fast AI responses
* Beautiful admin dashboard with conversation analytics
* Guided onboarding wizard for quick setup
* Device-adaptive rendering (mobile, tablet, desktop)
* Widget customization (accent color, position, greeting sound)
* Anti-hallucination system to prevent fabricated responses
* Rate limiting and security hardening built-in

**Third-Party Services:**

This plugin connects to the following external services:

1. **Groq API** (https://groq.com) — Used for AI chat responses. Requires a free API key from https://console.groq.com. [Terms of Use](https://groq.com/terms-of-use/) | [Privacy Policy](https://groq.com/privacy-policy/)

2. **Mark AI Backend** (https://mark-udfz.onrender.com) — Optional Python backend for voice synthesis (Edge TTS), speech-to-text (Whisper), and RAG content indexing. This is an open-source companion service. The plugin works without it using WordPress REST fallback for text chat. [Source Code](https://github.com/muhammadroohullah110/mark)

3. **GitHub API** (https://api.github.com) — Used only for checking plugin updates from the GitHub releases page. No user data is sent.

4. **Google Fonts** (https://fonts.googleapis.com) — Used to load the Open Sans and Outfit font families for the admin dashboard and widget UI. [Privacy Policy](https://policies.google.com/privacy)

5. **CDN Libraries** — Three.js (cdnjs.cloudflare.com) and Chart.js (cdn.jsdelivr.net) are loaded from CDNs for 3D rendering and analytics charts respectively.

No personal visitor data is sent to any external service. Chat messages are processed through the Groq API for generating responses.

== Installation ==

1. Upload the `mark-ai-chatbot` folder to `/wp-content/plugins/`
2. Activate the plugin through the Plugins menu
3. Go to "Mark AI" in the admin sidebar
4. Follow the onboarding wizard: enter your free Groq API key and customize your robot
5. Your 3D robot companion is now live on your site!

== Frequently Asked Questions ==

= Is it free? =
Yes! Mark AI uses Groq (free tier) for AI and Edge TTS (free) for voice. No paid subscriptions required.

= Does it work on mobile? =
Yes. Mark auto-detects your device and adapts 3D rendering quality, widget size, and touch interactions.

= Can I customize the robot? =
Yes. Choose from Professional, Friendly, or Playful personalities. Customize the accent color, greeting sound, position, and even write a custom system prompt.

= Does Mark make up information? =
Mark has a 3-layer anti-hallucination system. It only shares verified website content from the RAG index and clearly states when it doesn't know something.

= What data is sent externally? =
Chat messages are sent to the Groq API for AI response generation. No personal visitor data (IP, email, etc.) is transmitted. See the Description tab for full third-party service details.

== Screenshots ==

1. Mark the 3D robot walking on your website
2. Admin dashboard with conversation analytics
3. Onboarding wizard for first-time setup
4. Voice and text chat interaction

== Changelog ==

= 1.9.7 =
* Fixed wrong chat timestamps (showed "1/21/1970") — Unix seconds were being parsed as milliseconds

= 1.9.6 =
* Self-heals a previously mis-saved name (e.g. "Sorry") so a first-time visitor is no longer greeted as "returning" with a junk name
* Widget robot label now shows YOUR assistant name (not hard-coded "Mark")
* Dashboard numbers are now consistent — all KPIs read from the backend (fixes "all-time chats 0" while the weekly tile showed real numbers)

= 1.9.5 =
* Fixed false name detection — Mark no longer mistakes "sorry", "no", "I'm good", etc. for your name (and won't wrongly trigger the name celebration). A name is only captured right after Mark asks, and only when it's a plausible name.
* Talking robot repositioned to sit cleanly above the chat caption (no overlap)

= 1.9.4 =
* Clean admin — other plugins' notices (Elementor, Imagify, update nags, etc.) no longer clutter the Mark AI screens
* Widget now uses your custom assistant name everywhere (not hard-coded "Mark")
* Turnkey fix — the widget no longer wrongly says "the owner needs to add an AI key"; when needed it falls back through the central backend (which holds the key), with a friendly "warming up" message during cold start

= 1.9.3 =
* Modern glass toast notifications (icon chip, accent glow, smooth slide) replacing the old flat bar
* New "Welcome to the Command Center" tour — a getting-started overview of all 6 sections (shows on first visit; "Tour" button on Home)
* Refined form inputs (cyan-tinted, subtle depth) for a more premium feel

= 1.9.2 =
* Mark's Brain rebuilt as a single 2-column hub — Train + Sales style on the left, What Mark learned on the right, with the AI model tucked into a collapsible Advanced. Matches the new design.

= 1.9.1 =
* Admin redesign Step 2 — streamlined navigation 10 → 6 (Home · Mark's Brain · Voice · Conversations · Appearance · Plan), matching the new design. Mark's Brain merges Training + Sales style + Auto-Learning (+ Advanced). New Plan page. Appearance combines store profile, widget look, and where Mark appears. The old API-key/AI-Config clutter is gone (AI model lives under Mark's Brain → Advanced).

= 1.9.0 =
* Admin redesign — Step 1: matches the new Stitch design system (neon-cyan markai.shop brand, Space Grotesk + JetBrains Mono, glass cards, animated cyan ambience). Home = "Command Center". Streamlined navigation + remaining pages rolling out next.

= 1.8.0 =
* Premium voice tier — "Upgrade to Premium" unlocks ultra-realistic voices + a premium voice picker (Voice tab). Free tier keeps the free Edge voice. Secure Stripe checkout; plan badge shows your current tier.

= 1.7.1 =
* Smarter, more resilient AI brain — Kimi K2 (on Groq) as the main model with Moonshot Kimi K2 as an independent fallback, so Mark stays up even if one provider has an outage.

= 1.7.0 =
* No API key needed — Mark now runs on a central backend key. Store owners just configure (name, salesman name, etc.) — the Groq key step is removed from onboarding, AI Config, and Settings.
* Mark never goes silent — he now always answers product, price, and stock questions from the catalog (or points to the closest match) instead of dodging.
* Widget robot is bigger, better centered, and visibly alive — real 3D idle movement (slow look-around + breathing), not a frozen model.

= 1.6.1 =
* New dashboard layout — "Command Center": agent hero (Mark as your live salesman), a responsive bento grid, plain-English labels, sales-journey + who's-shopping + recent-chats + Mark's-tip tiles. Fully responsive (desktop + mobile). Keeps the Aurora colors.

= 1.6.0 =
* Brand-new "Aurora" admin design — light, premium-fintech: violet→pink gradient hero, white rounded cards, gradient stat numbers, gradient icon chips, Plus Jakarta Sans. A full departure from the dark theme.
* Soft animated aurora background, refined hover-lift + staggered entrance, violet focus rings

= 1.5.2 =
* Admin elite redesign: animated gradient headlines, premium glass cards with glowing top-edge, gradient stat numbers, glowing icon chips, staggered card entrance, refined hover-lift — across every page
* Wider, better-spaced layout (centered 1280px, generous vertical rhythm)

= 1.5.1 =
* Rive integration scaffolding for real, designer-authored robot motion (inert until a .riv asset is supplied — see MARK_RIVE_SPEC.md)
* Widget font upgraded to Space Grotesk (brand-consistent with the admin)

= 1.5.0 =
* Product links now REDIRECT in place — no raw URL is ever shown (href-less, status-bar-clean) so Mark "takes you there" instead of pasting a link
* Premium name-celebration: accent confetti burst, glowing ring, blurred scrim, spring reveal (respects reduced-motion)
* Robot re-centered in talking mode for a tighter, more cohesive layout with the caption
* First-time vs returning visitor sales framework: Mark adapts pace + posture across the whole conversation (Sales Cortex)
* Voice Speed control in the Voice tab (very slow to very fast), previewable before saving
* Admin: dark theme now fills the full screen — no white gap at the bottom; centered loaders

= 1.2.0 =
* Draco-compressed 3D model (5.2MB to 431KB — 92% faster loading)
* Pro-max intelligence upgrade with structured conversation engine
* Admin-configurable widget size (scale 1-10, desktop and mobile separately)
* Caption visibility fix during voice responses
* SSE streaming for instant chat responses
* Voice change now works correctly from admin panel
* 2D CSS fallback when WebGL is unavailable (no broken widgets)
* Reduced chat latency (optimized history and timeouts)
* WordPress.org compliance (proper escaping, license file)

= 1.1.0 =
* Added anti-hallucination system (3-layer defense)
* Added security hardening (rate limiting, input sanitization)
* Added caching layer (WordPress transients)
* Added accent color customization
* Added greeting sound personalization
* Added guided onboarding tour
* Added site-aware system prompt (Mark knows the website name)
* Fixed animations (increased visibility, extended durations)
* Fixed error handling with personality-driven messages
* Custom robot icon in WordPress admin menu

= 1.0.0 =
* Initial release
* 3D robot widget with walking, talking, and voice interaction
* Admin dashboard with glassmorphism design
* RAG-based intelligent navigation
* Voice configuration with multiple TTS voices
* Conversation tracking and analytics

== Upgrade Notice ==

= 1.2.0 =
Major performance upgrade: 92% faster 3D model loading, smarter AI conversations, streaming responses, and 2D fallback for all devices.

= 1.1.0 =
Major UX upgrade: anti-hallucination system, security hardening, accent color customization, and animated onboarding tour.
