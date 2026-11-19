import React, { forwardRef } from 'react';
import { fmt, depthOfField } from '../engine/engine.js';
import { renderKelvin } from '../engine/color.js';

const W = 1000, H = 720;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function useFrame(scene) {
  const pts = [{ x: 0, y: -0.8 }];
  scene.subjects.forEach((s) => pts.push(s));
  scene.lights.forEach((l) => l.modifier !== 'sun' && pts.push(l.pos));
  scene.set.walls.forEach(([x0, y0, x1, y1]) => {
    if (scene.set.kind === 'interior') pts.push({ x: x0, y: y0 }, { x: x1, y: y1 });
  });
  if (scene.set.kind === 'alley') pts.push({ x: -1.8, y: 0 }, { x: 1.8, y: 0 });
  if (['studio', 'neon'].includes(scene.set.kind) || (scene.set.kind === 'alley' && scene.bgY - scene.P.y < 20)) pts.push({ x: 0, y: scene.bgY + 0.6 });
  const sunL = scene.lights.find((l) => l.modifier === 'sun');
  if (sunL) pts.push(sunL.pos);
  // the whole move must fit, so the plot doesn't re-scale during playback
  if (scene.move) [scene.move.A, scene.move.B].forEach((p) => pts.push({ x: p.x, y: p.y - 0.8 }));
  let x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
  let y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
  const pad = Math.max(1.1, (y1 - y0) * 0.08);
  x0 -= pad; x1 += pad; y0 -= pad * 0.6; y1 += pad;
  const k = Math.min(W / (x1 - x0), (H - 40) / (y1 - y0));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const T = (p) => ({ x: W / 2 + (p.x - cx) * k, y: H / 2 + 10 - (p.y - cy) * k });
  const inv = (sx, sy) => ({ x: (sx - W / 2) / k + cx, y: -(sy - H / 2 - 10) / k + cy });
  return { k, T, inv, bounds: { x0, x1, y0, y1 } };
}

const halo = { paintOrder: 'stroke', stroke: '#0a0b0e', strokeWidth: 3.5, strokeLinejoin: 'round' };

