# UI Enhancement Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the design.md-derived token system (spec: `docs/superpowers/specs/2026-07-28-ui-enhancement-design.md`) across every surface SuiteMate V3 draws or restyles, one component family per task, with zero behavior change.

**Architecture:** A new `src/styles/tokens.css` defines the `--sm-*` custom-property set; each subsequent task edits the existing stylesheet that owns a component family in place, replacing literals with tokens and retuning the shared radius scale in the milestone that owns each radius token's primary consumer. All rules stay inside the existing gates (`html:not(.ext-f)`, `isDarkMode`, `disable_radii`).

**Tech Stack:** Vanilla CSS (Chrome-only: `light-dark()`, `color-mix()`, `:has()` already in use), node:test + `tests/verify.mjs` + `scripts/capture-fixtures.mjs` screenshot harness. No new dependencies.

## Global Constraints

- Repo: `/Users/Bivek.Shah/Documents/suitemate/suitematev3`. Work on `main`, in place (no worktree — session convention).
- Every content-page rule lives inside `html:not(.ext-f)` scoping (or an element namespace like `.suitemate-v3-toast` that only exists when SuiteMate injected it).
- NEVER add `position` or `display` declarations to NetSuite-owned elements (sticky-header doctrine). SuiteMate-owned elements (toasts, column menu, popup) are exempt.
- The ONLY JavaScript value change in the whole plan is `DEFAULT_ROLE_COLORS.main` in `src/shared/settings.js` (Task 2). Everything else is CSS, one `<link>` in `popup.html` (Task 8), and test/manifest bookkeeping.
- `tests/verify.mjs` `expectedStyleHashes` (line ~1872) pins sha256 hashes of 15 files including `src/styles/netsuite.css` and `src/styles/code.css`. Any commit editing a pinned file updates its hash in the same commit: compute with `shasum -a 256 src/styles/netsuite.css`.
- Version stays `3.18.1` until Task 10 (release). Do not touch version pins mid-stream.
- Commits: conventional messages (`feat:`/`chore:`/`docs:`). Author is the signed-in git user; NEVER add a `Co-Authored-By: Claude` trailer or any Claude attribution.
- Live testing is view-mode only on production account 6998262; never click native edit/submit controls; never destroy the user's saved column layouts (destructive so-columns cycles only on known-empty scopes).

