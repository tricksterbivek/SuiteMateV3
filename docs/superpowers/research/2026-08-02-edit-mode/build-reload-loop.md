# SuiteMate v3 — Build & Reload Development Loop

**Research date:** 2026-08-02
**Scope:** the exact build-and-reload development loop, for a captain agent driving Chrome to test Edit Mode table enhancements.
**Method:** read-only inspection of the repo at `/Users/Bivek.Shah/Documents/suitemate/suitematev3`, plus ground-truth execution of the read-only test stages. No repo files were modified in producing this research (this document is the sole artifact).

**Environment verified at time of research:** branch `main` · v3.21.1 · Node v24.14.0 · Python 3.13.13 · Chrome present at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

---

## Headline finding

**There is no automated reload. None.** No watch mode, no CRX auto-reload, no reload helper script, no Playwright/web-ext hook. Confirmed by inspection of `package.json`, `scripts/`, and the full `docs/` tree.

And the agent driving Chrome **cannot** press the reload button itself — `chrome://extensions` is a privileged page that extensions (including Claude in Chrome) cannot script. **The extension action popup is likewise unreachable from browser automation** (`save/CHECKPOINTS.md:1130`).

Every prior live session had **the owner** perform both by hand. Plan the loop around that constraint rather than around discovering a way past it.

---

## 1. Build

### 1.1 The repo root *is* the unpacked extension

There is no packaging step, no `dist/` staging directory for the extension, no copy phase. `manifest.json` sits at the repo root and references `src/…`, `dist/…`, `icons/…` relative to it. Chrome loads the working tree directly.

> **An edit to a source file is live in the extension folder the instant you save it.** What is *not* instant is Chrome picking it up — see §2.

### 1.2 What the build actually builds

`npm run build` → `node scripts/build.mjs` → esbuild, exactly **two** bundles:

| Entry point | Output | Consumed by |
|---|---|---|
| `src/suiteql/studio-entry.js` | `dist/suiteql-studio.js` | content script on `ubersearchresults.nl` (`manifest.json:208`); also `tests/fixtures/route-classic.html` |
| `src/palette/material-palette.js` | `dist/material-palette.js` | `src/popup/popup.html:230` |

esbuild options (`scripts/build.mjs:3-12`):

```js
const sharedOptions = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  minify: true,
  sourcemap: false,
  legalComments: "eof",
  logLevel: "info"
};
```

**Everything else ships unbundled.** All content scripts, the service worker, and the popup are plain source files Chrome reads directly from disk. Therefore:

> **You only need `npm run build` if you touched `src/suiteql/studio-entry.js` (or its imports) or `src/palette/material-palette.js`.** For so-columns, form-views, csv-export, shared, record-actions, styles, popup.js, or the service worker — the build is a no-op for your change.

For the Edit Mode work specifically (so-columns-adjacent, form-views-adjacent), **the build will almost never be needed.**

### 1.3 `dist/` is git-tracked

`.gitignore` is only:

```
.DS_Store
*.zip
artifacts/
node_modules/
```

`git ls-files dist/` returns both artifacts. A fresh clone works without building.

### 1.4 No watch mode

Confirmed: no `watch` string anywhere in `package.json` or `scripts/*.mjs`. Re-run `npm run build` by hand when needed.

`npm install` is needed only after dependency changes (README:61-66):

```sh
npm install
npm run build
```

### 1.5 Version bump — three files must agree

`tests/verify.mjs:13` hard-pins the manifest version:

```js
assert.equal(manifest.version, "3.21.1");
```

A version bump is therefore a **three-file edit, or `npm test` fails**:

| File | Line |
|---|---|
| `package.json` | 3 |
| `manifest.json` | 5 |
| `tests/verify.mjs` | 13 |

This is per-release, not per-build. The prior ship step names exactly these three — recovered from the deleted `docs/superpowers/plans/2026-07-31-form-layout-builder.md`, Task 8 Step 3:

> *"**Step 3: Version bump** — `package.json` + `manifest.json` `"version": "3.22.0"`, verify.mjs version pin; `npm test` green."*

---

## 2. Load and reload in Chrome

### 2.1 Initial load (README:53-59)

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click **Load unpacked**
4. Select `/Users/Bivek.Shah/Documents/suitemate/suitematev3` (the repo root)
5. Open NetSuite and reload the page

### 2.2 Architecture layers

Manifest V3, four distinct execution layers:

| Layer | Files |
|---|---|
| **Content scripts** — 14 entries in `manifest.json:32-221`; the main one is `run_at: "document_start"`, `all_frames: true`, matching `https://*.netsuite.com/*` | `src/shared/{utilities,routes,commands,bridge,lifecycle,settings}.js`, `src/internal-ids/{core,runtime}.js`, `src/csv-export/{core,runtime}.js`, `src/so-columns/{core,runtime}.js`, `src/tab-title/{core,runtime}.js`, `src/form-views/{core,runtime}.js`, `src/runtime/{theme-runtime,notification-runtime}.js`, `src/record-actions/{core,csv-import}.js`, `src/import-assistant/{core,context-runtime}.js`, plus 10 CSS files |
| **Service worker** — `manifest.json:26-28` | `src/background/service-worker.js` plus its 9 `importScripts`: `src/shared/{utilities,routes,bridge,permissions}.js`, `src/suiteql/core.js`, `src/record-actions/core.js`, `src/import-assistant/core.js`, `src/csv-export/core.js`, `src/netsuite/data-adapter.js` |
| **Main-world injected** — via `chrome.scripting.executeScript({world: "MAIN"})` from `service-worker.js:127-137` and `data-adapter.js:990-992` | `src/csv-export/main-world.js` |
| **Extension pages** | `src/popup/popup.{html,js,css}` |

Note that several `src/shared/*` and `src/*/core.js` files are **dual-layer** — loaded both as content scripts *and* via `importScripts` in the service worker. Editing one of those must satisfy both layers' reload rules.

### 2.3 What each kind of change requires

| Layer edited | `npm run build`? | Extension reload (⟳ on `chrome://extensions`) | NetSuite page refresh |
|---|---|---|---|
| Content script JS/CSS (`src/so-columns/*`, `src/form-views/*`, `src/styles/*`, `src/shared/*`, …) | No | **Yes** | **Yes**, after the reload |
| Service worker or any `importScripts` dependency | No | **Yes** (the reload restarts the SW) | Only if the file is also a content script |
| `src/csv-export/main-world.js` | No | **Yes** | No — re-injected per invocation |
| `src/popup/popup.{html,js,css}` | No | **Yes**, to be safe | No — close and reopen the popup |
| `manifest.json` | No | **Yes, mandatory** — Chrome reads the manifest only at load | Yes |
| `src/suiteql/studio-entry.js` or its imports | **Yes** | **Yes** | **Yes** |
| `src/palette/material-palette.js` | **Yes** | **Yes** | Reopen the popup |

