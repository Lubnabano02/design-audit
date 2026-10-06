/**
 * Finding the other pages.
 *
 * Deliberately timid. It stays on one origin, follows links one hop from where
 * you started, ignores anything that looks like it changes state, and stops at
 * a page limit. A design audit is not a reason to hammer somebody's server or
 * to click "delete account" on a logged-in session.
 */

/** Links that should never be followed automatically. */
const DANGEROUS = /(logout|signout|sign-out|log-out|delete|remove|destroy|cancel|unsubscribe|checkout|pay|purchase|order|admin|settings\/danger)/i;

/** Things that are not pages. */
const NOT_A_PAGE = /\.(pdf|zip|png|jpe?g|gif|svg|webp|avif|mp4|webm|mp3|wav|css|js|json|xml|rss|ics|dmg|exe|pkg)(\?|$)/i;

/** Fragment and tracking noise make the same page look like several. */
const TRACKING = /^(utm_|fbclid|gclid|ref|mc_cid|mc_eid)/i;

export function normalise(href, base) {
  let u;
  try { u = new URL(href, base); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  // "/docs" and "/docs/" are one page.
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

export function isWorthVisiting(url, origin) {
  if (!url) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.origin !== origin) return false;
  if (NOT_A_PAGE.test(u.pathname)) return false;
  if (DANGEROUS.test(u.pathname) || DANGEROUS.test(u.search)) return false;
  return true;
}

/** Same-origin links on the page, in the order they appear. */
export async function linksOn(page, origin) {
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
  const seen = new Set();
  const out = [];
  for (const h of hrefs) {
    const u = normalise(h, page.url());
    if (!u || seen.has(u) || !isWorthVisiting(u, origin)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/**
 * Walk out from a starting page, one hop, and return the URLs to audit
 * (the start page first).
 *
 * @param {import('playwright').Browser} browser
 * @param {string} startUrl
 * @param {{maxPages?:number, timeoutMs?:number}} opts
 */
export async function discover(browser, startUrl, { maxPages = 5, timeoutMs = 20000 } = {}) {
  const start = normalise(startUrl, startUrl);
  if (!start) throw new Error('That start URL is not valid.');
  const origin = new URL(start).origin;
  if (maxPages <= 1) return { urls: [start], skipped: [] };

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(start, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const found = await linksOn(page, origin);
    const urls = [start];
    for (const u of found) {
      if (urls.length >= maxPages) break;
      if (!urls.includes(u)) urls.push(u);
    }
    return { urls, skipped: Math.max(0, found.length - (urls.length - 1)) };
  } catch (err) {
    // If discovery fails, auditing the one page we were given is still useful.
    return { urls: [start], skipped: 0, error: err.message.split('\n')[0] };
  } finally {
    await context.close();
  }
}
