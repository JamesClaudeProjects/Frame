// Camera-move solver: push-in, pull-out, truck, pedestal, rack focus (Phase 1);
// arc / orbit, dolly zoom and whole-move light / shadow conflict checks (Phase 2).
// A move is a camera pose over normalised time t ∈ [0, 1]. Each move is anchored to the
// solved "hero frame" (the static camera): push / truck / pedestal END on it, a pull-out
// STARTS on it. Everything downstream (frustum, DoF, viewfinder, composition) is
// re-evaluated per frame from the pose, so nothing about the move is pre-rendered.

import { measureFrame, depthOfField, project, fixtureHeight, fmt } from './engine.js';

export const MOVES = {
  auto: 'Auto (mood)',
  static: 'Static',
  push: 'Push In',
  pull: 'Pull Out',
  truck: 'Truck',
  pedestal: 'Pedestal',
  rack: 'Rack Focus',
  arc: 'Arc / Orbit',
  zoom: 'Dolly Zoom',
  follow: 'Follow',
};

export const SUPPORTS = { auto: 'Auto', dolly: 'Dolly / Sticks', steadicam: 'Steadicam', handheld: 'Handheld' };

// Tone-driven defaults: shot length (s), pedestal direction (+1 = rises into the hero frame),
// arc direction (toward or away from the key) and dolly-zoom direction.
const TONE_MOVE = {
  // pace: walking speed (m/s) for follow shots
  melancholy: { dur: 10, ped: 1, arc: 'away', zoom: 'in', pace: 0.8 },
  tense: { dur: 8, ped: -1, arc: 'away', zoom: 'in', pace: 1.4 },
  romantic: { dur: 7, ped: -1, arc: 'toward', zoom: 'out', pace: 1.0 },
  heroic: { dur: 5, ped: -1, arc: 'toward', zoom: 'out', pace: 1.25 },
  lonely: { dur: 12, ped: 1, arc: 'toward', zoom: 'in', pace: 0.9 },
};

const DEG = Math.PI / 180;
const LENS_MIN = 14, LENS_MAX = 135;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Dolly grips ease in and out; smoothstep gives a peak speed of 1.5× the average.
export const ease = (t) => t * t * (3 - 2 * t);
const invEase = (e) => {
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (ease(m) < e) lo = m; else hi = m; }
  return (lo + hi) / 2;
};
const SAMPLES = 48;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Auto: the mood proposes a move --------------------------------------------
// Weights are tone tendencies, adjusted by blocking and location; the seed picks among
// them, so "Generate New Variation" can land on a different (but still in-mood) move.
const MOOD_WEIGHTS = {
  melancholy: { pull: 3, pedestal: 2, arc: 1.2, static: 1, follow: 0.8 },
  tense: { push: 3, zoom: 2, follow: 1.5, rack: 1.2, truck: 0.6 },
  romantic: { arc: 3, push: 2, rack: 1.8, follow: 0.6 },
  heroic: { pedestal: 3, push: 2, arc: 1.2, zoom: 0.8, follow: 1 },
  lonely: { pull: 3, pedestal: 2, truck: 1.2, static: 1, follow: 0.8 },
};

