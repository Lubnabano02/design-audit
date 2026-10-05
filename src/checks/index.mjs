import colorTokens from './color-tokens.mjs';
import typeScale from './type-scale.mjs';
import spacingGrid from './spacing-grid.mjs';
import contrast from './contrast.mjs';
import targetSize from './target-size.mjs';

export const checks = [colorTokens, typeScale, spacingGrid, contrast, targetSize];
export const byId = Object.fromEntries(checks.map(c => [c.id, c]));

/**
 * Run every enabled check over a snapshot.
 * @param {{elements: Array}} snapshot
 * @param {object} tokens   the design system, as rules
 * @param {object} config   { checks: { <id>: { enabled, severity } } }
 */
export function runChecks(snapshot, tokens, config = {}) {
  const settings = config.checks ?? {};
  const findings = [];

  for (const check of checks) {
    const opts = settings[check.id] ?? {};
    if (opts.enabled === false) continue;
    try {
      findings.push(...check.run(snapshot, tokens, opts));
    } catch (err) {
      findings.push({
        check: check.id, severity: 'P1', screen: '-', selector: '-',
        message: `check "${check.id}" threw: ${err.message}`,
        detail: { error: true },
      });
    }
  }

  const rank = { P1: 0, P2: 1, P3: 2 };
  return findings.sort((a, b) =>
    (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) ||
    a.check.localeCompare(b.check) ||
    a.selector.localeCompare(b.selector));
}
