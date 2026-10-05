/** Colour helpers: parsing, WCAG contrast, and perceptual distance. */

/** Parse "#rgb", "#rrggbb", "rgb(r,g,b)" or "rgba(r,g,b,a)" into {r,g,b,a} 0-255 / 0-1. */
export function parseColor(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }

  const fn = s.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const parts = fn[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  return null;
}

export function toHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Composite a possibly-translucent colour over an opaque backdrop. */
export function flatten(fg, bg) {
  if (!fg) return null;
  if (fg.a >= 1) return { ...fg, a: 1 };
  const b = bg || { r: 255, g: 255, b: 255, a: 1 };
  return {
    r: fg.r * fg.a + b.r * (1 - fg.a),
    g: fg.g * fg.a + b.g * (1 - fg.a),
    b: fg.b * fg.a + b.b * (1 - fg.a),
    a: 1,
  };
}

const channel = v => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance. */
export function luminance(c) {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG 2.x contrast ratio, 1–21. Both colours must be opaque; flatten() first. */
export function contrastRatio(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* --- CIE76 deltaE, via sRGB -> XYZ -> Lab. Good enough to answer
   "is this the token, or a different colour?" without a colour library. --- */
function toLab(c) {
  const [r, g, b] = [channel(c.r), channel(c.g), channel(c.b)];
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function deltaE(c1, c2) {
  const a = toLab(c1), b = toLab(c2);
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

/** Nearest token to a colour, with its distance. */
export function nearestToken(color, palette) {
  let best = null;
  for (const hex of palette) {
    const t = parseColor(hex);
    if (!t) continue;
    const d = deltaE(color, t);
    if (!best || d < best.distance) best = { token: hex.toUpperCase(), distance: d };
  }
  return best;
}
