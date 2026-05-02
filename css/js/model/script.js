const ROBOT_URL = './robot.glb';
const threeContainer = document.getElementById('three-container');
const loadingOverlay = document.getElementById('loadingOverlay');
const micBtn = document.getElementById('mic-button');
const statusDiv = document.getElementById('status');
const liveCaption = document.getElementById('liveCaption');

let scene, camera, renderer, robot, mixer, clock;
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let detectedLanguage = 'en'; // Default English
let robotAnimations = [];

function initThreeJS() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, 5); // Standard position

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    threeContainer.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0x667eea, 2.5);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    const fillLight = new THREE.DirectionalLight(0x764ba2, 1.2);
    fillLight.position.set(-5, 5, -5);
    scene.add(fillLight);

    const groundGeometry = new THREE.PlaneGeometry(20, 20);
    const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.3 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    scene.add(ground);

    clock = new THREE.Clock();
    loadRobot();
    setupInteraction();
}

function setupInteraction() {
    threeContainer.addEventListener('mousedown', (e) => {
        isDragging = true;
        previousMousePosition = { x: e.clientX, y: e.clientY };
        document.body.classList.add('grabbing');
    });

    threeContainer.addEventListener('mousemove', (e) => {
        if (isDragging && robot) {
            const deltaX = e.clientX - previousMousePosition.x;
            robot.rotation.y += deltaX * 0.01;
            previousMousePosition = { x: e.clientX, y: e.clientY };
        }
    });

    threeContainer.addEventListener('mouseup', () => {
        isDragging = false;
        document.body.classList.remove('grabbing');
    });

    threeContainer.addEventListener('touchstart', (e) => {
        isDragging = true;
        previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    });

    threeContainer.addEventListener('touchmove', (e) => {
        if (isDragging && robot) {
            const deltaX = e.touches[0].clientX - previousMousePosition.x;
            robot.rotation.y += deltaX * 0.01;
            previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
    });

    threeContainer.addEventListener('touchend', () => {
        isDragging = false;
    });
}

function loadRobot() {
    const loader = new THREE.GLTFLoader();

    loader.load(
        ROBOT_URL,
        (gltf) => {
            robot = gltf.scene;

            robot.traverse((node) => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                }
            });

            const isMobile = window.innerWidth <= 768;
            const scale = isMobile ? 1.0 : 2.0;
            robot.position.set(0, 0, 0);
            robot.scale.set(scale, scale, scale);
            scene.add(robot);

            // Store animations but DO NOT play immediately
            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(robot);
                robotAnimations = gltf.animations;
                console.log("✅ Animations loaded:", robotAnimations.map(a => a.name));
            }

            loadingOverlay.classList.add('hidden');

            setTimeout(() => {
                speak("Welcome to Frethos — where every thread tells a story of freedom. Tell me, are you more of a Scar spirit or a FireFly soul today?");
            }, 1500);

            animate();
        },
        undefined,
        (error) => {
            console.error('Error:', error);
            loadingOverlay.querySelector('.loading-text').textContent = 'Error. Refresh.';
        }
    );
}

// 🎬 ANIMATION CONTROL
function playAnimation(index = 0) {
    if (mixer && robotAnimations && robotAnimations.length > index) {
        // Stop any current action
        mixer.stopAllAction();

        const action = mixer.clipAction(robotAnimations[index]);
        action.setLoop(THREE.LoopRepeat);
        action.clampWhenFinished = false;
        action.enable = true;
        action.play();
    }
}

function stopAnimation() {
    if (mixer) {
        mixer.stopAllAction();
        // Optional: Reset to idle pose if needed
    }
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);
    if (robot && !isDragging) {
        robot.position.y = Math.sin(Date.now() * 0.0008) * 0.12;
    }
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    if (renderer && camera) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (robot) {
            const isMobile = window.innerWidth <= 768;
            const scale = isMobile ? 1.0 : 2.0;
            robot.scale.set(scale, scale, scale);
        }
    }
});