**Be conservative: always do the full extension reload.** Chrome's caching of unpacked content-script files is not reliably fresh on a page refresh alone, and this repo's own documentation prescribes the reload unconditionally — `docs/SMOKE_TEST.md` opens five separate passes with *"Reload the unpacked extension and…"* (lines 119, 133, 146, 161, 178).

The cost of guessing wrong is testing stale code and misattributing the result. That has already happened in this project once — see §5.8.

### 2.4 The reload is a human action

Evidence, verbatim:

- `docs/superpowers/plans/2026-07-28-persisted-sort-filter.md:445` — *"**Ask the owner to reload the unpacked extension**, then verify live (Playwright MCP, view-mode only): …"*
- Recovered layout-builder plan, Task 8 Step 2 — *"**Live protocol** (**user reloads extension first**; my test tab on SO 16302518, view mode only)"*
- `save/CHECKPOINTS.md:84` — *"**User-confirmed** live Chrome smoke test passed **after reloading the extension**."*
- `save/CHECKPOINTS.md:1100` — *"**Owner confirmed** the v3.19.1 build working live **after reload** (2026-07-29)."*
- `save/CHECKPOINTS.md:1090` — *"Live on production: **owner confirmed** the Export view download working after the response-validator fix."*

No sentence anywhere in `CHECKPOINTS.md` states that the agent reloaded anything. Every reload is passive-voice or attributed to the human.

### 2.5 The popup is also unreachable from automation

`save/CHECKPOINTS.md:1130`:

> *"the popup itself is **unreachable from the automation bridge**, so that single click remains owner-verifiable."*

Chrome's extension action popup cannot be driven by Playwright or Claude in Chrome. **Every feature-toggle flip is a human action**, exactly like the reload.

**Operational consequence:** batch "owner, please do X" into single interrupts — *reload the extension **and** set these toggles* — rather than discovering the popup dependency mid-pass. If a test needs a toggle in a specific state, get it set before the pass starts.

### 2.6 Documented workaround for a stale build

`save/CHECKPOINTS.md:979`:

> *"Live pass in the tricksterbivek profile with the one-rule fix **injected over the stale extension CSS**: production Sales Order value list narrowed 5 -> 1 in computed pixels with rows pinned; Purchase Order values all legitimately matched the probe (uniform MCW prefix). **Native confirmation after next extension reload.**"*

To validate a **CSS or self-contained JS** change without a reload: inject it over the running (stale) extension via the console or `javascript_tool`, confirm the behavior, and mark the result *provisional* until the owner's next reload gives native confirmation.

This does **not** work for manifest changes, service-worker changes, or anything depending on `document_start` timing.

### 2.7 "No refresh required" is itself a tested property

The reverse case — a setting flip taking effect on an already-open page — is an explicit test claim, not an assumption:

- `:1186` — *"The toggle-on-while-open path — the review's missing-observer finding — proved itself live: **flipping the settings installed both form-views and the grid on an already-open Sales Order with no refresh**."*
- `:1176` — *"**Missing observer**: the lifecycle registration had no `observe`, so the zero-wrapper bail never retried, late-rendered wrappers stayed unmanaged, and **toggling the setting on an open page did nothing until refresh (matches the live symptom)**."*
- `:69` — *"Applies the preference immediately **without a page reload** and removes only SuiteMate-owned badges when disabled."*

For Edit Mode, the equivalent property (does the enhancement install on an already-open edit form?) should be an explicit test, not assumed.

### 2.8 Page reload (distinct from extension reload) is the persistence assertion

"Real page reload" is the standard proof that state survived to `chrome.storage.sync`:

- `:705` — *"native load, drag, **persistence across reload**, Reset restoring the exact stamped native order, native retained **after final reload**"*
- `:889` — *"the hidden state **survived a full page reload** (schema-v2 sync storage round-trip); … the restore itself **persisted through a final reload** with clean storage."*
- `:1070` — *"**real page reload** auto-reapplied (2 of 5 rows, `Item ↑ · 1 filter ✕`, indicator, active arrow) … nothing resurrected **after reload**."*
- `:1227` — *"hide a field → **real page reload** → still hidden → chip unhide → storage clean"*
- `:749` — *"**page reload discarded all test rows**"* (used to clean up a 300-row DOM clone)

---

## 3. The fixture server — two different things

The project history's "fixture server" refers to **two distinct mechanisms**. Do not conflate them.

### 3.1 Automated, ephemeral — inside `npm test`

`scripts/capture-fixtures.mjs:84-111` spins up a `node:http` static server bound to `127.0.0.1` on a **random port** (`listen(0)`), path-traversal-guarded to the repo root, serving `Cache-Control: no-store`:

```js
function startStaticServer() {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
    const target = resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    …
  });
  return new Promise((resolvePromise, reject) => {
    server.listen(0, "127.0.0.1", () => { … });
  });
}
```

It then launches **headless Chrome** and drives it over raw **CDP via WebSocket**:

```
--headless=new --disable-background-networking --disable-component-update
--disable-default-apps --disable-extensions --disable-features=Translate,OptimizationHints
--disable-sync --force-color-profile=srgb --hide-scrollbars --metrics-recording-only
--mute-audio --no-default-browser-check --no-first-run --remote-allow-origins=*
--remote-debugging-port=0 --user-data-dir=<temp>
```

Fully automatic; you never touch it directly. Set `CHROME_PATH` if Chrome is installed outside the standard macOS/Linux locations (candidate list at `capture-fixtures.mjs:19-27`).

### 3.2 Manual, for real-Chrome testing — `python3 -m http.server 8931`

This is the one prior sessions used interactively, and **the captain's highest-leverage tool**:

```sh
cd /Users/Bivek.Shah/Documents/suitemate/suitematev3
python3 -m http.server 8931
```

Then open:

```
http://localhost:8931/tests/fixtures/sales-order.html?formViews=true&salesOrderColumns=true
```

Recovered layout-builder plan, Task 5 Step 4, verbatim:

