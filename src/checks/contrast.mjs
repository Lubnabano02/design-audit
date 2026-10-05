import { parseColor, flatten, contrastRatio } from '../color.mjs';

/** Flags text that fails WCAG contrast against the background it actually renders on. */
export default {
  id: 'contrast',
  title: 'Text contrast below threshold',
  run(snapshot, tokens, opts = {}) {
    const c = tokens.contrast ?? {};
    const minNormal = c.minNormalText ?? 4.5;
    const minLarge = c.minLargeText ?? 3.0;
    const largePx = c.largeTextPx ?? 24;
    const largeBoldPx = c.largeTextBoldPx ?? 18.66;
    const findings = [];

    for (const el of snapshot.elements) {
      if (!el.text || !el.text.trim()) continue;
      const s = el.styles ?? {};
      const fg = parseColor(s.color);
      const bgRaw = parseColor(s.effectiveBackground);
      if (!fg || !bgRaw) continue;

      const bg = flatten(bgRaw, { r: 255, g: 255, b: 255, a: 1 });
      const text = flatten(fg, bg);
      if (!text || !bg) continue;

      const size = s.fontSize ?? 16;
      const weight = s.fontWeight ?? 400;
      const isLarge = size >= largePx || (weight >= 700 && size >= largeBoldPx);
      const required = isLarge ? minLarge : minNormal;
      const ratio = contrastRatio(text, bg);
      if (ratio >= required) continue;

      findings.push({
        check: this.id,
        severity: opts.severity ?? 'P1',
        screen: el.screen,
        selector: el.selector,
        message: `contrast ${ratio.toFixed(2)}:1 is below ${required}:1 for ${isLarge ? 'large' : 'normal'} text`,
        detail: {
          ratio: +ratio.toFixed(2), required, fontSize: size, fontWeight: weight,
          foreground: s.color, background: s.effectiveBackground,
          sample: el.text.slice(0, 60),
        },
      });
    }
    return findings;
  },
};
