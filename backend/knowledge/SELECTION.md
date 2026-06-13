# Project Cortex — Phase 1 Corpus Selection Audit

Source corpus: **Sales-Skills** repo (109 skills) + distilled book doctrine + web phrasing.
Filter: **B2C e-commerce chat** (Mark talks to a shopper on a store, in one session, to drive a purchase). B2B/CRM/outbound/multi-touch skills are **deferred to a future B2B layer**, not deleted from our thinking.

Legend: ✅ KEEP (adapt to B2C chat) · 🅱️ DEFER (B2B/future layer) · ⛔ N/A (ops/tooling, not conversational)

## ✅ KEEP — B2C conversational doctrine (the Cortex core)
| Skill | Why it matters to a shopper chat |
|---|---|
| sales-psychology | 70+ mental models → B2C subset (loss aversion, social proof, scarcity, anchoring, paradox of choice, FOMO, price framing, reciprocity, endowment) |
| objection-handling | LAER framework (Listen-Acknowledge-Explore-Respond) — core of every objection |
| objection-recognition | Detect an objection vs a question |
| objection-pattern-learning | Feed MAIE: which reframes convert per store |
| closing | Buying-signal → close ladder (direct/assumptive/alternative/trial) |
| buying-signal-amplification | Detect "kitne ka / size / delivery" → switch to close mode |
| micro-commitment-stacking | Small-yes ladder → add-to-cart / link click |
| scarcity-urgency-calibration | Ethical urgency (real stock/sale only) |
| social-proof-injection | "bestseller / others bought" when true |
| discovery | Needs assessment before recommending |
| asking-effective-questions | SPIN-style questions adapted to shopping |
| active-listening | Reflect what the shopper actually said |
| empathy | Acknowledge the shopper's situation |
| building-rapport | Warm, human, quick trust |
| adaptability | Match persona (price_hunter vs gift_buyer…) |
| persona-classification | Aligns with MAIE persona taxonomy |
| emotional-arc-management | Track sentiment slope across turns |
| negative-sentiment-de-escalation | Calm an annoyed/abusive shopper |
| sentiment-analysis | Per-turn tone read |
| tone-matching | Mirror the shopper's energy/formality |
| intent-detection | Greeting / info / navigate / buy |
| conversational-flow-management | Keep the conversation moving to a goal |
| cross-sell-upsell-detection | "goes well with…" at the right moment |
| pricing-discussion-logic | Talk price with anchoring/framing, never invent |
| pricing-negotiation | Hold value on "too expensive" (no fake discounts) |
| product-knowledge | Speak accurately from catalog/RAG only |
| storytelling | Make a product benefit tangible |
| response-length-calibration | Short, voice-first replies |
| question-disambiguation | Clarify a vague ask in ONE question |
| out-of-scope-request-handling | Redirect medical/legal/etc. gracefully |
| fallback-gracefully | Degrade nicely when data is missing |
| multilingual-support | English / Urdu / Roman-Urdu seamless |
| conversation-memory | Remember name + context this session |
| sales-tactics | Tactical moves library (bundling, contrast) |
| urgency-creation | Genuine "selling out / sale ends" only |
| social-selling (concepts only) | Trust signals (reviews) — not LinkedIn outreach |
| response-confidence-scoring | Don't bluff when unsure |
| trigger-event-detection | Cart-intent / hesitation triggers |

→ **~37 skills**, distilled into the corpus files below.

## 🅱️ DEFER — B2B / multi-touch (future B2B layer; do NOT load into B2C Cortex)
budget-extraction-qualification, lead-qualification(-logic), qualifying-leads, ideal-customer-profile-matching, decision-maker-identification, multi-stakeholder-thread-management, negotiation (contract terms), pricing-negotiation (deal terms), deal-documentation, deal-review-win-loss, deal-upselling, pipeline-management, analytics-tracking, performance-analytics, propensity-scoring-realtime, time-to-close-prediction, win-loss-reason-extraction, territory-account-launch, sales-playbook-scaling, sales-process-optimization, competitive-intelligence-gathering, competitor-alternatives, competitive-positioning, prospect-research-integration, data-enrichment-integration, customer-onboarding, customer-referrals, referral-request-timing.

## ⛔ N/A — outbound / channel / ops (not in-session chat)
outbound-prospecting, email-sequence, drip-pacing-intelligence, re-engagement-sequencing, ghost-recovery-sequences, conversation-resurrection, follow-up-discipline, appointment-booking, callback-scheduling, meeting-confirmation-reminder-logic, meeting-conversion, post-meeting-follow-up-automation, voicemail-drop-optimization, warm-transfer-execution, multi-channel-coordination, channel-fallback-logic, channel-preference-detection, message-deliverability-optimization, spam-bot-detection-avoidance, timezone-awareness, timing-optimization, drip/AB-test infra, custom-field-population, data ops, etc.

*Note:* a few "⛔" ideas (ghost-recovery, re-engagement) become useful IF we later add Mark email/abandoned-cart follow-ups — parked for a future "Mark Outreach" module.

## Corpus output (this phase)
`backend/knowledge/corpus/*.json` — doctrine cards the Phase-2 compiler turns into runtime blocks:
`stages.json`, `psychology.json`, `discovery.json`, `buying_signals.json`,
`objections.json`, `closing.json`, `urgency.json`, `micro_commitments.json`, `social_proof.json`.
