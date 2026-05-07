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

// Navigation intent keywords (English)
const NAV_KEYWORDS = [
    'show', 'find', 'looking for', 'want to see', 'take me', 'go to',
    'browse', 'search', 'see', 'check', 'open', 'shop', 'buy', 'order',
    'new arrival', 'latest', 'collection', 'category', 'cart', 'checkout',
    'sale', 'offer', 'discount', 'deal', 'trending', 'popular', 'best seller',
    'product', 'page', 'store', 'section', 'where',
];

function isNavigationIntent(message) {
    const msg = message.toLowerCase();
    return NAV_KEYWORDS.some(kw => msg.includes(kw));
}

async function ragSearch(query) {
    if (!MARK_BACKEND) return [];
    try {
        const response = await fetch(`${MARK_BACKEND}/api/rag-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, top_k: 3, store_id: MARK_STORE_ID })
        });
        const data = await response.json();
        if (data.status === 'indexing') return [];
        return data.results || [];
    } catch (e) {
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
    if (isNavigationIntent(userMessage)) {
        const results = await ragSearch(userMessage);
        if (results.length > 0 && results[0].score >= 0.04) {
            redirectToPage(results[0].url, results[0].title);
            return;
        }
    }
    // Chat with AI
    if (typeof processWithOpenAI === 'function') {
        await processWithOpenAI(userMessage);
    }
}
