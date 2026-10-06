/**
 * Developer-side checks: performance, errors, and controls that do nothing.
 *
 * These read the runtime signals collected during capture rather than the
 * style snapshot, so they answer "does this page work" instead of "does this
 * page match the design".
 */

const DEFAULTS = {
  pageLoadWarnMs: 2500,
  pageLoadFailMs: 5000,
  ttfbWarnMs: 600,
  longTaskMs: 50,
  longTaskBudgetMs: 400,
  interactionWarnMs: 300,
  interactionFailMs: 1000,
  layoutShiftWarn: 0.1,
};

const f = (check, severity, message, detail, extra = {}) =>
  ({ check, severity, screen: extra.screen ?? '-', selector: extra.selector ?? '—', rect: extra.rect, message, detail });

/** How long the page took to become usable. */
export const pageLoad = {
  id: 'pageLoad',
  title: 'Page load',
  run(_snapshot, tokens, opts = {}, ctx = {}) {
    const t = { ...DEFAULTS, ...(tokens.performance ?? {}) };
    const out = [];
    for (const page of ctx.pages ?? []) {
      const r = page.runtime;
      if (!r?.timing) continue;
      const { loadMs, ttfbMs, transferBytes } = r.timing;
      const where = { screen: page.name, selector: page.url ?? '—' };

      if (loadMs >= t.pageLoadFailMs) {
        out.push(f(this.id, 'P1', `Page took ${(loadMs / 1000).toFixed(1)}s to finish loading — over the ${(t.pageLoadFailMs / 1000).toFixed(1)}s limit`,
          { loadMs, limitMs: t.pageLoadFailMs, ttfbMs, transferBytes }, where));
      } else if (loadMs >= t.pageLoadWarnMs) {
        out.push(f(this.id, 'P2', `Page took ${(loadMs / 1000).toFixed(1)}s to finish loading — past the ${(t.pageLoadWarnMs / 1000).toFixed(1)}s target`,
          { loadMs, targetMs: t.pageLoadWarnMs, ttfbMs, transferBytes }, where));
      }
      if (ttfbMs >= t.ttfbWarnMs) {
        out.push(f(this.id, 'P2', `Server took ${ttfbMs}ms to send the first byte`,
          { ttfbMs, targetMs: t.ttfbWarnMs }, where));
      }
    }
    return out;
  },
};

/** Work that blocked the main thread, which is what "feels slow" actually is. */
export const mainThread = {
  id: 'mainThread',
  title: 'Main thread',
  run(_snapshot, tokens, opts = {}, ctx = {}) {
    const t = { ...DEFAULTS, ...(tokens.performance ?? {}) };
    const out = [];
    for (const page of ctx.pages ?? []) {
      const tasks = page.runtime?.longTasks ?? [];
      const where = { screen: page.name, selector: page.url ?? '—' };
      if (tasks.length) {
        const total = tasks.reduce((n, x) => n + x.duration, 0);
        const worst = tasks.reduce((a, b) => (b.duration > a.duration ? b : a));
        const sev = total >= t.longTaskBudgetMs ? 'P2' : 'P3';
        out.push(f(this.id, sev,
          `${tasks.length} long task${tasks.length === 1 ? '' : 's'} blocked the main thread for ${total}ms (worst ${worst.duration}ms)`,
          { count: tasks.length, totalMs: total, worstMs: worst.duration, thresholdMs: t.longTaskMs }, where));
      }
      const cls = page.runtime?.layoutShift ?? 0;
      if (cls >= t.layoutShiftWarn) {
        out.push(f(this.id, 'P2', `Content moved around while loading (layout shift ${cls.toFixed(2)})`,
          { layoutShift: cls, target: t.layoutShiftWarn }, where));
      }
    }
    return out;
  },
};

