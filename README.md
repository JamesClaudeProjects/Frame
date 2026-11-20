# Procedural Flat-Lay Lighting Plot Generator

A planning tool for **real production teams**: the gaffer, camera department and sound department. It outputs rigging positions, meter readings, lens data and mic placement for an actual shoot.

A React + Vite single-page app that **solves** a cinematography setup from first principles and draws it as a top-down lighting plot, a through-the-lens wireframe, and a written rationale. There are no stored looks: every position, angle, ratio, Kelvin value and sentence comes from the inputs.

## Run

```bash
npm install
npm run dev
```

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo on the `main` branch.
2. Go to **Settings → Pages → Source** and pick **GitHub Actions**.
3. `.github/workflows/deploy.yml` builds and publishes on every push. `vite.config.js` uses `base: './'`, so the app works at any `/<repo>/` path.

## Using the interface

- **Sections collapse.** Every panel group (Scene, Lens, Camera Move, the readouts, Storyboard, Why This Works) folds up. When closed, it shows a one-line summary. Open/closed state is remembered in your browser.
- **Hover tags.** Anything with a dotted underline explains itself on hover, keyboard focus or tap, often with a line computed from the current scene. The text lives in `src/glossary.js`.
- **Less on the plot by default.** Fixture labels show one line. Turn on the **details** layer for second lines, shadow sizes and the full camera tag, or hover a fixture for its full spec.
- **Readable colour.** Kelvin-coloured text is lightened, keeping its hue, until it reaches at least 6:1 contrast against the plot.

## What the engine computes (`src/engine/engine.js`)

| Output | Model |
|---|---|
| Format & aspect | Capture format (Super 35, Full Frame, Anamorphic 2×) is chosen separately from the aspect ratio. The ratio is extracted from the gate (top/bottom or side crop). Anamorphic width is de-squeezed, so the monitor view and framing maths match what the audience sees |
| Field of view | `FOV = 2·atan(w / 2f)` on the extracted frame width |
| Lens distortion | Representative radial distortion `r' = r(1 + k₁r²)` by field of view and format: wide primes barrel, long lenses pincushion slightly, anamorphics add barrel. Shown in the viewfinder (toggle the *distortion* layer) and in the readout |
| Subject distance | Solved from the tone's shot size: `D = frameHeight · f / sensorHeight`, then widened if a dialogue pair won't fit |
| Depth of field | Hyperfocal `H = f²/(N·c) + f`, c = 0.025 mm; near/far limits; blur-disc size at the background |
| Subject placement | Rule-of-thirds offset `x = D·(w/6)/f`, nose turned toward lead room, 180° line for dialogue, crowd eyelines driven by the tone |
| Key light | Azimuth off the lens axis (short or broad side), elevation, and a modifier chosen from time × environment × softness (window ray-cast to the wall, sun, silk, book light, softbox, Fresnel); pushed out of the frustum when it would be in shot |
| Contrast | The environment's *natural* ratio (bounce × source size + ambient) is compared with the tone's *target* ratio. The gap decides between negative fill, passive bounce and active fill |
| Colour | Black-body Kelvin → RGB rendered relative to the camera's white balance; mired differences between sources and the nearest CTO/CTB gel |
| Shadows | Length `1.7 m / tan(elevation)`; penumbra = length × the source's angular size |
| Exposure | `E = 250·N²/(t·ISO)` with ISO and shutter angle as controls (t = angle / 360 / 24 fps). Gives key and fill meter readings, ND against sun or sky, and the key fixture's output class. Flags mains-practical flicker at 180° (use 172.8° at 50 Hz) and subjects inside the lens's close-focus distance |
| Viewfinder | Pinhole projection with camera height, pitch solved to put the eyes on the tone's target line, Dutch angle, and DoF blur on each figure |
| Composition | Negative space and headroom measured by rasterising the projected subject bounds |

**Camera support** is chosen separately: Sticks, Dolly, Slider (≤ 1.5 m), Jib / Crane, Steadicam / Gimbal or Handheld. Auto picks by move and mood. Impossible pairings, such as sticks on a push-in or a slider on an orbit, are switched with a note.

**Generate New Variation** reseeds a deterministic PRNG. It changes subject offsets, which third the subject sits on, light angles (±10°), dialogue stagger and crowd positions. The tone's rules stay the same.

## Camera moves

`src/engine/move.js` treats a move as a camera pose over time `t ∈ [0, 1]` with smoothstep easing (peak speed = 1.5× average). Each move is anchored to the solved hero frame: push-in, truck and pedestal **end** on it, and a pull-out **starts** on it.

