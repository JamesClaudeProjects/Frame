import React, { useEffect, useMemo, useRef, useState } from 'react';
import { compute, fmt } from './engine/engine.js';
import { TIMES, ENVS, TONES, BLOCKING, SENSORS, APERTURES } from './engine/tables.js';
import FlatLay from './components/FlatLay.jsx';
import Viewfinder from './components/Viewfinder.jsx';
import Readout from './components/Readout.jsx';
import { MOVES, SUPPORTS } from './engine/move.js';
import Filmstrip from './components/Filmstrip.jsx';
import { Section, Tip, More, usePersist } from './components/ui.jsx';

const FOCAL_MARKS = [14, 18, 24, 35, 50, 85, 135];

function Seg({ label, value, options, onChange, term }) {
  return (
    <div className="ctl">
      <div className="ctl-label">{term ? <Tip term={term}>{label}</Tip> : label}</div>
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
    move: 'auto', moveAmt: 0.6, moveDur: null, support: 'auto',
  });
  const LAYER_DEFAULTS = { fov: true, dof: true, beams: true, shadows: true, guides: true, labels: true, details: false, sound: false };
  const [layersRaw, setLayers] = usePersist('layers', LAYER_DEFAULTS);
  const layers = { ...LAYER_DEFAULTS, ...layersRaw }; // new layers appear for returning users
  const [notesOpen, setNotesOpen] = useState(false);
  const set = (k) => (v) => setInp((s) => ({ ...s, [k]: v }));
  const scene = useMemo(() => compute(inp), [inp]);
  const move = scene.move;

  // --- playback: t ∈ [0, 1] across the move's real duration
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setT(0); setPlaying(false); }, [inp.move, move.type]);
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
  const subjectsNow = useMemo(() => move.subjectsAt(t), [move, t]);
  const moving = move.type !== 'static' || move.support !== 'dolly';
  const moveName = `${move.auto ? 'Auto → ' : ''}${move.label}${move.support !== 'dolly' ? ` · ${SUPPORTS[move.support]}` : ''}`;
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
          <span>{inp.focal}mm f/{inp.aperture}</span><span>{inp.aspect}</span>{moving && <span>{moveName}</span>}
        </div>
      </header>

      <main className="grid">
        <aside className="panel controls">
          <div className="variation">
            <button className="primary" type="button" onClick={() => setInp((s) => ({ ...s, seed: s.seed + 1 }))}>
              ↻ Generate New Variation
            </button>
            <div className="seed"><Tip term="variation">variation #{inp.seed}</Tip> · mood rules held</div>
          </div>

          <Section id="c-scene" title="Scene" summary={`${TIMES[inp.time].label} · ${ENVS[inp.env].label.split(' · ').pop()} · ${TONES[inp.tone].label.split(' / ')[0]}`}>
            <Seg label="Time of Day" term="time" value={inp.time} options={TIMES} onChange={set('time')} />
            <Seg label="Environment" term="env" value={inp.env} options={ENVS} onChange={set('env')} />
            <Seg label="Blocking" term="blocking" value={inp.blocking} options={BLOCKING} onChange={set('blocking')} />
            <Seg label="Emotional Tone" term="tone" value={inp.tone} options={TONES} onChange={set('tone')} />
          </Section>

          <Section id="c-lens" title="Lens" summary={`${inp.focal}mm · f/${inp.aperture} · ${inp.aspect}`}>
            <div className="ctl">
              <div className="ctl-label"><Tip term="focal">Focal Length</Tip> <b>{inp.focal}mm</b></div>
              <input type="range" min={14} max={135} step={1} value={inp.focal} onChange={(e) => set('focal')(+e.target.value)} list="focal-marks" aria-label="Focal length" />
              <datalist id="focal-marks">{FOCAL_MARKS.map((m) => <option key={m} value={m} />)}</datalist>
              <div className="marks">{FOCAL_MARKS.map((m) => <button type="button" key={m} onClick={() => set('focal')(m)} className={inp.focal === m ? 'on' : ''}>{m}</button>)}</div>
            </div>
            <div className="ctl">
              <div className="ctl-label"><Tip term="aperture">Aperture</Tip> <b>f/{inp.aperture}</b></div>
              <input type="range" min={0} max={APERTURES.length - 1} step={1} value={apIdx} onChange={(e) => set('aperture')(APERTURES[+e.target.value])} aria-label="Aperture" />
              <div className="marks">{[1.4, 2, 2.8, 4, 5.6, 8, 11, 16].map((m) => <button type="button" key={m} onClick={() => set('aperture')(m)} className={inp.aperture === m ? 'on' : ''}>{m}</button>)}</div>
            </div>
            <Seg label="Aspect Ratio" term="aspect" value={inp.aspect} options={Object.fromEntries(Object.keys(SENSORS).map((k) => [k, k]))} onChange={set('aspect')} />
          </Section>

          <Section id="c-move" title="Camera Move" summary={`${move.auto ? 'Auto → ' : ''}${move.label}${moving ? ` · ${fmt(move.duration, 0)} s` : ''}`}>
            <Seg label="Move" term="move" value={inp.move} options={MOVES} onChange={set('move')} />
            {move.auto && (
              <div className="auto-pick">
                <Tip term="move" extra={`Odds for this mood: ${move.auto.odds.join(', ')}.${move.auto.why.length ? ` Weighted because ${move.auto.why.join(', and ')}.` : ''}`}>
                  <span>→ {move.label}</span>
                </Tip>
              </div>
            )}
            <Seg label="Camera Support" term="support" value={inp.support} options={SUPPORTS} onChange={set('support')} />
            {['push', 'pull', 'truck', 'pedestal', 'arc', 'zoom', 'follow'].includes(move.type) && (
              <div className="ctl">
                <div className="ctl-label">
                  <Tip term="travel">{{ pedestal: 'Vertical range', arc: 'Orbit sweep', zoom: 'Zoom ratio', follow: 'Walk distance' }[move.type] ?? 'Travel'}</Tip>{' '}
                  <b>{move.type === 'pedestal' ? `${fmt(move.lift, 2)} m` : move.type === 'arc' ? `${fmt((move.arc.sweep * 180) / Math.PI, 0)}° · ${fmt(move.travel, 2)} m` : move.type === 'zoom' ? `${fmt(move.zoom.fStart, 0)}→${fmt(move.zoom.fEnd, 0)}mm` : move.type === 'follow' ? `${fmt(move.follow.walk, 2)} m` : `${fmt(move.travel, 2)} m`}</b>
                </div>
                <input type="range" min={0} max={100} value={Math.round(inp.moveAmt * 100)} onChange={(e) => set('moveAmt')(+e.target.value / 100)} aria-label="Move size" />
              </div>
            )}
            {moving && (
              <div className="ctl">
                <div className="ctl-label"><Tip term="shotLength">Shot length</Tip> <b>{fmt(move.duration, 1)} s{inp.moveDur == null ? ' · auto' : ''}</b></div>
                <input type="range" min={2} max={20} step={0.5} value={move.duration} onChange={(e) => set('moveDur')(+e.target.value)} aria-label="Shot length" />
                {inp.moveDur != null && <div className="marks"><button type="button" onClick={() => set('moveDur')(null)}>reset to mood default</button></div>}
              </div>
            )}
          </Section>

          <Section id="c-layers" title="Plot layers & export" summary={`${Object.values(layers).filter(Boolean).length} of ${Object.keys(layers).length} layers on`} defaultOpen={false}>
            <div className="toggles">
              {Object.keys(layers).map((k) => (
                <label key={k}><input type="checkbox" checked={layers[k]} onChange={() => setLayers((l) => ({ ...l, [k]: !l[k] }))} />{k}</label>
              ))}
            </div>
            <p className="hint">“details” adds second label lines, shadow sizes and the full camera tag. Hover any fixture on the plot for its full spec.</p>
            <button className="ghost" type="button" onClick={exportSVG}>⤓ Export plot (SVG)</button>
          </Section>
        </aside>

        <section className="panel canvas">
          <FlatLay ref={svgRef} scene={scene} layers={layers} cam={pose} t={t} subjects={subjectsNow} />
          {(() => {
            const conflictNotes = new Set(move.conflicts.map((c) => c.note));
            const all = [...new Set([...scene.notes, ...move.notes])];
            const warn = all.filter((n) => conflictNotes.has(n) || /180°/.test(n));
            const info = all.filter((n) => !warn.includes(n));
            if (!all.length) return null;
            return (
              <div className="notes">
                <button type="button" className="notes-toggle" aria-expanded={notesOpen} onClick={() => setNotesOpen(!notesOpen)}>
                  <span className="chev" aria-hidden="true" />
                  {warn.length > 0 && <span className="n-warn">⚠ {warn.length} in-shot / continuity {warn.length === 1 ? 'issue' : 'issues'}</span>}
                  {info.length > 0 && <span className="n-info">⚑ {info.length} rigging {info.length === 1 ? 'note' : 'notes'}</span>}
                </button>
                {notesOpen && (
                  <ul className="notes-list">
                    {warn.map((n) => <li key={n} className="n-warn">⚠ {n}</li>)}
                    {info.map((n) => <li key={n}>⚑ {n}</li>)}
                  </ul>
                )}
              </div>
            );
          })()}
        </section>

        <aside className="panel side">
          <h2 className="panel-title">Through the Lens</h2>
          <Viewfinder scene={scene} cam={pose} metrics={moving ? metrics : null} transport={transport} t={t} subjects={subjectsNow} soundLayer={!!layers.sound} />
          <Readout scene={scene} move={move} metrics={metrics} t={t} soundLayer={!!layers.sound} onSoundLayer={() => setLayers((l) => ({ ...l, sound: !l.sound }))} />
        </aside>

        {moving && (
          <section className="panel board">
            <Section id="m-board" title="Storyboard" summary={`5 frames · ${move.auto ? 'Auto → ' : ''}${move.label}`}>
              <Filmstrip scene={scene} t={t} onSeek={(v) => { setPlaying(false); setT(v); }} />
            </Section>
          </section>
        )}

        <section className="panel theory">
          <Section id="m-theory" title="Why This Works" summary={scene.theory.map((p) => p.h).join(' · ')}>
            <div className="theory-grid">
              {scene.theory.map((p) => {
                // Lede = first sentence, or first two if the first is too short to say anything.
                const re = /[.!?]\s+(?=[A-Z“"(])/g;
                let cut = -1, mm;
                while ((mm = re.exec(p.t))) { cut = mm.index + 1; if (cut >= 70) break; }
                const lede = cut > 0 ? p.t.slice(0, cut) : p.t;
                const rest = cut > 0 ? p.t.slice(cut).trim() : '';
                return (
                  <article key={p.h}>
                    <h3>{p.h}</h3>
                    <p>{lede}{rest && <> <More label="read more" lessLabel="show less"><span>{rest} </span></More></>}</p>
                  </article>
                );
              })}
            </div>
            <div className="foot">
              FOV = 2·atan(w / 2f) with w = {fmt(scene.readout.sensor.w, 2)} mm ·
              DoF via hyperfocal H = f²/(N·c) + f, c = 0.025 mm ·
              exposure E = 250·N² / (t·ISO), ISO 800, 1/48 s
            </div>
          </Section>
        </section>
      </main>
    </div>
  );
}
