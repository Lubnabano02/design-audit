# design-audit

Compare a running web UI against its Figma source of truth, and report where they diverge.

Design systems drift. A colour gets hardcoded, a font size lands between two steps on the scale, a button ends up 18px tall. Nobody decided any of it — it accumulated. This tool finds that drift automatically, and keeps a record of the divergences somebody *did* decide on, so they stop coming back as new findings.

It is not tied to any particular product. Point it at a URL, give it your tokens, and it works.

---

## What it does

**Capture** — drives the page with Playwright: loads it, runs any scripted interactions (log in, open a menu, select a row), screenshots it, and reads the computed styles of every visible element.

**Fetch** — pulls the matching frame from Figma via the REST API, so the intended design sits next to the built one.

**Check** — runs rules over the captured styles:

| Check | What it catches |
|---|---|
| `colorTokens` | Rendered colours that aren't in the palette, measured by perceptual distance (CIE76 ΔE) rather than string equality — so `#0D6EFE` is correctly reported as *nearly* `#0D6EFD`, not as a different colour entirely |
| `typeScale` | Font sizes off the scale, families outside the system, weights that don't exist in it |
| `spacingGrid` | Padding and margin that aren't multiples of the base unit |
| `contrast` | Text below WCAG AA, measured against the background the text **actually renders on** — resolved by walking up the DOM through transparent ancestors, and compositing translucent colours before measuring |
| `targetSize` | Interactive controls below the minimum target size (WCAG 2.2 SC 2.5.8) |

**Report** — Markdown for people, JSON for CI. Exits non-zero on a P1 so it can gate a pipeline.

---

## The part that matters: exceptions

Most audit tools have the same failure mode. They report the same twelve things every run, somebody decides that four of them are fine, and next week they're reported again. Eventually everybody stops reading the report.

So approved divergences live in a file, and the runner enforces them:

```json
{
  "id": "EX-001",
  "check": "colorTokens",
  "match": { "screen": "checkout", "value": "#4A90D9" },
  "reason": "Third-party payment widget ships its own focus ring. Vendor won't expose it.",
  "approvedBy": "Design lead",
  "approvedOn": "2026-01-15",
  "expiresOn": "2026-12-31"
}
```

Three rules make this work rather than become a dumping ground:

- **An exception without a `reason` and an `approvedBy` is rejected.** One with neither is indistinguishable from a bug somebody got tired of seeing.
- **An empty `match` is rejected**, because it would silently suppress every finding from that check.
- **Expired exceptions stop suppressing** and are listed in the report so they get revisited. Unused ones are listed too — either the bug was fixed and the exception can go, or the match block has drifted and is no longer catching anything.

Suppressed findings still appear in the report, under *By design*, with their reason and approver. The decision stays visible; it just stops being noise.

---

## Example output

