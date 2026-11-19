# Procedural Flat-Lay Lighting Plot Generator

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

## What the engine computes (`src/engine/engine.js`)

| Output | Model |
|---|---|
| Field of view | `FOV = 2·atan(w / 2f)`, where `w` is the gate width for the aspect (S35 24.89 mm; 2× anamorphic de-squeezed to 43.9 mm) |
| Subject distance | Solved from the tone's shot size: `D = frameHeight · f / sensorHeight`, then widened if a dialogue pair won't fit |
| Depth of field | Hyperfocal `H = f²/(N·c) + f`, c = 0.025 mm; near/far limits; blur-disc size at the background |
| Subject placement | Rule-of-thirds offset `x = D·(w/6)/f`, nose turned toward lead room, 180° line for dialogue, crowd eyelines driven by the tone |
| Key light | Azimuth off the lens axis (short or broad side), elevation, and a modifier chosen from time × environment × softness (window ray-cast to the wall, sun, silk, book light, softbox, Fresnel); pushed out of the frustum when it would be in shot |
| Contrast | The environment's *natural* ratio (bounce × source size + ambient) is compared with the tone's *target* ratio. The gap decides between negative fill, passive bounce and active fill |
| Colour | Black-body Kelvin → RGB rendered relative to the camera's white balance; mired differences between sources and the nearest CTO/CTB gel |
| Shadows | Length `1.7 m / tan(elevation)`; penumbra = length × the source's angular size |
| Exposure | `E = 250·N²/(t·ISO)` at ISO 800 and 1/48 s; ND needed against sun or sky; output class for the key fixture |
| Viewfinder | Pinhole projection with camera height, pitch solved to put the eyes on the tone's target line, Dutch angle, and DoF blur on each figure |
| Composition | Negative space and headroom measured by rasterising the projected subject bounds |

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

**Camera support** (any move, including Static): *Dolly / Sticks* (no wobble), *Steadicam* (slow float, ±0.4° roll) or *Handheld* (breathing and step frequencies, ±1.5° roll, ~3 cm drift). The wobble is seeded noise, so each variation is repeatable. Auto uses Steadicam for follow shots, handheld for Tense, and a dolly otherwise.

**Storyboard:** five panels rendered through the lens at 0, 25, 50, 75 and 100% of the move, each captioned with time, focal length, distance, lens height, face size, key level and any light conflicts. Click a panel to jump to it. Export as a standalone SVG or a 2× PNG.

The plot draws the dolly track, ghost frustums at both marks, pedestal travel and focus marks. A transport under the viewfinder plays or scrubs the move in real time. The readout compares start, now and end values (distance, height, tilt, focus, DoF, face size, negative space, background scale) and lists the gear needed. Room and alley walls limit travel, and moves that are too fast or too slow are flagged.

### Lights checked against the whole move

After the hero frame is solved, every fixture is projected through the real lens (height, tilt and FOV). Anything whose head or stand would be in shot is raised (overhead rigs) or cheated wider. During a move, every sampled pose is checked again. A fixture or stand that enters frame is flagged with when it happens and a fix (e.g. "boom it to 3.1 m on a C-stand arm"). The engine also flags when the camera rig passes between the key and the subject (camera shadow on the face) and when the camera crosses the 180° line. Conflicts appear as red rings on the plot and as red markers in the viewfinder at the moment they happen.