> *"**Run the collapse sanity check** — serve (`python3 -m http.server 8931` from repo root), load `http://localhost:8931/tests/fixtures/sales-order.html?formViews=true&salesOrderColumns=true`, click Primary Information title: content row hides, aria-expanded flips …"*

> **It needs no extension reload at all.** Edit source → hard-refresh the fixture tab → the new code is live. No reload, no owner, no production risk.

### 3.3 Why the fixture works without the extension

The fixture pages are **self-loading**. `tests/fixtures/sales-order.html:18-37` includes `chrome-stub.js`, rewrites the URL so route detection fires, then `<script>`-tags every shared/core/runtime file the content-script layer would have injected:

```html
<script src="chrome-stub.js"></script>
<script>
  history.replaceState(null, "", "/app/accounting/transactions/salesord.nl?id=1");
</script>
<script src="../../src/shared/routes.js"></script>
<script src="../../src/shared/commands.js"></script>
<script src="../../src/shared/bridge.js"></script>
<script src="../../src/shared/lifecycle.js"></script>
<script src="../../src/shared/settings.js"></script>
<script src="../../src/runtime/theme-runtime.js"></script>
<script src="../../src/runtime/notification-runtime.js"></script>
<script src="../../src/record-actions/core.js"></script>
<script src="../../src/csv-export/core.js"></script>
<script src="../../src/so-columns/core.js"></script>
<script src="../../src/form-views/core.js"></script>
<script src="../../src/record-actions/csv-import.js"></script>
<script src="../../src/csv-export/runtime.js"></script>
<script src="../../src/so-columns/runtime.js"></script>
<script src="../../src/form-views/runtime.js"></script>
```

`tests/fixtures/chrome-stub.js` fakes `chrome.storage` and reads feature toggles from query params:

```
enabled, mode, squareCorners, showInternalIds, salesOrderColumns, formViews,
roleKey, mainColor, secondaryColor
```

It also exposes `SuiteMateV3Fixture` and **write counters**, which enabled the single strongest assertion in the project log — `save/CHECKPOINTS.md:1182`:

> *"Fixture round-trip re-proven at the review's exact failure scenario: stored sections `[Classification, Phantom Section]` + reload → replay collapsed Classification with **ZERO storage writes**; a user collapse then produced **exactly one write** and `Phantom Section` survived the merge."*

`save/CHECKPOINTS.md:1160` on the fixture's DOM realism:

> *"Fixture upgraded with a realistic classic form: `.uir-field-wrapper` divs carrying `data-field-name`/`data-walkthrough`/`.uir-label` across two collapsible field groups, plus a fixture-native collapse script emulating NetSuite's handler; **chrome-stub seeds `formViews` and serves the `suiteMateV3FormViews` key with write counters**."*

### 3.4 The "fresh-eval recipe" — a stale-cache fallback

`docs/superpowers/plans/2026-07-28-persisted-sort-filter.md:373`, the only copy of the full procedure in the repo:

> *"**Step 3: Fixture round-trip (manual browser step, served fixture).** Start `python3 -m http.server 8931` at repo root; in Chrome open the sales-order fixture via the fresh-eval recipe (replaceState to `?salesOrderColumns=true`, then chrome-stub → utilities → settings → routes → core → runtime with `cache:"no-store"`, inject `so-columns.css`). Sort a column asc + select one filter value; read `SuiteMateV3Fixture.columnOrders` (or `chrome.storage.sync.get`) and confirm `{sort:{label,dir:"asc"}, filters:{…}}` under the fixture scope. Reload the page, repeat injection WITHOUT interacting: assert at computed level that rows are sorted (first-cell text order), filtered rows are `display: none`, the sort indicator `↑` is present, and the arrow carries `suitemate-v3-so-columns-filter-active`."*

Decoded: manually `fetch` each module with `cache: "no-store"` and `eval` it in strict order **chrome-stub → utilities → settings → routes → core → runtime**, then inject the CSS. The `no-store` is the mechanism — it defeats Chrome's HTTP cache so each eval picks up the just-edited source. **This is explicitly the technique that sidesteps the extension-reload dependency.**

Since the fixture pages now load everything themselves, a hard refresh is normally sufficient. Keep this recipe as a fallback if you suspect caching.

### 3.5 Fixtures depend on a current build

`tests/fixtures/route-classic.html` loads `/dist/suiteql-studio.js`. If `dist/` is stale or missing, the route fixtures break.

### 3.6 Fixture vs live: the division of labor

Consistently across the project: **fixture proves mechanism and pixel-level assertions; production proves it against real DOM at real scale.**

`save/CHECKPOINTS.md:1188` states the doctrine — *"the full-parity fixture had already exonerated the build."*

Cases where the fixture agreed but live disagreed are called out as fixture gaps, and are worth studying before building the Edit Mode fixture:

- `:961` — live NetSuite collapsed borders render ~2px over the style width
- `:699` — *"real record pages mutate during load, so deriving the pristine order from the current DOM could capture an already-personalized arrangement"*
- `:989` — the `uir-list-row-tr` row family, *"evidenced by a live 16-row fulfillment the shared row predicate matched zero rows on"*

Shorthand used in the log for this mechanism is *"served fixture"* / *"the served sales-order page"* (`:670`, `:725`, `:742`, `:767`, `:791`, `:814`, `:1069`, `:1089`). The final line of the file (`:1227`) closes a session with *"fixture server shut down."*

---

## 4. Test suite

### 4.1 `npm test` — one long chained command (`package.json:8`)

Five stages, sequential, fail-fast:

1. `npm run build` — rebuilds both bundles
2. **35 × `node --check <file>`** — syntax-only gate across every `src/` module, `tests/fixtures/{chrome-stub,route-catalog,route-fixture}.js`, and `scripts/capture-fixtures.mjs`
3. `node --test` over **16** test files
4. `node tests/verify.mjs` — the contract / source-scan harness
5. `npm run fixtures:verify` — the 28 screenshot baselines

**Framework: `node:test` + `node:vm`.** No Jest, Mocha, or Vitest. Tests live in `tests/*.test.mjs`.

The 16 files run by `node --test`:

```
utilities  routes  fixtures  commands  bridge  data-adapter  lifecycle
runtime-lifecycle  settings  settings-transfer  permissions  internal-ids
csv-export  so-columns  tab-title  form-views
```

Two `*.test-support.mjs` files (`popup-settings-race`, `suiteql-studio-commands`) are helpers imported by those suites, not run directly. `tests/tmp-probe-fieldorder-wipe.mjs` is a leftover forensics probe, not in the suite.