const FlatLay = forwardRef(function FlatLay({ scene, layers, cam: camPose }, ref) {
  const { k, T, inv } = useFrame(scene);
  const cam = camPose ?? scene.camera;
  const cp = cam.pos;
  const camS = T(cp);
  const tanH = Math.tan(cam.fovH / 2);
  const farTop = inv(0, -20).y; // world y at top of canvas
  const farY = Math.max(farTop, scene.P.y + 2) * 1.05;
  const coneLen = farY - cp.y;
  const L = T({ x: cp.x - coneLen * tanH, y: farY }), R = T({ x: cp.x + coneLen * tanH, y: farY });
  const conePath = `M${camS.x},${camS.y} L${L.x},${L.y} L${R.x},${R.y} Z`;
  const icon = clamp(k * 0.32, 9, 17);
  const gridStep = [0.5, 1, 2, 5, 10].find((s) => s * k >= 30) ?? 10;
  const inv0 = inv(0, 0), inv1 = inv(W, H);
  const dof = depthOfField(cam.f, cam.N, cam.focus ?? scene.P.y);
  const focusY = cp.y + (cam.focus ?? scene.P.y);
  const yToS = (y) => T({ x: 0, y }).y;
  const wb = scene.readout.wb;

  // grid lines
  const grid = [];
  for (let x = Math.floor(inv0.x / gridStep) * gridStep; x <= inv1.x; x += gridStep) {
    const s = T({ x, y: 0 }).x;
    grid.push(<line key={'gx' + x} x1={s} x2={s} y1={0} y2={H} className={Math.abs(x) < 1e-6 ? 'grid grid-axis' : 'grid'} />);
  }
  for (let y = Math.floor(inv1.y / gridStep) * gridStep; y <= inv0.y; y += gridStep) {
    const s = yToS(y);
    grid.push(<line key={'gy' + y} x1={0} x2={W} y1={s} y2={s} className="grid" />);
  }

  const thirdAng = Math.atan(cam.sensor.w / 6 / cam.f);
  const labels = []; // {ax, ay, x, y, lines:[{t, fill, cls}]}
  const principals = scene.subjects.filter((p) => !p.extra);
  const isPrincipal = (sh) => principals.some((p) => p.x === sh.from.x && p.y === sh.from.y);
  const obstacles = scene.subjects.map((s) => { const c = T(s); const r = Math.max(0.3 * k, 12); return { x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r }; });
  obstacles.push({ x0: camS.x - 18, y0: camS.y - 16, x1: camS.x + 300, y1: camS.y + 22 });
  const ray = (a, l) => T({ x: cp.x + Math.sin(a) * l, y: cp.y + Math.cos(a) * l });

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="flatlay" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Top-down lighting plot">
      <defs>
        <clipPath id="cone"><path d={conePath} /></clipPath>
        <linearGradient id="coneFill" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#e9eef5" stopOpacity="0.10" />
          <stop offset="1" stopColor="#e9eef5" stopOpacity="0.02" />
        </linearGradient>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#2a2d34" strokeWidth="2" />
        </pattern>
        <pattern id="grass" width="14" height="14" patternUnits="userSpaceOnUse">
          <path d="M3 10 l1.5 -4 M9 5 l1 -3.5" stroke="#1f2a1c" strokeWidth="1.2" />
        </pattern>
        <radialGradient id="glow"><stop offset="0" stopColor="#fff" stopOpacity="1" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
        {scene.lights.map((l) => (
          <radialGradient key={'g' + l.id} id={'beam-' + l.id} cx="0" cy="0.5" r="1" fx="0" fy="0.5">
            <stop offset="0" stopColor={l.color} stopOpacity={l.role === 'practical' ? 0.35 : 0.42} />
            <stop offset="1" stopColor={l.color} stopOpacity="0" />
          </radialGradient>
        ))}
        {scene.shadows.map((s, i) => (
          <filter key={'f' + i} id={'sblur' + i} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={clamp(s.penumbra * k * 0.5, 0.4, 40)} />
          </filter>
        ))}
        <filter id="soft"><feGaussianBlur stdDeviation="6" /></filter>
        <linearGradient id="kbar" x1="0" x2="1">
          {[2000, 2700, 3200, 4300, 5600, 6500, 8000, 10000].map((kv, i) => (
            <stop key={kv} offset={i / 7} stopColor={renderKelvin(kv, wb)} />
          ))}
        </linearGradient>
      </defs>

      <rect width={W} height={H} fill="#0d0f13" />
      {scene.set.ground === 'grass' && <rect width={W} height={H} fill="url(#grass)" />}
      {scene.set.ground === 'wet' && <rect width={W} height={H} fill="#0c0d14" opacity="0.6" />}
      <g>{grid}</g>

      <SetGeometry scene={scene} T={T} k={k} />

      {/* FOV frustum */}
      {layers.fov && (
        <g>
          <path d={conePath} fill="url(#coneFill)" stroke="#d9e2ee" strokeOpacity="0.55" strokeWidth="1.2" />
          {layers.guides && (
            <g className="guide">
              {[-thirdAng, thirdAng].map((a, i) => { const e = ray(a, coneLen); return <line key={i} x1={camS.x} y1={camS.y} x2={e.x} y2={e.y} />; })}
              <line x1={camS.x} y1={camS.y} x2={camS.x} y2={T({ x: cp.x, y: farY }).y} strokeDasharray="2 6" />
            </g>
          )}
        </g>
      )}

      {/* Depth of field */}
      {layers.dof && (
        <g clipPath="url(#cone)">
          {(() => {
            const nearS = yToS(cp.y + dof.near), farS = Number.isFinite(dof.far) ? yToS(cp.y + Math.min(dof.far, coneLen)) : -50;
            const fall = Math.max((nearS - farS) * 0.8, 14);
            return (
              <>
                <rect x={0} width={W} y={farS - fall} height={fall} fill="#7fd3ff" opacity="0.05" />
                <rect x={0} width={W} y={nearS} height={fall} fill="#7fd3ff" opacity="0.05" />
                <rect x={0} width={W} y={farS} height={Math.max(nearS - farS, 1.5)} fill="#7fd3ff" opacity="0.2" />
                <line x1={0} x2={W} y1={nearS} y2={nearS} stroke="#7fd3ff" strokeWidth="1" strokeDasharray="5 4" opacity="0.8" />
                {Number.isFinite(dof.far) && <line x1={0} x2={W} y1={farS} y2={farS} stroke="#7fd3ff" strokeWidth="1" strokeDasharray="5 4" opacity="0.8" />}
                <line x1={0} x2={W} y1={yToS(focusY)} y2={yToS(focusY)} stroke="#7fd3ff" strokeWidth="1.6" />
              </>
            );
          })()}
        </g>
      )}
      {layers.dof && layers.labels && (() => {
        const y = yToS(focusY);
        const xL = T({ x: cp.x - (focusY - cp.y) * tanH, y: focusY }).x;
        const t = `FOCUS ${fmt(focusY - cp.y, 2)}m · DoF ${dof.total < 1 ? fmt(dof.total * 100, 0) + 'cm' : Number.isFinite(dof.total) ? fmt(dof.total, 2) + 'm' : '→∞'}`;
        const w = t.length * 6.3;
        labels.push({ ax: xL, ay: y, x: Math.max(8, xL - w - 8), y: y + 4, lines: [{ t, cls: 'lbl lbl-dof' }] });
        return null;
      })()}

      {/* Light beams */}
      {layers.beams && scene.lights.map((l) => <Beam key={'b' + l.id} l={l} T={T} k={k} scene={scene} />)}

      {/* Shadows */}
      {layers.shadows && scene.shadows.map((s, i) => {
        const a = s.dir, n = { x: -Math.sin(a), y: Math.cos(a) };
        const b = 0.22, tipW = b + s.penumbra;
        const tip = { x: s.from.x + Math.cos(a) * s.length, y: s.from.y + Math.sin(a) * s.length };
        const p = [
          { x: s.from.x + n.x * b, y: s.from.y + n.y * b }, { x: tip.x + n.x * tipW, y: tip.y + n.y * tipW },
          { x: tip.x - n.x * tipW, y: tip.y - n.y * tipW }, { x: s.from.x - n.x * b, y: s.from.y - n.y * b },
        ].map(T);
        const ts = T(tip), fs = T(s.from);
        return (
          <g key={'s' + i}>
            <polygon points={p.map((q) => `${q.x},${q.y}`).join(' ')} fill="#000" opacity={s.opacity} filter={`url(#sblur${i})`} />
            {isPrincipal(s) && layers.labels && (
              <line x1={fs.x} y1={fs.y} x2={ts.x} y2={ts.y} stroke="#8a93a3" strokeDasharray="2 3" strokeWidth="1" opacity="0.7" />
            )}
            {isPrincipal(s) && layers.labels && void labels.push({ ax: ts.x, ay: ts.y, x: ts.x + 4, y: ts.y + 12, lines: [{ t: `shadow ${fmt(s.length)}m · edge ${fmt(s.penumbra * 100, 0)}cm`, cls: 'lbl lbl-dim' }] })}
          </g>
        );
      })}

      {/* Line of action */}
      {scene.lineOfAction && layers.guides && (() => {
        const { a, b } = scene.lineOfAction;
        const d = { x: b.x - a.x, y: b.y - a.y }, l = Math.hypot(d.x, d.y);
        const e = 1.6 / l;
        const p0 = T({ x: a.x - d.x * e, y: a.y - d.y * e }), p1 = T({ x: b.x + d.x * e, y: b.y + d.y * e });
        return (
          <g>
            <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="#e8c26a" strokeDasharray="10 5 2 5" strokeWidth="1.2" opacity="0.8" />
            {layers.labels && void labels.push({ ax: p1.x, ay: p1.y, x: p1.x + 4, y: p1.y - 6, lines: [{ t: '180° LINE', cls: 'lbl', fill: '#e8c26a' }] })}
          </g>
        );
      })()}

      {/* Subjects */}
      {scene.subjects.map((s, i) => <Subject key={'p' + i} s={s} T={T} k={k} />)}
      {layers.labels && scene.subjects.forEach((s) => {
        if (!s.label) return;
        const c = T(s), sw = Math.max(0.5 * k, 22);
        labels.push({ ax: c.x, ay: c.y, x: c.x + sw * 0.55, y: c.y - sw * 0.45, lines: [{ t: s.label, cls: 'lbl lbl-subj' }] });
      })}

      {/* Fixtures */}
      {scene.lights.map((l) => <Fixture key={'fx' + l.id} l={l} T={T} k={k} icon={icon} />)}
      {layers.labels && scene.lights.forEach((l) => { const lb = fixtureLabel(l, T, k, icon); if (lb) labels.push(lb); })}

      {scene.move && scene.move.type !== 'static' && <MovePath move={scene.move} T={T} k={k} tanH={tanH} farY={farY} labels={layers.labels ? labels : null} />}

      {/* Camera */}
      <g transform={`translate(${camS.x},${camS.y})`}>
        <rect x={-15} y={-2} width={30} height={22} rx={3} fill="#1b1f27" stroke="#e9eef5" strokeWidth="1.5" />
        <path d="M-9,-2 L-12,-14 L12,-14 L9,-2 Z" fill="#2a303b" stroke="#e9eef5" strokeWidth="1.5" />
        <circle cx={0} cy={9} r={4} fill="#e05757" />
        {layers.labels && (
          <text x={22} y={10} className="lbl" fill="#e9eef5" style={halo}>
            A-CAM · {cam.f}mm · f/{cam.N} · {fmt(cam.fovH / DEG)}° H · ↕{fmt(cam.height, 2)}m{cam.dutch ? ` · dutch ${fmt(Math.abs(cam.dutch))}°` : ''}
          </text>
        )}
      </g>

      {layers.labels && <Labels items={labels} obstacles={obstacles} />}

      {/* Title block & scale */}
      <g transform="translate(16,18)">
        <text className="tb-title">LIGHTING PLOT · TOP VIEW</text>
        <text y={16} className="tb-sub">{scene.inp && `${scene.readout.sensor.label} · seed ${scene.inp.seed} · WB ${wb}K`}</text>
      </g>
      <g transform={`translate(${W - 16 - gridStep * k},${H - 20})`}>
        <line x1={0} x2={gridStep * k} y1={0} y2={0} stroke="#cfd6e2" strokeWidth="2" />
        <line x1={0} x2={0} y1={-4} y2={4} stroke="#cfd6e2" strokeWidth="2" />
        <line x1={gridStep * k} x2={gridStep * k} y1={-4} y2={4} stroke="#cfd6e2" strokeWidth="2" />
        <text x={gridStep * k / 2} y={-8} textAnchor="middle" className="lbl lbl-dim">{gridStep} m grid</text>
      </g>
      <g transform={`translate(16,${H - 34})`}>
        <rect width={180} height={8} rx={2} fill="url(#kbar)" />
        <text y={22} className="lbl lbl-dim">2000K</text>
        <text x={180} y={22} textAnchor="end" className="lbl lbl-dim">10000K</text>
        <text x={90} y={22} textAnchor="middle" className="lbl lbl-dim">as rendered @ {wb}K</text>
      </g>
    </svg>
  );
});

