/** Turn findings into something a person reads and something a machine reads. */

const COUNT = (arr, sev) => arr.filter(f => f.severity === sev).length;

export function toJSON(result, meta = {}) {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    ...meta,
    summary: {
      total: result.findings.length,
      P1: COUNT(result.findings, 'P1'),
      P2: COUNT(result.findings, 'P2'),
      P3: COUNT(result.findings, 'P3'),
      suppressed: result.suppressed.length,
    },
    findings: result.findings,
    suppressed: result.suppressed,
    expiredExceptions: result.expired,
    unusedExceptions: result.unused,
  }, null, 2);
}

export function toMarkdown(result, meta = {}) {
  const { findings, suppressed, expired, unused } = result;
  const L = [];
  L.push(`# Design audit${meta.project ? ` — ${meta.project}` : ''}`);
  L.push('');
  L.push(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  if (meta.baseUrl) L.push(`Build: ${meta.baseUrl}`);
  L.push('');
  L.push(`**${findings.length} findings** — ${COUNT(findings, 'P1')} P1, ${COUNT(findings, 'P2')} P2, ${COUNT(findings, 'P3')} P3`
       + (suppressed.length ? ` · ${suppressed.length} suppressed by approved exceptions` : ''));
  L.push('');

  if (!findings.length) {
    L.push('No findings. Either the build matches the system, or the checks are not looking hard enough — worth confirming which.');
  } else {
    const byCheck = {};
    for (const f of findings) (byCheck[f.check] ??= []).push(f);
    for (const [check, group] of Object.entries(byCheck)) {
      L.push(`## ${check} — ${group.length}`);
      L.push('');
      L.push('| Severity | Screen | Element | Finding |');
      L.push('|---|---|---|---|');
      for (const f of group) {
        L.push(`| ${f.severity} | ${f.screen} | \`${f.selector}\` | ${f.message} |`);
      }
      L.push('');
    }
  }

  if (suppressed.length) {
    L.push('## By design — covered by an approved exception');
    L.push('');
    L.push('These are real divergences that someone has already ruled on. They are listed so the decision stays visible, not so it gets re-argued.');
    L.push('');
    L.push('| Exception | Screen | Element | Finding | Reason | Approved by |');
    L.push('|---|---|---|---|---|---|');
    for (const s of suppressed) {
      L.push(`| ${s.exception.id} | ${s.screen} | \`${s.selector}\` | ${s.message} | ${s.exception.reason} | ${s.exception.approvedBy} |`);
    }
    L.push('');
  }

  if (expired.length) {
    L.push('## Expired exceptions');
    L.push('');
    L.push('These no longer suppress anything. Renew them or fix the underlying issue.');
    L.push('');
    for (const e of expired) L.push(`- **${e.id}** (${e.check}) expired ${e.expiresOn} — ${e.reason}`);
    L.push('');
  }

  if (unused.length) {
    L.push('## Unused exceptions');
    L.push('');
    L.push('Nothing matched these. Either the issue was fixed and the exception can go, or the match block no longer selects it.');
    L.push('');
    for (const e of unused) L.push(`- **${e.id}** (${e.check}) — ${e.reason}`);
    L.push('');
  }

  return L.join('\n');
}
