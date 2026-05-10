=== Mark AI -- Website Companion ===
Contributors: muhammadroohullah
Tags: chatbot, ai, voice, 3d-robot, assistant
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.1.0
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

2. **Mark AI Backend** (https://mark-ix64.onrender.com) — Optional Python backend for voice synthesis (Edge TTS), speech-to-text (Whisper), and RAG content indexing. This is an open-source companion service. The plugin works without it using WordPress REST fallback for text chat. [Source Code](https://github.com/muhammadroohullah110/mark)

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

= 1.1.0 =
Major UX upgrade: anti-hallucination system, security hardening, accent color customization, and animated onboarding tour.
