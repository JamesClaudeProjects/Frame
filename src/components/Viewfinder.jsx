import React from 'react';
import { toCamera, camToFrame, lensDistortion, blurDisc, fixtureHeight, fmt } from '../engine/engine.js';
import { Tip } from './ui.jsx';
import { boomAt } from '../engine/sound.js';

const SKY = {
  golden: ['#e79a52', '#3a3550'], noon: ['#8fb8de', '#3b6a9a'], blue: ['#2b4682', '#0d1631'],
  midnight: ['#07090f', '#020306'], overcast: ['#9a9fa6', '#5d6268'],
};
const GROUND = { grass: '#1e281a', asphalt: '#1d1e22', wet: '#121119', floor: '#2a221d', void: '#060607' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export default function Viewfinder({ scene, cam: camPose, metrics, transport, t = 1, subjects: subjOverride, uid = 'vf', bare = false, width, soundLayer = false, distortion = true }) {
  const U = (id) => `${uid}-${id}`;
  const subjects = subjOverride ?? scene.subjects;
  const cam = camPose ?? scene.camera;
  const S = cam.sensor;
  const VW = 560, VH = Math.round(VW / S.ratio);
  // Projection: world → camera space → frame, then the lens's radial distortion.
  const dist = distortion ? lensDistortion(S, cam.f).k1 : 0;
  const toScreen = (f) => {
    if (!f) return null;
    let { x, y } = f;
    if (dist) {
      const u = (x - 0.5) * 2, v = ((y - 0.5) * 2) / S.ratio;
      // The polynomial only describes the lens inside (and just past) the image circle; far
      // off-frame points are scaled uniformly so the mapping never folds back on itself.
      const k = 1 + dist * Math.min(u * u + v * v, 2.6);
      x = 0.5 + (u * k) / 2; y = 0.5 + (v * k * S.ratio) / 2;
    }
    return { x: x * VW, y: y * VH, z: f.z };
  };
  const P = (pt, h) => toScreen(camToFrame(cam, toCamera(cam, pt, h)));
  const time = scene.inp.time;
  const blurPx = (zM) => clamp((blurDisc(cam.f, cam.N, cam.focus ?? scene.P.y, zM) / S.h) * VH * 0.5, 0, 18);
  const bgBlur = blurPx(scene.bgY - cam.pos.y);

  // horizon
  const hz = P({ x: cam.pos.x + Math.sin(cam.yaw || 0) * 5000, y: cam.pos.y + Math.cos(cam.yaw || 0) * 5000 }, cam.height);
  const horizonY = hz ? hz.y : -1000;

  // Polygon in world space → clipped at the lens (near plane) → screen. Edges are
  // subdivided so walls bend correctly under lens distortion.
  const NEAR = 0.1;
  const polyC = (pts3, steps = 14) => {
    const dense = [];
    pts3.forEach((a, i) => {
      const b = pts3[(i + 1) % pts3.length];
      for (let j = 0; j < steps; j++) {
        const t = j / steps;
        dense.push(toCamera(cam, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, a.h + (b.h - a.h) * t));
      }
    });
    const out = [];
    dense.forEach((c, i) => {
      const n = dense[(i + 1) % dense.length];
      const cin = c.z >= NEAR, nin = n.z >= NEAR;
      if (cin) out.push(c);
      if (cin !== nin) {
        const t = (NEAR - c.z) / (n.z - c.z);
        out.push({ x: c.x + (n.x - c.x) * t, y: c.y + (n.y - c.y) * t, z: NEAR });
      }
    });
    const scr = out.map((c) => toScreen(camToFrame(cam, c))).filter(Boolean);
    return scr.length > 2 ? scr.map((p) => `${p.x},${p.y}`).join(' ') : null;
  };
  const line3 = (a, ha, b, hb, n = 40) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = P({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ha + (hb - ha) * t);
      if (p) out.push(`${p.x},${p.y}`);
    }
    return out.length > 1 ? out.join(' ') : null;
  };
  const W3 = (x, y, h) => ({ x, y, h });

  // background / set — geometry starts behind the camera and is clipped at the lens,
  // so it stays correct wherever the camera moves.
  const bg = [];
  const kind = scene.set.kind;
  const far = Math.min(scene.bgY, 60);
  const near = cam.pos.y - 3;
  if (kind !== 'studio') {
    for (let x = -12; x <= 12; x += 1) {
      const d = line3({ x, y: near }, 0, { x, y: far }, 0);
      if (d) bg.push(<polyline key={'gx' + x} points={d} className="vf-grid" />);
    }
    for (let y = Math.ceil(near); y <= far; y += y < 10 ? 1 : 5) {
      const d = line3({ x: -14, y }, 0, { x: 14, y }, 0, 16);
      if (d) bg.push(<polyline key={'gy' + y} points={d} className="vf-grid" />);
    }
  }
  if (kind === 'interior') {
    const x0 = scene.set.walls[0][0], x1 = scene.set.walls[0][2], y0 = scene.set.walls[0][1], by = scene.set.walls[1][3], Hc = 2.8;
    const ceil = polyC([W3(x0, y0, Hc), W3(x1, y0, Hc), W3(x1, by, Hc), W3(x0, by, Hc)]);
    const left = polyC([W3(x0, y0, 0), W3(x0, by, 0), W3(x0, by, Hc), W3(x0, y0, Hc)]);
    const right = polyC([W3(x1, y0, 0), W3(x1, by, 0), W3(x1, by, Hc), W3(x1, y0, Hc)]);
    const back = polyC([W3(x0, by, 0), W3(x1, by, 0), W3(x1, by, Hc), W3(x0, by, Hc)]);
    ceil && bg.push(<polygon key="ceil" points={ceil} fill="#141212" stroke="#3a3d45" strokeWidth="1" />);
    [left, right].forEach((d, i) => d && bg.push(<polygon key={'sw' + i} points={d} fill="#1d1a1a" stroke="#575b66" strokeWidth="1" />));
    back && bg.push(<polygon key="bw" points={back} fill="#221e1c" stroke="#6b707c" strokeWidth="1" />);
    scene.set.windows.forEach((w, i) => {
      const h = w.len / 2;
      const a = w.axis === 'x' ? { x: w.center.x, y: w.center.y - h } : { x: w.center.x - h, y: w.center.y };
      const b = w.axis === 'x' ? { x: w.center.x, y: w.center.y + h } : { x: w.center.x + h, y: w.center.y };
      const d = polyC([W3(a.x, a.y, 0.9), W3(b.x, b.y, 0.9), W3(b.x, b.y, 2.3), W3(a.x, a.y, 2.3)], 6);
      const lt = scene.lights.find((l) => l.modifier === 'window' && Math.abs(l.pos.x - w.center.x) < 0.01 && Math.abs(l.pos.y - w.center.y) < 0.01);
      d && bg.push(<polygon key={'win' + i} points={d} fill={lt?.color ?? '#cfe8ff'} opacity="0.75" stroke="#fff" strokeWidth="1" />);
    });
  } else if (kind === 'alley') {
    scene.set.walls.forEach(([x], i) => {
      const d = polyC([W3(x, near, 0), W3(x, far + 8, 0), W3(x, far + 8, 9), W3(x, near, 9)], 24);
      d && bg.push(<polygon key={'aw' + i} points={d} fill="#17181c" stroke="#4d525c" strokeWidth="1" />);
      for (let y = Math.ceil(near / 2.5) * 2.5; y < far + 8; y += 2.5) {
        const ln = line3({ x, y }, 0, { x, y }, 9, 8);
        ln && bg.push(<polyline key={'awl' + i + y} points={ln} stroke="#2b2e35" strokeWidth="1" fill="none" />);
      }
    });
  } else if (kind === 'neon') {
    const d = polyC([W3(-30, scene.bgY, 0), W3(30, scene.bgY, 0), W3(30, scene.bgY, 7), W3(-30, scene.bgY, 7)], 20);
    d && bg.push(<polygon key="fac" points={d} fill="#15131b" stroke="#3f3a4d" />);
  } else if (kind === 'field') {
    const pts = [];
    for (let x = -80; x <= 80; x += 2) {
      const p = P({ x, y: scene.bgY }, 4 + Math.abs(Math.sin(x * 1.7)) * 3);
      if (p) pts.push(`${p.x},${p.y}`);
    }
    const l = P({ x: 80, y: scene.bgY }, 0), r = P({ x: -80, y: scene.bgY }, 0);
    if (l && r) bg.push(<polygon key="trees" points={`${pts.join(' ')} ${l.x},${l.y} ${r.x},${r.y}`} fill="#0f150d" opacity="0.9" />);
  } else if (kind === 'studio') {
    bg.push(<rect key="cyc" width={VW} height={VH} fill={`url(#${U('cycGrad')})`} />);
  }

  // practicals glows
  const pracs = scene.lights.filter((l) => l.role === 'practical' || l.role === 'bg').map((l, i) => {
    const h = { lamp: 1.1, streetlamp: 3.6, neon: 3.2 }[l.modifier] ?? 2;
    const p = P(l.pos, h);
    if (!p) return null;
    const r = clamp((0.25 * cam.f) / p.z / S.h * VH, 2, 40);
    const on = l.lit !== false;
    return (
      <g key={'pr' + i}>
        {on && <circle cx={p.x} cy={p.y} r={r * (l.modifier === 'neon' ? 5 : 3.2)} fill={l.color} opacity={l.stops < -1.5 ? 0.12 : 0.28} filter={`url(#${U('vfGlow')})`} />}
        {l.modifier === 'neon'
          ? <rect x={p.x - r * 2.5} y={p.y - r * 0.4} width={r * 5} height={r * 0.8} rx={r * 0.4} fill={on ? l.color : '#333'} />
          : <circle cx={p.x} cy={p.y} r={r * 0.6} fill={on ? l.color : '#333'} />}
      </g>
    );
  });

  // subjects, far → near
  const key = scene.lights.find((l) => l.role === 'key');
  const rim = scene.lights.find((l) => l.role === 'rim');
  const ratio = scene.readout.ratio;
  const sorted = [...subjects].map((s, i) => ({ s, i })).sort((a, b) => b.s.y - a.s.y);
  const figures = sorted.map(({ s, i }) => {
    const side = { x: Math.cos(s.facing + Math.PI / 2), y: Math.sin(s.facing + Math.PI / 2) };
    const at = (o, h) => P({ x: s.x + side.x * o, y: s.y + side.y * o }, h);
    const head = P(s, 1.62);
    if (!head) return null;
    const hr = (0.115 * cam.f) / head.z / S.h * VH;
    // torso as an elliptical cross-section: take the image-space x-extent of its outline at each height
    const fwd = { x: Math.cos(s.facing), y: Math.sin(s.facing) };
    const span = (h, w, d) => {
      const q = [[w, 0], [-w, 0], [0, d], [0, -d], [w * 0.7, d * 0.7], [-w * 0.7, -d * 0.7], [w * 0.7, -d * 0.7], [-w * 0.7, d * 0.7]]
        .map(([a, b]) => P({ x: s.x + side.x * a + fwd.x * b, y: s.y + side.y * a + fwd.y * b }, h)).filter(Boolean);
      if (!q.length) return null;
      const c = P(s, h);
      return c && { l: Math.min(...q.map((p) => p.x)), r: Math.max(...q.map((p) => p.x)), y: c.y };
    };
    const sh = span(1.46, 0.23, 0.12), hp = span(0.92, 0.17, 0.11);
    const torso = sh && hp ? `${sh.l},${sh.y} ${sh.r},${sh.y} ${hp.r},${hp.y} ${hp.l},${hp.y}` : null;
    const legs = [line3({ x: s.x + side.x * 0.1, y: s.y + side.y * 0.1 }, 0.92, { x: s.x + side.x * 0.12, y: s.y + side.y * 0.12 }, 0, 2),
      line3({ x: s.x - side.x * 0.1, y: s.y - side.y * 0.1 }, 0.92, { x: s.x - side.x * 0.12, y: s.y - side.y * 0.12 }, 0, 2)];
    const neck = P(s, 1.48);
    // lighting on the head: which side of the head (in image x) faces the key
    const keyFor = s.label === 'B' ? scene.lights.find((l) => l.role === 'key2') ?? key : key;
    const kp = keyFor.modifier === 'sun' ? { x: s.x + Math.cos(keyFor.az) * 50, y: s.y + Math.sin(keyFor.az) * 50 } : keyFor.pos;
    const kImg = P(kp, 1.62) ?? { x: kp.x > s.x ? VW * 4 : -VW * 4 };
    const litRight = kImg.x > head.x;
    const toCam = Math.atan2(cam.pos.y - s.y, cam.pos.x - s.x), toKey = Math.atan2(kp.y - s.y, kp.x - s.x);
    const off = Math.abs(Math.atan2(Math.sin(toKey - toCam), Math.cos(toKey - toCam))) / Math.PI; // 0 = frontal, 1 = from behind
    const term = clamp(1 - off, 0.05, 0.95);
    const gid = U(`hg${i}`);
    const blur = blurPx(head.z);
    const shade = clamp(1 / ratio, 0.04, 0.6);
    const kc = keyFor.color;
    return (
      <g key={'fig' + i} filter={blur > 0.6 ? `url(#${U(`b${Math.round(blur * 2)}`)})` : undefined} opacity={s.extra ? 0.75 : 1}>
        <defs>
          <linearGradient id={gid} x1={litRight ? 1 : 0} x2={litRight ? 0 : 1} y1="0" y2="0">
            <stop offset="0" stopColor={kc} stopOpacity="0.95" />
            <stop offset={term} stopColor={kc} stopOpacity="0.55" />
            <stop offset={Math.min(term + 0.12, 1)} stopColor="#000" stopOpacity={1 - shade} />
            <stop offset="1" stopColor="#000" stopOpacity={1 - shade} />
          </linearGradient>
        </defs>
        {legs.map((d, j) => d && <polyline key={j} points={d} stroke="#8f98a8" strokeWidth={Math.max(hr * 0.5, 1)} fill="none" strokeLinecap="round" />)}
        {torso && <polygon points={torso} fill="#262b34" stroke={s.extra ? '#6c7484' : '#c9d1dd'} strokeWidth="1.2" />}
        {neck && <line x1={neck.x} y1={neck.y} x2={head.x} y2={head.y} stroke="#8f98a8" strokeWidth={hr * 0.5} />}
        <circle cx={head.x} cy={head.y} r={hr} fill="#3b2f2a" />
        <circle cx={head.x} cy={head.y} r={hr} fill={`url(#${gid})`} stroke={s.extra ? '#6c7484' : '#e9eef5'} strokeWidth="1" />
        {rim && (
          <path d={`M${head.x + (litRight ? -1 : 1) * hr * 0.2},${head.y - hr} A${hr},${hr} 0 0,${litRight ? 0 : 1} ${head.x + (litRight ? -1 : 1) * hr},${head.y + hr * 0.2}`}
            stroke={rim.color} strokeWidth={Math.max(hr * 0.16, 1.2)} fill="none" opacity="0.9" />
        )}
        {!s.extra && (() => {
          const nose = P({ x: s.x + Math.cos(s.facing) * 0.14, y: s.y + Math.sin(s.facing) * 0.14 }, 1.6);
          return nose && <line x1={head.x} y1={head.y} x2={nose.x} y2={nose.y} stroke="#ffd479" strokeWidth="1.2" />;
        })()}
      </g>
    );
  });

  // fixtures that intrude on this frame of the move
  const intruders = (scene.move ? scene.move.conflictsAt(t) : []).filter((c) => c.kind !== 'shadow').map((c) => {
    const l = scene.lights.find((x) => x.id === c.id);
    if (!l) return null;
    const h = l.modifier === 'silk' ? 3.4 : fixtureHeight(l);
    const head = P(l.pos, h), foot = c.kind === 'stand' || h < 3.2 ? P(l.pos, 0.05) : null;
    if (!head) return null;
    const hx = clamp(head.x, 6, VW - 6), hy = clamp(head.y, 6, VH - 6);
    return (
      <g key={'in' + c.id}>
        {foot && <line x1={head.x} y1={head.y} x2={foot.x} y2={foot.y} stroke="#ff5a5f" strokeWidth="1.5" strokeDasharray="4 3" />}
        <rect x={hx - 7} y={hy - 7} width={14} height={14} fill="none" stroke="#ff5a5f" strokeWidth="2" />
        <text x={hx > VW / 2 ? hx - 10 : hx + 10} y={clamp(hy + 4, 12, VH - 4)} textAnchor={hx > VW / 2 ? 'end' : 'start'} className="vf-warn">{c.label.toUpperCase()}{c.kind === 'stand' ? ' STAND' : ''} IN SHOT</text>
      </g>
    );
  });
  const camShadow = scene.move && scene.move.conflictsAt(t).some((c) => c.kind === 'shadow');

  const blurLevels = [...new Set(subjects.map((s) => { const h = P(s, 1.62); return h ? Math.round(blurPx(h.z) * 2) : 0; }))];
  const r = metrics ?? scene.readout;
  const sky = SKY[time];
  const groundC = GROUND[scene.set.ground];

  const svgEl = (
      <svg viewBox={`0 0 ${VW} ${VH}`} className="vf" xmlns="http://www.w3.org/2000/svg" width={width} height={width ? (width * VH) / VW : undefined}>
        <defs>
          <linearGradient id={U('skyGrad')} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={sky[0]} /><stop offset="1" stopColor={sky[1]} />
          </linearGradient>
          <radialGradient id={U('cycGrad')} cx="0.5" cy="0.55" r="0.7"><stop offset="0" stopColor="#141518" /><stop offset="1" stopColor="#050506" /></radialGradient>
          <filter id={U('vfGlow')} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6" /></filter>
          <filter id={U('bgBlur')} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation={bgBlur} /></filter>
          {blurLevels.map((b) => (
            <filter key={b} id={U(`b${b}`)} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={b / 2} /></filter>
          ))}
          <clipPath id={U('vfClip')}><rect width={VW} height={VH} /></clipPath>
        </defs>
        <g clipPath={`url(#${U('vfClip')})`}>
          <g transform={`rotate(${-cam.dutch} ${VW / 2} ${VH / 2})`}>
            <rect x={-VW} y={-VH} width={VW * 3} height={VH * 3} fill={groundC} />
            {kind !== 'studio' && kind !== 'interior' && (
              <rect x={-VW} y={-VH * 2} width={VW * 3} height={Math.max(horizonY + VH * 2, 0)} fill={`url(#${U('skyGrad')})`} opacity={time === 'midnight' ? 0.6 : 0.85} />
            )}
            <g filter={bgBlur > 0.5 ? `url(#${U('bgBlur')})` : undefined}>
              {bg}
              {pracs}
            </g>
            {kind !== 'studio' && kind !== 'interior' && <line x1={-VW} x2={VW * 2} y1={horizonY} y2={horizonY} stroke="#ffffff" strokeOpacity="0.25" strokeDasharray="6 6" />}
            {figures}
            {intruders}
          </g>
          {soundLayer && scene.sound && (scene.sound.move ? scene.sound.move.plan !== 'lav' : scene.sound.primary !== 'lav') && (() => {
            const b = boomAt(scene.sound, t);
            if (!b || b.ok === false) return <text x={VW / 2} y={14} textAnchor="middle" className="vf-warn">BOOM OUT OF REACH — LAV</text>;
            const m = P({ x: b.mic.x, y: b.mic.y }, b.mic.z);
            const shadowPts = (b.bgPts ?? []).map((p) => P({ x: p.x, y: p.y }, p.z)).filter(Boolean);
            const mx = m ? clamp(m.x, 20, VW - 20) : VW / 2;
            return (
              <g>
                {shadowPts.length > 1 && <polyline points={shadowPts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#000" strokeOpacity="0.55" strokeWidth="5" />}
                {shadowPts.length > 0 && <text x={clamp(shadowPts[0].x + 8, 4, VW - 130)} y={clamp(shadowPts[0].y - 6, 12, VH - 4)} className="vf-warn">BOOM SHADOW</text>}
                <path d={b.from === 'above' ? `M${mx - 7},2 L${mx + 7},2 L${mx},11 Z` : `M${mx - 7},${VH - 2} L${mx + 7},${VH - 2} L${mx},${VH - 11} Z`} fill="#6ee7b7" />
                <text x={mx + 10} y={b.from === 'above' ? 12 : VH - 6} className="vf-snd">BOOM {b.from === 'above' ? '▲ above' : '▼ below'} frame · {fmt(b.dist, 2)} m</text>
              </g>
            );
          })()}
          {camShadow && <text x={VW / 2} y={VH - 10} textAnchor="middle" className="vf-warn">CAMERA SHADOW ON SUBJECT</text>}
          {/* overlays */}
          <g className="vf-thirds">
            {[1, 2].map((i) => <line key={'v' + i} x1={(VW * i) / 3} x2={(VW * i) / 3} y1={0} y2={VH} />)}
            {[1, 2].map((i) => <line key={'h' + i} y1={(VH * i) / 3} y2={(VH * i) / 3} x1={0} x2={VW} />)}
          </g>
          <path d={`M${VW / 2 - 8},${VH / 2} h16 M${VW / 2},${VH / 2 - 8} v16`} stroke="#fff" strokeOpacity="0.5" />
          <rect x={VW * 0.05} y={VH * 0.05} width={VW * 0.9} height={VH * 0.9} fill="none" stroke="#fff" strokeOpacity="0.18" strokeDasharray="4 4" />
        </g>
        <rect width={VW} height={VH} fill="none" stroke="#e9eef5" strokeWidth="2" />
      </svg>
  );
  if (bare) return svgEl;
  return (
    <div className="vf-wrap">
      {svgEl}
      <div className="vf-hud">
        <span className="vf-lens">{fmt(cam.f, 0)}mm · f/{cam.N} · {scene.inp.aspect}{S.squeeze > 1 ? ' · de-squeezed' : ''}</span>
        <Tip term="tilt"><span>tilt {r.tiltDeg >= 0 ? '+' : ''}{fmt(r.tiltDeg)}°</span></Tip>
        {Math.abs(cam.dutch) > 0.3 ? <Tip term="dutch"><span>dutch {fmt(cam.dutch)}°</span></Tip> : null}
        <Tip term="negSpace"><span>space {fmt(r.negSpace, 0)}%</span></Tip>
        <Tip term="headroom"><span>headroom {fmt(r.headroom, 0)}%</span></Tip>
      </div>
      {transport}
    </div>
  );
}