**§V — Per-task verification cycle** (every task's steps reference this; run from repo root):

1. `npm test` — expect the unit phase green (186 tests). If the task changed visuals, the final `fixtures:verify` phase FAILS with non-zero percentages; that is the expected signal, continue to V2. If it fails for any file the task did not touch, stop and fix before proceeding.
2. `npm run fixtures:update` — regenerates baselines in `tests/fixtures/screenshots/{classic,redwood}/`.
3. `git status --short tests/fixtures/screenshots/` — every changed PNG must belong to a surface this task touched. View each changed PNG (Read tool renders images) and compare against expectations; a change outside the task's scope is a defect: revert, diagnose, do not re-bless.
4. `npm test` again — must end fully green (build, syntax checks, 186 unit tests, verify.mjs, fixtures:verify at 0.000%).
5. Live pass (needs the owner to reload the unpacked extension first — ask, then verify via Playwright MCP): open Sales Order 16302518, check the task's surfaces in light mode, dark mode (popup → Appearance → Dark), and once with a custom role color applied (popup → Role colors) to prove theme routing; run the so-columns functional smoke (Personalize → drag → Done → sort → filter → resize → Reset) on the SO; zero console errors. Task-specific live additions are listed per task.
6. Append a `save/CHECKPOINTS.md` entry (format: `## UI Enhancement: Task N (<name>)` + Status/Date/Included/Verification, matching existing entries), commit everything, push.

---

## File Structure

- `src/styles/tokens.css` — NEW. The `--sm-*` design-token set. Loaded before `netsuite.css` on NetSuite pages and linked from `popup.html` (Task 8). No rules other than custom-property definitions — it must never paint anything itself.
- `src/styles/netsuite.css` — theme defaults (lines 48-59), table vars (72-88), buttons (~660-1070), tabs (~1070-1230), totals (`.totallingtable` ~1696, `#totalRow` ~2514), sublists (~3030-3360), selects/menus (~234-410, 1330-1540), dialogs (~4560-5130 Redwood, `.uir-alert-box` ~417-660), dark block (6530-7400). Edited in Tasks 2-7. Hash-pinned.
- `src/styles/radii.css` — radius token values + usage map. Retuned across Tasks 2, 4, 6, 7 as each token's primary consumer is restyled.
- `src/styles/v3-compat.css` — table-header/subtab/field-group theming. Tasks 4-5.
- `src/styles/notifications.css` — toasts. Task 7.
- `src/so-columns/so-columns.css` — column-personalization UI. Tasks 2 (accent literals) and 4 (full tokenization).
- `src/record-actions/csv-import.css` — CSV Utils menu. Task 6.
- `src/popup/popup.css` + `src/popup/popup.html` — Task 8.
- `manifest.json` + `tests/verify.mjs` — bookkeeping for the new file (Task 1) and hash re-pins (every netsuite.css task).

---

### Task 1 (UI-0): Token foundation — zero visual change

**Files:**
- Create: `src/styles/tokens.css`
- Modify: `manifest.json` (first `content_scripts` entry, `css` array)
- Modify: `tests/verify.mjs` (~lines 33-35, expected css array)

**Interfaces:**
- Produces (consumed by every later task): custom properties `--sm-primary`, `--sm-primary-deep`, `--sm-primary-soft`, `--sm-focus`, `--sm-ink-deep`, `--sm-ink`, `--sm-charcoal`, `--sm-slate`, `--sm-steel`, `--sm-stone`, `--sm-canvas`, `--sm-surface-soft`, `--sm-hairline`, `--sm-hairline-soft`, `--sm-success`, `--sm-attention`, `--sm-warning`, `--sm-critical`, `--sm-critical-strong`, `--sm-shadow-1`, `--sm-shadow-2`, `--sm-space-1..7`, `--sm-type-{title,subtitle,body,button,caption}-{size,weight}` plus `--sm-type-body-spacing`, `--sm-type-title-line`, `--sm-type-body-line`, `--sm-type-caption-line`.

- [ ] **Step 1: Create `src/styles/tokens.css`** with exactly:

```css
/* SuiteMate V3 design tokens, derived from design.md.
   Spec: docs/superpowers/specs/2026-07-28-ui-enhancement-design.md
   Definitions only — this file must never paint anything itself.
   Fallbacks make every token safe outside NetSuite pages (popup). */

html:not(.ext-f) {
    /* accent — routed through role themes; cobalt default */
    --sm-primary: var(--theme-main, #0064e0);
    --sm-primary-deep: #0143b5;
    --sm-primary-soft: color-mix(in srgb, var(--sm-primary) 15%, transparent);
    --sm-focus: #0866ff;

    /* ink ramp (single blue-gray hue family) */
    --sm-ink-deep: light-dark(#0a1317, var(--dark-text-0, #fff));
    --sm-ink: light-dark(#1c2b33, var(--dark-text-1, #e8eaed));
    --sm-charcoal: light-dark(#344854, var(--dark-text-2, #aab0b7));
    --sm-slate: light-dark(#4e626f, var(--dark-text-2, #aab0b7));
    --sm-steel: light-dark(#68808f, var(--dark-text-3, #96a0af));
    --sm-stone: light-dark(#8fa1ac, var(--dark-gray-2, #8a8a8a));

    /* surfaces */
    --sm-canvas: light-dark(#fff, var(--dark-1, #202124));
    --sm-surface-soft: light-dark(#f1f4f7, var(--dark-2, #2e2f32));
    --sm-hairline: light-dark(#c9d1d9, var(--dark-3, #3e3f42));
    --sm-hairline-soft: light-dark(#e7ebef, var(--dark-2, #2e2f32));

    /* semantic (AA for white-on-fill except warning, which takes ink text) */
    --sm-success: #1c7c3c;
    --sm-attention: #b45309;
    --sm-warning: #ffd43b;
    --sm-critical: #c62828;
    --sm-critical-strong: #9f1d1d;

    /* elevation */
    --sm-shadow-1: 0 1px 1px rgba(0, 0, 0, .2);
    --sm-shadow-2: 0 1px 4px rgba(20, 22, 26, .3);

    /* spacing (4px base) */
    --sm-space-1: 4px;
    --sm-space-2: 8px;
    --sm-space-3: 12px;
    --sm-space-4: 16px;
    --sm-space-5: 20px;
    --sm-space-6: 24px;
    --sm-space-7: 32px;

    /* type — Open Sans via var(--normal-font) */
    --sm-type-title-size: 18px;
    --sm-type-title-weight: 600;
    --sm-type-title-line: 1.3;
    --sm-type-subtitle-size: 14px;
    --sm-type-subtitle-weight: 700;
    --sm-type-body-size: 13px;
    --sm-type-body-weight: 400;
    --sm-type-body-spacing: -0.1px;
    --sm-type-body-line: 1.5;
    --sm-type-button-size: 13px;
    --sm-type-button-weight: 600;
    --sm-type-caption-size: 11px;
    --sm-type-caption-line: 1.35
}
```

- [ ] **Step 2: Register in `manifest.json`.** In the FIRST `content_scripts` entry, insert `"src/styles/tokens.css"` into the `css` array immediately before `"src/styles/netsuite.css"` (index 2: after `font.css`, `code.css`).

- [ ] **Step 3: Update `tests/verify.mjs`.** Find the expected css list near lines 33-35 (contains `"src/styles/netsuite.css"`, `"src/styles/radii.css"`, `"src/styles/v3-compat.css"`) and insert `"src/styles/tokens.css"` in the same position as the manifest. Do NOT add it to `expectedStyleHashes` (only the historical 15 V1 files are pinned).

- [ ] **Step 4: Prove zero visual change.** Run `npm test` — it must end FULLY green including `fixtures:verify` at 0.000% on all 28 baselines, with NO `fixtures:update`. If any baseline moves, tokens.css is painting something — fix it (it may only define custom properties).

- [ ] **Step 5: §V.5 live sanity + §V.6 checkpoint.** Live: page renders identically, `getComputedStyle(document.documentElement).getPropertyValue("--sm-primary")` is non-empty in the console. Commit:

```bash
git add src/styles/tokens.css manifest.json tests/verify.mjs save/CHECKPOINTS.md
git commit -m "feat: UI-0 design token foundation (zero visual change)"
git push
```

---

### Task 2 (UI-1): Buttons, control bars, accent swap to cobalt

**Files:**
- Modify: `src/styles/netsuite.css` (theme defaults 48-59; Redwood buttons ~730-766; classic `.uir-button` block — locate in ~660-1070) + hash re-pin in `tests/verify.mjs:1875`
- Modify: `src/styles/radii.css:7` (pill 20px → 100px)
- Modify: `src/shared/settings.js:19` (`main: "#607799"` → `main: "#0064e0"`)
- Modify: `src/popup/popup.css` (4 accent literals at lines ~52, 54, 131, 151)
- Modify: `src/so-columns/so-columns.css` (26 `#607799` accent literals)

**Interfaces:**
- Consumes: `--sm-primary-deep`, `--sm-type-button-*` from Task 1; existing `--theme-main`, `--theme-main-dark`, `--suitemate-radius-pill`.
- Produces: cobalt as the default accent everywhere; pill button geometry other tasks must not flatten.

- [ ] **Step 1: Swap the on-page theme defaults.** In `netsuite.css` lines 49-50 replace the two `--theme-default-main*` values:

```css
    --theme-default-main: light-dark(#0064e0, color-mix(in srgb, #0064e0, #000 20%));
    --theme-default-main-light: light-dark(color-mix(in srgb, #0064e0, #fff 40%), #0064e0);
```

Leave all `--theme-default-secondary*` lines untouched (spec: secondary unchanged).

- [ ] **Step 2: Swap the JS default.** `src/shared/settings.js` line 19: `main: "#607799"` → `main: "#0064e0"`. Then `grep -rn "607799" tests/ src/` — remaining hits must only be: `tests/verify.mjs` materialShades lines (a generator sample input, NOT the default — leave), `tests/fixtures/route-fixture.css` var-fallbacks (leave), `tests/fixtures/theme-runtime.html` (leave). Any hit in `src/` outside popup.css/so-columns.css after Steps 3-4 is a miss.

- [ ] **Step 3: Popup accent literals.** In `popup.css` replace all four `#607799` occurrences with `#0064e0` (the popup gets full tokenization in Task 8; this keeps its accent consistent meanwhile).

- [ ] **Step 4: so-columns accent literals.** In `so-columns.css` replace all 26 `#607799` occurrences with `var(--theme-main, #0064e0)` (safe in both its light rules and `.isDarkMode` blocks — `var()` resolution is scheme-independent here because `--theme-main` itself carries the `light-dark()`).

- [ ] **Step 5: Pill geometry.** `radii.css` line 7: `--suitemate-radius-pill: 20px` → `--suitemate-radius-pill: 100px`. Consumers today: record-status pill (`radii.css:99-101`) — correct per design.md.

- [ ] **Step 6: Classic buttons.** Locate the classic button rules: `grep -n "uir-button\b" src/styles/netsuite.css | head -20`. Read that block, then: (a) set button corner rounding to `var(--suitemate-radius-pill)` on the block's main `:is(.uir-button, .uir-action-button …)` selector (replace any existing `border-radius` there — do not add a new competing rule); (b) in the same rule set `font-size: var(--sm-type-button-size); font-weight: var(--sm-type-button-weight); letter-spacing: var(--sm-type-body-spacing)`; (c) if the block paints gradient backgrounds, flatten primary buttons to `background: var(--theme-main)` with hover `var(--theme-main-dark)`, and secondary buttons to `background: var(--sm-canvas); border: 1px solid var(--sm-hairline); color: var(--sm-ink)` with hover `background: var(--sm-surface-soft)` — keep every `!important` that is already present, add none.

- [ ] **Step 7: Redwood buttons** (`netsuite.css` ~742-765). Replace the primary gradient trio with flat cobalt:

```css
html:not(.ext-f) .n-w-button:is(.style-standalone, .style-embedded).n-w-button--type-default.n-w-button--hierarchy-primary {
    border-color: var(--sm-primary-deep)
}

html:not(.ext-f) .n-w-button:is(.style-standalone, .style-embedded).n-w-button--type-default.n-w-button--hierarchy-primary:not(.n-widget--suspended) {
    background: var(--theme-main)
}

html:not(.ext-f) .n-w-button:is(.style-standalone, .style-embedded).n-w-button--type-default.n-w-button--hierarchy-primary:hover {
    background: var(--theme-main-dark)
}
```

and the secondary trio's gradient with `background: var(--sm-canvas)` / border `var(--sm-hairline)` / hover `background: var(--sm-surface-soft)`, keeping `color: #333` → `color: var(--sm-ink)`.

- [ ] **Step 8: Re-pin the netsuite.css hash** in `tests/verify.mjs:1875` with the output of `shasum -a 256 src/styles/netsuite.css`.

- [ ] **Step 9: Run §V.** Expected baseline changes: broadly ALL classic + redwood pages (the accent color moved) — that is in-scope for this task ONLY where the delta is accent hue, button shape, or button typography; any layout shift (element moved/resized beyond the button pills) is a defect. Live additions: buttons render as pills and remain clickable; tab bar shows cobalt; set a custom role color in the popup — the page accent follows it and so-columns controls match; revert to Default colors — cobalt returns (the new default). Commit message: `feat: UI-1 pill buttons and cobalt accent default`.

---

### Task 3 (UI-2): Summary/total boxes

**Files:**
- Modify: `src/styles/netsuite.css` (add a totals block near the existing `#totalRow` rules at ~2514) + hash re-pin

**Interfaces:**
- Consumes: `--sm-hairline-soft`, `--sm-canvas`, `--sm-charcoal`, `--sm-ink-deep`, `--sm-type-*`, `--sm-space-*`, `--suitemate-radius-surface`.

- [ ] **Step 1: Inspect the live totals DOM once** (view-mode SO 16302518, browser console): `document.querySelector(".totallingtable")?.outerHTML.slice(0, 800)` — confirm the container class and note the label/value cell classes. The rules below target `.totallingtable` and generic cells so they hold regardless; adjust only if the container class itself differs.

- [ ] **Step 2: Add the card treatment** (new block after the `#totalRow` rules):

```css
html:not(.ext-f) .totallingtable {
    background: var(--sm-canvas);
    border: 1px solid var(--sm-hairline-soft);
    border-radius: var(--suitemate-radius-surface);
    box-shadow: none;
    padding: var(--sm-space-2) var(--sm-space-4)
}

html:not(.ext-f) .totallingtable td {
    font-family: var(--normal-font);
    font-size: var(--sm-type-body-size);
    letter-spacing: var(--sm-type-body-spacing);
    color: var(--sm-charcoal);
    padding-block: 2px
}

html:not(.ext-f) .totallingtable tr:last-child td {
    font-size: var(--sm-type-subtitle-size);
    font-weight: var(--sm-type-subtitle-weight);
    color: var(--sm-ink-deep)
}
```

(The last-row emphasis assumes the grand total is the final row — verify against the Step 1 DOM and move the emphasis selector to the correct row hook if not.) Also restyle the list-page `#totalRow` cells (~2519) to `color: var(--sm-ink-deep); font-weight: var(--sm-type-subtitle-weight)` if they currently hardcode colors.

- [ ] **Step 3: Re-pin netsuite.css hash; run §V.** Expected baseline changes: transaction/record classic pages only. Live additions: totals box reads as a flat hairline card on SO + PO; dark mode legible; numbers align exactly as before (no layout shift — the card adds padding inside the existing table box only if it does not move neighbors; if it does, drop the padding line and keep border+radius only). Commit: `feat: UI-2 totals summary card treatment`.

---

### Task 4 (UI-3): Sublist tables + column-personalization UI

**Files:**
- Modify: `src/styles/netsuite.css` (table vars 72-88) + hash re-pin
- Modify: `src/styles/radii.css` (surface 5px → 12px; move inputs off `surface`)
- Modify: `src/so-columns/so-columns.css` (full tokenization)

**Interfaces:**
- Consumes: `--sm-hairline-soft`, `--sm-surface-soft`, `--sm-canvas`, `--sm-hairline`, `--sm-shadow-2`, `--sm-type-*`, `--suitemate-radius-{surface,overlay,control}`.
- Produces: `--suitemate-radius-surface` = 12px (Tasks 5+ inherit); inputs now round via `--suitemate-radius-control`.

- [ ] **Step 1: Table color vars.** `netsuite.css:72-79` (the `:not(.isRedwood)` block): `--table-border-color` light arm `#ebebeb` → `#e7ebef`; `--table-header-bg-color` light arm `#e5e5e5` → `#f1f4f7`. Keep the yellow `--row-hover-bg-color` exactly as is — the hover yellow is deep NetSuite muscle memory (spec Step 7: conservative wins). Leave the `.isRedwood` block untouched (it already delegates to Redwood tokens).

- [ ] **Step 2: Soften surfaces.** `radii.css:4`: `--suitemate-radius-surface: 5px` → `12px` (the spec's pre-approved conservative value; 16px was judged oversized for dense ERP chrome at plan time — record this choice in the checkpoint entry). Then split inputs off the surface token: in the input rule at `radii.css:63-72`, change `var(--suitemate-radius-surface)` to `var(--suitemate-radius-control)` so inputs stay tight (3px now, 8px after Task 6).

- [ ] **Step 3: Tokenize so-columns.css.** Substitutions (exact, current-value → token): `#c9d2dc` → `var(--sm-hairline)`; `#eef2f7` → `var(--sm-surface-soft)`; `#e2e7ee` → `var(--sm-hairline-soft)`; menu/controls `border-radius` literals of 8px → `var(--suitemate-radius-overlay, 8px)`; control-button font rules adopt `var(--sm-type-button-size)`/`weight`; menu shadow literal → `var(--sm-shadow-2)`. CONSTRAINT: inside the floating-menu rules (`[data-suitemate-v3-so-columns="menu"]` family) keep the existing literal-plus-`.isDarkMode`-override mechanism — do NOT introduce `light-dark()`-carrying tokens there (`--sm-canvas` etc. are banned in menu rules; the body-appended menu resolved `light-dark()` wrong before — Milestone 8 lesson). Align the menu's literals to the token VALUES instead (`#fff`, `#c9d1d9`, `#f1f4f7`, dark arms from the `--dark-*` ramp). `--theme-main` vars are fine in menu rules (already proven).

- [ ] **Step 4: Fixture pixel check for the menu** (the M8/M17 defect class): serve the repo (`python3 -m http.server 8931`), open the sales-order fixture, open a column menu, and assert `getComputedStyle(menu).backgroundColor` is opaque white in light and the dark value under `html.isDarkMode` — computed pixels, not CSSOM.

- [ ] **Step 5: Re-pin netsuite.css hash; run §V.** Expected baselines: every page with tables/tabs (surface radius moved). Live additions: sublist headers show the soft-cloud tint; sticky headers still stick on scroll; full so-columns smoke on SO 16302518 AND Item Fulfillment 14953684 (`uir-list-row-tr` family) AND PO 16295656; menu opens opaque in both schemes. Commit: `feat: UI-3 sublist surfaces and tokenized personalization UI`.

---

### Task 5 (UI-4): Cards, field groups, portlets

**Files:**
- Modify: `src/styles/v3-compat.css` (field-group chips 90-118)
- Modify: `src/styles/netsuite.css` (portlets ~5800-6300, alert boxes ~417-660) + hash re-pin

**Interfaces:**
- Consumes: `--sm-hairline-soft`, `--sm-surface-soft`, `--sm-canvas`, `--sm-type-subtitle-*`, `--suitemate-radius-surface`.

- [ ] **Step 1: Field-group chips** (`v3-compat.css:90-118`): keep the theme-driven chip colors (functionality), change only geometry/type: chip `div.fgroup_title` gets `font-size: var(--sm-type-subtitle-size); font-weight: var(--sm-type-subtitle-weight)` (replacing any font literals present) and the group underline `border-bottom: 2px solid var(--theme-secondary)` stays.

- [ ] **Step 2: Portlets/panes.** Locate with `grep -n "portlet\|setup-pane\|ns-portlet" src/styles/netsuite.css | head`. Read the block; apply the level-0 card recipe to the portlet container selectors found there: `border: 1px solid var(--sm-hairline-soft); border-radius: var(--suitemate-radius-surface); box-shadow: none; background: var(--sm-canvas)` — replacing existing border/shadow declarations in those same rules, adding no new selectors unless the container has none today.

- [ ] **Step 3: Alert boxes** (`.uir-alert-box`): `border: 1px solid var(--sm-hairline-soft)` and existing radius via `radii.css:95-97` (already `--suitemate-radius-dialog`) — value change comes in Task 7; here only swap any hardcoded border/background grays in the alert-box block for `--sm-hairline-soft`/`--sm-surface-soft`.

- [ ] **Step 4: Re-pin hash; run §V.** Expected baselines: record pages + dashboard. Live additions: field groups on SO render with chip typography; dashboard portlets show hairline cards; nothing moved. Commit: `feat: UI-4 card treatment for field groups and portlets`.

---

### Task 6 (UI-5): Dropdowns, menus, inputs geometry

**Files:**
- Modify: `src/styles/radii.css` (control 3px → 8px, compact 4px → 6px, overlay 8px → 16px)
- Modify: `src/styles/netsuite.css` (native selects 234-410, legacy `.ddm*`/`.dropdownDiv` 1330-1540, page-title menus ~1590-1659, button menus 767-790) + hash re-pin
- Modify: `src/record-actions/csv-import.css`

**Interfaces:**
- Consumes: `--sm-hairline`, `--sm-canvas`, `--sm-surface-soft`, `--sm-primary-soft`, `--sm-shadow-2`, `--sm-type-body-*`.
- Produces: overlay radius 16px — Task 4's menu fallback (`var(--suitemate-radius-overlay, 8px)`) picks this up automatically; toasts (Task 7) likewise.

- [ ] **Step 1: Radius retune.** `radii.css:2-5`: control `3px` → `8px`, compact `4px` → `6px`, overlay `8px` → `16px`. Blast radius to review in §V.3: inputs (control), popups/menus/ddm (overlay), toast close button (compact).
- [ ] **Step 2: Select/dropdown colors.** In the native-select block (234-410) swap hardcoded grays for tokens: field borders → `var(--sm-hairline)` (only where a literal gray sits today; leave `--field-border-color` var uses alone), menu/listbox backgrounds → `var(--sm-canvas)` equivalents ONLY where a literal exists; hovered option rows → `background: var(--sm-primary-soft)` where a literal hover gray exists today. Do not touch `::picker` structural rules.
- [ ] **Step 3: Menus.** Page-title `.ns-menu` and header button menus (`--menu-bg-color` at 768): `--menu-bg-color: light-dark(#fff, var(--dark-3))` and add `box-shadow: var(--sm-shadow-2)` to the same rules that already carry a shadow (replace the existing `0 0 2px 2px rgba(0,0,0,.2)` at ~773). `csv-import.css`: swap its literal borders/backgrounds for `var(--sm-hairline-soft)` / `var(--sm-canvas)` / hover `var(--sm-surface-soft)` (grep its hexes first; it is not hash-pinned).
- [ ] **Step 4: Re-pin hash; run §V.** Expected baselines: any page with inputs/menus. Live additions: open the page-title menu, the CSV Utils menu, a native select `::picker`, and the so-columns column menu — all 16px-rounded, shadow-2, opaque in both schemes; type into a filter search box (input rounding 8px, focus ring visible). Commit: `feat: UI-5 dropdown, menu and input geometry`.

---

### Task 7 (UI-6): Modals, dialogs, toasts

**Files:**
- Modify: `src/styles/radii.css` (dialog 10px → 24px)
- Modify: `src/styles/notifications.css` (semantic colors → tokens)
- Modify: `src/styles/netsuite.css` (`.ui-dialog` ~4560-5130, `nlpopup*` ~5240-5700) + hash re-pin

**Interfaces:**
- Consumes: `--sm-success`, `--sm-attention`, `--sm-critical`, `--sm-shadow-2`, `--sm-hairline-soft`, `--suitemate-radius-dialog`.

- [ ] **Step 1: Dialog radius.** `radii.css:6`: `10px` → `24px` (consumers: `.uir-alert-box`, `.n-w-window--modal`).
- [ ] **Step 2: Toast semantics.** In `notifications.css` replace: `#3b7d4f` (2×) → `var(--sm-success)`; `#a64f11` (2×) → `var(--sm-attention)`; `#a63232` (2×) → `var(--sm-critical)`; loading `#2763a5`/`#4f80b6` → `var(--theme-main, #0064e0)`; border `light-dark(#c9d2dc, var(--dark-2))` → `light-dark(#c9d1d9, var(--dark-2))`; `box-shadow: 0 8px 24px rgb(0 0 0 / .22)` → `var(--sm-shadow-2)`. Keep the pastel `light-dark()` background pairs as literals (they are tint variants no token covers). If the shadow-2 toast looks lost over busy pages live, restore the original shadow line and record the deviation in the checkpoint entry.
- [ ] **Step 3: NetSuite dialogs.** In the `.ui-dialog`/`nlpopup` blocks swap literal border grays → `var(--sm-hairline-soft)`, literal shadows → `var(--sm-shadow-2)`, title-bar font rules → `var(--sm-type-subtitle-size)`/`weight`. Geometry only — never `position`/`display`.
- [ ] **Step 4: Re-pin hash; run §V.** Expected baselines: toast fixtures (`toast-notification.png`, `toast-loading.png`) + dialog-bearing pages. Live additions: trigger a toast (run a CSV export on the SO — view-mode action, produces success toast), open a native popup (e.g. field help), both schemes. Commit: `feat: UI-6 dialog and toast treatment`.

---

### Task 8 (UI-7): Popup re-skin

**Files:**
- Modify: `src/popup/popup.html` (add `<link rel="stylesheet" href="../styles/tokens.css">` before `popup.css`)
- Modify: `src/popup/popup.css`

**Interfaces:**
- Consumes: every Task 1 token via their popup-safe fallbacks (`--theme-main` and `--dark-*` are undefined in the popup; `color-scheme: light` keeps `light-dark()` on light arms).

- [ ] **Step 1: Link tokens** in `popup.html` `<head>` before the existing `popup.css` link. Verify `tokens.css` rules apply: popup `<html>` has no `ext-f` class, so `html:not(.ext-f)` matches.
- [ ] **Step 2: Substitute the palette.** In `popup.css` (grep confirms current census): `#0064e0` (from Task 2; 4×) → `var(--sm-primary)`; `#344054` → `var(--sm-charcoal)`; `#475467` → `var(--sm-slate)`; `#667085` → `var(--sm-steel)`; `#b8c0cc` → `var(--sm-hairline)`; `#f7f9fc`/`#f8fbff` → `var(--sm-surface-soft)`; `#f4f6f8` (body) → `var(--sm-surface-soft)`; `#d92d20` → `var(--sm-critical)`; `#b42318` → `var(--sm-critical-strong)`; `#1570ef` → `var(--sm-focus)`; `#262626` body color → `var(--sm-ink)`. Leave `#fff` literals (canvas surfaces in a light-only page) and the color-picker plane gradients (they are the color-picking surface itself, not chrome).
- [ ] **Step 3: Geometry + type.** Buttons/CTAs → `border-radius: var(--suitemate-radius-pill, 100px)` with `--sm-type-button-*`; cards (tool card, role-colors card, backup `<details>`) → `border: 1px solid var(--sm-hairline-soft); border-radius: 16px`; the color-picker dialog → `border-radius: 24px; box-shadow: var(--sm-shadow-2)`; header title → `--sm-type-title-*`. `radii.css` is not linked in the popup, hence the literal fallbacks in the pill var and the literal 16/24px.
- [ ] **Step 4: Behavior regression.** Screenshot baselines do not cover the popup; instead verify by hand-run: open the popup, toggle each setting on/off (watch the page react), open the color picker, pick a color, Preview updates the page, Default colors restores cobalt, Export then Import a settings backup round-trips, Reset all works. `npm test` still fully green (popup tests are DOM-behavioral, not visual). All controls keyboard-reachable with visible focus.
- [ ] **Step 5: §V.6 checkpoint.** Commit: `feat: UI-7 popup re-skin on design tokens`.

---

### Task 9: Ponytail debt ledger + full-sweep verification

**Files:**
- Modify: `save/CHECKPOINTS.md` only

- [ ] **Step 1: Debt scan.** `grep -rnE '(#|//|/\*) ?ponytail:' src/` — append any new markers introduced by Tasks 1-8 to the ledger section of the final checkpoint entry (expected: none — CSS work should not need ceiling markers; the 4 existing core.js markers are unchanged).
- [ ] **Step 2: Full live sweep** (owner reloads first): SO 16302518, PO 16295656, IF 14953684, Invoice 16302113, plus one dashboard and one list page — light + dark + one custom role color; complete so-columns functional cycle on all three transaction types; toasts; popup round-trip. Zero console errors anywhere.
- [ ] **Step 3: Checkpoint entry** summarizing the whole layer; commit `docs: UI enhancement layer verification sweep`; push.

### Task 10: Release v3.19.0 (owner-gated)

- [ ] **Step 1: Confirm with the owner** that the sweep is accepted and they want the release cut now. Do not proceed without an explicit yes.
- [ ] **Step 2: Version bump.** `manifest.json` `"version": "3.18.1"` → `"3.19.0"`; `package.json` same; `tests/verify.mjs` pinned version string same (locate: `grep -n "3.18.1" tests/verify.mjs package.json manifest.json`). Run `npm test` — fully green.
- [ ] **Step 3: Commit `chore: prepare v3.19.0`, push, tag `v3.19.0`, `git push origin v3.19.0`, then `gh release create v3.19.0 --title "v3.19.0 — design.md UI Enhancement Layer" --notes` listing: token foundation, cobalt accent + pill buttons, totals cards, sublist surfaces + tokenized personalization UI, field-group/portlet cards, menu/input geometry, dialog/toast treatment, popup re-skin. Append the release checkpoint entry to `save/CHECKPOINTS.md` and push.

---

## Self-review (performed at write time)

- **Spec coverage:** §3 tokens → Task 1; §4.1 accent/default swap → Task 2; UI-2..7 → Tasks 3-8; §6 verification protocol → §V; §7.3 role-color proof → §V.5; spec's 12px-fallback pre-approval → Task 4 Step 2; hash-pin rule → Global Constraints + per-task steps. Release is Task 10 (beyond spec, owner-gated).
- **Placeholder scan:** every CSS step carries literal declarations or an exact substitution map; locate-then-edit steps name the grep and the target declarations.
- **Type consistency:** token names in Tasks 2-8 all appear in Task 1's produced list; radius token names match `radii.css` spellings; `--sm-type-*` grouped-property names used consistently.
