const BOXES = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
               'marginTop', 'marginRight', 'marginBottom', 'marginLeft'];

/** Flags padding and margin that are not multiples of the base unit. */
export default {
  id: 'spacingGrid',
  title: 'Spacing is off-grid',
  run(snapshot, tokens, opts = {}) {
    const base = tokens.spacing?.basePx ?? 0;
    if (!base) return [];
    const findings = [];

    for (const el of snapshot.elements) {
      const s = el.styles ?? {};
      const offenders = [];
      for (const prop of BOXES) {
        const v = s[prop];
        if (typeof v !== 'number' || v === 0) continue;
        // Sub-pixel values come from layout rounding, not from a decision.
        if (Math.abs(v - Math.round(v)) > 0.01) { offenders.push([prop, v]); continue; }
        if (Math.round(v) % base !== 0) offenders.push([prop, v]);
      }
      if (!offenders.length) continue;

      findings.push({
        check: this.id, severity: opts.severity ?? 'P3', screen: el.screen, selector: el.selector, rect: el.rect,
        message: `${offenders.map(([p, v]) => `${p} ${+v.toFixed(2)}px`).join(', ')} — not a multiple of ${base}px`,
        detail: { base, offenders: Object.fromEntries(offenders) },
      });
    }
    return findings;
  },
};