### 4.2 Ground truth — executed during this research

```
ℹ tests 213
ℹ suites 0
ℹ pass 213
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 230.583334
```

```
Verified 53 manifest resources, the route registry, the typed NetSuite bridge,
the observer lifecycle, 15 V1 style hashes, role themes, CSV Import, CSV Export,
and SuiteQL Core behavior.
```

```
Verified 28 fixture screenshots at 1440x1000.
classic/dashboard.png classic 0.000%
classic/login.png classic 0.000%
classic/file.png classic 0.000%
classic/file-cabinet.png classic 0.000%
classic/script-editor.png classic 0.000%
classic/script.png classic 0.000%
classic/script-deployment.png classic 0.000%
classic/script-status.png classic 0.000%
classic/scripting.png classic 0.000%
classic/saved-search.png classic 0.000%
classic/saved-search-edit.png classic 0.000%
classic/saved-search-results.png classic 0.000%
classic/global-search-results.png classic 0.000%
classic/suiteql-console.png suiteql-console 0.000%
classic/help-center.png classic 0.000%
classic/records-catalog.png classic 0.000%
classic/import-assistant.png classic 0.000%
classic/bundle-builder.png classic 0.000%
classic/pdf-template.png classic 0.000%
classic/workflow.png classic 0.000%
classic/netsuite-page.png classic 0.000%
classic/toast-notification.png classic 0.000%
classic/toast-loading.png classic 0.000%
classic/customer-login.png classic 0.000%
classic/field-help.png classic 0.000%
classic/map-reduce-status.png classic 0.000%
redwood/redwood-record.png redwood 0.000%
redwood/redwood-suiteql.png redwood 0.000%
```

**The suite is green as of 2026-08-02: 213 tests, 28 baselines at 0.000%.**

### 4.3 The "28 baselines at 0.000%" — the mechanism

This is **not** a code-coverage number. It is **pixel-diff visual regression**.

**Baselines.** 28 PNGs under `tests/fixtures/screenshots/` — 26 in `classic/`, 2 in `redwood/`. Viewport **1440×1000** (`catalog.VIEWPORT`).

**Capture** (`capture-fixtures.mjs:249-296`). For each fixture: create a background CDP target → `Emulation.setDeviceMetricsOverride` to 1440×1000 → navigate to the served fixture → wait for `document.documentElement.dataset.fixtureReady === "true"` or the route's last required selector (20s deadline) → `await document.fonts.ready` → inject a stylesheet neutralising all animation, transition and caret:

```css
*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
.suitemate-v3-toast{opacity:1!important;transform:none!important}
```

→ `window.scrollTo(0,0)` → run the route's optional `beforeCapture` → wait 100ms → `Page.captureScreenshot({format:"png", fromSurface:true, captureBeyondViewport:false})`.

**Compare** (`comparePng`, `capture-fixtures.mjs:361-381`). A hand-rolled PNG decoder (zlib inflate + Paeth unfiltering — no image dependencies) then a per-pixel scan:

```js
let maxDifference = 0;
for (let channel = 0; channel < 3; channel += 1) {
  const baselineValue = baseline.pixels[index * baseline.channels + channel];
  const actualValue = actual.pixels[index * actual.channels + channel];
  maxDifference = Math.max(maxDifference, Math.abs(baselineValue - actualValue));
}
if (maxDifference > 24) { changed += 1; }
```

A pixel counts as changed if **any** of R/G/B differs by **more than 24**. Result is `changedRatio = changed / totalPixels`. A dimension mismatch short-circuits to `changedRatio: 1`.

**Gate** (`capture-fixtures.mjs:433`):

```js
if (comparison.changedRatio > 0.01) {
  throw new Error(`${relativePath}: visual difference ${(comparison.changedRatio * 100).toFixed(3)}% exceeds 1%. ${comparison.reason}`);
}
```

Fails above **1%**. Reported as `(changedRatio * 100).toFixed(3)` — hence the literal string **`0.000%`**. So 0.000% means byte-for-byte-equivalent rendering, and the 1% tolerance is headroom that in practice has never been consumed.

**Catalog.** `tests/fixtures/route-catalog.js` defines `CLASSIC_ROUTES` + `CLASSIC_VARIANTS` (Customer Center login, Field Help, Map/Reduce status) + `REDWOOD_BASELINES`. `tests/fixtures.test.mjs:32` asserts every classified route except the intentionally unsupported `unknown` route has a Classic baseline.

**Documentation drift.** `README.md:76` and `docs/SMOKE_TEST.md:196` both say **26** baselines. Both are **stale**. The real count is **28**, verified by file count (`find tests/fixtures/screenshots -name "*.png" | wc -l` → 28) and by the runner's own output. `save/CHECKPOINTS.md` switched from 26 to 28 at line 669 and has said 28 ever since.

**Updating baselines:**

```sh
npm run fixtures:update    # rewrites tests/fixtures/screenshots/
npm run fixtures:verify
```

`docs/SMOKE_TEST.md:200`:

> *"Review screenshot changes individually before running `npm run fixtures:update`. **Never refresh baselines merely to silence a failed comparison.**"*

### 4.4 Running a subset

```sh
# one test file
node --test tests/form-views.test.mjs

# a single test by name
node --test --test-name-pattern "auto-reapply" tests/so-columns.test.mjs

# skip the slow screenshot stage entirely (fast inner loop, ~1s)
node --test tests/form-views.test.mjs && node tests/verify.mjs

# one fixture screenshot only
node scripts/capture-fixtures.mjs --verify --fixture=dashboard

# enumerate fixture ids
node scripts/capture-fixtures.mjs --list
```

### 4.5 Lint and typecheck gates

**There are none.** No ESLint, Prettier, TypeScript, or `tsconfig.json` anywhere in the repo. The only static gate is `node --check` (parse-only).

Two *implicit* gates are worth knowing, both inside `tests/verify.mjs`:

- **15 V1 style hashes.** `src/styles/*.css` files copied byte-for-byte from SuiteMate V1 are hash-pinned. Editing one fails the suite **by design** (README:29). The V3-owned exceptions are `src/styles/radii.css` and `src/styles/v3-compat.css`.
- **Popup source-scan assertions** (`verify.mjs:125-141`). Regex assertions over `popup.css` (must contain `min-width: 360px` on `:root` and `body`; must **not** contain `max-width: 100vw`) and `popup.html` (picker modal structure, exact script load order, absence of removed UI). Editing popup markup or styles can fail these.

