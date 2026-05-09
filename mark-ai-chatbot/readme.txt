=== Mark AI -- Shopping Companion ===
Contributors: muhammadroohullah
Tags: chatbot, ai, shopping, voice, ecommerce, 3d-robot
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

AI-powered 3D robot shopping companion with voice, RAG navigation, and a beautiful admin dashboard.

== Description ==

Mark AI is an AI-powered shopping companion that transforms online shopping into a conversation with a friendly 3D robot friend.

Features:
* 3D animated robot character (Three.js) that walks around your site
* Voice-first interaction (speech-to-text via Whisper + text-to-speech via Edge TTS)
* RAG-based intelligent page navigation and product awareness
* Free Edge TTS voice (no API key needed)
* Free Groq API for blazing-fast AI responses
* Beautiful Celestial High-Key admin dashboard
* Onboarding wizard for quick setup
* Conversation analytics with Chart.js visualizations
* Device-adaptive rendering (mobile, tablet, desktop)
* Widget customization (position, accent color, auto-greet)
* Embed code for non-WordPress sites
* Auto-updater via GitHub Releases

== Installation ==

1. Upload the `mark-ai-chatbot` folder to `/wp-content/plugins/`
2. Activate the plugin through the Plugins menu
3. Go to Mark AI in the admin sidebar
4. Follow the onboarding wizard: enter your free Groq API key and customize your robot
5. Your 3D robot companion is now live on your site!

== Frequently Asked Questions ==

= Is it free? =
Yes! Mark AI uses Groq (free API) for AI and Edge TTS (free) for voice. No paid subscriptions required.

= Does it work on mobile? =
Yes. Mark auto-detects your device and adapts the 3D rendering quality, widget size, and touch interactions.

= Can I customize the robot's personality? =
Yes. Choose from Professional, Friendly, or Playful personalities. You can also write a custom system prompt for full control.

== Changelog ==

= 1.0.0 =
* Initial release
* 3D robot widget with walking, talking, and voice interaction
* Celestial High-Key admin dashboard with glassmorphism design
* Onboarding wizard for first-time setup
* Analytics charts (conversation trends, peak hours)
* Voice configuration (Edge TTS with multiple voices)
* AI configuration (Groq API, model selection, temperature)
* Conversation tracking and analytics
* Widget preview in admin
* Accent color customization
* Embed code generator for external sites
* GitHub auto-updater
* Security hardened: rate limiting, input validation, API key masking
