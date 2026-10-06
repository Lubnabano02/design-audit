/**
 * What the page *does*, as opposed to how it looks.
 *
 * The design checks read computed styles. These read behaviour: how long the
 * page took, what blocked the main thread, what threw, what failed to load,
 * and which controls cannot actually do anything. This is the developer's
 * half of the audit.
 */

/** Installed before any page script runs, so nothing is missed. */
export const INSTALL_OBSERVERS = () => {
  window.__audit = { longTasks: [], layoutShift: 0 };
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        window.__audit.longTasks.push({ start: Math.round(e.startTime), duration: Math.round(e.duration) });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* not supported in this browser */ }
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) window.__audit.layoutShift += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* not supported */ }
};

/** Read after the page settles. Runs in the browser. */
export const COLLECT_RUNTIME = () => {
  const nav = performance.getEntriesByType('navigation')[0];
  const timing = nav ? {
    ttfbMs: Math.round(nav.responseStart),
    domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
    loadMs: Math.round(nav.loadEventEnd || nav.duration),
    transferBytes: nav.transferSize ?? 0,
  } : null;

  const paints = {};
  for (const p of performance.getEntriesByType('paint')) paints[p.name] = Math.round(p.startTime);

  const describe = el => {
    const parts = [];
    let n = el;
    for (let d = 0; n && n.nodeType === 1 && d < 4; d++) {
      let part = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(part + '#' + n.id); break; }
      const cls = (n.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      const parent = n.parentElement;
      if (parent) {
        const twins = [...parent.children].filter(c => c.tagName === n.tagName);
        if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(n) + 1})`;
      }
      parts.unshift(part);
      n = parent;
    }
    return parts.join(' > ');
  };

  const label = el => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title')
    || el.getAttribute('alt') || el.value || '').trim().slice(0, 60);

  const box = el => {
    const r = el.getBoundingClientRect();
    return { x: +(r.x + scrollX).toFixed(1), y: +(r.y + scrollY).toFixed(1),
             width: +r.width.toFixed(1), height: +r.height.toFixed(1) };
  };

  const deadControls = [];
  for (const a of document.querySelectorAll('a')) {
    const href = (a.getAttribute('href') || '').trim();
    const visible = a.getBoundingClientRect().width > 0;
    if (!visible) continue;
    if (!href || href === '#' || /^javascript:\s*(void\(0\))?;?$/i.test(href)) {
      deadControls.push({ kind: 'link-nowhere', selector: describe(a), label: label(a), rect: box(a) });
    }
  }
  for (const b of document.querySelectorAll('button,[role="button"],input[type=submit],input[type=button]')) {
    if (b.getBoundingClientRect().width === 0) continue;
    if (!label(b) && !b.querySelector('img,svg,[aria-label]')) {
      deadControls.push({ kind: 'control-unnamed', selector: describe(b), label: '', rect: box(b) });
    }
  }

  const brokenImages = [];
  for (const img of document.querySelectorAll('img')) {
    if (img.getBoundingClientRect().width === 0) continue;
    if (img.complete && img.naturalWidth === 0) {
      brokenImages.push({ selector: describe(img), src: (img.currentSrc || img.src || '').slice(0, 160), rect: box(img) });
    }
  }

  const unlabelledFields = [];
  for (const f of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea')) {
    if (f.getBoundingClientRect().width === 0) continue;
    const id = f.getAttribute('id');
    const labelled = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
      || f.closest('label') || f.getAttribute('aria-label') || f.getAttribute('aria-labelledby')
      || f.getAttribute('title') || f.getAttribute('placeholder');
    if (!labelled) unlabelledFields.push({ selector: describe(f), rect: box(f) });
  }

  return {
    timing,
    paints,
    longTasks: (window.__audit?.longTasks ?? []).slice(0, 50),
    layoutShift: +(window.__audit?.layoutShift ?? 0).toFixed(4),
    deadControls: deadControls.slice(0, 60),
    brokenImages: brokenImages.slice(0, 40),
    unlabelledFields: unlabelledFields.slice(0, 40),
  };
};

/**
 * Attach listeners for things that only exist as events.
 * Returns a drain() that hands back what was seen.
 */
export function watchPage(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];

  page.on('console', msg => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = msg.text().slice(0, 300);
    // Browsers log a console error for every failed request; the network
    // listeners already report those with more detail.
    if (/Failed to load resource/i.test(text)) return;
    consoleErrors.push({ level: type, text, location: msg.location()?.url ?? null });
  });

  page.on('pageerror', err => pageErrors.push({ text: String(err.message).slice(0, 300) }));

  page.on('requestfailed', req => {
    failedRequests.push({
      url: req.url().slice(0, 200),
      method: req.method(),
      reason: req.failure()?.errorText ?? 'unknown',
      type: req.resourceType(),
    });
  });

  page.on('response', res => {
    const s = res.status();
    if (s >= 400) badResponses.push({ url: res.url().slice(0, 200), status: s, type: res.request().resourceType() });
  });

  return () => ({
    consoleErrors: consoleErrors.slice(0, 40),
    pageErrors: pageErrors.slice(0, 40),
    failedRequests: failedRequests.slice(0, 40),
    badResponses: badResponses.slice(0, 40),
  });
}
