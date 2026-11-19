import React from 'react';
import { fmt } from '../engine/engine.js';

const Sw = ({ c }) => <i className="sw" style={{ background: c }} />;

export default function Readout({ scene, move, metrics }) {
  const r = scene.readout;
  const L = scene.lights;
  const key = L.find((l) => l.role === 'key');
  const rim = L.find((l) => l.role === 'rim');
  const fill = L.find((l) => l.role === 'fill');
  const neg = L.find((l) => l.role === 'neg');
  const pr = L.filter((l) => l.role === 'practical' && l.lit);
  const dofTxt = r.dof.total < 1 ? `${fmt(r.dof.total * 100, 0)} cm` : Number.isFinite(r.dof.total) ? `${fmt(r.dof.total, 2)} m` : '∞';
  const softTxt = r.key.soft > 0.6 ? 'soft' : r.key.soft > 0.25 ? 'semi-soft' : r.key.soft > 0.05 ? 'crisp' : 'hard';

  return (
    <div className="readout">
      <div className="ratio-row">
        <div className="ratio">
          <div className="big">{r.ratioStr}</div>
          <div className="cap">Key : Fill · {fmt(r.stops)} stops</div>
        </div>
        <div className="ratio-meter" title={`natural ${fmt(r.naturalRatio)}:1 → target ${r.ratioStr}`}>
          <div className="rm-bar"><span style={{ left: `${Math.min(r.stops / 5, 1) * 100}%` }} className="rm-t" /><span style={{ left: `${Math.min(Math.log2(r.naturalRatio) / 5, 1) * 100}%` }} className="rm-n" /></div>
          <div className="rm-cap"><span>◆ target</span><span>◇ natural {fmt(r.naturalRatio)}:1</span></div>
        </div>
      </div>

      <div className="kv-line">
        <span><Sw c={key.color} />Key: {r.key.k} {softTxt}</span>
        <span>{fill ? <><Sw c={fill.color} />Fill: {r.fill}</> : neg ? <><Sw c="#000" />Fill: Negative</> : <>Fill: ambient</>}</span>
        <span>{rim ? <><Sw c={rim.color} />Rim: {r.rim}</> : 'Rim: —'}</span>
        {pr.length > 0 && <span><Sw c={pr[0].color} />Prac: {pr[0].gel ? 'neon' : pr[0].kelvin + 'K'}{pr.length > 1 ? ` ×${pr.length}` : ''}</span>}
        <span className="dim">WB {r.wb}K · tone push {r.gelPush.name}</span>
      </div>

      {move && move.type !== 'static' && (
        <div className="move-box">
          <div className="move-head"><b>{move.label}</b><span className="dim">{fmt(move.duration, 1)} s · peak {fmt(move.speedPeak, 2)} m/s</span></div>
          <table className="stats">
            <tbody>
              <tr><th></th><th>start</th><th>now</th><th>end</th></tr>
              {[
                ['Distance', (m) => `${fmt(m.dist, 2)} m`],
                ...(move.type === 'zoom' ? [['Focal', (m) => `${fmt(m.f, 0)}mm`], ['H FOV', (m) => `${fmt(m.fovH, 0)}°`]] : []),
                ['Key ↔ lens', (m) => `${fmt(m.keyOff, 0)}°`],
                ['Lens height', (m) => `${fmt(m.height, 2)} m`],
                ['Tilt', (m) => `${fmt(m.tiltDeg)}°`],
                ['Focus', (m) => `${fmt(m.focus, 2)} m`],
                ['DoF', (m) => (m.dof.total < 1 ? `${fmt(m.dof.total * 100, 0)} cm` : Number.isFinite(m.dof.total) ? `${fmt(m.dof.total, 2)} m` : '∞')],
                ['Face size', (m) => `${fmt(m.faceSize, 0)}%`],
                ['Neg. space', (m) => `${fmt(m.negSpace, 0)}%`],
                ['BG scale', (m) => `${fmt(m.bgScale * 100, 0)}%`],
              ].map(([k, f]) => (
                <tr key={k}><th>{k}</th><td className="dim">{f(move.start)}</td><td>{f(metrics)}</td><td className="dim">{f(move.end)}</td></tr>
              ))}
            </tbody>
          </table>
          {move.gear.map((g) => <div key={g} className="move-gear">⚙ {g}</div>)}
          {move.conflicts.map((c) => <div key={c.id} className="move-warn">⚠ {c.note}</div>)}
          {move.lineCross && <div className="move-warn">⚠ Crosses the 180° line at {fmt(move.lineCross.t * move.duration, 1)} s</div>}
        </div>
      )}

      <table className="stats">
        <tbody>
          <tr><th>H × V FOV</th><td>{fmt(r.fovH)}° × {fmt(r.fovV)}°</td><th>FF equiv.</th><td>{fmt(r.ffEq, 0)}mm</td></tr>
          <tr><th>Subject dist.</th><td>{fmt(r.D, 2)} m</td><th>DoF</th><td>{dofTxt}</td></tr>
          <tr><th>Near / Far</th><td colSpan={3}>{fmt(r.dof.near, 2)} m → {Number.isFinite(r.dof.far) ? fmt(r.dof.far, 2) + ' m' : '∞'} · hyperfocal {fmt(r.dof.hyper, 1)} m</td></tr>
          <tr><th>BG blur disc</th><td>{fmt(r.bgBlurPct, 2)}% of frame</td><th>BG scale</th><td>{fmt(r.bgScale * 100, 0)}%</td></tr>
          <tr><th>Key angle</th><td>{fmt(r.key.off, 0)}° az · {fmt(r.key.elev, 0)}° el</td><th>Source size</th><td>{fmt(r.key.ang, 1)}°</td></tr>
          <tr><th>Key level</th><td>{fmt(r.keyLux, 0)} lx ({fmt(r.keyLux / 10.764, 0)} fc)</td><th>Fill level</th><td>{fmt(r.fillLux, 0)} lx</td></tr>
          {r.rimLux != null && <tr><th>Rim level</th><td>{fmt(r.rimLux, 0)} lx</td><th>Camera</th><td>{fmt(r.camH, 2)} m · {r.tiltDeg >= 0 ? '↑' : '↓'}{fmt(Math.abs(r.tiltDeg))}°</td></tr>}
          {r.ndText && <tr><th>Filtration</th><td colSpan={3}>{r.ndText}</td></tr>}
          {r.unitText && <tr><th>Key unit</th><td colSpan={3}>{r.unitText}</td></tr>}
          {r.noseMag > 4 && <tr><th>Distortion</th><td colSpan={3}>nose +{fmt(r.noseMag, 0)}% vs ears (lens {fmt(r.D, 2)} m from face)</td></tr>}
        </tbody>
      </table>

      <details className="gear" open>
        <summary>Gear list ({L.length})</summary>
        <ul>
          {L.map((l) => (
            <li key={l.id}>
              <Sw c={l.color} />
              <b>{l.role === 'neg' ? 'NEG' : l.role.toUpperCase()}</b> {l.name}
              <span className="dim">{l.kelvin ? ` · ${l.kelvin}K` : l.gel ? ` · ${l.gel}` : ''}{l.role !== 'practical' && l.modifier !== 'sun' && l.dist ? ` · ${fmt(l.dist)} m` : ''}{l.outside ? ` · ${l.outside}` : ''}</span>
            </li>
          ))}
          {key.outside && <li className="dim">↳ key unit outside window: {key.outside}</li>}
        </ul>
      </details>
    </div>
  );
}