/** Anything that threw, or failed to arrive. */
export const errors = {
  id: 'errors',
  title: 'Errors and failed requests',
  run(_snapshot, _tokens, opts = {}, ctx = {}) {
    const out = [];
    for (const page of ctx.pages ?? []) {
      const r = page.runtime ?? {};
      const where = { screen: page.name };

      for (const e of r.pageErrors ?? []) {
        out.push(f(this.id, 'P1', `Uncaught error: ${e.text}`, { kind: 'pageerror' }, { ...where, selector: page.url ?? '—' }));
      }
      for (const e of r.consoleErrors ?? []) {
        out.push(f(this.id, e.level === 'error' ? 'P2' : 'P3',
          `Console ${e.level}: ${e.text}`, { kind: 'console', level: e.level },
          { ...where, selector: e.location ?? page.url ?? '—' }));
      }
      for (const req of r.failedRequests ?? []) {
        out.push(f(this.id, req.type === 'document' ? 'P1' : 'P2',
          `Request failed (${req.reason}) — ${req.type}`, { url: req.url, reason: req.reason },
          { ...where, selector: req.url }));
      }
      for (const res of r.badResponses ?? []) {
        out.push(f(this.id, res.status >= 500 ? 'P1' : 'P2',
          `${res.status} response for a ${res.type}`, { url: res.url, status: res.status },
          { ...where, selector: res.url }));
      }
    }
    return out;
  },
};

/** Controls that look clickable but cannot do anything. */
export const brokenControls = {
  id: 'brokenControls',
  title: 'Controls that do nothing',
  run(_snapshot, _tokens, opts = {}, ctx = {}) {
    const out = [];
    for (const page of ctx.pages ?? []) {
      const r = page.runtime ?? {};
      const where = { screen: page.name };

      for (const c of r.deadControls ?? []) {
        if (c.kind === 'link-nowhere') {
          out.push(f(this.id, 'P2', `Link goes nowhere${c.label ? ` — “${c.label}”` : ''}`,
            { kind: c.kind, label: c.label }, { ...where, selector: c.selector, rect: c.rect }));
        } else {
          out.push(f(this.id, 'P2', 'Button has no accessible name — a screen reader announces nothing',
            { kind: c.kind }, { ...where, selector: c.selector, rect: c.rect }));
        }
      }
      for (const img of r.brokenImages ?? []) {
        out.push(f(this.id, 'P1', 'Image failed to load',
          { src: img.src }, { ...where, selector: img.selector, rect: img.rect }));
      }
      for (const fl of r.unlabelledFields ?? []) {
        out.push(f(this.id, 'P2', 'Form field has no label',
          { kind: 'field-unlabelled' }, { ...where, selector: fl.selector, rect: fl.rect }));
      }
    }
    return out;
  },
};

/** How long each scripted interaction took to respond. */
export const interactions = {
  id: 'interactions',
  title: 'Interaction response',
  run(_snapshot, tokens, opts = {}, ctx = {}) {
    const t = { ...DEFAULTS, ...(tokens.performance ?? {}) };
    const out = [];
    for (const page of ctx.pages ?? []) {
      for (const step of page.interactions ?? []) {
        const where = { screen: page.name, selector: step.selector ?? step.name };
        if (step.failed) {
          out.push(f(this.id, 'P1', `“${step.name}” did not work — ${step.failed}`, { step: step.name }, where));
          continue;
        }
        if (step.ms >= t.interactionFailMs) {
          out.push(f(this.id, 'P1', `“${step.name}” took ${step.ms}ms to respond — over the ${t.interactionFailMs}ms limit`,
            { ms: step.ms, limitMs: t.interactionFailMs }, where));
        } else if (step.ms >= t.interactionWarnMs) {
          out.push(f(this.id, 'P2', `“${step.name}” took ${step.ms}ms to respond — past the ${t.interactionWarnMs}ms target`,
            { ms: step.ms, targetMs: t.interactionWarnMs }, where));
        }
      }
    }
    return out;
  },
};

export const runtimeChecks = [pageLoad, mainThread, errors, brokenControls, interactions];
export const RUNTIME_IDS = new Set(runtimeChecks.map(c => c.id));
