// Production-sound planner (Phase A). Reads the solved scene — hero camera, frame lines,
// lights, set geometry — and plans where the microphone goes for the cleanest dialogue
// that still matches the picture. All levels are planning estimates from typical values
// (dBA re 20 µPa), not measurements of a real location.

import { project, fmt } from './engine.js';

const C = 343; // speed of sound, m/s
const MOUTH_H = 1.55;
const TARGET_SNR = 25; // clean dialogue
const USABLE_SNR = 18; // usable with cleanup
const db = (x) => 10 * Math.log10(x);
const sumDb = (levels) => db(levels.reduce((a, l) => a + 10 ** (l / 10), 0));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Speech level at 1 m, by tone (soft intimate delivery → projected).
const VOICE = { romantic: 50, melancholy: 53, lonely: 53, tense: 58, heroic: 66 };

// Background noise (dBA) by environment × time, before point sources.
const FLOOR = {
  interior: { golden: 34, noon: 36, overcast: 33, blue: 33, midnight: 30 },
  studio: { golden: 24, noon: 24, overcast: 24, blue: 24, midnight: 24 },
  field: { golden: 37, noon: 39, overcast: 38, blue: 33, midnight: 28 },
  alley: { golden: 50, noon: 51, overcast: 50, blue: 47, midnight: 44 },
  neon: { golden: 60, noon: 61, overcast: 60, blue: 57, midnight: 54 }, // assumes traffic held between takes
};
const FLOOR_WHAT = {
  interior: 'HVAC, fridge and street bleed through the windows',
  studio: 'treated stage — air handling only',
  field: 'wind in grass, distant road',
  alley: 'rooftop HVAC units and distant traffic',
  neon: 'street and crowd, with traffic held between takes',
};
// Typical wind speed (m/s) at mic height, by time; scaled by how sheltered the set is.
const WIND = { golden: 3, noon: 5, overcast: 6, blue: 2, midnight: 1 };
const SHELTER = { field: 1, neon: 0.6, alley: 0.35, interior: 0, studio: 0 };

// Microphone classes: directivity index for diffuse noise (dB) and directivity factor Q.
const MICS = {
  hyper: { name: 'Pencil hypercardioid', DI: 6, Q: 4 },
  shotgun: { name: 'Short shotgun', DI: 8, Q: 6 },
  lav: { name: 'Lavalier (omni)', DI: 0, Q: 1 },
};