export function pickMove(scene, inp) {
  const w = { ...MOOD_WEIGHTS[inp.tone] };
  const why = [];
  const bump = (k, x, reason) => { w[k] = (w[k] ?? 0) * x + (w[k] ? 0 : x * 0.6); if (reason) why.push(reason); };
  if (inp.blocking === 'two') { bump('rack', 1.6, 'a dialogue invites a rack between the pair'); bump('arc', 1.3); w.follow = (w.follow ?? 0) * 0.3; }
  if (inp.blocking === 'crowd') { bump('follow', 1.8, 'a crowd rewards following the hero through it'); bump('truck', 1.4); }
  if (['field', 'alley', 'neon'].includes(inp.env)) bump('follow', 1.4, 'an exterior gives room to walk');
  if (inp.env === 'interior' || inp.env === 'studio') { w.follow = (w.follow ?? 0) * 0.6; }
  if (inp.focal >= 85) { bump('rack', 1.3, 'a long lens makes focus the main tool'); w.arc = (w.arc ?? 0) * 0.6; }
  if (inp.focal <= 24) { bump('push', 1.3, 'a wide lens makes travel read strongly'); bump('zoom', 1.2); }
  const entries = Object.entries(w).filter(([, v]) => v > 0);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const rng = mulberry32(inp.seed * 104729 + 3);
  let r = rng() * total, type = entries[0][0];
  for (const [k, v] of entries) { if ((r -= v) <= 0) { type = k; break; } }
  const ranked = entries.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${MOVES[k]} ${Math.round((v / total) * 100)}%`);
  return { type, odds: ranked, why };
}

// --- Camera support: operator wobble ---------------------------------------------
// Deterministic band-limited noise (sum of sines with seeded phases). Handheld adds a
// breathing component (~0.3 Hz) and a step component (~2 Hz); Steadicam only floats.
const WOBBLE = {
  dolly: null,
  steadicam: { pos: 0.015, h: 0.01, yaw: 0.25, pitch: 0.2, roll: 0.4, hz: [0.22, 0.41] },
  handheld: { pos: 0.03, h: 0.025, yaw: 0.9, pitch: 0.7, roll: 1.5, hz: [0.3, 0.9, 2.1] },
};
function makeWobble(kind, seed) {
  const W = WOBBLE[kind];
  if (!W) return () => ({ x: 0, y: 0, h: 0, yaw: 0, pitch: 0, roll: 0 });
  const rng = mulberry32(seed * 7 + 11);
  const ph = {};
  ['x', 'y', 'h', 'yaw', 'pitch', 'roll'].forEach((c) => { ph[c] = W.hz.map(() => rng() * Math.PI * 2); });
  const n = (c, sec) => W.hz.reduce((a, hz, i) => a + Math.sin(2 * Math.PI * hz * sec + ph[c][i]) / (i + 1), 0) / 1.4;
  return (sec) => ({
    x: n('x', sec) * W.pos, y: n('y', sec) * W.pos, h: n('h', sec) * W.h,
    yaw: n('yaw', sec) * W.yaw * DEG, pitch: n('pitch', sec) * W.pitch * DEG, roll: n('roll', sec) * W.roll,
  });
}

export function solveMove(scene, inp) {
  let type = MOVES[inp.move] ? inp.move : 'static';
  const auto = type === 'auto' ? pickMove(scene, inp) : null;
  if (auto) type = auto.type;
  const hero = scene.camera;
  const P = scene.P;
  const S = hero.sensor, f = hero.f, N = hero.N;
  const tm = TONE_MOVE[inp.tone];
  const amt = clamp(inp.moveAmt ?? 0.6, 0, 1);
  const duration = inp.moveDur ?? tm.dur;
  const notes = [];
  const key = scene.lights.find((l) => l.role === 'key');

  // Physical limits from the set: interior walls, alley walls.
  let minY = -Infinity, xLim = Infinity, maxY = Infinity;
  if (scene.set.kind === 'interior') {
    const [x0, y0, x1] = scene.set.walls[0];
    minY = y0 + 0.45;
    maxY = scene.bgY - 0.45;
    xLim = Math.min(Math.abs(x0), Math.abs(x1)) - 0.4;
  } else if (scene.set.kind === 'alley') {
    xLim = Math.abs(scene.set.walls[1][0]) - 0.35;
  }
  const inside = (p) => p.y >= minY - 1e-6 && p.y <= maxY && Math.abs(p.x) <= xLim + 1e-6;

  // A move is a rig state over eased time e: position, lens height, yaw (lens axis
  // rotated from +Y toward +X) and focal length. Default = the hero frame, static.
  const heroRig = { x: 0, y: 0, h: hero.height, yaw: 0, f };
  let rig = () => heroRig;
  let rack = null, arc = null, zoom = null, follow = null;
  let subjAt = null; // primary subject position over eased time (follow shots)

  if (type === 'push' || type === 'pull' || type === 'truck' || type === 'pedestal') {
    const A = { ...heroRig }, B = { ...heroRig };
    if (type === 'push') {
      const want = P.y * (0.15 + 0.6 * amt);
      A.y = Math.max(-want, minY);
      if (-A.y < want - 0.01) notes.push(`Room wall limits the push — travel trimmed from ${fmt(want)} m to ${fmt(-A.y)} m`);
    } else if (type === 'pull') {
      const want = P.y * (0.2 + 1.0 * amt);
      B.y = Math.max(-want, minY);
      if (-B.y < want - 0.01) notes.push(`Room wall limits the pull-out — travel trimmed from ${fmt(want)} m to ${fmt(-B.y)} m`);
    } else if (type === 'truck') {
      const want = ((P.y * S.w) / f) * (0.25 + 0.75 * amt);
      const side = Math.sign(P.x) || 1;
      // Start on the far side of the subject and track toward them, ending on the hero frame.
      A.x = clamp(-side * want, -xLim, xLim);
      if (Math.abs(A.x) < want - 0.01) notes.push(`Walls limit the truck — travel trimmed from ${fmt(want)} m to ${fmt(Math.abs(A.x))} m`);
    } else {
      A.h = clamp(hero.height - tm.ped * (0.4 + 1.4 * amt), 0.3, 4.5);
    }
    rig = (e) => ({ x: lerp(A.x, B.x, e), y: lerp(A.y, B.y, e), h: lerp(A.h, B.h, e), yaw: 0, f });
  } else if (type === 'rack') {
    rack = rackTargets(scene, inp);
  } else if (type === 'arc') {
    // Orbit the primary subject at the hero radius; yaw turns with the orbit so the subject
    // keeps their composed screen position while the world rotates behind them.
    const v0 = { x: -P.x, y: -P.y };
    const ac = Math.atan2(v0.y, v0.x);
    const ak = key.modifier === 'sun' ? key.az : Math.atan2(key.pos.y - P.y, key.pos.x - P.x);
    const towardKey = Math.sign(wrap(ak - ac)) || 1;
    // The move travels TOWARD the key (opening the face) or AWAY (into the shadow side).
    const travelDir = tm.arc === 'toward' ? towardKey : -towardKey;
    let sweep = (15 + 75 * amt) * DEG;
    const at = (phi) => ({ x: P.x + v0.x * Math.cos(phi) - v0.y * Math.sin(phi), y: P.y + v0.x * Math.sin(phi) + v0.y * Math.cos(phi) });
    const fits = (sw) => { for (let i = 0; i <= 24; i++) if (!inside(at(-travelDir * sw * (1 - i / 24)))) return false; return true; };
    const want = sweep;
    while (!fits(sweep) && sweep > 4 * DEG) sweep *= 0.9;
    if (!fits(sweep)) sweep = 0;
    if (sweep < want - 0.5 * DEG) notes.push(`Walls limit the arc — sweep trimmed from ${fmt(want / DEG, 0)}° to ${fmt(sweep / DEG, 0)}°`);
    const phiStart = -travelDir * sweep;
    arc = { radius: Math.hypot(v0.x, v0.y), sweep, travelDir, toward: tm.arc === 'toward' };
    rig = (e) => {
      const phi = phiStart * (1 - e);
      const p = at(phi);
      return { x: p.x, y: p.y, h: hero.height, yaw: -phi, f };
    };
  } else if (type === 'zoom') {
    // Dolly zoom: magnification f/D is held constant, so the subject stays the same size
    // while the field of view — and the background's apparent scale — changes.
    const D = P.y;
    let dir = tm.zoom;
    const solveR = (d) => {
      let r = 1 + 1.5 * amt;
      if (d === 'in') { r = Math.min(r, LENS_MAX / f); if (Number.isFinite(minY)) r = Math.min(r, (D - minY) / D); }
      else r = Math.min(r, f / LENS_MIN, D / 0.6);
      return r;
    };
    let r = solveR(dir);
    if (r < 1.08) {
      const other = dir === 'in' ? 'out' : 'in';
      const r2 = solveR(other);
      if (r2 > r) { notes.push(`A ${dir === 'in' ? 'dolly-in / zoom-out' : 'dolly-out / zoom-in'} won't fit at ${f}mm here — reversed`); dir = other; r = r2; }
    }
    r = Math.max(r, 1);
    if (r < 1.08) notes.push(`Lens range or set space leaves almost no room for a dolly zoom at ${f}mm`);
    const Dstart = dir === 'in' ? D * r : D / r;
    const yS = D - Dstart;
    zoom = { dir, ratio: r, fStart: (f * Dstart) / D, fEnd: f, dStart: Dstart, dEnd: D };
    rig = (e) => {
      const y = lerp(yS, 0, e);
      return { x: 0, y, h: hero.height, yaw: 0, f: (f * (D - y)) / D };
    };
  } else if (type === 'follow') {
    // The subject walks forward along their facing into the hero mark; the camera holds
    // its hero offset, so framing is locked while the world (and the light) slides past.
    const s0 = scene.subjects[0];
    const hd = { x: Math.cos(s0.facing), y: Math.sin(s0.facing) };
    const off = { x: -P.x, y: -P.y };
    let walk = tm.pace * duration * (0.25 + 0.75 * amt);
    const want = walk;
    const subjPt = (w, e) => ({ x: P.x - hd.x * w * (1 - e), y: P.y - hd.y * w * (1 - e) });
    const ok = (w) => {
      for (let i = 0; i <= 20; i++) {
        const sp = subjPt(w, i / 20);
        if (!inside({ x: sp.x + off.x, y: sp.y + off.y })) return false;
        if (Math.abs(sp.x) > xLim || sp.y > maxY || sp.y < minY) return false;
      }
      return true;
    };
    while (!ok(walk) && walk > 0.3) walk *= 0.9;
    if (!ok(walk)) walk = 0;
    if (walk < want - 0.05) notes.push(`Set limits the walk — trimmed from ${fmt(want)} m to ${fmt(walk)} m`);
    subjAt = (e) => subjPt(walk, e);
    const towardLens = hd.x * -P.x + hd.y * -P.y > 0; // heading has a component toward the lens
    follow = { walk, pace: walk / duration, leading: towardLens, heading: s0.facing };
    rig = (e) => { const sp = subjAt(e); return { x: sp.x + off.x, y: sp.y + off.y, h: hero.height, yaw: 0, f }; };
  }

  // Camera support (wobble) — explicit, or chosen by move and mood.
  const support = inp.support && inp.support !== 'auto' ? inp.support
    : type === 'follow' ? 'steadicam' : inp.tone === 'tense' && type !== 'pedestal' ? 'handheld' : 'dolly';
  const wob = makeWobble(support, inp.seed);
  const subjPos = (e) => (subjAt ? subjAt(e) : P);

  const poseAt = (t) => {
    const e = ease(clamp(t, 0, 1));
    const r = rig(e);
    const sp = subjPos(e);
    const fwd = { x: Math.sin(r.yaw), y: Math.cos(r.yaw) };
    const dist = (sp.x - r.x) * fwd.x + (sp.y - r.y) * fwd.y; // along the lens axis
    // Operator holds the eyes on the tone's target line throughout the move.
    const pitch = Math.atan2(hero.eyeH - r.h, dist) - Math.atan(hero.vTarget / r.f);
    const focus = rack ? lerp(rack.a.dist, rack.b.dist, e) : dist;
    const w = wob(t * duration);
    return {
      ...hero, pos: { x: r.x + w.x, y: r.y + w.y }, height: r.h + w.h, yaw: r.yaw + w.yaw, pitch: pitch + w.pitch,
      dutch: hero.dutch + w.roll, focus, f: r.f, subject: sp,
      fovH: 2 * Math.atan(S.w / (2 * r.f)), fovV: 2 * Math.atan(S.h / (2 * r.f)), dist,
    };
  };

  // Subjects at time t (only the primary walks).
  const subjectsAt = (t) => {
    if (!subjAt) return scene.subjects;
    const sp = subjAt(ease(clamp(t, 0, 1)));
    return scene.subjects.map((s, i) => (i === 0 ? { ...s, x: sp.x, y: sp.y } : s));
  };

  const keyDist = (sp) => (key.modifier === 'sun' ? 1 : Math.hypot(key.pos.x - sp.x, key.pos.y - sp.y, (Number.isFinite(key.height) ? key.height : 2.5) - 1.6));
  const metricsAt = (t) => {
    const cam = poseAt(t);
    const sp = cam.subject;
    const m = measureFrame(cam, subjectsAt(t));
    const keyDir = key.modifier === 'sun' ? key.az : Math.atan2(key.pos.y - sp.y, key.pos.x - sp.x);
    const camDir = Math.atan2(cam.pos.y - sp.y, cam.pos.x - sp.x);
    const bgAxis = (scene.bgY - cam.pos.y) / Math.max(Math.cos(cam.yaw), 0.2);
    return {
      ...m,
      dist: cam.dist,
      height: cam.height,
      tiltDeg: (cam.pitch * 180) / Math.PI,
      focus: cam.focus,
      f: cam.f,
      fovH: cam.fovH / DEG,
      dof: depthOfField(cam.f, N, cam.focus),
      bgScale: cam.dist / bgAxis,
      // face (chin→crown ≈ 0.23 m) as a share of frame height — the usual measure of shot size
      faceSize: ((0.23 * cam.f) / (Math.hypot(cam.pos.x - sp.x, cam.pos.y - sp.y) * S.h)) * 100,
      keyOff: Math.abs(wrap(keyDir - camDir)) / DEG,
      // key level on the face relative to the hero mark (inverse-square), in stops
      keyStops: 2 * Math.log2(keyDist(P) / keyDist(sp)),
      roll: cam.dutch,
    };
  };

  // Sampled path (for drawing curved track and for conflict checks).
  const path = [];
  for (let i = 0; i <= SAMPLES; i++) path.push(rig(ease(i / SAMPLES)));
  const A = rig(0), B = rig(1);
  let travel = 0;
  for (let i = 1; i < path.length; i++) travel += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  const lift = Math.abs(B.h - A.h);
  const pathLen = Math.hypot(travel, lift);
  const speedAvg = pathLen / duration;
  const speedPeak = speedAvg * 1.5;
  const start = metricsAt(0), end = metricsAt(1);

  // 180° line (dialogue): does the camera cross it during the move?
  let lineCross = null;
  if (scene.lineOfAction && type !== 'static') {
    const { a, b } = scene.lineOfAction;
    const side = (p) => Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const s0 = side(path[0]);
    const i = path.findIndex((p) => side(p) !== s0 && side(p) !== 0);
    if (i > 0) {
      lineCross = { t: i / SAMPLES };
      notes.push(`Camera crosses the 180° line at ${fmt(lineCross.t * duration, 1)} s — screen direction flips mid-shot`);
    }
  }

  const conflicts = checkLights(scene, poseAt, type === 'static' ? [1] : null, duration);
  conflicts.forEach((c) => notes.push(c.note));

  // Practicality / gear.
  const gear = [];
  const tracked = support === 'dolly';
  if (['push', 'pull', 'truck', 'zoom'].includes(type) && tracked) {
    const track = travel + 1.2;
    gear.push(`Dolly on ≈ ${fmt(track)} m of straight track (${Math.ceil(track / 2.44)} × 8 ft sections)`);
  }
  if (type === 'follow') {
    gear.push(`Subject walks ${fmt(follow.walk, 2)} m at ~${fmt(follow.walk / duration * 1.0, 2)} m/s avg (${follow.leading ? 'toward lens — camera leads, backing up' : 'away / across — camera trails'})`);
    if (support === 'dolly') gear.push(`Dolly on ≈ ${fmt(travel + 1.2)} m of track laid along the walk`);
  }
  if (support === 'steadicam') gear.push(`Steadicam${travel > 0.05 ? ` — operator walks ${fmt(travel, 2)} m${type === 'follow' && follow.leading ? ' backwards, with a spotter' : ''}` : ''}; no track`);
  if (support === 'handheld') gear.push(`Handheld shoulder rig${travel > 0.05 ? ` — operator walks ${fmt(travel, 2)} m` : ''}; ±${WOBBLE.handheld.roll}° roll, ±${WOBBLE.handheld.pos * 100} cm drift`);
  if (type === 'arc' && arc.sweep > 0 && tracked) {
    const sections = Math.ceil((travel + 1.2) / 2.44);
    gear.push(`Curved track, radius ${fmt(arc.radius, 2)} m, ${fmt(travel, 2)} m of arc (${sections} curved sections${arc.radius < 1.5 ? ' — tight radius, consider a Steadicam or round-table dolly' : ''})`);
  }
  if (['push', 'pull', 'truck', 'zoom', 'arc'].includes(type) && tracked) {
    if (speedPeak > 1.2) notes.push(`Peak ${fmt(speedPeak, 2)} m/s is fast for a dolly — lengthen the shot or use a vehicle/remote head`);
    else if (speedPeak < 0.06 && travel > 0.05) notes.push(`Peak ${fmt(speedPeak * 100, 0)} cm/s is a crawl — a motorised slider holds this steadier than a grip`);
  }
  if (type === 'pedestal') {
    gear.push(lift <= 0.9 ? `Dolly column / pedestal (${fmt(lift, 2)} m stroke ≤ 0.9 m)` : lift <= 2.5 ? `Jib arm (${fmt(lift, 2)} m vertical exceeds a dolly column)` : `Crane / Technocrane (${fmt(lift, 2)} m vertical)`);
    if (speedPeak > 0.6) notes.push(`Boom peaks at ${fmt(speedPeak, 2)} m/s — fast enough to read as a swoop, not a drift`);
  }
  if (type === 'rack') {
    gear.push(`1st AC pulls ${fmt(Math.abs(rack.b.dist - rack.a.dist), 2)} m of focus throw — marks at ${fmt(rack.a.dist, 2)} m and ${fmt(rack.b.dist, 2)} m`);
  }
  if (type === 'zoom') {
    const lo = Math.min(zoom.fStart, zoom.fEnd), hi = Math.max(zoom.fStart, zoom.fEnd);
    gear.push(`Cine zoom covering ${fmt(lo, 0)}–${fmt(hi, 0)}mm (${fmt(hi / lo, 1)}×), zoom motor slaved to the dolly so f/D stays locked`);
    if (hi / lo > 5) notes.push(`${fmt(hi / lo, 1)}× zoom range — beyond most short cine zooms; needs a long-range zoom (e.g. 25–250)`);
    gear.push('Hold the T-stop constant through the zoom (no ramping) to keep exposure locked');
  }

  return {
    type, label: MOVES[type], auto, support, A, B, path, duration, travel, lift, speedAvg, speedPeak, poseAt, metricsAt, subjectsAt,
    subjPath: subjAt ? [...Array(25)].map((_, i) => subjAt(i / 24)) : null,
    start, end, rack, arc, zoom, follow, lineCross, conflicts, notes, gear,
    conflictsAt: (t) => checkLights(scene, poseAt, [t], duration),
    theory: type === 'static' && support === 'dolly' && !auto ? null : synthesizeMove({ type, A, B, start, end, duration, travel, lift, speedPeak, rack, arc, zoom, follow, auto, support, lineCross, conflicts, scene, inp }),
  };
}

