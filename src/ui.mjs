/**
 * The local UI: shell, landing, the two forms, and the results page.
 * Plain HTML and CSS — no build step, no framework, no network calls.
 */

import { collapseFindings, collapseStats } from './collapse.mjs';

export const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CSS = `
:root{
  --bg:#0b0e14; --surface:#12161f; --surface-2:#191e2a; --line:#242b38; --line-2:#2f3747;
  --ink:#e8edf4; --ink-2:#99a3b3; --ink-3:#6a7384;
  --accent:#5b8cff; --accent-2:#7aa2ff; --accent-ink:#fff;
  --p1:#ff6b63; --p2:#e3a21a; --p3:#5b8cff; --ok:#3ecf8e;
  --r:12px; --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.28);
}
@media (prefers-color-scheme:light){:root{
  --bg:#f7f8fa; --surface:#fff; --surface-2:#f2f4f7; --line:#e3e7ee; --line-2:#d5dae3;
  --ink:#121722; --ink-2:#5a6475; --ink-3:#848d9c;
  --shadow:0 1px 2px rgba(16,24,40,.06),0 8px 24px rgba(16,24,40,.08);
}}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:var(--accent)}

.topbar{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 86%,transparent);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.topbar .in{max-width:1080px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:14px}
.brand{display:flex;align-items:center;gap:9px;font-weight:650;letter-spacing:-.01em;
  text-decoration:none;color:var(--ink);font-size:15px}
.brand .dot{width:9px;height:9px;border-radius:3px;
  background:linear-gradient(135deg,var(--accent),var(--ok))}
.spacer{flex:1}
.ghost{font-size:13px;color:var(--ink-2);text-decoration:none;padding:6px 10px;border-radius:8px}
.ghost:hover{background:var(--surface-2);color:var(--ink)}

.page{max-width:1080px;margin:0 auto;padding:44px 20px 80px}
.narrow{max-width:660px}
h1{font-size:26px;line-height:1.25;margin:0 0 8px;letter-spacing:-.02em}
h2{font-size:17px;margin:0 0 4px;letter-spacing:-.01em}
.lede{color:var(--ink-2);font-size:14.5px;margin:0 0 36px;max-width:60ch}

.modes{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:720px){.modes{grid-template-columns:1fr}}
.mode{display:block;text-decoration:none;color:inherit;background:var(--surface);
  border:1px solid var(--line);border-radius:var(--r);padding:24px;transition:.16s}
.mode:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:var(--shadow)}
.mode .ic{width:40px;height:40px;border-radius:10px;background:var(--surface-2);
  border:1px solid var(--line);display:grid;place-items:center;margin:0 0 16px}
.mode p{color:var(--ink-2);font-size:13.5px;margin:6px 0 16px;min-height:3em}
.mode .go{font-size:13px;font-weight:600;color:var(--accent)}
.mode .meta{margin-top:14px;padding-top:14px;border-top:1px solid var(--line);
  font-size:12px;color:var(--ink-3)}

form{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);
  padding:26px;box-shadow:var(--shadow)}
.field{margin:0 0 20px}
label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}
.hint{font-weight:400;color:var(--ink-3);font-size:12px}
input,textarea,select{width:100%;font:inherit;font-size:14px;color:var(--ink);
  background:var(--bg);border:1px solid var(--line-2);border-radius:9px;padding:10px 12px;
  transition:border-color .14s,box-shadow .14s}
input:focus,textarea:focus,select:focus{outline:0;border-color:var(--accent);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
textarea{font-family:var(--mono);font-size:12.5px;min-height:150px;resize:vertical}
.row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:620px){.row{grid-template-columns:1fr}}
details{border:1px solid var(--line);border-radius:10px;background:var(--bg);margin:0 0 20px}
summary{cursor:pointer;padding:11px 13px;font-size:13px;font-weight:600;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"▸ ";color:var(--ink-3)}
details[open] summary::before{content:"▾ "}
details .inner{padding:4px 13px 14px}
.btn{display:inline-block;text-decoration:none;font:inherit;font-weight:600;font-size:14px;
  background:var(--accent);color:var(--accent-ink);border:0;border-radius:9px;
  padding:11px 20px;cursor:pointer;transition:.14s}
.btn:hover{background:var(--accent-2)}
.btn[disabled]{opacity:.6;cursor:progress}
.btn.sec{background:var(--surface-2);color:var(--ink);border:1px solid var(--line-2)}
.btn.sec:hover{background:var(--line)}
.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}

.err{border:1px solid var(--p1);background:color-mix(in srgb,var(--p1) 12%,transparent);
  border-radius:10px;padding:13px 15px;font-size:13.5px;margin:0 0 22px}
.err b{color:var(--p1)}

.sum{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 22px}
.sum .spacer{flex:1;min-width:0}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:999px;
  padding:7px 14px;font-size:12.5px;color:var(--ink-2)}
.stat b{color:var(--ink);font-weight:650;font-variant-numeric:tabular-nums}
.stat.p1 b{color:var(--p1)}.stat.p2 b{color:var(--p2)}.stat.p3 b{color:var(--p3)}

.panes{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:0 0 26px}
@media(max-width:760px){.panes{grid-template-columns:1fr}}
.pane{border:1px solid var(--line);border-radius:var(--r);background:var(--surface);overflow:hidden}
.pane h3{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2);
  margin:0;padding:11px 14px;border-bottom:1px solid var(--line);font-weight:650}
.pane img{display:block;width:100%;height:auto}
.pane .empty{padding:44px 18px;text-align:center;color:var(--ink-3);font-size:13px}

.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px}
button.f{font:inherit;font-size:13px;color:var(--ink);background:var(--surface);
  border:1px solid var(--line-2);border-radius:8px;padding:6px 12px;cursor:pointer}
button.f[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}
.bar select,.bar input{width:auto;font-size:13px;padding:6px 10px}
.bar input[type=search]{flex:1;min-width:170px}

table{width:100%;border-collapse:collapse;font-size:13.5px}
thead th{text-align:left;font-size:10px;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-3);font-weight:650;padding:0 10px 9px;border-bottom:1px solid var(--line)}
tbody tr{border-bottom:1px solid var(--line)}
tbody tr:hover{background:var(--surface)}
td{padding:11px 10px;vertical-align:top}
.sev{display:inline-block;min-width:26px;text-align:center;font-size:11px;font-weight:700;
  border-radius:5px;padding:2px 7px}
.sev.P1{background:color-mix(in srgb,var(--p1) 18%,transparent);color:var(--p1)}
.sev.P2{background:color-mix(in srgb,var(--p2) 18%,transparent);color:var(--p2)}
.sev.P3{background:color-mix(in srgb,var(--p3) 18%,transparent);color:var(--p3)}
.sel{font-family:var(--mono);font-size:12px;color:var(--ink-2);cursor:pointer;
  word-break:break-all;border:0;background:none;padding:0;text-align:left}
.sel:hover{color:var(--accent)}
.check{font-size:11px;color:var(--ink-3);margin-top:2px}
.none{padding:48px 0;text-align:center;color:var(--ink-3)}
footer{margin:44px 0 0;padding-top:16px;border-top:1px solid var(--line);
  font-size:12px;color:var(--ink-3)}

/* hero */
.hero{position:relative;padding:18px 0 46px;text-align:center}
.hero::before{content:"";position:absolute;inset:-60px -40% auto;height:380px;z-index:-1;
  background:radial-gradient(60% 60% at 50% 0%,color-mix(in srgb,var(--accent) 16%,transparent),transparent 70%)}
.hero h1{font-size:40px;line-height:1.1;letter-spacing:-.03em;margin:0 auto 14px;max-width:16ch}
.hero .lede{font-size:16px;margin:0 auto 10px;max-width:56ch}
.kicker{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;font-weight:600;
  letter-spacing:.04em;text-transform:uppercase;color:var(--ink-2);background:var(--surface);
  border:1px solid var(--line);border-radius:999px;padding:5px 12px;margin:0 0 20px}
.kicker b{color:var(--ok);font-weight:700}

/* sections */
.band{margin:56px 0 0}
.band h2{font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-3);
  margin:0 0 18px;font-weight:650}
.checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.chk{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:15px 16px}
.chk b{display:block;font-size:13.5px;margin:0 0 3px}
.chk span{font-size:12.5px;color:var(--ink-2);line-height:1.5}
.steps{counter-reset:s;display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}
.step{position:relative;padding:0 0 0 38px}
.step::before{counter-increment:s;content:counter(s);position:absolute;left:0;top:-1px;
  width:26px;height:26px;border-radius:50%;background:var(--surface);border:1px solid var(--line);
  color:var(--ink-2);font:650 12px/25px ui-sans-serif,system-ui;text-align:center}
.step b{display:block;font-size:14px;margin:0 0 3px}
.step span{font-size:13px;color:var(--ink-2)}

/* download menu */
.menu{position:relative}
.menu>button{display:inline-flex;align-items:center;gap:8px}
.menu>button::after{content:"";width:0;height:0;border:4px solid transparent;
  border-top-color:currentColor;margin-top:2px}
.menu .pop{position:absolute;right:0;top:calc(100% + 8px);z-index:30;min-width:310px;
  background:var(--surface);border:1px solid var(--line);border-radius:11px;
  box-shadow:var(--shadow);padding:6px;display:none}
.menu[data-open="true"] .pop{display:block}
.menu .pop a{display:block;text-decoration:none;color:inherit;border-radius:8px;padding:10px 12px}
.menu .pop a:hover,.menu .pop a:focus-visible{background:var(--surface-2);outline:none}
.menu .pop b{display:block;font-size:13.5px;margin:0 0 2px}
.menu .pop span{display:block;font-size:12px;color:var(--ink-2);line-height:1.45}
.menu .pop hr{border:0;border-top:1px solid var(--line);margin:5px 8px}
.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--ink);
  color:var(--bg);font-size:12.5px;padding:9px 15px;border-radius:8px;opacity:0;
  transition:opacity .18s;pointer-events:none}
.toast.on{opacity:1}
.spin{display:none;width:15px;height:15px;border:2px solid var(--line-2);
  border-top-color:var(--accent);border-radius:50%;animation:sp .7s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.loading .spin{display:inline-block}
`;

