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

test('image colour buckets never overflow a byte', async () => {
  const src = await readFile(path.join(root, 'src/image-audit.mjs'), 'utf8');
  // Math.round(255 / 8) * 8 === 256, which wraps and corrupts the channel.
  assert.ok(!/Math\.round\(data\[/.test(src), 'channels must be masked, not rounded');
  assert.ok(/& 0xF8/.test(src), 'channels should be masked to a multiple of 8');
});

test('cross-screen needs two screens and compares styling, not layout', async () => {
  const { default: crossScreen } = await import('../src/checks/cross-screen.mjs');
  const tokens = {};
  const one = { elements: [{ screen: 'a', selector: 'nav', styles: { color: '#fff' }, rect: { height: 50 } }] };
  assert.equal(crossScreen.run(one, tokens).length, 0, 'one screen cannot be inconsistent');

  const two = { elements: [
    { screen: 'a', selector: 'nav', styles: { color: 'rgb(255,255,255)', fontSize: 16 }, rect: { height: 50 } },
    { screen: 'b', selector: 'nav', styles: { color: 'rgb(20,20,20)', fontSize: 16 }, rect: { height: 900 } },
  ] };
  const found = crossScreen.run(two, tokens);
  assert.equal(found.length, 1);
  assert.equal(found[0].detail.property, 'color');
  // Height is deliberately not compared: content legitimately differs per page.
  const src = await readFile(path.join(root, 'src/checks/cross-screen.mjs'), 'utf8');
  assert.ok(!/from: 'rect'/.test(src), 'layout must not be compared across screens');
});

test('visual diff compares colour, not brightness', async () => {
  const src = await readFile(path.join(root, 'src/visual-diff.mjs'), 'utf8');
  // #198754 and #DC3545 differ by 0.001 in luminance; comparing it misses them.
  assert.ok(/deltaE/.test(src), 'must use a perceptual distance');
  assert.ok(/#198754 and #DC3545/.test(src), 'the reason should be recorded');
});

test('a decision needs a reason, an approver and a known ruling', async () => {
  const { recordDecision } = await import('../src/history.mjs');
  const dir = path.join(root, '.tmp-ledger-test');
  await assert.rejects(() => recordDecision(dir, { finding: 'x|y|z', ruling: 'nonsense', by: 'a', why: 'b' }),
    /ruling must be one of/);
  await assert.rejects(() => recordDecision(dir, { finding: 'x|y|z', ruling: 'by-design' }),
    /who decided|why/);
});

test('draft runs stay out of the history', async () => {
  const { recordRun } = await import('../src/history.mjs');
  const r = await recordRun('/tmp/never-written-' + Date.now(), { at: 'now', total: 1 }, { draft: true });
  assert.equal(r.recorded, false);
  assert.equal(r.entry.draft, true);
});

test('byte-identical findings fold into one with a count', async () => {
  const { collapseIdentical } = await import('../src/collapse.mjs');
  const same = { check: 'errors', selector: 'main.js', message: 'Console warning: x', severity: 'P3' };
  const folded = collapseIdentical([{ ...same }, { ...same }, { ...same }]);
  assert.equal(folded.length, 1);
  assert.equal(folded[0].times, 3);
});

test('findings on different elements never fold', async () => {
  const { collapseIdentical } = await import('../src/collapse.mjs');
  const a = { check: 'contrast', selector: 'h1', message: 'too faint', severity: 'P1' };
  const b = { check: 'contrast', selector: 'p', message: 'too faint', severity: 'P1' };
  const folded = collapseIdentical([a, b]);
  assert.equal(folded.length, 2, 'two elements are two problems to fix');
});

test('grouping keys cannot collide across checks', async () => {
  const { collapseFindings } = await import('../src/collapse.mjs');
  // A separator that can appear inside a field would let these two merge.
  const a = { check: 'contrast', selector: 'h1', message: 'x y', severity: 'P1', rect: {} };
  const b = { check: 'contrast x', selector: 'h2', message: 'y', severity: 'P1', rect: {} };
  assert.equal(collapseFindings([a, b]).length, 2, 'different checks must stay separate');
});

test('grouping keys survive adjacent-field ambiguity', async () => {
  const { collapseFindings, collapseIdentical } = await import('../src/collapse.mjs');
  // With naive concatenation these two produce the same key.
  const a = { check: 'ab', selector: 's', message: 'c', severity: 'P1', rect: {} };
  const b = { check: 'a', selector: 's', message: 'bc', severity: 'P1', rect: {} };
  assert.equal(collapseFindings([a, b]).length, 2);
  assert.equal(collapseIdentical([a, b]).length, 2);
});

test('no source file contains a NUL byte', async () => {
  const { readdir } = await import('node:fs/promises');
  const dirs = ['src', 'src/checks', 'test'];
  for (const d of dirs) {
    for (const name of await readdir(path.join(root, d))) {
      if (!name.endsWith('.mjs')) continue;
      const buf = await readFile(path.join(root, d, name));
      assert.equal(buf.includes(0), false, `${d}/${name} contains a NUL byte`);
    }
  }
});
