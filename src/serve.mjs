/**
 * The local UI server.
 *
 * Binds to 127.0.0.1 only. A Figma token submitted through the form is used
 * for the length of one run and never written to disk or kept afterwards —
 * which is the reason this runs on your machine rather than somewhere hosted.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runChecks } from './checks/index.mjs';
import { applyExceptions } from './exceptions.mjs';
import { toHTML, imageDataUri } from './report-html.mjs';
import { toCSV } from './report-csv.mjs';
import { toDesignerHTML } from './report-designer.mjs';
import { normaliseNodeId } from './figma.mjs';
import { discover } from './crawl.mjs';
import { auditImage, IMAGE_LIMITS } from './image-audit.mjs';
import { compareVisually, renderDiffOverlay } from './visual-diff.mjs';
import { readBody, parseMultipart, imageToDataUri } from './multipart.mjs';
import { landing, form, results, DEFAULT_TOKENS } from './ui.mjs';

/** Finished runs, so the result page and its downloads survive a reload. */
const runs = new Map();
const MAX_RUNS = 20;

function remember(run) {
  const id = randomUUID().slice(0, 8);
  runs.set(id, run);
  while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);
  return id;
}

const MAX_UPLOAD = 12e6;

async function parseBody(req) {
  const type = req.headers['content-type'] ?? '';
  if (type.startsWith('multipart/form-data')) {
    const body = await readBody(req, MAX_UPLOAD);
    const { fields, files } = parseMultipart(body, type);
    return { ...fields, _files: files };
  }
  const body = await readBody(req, 2e6);
  return Object.fromEntries(new URLSearchParams(body.toString('utf8')));
}

function figmaKeyFrom(url) {
  return (String(url).match(/\/(?:design|file)\/([A-Za-z0-9]+)/) || [])[1] ?? null;
}

async function doRunImage(input) {
  let tokens;
  try {
    tokens = JSON.parse(input.tokens || DEFAULT_TOKENS);
  } catch (err) {
    throw new Error(`The design tokens are not valid JSON — ${err.message}`);
  }

  const dataUri = imageToDataUri(input._files?.image);

  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new Error('Playwright is not installed. Run: npm install && npx playwright install chromium'); }

  const browser = await chromium.launch();
  try {
    const { findings, extracted } = await auditImage(browser, dataUri, tokens);
    const result = applyExceptions(findings, { exceptions: [] });
    const name = input._files.image.filename || 'screenshot';
    const meta = {
      project: name, baseUrl: null, source: 'image',
      viewport: { width: extracted.width, height: extracted.height },
      pageHeight: extracted.height,
      limits: IMAGE_LIMITS,
      palette: extracted.significant,
    };
    const images = { build: dataUri, figma: null };
    return {
      mode: 'audit', source: 'image', meta, images, result,
      html: toHTML(result, meta, images),
      review: toDesignerHTML(result, meta, images),
      csv: toCSV(result, meta),
      notes: [],
    };
  } finally {
    await browser.close();
  }
}

