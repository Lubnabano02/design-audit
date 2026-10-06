/**
 * The same thing, styled differently in two places.
 *
 * Every other check looks at one page in isolation, so none of them can catch
 * a header that is 64px on one screen and 72px on another — both are internally
 * consistent, and both pass. This one compares screens to each other.
 *
 * It only speaks up when an element appears on more than one page under the
 * same selector, which is a good proxy for "this is meant to be one component".
 */
import { parseColor, flatten, deltaE, toHex } from '../color.mjs';

/**
 * Styling only — deliberately not layout.
 *
 * Comparing height sounded right and was tried: it reported content regions
 * that are *supposed* to differ, and text blocks that wrapped onto two lines
 * on one page and one on the other. On a real documentation site that was 28
 * noise findings hiding 2 real ones. Without a curated list of which elements
 * are chrome, height cannot be told apart from content, so it is left out.
 *
 * A component rendered in two different colours, weights or sizes is always
 * worth knowing about, and never ambiguous.
 */
const COMPARED = [
  { key: 'fontSize',        label: 'font size',   kind: 'px',    tolerance: 0.6 },
  { key: 'fontWeight',      label: 'font weight', kind: 'num',   tolerance: 0 },
  { key: 'color',           label: 'text colour', kind: 'color', tolerance: 2 },
  { key: 'backgroundColor', label: 'background',  kind: 'color', tolerance: 2 },
  { key: 'paddingTop',      label: 'top padding', kind: 'px',    tolerance: 1 },
  { key: 'paddingLeft',     label: 'left padding',kind: 'px',    tolerance: 1 },
];

const valueOf = (el, spec) => el.styles?.[spec.key];

/** Are these two values the same, within tolerance? */
function differs(a, b, spec) {
  if (a == null || b == null) return false;
  if (spec.kind === 'color') {
    const pa = parseColor(a), pb = parseColor(b);
    if (!pa || !pb) return false;
    // Fully transparent on both sides is agreement, not a difference.
    if (pa.a === 0 && pb.a === 0) return false;
    if ((pa.a === 0) !== (pb.a === 0)) return true;
    return deltaE(flatten(pa, { r: 255, g: 255, b: 255, a: 1 }),
                  flatten(pb, { r: 255, g: 255, b: 255, a: 1 })) > spec.tolerance;
  }
  if (spec.kind === 'num') return a !== b;
  return Math.abs(Number(a) - Number(b)) > spec.tolerance;
}

const show = (v, spec) => {
  if (v == null) return '—';
  if (spec.kind === 'color') { const p = parseColor(v); return p ? toHex(flatten(p, { r: 255, g: 255, b: 255, a: 1 })) : String(v); }
  if (spec.kind === 'px') return `${Math.round(Number(v) * 10) / 10}px`;
  return String(v);
};

export default {
  id: 'crossScreen',
  title: 'Inconsistent between screens',
  run(snapshot, tokens, opts = {}) {
    const elements = snapshot.elements ?? [];
    const screens = new Set(elements.map(e => e.screen));
    if (screens.size < 2) return [];   // nothing to compare against

    // One entry per selector per screen. If a selector repeats within a screen
    // it is a list item, not a component, so it is not comparable across pages.
    const bySelector = new Map();
    for (const el of elements) {
      if (!el.selector) continue;
      let perScreen = bySelector.get(el.selector);
      if (!perScreen) bySelector.set(el.selector, (perScreen = new Map()));
      const seen = perScreen.get(el.screen);
      if (seen) { seen.count++; } else { perScreen.set(el.screen, { el, count: 1 }); }
    }

    const findings = [];
    for (const [selector, perScreen] of bySelector) {
      if (perScreen.size < 2) continue;
      const entries = [...perScreen.entries()].filter(([, v]) => v.count === 1);
      if (entries.length < 2) continue;

      const [, first] = entries[0];
      for (const spec of COMPARED) {
        const base = valueOf(first.el, spec);
        if (base == null) continue;

        const odd = entries.filter(([, v]) => differs(base, valueOf(v.el, spec), spec));
        if (!odd.length) continue;

        const variants = entries.map(([screen, v]) => `${screen} ${show(valueOf(v.el, spec), spec)}`);
        findings.push({
          check: this.id,
          severity: opts.severity ?? 'P2',
          screen: entries.map(([s]) => s).join(' / '),
          selector,
          rect: first.el.rect,
          message: `${spec.label} differs between screens — ${variants.join(', ')}`,
          detail: {
            property: spec.key,
            value: show(base, spec),
            screens: Object.fromEntries(entries.map(([s, v]) => [s, show(valueOf(v.el, spec), spec)])),
          },
        });
        // One property is enough to make the point for this element.
        break;
      }
    }
    return findings;
  },
};