| Move | What changes |
|---|---|
| Push In / Pull Out | Dolly distance; tilt re-solved each frame to hold the eyeline; focus follows the subject |
| Truck | Lateral position with no pan, producing parallax between subject and background (and an off-frame reveal at high travel) |
| Pedestal | Lens height; tilt re-solved so a low-to-high move flips the power relationship partway through |
| Rack Focus | Focus distance between two computed targets (subject ↔ second actor, watching extra, practical or background) |
| Arc / Orbit | Camera circles the subject at the hero radius and pans with the orbit, so the subject keeps their screen position while the key's angle to the lens changes. The mood decides whether it moves toward the light (opening the face) or away from it (into shadow). Sweep is trimmed to fit the walls |
| Dolly Zoom | `f(t) = f₀ · D(t)/D₀` keeps the subject the same size while the FOV and background scale change. Dolly-in/zoom-out or the reverse depending on mood, limited to a 14–135 mm lens range and to the set |
| Follow | The subject walks along their facing into the hero mark at a pace set by the mood; the camera keeps its hero offset (leading if they walk toward the lens, trailing otherwise). Lights stay fixed, so the key level on the face changes by inverse-square along the walk |
| Auto (mood) | The mood weights the moves, adjusted by blocking, location and focal length; the variation seed picks one, and the odds are shown |

**Camera support wobble:** Sticks, Dolly, Slider and Jib are steady. Steadicam / Gimbal floats (±0.4° roll). Handheld adds breathing and step frequencies (±1.5° roll, ~3 cm drift). The wobble is seeded noise, so each variation is repeatable.

**Storyboard:** five panels rendered through the lens at 0, 25, 50, 75 and 100% of the move, each captioned with time, focal length, distance, lens height, face size, key level and any light conflicts. Click a panel to jump to it. Export as a standalone SVG or a 2× PNG.

The plot draws the dolly track, ghost frustums at both marks, pedestal travel and focus marks. A transport under the viewfinder plays or scrubs the move in real time. The readout compares start, now and end values (distance, height, tilt, focus, DoF, face size, negative space, background scale) and lists the gear needed. Room and alley walls limit travel, and moves that are too fast or too slow are flagged.

### Lights checked against the whole move

After the hero frame is solved, every fixture is projected through the real lens (height, tilt and FOV). Anything whose head or stand would be in shot is raised (overhead rigs) or cheated wider. During a move, every sampled pose is checked again. A fixture or stand that enters frame is flagged with when it happens and a fix (e.g. "boom it to 3.1 m on a C-stand arm"). The engine also flags when the camera rig passes between the key and the subject (camera shadow on the face) and when the camera crosses the 180° line. Conflicts appear as red rings on the plot and as red markers in the viewfinder at the moment they happen.

## Sound (Phase A)

`src/engine/sound.js` plans production sound for the hero frame. Levels are planning estimates from typical values, not measurements.

| Output | Model |
|---|---|
| Voice level | Set by mood (≈50 dB at 1 m for intimate, 66 dB for heroic), plus the Lombard effect: people speak up ~0.5 dB per dB of noise above 45 dBA |
| Noise floor | Location × time of day, plus point sources by inverse square: neon ballast hum, and HMI ballast fans (with the distance needed to drop them 10 dB under the floor) |
| Room | Interiors: Sabine reverb `RT60 = 0.161·V / A` from room size and surfaces (glass, floor, furnishings, cast and crew, black flags), and critical distance `0.057·√(Q·V/RT60)`. Alleys: flutter echo between parallel walls. Neon street: slap off the storefront. Field: open air |
| Boom geometry | The frame's top and bottom lines at the subject are solved through the real lens. The mic sits 15 cm outside frame. Operator positions (either side, or beside the camera) are rejected if the pole would dip into frame |
| Boom shadows | The pole's shadow from key, rim and sun is cast onto floor and walls and checked against the frame, and onto the light-to-face path. The planner picks the position that keeps it out of shot |
| Boom vs lav | Signal-to-noise at the mic (25 dB clean, 18 dB usable), staying inside critical distance indoors. Lav when the boom can't get close, with a perspective warning for wide shots |

Turn on the **sound** layer (or "plot" in the Sound section) to draw the boom operator, pole, mic pickup lobe, lav, critical-distance circle, noise-source rings and wind. Boom shadows show as red marks on the plot and in the viewfinder.

## Sound (Phase B): moves and dialogue

- **Boom through the move.** The boom is re-solved at 25 points across any camera move, against the moving frame line, pole-in-frame and shadow checks. One operator setup is chosen for the whole move: the one covering the most frames at the lowest cost. Gaps are reported as *out of reach* (cover with the lav) or *handoff* (a second operator takes over). The operator's walking distance and peak speed are reported.
- **Rig noise at the mic.** Dolly wheels and track (scaled by speed), Steadicam or handheld operator footsteps, boom operator footsteps, a walking subject (plus lav clothing rustle), zoom motor and jib. Footstep levels depend on the floor surface. Anything within 6 dB of the noise floor is flagged with a fix.
- **Sound perspective.** The change in mic distance is compared with the change in shot size. The result is *follows*, *steady* or *flat*, and flat comes with mixing advice.
- **Dialogue.** One boom swings between speakers if the mic only travels ≤ 1.6 m between lines. Otherwise the planner looks for a clean second boom position on the other side, or falls back to a lav on the second speaker.
- **UI.** A clean-margin timeline (boom vs lav, with out-of-reach, handoff and shadow bands and the playhead) in the Sound section. The live boom, operator path and mic path on the plot. Swing or second boom for dialogue. A live boom marker in the viewfinder, and 🎙 margins on storyboard frames.