`verify.mjs` also asserts the full content-script manifest arrays element-by-element (`verify.mjs:30-102`) — **adding a file to `manifest.json` content scripts requires updating `verify.mjs` in the same commit.** This is directly relevant to Edit Mode if a new module is added.

---

## 5. Prior testing conventions

### 5.0 There is no `docs/testing-log.md`

It has **never existed** — confirmed against full git history (`git log --all --diff-filter=A --name-only`). `docs/BUILD-BRIEF-edit-mode.md:117` *instructs the captain to create it*:

> *"After every save, append one line to `docs/testing-log.md` (timestamp, what changed, gate verdict) and include it in the next checkpoint commit."*

Treat it as a **new deliverable**, not an existing artifact.

### 5.1 `save/CHECKPOINTS.md` is the real log — and the template

83,378 bytes, 1227 lines, ~25 milestones. Governing doctrine, line 3:

> *"This file records verified development baselines. New feature work must not begin until the preceding checkpoint has passed automated tests, live NetSuite verification, pull request review and release publication."*

**Two eras.**

**Era A (v3.2.0 – v3.14.0, lines 5–651)** — fixed 8-part shape:

```
## v3.N.0: <Title>
Status: <Verified | …>
Date: YYYY-MM-DD
Pull request: <https://github.com/tricksterbivek/SuiteMateV3/pull/NN>
Release: <https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.N.0>
### Included         — bulleted scope / behavior / security claims
### Verification     — npm test / baselines / hashes / git diff --check / npm audit / live checks
### Restore          — fenced bash block (git switch --detach v3.N.0)
### Next feature     — ticket ID + name
```

Era A's five-bullet verification block, e.g. lines 29–34:

> *"- Full `npm test` regression suite with 150 passing tests.
> - All 26 screenshot baselines reproduced at 0.000 percent difference.
> - Protected 15-file SuiteMate V1 styling hash suite unchanged.
> - `git diff --check`.
> - `npm audit --omit=dev` with zero vulnerabilities."*

**Era B (Milestone 1 onward, lines 652–1227)** — `Pull request:`, `Release:`, `### Restore`, `### Next feature`, `git diff --check` and `npm audit --omit=dev` were **all dropped**. Provenance moved to `Spec:`/`Plan:` links and inline git refs. **Copy this shape:**

```
## <Feature>: Milestone N (<parenthetical subtitle>)
Status: <state string>
Date: YYYY-MM-DD
[Spec: docs/superpowers/specs/… · Plan: docs/superpowers/plans/…]
### Included        — root-cause narrative + design decisions + rejected alternatives
### Verification    — npm test line, then fixture line, then browser line
[### Milestone N live verification (YYYY-MM-DD)]   ← appended AFTER the live pass
[### Addendum (post-rollback forensics, YYYY-MM-DD)]
```

The live-verification subsection is **appended after the fact** — the milestone is written first with automated + fixture evidence, then amended once a live pass runs.

**`Status:` is a small state machine.** Reuse these strings verbatim:

- `Complete; live NetSuite verification passed 2026-07-28` (:710, 729, 754, 795, 820, 835, 851, 872, 894, 911, 944)
- `Automated + browser verification complete; live NetSuite retest pending` (:777, 928)
- `Live NetSuite verification complete` (:693)
- `Complete; confirmed working by user on live NetSuite 2026-07-28` (:966)
- `Complete; owner-confirmed working live 2026-07-28` (:1074)
- `Complete; live-verified across three transaction types 2026-07-28` (:1053)
- `Complete; live-verified at both scales 2026-07-30` (:1104)
- `Complete; live-verified across four record shapes 2026-07-30` (:1119)
- `Complete; suite-verified, fixture functional pass and adversarial review next` (:1151)
- `Complete; superseded by Milestone 3 live verification` (:654, 674)

**The standard test-gate sentence** (Era B canonical form, first at :669):

> *"Full `npm test` suite: 171 passing tests, **28 screenshot baselines at 0.000 percent difference**."*

Later wording drifts — *"0.000 percent difference"* → *"0.000 percent"* → *"0.000%"*, and *"screenshot baselines"* → *"baselines"*. The stable invariants are the literal count **28** and the literal **0.000**. When the test count changes, the delta is **justified inline in parentheses**, e.g.:

- `:1068` — *"190 passing (4 new core suites; 8 schema-version expectations updated **as declared consequences of the bump**); 28 screenshot baselines **untouched** at 0.000 percent."*
- `:1164` — *"212 passing (routes capability tests, settings v5 across four suites, transfer legacy acceptance, form-views core); 28 screenshot baselines untouched at 0.000 percent (feature is default-off and startPaused — the M22 precedent)."*
- `:1009` — *"Full `npm test` **after every step group**: 186 passing tests, 28 screenshot baselines at 0.000 percent difference **throughout**."*
- `:1203` — *"Full `npm test` green (213 tests, 28 baselines at 0.000%)."*

**Every live pass closes with a zero-errors assertion:**

- *"Zero JavaScript errors."* — :750, 773, 816, 868, 890, 962, 1017
- *"Zero console errors."* — :1114, 1130
- `:1070` — *"**Zero SuiteMate console errors (only NetSuite's own SuitePhone CSP notice).**"* ← the acceptable-noise carve-out
- `:1189` — *"Coexistence green (45 grid arrows, smart tab titles); zero SuiteMate console errors throughout."*

**Two more recurring gates:** *"Screenshot reviewed."* as a human-eye check (:813, 831, 847, 863, 924), and **scale checks on real DOM** — `:749`:

> *"Scale check on real 44-column PO DOM cloned to 300 rows: first sort ~0.9s wall-clock (includes one-time row stamping and automation round-trip), subsequent sorts ~0.36s, live filter ~0.14s, correct visible counts; page reload discarded all test rows."*

### 5.2 Assert at computed-display level — a recorded methodology correction

`save/CHECKPOINTS.md:973` — the single most load-bearing methodology sentence in the project:

> *"Verification-methodology correction recorded: prior checks read the `.hidden` property instead of computed display, **passing while pixels never changed**. Menu verifications now assert at the computed-display level."*

Downstream compliance:

- `:863` — *"Browser pass **at the computed-display level**"*
- `:978` — *"Fixture pass **at pixel level**"*
- `:924` — *"computed box-shadow none"*
- `:979` — *"narrowed 5 -> 1 **in computed pixels**"*
- `:1069` — *"re-sorted and filtered **at computed level**"*
- `:1094` — *"leaked past the computed-display test"*

