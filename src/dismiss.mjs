/**
 * Getting the consent banner out of the way.
 *
 * Almost every real site opens behind a cookie dialog. Left alone it dims the
 * page, so the screenshot is useless, and its own markup gets audited — nobody
 * is going to restyle a vendor's consent banner to match your tokens.
 *
 * Declining is the default. Accepting on someone's behalf sets tracking cookies
 * they did not ask for, and either choice dismisses the dialog equally well.
 */

/** Known consent platforms, decline first. */
const KNOWN = [
  { cmp: 'OneTrust',     decline: '#onetrust-reject-all-handler, .ot-pc-refuse-all-handler', accept: '#onetrust-accept-btn-handler' },
  { cmp: 'Cookiebot',    decline: '#CybotCookiebotDialogBodyButtonDecline',                  accept: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll' },
  { cmp: 'Didomi',       decline: '#didomi-notice-disagree-button',                          accept: '#didomi-notice-agree-button' },
  { cmp: 'Usercentrics', decline: '[data-testid="uc-deny-all-button"]',                      accept: '[data-testid="uc-accept-all-button"]' },
  { cmp: 'Quantcast',    decline: '.qc-cmp2-summary-buttons button[mode="secondary"]',       accept: '.qc-cmp2-summary-buttons button[mode="primary"]' },
  { cmp: 'TrustArc',     decline: '#truste-consent-required',                                accept: '#truste-consent-button' },
  { cmp: 'Osano',        decline: '.osano-cm-denyAll',                                       accept: '.osano-cm-acceptAll' },
  { cmp: 'CookieYes',    decline: '.cky-btn-reject',                                         accept: '.cky-btn-accept' },
  { cmp: 'Klaro',        decline: '.cn-decline',                                             accept: '.cm-btn-success' },
];

/** Button text, when the platform is not one we recognise. */
const DECLINE_TEXT = /^(ablehnen|alle ablehnen|nur (erforderliche|notwendige)|nein,? danke|reject( all)?|decline( all)?|necessary only|only essential|refuser|rechazar|rifiuta)/i;
const ACCEPT_TEXT = /^(akzeptieren|alle akzeptieren|zustimmen|ich stimme zu|ja,? ich stimme zu|accept( all)?|agree|allow all|i agree|got it|ok|accepter|aceptar|accetta)/i;

/** Is something large and fixed sitting over the page? */
export const FIND_BLOCKING_OVERLAY = () => {
  const vw = innerWidth, vh = innerHeight;
  let worst = null;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    const cover = (Math.min(r.width, vw) * Math.min(r.height, vh)) / (vw * vh);
    if (cover < 0.25) continue;
    const z = parseInt(cs.zIndex, 10) || 0;
    const id = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${
      el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
    if (!worst || cover > worst.cover) worst = { selector: id, cover: +cover.toFixed(2), zIndex: z };
  }
  return worst;
};

/** Everything inside this element, by selector prefix, so findings can be dropped. */
export const MARK_SUBTREE = sel => {
  const root = document.querySelector(sel);
  if (!root) return [];
  return [...root.querySelectorAll('*')].length;
};

async function clickIfPresent(page, selector, timeout = 1200) {
  if (!selector) return false;
  try {
    const el = page.locator(selector).first();
    if (!(await el.isVisible({ timeout }).catch(() => false))) return false;
    await el.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

/** Try the generic text match across buttons and links. */
async function clickByText(page, pattern) {
  try {
    const handles = await page.$$('button, [role="button"], a');
    for (const h of handles.slice(0, 120)) {
      const text = ((await h.innerText().catch(() => '')) || '').trim();
      if (!text || text.length > 40 || !pattern.test(text)) continue;
      if (!(await h.isVisible().catch(() => false))) continue;
      await h.click({ timeout: 1200 }).catch(() => {});
      return text;
    }
  } catch { /* nothing clickable */ }
  return null;
}

/**
 * Dismiss a consent dialog if one is in the way.
 * @param {import('playwright').Page} page
 * @param {{mode?: 'decline'|'accept'|'off', custom?: string|null}} opts
 * @returns {Promise<{dismissed:boolean, how:string|null, overlay:object|null}>}
 */
export async function dismissOverlays(page, { mode = 'decline', custom = null } = {}) {
  if (mode === 'off' && !custom) {
    return { dismissed: false, how: null, overlay: await page.evaluate(FIND_BLOCKING_OVERLAY) };
  }

  let how = null;

  if (custom) {
    if (await clickIfPresent(page, custom, 3000)) how = `your selector (${custom})`;
  }

  if (!how && mode !== 'off') {
    // Exhaust the preferred answer completely — known buttons *and* text —
    // before falling back to the other one. Otherwise a vendor we recognise
    // gets accepted while a plain "No thanks" sits unclicked next to it.
    const first = mode === 'accept' ? 'accept' : 'decline';
    const second = first === 'accept' ? 'decline' : 'accept';
    const textFor = w => (w === 'accept' ? ACCEPT_TEXT : DECLINE_TEXT);

    for (const which of [first, second]) {
      for (const cmp of KNOWN) {
        if (await clickIfPresent(page, cmp[which])) { how = `${cmp.cmp} — ${which}`; break; }
      }
      if (how) break;
      const text = await clickByText(page, textFor(which));
      if (text) { how = `${which} — button labelled “${text}”`; break; }
    }
  }

  if (how) {
    // Dismissing often kicks off rendering that was blocked behind the dialog.
    // Capturing straight away catches a loading spinner instead of the page.
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const overlay = await page.evaluate(FIND_BLOCKING_OVERLAY);
  return { dismissed: !!how, how, overlay };
}
