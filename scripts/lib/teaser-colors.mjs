// Teaser-lane color math: one accent hex plus a dark/light ground in, a full
// brandSchema `colors` object out. Lives here (not inline in render-teaser.mjs)
// so it can be tested without fetching a logo or shelling out to remotion.

/** '#f80' | 'f80' | '#FF8800' -> '#ff8800'. Throws on anything else. */
export const norm = (h) => {
  h = String(h).trim().toLowerCase();
  if (!h.startsWith('#')) h = '#' + h;
  if (h.length === 4) h = '#' + [...h.slice(1)].map((c) => c + c).join('');
  if (!/^#[0-9a-f]{6}$/.test(h)) throw new Error('bad hex ' + h);
  return h;
};

/** Linear per-channel blend: t=0 returns a, t=1 returns b. */
export const mix = (a, b, t) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
};

/** WCAG relative luminance, 0 (black) to 1 (white). */
export const luminance = (h) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Pick the ground from an SVG logo's own fill colors: a navy wordmark on a navy
 * ground is invisible (measured on the first render of this lane). Pure black and
 * pure white carry no signal, so they are dropped; with nothing left, dark wins.
 */
export const groundFromLogoFills = (svg) => {
  const fills = [...svg.matchAll(/(?:fill|stroke|stop-color)\s*[:=]\s*["']?(#[0-9a-fA-F]{3,6})/g)]
    .map((m) => norm(m[1]))
    .filter((h) => h !== '#000000' && h !== '#ffffff');
  const meanLuminance = fills.length ? fills.reduce((s, h) => s + luminance(h), 0) / fills.length : null;
  return {
    theme: meanLuminance !== null && meanLuminance < 0.2 ? 'light' : 'dark',
    sampled: fills.length,
    meanLuminance,
  };
};

/** CTA legibility floors/ceilings — the `profit` role carries the CTA line. */
const CTA_MIN_LUMINANCE_ON_DARK = 0.25;
const CTA_MAX_LUMINANCE_ON_LIGHT = 0.35;

/**
 * The full neutral ramp derived from the accent and the ground.
 * `bg` overrides the derived ground (paid.ai is dark green, not near-black);
 * the ramp still derives from whatever ground ends up in play.
 */
export const teaserColors = ({accent, dark, bg: bgOverride = null}) => {
  const bg = bgOverride
    ? norm(bgOverride)
    : dark
      ? mix('#0e1014', accent, 0.06)
      : mix('#f7f8fa', accent, 0.03);
  const ink = dark ? '#fafafa' : '#14181d';
  const colors = {
    bg,
    surface: mix(bg, ink, 0.04),
    surface2: mix(bg, ink, 0.08),
    line: mix(bg, ink, 0.14),
    ink,
    ink2: mix(ink, bg, 0.25),
    ink3: mix(ink, bg, 0.45),
    brand: accent,
    profit: dark ? mix(accent, '#ffffff', 0.25) : mix(accent, '#000000', 0.2),
    safe: '#22c55e',
    loss: '#ef4444',
    info: '#3b82f6',
    rare: '#eab308',
  };
  if (dark && luminance(colors.profit) < CTA_MIN_LUMINANCE_ON_DARK) {
    colors.profit = mix(accent, '#ffffff', 0.5);
  }
  if (!dark && luminance(colors.profit) > CTA_MAX_LUMINANCE_ON_LIGHT) {
    colors.profit = mix(accent, '#000000', 0.45);
  }
  return colors;
};