Run against the public [TodoMVC demo](https://demo.playwright.dev/todomvc) with the example tokens — 15 elements, 55 findings:

```
**55 findings** — 6 P1, 35 P2, 14 P3

## contrast — 6

| Severity | Screen | Element | Finding |
|---|---|---|---|
| P1 | todomvc | `body > footer.info > p:nth-of-type(2) > a`    | contrast 1.69:1 is below 4.5:1 for normal text |
| P1 | todomvc | `section.todoapp > div > header.header > h1`   | contrast 1.27:1 is below 3:1 for large text    |

## colorTokens — 17

| Severity | Screen | Element | Finding |
|---|---|---|---|
| P2 | todomvc | `input.new-todo` | text colour #4D4D4D is not a palette token (nearest #343A40, ΔE 6.7) |
```

Selectors carry `:nth-of-type` where siblings share a tag, so each row points at one element you can paste into devtools.

## Install

```bash
git clone https://github.com/Lubnabano02/design-audit.git
cd design-audit
npm install
npx playwright install chromium   # only needed for capture
```

Node 18+. Playwright is an optional peer dependency — the checks and reports run without it.

## Try it without setting anything up

```bash
npm run demo
```

Runs the checks against a bundled fixture with deliberately planted problems, and prints the report. No browser, no Figma account, no config.

## Use it on your own project

**1. Describe your design system** as the rules the build is checked against — `tokens.json`:

```json
{
  "color":   { "palette": ["#FFFFFF", "#212529", "#0D6EFD"], "toleranceDeltaE": 3 },
  "type":    { "families": ["Inter"], "sizesPx": [12, 14, 16, 20, 24, 32], "weights": [400, 500, 600, 700] },
  "spacing": { "basePx": 4 },
  "contrast":   { "minNormalText": 4.5, "minLargeText": 3.0 },
  "targetSize": { "minPx": 24 }
}
```

**2. Describe your screens** — `design-audit.config.json`:

```json
{
  "baseUrl": "https://your-app.example.com",
  "tokensFile": "./tokens.json",
  "exceptionsFile": "./exceptions.json",
  "figma": { "fileKey": "env:FIGMA_FILE_KEY", "token": "env:FIGMA_TOKEN" },
  "viewport": { "width": 1440, "height": 900 },
  "screens": [
    {
      "name": "dashboard",
      "path": "/dashboard",
      "figmaNodeId": "1:2",
      "waitFor": "text=Overview",
      "interactions": [
        { "name": "open-filters", "action": "click", "selector": "button[aria-label='Filters']", "expect": "text=Date range" }
      ]
    }
  ]
}
```

`figmaNodeId` accepts a bare id (`1:2`) or a pasted Figma URL.

**3. Run it:**

```bash
export FIGMA_TOKEN=figd_...
export FIGMA_FILE_KEY=...
node src/cli.mjs run --config design-audit.config.json
```

Writes `audit-runs/<date>/<screen>/build.png`, `figma.png`, `snapshot.json`, and a report at the run root.

---

## Running it in CI

`check` exits `1` if any P1 survives its exceptions, so it drops into a pipeline unchanged:

```yaml
- run: npx playwright install --with-deps chromium
- run: node src/cli.mjs run --config design-audit.config.json
  env:
    FIGMA_TOKEN: ${{ secrets.FIGMA_TOKEN }}
    FIGMA_FILE_KEY: ${{ secrets.FIGMA_FILE_KEY }}
```

Start with contrast as the only P1. Promoting more checks to P1 before the backlog is clear just teaches everyone to pass `--no-verify`.

---

## What this does not do yet

Being honest about the edges, because a tool that overstates itself wastes your afternoon:

- **No pixel diffing.** It downloads the Figma frame and puts it beside the build capture, but does not compare them automatically. Overlay comparison is genuinely hard to get right — anti-aliasing, font rendering and dynamic content produce enough false positives to drown the real findings. The rule checks are more useful per unit of effort, which is why they came first.
- **The Figma download path has not been run against the live API.** The capture-and-check pipeline has: it was run end to end against a public site, and the output in [Example output](#example-output) is real. The Figma half is written and unit-tested for URL parsing, but nobody has yet pointed it at a real file with a real token. Expect to hit something the first time.
- **No Figma-side token extraction.** Tokens are declared by hand in `tokens.json` rather than read from Figma variables. Reading them from the file via the Variables API is the obvious next step.
- **Captures one state per screen.** Interactions run in sequence and the shot is taken at the end (or at `captureAfter`). Capturing several states per screen would need the config to describe them as separate entries.
- **Not tested against every auth setup.** `storageState` covers the common case of a saved logged-in session. SSO flows that re-challenge will need their own handling.
- **Static analysis only.** It reads what rendered. It will not catch a layout that breaks at a viewport you didn't list.

## Tests

```bash
npm test
```

Ten tests covering the colour maths against published WCAG reference values, each check firing on a known-bad fixture, and the exceptions logic — including that expired exceptions stop suppressing and that an under-specified exception is rejected.

---

## Security

Everything that identifies a specific project stays out of the repo. `.gitignore` excludes `design-audit.config.json`, `tokens.json`, `exceptions.json`, `.auth/`, `.env` and `audit-runs/` — only the `.example.json` files are committed. Figma credentials are read from the environment and never from config.

If you fork this for internal use, keep it that way: a config file is a map of your private routes, selectors and file keys.

## Licence

MIT
