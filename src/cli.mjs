#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, loadTokens, loadExceptions } from './config.mjs';
import { runChecks } from './checks/index.mjs';
import { applyExceptions, validateExceptions } from './exceptions.mjs';
import { toMarkdown, toJSON } from './report.mjs';
import { toHTML, imageDataUri } from './report-html.mjs';
import { toDesignerHTML } from './report-designer.mjs';
import { recordRun, compareRuns, summarise, loadHistory,
         recordDecision, loadLedger, ledgerToExceptions } from './history.mjs';
import { compareVisually, renderDiffOverlay } from './visual-diff.mjs';

const args = process.argv.slice(2);
const command = args[0];
const flag = name => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1]?.startsWith('--') ? true : args[i + 1]) : null;
};

const USAGE = `
design-audit — compare a running UI against its Figma source of truth

  design-audit check    --snapshot <file> --tokens <file> [--exceptions <file>] [--out <dir>]
                        Run the rule checks over a captured snapshot. No browser needed.

  design-audit run      --config <file>
                        Capture every screen, fetch its Figma frame, check, and report.

  design-audit capture  --config <file>
                        Capture only. Writes snapshot.json and build.png per screen.

  design-audit serve    [--port 4000]
                        Open a local page where you paste a URL and a Figma link.

  design-audit history  --config <file>
                        What previous runs found, and the trend.

  design-audit decide   --config <file> --finding "<check>|<selector>|<message>"
                        --ruling build-must-change|design-must-change|by-design|wont-fix|deferred
                        --by "<name>" --why "<reason>"
                        Record a ruling. "by-design" also stops it being reported.

Options
  --format md|json|html Report format for "check" (default: md)
  --out <dir>           Where to write reports
  --draft               Do not add this run to the history or the ledger

Environment
  FIGMA_TOKEN           Figma personal access token
  FIGMA_FILE_KEY        Figma file key, if not set in config
`;

function fail(message) {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

async function cmdCheck() {
  const snapshotPath = flag('snapshot');
  const tokensPath = flag('tokens');
  if (!snapshotPath || !tokensPath) fail('check needs --snapshot and --tokens');

  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const tokens = await loadTokens(tokensPath);
  const exceptions = await loadExceptions(flag('exceptions'));

  const problems = validateExceptions(exceptions);
  if (problems.length) fail('exceptions file is not valid:\n  - ' + problems.join('\n  - '));

  const result = applyExceptions(runChecks(snapshot, tokens, { checks: {} }), exceptions);
  const meta = { project: snapshot.screen, baseUrl: snapshot.url };
  const format = flag('format') ?? 'md';
  const output = format === 'json' ? toJSON(result, meta)
               : format === 'html' ? toHTML(result, meta, {})
               : toMarkdown(result, meta);

  const outDir = flag('out');
  if (outDir) {
    await mkdir(outDir, { recursive: true });
    const file = path.join(outDir, `report.${format === 'json' ? 'json' : format === 'html' ? 'html' : 'md'}`);
    await writeFile(file, output);
    console.log(`Wrote ${file} — ${result.findings.length} findings, ${result.suppressed.length} suppressed`);
  } else {
    console.log(output);
  }
  process.exitCode = result.findings.some(f => f.severity === 'P1') ? 1 : 0;
}

async function cmdCapture(alsoCheck) {
  const configPath = flag('config');
  if (!configPath) fail('capture needs --config');
  const config = await loadConfig(configPath);
  const { captureAll } = await import('./capture.mjs');

  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.join(config._outDir, stamp);
  await mkdir(outDir, { recursive: true });

  const captures = await captureAll(config, outDir);
  console.log(`Captured ${captures.length} screen(s) into ${outDir}`);

  if (config.figma?.fileKey && config.figma?.token) {
    const { downloadFrame, normaliseNodeId } = await import('./figma.mjs');
    for (const screen of config.screens) {
      if (!screen.figmaNodeId) continue;
      try {
        const dest = path.join(outDir, screen.name, 'figma.png');
        await downloadFrame(normaliseNodeId(screen.figmaNodeId), dest, config.figma);
        console.log(`  ${screen.name}: fetched Figma frame`);
      } catch (err) {
        console.warn(`  ${screen.name}: could not fetch Figma frame — ${err.message}`);
      }
    }
  } else {
    console.log('  (no Figma credentials — skipping frame download)');
  }

  if (!alsoCheck) return;

  const tokens = await loadTokens(config._tokensPath);
  const fileExceptions = await loadExceptions(config._exceptionsPath);
  const ledger = await loadLedger(config._outDir);
  const exceptions = { exceptions: [
    ...(fileExceptions.exceptions ?? []),
    ...ledgerToExceptions(ledger).exceptions,
  ] };
  const all = { elements: captures.flatMap(c => c.snapshot.elements) };
  const ctx = { pages: captures.map(c => ({
    name: c.snapshot.screen, url: c.snapshot.url,
    runtime: c.snapshot.runtime, interactions: c.snapshot.interactions,
  })) };
  const result = applyExceptions(runChecks(all, tokens, config, ctx), exceptions);

  const meta = { project: path.basename(config._dir), baseUrl: config.baseUrl };
  await writeFile(path.join(outDir, 'report.md'), toMarkdown(result, meta));
  await writeFile(path.join(outDir, 'report.json'), toJSON(result, { baseUrl: config.baseUrl }));

  const first = config.screens[0];
  const shots = {
    build: await imageDataUri(path.join(outDir, first.name, 'build.png')),
    figma: await imageDataUri(path.join(outDir, first.name, 'figma.png')),
  };

  // Compare the frame with the build, if both are here.
  if (shots.build && shots.figma) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    try {
      const diff = await compareVisually(browser, shots.build, shots.figma);
      if (diff.ran) {
        result.findings.push(...diff.findings);
        const overlay = await renderDiffOverlay(browser, shots.figma, diff);
        if (overlay) {
          shots.figma = overlay;
          meta.visualDiff = { changedShare: diff.changedShare, regions: diff.regions.length };
        }
      }
    } finally { await browser.close(); }
  }

  const draft = args.includes('--draft');
  const runSummary = summarise(result, { ...meta, pages: config.screens });
  const { previous } = await recordRun(config._outDir, runSummary, { draft });
  const trend = compareRuns(runSummary, previous);
  meta.trend = trend;
  meta.draft = draft;
  await writeFile(path.join(outDir, 'report.html'), toHTML(result, meta, shots));
  await writeFile(path.join(outDir, 'review.html'),
    toDesignerHTML(result, { ...meta, viewport: first.viewport ?? config.viewport }, shots));
  console.log(`\n${result.findings.length} findings (${result.suppressed.length} suppressed) — ${path.join(outDir, 'report.md')}`);
  if (draft) console.log('  draft run — not added to history or the ledger');
  if (trend) {
    const sign = n => (n > 0 ? `+${n}` : String(n));
    console.log(`  since the last run: ${sign(trend.total)} findings · ${trend.fixed} fixed · ${trend.introduced} new`);
  }
  process.exitCode = result.findings.some(f => f.severity === 'P1') ? 1 : 0;
}

