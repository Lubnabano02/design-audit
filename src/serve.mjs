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
import { normaliseNodeId } from './figma.mjs';
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

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 2e6) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
    req.on('error', reject);
  });
}

function figmaKeyFrom(url) {
  return (String(url).match(/\/(?:design|file)\/([A-Za-z0-9]+)/) || [])[1] ?? null;
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
    const config = { baseUrl: target.origin, viewport: { width: w, height: h }, captureTimeoutMs: 30000 };

    let snapshot, screenshot;
    try {
      ({ snapshot, screenshot } = await captureScreen(screen, config, { outDir, browser }));
    } catch (err) {
      throw new Error(`Could not load that page — ${err.message.split('\n')[0]}`);
    }

    const result = applyExceptions(runChecks(snapshot, tokens, { checks: {} }), { exceptions: [] });

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

    const meta = { project: target.hostname, baseUrl: input.url };
    const images = { build: await imageDataUri(screenshot), figma: figmaImg };

    return {
      mode: input.mode,
      meta,
      images,
      result,
      html: toHTML(result, meta, images),
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

        const m = route.match(/^\/r\/([a-z0-9]+)(?:\/(report\.html|findings\.csv))?$/i);
        if (m) {
          const run = runs.get(m[1]);
          if (!run) return send(404, form('audit', { error: 'That result has expired. Runs are kept only while the server is up.' }));
          if (m[2] === 'report.html') {
            return send(200, run.html, 'text/html; charset=utf-8',
              { 'content-disposition': `attachment; filename="design-audit-${run.meta.project}.html"` });
          }
          if (m[2] === 'findings.csv') {
            return send(200, run.csv, 'text/csv; charset=utf-8',
              { 'content-disposition': `attachment; filename="design-audit-${run.meta.project}.csv"` });
          }
          return send(200, results(m[1], run.result, run.meta, run.images, run.mode));
        }
        return send(404, landing());
      }

      if (req.method === 'POST' && route === '/run') {
        const input = await parseBody(req);
        const mode = input.mode === 'compare' ? 'compare' : 'audit';
        try {
          const run = await doRun(input);
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
