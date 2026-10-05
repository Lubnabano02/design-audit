/**
 * A local, single-user web UI.
 *
 * Binds to 127.0.0.1 only. A Figma token submitted through the form is held in
 * memory for the length of the run and never written to disk — which is the
 * whole reason this runs on your machine rather than somewhere hosted.
 */
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runChecks } from './checks/index.mjs';
import { applyExceptions } from './exceptions.mjs';
import { toHTML, imageDataUri } from './report-html.mjs';
import { normaliseNodeId } from './figma.mjs';

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const FORM_STYLE = `
:root{--bg:#0e1116;--panel:#161b22;--line:#2a3240;--ink:#e6edf3;--ink-2:#9aa7b4;
  --ink-3:#6b7684;--accent:#58a6ff;--err:#f85149}
@media (prefers-color-scheme:light){:root{--bg:#fff;--panel:#f6f8fa;--line:#d8dee4;
  --ink:#1f2328;--ink-2:#59636e;--ink-3:#818b98}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:620px;margin:0 auto;padding:56px 16px 80px}
h1{font-size:24px;margin:0 0 6px;letter-spacing:-.01em}
.sub{color:var(--ink-2);font-size:13.5px;margin:0 0 32px}
label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}
.hint{font-weight:400;color:var(--ink-3);font-size:12px}
input,textarea,select{width:100%;font:inherit;font-size:14px;color:var(--ink);
  background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
textarea{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;min-height:150px;resize:vertical}
.field{margin:0 0 22px}
button{font:inherit;font-weight:600;font-size:14px;background:var(--accent);color:#fff;
  border:0;border-radius:8px;padding:11px 22px;cursor:pointer}
button[disabled]{opacity:.55;cursor:progress}
details{margin:0 0 22px;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
summary{cursor:pointer;padding:11px 13px;font-size:13px;font-weight:600}
details .inner{padding:0 13px 14px}
.err{border:1px solid var(--err);background:rgba(248,81,73,.1);color:var(--ink);
  border-radius:8px;padding:12px 14px;font-size:13.5px;margin:0 0 22px}
.err b{color:var(--err)}
footer{margin:36px 0 0;font-size:12px;color:var(--ink-3)}
`;

