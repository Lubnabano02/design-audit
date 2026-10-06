/**
 * Remembering runs, and what was decided about them.
 *
 * A single audit tells you where you are. A series tells you whether you are
 * getting better, which is the only question anyone actually asks twice.
 *
 * Draft runs are kept out of it deliberately. Work in progress should be
 * auditable without polluting the record — an exploratory run that drags the
 * trend down teaches the team to stop running audits.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const INDEX = 'history.json';
const LEDGER = 'decisions.json';

async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

/* ------------------------------------------------------------------ history */

export async function loadHistory(dir) {
  const h = await readJSON(path.join(dir, INDEX), { runs: [] });
  return Array.isArray(h.runs) ? h : { runs: [] };
}

/**
 * Append a run. Drafts are returned unchanged and never written.
 * @returns {{recorded:boolean, entry:object, previous:object|null}}
 */
export async function recordRun(dir, entry, { draft = false, keep = 200 } = {}) {
  if (draft) return { recorded: false, entry: { ...entry, draft: true }, previous: null };

  await mkdir(dir, { recursive: true });
  const history = await loadHistory(dir);
  const previous = history.runs.length ? history.runs[history.runs.length - 1] : null;

  history.runs.push(entry);
  if (history.runs.length > keep) history.runs = history.runs.slice(-keep);
  await writeFile(path.join(dir, INDEX), JSON.stringify(history, null, 2));
  return { recorded: true, entry, previous };
}

/** What changed since the run before this one. */
export function compareRuns(current, previous) {
  if (!previous) return null;
  const d = (a, b) => (a ?? 0) - (b ?? 0);
  return {
    since: previous.at,
    total: d(current.total, previous.total),
    P1: d(current.P1, previous.P1),
    P2: d(current.P2, previous.P2),
    P3: d(current.P3, previous.P3),
    fixed: (previous.fingerprints ?? []).filter(f => !(current.fingerprints ?? []).includes(f)).length,
    introduced: (current.fingerprints ?? []).filter(f => !(previous.fingerprints ?? []).includes(f)).length,
  };
}

/** A stable id for a finding, so the same problem is recognised across runs. */
export function fingerprint(f) {
  return `${f.check}|${f.selector}|${f.message}`;
}

export function summarise(result, meta = {}) {
  const findings = result.findings ?? [];
  const n = sev => findings.filter(f => f.severity === sev).length;
  return {
    at: new Date().toISOString(),
    url: meta.baseUrl ?? meta.project ?? null,
    pages: meta.pages?.length ?? 1,
    total: findings.length,
    P1: n('P1'), P2: n('P2'), P3: n('P3'),
    suppressed: (result.suppressed ?? []).length,
    fingerprints: findings.map(fingerprint),
  };
}

/* ------------------------------------------------------------------ ledger */

/**
 * Every ruling, kept. An exception only records decisions that silence a
 * finding; this records the ones that do not, too — "the build must change"
 * is a decision somebody should be able to look up later.
 */
export async function loadLedger(dir) {
  const l = await readJSON(path.join(dir, LEDGER), { decisions: [] });
  return Array.isArray(l.decisions) ? l : { decisions: [] };
}

const RULINGS = new Set(['build-must-change', 'design-must-change', 'by-design', 'wont-fix', 'deferred']);

export async function recordDecision(dir, decision) {
  const problems = [];
  if (!decision.finding) problems.push('which finding');
  if (!RULINGS.has(decision.ruling)) problems.push(`ruling must be one of: ${[...RULINGS].join(', ')}`);
  if (!decision.by) problems.push('who decided');
  if (!decision.why) problems.push('why');
  if (problems.length) throw new Error(`A decision needs ${problems.join(', ')}.`);

  await mkdir(dir, { recursive: true });
  const ledger = await loadLedger(dir);
  const entry = {
    id: `D-${String(ledger.decisions.length + 1).padStart(4, '0')}`,
    at: new Date().toISOString(),
    finding: decision.finding,
    ruling: decision.ruling,
    by: decision.by,
    why: decision.why,
  };
  ledger.decisions.push(entry);
  await writeFile(path.join(dir, LEDGER), JSON.stringify(ledger, null, 2));
  await writeFile(path.join(dir, 'decisions.md'), toMarkdownLedger(ledger));
  return entry;
}

/** A finding id contains pipes, which would break a markdown table. */
const cell = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function toMarkdownLedger(ledger) {
  const L = ['# Decisions', '',
    'Every ruling made on a finding, oldest first. A decision that is not written down gets made again.', '',
    '| ID | Date | Ruling | Finding | Why | By |', '|---|---|---|---|---|---|'];
  for (const d of ledger.decisions) {
    L.push(`| ${d.id} | ${d.at.slice(0, 10)} | ${d.ruling} | ${cell(d.finding)} | ${cell(d.why)} | ${cell(d.by)} |`);
  }
  return L.join('\n') + '\n';
}

/** Rulings of "by design" become exceptions, so they stop being reported. */
export function ledgerToExceptions(ledger) {
  return {
    exceptions: (ledger.decisions ?? [])
      .filter(d => d.ruling === 'by-design')
      .map(d => {
        const [check, selector] = String(d.finding).split('|');
        return {
          id: d.id, check,
          match: selector ? { selector } : {},
          reason: d.why, approvedBy: d.by, approvedOn: d.at.slice(0, 10),
        };
      })
      .filter(e => e.check && Object.keys(e.match).length),
  };
}