// Move overlay: dolly track with ties, ghost frustums at the start and end marks,
// pedestal travel, and the 1st AC's focus marks for a rack.
function MovePath({ move, T, k, tanH, farY, labels }) {
  const { A, B, type } = move;
  const a = T(A), b = T(B);
  const els = [];
  const ghost = (p, key, label) => {
    const s = T(p), reach = Math.min(farY - p.y, 6);
    const l = T({ x: p.x - reach * tanH, y: p.y + reach }), r = T({ x: p.x + reach * tanH, y: p.y + reach });
    els.push(
      <g key={key} opacity="0.55">
        <path d={`M${s.x},${s.y} L${l.x},${l.y} M${s.x},${s.y} L${r.x},${r.y}`} stroke="#f5b041" strokeWidth="1" strokeDasharray="3 4" />
        <rect x={s.x - 9} y={s.y - 1} width={18} height={13} rx={2} fill="none" stroke="#f5b041" strokeWidth="1.2" />
      </g>,
    );
    if (labels) labels.push({ ax: s.x, ay: s.y, x: s.x - 70, y: s.y + 26, lines: [{ t: label, cls: 'lbl', fill: '#f5b041' }] });
  };
  if (['push', 'pull', 'truck'].includes(type)) {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, nx = -uy, ny = ux;
    const g = 7;
    const ext = 0.6 * k; // track runs a little past both marks
    const s0 = { x: a.x - ux * ext, y: a.y - uy * ext }, s1 = { x: b.x + ux * ext, y: b.y + uy * ext };
    [-1, 1].forEach((side) => els.push(
      <line key={'rail' + side} x1={s0.x + nx * g * side} y1={s0.y + ny * g * side} x2={s1.x + nx * g * side} y2={s1.y + ny * g * side} stroke="#b9a27a" strokeWidth="1.5" />,
    ));
    const total = len + 2 * ext, step = Math.max(0.3 * k, 8);
    for (let d = 0; d <= total; d += step) {
      const c = { x: s0.x + ux * d, y: s0.y + uy * d };
      els.push(<line key={'tie' + d} x1={c.x - nx * (g + 3)} y1={c.y - ny * (g + 3)} x2={c.x + nx * (g + 3)} y2={c.y + ny * (g + 3)} stroke="#6f6248" strokeWidth="2" />);
    }
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    els.push(<path key="arrow" d={`M${m.x - ux * 8 + nx * 6},${m.y - uy * 8 + ny * 6} L${m.x + ux * 6},${m.y + uy * 6} L${m.x - ux * 8 - nx * 6},${m.y - uy * 8 - ny * 6}`} fill="none" stroke="#f5b041" strokeWidth="2" />);
    ghost(A, 'gA', type === 'pull' ? 'START · hero frame' : 'START');
    ghost(B, 'gB', type === 'pull' ? 'END' : 'END · hero frame');
    if (labels) labels.push({ ax: m.x, ay: m.y, x: m.x + 16, y: m.y - 10, lines: [{ t: `${move.label.toUpperCase()} · ${fmt(move.travel, 2)} m · ${fmt(move.duration, 0)} s`, cls: 'lbl', fill: '#f5b041' }, { t: `peak ${fmt(move.speedPeak, 2)} m/s · eased`, cls: 'lbl lbl-dim' }] });
  } else if (type === 'pedestal') {
    const up = B.h > A.h;
    els.push(
      <g key="ped" transform={`translate(${a.x - 34},${a.y})`}>
        <line x1={0} y1={-16} x2={0} y2={16} stroke="#f5b041" strokeWidth="2" />
        <path d={up ? 'M-5,-10 L0,-17 L5,-10' : 'M-5,10 L0,17 L5,10'} fill="none" stroke="#f5b041" strokeWidth="2" />
      </g>,
    );
    if (labels) labels.push({ ax: a.x - 34, ay: a.y, x: a.x - 200, y: a.y - 4, lines: [{ t: `PEDESTAL ${up ? 'UP' : 'DOWN'} · ${fmt(A.h, 2)} → ${fmt(B.h, 2)} m`, cls: 'lbl', fill: '#f5b041' }, { t: `${fmt(move.lift, 2)} m in ${fmt(move.duration, 0)} s`, cls: 'lbl lbl-dim' }] });
  } else if (type === 'rack') {
    [['a', move.rack.a], ['b', move.rack.b]].forEach(([id, m], i) => {
      const y = B.y + m.dist;
      const half = (m.dist) * tanH;
      const l = T({ x: B.x - half, y }), r = T({ x: B.x + half, y });
      els.push(<line key={'mk' + id} x1={l.x} y1={l.y} x2={r.x} y2={r.y} stroke="#f5b041" strokeWidth="1.2" strokeDasharray="1 3" />);
      els.push(<circle key={'mc' + id} cx={r.x} cy={r.y} r={3.5} fill="#f5b041" />);
      if (labels) labels.push({ ax: r.x, ay: r.y, x: r.x + 6, y: r.y + 4, lines: [{ t: `MARK ${i + 1} · ${m.label} · ${fmt(m.dist, 2)} m`, cls: 'lbl', fill: '#f5b041' }] });
    });
  }
  return <g>{els}</g>;
}