const V3 = (x, y, z) => ({ x, y, z });
const sub3 = (a, b) => V3(a.x - b.x, a.y - b.y, a.z - b.z);
const len3 = (a) => Math.hypot(a.x, a.y, a.z);
const lerp3 = (a, b, t) => V3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
function distPointSeg(p, a, b) {
  const ab = sub3(b, a), ap = sub3(p, a);
  const t = clamp((ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / (ab.x * ab.x + ab.y * ab.y + ab.z * ab.z || 1), 0, 1);
  return len3(sub3(p, lerp3(a, b, t)));
}

/** Height (m) at which the frame's top (edge=0) or bottom (edge=1) crosses a ground point. */
function frameEdgeHeight(cam, pt, edge) {
  let lo = -6, hi = 30;
  const yAt = (h) => { const p = project(cam, pt, h); return p ? p.y : null; };
  const yl = yAt(lo), yh = yAt(hi);
  if (yl == null || yh == null) return edge === 0 ? Infinity : -Infinity;
  // y decreases as h increases
  if (edge === 0 && yh > 0) return Infinity; // even 30 m up is still in frame
  if (edge === 1 && yl < 1) return -Infinity; // floor and below are in frame
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (yAt(m) > edge) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

export function solveSound(scene, inp) {
  const cam = scene.camera;
  const S = cam.sensor;
  const tanH = Math.tan(cam.fovH / 2);
  const kind = scene.set.kind;
  const exterior = ['field', 'alley', 'neon'].includes(kind);
  const notes = [], gear = [], warnings = [];
  const principals = scene.subjects.filter((s) => !s.extra);
  const mouthOf = (s) => V3(s.x + Math.cos(s.facing) * 0.09, s.y + Math.sin(s.facing) * 0.09, MOUTH_H);
  const mouths = principals.map(mouthOf);
  const mouth = mouths[0];

  // --- Voice and noise ------------------------------------------------------
  const parts = [{ name: FLOOR_WHAT[kind], level: FLOOR[kind][inp.time] }];
  // Lombard effect: people speak up in noise (~0.5 dB per dB above 45 dBA, capped).
  const lombard = clamp(0.5 * (FLOOR[kind][inp.time] - 45), 0, 10);
  const voice = VOICE[inp.tone] + lombard;
  if (inp.blocking === 'crowd') parts.push({ name: 'background walla (crowd)', level: FLOOR[kind][inp.time] + 4 });
  const sources = []; // point sources drawn on the plot
  scene.lights.forEach((l) => {
    if (l.role === 'practical' && l.modifier === 'neon' && l.lit) sources.push({ name: 'Neon ballast hum', pos: l.pos, l1: 42, kind: 'hum' });
  });
  const hmi = scene.lights.filter((l) => /HMI/.test(l.name) || /HMI/.test(l.outside ?? ''));
  hmi.forEach((l) => sources.push({ name: 'HMI ballast fan', pos: l.pos, l1: 52, kind: 'ballast', light: l.id }));
  // Ballasts can be moved: solve the distance that puts them 10 dB under the floor.
  const baseFloor = sumDb(parts.map((p) => p.level));
  sources.forEach((src) => {
    if (src.kind === 'ballast') {
      src.moveTo = 10 ** ((src.l1 - (baseFloor - 10)) / 20);
    }
  });
  const atMic = (src, p) => src.l1 - 20 * Math.log10(Math.max(Math.hypot(src.pos.x - p.x, src.pos.y - p.y, 1.5 - p.z), 0.5));

  const windSpeed = WIND[inp.time] * (SHELTER[kind] ?? 0);
  const wind = windSpeed < 0.5 ? null : windSpeed < 2 ? 'light' : windSpeed < 5 ? 'moderate' : 'strong';

  // --- Room acoustics --------------------------------------------------------
  let room = { kind: 'free', rt60: 0, V: Infinity, label: 'open air — no reverberant field' };
  if (kind === 'interior') {
    const [x0, y0, x1] = scene.set.walls[0];
    const y1 = scene.set.walls[1][3];
    const W = x1 - x0, Dp = y1 - y0, Hh = 2.8, floorA = W * Dp;
    const wallA = 2 * (W + Dp) * Hh;
    const glass = scene.set.windows.length * 1.5 * 1.4;
    const negFlags = scene.lights.filter((l) => l.role === 'neg').length;
    const A = floorA * 0.15 + floorA * 0.06 + (wallA - glass) * 0.09 + glass * 0.04
      + floorA * 0.25 /* furnishings */ + (principals.length + 6) * 0.45 /* cast + crew */ + negFlags * 1.44 * 0.6;
    const V = floorA * Hh;
    room = { kind: 'room', V, A, rt60: (0.161 * V) / A, dims: [W, Dp, Hh], label: `${fmt(W, 1)} × ${fmt(Dp, 1)} × ${Hh} m room` };
  } else if (kind === 'studio') {
    const w = 2 * Math.max(6, (scene.bgY + 2) * tanH), d = scene.bgY + 4, h = 6;
    const V = w * d * h, floorA = w * d;
    const A = floorA * 0.02 + floorA * 0.5 /* draped grid */ + 2 * (w + d) * h * 0.55 + 8 * 0.45;
    room = { kind: 'room', V, A, rt60: (0.161 * V) / A, dims: [w, d, h], label: 'draped stage (duvetyne cyc)' };
  } else if (kind === 'alley') {
    const w = 2 * Math.abs(scene.set.walls[1][0]);
    room = { kind: 'flutter', rt60: 0, V: Infinity, flutterHz: C / (2 * w), flutterMs: (2 * w / C) * 1000, label: `parallel brick walls ${fmt(w, 1)} m apart` };
  } else if (kind === 'neon') {
    const d = scene.bgY - scene.P.y;
    room = { kind: 'slap', rt60: 0, V: Infinity, slapMs: (2 * d / C) * 1000, label: `storefront ${fmt(d, 1)} m behind the subject` };
  }
  const critDist = (mic) => (room.kind === 'room' ? 0.057 * Math.sqrt((mic.Q * room.V) / room.rt60) : Infinity);

  // --- Boom planner (any camera pose, any target mouth) -------------------------
  const mic = room.kind === 'room' ? MICS.hyper : MICS.shotgun; // shotguns colour badly indoors
  const keyLights = scene.lights.filter((l) => (l.role === 'key' || l.role === 'key2' || (l.role === 'rim' && l.modifier !== 'window') || l.modifier === 'sun') && l.pos);
  const lightPoint = (l) => {
    if (l.modifier === 'sun') {
      const el = ((l.elev ?? 45) * Math.PI) / 180;
      return { sun: true, dir: V3(Math.cos(l.az) * Math.cos(el), Math.sin(l.az) * Math.cos(el), Math.sin(el)) };
    }
    const h = Number.isFinite(l.height) ? l.height : Number.isFinite(l.headH) ? l.headH : 2.6;
    return { sun: false, p: V3(l.pos.x, l.pos.y, h) };
  };
  const walls = [];
  if (['interior', 'studio', 'neon'].includes(kind)) walls.push({ axis: 'y', v: scene.bgY });
  if (kind === 'alley') { const w = Math.abs(scene.set.walls[1][0]); walls.push({ axis: 'x', v: -w }, { axis: 'x', v: w }); }
  if (kind === 'interior') { walls.push({ axis: 'x', v: scene.set.walls[0][0] }, { axis: 'x', v: scene.set.walls[0][2] }); }
  // Where does the shadow of point p land (floor or a wall) for this light?
  const castShadow = (lp, p) => {
    const d = lp.sun ? V3(-lp.dir.x, -lp.dir.y, -lp.dir.z) : sub3(p, lp.p);
    let best = null;
    if (d.z < -1e-3) { const s = -p.z / d.z; best = { s, pt: V3(p.x + d.x * s, p.y + d.y * s, 0), surface: 'floor' }; }
    walls.forEach((w) => {
      const comp = w.axis === 'y' ? d.y : d.x;
      const pos = w.axis === 'y' ? p.y : p.x;
      if (Math.abs(comp) < 1e-6) return;
      const s = (w.v - pos) / comp;
      if (s <= 0) return;
      const pt = V3(p.x + d.x * s, p.y + d.y * s, p.z + d.z * s);
      if (pt.z < 0 || pt.z > 3.2) return;
      if (!best || s < best.s) best = { s, pt, surface: 'wall' };
    });
    return best;
  };
  const inFrameOf = (c) => (pt) => { const q = project(c, { x: pt.x, y: pt.y }, pt.z); return q && q.x > 0.01 && q.x < 0.99 && q.y > 0.01 && q.y < 0.99; };

  // Evaluate one boom setup: mic just outside the frame line over `target`, operator on
  // `side` (±1 beside the frame, ±2 beside the camera) or at a fixed position.
  const evaluate = (c, from, side, target, allMouths, fixedOp) => {
    const tanHc = Math.tan(c.fovH / 2);
    const inFrame = inFrameOf(c);
    const ground = { x: target.x, y: target.y };
    const top = frameEdgeHeight(c, ground, 0), bottom = frameEdgeHeight(c, ground, 1);
    const toCam = Math.atan2(c.pos.y - target.y, c.pos.x - target.x);
    const fwd = 0.22;
    let micPos;
    if (from === 'above') {
      if (!Number.isFinite(top)) return null;
      micPos = V3(target.x + Math.cos(toCam) * fwd, target.y + Math.sin(toCam) * fwd, Math.max(top + 0.15, MOUTH_H + 0.25));
      if (micPos.z > 6) return null;
    } else {
      if (!Number.isFinite(bottom) || bottom < 0.75) return null; // floor or waist in frame
      micPos = V3(target.x + Math.cos(toCam) * fwd, target.y + Math.sin(toCam) * fwd, Math.min(bottom - 0.15, MOUTH_H - 0.3));
    }
    const depth = (target.x - c.pos.x) * Math.sin(c.yaw || 0) + (target.y - c.pos.y) * Math.cos(c.yaw || 0);
    const halfWc = depth * tanHc;
    let op;
    if (fixedOp) op = { ...fixedOp };
    else if (Math.abs(side) === 2) op = { x: c.pos.x + Math.sign(side) * 0.55, y: c.pos.y - 0.45 };
    else {
      op = { x: target.x + side * (halfWc + 1.0), y: target.y + 0.3 };
      if (Math.abs(op.x - c.pos.x) < (op.y - c.pos.y) * tanHc + 0.4) op.x = c.pos.x + side * ((op.y - c.pos.y) * tanHc + 0.6);
    }
    if (!fixedOp && kind === 'interior' && Math.abs(side) !== 2) {
      const [x0, , x1] = scene.set.walls[0];
      if (op.x < x0 + 0.35 || op.x > x1 - 0.35) {
        op.x = clamp(op.x, x0 + 0.35, x1 - 0.35);
        if (Math.abs(op.x - c.pos.x) < (op.y - c.pos.y) * tanHc + 0.2) return null; // no room on that side
      }
    }
    if (!fixedOp && kind === 'alley' && Math.abs(side) !== 2 && Math.abs(op.x) > Math.abs(scene.set.walls[1][0]) - 0.3) {
      op.x = Math.sign(op.x) * (Math.abs(scene.set.walls[1][0]) - 0.3);
      if (Math.abs(op.x - c.pos.x) < (op.y - c.pos.y) * tanHc + 0.2) return null;
    }
    const hands = V3(op.x, op.y, from === 'above' ? 2.1 : 0.9);
    const pole = len3(sub3(micPos, hands));
    if (pole > 6) return null;
    // the pole itself must never dip into frame
    for (let i = 0; i <= 16; i++) if (inFrame(lerp3(hands, micPos, i / 16))) return null;
    const dist = len3(sub3(micPos, target));
    // shadows of pole + mic from each hard-ish light
    let face = null, bg = null;
    const bgPts = [];
    keyLights.forEach((l) => {
      const lp = lightPoint(l);
      const soft = (l.angSize ?? (l.size ?? 0.3) / Math.max(l.dist ?? 2, 0.3)) > 0.45;
      for (let i = 0; i <= 14; i++) {
        const p = lerp3(hands, micPos, i / 14);
        allMouths.forEach((m) => {
          const src = lp.sun ? V3(m.x + lp.dir.x * 40, m.y + lp.dir.y * 40, m.z + lp.dir.z * 40) : lp.p;
          if (distPointSeg(p, src, m) < 0.07 && !face) face = { light: l, soft };
        });
        const hit = castShadow(lp, p);
        if (hit && inFrame(hit.pt)) {
          bgPts.push({ ...hit.pt, soft });
          if (!bg || (!soft && bg.soft)) bg = { light: l, soft, surface: hit.surface, pt: hit.pt };
        }
      }
    });
    const snr = voice - 20 * Math.log10(dist) - (baseFloor - mic.DI);
    const score = (face ? (face.soft ? 30 : 120) : 0) + (bg ? (bg.soft ? 15 : 60) : 0) + dist * 12 + (from === 'below' ? 4 : 0) + (Math.abs(side) === 2 ? 3 : 0) + Math.max(pole - 4.5, 0) * 20;
    return { from, side, mic: micPos, op, hands, pole, dist, face, bg, bgPts, snr, score, frameTop: top, frameBottom: bottom };
  };
  const planBoom = (c, target, allMouths) => {
    const list = [];
    ['above', 'below'].forEach((from) => [-1, 1, -2, 2].forEach((side) => { const r = evaluate(c, from, side, target, allMouths); if (r) list.push(r); }));
    return list.sort((x, y) => x.score - y.score);
  };

  const candidates = planBoom(cam, mouth, mouths);
  const boom = candidates[0] ?? null;
  const frameTop = boom ? boom.frameTop : frameEdgeHeight(cam, { x: mouth.x, y: mouth.y }, 0);
  const frameBottom = boom ? boom.frameBottom : frameEdgeHeight(cam, { x: mouth.x, y: mouth.y }, 1);
  const shadowFree = candidates.filter((c) => !c.face && !c.bg);

  // --- Lav -------------------------------------------------------------------
  const lavDist = 0.22;
  const lavSnr = voice - 20 * Math.log10(lavDist) - baseFloor - 3; // −3 dB: chest shadowing / clothing
  // point sources at the mic positions
  const noiseAt = (p) => sumDb([baseFloor, ...sources.map((s) => atMic(s.kind === 'ballast' && s.moveTo ? { ...s, l1: s.l1 - 20 * Math.log10(Math.max(s.moveTo, 1)) } : s, p))]);
  const noiseAtPt = noiseAt;
  const floorAtBoom = boom ? noiseAt(boom.mic) : baseFloor;
  if (boom) boom.snr = voice - 20 * Math.log10(boom.dist) - (floorAtBoom - mic.DI);

  // --- Dialogue: one boom swinging, two booms, or boom + lav --------------------
  let dialogue = null;
  if (mouths.length === 2 && boom) {
    const B = mouths[1];
    const sep = Math.hypot(B.x - mouth.x, B.y - mouth.y);
    const swingB = evaluate(cam, boom.from, boom.side, B, mouths, boom.op);
    // What limits a single operator is how far the mic must travel between lines.
    const travel = swingB ? len3(sub3(swingB.mic, boom.mic)) : null;
    const swingTime = travel != null ? travel / 1.8 : null; // ~1.8 m/s is a quick, quiet swing
    if (swingB) swingB.snr = voice - 20 * Math.log10(swingB.dist) - (noiseAtPt(swingB.mic) - mic.DI);
    let plan, second = null;
    if (swingB && travel <= 1.6 && swingB.snr >= USABLE_SNR && !(swingB.face && !swingB.face.soft)) plan = 'swing';
    else {
      second = planBoom(cam, B, mouths).find((c) => Math.sign(c.side) !== Math.sign(boom.side) && !(c.face && !c.face.soft) && !(c.bg && !c.bg.soft));
      if (second) second.snr = voice - 20 * Math.log10(second.dist) - (noiseAtPt(second.mic) - mic.DI);
      plan = second && second.snr >= USABLE_SNR ? 'two' : 'boom+lavB';
    }
    dialogue = { sep, travel, swingTime, swingB, second, plan };
  }

  // --- Decision ----------------------------------------------------------------
  const dc = critDist(mic);
  const faceSize = ((0.23 * cam.f) / (Math.hypot(mouth.x - cam.pos.x, mouth.y - cam.pos.y) * S.h)) * 100;
  const wide = faceSize < 8;
  let primary;
  if (boom && boom.snr >= TARGET_SNR && (room.kind !== 'room' || boom.dist <= 0.75 * dc)) primary = 'boom';
  else if (boom && boom.snr >= USABLE_SNR) primary = 'boom+lav';
  else primary = 'lav';
  const bestSnr = primary === 'lav' ? lavSnr : boom.snr;
  if (bestSnr < USABLE_SNR) warnings.push(`Only ~${fmt(bestSnr, 0)} dB above the noise even on a lav — plan wild lines or ADR, or ask for a louder delivery`);
  if (boom && boom.face && !boom.face.soft) warnings.push(`Boom pole shadow crosses the face from the ${boom.face.light.label.split(' · ')[0].toLowerCase()} — flag the light or go lav`);
  else if (boom && boom.bg && !boom.bg.soft && primary !== 'lav') warnings.push(`Boom shadow lands on the ${boom.bg.surface} in frame — no shadow-free boom position here`);

  // --- Notes & gear -------------------------------------------------------------
  if (primary !== 'lav') gear.push(`${mic.name} on a ${fmt(Math.ceil(boom.pole * 2) / 2, 1)} m boom, ${boom.from} frame, operator ${Math.abs(boom.side) === 2 ? `beside camera (${boom.side > 0 ? 'right' : 'left'}), booming over it` : `camera-${boom.side > 0 ? 'right' : 'left'}`}`);
  if (primary !== 'boom') gear.push(`Lav under wardrobe${principals.length > 1 ? ` on all ${principals.length} principals` : ''}, sticky mount${wind ? ' + fur cover' : ''}`);
  if (room.kind !== 'room' && wind) gear.push(wind === 'strong' ? 'Full blimp + dead-cat fur; consider a wind break' : wind === 'moderate' ? 'Blimp + dead-cat fur on the boom' : 'Foam or light fur on the boom');
  if (room.kind === 'flutter') gear.push(`Sound blankets on the wall opposite the boom (${fmt(room.flutterHz, 0)} Hz flutter, ${fmt(room.flutterMs, 0)} ms)`);
  if (room.kind === 'room' && room.rt60 > 0.6) gear.push('Sound blankets on hard walls off-camera to shorten the reverb');
  if (dialogue) {
    if (dialogue.plan === 'swing') gear.push(`One boom swings between A and B on cue: mic travels ${fmt(dialogue.travel, 2)} m (~${fmt(dialogue.swingTime, 1)} s)`);
    else if (dialogue.plan === 'two') gear.push(`Second boom for B from ${Math.abs(dialogue.second.side) === 2 ? 'beside camera' : `camera-${dialogue.second.side > 0 ? 'right' : 'left'}`} (${fmt(dialogue.second.dist, 2)} m, ${fmt(dialogue.second.snr, 0)} dB) — one boom would have to travel ${dialogue.travel != null ? fmt(dialogue.travel, 1) + ' m' : 'out of reach'} between lines`);
    else gear.push('Boom covers A; lav on B (no clean second boom position)');
  }
  gear.push('Record 30 s of room tone after the take');
  if (kind === 'interior') notes.push('Kill the fridge and HVAC for takes');
  if (inp.blocking === 'crowd') notes.push('Background mimes walla; record real walla wild for post');
  sources.filter((s) => s.kind === 'ballast').forEach((s) => notes.push(`Move the HMI ballast ≥ ${fmt(Math.ceil(s.moveTo), 0)} m from set (fan noise ${s.l1} dB @ 1 m)`));
  if (sources.some((s) => s.kind === 'hum')) notes.push('Neon ballasts hum at 50/60 Hz harmonics — switch the signs off for close takes if the look survives');
  if (exterior && hmi.length) notes.push('Park the generator ≥ 50 m away, behind a truck or building');
  if (boom && shadowFree.length && boom !== shadowFree[0]) notes.push('A shadow-free boom position exists but is much further away — trade-off logged');
  if (wide && primary !== 'boom') notes.push(`Wide shot (face ${fmt(faceSize, 0)}% of frame): a lav will sound too close for the picture — blend in boom or room for perspective`);

  // --- Perspective by tone -------------------------------------------------------
  const perspective = ['romantic', 'tense'].includes(inp.tone) ? 'close and dry'
    : inp.tone === 'heroic' ? 'present and slightly open' : 'open, with some room around it';

  const summary = `${primary === 'boom' ? 'Boom' : primary === 'lav' ? 'Lav' : 'Boom + lav'} · ${fmt(bestSnr, 0)} dB SNR${boom && (boom.face || boom.bg) && primary !== 'lav' ? ' · ⚠ shadow' : ''}`;

  const sound = {
    voice, lombard, floor: baseFloor, floorAtBoom, parts, sources, wind, windSpeed, room, critDist: dc, mic, frameTop, frameBottom,
    boom, candidates, shadowFree: shadowFree.length > 0, lav: { dist: lavDist, snr: lavSnr }, primary, bestSnr,
    faceSize, wide, perspective, notes, gear, warnings, summary, mouth, mouths, dialogue,
    // planner internals, used to track the boom through a camera move
    _ctx: { evaluate, planBoom, noiseAt, mouthOf, voice, baseFloor, mic, lavDist },
  };
  sound.theory = synthesizeSound(sound, scene, inp);
  return sound;
}

function synthesizeSound(s, scene, inp) {
  const b = s.boom;
  let t = `A ${inp.tone} delivery sits around ${fmt(s.voice, 0)} dB at 1 m${s.lombard > 1 ? ` (people raise their voices ~${fmt(s.lombard, 0)} dB in this noise)` : ''}; the noise floor is about ${fmt(s.floor, 0)} dB (${s.parts[0].name}). `;
  if (Number.isFinite(s.frameTop)) {
    if (b) t += `The top of frame crosses the subject at ${fmt(s.frameTop, 2)} m, so a boom held ${b.from === 'below' ? 'just below frame' : '15 cm above it'} sits ${fmt(b.dist, 2)} m from the mouth, giving ~${fmt(b.snr, 0)} dB of clean voice over noise with a ${s.mic.name.toLowerCase()}. `;
    else t += `The top of frame crosses the subject at ${fmt(s.frameTop, 2)} m, but there is no position where the boom operator and pole both stay out of frame. `;
  } else {
    t += 'The frame is so wide or so low that a boom cannot reach the subject from above. ';
  }
  if (s.room.kind === 'room') {
    t += `The ${s.room.label} rings for about ${fmt(s.room.rt60, 2)} s; the mic must stay within ${fmt(s.critDist, 2)} m (critical distance) to hear more voice than room. `;
  } else if (s.room.kind === 'flutter') {
    t += `The ${s.room.label} create a ${fmt(s.room.flutterMs, 0)} ms flutter echo, so the boom aims away from the walls and blankets go up opposite it. `;
  } else if (s.room.kind === 'slap') {
    t += `The ${s.room.label} returns a ${fmt(s.room.slapMs, 0)} ms slap; aim the mic's null toward it. `;
  }
  if (s.primary === 'boom') t += 'Boom is primary: it keeps the voice natural and matches the camera’s perspective.';
  else if (s.primary === 'boom+lav') t += 'Boom stays primary for perspective, with a lav as safety because the margin over noise is thin.';
  else t += `A lav becomes primary because the boom cannot get close enough${s.wide ? '; in a wide shot that close sound must be blended with room for perspective' : ''}.`;
  if (s.primary === 'lav') { /* boom placement is secondary — skip shadow talk */ } else if (b && (b.face || b.bg)) {
    const what = b.face ? 'the face' : `the ${b.bg.surface} in frame`;
    t += ` The pole sits in the ${(b.face ?? b.bg).light.label.split(' · ')[0].toLowerCase()}’s path and throws a ${((b.face ?? b.bg).soft ? 'soft, faint' : 'hard')} shadow onto ${what}${(b.face ?? b.bg).soft ? ', which will likely disappear in the soft light' : '; this is the classic camera-vs-sound conflict, flagged before the shoot day'}.`;
  } else if (b) {
    t += ` Booming ${b.from} frame from ${Math.abs(b.side) === 2 ? 'beside the camera' : `camera-${b.side > 0 ? 'right' : 'left'}`} keeps the pole’s shadow out of the light’s path.`;
  }
  t += ` For this mood the voice should sound ${s.perspective}.`;
  return { h: 'Sound', t };
}

// --- Phase B: the boom through a camera move ----------------------------------------
// Re-solve the boom at each sampled pose of the move, keeping the operator on the same
// side while that stays reasonable. Adds rig noise (dolly, Steadicam / handheld operator,
// walking subject, zoom motor, jib) at the real mic position, and compares how the sound
// perspective changes against the picture.

const FOOTFALL = { interior: 4, studio: 2, field: -8, alley: 2, neon: 0 }; // floor surface, dB

export function trackSoundMove(scene, inp) {
  const s = scene.sound, mv = scene.move;
  if (!s || !mv || mv.type === 'static') return null;
  const { evaluate, planBoom, noiseAt, mouthOf, voice, mic, lavDist } = s._ctx;
  const kind = scene.set.kind;
  const foot = FOOTFALL[kind] ?? 0;
  const N = 24, dt = mv.duration / N;
  const samples = [];
  // Pass 1: candidates at every pose.
  const frames = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const cam = mv.poseAt(t);
    const subs = mv.subjectsAt(t);
    const mouths = subs.filter((x) => !x.extra).map(mouthOf);
    frames.push({ t, cam, subs, mouths, target: mouths[0], cands: planBoom(cam, mouths[0], mouths) });
  }
  // Pass 2: one operator setup (from + side) for the whole move — the one that covers the
  // most frames at the lowest total cost. A setup can't change mid-take without a handoff.
  const keyOf = (c) => `${c.from}:${c.side}`;
  const configs = {};
  frames.forEach((f) => f.cands.forEach((c) => { const k = keyOf(c); (configs[k] ??= { n: 0, cost: 0 }); configs[k].n++; configs[k].cost += c.score; }));
  const best = Object.entries(configs).sort((x, y) => y[1].n - x[1].n || x[1].cost - y[1].cost)[0]?.[0] ?? null;
  const switches = [];
  let prevCam = frames[0].cam, prevSub = frames[0].subs[0], prevOp = null;
  for (let i = 0; i <= N; i++) {
    const { t, cam, subs, target, cands } = frames[i];
    let pick = best ? cands.find((c) => keyOf(c) === best) ?? null : null;
    let handoff = false;
    if (!pick && cands.length) { pick = cands[0]; handoff = true; }
    if (handoff && (i === 0 || !samples[i - 1]?.handoff)) switches.push(t);

    // speeds over this step
    const camSpeed = i ? Math.hypot(cam.pos.x - prevCam.pos.x, cam.pos.y - prevCam.pos.y, cam.height - prevCam.height) / dt : 0;
    const subSpeed = i ? Math.hypot(subs[0].x - prevSub.x, subs[0].y - prevSub.y) / dt : 0;
    const opSpeed = i && pick && prevOp ? Math.hypot(pick.op.x - prevOp.x, pick.op.y - prevOp.y) / dt : 0;

    // rig noise sources (level at 1 m, position)
    const rig = [];
    const moving = camSpeed > 0.08; // ignore handheld/Steadicam float
    if (moving && mv.support === 'dolly' && mv.travel > 0.05) rig.push({ name: 'dolly wheels / track', l1: clamp(30 + 20 * Math.log10(camSpeed / 0.3), 20, 42), at: V3(cam.pos.x, cam.pos.y, 0.3) });
    if (moving && mv.support !== 'dolly') rig.push({ name: `${mv.support === 'steadicam' ? 'Steadicam' : 'handheld'} operator footsteps`, l1: 42 + foot, at: V3(cam.pos.x, cam.pos.y, 0.1) });
    if (mv.type === 'pedestal' && mv.lift > 0.9 && moving) rig.push({ name: 'jib / crane', l1: 30, at: V3(cam.pos.x, cam.pos.y, 1) });
    if (mv.type === 'zoom' && moving) rig.push({ name: 'zoom motor', l1: 26, at: V3(cam.pos.x, cam.pos.y, cam.height) });
    if (subSpeed > 0.05) rig.push({ name: 'subject footsteps', l1: 44 + foot, at: V3(subs[0].x, subs[0].y, 0.05), subject: true });
    if (opSpeed > 0.15) rig.push({ name: 'boom operator footsteps', l1: 40 + foot, at: V3(pick.op.x, pick.op.y, 0.05) });
    const lvlAt = (src, p) => src.l1 - 20 * Math.log10(Math.max(len3(sub3(src.at, p)), 0.3));

    const chest = V3(target.x, target.y, 1.35);
    let snr = null, noise = null;
    if (pick) {
      noise = sumDb([noiseAt(pick.mic), ...rig.map((r) => lvlAt(r, pick.mic))]);
      snr = voice - 20 * Math.log10(pick.dist) - (noise - mic.DI);
    }
    const lavNoise = sumDb([s.floor, ...rig.map((r) => lvlAt(r, chest))]);
    const lavSnr = voice - 20 * Math.log10(lavDist) - lavNoise - 3 - (subSpeed > 0.05 ? 4 : 0); // −4 dB clothing rustle while walking
    const camDist = Math.hypot(cam.pos.x - target.x, cam.pos.y - target.y);
    const face = ((0.23 * cam.f) / (camDist * cam.sensor.h)) * 100;
    samples.push({
      t, ok: !!pick, handoff, mic: pick?.mic, op: pick?.op, hands: pick?.hands, from: pick?.from, side: pick?.side,
      pole: pick?.pole, dist: pick?.dist, snr, lavSnr, noise, rig,
      shadow: pick && ((pick.face && !pick.face.soft) || (pick.bg && !pick.bg.soft)) ? (pick.face ? 'face' : pick.bg.surface) : null,
      bgPts: pick?.bgPts ?? [], face,
    });
    prevCam = cam; prevSub = subs[0]; prevOp = pick?.op ?? prevOp;
  }

  // spans of trouble, as [t0, t1]
  const spans = (pred) => {
    const out = [];
    let start = null;
    samples.forEach((x, i) => {
      if (pred(x) && start == null) start = x.t;
      if ((!pred(x) || i === samples.length - 1) && start != null) { out.push([start, pred(x) ? x.t : samples[i - 1].t]); start = null; }
    });
    return out;
  };
  const noBoom = spans((x) => !x.ok);
  const shadowSpans = spans((x) => !!x.shadow);
  const weakSpans = spans((x) => x.ok && x.snr < USABLE_SNR);
  const okS = samples.filter((x) => x.ok);
  const minBoom = okS.length ? okS.reduce((a, b) => (b.snr < a.snr ? b : a)) : null;
  const minLav = samples.reduce((a, b) => (b.lavSnr < a.lavSnr ? b : a));
  let opTravel = 0, opPeak = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (a.ok && b.ok && !a.handoff && !b.handoff) {
      const d = Math.hypot(b.op.x - a.op.x, b.op.y - a.op.y);
      opTravel += d; opPeak = Math.max(opPeak, d / dt);
    }
  }
  const rigPeak = {};
  samples.forEach((x) => x.rig.forEach((r) => { if (x.ok) { const l = r.l1 - 20 * Math.log10(Math.max(len3(sub3(r.at, x.mic)), 0.3)); rigPeak[r.name] = Math.max(rigPeak[r.name] ?? -99, l); } }));

  // Sound perspective: does mic distance change the way the shot size does?
  const a = okS[0], b = okS[okS.length - 1];
  const pic = Math.log2(samples[0].face / samples[samples.length - 1].face); // + = picture gets wider
  const snd = a && b ? Math.log2(b.dist / a.dist) : 0; // + = mic gets further away
  let perspective;
  if (Math.abs(pic) < 0.2) perspective = { verdict: 'steady', text: 'shot size barely changes, so the mic can hold its distance' };
  else if (Math.sign(snd) === Math.sign(pic) && Math.abs(snd) >= 0.4 * Math.abs(pic)) perspective = { verdict: 'follows', text: `the mic moves ${snd > 0 ? 'away' : 'in'} as the shot ${pic > 0 ? 'widens' : 'tightens'}, so the sound perspective follows the picture` };
  else perspective = { verdict: 'flat', text: `the shot ${pic > 0 ? 'widens' : 'tightens'} ×${fmt(2 ** Math.abs(pic), 1)} but the mic distance barely changes, so the sound stays at one perspective — ${pic > 0 ? 'add room in the mix as the frame opens' : 'ride the boom in as the frame closes'}` };

  // Recommendation for the move
  const warnings = [], notes = [];
  const fmtSpan = ([t0, t1]) => (t0 === 0 && t1 === 1 ? 'the whole move' : `${fmt(t0 * mv.duration, 1)}–${fmt(t1 * mv.duration, 1)} s`);
  let plan;
  if (noBoom.length && noBoom[0][0] === 0 && noBoom[noBoom.length - 1][1] === 1 && noBoom.length === 1) plan = 'lav';
  else if (noBoom.length || switches.length || weakSpans.length) plan = 'boom+lav';
  else plan = 'boom';
  if (s.primary === 'lav' && plan === 'boom') plan = 'boom+lav';
  noBoom.forEach((sp) => { if (plan !== 'lav') warnings.push(`Boom can't reach the subject during ${fmtSpan(sp)} without entering frame — cover with the lav there`); });
  const handoffSpans = spans((x) => x.handoff);
  handoffSpans.forEach((sp) => warnings.push(`The main boom position can't cover ${fmtSpan(sp)} — a second boom operator (or the lav) takes over there`));
  shadowSpans.forEach((sp) => warnings.push(`Boom shadow in frame (${samples.find((x) => x.t >= sp[0] && x.shadow).shadow}) during ${fmtSpan(sp)}`));
  weakSpans.forEach((sp) => warnings.push(`Boom drops below ${USABLE_SNR} dB clean during ${fmtSpan(sp)}`));
  if (plan !== 'boom' && minLav.lavSnr < USABLE_SNR && minLav.lavSnr < s.bestSnr - 3) warnings.push(`The lav drops to ${fmt(minLav.lavSnr, 0)} dB clean at ${fmt(minLav.t * mv.duration, 1)} s (rig and footstep noise) — plan wild lines for that moment`);
  Object.entries(rigPeak).forEach(([name, lvl]) => {
    if (lvl > s.floor - 6) {
      const fix = /dolly/.test(name) ? 'level the track, use quiet wheels and wax the joints'
        : /operator/.test(name) ? 'soft-soled shoes and carpet runners along the path'
          : /subject/.test(name) ? 'soft soles or rubber heel pads; foley the steps in post'
            : /zoom/.test(name) ? 'slow the zoom motor or use a quieter one' : 'service it or slow the move';
      notes.push(`${name.charAt(0).toUpperCase() + name.slice(1)} ${/steps|wheels/.test(name) ? 'reach' : 'reaches'} ${fmt(lvl, 0)} dB at the mic (floor ${fmt(s.floor, 0)} dB) — ${fix}`);
    }
  });
  if (opTravel > 0.3) notes.push(`Boom operator walks ${fmt(opTravel, 1)} m with the camera (peak ${fmt(opPeak, 2)} m/s)${opPeak > 1.2 ? ' — fast; rehearse the path' : ''}`);
  if (perspective.verdict === 'flat') notes.push(`Perspective: ${perspective.text}`);

  // The gear line must describe the setup used for the move, not the static frame's.
  if (best) {
    const [from, sideStr] = best.split(':');
    const side = +sideStr;
    const poleMax = Math.max(...samples.filter((x) => x.ok && !x.handoff).map((x) => x.pole));
    const where = Math.abs(side) === 2 ? `beside camera (${side > 0 ? 'right' : 'left'}), booming over it` : `camera-${side > 0 ? 'right' : 'left'}`;
    const line = `${mic.name} on a ${fmt(Math.ceil(poleMax * 2) / 2, 1)} m boom, ${from} frame, operator ${where}${opTravel > 0.3 ? `, walking ${fmt(opTravel, 1)} m with the camera` : ''}`;
    const i = s.gear.findIndex((g) => g.startsWith(mic.name));
    if (i >= 0) s.gear[i] = line; else if (plan !== 'lav') s.gear.unshift(line);
  }
  const res = { samples, config: best, noBoom, shadowSpans, weakSpans, switches, minBoom, minLav, opTravel, opPeak, rigPeak, perspective, plan, warnings, notes };
  // extend the Sound card
  const moveTxt = ` During the ${mv.label.toLowerCase()} the boom is re-solved every ${fmt(dt, 1)} s: ${plan === 'boom' ? `it stays clear of frame throughout, bottoming out at ${fmt(minBoom.snr, 0)} dB clean at ${fmt(minBoom.t * mv.duration, 1)} s` : plan === 'lav' ? 'it can never get close without entering frame, so the lav carries the shot' : `it needs help (${[noBoom.length ? 'out of reach for part of the move' : null, switches.length ? 'a handoff to a second position' : null, weakSpans.length ? 'weak spots' : null].filter(Boolean).join(', ')}), so the lav backs it up`}${opTravel > 0.3 ? `, with the operator walking ${fmt(opTravel, 1)} m` : ''}. Sound perspective: ${perspective.text}.`;
  s.theory.t += moveTxt;
  return res;
}

/** The boom setup at time t (nearest tracked sample during a move, else the hero plan). */
export function boomAt(sound, t) {
  if (!sound) return null;
  if (!sound.move) return sound.boom ? { ...sound.boom, ok: true } : null;
  const smp = sound.move.samples;
  const x = smp[Math.round(Math.max(0, Math.min(1, t)) * (smp.length - 1))];
  return x.ok ? { ...x } : { ok: false, t: x.t };
}