function formPage(error, values = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>design-audit</title><style>${FORM_STYLE}</style></head><body><div class="wrap">
<h1>design-audit</h1>
<p class="sub">Compare a running page against its Figma frame. Everything runs on this machine — nothing is uploaded.</p>
${error ? `<div class="err"><b>Could not finish.</b> ${esc(error)}</div>` : ''}
<form method="POST" action="/run" id="f">

  <div class="field">
    <label for="url">Website URL <span class="hint">— the page to audit</span></label>
    <input id="url" name="url" type="url" required placeholder="https://example.com/dashboard"
           value="${esc(values.url ?? '')}">
  </div>

  <div class="field">
    <label for="figma">Figma frame <span class="hint">— optional, paste the frame link</span></label>
    <input id="figma" name="figma" type="url" placeholder="https://www.figma.com/design/KEY/File?node-id=1-2"
           value="${esc(values.figma ?? '')}">
  </div>

  <div class="field">
    <label for="token">Figma token <span class="hint">— only needed for the frame; kept in memory, never saved</span></label>
    <input id="token" name="token" type="password" placeholder="figd_…" autocomplete="off">
  </div>

  <details>
    <summary>Advanced — wait condition, viewport, design tokens</summary>
    <div class="inner">
      <div class="field">
        <label for="waitFor">Wait for <span class="hint">— a selector that means the page is ready</span></label>
        <input id="waitFor" name="waitFor" placeholder="text=Overview" value="${esc(values.waitFor ?? '')}">
      </div>
      <div class="field">
        <label for="viewport">Viewport</label>
        <select id="viewport" name="viewport">
          <option value="1440x900">1440 × 900 — desktop</option>
          <option value="1280x800">1280 × 800 — laptop</option>
          <option value="768x1024">768 × 1024 — tablet</option>
          <option value="390x844">390 × 844 — phone</option>
        </select>
      </div>
      <div class="field">
        <label for="tokens">Design tokens <span class="hint">— leave as-is to use the defaults</span></label>
        <textarea id="tokens" name="tokens">${esc(values.tokens ?? DEFAULT_TOKENS)}</textarea>
      </div>
    </div>
  </details>

  <button type="submit" id="go">Run audit</button>
</form>
<footer>A run takes 10–30 seconds. The first one also downloads Chromium.</footer>
</div>
<script>
document.getElementById('f').addEventListener('submit', () => {
  const b = document.getElementById('go');
  b.disabled = true; b.textContent = 'Running…';
});
</script>
</body></html>`;
}

const DEFAULT_TOKENS = JSON.stringify({
  color: { palette: ['#FFFFFF', '#F8F9FA', '#E9ECEF', '#CED4DA', '#6C757D', '#343A40', '#212529', '#0D6EFD', '#198754', '#DC3545', '#FFC107'], toleranceDeltaE: 3 },
  type: { families: ['Inter', 'system-ui'], sizesPx: [12, 14, 16, 18, 20, 24, 32, 40], weights: [400, 500, 600, 700] },
  spacing: { basePx: 4 },
  contrast: { minNormalText: 4.5, minLargeText: 3.0 },
  targetSize: { minPx: 24 },
}, null, 2);

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 1e6) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
    req.on('error', reject);
  });
}

async function runAudit(form) {
  const tokens = JSON.parse(form.tokens || DEFAULT_TOKENS);
  const target = new URL(form.url);
  const [w, h] = (form.viewport || '1440x900').split('x').map(Number);

  const { captureScreen } = await import('./capture.mjs');
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Playwright is not installed. Run: npm install playwright && npx playwright install chromium');
  }

  const outDir = await mkdtemp(path.join(tmpdir(), 'design-audit-'));
  const browser = await chromium.launch();
  try {
    const screen = {
      name: 'page',
      path: target.pathname + target.search,
      waitFor: form.waitFor || null,
      viewport: { width: w, height: h },
    };
    const config = { baseUrl: target.origin, viewport: { width: w, height: h }, captureTimeoutMs: 30000 };
    const { snapshot, screenshot } = await captureScreen(screen, config, { outDir, browser });

    const result = applyExceptions(runChecks(snapshot, tokens, { checks: {} }), { exceptions: [] });

    let figmaImg = null;
    if (form.figma && form.token) {
      const { downloadFrame } = await import('./figma.mjs');
      const key = (form.figma.match(/\/(?:design|file)\/([A-Za-z0-9]+)/) || [])[1];
      const node = normaliseNodeId(form.figma);
      if (!key || !node) throw new Error('That Figma link has no file key or node id in it. Copy the link from “Copy link to selection”.');
      const dest = path.join(outDir, 'figma.png');
      await downloadFrame(node, dest, { fileKey: key, token: form.token });
      figmaImg = await imageDataUri(dest);
    }

    const html = toHTML(result, { project: target.hostname, baseUrl: form.url }, {
      build: await imageDataUri(screenshot),
      figma: figmaImg,
    });
    return html;
  } finally {
    await browser.close();
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function serve({ port = 4000 } = {}) {
  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'text/html; charset=utf-8') =>
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }).end(body);

    try {
      if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
        return send(200, formPage(null));
      }
      if (req.method === 'POST' && req.url === '/run') {
        const form = await parseBody(req);
        try {
          return send(200, await runAudit(form));
        } catch (err) {
          return send(200, formPage(err.message, form));
        }
      }
      return send(404, formPage('Not found'));
    } catch (err) {
      return send(500, formPage(err.message));
    }
  });

  // Localhost only. This holds a Figma token in memory; it is not for exposing.
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  design-audit is running at http://127.0.0.1:${port}\n  Press Ctrl+C to stop.\n`);
  });
  return server;
}
