// ============================================================
// MARK BRAIN — RAG-Powered Navigation + Chat Router
// Routes: Backend (Render) for full features, WP REST as fallback
// ============================================================

// Config from WP (set by class-mark-ai-widget.php via wp_localize_script)
const MARK_CFG = (typeof markAIConfig !== 'undefined') ? markAIConfig : {};

// Backend URL — Python FastAPI on Render (primary for chat, TTS, transcribe, RAG)
const MARK_BACKEND = MARK_CFG.backendUrl || 'https://mark-ix64.onrender.com';

// WP REST — fallback for chat if backend is down
const MARK_WP_REST = MARK_CFG.restUrl || '/wp-json/mark-ai/v1/';
const MARK_WP_NONCE = MARK_CFG.nonce || '';

const MARK_STORE_ID = MARK_CFG.storeId || '';
const MARK_LANGUAGE = MARK_CFG.language || 'en';

// ── Navigation Intent Detection ────────────────────────────
// Only trigger redirect for STRONG navigation commands
const NAV_STRONG = [
    'take me', 'go to', 'open', 'navigate', 'redirect',
    'show me the page', 'checkout', 'cart',
];

// Weaker intent — ask Mark to talk about it AND offer to navigate
const NAV_BROWSE = [
    'show', 'find', 'looking for', 'want to see',
    'browse', 'search', 'see', 'check', 'shop', 'buy', 'order',
    'new arrival', 'latest', 'collection', 'category',
    'sale', 'offer', 'discount', 'deal', 'trending', 'popular', 'best seller',
    'product', 'where',
];

function classifyIntent(message) {
    const msg = message.toLowerCase();
    if (NAV_STRONG.some(kw => msg.includes(kw))) return 'navigate';
    if (NAV_BROWSE.some(kw => msg.includes(kw))) return 'browse';
    return 'chat';
}

async function ragSearch(query) {
    if (!MARK_BACKEND) return [];
    try {
        const response = await fetch(`${MARK_BACKEND}/api/rag-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, top_k: 3, store_id: MARK_STORE_ID }),
            signal: AbortSignal.timeout(8000)
        });
        const data = await response.json();
        if (data.status === 'indexing') return [];
        return data.results || [];
    } catch (e) {
        console.log('[Mark Brain] RAG search failed:', e.message);
        return [];
    }
}

function redirectToPage(url, title) {
    const feedback = `Sure, let me take you to ${title}.`;
    if (typeof speak === 'function') speak(feedback);
    setTimeout(() => { window.location.href = url; }, 2800);
}

// Main entry — called from chatbot.js
async function processUserMessage(userMessage) {
    const intent = classifyIntent(userMessage);

    if (intent === 'navigate') {
        // Strong navigation — try to redirect immediately
        const results = await ragSearch(userMessage);
        if (results.length > 0 && results[0].score >= 0.04) {
            redirectToPage(results[0].url, results[0].title);
            return;
        }
    }

    // For 'browse' intent and 'chat' — let Mark talk about it
    // The RAG-to-chat pipeline in the backend will inject relevant
    // page content so Mark can answer knowledgeably
    if (typeof processWithOpenAI === 'function') {
        await processWithOpenAI(userMessage);
    }
}
