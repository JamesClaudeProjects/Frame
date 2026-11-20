// Procedural cinematography solver.
// World space: metres, camera at the origin looking down +Y, +X to camera-right.
// Angles are radians in the XY plane (atan2 convention).

import { TIMES, ENVS, TONES, SENSORS, NEON } from './tables.js';
import { solveMove, fixtureName } from './move.js';
import { solveSound } from './sound.js';
import { renderKelvin, shiftKelvin, nearestGel, mired, describeShift } from './color.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V = (x, y) => ({ x, y });
const add = (a, b) => V(a.x + b.x, a.y + b.y);
const sub = (a, b) => V(a.x - b.x, a.y - b.y);
const mul = (a, s) => V(a.x * s, a.y * s);
const len = (a) => Math.hypot(a.x, a.y);
const ang = (a) => Math.atan2(a.y, a.x);
const dir = (a) => V(Math.cos(a), Math.sin(a));
const polar = (p, a, d) => V(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const fmt = (n, d = 1) => (Number.isFinite(n) ? Number(n.toFixed(d)).toString() : '∞');

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ray from p at angle a against an axis-aligned rectangle (inside), returns hit + wall axis.
function rayRect(p, a, r) {
  const d = dir(a);
  let best = { t: Infinity };
  const test = (t, axis, val) => {
    if (t > 1e-6 && t < best.t) {
      const h = add(p, mul(d, t));
      const ok = axis === 'x' ? h.y >= r.y0 - 1e-6 && h.y <= r.y1 + 1e-6 : h.x >= r.x0 - 1e-6 && h.x <= r.x1 + 1e-6;
      if (ok) best = { t, hit: h, axis, val };
    }
  };
  if (d.x) { test((r.x0 - p.x) / d.x, 'x', r.x0); test((r.x1 - p.x) / d.x, 'x', r.x1); }
  if (d.y) { test((r.y0 - p.y) / d.y, 'y', r.y0); test((r.y1 - p.y) / d.y, 'y', r.y1); }
  return best;
}

// --- Optics -----------------------------------------------------------------

export const COC = 0.025; // mm, Super 35 circle of confusion

export function depthOfField(fmm, N, sM) {
  const s = sM * 1000;
  const H = (fmm * fmm) / (N * COC) + fmm;
  const near = (s * (H - fmm)) / (H + s - 2 * fmm);
  const far = s < H ? (s * (H - fmm)) / (H - s) : Infinity;
  return { near: near / 1000, far: far / 1000, hyper: H / 1000, total: (far - near) / 1000 };
}

/** Blur-disc diameter on the sensor (mm) for an object at xM when focused at sM. */
export function blurDisc(fmm, N, sM, xM) {
  const s = sM * 1000, x = xM * 1000;
  if (!Number.isFinite(x)) return (fmm * fmm) / (N * (s - fmm));
  return ((fmm * fmm) / (N * (s - fmm))) * (Math.abs(x - s) / x);
}

/** Pinhole projection of a world point (x, y, height h) to normalised frame coords (0..1, y down). */
export function project(cam, pt, h) {
  // yaw: rotation of the lens axis from +Y toward +X (0 = looking straight down the set)
  const yaw = cam.yaw || 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const wx = pt.x - cam.pos.x, wz = pt.y - cam.pos.y, dy = h - cam.height;
  const dx = wx * cy - wz * sy, dz = wx * sy + wz * cy;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const zc = dz * cp + dy * sp;
  const yc = dy * cp - dz * sp;
  if (zc <= 0.05) return null;
  const u = (cam.f * dx) / zc / cam.sensor.w;
  const v = (cam.f * yc) / zc / cam.sensor.h;
  return { x: 0.5 + u, y: 0.5 - v, z: zc };
}

// --- Main solve -------------------------------------------------------------

export function compute(inp) {
  const rng = mulberry32(inp.seed * 7919 + 17);
  const J = (r) => (rng() * 2 - 1) * r;
  const T = TIMES[inp.time], E = ENVS[inp.env], M = TONES[inp.tone], S = SENSORS[inp.aspect];
  const f = inp.focal, N = inp.aperture, blocking = inp.blocking;
  const wb = T.wb;
  const notes = [];

  const fovH = 2 * Math.atan(S.w / (2 * f));
  const fovV = 2 * Math.atan(S.h / (2 * f));
  const tanH = Math.tan(fovH / 2);

  // Subject distance is solved from shot size (vertical coverage at the subject plane).
  const shotScale = blocking === 'two' ? 1.35 : blocking === 'crowd' ? 1.9 : 1;
  const shotH = M.shotH * shotScale * (1 + J(0.08));
  let D = (shotH * f) / S.h;
  let sep = 0;
  if (blocking === 'two') {
    sep = M.sep * (1 + J(0.12));
    const need = sep * 1.8 + 0.6;
    if ((D * S.w) / f < need) D = (need * f) / S.w;
  }
  D = clamp(D, 0.6, 45);
  const frameW = (D * S.w) / f;

  // --- Blocking --------------------------------------------------------------
  const cam = { x: 0, y: 0 };
  const subjects = [];
  let P, ls, lam = 0;
  if (blocking === 'two') {
    lam = (M.stagger + J(6)) * DEG * (rng() < 0.5 ? 1 : -1);
    const C = V(J(0.05) * frameW, D);
    const u = dir(lam);
    const A = sub(C, mul(u, sep / 2));
    const B = add(C, mul(u, sep / 2));
    const aFace = ang(sub(B, A)) + J(5) * DEG;
    let bFace = ang(sub(A, B)) + J(5) * DEG;
    if (M.turnAway) bFace -= (50 + J(15)) * DEG; // B half-turns away from A, upstage
    subjects.push({ ...A, facing: aFace, label: 'A', primary: true, look: B });
    subjects.push({ ...B, facing: bFace, label: 'B', primary: false, look: M.turnAway ? null : A });
    P = A; ls = 1;
  } else {
    const side = rng() < 0.5 ? -1 : 1;
    const sx = side * ((D * (S.w / 6)) / f) * M.xThird * (1 + J(0.1));
    P = V(sx, D);
    ls = -side; // look toward frame centre (lead room)
    const cd = ang(sub(cam, P));
    subjects.push({ ...P, facing: cd + ls * (M.faceDeg + J(8)) * DEG, label: blocking === 'crowd' ? 'HERO' : 'A', primary: true, look: null });
  }
  const camDir = ang(sub(cam, P)); // subject → lens
  const bgY = Math.max(...subjects.map((s) => s.y)) + E.bg * (1 + J(0.1));

  if (blocking === 'crowd') {
    const n = 7 + Math.floor(rng() * 5);
    const depthSpan = Math.min(E.bg, 14) * 0.85;
    const common = (rng() < 0.5 ? 0 : 180) * DEG;
    let tries = 0;
    while (subjects.length < n + 1 && tries++ < 200) {
      const y = D + 1.0 + rng() * depthSpan;
      const x = (rng() * 2 - 1) * y * tanH * 1.05;
      const p = V(x, y);
      if (subjects.some((s) => len(sub(s, p)) < 0.75)) continue;
      if (E.exterior === false && E.ground === 'floor' && y > bgY - 0.4) continue;
      const toHero = ang(sub(P, p));
      let facing;
      switch (M.crowd) {
        case 'watching': facing = rng() < 0.45 ? toHero + J(6) * DEG : J(180) * DEG; break;
        case 'toward': facing = toHero + J(20) * DEG; break;
        case 'away': facing = 90 * DEG + J(45) * DEG; break;
        case 'same-way': facing = common + J(12) * DEG; break;
        default: facing = J(180) * DEG;
      }
      const watching = Math.abs(wrap(facing - toHero)) < 12 * DEG;
      subjects.push({ ...p, facing, label: '', primary: false, extra: true, watching });
    }
  }

  // --- Set geometry ----------------------------------------------------------
  const set = { kind: inp.env, ground: E.ground, bgY, walls: [], windows: [], features: [] };
  let room = null;
  if (inp.env === 'interior') {
    const rw = Math.max(2.4 + D * 0.12 + J(0.3), bgY * tanH * 0.85);
    room = { x0: -rw, x1: rw, y0: -1.6, y1: bgY };
    set.walls.push([room.x0, room.y0, room.x1, room.y0], [room.x1, room.y0, room.x1, room.y1], [room.x1, room.y1, room.x0, room.y1], [room.x0, room.y1, room.x0, room.y0]);
  } else if (inp.env === 'alley') {
    const hw = 1.55 + J(0.2);
    room = { x0: -hw, x1: hw, y0: -4, y1: bgY + 8 };
    set.walls.push([-hw, -4, -hw, bgY + 8], [hw, -4, hw, bgY + 8]);
  } else if (inp.env === 'studio') {
    set.features.push({ type: 'cyc', y: bgY, w: Math.max(4, bgY * tanH * 1.3) });
  } else if (inp.env === 'neon') {
    set.features.push({ type: 'facade', y: bgY }, { type: 'curb', y: bgY - 2.6 });
  } else {
    set.features.push({ type: 'treeline', y: bgY });
  }

  const inFrame = (p, m = 0.35) => p.y > 0.3 && Math.abs(p.x) < p.y * tanH + m && p.y < bgY + 0.5;
  const tone = (k) => shiftKelvin(k, M.mired);
  const lights = [];

  const placeFixture = (az, dist, elev, label) => {
    let p = polar(P, az, dist);
    let cheat = null;
    if (room && inp.env === 'alley' && Math.abs(p.x) > room.x1 - 0.15) {
      p = V(Math.sign(p.x) * (room.x1 - 0.15), p.y);
      cheat = `${label} rigged off the alley wall`;
    }
    if (room && inp.env === 'interior') {
      p = V(clamp(p.x, room.x0 + 0.3, room.x1 - 0.3), clamp(p.y, room.y0 + 0.3, room.y1 - 0.3));
    }
    if (inFrame(p)) {
      if (elev >= 50) cheat = `${label} flown overhead, above frame line`;
      else {
        const sx = Math.sign(p.x - 0) || ls;
        p = V(sx * (p.y * tanH + 0.55), p.y);
        if (room) p.x = clamp(p.x, room.x0 + 0.25, room.x1 - 0.25);
        cheat = `${label} cheated wide to clear the ${fmt((fovH / DEG), 0)}° frustum`;
      }
    }
    if (cheat) notes.push(cheat);
    return p;
  };

  // --- Key solve -------------------------------------------------------------
  let keyAz = camDir + ls * (M.keyDeg + J(10)) * DEG;
  let keyElev = M.keyElev + J(4);
  const neonPick = rng() < 0.5;
  const neonKey = neonPick ? NEON.a : NEON.b;
  const neonRim = neonPick ? NEON.b : NEON.a;
  let key = { role: 'key', id: 'key' };
  let sun = null, rimSpec = null;

  const studioMod = () => (M.soft > 0.75 ? 'book' : M.soft > 0.45 ? 'softbox' : 'fresnel');
  const MOD = {
    book: { size: 2.4, dist: 2.1, beam: 110, name: 'Book Light (bounce → diffusion)' },
    softbox: { size: 1.2, dist: 1.6, beam: 90, name: 'Softbox w/ grid' },
    fresnel: { size: 0.22, dist: 3.6, beam: 22 + M.soft * 30, name: 'Fresnel' },
  };
  const artificial = (mod, k, motivation, extra = {}) => {
    const m = MOD[mod];
    const dist = (extra.dist ?? m.dist) * (1 + J(0.12)) * (blocking === 'crowd' ? 1.3 : 1);
    Object.assign(key, {
      modifier: mod, name: extra.name ?? m.name, size: extra.size ?? m.size, beam: extra.beam ?? m.beam,
      kelvin: k, motivation, natural: false,
      pos: null, dist, ...extra,
    });
  };

  if (inp.env === 'interior') {
    if (T.daylight) {
      const hit = rayRect(P, keyAz, room);
      const wpos = hit.hit;
      const wlen = 1.3 + rng() * 0.5;
      set.windows.push({ center: wpos, axis: hit.axis, len: wlen, lit: true });
      const direct = inp.time === 'golden';
      Object.assign(key, {
        modifier: 'window', natural: true, pos: wpos, dist: len(sub(wpos, P)),
        size: direct ? 0.02 * len(sub(wpos, P)) : wlen,
        kelvin: inp.time === 'golden' ? T.sunK : inp.time === 'noon' ? 6200 : T.skyK,
        beam: direct ? 18 : 120,
        name: direct ? 'Natural Window · direct sun shaft' : 'Natural Window · skylight',
        motivation: direct ? 'low sun through the glass' : `${T.label.toLowerCase()} skylight`,
        outside: direct ? '18K HMI + ½ CTO through window' : '4× SkyPanel S360 through 12×12 diffusion outside',
      });
      if (direct) keyElev = 12 + J(3);
      else keyElev = 22 + J(4);
    } else {
      artificial(M.soft > 0.5 ? 'softbox' : 'fresnel', tone(2900), 'table-lamp practical', {
        name: M.soft > 0.5 ? 'China-ball / Softbox (practical-motivated)' : 'Fresnel (practical-motivated)',
      });
    }
  } else if (inp.env === 'studio') {
    const look = { golden: 3200, noon: 5600, overcast: 6500, blue: 9000, midnight: 5600 }[inp.time];
    artificial(studioMod(), tone(look), `simulated ${T.label.toLowerCase()}`);
  } else {
    // exterior
    if (inp.time === 'golden') {
      const sunAz = inp.env === 'alley' ? 90 * DEG + J(8) * DEG : camDir - ls * (155 + J(12)) * DEG;
      sun = { az: sunAz, elev: T.sunElev + J(2), kelvin: T.sunK, rim: true };
      keyElev = 14 + J(4);
      artificial('book', 3700, 'sun bounced off the ground plane', {
        name: 'Book Light · Ultrabounce catching sun', natural: false,
      });
    } else if (inp.time === 'noon') {
      sun = { az: keyAz, elev: T.sunElev + J(3), kelvin: T.sunK, rim: false };
      if (M.soft >= 0.5) {
        Object.assign(key, {
          modifier: 'silk', name: '12×12 Silk overhead (sun diffused)', natural: true,
          size: 3.6, dist: 1.6, beam: 140, kelvin: 5600, motivation: 'sun through silk', pos: V(P.x, P.y),
        });
        keyElev = 62 + J(4);
        sun.silked = true;
      } else {
        Object.assign(key, {
          modifier: 'sun', name: 'Raw Sun (hard top light)', natural: true,
          size: 0.0093, dist: 1, beam: 0, kelvin: T.sunK, motivation: 'the sun itself',
        });
        keyElev = sun.elev;
        keyAz = sun.az;
      }
    } else if (inp.time === 'overcast') {
      artificial('book', T.skyK, 'overcast sky, shaped', { name: 'Book Light · 8×8 bounce (sky-matched)' });
    } else if (inp.env === 'neon') {
      artificial('softbox', null, 'neon signage', { name: 'LED Tube / Softbox gelled to neon', gel: neonKey });
    } else if (inp.env === 'alley') {
      artificial('fresnel', 2100, 'sodium wall lamp', { name: 'Fresnel · sodium-matched', dist: 3.2 });
      keyElev = 50 + J(5);
    } else if (inp.time === 'midnight') {
      artificial('fresnel', 5600, 'moonlight', { name: 'HMI 4K on condor (moon)', dist: 14, size: 0.3 });
      keyElev = 34 + J(4);
    } else {
      artificial('book', M.soft > 0.6 && M.mired > 0 ? tone(3000) : T.skyK,
        M.mired > 0 ? 'lantern / car-lamp glow' : 'residual skylight', { name: 'Book Light · residual skylight' });
    }
  }

  if (!key.pos) {
    key.pos = key.modifier === 'sun' ? polar(P, keyAz, 6) : placeFixture(keyAz, key.dist, keyElev, 'Key');
    if (key.modifier !== 'sun') {
      key.dist = len(sub(key.pos, P));
      keyAz = ang(sub(key.pos, P));
    }
  } else if (key.modifier === 'window') {
    keyAz = ang(sub(key.pos, P));
  }
  key.az = keyAz;
  key.elev = keyElev;
  key.kelvin = key.kelvin ? Math.round(key.kelvin / 50) * 50 : null;
  key.color = key.gel ?? renderKelvin(key.kelvin, wb);
  key.height = key.modifier === 'sun' ? Infinity : 1.65 + Math.tan(keyElev * DEG) * key.dist;
  key.angSize = key.modifier === 'sun' ? 0.0093 : key.size / Math.max(key.dist, 0.3);
  key.aim = P;
  key.stops = 0;
  key.label = `KEY · ${key.modifier === 'window' ? 'Window' : key.name.split(' (')[0].split(' ·')[0]}`;
  lights.push(key);
  const softness = clamp(key.angSize / 1.0, 0, 1);
  const keyOffDeg = Math.abs(wrap(keyAz - camDir)) / DEG;
  const faceOffDeg = Math.abs(wrap(subjects[0].facing - camDir)) / DEG;
  const shortSide = Math.sign(wrap(keyAz - camDir)) === Math.sign(wrap(subjects[0].facing - camDir));

  // second key for dialogue (cross-key)
  if (blocking === 'two' && !['window', 'sun', 'silk'].includes(key.modifier)) {
    const B = subjects[1];
    const cdB = ang(sub(cam, B));
    const azB = cdB - (M.keyDeg + J(10)) * DEG;
    const pos = placeFixture(azB, key.dist, keyElev, 'Cross-key');
    lights.push({
      ...key, id: 'key2', role: 'key2', pos, az: ang(sub(pos, B)), aim: B,
      dist: len(sub(pos, B)), label: 'KEY B · Cross', stops: J(0.2) - 0.2,
    });
  }

  // --- Contrast solve: natural ratio vs. tonal target → fill strategy --------
  const ambientFrac = E.exterior
    ? { golden: 0.22, noon: 0.15, overcast: 0.45, blue: 0.12, midnight: 0.01 }[inp.time]
    : inp.env === 'interior' ? (T.daylight ? 0.09 : 0.02) : 0;
  const phi = clamp(E.bounce * (0.45 + 0.55 * softness) + ambientFrac, 0.012, 0.9);
  const naturalStops = Math.log2(1 + 1 / phi);
  const targetStops = clamp(M.stops + (0.5 - softness) * 0.6 + J(0.2), 0.6, 4.6);
  const delta = targetStops - naturalStops;
  const ratio = Math.pow(2, targetStops);

  const fillSide = camDir - ls * (38 + J(8)) * DEG;
  const fillPlan = { natural: Math.pow(2, naturalStops), delta };
  const wantNeg = delta > 0.25 || inp.tone === 'melancholy' || inp.tone === 'tense';
  if (wantNeg) {
    const az = camDir - ls * (82 + J(12)) * DEG;
    const pos = placeFixture(az, 0.85 + J(0.1) + (blocking === 'crowd' ? 0.4 : 0), 0, 'Neg fill');
    lights.push({
      id: 'neg', role: 'neg', modifier: 'flag', name: '4×4 Floppy · Duvetyne (negative fill)',
      pos, az, aim: P, dist: len(sub(pos, P)), label: 'NEG FILL', kelvin: null, color: '#0b0b0d', stops: null, size: 1.2,
    });
    fillPlan.neg = Math.max(delta, 0.3);
  }
  if (delta < -0.25) {
    const active = delta < -1;
    const kF = key.kelvin ? key.kelvin : 5600;
    const pos = placeFixture(fillSide, active ? 1.9 : 1.3, 18, 'Fill');
    lights.push({
      id: 'fill', role: 'fill', modifier: active ? 'softbox' : 'bounce',
      name: active ? 'LED 4×4 + ½ grid (active fill)' : 'Beadboard / muslin bounce (passive fill)',
      pos, az: ang(sub(pos, P)), aim: P, dist: len(sub(pos, P)), label: active ? 'FILL · LED' : 'FILL · Bounce',
      kelvin: key.gel ? null : Math.round(kF / 50) * 50, gel: key.gel, color: key.gel ?? renderKelvin(kF, wb),
      stops: -targetStops, size: active ? 1.2 : 1.0, beam: 100,
    });
    fillPlan.add = -delta;
    fillPlan.active = active;
  }

  // --- Rim / separation -----------------------------------------------------
  let rimAz = camDir - ls * (150 + J(12)) * DEG;
  if (sun && sun.rim) {
    rimSpec = { source: 'sun' };
  } else if (inp.env === 'interior' && !T.daylight) {
    const hit = rayRect(P, rimAz, room);
    set.windows.push({ center: hit.hit, axis: hit.axis, len: 1.3, lit: true });
    const k = inp.time === 'midnight' ? 5600 : T.skyK;
    lights.push({
      id: 'rim', role: 'rim', modifier: 'window', name: inp.time === 'midnight' ? 'Window · moonlight edge (HMI outside)' : 'Window · blue-hour sky edge',
      pos: hit.hit, az: ang(sub(hit.hit, P)), aim: P, dist: len(sub(hit.hit, P)), label: 'RIM · Window',
      kelvin: k, color: renderKelvin(k, wb), stops: M.rimStops - 0.5 + J(0.2), size: 1.3, beam: 70, natural: true,
    });
  } else if (blocking === 'two') {
    const C = mul(add(subjects[0], subjects[1]), 0.5);
    const pos = V(C.x + J(0.4), Math.max(subjects[0].y, subjects[1].y) + 2.2);
    const k = inp.env === 'neon' && !T.daylight ? null : tone(M.rimK);
    lights.push({
      id: 'rim', role: 'rim', modifier: 'fresnel', name: 'Overhead backlight (shared)', pos, az: ang(sub(pos, C)), aim: C,
      dist: len(sub(pos, C)), label: 'BACKLIGHT', kelvin: k && Math.round(k / 50) * 50, gel: k ? null : neonRim,
      color: k ? renderKelvin(k, wb) : neonRim, stops: M.rimStops + J(0.2), size: 0.25, beam: 50,
    });
    notes.push('Backlight flown overhead, above frame line');
  } else {
    let k = tone(M.rimK), gel = null, name = 'Fresnel · rim / hair', mot = null;
    if (inp.env === 'neon' && !T.daylight) { k = null; gel = neonRim; name = 'Neon spill (practical as rim)'; }
    if (inp.env === 'alley' && !T.daylight) { k = 2100; name = 'Fresnel · far streetlamp edge'; mot = 'sodium lamp'; }
    if (inp.env === 'interior' && T.daylight) { k = 3200; name = 'Fresnel · kicker (practical-motivated)'; }
    const pos = placeFixture(rimAz, 2.7 + J(0.3), 48, 'Rim');
    lights.push({
      id: 'rim', role: 'rim', modifier: 'fresnel', name, pos, az: ang(sub(pos, P)), aim: P, dist: len(sub(pos, P)),
      label: inp.env === 'interior' && T.daylight ? 'KICKER' : 'RIM', kelvin: k && Math.round(k / 50) * 50, gel,
      color: gel ?? renderKelvin(k, wb), stops: M.rimStops + J(0.2), size: 0.22, beam: 26, motivation: mot,
    });
  }

  if (sun && key.modifier !== 'sun') {
    const pos = polar(P, sun.az, Math.max(5.5, D * 0.35));
    lights.push({
      id: 'sun', role: sun.rim ? 'rim' : 'sun', modifier: 'sun', name: sun.rim ? 'Sun · backlight' : sun.silked ? 'Sun (silked)' : 'Sun',
      pos, az: sun.az, elev: sun.elev, aim: P, dist: 150e9, label: sun.rim ? 'RIM · SUN' : 'SUN',
      kelvin: sun.kelvin, color: renderKelvin(sun.kelvin, wb), stops: sun.rim ? 1.3 + J(0.2) : 0, size: 0.0093, angSize: 0.0093,
    });
  }

  // --- Practicals -----------------------------------------------------------
  const keySideX = Math.sign(key.pos.x - P.x) || ls;
  const fx = (y, side, k) => side * Math.min(y * tanH * k, room ? room.x1 - 0.4 : Infinity);
  if (inp.env === 'interior') {
    const y = bgY - 0.45;
    const k = T.daylight ? 2700 : 2700;
    lights.push(practical('lamp', V(fx(y, keySideX, 0.62), y), 'Table lamp', k, wb, T.daylight ? -2 : 0));
    if (!T.daylight) lights.push(practical('lamp', V(fx(y, -keySideX, 0.75), y), 'Floor lamp (dim)', 2400, wb, -1.5));
  } else if (inp.env === 'alley') {
    const lit = !T.daylight;
    [3, 8.5, 14].forEach((dy, i) => {
      const y = D + dy;
      if (y > bgY + 6) return;
      lights.push(practical('streetlamp', V((i % 2 ? 1 : -1) * keySideX * (room.x1 - 0.1), y), 'Sodium wall lamp', 2100, wb, lit ? -0.5 : null));
    });
  } else if (inp.env === 'neon') {
    const n = 2 + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : -0.75 + (1.5 * i) / (n - 1);
      const g = i % 2 ? neonRim : neonKey;
      lights.push({ ...practical('neon', V(t * bgY * tanH + J(0.4), bgY - 0.1), 'Neon sign', null, wb, T.daylight ? -2.5 : 0), gel: g, color: g });
    }
  } else if (inp.env === 'field' && T.night) {
    const y = D + Math.min(E.bg * 0.45, 18);
    lights.push(practical('streetlamp', V(fx(y, keySideX, 0.5), y), 'Distant road lamp', 2100, wb, -2));
  } else if (inp.env === 'studio' && ['melancholy', 'lonely', 'tense'].includes(inp.tone)) {
    const pos = V(-keySideX * (bgY * tanH + 1.2), bgY - 1.2);
    const k = Math.round(tone(M.rimK) / 50) * 50;
    lights.push({
      id: 'bg', role: 'bg', modifier: 'fresnel', name: 'Fresnel + cookie · cyc slash', pos, aim: V(keySideX * 0.6, bgY),
      az: 0, dist: 3, label: 'BG SLASH', kelvin: k, color: renderKelvin(k, wb), stops: -1.5, size: 0.22, beam: 18,
    });
  }

  // --- Camera & optics -------------------------------------------------------
  const camH = M.camH + J(0.06);
  const eyeH = 1.6;
  const vTarget = (M.eyeFrac + J(0.02)) * S.h;
  const pitch = Math.atan2(eyeH - camH, P.y) - Math.atan(vTarget / f);
  const dutch = M.dutch ? (M.dutch + J(2)) * (rng() < 0.5 ? 1 : -1) : 0;
  const camera = { pos: V(0, 0), height: camH, pitch, yaw: 0, dutch, f, N, sensor: S, fovH, fovV, focus: P.y, vTarget, eyeH };

  // --- Clear the hero frame ------------------------------------------------
  // Every fixture is projected through the solved lens (height, tilt, FOV). Anything whose
  // head — or stand, unless rigged overhead — lands in frame is raised (overhead rigs) or
  // cheated wider (stands) until it clears. Shadows are cast after this, from final positions.
  lights.forEach((l) => {
    if (['practical'].includes(l.role) || ['sun', 'window'].includes(l.modifier)) return;
    const silk = l.modifier === 'silk';
    let h = silk ? 3.4 : fixtureHeight(l);
    const flown = silk || h > 3.2;
    const pts = () => (silk ? [[-1.8, -1.8], [1.8, -1.8], [1.8, 1.8], [-1.8, 1.8]].map(([a, b]) => V(l.pos.x + a, l.pos.y + b)) : [l.pos]);
    const inShot = () => pts().some((p) => (flown ? [h] : [0.05, h * 0.5, h]).some((hh) => {
      const q = project(camera, p, hh);
      return q && q.x > -0.03 && q.x < 1.03 && q.y > -0.03 && q.y < 1.03;
    }));
    if (!inShot()) { l.headH = h; return; }
    const h0 = h, p0 = { ...l.pos };
    const out = Math.sign(l.pos.x) || ls;
    for (let i = 0; i < 60 && inShot(); i++) {
      if (flown && h < 7) h += 0.15;
      else {
        l.pos = V(l.pos.x + out * 0.15, l.pos.y);
        if (room && Math.abs(l.pos.x) > room.x1 - 0.2) { l.pos = V(out * (room.x1 - 0.2), l.pos.y); if (h < 7) h += 0.15; }
      }
    }
    l.headH = h;
    if (Number.isFinite(l.height)) l.height = h;
    const aim = l.aim ?? P;
    l.dist = len(sub(l.pos, aim));
    if (l.modifier !== 'silk') l.az = ang(sub(l.pos, aim));
    if (l.angSize != null && l.modifier !== 'sun') l.angSize = l.size / Math.max(l.dist, 0.3);
    const name = fixtureName(l);
    if (inShot()) notes.push(`${name} cannot fully clear the frame — flag it off or pick it up in a separate setup`);
    else if (h > h0 + 0.05 && len(sub(l.pos, p0)) < 0.05) notes.push(`${name} raised to ${fmt(h, 1)} m to clear the top of frame`);
    else notes.push(`${name} cheated ${fmt(len(sub(l.pos, p0)), 1)} m wider${h > h0 + 0.05 ? ` and raised to ${fmt(h, 1)} m` : ''} to clear frame`);
  });

  // --- Shadows ---------------------------------------------------------------
  const shadowOpacity = clamp(0.12 + 0.11 * targetStops, 0.15, 0.62) * (1 - softness * 0.55);
  const shadows = [];
  const castFrom = (L, subj, strength = 1) => {
    if (L.role === 'neg' || L.modifier === 'silk') return;
    const elev = L.modifier === 'sun' ? (L.elev ?? keyElev) : Math.atan2(Math.max(L.height ?? 1.65 + Math.tan((L.elev ?? keyElev) * DEG) * L.dist, 1.75) - 1.65, L.dist) / DEG;
    const e = clamp(elev, 4, 88);
    const lengthM = clamp(1.7 / Math.tan(e * DEG), 0.15, 9);
    const d = L.modifier === 'sun' ? L.az + Math.PI : ang(sub(subj, L.pos));
    const angSize = L.angSize ?? L.size / Math.max(L.dist, 0.3);
    shadows.push({
      from: V(subj.x, subj.y), dir: d, length: lengthM, penumbra: lengthM * angSize,
      opacity: shadowOpacity * strength, elev: e, light: L.id,
    });
  };
  subjects.forEach((s) => {
    const keyFor = blocking === 'two' && !s.primary ? lights.find((l) => l.id === 'key2') ?? key : key;
    if (key.modifier !== 'silk') castFrom(keyFor, s, s.extra ? 0.6 : 1);
    const sunL = lights.find((l) => l.id === 'sun');
    if (sunL && sunL !== key && !sun.silked) castFrom(sunL, s, 0.9);
    else if (sunL && sun.silked) castFrom({ ...sunL, angSize: 0.0093 }, s, 0.35);
  });
  if (key.modifier === 'silk') subjects.forEach((s) => shadows.push({ from: V(s.x, s.y), dir: keyAz + Math.PI, length: 0.35, penumbra: 0.4, opacity: 0.22, elev: 78, light: 'key' }));

  const dof = depthOfField(f, N, P.y);
  const bgBlur = blurDisc(f, N, P.y, bgY);
  const bgBlurPct = (bgBlur / S.h) * 100;
  const fgBlurPct = (blurDisc(f, N, P.y, Math.max(0.3, P.y * 0.5)) / S.h) * 100;
  const ffEq = 36 / (2 * tanH);
  const bgScale = P.y / bgY;
  const noseMag = P.y < 2 ? (P.y / (P.y - 0.1) - 1) * 100 : 0;

  // --- Composition (measured through the projected lens) --------------------
  const { negSpace, headroom, pCenterX, pHeight, pBox } = measureFrame(camera, subjects);
  const tiltDeg = pitch / DEG;

  // --- Exposure --------------------------------------------------------------
  const keyLux = 15 * N * N; // incident lux for correct exposure at ISO 800, 1/48s (C = 250)
  let available = null;
  if (key.modifier === 'sun') available = T.sunLux;
  else if (key.modifier === 'silk') available = T.sunLux * 0.25;
  else if (key.modifier === 'window') available = inp.time === 'golden' ? T.sunLux * 0.85 : T.skyLux * 0.25;
  else if (E.exterior && inp.time === 'golden') available = T.sunLux * 0.35;
  else if (E.exterior && inp.time === 'overcast') available = T.skyLux * 0.6;
  let ndStops = 0, ndText = null, unitText = null;
  if (available) {
    ndStops = Math.log2(available / keyLux);
    if (ndStops > 0.3) {
      const s = Math.round(ndStops);
      ndText = `ND ${(s * 0.3).toFixed(1)} (${s} stops) to hold f/${N}`;
    } else if (ndStops < -0.3) {
      ndText = `${fmt(-ndStops)} stops short — supplement or open up`;
    } else ndText = 'No ND needed';
  }
  if (!key.natural) {
    const lossF = { book: 4, softbox: 2.2, fresnel: 1 }[key.modifier] ?? 1.5;
    const need = keyLux * key.dist * key.dist * lossF;
    unitText = need < 2500 ? '1×1 LED panel class' : need < 12000 ? 'SkyPanel S60 / 1K Fresnel class'
      : need < 60000 ? 'SkyPanel S360 / 2K–5K class' : need < 250000 ? '4K–9K HMI class' : '12K–18K HMI class';
    unitText += ` (~${fmt(need / 1000, 1)} klux·m² at source)`;
  }

  // --- Readouts ----------------------------------------------------------------
  const rim = lights.find((l) => l.role === 'rim');
  const fill = lights.find((l) => l.role === 'fill');
  const neg = lights.find((l) => l.role === 'neg');
  const practicals = lights.filter((l) => l.role === 'practical');
  const kStr = (l) => (l ? (l.gel ? `gel ${l.gel}` : `${l.kelvin}K`) : '—');
  const readout = {
    ratio, ratioStr: `${ratio >= 9.5 ? Math.round(ratio) : fmt(ratio)}:1`, stops: targetStops,
    naturalRatio: fillPlan.natural, fillPlan,
    wb,
    key: { k: kStr(key), soft: softness, ang: key.angSize / DEG, kind: key.name, elev: keyElev, off: keyOffDeg, shortSide },
    fill: fill ? kStr(fill) : neg ? 'Negative' : 'Ambient bounce',
    rim: rim ? kStr(rim) : '—',
    practicals: practicals.filter((p) => p.lit !== false).map(kStr),
    gelPush: nearestGel(M.mired),
    fovH: fovH / DEG, fovV: fovV / DEG, ffEq, D: P.y, dof, bgBlurPct, fgBlurPct, bgScale, noseMag,
    negSpace, headroom, pCenterX, pHeight, tiltDeg, camH, dutch,
    keyLux, fillLux: keyLux / ratio, rimLux: rim && rim.stops != null ? keyLux * Math.pow(2, rim.stops) : null,
    ndText, unitText, sep, proxemics: blocking === 'two' ? proxemic(sep) : null,
    shadow: shadows.find((x) => x.light === 'key') ?? shadows[0], sensor: S,
  };

  const ctx = { inp, T, E, M, S, key, rim, fill, neg, practicals, sun, subjects, readout, softness, notes, blocking, wb, keyOffDeg, faceOffDeg, shortSide, lam };
  const theory = synthesize(ctx);

  const scene = { camera, subjects, lights, set, shadows, dof, readout, theory, notes, P, ls, lineOfAction: blocking === 'two' ? { a: subjects[0], b: subjects[1] } : null, bgY, inp };
  scene.sound = solveSound(scene, inp);
  theory.push(scene.sound.theory);
  scene.move = solveMove(scene, inp);
  if (scene.move.theory) theory.push(scene.move.theory);
  return scene;
}