async function cmdHistory() {
  const configPath = flag('config');
  if (!configPath) fail('history needs --config');
  const config = await loadConfig(configPath);
  const { runs } = await loadHistory(config._outDir);
  if (!runs.length) return console.log('\nNo runs recorded yet.\n');

  console.log('\n  Date              Findings   P1   P2   P3   Pages');
  console.log('  ' + '-'.repeat(52));
  for (const r of runs.slice(-20)) {
    console.log(`  ${r.at.slice(0, 16).replace('T', ' ')}  ${String(r.total).padStart(8)} ${
      String(r.P1).padStart(4)} ${String(r.P2).padStart(4)} ${String(r.P3).padStart(4)} ${String(r.pages).padStart(7)}`);
  }
  const first = runs[0], last = runs[runs.length - 1];
  if (runs.length > 1) {
    const d = last.total - first.total;
    console.log(`\n  ${runs.length} runs · ${d === 0 ? 'no net change' : d < 0 ? `${-d} fewer findings` : `${d} more findings`} since ${first.at.slice(0, 10)}\n`);
  } else console.log('');
}

async function cmdDecide() {
  const configPath = flag('config');
  if (!configPath) fail('decide needs --config');
  const config = await loadConfig(configPath);
  const entry = await recordDecision(config._outDir, {
    finding: flag('finding'), ruling: flag('ruling'), by: flag('by'), why: flag('why'),
  });
  console.log(`\n  ${entry.id} recorded — ${entry.ruling}`);
  console.log(`  ${path.join(config._outDir, 'decisions.md')}\n`);
  if (entry.ruling === 'by-design') console.log('  This finding will stop being reported.\n');
}

try {
  if (command === 'check') await cmdCheck();
  else if (command === 'history') await cmdHistory();
  else if (command === 'decide') await cmdDecide();
  else if (command === 'capture') await cmdCapture(false);
  else if (command === 'run') await cmdCapture(true);
  else if (command === 'serve') {
    const { serve } = await import('./serve.mjs');
    serve({ port: Number(flag('port')) || 4000 });
  }
  else { console.log(USAGE); process.exit(command ? 1 : 0); }
} catch (err) {
  fail(err.message);
}
