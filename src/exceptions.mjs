/**
 * Approved divergences.
 *
 * The point is that a decision someone already made does not come back as a
 * finding next week. Rules live here, in code, rather than in a reviewer's
 * memory — so the only way to re-open a settled question is to edit the file.
 */

/** Does a finding match an exception's `match` block? */
function matches(finding, match = {}) {
  for (const [key, want] of Object.entries(match)) {
    if (key === 'value') {
      const got = finding.detail?.value;
      if (String(got).toLowerCase() !== String(want).toLowerCase()) return false;
    } else if (key === 'selector') {
      if (!finding.selector?.includes(want)) return false;
    } else if (finding[key] !== want) return false;
  }
  return true;
}

function isExpired(ex, now) {
  return !!ex.expiresOn && new Date(ex.expiresOn) < now;
}

/**
 * Split findings into those that stand and those covered by an exception.
 * Expired exceptions do not suppress anything, and are reported so they get revisited.
 */
export function applyExceptions(findings, exceptionsFile = {}, now = new Date()) {
  const all = exceptionsFile.exceptions ?? [];
  const live = all.filter(e => !isExpired(e, now));
  const expired = all.filter(e => isExpired(e, now));

  const kept = [];
  const suppressed = [];

  for (const f of findings) {
    const hit = live.find(e => e.check === f.check && matches(f, e.match));
    if (hit) suppressed.push({ ...f, exception: { id: hit.id, reason: hit.reason, approvedBy: hit.approvedBy } });
    else kept.push(f);
  }

  const unused = live.filter(e => !suppressed.some(s => s.exception.id === e.id));
  return { findings: kept, suppressed, expired, unused };
}

/** An exception without a reason and an approver is just a silenced bug. */
export function validateExceptions(exceptionsFile = {}) {
  const problems = [];
  for (const e of exceptionsFile.exceptions ?? []) {
    if (!e.id) problems.push('an exception is missing "id"');
    if (!e.check) problems.push(`${e.id ?? '?'}: missing "check"`);
    if (!e.reason) problems.push(`${e.id ?? '?'}: missing "reason"`);
    if (!e.approvedBy) problems.push(`${e.id ?? '?'}: missing "approvedBy"`);
    if (!e.match || !Object.keys(e.match).length) problems.push(`${e.id ?? '?'}: empty "match" would suppress every ${e.check} finding`);
  }
  return problems;
}
