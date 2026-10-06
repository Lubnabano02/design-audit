/**
 * A self-contained HTML report.
 *
 * Images are embedded as data URIs so a single file can be opened anywhere,
 * or sent to someone, without the run folder going with it.
 */

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const count = (arr, sev) => arr.filter(f => f.severity === sev).length;

/** Developer sections, in the order a developer would triage them. */
const SECTIONS = [
  { ids: ['errors'],          title: 'Errors and failed requests', blurb: 'Anything that threw, or never arrived.' },
  { ids: ['interactions'],    title: 'Interactions',               blurb: 'Controls that were driven, and how long they took to respond.' },
  { ids: ['pageLoad', 'mainThread'], title: 'Performance',         blurb: 'Load timing, main-thread blocking and layout stability.' },
  { ids: ['brokenControls'],  title: 'Broken controls',            blurb: 'Links that go nowhere, unnamed buttons, images that failed, unlabelled fields.' },
  { ids: ['contrast', 'colorTokens', 'typeScale', 'spacingGrid', 'targetSize'],
    title: 'Design implementation', blurb: 'Where the build drifted from the tokens. The designer review groups these by problem.' },
];

const STYLE = `
:root{
  --bg:#0e1116; --panel:#161b22; --panel-2:#1c2230; --line:#2a3240;
  --ink:#e6edf3; --ink-2:#9aa7b4; --ink-3:#6b7684;
  --p1:#f85149; --p2:#d29922; --p3:#58a6ff; --ok:#3fb950; --accent:#58a6ff;
  --radius:10px; --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
}
@media (prefers-color-scheme:light){
  :root:not([data-theme="dark"]){
    --bg:#ffffff; --panel:#f6f8fa; --panel-2:#eef1f4; --line:#d8dee4;
    --ink:#1f2328; --ink-2:#59636e; --ink-3:#818b98;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:32px 16px 72px}
h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
.sub{color:var(--ink-2);font-size:13px;margin:0 0 20px}
.who{display:inline-block;font-size:12px;color:var(--ink-2);background:var(--panel);
  border:1px solid var(--line);border-radius:999px;padding:5px 13px;margin:0 0 18px}
.sub a{color:var(--accent)}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 24px}
.chip{border:1px solid var(--line);background:var(--panel);border-radius:999px;
  padding:5px 12px;font-size:12px;color:var(--ink-2);white-space:nowrap}
.chip b{color:var(--ink);font-weight:600}
.chip.p1 b{color:var(--p1)} .chip.p2 b{color:var(--p2)} .chip.p3 b{color:var(--p3)}
.compare{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:0 0 28px}
@media (max-width:760px){.compare{grid-template-columns:1fr}}
.pane{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);overflow:hidden}
.pane h2{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-2);
  margin:0;padding:10px 14px;border-bottom:1px solid var(--line);font-weight:600}
.pane img{display:block;width:100%;height:auto}
.pane .empty{padding:36px 16px;text-align:center;color:var(--ink-3);font-size:13px}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px}
button.f,select,input[type=search]{font:inherit;font-size:13px;color:var(--ink);
  background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:6px 11px}
button.f{cursor:pointer}
button.f[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}
input[type=search]{flex:1;min-width:180px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
thead th{text-align:left;font-size:10px;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-3);font-weight:600;padding:0 10px 8px;border-bottom:1px solid var(--line)}
tbody tr{border-bottom:1px solid var(--line)}
tbody tr:hover{background:var(--panel)}
td{padding:11px 10px;vertical-align:top}
.sev{display:inline-block;min-width:26px;text-align:center;font-size:11px;font-weight:700;
  border-radius:5px;padding:2px 6px}
.sev.P1{background:rgba(248,81,73,.16);color:var(--p1)}
.sev.P2{background:rgba(210,153,34,.16);color:var(--p2)}
.sev.P3{background:rgba(88,166,255,.16);color:var(--p3)}
.sel{font-family:var(--mono);font-size:12px;color:var(--ink-2);cursor:pointer;
  word-break:break-all;border:0;background:none;padding:0;text-align:left}
.sel:hover{color:var(--accent)}
.check{font-size:11px;color:var(--ink-3)}
.times{display:inline-block;margin-left:6px;font-size:11px;font-weight:600;color:var(--ink-3);
  background:var(--panel-2);border:1px solid var(--line);border-radius:5px;padding:1px 6px;vertical-align:1px}
.none{padding:40px 0;text-align:center;color:var(--ink-3)}
.sec{margin:0 0 30px}
.sh{display:flex;align-items:baseline;gap:9px;margin:0 0 3px}
.sh h2{font-size:16px;margin:0;letter-spacing:-.01em}
.sh .n{font-size:12px;color:var(--ink-3)}
.sb{color:var(--ink-2);font-size:12.5px;margin:0 0 11px}
details{margin:22px 0 0;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}
details>summary{cursor:pointer;padding:12px 14px;font-size:13px;font-weight:600}
details .inner{padding:0 14px 14px}
.note{font-size:12.5px;color:var(--ink-2);margin:0 0 10px}
footer{margin:40px 0 0;padding-top:16px;border-top:1px solid var(--line);
  font-size:12px;color:var(--ink-3)}
footer a{color:var(--ink-2)}
.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--ink);
  color:var(--bg);font-size:12.5px;padding:8px 14px;border-radius:7px;opacity:0;
  transition:opacity .18s;pointer-events:none}
.toast.on{opacity:1}
`;