// --- Light / shadow conflicts over the whole move ----------------------------
// Each fixture is projected through every sampled pose. A head inside the frame (or a
// stand, for anything not rigged overhead) is a conflict; so is the camera rig passing
// between the key and the subject low enough to cast its shadow on them.

export function fixtureName(l) {
  if (l.modifier === 'silk') return '12×12 silk';
  if (l.role === 'neg') return 'Neg-fill floppy';
  if (l.role === 'key2') return 'Cross-key';
  const first = l.label.split(' · ')[0];
  return first.charAt(0) + first.slice(1).toLowerCase();
}

function checkLights(scene, poseAt, onlyTimes, duration) {
  const P = scene.P;
  const ts = onlyTimes ?? [...Array(SAMPLES + 1)].map((_, i) => i / SAMPLES);
  const poses = ts.map((t) => ({ t, cam: poseAt(t) }));
  const inside = (p, m = 0.0) => p && p.x > -m && p.x < 1 + m && p.y > -m && p.y < 1 + m;
  const out = [];
  scene.lights.forEach((l) => {
    if (['practical', 'sun'].includes(l.role) || l.modifier === 'sun' || l.modifier === 'window') return;
    const pts = l.modifier === 'silk'
      ? [[-1.8, -1.8], [1.8, -1.8], [1.8, 1.8], [-1.8, 1.8]].map(([dx, dy]) => ({ x: l.pos.x + dx, y: l.pos.y + dy }))
      : [l.pos];
    const h = l.modifier === 'silk' ? 3.4 : fixtureHeight(l);
    const flown = h > 3.2 || l.modifier === 'silk';
    const heights = flown ? [h] : [0.05, h * 0.5, h];
    const hits = poses.filter(({ cam }) => pts.some((p) => heights.some((hh) => inside(project(cam, p, hh)))));
    if (!hits.length) return;
    const headHit = poses.some(({ cam }) => pts.some((p) => inside(project(cam, p, h))));
    const t0 = hits[0].t, t1 = hits[hits.length - 1].t;
    // Fix: how high must the head go to clear the top of frame at the worst pose?
    let clearH = null;
    for (let hh = h; hh <= 8; hh += 0.1) {
      if (!hits.some(({ cam }) => pts.some((p) => inside(project(cam, p, hh), 0.02)))) { clearH = hh; break; }
    }
    const name = fixtureName(l);
    const when = onlyTimes ? 'in the hero frame' : t0 === 0 && t1 === 1 ? 'for the whole move' : `from ${fmt(t0 * duration, 1)} s to ${fmt(t1 * duration, 1)} s`;
    const fix = clearH && clearH - h < 2.5 && !flown
      ? `boom it to ${fmt(clearH, 1)} m on a C-stand arm or fly it`
      : clearH && flown ? `raise the rig to ${fmt(clearH, 1)} m` : 'cheat it wider or flag it off and pick it up in a separate setup';
    out.push({
      id: l.id, label: name, t0, t1, head: headHit, kind: headHit ? 'fixture' : 'stand',
      note: `${name} ${headHit ? '' : 'stand '}in shot ${when} — ${fix}`,
    });
  });

  // Camera / dolly shadow across the subject.
  const key = scene.lights.find((l) => l.role === 'key');
  if (key && key.modifier !== 'silk' && key.modifier !== 'window') {
    const shadowTs = poses.filter(({ cam }) => {
      const P = cam.subject ?? scene.P;
      const c = cam.pos, top = cam.height + 0.35; // camera + operator head
      let kx, ky, kh, kd;
      if (key.modifier === 'sun') {
        kd = 30; kx = P.x + Math.cos(key.az) * kd; ky = P.y + Math.sin(key.az) * kd;
        kh = 1.6 + Math.tan(key.elev * DEG) * kd;
      } else { kx = key.pos.x; ky = key.pos.y; kh = Number.isFinite(key.height) ? key.height : 2.5; kd = Math.hypot(kx - P.x, ky - P.y); }
      const vx = kx - P.x, vy = ky - P.y, L2 = vx * vx + vy * vy;
      const u = ((c.x - P.x) * vx + (c.y - P.y) * vy) / L2; // 0 at subject, 1 at key
      if (u <= 0.02 || u >= 1) return false;
      const off = Math.hypot(P.x + vx * u - c.x, P.y + vy * u - c.y);
      const rayH = 1.6 + (kh - 1.6) * u;
      return off < 0.45 && top > rayH;
    });
    if (shadowTs.length) {
      const t0 = shadowTs[0].t, t1 = shadowTs[shadowTs.length - 1].t;
      out.push({
        id: 'camshadow', label: 'Camera shadow', t0, t1, kind: 'shadow',
        note: `Camera/dolly shadow crosses the subject ${onlyTimes ? 'in the hero frame' : `from ${fmt(t0 * duration, 1)} s to ${fmt(t1 * duration, 1)} s`} — raise the key or re-route the track`,
      });
    }
  }
  return out;
}

