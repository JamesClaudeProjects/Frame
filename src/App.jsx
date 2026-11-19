import React, { useMemo, useRef, useState } from 'react';
import { compute, fmt } from './engine/engine.js';
import { TIMES, ENVS, TONES, BLOCKING, SENSORS, APERTURES } from './engine/tables.js';
import FlatLay from './components/FlatLay.jsx';
import Viewfinder from './components/Viewfinder.jsx';
import Readout from './components/Readout.jsx';

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
  });
  const [layers, setLayers] = useState({ fov: true, dof: true, beams: true, shadows: true, guides: true, labels: true });
  const set = (k) => (v) => setInp((s) => ({ ...s, [k]: v }));
  const scene = useMemo(() => compute(inp), [inp]);
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
          <span>{inp.focal}mm f/{inp.aperture}</span><span>{inp.aspect}</span>
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
          <FlatLay ref={svgRef} scene={scene} layers={layers} />
          {scene.notes.length > 0 && (
            <div className="notes">{scene.notes.map((n, i) => <span key={i}>⚑ {n}</span>)}</div>
          )}
        </section>

        <aside className="panel side">
          <h2>Through the Lens</h2>
          <Viewfinder scene={scene} />
          <Readout scene={scene} />
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
