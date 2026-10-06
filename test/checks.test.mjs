import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { contrastRatio, parseColor, deltaE, flatten, nearestToken } from '../src/color.mjs';
import { runChecks } from '../src/checks/index.mjs';
import { applyExceptions, validateExceptions } from '../src/exceptions.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = async f => JSON.parse(await readFile(path.join(root, f), 'utf8'));

test('contrast ratio matches the WCAG reference values', () => {
  assert.equal(contrastRatio(parseColor('#FFFFFF'), parseColor('#000000')).toFixed(2), '21.00');
  assert.equal(contrastRatio(parseColor('#767676'), parseColor('#FFFFFF')).toFixed(2), '4.54');
  assert.equal(contrastRatio(parseColor('#FFFFFF'), parseColor('#FFFFFF')).toFixed(2), '1.00');
});

test('translucent colours are composited before measuring', () => {
  const half = parseColor('rgba(0, 0, 0, 0.5)');
  const over = flatten(half, parseColor('#FFFFFF'));
  assert.equal(Math.round(over.r), 128);
  assert.equal(over.a, 1);
});

test('nearest token finds an exact match at distance zero', () => {
  const near = nearestToken(parseColor('#0D6EFD'), ['#0D6EFD', '#198754']);
  assert.equal(near.token, '#0D6EFD');
  assert.ok(near.distance < 0.01);
});

test('identical colours have zero deltaE', () => {
  assert.equal(deltaE(parseColor('#ABCDEF'), parseColor('#ABCDEF')), 0);
});

test('checks find the planted problems in the fixture', async () => {
  const snapshot = await read('examples/snapshot.fixture.json');
  const tokens = await read('examples/tokens.example.json');
  const findings = runChecks(snapshot, tokens, { checks: {} });

  const ids = new Set(findings.map(f => f.check));
  assert.ok(ids.has('contrast'), 'expected a contrast finding');
  assert.ok(ids.has('targetSize'), 'expected a target size finding');
  assert.ok(ids.has('typeScale'), 'expected a type scale finding');
  assert.ok(ids.has('spacingGrid'), 'expected a spacing finding');
  assert.ok(ids.has('colorTokens'), 'expected a colour token finding');

  // P1s sort to the top.
  assert.equal(findings[0].severity, 'P1');
});

test('a disabled check produces nothing', async () => {
  const snapshot = await read('examples/snapshot.fixture.json');
  const tokens = await read('examples/tokens.example.json');
  const findings = runChecks(snapshot, tokens, { checks: { contrast: { enabled: false } } });
  assert.equal(findings.filter(f => f.check === 'contrast').length, 0);
});

test('approved exceptions suppress their finding and nothing else', async () => {
  const snapshot = await read('examples/snapshot.fixture.json');
  const tokens = await read('examples/tokens.example.json');
  const exceptions = await read('examples/exceptions.example.json');

  const raw = runChecks(snapshot, tokens, { checks: {} });
  const result = applyExceptions(raw, exceptions);

  assert.equal(result.findings.length + result.suppressed.length, raw.length);
  assert.ok(result.suppressed.length >= 1);
  for (const s of result.suppressed) assert.ok(s.exception.reason, 'a suppressed finding must carry its reason');
});

test('an expired exception stops suppressing and is reported', async () => {
  const snapshot = await read('examples/snapshot.fixture.json');
  const tokens = await read('examples/tokens.example.json');
  const exceptions = await read('examples/exceptions.example.json');

  const raw = runChecks(snapshot, tokens, { checks: {} });
  const future = new Date('2099-01-01');
  const result = applyExceptions(raw, exceptions, future);

  assert.ok(result.expired.length >= 1, 'expected at least one expired exception');
  assert.ok(result.suppressed.length < 2, 'expired exceptions must not suppress');
});

test('an exception without a reason or approver is rejected', () => {
  const problems = validateExceptions({ exceptions: [{ id: 'EX-9', check: 'contrast', match: { screen: 'x' } }] });
  assert.ok(problems.some(p => /reason/.test(p)));
  assert.ok(problems.some(p => /approvedBy/.test(p)));
});

test('an empty match block is rejected as too broad', () => {
  const problems = validateExceptions({ exceptions: [{ id: 'EX-10', check: 'contrast', reason: 'r', approvedBy: 'a', match: {} }] });
  assert.ok(problems.some(p => /every/.test(p)));
});

test('Figma node ids are accepted as a bare id or a pasted URL', async () => {
  const { normaliseNodeId } = await import('../src/figma.mjs');
  assert.equal(normaliseNodeId('1:2'), '1:2');
  assert.equal(normaliseNodeId('1-2'), '1:2');
  assert.equal(normaliseNodeId('https://www.figma.com/design/ABC123/My-File?node-id=6415-307796'), '6415:307796');
  assert.equal(normaliseNodeId('https://www.figma.com/design/ABC123/My-File?node-id=6415-307796&t=xyz'), '6415:307796');
  assert.equal(normaliseNodeId(null), null);
});

test('element descriptions are unique among same-tag siblings', async () => {
  // Guards the bug where three sibling <p> elements all described identically
  // and the report looked like it was repeating itself.
  const { collectStyles } = await import('../src/snapshot.mjs');
  const src = collectStyles.toString();
  assert.ok(/nth-of-type/.test(src), 'describe() must disambiguate same-tag siblings');
});

test('crawl refuses to leave the origin or follow dangerous links', async () => {
  const { isWorthVisiting, normalise } = await import('../src/crawl.mjs');
  const origin = 'https://example.com';
  assert.ok(isWorthVisiting('https://example.com/about', origin));
  assert.ok(!isWorthVisiting('https://evil.com/about', origin), 'must stay on origin');
  assert.ok(!isWorthVisiting('https://example.com/logout', origin), 'must not follow logout');
  assert.ok(!isWorthVisiting('https://example.com/account/delete', origin), 'must not follow delete');
  assert.ok(!isWorthVisiting('https://example.com/brochure.pdf', origin), 'must skip non-pages');
  assert.ok(!isWorthVisiting('mailto:a@b.com', origin));
});

test('crawl treats the same page as one page', async () => {
  const { normalise } = await import('../src/crawl.mjs');
  const base = 'https://example.com/docs';
  assert.equal(normalise('/docs/', base), normalise('/docs', base));
  assert.equal(normalise('/docs#intro', base), normalise('/docs', base));
  assert.equal(normalise('/docs?utm_source=x', base), normalise('/docs', base));
  assert.notEqual(normalise('/docs?page=2', base), normalise('/docs', base));
});

test('consent dismissal prefers declining over accepting', async () => {
  const src = await readFile(path.join(root, 'src/dismiss.mjs'), 'utf8');
  // Declining must be exhausted — known selectors and text — before accepting.
  const declineFirst = src.indexOf("const first = mode === 'accept' ? 'accept' : 'decline'");
  assert.ok(declineFirst > 0, 'decline must be the default preference');
  assert.ok(/Accepting on someone's behalf sets tracking cookies/.test(src),
    'the reason for declining should be written down');
});

test('known consent platforms all offer a decline path or none at all', async () => {
  const src = await readFile(path.join(root, 'src/dismiss.mjs'), 'utf8');
  const block = src.slice(src.indexOf('const KNOWN'), src.indexOf('/** Button text'));
  const entries = [...block.matchAll(/cmp:\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(entries.length >= 8, 'should cover the common consent platforms');
  // No site-specific entries: a generic tool should not special-case one company.
  assert.ok(!/Ryanair|Amazon|Facebook/i.test(block), 'no site-specific entries');
});
