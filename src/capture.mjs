import { collectStyles } from './snapshot.mjs';

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
  const timeout = config.captureTimeoutMs ?? 30000;
  const notes = [];

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

    for (const step of screen.interactions ?? []) {
      try {
        const target = page.locator(step.selector).first();
        if (step.action === 'fill') await target.fill(step.value ?? '');
        else if (step.action === 'hover') await target.hover();
        else await target.click();
        if (step.expect) await page.waitForSelector(step.expect, { timeout });
      } catch (err) {
        notes.push({ level: 'P2', message: `interaction "${step.name}" failed: ${err.message.split('\n')[0]}` });
      }
      if (screen.captureAfter && screen.captureAfter === step.name) break;
    }

    const dir = path.join(outDir, screen.name);
    await fs.mkdir(dir, { recursive: true });
    const shot = path.join(dir, 'build.png');
    await page.screenshot({ path: shot, fullPage: screen.fullPage ?? false });

    const elements = (await page.evaluate(collectStyles)).map(e => ({ ...e, screen: screen.name }));
    const snapshot = {
      screen: screen.name,
      url,
      capturedAt: new Date().toISOString(),
      viewport: screen.viewport ?? config.viewport,
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