function SetGeometry({ scene, T, k }) {
  const { set } = scene;
  const els = [];
  set.walls.forEach(([x0, y0, x1, y1], i) => {
    const a = T({ x: x0, y: y0 }), b = T({ x: x1, y: y1 });
    els.push(<line key={'w' + i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#9aa3b2" strokeWidth={Math.max(4, 0.15 * k)} strokeLinecap="square" />);
  });
  if (set.kind === 'alley') {
    set.walls.forEach(([x0, y0, x1, y1], i) => {
      const a = T({ x: x0, y: y0 }), b = T({ x: x1, y: y1 });
      const off = x0 < 0 ? -14 : 0;
      els.push(<rect key={'wh' + i} x={Math.min(a.x, b.x) + off} y={Math.min(a.y, b.y)} width={14} height={Math.abs(b.y - a.y)} fill="url(#hatch)" />);
    });
  }
  set.windows.forEach((w, i) => {
    const h = w.len / 2;
    const a = w.axis === 'x' ? { x: w.center.x, y: w.center.y - h } : { x: w.center.x - h, y: w.center.y };
    const b = w.axis === 'x' ? { x: w.center.x, y: w.center.y + h } : { x: w.center.x + h, y: w.center.y };
    const A = T(a), B = T(b), C = T(w.center);
    els.push(
      <g key={'win' + i}>
        <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#0d0f13" strokeWidth={Math.max(6, 0.17 * k)} />
        <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#cfe8ff" strokeWidth="2" />
        <circle cx={C.x} cy={C.y} r={3} fill="#cfe8ff" />
      </g>,
    );
  });
  set.features.forEach((f, i) => {
    if (f.type === 'cyc') {
      const a = T({ x: -f.w, y: f.y - 0.6 }), m = T({ x: 0, y: f.y }), b = T({ x: f.w, y: f.y - 0.6 });
      const c1 = T({ x: -f.w, y: f.y }), c2 = T({ x: f.w, y: f.y });
      els.push(<path key={'f' + i} d={`M${a.x},${a.y} Q${c1.x},${c1.y} ${m.x},${m.y} Q${c2.x},${c2.y} ${b.x},${b.y}`} fill="none" stroke="#7d8696" strokeWidth="3" />);
      els.push(<text key={'ft' + i} x={m.x} y={m.y - 8} textAnchor="middle" className="lbl lbl-dim" style={halo}>CYC · black duvetyne</text>);
    } else if (f.type === 'facade') {
      const y = T({ x: 0, y: f.y }).y;
      els.push(<rect key={'f' + i} x={0} y={y - 26} width={W} height={26} fill="url(#hatch)" />, <line key={'fl' + i} x1={0} x2={W} y1={y} y2={y} stroke="#9aa3b2" strokeWidth="3" />);
      els.push(<text key={'ft' + i} x={W / 2} y={y - 32} textAnchor="middle" className="lbl lbl-dim" style={halo}>STOREFRONT FAÇADE</text>);
    } else if (f.type === 'curb') {
      const y = T({ x: 0, y: f.y }).y;
      els.push(<line key={'f' + i} x1={0} x2={W} y1={y} y2={y} stroke="#5a6170" strokeWidth="1.5" strokeDasharray="14 6" />);
      els.push(<text key={'ft' + i} x={12} y={y - 5} className="lbl lbl-dim" style={halo}>CURB · wet asphalt (reflective)</text>);
    } else if (f.type === 'treeline') {
      const y = T({ x: 0, y: f.y }).y;
      if (y > 30) {
        const dots = [];
        for (let x = 6; x < W; x += 18) dots.push(<circle key={x} cx={x} cy={y + Math.sin(x) * 4} r={7} fill="#1a2418" stroke="#2c3a28" />);
        els.push(<g key={'f' + i}>{dots}</g>);
      } else {
        els.push(<text key={'ft' + i} x={W / 2} y={30} textAnchor="middle" className="lbl lbl-dim" style={halo}>↑ tree line {fmt(f.y, 0)} m · open horizon</text>);
      }
    }
  });
  return <g>{els}</g>;
}

function Beam({ l, T, k, scene }) {
  if (l.role === 'neg' || !l.color) return null;
  if (l.modifier === 'sun') {
    // parallel shafts crossing the set
    const a = l.az + Math.PI, n = { x: -Math.sin(a), y: Math.cos(a) };
    const c = scene.P;
    const shafts = [];
    for (let i = -6; i <= 6; i++) {
      const o = i * 0.9;
      const s = T({ x: c.x + n.x * o - Math.cos(a) * 9, y: c.y + n.y * o - Math.sin(a) * 9 });
      const e = T({ x: c.x + n.x * o + Math.cos(a) * 9, y: c.y + n.y * o + Math.sin(a) * 9 });
      shafts.push(<line key={i} x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={l.color} strokeOpacity={l.elev > 60 ? 0.07 : 0.13} strokeWidth={Math.max(2, 0.25 * k)} />);
    }
    return <g>{shafts}</g>;
  }
  if (l.modifier === 'silk') {
    const c = T(l.pos), s = 3.6 * k;
    return <rect x={c.x - s / 2} y={c.y - s / 2} width={s} height={s} fill={l.color} opacity="0.07" />;
  }
  if (l.role === 'practical') {
    if (!l.lit) return null;
    const c = T(l.pos), r = Math.max(1.6 * k, 24) * (l.modifier === 'neon' ? 1.6 : 1);
    return <circle cx={c.x} cy={c.y} r={r} fill={l.color} opacity={l.stops < -1.5 ? 0.08 : 0.16} filter="url(#soft)" />;
  }
  const from = T(l.pos), to = T(l.aim);
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const len = Math.max(dist * 1.55, 1.5 * k);
  const half = ((l.beam ?? 60) / 2) * DEG;
  const p1 = { x: from.x + Math.cos(a - half) * len, y: from.y + Math.sin(a - half) * len };
  const p2 = { x: from.x + Math.cos(a + half) * len, y: from.y + Math.sin(a + half) * len };
  const sweep = `A${len},${len} 0 0,1 ${p2.x},${p2.y}`;
  return (
    <g>
      <path d={`M${from.x},${from.y} L${p1.x},${p1.y} ${sweep} Z`} fill={l.color} opacity={l.role === 'key' || l.role === 'key2' ? 0.16 : 0.1} />
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={l.color} strokeOpacity="0.55" strokeWidth="1" strokeDasharray="1 4" />
    </g>
  );
}

function Subject({ s, T, k }) {
  const c = T(s);
  const sw = Math.max(0.5 * k, s.extra ? 14 : 22);
  const sh = sw * 0.46;
  const hr = sw * 0.24;
  const rot = -s.facing / DEG; // svg rotation: local +x = facing
  const col = s.extra ? '#7c8597' : '#f1f3f7';
  let eye = null;
  if (!s.extra || s.watching) {
    const target = s.look ?? { x: s.x + Math.cos(s.facing) * 2.6, y: s.y + Math.sin(s.facing) * 2.6 };
    const t = T(target);
    const d = Math.hypot(t.x - c.x, t.y - c.y);
    const ux = (t.x - c.x) / d, uy = (t.y - c.y) / d;
    eye = (
      <line x1={c.x + ux * hr * 1.3} y1={c.y + uy * hr * 1.3} x2={t.x - ux * (s.look ? hr * 1.8 : 0)} y2={t.y - uy * (s.look ? hr * 1.8 : 0)}
        stroke={s.watching ? '#e86b6b' : '#ffd479'} strokeWidth={s.extra ? 1 : 1.4} strokeDasharray="3 4" opacity={s.extra ? 0.55 : 0.95} markerEnd="" />
    );
  }
  return (
    <g>
      {eye}
      <g transform={`translate(${c.x},${c.y}) rotate(${rot})`}>
        <ellipse cx={0} cy={0} rx={sh / 2} ry={sw / 2} fill={s.extra ? '#2a2f39' : '#3a414e'} stroke={col} strokeWidth={s.extra ? 1 : 1.6} />
        <circle cx={0} cy={0} r={hr} fill={s.extra ? '#4a5160' : '#cfd6e2'} stroke={col} strokeWidth="1" />
        <path d={`M${hr * 0.85},${-hr * 0.35} L${hr * 1.55},0 L${hr * 0.85},${hr * 0.35}`} fill={col} />
      </g>
    </g>
  );
}

function Fixture({ l, T, k, icon }) {
  const c = T(l.pos);
  const to = T(l.aim);
  const a = (Math.atan2(to.y - c.y, to.x - c.x) * 180) / Math.PI;
  const u = icon;
  let g;
  switch (l.modifier) {
    case 'softbox':
      g = <path d={`M${-u * 0.6},${-u * 0.35} L${-u * 0.6},${u * 0.35} L${u * 0.5},${u} L${u * 0.5},${-u} Z`} fill="#222833" stroke={l.color} strokeWidth="2" />;
      break;
    case 'book':
      g = (
        <g stroke={l.color} strokeWidth="2.4" fill="none">
          <path d={`M${u * 0.7},${-u * 1.1} L${-u * 0.6},${-u * 0.1}`} />
          <path d={`M${u * 0.7},${u * 1.1} L${-u * 0.6},${u * 0.1}`} strokeDasharray="3 2" />
          <circle cx={-u * 1.2} cy={0} r={u * 0.32} fill={l.color} stroke="none" />
          <line x1={-u * 1.0} y1={0} x2={-u * 0.55} y2={-u * 0.25} strokeWidth="1" />
        </g>
      );
      break;
    case 'fresnel':
      g = (
        <g>
          <rect x={-u * 0.7} y={-u * 0.5} width={u * 1.1} height={u} rx={2} fill="#222833" stroke={l.color} strokeWidth="2" />
          <line x1={u * 0.4} y1={-u * 0.5} x2={u * 0.95} y2={-u * 0.85} stroke={l.color} strokeWidth="1.6" />
          <line x1={u * 0.4} y1={u * 0.5} x2={u * 0.95} y2={u * 0.85} stroke={l.color} strokeWidth="1.6" />
          <circle cx={u * 0.4} cy={0} r={u * 0.22} fill={l.color} />
        </g>
      );
      break;
    case 'window':
      g = (
        <g>
          <rect x={-u * 0.4} y={-u * 0.9} width={u * 0.8} height={u * 1.8} fill="#0d0f13" stroke={l.color} strokeWidth="2" />
          <line x1={0} y1={-u * 0.9} x2={0} y2={u * 0.9} stroke={l.color} strokeWidth="1" />
          <line x1={-u * 0.4} y1={0} x2={u * 0.4} y2={0} stroke={l.color} strokeWidth="1" />
        </g>
      );
      break;
    case 'sun':
      g = (
        <g>
          {[...Array(8)].map((_, i) => (
            <line key={i} x1={Math.cos((i * Math.PI) / 4) * u * 0.8} y1={Math.sin((i * Math.PI) / 4) * u * 0.8} x2={Math.cos((i * Math.PI) / 4) * u * 1.25} y2={Math.sin((i * Math.PI) / 4) * u * 1.25} stroke={l.color} strokeWidth="2" />
          ))}
          <circle r={u * 0.6} fill={l.color} />
        </g>
      );
      break;
    case 'silk': {
      const s = 3.6 * k;
      g = <rect x={-s / 2} y={-s / 2} width={s} height={s} fill="none" stroke="#e9eef5" strokeWidth="1.5" strokeDasharray="8 5" />;
      break;
    }
    case 'flag': {
      const w = Math.max(1.2 * k, u * 2.2);
      g = (
        <g>
          <rect x={-u * 0.25} y={-w / 2} width={u * 0.5} height={w} fill="#000" stroke="#d0d5de" strokeWidth="1.5" />
          <line x1={-u * 0.25} y1={-w / 2} x2={u * 0.25} y2={w / 2} stroke="#3b3f47" />
          <line x1={-u * 0.25} y1={w / 2} x2={u * 0.25} y2={-w / 2} stroke="#3b3f47" />
        </g>
      );
      break;
    }
    case 'bounce': {
      const w = Math.max(1.0 * k, u * 2);
      g = <rect x={-u * 0.2} y={-w / 2} width={u * 0.4} height={w} fill="#f4f1ea" stroke={l.color} strokeWidth="1.5" />;
      break;
    }
    case 'lamp':
      g = (
        <g>
          <circle r={u * 0.75} fill="none" stroke={l.color} strokeWidth="2" />
          <circle r={u * 0.32} fill={l.lit ? l.color : '#333'} />
        </g>
      );
      break;
    case 'streetlamp':
      g = (
        <g>
          <circle r={u * 0.5} fill={l.lit ? l.color : '#2a2d33'} stroke="#9aa3b2" strokeWidth="1.5" />
        </g>
      );
      break;
    case 'neon':
      g = <rect x={-u * 1.4} y={-u * 0.22} width={u * 2.8} height={u * 0.44} rx={u * 0.22} fill={l.color} stroke="#fff" strokeOpacity="0.7" strokeWidth="1" />;
      break;
    default:
      g = <circle r={u * 0.5} fill={l.color} />;
  }
  const rotate = ['neon', 'lamp', 'streetlamp', 'sun', 'silk'].includes(l.modifier) ? 0 : a;
  return <g transform={`translate(${c.x},${c.y}) rotate(${rotate})`}>{g}</g>;
}

function fixtureLabel(l, T, k, u) {
  if (l.role === 'practical' && l.modifier === 'streetlamp' && !l.lit) return null;
  const c = T(l.pos);
  const tag = l.role === 'neg' ? 'NEG FILL · duvetyne' : `${l.label}${l.kelvin ? ' · ' + l.kelvin + 'K' : l.gel ? ' · gel' : ''}`;
  const sub = l.modifier === 'sun' ? `elev ${fmt(l.elev, 0)}°` : l.role === 'practical' ? l.name : l.role === 'neg' ? '4×4 floppy' : l.stops != null && l.role !== 'key' ? `${l.stops >= 0 ? '+' : ''}${fmt(l.stops)} st vs key` : l.name;
  const silk = l.modifier === 'silk';
  return {
    ax: c.x, ay: c.y,
    x: silk ? c.x + (3.6 * k) / 2 + 6 : c.x + u * 1.5,
    y: silk ? c.y - (3.6 * k) / 2 + 10 : c.y - u * 0.4,
    lines: [{ t: tag, cls: 'lbl lbl-fx', fill: l.role === 'neg' ? '#d0d5de' : l.color }, { t: sub, cls: 'lbl lbl-dim' }],
  };
}

// Greedy label placement: try nearby slots, avoid prior labels/obstacles, draw a leader if displaced.
function Labels({ items, obstacles }) {
  const placed = [...obstacles];
  const hit = (b) => placed.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  const out = items.map((it, i) => {
    const w = Math.max(...it.lines.map((l) => l.t.length)) * 6.2 + 4;
    const h = it.lines.length * 12 + 2;
    const flipX = it.ax - (it.x - it.ax) - w;
    let best = null;
    for (const dy of [0, 15, -15, 30, -30, 45, -45, 60, -60, 80, -80, 100, -100]) {
      for (const x of [it.x, flipX]) {
        const b = { x0: x, y0: it.y + dy - 10, x1: x + w, y1: it.y + dy - 10 + h };
        if (b.x0 < 2 || b.x1 > W - 2 || b.y0 < 34 || b.y1 > H - 40) continue;
        if (!hit(b)) { best = { x, y: it.y + dy, b }; break; }
      }
      if (best) break;
    }
    if (!best) best = { x: clamp(it.x, 2, W - w - 2), y: it.y, b: { x0: it.x, y0: it.y - 10, x1: it.x + w, y1: it.y - 10 + h } };
    placed.push(best.b);
    const moved = Math.hypot(best.x - it.x, best.y - it.y) > 4;
    const lx = clamp(it.ax, best.b.x0, best.b.x1), ly = clamp(it.ay, best.b.y0, best.b.y1);
    return (
      <g key={'lb' + i}>
        {moved && <line x1={it.ax} y1={it.ay} x2={lx} y2={ly} stroke="#6d7584" strokeWidth="0.8" opacity="0.8" />}
        {it.lines.map((l, j) => (
          <text key={j} x={best.x} y={best.y + j * 12} className={l.cls} style={l.fill ? { ...halo, fill: l.fill } : halo}>{l.t}</text>
        ))}
      </g>
    );
  });
  return <g>{out}</g>;
}

export default FlatLay;
