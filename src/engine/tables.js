// Parameter tables. These are *coefficients* that feed the solver, not pre-written looks:
// every output (positions, ratios, Kelvin, FOV, DoF, prose) is computed from them.

export const TIMES = {
  golden: {
    label: 'Golden Hour', sunElev: 7, sunK: 3300, skyK: 7000, wb: 5600,
    sunLux: 12000, skyLux: 2500, daylight: true, sun: true,
  },
  noon: {
    label: 'High Noon', sunElev: 76, sunK: 5600, skyK: 9500, wb: 5600,
    sunLux: 100000, skyLux: 15000, daylight: true, sun: true,
  },
  blue: {
    label: 'Blue Hour', sunElev: -5, sunK: null, skyK: 12000, wb: 5600,
    sunLux: 0, skyLux: 40, daylight: false, sun: false,
  },
  midnight: {
    label: 'Midnight', sunElev: -40, sunK: null, skyK: 4100, wb: 3200,
    sunLux: 0, skyLux: 0.2, daylight: false, sun: false, night: true,
  },
  overcast: {
    label: 'Overcast', sunElev: 35, sunK: null, skyK: 6800, wb: 5600,
    sunLux: 0, skyLux: 12000, daylight: true, sun: false,
  },
};

// bounce: how much ambient fill the surroundings return (0 = black void).
// bg: depth from subject to the background plane (m).
export const ENVS = {
  interior: { label: 'Interior · Window Room', bounce: 0.38, bg: 3.2, exterior: false, ground: 'floor' },
  field: { label: 'Exterior · Open Field', bounce: 0.12, bg: 45, exterior: true, ground: 'grass' },
  alley: { label: 'Narrow Alleyway', bounce: 0.3, bg: 16, exterior: true, ground: 'asphalt' },
  studio: { label: 'Studio Void', bounce: 0.03, bg: 3.8, exterior: false, ground: 'void' },
  neon: { label: 'Neon Street', bounce: 0.26, bg: 8, exterior: true, ground: 'wet' },
};

export const BLOCKING = {
  one: { label: '1 Person' },
  two: { label: '2 People · Dialogue' },
  crowd: { label: 'Crowd / Background' },
};

// Tone coefficients.
//  stops     – base key:fill contrast in stops (2^stops = ratio)
//  soft      – desired source softness 0..1
//  keyDeg    – key azimuth off the lens axis toward the face's short side
//  faceDeg   – how far the subject's nose turns off-lens toward lead room
//  keyElev   – key elevation (deg)
//  shotH     – vertical frame height at subject (m)  → drives subject distance
//  camH      – lens height (m), eyeFrac – eye-line offset from frame centre (fraction of height, + = up)
//  xThird    – multiplier on the rule-of-thirds offset (1 = on the third)
//  sep       – dialogue separation (m), stagger – line-of-action skew (deg)
//  mired     – gel push on artificial sources (+ warmer)
//  rimK/rimStops – rim colour temp and level relative to key
export const TONES = {
  melancholy: {
    label: 'Melancholy / Sad', stops: 3.0, soft: 0.72, keyDeg: 100, faceDeg: 55, keyElev: 42,
    shotH: 1.7, camH: 1.85, eyeFrac: -0.15, xThird: 1.15, dutch: 0, sep: 1.9, stagger: 22,
    turnAway: true, mired: -28, rimK: 8000, rimStops: -1, crowd: 'away',
  },
  tense: {
    label: 'Tense / Paranoid', stops: 3.3, soft: 0.15, keyDeg: 88, faceDeg: 35, keyElev: 62,
    shotH: 0.75, camH: 1.45, eyeFrac: 0.17, xThird: 1.0, dutch: 7, sep: 1.15, stagger: 4,
    turnAway: false, mired: -14, rimK: 6500, rimStops: 0, crowd: 'watching',
  },
  romantic: {
    label: 'Romantic / Intimate', stops: 1.0, soft: 0.92, keyDeg: 38, faceDeg: 25, keyElev: 28,
    shotH: 0.5, camH: 1.6, eyeFrac: 0.17, xThird: 0.8, dutch: 0, sep: 0.5, stagger: 14,
    turnAway: false, mired: 40, rimK: 3000, rimStops: -0.5, crowd: 'oblivious',
  },
  heroic: {
    label: 'Heroic / Dominant', stops: 2.0, soft: 0.32, keyDeg: 50, faceDeg: 40, keyElev: 38,
    shotH: 1.25, camH: 0.7, eyeFrac: 0.22, xThird: 0.35, dutch: 0, sep: 1.5, stagger: 0,
    turnAway: false, mired: 18, rimK: 5600, rimStops: 1, crowd: 'toward',
  },
  lonely: {
    label: 'Detached / Lonely', stops: 2.4, soft: 0.55, keyDeg: 118, faceDeg: 78, keyElev: 24,
    shotH: 3.6, camH: 2.6, eyeFrac: -0.17, xThird: 1.3, dutch: 0, sep: 2.6, stagger: 30,
    turnAway: true, mired: -36, rimK: 9000, rimStops: -0.5, crowd: 'same-way',
  },
};

// Capture formats (what the camera records) are separate from the aspect ratio (what is
// extracted from it). Anamorphic gate width is de-squeezed, so the monitor view and all
// framing maths match what the audience sees.
export const FORMATS = {
  s35: { label: 'Super 35', long: 'Super 35 · spherical', gate: [24.89, 18.66], squeeze: 1, coc: 0.025, minFocus: 0.45 },
  ff: { label: 'Full Frame', long: 'Full Frame · spherical', gate: [36, 24], squeeze: 1, coc: 0.03, minFocus: 0.45 },
  ana2: { label: 'Anamorphic 2×', long: 'Anamorphic 2× · S35 4-perf', gate: [21.95, 18.6], squeeze: 2, coc: 0.025, minFocus: 0.9 },
};
export const ASPECTS = { '1.33:1': 4 / 3, '1.78:1': 16 / 9, '1.85:1': 1.85, '2.39:1': 2.39, '1:1': 1 };

/** The extracted frame (mm, de-squeezed) for a capture format and aspect ratio. */
export function sensorFor(format = 's35', aspect = '2.39:1') {
  const F = FORMATS[format] ?? FORMATS.s35;
  const a = ASPECTS[aspect] ?? 2.39;
  const W = F.gate[0] * F.squeeze, H = F.gate[1];
  const [w, h] = a >= W / H ? [W, W / a] : [H * a, H];
  const native = Math.abs(a - W / H) < 0.05;
  return {
    w, h, ratio: a, squeeze: F.squeeze, coc: F.coc, minFocus: F.minFocus, format,
    label: `${F.long} · ${aspect}${native ? '' : a >= W / H ? ' (top/bottom crop)' : ' (side crop)'}`,
  };
}

export const APERTURES = [1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16];

export const NEON = { a: '#ff2fa8', b: '#22e4ff' };