async function doRun(input) {
  let tokens;
  try {
    tokens = JSON.parse(input.tokens || DEFAULT_TOKENS);
  } catch (err) {
    throw new Error(`The design tokens are not valid JSON — ${err.message}`);
  }

  let target;
  try {
    target = new URL(input.url);
  } catch {
    throw new Error('That page URL is not valid. It needs to start with http:// or https://');
  }

  const compare = input.mode === 'compare';
  if (compare) {
    if (!figmaKeyFrom(input.figma) || !normaliseNodeId(input.figma)) {
      throw new Error('That Figma link has no file key or node id in it. Use “Copy link to selection” on the frame.');
    }
    if (!input.token) throw new Error('Comparing needs a Figma token.');
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Playwright is not installed. Run: npm install && npx playwright install chromium');
  }

  const [w, h] = (input.viewport || '1440x900').split('x').map(Number);
  const outDir = await mkdtemp(path.join(tmpdir(), 'design-audit-'));
  const browser = await chromium.launch();

  try {
    const { captureScreen } = await import('./capture.mjs');
    const screen = {
      name: 'page',
      path: target.pathname + target.search,
      waitFor: input.waitFor || null,
      viewport: { width: w, height: h },
    };
    const config = { baseUrl: target.origin, viewport: { width: w, height: h }, captureTimeoutMs: 30000,
      consent: ['decline', 'accept', 'off'].includes(input.consent) ? input.consent : 'decline',
      dismiss: input.dismiss?.trim() || null };

    const maxPages = Math.min(Math.max(parseInt(input.maxPages, 10) || 1, 1), 12);
    const { urls, error: crawlError } = await discover(browser, input.url, { maxPages });

    const pages = [];
    for (const [i, href] of urls.entries()) {
      const u = new URL(href);
      const sc = { ...screen, name: i === 0 ? 'page' : `page-${i + 1}`, path: u.pathname + u.search };
      try {
        const { snapshot, screenshot } = await captureScreen(
          sc, { ...config, baseUrl: u.origin }, { outDir, browser });
        pages.push({ url: href, snapshot, screenshot });
      } catch (err) {
        // One bad page should not lose the rest of the run.
        pages.push({ url: href, failed: err.message.split('\n')[0] });
      }
    }
    if (!pages.some(p => p.snapshot)) {
      throw new Error(`Could not load that page — ${pages[0]?.failed ?? 'unknown error'}`);
    }

    const ok = pages.filter(p => p.snapshot);
    const snapshot = ok[0].snapshot;
    const screenshot = ok[0].screenshot;
    const allElements = ok.flatMap(p => p.snapshot.elements);
    const ctx = { pages: ok.map(p => ({
      name: p.snapshot.screen, url: p.url,
      runtime: p.snapshot.runtime, interactions: p.snapshot.interactions,
    })) };
    const result = applyExceptions(
      runChecks({ elements: allElements }, tokens, { checks: {} }, ctx), { exceptions: [] });

    let figmaImg = null;
    if (compare) {
      const { downloadFrame } = await import('./figma.mjs');
      const dest = path.join(outDir, 'figma.png');
      try {
        await downloadFrame(normaliseNodeId(input.figma), dest, {
          fileKey: figmaKeyFrom(input.figma), token: input.token,
        });
        figmaImg = await imageDataUri(dest);
      } catch (err) {
        throw new Error(`The page was captured, but Figma could not be reached — ${err.message}`);
      }
    }

    // Compare the frame with the build, where both exist.
    let visual = null;
    if (figmaImg) {
      const diff = await compareVisually(browser, await imageDataUri(screenshot), figmaImg);
      if (diff.ran) {
        result.findings.push(...diff.findings);
        const overlay = await renderDiffOverlay(browser, figmaImg, diff);
        if (overlay) { figmaImg = overlay; visual = { changedShare: diff.changedShare, regions: diff.regions.length }; }
      }
    }

    const meta = {
      project: target.hostname, baseUrl: input.url, visual,
      viewport: { width: w, height: h }, pageHeight: snapshot.pageHeight,
      pages: ok.map(p => p.url), failed: pages.filter(p => p.failed),
      consent: ok[0]?.snapshot?.consent ?? null,
      crawlError,
    };
    const images = { build: await imageDataUri(screenshot), figma: figmaImg };

    return {
      mode: input.mode,
      meta,
      images,
      result,
      html: toHTML(result, meta, images),
      review: toDesignerHTML(result, meta, images),
      csv: toCSV(result, meta),
      notes: snapshot.notes ?? [],
    };
  } finally {
    await browser.close();
    // The token lives only as long as this call.
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function serve({ port = 4000 } = {}) {
  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'text/html; charset=utf-8', extra = {}) =>
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra }).end(body);

    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname;

    try {
      if (req.method === 'GET') {
        if (route === '/') return send(200, landing());
        if (route === '/audit') return send(200, form('audit'));
        if (route === '/compare') return send(200, form('compare'));

        const m = route.match(/^\/r\/([a-z0-9]+)(?:\/(report\.html|review\.html|findings\.csv))?$/i);
        if (m) {
          const run = runs.get(m[1]);
          if (!run) return send(404, form('audit', { error: 'That result has expired. Runs are kept only while the server is up.' }));
          if (m[2] === 'report.html') {
            return send(200, run.html, 'text/html; charset=utf-8',
              { 'content-disposition': `attachment; filename="developer-report-${run.meta.project}.html"` });
          }
          if (m[2] === 'review.html') {
            return send(200, run.review, 'text/html; charset=utf-8',
              { 'content-disposition': `attachment; filename="designer-review-${run.meta.project}.html"` });
          }
          if (m[2] === 'findings.csv') {
            return send(200, run.csv, 'text/csv; charset=utf-8',
              { 'content-disposition': `attachment; filename="findings-${run.meta.project}.csv"` });
          }
          return send(200, results(m[1], run.result, run.meta, run.images, run.mode));
        }
        return send(404, landing());
      }

      if (req.method === 'POST' && route === '/run') {
        const input = await parseBody(req);
        const mode = input.mode === 'compare' ? 'compare' : 'audit';
        try {
          const run = input.source === 'image' ? await doRunImage(input) : await doRun(input);
          const id = remember(run);
          // Redirect so a reload does not re-run the audit.
          return res.writeHead(303, { location: `/r/${id}` }).end();
        } catch (err) {
          return send(200, form(mode, { error: err.message, values: input }));
        }
      }

      return send(405, landing());
    } catch (err) {
      return send(500, form('audit', { error: err.message }));
    }
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${port} is already in use. Try: node src/cli.mjs serve --port ${port + 1}\n`);
      process.exit(1);
    }
    throw err;
  });

  // Localhost only. This handles a Figma token; it is not for exposing.
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  design-audit is running at http://127.0.0.1:${port}`);
    console.log('  Leave this window open. Press Ctrl+C to stop.\n');
  });
  return server;
}