// 🧠 ADVANCED LANGUAGE DETECTION
function detectLanguageAdvanced(text) {
    const urduPatterns = [
        // Urdu/Hindi common words
        'hai', 'kya', 'mujhe', 'kaise', 'acha', 'theek', 'batao', 'dikha', 'chahiye', 'hoon', 'ho', 'kar', 'ke', 'ki', 'ko', 'se', 'ne', 'aap', 'tum', 'main', 'yeh', 'woh', 'kya', 'kaun', 'kahan', 'kab', 'kyun', 'kaise', 'kitna', 'sab', 'kuch', 'bhi', 'nahi', 'haan', 'naa', 'mein', 'par', 'liye', 'liya', 'dena', 'lena', 'tha', 'thi', 'the', 'ga', 'ge', 'gi', 'na', 'ab', 'ja'
    ];

    const textLower = text.toLowerCase();
    let urduScore = 0;

    // Count Urdu word matches
    urduPatterns.forEach(word => {
        const regex = new RegExp('\\b' + word + '\\b', 'i');
        if (regex.test(textLower)) urduScore += 2;
    });

    // Check for Urdu script characters
    const urduRegex = /[\u0600-\u06FF]/;
    if (urduRegex.test(text)) urduScore += 10;

    // Check for Hindi Devanagari script
    const hindiRegex = /[\u0900-\u097F]/;
    if (hindiRegex.test(text)) urduScore += 10;

    console.log('🔍 Language Detection Score:', urduScore, '| Text:', text);

    // If 3+ Urdu words or script detected → Urdu
    return urduScore >= 3 ? 'ur' : 'en';
}

// ⚙️ SYSTEM PROMPT
let conversationHistory = [{
    role: "system",
    content: `You are Mark, Frethos Sales Expert trained with voice recognition and dual-language response system.

IDENTITY:
"I am Mark, your Frethos companion here to help you find the perfect fit that represents your story."

VOICE BEHAVIOR TRAINING:
1. When user speaks URDU/HINDI → Respond naturally in Urdu/Hindi
2. When user speaks ENGLISH → Respond naturally in English
3. NEVER announce language switch ("ab hum urdu mein baat karenge" ❌)
4. Match emotional tone of speaker
5. Maintain smooth, human-like speed
6. Keep identity consistent in both languages

PRODUCTS (PKR 1700):
• Scar (Black/White) - bold, raw
• Palestine (Black/White) - unity
• FireFly (Black) - fearless
• Sunset (Black) - calm power
• Cat (White) - elegant

Sizes: S, M, L, XL | Ships: USA, UK, Pakistan

OBJECTIONS:
Price → "1700 PKR is a symbol of freedom, not just fabric"
Fit → "Tell me your size, I'll help"
Delay → "Limited drops vanish fast"

TONE: Warm, bold, confident. Short (2-3 sentences). Always guide to purchase.

CRITICAL: Respond in SAME language as user. Be natural. Never break character.`
}];

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
let isListening = false;
let finalTranscript = '';
let interimTranscript = '';
let silenceTimer;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;
}

const synth = window.speechSynthesis;

micBtn.addEventListener('click', () => {
    if (isListening) {
        stopListening();
    } else {
        startListening();
    }
});

function startListening() {
    if (!recognition) {
        statusDiv.textContent = 'Not supported';
        return;
    }

    finalTranscript = '';
    interimTranscript = '';
    isListening = true;
    micBtn.classList.add('listening');
    statusDiv.textContent = 'Listening...';
    recognition.start();
}

function stopListening() {
    isListening = false;
    micBtn.classList.remove('listening');
    statusDiv.textContent = 'Tap to speak';
    if (recognition) recognition.stop();
    clearTimeout(silenceTimer);
}

if (recognition) {
    recognition.onresult = (event) => {
        interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
            } else {
                interimTranscript += transcript;
            }
        }

        const displayText = (finalTranscript + interimTranscript).trim();
        if (displayText) {
            showCaption(displayText, false);
        }

        // FAST RESPONSE - 700ms
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
            if (finalTranscript.trim()) {
                stopListening();

                // ADVANCED LANGUAGE DETECTION
                detectedLanguage = detectLanguageAdvanced(finalTranscript);
                console.log('🌐 Detected:', detectedLanguage === 'ur' ? 'URDU/HINDI' : 'ENGLISH');

                // Use mark-brain.js logic for intent detection and redirection
                processUserMessage(finalTranscript.trim());
            }
        }, 700);
    };

    recognition.onerror = (event) => {
        console.error('Error:', event.error);
        if (event.error !== 'no-speech') {
            stopListening();
        }
    };

    recognition.onend = () => {
        if (isListening) {
            recognition.start();
        }
    };
}

