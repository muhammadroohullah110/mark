/**
 * Mark AI — 3D Robot Website Companion (WP Plugin)
 * Floating 3D robot widget: walks, talks, voice+text, RAG navigation.
 * Primary: Python backend (Render) for chat/TTS/STT/RAG.
 * Fallback: WP REST (PHP→Groq) for basic text chat.
 */

(function () {
    'use strict';

    // ============================================================
    // CONFIG (markAIConfig set by mark-brain.js wp_localize_script)
    // ============================================================
    const CFG = window.markAIConfig || {};
    const PLUGIN_URL = CFG.pluginUrl || '';
    const STORE_ID   = CFG.storeId || '';
    const POSITION   = CFG.position || 'bottom-right';
    const AUTO_GREET = CFG.autoGreet !== false;
    const LANG       = CFG.language || 'en';
    const ACCENT     = CFG.accentColor || '#667eea';
    const GREET_SOUND = CFG.greetingSoundText || 'Ayie!';
    const IDLE_TIMEOUT_CFG = (parseInt(CFG.idleTimeout) || 60) * 1000; // from admin (seconds → ms)

    /** Convert hex color to "r,g,b" string for rgba() usage */
    function hexToRgb(hex) {
        const h = hex.replace('#', '');
        const r = parseInt(h.substring(0, 2), 16) || 102;
        const g = parseInt(h.substring(2, 4), 16) || 126;
        const b = parseInt(h.substring(4, 6), 16) || 234;
        return r + ',' + g + ',' + b;
    }

    /** Lighten a hex color by a percentage (0-100) */
    function lightenHex(hex, pct) {
        const h = hex.replace('#', '');
        let r = parseInt(h.substring(0, 2), 16);
        let g = parseInt(h.substring(2, 4), 16);
        let b = parseInt(h.substring(4, 6), 16);
        r = Math.min(255, r + Math.round((255 - r) * pct / 100));
        g = Math.min(255, g + Math.round((255 - g) * pct / 100));
        b = Math.min(255, b + Math.round((255 - b) * pct / 100));
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }

    // Backend (Python on Render) — primary for all AI features
    const BACKEND = (typeof MARK_BACKEND !== 'undefined') ? MARK_BACKEND : 'https://mark-ix64.onrender.com';
    // WP REST — fallback only
    const WP_REST = (typeof MARK_WP_REST !== 'undefined') ? MARK_WP_REST : '/wp-json/mark-ai/v1/';
    const WP_NONCE = (typeof MARK_WP_NONCE !== 'undefined') ? MARK_WP_NONCE : '';

    // ============================================================
    // DEVICE DETECTION — auto-optimize for hardware
    // ============================================================
    const DEVICE = (() => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const mobile = w <= 768 && touch;
        const tablet = w > 768 && w <= 1024 && touch;
        const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
        const lowEnd = (navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory || 4) < 3;
        const conn = navigator.connection;
        const slowNet = conn && (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g');
        return { mobile, tablet, touch, dpr, lowEnd, slowNet, w, h };
    })();

    // Robot — sizes adapt to device
    const ROBOT_URL         = PLUGIN_URL + 'public/model/robot.glb';
    const WIDGET_PX         = DEVICE.mobile ? 90 : DEVICE.tablet ? 100 : 115;
    const TALKING_PX        = DEVICE.mobile ? 240 : DEVICE.tablet ? 280 : 320;
    // Idle timeout — uses admin setting, with sensible floor (15s min)
    const IDLE_TIMEOUT_SHORT = Math.max(IDLE_TIMEOUT_CFG, 15000);
    const IDLE_TIMEOUT_LONG  = Math.max(IDLE_TIMEOUT_CFG * 2, 30000);
    const WALK_INTERVAL     = DEVICE.mobile ? 7000 : 5500;
    const MEMORY_KEY        = 'mark_memory';

    const W_CAM = { fov:50, x:0, y:0.5, z:3.4 };
    const T_CAM = { fov:50, x:0, y:0.7, z:4.0 };

    console.log('[Mark] Device:', DEVICE.mobile ? 'Mobile' : DEVICE.tablet ? 'Tablet' : 'Desktop',
                '| DPR:', DEVICE.dpr, '| LowEnd:', DEVICE.lowEnd, '| Touch:', DEVICE.touch);

    // ============================================================
    // ROOT CHECK
    // ============================================================
    const root = document.getElementById('mark-ai-chatbot-root');
    if (!root) return;

    // ============================================================
    // STATE
    // ============================================================
    let scene, camera, renderer, robot, mixer, clock;
    let robotAnimations   = [];
    let markState         = 'loading';
    let walkTimer         = null;
    let idleTimer         = null;
    let detectedLanguage  = 'en';
    let languageLocked    = true; // English only for V1
    let lastMarkText      = '';
    let exchangeCount     = 0;
    let currentAudio      = null;
    let ttsAvailable      = false;
    let backendAlive      = false;
    let conversationHistory = [];
    let lastTalkingTimestamp = 0; // tracks when Mark last had a conversation
    const SESSION_ID = 'mark_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    // ── Session Persistence — survive close/reopen within same page session ──
    const SESSION_HISTORY_KEY = 'mark_session_history';
    const SESSION_TIMESTAMP_KEY = 'mark_session_ts';
    const SESSION_MEMORY_TTL = 10 * 60 * 1000; // 10 minutes — after this, fresh greeting

    function saveSessionHistory() {
        try {
            sessionStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(conversationHistory.slice(-16)));
            sessionStorage.setItem(SESSION_TIMESTAMP_KEY, String(Date.now()));
        } catch {}
    }

    function loadSessionHistory() {
        try {
            const ts = parseInt(sessionStorage.getItem(SESSION_TIMESTAMP_KEY) || '0');
            if (Date.now() - ts > SESSION_MEMORY_TTL) return []; // expired
            const data = JSON.parse(sessionStorage.getItem(SESSION_HISTORY_KEY) || '[]');
            return Array.isArray(data) ? data : [];
        } catch { return []; }
    }

    function hasRecentConversation() {
        const ts = parseInt(sessionStorage.getItem(SESSION_TIMESTAMP_KEY) || '0');
        return (Date.now() - ts) < SESSION_MEMORY_TTL && loadSessionHistory().length > 0;
    }

    // ============================================================
    // ERROR HANDLING — personality-driven, modern UX
    // ============================================================
    const MARK_MSGS = {
        thinking: [
            'Hmm, let me think...',
            'One sec, cooking up something good...',
            'Brb, consulting my robot brain...',
            'Processing at light speed...',
            'Hold tight, thinking hard...',
        ],
        engineFail: "Oops! My 3D engine didn't load. Try refreshing the page! 🔄",
        modelFail: "I couldn't put myself together! A quick page refresh should fix me. 🔧",
        voiceUnavail: "My voice is taking a nap 😴 Type to me instead!",
        voiceServerFail: "Couldn't reach my voice server. Let's chat by text! ⌨️",
        connectionFail: [
            'Lost my connection! Give it another try? 🔁',
            'Whoops, the signal dropped. Try again?',
            'My wires got tangled! One more try? 🔌',
        ],
        micDenied: "I need mic access to hear you. Check your browser permissions! 🎤",
    };

    function pickRandom(arr) {
        if (typeof arr === 'string') return arr;
        return arr[Math.floor(Math.random() * arr.length)];
    }

    let thinkingMsgTimer = null;

    // ============================================================
    // BUILD DOM
    // ============================================================
    function buildDOM() {
        // Apply accent color as CSS custom properties
        const accentRgb = hexToRgb(ACCENT);
        const accentLight = lightenHex(ACCENT, 30);
        root.style.setProperty('--mark-accent', ACCENT);
        root.style.setProperty('--mark-accent-rgb', accentRgb);
        root.style.setProperty('--mark-accent-light', accentLight);

        root.innerHTML = `
        <div class="mark-loading-overlay" id="markLoadingOverlay">
            <div class="mark-loading-text">Loading Mark...</div>
            <div class="mark-loading-spinner"></div>
        </div>

        <div id="mark-talk-backdrop"></div>

        <div id="mark-widget">
            <div id="mark-hint">Hi! Tap me</div>
            <div id="mark-three-container"></div>
        </div>

        <div id="mark-live-caption" class="mark-chat-ui"></div>
        <div id="mark-thinking-indicator" class="mark-chat-ui">Mark is thinking</div>
        <button id="mark-close-btn" class="mark-chat-ui" title="Close">&times;</button>

        <button id="mark-mic-btn" class="mark-chat-ui" title="Hold to talk">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8"  y1="23" x2="16" y2="23"/>
            </svg>
        </button>
        <div id="mark-mic-hint" class="mark-chat-ui">Hold to talk</div>

        <div id="mark-text-input-area" class="mark-chat-ui">
            <input type="text" id="mark-text-input" placeholder="or type here..." autocomplete="off" />
            <button id="mark-send-btn" title="Send">&#10148;</button>
        </div>
        `;
    }

    // DOM refs
    let markWidget, threeContainer, loadingOverlay, micBtn, micHint,
        liveCaption, markHint, closeBtn, thinkingEl, textInput, sendBtn, talkBackdrop;

    function assignDOMRefs() {
        markWidget     = document.getElementById('mark-widget');
        threeContainer = document.getElementById('mark-three-container');
        loadingOverlay = document.getElementById('markLoadingOverlay');
        micBtn         = document.getElementById('mark-mic-btn');
        micHint        = document.getElementById('mark-mic-hint');
        liveCaption    = document.getElementById('mark-live-caption');
        markHint       = document.getElementById('mark-hint');
        closeBtn       = document.getElementById('mark-close-btn');
        thinkingEl     = document.getElementById('mark-thinking-indicator');
        textInput      = document.getElementById('mark-text-input');
        sendBtn        = document.getElementById('mark-send-btn');
        talkBackdrop   = document.getElementById('mark-talk-backdrop');
    }

    // ============================================================
    // BACKEND HEALTH CHECK — wake up Render backend with retries
    // Free tier sleeps after inactivity; needs ~30s to cold-start.
    // ============================================================
    let backendRetries = 0;
    const MAX_RETRIES  = 5;

    async function checkBackend() {
        if (!BACKEND) return;
        try {
            const res = await fetch(`${BACKEND}/api/status`, { signal: AbortSignal.timeout(12000) });
            if (!res.ok) throw new Error('Status ' + res.status);
            const data = await res.json();
            backendAlive = true;
            ttsAvailable = data.tts_available !== false;
            backendRetries = 0;
            console.log('[Mark] Backend alive — TTS:', ttsAvailable);
        } catch(e) {
            console.log('[Mark] Backend check failed:', e.message, '(retry', backendRetries+1, '/', MAX_RETRIES, ')');
            backendAlive = false;
            ttsAvailable = false;
            // Retry with exponential backoff (4s, 8s, 16s, 32s, 64s)
            if (backendRetries < MAX_RETRIES) {
                const delay = 4000 * Math.pow(2, backendRetries);
                backendRetries++;
                setTimeout(checkBackend, delay);
            }
        }
    }

    // ============================================================
    // LOCALSTORAGE MEMORY
    // ============================================================
    function loadMemory() {
        try { return JSON.parse(localStorage.getItem(MEMORY_KEY)) || {}; }
        catch { return {}; }
    }
    function saveMemory(data) {
        try {
            const existing = loadMemory();
            existing.lastVisit = Date.now();
            localStorage.setItem(MEMORY_KEY, JSON.stringify({ ...existing, ...data }));
        } catch {}
    }

    function tryExtractName(text) {
        const patterns = [
            /(?:my name is|i'm|i am|call me|this is)\s+([a-z]{2,15})/i,
            /(?:mera naam|naam hai|naam)\s+([a-z]{2,15})/i,
        ];
        const skip = ['hello','hi','hey','yes','no','ok','sure','please','show','find','english','want','need','the','and','but'];
        for (const p of patterns) {
            const m = text.match(p);
            if (m && m[1]) {
                const name = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
                if (!skip.includes(name.toLowerCase())) return name;
            }
        }
        return null;
    }

    // ============================================================
    // THREE.JS
    // ============================================================
    function initThree() {
        if (typeof THREE === 'undefined') {
            loadingOverlay.querySelector('.mark-loading-text').textContent = MARK_MSGS.engineFail;
            return;
        }

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(W_CAM.fov, 1, 0.1, 1000);
        camera.position.set(W_CAM.x, W_CAM.y, W_CAM.z);

        // Device-adaptive renderer quality
        const useAntialias = !DEVICE.lowEnd;
        const useShadows = !DEVICE.lowEnd && !DEVICE.mobile;
        renderer = new THREE.WebGLRenderer({ antialias: useAntialias, alpha: true, powerPreference: DEVICE.lowEnd ? 'low-power' : 'high-performance' });
        renderer.setSize(WIDGET_PX, WIDGET_PX);
        renderer.setPixelRatio(DEVICE.dpr);
        renderer.setClearColor(0x000000, 0);
        renderer.shadowMap.enabled = useShadows;
        if (useShadows) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        threeContainer.appendChild(renderer.domElement);

        // Make canvas not intercept touch/pointer events (fixes mobile drag)
        renderer.domElement.style.pointerEvents = 'none';

        scene.add(new THREE.AmbientLight(0xffffff, 1.4));
        const dir = new THREE.DirectionalLight(0x9bb0ff, 2.6);
        dir.position.set(5, 10, 7);
        dir.castShadow = useShadows;
        scene.add(dir);
        if (!DEVICE.lowEnd) {
            const fill = new THREE.DirectionalLight(0x9b59ff, 1.4);
            fill.position.set(-5, 5, -5); scene.add(fill);
        }

        clock = new THREE.Clock();

        // Check backend health (non-blocking)
        checkBackend();

        loadRobot();
    }

    function loadRobot() {
        const loader = new THREE.GLTFLoader();
        loader.load(ROBOT_URL, (gltf) => {
            robot = gltf.scene;
            robot.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
            robot.scale.set(1.1, 1.1, 1.1);
            robot.position.set(0, -0.45, 0);
            robot.rotation.y = 0;
            scene.add(robot);

            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(robot);
                robotAnimations = gltf.animations;
            }
            window.markAnimator.init(robot, mixer, robotAnimations, scene);
            window.markAnimator.play('idle');

            loadingOverlay.classList.add('mark-hidden');
            markState = 'widget';
            startWalking();
            animate();
        }, undefined, () => {
            loadingOverlay.querySelector('.mark-loading-text').textContent = MARK_MSGS.modelFail;
        });
    }

    function animate() {
        requestAnimationFrame(animate);
        window.markAnimator.update(clock.getDelta());
        renderer.render(scene, camera);
    }

    // ============================================================
    // WALKING
    // ============================================================
    function startWalking() { clearTimeout(walkTimer); scheduleWalk(); }
    function scheduleWalk() {
        if (markState !== 'widget') return;
        moveToRandomSpot();
        walkTimer = setTimeout(scheduleWalk, WALK_INTERVAL + Math.random() * 2000);
    }
    function moveToRandomSpot() {
        const w = WIDGET_PX;
        if (DEVICE.mobile) {
            // Mobile: walk in bottom third of screen, avoid top
            const padX = 20;
            const minY = window.innerHeight * 0.55;
            const maxY = window.innerHeight - w - 30;
            markWidget.style.left = (padX + Math.random() * (window.innerWidth - w - padX * 2)) + 'px';
            markWidget.style.top  = (minY + Math.random() * Math.max(0, maxY - minY)) + 'px';
        } else {
            // Desktop: walk in bottom-right quadrant (doesn't block content)
            const minX = window.innerWidth * 0.55;
            const maxX = window.innerWidth - w - 30;
            const minY = window.innerHeight * 0.45;
            const maxY = window.innerHeight - w - 30;
            markWidget.style.left = (minX + Math.random() * Math.max(0, maxX - minX)) + 'px';
            markWidget.style.top  = (minY + Math.random() * Math.max(0, maxY - minY)) + 'px';
        }
    }
    function stopWalking() {
        clearTimeout(walkTimer);
        const r = markWidget.getBoundingClientRect();
        markWidget.style.left = r.left + 'px';
        markWidget.style.top  = r.top  + 'px';
    }

    // ============================================================
    // DRAGGING — Pointer Events (desktop) + Touch Events (mobile fallback)
    // ============================================================
    let dragData = null, didDrag = false;

    function dragStart(x, y, pointerId) {
        if (markState !== 'widget') return;
        stopWalking(); markWidget.classList.add('mark-dragging');
        const r = markWidget.getBoundingClientRect();
        dragData = { startX: x, startY: y, widgetX: r.left, widgetY: r.top, pointerId };
        didDrag = false;
    }
    function dragMove(x, y) {
        if (!dragData) return;
        const dx = x - dragData.startX, dy = y - dragData.startY;
        if (Math.abs(dx) + Math.abs(dy) > 6) didDrag = true;
        if (didDrag) {
            markWidget.style.left = (dragData.widgetX + dx) + 'px';
            markWidget.style.top  = (dragData.widgetY + dy) + 'px';
        }
    }
    function dragEnd() {
        if (!dragData) return;
        markWidget.classList.remove('mark-dragging');
        if (dragData.pointerId != null) {
            try { markWidget.releasePointerCapture(dragData.pointerId); } catch(_){}
        }
        if (didDrag) { setTimeout(() => { if (markState === 'widget') startWalking(); }, 2000); }
        else { enterTalkingMode(); }
        dragData = null; didDrag = false;
    }

    // Pointer events (works on desktop + modern mobile)
    function onPointerDown(e) {
        e.preventDefault(); e.stopPropagation();
        try { markWidget.setPointerCapture(e.pointerId); } catch(_){}
        dragStart(e.clientX, e.clientY, e.pointerId);
    }
    function onPointerMove(e) { e.preventDefault(); dragMove(e.clientX, e.clientY); }
    function onPointerUp(e) { e.preventDefault(); dragEnd(); }

    // Touch events (fallback for mobile browsers with pointer event issues)
    function onTouchStart(e) {
        e.preventDefault(); e.stopPropagation();
        const t = e.touches[0];
        dragStart(t.clientX, t.clientY, null);
    }
    function onTouchMove(e) {
        e.preventDefault();
        if (!dragData) return;
        const t = e.touches[0];
        dragMove(t.clientX, t.clientY);
    }
    function onTouchEnd(e) { e.preventDefault(); dragEnd(); }

    // ============================================================
    // TALKING MODE
    // ============================================================
    function enterTalkingMode() {
        if (markState !== 'widget') return;
        markState = 'talking'; exchangeCount = 0;
        clearTimeout(walkTimer);
        markHint.style.display = 'none';

        console.log('[Mark] Entering talking mode — backendAlive:', backendAlive, 'ttsAvailable:', ttsAvailable);

        // If backend isn't awake yet, kick off a fresh wake-up attempt
        if (!backendAlive) { backendRetries = 0; checkBackend(); }

        root.classList.add('mark-talking');
        markWidget.classList.add('mark-talking');

        setTimeout(() => {
            renderer.setSize(TALKING_PX, TALKING_PX);
            camera.fov = T_CAM.fov;
            camera.position.set(T_CAM.x, T_CAM.y, T_CAM.z);
            camera.updateProjectionMatrix();
        }, 720);

        // ── Session memory: restore conversation & skip greeting on quick reopen ──
        if (hasRecentConversation()) {
            conversationHistory = loadSessionHistory();
            exchangeCount = Math.min(conversationHistory.length, 5);
            const lastMsg = conversationHistory.filter(m => m.role === 'assistant').pop();
            const wb = lastMsg ? "I'm back! What else can I help with?" : "Hey again! 👋";
            showCaption(wb, false);
            speak(wb);
            console.log('[Mark] Session restored —', conversationHistory.length, 'messages in memory');
            return;
        }

        // ── Fresh greeting ──
        const mem = loadMemory();
        if (mem.name) {
            playCuteAyie(() => { sendGreeting('returning', mem.name, 'en'); });
        } else {
            playCuteAyie(() => { sendGreeting('init'); });
        }
    }

    function returnToWidget() {
        if (markState !== 'talking') return;
        stopSpeaking();
        markState = 'widget'; exchangeCount = 0;

        root.classList.remove('mark-talking');
        markWidget.classList.remove('mark-talking');
        liveCaption.style.opacity = '0';
        hideThinking();

        // PERSIST conversation — don't wipe! Mark remembers within the session
        saveSessionHistory();
        lastTalkingTimestamp = Date.now();

        setTimeout(() => {
            renderer.setSize(WIDGET_PX, WIDGET_PX);
            camera.fov = W_CAM.fov;
            camera.position.set(W_CAM.x, W_CAM.y, W_CAM.z);
            camera.updateProjectionMatrix();
            startWalking();
        }, 720);
    }

    function getIdleTimeout() { return exchangeCount >= 3 ? IDLE_TIMEOUT_LONG : IDLE_TIMEOUT_SHORT; }
    function resetIdleTimer() { clearTimeout(idleTimer); idleTimer = setTimeout(returnToWidget, getIdleTimeout()); }
    function cancelIdleTimer() { clearTimeout(idleTimer); }

    // ============================================================
    // THINKING
    // ============================================================
    function showThinking() {
        if (liveCaption) liveCaption.style.opacity = '0';
        if (thinkingEl) {
            thinkingEl.textContent = pickRandom(MARK_MSGS.thinking);
            thinkingEl.classList.add('mark-show');
            thinkingEl.style.visibility = 'visible';
            thinkingEl.style.display = 'block';
            // Rotate thinking messages every 3 seconds
            clearInterval(thinkingMsgTimer);
            thinkingMsgTimer = setInterval(() => {
                if (thinkingEl) thinkingEl.textContent = pickRandom(MARK_MSGS.thinking);
            }, 3000);
        }
        window.markAnimator.play('think');
    }
    function hideThinking() {
        clearInterval(thinkingMsgTimer);
        if (thinkingEl) {
            thinkingEl.classList.remove('mark-show');
            thinkingEl.style.display = 'none';
        }
    }

    // ============================================================
    // GREETINGS — routes through backend (has Mark's soul + products)
    // ============================================================
    async function sendGreeting(type, name, language) {
        showThinking();

        let msg;
        if (type === 'returning') {
            msg = `__RETURNING__:Name is ${name}. Language preference is English.`;
        } else {
            msg = '__INIT__';
        }

        // Try backend first (has Mark's full personality + product catalog)
        if (backendAlive) {
            try {
                const res = await fetch(`${BACKEND}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: [{ role: 'user', content: msg }],
                        user_language: language || detectedLanguage,
                        store_id: STORE_ID
                    }),
                    signal: AbortSignal.timeout(15000)
                });
                const data = await res.json();
                hideThinking();
                if (data.response) {
                    conversationHistory.push({ role: 'assistant', content: data.response });
                    showCaption(data.response);
                    speak(data.response);
                    return;
                }
            } catch(e) {
                console.log('[Mark] Backend chat failed:', e.message);
                // fall through to WP fallback
            }
        }

        // Fallback to WP REST
        try {
            const res = await fetch(WP_REST + 'chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': WP_NONCE },
                body: JSON.stringify({ message: msg, language: language || detectedLanguage, store_id: STORE_ID, session_id: SESSION_ID }),
                signal: AbortSignal.timeout(15000)
            });
            const data = await res.json();
            hideThinking();
            if (data.reply) {
                conversationHistory.push({ role: 'assistant', content: data.reply });
                showCaption(data.reply);
                speak(data.reply);
                return;
            }
        } catch(e) {
            console.log('[Mark] WP REST chat failed:', e.message);
        }

        // Hardcoded fallback — ALWAYS shows something
        hideThinking();
        const fb = type === 'returning'
            ? `${name}! Welcome back! What are you looking for today?`
            : "Hey hey! I'm Mark, your friendly robot assistant. What's your name?";
        showCaption(fb); speak(fb);
    }

    // ============================================================
    // ECHO GUARD
    // ============================================================
    function isEcho(userText) {
        if (!lastMarkText) return false;
        const a = userText.toLowerCase().replace(/[^a-z0-9 ]/g,'').trim();
        const b = lastMarkText.toLowerCase().replace(/[^a-z0-9 ]/g,'').trim();
        if (!a || !b) return false;
        if (b.includes(a) && a.length > 10) return true;
        const wordsA = a.split(/\s+/), wordsB = new Set(b.split(/\s+/));
        const overlap = wordsA.filter(w => wordsB.has(w)).length;
        return wordsA.length > 3 && (overlap / wordsA.length) > 0.6;
    }

    // ============================================================
    // VOICE — Edge TTS (backend) + Browser TTS (fallback)
    // ============================================================
    const synth = window.speechSynthesis;

    function stopSpeaking() {
        clearInterval(typewriterTimer);
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        if (synth && synth.speaking) synth.cancel();
    }

    function sanitizeForTTS(text) {
        return text.replace(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿ऀ-ॿ]/g, '').replace(/\s{2,}/g, ' ').trim();
    }

    function speak(text) {
        stopSpeaking();

        const anim = window.markSituationDetector.detect(text, 'mark');
        if (anim) window.markAnimator.play(anim);

        const cleanText = sanitizeForTTS(text);
        if (!cleanText) { resetIdleTimer(); return; }
        lastMarkText = cleanText;
        cancelIdleTimer();

        if (ttsAvailable && backendAlive) {
            playBackendTTS(cleanText).catch((e) => {
                console.log('[Mark] Backend TTS failed, using browser:', e.message);
                playBrowserTTS(cleanText);
            });
        } else {
            playBrowserTTS(cleanText);
        }
    }

    async function playBackendTTS(text) {
        const res = await fetch(`${BACKEND}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, language: detectedLanguage, store_id: STORE_ID })
        });
        if (!res.ok) throw new Error('TTS HTTP ' + res.status);

        const blob = await res.blob();
        if (blob.size < 100) throw new Error('TTS empty audio');

        const url = URL.createObjectURL(blob);
        currentAudio = new Audio(url);
        currentAudio.onended = () => {
            URL.revokeObjectURL(url); currentAudio = null;
            window.markAnimator.play('idle'); hideCaption(); resetIdleTimer();
        };
        currentAudio.onerror = () => {
            URL.revokeObjectURL(url); currentAudio = null;
            playBrowserTTS(text);
        };

        // Handle autoplay restrictions — if play() is rejected, fall back
        try {
            await currentAudio.play();
        } catch(e) {
            console.log('[Mark] Audio autoplay blocked:', e.message);
            URL.revokeObjectURL(url); currentAudio = null;
            playBrowserTTS(text);
        }
    }

    function playBrowserTTS(text) {
        if (!synth) {
            window.markAnimator.play('idle');
            hideCaption();
            resetIdleTimer();
            return;
        }

        // Chrome bug: cancel any stuck queue before speaking
        synth.cancel();

        const u = new SpeechSynthesisUtterance(text);
        u.rate = 0.97; u.pitch = 0.92; u.volume = 1.0;

        const go = () => {
            const v = pickVoice();
            if (v) { u.voice = v; u.lang = v.lang; }
            u.onend = () => { window.markAnimator.play('idle'); hideCaption(); resetIdleTimer(); };
            u.onerror = (e) => {
                console.log('[Mark] Browser TTS error:', e.error);
                window.markAnimator.play('idle'); hideCaption(); resetIdleTimer();
            };

            // Chrome 15-second bug fix: pause/resume keeps synthesis alive
            synth.speak(u);
            if (text.length > 80) {
                const keepAlive = setInterval(() => {
                    if (!synth.speaking) { clearInterval(keepAlive); return; }
                    synth.pause(); synth.resume();
                }, 10000);
                u.onend = () => { clearInterval(keepAlive); window.markAnimator.play('idle'); hideCaption(); resetIdleTimer(); };
            }
        };

        // Force-load voices (some browsers lazy-load them)
        const voices = synth.getVoices();
        if (voices.length > 0) {
            go();
        } else {
            synth.onvoiceschanged = () => { go(); synth.onvoiceschanged = null; };
            // Safety timeout — if voices never load, still try
            setTimeout(() => { if (!synth.speaking) go(); }, 1000);
        }
    }

    function pickVoice() {
        const voices = synth.getVoices();
        return voices.find(v => v.name.includes('Microsoft Mark'))
            || voices.find(v => v.name.includes('Microsoft David'))
            || voices.find(v => v.name.includes('Google UK English Male'))
            || voices.find(v => v.lang === 'en-US')
            || voices.find(v => v.lang.startsWith('en'));
    }

    function playCuteAyie(callback) {
        if (!synth) { if (callback) setTimeout(callback, 300); return; }
        synth.cancel();
        const u = new SpeechSynthesisUtterance(GREET_SOUND);
        u.pitch = 2.0; u.rate = 0.85; u.volume = 1.0;
        const go = () => {
            const voices = synth.getVoices();
            const v = voices.find(x => x.name.includes('Samantha'))
                  || voices.find(x => x.name.includes('Microsoft Zira'))
                  || voices.find(x => x.lang.startsWith('en'));
            if (v) { u.voice = v; u.lang = v.lang; }
            u.onend = () => { if (callback) setTimeout(callback, 280); };
            synth.speak(u);
        };
        synth.getVoices().length > 0 ? go() : (synth.onvoiceschanged = go);
    }

    // ============================================================
    // CAPTIONS — guaranteed visibility with typewriter effect
    // ============================================================
    let typewriterTimer = null;
    let hideCaptionTimer = null;

    function showCaption(text, typewriter) {
        if (!liveCaption || !text) return;
        if (typewriter === undefined) typewriter = true;
        clearInterval(typewriterTimer);
        clearTimeout(hideCaptionTimer);

        // Force show — override any lingering CSS
        liveCaption.style.opacity = '1';
        liveCaption.style.visibility = 'visible';
        liveCaption.style.display = 'block';
        liveCaption.style.pointerEvents = 'auto';

        console.log('[Mark] Caption:', text.substring(0, 60) + '...');

        if (!typewriter || text.length < 20) {
            liveCaption.textContent = text;
            return;
        }
        const words = text.split(' ');
        let shown = 0;
        liveCaption.textContent = '';
        typewriterTimer = setInterval(() => {
            shown++;
            liveCaption.textContent = words.slice(0, shown).join(' ');
            if (shown >= words.length) clearInterval(typewriterTimer);
        }, 60);
    }

    function hideCaption() {
        clearTimeout(hideCaptionTimer);
        hideCaptionTimer = setTimeout(() => {
            if (liveCaption) liveCaption.style.opacity = '0.3';
        }, 5000);
    }

    // ============================================================
    // HOLD-TO-RECORD MIC — Whisper transcription via backend
    // ============================================================
    let mediaRecorder = null, audioChunks = [], isRecording = false;

    async function startRecording() {
        if (markState !== 'talking' || isRecording) return;

        // Decide: use browser Speech Recognition (free, instant) when backend is down
        if (!backendAlive && SpeechRecognition) {
            startBrowserRecognition();
            return;
        }

        cancelIdleTimer(); stopSpeaking();
        window.markAnimator.play('listen');
        liveCaption.style.opacity = '0.3';
        hideThinking();

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioChunks = [];
            const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
            mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                if (audioChunks.length === 0) { resetIdleTimer(); return; }
                await transcribeAndProcess(new Blob(audioChunks, { type: mime }), mime);
            };
            await new Promise(r => setTimeout(r, 250));
            mediaRecorder.start();
            isRecording = true;
            micBtn.classList.add('mark-listening');
            micHint.textContent = 'Release to send';
        } catch {
            micHint.textContent = MARK_MSGS.micDenied;
        }
    }

    function stopRecording() {
        if (!isRecording) return;

        // If using browser Speech Recognition, stop that
        if (browserRecognition) {
            stopBrowserRecognition();
            return;
        }

        isRecording = false;
        micBtn.classList.remove('mark-listening');
        micHint.textContent = 'Processing...';
        window.markAnimator.play('idle');
        try { mediaRecorder.stop(); } catch(_){}
    }

    // ============================================================
    // TEXT INPUT
    // ============================================================
    function handleTextSubmit() {
        const text = textInput.value.trim();
        if (!text || markState !== 'talking') return;
        textInput.value = '';
        cancelIdleTimer(); stopSpeaking();
        processTextInput(text);
    }

    async function processTextInput(text) {
        showCaption(text, false);

        const name = tryExtractName(text);
        if (name) saveMemory({ name });

        const userAnim = window.markSituationDetector.detect(text, 'user');
        if (userAnim && userAnim !== 'speak') window.markAnimator.play(userAnim);

        setTimeout(showThinking, 400);
        await processUserMessage(text);
        micHint.textContent = 'Hold to talk';
    }

    // ============================================================
    // TRANSCRIBE + PROCESS (voice → Whisper → chat)
    // Falls back to Web Speech Recognition API when backend is down
    // ============================================================
    async function transcribeAndProcess(blob, mime) {
        // Try backend Whisper first
        if (backendAlive) {
            try {
                showThinking();
                const form = new FormData();
                form.append('audio', blob, mime.includes('ogg') ? 'audio.ogg' : 'audio.webm');
                const headers = {};
                if (STORE_ID) headers['X-Store-ID'] = STORE_ID;

                const res = await fetch(`${BACKEND}/api/transcribe`, {
                    method: 'POST',
                    body: form,
                    headers: headers,
                    signal: AbortSignal.timeout(15000)
                });
                const data = await res.json();
                const text = data.text ? data.text.trim() : '';

                if (!text) { hideThinking(); micHint.textContent = 'Hold to talk'; resetIdleTimer(); return; }
                if (isEcho(text)) { hideThinking(); micHint.textContent = 'Hold to talk'; resetIdleTimer(); return; }

                hideThinking();
                await processTextInput(text);
                return;
            } catch(e) {
                console.log('[Mark] Backend transcription failed:', e.message);
                // Fall through — will show voice unavailable message
            }
        }

        // Backend down — tell user to type (recording already happened, can't retroactively use SpeechRecognition)
        hideThinking();
        showCaption("My voice server is waking up — type your message below! ⌨️");
        micHint.textContent = 'Hold to talk';
        resetIdleTimer();
    }

    // ============================================================
    // BROWSER SPEECH RECOGNITION — Live fallback for mic when
    // backend is down. Uses Web Speech API (Chrome, Edge, Safari)
    // ============================================================
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let browserRecognition = null;
    let useBrowserSTT = false; // true when backend is down

    function startBrowserRecognition() {
        if (!SpeechRecognition) {
            micHint.textContent = "Browser doesn't support voice input";
            return;
        }
        cancelIdleTimer(); stopSpeaking();
        window.markAnimator.play('listen');
        liveCaption.style.opacity = '0.3';
        hideThinking();

        browserRecognition = new SpeechRecognition();
        browserRecognition.continuous = false;
        browserRecognition.interimResults = true;
        browserRecognition.lang = 'en-US';
        browserRecognition.maxAlternatives = 1;

        let finalTranscript = '';

        browserRecognition.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interim += event.results[i][0].transcript;
                }
            }
            // Show live transcription
            if (interim) showCaption(interim, false);
        };

        browserRecognition.onend = async () => {
            isRecording = false;
            micBtn.classList.remove('mark-listening');
            window.markAnimator.play('idle');

            const text = finalTranscript.trim();
            if (!text) { micHint.textContent = 'Hold to talk'; resetIdleTimer(); return; }
            if (isEcho(text)) { micHint.textContent = 'Hold to talk'; resetIdleTimer(); return; }

            await processTextInput(text);
            micHint.textContent = 'Hold to talk';
        };

        browserRecognition.onerror = (e) => {
            console.log('[Mark] Browser STT error:', e.error);
            isRecording = false;
            micBtn.classList.remove('mark-listening');
            window.markAnimator.play('idle');
            if (e.error === 'not-allowed') {
                micHint.textContent = MARK_MSGS.micDenied;
            } else {
                micHint.textContent = 'Hold to talk';
            }
            resetIdleTimer();
        };

        browserRecognition.start();
        isRecording = true;
        micBtn.classList.add('mark-listening');
        micHint.textContent = 'Listening... release to send';
    }

    function stopBrowserRecognition() {
        if (browserRecognition) {
            try { browserRecognition.stop(); } catch(_){}
            browserRecognition = null;
        }
    }

    // ============================================================
    // CHAT — Backend (primary) → WP REST (fallback)
    // Backend has: Mark's soul, product catalog, conversation context
    // ============================================================
    /**
     * Chat handler — Backend (primary) then WP REST (fallback).
     * @param {string} userInput — the user's message
     * @param {string} ragContext — optional RAG context from mark-brain.js
     */
    window.processChatMessage = async function(userInput, ragContext) {
        conversationHistory.push({ role: 'user', content: userInput });

        // Build the enriched message with RAG context (if available)
        const enrichedInput = ragContext
            ? userInput + ragContext
            : userInput;

        // Try Python backend first (full Mark personality + products + RAG)
        if (backendAlive) {
            try {
                // For backend, send RAG context as a separate system hint
                const messages = conversationHistory.slice(-12);
                if (ragContext) {
                    messages.push({ role: 'system', content: ragContext });
                }

                const res = await fetch(`${BACKEND}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: messages,
                        user_language: detectedLanguage,
                        store_id: STORE_ID
                    })
                });
                const data = await res.json();
                hideThinking();
                if (data.response) {
                    const reply = data.response.trim();
                    conversationHistory.push({ role: 'assistant', content: reply });
                    exchangeCount++;
                    if (conversationHistory.length > 16) conversationHistory = conversationHistory.slice(-16);
                    saveSessionHistory();
                    showCaption(reply, true);
                    speak(reply);
                    return;
                }
            } catch(e) {
                // Backend failed, try WP fallback
            }
        }

        // Fallback: WP REST — inject RAG context into history so Groq sees it
        try {
            const historyForWP = conversationHistory.slice(-12);
            if (ragContext) {
                // Add RAG context as a system message in the history
                historyForWP.push({ role: 'system', content: ragContext });
            }

            const res = await fetch(WP_REST + 'chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': WP_NONCE },
                body: JSON.stringify({
                    message: userInput,
                    language: detectedLanguage,
                    store_id: STORE_ID,
                    session_id: SESSION_ID,
                    history: historyForWP
                })
            });
            const data = await res.json();
            hideThinking();
            if (data.reply) {
                const reply = data.reply.trim();
                conversationHistory.push({ role: 'assistant', content: reply });
                exchangeCount++;
                if (conversationHistory.length > 16) conversationHistory = conversationHistory.slice(-16);
                saveSessionHistory();
                showCaption(reply, true);
                speak(reply);
                return;
            }
        } catch(e) { /* both failed */ }

        hideThinking();
        showCaption(pickRandom(MARK_MSGS.connectionFail));
        resetIdleTimer();
    };

    // ============================================================
    // EXPOSE GLOBALS for mark-brain.js
    // ============================================================
    window.speak = function(t) { speak(t); };
    Object.defineProperty(window, 'detectedLanguage', {
        get() { return detectedLanguage; },
        set(v) { detectedLanguage = v; },
        configurable: true
    });

    // ============================================================
    // BIND EVENTS
    // ============================================================
    function bindEvents() {
        // Pointer events (desktop + modern mobile)
        markWidget.addEventListener('pointerdown', onPointerDown, { passive: false });
        markWidget.addEventListener('pointermove', onPointerMove, { passive: false });
        markWidget.addEventListener('pointerup', onPointerUp, { passive: false });

        // Touch events fallback (ensures mobile drag works on all devices)
        if (DEVICE.touch) {
            markWidget.addEventListener('touchstart', onTouchStart, { passive: false });
            markWidget.addEventListener('touchmove', onTouchMove, { passive: false });
            markWidget.addEventListener('touchend', onTouchEnd, { passive: false });
            markWidget.addEventListener('touchcancel', onTouchEnd, { passive: false });
        }

        closeBtn.addEventListener('click', returnToWidget);
        talkBackdrop.addEventListener('click', returnToWidget);

        micBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); startRecording(); });
        micBtn.addEventListener('pointerup',   (e) => { e.preventDefault(); stopRecording(); });
        micBtn.addEventListener('pointerleave',() => { if (isRecording) stopRecording(); });
        micBtn.addEventListener('pointercancel',()=> { if (isRecording) stopRecording(); });

        // Touch fallback for mic on mobile
        if (DEVICE.touch) {
            micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); }, { passive: false });
            micBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); }, { passive: false });
        }

        sendBtn.addEventListener('click', handleTextSubmit);
        textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleTextSubmit(); }
            cancelIdleTimer();
        });

        window.addEventListener('resize', () => {
            if (markState === 'widget' && markWidget) {
                const r = markWidget.getBoundingClientRect();
                if (r.left + WIDGET_PX > window.innerWidth) markWidget.style.left = (window.innerWidth - WIDGET_PX - 30) + 'px';
                if (r.top + WIDGET_PX > window.innerHeight) markWidget.style.top = (window.innerHeight - WIDGET_PX - 30) + 'px';
            }
        });
    }

    // ============================================================
    // BOOT
    // ============================================================
    function init() {
        buildDOM();
        assignDOMRefs();
        bindEvents();
        initThree();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
