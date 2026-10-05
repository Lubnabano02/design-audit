import { parseColor, flatten, nearestToken, toHex } from '../color.mjs';

const PROPS = [
  ['color', 'text colour'],
  ['backgroundColor', 'background'],
  ['borderColor', 'border'],
];

/** Flags rendered colours that are not in the palette (within tolerance). */
export default {
  id: 'colorTokens',
  title: 'Colour is off-palette',
  run(snapshot, tokens, opts = {}) {
    const palette = tokens.color?.palette ?? [];
    const tolerance = tokens.color?.toleranceDeltaE ?? 3;
    if (!palette.length) return [];
    const findings = [];

    for (const el of snapshot.elements) {
      for (const [prop, label] of PROPS) {
        // A text colour on an element with no text of its own is inherited,
        // not chosen — reporting it buries the elements that actually show it.
        if (prop === 'color' && !el.text) continue;

        const raw = el.styles?.[prop];
        const parsed = parseColor(raw);
        if (!parsed || parsed.a === 0) continue;

        const backdrop = parseColor(el.styles?.effectiveBackground) ?? { r: 255, g: 255, b: 255, a: 1 };
        const solid = flatten(parsed, backdrop);
        const near = nearestToken(solid, palette);
        if (!near || near.distance <= tolerance) continue;

        findings.push({
          check: this.id,
          severity: opts.severity ?? 'P2',
          screen: el.screen,
          selector: el.selector,
          message: `${label} ${toHex(solid)} is not a palette token (nearest ${near.token}, ΔE ${near.distance.toFixed(1)})`,
          detail: { property: prop, value: toHex(solid), nearest: near.token, deltaE: +near.distance.toFixed(2) },
        });
      }
    }
    return findings;
  },
};
