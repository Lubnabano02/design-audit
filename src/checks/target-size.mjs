/** Flags interactive controls smaller than the minimum target size. */
export default {
  id: 'targetSize',
  title: 'Target smaller than minimum',
  run(snapshot, tokens, opts = {}) {
    const min = tokens.targetSize?.minPx ?? 24;
    const findings = [];

    for (const el of snapshot.elements) {
      if (!el.interactive) continue;
      const r = el.rect;
      if (!r || !r.width || !r.height) continue;
      if (r.width >= min && r.height >= min) continue;

      findings.push({
        check: this.id,
        severity: opts.severity ?? 'P2',
        screen: el.screen,
        selector: el.selector,
        rect: el.rect,
        message: `target is ${Math.round(r.width)}x${Math.round(r.height)}px, below the ${min}x${min}px minimum`,
        detail: { width: +r.width.toFixed(1), height: +r.height.toFixed(1), minimum: min, role: el.role, label: el.text?.slice(0, 40) },
      });
    }
    return findings;
  },
};
