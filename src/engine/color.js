// Colour-temperature maths: Kelvin → RGB, mired shifts, gel lookup, WB-relative rendering.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Tanner Helland's black-body approximation (good from 1000K to 40000K).
export function kelvinToRGB(k) {
  const t = clamp(k, 1000, 40000) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)];
}

export const mired = (k) => 1e6 / k;

const toHex = (rgb) =>
  '#' + rgb.map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('');

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/**
 * How a source of temperature `k` *renders* on a camera white-balanced to `wb`.
 * Divides out the WB illuminant (von Kries style), then boosts saturation so the
 * diagram reads clearly: tungsten under daylight WB → amber, HMI under tungsten WB → cyan.
 */
export function renderKelvin(k, wb, boost = 2.1) {
  const s = kelvinToRGB(k);
  const w = kelvinToRGB(wb);
  let c = s.map((v, i) => v / Math.max(w[i], 1));
  const m = Math.max(...c);
  c = c.map((v) => v / m);
  const gray = (c[0] + c[1] + c[2]) / 3;
  c = c.map((v) => clamp(gray + (v - gray) * boost, 0, 1));
  const m2 = Math.max(...c);
  return toHex(c.map((v) => (v / m2) * 255));
}

const GELS = [
  { name: 'Full CTO', m: 159 },
  { name: '½ CTO', m: 81 },
  { name: '¼ CTO', m: 42 },
  { name: '⅛ CTO', m: 20 },
  { name: 'none', m: 0 },
  { name: '⅛ CTB', m: -12 },
  { name: '¼ CTB', m: -30 },
  { name: '½ CTB', m: -68 },
  { name: 'Full CTB', m: -131 },
];

/** Nearest standard correction gel for a mired shift (positive = warmer). */
export function nearestGel(shift) {
  let best = GELS[4];
  for (const g of GELS) if (Math.abs(g.m - shift) < Math.abs(best.m - shift)) best = g;
  return best;
}

/** Apply a mired shift to a Kelvin value (positive shift = warmer / lower K). */
export const shiftKelvin = (k, miredShift) => 1e6 / (mired(k) + miredShift);

/** Describe how a source reads relative to camera WB. */
export function describeShift(k, wb) {
  const d = mired(wb) - mired(k); // >0 → source cooler than WB → reads blue
  const a = Math.abs(d);
  const mag = a < 15 ? 'neutral' : a < 45 ? 'slightly' : a < 100 ? 'clearly' : 'deeply';
  if (mag === 'neutral') return { text: 'neutral', d };
  return { text: `${mag} ${d > 0 ? 'cool' : 'warm'}`, d };
}

export { toHex };

// --- Text legibility ---------------------------------------------------------------
const relLum = (rgb) => {
  const c = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrast = (a, b) => {
  const [x, y] = [relLum(hexToRgb(a)), relLum(hexToRgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/**
 * Keep a colour's hue but lighten it toward white until it reaches `min` contrast against
 * `bg` — used for Kelvin-coloured text so a deep-blue 12000K label stays legible.
 */
export function readable(hex, bg = '#0d0f13', min = 6) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const rgb = hexToRgb(hex);
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = rgb.map((v) => v + (255 - v) * t);
    const h = toHex(c);
    if (contrast(h, bg) >= min) return h;
  }
  return '#ffffff';
}
