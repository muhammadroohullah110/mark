/* ============================================================
   MARK AI — Rive Animator (real, designer-authored motion)
   ------------------------------------------------------------
   Drop-in layer for "real" character animation via Rive
   (https://rive.app). It is INERT by default: unless a valid
   .riv URL is provided (markAIConfig.riveUrl) AND it loads
   successfully, this module does nothing and the existing
   Three.js robot keeps running untouched.

   On a successful load it transparently bridges
   window.markAnimator.play(...) → Rive, so NO other code needs
   to change. See MARK_RIVE_SPEC.md for the .riv contract
   (artboard "Mark", state machine "MarkSM", inputs:
   mood[Number], wave/jump/wink/celebrate[Trigger]).
   ============================================================ */
(function () {
    'use strict';

    var RIVE_CDN = 'https://unpkg.com/@rive-app/canvas@2.21.6/rive.js';
    var ARTBOARD = 'Mark';
    var STATE_MACHINE = 'MarkSM';

    // semantic state → Rive input action
    var MOODS = { idle: 0, speak: 1, listen: 2, think: 3 };
    var TRIGGERS = { wave: 1, jump: 1, wink: 1, celebrate: 1 };

    var _rive = null;          // Rive instance
    var _inputs = {};          // name → input object
    var _active = false;
    var _canvas = null;
    var _curMood = 0;

    function log() {
        if (window.MARK_DEBUG) { try { console.log.apply(console, ['[MarkRive]'].concat([].slice.call(arguments))); } catch (e) {} }
    }

    function loadRuntime(cb) {
        if (window.rive && window.rive.Rive) { cb(); return; }
        var s = document.createElement('script');
        s.src = RIVE_CDN;
        s.async = true;
        s.onload = function () { cb(); };
        s.onerror = function () { log('runtime load failed'); cb(new Error('rive runtime failed')); };
        document.head.appendChild(s);
    }

    function mountCanvas(mountSelector) {
        var host = document.querySelector(mountSelector || '#mark-widget');
        if (!host) return null;
        var c = document.getElementById('mark-rive-canvas');
        if (!c) {
            c = document.createElement('canvas');
            c.id = 'mark-rive-canvas';
            c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
            host.appendChild(c);
        }
        return c;
    }

    function getInput(name) {
        return _inputs[name] || null;
    }

    function setMood(value) {
        _curMood = value;
        var m = getInput('mood');
        if (m) { try { m.value = value; } catch (e) {} }
    }

    function fire(name) {
        var t = getInput(name);
        if (t && typeof t.fire === 'function') { try { t.fire(); } catch (e) {} }
    }

    // public play() — mirrors markAnimator.play(state)
    function play(state) {
        if (!_active) return;
        if (Object.prototype.hasOwnProperty.call(MOODS, state)) {
            setMood(MOODS[state]);
        } else if (Object.prototype.hasOwnProperty.call(TRIGGERS, state)) {
            fire(state);            // one-shot; SM returns to current mood
        } else if (state === 'walk' || state === 'wave') {
            // walk maps to idle posture (free-roam handled by CSS movement)
            if (state === 'wave') fire('wave'); else setMood(0);
        }
        // unknown states are ignored (graceful)
    }

    // Once Rive is live, route the existing animator through it without
    // editing any call sites. Falls back gracefully if animator isn't ready yet.
    function bridgeAnimator(attempt) {
        attempt = attempt || 0;
        if (!window.markAnimator) {
            if (attempt < 25) { setTimeout(function () { bridgeAnimator(attempt + 1); }, 200); }
            return;
        }
        if (window.markAnimator.__riveBridged) return;
        window.markAnimator.__riveBridged = true;
        window.markAnimator.play = function (state) { play(state); };
        // Hide the Three.js robot — Rive now owns the visuals.
        var three = document.getElementById('mark-three-container');
        if (three) three.style.opacity = '0';
        log('bridged markAnimator → Rive');
    }

    function init(opts) {
        opts = opts || {};
        var url = opts.url || (window.markAIConfig && window.markAIConfig.riveUrl) || '';
        if (!url) { log('no riveUrl — staying inert (Three.js robot in use)'); return; }

        loadRuntime(function (err) {
            if (err || !window.rive || !window.rive.Rive) return;   // stay inert
            _canvas = mountCanvas(opts.mountSelector);
            if (!_canvas) { log('no mount node'); return; }
            try {
                _rive = new window.rive.Rive({
                    src: url,
                    canvas: _canvas,
                    autoplay: true,
                    artboard: ARTBOARD,
                    stateMachines: STATE_MACHINE,
                    onLoad: function () {
                        try {
                            _rive.resizeDrawingSurfaceToCanvas();
                            var arr = _rive.stateMachineInputs(STATE_MACHINE) || [];
                            for (var i = 0; i < arr.length; i++) { _inputs[arr[i].name] = arr[i]; }
                            _active = true;
                            setMood(0);
                            // keep the drawing surface crisp as the widget resizes
                            if (window.ResizeObserver && _canvas.parentNode) {
                                new ResizeObserver(function () {
                                    try { _rive.resizeDrawingSurfaceToCanvas(); } catch (e) {}
                                }).observe(_canvas.parentNode);
                            }
                            bridgeAnimator();
                            log('active — Rive robot live');
                        } catch (e) { log('onLoad error', e); }
                    },
                    onLoadError: function (e) { log('rive load error', e); }   // stay inert
                });
            } catch (e) { log('init threw', e); }   // stay inert → Three.js continues
        });
    }

    window.MarkRive = {
        init: init,
        play: play,
        isActive: function () { return _active; }
    };

    // Auto-init once config is available (no-op if riveUrl is empty).
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { init(); });
    } else {
        init();
    }
})();
