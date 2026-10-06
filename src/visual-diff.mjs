/**
 * Comparing the build capture with the Figma frame.
 *
 * This is the half of the audit that was missing: the frame was downloaded and
 * placed beside the build, and a human did the comparing.
 *
 * It is also the half that is easy to do badly. Anti-aliasing, font hinting and
 * anything dynamic differ harmlessly on every run, so a naive pixel compare
 * reports a sea of red and gets ignored. Three things keep it honest:
 *
 *   - compare blocks, not pixels, so a one-pixel edge shift is not a finding
 *   - compare perceptually, so imperceptible colour drift is not a finding
 *   - report regions with a share of the image, so a reader can judge scale
 *
 * Even so: treat the output as "look here", never as "this is wrong".
 */

/** Runs in the browser — both images onto canvases, compared block by block. */
const COMPARE = ({ aUri, bUri, block, tolerance, maxSide }) => new Promise((resolve, reject) => {
  const load = src => new Promise((ok, no) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => no(new Error('An image could not be decoded.'));
    i.src = src;
  });

  Promise.all([load(aUri), load(bUri)]).then(([a, b]) => {
    // Compare at a common size; the frame and the build are rarely identical.
    const w = Math.min(maxSide, Math.max(a.width, b.width));
    const h = Math.round(w * Math.max(a.height / a.width, b.height / b.width));

    const draw = img => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      // Fit to width, top-aligned: both are page captures, so they share an origin.
      const scale = w / img.width;
      ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, w, img.height * scale);
      return ctx.getImageData(0, 0, w, h).data;
    };

    const A = draw(a), B = draw(b);

    // Perceptual distance, not brightness. Comparing luminance alone was tried
    // and is wrong: #198754 and #DC3545 differ by 0.001 in luminance, so a green
    // block becoming a red one registered as no change at all.
    const lin = v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lab = (r, g, b) => {
      const R = lin(r), G = lin(g), B = lin(b);
      const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
      const y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
      const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
      const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      const fx = f(x), fy = f(y), fz = f(z);
      return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
    };
    const deltaE = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

    const cols = Math.ceil(w / block), rows = Math.ceil(h / block);
    const regions = [];
    let changedBlocks = 0;

    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < cols; bx++) {
        // Mean colour of the block in each image, then how far apart they look.
        let ar = 0, ag = 0, ab = 0, br = 0, bg = 0, bb = 0, n = 0;
        for (let y = by * block; y < Math.min((by + 1) * block, h); y += 2) {
          for (let x = bx * block; x < Math.min((bx + 1) * block, w); x += 2) {
            const i = (y * w + x) * 4;
            ar += A[i]; ag += A[i + 1]; ab += A[i + 2];
            br += B[i]; bg += B[i + 1]; bb += B[i + 2];
            n++;
          }
        }
        if (!n) continue;
        const delta = deltaE(lab(ar / n, ag / n, ab / n), lab(br / n, bg / n, bb / n));
        if (delta <= tolerance) continue;
        changedBlocks++;
        regions.push({ x: bx * block, y: by * block, w: block, h: block, delta: +delta.toFixed(3) });
      }
    }

    // Merge touching blocks into rectangles, so the report lists areas not confetti.
    const merged = [];
    const key = (x, y) => `${x},${y}`;
    const grid = new Set(regions.map(r => key(r.x, r.y)));
    const used = new Set();
    for (const r of regions) {
      if (used.has(key(r.x, r.y))) continue;
      let right = r.x, bottom = r.y;
      while (grid.has(key(right + block, r.y)) && !used.has(key(right + block, r.y))) right += block;
      let canGrow = true;
      while (canGrow) {
        for (let x = r.x; x <= right; x += block) {
          if (!grid.has(key(x, bottom + block)) || used.has(key(x, bottom + block))) { canGrow = false; break; }
        }
        if (canGrow) bottom += block;
      }
      for (let y = r.y; y <= bottom; y += block) for (let x = r.x; x <= right; x += block) used.add(key(x, y));
      merged.push({ x: r.x, y: r.y, w: right - r.x + block, h: bottom - r.y + block });
    }

    resolve({
      width: w, height: h, block,
      changedShare: +(changedBlocks / (cols * rows)).toFixed(4),
      regions: merged.sort((p, q) => q.w * q.h - p.w * p.h).slice(0, 40),
    });
  }).catch(reject);
});

/**
 * @param {import('playwright').Browser} browser
 * @param {string} buildUri  data URI of the build capture
 * @param {string} figmaUri  data URI of the Figma frame
 * @param {{block?:number, tolerance?:number, maxSide?:number, severity?:string}} opts
 */
export async function compareVisually(browser, buildUri, figmaUri, opts = {}) {
  // tolerance is in deltaE: ~2 is the threshold of visibility, 6 is comfortably visible.
  const { block = 16, tolerance = 6, maxSide = 1000 } = opts;
  if (!buildUri || !figmaUri) return { ran: false, reason: 'Needs both a build capture and a Figma frame.' };

  const context = await browser.newContext();
  const page = await context.newPage();
  let out;
  try {
    await page.goto('about:blank');
    out = await page.evaluate(COMPARE, { aUri: buildUri, bUri: figmaUri, block, tolerance, maxSide });
  } finally {
    await context.close();
  }

  const findings = [];
  const pct = (out.changedShare * 100).toFixed(1);

  if (out.changedShare > 0.0005) {
    findings.push({
      check: 'visualDiff',
      severity: out.changedShare >= 0.15 ? 'P2' : 'P3',
      screen: 'build vs figma',
      selector: `${out.regions.length} region${out.regions.length === 1 ? '' : 's'}`,
      message: `${pct}% of the frame differs from the build — ${out.regions.length} area${out.regions.length === 1 ? '' : 's'} to look at`,
      detail: { changedShare: out.changedShare, regions: out.regions.length, block },
    });
  }

  return { ran: true, ...out, findings };
}

/** The frame with the differing areas boxed, as a data URI. */
export async function renderDiffOverlay(browser, figmaUri, diff) {
  if (!diff?.ran || !diff.regions?.length) return null;
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto('about:blank');
    return await page.evaluate(({ uri, regions, width, height }) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not draw the overlay.'));
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        ctx.strokeStyle = 'rgba(255,80,80,0.95)';
        ctx.fillStyle = 'rgba(255,80,80,0.14)';
        ctx.lineWidth = 2;
        for (const r of regions) { ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeRect(r.x, r.y, r.w, r.h); }
        resolve(c.toDataURL('image/png'));
      };
      img.src = uri;
    }), { uri: figmaUri, regions: diff.regions, width: diff.width, height: diff.height });
  } finally {
    await context.close();
  }
}
