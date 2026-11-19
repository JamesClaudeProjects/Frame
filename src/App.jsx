import React, { useEffect, useMemo, useRef, useState } from 'react';
import { compute, fmt } from './engine/engine.js';
import { TIMES, ENVS, TONES, BLOCKING, SENSORS, APERTURES } from './engine/tables.js';
import FlatLay from './components/FlatLay.jsx';
import Viewfinder from './components/Viewfinder.jsx';
import Readout from './components/Readout.jsx';
import { MOVES } from './engine/move.js';

const FOCAL_MARKS = [14, 18, 24, 35, 50, 85, 135];

function Seg({ label, value, options, onChange, hint }) {
  return (
    <div className="ctl">
      <div className="ctl-label">{label}{hint && <span className="ctl-hint">{hint}</span>}</div>
      <div className="seg">
        {Object.entries(options).map(([k, o]) => (
          <button key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)} type="button">
            {typeof o === 'string' ? o : o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [inp, setInp] = useState({
    time: 'golden', env: 'interior', blocking: 'one', tone: 'melancholy',
    focal: 50, aperture: 2, aspect: '2.39:1', seed: 1,
    move: 'push', moveAmt: 0.6, moveDur: null,
  });
  const [layers, setLayers] = useState({ fov: true, dof: true, beams: true, shadows: true, guides: true, labels: true });
  const set = (k) => (v) => setInp((s) => ({ ...s, [k]: v }));
  const scene = useMemo(() => compute(inp), [inp]);
  const move = scene.move;

  // --- playback: t ∈ [0, 1] across the move's real duration
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setT(0); setPlaying(false); }, [inp.move]);
  const tRef = useRef(0);
  tRef.current = t;
  useEffect(() => {
    if (!playing) return undefined;
    let raf, last = performance.now();
    const tick = (now) => {
      const n = Math.min(tRef.current + (now - last) / 1000 / move.duration, 1);
      last = now;
      tRef.current = n;
      setT(n);
      if (n >= 1) setPlaying(false); else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, move]);
  const pose = useMemo(() => move.poseAt(t), [move, t]);
  const metrics = useMemo(() => move.metricsAt(t), [move, t]);
  const moving = move.type !== 'static';
  const play = () => { if (t >= 1) setT(0); setPlaying((p) => !p); };
  const transport = moving && (
    <div className="transport">
      <button type="button" onClick={() => { setPlaying(false); setT(0); }} title="Start mark">⏮</button>
      <button type="button" className="play" onClick={play} title="Play / pause">{playing ? '❚❚' : '▶'}</button>
      <button type="button" onClick={() => { setPlaying(false); setT(1); }} title="End mark">⏭</button>
      <input type="range" min={0} max={1000} value={Math.round(t * 1000)} onChange={(e) => { setPlaying(false); setT(+e.target.value / 1000); }} aria-label="Scrub move" />
      <span className="tc">{fmt(t * move.duration, 1)}s / {fmt(move.duration, 0)}s</span>
    </div>
  );
  const svgRef = useRef(null);
  const apIdx = APERTURES.indexOf(inp.aperture);

  const exportSVG = () => {
    const src = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([src], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lighting-plot-${inp.time}-${inp.env}-${inp.tone}-${inp.focal}mm-s${inp.seed}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="rec" />
          <h1>Flat-Lay<span>/</span>Lighting Plot Generator</h1>
        </div>
        <div className="top-meta">
          <span>{TIMES[inp.time].label}</span><span>{ENVS[inp.env].label}</span><span>{TONES[inp.tone].label}</span>
          <span>{inp.focal}mm f/{inp.aperture}</span><span>{inp.aspect}</span>{moving && <span>{move.label}</span>}
        </div>
      </header>

      <main className="grid">
        <aside className="panel controls">
          <h2>Cinematography Matrix</h2>
          <Seg label="Time of Day" hint="sun · ambient K" value={inp.time} options={TIMES} onChange={set('time')} />
          <Seg label="Environment" hint="bounce · practicals" value={inp.env} options={ENVS} onChange={set('env')} />
          <Seg label="Blocking" hint="placement · eyelines" value={inp.blocking} options={BLOCKING} onChange={set('blocking')} />
          <Seg label="Emotional Tone" hint="ratio · height · space" value={inp.tone} options={TONES} onChange={set('tone')} />

          <h2>Optical Package</h2>
          <div className="ctl">
            <div className="ctl-label">Focal Length <b>{inp.focal}mm</b></div>
            <input type="range" min={14} max={135} step={1} value={inp.focal} onChange={(e) => set('focal')(+e.target.value)} list="focal-marks" />
            <datalist id="focal-marks">{FOCAL_MARKS.map((m) => <option key={m} value={m} />)}</datalist>
            <div className="marks">{FOCAL_MARKS.map((m) => <button type="button" key={m} onClick={() => set('focal')(m)} className={inp.focal === m ? 'on' : ''}>{m}</button>)}</div>
          </div>
          <div className="ctl">
            <div className="ctl-label">Aperture <b>f/{inp.aperture}</b></div>
            <input type="range" min={0} max={APERTURES.length - 1} step={1} value={apIdx} onChange={(e) => set('aperture')(APERTURES[+e.target.value])} />
            <div className="marks">{[1.4, 2, 2.8, 4, 5.6, 8, 11, 16].map((m) => <button type="button" key={m} onClick={() => set('aperture')(m)} className={inp.aperture === m ? 'on' : ''}>{m}</button>)}</div>
          </div>
          <Seg label="Aspect Ratio" value={inp.aspect} options={Object.fromEntries(Object.keys(SENSORS).map((k) => [k, k]))} onChange={set('aspect')} />

          <h2>Camera Move</h2>
          <Seg label="Move" hint="pose over time" value={inp.move} options={MOVES} onChange={set('move')} />
          {['push', 'pull', 'truck', 'pedestal'].includes(inp.move) && (
            <div className="ctl">
              <div className="ctl-label">{inp.move === 'pedestal' ? 'Vertical range' : 'Travel'} <b>{inp.move === 'pedestal' ? `${fmt(move.lift, 2)} m` : `${fmt(move.travel, 2)} m`}</b></div>
              <input type="range" min={0} max={100} value={Math.round(inp.moveAmt * 100)} onChange={(e) => set('moveAmt')(+e.target.value / 100)} />
            </div>
          )}
          {moving && (
            <div className="ctl">
              <div className="ctl-label">Shot length <b>{fmt(move.duration, 1)} s{inp.moveDur == null ? ' · auto' : ''}</b></div>
              <input type="range" min={2} max={20} step={0.5} value={move.duration} onChange={(e) => set('moveDur')(+e.target.value)} />
              {inp.moveDur != null && <div className="marks"><button type="button" onClick={() => set('moveDur')(null)}>reset to tone default</button></div>}
            </div>
          )}

          <button className="primary" type="button" onClick={() => setInp((s) => ({ ...s, seed: s.seed + 1 }))}>
            ↻ Generate New Variation
          </button>
          <div className="seed">variation #{inp.seed} · mood rules held constant</div>

          <h2>Layers</h2>
          <div className="toggles">
            {Object.keys(layers).map((k) => (
              <label key={k}><input type="checkbox" checked={layers[k]} onChange={() => setLayers((l) => ({ ...l, [k]: !l[k] }))} />{k}</label>
            ))}
          </div>
          <button className="ghost" type="button" onClick={exportSVG}>⤓ Export plot (SVG)</button>
        </aside>

        <section className="panel canvas">
          <FlatLay ref={svgRef} scene={scene} layers={layers} cam={pose} />
          {scene.notes.length + move.notes.length > 0 && (
            <div className="notes">{[...scene.notes, ...move.notes].map((n, i) => <span key={i}>⚑ {n}</span>)}</div>
          )}
        </section>

        <aside className="panel side">
          <h2>Through the Lens</h2>
          <Viewfinder scene={scene} cam={pose} metrics={moving ? metrics : null} transport={transport} />
          <Readout scene={scene} move={move} metrics={metrics} />
        </aside>

        <section className="panel theory">
          <h2>Why This Works</h2>
          <div className="theory-grid">
            {scene.theory.map((p) => (
              <article key={p.h}><h3>{p.h}</h3><p>{p.t}</p></article>
            ))}
          </div>
          <div className="foot">
            FOV = 2·atan(w / 2f) with w = {fmt(scene.readout.sensor.w, 2)} mm ·
            DoF via hyperfocal H = f²/(N·c) + f, c = 0.025 mm ·
            exposure E = 250·N² / (t·ISO), ISO 800, 1/48 s
          </div>
        </section>
      </main>
    </div>
  );
}
