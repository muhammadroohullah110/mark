// ============================================================
// MARK ANIMATOR
// Base GLB clip ALWAYS plays underneath (the "alive" feel).
// Procedural animations layer on top:
//   idle, speak, wave, jump, blush, wink, listen, think
// ============================================================

class MarkAnimator {
    constructor() {
        this.robot      = null;
        this.mixer      = null;
        this.glbClips   = [];
        this.scene      = null;
        this.state      = 'idle';
        this.timer      = 0;
        this.blushLight = null;
        this.basePos    = { x: 0, y: 0, z: 0 };
    }

    init(robot, mixer, glbClips, scene) {
        this.robot    = robot;
        this.mixer    = mixer;
        this.glbClips = glbClips;
        this.scene    = scene;
        this.basePos  = { x: robot.position.x, y: robot.position.y, z: robot.position.z };

        // ── Always play the GLB clip in a loop — it's the "alive" base
        if (mixer && glbClips.length > 0) {
            const action = mixer.clipAction(glbClips[0]);
            action.setLoop(THREE.LoopRepeat);
            action.setEffectiveWeight(1);
            action.play();
        }
    }

    // PUBLIC: switch to a procedural overlay state
    play(state) {
        if (!this.robot) return;
        if (this.state === state) {
            this.timer = 0; // restart same animation (don't skip)
            return;
        }
        this._reset();
        this.state = state;
        this.timer = 0;
        if (state === 'blush') this._addBlushLight();
    }

    _reset() {
        if (this.robot) {
            this.robot.rotation.x = 0;
            this.robot.rotation.y = 0;
            this.robot.rotation.z = 0;
        }
        this._removeBlushLight();
    }

    update(delta) {
        if (!this.robot) return;
        this.timer += delta;

        if (this.mixer) this.mixer.update(delta);

        const t = this.timer;
        switch (this.state) {
            case 'idle':   this._idle(t);    break;
            case 'speak':  this._speak(t);   break;
            case 'wave':   this._wave(t);    break;
            case 'jump':   this._jump(t);    break;
            case 'blush':  this._blush(t);   break;
            case 'wink':   this._wink(t);    break;
            case 'listen': this._listen(t);  break;
            case 'think':  this._think(t);   break;
        }
    }

    // ── IDLE — alive: float + slow look-around + breathing tilts ──
    // Visibly 3D even at rest, so Mark never looks frozen.
    _idle(t) {
        this.robot.position.y = this.basePos.y + Math.sin(t * 1.0) * 0.16;   // bob
        this.robot.rotation.y = Math.sin(t * 0.45) * 0.40;                   // slow look left/right (3D turn)
        this.robot.rotation.x = Math.sin(t * 0.7) * 0.05;                    // gentle breathing nod
        this.robot.rotation.z = Math.sin(t * 0.6) * 0.05;                    // subtle sway
    }

    // ── SPEAK — visible head bob & nod while talking ────────────
    _speak(t) {
        this.robot.position.y = this.basePos.y + Math.sin(t * 3.5) * 0.35;
        this.robot.rotation.x = Math.sin(t * 4.2) * 0.12;
        this.robot.rotation.z = Math.sin(t * 2.8) * 0.08;
    }

    // ── WAVE — big enthusiastic rocking (3.5 s) ─────────────────
    _wave(t) {
        const env = t < 0.3 ? t / 0.3
                  : t < 2.8 ? 1.0
                  : Math.max(0, 1 - (t - 2.8) / 0.7);
        this.robot.rotation.z = Math.sin(t * 6.0) * 0.50 * env;
        this.robot.position.y = this.basePos.y + Math.sin(t * 1.5) * 0.25;
        if (t > 3.5) this.play('idle');
    }

    // ── JUMP — proper jump arc (1.0 s) ──────────────────────────
    _jump(t) {
        const dur = 1.0;
        const p   = Math.min(t / dur, 1);
        const arc = Math.sin(p * Math.PI);
        this.robot.position.y = this.basePos.y + arc * 1.4;
        this.robot.rotation.x = Math.sin(p * Math.PI * 2) * 0.20;
        if (t > dur) this.play('idle');
    }