/** Head height (m) of a fixture, from its role or its solved elevation. */
export function fixtureHeight(l) {
  if (Number.isFinite(l.headH)) return l.headH;
  if (l.role === 'neg') return 2.1;
  if (l.role === 'fill') return l.modifier === 'bounce' ? 1.4 : 1.8;
  if (l.role === 'bg') return 2.6;
  if (Number.isFinite(l.height)) return l.height;
  return clamp(1.65 + Math.tan(48 * DEG) * Math.max(l.dist ?? 2, 0.5), 2, 6);
}

function practical(kind, pos, name, k, wb, stops) {
  return {
    id: 'prac-' + Math.round(pos.x * 100) + '-' + Math.round(pos.y * 100), role: 'practical', modifier: kind, name, pos, aim: pos,
    kelvin: k, color: k ? renderKelvin(k, wb) : '#fff', stops, lit: stops !== null, label: 'PRAC', size: 0.3, dist: 0,
  };
}

/** Measure framing through a camera pose: negative space, headroom, subject position/height. */
export function measureFrame(camera, subjects) {
  const boxes = subjects.map((s) => {
    const pts = [];
    const side = dir(s.facing + Math.PI / 2);
    [[0.24, 1.48], [-0.24, 1.48], [0.18, 0], [-0.18, 0]].forEach(([o, h]) => {
      const p = project(camera, add(s, mul(side, o)), h);
      if (p) pts.push(p);
    });
    const top = project(camera, s, 1.8);
    if (top) pts.push(top);
    if (!pts.length) return null;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), primary: s.primary, extra: s.extra };
  });
  const clip01 = (b) => b && { x0: clamp(b.x0, 0, 1), x1: clamp(b.x1, 0, 1), y0: clamp(b.y0, 0, 1), y1: clamp(b.y1, 0, 1) };
  const occ = rasterCoverage(boxes.filter((b) => b && !b.extra).map(clip01));
  const pBox = boxes[0];
  return {
    negSpace: (1 - occ) * 100,
    headroom: pBox ? pBox.y0 * 100 : 0,
    pCenterX: pBox ? ((pBox.x0 + pBox.x1) / 2) * 100 : 50,
    pHeight: pBox ? clamp(pBox.y1, 0, 1) - clamp(pBox.y0, 0, 1) : 0,
    pBox,
  };
}

