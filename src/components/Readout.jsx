import React from 'react';
import { fmt } from '../engine/engine.js';
import { Section, Tip } from './ui.jsx';
import { boomAt } from '../engine/sound.js';

const Sw = ({ c }) => <i className="sw" style={{ background: c }} />;
const dofStr = (d) => (d.total < 1 ? `${fmt(d.total * 100, 0)} cm` : Number.isFinite(d.total) ? `${fmt(d.total, 2)} m` : '∞');

// Headline first (ratio + colour chips), everything else in collapsible sections that
// show a one-line summary while closed. Each label carries a hover tag.
export default function Readout({ scene, move, metrics, soundLayer, onSoundLayer, t = 0 }) {
  const r = scene.readout;
  const L = scene.lights;
  const key = L.find((l) => l.role === 'key');
  const rim = L.find((l) => l.role === 'rim');
  const fill = L.find((l) => l.role === 'fill');
  const neg = L.find((l) => l.role === 'neg');
  const pr = L.filter((l) => l.role === 'practical' && l.lit);
  const softTxt = r.key.soft > 0.6 ? 'soft' : r.key.soft > 0.25 ? 'semi-soft' : r.key.soft > 0.05 ? 'crisp' : 'hard';
  const moving = move && (move.type !== 'static' || move.support !== 'dolly');
  const warnings = move ? [...move.conflicts.map((c) => c.note), ...(move.lineCross ? [`Crosses the 180° line at ${fmt(move.lineCross.t * move.duration, 1)} s`] : [])] : [];
  const ratioRead = r.ratio >= 6 ? 'chiaroscuro — the shadow side falls toward black' : r.ratio >= 3 ? 'sculpted but readable' : 'open and soft';

  const moveRows = moving ? [
    ['dist', 'Distance', (m) => `${fmt(m.dist, 2)} m`],
    ...(move.type === 'zoom' ? [['focal', 'Focal', (m) => `${fmt(m.f, 0)}mm`], ['fov', 'H FOV', (m) => `${fmt(m.fovH, 0)}°`]] : []),
    ['faceSize', 'Face size', (m) => `${fmt(m.faceSize, 0)}%`],
    ['keyOff', 'Key ↔ lens', (m) => `${fmt(m.keyOff, 0)}°`],
    ...(move.type === 'follow' ? [['keyStops', 'Key level', (m) => `${m.keyStops >= 0 ? '+' : ''}${fmt(m.keyStops, 1)} st`]] : []),
    ['camera', 'Lens height', (m) => `${fmt(m.height, 2)} m`],
    ['tilt', 'Tilt', (m) => `${fmt(m.tiltDeg)}°`],
    ['dist', 'Focus', (m) => `${fmt(m.focus, 2)} m`],
    ['dof', 'DoF', (m) => dofStr(m.dof)],
    ['negSpace', 'Neg. space', (m) => `${fmt(m.negSpace, 0)}%`],
    ['bgScale', 'BG scale', (m) => `${fmt(m.bgScale * 100, 0)}%`],
  ] : [];

  return (
    <div className="readout">
      {/* Headline: contrast */}
      <div className="ratio-row">
        <div className="ratio">
          <Tip term="ratio" extra={`Here: the lit side is ${fmt(r.stops)} stops brighter than the shadow side — ${ratioRead}.`}>
            <span className="big">{r.ratioStr}</span>
          </Tip>
          <div className="cap">Key : Fill</div>
        </div>
        <div className="ratio-meter">
          <div className="rm-bar" aria-hidden="true">
            <span style={{ left: `${Math.min(r.stops / 5, 1) * 100}%` }} className="rm-t" />
            <span style={{ left: `${Math.min(Math.log2(r.naturalRatio) / 5, 1) * 100}%` }} className="rm-n" />
          </div>
          <div className="rm-cap">
            <span className="rm-tl">◆ target {r.ratioStr}</span>
            <Tip term="natural" extra={r.fillPlan.neg ? 'Here the target is higher, so a black flag takes light away.' : r.fillPlan.add ? 'Here the target is lower, so fill is added.' : 'Here the location already matches.'}>
              <span className="rm-nl">◇ natural {fmt(r.naturalRatio)}:1</span>
            </Tip>
          </div>
        </div>
      </div>

      {/* Headline: colour chips */}
      <div className="chips">
        <Tip term="key" extra={`${key.name}${key.motivation ? ` — motivated by ${key.motivation}` : ''}.`}>
          <span className="chip"><Sw c={key.color} />Key {r.key.k} <span className="dim">{softTxt}</span></span>
        </Tip>
        <Tip term="fill" extra={fill ? fill.name : neg ? neg.name : 'No fill unit: the room’s bounce is enough.'}>
          <span className="chip">{fill ? <><Sw c={fill.color} />Fill {r.fill}</> : neg ? <><Sw c="#000" />Fill negative</> : <>Fill ambient</>}</span>
        </Tip>
        {rim && (
          <Tip term="rim" extra={rim.name}>
            <span className="chip"><Sw c={rim.color} />Rim {r.rim}</span>
          </Tip>
        )}
        {pr.length > 0 && (
          <Tip term="practical" extra={`${pr.length} lit in frame: ${[...new Set(pr.map((p) => p.name))].join(', ')}.`}>
            <span className="chip"><Sw c={pr[0].color} />Prac {pr[0].gel ? 'neon' : pr[0].kelvin + 'K'}{pr.length > 1 ? ` ×${pr.length}` : ''}</span>
          </Tip>
        )}
        <Tip term="wb" extra={`Tone push on artificial units: ${r.gelPush.name}.`}>
          <span className="chip chip-dim">WB {r.wb}K</span>
        </Tip>
      </div>

      {warnings.length > 0 && (
        <div className="alert" role="status">
          <Tip term="inShot">
            <span>⚠ {warnings.length} rigging {warnings.length === 1 ? 'issue' : 'issues'} during the move</span>
          </Tip>
          <span className="dim"> — open “Camera move” for fixes</span>
        </div>
      )}

      {scene.sound.warnings.length > 0 && (
        <div className="alert alert-sound" role="status">
          <Tip term="sound"><span>🎙 {scene.sound.warnings.length} sound {scene.sound.warnings.length === 1 ? 'issue' : 'issues'}</span></Tip>
          <span className="dim"> — open “Sound” below</span>
        </div>
      )}

      <SoundSection s={scene.sound} soundLayer={soundLayer} onSoundLayer={onSoundLayer} t={t} duration={move?.duration} />

      {moving && (
        <Section
          id="r-move"
          title={`Camera move · ${move.auto ? 'Auto → ' : ''}${move.label}`}
          summary={`${fmt(move.duration, 1)} s${move.travel > 0.05 ? ` · ${fmt(move.travel, 1)} m` : ''}${move.support !== 'dolly' ? ` · ${move.support}` : ''}`}
          defaultOpen={false}
        >
          <table className="stats move-table">
            <thead><tr><th /><th>start</th><th>now</th><th>end</th></tr></thead>
            <tbody>
              {moveRows.map(([term, label, f]) => (
                <tr key={label}><th><Tip term={term}>{label}</Tip></th><td className="dim">{f(move.start)}</td><td>{f(metrics)}</td><td className="dim">{f(move.end)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="move-meta">
            <Tip term="speed"><span>peak {fmt(move.speedPeak, 2)} m/s</span></Tip>
          </div>
          {move.gear.map((g) => <div key={g} className="move-gear">⚙ {g}</div>)}
          {warnings.map((w) => <div key={w} className="move-warn">⚠ {w}</div>)}
        </Section>
      )}

      <Section
        id="r-lens"
        title="Lens & exposure"
        summary={`${fmt(r.fovH, 0)}° view · DoF ${dofStr(r.dof)}${r.ndText && r.ndText.startsWith('ND') ? ` · ${r.ndText.split(' (')[0]}` : ''}`}
        defaultOpen={false}
      >
        <table className="stats">
          <tbody>
            <tr><th><Tip term="fov">View (H × V)</Tip></th><td>{fmt(r.fovH)}° × {fmt(r.fovV)}°</td><th><Tip term="ffEq">FF equiv.</Tip></th><td>{fmt(r.ffEq, 0)}mm</td></tr>
            <tr><th><Tip term="dist">Subject dist.</Tip></th><td>{fmt(r.D, 2)} m</td><th><Tip term="dof">DoF</Tip></th><td>{dofStr(r.dof)}</td></tr>
            <tr><th><Tip term="nearFar" extra={`Hyperfocal here: ${fmt(r.dof.hyper, 1)} m.`}>Near → far</Tip></th><td colSpan={3}>{fmt(r.dof.near, 2)} m → {Number.isFinite(r.dof.far) ? fmt(r.dof.far, 2) + ' m' : '∞'}</td></tr>
            <tr><th><Tip term="bgBlur">BG blur</Tip></th><td>{fmt(r.bgBlurPct, 1)}%</td><th><Tip term="bgScale">BG scale</Tip></th><td>{fmt(r.bgScale * 100, 0)}%</td></tr>
            <tr><th><Tip term="camera">Camera</Tip></th><td colSpan={3}>{fmt(r.camH, 2)} m high · {r.tiltDeg >= 0 ? 'up' : 'down'} {fmt(Math.abs(r.tiltDeg))}°{r.dutch ? ` · dutch ${fmt(Math.abs(r.dutch))}°` : ''}</td></tr>
            {r.noseMag > 4 && <tr><th><Tip term="distortion">Distortion</Tip></th><td colSpan={3}>nose +{fmt(r.noseMag, 0)}% vs ears</td></tr>}
            <tr><th><Tip term="keyLevel">Key level</Tip></th><td>{fmt(r.keyLux, 0)} lx</td><th><Tip term="fillLevel">Fill</Tip></th><td>{fmt(r.fillLux, 0)} lx</td></tr>
            {r.rimLux != null && <tr><th><Tip term="rimLevel">Rim level</Tip></th><td colSpan={3}>{fmt(r.rimLux, 0)} lx</td></tr>}
            {r.ndText && <tr><th><Tip term="nd">Filtration</Tip></th><td colSpan={3}>{r.ndText}</td></tr>}
          </tbody>
        </table>
      </Section>

      <Section
        id="r-light"
        title="Key light geometry"
        summary={`${fmt(r.key.off, 0)}° around · ${fmt(r.key.elev, 0)}° up · ${softTxt}`}
        defaultOpen={false}
      >
        <table className="stats">
          <tbody>
            <tr><th><Tip term="keyAngle">Angle</Tip></th><td>{fmt(r.key.off, 0)}° az · {fmt(r.key.elev, 0)}° el</td><th><Tip term="srcSize">Source size</Tip></th><td>{fmt(r.key.ang, 1)}°</td></tr>
            {r.shadow && <tr><th><Tip term="shadow">Shadow</Tip></th><td colSpan={3}>{fmt(r.shadow.length)} m long · {fmt(r.shadow.penumbra * 100, 0)} cm soft edge</td></tr>}
            {r.unitText && <tr><th><Tip term="unit">Key unit</Tip></th><td colSpan={3}>{r.unitText}</td></tr>}
          </tbody>
        </table>
      </Section>

      <Section id="r-gear" title="Gear list" summary={`${L.length} items`} defaultOpen={false}>
        <ul className="gear-list">
          {L.map((l) => (
            <li key={l.id}>
              <Sw c={l.color} />
              <b>{l.role === 'neg' ? 'NEG' : l.role === 'key2' ? 'KEY B' : l.role.toUpperCase()}</b> {l.name}
              <span className="dim">{l.kelvin ? ` · ${l.kelvin}K` : l.gel ? ` · ${l.gel}` : ''}{l.role !== 'practical' && l.modifier !== 'sun' && l.dist ? ` · ${fmt(l.dist)} m` : ''}</span>
            </li>
          ))}
          {key.outside && <li className="dim">↳ key unit outside window: {key.outside}</li>}
        </ul>
      </Section>
    </div>
  );
}

function SoundSection({ s, soundLayer, onSoundLayer, t, duration }) {
  // During a move, the mic / frame-line / shadow rows follow the live boom position.
  const live = s.move ? boomAt(s, t) : null;
  const b = live ? (live.ok === false ? null : { ...live, face: live.shadow === 'face' ? { soft: false } : null, bg: live.shadow && live.shadow !== 'face' ? { surface: live.shadow, soft: false } : null }) : s.boom;
  const roomRow = s.room.kind === 'room'
    ? <><Tip term="rt60">{fmt(s.room.rt60, 2)} s reverb</Tip> · <Tip term="critDist">critical dist. {fmt(s.critDist, 2)} m</Tip></>
    : s.room.kind === 'flutter' ? <Tip term="roomEcho">{fmt(s.room.flutterMs, 0)} ms flutter echo ({fmt(s.room.flutterHz, 0)} Hz)</Tip>
      : s.room.kind === 'slap' ? <Tip term="roomEcho">{fmt(s.room.slapMs, 0)} ms slap off the storefront</Tip>
        : <Tip term="roomEcho">open air — no reverb</Tip>;
  const shadow = !b ? '—' : b.face ? `on the face${b.face.soft ? ' (soft, faint)' : ''}` : b.bg ? `on the ${b.bg.surface} in frame${b.bg.soft ? ' (soft, faint)' : ''}` : 'clear';
  return (
    <Section
      id="r-sound"
      title="Sound"
      summary={s.summary}
      defaultOpen={false}
      aside={<button type="button" className={`mini-toggle${soundLayer ? ' on' : ''}`} aria-pressed={soundLayer} onClick={onSoundLayer} title="Show the sound plan on the lighting plot">{soundLayer ? '◉' : '○'} plot</button>}
    >
      <table className="stats">
        <tbody>
          <tr><th><Tip term="snr">Clean margin</Tip></th><td colSpan={3}><b className={s.bestSnr >= 25 ? 'ok' : s.bestSnr >= 18 ? 'meh' : 'bad'}>{fmt(s.bestSnr, 0)} dB</b> on {s.primary === 'lav' ? 'lav' : 'boom'}{s.primary !== 'lav' && <span className="dim"> · lav would give {fmt(s.lav.snr, 0)} dB</span>}</td></tr>
          <tr><th><Tip term="voiceLevel">Voice</Tip></th><td>{fmt(s.voice, 0)} dB @ 1 m</td><th><Tip term="noiseFloor">Noise</Tip></th><td>{fmt(s.floor, 0)} dB</td></tr>
          <tr><th><Tip term="micPattern">Mic{live ? ' (now)' : ''}</Tip></th><td colSpan={3}>{(live ? s.move.plan === 'lav' : s.primary === 'lav') || !b ? (live && live.ok === false ? 'boom out of reach here — lav' : 'Lavalier (omni), 22 cm') : `${s.mic.name}, ${fmt(b.dist, 2)} m from mouth${live ? ` · ${fmt(live.snr, 0)} dB` : ''}`}</td></tr>
          {b && <tr><th><Tip term="frameLine">Frame line</Tip></th><td colSpan={3}>{live ? `boom ${b.from} frame, pole ${fmt(b.pole, 1)} m${live.handoff ? ' · 2nd operator' : ''}` : `${Number.isFinite(s.frameTop) ? `top crosses subject at ${fmt(s.frameTop, 2)} m` : 'no top line'} · boom ${b.from}, pole ${fmt(b.pole, 1)} m`}</td></tr>}
          {b && s.primary !== 'lav' && <tr><th><Tip term="boomShadow">Boom shadow</Tip></th><td colSpan={3} className={shadow === 'clear' ? '' : 'warn-text'}>{shadow}</td></tr>}
          <tr><th><Tip term="roomEcho">Room</Tip></th><td colSpan={3}>{roomRow}</td></tr>
          {s.wind && <tr><th><Tip term="wind">Wind</Tip></th><td colSpan={3}>{s.wind}, ~{fmt(s.windSpeed, 0)} m/s</td></tr>}
          {s.dialogue && (
            <tr><th><Tip term="dialogue">Dialogue</Tip></th><td colSpan={3}>
              {s.dialogue.plan === 'swing' ? `one boom swings ${fmt(s.dialogue.travel, 2)} m between A and B` : s.dialogue.plan === 'two' ? `second boom on B (${fmt(s.dialogue.second.snr, 0)} dB)` : 'boom on A, lav on B'}
              <span className="dim"> · {fmt(s.dialogue.sep, 1)} m apart</span>
            </td></tr>
          )}
        </tbody>
      </table>
      {s.move && <SoundMove m={s.move} t={t} duration={duration} />}
      {s.gear.map((g) => <div key={g} className="move-gear">🎙 {g}</div>)}
      {s.notes.map((n) => <div key={n} className="sound-note">· {n}</div>)}
      {s.warnings.map((w) => <div key={w} className="move-warn">⚠ {w}</div>)}
    </Section>
  );
}

// Clean-margin timeline across the move: boom (solid) and lav (dashed) against the 25 / 18 dB
// lines, with red bands where the boom is out of reach, handed off or throwing a shadow.
function SoundMove({ m, t, duration }) {
  const W = 300, H = 64, pad = 4;
  const vals = m.samples.flatMap((x) => [x.snr, x.lavSnr]).filter((v) => v != null);
  const lo = Math.min(10, ...vals) - 2, hi = Math.max(40, ...vals) + 2;
  const X = (tt) => pad + tt * (W - 2 * pad);
  const Y = (v) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
  const line = (key) => {
    let d = '', pen = false;
    m.samples.forEach((x) => { const v = x[key]; if (v == null || !x.ok && key === 'snr') { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(x.t)},${Y(v)} `; pen = true; });
    return d;
  };
  const band = (sp, i, col) => <rect key={col + i} x={X(sp[0]) - 2} width={Math.max(X(sp[1]) - X(sp[0]), 0) + 4} y={pad} height={H - 2 * pad} fill={col} opacity="0.22" />;
  const plan = m.plan === 'boom' ? 'boom tracks the whole move' : m.plan === 'lav' ? 'lav carries the move' : 'boom with lav backup';
  return (
    <div className="snd-move">
      <div className="snd-move-head"><Tip term="soundMove"><span>During the move</span></Tip> <span className="dim">· {plan}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="snr-chart" role="img" aria-label="Clean margin across the move">
        {m.noBoom.map((sp, i) => band(sp, i, '#ff5a5f'))}
        {(m.handoffSpans ?? []).map((sp, i) => band(sp, i, '#ffd27a'))}
        {m.shadowSpans.map((sp, i) => band(sp, i, '#ff5a5f'))}
        {[25, 18].map((v) => <g key={v}><line x1={pad} x2={W - pad} y1={Y(v)} y2={Y(v)} stroke="#4a5262" strokeDasharray="3 4" /><text x={W - pad} y={Y(v) - 2} textAnchor="end" className="snr-tick">{v} dB</text></g>)}
        <path d={line('lavSnr')} fill="none" stroke="#9aa2b1" strokeWidth="1.2" strokeDasharray="3 3" />
        <path d={line('snr')} fill="none" stroke="#6ee7b7" strokeWidth="2" />
        <line x1={X(t)} x2={X(t)} y1={pad} y2={H - pad} stroke="#f5b041" strokeWidth="1.5" />
      </svg>
      <div className="snr-legend"><span className="lg-boom">— boom</span><span className="lg-lav">- - lav</span><span className="lg-bad">▮ out of reach / shadow</span>{(m.handoffSpans ?? []).length > 0 && <span className="lg-hand">▮ handoff</span>}</div>
      <table className="stats">
        <tbody>
          {m.minBoom && <tr><th>Weakest boom</th><td colSpan={3}>{fmt(m.minBoom.snr, 0)} dB at {fmt(m.minBoom.t * duration, 1)} s</td></tr>}
          <tr><th>Weakest lav</th><td colSpan={3}>{fmt(m.minLav.lavSnr, 0)} dB at {fmt(m.minLav.t * duration, 1)} s</td></tr>
          {m.opTravel > 0.3 && <tr><th>Boom op walks</th><td colSpan={3}>{fmt(m.opTravel, 1)} m · peak {fmt(m.opPeak, 2)} m/s</td></tr>}
          <tr><th><Tip term="perspective">Perspective</Tip></th><td colSpan={3}>{m.perspective.verdict === 'follows' ? 'follows the picture' : m.perspective.verdict === 'steady' ? 'steady (shot size holds)' : 'flat — stays put while the picture changes'}</td></tr>
        </tbody>
      </table>
      {m.notes.map((n) => <div key={n} className="sound-note">· {n}</div>)}
    </div>
  );
}
