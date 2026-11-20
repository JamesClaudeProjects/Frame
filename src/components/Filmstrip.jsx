import React, { useMemo, useRef } from 'react';
import Viewfinder from './Viewfinder.jsx';
import { fmt } from '../engine/engine.js';

const FRAMES = [0, 0.25, 0.5, 0.75, 1];

// Storyboard: the move rendered through the lens at evenly spaced beats, with the numbers
// a crew needs on each panel. Panels are real projections, not thumbnails of the live view.
export default function Filmstrip({ scene, t, onSeek }) {
  const move = scene.move;
  const stripRef = useRef(null);
  const frames = useMemo(() => FRAMES.map((ft) => {
    const m = move.metricsAt(ft);
    const conflicts = move.conflictsAt(ft);
    return {
      t: ft, cam: move.poseAt(ft), subjects: move.subjectsAt(ft), m,
      warn: conflicts.map((c) => (c.kind === 'shadow' ? 'cam shadow' : `${c.label.toLowerCase()}${c.kind === 'stand' ? ' stand' : ''} in shot`)),
    };
  }), [move]);
  const caption = (f) => [
    `${fmt(f.t * move.duration, 1)}s`,
    `${fmt(f.cam.f, 0)}mm`,
    `${fmt(f.m.dist, 2)}m`,
    `↕${fmt(f.cam.height, 2)}m`,
    `face ${fmt(f.m.faceSize, 0)}%`,
  ].join(' · ');
  const extra = (f) => {
    const bits = [];
    if (Math.abs(f.m.keyStops) > 0.25) bits.push(`key ${f.m.keyStops > 0 ? '+' : ''}${fmt(f.m.keyStops, 1)} st`);
    if (move.rack) bits.push(`focus ${fmt(f.cam.focus, 2)}m`);
    bits.push(`key↔lens ${fmt(f.m.keyOff, 0)}°`);
    const sm = scene.sound?.move?.samples;
    if (sm) { const x = sm[Math.round(f.t * (sm.length - 1))]; bits.push(x.ok ? `🎙 ${fmt(x.snr, 0)} dB` : '🎙 lav'); }
    return bits.join(' · ');
  };
  const nearest = FRAMES.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), 0);
  const title = `${move.auto ? 'AUTO → ' : ''}${move.label.toUpperCase()} · ${fmt(move.duration, 1)} s · ${move.support}`;

  // Compose one standalone SVG: each panel's own <svg> nested at its slot, plus captions.
  const buildSVG = () => {
    const panels = [...stripRef.current.querySelectorAll('.fs-panel svg')];
    const pw = 360, ph = Math.round(pw / scene.readout.sensor.ratio), gap = 16, top = 46, capH = 44;
    const W = gap + FRAMES.length * (pw + gap), H = top + ph + capH + gap;
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
      + '<style>.vf-grid{stroke:#fff;stroke-opacity:.07;fill:none}.vf-thirds line{stroke:#fff;stroke-opacity:.22}.vf-warn{font:600 10px monospace;fill:#ff5a5f;paint-order:stroke;stroke:#000;stroke-width:3px}</style>'
      + `<rect width="${W}" height="${H}" fill="#0b0c0f"/>`
      + `<text x="${gap}" y="26" font-family="monospace" font-size="14" fill="#f5b041" letter-spacing="2">${esc(title)}</text>`
      + `<text x="${W - gap}" y="26" text-anchor="end" font-family="monospace" font-size="11" fill="#8a92a1">${esc(`${scene.inp.focal}mm f/${scene.inp.aperture} · ${scene.inp.aspect} · ${scene.inp.tone} · ${scene.inp.env} · seed ${scene.inp.seed}`)}</text>`;
    panels.forEach((el, i) => {
      const x = gap + i * (pw + gap);
      const src = new XMLSerializer().serializeToString(el)
        .replace(/^<svg([^>]*?)\swidth="[^"]*"/, '<svg$1')
        .replace(/^<svg([^>]*?)\sheight="[^"]*"/, '<svg$1')
        .replace(/^<svg/, `<svg x="${x}" y="${top}" width="${pw}" height="${ph}"`);
      const f = frames[i];
      out += src
        + `<text x="${x}" y="${top + ph + 16}" font-family="monospace" font-size="11" fill="#e6e9ef">${esc(`${i + 1}. ${caption(f)}`)}</text>`
        + `<text x="${x}" y="${top + ph + 30}" font-family="monospace" font-size="10" fill="#8a92a1">${esc(extra(f))}</text>`
        + (f.warn.length ? `<text x="${x}" y="${top + ph + 43}" font-family="monospace" font-size="10" fill="#ff7a7e">${esc('⚠ ' + f.warn.join(', '))}</text>` : '');
    });
    return { svg: out + '</svg>', W, H };
  };
  const fileBase = `storyboard-${move.type}-${scene.inp.tone}-${scene.inp.focal}mm-s${scene.inp.seed}`;
  const download = (href, name) => { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); };
  const exportSVG = () => {
    const { svg } = buildSVG();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    download(url, `${fileBase}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportPNG = () => {
    const { svg, W, H } = buildSVG();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = W * 2; c.height = H * 2;
      const ctx = c.getContext('2d');
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      c.toBlob((b) => { const u = URL.createObjectURL(b); download(u, `${fileBase}.png`); setTimeout(() => URL.revokeObjectURL(u), 1000); });
    };
    img.src = url;
  };

  return (
    <div className="filmstrip">
      <div className="fs-head">
        <span className="dim">{title}</span>
        <span className="fs-actions">
          <button type="button" onClick={exportSVG}>⤓ SVG</button>
          <button type="button" onClick={exportPNG}>⤓ PNG</button>
        </span>
      </div>
      <div className="fs-row" ref={stripRef}>
        {frames.map((f, i) => (
          <button type="button" key={f.t} className={`fs-panel${nearest === f.t ? ' on' : ''}`} onClick={() => onSeek(f.t)} title="Jump to this frame">
            <Viewfinder scene={scene} cam={f.cam} subjects={f.subjects} t={f.t} uid={`fs${i}`} bare />
            <div className="fs-cap"><b>{i + 1}</b> {caption(f)}</div>
            <div className="fs-cap dim">{extra(f)}</div>
            {f.warn.length > 0 && <div className="fs-cap warn">⚠ {f.warn.join(', ')}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