const SCRIPT = `
const rows = [...document.querySelectorAll('tbody tr')];
const sevBtns = [...document.querySelectorAll('button.f[data-sev]')];
const checkSel = document.getElementById('check');
const q = document.getElementById('q');
let sev = 'all';

function apply(){
  const needle = q.value.trim().toLowerCase();
  const check = checkSel.value;
  let shown = 0;
  for (const r of rows){
    const ok = (sev === 'all' || r.dataset.sev === sev)
      && (check === 'all' || r.dataset.check === check)
      && (!needle || r.dataset.hay.includes(needle));
    r.hidden = !ok;
    if (ok) shown++;
  }
  document.getElementById('shown').textContent = shown;
}
sevBtns.forEach(b => b.addEventListener('click', () => {
  sev = b.dataset.sev;
  sevBtns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  apply();
}));
checkSel.addEventListener('change', apply);
q.addEventListener('input', apply);

const toast = document.getElementById('toast');
document.addEventListener('click', e => {
  const b = e.target.closest('.sel');
  if (!b) return;
  navigator.clipboard?.writeText(b.textContent.trim()).then(() => {
    toast.textContent = 'Selector copied';
    toast.classList.add('on');
    setTimeout(() => toast.classList.remove('on'), 1200);
  }).catch(() => {});
});
`;

function pane(title, dataUri, emptyNote) {
  return `<div class="pane"><h2>${esc(title)}</h2>${
    dataUri ? `<img src="${dataUri}" alt="${esc(title)}">`
            : `<p class="empty">${esc(emptyNote)}</p>`
  }</div>`;
}

/**
 * @param {{findings:Array,suppressed:Array,expired:Array,unused:Array}} result
 * @param {{project?:string,baseUrl?:string,figmaUrl?:string}} meta
 * @param {{build?:string|null, figma?:string|null}} images  data URIs
 */
