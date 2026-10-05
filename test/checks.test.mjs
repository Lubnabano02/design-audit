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