> **Rule for the captain: never assert a class name, attribute, or `.hidden` property as proof. Read `getComputedStyle` / bounding rects.** A test that passes on state instead of pixels is the documented failure mode in this codebase.

### 5.3 "display-defeats-hidden" is a known recurring defect class — third sighting

Tracked by sighting count across milestones:

- M11 (`:858`)
- M17 (`:972`) — *"the same defect class as the Milestone 11 button bug"*
- `:1143` — *"the third instance of the M11/M17 display-defeats-hidden defect class"*; `:1157` — *"third sighting"*

The doctrine that emerged, from the recovered layout-builder plan's Global Constraints:

> *"Visibility/effect CSS needs `!important` (M11/M17 doctrine)."*

**Edit Mode hide/show columns is exactly this defect class's habitat.** Expect sighting four. Write the `!important` in from the start and assert computed display.

### 5.4 Staged verification: unit → fixture → live

From `docs/superpowers/specs/2026-07-30-personal-form-views-design.md:38`:

> *"Unit: core normalizers/writers + plan/apply helpers in the vm harness (`plain()` doctrine). Fixture: served sales-order fixture — hide fields, collapse a section, reload with seeded storage, assert computed-display reapplication and chip/ghost behavior at pixel level. Live: SO 16302518 full cycle (hide, collapse, reload auto-reapply, un-hide via chip, Reset clean), plus a non-SO record proving the capability does NOT fire there; existing features smoke (grid personalization on the same page must be untouched); zero console errors. **Checkpoints at: core+storage landed, runtime+UX landed, fixture-verified, live-verified.**"*

Note the negative test — *"a non-SO record proving the capability does NOT fire there"* — is a standing convention, not optional.

### 5.5 Fixes found during a live pass are deferred, not blocked

Three verbatim instances of the annotation convention:

- `:814` — *"Two micro-fixes found during the pass, **verified on the served fixture (live after next extension reload)**: a second-pass right-edge re-clamp (menu width settles wider than first measurement by ~1px), and a 350ms scroll-close grace period so the menu is not self-closed by the trailing events of a smooth scroll."*
- `:961` — *"drag math now starts from the applied style width when present (**fixture-verified; live on next reload**)."*
- `:979` — *"the one-rule fix injected over the stale extension CSS … **Native confirmation after next extension reload.**"*

`Status: Automated + browser verification complete; live NetSuite retest pending` is a **legitimate checkpoint state**. Do not block a milestone on a reload you cannot perform.

### 5.6 Live passes were batched across milestones

Section headers show it plainly:

- `:744` — `### Milestone 4 + 5 live verification (2026-07-28)`
- `:769` — `### Milestone 6 live verification (2026-07-28)`
- `:811` — `### Milestone 8 live verification (2026-07-28)`
- `:865` — `### Milestones 9-11 combined live verification (2026-07-28)`
- `:887` — `### Milestone 12 live verification (2026-07-28)`
- `:958` — `### Milestones 13, 14 and 16 combined live verification (2026-07-28)`
- `:1012` — `### Milestone 19 live verification of the refactored build (2026-07-28, v3.18.1 loaded)`
- `:1184` — `### Personal Form Views: Milestone 24d (final live verification, shipped build)`

Live sessions are expensive (each needs a human interrupt), so several milestones are queued and verified in one production session.

### 5.7 Production account, records, and the destructive-test rule

- **Account `6998262`** (production) — `:705`, `:746`
- **User internal ID `2462`** — visible only inside the recovered storage key at `:1212`
- **Storage scope format `company:user:recordType`** — `:681`, `:706`; concrete example `6998262:2462:salesord`

| Record | Internal ID | Shape noted |
|---|---|---|
| Sales Order | **16302518** | 45 columns / 154 fields — the workhorse |
| Item Fulfillment | **14953684** | 16 `uir-list-row-tr` rows — different row family |
| Purchase Order | **16295656** | 44 columns, **empty scope** — the burn record |

**Destructive tests were confined to an empty-scope record:**

- `:1070` — *"PO 16295656 **(empty scope)** — full destructive cycle, Reset cleared sort+filters+layout and nothing resurrected after reload."*
- `:1017` — *"User's real saved layouts untouched (**destructive checks confined to an empty-scope record**). Zero JavaScript errors."*
- `:1187` — the form-views pass *"ended by restoring their exact saved view rather than Reset"* because the owner's real data was in scope.

Recovered plan, Global Constraints:

> *"Live testing: view mode only; never click native Edit/Submit; **never press Reset on the live scope** `6998262:2462:salesord` (holds the user's real hidden-field prefs); teardown = drag back to native (delta self-cleans)."*

> ⚠️ **`docs/BUILD-BRIEF-edit-mode.md:89-93` supersedes these record IDs** with a RECORD LOCK on `id=16342809` **only**. The historical IDs are context, **not** permission to open them. And because the brief grants **one** record, the empty-scope separation is unavailable — check whether `6998262:2462:salesord` holds owner data before any destructive action, and prefer *reverse-the-interaction* teardown over Reset.

### 5.8 Storage forensics — the recurring debugging technique

Two paths were used:

1. **Live**, from the page console: `chrome.storage.sync.get(...)` (`plans/2026-07-28-persisted-sort-filter.md:445`).
2. **Post-hoc**, from Chrome's **"Sync Extension Settings" LevelDB** on disk. `:706`, the canonical sentence:

> *"**Storage forensics (Sync Extension Settings LevelDB)** confirmed per-user, per-type scope keys (`company:user:recordType`) in production and correct entry deletion on Reset; pre-existing user personalizations preserved."*

No filesystem path or shell command is recorded anywhere in the repo — "Sync Extension Settings" is the Chrome profile subdirectory name only. On macOS this resolves to `~/Library/Application Support/Google/Chrome/<Profile>/Sync Extension Settings/<extension-id>/`, but the repo does not state it. Note the phrasing *"LevelDB history"* and *"the storage log"* — the append-only `.log`/`.ldb` records were read for **superseded** values, not just current state.

**Used as a diagnostic to exonerate code** — `:1188`:

> *"A non-install red herring was root-caused by **storage forensics**: both feature toggles had been switched off in stored settings (**a popup save around the extension reload**), **not a code fault** — the full-parity fixture had already exonerated the build."*

