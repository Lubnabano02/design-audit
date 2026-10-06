/**
 * The designer's report.
 *
 * The developer report answers "which element, which property, what value".
 * This one answers "where is it, what does it look like, and what should it be" —
 * findings drawn on the screenshot, grouped by design concern, with the colours
 * and sizes rendered rather than printed as hex.
 */

import { collapseFindings, collapseStats } from './collapse.mjs';

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Design concerns, in the order a designer would look at them. */
const GROUPS = [
  { id: 'contrast',    title: 'Readability',   blurb: 'Text that is too faint against what sits behind it.' },
  { id: 'colorTokens', title: 'Colour',        blurb: 'Colours that are not in your palette.' },
  { id: 'typeScale',   title: 'Type',          blurb: 'Sizes, families and weights that are not in your system.' },
  { id: 'spacingGrid', title: 'Spacing',       blurb: 'Padding and margins that do not sit on your base unit.' },
  { id: 'targetSize',  title: 'Touch targets', blurb: 'Controls too small to hit reliably.' },
];

/** Say what is wrong in the words a designer would use. */
function plain(f) {
  const d = f.detail ?? {};
  switch (f.check) {
    case 'contrast': {
      const how = d.ratio < 2 ? 'barely visible' : d.ratio < 3 ? 'hard to read' : 'slightly too faint';
      return { headline: `Too light to read — ${how}`,
               detail: `${d.ratio}:1 against its background. Needs at least ${d.required}:1.` };
    }
    case 'colorTokens':
      return { headline: d.property === 'backgroundColor' ? 'Background colour is not in the palette'
                       : d.property === 'borderColor' ? 'Border colour is not in the palette'
                       : 'Text colour is not in the palette',
               detail: `Using ${d.value}. The closest thing in your palette is ${d.nearest}.` };
    case 'typeScale':
      if (d.property === 'fontSize') return { headline: `${d.value}px is not on your type scale`,
                                              detail: `The nearest step is ${d.nearest}px.` };
      if (d.property === 'fontFamily') return { headline: `“${d.value}” is not one of your fonts`,
                                                detail: `Your system uses ${(d.allowed ?? []).join(' or ')}.` };
      return { headline: `Weight ${d.value} is not in your system`,
               detail: `Your weights are ${(d.allowed ?? []).join(', ')}.` };
    case 'spacingGrid': {
      const vals = Object.entries(d.offenders ?? {}).map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()} ${+Number(v).toFixed(2)}px`);
      return { headline: `Spacing is off your ${d.base}px grid`, detail: vals.join(', ') };
    }
    case 'targetSize':
      return { headline: `Too small to tap — ${Math.round(d.width)}×${Math.round(d.height)}px`,
               detail: `Needs to be at least ${d.minimum}×${d.minimum}px.` };
    default:
      return { headline: f.message, detail: '' };
  }
}

/** Show the problem instead of describing it. */
function evidence(f) {
  const d = f.detail ?? {};
  if (f.check === 'contrast') {
    return `<div class="ev"><span class="demo" style="background:${esc(d.background)};color:${esc(d.foreground)}">${
      esc((d.sample || 'Sample text').slice(0, 28))}</span>
      <span class="vs">on</span><span class="sw" style="background:${esc(d.background)}"></span></div>`;
  }
  if (f.check === 'colorTokens') {
    return `<div class="ev"><span class="sw" style="background:${esc(d.value)}"></span>
      <code>${esc(d.value)}</code><span class="vs">should be</span>
      <span class="sw" style="background:${esc(d.nearest)}"></span><code>${esc(d.nearest)}</code></div>`;
  }
  if (f.check === 'typeScale' && d.property === 'fontSize') {
    return `<div class="ev"><span style="font-size:${Math.min(d.value, 34)}px;line-height:1">Aa</span>
      <code>${esc(d.value)}px</code><span class="vs">should be</span>
      <span style="font-size:${Math.min(d.nearest, 34)}px;line-height:1;color:var(--ok)">Aa</span>
      <code>${esc(d.nearest)}px</code></div>`;
  }
  if (f.check === 'targetSize') {
    const w = Math.min(Math.round(d.width), 44), h = Math.min(Math.round(d.height), 44);
    return `<div class="ev"><span class="box" style="width:${w}px;height:${h}px"></span>
      <code>${Math.round(d.width)}×${Math.round(d.height)}</code><span class="vs">should be</span>
      <span class="box ok" style="width:${d.minimum}px;height:${d.minimum}px"></span>
      <code>${d.minimum}×${d.minimum}</code></div>`;
  }
  return '';
}

const CSS = `
:root{--bg:#0b0e14;--surface:#12161f;--line:#242b38;--ink:#e8edf4;--ink-2:#99a3b3;--ink-3:#6a7384;
  --p1:#ff6b63;--p2:#e3a21a;--p3:#5b8cff;--ok:#3ecf8e;--accent:#5b8cff;--mono:ui-monospace,Menlo,monospace}
@media(prefers-color-scheme:light){:root{--bg:#f7f8fa;--surface:#fff;--line:#e3e7ee;
  --ink:#121722;--ink-2:#5a6475;--ink-3:#848d9c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:980px;margin:0 auto;padding:40px 20px 80px}
h1{font-size:25px;margin:0 0 6px;letter-spacing:-.02em}
.lede{color:var(--ink-2);font-size:14px;margin:0 0 28px}
.who{display:inline-block;font-size:12px;color:var(--ink-2);background:var(--surface);
  border:1px solid var(--line);border-radius:999px;padding:5px 13px;margin:0 0 18px}
.stats{display:flex;gap:9px;flex-wrap:wrap;margin:0 0 30px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:999px;
  padding:7px 14px;font-size:12.5px;color:var(--ink-2)}
.stat b{color:var(--ink);font-variant-numeric:tabular-nums}

.shot{position:relative;border:1px solid var(--line);border-radius:12px;overflow:hidden;
  background:var(--surface);margin:0 0 10px;line-height:0}
.shot img{width:100%;height:auto;display:block}
.mk{position:absolute;border:1.5px solid var(--p2);border-radius:3px;opacity:.4;
  transition:opacity .12s,box-shadow .12s}
.mk[data-s="P1"]{border-color:var(--p1);opacity:.75}
.mk[data-s="P3"]{border-color:var(--p3)}
.mk i{position:absolute;top:-9px;left:-9px;width:18px;height:18px;border-radius:50%;
  background:var(--p2);color:#111;font:700 10px/18px ui-sans-serif,system-ui;
  text-align:center;font-style:normal;opacity:0;transition:opacity .12s}
.mk[data-s="P1"] i{background:var(--p1);color:#fff}
.mk[data-s="P3"] i{background:var(--p3);color:#fff}
.mk[data-s="P1"] i{opacity:1}
.mk.on{opacity:1;border-width:2.5px;box-shadow:0 0 0 3px rgba(91,140,255,.3),0 0 0 1px rgba(0,0,0,.5);z-index:2}
.mk.on i{opacity:1}
.item{cursor:pointer}
.item:hover,.item.on{border-color:var(--accent)}
.caption{font-size:12px;color:var(--ink-3);margin:0 0 34px}

section{margin:0 0 34px}
.gh{display:flex;align-items:baseline;gap:10px;margin:0 0 4px}
.gh h2{font-size:17px;margin:0;letter-spacing:-.01em}
.gh .n{font-size:12px;color:var(--ink-3)}
.gb{color:var(--ink-2);font-size:13px;margin:0 0 14px}

.item{display:flex;gap:14px;background:var(--surface);border:1px solid var(--line);
  border-radius:11px;padding:14px 16px;margin:0 0 9px}
.num{flex:0 0 22px;height:22px;border-radius:50%;background:var(--line);color:var(--ink-2);
  font:700 11px/22px ui-sans-serif,system-ui;text-align:center}
.item[data-s="P1"] .num{background:var(--p1);color:#fff}
.item[data-s="P2"] .num{background:var(--p2);color:#111}
.item[data-s="P3"] .num{background:var(--p3);color:#fff}
.body{flex:1;min-width:0}
.hl{font-weight:600;font-size:14.5px;margin:0 0 2px}
.dt{color:var(--ink-2);font-size:13px;margin:0}
.ev{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:10px 0 0;
  padding:9px 11px;background:var(--bg);border:1px solid var(--line);border-radius:8px}
.ev code{font-family:var(--mono);font-size:11.5px;color:var(--ink-2)}
.sw{width:22px;height:22px;border-radius:5px;border:1px solid rgba(128,128,128,.4);flex:none}
.demo{padding:4px 9px;border-radius:5px;font-size:13px;white-space:nowrap}
.vs{font-size:11px;color:var(--ink-3)}
.box{border:1.5px dashed var(--p2);border-radius:4px;flex:none}
.box.ok{border-color:var(--ok);border-style:solid}
.dev{margin:9px 0 0;font-size:11.5px;color:var(--ink-3)}
.dev code{font-family:var(--mono);word-break:break-all;color:var(--ink-3)}
.more{color:var(--ink-3)}
.affects{color:var(--p3);font-size:12.5px;margin-top:3px}
.none{padding:46px 0;text-align:center;color:var(--ink-3)}
footer{margin:40px 0 0;padding-top:16px;border-top:1px solid var(--line);font-size:12px;color:var(--ink-3)}
footer a{color:var(--ink-2)}
`;

/**
 * @param {{findings:Array, suppressed?:Array}} result
 * @param {{project?:string, baseUrl?:string, viewport?:{width:number,height:number}}} meta
 * @param {{build?:string|null}} images  data URIs
 */
export function toDesignerHTML(result, meta = {}, images = {}) {
  const findings = collapseFindings(result.findings ?? []);
  const stats = collapseStats(findings);
  const vw = meta.viewport?.width ?? 1440;
  // The screenshot is the whole page, so markers scale to its height.
  const vh = meta.pageHeight ?? meta.viewport?.height ?? 900;

  const numbered = findings.map((f, i) => ({ ...f, n: i + 1 }));

  // Mark every element a problem affects, all sharing the problem's number.
  const inShot = r => r && r.width > 0 && r.y < vh && r.x < vw;
  let marked = 0, hidden = 0;
  const markers = numbered.flatMap(f => (f.occurrences ?? []).map((o, i) => {
    if (!inShot(o.rect)) { hidden++; return ''; }
    marked++;
    const left = (o.rect.x / vw) * 100, top = (o.rect.y / vh) * 100;
    const w = (Math.max(o.rect.width, 6) / vw) * 100, h = (Math.max(o.rect.height, 6) / vh) * 100;
    return `<span class="mk" data-s="${esc(f.severity)}" data-n="${f.n}" title="${esc(plain(f).headline)}"
      style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;width:${w.toFixed(2)}%;height:${h.toFixed(2)}%"
      >${i === 0 ? `<i>${f.n}</i>` : ''}</span>`;
  })).join('');
  const onShot = { length: marked };
  const offShot = hidden;

  const sections = GROUPS.map(g => {
    const items = numbered.filter(f => f.check === g.id);
    if (!items.length) return '';
    return `<section>
      <div class="gh"><h2>${esc(g.title)}</h2><span class="n">${items.length}</span></div>
      <p class="gb">${esc(g.blurb)}</p>
      ${items.map(f => {
        const p = plain(f);
        return `<div class="item" data-s="${esc(f.severity)}" data-n="${f.n}">
          <span class="num">${f.n}</span>
          <div class="body">
            <p class="hl">${esc(p.headline)}</p>
            ${p.detail ? `<p class="dt">${esc(p.detail)}</p>` : ''}
            ${f.count > 1 ? `<p class="dt affects">Affects ${f.count} places on the page.</p>` : ''}
            ${evidence(f)}
            <p class="dev">For your developer: <code>${esc(f.selector)}</code>${
              f.count > 1 ? ` <span class="more">+${f.count - 1} more</span>` : ''}</p>
          </div></div>`;
      }).join('')}
    </section>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Designer review${meta.project ? ' — ' + esc(meta.project) : ''}</title>
<style>${CSS}</style></head><body><div class="wrap">

<h1>Designer review${meta.project ? ' — ' + esc(meta.project) : ''}</h1>
<p class="who">For the designer — what changed and where. The developer report has the selectors and exact values.</p>
<p class="lede">${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC${
  meta.baseUrl ? ` · ${esc(meta.baseUrl)}` : ''}</p>

<div class="stats">
  <span class="stat"><b>${findings.length}</b> things to look at</span>
  ${stats.folded ? `<span class="stat"><b>${stats.elements}</b> elements affected</span>` : ''}
  ${GROUPS.map(g => {
    const c = findings.filter(f => f.check === g.id).length;
    return c ? `<span class="stat"><b>${c}</b> ${esc(g.title.toLowerCase())}</span>` : '';
  }).join('')}
</div>

${images.build ? `<div class="shot"><img src="${images.build}" alt="The page, with findings marked">${markers}</div>
<p class="caption">${marked} element${marked === 1 ? '' : 's'} marked${
  offShot ? ` · ${offShot} sit below the fold and are listed but not drawn` : ''}. Hover a finding to light up every place it appears.</p>` : ''}

${findings.length ? sections
  : `<p class="none">Nothing to flag. Either the page matches your system, or the tokens are too loose to catch anything — worth knowing which.</p>`}

<script>
for (const item of document.querySelectorAll('.item')) {
  const marks = [...document.querySelectorAll('.mk[data-n="' + item.dataset.n + '"]')];
  if (!marks.length) continue;
  const on = v => { marks.forEach(m => m.classList.toggle('on', v)); item.classList.toggle('on', v); };
  item.addEventListener('mouseenter', () => on(true));
  item.addEventListener('mouseleave', () => on(false));
  item.addEventListener('click', () => {
    marks[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    on(true); setTimeout(() => on(false), 1800);
  });
}
</script>
<footer>The developer report has the selectors, properties and exact values.
Generated by <a href="https://github.com/Lubnabano02/design-audit">design-audit</a>.</footer>
</div></body></html>`;
}
