/**
 * Auditing a picture.
 *
 * A screenshot has no DOM, so there are no computed styles, no elements and no
 * selectors. Of the design checks only colour survives — and it survives well,
 * because colour is the one thing pixels tell you honestly.
 *
 * What that buys is the thing a URL cannot do: checking a mockup, an export, or
 * an image somebody sent you, against the same palette the build is held to.
 *
 * Decoding happens in Chromium via canvas rather than an image library, because
 * Playwright is already a dependency and an image decoder would be another one.
 */
import { nearestToken, toHex } from './color.mjs';

/** Runs in the browser: draw the image and count its colours. */
const EXTRACT = ({ dataUri, maxSide }) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onerror = () => reject(new Error('That file could not be read as an image.'));
  img.onload = () => {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    // Nearest-neighbour: smoothing blends neighbouring pixels and invents
    // colours that are not in the image, which then get reported as findings.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    // Bucket to a coarse grid so near-identical pixels count as one colour.
    // Masking (not rounding) keeps every channel inside 0-248: rounding 255 to
    // the nearest 8 gives 256, which overflows the byte and turns #FFEE5B green.
    const buckets = new Map();
    let counted = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;            // effectively transparent
      const r = data[i] & 0xF8;
      const g = data[i + 1] & 0xF8;
      const b = data[i + 2] & 0xF8;
      const key = (r << 16) | (g << 8) | b;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
      counted++;
    }
    const colours = [...buckets.entries()]
      .map(([key, n]) => ({ r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255, share: n / counted }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 48);

    resolve({ width: img.width, height: img.height, sampled: counted, colours });
  };
  img.src = dataUri;
});

/**
 * @param {import('playwright').Browser} browser
 * @param {string} dataUri      the uploaded image
 * @param {object} tokens
 * @param {{minShare?:number, maxSide?:number}} opts
 */
export async function auditImage(browser, dataUri, tokens, { minShare = 0.002, maxSide = 600 } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let extracted;
  try {
    await page.goto('about:blank');
    extracted = await page.evaluate(EXTRACT, { dataUri, maxSide });
  } finally {
    await context.close();
  }

  const palette = tokens.color?.palette ?? [];
  const tolerance = tokens.color?.toleranceDeltaE ?? 3;
  const findings = [];

  if (!palette.length) {
    return { findings, extracted, note: 'No palette in your tokens, so there was nothing to check the colours against.' };
  }

  // Only colours with a real presence; a stray anti-aliased pixel is not a decision.
  const significant = extracted.colours.filter(c => c.share >= minShare);

  for (const c of significant) {
    const near = nearestToken(c, palette);
    if (!near || near.distance <= tolerance) continue;
    const pct = (c.share * 100).toFixed(c.share >= 0.01 ? 1 : 2);
    findings.push({
      check: 'colorTokens',
      severity: c.share >= 0.02 ? 'P2' : 'P3',
      screen: 'image',
      selector: `${pct}% of the image`,
      message: `${toHex(c)} is not a palette token (nearest ${near.token}, ΔE ${near.distance.toFixed(1)})`,
      detail: { property: 'pixel', value: toHex(c), nearest: near.token,
                deltaE: +near.distance.toFixed(2), share: +c.share.toFixed(4) },
    });
  }

  findings.sort((a, b) => (b.detail.share ?? 0) - (a.detail.share ?? 0));

  return {
    findings,
    extracted: {
      ...extracted,
      significant: significant.map(c => ({ hex: toHex(c), share: +c.share.toFixed(4) })),
    },
  };
}

/** What a picture cannot answer, said plainly. */
export const IMAGE_LIMITS = [
  ['Type', 'Font size, family and weight are not recoverable from pixels.'],
  ['Spacing', 'Padding and margins need the box model, which an image does not carry.'],
  ['Touch targets', 'Nothing in an image says which parts are interactive.'],
  ['Readability', 'Contrast needs to know which pixels are text and what sits behind them.'],
  ['Behaviour', 'Load time, errors and broken controls only exist on a running page.'],
];
