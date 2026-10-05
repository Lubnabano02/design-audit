/** Flags font sizes, families and weights that sit outside the type scale. */
export default {
  id: 'typeScale',
  title: 'Type is off-scale',
  run(snapshot, tokens, opts = {}) {
    const sizes = tokens.type?.sizesPx ?? [];
    const families = (tokens.type?.families ?? []).map(f => f.toLowerCase());
    const weights = tokens.type?.weights ?? [];
    const findings = [];

    for (const el of snapshot.elements) {
      if (!el.text) continue;
      const s = el.styles ?? {};

      if (sizes.length && typeof s.fontSize === 'number') {
        const rounded = Math.round(s.fontSize * 100) / 100;
        if (!sizes.includes(rounded)) {
          const nearest = sizes.reduce((a, b) => (Math.abs(b - rounded) < Math.abs(a - rounded) ? b : a));
          findings.push({
            check: this.id, severity: opts.severity ?? 'P2', screen: el.screen, selector: el.selector, rect: el.rect,
            message: `font-size ${rounded}px is not on the scale (nearest ${nearest}px)`,
            detail: { property: 'fontSize', value: rounded, nearest },
          });
        }
      }

      if (families.length && s.fontFamily) {
        const used = s.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
        if (used && !families.includes(used)) {
          findings.push({
            check: this.id, severity: opts.severity ?? 'P2', screen: el.screen, selector: el.selector, rect: el.rect,
            message: `font-family "${used}" is not a system font`,
            detail: { property: 'fontFamily', value: used, allowed: tokens.type.families },
          });
        }
      }

      if (weights.length && typeof s.fontWeight === 'number' && !weights.includes(s.fontWeight)) {
        findings.push({
          check: this.id, severity: opts.severity ?? 'P3', screen: el.screen, selector: el.selector, rect: el.rect,
          message: `font-weight ${s.fontWeight} is not in the system`,
          detail: { property: 'fontWeight', value: s.fontWeight, allowed: weights },
        });
      }
    }
    return findings;
  },
};