**Used as archaeology / data recovery** — `:1206-1213`:

> `### Addendum (post-rollback forensics, 2026-07-31)`
>
> *"**LevelDB history** showed the owner had been exercising the layout builder themselves after the live pass (field reorders across four groups, section moves, collapses, two Resets — the Resets are what cleared their earlier two hidden fields, before the rollback)…"*
>
> *"The rollback verification's hide/unhide write then hit the documented compat ceiling and dropped the owner's final builder experiment for the touched scope. **Recovered verbatim from the storage log** for when `feature/form-layout-builder` resumes:"*
>
> ```json
> {"schemaVersion":2,"views":{"6998262:2462:salesord":{"fieldOrder":{"Account Information":["exchangerate","currency"],"Primary Information":["entity","trandate","tranid","otherrefnum","memo","custbody_gwp_not_selected","custbody_shopify_order_number"]}}}}
> ```

> **Cautionary tale: a symptom observed right after a reload was misdiagnosed as a code defect when it was actually stale/changed stored state. Before blaming code after a reload, dump the stored settings.**

**Storage surface referenced throughout:**

| Item | Lines |
|---|---|
| `chrome.storage.sync` (named API) | 664 |
| Key `suiteMateV3ColumnOrder` | 664, 1061 |
| Key `suiteMateV3FormViews` | 1142, 1160 |
| Scope key format `company:user:recordType` | 681, 706 |
| Concrete scope key `6998262:2462:salesord` | 1212 |
| Schema v1→v2 (order → `{order?, hidden?}`) | 880 |
| v2 + `widths` (`{order?, hidden?, widths?}`) | 902 |
| Schema v3 (+ `sort`, `filters`) | 1061 |
| form-views schema-2 container compat | 1199, 1203 |
| 7,800-byte quota guard, single-entry eviction | 1142 |
| "empty storage" / "clean storage" as a Reset assertion | 885, 889, 1010, 1016, 1114, 1227 |
| Serialized write queue (race fix) | 1062 |

`:1062` records the fixture catching a real storage race:

> *"The fixture round-trip caught back-to-back saves clobbering each other's read-modify-write — all five storage savers now serialize through one promise queue (the shipped three shared the latent race)."*

### 5.9 Browser automation tooling changed — twice

Prior sessions used **Playwright**, always described as a "bridge":

- `:705` — *"Live production pass (account 6998262, 45-column Sales Order, **real pointer drags via Playwright bridge**): native load, drag, persistence across reload, Reset restoring the exact stamped native order, native retained after final reload, zero console errors."*
- `:746` — *"Production account 6998262, **real pointer interaction via Playwright bridge**."*
- `:725` — *"Browser pass (served fixture, **real clicks/drags via Playwright**)"*
- `:670` — *"Browser functional pass (served fixture, **real Chrome**)"*

Interaction fidelity is always spelled out — the convention is "real" plus the gesture type: *"real clicks/drags"*, *"real typing/clicks/drags"*, *"real checkbox clicks/typing/drags"* (:725, 742, 767, 791), *"real pointer drags"*, *"real page reload"*.

The strings `claude-in-chrome`, `Playwright MCP`, and `chrome-devtools MCP` appear **nowhere** in `CHECKPOINTS.md`. The only other in-browser hint is `:1174` — *"refutation-verified with **in-Chrome and Node mutation experiments**."*

> `docs/BUILD-BRIEF-edit-mode.md:85` mandates **Claude in Chrome** for this phase. Both MCP servers are available in-session; follow the brief.

### 5.10 Other recurring gate vocabulary

- **Adversarial review as a named gate** — `:1078` *"Built via ultracode recon + adversarial-review workflows"*; `:1092` *"The ultracode review fan-out (4 lenses, 12 raw findings, each adversarially verified — several by mutation testing)"*; `:1138` *"Built via Opus 5 ultracode recon (4 mappers: form DOM, reuse surface, wiring ripple, risk screen)"*; `:1174` *"The Opus 5 review fan-out (4 lenses, 22 agents, refutation-verified with in-Chrome and Node mutation experiments) confirmed three real defects, all fixed."*
- **Self-critique of test theater** — `:1177` *"**Transfer test theater** (reviewer catch on my own test): `transfer.create()` migrates before enveloping, so the v3/v4 acceptance test never reached the legacy branch. Replaced with hand-built v3/v4 envelopes that drive it genuinely, plus two NON_CANONICAL negatives."*
- **ponytail debt ledger** — `:1005` *"4 markers in core.js (quota single-entry eviction, day-first dates, non-contiguous-row sort refusal, partial-stamp restamp) — 3 without upgrade triggers, recorded for future milestone decisions."*

### 5.11 Reusable assets for the Edit Mode work

| Asset | Path | Note |
|---|---|---|
| Sales Order fixture | `tests/fixtures/sales-order.html` | self-loading; `replaceState`s to `salesord.nl?id=1`; **view-mode markup — will need Edit Mode machine-table markup added** |
| chrome.storage stub | `tests/fixtures/chrome-stub.js` | query-param toggles, **write counters**, `SuiteMateV3Fixture` global |
| Route fixture harness | `tests/fixtures/route-classic.html`, `route-catalog.js`, `route-fixture.js` | drives the 28 baselines; loads `/dist/suiteql-studio.js` |
| Live SO DOM topology | recovered plan, Global Constraints line 21 | precise selector map, probed twice against SO 16302518 — see below |
| View-mode grid precedent | `src/so-columns/core.js` (24.6 KB) + `runtime.js` (38 KB) | the drag/sort/filter/persist implementation Edit Mode must mirror **without touching** |
| Form-views precedent | `src/form-views/core.js` (8.5 KB) + `runtime.js` (15.8 KB) | hide/show + persistent collapse, schema-2 storage |
| Manual smoke checklist | `docs/SMOKE_TEST.md` | 200 lines of per-feature manual checks |
| V1 feature inventory | `save/SUITEMATE_V1_MASTER_FEATURE_INVENTORY.md` | referenced at README:89 |

**Recovered live Sales Order topology** (verbatim, recovered plan line 21):