function rasterCoverage(boxes, n = 60) {
  let hit = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = (i + 0.5) / n, y = (j + 0.5) / n;
    if (boxes.some((b) => b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)) hit++;
  }
  return hit / (n * n);
}

function proxemic(d) {
  if (d < 0.46) return { zone: 'intimate', range: '< 0.45 m' };
  if (d < 1.22) return { zone: 'personal', range: '0.45–1.2 m' };
  if (d < 3.7) return { zone: 'social', range: '1.2–3.7 m' };
  return { zone: 'public', range: '> 3.7 m' };
}

// --- "Why this works" synthesis ------------------------------------------------
// Each sentence is selected by computed conditions (angles, ratios, mired deltas,
// coverage) and filled with the solved numbers — not looked up by preset name.

function synthesize(c) {
  const { inp, T, E, M, key, rim, practicals, sun, readout: r, softness, blocking, wb, keyOffDeg, faceOffDeg, shortSide } = c;
  const out = [];
  const toneWord = M.label.split(' / ')[0].toLowerCase();

  // 1 · Source & quality
  const q = softness > 0.6 ? 'broad, wrapping' : softness > 0.25 ? 'directional but forgiving' : softness > 0.05 ? 'crisp' : 'razor-hard';
  let s1 = `${T.label} ${E.exterior ? 'outdoors' : inp.env === 'studio' ? 'in a black void' : 'inside the room'} resolves to a ${key.name.replace(/^(\w)(\w)/, (m, a, b) => (b === b.toUpperCase() ? m : a.toLowerCase() + b))} `
    + `${key.modifier === 'sun' ? '' : `${fmt(key.dist)} m from the subject, `}${fmt(keyOffDeg, 0)}° off the lens axis and ${fmt(r.key.elev, 0)}° high. `
    + `It subtends ${fmt(r.key.ang, 1)}° from the face, so the light is ${q}: a ${fmt(r.shadow?.length ?? 0)} m floor shadow with a ${fmt((r.shadow?.penumbra ?? 0) * 100, 0)} cm penumbra.`;
  if (key.modifier === 'sun' && r.key.elev > 55) {
    s1 += ` At ${fmt(r.key.elev, 0)}° the sun drives brow shadow straight into the eye sockets — ${M.stops >= 2.5 ? `which suits ${toneWord}: the audience cannot fully read the eyes, so the character withholds.` : `so we would normally silk it; here the hardness is accepted for its graphic, exposed quality.`}`;
  } else if (key.modifier === 'silk') {
    s1 += ` A ${fmt(T.sunElev, 0)}° noon sun would carve raccoon-eye shadows; the 12×12 silk converts it into a ${fmt(3.6, 1)} m source that wraps the face — the tonal priority (${toneWord}) outranks the time of day.`;
  } else if (sun?.rim) {
    s1 += ` The ${fmt(sun.elev, 0)}° sun is placed behind the subject as a rim, so its long shadows rake toward the lens and the face is keyed by its own bounce — that is why the light on the skin still feels like golden hour.`;
  } else if (key.modifier === 'window') {
    s1 += ` Because the window is visible in the geography, the direction is motivated — the viewer accepts the light as the world's, not the filmmaker's.`;
  } else if (key.motivation && !E.exterior && !T.daylight) {
    s1 += ` The key is cheated from the direction of the ${key.motivation} so the light remains diegetic even though the practical itself is too dim to expose on.`;
  } else if (key.motivation) {
    s1 += ` It is motivated by ${key.motivation}.`;
  }
  out.push({ h: 'Source & Quality', t: s1 });

  // 2 · Contrast
  const nat = r.naturalRatio;
  let s2 = `Left alone, this ${E.label.toLowerCase()} returns enough bounce for roughly ${fmt(nat)}:1. ${M.label} calls for ${r.ratioStr} (${fmt(r.stops)} stops), `;
  if (r.fillPlan.neg && r.fillPlan.delta > 0.25) s2 += `so a duvetyne floppy on the fill side subtracts ~${fmt(r.fillPlan.neg)} stops of bounce. `;
  else if (r.fillPlan.neg) s2 += `so the floppy stays in mainly to keep the shadow side from milking up when the camera moves. `;
  else if (r.fillPlan.add) s2 += `so we add ${fmt(r.fillPlan.add)} stops with ${r.fillPlan.active ? 'an active LED fill' : 'a passive bounce'} to open the shadows. `;
  else s2 += 'which the room already gives us — no fill or flag required. ';
  if (r.ratio >= 6) s2 += 'At this ratio the shadow side falls toward black: half the face becomes unknowable, which the audience reads as concealment, grief or threat.';
  else if (r.ratio >= 3) s2 += 'The face is sculpted yet fully readable — shape without secrecy.';
  else s2 += 'Shadows stay open and nothing is hidden; low contrast reads as safety, honesty and closeness.';
  s2 += shortSide && keyOffDeg > faceOffDeg - 10
    ? ` The key lands on the short side (the far cheek from lens), narrowing the face and pushing shadow toward camera.`
    : ` The key falls on the broad side of the face, widening it and flattening its modelling.`;
  out.push({ h: 'Contrast Ratio', t: s2 });

  // 3 · Colour
  const kd = key.kelvin ? describeShift(key.kelvin, wb) : null;
  let s3 = `Camera is balanced at ${wb}K. `;
  if (key.gel) s3 += `The key carries the neon's own saturated hue (${key.gel}), so skin takes the colour of the city. `;
  else s3 += `The ${key.kelvin}K key renders ${kd.text}${Math.abs(kd.d) >= 15 ? ` (${fmt(Math.abs(kd.d), 0)} mired off neutral)` : ''}. `;
  if (rim && rim.kelvin && key.kelvin) {
    const dm = mired(rim.kelvin) - mired(key.kelvin);
    if (Math.abs(dm) > 40) {
      s3 += `The rim sits ${fmt(Math.abs(dm), 0)} mired ${dm < 0 ? 'cooler' : 'warmer'} than the key (≈ ${nearestGel(dm).name} apart), `;
      s3 += dm < 0 ? 'so the subject is warm against a cold world — feeling exists in the person, not the place. ' : 'so warmth hugs the edges while the face stays cool — comfort the character cannot quite reach. ';
    } else s3 += 'Key and rim share a temperature, keeping the palette unified. ';
  } else if (rim?.gel && key.gel) s3 += `The rim takes the complementary neon (${rim.gel}), splitting the face into two competing colour fields. `;
  const lp = practicals.filter((p) => p.lit && p.kelvin);
  if (lp.length && key.kelvin) {
    const dm = mired(lp[0].kelvin) - mired(key.kelvin);
    if (Math.abs(dm) > 40) s3 += `Practicals at ${lp[0].kelvin}K glow ${dm > 0 ? 'warmer' : 'cooler'} than the key in the background, building depth through colour contrast.`;
  }
  if (Math.abs(M.mired) > 10 && !key.natural && key.kelvin) s3 += ` Artificial units carry a ${r.gelPush.name} push to bias the palette toward ${M.mired > 0 ? 'warmth' : 'cold'}.`;
  out.push({ h: 'Colour Temperature', t: s3 });

  // 4 · Lens & frame
  let s4 = `${inp.focal}mm on ${r.sensor.label} sees ${fmt(r.fovH)}° × ${fmt(r.fovV)}° (≈ ${fmt(r.ffEq, 0)}mm full-frame horizontal). Holding the shot size puts the lens ${fmt(r.D)} m from the subject; the background ${fmt(c.subjects[0] ? (c.readout.D / r.bgScale - r.D) : 0)} m behind renders at ${fmt(r.bgScale * 100, 0)}% of its subject-plane scale`;
  s4 += r.bgScale > 0.6 ? ' — heavy compression stacks the world against the subject.' : r.bgScale < 0.2 ? ' — the wide perspective exaggerates depth and isolates the subject in space.' : '.';
  if (r.noseMag > 4) s4 += ` At this distance the nose is ${fmt(r.noseMag, 0)}% larger than the ears — visible wide-angle distortion${M.stops >= 3 ? ' that adds unease' : ''}.`;
  s4 += ` At f/${inp.aperture} the zone of acceptable focus is ${r.dof.total < 1 ? fmt(r.dof.total * 100, 0) + ' cm' : Number.isFinite(r.dof.total) ? fmt(r.dof.total) + ' m' : 'to infinity'} deep and the background blur disc is ${fmt(r.bgBlurPct, 1)}% of frame height`;
  s4 += r.bgBlurPct > 3 ? ', dissolving the environment into abstraction.' : r.bgBlurPct < 0.6 ? ', keeping the environment legible as a character.' : '.';
  s4 += ` The lens sits at ${fmt(r.camH)} m, ${Math.abs(r.tiltDeg) < 0.5 ? 'level' : `tilted ${r.tiltDeg >= 0 ? 'up' : 'down'} ${fmt(Math.abs(r.tiltDeg))}°`}${r.dutch ? `, Dutched ${fmt(Math.abs(r.dutch))}°` : ''}`;
  s4 += r.camH < 1.2 ? ' — looking up at the subject grants stature.' : r.camH > 2 ? ' — looking down diminishes the subject.' : r.dutch ? ' — the tilted horizon destabilises the frame.' : r.camH > 1.75 ? ' — just above the eyeline, a quiet downward weight.' : ' — eye level, neutral and intimate.';
  s4 += ` Negative space measures ${fmt(r.negSpace, 0)}% of frame with ${fmt(r.headroom, 0)}% headroom`;
  s4 += r.negSpace > 75 && r.pHeight > 0.6 ? `, yet the figure spans ${fmt(r.pHeight * 100, 0)}% of frame height — it owns the vertical while the width stays open.` : r.negSpace > 75 ? ': the subject is outnumbered by emptiness.' : r.negSpace < 45 ? ': the subject crowds the frame — no escape from them.' : '.';
  out.push({ h: 'Lens & Frame', t: s4 });

  // 5 · Blocking
  if (blocking === 'two') {
    const p = r.proxemics;
    let s5 = `The pair stand ${fmt(r.sep, 2)} m apart — Hall's ${p.zone} distance (${p.range}). The line of action is skewed ${fmt(Math.abs(c.lam / DEG), 0)}° from the lens plane`;
    s5 += Math.abs(c.lam / DEG) < 8 ? ', a flat 50/50 profile that stages them as equals in opposition.' : ', so one figure is nearer — the frame quietly chooses a side.';
    if (M.turnAway) s5 += ' B is half-turned upstage, breaking the eyeline: they share the frame but not the moment.';
    if (key.modifier !== 'window' && key.modifier !== 'sun' && key.modifier !== 'silk') s5 += ' Each actor is keyed from the far side, so every key doubles as the other\'s edge (cross-keying).';
    out.push({ h: 'Blocking & Eyelines', t: s5 });
  } else if (blocking === 'crowd') {
    const n = c.subjects.filter((s) => s.extra).length;
    const w = c.subjects.filter((s) => s.watching).length;
    let s5 = `${n} background figures are scattered through ${fmt(Math.min(E.bg, 14) * 0.85, 0)} m of depth. `;
    s5 += w ? `${w} of them hold an eyeline on the hero — the crowd becomes the source of the ${toneWord} feeling.` : M.crowd === 'same-way' ? 'They all drift one way while the hero holds still — isolation through counter-motion.' : M.crowd === 'away' ? 'They face away; the hero is unseen within the many.' : 'Their eyelines ignore the hero, letting the moment stay private in public.';
    out.push({ h: 'Blocking & Eyelines', t: s5 });
  } else {
    const lead = r.pCenterX < 50 ? 'right' : 'left';
    out.push({
      h: 'Blocking & Eyelines',
      t: `The subject sits at ${fmt(r.pCenterX, 0)}% across the frame, nose turned ${fmt(faceOffDeg, 0)}° off-lens toward frame ${lead}${faceOffDeg > 60 ? ' — near profile, the gaze leaves the frame and the audience follows it into empty space' : ', giving lead room for the eyeline to land'}.`,
    });
  }
  return out;
}