export function toHTML(result, meta = {}, images = {}) {
  const { findings, suppressed = [], expired = [], unused = [] } = result;
  const checksUsed = [...new Set(findings.map(f => f.check))].sort();

  const row = f => {
    const hay = `${f.severity} ${f.check} ${f.selector} ${f.message}`.toLowerCase();
    return `<tr data-sev="${esc(f.severity)}" data-check="${esc(f.check)}" data-hay="${esc(hay)}">
      <td><span class="sev ${esc(f.severity)}">${esc(f.severity)}</span></td>
      <td><button class="sel" title="Click to copy">${esc(f.selector)}</button>
          <div class="check">${esc(f.check)}${f.screen && f.screen !== '-' ? ' · ' + esc(f.screen) : ''}</div></td>
      <td>${esc(f.message)}${f.times > 1 ? ` <span class="times">×${f.times}</span>` : ''}</td>
    </tr>`;
  };

  const sections = SECTIONS.map(sec => {
    const group = findings.filter(f => sec.ids.includes(f.check));
    if (!group.length) return '';
    return `<section class="sec">
      <div class="sh"><h2>${esc(sec.title)}</h2><span class="n">${group.length}</span></div>
      <p class="sb">${esc(sec.blurb)}</p>
      <table><thead><tr><th>Severity</th><th>Element</th><th>Finding</th></tr></thead>
        <tbody>${group.map(row).join('')}</tbody></table>
    </section>`;
  }).join('');

  const rows = findings.map(row).join('\n');

  const suppressedBlock = suppressed.length ? `
  <details>
    <summary>By design — ${suppressed.length} covered by an approved exception</summary>
    <div class="inner">
      <p class="note">Real divergences somebody has already ruled on. Listed so the decision stays visible, not so it gets re-argued.</p>
      <table><thead><tr><th>Exception</th><th>Element</th><th>Finding</th><th>Reason</th><th>Approved by</th></tr></thead><tbody>
      ${suppressed.map(s => `<tr><td>${esc(s.exception.id)}</td><td class="sel">${esc(s.selector)}</td><td>${esc(s.message)}</td><td>${esc(s.exception.reason)}</td><td>${esc(s.exception.approvedBy)}</td></tr>`).join('')}
      </tbody></table>
    </div>
  </details>` : '';

  const staleBlock = (expired.length || unused.length) ? `
  <details>
    <summary>Exceptions needing attention — ${expired.length + unused.length}</summary>
    <div class="inner">
      ${expired.length ? `<p class="note"><b>Expired</b> — these no longer suppress anything.</p><ul>${expired.map(e => `<li>${esc(e.id)} (${esc(e.check)}) expired ${esc(e.expiresOn)} — ${esc(e.reason)}</li>`).join('')}</ul>` : ''}
      ${unused.length ? `<p class="note"><b>Unused</b> — nothing matched. Either it was fixed, or the match block has drifted.</p><ul>${unused.map(e => `<li>${esc(e.id)} (${esc(e.check)}) — ${esc(e.reason)}</li>`).join('')}</ul>` : ''}
    </div>
  </details>` : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Developer report${meta.project ? ' — ' + esc(meta.project) : ''}</title>
<style>${STYLE}</style></head>
<body><div class="wrap">

<h1>Developer report${meta.project ? ' — ' + esc(meta.project) : ''}</h1>
<p class="who">For the developer — every element, with selectors and exact values. The designer review groups these by problem.</p>
<p class="sub">${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC${
  meta.baseUrl ? ` · <a href="${esc(meta.baseUrl)}">${esc(meta.baseUrl)}</a>` : ''}</p>

<div class="chips">
  <span class="chip"><b>${findings.length}</b> findings</span>
  ${(() => { const fn = findings.filter(f => ['errors','interactions','pageLoad','mainThread','brokenControls'].includes(f.check)).length;
     return fn ? `<span class="chip"><b>${fn}</b> functional</span><span class="chip"><b>${findings.length - fn}</b> design</span>` : ''; })()}
  <span class="chip p1"><b>${count(findings, 'P1')}</b> P1</span>
  <span class="chip p2"><b>${count(findings, 'P2')}</b> P2</span>
  <span class="chip p3"><b>${count(findings, 'P3')}</b> P3</span>
  ${suppressed.length ? `<span class="chip"><b>${suppressed.length}</b> suppressed</span>` : ''}
</div>

<div class="compare">
  ${pane('Build', images.build, 'No capture for this run.')}
  ${pane('Figma', images.figma, 'No Figma frame — add a frame link and a token to compare.')}
</div>

<div class="bar">
  <button class="f" data-sev="all" aria-pressed="true">All</button>
  <button class="f" data-sev="P1" aria-pressed="false">P1</button>
  <button class="f" data-sev="P2" aria-pressed="false">P2</button>
  <button class="f" data-sev="P3" aria-pressed="false">P3</button>
  <select id="check"><option value="all">All checks</option>${
    checksUsed.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
  <input id="q" type="search" placeholder="Filter by selector or message…">
</div>

${findings.length ? `${sections}
<p class="sub" style="margin-top:12px"><span id="shown">${findings.length}</span> of ${findings.length} shown</p>`
: `<p class="none">No findings. Either the build matches the system, or the checks are not looking hard enough — worth knowing which.</p>
<p class="sub" style="display:none"><span id="shown">0</span></p>`}

${suppressedBlock}
${staleBlock}

<footer>Generated by <a href="https://github.com/Lubnabano02/design-audit">design-audit</a>. Click any selector to copy it.</footer>
</div>
<div class="toast" id="toast"></div>
<script>${SCRIPT}</script>
</body></html>`;
}

/** Read an image off disk as a data URI, or null if it isn't there. */
export async function imageDataUri(filePath) {
  try {
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(filePath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