> *"Live SO topology (probed twice, SO 16302518): groups = self-contained `<table width="100%">` in slot TDs; 4 layout tables (`#detail_table_lay` in `div__body`: 4 × colspan-3 slots; `shipping_div`: row of 3 colspan-1 TDs [Shipping Information, Shipping Address, empty spacer table] + colspan-3 Ship Central row; `billingtab_div` and `accntingtab_div`: rows of 2 colspan-1 TDs). Title TD: `td.fgroup_title.uir-field-group[.uir-field-group--collapsible][role=button]` containing `div.fgroup_title.uir-field-group-title` (+ icon span when collapsible). Content row: `tr.uir-fieldgroup-content.uir-field-group-content` (id `tr_fg_*` — NetSuite collapse targets these ids). Columns: `td > table.table_fields > tbody > tr.uir-field-wrapper-cell` (one TD per row, 1–2 wrapper DIVs per TD). `#detail_table_lay` also has a row of 3 `td.uir-table-fields-wrapper` (ungrouped fields — never slots)."*

This is **view-mode** topology. Edit Mode sublist "machine" tables are a different surface and will need their own probe.

---

## 6. The exact per-cycle recipe

### A. Fixture-only cycle — no reload, no owner, no production (**the default**)

```sh
# once per session, leave running:
cd /Users/Bivek.Shah/Documents/suitemate/suitematev3
python3 -m http.server 8931
```

Per edit to any content-script-layer file (`src/so-columns/*`, `src/form-views/*`, `src/shared/*`, `src/styles/*`, …):

1. Save the file.
2. `node --check <edited file>` — instant syntax gate.
3. Hard-refresh the fixture tab:
   `http://localhost:8931/tests/fixtures/sales-order.html?salesOrderColumns=true&formViews=true`
4. Assert via **computed style / bounding rects** (§5.2). Read writes from `SuiteMateV3Fixture` or the stubbed `chrome.storage.sync.get`; use the write counters to prove *how many* writes occurred.

No extension reload. No owner involvement. Iterate freely.

### B. Unit-test cycle

```sh
node --test tests/<area>.test.mjs && node tests/verify.mjs     # ~1s
```

### C. Full gate — before every checkpoint commit

```sh
npm test
```

Recovered plan, Global Constraints line 20:

> *"Full gate per task: `npm test` (build → node --check → node --test → verify.mjs → fixtures:verify). Fixture screenshot changes: `npm run fixtures:update` + eyeball each changed baseline."*

Expected: **213 passing** (plus your new tests), **28 baselines at 0.000%**.

A baseline moving when your feature shouldn't change any captured page **is a defect, not a baseline to refresh** — `plans/2026-07-28-persisted-sort-filter.md:20`:

> *"`npm test` must end fully green (incl. `fixtures:verify` at 0.000% — this feature adds no visual change to any captured fixture page, so baselines must NOT move; **any diff is a defect**)."*

### D. Live production cycle — the only one needing a human

1. `npm run build` — **only if** `src/suiteql/studio-entry.js` or `src/palette/material-palette.js` (or their imports) changed.
2. `npm test` — green.
3. **Ask the owner**, in one combined interrupt, to:
   a. open `chrome://extensions` and click ⟳ on SuiteMate V3, **and**
   b. set any required popup toggles.
   *You can reach neither surface.*
4. Wait for the owner's explicit confirmation that both are done.
5. Hard-refresh the NetSuite tab.
6. Test — asserting at computed-display level.
7. If a fix is found: apply it, fixture-verify it, and record it as *"fixture-verified; live on next reload."* Do not block.

**Batch live passes** into milestone-sized sessions (§5.6).

---

## 7. Command quick reference

```sh
cd /Users/Bivek.Shah/Documents/suitemate/suitematev3

npm run build                          # ONLY for suiteql-studio / material-palette sources
npm test                               # full gate: build → node --check ×35 → 213 tests → verify.mjs → 28 baselines
node --test tests/form-views.test.mjs  # single test file
node --test --test-name-pattern "X" tests/so-columns.test.mjs
node tests/verify.mjs                  # manifest + source contracts only
npm run fixtures:verify                # 28 screenshots (headless Chrome, ~30s)
npm run fixtures:update                # rewrite baselines — REVIEW EACH ONE FIRST
node scripts/capture-fixtures.mjs --list
node scripts/capture-fixtures.mjs --verify --fixture=dashboard

python3 -m http.server 8931            # manual fixture server (from repo root)
# → http://localhost:8931/tests/fixtures/sales-order.html?salesOrderColumns=true&formViews=true
```

**Owner-only, per live cycle:** `chrome://extensions` → ⟳ on SuiteMate V3 → set popup toggles → then hard-refresh the NetSuite tab.

---

## 8. Bottom line for the Edit Mode plan

The loop has exactly **one human bottleneck** — extension reload plus popup toggles — and exactly **one escape hatch** from it: the served fixture at `:8931`, which needs neither.

Three recommendations:

1. **Build the Edit Mode machine-table markup into `tests/fixtures/sales-order.html` early.** Every hour spent making the fixture faithful buys back a production interrupt later. The `chrome-stub` write counters make storage assertions provable in a way live testing cannot match.
2. **Spend live access in batched, milestone-sized passes**, and record fixes found during a pass as *"fixture-verified; live on next reload"* rather than blocking the milestone.
3. **Assert at computed-display level everywhere**, fixture and live. The `.hidden`-property failure mode is documented in this codebase, and "display-defeats-hidden" already has three recorded sightings — Edit Mode hide/show is its natural habitat.

---

## Appendix — provenance of this research

Sources read:

- `package.json`, `manifest.json`, `.gitignore`, `README.md`
- `scripts/build.mjs`, `scripts/capture-fixtures.mjs`
- `tests/verify.mjs` (structure), `tests/fixtures/` (chrome-stub, sales-order.html, route-classic.html, screenshots)
- `docs/SMOKE_TEST.md`, `docs/BUILD-BRIEF-edit-mode.md`
- `docs/superpowers/plans/2026-07-28-persisted-sort-filter.md`
- `docs/superpowers/specs/2026-07-30-personal-form-views-design.md`
- `save/CHECKPOINTS.md` (full, 1227 lines)
- `docs/superpowers/plans/2026-07-31-form-layout-builder.md` — **recovered from git** (deleted in `42ad514`; read via `git show 42ad514^:<path>`)
- `src/background/service-worker.js`, `src/popup/popup.html`, directory listings across `src/`

Commands executed (all read-only with respect to the repo; `fixtures:verify` writes only to a temp dir, and `npm run build` was deliberately skipped so `dist/` was never touched):

```sh
node --test <16 test files>     # → 213 pass, 0 fail
node tests/verify.mjs           # → green
npm run fixtures:verify         # → 28 screenshots, all 0.000%
```
