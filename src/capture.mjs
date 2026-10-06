import { collectStyles } from './snapshot.mjs';
import { INSTALL_OBSERVERS, COLLECT_RUNTIME, watchPage } from './runtime.mjs';
import { dismissOverlays } from './dismiss.mjs';

/**
 * Drive a screen: load it, run its interactions, screenshot it, and read its styles.
 * Playwright is a peer dependency — imported lazily so the checks can run without it.
 */
export async function captureScreen(screen, config, { outDir, browser }) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const context = await browser.newContext({
    viewport: screen.viewport ?? config.viewport ?? { width: 1440, height: 900 },
    ...(config.auth?.storageState ? { storageState: config.auth.storageState } : {}),
  });
  const page = await context.newPage();
  await page.addInitScript(INSTALL_OBSERVERS);
  const drain = watchPage(page);
  const timeout = config.captureTimeoutMs ?? 30000;
  const notes = [];
  const steps = [];

  try {
    const url = new URL(screen.path, config.baseUrl).toString();
    await page.goto(url, { waitUntil: 'networkidle', timeout });

    if (screen.waitFor) {
      try {
        await page.waitForSelector(screen.waitFor, { timeout });
      } catch {
        // Carry on and capture whatever rendered — a screen that never settles
        // is itself the finding, and a hard throw would hide the rest of the run.
        notes.push({ level: 'P1', message: `did not reach ready state within ${timeout}ms (waitFor: ${screen.waitFor})` });
      }
    }

    // Clear the consent dialog before anything is measured, or the shot is of
    // a dimmed page and the dialog's own markup gets audited.
    const consent = await dismissOverlays(page, {
      mode: screen.consent ?? config.consent ?? 'decline',
      custom: screen.dismiss ?? config.dismiss ?? null,
    });
    if (consent.overlay && consent.overlay.cover >= 0.4) {
      notes.push({ level: 'P2', message:
        `something still covers ${Math.round(consent.overlay.cover * 100)}% of the page (${consent.overlay.selector}) — findings behind it may be unreliable` });
    }

    for (const step of screen.interactions ?? []) {
      const began = Date.now();
      try {
        const target = page.locator(step.selector).first();
        if (step.action === 'fill') await target.fill(step.value ?? '');
        else if (step.action === 'hover') await target.hover();
        else await target.click();
        if (step.expect) await page.waitForSelector(step.expect, { timeout });
        steps.push({ name: step.name, selector: step.selector, ms: Date.now() - began });
      } catch (err) {
        const why = err.message.split('\n')[0];
        steps.push({ name: step.name, selector: step.selector, ms: Date.now() - began, failed: why });
        notes.push({ level: 'P2', message: `interaction "${step.name}" failed: ${why}` });
      }
      if (screen.captureAfter && screen.captureAfter === step.name) break;
    }

    const dir = path.join(outDir, screen.name);
    await fs.mkdir(dir, { recursive: true });
    const shot = path.join(dir, 'build.png');
    await page.screenshot({ path: shot, fullPage: screen.fullPage ?? true });

    const elements = (await page.evaluate(collectStyles)).map(e => ({ ...e, screen: screen.name }));
    const pageHeight = await page.evaluate(() => Math.max(
      document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
    const runtime = { ...(await page.evaluate(COLLECT_RUNTIME)), ...drain() };
    const snapshot = {
      screen: screen.name,
      url,
      capturedAt: new Date().toISOString(),
      viewport: screen.viewport ?? config.viewport,
      pageHeight,
      consent,
      runtime,
      interactions: steps,
      notes,
      elements,
    };
    await fs.writeFile(path.join(dir, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
    return { snapshot, screenshot: shot };
  } finally {
    await context.close();
  }
}

/** Capture every screen in the config. */
export async function captureAll(config, outDir) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  }
  const browser = await chromium.launch();
  try {
    const results = [];
    for (const screen of config.screens ?? []) {
      results.push(await captureScreen(screen, config, { outDir, browser }));
    }
    return results;
  } finally {
    await browser.close();
  }
}