// Pick what the focus racks between — computed from the blocking, not a fixed preset.
function rackTargets(scene, inp) {
  const P = scene.P;
  const subj = scene.subjects;
  let other;
  if (subj.length === 2) {
    const b = subj[1];
    other = { dist: b.y, label: 'subject B', point: b };
  } else if (subj.length > 2) {
    const extras = subj.filter((s) => s.extra);
    const watcher = extras.find((s) => s.watching);
    const pick = watcher ?? extras.reduce((a, s) => (Math.abs(s.y - P.y) > Math.abs(a.y - P.y) ? s : a), extras[0]);
    other = { dist: pick.y, label: watcher ? 'watching extra' : 'crowd', point: pick };
  } else {
    const tanH = Math.tan(scene.camera.fovH / 2);
    const prac = scene.lights.filter((l) => l.role === 'practical' && l.lit && l.pos.y > P.y && Math.abs(l.pos.x) < l.pos.y * tanH)
      .sort((a, b) => a.pos.y - b.pos.y)[0];
    other = prac
      ? { dist: prac.pos.y, label: prac.name.toLowerCase(), point: prac.pos }
      : { dist: Math.min(scene.bgY, P.y + 12), label: 'background', point: { x: 0, y: Math.min(scene.bgY, P.y + 12) } };
  }
  const hero = { dist: P.y, label: subj.length > 2 ? 'hero' : subj.length === 2 ? 'subject A' : 'subject', point: P };
  // Unsettled tones pull attention AWAY from the subject; the others land ON the subject.
  const away = ['tense', 'lonely'].includes(inp.tone);
  return away ? { a: hero, b: other } : { a: other, b: hero };
}