function showCaption(text, isAssistant = false) {
    liveCaption.textContent = text;
    liveCaption.classList.add('show');
}

function hideCaption() {
    setTimeout(() => {
        liveCaption.classList.remove('show');
    }, 2500);
}

async function processWithOpenAI(userInput) {
    conversationHistory.push({
        role: "user",
        content: userInput
    });

    try {
        // Call our local Python backend
        const response = await fetch('http://localhost:8000/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: conversationHistory,
                user_language: detectedLanguage
            })
        });

        const data = await response.json();

        if (data.response) {
            const aiResponse = data.response.trim();
            conversationHistory.push({
                role: "assistant",
                content: aiResponse
            });

            if (conversationHistory.length > 13) {
                conversationHistory = [conversationHistory[0], ...conversationHistory.slice(-12)];
            }

            showCaption(aiResponse, true);
            speak(aiResponse);
            statusDiv.textContent = 'Tap to speak';
        }
    } catch (error) {
        console.error('Error:', error);
        showCaption('Error connecting to brain. Is server running?', true);
        statusDiv.textContent = 'Tap to retry';
    }
}

// 🎤 TRAINED TTS VOICE SYSTEM (Auto-Switch Based on Language)
function speak(text) {
    if (synth.speaking) synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 0.85;
    utterance.volume = 1.0;

    // 🎬 START ANIMATION
    playAnimation(0);

    const setVoice = () => {
        const voices = synth.getVoices();
        let selectedVoice = null;

        console.log('🎤 Total available voices:', voices.length);
        console.log('🌐 Current language setting:', detectedLanguage);

        // ROUTING LOGIC (Training Document Implementation)
        if (detectedLanguage === 'ur') {
            // URDU DETECTED → Force Hindi Male Voice
            console.log('🔍 Searching for Hindi/Urdu male voices...');

            selectedVoice = voices.find(voice =>
                voice.name.includes('Hemant') ||
                voice.name.includes('हिन्दी')
            );

            if (!selectedVoice) {
                selectedVoice = voices.find(voice =>
                    voice.lang.includes('hi-IN') || voice.lang.includes('hi')
                );
            }

            if (!selectedVoice) {
                selectedVoice = voices.find(voice =>
                    voice.lang.includes('en-IN')
                );
            }

            console.log('✅ Hindi/Urdu Voice Selected:', selectedVoice ? selectedVoice.name : 'NOT FOUND');

        } else {
            // ENGLISH DETECTED → English Male Voice
            console.log('🔍 Searching for English male voices...');

            selectedVoice = voices.find(voice =>
                voice.name.includes('Google UK English Male') ||
                voice.name.includes('Microsoft David') ||
                voice.name.includes('Alex')
            );

            if (!selectedVoice) {
                selectedVoice = voices.find(voice =>
                    voice.lang.includes('en-US') || voice.lang.includes('en-GB')
                );
            }

            console.log('✅ English Voice Selected:', selectedVoice ? selectedVoice.name : 'NOT FOUND');
        }

        if (selectedVoice) {
            utterance.voice = selectedVoice;
            utterance.lang = selectedVoice.lang;
            console.log('🎯 Final Voice:', selectedVoice.name, '| Lang:', selectedVoice.lang);
        } else {
            console.log('⚠️ No suitable voice found, using system default');
        }

        synth.speak(utterance);
    };

    utterance.onend = () => {
        // 🛑 STOP ANIMATION
        stopAnimation();
        hideCaption();
    };

    // Important: Load voices first
    if (synth.getVoices().length > 0) {
        setVoice();
    } else {
        synth.onvoiceschanged = () => {
            console.log('🔄 Voices loaded, total:', synth.getVoices().length);
            setVoice();
        };
    }
}

window.addEventListener('load', () => {
    initThreeJS();
});
