# Mark — Rive Animation Contract (v1)

Mark's "real" motion path is **Rive** (https://rive.app). Rive art is authored in the
Rive editor and exported as a binary **`.riv`** file — it cannot be generated in code.
This document is the **contract** the `.riv` must follow so it drops straight into the
widget with zero code changes. Author (or commission) the asset to this spec.

The runtime integration already exists in `public/js/rive-animator.js`. The moment a
valid `.riv` (built to this contract) is supplied, Rive takes over the robot; if it is
absent or fails to load, the widget silently keeps the existing Three.js robot.

---

## 1. Artboard

| Property | Value |
|---|---|
| Artboard name | `Mark` |
| Canvas | square, transparent background |
| Design size | 600 × 600 (scales down to ~90px idle / ~280px talking) |
| Origin | centered |

## 2. State Machine

| Property | Value |
|---|---|
| State machine name | `MarkSM` (must be the default) |

### Inputs (exact names + types — case-sensitive)

| Input | Type | Meaning | Runtime sets it when |
|---|---|---|---|
| `mood` | Number | Continuous posture: `0`=idle, `1`=speak (talking), `2`=listen, `3`=think | Mark enters that ongoing state |
| `wave` | Trigger | One-shot greeting wave | Greeting / lead captured |
| `jump` | Trigger | One-shot excited hop | Excitement / success |
| `wink` | Trigger | One-shot wink | Playful beats |
| `celebrate` | Trigger | One-shot celebratory burst | Name celebration |

**Behavior expectations inside the state machine:**
- `mood=0` (idle): gentle breathing/float loop — the default resting loop.
- `mood=1` (speak): mouth/head motion suitable for talking; loop until mood changes.
- `mood=2` (listen): attentive lean-in, small nods; loop.
- `mood=3` (think): look-up / ponder pose; loop.
- Triggers (`wave`/`jump`/`wink`/`celebrate`): play once, then **return to the current `mood`** automatically.
- All transitions should blend (no hard snaps).

## 3. Export settings

- Export **For runtime** (`.riv`), not an image/video.
- Include the `Mark` artboard and the `MarkSM` state machine.
- Keep it lean (target < 300 KB). Strip unused artboards/assets.

## 4. Where the file goes

Two ways to point the widget at the `.riv`:

1. **Bundled:** drop it at `public/rive/mark.riv` (then set the URL to that path), or
2. **CDN/URL:** host it anywhere and provide the absolute URL.

The URL is read from the WP setting `rive_url` (admin field is added when wiring goes
live). Empty = Rive disabled = current Three.js robot.

## 5. Runtime API (already implemented)

`public/js/rive-animator.js` exposes `window.MarkRive`:

```js
MarkRive.init({ url, mountSelector });   // called automatically with markAIConfig.riveUrl
MarkRive.play('idle'|'speak'|'listen'|'think'|'wave'|'jump'|'wink'|'celebrate');
MarkRive.isActive();                     // true once a .riv loaded successfully
```

On successful load it transparently bridges `window.markAnimator.play(...)` → Rive, so
**no other code changes are needed**. On any failure it stays inert and the Three.js
robot continues unchanged.

## 6. How to get the asset (recommended order)

1. **Commission / author in the Rive editor** to this contract — best brand match for
   "Mark, the world's first digital salesman." (Rive Marketplace has character riggers.)
2. **Adapt a community robot** from the Rive Community as a fast placeholder, renamed to
   match the artboard/state-machine/input names above.

Once the `.riv` exists, the final step is: set `rive_url`, smoke-test the 8 states, tune
sizing/position, ship the next plugin build.
