// ============================================================
// MARK BRAIN — Ultra RAG Engine + Intelligent Chat Router
// Handles: intent classification, RAG search with re-ranking,
// context injection, smart navigation, fallback chains.
// ============================================================

(function () {
    'use strict';

    // Flip to true only when debugging — keeps the customer's console clean.
    const MARK_DEBUG = false;

    // Config from WP (set by class-mark-ai-widget.php via wp_localize_script)
    const CFG = (typeof markAIConfig !== 'undefined') ? markAIConfig : {};

    // Backend URL — Python FastAPI on Render (primary for chat, TTS, transcribe, RAG)
    const BACKEND = CFG.backendUrl || 'https://mark-udfz.onrender.com';

    // WP REST — fallback for chat if backend is down
    const WP_REST = CFG.restUrl || '/wp-json/mark-ai/v1/';
    const WP_NONCE = CFG.nonce || '';

    const STORE_ID = CFG.storeId || '';
    const LANGUAGE = CFG.language || 'en';

    // ── Expose as globals for chatbot.js ──
    window.MARK_BACKEND  = BACKEND;
    window.MARK_WP_REST  = WP_REST;
    window.MARK_WP_NONCE = WP_NONCE;
    window.MARK_STORE_ID = STORE_ID;
    window.MARK_LANGUAGE = LANGUAGE;

    // ================================================================
    // INTENT CLASSIFICATION (multi-signal, weighted)
    // ================================================================

    // Strong navigation commands — user clearly wants to go somewhere
    const NAV_STRONG_PATTERNS = [
        /\b(take me to|go to|navigate to|redirect to|open|bring me to)\b/i,
        /\b(checkout|my cart|shopping cart|proceed to)\b/i,
        /\b(visit|head to|jump to|switch to)\s+(the\s+)?\w+\s*(page|section|category)/i,
        /\b(le jao|le chalo|page kholo|wahan jao)\b/i,
    ];

    // Browse intent — user wants to see/find something (Mark talks + offers link)
    const NAV_BROWSE_PATTERNS = [
        /\b(show me|find|looking for|want to see|want to buy)\b/i,
        /\b(browse|search for|see|check out)\b/i,
        /\b(new arrival|latest|collection|category|categories)\b/i,
        /\b(sale|offer|discount|deal|trending|popular|best seller)\b/i,
        /\b(where (can|do|is)|how (to|do I))\b/i,
        /\b(dikhao|dikha do|le chalo|kahan hai|batao kahan)\b/i,
    ];

    // Product-specific patterns — Mark should answer from product knowledge
    const PRODUCT_PATTERNS = [
        /\b(price|cost|how much|shipping|delivery|return|refund|warranty)\b/i,
        /\b(size|color|material|weight|dimension|specification|feature)\b/i,
        /\b(in stock|available|out of stock|stock)\b/i,
        /\b(compare|difference|vs|versus|better)\b/i,
        /\b(review|rating|recommend)\b/i,
    ];

    // Greeting patterns — skip RAG entirely
    const GREETING_PATTERNS = [
        /^(hi|hello|hey|yo|sup|hola|greetings|good\s+(morning|afternoon|evening))\s*[!?.]*$/i,
        /^(how are you|what'?s up|howdy)\s*[!?.]*$/i,
        /^(thanks|thank you|bye|goodbye|see you|later)\s*[!?.]*$/i,
    ];

    /**
     * Classify user intent with confidence score.
     * Returns: { type: 'navigate'|'browse'|'product'|'chat'|'greeting', confidence: 0-1 }
     */
    function classifyIntent(message) {
        const msg = message.trim();

        // Greetings — never search RAG
        if (GREETING_PATTERNS.some(p => p.test(msg))) {
            return { type: 'greeting', confidence: 1.0 };
        }

        // Very short messages (< 3 words) are usually chat
        const wordCount = msg.split(/\s+/).length;
        if (wordCount <= 2 && !NAV_STRONG_PATTERNS.some(p => p.test(msg))) {
            return { type: 'chat', confidence: 0.7 };
        }

        // Strong navigation
        if (NAV_STRONG_PATTERNS.some(p => p.test(msg))) {
            return { type: 'navigate', confidence: 0.95 };
        }

        // Product questions
        if (PRODUCT_PATTERNS.some(p => p.test(msg))) {
            return { type: 'product', confidence: 0.85 };
        }

        // Browse intent
        if (NAV_BROWSE_PATTERNS.some(p => p.test(msg))) {
            return { type: 'browse', confidence: 0.75 };
        }

        return { type: 'chat', confidence: 0.6 };
    }

    // ================================================================
    // RAG SEARCH — with timeout, retry, and result validation
    // ================================================================

    /** Local cache to avoid duplicate API calls in same session */
    const ragCache = new Map();
    const RAG_CACHE_TTL = 60000; // 1 minute

    function getCacheKey(query) {
        return query.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    }

    /**
     * Search the RAG index with caching and validation.
     * Returns: Array of { url, title, snippet, score }
     */
    async function ragSearch(query, topK = 5) {
        if (!BACKEND) return [];

        // Check cache
        const cacheKey = getCacheKey(query);
        const cached = ragCache.get(cacheKey);
        if (cached && Date.now() - cached.time < RAG_CACHE_TTL) {
            return cached.results;
        }

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);

            const ragHeaders = { 'Content-Type': 'application/json' };
            if (STORE_ID) ragHeaders['X-Store-ID'] = STORE_ID;
            const response = await fetch(`${BACKEND}/api/rag-search`, {
                method: 'POST',
                headers: ragHeaders,
                body: JSON.stringify({
                    query,
                    top_k: topK,
                    store_id: STORE_ID,
                }),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            const data = await response.json();

            // Backend still indexing
            if (data.status === 'indexing') {
                MARK_DEBUG && console.log('[Mark Brain] RAG index still building...');
                return [];
            }

            const results = (data.results || []).filter(r => {
                // Filter out low-quality results
                if (!r.url || !r.title) return false;
                if (r.score < 0.03) return false; // floor noise
                return true;
            });

            // Cache results
            ragCache.set(cacheKey, { results, time: Date.now() });

            // Trim cache if too large (max 50 entries)
            if (ragCache.size > 50) {
                const oldest = ragCache.keys().next().value;
                ragCache.delete(oldest);
            }

            return results;
        } catch (e) {
            if (e.name === 'AbortError') {
                MARK_DEBUG && console.log('[Mark Brain] RAG search timed out');
            } else {
                MARK_DEBUG && console.log('[Mark Brain] RAG search failed:', e.message);
            }
            return [];
        }
    }

    // ================================================================
    // CONTEXT BUILDER — Builds rich context from RAG results
    // ================================================================

    /**
     * Build a context string from RAG results that can be injected
     * into the chat prompt so Mark can answer knowledgeably.
     */
    function buildRAGContext(results) {
        if (!results || results.length === 0) return '';

        const contextParts = results
            .slice(0, 3) // Max 3 results for context
            .map((r, i) => {
                let ctx = `[Page ${i + 1}: "${r.title}" — ${r.url}]`;
                if (r.snippet) {
                    // Truncate long snippets
                    const snippet = r.snippet.length > 300
                        ? r.snippet.substring(0, 300) + '...'
                        : r.snippet;
                    ctx += `\n${snippet}`;
                }
                return ctx;
            });

        return '\n\n--- VERIFIED WEBSITE CONTENT (Zone 1 knowledge — you can state these facts confidently) ---\n'
             + contextParts.join('\n\n')
             + '\n--- END OF VERIFIED CONTENT ---\n\n'
             + 'The above is Zone 1 knowledge. State these facts confidently as your own knowledge about this website. '
             + 'Do NOT invent anything beyond what is written above. '
             + 'If the visitor asks about something NOT covered above, redirect them warmly to explore the website.';
    }

    // ================================================================
    // NAVIGATION — Smart redirect with user feedback
    // ================================================================

    function redirectToPage(url, title) {
        // Security: only navigate to SAME-ORIGIN URLs. The target comes from
        // RAG/LLM output, so an attacker who seeds the index could otherwise
        // open-redirect visitors off-site. Enforce origin (not just protocol).
        let safeUrl;
        try {
            const parsed = new URL(url, window.location.origin);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
                console.warn('[Mark Brain] Blocked non-HTTP redirect:', url);
                return;
            }
            if (parsed.origin !== window.location.origin) {
                console.warn('[Mark Brain] Blocked off-origin redirect:', url);
                return;
            }
            safeUrl = parsed.href;
        } catch (e) {
            console.warn('[Mark Brain] Invalid URL:', url);
            return;
        }

        const feedback = 'Taking you to ' + title + '!';

        // Show caption immediately
        if (typeof window.showCaption === 'function') {
            window.showCaption(feedback, false);
        }
        // Speak it
        if (typeof window.speak === 'function') {
            window.speak(feedback);
        }

        // Navigate after brief delay so user sees/hears feedback
        setTimeout(() => {
            window.location.href = safeUrl;
        }, 1800);
    }

    // ================================================================
    // MAIN ENTRY — Called from chatbot.js
    // ================================================================

    /**
     * Process user message through the RAG-enhanced pipeline.
     * 1. Classify intent
     * 2. RAG search (if needed)
     * 3. Navigate OR enrich chat with context
     */
    window.processUserMessage = async function (userMessage) {
        const intent = classifyIntent(userMessage);
        MARK_DEBUG && console.log('[Mark Brain] Intent:', intent.type, '| Confidence:', intent.confidence);

        // ── Greetings: skip RAG, go straight to chat ──
        if (intent.type === 'greeting') {
            if (typeof window.processChatMessage === 'function') {
                await window.processChatMessage(userMessage);
            }
            return;
        }

        // ── Navigate or Browse: AUTO-REDIRECT when RAG has a match ──
        if (intent.type === 'navigate' || intent.type === 'browse') {
            const results = await ragSearch(userMessage);
            if (results.length > 0 && results[0].score >= 0.05) {
                redirectToPage(results[0].url, results[0].title);
                return; // Redirecting — no chat needed
            }
            // No good match → fall through to chat with context
            if (results.length > 0) {
                const ragContext = buildRAGContext(results);
                if (typeof window.processChatMessage === 'function') {
                    await window.processChatMessage(userMessage, ragContext);
                }
                return;
            }
        }

        // ── Product / Chat: enrich with RAG context, no redirect ──
        let ragContext = '';
        if (intent.type !== 'greeting') {
            const results = await ragSearch(userMessage);
            if (results.length > 0) {
                ragContext = buildRAGContext(results);
            }
        }

        // Pass to chat handler with optional RAG context
        if (typeof window.processChatMessage === 'function') {
            await window.processChatMessage(userMessage, ragContext);
        }
    };

    // Expose for debugging
    window.markBrain = {
        classifyIntent,
        ragSearch,
        buildRAGContext,
    };

})();