    // ── BLUSH — shy tilt + pink glow (3.5 s) ───────────────────
    _blush(t) {
        const tilt = t < 0.4 ? (t / 0.4) * 0.30
                   : t < 2.6 ? 0.30
                   : Math.max(0, 0.30 * (1 - (t - 2.6) / 0.7));
        this.robot.rotation.x = tilt;
        this.robot.position.y = this.basePos.y + Math.sin(t * 0.9) * 0.10;

        if (this.blushLight) {
            this.blushLight.intensity =
                t < 0.5 ? (t / 0.5) * 4.0
              : t < 2.6 ? 3.0 + Math.sin(t * 4.0) * 1.0
              : Math.max(0, 4.0 - (t - 2.6) * 4.0);
        }
        if (t > 3.5) this.play('idle');
    }

    // ── WINK — head tilt + cheeky bounce (1.8 s) ────────────────
    _wink(t) {
        const dur = 1.8;
        const tilt = t < 0.3 ? (t / 0.3) * 0.30
                   : t < 1.2 ? 0.30
                   : Math.max(0, 0.30 * (1 - (t - 1.2) / 0.6));
        this.robot.rotation.z = tilt;
        this.robot.position.y = this.basePos.y + Math.sin(t * 4.0) * 0.18;
        if (t > dur) this.play('idle');
    }

    // ── LISTEN — attentive lean forward, gentle nod (while user speaks) ──
    _listen(t) {
        const lean = Math.min(t / 0.3, 1) * 0.15;     // lean forward eagerly
        this.robot.rotation.x = lean;
        this.robot.rotation.z = Math.sin(t * 1.8) * 0.03;  // tiny nod side-to-side
        this.robot.position.y = this.basePos.y + Math.sin(t * 1.2) * 0.05; // subtle breathing
    }

    // ── THINK — look up, gentle sway (while processing response) ─
    _think(t) {
        const lookUp = Math.min(t / 0.4, 1) * -0.20;  // tilt head up (thinking)
        this.robot.rotation.x = lookUp;
        this.robot.rotation.z = Math.sin(t * 2.0) * 0.12;  // visible sway
        this.robot.position.y = this.basePos.y + Math.sin(t * 0.8) * 0.15;
    }

    _addBlushLight() {
        this.blushLight = new THREE.PointLight(0xff5a9b, 0, 5.0);
        this.blushLight.position.set(0, 1.3, 1.6);
        this.scene.add(this.blushLight);
    }

    _removeBlushLight() {
        if (this.blushLight) {
            this.scene.remove(this.blushLight);
            this.blushLight = null;
        }
    }
}


// ============================================================
// SITUATION DETECTOR — picks animation from text
// Works for English text analysis
// ============================================================

class MarkSituationDetector {
    detect(text, speaker) {
        const t = text.toLowerCase();

        if (speaker === 'mark') {
            if (this._isGreeting(t))  return 'wave';
            if (this._isExcited(t))   return 'jump';
            if (this._isCharming(t))  return 'wink';
            return 'speak';
        }
        if (speaker === 'user') {
            if (this._isCompliment(t)) return 'blush';
            if (this._isExcited(t))    return 'jump';
        }
        return null;
    }

    _isGreeting(t) {
        return /\b(hello|hi\b|welcome|hey there|hey hey|good morning|good evening|good afternoon|greetings|how are you|nice to meet|howdy|what's up|whats up)\b/i.test(t);
    }
    _isExcited(t) {
        return /\b(amazing|fantastic|great deal|love it|perfect|incredible|wow|congratulations|awesome|wonderful|brilliant|excellent|outstanding|epic|sweet|oh my|yay|woohoo|let's go)\b/i.test(t)
            || /[!]{2,}/.test(t); // multiple exclamation marks = excited
    }
    _isCompliment(t) {
        return /\b(you('re| are) (cute|sweet|great|awesome|amazing|smart|funny|adorable|the best|cool|helpful)|love you|good job|well done|nice work|so cute|so smart|so cool|thank you|thanks mark|you rock|great job)\b/i.test(t);
    }
    _isCharming(t) {
        return /\b(secret|just between us|exclusive|only for you|insider|between you and me|special deal|tell you what|guess what|let me tell you|here's the thing|fun fact|did you know|bonus|surprise)\b/i.test(t);
    }
}

window.markAnimator          = new MarkAnimator();
window.markSituationDetector = new MarkSituationDetector();
