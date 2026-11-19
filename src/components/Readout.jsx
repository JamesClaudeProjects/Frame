import React from 'react';
import { fmt } from '../engine/engine.js';
import { Section, Tip } from './ui.jsx';

const Sw = ({ c }) => <i className="sw" style={{ background: c }} />;
const dofStr = (d) => (d.total < 1 ? `${fmt(d.total * 100, 0)} cm` : Number.isFinite(d.total) ? `${fmt(d.total, 2)} m` : '∞');

// Headline first (ratio + colour chips), everything else in collapsible sections that
// show a one-line summary while closed. Each label carries a hover tag.
export default function Readout({ scene, move, metrics }) {
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
