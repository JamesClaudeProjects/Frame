// Camera-move solver (Phase 1): push-in, pull-out, truck, pedestal, rack focus.
// A move is a camera pose over normalised time t ∈ [0, 1]. Each move is anchored to the
// solved "hero frame" (the static camera): push / truck / pedestal END on it, a pull-out
// STARTS on it. Everything downstream (frustum, DoF, viewfinder, composition) is
// re-evaluated per frame from the pose, so nothing about the move is pre-rendered.

import { measureFrame, depthOfField, fmt } from './engine.js';

export const MOVES = {
  static: 'Static',
  push: 'Push In',
  pull: 'Pull Out',
  truck: 'Truck',
  pedestal: 'Pedestal',
  rack: 'Rack Focus',
};

// Tone-driven defaults: shot length (s) and pedestal direction (+1 = rises into the hero frame).
const TONE_MOVE = {
  melancholy: { dur: 10, ped: 1 },
  tense: { dur: 8, ped: -1 },
  romantic: { dur: 7, ped: -1 },
  heroic: { dur: 5, ped: -1 },
  lonely: { dur: 12, ped: 1 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
// Dolly grips ease in and out; smoothstep gives a peak speed of 1.5× the average.
export const ease = (t) => t * t * (3 - 2 * t);
const invEase = (e) => {
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (ease(m) < e) lo = m; else hi = m; }
  return (lo + hi) / 2;
};

export function solveMove(scene, inp) {
  const type = MOVES[inp.move] ? inp.move : 'static';
  const hero = scene.camera;
  const P = scene.P;
  const S = hero.sensor, f = hero.f, N = hero.N;
  const tm = TONE_MOVE[inp.tone];
  const amt = clamp(inp.moveAmt ?? 0.6, 0, 1);
  const duration = inp.moveDur ?? tm.dur;
  const notes = [];

  // Physical limits from the set: interior walls, alley walls.
  let minY = -Infinity, xLim = Infinity;
  if (scene.set.kind === 'interior') {
    const [x0, y0, x1] = scene.set.walls[0];
    minY = y0 + 0.45;
    xLim = Math.min(Math.abs(x0), Math.abs(x1)) - 0.4;
  } else if (scene.set.kind === 'alley') {
    xLim = Math.abs(scene.set.walls[1][0]) - 0.35;
  }

  const A = { x: 0, y: 0, h: hero.height };
  const B = { x: 0, y: 0, h: hero.height };
  let rack = null;

  if (type === 'push') {
    const want = P.y * (0.15 + 0.6 * amt);
    A.y = Math.max(-want, minY);
    if (-A.y < want - 0.01) notes.push(`Room wall limits the push — travel trimmed from ${fmt(want)} m to ${fmt(-A.y)} m`);
  } else if (type === 'pull') {
    const want = P.y * (0.2 + 1.0 * amt);
    B.y = Math.max(-want, minY);
    if (-B.y < want - 0.01) notes.push(`Room wall limits the pull-out — travel trimmed from ${fmt(want)} m to ${fmt(-B.y)} m`);
  } else if (type === 'truck') {
    const frameW = (P.y * S.w) / f;
    const want = frameW * (0.25 + 0.75 * amt);
    const side = Math.sign(P.x) || 1;
    // Start on the far side of the subject and track toward them, ending on the hero frame.
    A.x = clamp(-side * want, -xLim, xLim);
    if (Math.abs(A.x) < want - 0.01) notes.push(`Walls limit the truck — travel trimmed from ${fmt(want)} m to ${fmt(Math.abs(A.x))} m`);
  } else if (type === 'pedestal') {
    const range = 0.4 + 1.4 * amt;
    A.h = clamp(hero.height - tm.ped * range, 0.3, 4.5);
  } else if (type === 'rack') {
    rack = rackTargets(scene, inp);
  }

  const poseAt = (t) => {
    const e = ease(clamp(t, 0, 1));
    const x = lerp(A.x, B.x, e), y = lerp(A.y, B.y, e), h = lerp(A.h, B.h, e);
    const dist = P.y - y;
    // Operator holds the eyes on the tone's target line throughout the move.
    const pitch = Math.atan2(hero.eyeH - h, dist) - Math.atan(hero.vTarget / f);
    const focus = rack ? lerp(rack.a.dist, rack.b.dist, e) : dist;
    return { ...hero, pos: { x, y }, height: h, pitch, focus };
  };

  const metricsAt = (t) => {
    const cam = poseAt(t);
    const m = measureFrame(cam, scene.subjects);
    const dist = P.y - cam.pos.y;
    return {
      ...m,
      dist,
      height: cam.height,
      tiltDeg: (cam.pitch * 180) / Math.PI,
      focus: cam.focus,
      dof: depthOfField(f, N, cam.focus),
      bgScale: dist / (scene.bgY - cam.pos.y),
      // face (chin→crown ≈ 0.23 m) as a share of frame height — the usual measure of shot size
      faceSize: ((0.23 * f) / (Math.hypot(dist, P.x - cam.pos.x) * S.h)) * 100,
    };
  };

  const travel = Math.hypot(B.x - A.x, B.y - A.y);
  const lift = Math.abs(B.h - A.h);
  const pathLen = Math.hypot(travel, lift);
  const speedAvg = pathLen / duration;
  const speedPeak = speedAvg * 1.5;
  const start = metricsAt(0), end = metricsAt(1);

  // Practicality / gear.
  const gear = [];
  if (['push', 'pull', 'truck'].includes(type)) {
    const track = travel + 1.2;
    gear.push(`Dolly on ≈ ${fmt(track)} m of track (${Math.ceil(track / 2.44)} × 8 ft sections)`);
    if (speedPeak > 1.2) notes.push(`Peak ${fmt(speedPeak, 2)} m/s is fast for a dolly — lengthen the shot or use a vehicle/remote head`);
    else if (speedPeak < 0.06) notes.push(`Peak ${fmt(speedPeak * 100, 0)} cm/s is a crawl — a motorised slider holds this steadier than a grip`);
  }
  if (type === 'pedestal') {
    gear.push(lift <= 0.9 ? `Dolly column / pedestal (${fmt(lift, 2)} m stroke ≤ 0.9 m)` : lift <= 2.5 ? `Jib arm (${fmt(lift, 2)} m vertical exceeds a dolly column)` : `Crane / Technocrane (${fmt(lift, 2)} m vertical)`);
    if (speedPeak > 0.6) notes.push(`Boom peaks at ${fmt(speedPeak, 2)} m/s — fast enough to read as a swoop, not a drift`);
  }
  if (type === 'rack') {
    gear.push(`1st AC pulls ${fmt(Math.abs(rack.b.dist - rack.a.dist), 2)} m of focus throw — marks at ${fmt(rack.a.dist, 2)} m and ${fmt(rack.b.dist, 2)} m`);
  }

  return {
    type, label: MOVES[type], A, B, duration, travel, lift, speedAvg, speedPeak, poseAt, metricsAt,
    start, end, rack, notes, gear,
    theory: type === 'static' ? null : synthesizeMove({ type, A, B, start, end, duration, travel, lift, speedPeak, rack, scene, inp }),
  };
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

function synthesizeMove({ type, A, B, start: s, end: e, duration, travel, lift, speedPeak, rack, scene, inp }) {
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
  }
  return { h: 'Movement', t };
}

const dofText = (d) => (d.total < 1 ? `${fmt(d.total * 100, 0)} cm` : Number.isFinite(d.total) ? `${fmt(d.total, 2)} m` : 'to infinity');