export function shell(title, body, { wide = false } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
<div class="topbar"><div class="in">
  <a class="brand" href="/"><span class="dot"></span>design-audit</a>
  <span class="spacer"></span>
  <a class="ghost" href="/">Start over</a>
  <a class="ghost" href="https://github.com/Lubnabano02/design-audit">GitHub</a>
</div></div>
<div class="page${wide ? '' : ' narrow'}">${body}</div>
<div class="toast" id="toast"></div>
</body></html>`;
}

const ICON_AUDIT = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M2.5 7h15M6 11h4M6 13.5h7"/></svg>`;
const ICON_COMPARE = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
<rect x="2" y="4" width="7" height="12" rx="1.5"/><rect x="11" y="4" width="7" height="12" rx="1.5"/><path d="M10 2.5v15"/></svg>`;

export function landing() {
  const check = (name, what) => `<div class="chk"><b>${name}</b><span>${what}</span></div>`;
  return shell('design-audit', `
<div class="hero">
  <span class="kicker"><b>●</b> Runs on your machine</span>
  <h1>See where the build drifted from the design</h1>
  <p class="lede">Reads what the browser actually rendered and measures it against your design tokens.
     Then tells the designer and the developer, each in their own language.</p>
</div>

<div class="modes">
  <a class="mode" href="/audit">
    <div class="ic">${ICON_AUDIT}</div>
    <h2>Audit a page</h2>
    <p>Check a live page against your design tokens. No Figma needed.</p>
    <div class="go">Start →</div>
    <div class="meta">Needs: a URL</div>
  </a>
  <a class="mode" href="/compare">
    <div class="ic">${ICON_COMPARE}</div>
    <h2>Compare with Figma</h2>
    <p>The same checks, plus the frame beside the build so you can see them together.</p>
    <div class="go">Start →</div>
    <div class="meta">Needs: a URL, a frame link, a Figma token</div>
  </a>
</div>

<div class="band">
  <h2>What it checks</h2>
  <div class="checks">
    ${check('Readability', 'Contrast measured against the background the text really sits on, not the one it declares.')}
    ${check('Colour', 'Rendered colours matched to your palette by how different they look, not by string equality.')}
    ${check('Type', 'Sizes, families and weights that are not in your system.')}
    ${check('Spacing', 'Padding and margins that do not sit on your base unit.')}
    ${check('Touch targets', 'Controls too small to hit reliably.')}
  </div>
</div>

<div class="band">
  <h2>How it works</h2>
  <div class="steps">
    <div class="step"><b>Point it at a page</b><span>It loads the page in a real browser and reads every visible element.</span></div>
    <div class="step"><b>Give it your tokens</b><span>Your palette, type scale and spacing unit become the rules it checks against.</span></div>
    <div class="step"><b>Take the reports</b><span>A visual review for the designer, a precise one for the developer, a CSV for triage.</span></div>
  </div>
</div>

<footer>Nothing is uploaded and nothing is stored. A Figma token is held in memory for one run and never written to disk.
  <a href="https://github.com/Lubnabano02/design-audit">Source on GitHub</a>.</footer>
`, { wide: true });
}

export const DEFAULT_TOKENS = JSON.stringify({
  color: { palette: ['#FFFFFF', '#F8F9FA', '#E9ECEF', '#CED4DA', '#6C757D', '#343A40', '#212529', '#0D6EFD', '#198754', '#DC3545', '#FFC107'], toleranceDeltaE: 3 },
  type: { families: ['Inter', 'system-ui'], sizesPx: [12, 14, 16, 18, 20, 24, 32, 40], weights: [400, 500, 600, 700] },
  spacing: { basePx: 4 },
  contrast: { minNormalText: 4.5, minLargeText: 3.0 },
  targetSize: { minPx: 24 },
  performance: { pageLoadWarnMs: 2500, pageLoadFailMs: 5000, ttfbWarnMs: 600,
                 longTaskMs: 50, longTaskBudgetMs: 400,
                 interactionWarnMs: 300, interactionFailMs: 1000, layoutShiftWarn: 0.1 },
}, null, 2);

export function form(mode, { error, values = {} } = {}) {
  const compare = mode === 'compare';
  const title = compare ? 'Compare with Figma' : 'Audit a page';
  const lede = compare
    ? 'The build and the frame, side by side, with the rule checks underneath.'
    : 'Check a live page against your design tokens.';

  return shell(`${title} — design-audit`, `
<h1>${esc(title)}</h1>
<p class="lede">${esc(lede)}</p>
${error ? `<div class="err"><b>Could not finish.</b> ${esc(error)}</div>` : ''}
<form method="POST" action="/run" id="f">
  <input type="hidden" name="mode" value="${esc(mode)}">

  <div class="field">
    <label for="url">Page URL <span class="hint">— the page to check</span></label>
    <input id="url" name="url" type="url" required placeholder="https://example.com/dashboard"
           value="${esc(values.url ?? '')}" autofocus>
  </div>

  ${compare ? `
  <div class="field">
    <label for="figma">Figma frame <span class="hint">— right-click the frame → Copy link to selection</span></label>
    <input id="figma" name="figma" type="url" required
           placeholder="https://www.figma.com/design/KEY/File?node-id=1-2" value="${esc(values.figma ?? '')}">
  </div>
  <div class="field">
    <label for="token">Figma token <span class="hint">— Figma → Settings → Personal access tokens (file content, read-only)</span></label>
    <input id="token" name="token" type="password" required placeholder="figd_…" autocomplete="off">
  </div>` : ''}

  <details>
    <summary>Page settings</summary>
    <div class="inner">
      <div class="field">
        <label for="consent">Cookie banner <span class="hint">— cleared before anything is measured</span></label>
        <select id="consent" name="consent">
          <option value="decline">Decline it (recommended)</option>
          <option value="accept">Accept it</option>
          <option value="off">Leave it alone</option>
        </select>
      </div>
      <div class="field">
        <label for="dismiss">Dismiss this first <span class="hint">— optional selector, if the banner is not found automatically</span></label>
        <input id="dismiss" name="dismiss" placeholder="#cookie-banner .accept" value="${esc(values.dismiss ?? '')}">
      </div>
      <div class="field">
        <label for="maxPages">How many pages <span class="hint">— follows links from this page, same site only</span></label>
        <select id="maxPages" name="maxPages">
          <option value="1">Just this page</option>
          <option value="5">This page + up to 4 linked</option>
          <option value="10">This page + up to 9 linked</option>
        </select>
      </div>
      <div class="row">
        <div class="field">
          <label for="waitFor">Wait for <span class="hint">— optional selector</span></label>
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
      </div>
    </div>
  </details>

  <details>
    <summary>Design tokens</summary>
    <div class="inner">
      <p class="hint" style="margin:0 0 10px">Replace these with your own. The defaults are a generic palette — left as-is, they will flag most of your page.</p>
      <textarea id="tokens" name="tokens" spellcheck="false">${esc(values.tokens ?? DEFAULT_TOKENS)}</textarea>
    </div>
  </details>

  <div class="actions">
    <button class="btn" type="submit" id="go">Run check</button>
    <span class="spin" id="sp"></span>
    <span class="hint" id="note">Takes 10–30 seconds.</span>
  </div>
</form>
<script>
document.getElementById('f').addEventListener('submit', e => {
  const b = document.getElementById('go');
  b.disabled = true; b.textContent = 'Running…';
  document.querySelector('.actions').classList.add('loading');
  document.getElementById('note').textContent = 'Loading the page and reading its styles…';
});
</script>
`);
}

const pane = (title, src, empty) =>
  `<div class="pane"><h3>${esc(title)}</h3>${
    src ? `<img src="${src}" alt="${esc(title)}">` : `<p class="empty">${esc(empty)}</p>`}</div>`;

/** The in-app results view, with the downloads. */
export function results(id, result, meta, images, mode) {
  const { findings, suppressed = [] } = result;
  const problems = collapseStats(collapseFindings(findings)).problems;
  const n = sev => findings.filter(f => f.severity === sev).length;
  const checks = [...new Set(findings.map(f => f.check))].sort();

  const rows = findings.map(f => `<tr data-sev="${esc(f.severity)}" data-check="${esc(f.check)}"
      data-hay="${esc((f.severity + ' ' + f.check + ' ' + f.selector + ' ' + f.message).toLowerCase())}">
    <td><span class="sev ${esc(f.severity)}">${esc(f.severity)}</span></td>
    <td><button class="sel" title="Click to copy">${esc(f.selector)}</button>
        <div class="check">${esc(f.check)}</div></td>
    <td>${esc(f.message)}</td></tr>`).join('');

  return shell(`Results — ${esc(meta.project ?? 'design-audit')}`, `
<h1>${esc(meta.project ?? 'Results')}</h1>
<p class="lede">${(meta.pages?.length ?? 1) > 1
  ? `${meta.pages.length} pages checked — ${meta.pages.map(u => esc(new URL(u).pathname)).join(', ')}`
  : esc(meta.baseUrl ?? '')}${
  meta.failed?.length ? ` · ${meta.failed.length} could not be loaded` : ''}</p>

<div class="sum">
  <span class="stat"><b>${problems}</b> problems</span>
  <span class="stat"><b>${findings.length}</b> elements</span>
  <span class="stat p1"><b>${n('P1')}</b> P1</span>
  <span class="stat p2"><b>${n('P2')}</b> P2</span>
  <span class="stat p3"><b>${n('P3')}</b> P3</span>
  ${suppressed.length ? `<span class="stat"><b>${suppressed.length}</b> by design</span>` : ''}
  <span class="spacer"></span>
  <div class="menu" id="dl">
    <button class="btn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="dlpop">Download</button>
    <div class="pop" id="dlpop" role="menu">
      <a role="menuitem" href="/r/${id}/review.html" download>
        <b>Designer review</b><span>Findings marked on the page, grouped by concern, in plain language.</span></a>
      <a role="menuitem" href="/r/${id}/report.html" download>
        <b>Developer report</b><span>Selectors, properties and exact values, filterable.</span></a>
      <hr>
      <a role="menuitem" href="/r/${id}/findings.csv" download>
        <b>Findings (CSV)</b><span>One row per element. Opens in Excel or Sheets for triage.</span></a>
    </div>
  </div>
</div>

<div class="panes">
  ${pane('Build', images.build, 'No capture for this run.')}
  ${mode === 'compare'
    ? pane('Figma', images.figma, 'The frame could not be fetched.')
    : pane('Figma', null, 'Not compared. Use “Compare with Figma” to see the frame here.')}
</div>

<div class="bar">
  <button class="f" data-sev="all" aria-pressed="true">All</button>
  <button class="f" data-sev="P1" aria-pressed="false">P1</button>
  <button class="f" data-sev="P2" aria-pressed="false">P2</button>
  <button class="f" data-sev="P3" aria-pressed="false">P3</button>
  <select id="check"><option value="all">All checks</option>${
    checks.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
  <input id="q" type="search" placeholder="Filter…">
</div>

${findings.length
  ? `<table><thead><tr><th>Severity</th><th>Element</th><th>Finding</th></tr></thead><tbody>${rows}</tbody></table>
     <p class="lede" style="margin-top:12px"><span id="shown">${findings.length}</span> of ${findings.length} elements shown · the designer review folds these into ${problems} problems</p>`
  : `<p class="none">No findings. Either the page matches your tokens, or the tokens are too loose to catch anything.</p>
     <span id="shown" hidden></span>`}

<footer>Run again from <a href="/">the start</a>. Downloads stay available until you stop the server.</footer>
<script>
const rows=[...document.querySelectorAll('tbody tr')];
const btns=[...document.querySelectorAll('button.f')];
const sel=document.getElementById('check'), q=document.getElementById('q');
let sev='all';
function apply(){const needle=q.value.trim().toLowerCase(),c=sel.value;let k=0;
  for(const r of rows){const ok=(sev==='all'||r.dataset.sev===sev)&&(c==='all'||r.dataset.check===c)
    &&(!needle||r.dataset.hay.includes(needle));r.hidden=!ok;if(ok)k++}
  const s=document.getElementById('shown'); if(s) s.textContent=k;}
btns.forEach(b=>b.addEventListener('click',()=>{sev=b.dataset.sev;
  btns.forEach(x=>x.setAttribute('aria-pressed',String(x===b)));apply()}));
sel.addEventListener('change',apply); q.addEventListener('input',apply);
const dl=document.getElementById('dl'), dlb=dl.querySelector('button');
const setOpen=v=>{dl.dataset.open=String(v);dlb.setAttribute('aria-expanded',String(v))};
dlb.addEventListener('click',e=>{e.stopPropagation();setOpen(dl.dataset.open!=='true')});
document.addEventListener('click',e=>{if(!dl.contains(e.target))setOpen(false)});
document.addEventListener('keydown',e=>{if(e.key==='Escape')setOpen(false)});
dl.querySelectorAll('.pop a').forEach(a=>a.addEventListener('click',()=>setOpen(false)));

const toast=document.getElementById('toast');
document.addEventListener('click',e=>{const b=e.target.closest('.sel');if(!b)return;
  navigator.clipboard?.writeText(b.textContent.trim()).then(()=>{
    toast.textContent='Selector copied';toast.classList.add('on');
    setTimeout(()=>toast.classList.remove('on'),1200)}).catch(()=>{})});
</script>
`, { wide: true });
}
