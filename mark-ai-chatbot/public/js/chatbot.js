/**
 * Mark AI — 3D Robot Shopping Companion (WP Plugin)
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

    // Backend (Python on Render) — primary for all AI features
    const BACKEND = (typeof MARK_BACKEND !== 'undefined') ? MARK_BACKEND : 'https://mark-ix64.onrender.com';
    // WP REST — fallback only
    const WP_REST = (typeof MARK_WP_REST !== 'undefined') ? MARK_WP_REST : '/wp-json/mark-ai/v1/';
    const WP_NONCE = (typeof MARK_WP_NONCE !== 'undefined') ? MARK_WP_NONCE : '';

    // Robot
    const ROBOT_URL         = PLUGIN_URL + 'public/model/robot.glb';
    const WIDGET_PX         = 115;
    const TALKING_PX        = 320;
    const MOBILE_PX         = window.innerWidth <= 768 ? 95 : null;
    const MOBILE_TPX        = window.innerWidth <= 768 ? 260 : null;
    const IDLE_TIMEOUT_SHORT = 10000;
    const IDLE_TIMEOUT_LONG  = 25000;
    const WALK_INTERVAL     = 5500;
    const MEMORY_KEY        = 'mark_memory';

    const W_CAM = { fov:50, x:0, y:0.5, z:3.4 };
    const T_CAM = { fov:50, x:0, y:0.7, z:4.0 };

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
    let detectedLanguage  = LANG;
    let languageLocked    = false;
    let lastMarkText      = '';
    let exchangeCount     = 0;
    let currentAudio      = null;
    let ttsAvailable      = false;
    let backendAlive      = false;
    let conversationHistory = [];

    // ============================================================
    // BUILD DOM
    // ============================================================
    function buildDOM() {
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
    const MAX_RETRIES  = 4;

    async function checkBackend() {
        if (!BACKEND) return;
        try {
            const res = await fetch(`${BACKEND}/api/status`, { signal: AbortSignal.timeout(8000) });
            const data = await res.json();
            backendAlive = true;
            ttsAvailable = data.tts_available || false;
            backendRetries = 0;
        } catch {
            backendAlive = false;
            ttsAvailable = false;
            // Retry with exponential backoff (5s, 10s, 20s, 40s)
            if (backendRetries < MAX_RETRIES) {
                const delay = 5000 * Math.pow(2, backendRetries);
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
        const skip = ['hello','hi','hey','yes','no','ok','sure','please','show','find','english','urdu','want','need','the','and','but'];
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
            loadingOverlay.querySelector('.mark-loading-text').textContent = 'Error: 3D engine not loaded.';
            return;
        }

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(W_CAM.fov, 1, 0.1, 1000);
        camera.position.set(W_CAM.x, W_CAM.y, W_CAM.z);

        renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
        const px = MOBILE_PX || WIDGET_PX;
        renderer.setSize(px, px);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        threeContainer.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 1.4));
        const dir = new THREE.DirectionalLight(0x9bb0ff, 2.6);
        dir.position.set(5, 10, 7); dir.castShadow = true; scene.add(dir);
        const fill = new THREE.DirectionalLight(0x9b59ff, 1.4);
        fill.position.set(-5, 5, -5); scene.add(fill);

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
            loadingOverlay.querySelector('.mark-loading-text').textContent = 'Error loading Mark. Refresh.';
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
        const w = MOBILE_PX || WIDGET_PX;
        const isMobile = window.innerWidth <= 768;

        if (isMobile) {
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
    // DRAGGING
    // ============================================================
    let dragData = null, didDrag = false;

    function onPointerDown(e) {
        if (markState !== 'widget') return;
        e.preventDefault(); markWidget.setPointerCapture(e.pointerId);
        stopWalking(); markWidget.classList.add('mark-dragging');
        const r = markWidget.getBoundingClientRect();
        dragData = { startX:e.clientX, startY:e.clientY, widgetX:r.left, widgetY:r.top };
        didDrag = false;
    }
    function onPointerMove(e) {
        if (!dragData) return;
        const dx = e.clientX - dragData.startX, dy = e.clientY - dragData.startY;
        if (Math.abs(dx) + Math.abs(dy) > 8) didDrag = true;
        if (didDrag) {
            markWidget.style.left = (dragData.widgetX+dx)+'px';
            markWidget.style.top  = (dragData.widgetY+dy)+'px';
        }
    }
    function onPointerUp(e) {
        if (!dragData) return;
        markWidget.classList.remove('mark-dragging');
        try { markWidget.releasePointerCapture(e.pointerId); } catch(_){}
        if (didDrag) { setTimeout(() => { if (markState==='widget') startWalking(); }, 2000); }
        else { enterTalkingMode(); }
        dragData = null; didDrag = false;
    }

    // ============================================================
    // TALKING MODE
    // ============================================================
    function enterTalkingMode() {
        if (markState !== 'widget') return;
        markState = 'talking'; exchangeCount = 0;
        clearTimeout(walkTimer);
        markHint.style.display = 'none';

        // If backend isn't awake yet, kick off a fresh wake-up attempt
        if (!backendAlive) { backendRetries = 0; checkBackend(); }

        root.classList.add('mark-talking');
        markWidget.classList.add('mark-talking');

        setTimeout(() => {
            const px = MOBILE_TPX || TALKING_PX;
            renderer.setSize(px, px);
            camera.fov = T_CAM.fov;
            camera.position.set(T_CAM.x, T_CAM.y, T_CAM.z);
            camera.updateProjectionMatrix();
        }, 720);

        const mem = loadMemory();
        if (mem.name && mem.language) {
            detectedLanguage = mem.language;
            languageLocked = true;
            playCuteAyie(() => { sendGreeting('returning', mem.name, mem.language); });
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
        conversationHistory = [];

        setTimeout(() => {
            const px = MOBILE_PX || WIDGET_PX;
            renderer.setSize(px, px);
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
        liveCaption.style.opacity = '0';
        thinkingEl.textContent = detectedLanguage === 'ur' ? 'Mark soch raha hai' : 'Mark is thinking';
        thinkingEl.classList.add('mark-show');
        window.markAnimator.play('think');
    }
    function hideThinking() { thinkingEl.classList.remove('mark-show'); }

    // ============================================================
    // GREETINGS — routes through backend (has Mark's soul + products)
    // ============================================================
    async function sendGreeting(type, name, language) {
        showThinking();

        let msg;
        if (type === 'returning') {
            msg = `__RETURNING__:Name is ${name}. Language preference is ${language === 'ur' ? 'Roman Urdu' : 'English'}.`;
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
                    })
                });
                const data = await res.json();
                hideThinking();
                if (data.response) {
                    conversationHistory.push({ role: 'assistant', content: data.response });
                    showCaption(data.response);
                    speak(data.response);
                    return;
                }
            } catch(e) { /* fall through to WP fallback */ }
        }

        // Fallback to WP REST
        try {
            const res = await fetch(WP_REST + 'chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': WP_NONCE },
                body: JSON.stringify({ message: msg, language: language || detectedLanguage, store_id: STORE_ID })
            });
            const data = await res.json();
            hideThinking();
            if (data.reply) {
                conversationHistory.push({ role: 'assistant', content: data.reply });
                showCaption(data.reply);
                speak(data.reply);
                return;
            }
        } catch(e) { /* both failed */ }

        // Hardcoded fallback
        hideThinking();
        const fb = type === 'returning'
            ? (language === 'ur' ? `${name}! Wapas aaye -- bohat acha! Kya chahiye aaj?` : `${name}! Welcome back! What are you looking for today?`)
            : "Hey hey! I'm Mark, your shopping buddy. What's your name -- and shall we chat in English ya Urdu?";
        showCaption(fb); speak(fb);
    }

    // ============================================================
    // LANGUAGE DETECTION
    // ============================================================
    function detectLanguageAdvanced(text) {
        const patterns = ['hai','kya','mujhe','kaise','acha','theek','batao','dikha',
            'chahiye','hoon','ho','kar','ke','ki','ko','se','ne','aap','tum','main',
            'yeh','woh','kaun','kahan','kab','kyun','kitna','sab','kuch','bhi',
            'nahi','haan','naa','mein','par','liye','dena','lena','tha','thi','the',
            'bohat','zyada','thora','assalam','salaam','adaab','naam','mera'];
        let score = 0;
        const lower = text.toLowerCase();
        patterns.forEach(w => { if (new RegExp('\\b'+w+'\\b','i').test(lower)) score += 2; });
        if (/[؀-ۿ]/.test(text)) score += 10;
        return score >= 3 ? 'ur' : 'en';
    }

    function detectLanguagePreference(text) {
        const t = text.toLowerCase();
        if (/\b(urdu|roman urdu|urdoo)\b/.test(t)) return 'ur';
        if (/\b(english|angrezi|eng)\b/.test(t)) return 'en';
        return null;
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
            playBackendTTS(cleanText).catch(() => { playBrowserTTS(cleanText); });
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
        if (!res.ok) throw new Error('TTS failed');

        const blob = await res.blob();
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
        await currentAudio.play();
    }

    function playBrowserTTS(text) {
        if (!synth) { resetIdleTimer(); return; }
        const u = new SpeechSynthesisUtterance(text);
        if (detectedLanguage === 'ur') { u.rate = 0.88; u.pitch = 0.95; }
        else { u.rate = 0.97; u.pitch = 0.92; }
        u.volume = 1.0;

        const go = () => {
            const v = pickVoice(detectedLanguage);
            if (v) { u.voice = v; u.lang = v.lang; }
            if (detectedLanguage === 'ur') u.lang = 'en-IN';
            u.onend = () => { window.markAnimator.play('idle'); hideCaption(); resetIdleTimer(); };
            synth.speak(u);
        };
        synth.getVoices().length > 0 ? go() : (synth.onvoiceschanged = go);
    }

    function pickVoice(language) {
        const voices = synth.getVoices();
        if (language === 'ur') {
            return voices.find(v => v.name.includes('Microsoft Ravi'))
                || voices.find(v => v.lang === 'en-IN')
                || voices.find(v => v.lang.startsWith('hi'))
                || voices.find(v => v.lang.startsWith('en'));
        }
        return voices.find(v => v.name.includes('Microsoft Mark'))
            || voices.find(v => v.name.includes('Microsoft David'))
            || voices.find(v => v.name.includes('Google UK English Male'))
            || voices.find(v => v.lang === 'en-US')
            || voices.find(v => v.lang.startsWith('en'));
    }

    function playCuteAyie(callback) {
        if (!synth) { if (callback) setTimeout(callback, 300); return; }
        synth.cancel();
        const u = new SpeechSynthesisUtterance('Ayie!');
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
    // CAPTIONS
    // ============================================================
    let typewriterTimer = null;
    function showCaption(text, typewriter) {
        if (typewriter === undefined) typewriter = true;
        clearInterval(typewriterTimer);
        liveCaption.style.opacity = '1';
        if (!typewriter || text.length < 20) { liveCaption.textContent = text; return; }
        const words = text.split(' ');
        let shown = 0;
        liveCaption.textContent = '';
        typewriterTimer = setInterval(() => {
            shown++;
            liveCaption.textContent = words.slice(0, shown).join(' ');
            if (shown >= words.length) clearInterval(typewriterTimer);
        }, 70);
    }
    function hideCaption() { setTimeout(() => { liveCaption.style.opacity = '0.3'; }, 4000); }

    // ============================================================
    // HOLD-TO-RECORD MIC — Whisper transcription via backend
    // ============================================================
    let mediaRecorder = null, audioChunks = [], isRecording = false;

    async function startRecording() {
        if (markState !== 'talking' || isRecording) return;
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
            micHint.textContent = detectedLanguage === 'ur' ? 'Chor do bhejne ke liye' : 'Release to send';
        } catch {
            micHint.textContent = detectedLanguage === 'ur' ? 'Mic nahi mila' : 'Mic access denied';
        }
    }

    function stopRecording() {
        if (!isRecording) return;
        isRecording = false;
        micBtn.classList.remove('mark-listening');
        micHint.textContent = detectedLanguage === 'ur' ? 'Suno...' : 'Processing...';
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

        const langPref = detectLanguagePreference(text);
        if (langPref && !languageLocked) { detectedLanguage = langPref; languageLocked = true; }
        else if (!languageLocked) { detectedLanguage = detectLanguageAdvanced(text); }

        const name = tryExtractName(text);
        if (name) saveMemory({ name });
        if (languageLocked) saveMemory({ language: detectedLanguage });

        const userAnim = window.markSituationDetector.detect(text, 'user');
        if (userAnim && userAnim !== 'speak') window.markAnimator.play(userAnim);

        setTimeout(showThinking, 400);
        await processUserMessage(text);
        micHint.textContent = detectedLanguage === 'ur' ? 'Dabao aur bolo' : 'Hold to talk';
    }

    // ============================================================
    // TRANSCRIBE + PROCESS (voice → Whisper → chat)
    // ============================================================
    async function transcribeAndProcess(blob, mime) {
        if (!backendAlive) {
            hideThinking();
            showCaption(detectedLanguage === 'ur'
                ? 'Voice abhi available nahi. Type kar ke baat karo.'
                : 'Voice not available right now. Please type instead.');
            micHint.textContent = 'Hold to talk';
            resetIdleTimer();
            return;
        }

        try {
            showThinking();
            const form = new FormData();
            form.append('audio', blob, mime.includes('ogg') ? 'audio.ogg' : 'audio.webm');
            const headers = {};
            if (STORE_ID) headers['X-Store-ID'] = STORE_ID;

            const res = await fetch(`${BACKEND}/api/transcribe`, {
                method: 'POST',
                body: form,
                headers: headers
            });
            const data = await res.json();
            const text = data.text ? data.text.trim() : '';

            if (!text) { hideThinking(); micHint.textContent = detectedLanguage==='ur'?'Dabao aur bolo':'Hold to talk'; resetIdleTimer(); return; }
            if (isEcho(text)) { hideThinking(); micHint.textContent = detectedLanguage==='ur'?'Dabao aur bolo':'Hold to talk'; resetIdleTimer(); return; }

            hideThinking();
            await processTextInput(text);
        } catch(e) {
            hideThinking();
            showCaption(detectedLanguage==='ur'?'Voice server se connection nahi mila.':'Could not connect to voice server.');
            micHint.textContent = detectedLanguage==='ur'?'Dabao aur bolo':'Hold to talk';
            resetIdleTimer();
        }
    }

    // ============================================================
    // CHAT — Backend (primary) → WP REST (fallback)
    // Backend has: Mark's soul, product catalog, conversation context
    // ============================================================
    window.processWithOpenAI = async function(userInput) {
        conversationHistory.push({ role: 'user', content: userInput });

        // Try Python backend first (full Mark personality + products + RAG)
        if (backendAlive) {
            try {
                const res = await fetch(`${BACKEND}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: conversationHistory.slice(-12),
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
                    showCaption(reply, true);
                    speak(reply);
                    return;
                }
            } catch(e) {
                // Backend failed, try WP fallback
            }
        }

        // Fallback: WP REST (basic Groq chat, no products/personality)
        try {
            const res = await fetch(WP_REST + 'chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': WP_NONCE },
                body: JSON.stringify({
                    message: userInput,
                    language: detectedLanguage,
                    store_id: STORE_ID,
                    history: conversationHistory.slice(-12)
                })
            });
            const data = await res.json();
            hideThinking();
            if (data.reply) {
                const reply = data.reply.trim();
                conversationHistory.push({ role: 'assistant', content: reply });
                exchangeCount++;
                if (conversationHistory.length > 16) conversationHistory = conversationHistory.slice(-16);
                showCaption(reply, true);
                speak(reply);
                return;
            }
        } catch(e) { /* both failed */ }

        hideThinking();
        showCaption(detectedLanguage==='ur'?'Connection problem. Dobara try karo.':'Connection error. Please try again.');
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
        markWidget.addEventListener('pointerdown', onPointerDown);
        markWidget.addEventListener('pointermove', onPointerMove);
        markWidget.addEventListener('pointerup', onPointerUp);

        closeBtn.addEventListener('click', returnToWidget);
        talkBackdrop.addEventListener('click', returnToWidget);

        micBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); startRecording(); });
        micBtn.addEventListener('pointerup',   (e) => { e.preventDefault(); stopRecording(); });
        micBtn.addEventListener('pointerleave',() => { if (isRecording) stopRecording(); });
        micBtn.addEventListener('pointercancel',()=> { if (isRecording) stopRecording(); });

        sendBtn.addEventListener('click', handleTextSubmit);
        textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleTextSubmit(); }
            cancelIdleTimer();
        });

        window.addEventListener('resize', () => {
            if (markState === 'widget' && markWidget) {
                const r = markWidget.getBoundingClientRect();
                const w = MOBILE_PX || WIDGET_PX;
                if (r.left+w > window.innerWidth) markWidget.style.left = (window.innerWidth-w-30)+'px';
                if (r.top+w > window.innerHeight) markWidget.style.top = (window.innerHeight-w-30)+'px';
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