function synthesizeMove({ type, A, B, start: s, end: e, duration, travel, lift, speedPeak, rack, arc, zoom, follow, auto, support, lineCross, conflicts, scene, inp }) {
  const f = scene.camera.f;
  const pct = (v) => `${fmt(v, 0)}%`;
  let t = '';
  if (type === 'push' || type === 'pull') {
    const verb = type === 'push' ? 'push-in' : 'pull-out';
    t = `The ${fmt(travel, 2)} m ${verb} over ${fmt(duration, 0)} s (peak ${fmt(speedPeak, 2)} m/s, eased) ${e.faceSize >= s.faceSize ? 'grows' : 'shrinks'} the face from ${pct(s.faceSize)} to ${pct(e.faceSize)} of frame height (×${fmt(e.faceSize / s.faceSize, 2)}), `
      + `while negative space goes ${pct(s.negSpace)} → ${pct(e.negSpace)}. `;
    t += `Because the lens moves rather than zooms, perspective changes too: the background's relative scale goes ${pct(s.bgScale * 100)} → ${pct(e.bgScale * 100)}`;
    t += f < 30 ? `, a large shift on a ${f}mm lens, so space visibly stretches as the camera travels. ` : f > 70 ? `, a subtle shift on a ${f}mm lens, so the move reads as a slow compression, not a journey. ` : '. ';
    const grow = e.faceSize / s.faceSize;
    if (grow > 1.15 || e.negSpace < s.negSpace - 8) t += 'The frame closes in on the subject; the audience is drawn into their state and loses the option of looking away.';
    else if (grow < 0.87 || e.negSpace > s.negSpace + 8) t += 'Emptiness grows as the shot runs, so the isolation is felt over time, not just shown.';
    else t += 'Framing barely changes, so the move works on the audience mostly through perspective.';
  } else if (type === 'truck') {
    const S = scene.camera.sensor;
    const subjShift = (travel * f) / (s.dist * S.w) * 100;
    const bgShift = (travel * f) / ((scene.bgY - A.y) * S.w) * 100;
    t = `The ${fmt(travel, 2)} m lateral truck slides the subject ${pct(subjShift)} of frame width but the background only ${pct(bgShift)} — `
      + `${fmt(subjShift / Math.max(bgShift, 0.01), 1)}× parallax. The subject travels from ${s.pCenterX < 0 || s.pCenterX > 100 ? 'off-frame' : pct(s.pCenterX)} to ${pct(e.pCenterX)} across the frame and lands on the composed third. `;
    t += subjShift > 60 ? 'At this travel the subject is revealed from off-frame — the world is introduced before the person.' : 'The difference in speed between planes is what sells depth; the subject separates from the world without a cut.';
  } else if (type === 'pedestal') {
    const cross = (1.6 - A.h) / (B.h - A.h);
    t = `The camera ${B.h > A.h ? 'rises' : 'descends'} ${fmt(lift, 2)} m (${fmt(A.h, 2)} → ${fmt(B.h, 2)} m) over ${fmt(duration, 0)} s, tilt re-solved each frame from ${fmt(s.tiltDeg)}° to ${fmt(e.tiltDeg)}° so the eyes stay on their line. `;
    if (cross > 0 && cross < 1) t += `It crosses the 1.6 m eyeline at ${fmt(invEase(cross) * duration, 1)} s: the shot begins ${A.h < 1.6 ? 'looking up' : 'looking down'} and ends ${B.h < 1.6 ? 'looking up' : 'looking down'} — the power relationship flips within the shot. `;
    else t += `It never crosses the eyeline, so it ${B.h < 1.6 ? 'deepens a low, empowering angle' : 'deepens a high, diminishing angle'} rather than reversing it. `;
    t += `Headroom moves ${pct(s.headroom)} → ${pct(e.headroom)}.`;
  } else if (type === 'rack') {
    t = `Focus rolls from the ${rack.a.label} at ${fmt(rack.a.dist, 2)} m to the ${rack.b.label} at ${fmt(rack.b.dist, 2)} m. At f/${scene.camera.N} the sharp zone is ${dofText(s.dof)} at the first mark and ${dofText(e.dof)} at the second`;
    const sep = Math.abs(rack.b.dist - rack.a.dist);
    t += s.dof.total < sep ? ', narrower than the gap between them, so only one can ever be sharp — the pull is a clear change of attention. ' : ', wide enough to hold both, so the rack is a soft nudge rather than a switch. ';
    t += rack.b.point === scene.P ? 'Attention lands on the subject, delivered by the lens instead of a cut.' : 'Attention leaves the subject for something they cannot see, which feeds unease.';
  } else if (type === 'arc') {
    if (arc.sweep === 0) {
      t = 'The set leaves no room to orbit the subject at this radius, so the arc collapses to a static frame. ';
    } else {
      t = `The camera orbits ${fmt(arc.sweep / DEG, 0)}° around the subject at a ${fmt(arc.radius, 2)} m radius (${fmt(travel, 2)} m of curved track, peak ${fmt(speedPeak, 2)} m/s), panning with the orbit so the subject holds ${pct(e.pCenterX)} across the frame while the world rotates behind them. `;
      t += `The key swings from ${fmt(s.keyOff, 0)}° to ${fmt(e.keyOff, 0)}° off the lens axis`;
      t += arc.toward
        ? ' — the camera travels toward the light, so the face opens up and brightens as the shot runs: a reveal, a warming.'
        : ' — the camera travels away from the light, so more of the shadow side turns to lens as the shot runs: the character closes off while we circle them.';
    }
  } else if (type === 'zoom') {
    const into = zoom.dir === 'in';
    t = `Dolly ${into ? 'in' : 'out'} from ${fmt(zoom.dStart, 2)} m to ${fmt(zoom.dEnd, 2)} m while zooming ${into ? 'out' : 'in'} ${fmt(zoom.fStart, 0)} → ${fmt(zoom.fEnd, 0)}mm, holding f/D constant: the face stays at ${pct(s.faceSize)} → ${pct(e.faceSize)} of frame height, but the horizontal view goes ${fmt(s.fovH, 0)}° → ${fmt(e.fovH, 0)}° and the background's relative scale ${pct(s.bgScale * 100)} → ${pct(e.bgScale * 100)}. `;
    t += into
      ? 'The world stretches away behind a subject who never moves — the ground seems to drop out from under them; the audience feels a realisation or vertigo they cannot name.'
      : 'The background swells forward and crowds the subject while they stay fixed — the world closing in, or the moment becoming enormous.';
    t += ` Depth of field barely changes (${dofText(s.dof)} → ${dofText(e.dof)}) because magnification is constant; the effect is pure perspective.`;
  }
  else if (type === 'follow') {
    t = `The subject walks ${fmt(follow.walk, 2)} m into their mark at ~${fmt(follow.pace, 2)} m/s (eased), ${follow.leading ? 'toward the lens, with the camera leading and backing up' : 'away from or across the lens, with the camera trailing'}. `
      + `The camera holds its offset, so the face stays at ${pct(e.faceSize)} of frame and the composition is locked while the world slides past behind them. `;
    if (Math.abs(s.keyStops) > 0.3) {
      t += s.keyStops < 0
        ? `The key is a fixed fixture, so by inverse-square the face starts ${fmt(-s.keyStops, 1)} stops under and walks up into its full level at the mark — they literally walk into their light.`
        : `The key is a fixed fixture, so the face starts ${fmt(s.keyStops, 1)} stops hot and settles as they reach the mark — they walk out of the glare into the moment.`;
    } else t += 'Light level on the face barely changes along the walk, so the move reads purely as motion, not revelation.';
    t += ` The key's angle to the lens goes ${fmt(s.keyOff, 0)}° → ${fmt(e.keyOff, 0)}° as they move through the set.`;
  } else if (type === 'static') {
    t = 'The frame is locked to the hero composition; only the operator moves it.';
  }
  if (support === 'steadicam') t += ' On Steadicam the frame floats (±0.4° roll, ~1.5 cm drift at 0.2–0.4 Hz): untethered and gliding, the camera feels like a presence rather than a machine.';
  if (support === 'handheld') t += ' Handheld adds ±1.5° of roll and ~3 cm of drift with breathing (0.3 Hz) and step (2 Hz) components: the frame is nervous and reactive, making the audience a participant rather than an observer.';
  if (auto) t = `Auto rolled ${MOVES[type]} from this mood's weighted options (${auto.odds.join(', ')}${auto.why.length ? ` — weighted because ${auto.why.join(', and ')}` : ''}). ` + t;
  if (lineCross) t += ` Note: the move crosses the 180° line at ${fmt(lineCross.t * duration, 1)} s, so the pair swap screen sides — use it deliberately (a shift in power) or keep the track on one side.`;
  if (type !== 'static') {
    const lc = conflicts.filter((c) => c.kind !== 'shadow');
    const sh = conflicts.find((c) => c.kind === 'shadow');
    if (lc.length) t += ` Over the move, ${lc.map((c) => `the ${c.label.toLowerCase()}${c.kind === 'stand' ? ' stand' : ''}`).join(', ')} ${lc.length > 1 ? 'enter' : 'enters'} frame — the lighting plan must be rigged for the whole move, not just the hero frame.`;
    else t += ' No fixture or stand enters the frame at any point in the move.';
    if (sh) t += ' The camera passes between key and subject, so the rig\'s own shadow will cross the face.';
  }
  return { h: 'Movement', t };
}

const dofText = (d) => (d.total < 1 ? `${fmt(d.total * 100, 0)} cm` : Number.isFinite(d.total) ? `${fmt(d.total, 2)} m` : 'to infinity');
