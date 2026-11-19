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
