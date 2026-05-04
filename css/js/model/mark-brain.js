// ============================================================
// MARK BRAIN — RAG-Powered Navigation
// Detects navigation intent → asks backend for best page → redirects
// Falls back to conversational AI when no navigation match
// ============================================================

// Auto-detect: if running on webnsoft.com use production URL, otherwise localhost
const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : window.location.origin + '/mark-api';

// Navigation intent keywords (English + Roman Urdu)
const NAV_KEYWORDS = [
    // English
    'show', 'find', 'looking for', 'want to see', 'take me', 'go to',
    'browse', 'search', 'see', 'check', 'open', 'shop', 'buy', 'order',
    'new arrival', 'latest', 'collection', 'category', 'cart', 'checkout',
    'sale', 'offer', 'discount', 'deal', 'trending', 'popular', 'best seller',
    'product', 'page', 'store', 'section', 'where',
    // Roman Urdu
    'dikha', 'dikhao', 'dekhna', 'dekhao', 'chahiye', 'chahta', 'chahti',
    'karo', 'kahan', 'le chalo', 'jana', 'kharidna', 'khareedna', 'naya',
    'nayi', 'cart mein', 'kart', 'checkout karo', 'dhundh', 'talash'
];

function isNavigationIntent(message) {
    const msg = message.toLowerCase();
    return NAV_KEYWORDS.some(kw => msg.includes(kw));
}

async function ragSearch(query) {
    try {
        const response = await fetch(`${BACKEND_URL}/api/rag-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, top_k: 3 })
        });
        const data = await response.json();
        if (data.status === 'indexing') return [];
        return data.results || [];
    } catch (e) {
        return [];
    }
}

function redirectToPage(url, title) {
    // Speak in user's chosen language
    const lang = (typeof detectedLanguage !== 'undefined') ? detectedLanguage : 'en';
    const feedback = lang === 'ur'
        ? `Chaliye, main aap ko ${title} le chalta hoon.`
        : `Sure, let me take you to ${title}.`;
    if (typeof speak === 'function') speak(feedback);
    setTimeout(() => { window.location.href = url; }, 2800);
}

// Main entry point — called from index.html after transcription
async function processUserMessage(userMessage) {
    if (isNavigationIntent(userMessage)) {
        const results = await ragSearch(userMessage);

        if (results.length > 0 && results[0].score >= 0.04) {
            redirectToPage(results[0].url, results[0].title);
            return;
        }
    }

    // Not a navigation intent, or RAG found nothing → chat with AI
    if (typeof processWithOpenAI === 'function') {
        await processWithOpenAI(userMessage);
    }
}
