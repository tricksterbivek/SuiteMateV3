# Edit Mode Table Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship column resizing, hide/show, drag-and-drop reorder, personalization persistence, and page-scoped session-only filtering and sorting to the Sales Order `#item_splits` sublist machine in **Edit Mode** (`salesord.nl?id=…&e=…`), without changing one byte of View Mode behaviour.

**Architecture:** A parallel module family `src/edit-grid/{core,runtime}.js` + `edit-grid.css` that shares no code, no storage key and no CSS with `src/so-columns/`. Mode separation is a route gate: a new capability whose rule requires `hasParam(context, "e")` is the exact byte-complement of the two existing `!hasParam(context, "e")` rules. Persistence lives in its own `chrome.storage.sync` key `suiteMateV3EditColumns`, keyed by the internal column id decoded from `_fs` span ids — never by header label. Everything written into the machine is discarded on repaint, so re-apply is universal, idempotent and self-suppressing (stamp exclusion + identity early-return).

**Tech Stack:** Vanilla JS IIFEs (`Object.freeze` exports on `globalThis`), `node:test` + `node:vm` `runInNewContext` harness, `chrome.storage.sync`, MV3 content scripts, served-fixture browser verification (`python3 -m http.server 8931`), Claude in Chrome for live passes.

**Spec:** `docs/superpowers/specs/2026-08-02-edit-mode-table-enhancements-design.md` (approved, binding).
**Workflow/testing rules:** `docs/BUILD-BRIEF-edit-mode.md` (binding).
**Design input:** `docs/superpowers/research/2026-08-02-edit-mode/synthesis-and-approaches.md`, `…/sublist-machine-dossier.md`.

## Global Constraints

Every task's requirements implicitly include this section.

- **Repo** `/Users/Bivek.Shah/Documents/suitemate/suitematev3`. All work happens on branch **`feature/edit-mode-table-enhancements`** (created in Task 1). Never commit to `main`.
- **View Mode files are untouched** except four one-token additions, each appending `, [data-suitemate-v3-edit-grid]` to an existing selector string and changing nothing else: `src/so-columns/core.js:24`, `src/form-views/core.js:21`, `src/csv-export/core.js:211` (`VIEW_FOREIGN_NODE_SELECTOR`), `src/tab-title/core.js:5`. Mechanical enforcement: `git diff --name-only main | grep so-columns` returns **nothing** before Task 8 and **exactly `src/so-columns/core.js`** after it — never `src/so-columns/runtime.js`, never `tests/so-columns.test.mjs`.
- **`src/edit-grid/` imports nothing from `so-columns`.** The literal string `suiteMateV3ColumnOrder` must never appear anywhere under `src/edit-grid/` (asserted by the source-purity unit test).
- **New storage key only:** `suiteMateV3EditColumns`, container `{ schemaVersion: 1, grids: { [scopeKey]: { order?: string[], hidden?: string[], widths?: { [columnId]: number } } } }`. Sort and filter are **session-only and never persisted**; the container reserves no keys for them.
- **Scope key:** `` `${companyId}:${userId}:${type}:edit` `` from the `session_status_init.jsp` parse; fallback `` `${location.hostname}:${type}:edit` ``.
- **Capability rule requires `hasParam(context, "e")`.** Every existing `case` in `src/shared/routes.js` stays byte-identical; the new one is inserted after `:295`, before `RECORD_TYPE_BRIDGE`.
- **Settings flag `salesOrderColumnsEdit`, default `false`**, schema 5→6 with a pass-through migration. Lifecycle registration uses `startPaused: true`.
- **Caps, verbatim from spec §5:** ≤ **100** column ids per list; ≤ **200** characters per id; widths clamped to `[perColumnMin, 1000]` where `perColumnMin` is the widest widget `offsetWidth` in that column, never below the static floor `ABSOLUTE_MIN_COLUMN_WIDTH = 50` (`src/styles/netsuite.css:2999-3001` sizes machine inputs at `width: calc(100% - 21px)`, so a column under ~50 px leaves the widget unusable) and **never** the View Mode `MIN_COLUMN_WIDTH = 30`. `MAX_SYNC_ITEM_BYTES = 7800`, measured as `new TextEncoder().encode(STORAGE_KEY + JSON.stringify(next)).length`.
- **Fixture assertions are at computed style or bounding rect only** — never a class name, never the `hidden` attribute (`save/CHECKPOINTS.md:972` is the recorded cost).
- **Count storage writes, not DOM operations.** One gesture = exactly one write, then flat for 500 ms; seeded storage + reload = re-apply with **zero** writes.
- **Every hide/filter CSS rule carries `display: none !important`**, plus the `[data-suitemate-v3-edit-grid][hidden] { display: none !important }` guard.
- **Every injected button is `type="button"`** (safety-critical inside `main_form`). **No `innerHTML` anywhere** — nodes are built with `createElement` and stamped with `DATA_ATTRIBUTE` at creation.
- **Probe-before-reorder:** no reorder code is written before Gate A (M1 probe 8) is answered.
- **Cleanup is synchronous.** `src/shared/lifecycle.js:479-481` **throws** at `register()` if `cleanup` is declared `async`; `:188-195` only **reports** a `TypeError` if a non-`async` cleanup returns a thenable at runtime. So `removeEditGrid` must be a plain function that returns nothing — a promise-returning cleanup is silently reported, not rejected. **Delegated listeners only**, one per event type, on the container, under the `BOUND_ATTRIBUTE` guard — never on rows or cells.
- **No MAIN-world injection, no page-JS bridge, no service-worker or `src/shared/bridge.js` change.** `tests/verify.mjs:69-76` forbids declaring MAIN-world injection in the manifest.
- **The new fixture is NOT registered in `tests/fixtures/route-catalog.js`** — that is what keeps the baseline PNGs and the `tests/fixtures.test.mjs:101` count of 28 untouched.
- **`npm test` must end fully green at every checkpoint:** 213 + the new tests, **28 screenshot baselines at 0.000 %**. A moved baseline is a defect, never a baseline to refresh.
- **Version frozen at `3.21.1`** across `package.json:3`, `manifest.json:5`, `tests/verify.mjs:13` until the final owner-gated bump (Task 37).
- **Live testing:** record lock — account `6998262`, `id=16342809`, **and the same record with `&e=T` appended** (Q2), no other record or transaction. Safety triple before testing and before every save. Four-eyes save gate. Forbidden verbs. **No milestone in this plan requires a save.** `docs/testing-log.md` gains a line after every live session.
- **Sequential build.** Parallel agents are for research, review and verification only. The next milestone does not begin until the previous checkpoint has passed (`save/CHECKPOINTS.md:3`).
- **No `<`-bracketed placeholder may survive a commit.** Every document template in this plan (checkpoint entries, `docs/testing-log.md` lines, completion-doc cells, the Task 34A revert SHAs) carries `<…>` markers standing for observations that cannot exist before the step runs. Replace every one with the observed value before `git add`; a surviving `<…>` is a defect.
- **Commits:** conventional messages; author = the signed-in git user (`git config user.email`); **never** add a `Co-Authored-By: Claude` trailer.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `src/edit-grid/core.js` | `SuiteMateV3EditGridCore`. Frozen contract (version, storage key, every selector/class/attribute), the six-part storage doctrine, and every Edit-Mode-native DOM planner. Zero DOM-global, storage, bridge or network authority. |
| `src/edit-grid/runtime.js` | Top-frame check → capability gate → lifecycle registration → settings gate → idempotent `installEditGrid` / synchronous `removeEditGrid`. Owns scope resolution, the open-line state machine, the apply queue, delegated listeners, force-reveal rules and the serialized save queue. |
| `src/edit-grid/edit-grid.css` | Every rule scoped under `[data-suitemate-v3-edit-grid]` or this feature's own classes. All hide rules carry `!important`. |
| `tests/edit-grid.test.mjs` | vm-sandbox unit suite for `core.js`: frozen contract first, source purity last. |
| `tests/fixtures/sales-order-edit.html` | Self-loading Edit Mode fixture; `replaceState` to `salesord.nl?id=1&e=T`; realistic `#item_splits` markup with system `display:none` cells, `_fs` spans, a `machineButtonRow`, a totals row; a script emulating open-line / add-line / full-`<tbody>` repaint. |
| `docs/testing-log.md` | Created in M1's live pass; one line per live session thereafter. |
| `docs/superpowers/completion/2026-08-02-edit-mode-table-enhancements.md` | Final completion doc (Task 36). |

**Modified — the complete flagged list (every entry additive)**

| Path | Change |
|---|---|
| `src/shared/routes.js` | `+1` capability constant, `+1` `case`. Existing cases untouched. |
| `tests/routes.test.mjs` | `+1` positive/negative/mutual-exclusion test. |
| `src/shared/settings.js` | `SCHEMA_VERSION` 5→6, `salesOrderColumnsEdit: false` default, `=== true` normalization, `5 → 6` migration. |
| `src/shared/settings-transfer.js` | `+1` legacy-field row for schema 5. |
| `src/popup/popup.html`, `src/popup/popup.js` | New opt-in toggle "Sales Order columns (Edit Mode)". |
| `tests/settings.test.mjs`, `tests/settings-transfer.test.mjs`, `tests/verify.mjs` | New flag in every expected settings object; `schemaVersion: 6`. |
| `manifest.json` | `+1` css, `+2` js. |
| `tests/verify.mjs` | Manifest array mirrors; `+1` fixture in the link list; `+3` entries in `extensionSources`. |
| `package.json` | `+2` `node --check`, `+1` `--test tests/edit-grid.test.mjs`. |
| `tests/fixtures/chrome-stub.js` | `suiteMateV3EditColumns` get/set branch + `dataset.editGridWrites` counter + the `salesOrderColumnsEdit` settings seed. |
| Four `FOREIGN_NODE_SELECTOR` lists | One token each (Task 8). |
| `save/CHECKPOINTS.md` | One entry per milestone. |

---

# Milestone M1 — Shared Edit Mode foundation

Ten tasks. Ends with attachment and re-render survival proven, **Gate A answered**, and `docs/testing-log.md` in existence.

### Task 1: Feature branch and baseline capture

**Files:**
- No source changes.

**Interfaces:**
- Consumes: nothing.
- Produces: branch `feature/edit-mode-table-enhancements`; the recorded baseline numbers every later task compares against.

- [ ] **Step 1: Confirm a clean tree on `main`**

```bash
cd /Users/Bivek.Shah/Documents/suitemate/suitematev3
git status --short && git rev-parse --abbrev-ref HEAD
```

Expected: the only untracked entry is `docs/BUILD-BRIEF-edit-mode.md` (or nothing), and the branch is `main`. If anything else is dirty, stop and report.

- [ ] **Step 2: Create and switch to the feature branch**

```bash
git checkout -b feature/edit-mode-table-enhancements
git rev-parse --abbrev-ref HEAD
```

Expected: `feature/edit-mode-table-enhancements`.

- [ ] **Step 3: Capture the baseline test numbers**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
npm run fixtures:verify 2>&1 | tail -5
```

Expected: `ℹ tests 213`, `ℹ pass 213`, `ℹ fail 0`; `fixtures:verify` reports 28 baselines at `0.000%`. Record these two numbers — every later checkpoint states `213 + n`. If the local baseline differs from 213, use the observed number as the baseline; **all-green plus 28 baselines at 0.000 % is the bar**.

- [ ] **Step 4: Confirm the View Mode diff guard reads empty**

```bash
git diff --name-only main | grep so-columns; echo "exit=$?"
```

Expected: no output, `exit=1` (grep found nothing). This exact command is re-run in every milestone's View Mode regression step.

### Task 2: Route capability `TRANSACTION_COLUMN_PERSONALIZATION_EDIT`

**Files:**
- Modify: `src/shared/routes.js` (CAPABILITIES block `:4-21`; new `case` inserted after `:295`, before `case CAPABILITIES.RECORD_TYPE_BRIDGE:` at `:296`)
- Test: `tests/routes.test.mjs` (append after the `limits form views to top-frame Sales Order view mode` test)

**Interfaces:**
- Consumes: existing `hasParam(context, name)`, `PATHS.SALES_ORDER`, `context.isTopFrame`, `context.path`.
- Produces: `routes.CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT === "transaction-column-personalization-edit"`, consumed by `src/edit-grid/runtime.js` (Task 6) as the `capability` of its lifecycle registration and its pre-registration gate.

- [ ] **Step 1: Write the failing test** — append to `tests/routes.test.mjs`:

```js
test("limits edit-mode transaction column personalization to top-frame Sales Order edit URLs", () => {
  for (const path of [
    "/app/accounting/transactions/salesord.nl?id=1&e=T",
    "/app/accounting/transactions/salesord.nl?id=1&e=F",
    "/app/accounting/transactions/salesord.nl?id=16342809&e=T&whence="
  ]) {
    assert.equal(
      routes.supports(CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT, page(path)),
      true,
      path
    );
  }

  for (const path of [
    "/app/accounting/transactions/salesord.nl?id=1",
    "/app/accounting/transactions/salesord.nl?e=T",
    "/app/accounting/transactions/salesord.nl",
    "/app/accounting/transactions/custinvc.nl?id=7&e=T",
    "/app/accounting/transactions/purchord.nl?id=12&e=T",
    "/app/accounting/transactions/itemship.nl?id=99&e=T",
    "/app/common/entity/custjob.nl?id=5&e=T",
    "/app/accounting/transactions/transactionlist.nl"
  ]) {
    assert.equal(
      routes.supports(CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT, page(path)),
      false,
      path
    );
  }

  assert.equal(
    routes.supports(
      CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT,
      page("/app/accounting/transactions/salesord.nl?id=1&e=T", { isTopFrame: false })
    ),
    false
  );
  assert.equal(
    routes.supports(
      CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT,
      routes.createPageContext("https://example.com/app/accounting/transactions/salesord.nl?id=1&e=T")
    ),
    false
  );

  // Spec H3: the edit rule is the exact complement of the two view-mode rules,
  // so no URL can ever satisfy both. This is the whole mode-separation proof.
  for (const path of [
    "/app/accounting/transactions/salesord.nl?id=1",
    "/app/accounting/transactions/salesord.nl?id=1&e=T",
    "/app/accounting/transactions/salesord.nl?id=1&e=F"
  ]) {
    const context = page(path);
    assert.equal(
      routes.supports(CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION, context)
        && routes.supports(CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT, context),
      false,
      path
    );
    assert.equal(
      routes.supports(CAPABILITIES.FORM_VIEWS, context)
        && routes.supports(CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT, context),
      false,
      path
    );
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test tests/routes.test.mjs 2>&1 | grep -E "not ok|ℹ fail"
```

Expected: FAIL — the new test asserts `true` but gets `false` (the capability constant is `undefined`, so `supports()` hits `default: return false`).

- [ ] **Step 3: Add the capability constant** — in `src/shared/routes.js`, change the last line of the `CAPABILITIES` block (`:20`) from `FORM_VIEWS: "form-views"` to:

```js
    FORM_VIEWS: "form-views",
    TRANSACTION_COLUMN_PERSONALIZATION_EDIT: "transaction-column-personalization-edit"
```

- [ ] **Step 4: Add the `case`** — insert directly after the `FORM_VIEWS` case's closing `&& !hasParam(context, "e");` (`:295`) and before `case CAPABILITIES.RECORD_TYPE_BRIDGE:`:

```js
      case CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT:
        // Sales Orders only for this phase; generalize by widening this rule.
        // hasParam("e") — not e === "T" — makes this the exact byte-complement
        // of the two !hasParam(context, "e") rules above, so the modes are
        // mutually exclusive by construction. A non-editable ?e=F page reaches
        // the runtime and then fails closed at install.
        return context.isTopFrame
          && Boolean(context.path)
          && context.path.toLowerCase() === PATHS.SALES_ORDER
          && hasParam(context, "id")
          && hasParam(context, "e");
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 214`, `ℹ pass 214`, `ℹ fail 0`; `fixtures:verify` at 0.000 %.

- [ ] **Step 6: Confirm the existing negatives were not edited**

```bash
git diff -U0 src/shared/routes.js | grep "^-" | grep -v "^---"
```

Expected: exactly one removed line — the old `FORM_VIEWS: "form-views"` line (replaced by the two-line version). No other deletions. If `TRANSACTION_COLUMN_PERSONALIZATION` or `FORM_VIEWS` case bodies appear, revert and redo.

- [ ] **Step 7: Commit**

```bash
git add src/shared/routes.js tests/routes.test.mjs
git commit -m "feat: add edit-mode transaction column personalization capability"
```

### Task 3: Settings schema 5→6 with the `salesOrderColumnsEdit` flag

**Files:**
- Modify: `src/shared/settings.js` (`SCHEMA_VERSION` `:9`; `DEFAULTS` `:29-39`; `normalizeCurrent` `:123-136`; `MIGRATIONS` `:138-174`)
- Modify: `src/shared/settings-transfer.js` (`legacySchemaFields` table `:115-120`)
- Modify: `src/popup/popup.html` (new toggle row after the `formViews` row at `:75-81`)
- Modify: `src/popup/popup.js` (`:19-21` element lookups, `render()` at `:407-434` — the two insertion lines are `:416` and `:425` — and `readAppearance()` at `:436-446`)
- Test: `tests/settings.test.mjs`, `tests/settings-transfer.test.mjs`, `tests/verify.mjs` (`:945-964`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `settingsApi.SCHEMA_VERSION === 6`; `settingsApi.DEFAULTS.salesOrderColumnsEdit === false`; `settingsApi.normalize(v).salesOrderColumnsEdit` is a strict boolean. `src/edit-grid/runtime.js` (Task 6) reads exactly this field name.

- [ ] **Step 1: Write the failing tests.** In `tests/settings.test.mjs`, add `salesOrderColumnsEdit: false` immediately after every existing `formViews: false` line (7 sites: `:103`, `:137`, `:152`, `:162`, `:190`, `:228`, `:280`), change every `schemaVersion: 5` in an expected object to `6`, and append this migration test at the end of the file:

```js
test("migrates schema 5 to 6 by adding the edit-mode grid flag", () => {
  const api = createApi();
  const v5 = {
    schemaVersion: 5,
    enabled: true,
    mode: "dark",
    squareCorners: false,
    showInternalIds: true,
    salesOrderColumns: true,
    smartTabTitles: false,
    formViews: true,
    roleThemes: {}
  };
  const migrated = api.migrate(v5);
  assert.equal(migrated.schemaVersion, 6);
  assert.equal(migrated.salesOrderColumnsEdit, false);
  assert.equal(migrated.salesOrderColumns, true);
  assert.equal(migrated.formViews, true);
  assert.equal(api.normalize({ salesOrderColumnsEdit: "yes" }).salesOrderColumnsEdit, false);
  assert.equal(api.normalize({ salesOrderColumnsEdit: true }).salesOrderColumnsEdit, true);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test tests/settings.test.mjs 2>&1 | grep -E "not ok|ℹ fail"
```

Expected: FAIL — `migrated.schemaVersion` is `5`, `salesOrderColumnsEdit` is `undefined`.

- [ ] **Step 3: Bump the schema in `src/shared/settings.js`.** (a) `:9` → `const SCHEMA_VERSION = 6;`. (b) In `DEFAULTS` (`:29-39`), add after `formViews: false,`:

```js
    salesOrderColumnsEdit: false,
```

(c) In `normalizeCurrent` (`:123-136`), add after `formViews: candidate.formViews === true,`:

```js
      salesOrderColumnsEdit: candidate.salesOrderColumnsEdit === true,
```

(d) In `MIGRATIONS` (`:138-174`), add after the `4(value)` migration:

```js
    5(value) {
      return {
        ...value,
        schemaVersion: 6,
        salesOrderColumnsEdit: value.salesOrderColumnsEdit === true
      };
    }
```

- [ ] **Step 4: Extend the transfer validator.** In `src/shared/settings-transfer.js`, add this row to `legacySchemaFields` after the `4:` row:

```js
      5: ["enabled", "mode", "squareCorners", "showInternalIds", "salesOrderColumns", "smartTabTitles", "formViews", "roleThemes"]
```

- [ ] **Step 5: Add the popup toggle.** In `src/popup/popup.html`, insert after the `formViews` toggle row (closing `</label>` at `:81`):

```html
        <label class="toggle-row" for="salesOrderColumnsEdit">
          <span>
            <strong>Sales Order columns (Edit Mode)</strong>
            <small>Resize, hide, reorder and filter the item sublist while editing</small>
          </span>
          <input id="salesOrderColumnsEdit" name="salesOrderColumnsEdit" type="checkbox">
        </label>
```

In `src/popup/popup.js`: (a) after `const formViewsInput = document.querySelector("#formViews");` (`:21`) add

```js
  const salesOrderColumnsEditInput = document.querySelector("#salesOrderColumnsEdit");
```

(b) in `render()` after `formViewsInput.checked = currentSettings.formViews;` add

```js
    salesOrderColumnsEditInput.checked = currentSettings.salesOrderColumnsEdit;
```

(c) in `render()` after `formViewsInput.disabled = settingsLocked || settingsTransferBusy;` add

```js
    salesOrderColumnsEditInput.disabled = settingsLocked || settingsTransferBusy;
```

(d) in `readAppearance()` change `formViews: formViewsInput.checked` to

```js
      formViews: formViewsInput.checked,
      salesOrderColumnsEdit: salesOrderColumnsEditInput.checked
```

- [ ] **Step 6: Update the remaining expectations.** In `tests/verify.mjs`: `:945` → `assert.equal(settingsApi.SCHEMA_VERSION, 6);`; after `:951` add `assert.equal(settingsApi.DEFAULTS.salesOrderColumnsEdit, false);`; in the `validateForStorage` deepEqual object (`:953-965`) change `schemaVersion: 5` → `6` and add `salesOrderColumnsEdit: false,` after `formViews: false,`. In `tests/settings-transfer.test.mjs`, add `salesOrderColumnsEdit: false` after every `formViews: false` in an expected settings object and change every expected `schemaVersion: 5` in a *current-schema* assertion to `6` (leave hand-built legacy v3/v4/v5 envelopes at their declared versions — they are inputs, not expectations).

- [ ] **Step 7: Run the full suite**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 215`, `ℹ pass 215`, `ℹ fail 0`; 28 baselines at 0.000 %. If `settings-transfer` fails with `NON_CANONICAL_BACKUP_SETTINGS`, the schema-5 legacy row in Step 4 is missing or misspelled.

- [ ] **Step 8: Commit**

```bash
git add src/shared/settings.js src/shared/settings-transfer.js src/popup/popup.html src/popup/popup.js tests/settings.test.mjs tests/settings-transfer.test.mjs tests/verify.mjs
git commit -m "feat: settings schema 6 with the default-off Edit Mode grid toggle"
```

### Task 4: Chrome storage stub — new key, write counter, settings seed

**Files:**
- Modify: `tests/fixtures/chrome-stub.js` (settings seed `:10-17`; module state `:18-19`; `get` `:208-216`; `set` `:217-251`; `SuiteMateV3Fixture` `:311-333`)

**Interfaces:**
- Consumes: nothing.
- Produces: `chrome.storage.sync` serves and stores `suiteMateV3EditColumns`; `document.documentElement.dataset.editGridWrites` counts writes to that key; `SuiteMateV3Fixture.editColumns` exposes the stored container; the fixture URL param `?salesOrderColumnsEdit=true` seeds the settings flag. Task 7's fixture and every later fixture round-trip depend on all four.

- [ ] **Step 1: Seed the new settings flag.** In the `settings` initializer (`:10-17`), add after `formViews: params.get("formViews") === "true"`:

```js
    salesOrderColumnsEdit: params.get("salesOrderColumnsEdit") === "true"
```

(add a comma to the preceding line).

- [ ] **Step 2: Add module state.** Beside `let formViews;` (`:19`) add:

```js
  let editColumns;
```

- [ ] **Step 3: Serve the key.** In `storage.sync.get` (`:208-216`), add before the final `return`:

```js
          if (key === "suiteMateV3EditColumns") {
            return { [key]: editColumns };
          }
```

- [ ] **Step 4: Store the key and count the write.** In `storage.sync.set`, add a branch mirroring the `suiteMateV3FormViews` branch, before the `suiteMateV3ColumnOrder` branch:

```js
          if (key === "suiteMateV3EditColumns") {
            const previousEditColumns = editColumns;
            editColumns = nextSettings;
            document.documentElement.dataset.editGridWrites = String(
              Number(document.documentElement.dataset.editGridWrites ?? 0) + 1
            );
            for (const listener of listeners) {
              listener({ [key]: { oldValue: previousEditColumns, newValue: editColumns } }, "sync");
            }
            return;
          }
```

- [ ] **Step 5: Expose it to the fixture harness.** In the `SuiteMateV3Fixture` object, after the `formViews` getter:

```js
    get editColumns() {
      return editColumns;
    },
```

- [ ] **Step 6: Verify syntax and the suite**

```bash
node --check tests/fixtures/chrome-stub.js && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: no syntax error; `ℹ tests 215`, `ℹ pass 215`, `ℹ fail 0`; baselines at 0.000 % (the stub is fixture-only and the seed defaults to `false`, so no captured page changes).

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/chrome-stub.js
git commit -m "test: chrome stub serves the edit-grid storage key with a write counter"
```

### Task 5: `src/edit-grid/core.js` — frozen contract, storage doctrine, Edit-Mode identity

**Files:**
- Create: `src/edit-grid/core.js`
- Create: `tests/edit-grid.test.mjs`
- Modify: `package.json:10` (`node --check` for the new core; `tests/edit-grid.test.mjs` in the `--test` list)

**Interfaces:**
- Consumes: `TextEncoder` (the only sandbox global, exactly as `tests/so-columns.test.mjs:11-16` injects it).
- Produces — the names every later task uses:
  - Constants: `VERSION = 1`, `STORAGE_KEY = "suiteMateV3EditColumns"`, `STORAGE_SCHEMA_VERSION = 1`, `MAX_SYNC_ITEM_BYTES = 7800`, `MAX_COLUMN_ID_LENGTH = 200`, `MAX_COLUMN_IDS = 100`, `ABSOLUTE_MIN_COLUMN_WIDTH = 50`, `MAX_COLUMN_WIDTH = 1000`, `MACHINE_TABLE_SELECTOR = "#item_splits"`, `MACHINE_CONTAINER_SELECTOR = ".uir-machine-table-container"`, `HEADER_ROW_SELECTOR = "tr.uir-machine-headerrow"`, `DATA_ROW_SELECTOR = "tr.uir-machine-row"`, `FOCUSED_ROW_SELECTOR`, `EXCLUDED_ROW_SELECTOR`, `COLUMN_SPAN_SELECTOR = 'span[id$="_fs"]'`, `DATA_ATTRIBUTE`, `NATIVE_ROW_ATTRIBUTE`, `BOUND_ATTRIBUTE`, `FOREIGN_NODE_SELECTOR`, `CLASSES`.
  - Widths: `clampWidth(value, minimum)`.
  - Storage: `normalizeStored(value)`, `refusesNewerSchema(stored)`, `withOrder(stored, key, ids|null)`, `withHidden(stored, key, ids|null)`, `withWidths(stored, key, widths|null)`.
  - DOM: `machineIdFromTable(table)`, `rowLineNumber(row, machineId)`, `columnIdFromSpanId(spanId, machineId, line)`, `visibleCells(row)`, `tableRows(table)`, `headerRow(table)`, `isExcludedRow(row)`, `alignsToHeader(row, columnIds)`, `isDataRow(row, columnIds)`, `readColumnIds(table)`, `isOrderedMachine(table)`.

- [ ] **Step 1: Write the failing unit tests** — create `tests/edit-grid.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "src/edit-grid/core.js"), "utf8");

function createApi() {
  const sandbox = { TextEncoder };
  sandbox.globalThis = sandbox;
  runInNewContext(source, sandbox);
  return sandbox.SuiteMateV3EditGridCore;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// ===== Edit-Mode DOM stub =====
// Rows carry extra system cells with inline display:none, _fs spans, an
// item_row_N id, a machineButtonRow and a totals row — the shapes that make
// every View Mode row predicate match zero rows (spec H1).
function createCell({ text = "", spanId = null, systemHidden = false, width = 100 } = {}) {
  const classes = new Set();
  return {
    textContent: text,
    style: { display: systemHidden ? "none" : "", width: "" },
    offsetWidth: width,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const on = force ?? !classes.has(name);
        if (on) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        return on;
      }
    },
    getBoundingClientRect: () => ({ width }),
    querySelector: (selector) => (spanId && selector.includes("_fs") ? { id: spanId } : null)
  };
}

function classMatcher(className) {
  const names = String(className).split(/\s+/).filter(Boolean);
  return (selector) => String(selector)
    .split(",")
    .some((part) => names.includes(part.trim().replace(/^(?:tr|td|table)?\./, "")));
}

function createRow({ id = "", className = "uir-machine-row", cells = [] } = {}) {
  const row = {
    id,
    className,
    cells,
    matches: classMatcher(className),
    getAttribute: (name) => row.attributes?.[name] ?? null,
    setAttribute: (name, value) => {
      row.attributes = { ...(row.attributes ?? {}), [name]: String(value) };
    },
    insertBefore(node, reference) {
      const from = row.cells.indexOf(node);
      if (from >= 0) {
        row.cells.splice(from, 1);
      }
      const at = reference ? row.cells.indexOf(reference) : -1;
      row.cells.splice(at < 0 ? row.cells.length : at, 0, node);
      return node;
    }
  };
  return row;
}

function createTable(rows, { id = "item_splits", className = "uir-machine-table" } = {}) {
  return {
    id,
    className,
    rows,
    style: { tableLayout: "", width: "" },
    matches: classMatcher(className),
    closest: () => null,
    querySelector: (selector) => rows.find((row) => row.matches(selector)) ?? null,
    querySelectorAll: () => []
  };
}

// Three data columns (item, quantity, rate) plus one NetSuite system cell that
// carries inline display:none — the extra <td> that breaks View Mode.
function createMachine({ lines = 2, className } = {}) {
  const header = createRow({
    className: "uir-machine-headerrow",
    cells: [
      createCell({ text: "Item" }),
      createCell({ text: "Quantity" }),
      createCell({ text: "Rate" }),
      createCell({ text: "", systemHidden: true })
    ]
  });
  const dataRows = Array.from({ length: lines }, (_, index) => {
    const line = index + 1;
    return createRow({
      id: `item_row_${line}`,
      className: "uir-machine-row",
      cells: [
        createCell({ text: `SKU-100${line}`, spanId: `item_item${line}_fs` }),
        createCell({ text: String(line * 2), spanId: `item_quantity${line}_fs` }),
        createCell({ text: `$1${line}.00`, spanId: `item_rate${line}_fs` }),
        createCell({ text: "sys", spanId: `item_sys${line}_fs`, systemHidden: true })
      ]
    });
  });
  const buttonRow = createRow({ className: "machineButtonRow", cells: [createCell({ text: "OK Cancel" })] });
  const totalsRow = createRow({ className: "totalrow", cells: [createCell({ text: "Total" })] });
  return createTable([header, ...dataRows, buttonRow, totalsRow], className ? { className } : {});
}

test("exports a frozen core with the Edit Mode storage and DOM contract", () => {
  const core = createApi();
  assert.equal(core.VERSION, 1);
  assert.equal(Object.isFrozen(core), true);
  assert.equal(core.STORAGE_KEY, "suiteMateV3EditColumns");
  assert.equal(core.STORAGE_SCHEMA_VERSION, 1);
  assert.equal(core.MAX_SYNC_ITEM_BYTES, 7800);
  assert.equal(core.MAX_COLUMN_ID_LENGTH, 200);
  assert.equal(core.MAX_COLUMN_IDS, 100);
  assert.equal(core.ABSOLUTE_MIN_COLUMN_WIDTH, 50);
  assert.equal(core.MAX_COLUMN_WIDTH, 1000);
  assert.equal(core.MACHINE_TABLE_SELECTOR, "#item_splits");
  assert.equal(core.MACHINE_CONTAINER_SELECTOR, ".uir-machine-table-container");
  assert.equal(core.HEADER_ROW_SELECTOR, "tr.uir-machine-headerrow");
  assert.equal(core.DATA_ROW_SELECTOR, "tr.uir-machine-row");
  assert.equal(core.COLUMN_SPAN_SELECTOR, 'span[id$="_fs"]');
  assert.equal(core.DATA_ATTRIBUTE, "data-suitemate-v3-edit-grid");
  assert.equal(core.NATIVE_ROW_ATTRIBUTE, "data-suitemate-v3-edit-grid-native-row");
  assert.equal(core.BOUND_ATTRIBUTE, "data-suitemate-v3-edit-grid-bound");
  assert.equal(core.CLASSES.colHidden, "suitemate-v3-edit-grid-col-hidden");
  assert.equal(core.CLASSES.rowFiltered, "suitemate-v3-edit-grid-row-filtered");
  assert.equal(Object.isFrozen(core.CLASSES), true);
});

test("decodes column ids from _fs spans against the row's own line number", () => {
  const core = createApi();
  assert.equal(core.machineIdFromTable(createMachine()), "item");
  assert.equal(core.columnIdFromSpanId("item_quantity1_fs", "item", 1), "quantity");
  // Line 21 must not be mistaken for line 1 — the ambiguity that makes a naive
  // span[id$="1_fs"] scan decode "quantity2" on a paged machine.
  assert.equal(core.columnIdFromSpanId("item_quantity21_fs", "item", 21), "quantity");
  assert.equal(core.columnIdFromSpanId("item_quantity21_fs", "item", 1), null);
  assert.equal(core.columnIdFromSpanId("item_custcol_abc21_fs", "item", 1), "custcol_abc2");
  assert.equal(core.columnIdFromSpanId("item_item1_fs_lbl", "item", 1), null);
  assert.equal(core.columnIdFromSpanId(null, "item", 1), null);
  assert.equal(core.columnIdFromSpanId(`item_${"x".repeat(201)}1_fs`, "item", 1), null);
  assert.equal(core.rowLineNumber(createMachine().rows[1], "item"), 1);
  assert.equal(core.rowLineNumber(createMachine().rows[2], "item"), 2);
});

test("reads the column axis from visible cells only and ignores excluded rows", () => {
  const core = createApi();
  const table = createMachine();
  assert.deepEqual(plain(core.readColumnIds(table)), ["item", "quantity", "rate"]);
  assert.equal(core.visibleCells(table.rows[1]).length, 3);
  assert.equal(core.alignsToHeader(table.rows[1], ["item", "quantity", "rate"]), true);
  assert.equal(core.isDataRow(table.rows[1], ["item", "quantity", "rate"]), true);
  // machineButtonRow and the totals row are never data rows, never counted.
  assert.equal(core.isExcludedRow(table.rows[3]), true);
  assert.equal(core.isExcludedRow(table.rows[4]), true);
  assert.equal(core.isDataRow(table.rows[3], ["item", "quantity", "rate"]), false);
  assert.equal(core.isDataRow(table.rows[4], ["item", "quantity", "rate"]), false);
  assert.equal(core.isDataRow(table.rows[0], ["item", "quantity", "rate"]), false);
  assert.deepEqual(plain(core.readColumnIds(createTable([]))), []);
});

test("refuses ordered machines, failing closed on anything unreadable", () => {
  const core = createApi();
  assert.equal(core.isOrderedMachine(createMachine()), false);
  assert.equal(core.isOrderedMachine(createMachine({ className: "uir-machine-table uir-draggable-table" })), true);
  assert.equal(core.isOrderedMachine(null), true);
});

test("normalizes the stored container fail-closed and refuses a newer schema", () => {
  const core = createApi();
  assert.deepEqual(plain(core.normalizeStored(undefined)), { schemaVersion: 1, grids: {} });
  assert.deepEqual(plain(core.normalizeStored({ schemaVersion: 1, grids: "nope" })), { schemaVersion: 1, grids: {} });
  assert.deepEqual(
    plain(core.normalizeStored({ schemaVersion: 1, grids: { "1:2:salesord:edit": { order: ["item", "rate"] } } })),
    { schemaVersion: 1, grids: { "1:2:salesord:edit": { order: ["item", "rate"] } } }
  );
  assert.deepEqual(plain(core.normalizeStored({ schemaVersion: 2, grids: { a: { order: ["x"] } } }).grids), {});
  assert.equal(core.refusesNewerSchema({ schemaVersion: 2, grids: {} }), true);
  assert.equal(core.refusesNewerSchema({ schemaVersion: 1, grids: {} }), false);
  assert.equal(core.withOrder({ schemaVersion: 2, grids: {} }, "1:2:salesord:edit", ["item"]), null);
  // Hostile input: prototype keys are refused as scope keys and as column ids.
  assert.equal(core.withOrder(undefined, "__proto__", ["item"]), null);
  assert.equal(core.withOrder(undefined, "1:2:salesord:edit", ["__proto__", "item"]), null);
  assert.equal(core.withOrder(undefined, "1:2:salesord:edit", [`${"x".repeat(201)}`]), null);
  assert.equal(core.withOrder(undefined, "1:2:salesord:edit", Array.from({ length: 101 }, (_, i) => `c${i}`)), null);
});

test("writers merge, delete empty entries and evict over quota", () => {
  const core = createApi();
  const key = "1:2:salesord:edit";
  const ordered = core.withOrder(undefined, key, ["rate", "item", "quantity"]);
  assert.deepEqual(plain(ordered), {
    schemaVersion: 1,
    grids: { [key]: { order: ["rate", "item", "quantity"] } }
  });
  const hidden = core.withHidden(ordered, key, ["quantity"]);
  assert.deepEqual(plain(hidden.grids[key]), { order: ["rate", "item", "quantity"], hidden: ["quantity"] });
  const sized = core.withWidths(hidden, key, { item: 240, quantity: 12, rate: 5000 });
  assert.deepEqual(plain(sized.grids[key].widths), { item: 240, quantity: 50, rate: 1000 });
  const clearedHidden = core.withHidden(sized, key, null);
  assert.equal("hidden" in plain(clearedHidden.grids[key]), false);
  let emptied = core.withOrder(clearedHidden, key, null);
  emptied = core.withWidths(emptied, key, null);
  assert.deepEqual(plain(emptied.grids), {});
  // Quota: eviction is scoped to grids and keeps only the entry being written.
  const fat = { schemaVersion: 1, grids: {} };
  for (let index = 0; index < 20; index += 1) {
    fat.grids[`scope${index}`] = { order: Array.from({ length: 100 }, (_, i) => `column_${i}_padding`) };
  }
  const evicted = core.withOrder(fat, "scope0", ["item", "rate"]);
  assert.deepEqual(Object.keys(plain(evicted.grids)), ["scope0"]);
});

test("core has no DOM, storage, bridge or network authority", () => {
  assert.doesNotMatch(source, /document\.|chrome\.|fetch\(|XMLHttpRequest|innerHTML|localStorage|sessionStorage/);
  assert.doesNotMatch(source, /suiteMateV3ColumnOrder/);
  assert.doesNotMatch(source, /SuiteMateV3SoColumnsCore/);
});
```

- [ ] **Step 2: Register the suite and the syntax gate.** In `package.json:10`, add `&& node --check src/edit-grid/core.js` immediately after the `src/form-views/core.js` check, and add `tests/edit-grid.test.mjs` at the end of the `node --test` file list (after `tests/form-views.test.mjs`).

- [ ] **Step 3: Run it to verify it fails**

```bash
node --test tests/edit-grid.test.mjs 2>&1 | tail -5
```

Expected: FAIL — `ENOENT: no such file or directory, open '…/src/edit-grid/core.js'`.

- [ ] **Step 4: Write `src/edit-grid/core.js`**

```js
(function defineSuiteMateV3EditGridCore(globalScope) {
  "use strict";

  const VERSION = 1;
  const STORAGE_KEY = "suiteMateV3EditColumns";
  const STORAGE_SCHEMA_VERSION = 1;
  const MAX_SYNC_ITEM_BYTES = 7800;
  const MAX_COLUMN_ID_LENGTH = 200;
  const MAX_COLUMN_IDS = 100;
  const ABSOLUTE_MIN_COLUMN_WIDTH = 50;
  const MAX_COLUMN_WIDTH = 1000;

  const MACHINE_TABLE_SELECTOR = "#item_splits";
  const MACHINE_CONTAINER_SELECTOR = ".uir-machine-table-container";
  const HEADER_ROW_SELECTOR = "tr.uir-machine-headerrow";
  const DATA_ROW_SELECTOR = "tr.uir-machine-row";
  const FOCUSED_ROW_SELECTOR = "tr.uir-machine-row-focused, tr.listfocusedrow";
  const EXCLUDED_ROW_SELECTOR =
    "tr.machineButtonRow, tr.totalrow, tr.uir-machine-loading-row, tr.uir-machine-nodata-row";
  const ORDERED_TABLE_SELECTOR = ".uir-draggable-table";
  const ORDERED_CONTAINER_SELECTOR = ".uir-list-machine-ordered";
  const MOVABLE_CELL_SELECTOR = "td.movable";
  const COLUMN_SPAN_SELECTOR = 'span[id$="_fs"]';

  const DATA_ATTRIBUTE = "data-suitemate-v3-edit-grid";
  const NATIVE_ROW_ATTRIBUTE = "data-suitemate-v3-edit-grid-native-row";
  const BOUND_ATTRIBUTE = "data-suitemate-v3-edit-grid-bound";
  const FOREIGN_NODE_SELECTOR =
    "[data-suitemate-v3-internal-id], [data-suitemate-v3-so-columns], [data-suitemate-v3-form-views], [data-suitemate-v3-edit-grid]";
  const RESERVED_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);
  const CLASSES = Object.freeze({
    controls: "suitemate-v3-edit-grid-controls",
    button: "suitemate-v3-edit-grid-button",
    chip: "suitemate-v3-edit-grid-chip",
    menu: "suitemate-v3-edit-grid-menu",
    note: "suitemate-v3-edit-grid-note",
    colHidden: "suitemate-v3-edit-grid-col-hidden",
    rowFiltered: "suitemate-v3-edit-grid-row-filtered",
    personalizing: "suitemate-v3-edit-grid-personalizing",
    dragging: "suitemate-v3-edit-grid-dragging",
    dropTarget: "suitemate-v3-edit-grid-drop-target",
    resizeEdge: "suitemate-v3-edit-grid-resize-edge"
  });

  if (globalScope.SuiteMateV3EditGridCore?.VERSION === VERSION) {
    return;
  }

  // ===== Storage schema: validation, normalization and writers =====
  function isPlainObject(value) {
    return Boolean(
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.prototype.toString.call(value) === "[object Object]"
    );
  }

  function normalizeScopeKey(value) {
    return typeof value === "string"
      && value.length > 0
      && value.length <= MAX_COLUMN_ID_LENGTH
      && !RESERVED_KEYS.includes(value)
      ? value
      : null;
  }

  function normalizeColumnId(value) {
    const identifier = String(value ?? "").trim();
    return identifier.length > 0
      && identifier.length <= MAX_COLUMN_ID_LENGTH
      && !RESERVED_KEYS.includes(identifier)
      ? identifier
      : null;
  }

  function normalizeColumnIds(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COLUMN_IDS) {
      return null;
    }
    const ids = [];
    for (const candidate of value) {
      const id = typeof candidate === "string" ? normalizeColumnId(candidate) : null;
      if (!id) {
        return null;
      }
      ids.push(id);
    }
    return ids;
  }

  function clampWidth(pixels, minimum) {
    const floor = Math.max(ABSOLUTE_MIN_COLUMN_WIDTH, Math.round(Number(minimum) || 0));
    return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(floor, pixels)));
  }

  function normalizeWidths(value) {
    if (!isPlainObject(value)) {
      return null;
    }
    const widths = {};
    for (const [candidateId, width] of Object.entries(value)) {
      const id = normalizeColumnId(candidateId);
      const pixels = Number(width);
      if (!id || !Number.isFinite(pixels)) {
        continue;
      }
      widths[id] = clampWidth(pixels, ABSOLUTE_MIN_COLUMN_WIDTH);
    }
    const keys = Object.keys(widths);
    return keys.length && keys.length <= MAX_COLUMN_IDS ? widths : null;
  }

  function entryIsEmpty(entry) {
    return !entry.order && !entry.hidden && !entry.widths;
  }

  function normalizeEntry(value) {
    if (!isPlainObject(value)) {
      return null;
    }
    const order = normalizeColumnIds(value.order);
    const hidden = normalizeColumnIds(value.hidden);
    const widths = normalizeWidths(value.widths);
    if (!order && !hidden && !widths) {
      return null;
    }
    return {
      ...(order ? { order } : {}),
      ...(hidden ? { hidden } : {}),
      ...(widths ? { widths } : {})
    };
  }

  function normalizeStored(value) {
    const normalized = { schemaVersion: STORAGE_SCHEMA_VERSION, grids: {} };
    if (
      !isPlainObject(value)
      || !Number.isSafeInteger(value.schemaVersion)
      || value.schemaVersion < 1
      || value.schemaVersion > STORAGE_SCHEMA_VERSION
      || !isPlainObject(value.grids)
    ) {
      return normalized;
    }
    for (const [scopeKey, entry] of Object.entries(value.grids)) {
      const key = normalizeScopeKey(scopeKey);
      const normalizedEntry = normalizeEntry(entry);
      if (key && normalizedEntry) {
        normalized.grids[key] = normalizedEntry;
      }
    }
    return normalized;
  }

  function refusesNewerSchema(stored) {
    return isPlainObject(stored)
      && Number.isSafeInteger(stored.schemaVersion)
      && stored.schemaVersion > STORAGE_SCHEMA_VERSION;
  }

  function evictOverQuota(next, key) {
    const bytes = new TextEncoder().encode(`${STORAGE_KEY}${JSON.stringify(next)}`).length;
    if (bytes > MAX_SYNC_ITEM_BYTES) {
      // Single-entry eviction, scoped to this feature's own container: the
      // blast radius of a quota event stops at other Edit Mode scopes and can
      // never reach a View Mode layout (spec H2).
      next.grids = key in next.grids ? { [key]: next.grids[key] } : {};
    }
    return next;
  }

  function writeField(stored, scopeKey, field, value, normalizer) {
    if (refusesNewerSchema(stored)) {
      return null;
    }
    const next = normalizeStored(stored);
    const key = normalizeScopeKey(scopeKey);
    if (!key) {
      return null;
    }
    const entry = { ...(next.grids[key] ?? {}) };
    const empty = value === null || value === undefined
      || (Array.isArray(value) && value.length === 0)
      || (isPlainObject(value) && Object.keys(value).length === 0);
    if (empty) {
      delete entry[field];
    } else {
      const normalized = normalizer(value);
      if (!normalized) {
        return null;
      }
      entry[field] = normalized;
    }
    if (entryIsEmpty(entry)) {
      delete next.grids[key];
    } else {
      next.grids[key] = entry;
    }
    return evictOverQuota(next, key);
  }

  function withOrder(stored, scopeKey, columnIds) {
    return writeField(stored, scopeKey, "order", columnIds, normalizeColumnIds);
  }

  function withHidden(stored, scopeKey, columnIds) {
    return writeField(stored, scopeKey, "hidden", columnIds, normalizeColumnIds);
  }

  function withWidths(stored, scopeKey, widths) {
    return writeField(stored, scopeKey, "widths", widths, normalizeWidths);
  }

  // ===== Edit-Mode DOM identity =====
  function tableRows(table) {
    return Array.from(table?.rows ?? []);
  }

  function headerRow(table) {
    return table?.querySelector?.(HEADER_ROW_SELECTOR) ?? null;
  }

  function machineIdFromTable(table) {
    // #item_splits -> item, matching NetSuite's own {sublistId}_row_{n} ids.
    return String(table?.id ?? "").replace(/_+(?:splits|div)$/, "");
  }

  function rowLineNumber(row, machineId) {
    const prefix = `${machineId}_row_`;
    const id = String(row?.id ?? "");
    if (!id.startsWith(prefix)) {
      return null;
    }
    const line = Number(id.slice(prefix.length));
    return Number.isSafeInteger(line) && line > 0 ? line : null;
  }

  function columnIdFromSpanId(spanId, machineId, line) {
    // Mirrors src/internal-ids/core.js sublistColumnId, with the row's own line
    // number instead of a hard-coded 1 so a paged machine (line 26+) decodes
    // and line 21 can never be mistaken for line 1.
    const raw = String(spanId ?? "");
    const suffix = `${line}_fs`;
    if (!Number.isSafeInteger(line) || line <= 0 || !raw.endsWith(suffix)) {
      return null;
    }
    const withoutRow = raw.slice(0, -suffix.length);
    const prefix = machineId ? `${machineId}_` : "";
    const identifier = prefix && withoutRow.startsWith(prefix)
      ? withoutRow.slice(prefix.length)
      : withoutRow;
    return normalizeColumnId(identifier);
  }

  function visibleCells(row) {
    // Inline display:none is how NetSuite hides its own system cells; SuiteMate
    // hides columns with a class, so a SuiteMate-hidden column stays on the axis.
    return Array.from(row?.cells ?? []).filter((cell) => cell?.style?.display !== "none");
  }

  function isExcludedRow(row) {
    try {
      return row?.matches?.(EXCLUDED_ROW_SELECTOR) === true;
    } catch {
      return true;
    }
  }

  function alignsToHeader(row, columnIds) {
    return Array.isArray(columnIds)
      && columnIds.length > 0
      && visibleCells(row).length === columnIds.length;
  }

  function isDataRow(row, columnIds) {
    try {
      return row?.matches?.(DATA_ROW_SELECTOR) === true
        && !row.matches(HEADER_ROW_SELECTOR)
        && !isExcludedRow(row)
        && alignsToHeader(row, columnIds);
    } catch {
      return false;
    }
  }

  function readColumnIds(table) {
    try {
      const header = headerRow(table);
      const width = visibleCells(header).length;
      if (!width) {
        return [];
      }
      const machineId = machineIdFromTable(table);
      for (const row of tableRows(table)) {
        if (row === header || isExcludedRow(row) || visibleCells(row).length !== width) {
          continue;
        }
        const line = rowLineNumber(row, machineId);
        if (line === null) {
          continue;
        }
        const ids = visibleCells(row).map((cell) =>
          columnIdFromSpanId(cell?.querySelector?.(COLUMN_SPAN_SELECTOR)?.id, machineId, line) ?? "");
        if (ids.every(Boolean)) {
          return ids;
        }
      }
      return [];
    } catch {
      return [];
    }
  }

  function isOrderedMachine(table) {
    try {
      if (table?.matches?.(ORDERED_TABLE_SELECTOR)) {
        return true;
      }
      if (table?.closest?.(ORDERED_CONTAINER_SELECTOR)) {
        return true;
      }
      return Boolean(table?.querySelector?.(MOVABLE_CELL_SELECTOR));
    } catch {
      return true;
    }
  }

  // ===== Frozen export surface =====
  Object.defineProperty(globalScope, "SuiteMateV3EditGridCore", {
    value: Object.freeze({
      VERSION,
      STORAGE_KEY,
      STORAGE_SCHEMA_VERSION,
      MAX_SYNC_ITEM_BYTES,
      MAX_COLUMN_ID_LENGTH,
      MAX_COLUMN_IDS,
      ABSOLUTE_MIN_COLUMN_WIDTH,
      MAX_COLUMN_WIDTH,
      MACHINE_TABLE_SELECTOR,
      MACHINE_CONTAINER_SELECTOR,
      HEADER_ROW_SELECTOR,
      DATA_ROW_SELECTOR,
      FOCUSED_ROW_SELECTOR,
      EXCLUDED_ROW_SELECTOR,
      COLUMN_SPAN_SELECTOR,
      DATA_ATTRIBUTE,
      NATIVE_ROW_ATTRIBUTE,
      BOUND_ATTRIBUTE,
      FOREIGN_NODE_SELECTOR,
      CLASSES,
      clampWidth,
      normalizeStored,
      refusesNewerSchema,
      withOrder,
      withHidden,
      withWidths,
      machineIdFromTable,
      rowLineNumber,
      columnIdFromSpanId,
      visibleCells,
      tableRows,
      headerRow,
      isExcludedRow,
      alignsToHeader,
      isDataRow,
      readColumnIds,
      isOrderedMachine
    }),
    configurable: false,
    enumerable: true,
    writable: false
  });
})(globalThis);
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 222`, `ℹ pass 222`, `ℹ fail 0` (215 + 7 new); 28 baselines at 0.000 %.

- [ ] **Step 6: Commit**

```bash
git add src/edit-grid/core.js tests/edit-grid.test.mjs package.json
git commit -m "feat: edit-grid core with the Edit Mode storage doctrine and column identity"
```

### Task 6: `src/edit-grid/runtime.js` + `edit-grid.css` — mount, stamp, tear down, do nothing visible

**Files:**
- Create: `src/edit-grid/runtime.js`, `src/edit-grid/edit-grid.css`
- Modify: `manifest.json` (css array `:41-52`, js array `:53-74`), `tests/verify.mjs` (`:30-41`, `:42-63`, `extensionSources` `:186-218`), `package.json:10`

**Interfaces:**
- Consumes: `SuiteMateV3EditGridCore` (Task 5), `routes.CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT` (Task 2), `settingsApi.normalize(v).salesOrderColumnsEdit` (Task 3), `SuiteMateV3Lifecycle.register`, `globalThis.SuiteMateV3Notifications?.showToast`.
- Produces — the runtime seams every later milestone extends, by exact name: `installEditGrid({ signal, isCurrent })`, `removeEditGrid()`, `relevant(records)`, `renderSignature(table, columnIds)`, `targetSignature(table, columnIds)`, `applyAll(table, columnIds)`, `queueApply(reason)`, `isLineOpen()`, `isDirty()`, `forcedRows()`, `ensureBindings(container)`, `releaseBindings(container)`, `DELEGATED_LISTENERS`, `enqueueSave(operation)`, `resolveScopeKey()`, `showToast(message, type)`, module state `entry`, `nativeColumnIds`, `activeTable`, `scopeKey`, `pendingApply`.

- [ ] **Step 1: Write `src/edit-grid/edit-grid.css`**

```css
/* SuiteMate V3 — Sales Order Edit Mode grid (src/edit-grid/*).
   Every rule is scoped to this feature's own attribute or classes; nothing here
   may match a View Mode node. Hide rules carry !important: display-defeats-
   hidden has three recorded sightings (CHECKPOINTS.md:858, :972, :1143). */

[data-suitemate-v3-edit-grid][hidden] {
    display: none !important
}

.suitemate-v3-edit-grid-col-hidden {
    display: none !important
}

.suitemate-v3-edit-grid-row-filtered {
    display: none !important
}

.suitemate-v3-edit-grid-controls {
    display: inline-flex;
    flex-wrap: wrap;
    max-width: 100%;
    box-sizing: border-box;
    align-items: center;
    gap: 6px;
    margin: 0 0 4px 6px;
    vertical-align: middle
}

.suitemate-v3-edit-grid-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border: 1px solid var(--theme-secondary, #a2a4a8);
    border-radius: var(--radius-small, 4px);
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: 18px;
    cursor: pointer
}

.suitemate-v3-edit-grid-button:hover {
    border-color: var(--theme-main, #607799)
}

.suitemate-v3-edit-grid-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border: 1px dashed var(--theme-secondary, #a2a4a8);
    border-radius: var(--radius-small, 4px);
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: 16px;
    cursor: pointer
}

.suitemate-v3-edit-grid-note {
    font-size: 11px;
    opacity: .75
}

.suitemate-v3-edit-grid-resize-edge {
    cursor: col-resize !important;
    box-shadow: inset -3px 0 0 var(--theme-main, #607799) !important
}

body.suitemate-v3-edit-grid-resizing {
    cursor: col-resize !important;
    user-select: none !important
}

#item_splits[data-suitemate-v3-edit-grid-bound] tr.uir-machine-headerrow td {
    box-sizing: border-box
}

.suitemate-v3-edit-grid-menu {
    position: absolute;
    z-index: 9999;
    max-height: 320px;
    min-width: 200px;
    overflow: auto;
    padding: 6px;
    border: 1px solid var(--theme-secondary, #a2a4a8);
    border-radius: var(--radius-small, 4px);
    background: var(--ns-background, #fff);
    color: inherit
}

html.isDarkMode .suitemate-v3-edit-grid-menu {
    background: var(--ns-background, #23272e)
}

.suitemate-v3-edit-grid-menu label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    white-space: nowrap
}

.suitemate-v3-edit-grid-personalizing tr.uir-machine-headerrow td {
    cursor: grab
}

.suitemate-v3-edit-grid-dragging {
    opacity: .55
}

.suitemate-v3-edit-grid-drop-target {
    box-shadow: inset 3px 0 0 var(--theme-main, #607799)
}
```

- [ ] **Step 2: Write `src/edit-grid/runtime.js`**

```js
(function initializeSuiteMateV3EditGrid() {
  "use strict";

  const core = globalThis.SuiteMateV3EditGridCore;
  const lifecycleApi = globalThis.SuiteMateV3Lifecycle;
  const routeApi = globalThis.SuiteMateV3Routes;
  const settingsApi = globalThis.SuiteMateV3Settings;
  if (
    !core
    || !lifecycleApi
    || !routeApi
    || !settingsApi
    || !globalThis.document
    || !globalThis.location
    || !globalThis.chrome?.runtime
  ) {
    return;
  }

  let topFrame = false;
  try {
    topFrame = window === window.top;
  } catch {
    return;
  }

  const pageContext = routeApi.createPageContext(location, {
    isTopFrame: topFrame,
    trustedContentScript: true
  });
  if (!routeApi.supports(routeApi.CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT, pageContext)) {
    return;
  }

  const OWNED_SELECTOR = `[${core.DATA_ATTRIBUTE}]`;
  const RELEVANT_SELECTOR =
    `${core.MACHINE_TABLE_SELECTOR}, ${core.HEADER_ROW_SELECTOR}, ${core.DATA_ROW_SELECTOR}`;
  let settingsRevision = 0;
  let scopeKey = null;
  let activeTable = null;
  let nativeColumnIds = null;
  let entry = {};
  let pendingApply = false;
  let installErrorLogged = false;

  function showToast(message, type) {
    globalThis.SuiteMateV3Notifications?.showToast(message, { type });
  }

  function logOnce(error) {
    if (installErrorLogged) {
      return;
    }
    installErrorLogged = true;
    console.error("SuiteMate V3 edit grid install failed.", error);
  }

  // ===== Scope =====
  function recordType() {
    const match = /\/([a-z0-9_]+)\.nl$/i.exec(location.pathname);
    return (match?.[1] ?? "record").toLowerCase();
  }

  function resolveScopeKey() {
    const type = recordType();
    try {
      const sessionScript = document.querySelector(
        'script[src^="/javascript/sessionstatus/session_status_init.jsp?"]'
      );
      if (sessionScript?.src) {
        const params = new URL(sessionScript.src, location.origin).searchParams;
        const companyId = params.get("companyId");
        // Session id is COMPANY~USER~ROLE~FLAG; segment 2 is the user id.
        const userId = params.get("id")?.split("~")[1];
        if (companyId && userId) {
          return `${companyId}:${userId}:${type}:edit`;
        }
      }
    } catch {}
    return `${location.hostname}:${type}:edit`;
  }

  // ===== Machine state =====
  function machineTable() {
    return document.querySelector(core.MACHINE_TABLE_SELECTOR);
  }

  function machineContainer(table) {
    return table?.closest?.(core.MACHINE_CONTAINER_SELECTOR) ?? null;
  }

  function isLineOpen() {
    const table = activeTable ?? machineTable();
    if (!table) {
      return false;
    }
    return Boolean(table.querySelector(core.FOCUSED_ROW_SELECTOR))
      || Boolean(table.querySelector("tr.machineButtonRow"));
  }

  function isDirty() {
    const table = activeTable ?? machineTable();
    const openRow = table?.querySelector?.(core.FOCUSED_ROW_SELECTOR);
    if (!openRow) {
      return false;
    }
    return Array.from(openRow.querySelectorAll("input, select, textarea"))
      .some((field) => field.value !== field.defaultValue);
  }

  function forcedRows() {
    // The open row and any dirty row are exempt from every hide/filter/move set.
    const table = activeTable ?? machineTable();
    return Array.from(table?.querySelectorAll?.(core.FOCUSED_ROW_SELECTOR) ?? []);
  }

  // ===== Delegated listeners (one per event type, on the container) =====
  const DELEGATED_LISTENERS = [
    // M2 adds the resize pair, M3 the focusin reveal, M5 the control clicks,
    // M6/M7 the header menu. Nothing is bound per row: rows are destroyed on
    // every repaint and per-row binding is how duplicate handlers accumulate.
  ];

  function ensureBindings(container) {
    if (!container || container.hasAttribute(core.BOUND_ATTRIBUTE)) {
      return;
    }
    container.setAttribute(core.BOUND_ATTRIBUTE, "");
    for (const [type, handler, options] of DELEGATED_LISTENERS) {
      container.addEventListener(type, handler, options);
    }
  }

  function releaseBindings(container) {
    if (!container?.hasAttribute?.(core.BOUND_ATTRIBUTE)) {
      return;
    }
    container.removeAttribute(core.BOUND_ATTRIBUTE);
    for (const [type, handler, options] of DELEGATED_LISTENERS) {
      container.removeEventListener(type, handler, options);
    }
  }

  function ensureMountMarker(container) {
    if (container.querySelector(`:scope > [${core.DATA_ATTRIBUTE}="mount"]`)) {
      return;
    }
    const marker = document.createElement("span");
    marker.setAttribute(core.DATA_ATTRIBUTE, "mount");
    marker.hidden = true;
    container.append(marker);
  }

  // ===== Serialized save queue =====
  let saveQueue = Promise.resolve();
  function enqueueSave(operation) {
    saveQueue = saveQueue.then(operation, operation);
    return saveQueue;
  }

  // ===== Apply =====
  function renderSignature(table, columnIds) {
    // Everything the runtime applies MUST appear here. An install whose current
    // signature already equals the target performs zero DOM and zero storage
    // writes — that is what makes "one gesture = exactly one write" testable.
    return JSON.stringify({ ids: columnIds });
  }

  function targetSignature(table, columnIds) {
    void table;
    return JSON.stringify({ ids: columnIds });
  }

  function applyAll(table, columnIds) {
    // M2 appends applyCurrentWidths, M3 applyCurrentHidden, M6 applyCurrent
    // Filters, M7 applyCurrentSort. M1 applies nothing: the foundation must be
    // invisible so the 28 screenshot baselines cannot move.
    void table;
    void columnIds;
  }

  function queueApply(reason) {
    if (isLineOpen()) {
      // Hide/show, width and filter changes queue while a line is open and
      // flush when it closes; reorder and sort are refused outright (M4/M7).
      pendingApply = true;
      return;
    }
    pendingApply = false;
    const table = machineTable();
    const columnIds = table ? core.readColumnIds(table) : [];
    if (!table || columnIds.length < 2) {
      return;
    }
    activeTable = table;
    applyAll(table, columnIds);
    void reason;
  }

  async function installEditGrid({ signal, isCurrent }) {
    try {
      const table = machineTable();
      const container = machineContainer(table);
      if (!table || !container) {
        return false;
      }
      const columnIds = core.readColumnIds(table);
      // Fail closed on an unrecognized machine: no header, no _fs spans,
      // duplicate or undecodable ids (spec section 7).
      if (
        columnIds.length < 2
        || columnIds.some((id) => !id)
        || new Set(columnIds).size !== columnIds.length
      ) {
        return false;
      }
      activeTable = table;
      nativeColumnIds = columnIds;
      scopeKey = resolveScopeKey();
      ensureMountMarker(container);
      ensureBindings(container);
      const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
      if (signal.aborted || !isCurrent() || !table.isConnected) {
        return false;
      }
      if (core.refusesNewerSchema(stored[core.STORAGE_KEY])) {
        showToast("This layout was saved by a newer SuiteMate.", "warning");
        entry = {};
        return true;
      }
      entry = core.normalizeStored(stored[core.STORAGE_KEY]).grids[scopeKey] ?? {};
      // Identity re-derivation: Add/Insert/Remove renumbers every row id and
      // _fs span, so identity is re-read here on every install and a surviving
      // stamp on a <td> is never trusted as identity.
      const current = core.readColumnIds(table);
      if (renderSignature(table, current) === targetSignature(table, current)) {
        return true;
      }
      if (isLineOpen()) {
        pendingApply = true;
        return true;
      }
      applyAll(table, current);
      return !signal.aborted && isCurrent();
    } catch (error) {
      logOnce(error);
      return false;
    }
  }

  function removeEditGrid() {
    try {
      const table = activeTable ?? machineTable();
      releaseBindings(machineContainer(table));
      // M2 appends core.applyWidths(table, null, {}), M3 the hidden reset, M6 the
      // filter reset, M7 the native row-order restore.
    } catch {}
    for (const node of document.querySelectorAll(OWNED_SELECTOR)) {
      node.remove();
    }
    activeTable = null;
    nativeColumnIds = null;
    scopeKey = null;
    entry = {};
    pendingApply = false;
  }

  // ===== Relevance: stamp exclusion =====
  function isOwned(node) {
    return node?.nodeType === 1
      && (node.matches?.(OWNED_SELECTOR) === true || Boolean(node.closest?.(OWNED_SELECTOR)));
  }

  function isMachineNode(node) {
    if (node?.nodeType !== 1) {
      return false;
    }
    return node.matches?.(RELEVANT_SELECTOR) === true
      || Boolean(node.querySelector?.(RELEVANT_SELECTOR))
      || Boolean(node.closest?.(core.MACHINE_TABLE_SELECTOR));
  }

  function relevant(records) {
    return records.some((record) => {
      if (isOwned(record.target)) {
        return false;
      }
      const touched = [...record.addedNodes, ...record.removedNodes];
      return touched.some((node) => !isOwned(node) && isMachineNode(node))
        || isMachineNode(record.target);
    });
  }

  const lifecycleHandle = lifecycleApi.register({
    id: "record.edit-grid",
    replace: true,
    capability: routeApi.CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT,
    mode: "continuous",
    startPaused: true,
    observe: {
      childList: true,
      subtree: true
    },
    relevant,
    evaluate: installEditGrid,
    cleanup: removeEditGrid
  });

  function applySettings(value, reason) {
    const settings = settingsApi.normalize(value);
    if (settings.salesOrderColumnsEdit) {
      lifecycleHandle.resume(reason);
    } else {
      lifecycleHandle.pause(reason);
      removeEditGrid();
    }
  }

  async function start() {
    const revision = settingsRevision;
    try {
      const settings = await settingsApi.get();
      if (revision === settingsRevision) {
        applySettings(settings, "settings-loaded");
      }
    } catch {
      if (revision === settingsRevision) {
        lifecycleHandle.pause("settings-failed");
        removeEditGrid();
      }
    }
  }

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    const change = changes[settingsApi.STORAGE_KEY];
    if (areaName !== "sync" || !change) {
      return;
    }
    settingsRevision += 1;
    try {
      applySettings(change.newValue, "settings-changed");
    } catch {
      lifecycleHandle.pause("settings-invalid");
      removeEditGrid();
    }
  });

  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      lifecycleHandle.dispose("page-hidden");
    }
  });

  start();
})();
```

- [ ] **Step 3: Wire the manifest.** In `manifest.json`, append `"src/edit-grid/edit-grid.css"` to the css array (after `"src/form-views/form-views.css"`), insert `"src/edit-grid/core.js"` immediately after `"src/form-views/core.js"` in the js array, and append `"src/edit-grid/runtime.js"` as the **last** js entry (after `"src/form-views/runtime.js"`).

- [ ] **Step 4: Mirror the manifest in `tests/verify.mjs`.** Make the identical three insertions in the `deepEqual` css array (`:30-41`) and js array (`:42-63`), and add these three entries to `extensionSources` after `"src/so-columns/so-columns.css"`:

```js
  "src/edit-grid/core.js",
  "src/edit-grid/runtime.js",
  "src/edit-grid/edit-grid.css",
```

- [ ] **Step 5: Add the syntax gate.** In `package.json:10`, add `&& node --check src/edit-grid/runtime.js` immediately after the `src/edit-grid/core.js` check added in Task 5.

- [ ] **Step 6: Run the suite**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 222`, `ℹ pass 222`, `ℹ fail 0`; 28 baselines at 0.000 % (the feature is default-off and `startPaused`, so no captured page can change). A `deepEqual` failure here means the manifest and its `verify.mjs` mirror disagree byte-for-byte.

- [ ] **Step 7: Commit**

```bash
git add src/edit-grid/runtime.js src/edit-grid/edit-grid.css manifest.json tests/verify.mjs package.json
git commit -m "feat: edit-grid runtime mounts, stamps and tears down with no visible behaviour"
```

### Task 7: `tests/fixtures/sales-order-edit.html` + the M1 fixture round-trip

**Files:**
- Create: `tests/fixtures/sales-order-edit.html`
- Modify: `tests/verify.mjs` (fixture link list `:156-169`)

**Interfaces:**
- Consumes: `tests/fixtures/chrome-stub.js` (Task 4), `src/edit-grid/{core,runtime}.js` (Tasks 5-6).
- Produces: `SuiteMateV3EditFixture.openLine(n)`, `.closeLine()`, `.addLine()`, `.removeLine(n)`, `.repaint()` — the repaint emulator every later milestone's fixture step drives.

- [ ] **Step 1: Create the fixture**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <base href="/tests/fixtures/">
    <title>SuiteMate V3 Sales Order Edit Mode fixture</title>
    <link rel="stylesheet" href="../../src/styles/font.css">
    <link rel="stylesheet" href="../../src/styles/netsuite.css">
    <link rel="stylesheet" href="../../src/styles/radii.css">
    <link rel="stylesheet" href="../../src/styles/v3-compat.css">
    <link rel="stylesheet" href="../../src/styles/notifications.css">
    <link rel="stylesheet" href="../../src/edit-grid/edit-grid.css">
    <link rel="stylesheet" href="netSuiteFixture.css">
    <script src="chrome-stub.js"></script>
    <script>
      history.replaceState(null, "", "/app/accounting/transactions/salesord.nl?id=1&e=T");
    </script>
    <script type="application/json" src="/javascript/sessionstatus/session_status_init.jsp?id=FIXTURE~1~3~N&companyName=Fixture+Company&roleName=Administrator&companyId=FIXTURE&roleId=3"></script>
    <script src="../../src/shared/utilities.js"></script>
    <script src="../../src/shared/routes.js"></script>
    <script src="../../src/shared/commands.js"></script>
    <script src="../../src/shared/lifecycle.js"></script>
    <script src="../../src/shared/settings.js"></script>
    <script src="../../src/runtime/notification-runtime.js"></script>
    <script src="../../src/edit-grid/core.js"></script>
    <script src="../../src/edit-grid/runtime.js"></script>
  </head>
  <body>
    <form id="main_form">
      <input id="baserecordtype" type="hidden" value="salesorder">
      <main id="div__body">
        <h1 class="uir-page-title-firstline">Sales Order #SO10428 — Edit</h1>
        <div id="items" class="uir-machine-table-container">
          <table id="item_splits" class="uir-machine-table">
            <tbody></tbody>
          </table>
        </div>
      </main>
    </form>
    <script>
      // Emulates the parts of NetSuite's machine that the design depends on:
      // extra system <td>s with inline display:none, {machine}_{column}{line}_fs
      // spans, {machine}_row_{n} ids, a machineButtonRow beneath the open line,
      // a totals row, and a buildtable()-style full <tbody> regenerate that
      // discards everything SuiteMate wrote.
      (() => {
        const COLUMNS = ["item", "quantity", "rate", "amount"];
        const LABELS = { item: "Item", quantity: "Quantity", rate: "Rate", amount: "Amount" };
        const table = document.querySelector("#item_splits");
        let lines = [
          { item: "SKU-1001", quantity: "2", rate: "18.00", amount: "36.00" },
          { item: "SKU-2004", quantity: "1", rate: "24.00", amount: "24.00" },
          { item: "SKU-3300", quantity: "5", rate: "4.50", amount: "22.50" }
        ];
        let openLine = null;

        function cell(content, { spanId = null, systemHidden = false } = {}) {
          const td = document.createElement("td");
          if (systemHidden) {
            td.style.display = "none";
          }
          if (spanId) {
            const span = document.createElement("span");
            span.id = spanId;
            span.textContent = content;
            td.append(span);
          } else {
            td.textContent = content;
          }
          return td;
        }

        function buildTable() {
          const body = document.createElement("tbody");
          const header = document.createElement("tr");
          header.className = "uir-machine-headerrow";
          for (const column of COLUMNS) {
            const th = document.createElement("td");
            const label = document.createElement("div");
            label.className = "listheader";
            label.textContent = LABELS[column];
            th.append(label);
            header.append(th);
          }
          header.append(cell("", { systemHidden: true }));
          body.append(header);

          lines.forEach((line, index) => {
            const number = index + 1;
            const row = document.createElement("tr");
            row.id = `item_row_${number}`;
            row.className = number === openLine ? "uir-machine-row uir-machine-row-focused" : "uir-machine-row";
            for (const column of COLUMNS) {
              if (number === openLine) {
                const td = document.createElement("td");
                td.className = "uir-machine-focused-cell";
                const span = document.createElement("span");
                span.id = `item_${column}${number}_fs`;
                const input = document.createElement("input");
                input.type = "text";
                input.value = line[column];
                input.defaultValue = line[column];
                span.append(input);
                td.append(span);
                row.append(td);
              } else {
                row.append(cell(line[column], { spanId: `item_${column}${number}_fs` }));
              }
            }
            row.append(cell(`sys${number}`, { spanId: `item_sys${number}_fs`, systemHidden: true }));
            body.append(row);
            if (number === openLine) {
              const buttons = document.createElement("tr");
              buttons.className = "machineButtonRow";
              const buttonCell = document.createElement("td");
              buttonCell.colSpan = COLUMNS.length + 1;
              buttonCell.textContent = "OK  Cancel  Insert";
              buttons.append(buttonCell);
              body.append(buttons);
            }
          });

          const totals = document.createElement("tr");
          totals.className = "totalrow";
          const totalsCell = document.createElement("td");
          totalsCell.colSpan = COLUMNS.length + 1;
          totalsCell.textContent = "Total";
          totals.append(totalsCell);
          body.append(totals);

          table.replaceChild(body, table.tBodies[0]);
        }

        globalThis.SuiteMateV3EditFixture = {
          get lines() {
            return lines;
          },
          openLine(number) {
            openLine = number;
            buildTable();
          },
          closeLine() {
            openLine = null;
            buildTable();
          },
          addLine() {
            const number = lines.length + 1;
            lines = [...lines, { item: `SKU-90${number}`, quantity: "1", rate: "9.00", amount: "9.00" }];
            buildTable();
          },
          removeLine(number) {
            lines = lines.filter((_, index) => index + 1 !== number);
            buildTable();
          },
          repaint: buildTable
        };
        buildTable();
      })();
    </script>
  </body>
</html>
```

- [ ] **Step 2: Register the fixture in the link list.** In `tests/verify.mjs`, add `"tests/fixtures/sales-order-edit.html",` to the fixture array (`:156-169`) after `"tests/fixtures/sales-order.html",`. **Do not** add it to `tests/fixtures/route-catalog.js` — that is what keeps the baseline count at 28.

- [ ] **Step 3: Run the suite**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 222`, `ℹ pass 222`, `ℹ fail 0`; `fixtures.test.mjs` still asserts 28 entries; baselines at 0.000 %. A failure here is an unreachable `src`/`href` in the new fixture.

- [ ] **Step 4: Serve the fixture and run the M1 round-trip**

```bash
python3 -m http.server 8931 >/dev/null 2>&1 &
```

Open `http://localhost:8931/tests/fixtures/sales-order-edit.html?salesOrderColumnsEdit=true` in Chrome and run in the console:

```js
// 1. Mounts on ?e=T
const container = document.querySelector("#items");
console.log("mounted:", Boolean(container.querySelector('[data-suitemate-v3-edit-grid="mount"]')));
console.log("bound:", container.hasAttribute("data-suitemate-v3-edit-grid-bound"));
console.log("watcher:", SuiteMateV3Lifecycle.getDiagnostics().watcherIds.includes("record.edit-grid"));

// 2. Nothing visible: the machine is byte-identical to what the fixture emitted
const table = document.querySelector("#item_splits");
console.log("tableLayout:", getComputedStyle(table).tableLayout);      // expect "auto"
console.log("rowsVisible:", [...table.rows].every((r) => getComputedStyle(r).display !== "none"));

// 3. Survives a full <tbody> regenerate with zero storage writes
delete document.documentElement.dataset.editGridWrites;
SuiteMateV3EditFixture.repaint();
SuiteMateV3EditFixture.addLine();
SuiteMateV3EditFixture.openLine(2);
SuiteMateV3EditFixture.closeLine();
await new Promise((r) => setTimeout(r, 500));
console.log("writes:", document.documentElement.dataset.editGridWrites ?? "0");   // expect "0"
console.log("still mounted:", Boolean(document.querySelector('[data-suitemate-v3-edit-grid="mount"]')));

// 4. Route gate: the complement is asserted at the gate, not at the DOM (spec H3)
const edit = SuiteMateV3Routes.createPageContext(location.href, { isTopFrame: true });
const view = SuiteMateV3Routes.createPageContext(
  location.href.replace("&e=T", ""), { isTopFrame: true });
console.log("edit caps:", [
  SuiteMateV3Routes.supports("transaction-column-personalization-edit", edit),
  SuiteMateV3Routes.supports("transaction-column-personalization", edit)
]);                                                                    // expect [true, false]
console.log("view caps:", [
  SuiteMateV3Routes.supports("transaction-column-personalization-edit", view),
  SuiteMateV3Routes.supports("transaction-column-personalization", view)
]);                                                                    // expect [false, true]

// 5. Teardown leaves zero owned nodes and zero listeners
SuiteMateV3Lifecycle.dispose("record.edit-grid", "fixture-teardown");
console.log("owned nodes:", document.querySelectorAll("[data-suitemate-v3-edit-grid]").length);  // 0
console.log("bound:", container.hasAttribute("data-suitemate-v3-edit-grid-bound"));              // false
```

Expected: `mounted: true`, `bound: true`, `watcher: true`; `tableLayout: auto`; `rowsVisible: true`; `writes: 0`; `still mounted: true`; `edit caps: [true, false]`; `view caps: [false, true]`; `owned nodes: 0`; `bound: false`.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/sales-order-edit.html tests/verify.mjs
git commit -m "test: Edit Mode sales order fixture with a repaint emulator"
```

### Task 8: The four one-token `FOREIGN_NODE_SELECTOR` additions

**Files:**
- Modify: `src/so-columns/core.js:24`, `src/form-views/core.js:21`, `src/csv-export/core.js:211`, `src/tab-title/core.js:5`

**Interfaces:**
- Consumes: `core.DATA_ATTRIBUTE === "data-suitemate-v3-edit-grid"` (Task 5).
- Produces: nothing new — a defensive exclusion so no future View Mode text read can ingest an Edit Mode affordance.

- [ ] **Step 1: Confirm no test pins these strings**

```bash
grep -rn "data-suitemate-v3-form-views\], \|FOREIGN_NODE_SELECTOR" tests/ | grep -v edit-grid
```

Expected: no test asserts the literal selector string. If one appears, update it in this task and say so in the checkpoint entry.

- [ ] **Step 2: Apply the four edits.** In each of these lines, append `, [data-suitemate-v3-edit-grid]` inside the closing quote and change nothing else:

`src/so-columns/core.js:24` and `src/form-views/core.js:21` and `src/tab-title/core.js:5` become:

```js
  const FOREIGN_NODE_SELECTOR = "[data-suitemate-v3-internal-id], [data-suitemate-v3-so-columns], [data-suitemate-v3-form-views], [data-suitemate-v3-edit-grid]";
```

`src/csv-export/core.js:211` becomes:

```js
  const VIEW_FOREIGN_NODE_SELECTOR = "[data-suitemate-v3-so-columns], [data-suitemate-v3-internal-id], [data-suitemate-v3-form-views], [data-suitemate-v3-edit-grid]";
```

- [ ] **Step 3: Prove the diff is exactly four tokens**

```bash
git diff --stat src/so-columns/core.js src/form-views/core.js src/csv-export/core.js src/tab-title/core.js
git diff --name-only main | grep so-columns
```

Expected: four files, `4 insertions(+), 4 deletions(-)`; the grep prints exactly `src/so-columns/core.js` and nothing else. From here on, that is the permanent expected output of the View Mode diff guard.

- [ ] **Step 4: Run the suite**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 222`, `ℹ pass 222`, `ℹ fail 0`; 28 baselines at 0.000 %.

- [ ] **Step 5: Commit**

```bash
git add src/so-columns/core.js src/form-views/core.js src/csv-export/core.js src/tab-title/core.js
git commit -m "fix: exclude edit-grid nodes from the four view-mode foreign-node selectors"
```

### Task 9: LIVE PROBE PASS — dossier §12 probes, Gate A, and `docs/testing-log.md`

**Files:**
- Create: `docs/testing-log.md`
- No source changes.

**Interfaces:**
- Consumes: nothing in code. The extension does **not** need to be loaded for the read-only probes; probe results describe NetSuite, not SuiteMate.
- Produces: the **Gate A verdict** (`id-addressed` ⇒ M4 ships, `index-addressed` ⇒ M4 closes as not technically possible), the **native drag-order verdict** (probe 6b; gates M6/M7), and the verbatim transcripts pasted into the M1 checkpoint entry and `docs/testing-log.md`.

**SAFETY PROTOCOL — restated in full because it binds every browser action in this task:**

1. **Record lock.** Account `6998262`, `id=16342809`, and no other record or transaction. Per Q2 the lock explicitly covers **the same record with `&e=T` appended**: `https://6998262.app.netsuite.com/app/accounting/transactions/salesord.nl?id=16342809&e=T`. Before ANY interaction, confirm the URL bar shows account `6998262` and `id=16342809`. Any other record or account: **stop and report**. Never create additional test Sales Orders. Never open other transactions in Edit Mode.
2. **Safety triple — verify all three BEFORE testing begins and again BEFORE every save:** (a) `custbody_salesorder_issue` is checked (true); (b) Status is Pending Approval; (c) the Memo clearly indicates a testing record. If any check fails at any point: do **not** save, stop, report immediately.
3. **Four-eyes save gate.** The captain never decides alone that a save is safe. Before every save: the captain gathers evidence (URL bar showing account + id, the three safety fields, and a one-paragraph statement of exactly what the save changes and why), dispatches an **Opus 5** subagent as the save gate, and the gate answers exactly **GO** or **NO-GO** with reasons. Default is **NO-GO**; missing, stale or ambiguous evidence means NO-GO. Click Save only on GO. On NO-GO: do not save, stop, report. The first save of a session additionally requires the owner's explicit go-ahead in chat.
4. **No save is required by this task or by any milestone in this plan.** Probe 5 (the serialized payload) requires a save and is therefore **deferred** (spec §12 U1; synthesis §5 Q2). Probe 8 is authorized as an **in-page** open/edit/commit with **no record save**; teardown is navigating away, never Submit.
5. **Forbidden regardless of anything else:** Approve, Reject, Bill, Fulfill, Email, Print, Delete, Make Copy, or any status-changing or document-sending action. Edit and Save are the only permitted record verbs.
6. **Every interpretation question** — "does this render correctly?", "is this a regression?", "did NetSuite recalc as expected?" — is answered by an **Opus 5** subagent from DOM evidence, never by the captain's own reading. Browser testing stays sequential; never run parallel agents sharing Chrome.
7. **`docs/testing-log.md` gains a line for this session** (timestamp, milestone, what was exercised, evidence location, gate verdict where a gate ran) and ships in the M1 checkpoint commit.

- [ ] **Step 1: Open the locked record in Edit Mode and verify the safety triple**

Navigate to `https://6998262.app.netsuite.com/app/accounting/transactions/salesord.nl?id=16342809&e=T`. Read back, via DOM, all four facts before anything else:

```js
({
  url: location.href,
  account: location.hostname,
  issueFlagChecked: document.querySelector('#custbody_salesorder_issue')?.checked
    ?? document.querySelector('[name="custbody_salesorder_issue"]')?.value,
  status: document.querySelector('#status_fs, .uir-record-status')?.textContent?.trim()
    ?? document.querySelector('[name="orderstatus"]')?.value,
  memo: document.querySelector('#memo')?.value
})
```

Expected: hostname `6998262.app.netsuite.com`, `id=16342809&e=T` in the URL, issue flag true, status Pending Approval, memo clearly marking a testing record. **Any deviation: stop and report.**

- [ ] **Step 2: Probe 1 — container, table and machine name**

```js
[...document.querySelectorAll('.uir-machine-table-container')]
  .map((d) => [d.id, d.dataset.machineName ?? null, d.className, d.querySelector('table')?.id])
```

Records: the container id and class, whether `data-machine-name` exists at all, and the machine table id. Answers U3 (probe 6d is the same read).

- [ ] **Step 3: Probe 2 — the cell-count mismatch that is spec H1**

```js
(() => {
  const t = document.querySelector('#item_splits');
  const h = t.querySelector('tr.uir-machine-headerrow');
  const vis = (r) => [...r.cells].filter((c) => c.style.display !== 'none').length;
  return {
    headerCells: h.cells.length,
    headerVisible: vis(h),
    rows: [...t.rows].slice(0, 8).map((r) => [r.id, r.className, r.cells.length, vis(r)])
  };
})()
```

Expected shape: data rows have `cells.length > headerCells` while `vis(row) === vis(header)`. **This is the read that proves `visibleCells` is the right column axis.** If `vis(row) !== vis(header)` for a static data row, the design's axis assumption is wrong — stop and report before writing M2.

- [ ] **Step 4: Probe 3 — row id pattern and where the button/totals rows sit**

```js
[...document.querySelector('#item_splits').rows].map((r) => [r.id, r.className])
```

Expected: data rows ids of the form `item_row_1`, `item_row_2`, …; a `totalrow` (or similar) outside the data range. Record the exact class names of any non-data rows — they go into `EXCLUDED_ROW_SELECTOR` if they differ from the spec's list.

- [ ] **Step 5: Probe 4 — `_fs` span ids per row (column identity)**

```js
[...document.querySelector('#item_splits').rows]
  .filter((r) => /_row_\d+$/.test(r.id))
  .slice(0, 3)
  .map((r) => [r.id, [...r.cells].map((c) => c.querySelector('span[id$="_fs"]')?.id ?? null)])
```

Expected: `item_item1_fs`, `item_quantity1_fs`, … on line 1; the same column stems with `2` on line 2. **Verify that `core.columnIdFromSpanId(spanId, "item", line)` reproduces the stems**, including for any custom column whose id ends in a digit.

- [ ] **Step 6: Probe 5 — DEFERRED, do not run.** It requires a save and is diagnostic only: this design never reads or writes the serialized payload (spec §12 U1). Record "deferred, requires a save" in the transcript.

- [ ] **Step 7: Probe 6 — machine globals (informational only)**

```js
(() => {
  const m = globalThis.machines;
  const item = m?.item;
  return {
    machineKeys: m ? Object.keys(m) : null,
    dataManager: typeof item?.dataManager,
    buildtable: typeof item?.buildtable,
    postBuildTableListeners: Array.isArray(item?.postBuildTableListeners),
    currentRowNum: item?.currentRowNum ?? null
  };
})()
```

This is a console observation only. **Nothing in this plan depends on the result** — attachment is designed on the MutationObserver path (synthesis C2), and MAIN-world injection is a non-goal. If a repaint hook exists it is adopted later, behind the same `queueApply()` seam, as an optimization.

- [ ] **Step 8: Probe 6b — is the machine natively drag-ordered? (gates M6 and M7)**

```js
(() => {
  const t = document.querySelector('#item_splits');
  return {
    draggableTable: t.matches('.uir-draggable-table'),
    orderedContainer: Boolean(t.closest('.uir-list-machine-ordered')),
    movableCells: t.querySelectorAll('td.movable').length
  };
})()
```

Any `true`/non-zero ⇒ **row order is record data**: sort and filter refuse permanently for this machine, and M6/M7 close as not technically possible with this transcript as justification. `false/false/0` ⇒ M6 and M7 proceed. Either way the refusal stays in the code as an unconditional precondition (spec §7).

- [ ] **Step 9: Probes 6c and 6d — `data-field-name` and `data-machine-name`**

```js
({
  fieldNames: [...document.querySelector('#item_splits').rows]
    .find((r) => /_row_1$/.test(r.id))?.cells
    && [...document.querySelector('#item_splits').rows.find((r) => /_row_1$/.test(r.id)).cells]
      .map((c) => c.dataset.fieldName ?? null),
  machineNameAttr: document.querySelector('.uir-machine-table-container[data-machine-name]') !== null
})
```

Informational: this plan keys columns by `_fs` decode only (spec §5). Record whether `data-field-name` is present for a future simplification, and settle whether `src/styles/netsuite.css:1616`'s `data-machine-name` is dead code (U3). **No selector in `src/edit-grid/` may depend on either.**

- [ ] **Step 10: Probe 7 — what an open-line select rebuilds**

```js
globalThis.__smBefore = [...document.querySelector('#item_splits').rows];
```

Click the Item cell of line 1 to open it, then:

```js
[...document.querySelector('#item_splits').rows]
  .map((r, i) => [r.id || r.className, r === globalThis.__smBefore[i]])
```

Records the true rebuild scope of a select (which `<tr>` nodes are new objects). Then press Escape / click Cancel to close the line.

- [ ] **Step 11: Probe 9 — resize conflict model (gates M2's mechanism)**

```js
(() => {
  const t = document.querySelector('#item_splits');
  const h = t.querySelector('tr.uir-machine-headerrow');
  return {
    colgroups: t.querySelectorAll('colgroup').length,
    tableLayout: getComputedStyle(t).tableLayout,
    tableWidthStyle: t.style.width,
    headerCells: [...h.cells].map((c) => [c.getAttribute('width'), getComputedStyle(c).width])
  };
})()
```

Expected per the dossier: `colgroups: 0`, `tableLayout: "auto"`. If a `<colgroup>` or a non-auto `table-layout` exists, M2's mechanism must be re-derived — stop and report.

- [ ] **Step 12: Probe 10 — add a line, observe renumbering**

Click **Add** on the sublist (in-page only, no save), then:

```js
[...document.querySelector('#item_splits').rows]
  .filter((r) => /_row_\d+$/.test(r.id))
  .map((r) => [r.id, [...r.cells].map((c) => c.querySelector('span[id$="_fs"]')?.id ?? null)[0]])
```

Expected: every row id and `_fs` span id renumbered. This is the evidence behind "identity is re-derived on every install; a surviving stamp on a `<td>` is never trusted as identity". Remove the added line again before continuing.

- [ ] **Step 13: Probe 12 — page scope**

```js
[
  document.querySelectorAll('#item_splits tr.uir-machine-row').length,
  globalThis.nlapiGetLineItemCount?.('item') ?? null
]
```

Records rendered rows vs total lines. If they differ, the machine paginates and M6/M7's page-scope disclosure is mandatory (Q4).

- [ ] **Step 14: Probe 11 — the focus-into-hidden-cell hazard (informs M3)**

Hide one required column with the exact mechanism M3 will ship, then force a validation failure on that field:

```js
(() => {
  const t = document.querySelector('#item_splits');
  const style = document.createElement('style');
  style.id = 'sm-probe-11';
  style.textContent = '.sm-probe-hidden { display: none !important }';
  document.head.append(style);
  const h = t.querySelector('tr.uir-machine-headerrow');
  const index = [...h.cells].filter((c) => c.style.display !== 'none')
    .findIndex((c) => /quantity/i.test(c.textContent));
  for (const row of [...t.rows]) {
    const vis = [...row.cells].filter((c) => c.style.display !== 'none');
    vis[index]?.classList.add('sm-probe-hidden');
  }
  return index;
})()
```

Now open a line, clear the hidden required field's value if reachable, and click OK. Record: does the line refuse to commit, and is there a visible error? Then undo the probe:

```js
document.querySelector('#sm-probe-11')?.remove();
document.querySelectorAll('.sm-probe-hidden').forEach((c) => c.classList.remove('sm-probe-hidden'));
```

This transcript is the evidence that force-reveal on `focusin` and on validation failure is mandatory, not polish.

- [ ] **Step 15: Probe 8 — GATE A. The decisive probe. In-page only, never save.**

Re-verify the safety triple (Step 1) before starting. Then:

(a) Baseline a **non-focused** row:

```js
globalThis.__smGateA = [...document.querySelector('#item_row_2').cells]
  .filter((c) => c.style.display !== 'none')
  .map((c) => [c.querySelector('span[id$="_fs"]')?.id ?? null, c.textContent.trim()]);
globalThis.__smGateA
```

(b) Permute two `<td>`s in that row — visible cells only, never `row.cells[i]`:

```js
(() => {
  const row = document.querySelector('#item_row_2');
  const vis = [...row.cells].filter((c) => c.style.display !== 'none');
  row.insertBefore(vis[3], vis[1]);
  return [...row.cells]
    .filter((c) => c.style.display !== 'none')
    .map((c) => [c.querySelector('span[id$="_fs"]')?.id ?? null, c.textContent.trim()]);
})()
```

(c) Open line 3, change one field (e.g. Quantity), and click **OK** — an in-page line commit. **Nothing reaches the server; no Submit, no Save.**

(d) Read back:

```js
({
  permutedRow: [...document.querySelector('#item_row_2').cells]
    .filter((c) => c.style.display !== 'none')
    .map((c) => [c.querySelector('span[id$="_fs"]')?.id ?? null, c.textContent.trim()]),
  baseline: globalThis.__smGateA,
  viaApi: globalThis.nlapiGetLineItemValue?.('item', 'quantity', 2) ?? null
})
```

(e) **Verdict.** Each value is still paired with its own `_fs` span id (the pairs in `permutedRow` match `baseline` pairwise, only reordered) ⇒ the repaint is **id-addressed** ⇒ **Gate A PASS ⇒ M4 ships**. Any value has moved into a different column's span ⇒ the repaint is **index-addressed** ⇒ **Gate A FAIL ⇒ M4 closes as not technically possible** (Q3: nothing is built as a substitute).

(f) **Teardown: navigate away.** Load `https://6998262.app.netsuite.com/app/accounting/transactions/salesord.nl?id=16342809` (the view URL) to discard the in-page state. **Never click Submit or Save.**

(g) Have an **Opus 5** subagent independently read the (a)/(d) transcripts and state the verdict. The captain does not interpret this result alone.

- [ ] **Step 16: Create `docs/testing-log.md`**

```markdown
# SuiteMate V3 — live testing log

One line per live session against the locked record (account `6998262`,
Sales Order `id=16342809`, and the same record with `&e=T`). A session with no
save still leaves a line. Save lines additionally record the four-eyes gate
verdict.

| Timestamp | Milestone | Exercised | Evidence | Gate verdict |
|---|---|---|---|---|
| 2026-08-02 <HH:MM> AEST | M1 | Dossier §12 probes 1, 2, 3, 4, 6, 6b, 6c, 6d, 7, 8, 9, 10, 11, 12 on `id=16342809&e=T`; read-only except probe 8's authorized in-page line commit; probe 5 deferred (requires a save) | Transcripts in `save/CHECKPOINTS.md` M1 entry | No save; four-eyes gate not invoked. Gate A: <PASS id-addressed / FAIL index-addressed>. Native drag-order (probe 6b): <yes/no> |
```

Replace `<HH:MM>` and both `<…>` verdicts with the observed values before committing. **No `<`-bracketed placeholder may survive the commit.**

- [ ] **Step 17: Commit**

```bash
git add docs/testing-log.md
git commit -m "docs: record the Edit Mode live probe pass and the Gate A verdict"
```

### Task 10: M1 checkpoint

**Files:**
- Modify: `save/CHECKPOINTS.md`

**Interfaces:**
- Consumes: Tasks 1-9.
- Produces: the recorded Gate A and drag-order verdicts that M4, M6 and M7 read.

- [ ] **Step 1: Full gate**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
npm run fixtures:verify 2>&1 | tail -5
```

Expected: `ℹ tests 222`, `ℹ pass 222`, `ℹ fail 0`; 28 baselines at **0.000 %**. A moved baseline is a defect — do not refresh it.

- [ ] **Step 2: View Mode regression (explicit)**

(a) Load `https://6998262.app.netsuite.com/app/accounting/transactions/salesord.nl?id=16342809` (view mode, same record) and confirm: grid column personalization, sort, filter and widths all behave; Export view produces data rows, not headers-only; tab titles and internal-id badges unaffected; **zero SuiteMate console errors**. An Opus 5 subagent reads the DOM evidence and states pass/fail.

(b) The mechanical guard:

```bash
git diff --name-only main | grep so-columns
```

Expected: exactly `src/so-columns/core.js` (the one-token `FOREIGN_NODE_SELECTOR` addition) and nothing else.

- [ ] **Step 3: Append the checkpoint entry** to `save/CHECKPOINTS.md`:

```markdown
## Edit Mode Table Enhancements: Milestone M1 (shared foundation)

Status: Complete
Date: 2026-08-02

### Included

- New additive capability `TRANSACTION_COLUMN_PERSONALIZATION_EDIT` in `src/shared/routes.js` (Sales Orders, top frame, `id` + `e` present). It is the exact byte-complement of the two `!hasParam(context, "e")` view-mode rules, so the modes are mutually exclusive by construction; existing cases untouched and their negatives unedited.
- `src/edit-grid/{core.js,runtime.js,edit-grid.css}`: a parallel module family sharing no code, no storage key and no CSS with `src/so-columns/`. The core carries the frozen contract, the six-part storage doctrine on its own key `suiteMateV3EditColumns` (container schema 1, `grids` keyed by `{company}:{user}:{type}:edit`), and Edit-Mode-native identity — the column axis is `visibleCells()` (inline `display:none` excluded, SuiteMate's class-based hiding retained) and column ids are decoded from `{machine}_{column}{line}_fs` spans against the row's own line number. The runtime mounts, stamps, binds one delegated-listener set under `BOUND_ATTRIBUTE`, early-returns on identity, and tears down synchronously to zero owned nodes — and does nothing visible.
- Settings schema v5→v6 with the full ripple and a new default-off opt-in toggle "Sales Order columns (Edit Mode)" (`salesOrderColumnsEdit`); registration is `startPaused`, which is why the 28 screenshot baselines cannot move.
- `tests/fixtures/sales-order-edit.html`: self-loading Edit Mode fixture (`?id=1&e=T`) with system `display:none` cells, `_fs` spans, `item_row_N` ids, a `machineButtonRow`, a totals row and a `buildtable()`-style full `<tbody>` regenerate. Deliberately NOT in `route-catalog.js`, which keeps the baseline count at 28. `chrome-stub` serves the new key with an `editGridWrites` counter.
- Coexistence: all four `FOREIGN_NODE_SELECTOR` lists (so-columns, form-views, csv-export view snapshot, tab-title) now exclude `[data-suitemate-v3-edit-grid]` — one token each, four insertions, zero test edits.

### Verification

- Full `npm test`: 222 passing; 28 screenshot baselines untouched at 0.000 percent.
- Fixture round-trip: mounts on `?e=T` with the marker and the bound attribute present; route gate returns `[edit true, view false]` on `?id=1&e=T` and `[edit false, view true]` on `?id=1` — the H3 complement asserted at the gate, not at the DOM; full `<tbody>` regenerate + add-line + open-line + close-line produced ZERO storage writes over 500 ms; teardown left zero owned nodes and removed the bound attribute; computed `table-layout` stayed `auto` and every row stayed visible (nothing visible shipped).
- View Mode regression on the same record `id=16342809`: personalization, sort, filter, widths, Export view, tab titles and internal-id badges all behave; zero SuiteMate console errors. `git diff --name-only main | grep so-columns` returns exactly `src/so-columns/core.js`.
- Live probe pass on `id=16342809&e=T`, read-only except the authorized in-page probe 8; no save occurred, so the four-eyes gate was not invoked; teardown by navigating away. `docs/testing-log.md` created.

#### Probe transcripts (verbatim)

<paste the raw console output of probes 1, 2, 3, 4, 6, 6b, 6c, 6d, 7, 8, 9, 10, 11, 12 here; probe 5 recorded as "deferred, requires a save">

#### Binding verdicts

- **Gate A (probe 8)**: <PASS — repaint is id-addressed, M4 ships / FAIL — repaint is index-addressed, M4 closes as not technically possible>.
- **Native drag-order machine (probe 6b)**: <no — M6 and M7 proceed / yes — row order is record data, M6 and M7 close as not technically possible>.
- **Page scope (probe 12)**: <rendered rows> of <total lines> — page-scope disclosure in the M6/M7 UI is <mandatory / still shipped per Q4>.
```

Replace every `<…>` with the observed values. **No `<`-bracketed placeholder may survive the commit.**

- [ ] **Step 4: Commit**

```bash
git add save/CHECKPOINTS.md
git commit -m "docs: M1 checkpoint — Edit Mode foundation attached, Gate A answered"
```

---

# Milestone M2 — Column resizing

Four tasks. The first user-visible Edit Mode feature.

### Task 11: `core.applyWidths` and `core.columnMinimums`

**Files:**
- Modify: `src/edit-grid/core.js` (new functions after `isOrderedMachine`; export block)
- Test: `tests/edit-grid.test.mjs` (extend the cell stub; add two tests before the source-purity test)

**Interfaces:**
- Consumes: `clampWidth`, `headerRow`, `visibleCells`, `alignsToHeader`, `tableRows`, `readColumnIds`, `isPlainObject` (Task 5).
- Produces: `core.columnMinimums(table, columnIds) -> { [columnId]: number }` (the widest widget `offsetWidth` per column, 0 when a column has no widget) and `core.applyWidths(table, widths, minimums) -> boolean`. Task 12 calls both; `null`/`{}` widths restores the native layout.

- [ ] **Step 1: Extend the cell stub.** In `tests/edit-grid.test.mjs`, give `createCell` a `widget` option and a `querySelectorAll`:

```js
function createCell({ text = "", spanId = null, systemHidden = false, width = 100, widget = 0 } = {}) {
  const classes = new Set();
  const widgets = widget ? [{ offsetWidth: widget }] : [];
  return {
    textContent: text,
    style: { display: systemHidden ? "none" : "", width: "" },
    offsetWidth: width,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const on = force ?? !classes.has(name);
        if (on) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        return on;
      }
    },
    getBoundingClientRect: () => ({ width }),
    querySelector: (selector) => (spanId && selector.includes("_fs") ? { id: spanId } : null),
    querySelectorAll: (selector) => (selector.includes("input") ? widgets : [])
  };
}
```

- [ ] **Step 2: Write the failing tests** — insert before the source-purity test:

```js
test("derives a per-column minimum from the widest widget in that column", () => {
  const core = createApi();
  const table = createMachine();
  // Line 1 quantity carries a 180px input; nothing else carries a widget.
  table.rows[1].cells[1] = createCell({ text: "2", spanId: "item_quantity1_fs", widget: 180 });
  const minimums = core.columnMinimums(table, ["item", "quantity", "rate"]);
  assert.deepEqual(plain(minimums), { item: 0, quantity: 180, rate: 0 });
});

test("applies widths to header cells only, clamped per column, and restores on clear", () => {
  const core = createApi();
  const table = createMachine();
  table.rows[1].cells[1] = createCell({ text: "2", spanId: "item_quantity1_fs", widget: 180 });
  const columnIds = core.readColumnIds(table);
  const minimums = core.columnMinimums(table, columnIds);

  assert.equal(core.applyWidths(table, { item: 240, quantity: 60, rate: 20 }, minimums), true);
  const header = core.visibleCells(table.rows[0]);
  // 240 as stored; quantity floored at its 180px widget, never at 30 or 50;
  // rate floored at the absolute 50px input floor.
  assert.deepEqual(header.map((cell) => cell.style.width), ["240px", "180px", "50px"]);
  assert.equal(table.style.tableLayout, "fixed");
  // table.style.width is left unset so the machine keeps its own sizing.
  assert.equal(table.style.width, "");
  // Body cells are never touched: fixed layout makes row 1 authoritative.
  assert.deepEqual(core.visibleCells(table.rows[1]).map((cell) => cell.style.width), ["", "", ""]);
  // The system cell is off the axis and never receives a width.
  assert.equal(table.rows[1].cells[3].style.width, "");

  assert.equal(core.applyWidths(table, null, minimums), true);
  assert.deepEqual(header.map((cell) => cell.style.width), ["", "", ""]);
  assert.equal(table.style.tableLayout, "");
  assert.equal(core.applyWidths(null, { item: 100 }, {}), false);
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
node --test tests/edit-grid.test.mjs 2>&1 | grep -E "not ok|ℹ fail"
```

Expected: FAIL — `core.columnMinimums is not a function`.

- [ ] **Step 4: Implement in `src/edit-grid/core.js`** — add after `isOrderedMachine`:

```js
  // ===== Widths =====
  function columnMinimums(table, columnIds) {
    const minimums = {};
    if (!Array.isArray(columnIds) || !columnIds.length) {
      return minimums;
    }
    for (const id of columnIds) {
      if (id) {
        minimums[id] = 0;
      }
    }
    try {
      const header = headerRow(table);
      for (const row of tableRows(table)) {
        if (row === header || !alignsToHeader(row, columnIds)) {
          continue;
        }
        visibleCells(row).forEach((cell, index) => {
          const id = columnIds[index];
          if (!id) {
            return;
          }
          for (const widget of Array.from(cell?.querySelectorAll?.("input, select, textarea") ?? [])) {
            minimums[id] = Math.max(minimums[id] ?? 0, Number(widget?.offsetWidth) || 0);
          }
        });
      }
    } catch {}
    return minimums;
  }

  function applyWidths(table, widths, minimums) {
    try {
      const header = headerRow(table);
      if (!header) {
        return false;
      }
      const cells = visibleCells(header);
      const active = isPlainObject(widths) && Object.keys(widths).length > 0;
      if (!active) {
        for (const cell of cells) {
          if (cell.style) {
            cell.style.width = "";
          }
        }
        if (table.style) {
          table.style.tableLayout = "";
        }
        return true;
      }
      const columnIds = readColumnIds(table);
      if (cells.length !== columnIds.length) {
        return false;
      }
      // Freeze every column at its stored or currently rendered width so the
      // flip to fixed layout is pixel-identical; fixed layout then reads row 1
      // only, so repainted data cells cannot disturb the columns. table.style
      // .width is deliberately left unset.
      cells.forEach((cell, index) => {
        const id = columnIds[index];
        const stored = id ? Number(widths[id]) : Number.NaN;
        const rendered = Math.round(cell.getBoundingClientRect?.().width ?? 0);
        const target = Number.isFinite(stored) ? stored : rendered;
        if (target > 0 && cell.style) {
          cell.style.width = `${clampWidth(target, minimums?.[id])}px`;
        }
      });
      if (table.style) {
        table.style.tableLayout = "fixed";
      }
      return true;
    } catch {
      return false;
    }
  }
```

Add `columnMinimums,` and `applyWidths,` to the frozen export object beside `isOrderedMachine`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 224`, `ℹ pass 224`, `ℹ fail 0`; 28 baselines at 0.000 %.

- [ ] **Step 6: Commit**

```bash
git add src/edit-grid/core.js tests/edit-grid.test.mjs
git commit -m "feat: edit-grid width planner with per-column widget minimums"
```

### Task 12: Runtime resize interaction and width persistence

**Files:**
- Modify: `src/edit-grid/runtime.js` (module state; new resize section; `renderSignature`, `targetSignature`, `applyAll`, `removeEditGrid`, `DELEGATED_LISTENERS`)

**Interfaces:**
- Consumes: `core.columnMinimums`, `core.applyWidths`, `core.clampWidth`, `core.withWidths` (Tasks 5, 11); `enqueueSave`, `queueApply`, `isLineOpen`, `showToast`, `scopeKey`, `entry` (Task 6).
- Produces: `columnWidths` module state (`{ [columnId]: number }`), `applyCurrentWidths(table, columnIds)`, `saveWidths()`, `handleResizeHover/Down/Move/Up`, `RESIZE_EDGE_PX = 5`.

- [ ] **Step 1: Add module state.** Beside `let pendingApply = false;` add:

```js
  let columnWidths = {};
  let resizing = null;
  const RESIZE_EDGE_PX = 5;
```

- [ ] **Step 2: Add the resize section** after `forcedRows()`:

```js
  // ===== Resize =====
  function headerCellsOf(table) {
    return core.visibleCells(core.headerRow(table));
  }

  function resizeEdgeCell(table, event) {
    // A 5px zone on the right edge of a header cell. NetSuite's own field help
    // lives on .listheader inside the cell, so anything outside this zone stays
    // native (src/styles/netsuite.css:1616-1623).
    for (const cell of headerCellsOf(table)) {
      const rect = cell.getBoundingClientRect();
      if (
        event.clientX >= rect.right - RESIZE_EDGE_PX
        && event.clientX <= rect.right + 1
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom
      ) {
        return cell;
      }
    }
    return null;
  }

  function columnIdOfHeaderCell(table, cell) {
    const columnIds = core.readColumnIds(table);
    const index = headerCellsOf(table).indexOf(cell);
    return index >= 0 ? columnIds[index] ?? null : null;
  }

  function handleResizeHover(event) {
    const table = event.target?.closest?.(core.MACHINE_TABLE_SELECTOR);
    if (!table || resizing) {
      return;
    }
    const edge = resizeEdgeCell(table, event);
    for (const cell of headerCellsOf(table)) {
      cell.classList.toggle(core.CLASSES.resizeEdge, cell === edge);
    }
  }

  function handleResizeDown(event) {
    try {
      const table = event.target?.closest?.(core.MACHINE_TABLE_SELECTOR);
      if (!table || event.button !== 0) {
        return;
      }
      const cell = resizeEdgeCell(table, event);
      const columnId = cell ? columnIdOfHeaderCell(table, cell) : null;
      if (!cell || !columnId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Prefer the applied style width: live NetSuite collapsed borders render
      // ~2px over the style value and re-measuring rects would accumulate it.
      const styleWidth = Number.parseInt(cell.style?.width ?? "", 10);
      resizing = {
        table,
        columnId,
        startX: event.clientX,
        startWidth: Number.isFinite(styleWidth) ? styleWidth : cell.getBoundingClientRect().width,
        minimum: core.columnMinimums(table, core.readColumnIds(table))[columnId] ?? 0
      };
      document.body.classList.add("suitemate-v3-edit-grid-resizing");
      document.addEventListener("pointermove", handleResizeMove, true);
      document.addEventListener("pointerup", handleResizeUp, true);
    } catch {
      handleResizeUp();
    }
  }

  function handleResizeMove(event) {
    if (!resizing) {
      return;
    }
    const next = core.clampWidth(
      resizing.startWidth + (event.clientX - resizing.startX),
      resizing.minimum
    );
    columnWidths = { ...columnWidths, [resizing.columnId]: next };
    applyCurrentWidths(resizing.table, core.readColumnIds(resizing.table));
  }

  function handleResizeUp() {
    document.removeEventListener("pointermove", handleResizeMove, true);
    document.removeEventListener("pointerup", handleResizeUp, true);
    document.body.classList.remove("suitemate-v3-edit-grid-resizing");
    if (!resizing) {
      return;
    }
    resizing = null;
    saveWidths();
  }

  function applyCurrentWidths(table, columnIds) {
    core.applyWidths(
      table,
      Object.keys(columnWidths).length ? columnWidths : null,
      core.columnMinimums(table, columnIds)
    );
  }

  function saveWidths() {
    return enqueueSave(async () => {
      try {
        if (!scopeKey) {
          return;
        }
        const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
        const next = core.withWidths(
          stored[core.STORAGE_KEY],
          scopeKey,
          Object.keys(columnWidths).length ? columnWidths : null
        );
        if (!next) {
          showToast("Column layout could not be saved.", "warning");
          return;
        }
        await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
      } catch {
        showToast("Column layout could not be saved.", "warning");
      }
    });
  }
```

- [ ] **Step 3: Extend the three seams.** Replace `renderSignature`, `targetSignature` and `applyAll` with:

```js
  function renderSignature(table, columnIds) {
    return JSON.stringify({
      ids: columnIds,
      layout: table?.style?.tableLayout ?? "",
      widths: headerCellsOf(table).map((cell) => cell.style?.width ?? "")
    });
  }

  function targetSignature(table, columnIds) {
    const active = Object.keys(columnWidths).length > 0;
    const minimums = core.columnMinimums(table, columnIds);
    return JSON.stringify({
      ids: columnIds,
      layout: active ? "fixed" : "",
      widths: headerCellsOf(table).map((cell, index) => {
        if (!active) {
          return "";
        }
        const id = columnIds[index];
        const stored = Number(columnWidths[id]);
        const rendered = Math.round(cell.getBoundingClientRect?.().width ?? 0);
        const target = Number.isFinite(stored) ? stored : rendered;
        return target > 0 ? `${core.clampWidth(target, minimums[id])}px` : "";
      })
    });
  }

  function applyAll(table, columnIds) {
    applyCurrentWidths(table, columnIds);
  }
```

- [ ] **Step 4: Restore state on install and release it on teardown.** In `installEditGrid`, immediately after `entry = core.normalizeStored(…).grids[scopeKey] ?? {};` add:

```js
      columnWidths = { ...(entry.widths ?? {}) };
```

In `removeEditGrid`, inside the `try`, after `releaseBindings(machineContainer(table));` add:

```js
      handleResizeUp();
      core.applyWidths(table, null, {});
      columnWidths = {};
```

- [ ] **Step 5: Register the delegated listeners.** Replace the `DELEGATED_LISTENERS` literal with:

```js
  const DELEGATED_LISTENERS = [
    ["pointermove", handleResizeHover],
    ["pointerdown", handleResizeDown]
    // M3 adds focusin, M5 the control clicks, M6/M7 the header menu.
  ];
```

- [ ] **Step 6: Syntax and suite**

```bash
node --check src/edit-grid/runtime.js && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: no syntax error; `ℹ tests 224`, `ℹ pass 224`, `ℹ fail 0`; 28 baselines at 0.000 %.

- [ ] **Step 7: Fixture round-trip — computed px survive a repaint, one gesture = one write**

Serve the fixture (`python3 -m http.server 8931`) and open
`http://localhost:8931/tests/fixtures/sales-order-edit.html?salesOrderColumnsEdit=true`, then in the console:

```js
const table = document.querySelector("#item_splits");
const header = () => [...table.querySelector("tr.uir-machine-headerrow").cells]
  .filter((c) => c.style.display !== "none");

// One drag gesture on the Quantity edge = exactly one storage write.
delete document.documentElement.dataset.editGridWrites;
const cell = header()[1];
const rect = cell.getBoundingClientRect();
const at = (type, x, target) => target.dispatchEvent(
  new PointerEvent(type, { clientX: x, clientY: rect.top + 4, button: 0, bubbles: true }));
at("pointerdown", rect.right - 1, cell);
at("pointermove", rect.right + 60, document);
at("pointerup", rect.right + 60, document);
await new Promise((r) => setTimeout(r, 500));
console.log("writes:", document.documentElement.dataset.editGridWrites);        // expect "1"
console.log("stored:", JSON.stringify(SuiteMateV3Fixture.editColumns));
console.log("computed:", header().map((c) => getComputedStyle(c).width));
console.log("layout:", getComputedStyle(table).tableLayout);                    // expect "fixed"

// Widths survive a full <tbody> regenerate, add-line and remove-line…
const before = header().map((c) => getComputedStyle(c).width);
SuiteMateV3EditFixture.repaint();
SuiteMateV3EditFixture.addLine();
SuiteMateV3EditFixture.removeLine(4);
await new Promise((r) => setTimeout(r, 300));
console.log("after repaint:", header().map((c) => getComputedStyle(c).width), before);

// …and re-apply from seeded storage with ZERO writes.
delete document.documentElement.dataset.editGridWrites;
location.reload();
// after reload:
await new Promise((r) => setTimeout(r, 500));
console.log("reload writes:", document.documentElement.dataset.editGridWrites ?? "0");   // "0"
```

Expected: `writes: "1"`; the stored container is `{schemaVersion:1,grids:{"FIXTURE:1:salesord:edit":{widths:{quantity:<n>}}}}`; computed widths match the applied px; `layout: fixed`; the width array after repaint/add/remove equals `before`; `reload writes: 0`. **Assert at computed style — never at a class name or the `hidden` attribute.**

- [ ] **Step 8: Commit**

```bash
git add src/edit-grid/runtime.js
git commit -m "feat: Edit Mode column resizing persisted under the edit-grid key"
```

### Task 13: M2 live pass and View Mode regression

**Files:**
- Modify: `docs/testing-log.md`

**Interfaces:**
- Consumes: the shipped M2 build.
- Produces: the live evidence quoted in the M2 checkpoint entry.

**SAFETY PROTOCOL — restated in full because it binds every browser action in this task:**

1. **Record lock.** Account `6998262`, `id=16342809`, and no other record or transaction. The lock explicitly covers **the same record with `&e=T` appended** (Q2). Before ANY interaction, confirm the URL bar shows account `6998262` and `id=16342809`. Any other record or account: **stop and report**. Never create additional test Sales Orders. Never open other transactions in Edit Mode.
2. **Safety triple — verify all three BEFORE testing begins and again BEFORE every save:** `custbody_salesorder_issue` checked (true); Status = Pending Approval; Memo clearly indicates a testing record. Any failure at any point: do **not** save, stop, report immediately.
3. **Four-eyes save gate.** Before every save: the captain gathers evidence (URL bar showing account + id, the three safety fields, and a one-paragraph statement of exactly what the save changes and why), dispatches an **Opus 5** subagent as the save gate, and the gate answers exactly **GO** or **NO-GO**. Default **NO-GO**; missing, stale or ambiguous evidence means NO-GO. Save only on GO; on NO-GO stop and report. The first save of a session additionally requires the owner's explicit go-ahead in chat.
4. **This milestone requires no save.** Every check below is in-page. If a step appears to need a save, stop and report instead of improvising.
5. **Forbidden regardless of anything else:** Approve, Reject, Bill, Fulfill, Email, Print, Delete, Make Copy, or any status-changing or document-sending action.
6. **Every interpretation question is answered by an Opus 5 subagent from DOM evidence**, never by the captain's own reading. Browser testing stays sequential.
7. **Append one line to `docs/testing-log.md` for this session** and ship it in the M2 checkpoint commit.

- [ ] **Step 1: Ask the owner for the human actions, in one interrupt.** Extension reload and popup toggles cannot be automated. Request both together: (a) reload the unpacked extension at `chrome://extensions`; (b) open the SuiteMate popup and switch **"Sales Order columns (Edit Mode)" ON**, leaving the View Mode toggles as they are. Wait for confirmation before proceeding.

- [ ] **Step 2: Verify the safety triple on the locked record in Edit Mode**

Navigate to `https://6998262.app.netsuite.com/app/accounting/transactions/salesord.nl?id=16342809&e=T` and read back the URL, account, `custbody_salesorder_issue`, Status and Memo via DOM (the exact snippet is in Task 9 Step 1). Any deviation: stop and report.

- [ ] **Step 3: Exercise resize across every native behaviour**

Drag the right edge of two header cells (one widget-bearing column such as Quantity, one text column such as Item). After each of the following, capture `getComputedStyle` widths of every visible header cell and confirm they are unchanged:

- open a line (click a cell), then close it (Cancel);
- add a line (**Add**), then remove it (**Remove**);
- trigger a recalculation (change a Quantity and commit the line in-page);
- scroll the machine container horizontally.

Also confirm: no double scrollbar inside `.uir-machine-table-container`; NetSuite's native field help still opens when clicking the header **outside** the 5 px edge zone; the resize cursor appears only inside it.

```js
(() => {
  const t = document.querySelector('#item_splits');
  const h = t.querySelector('tr.uir-machine-headerrow');
  return {
    layout: getComputedStyle(t).tableLayout,
    tableWidthStyle: t.style.width,
    widths: [...h.cells].filter((c) => c.style.display !== 'none')
      .map((c) => getComputedStyle(c).width),
    containerScroll: (() => {
      const c = t.closest('.uir-machine-table-container');
      return [c.scrollWidth > c.clientWidth, document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth];
    })()
  };
})()
```

Expected: `layout: "fixed"`, `tableWidthStyle: ""`, identical width arrays across all four interactions. An **Opus 5** subagent reads the four captures and states pass/fail.

- [ ] **Step 4: Confirm mode isolation in storage**

```js
await chrome.storage.sync.get(["suiteMateV3EditColumns", "suiteMateV3ColumnOrder"])
```

Expected: only a `…:salesord:edit` scope appears under `suiteMateV3EditColumns`; `suiteMateV3ColumnOrder` is byte-identical to its value before the session (capture it before Step 3 and diff the JSON strings).

- [ ] **Step 5: View Mode regression (explicit)**

(a) Load `https://6998262.app.netsuite.com/app/accounting/transactions/salesord.nl?id=16342809` (view mode, same record) and confirm: column personalization, sort, filter and widths behave; Export view produces data rows, not headers-only; tab titles and internal-id badges unaffected; **zero SuiteMate console errors**. An Opus 5 subagent reads the DOM evidence and states pass/fail.

(b) ```bash
git diff --name-only main | grep so-columns
```
Expected: exactly `src/so-columns/core.js`.

- [ ] **Step 6: Append the log line** to `docs/testing-log.md`:

```markdown
| 2026-08-0X <HH:MM> AEST | M2 | Column resize on `id=16342809&e=T`: two columns dragged, widths held across open-line / add-line / remove-line / recalc / horizontal scroll; field help intact outside the 5px edge; `suiteMateV3ColumnOrder` byte-identical before and after | `save/CHECKPOINTS.md` M2 entry | No save; four-eyes gate not invoked |
```

- [ ] **Step 7: Commit**

```bash
git add docs/testing-log.md
git commit -m "docs: record the M2 live resize pass"
```

### Task 14: M2 checkpoint

**Files:**
- Modify: `save/CHECKPOINTS.md`

- [ ] **Step 1: Full gate**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
npm run fixtures:verify 2>&1 | tail -5
```

Expected: `ℹ tests 224`, `ℹ pass 224`, `ℹ fail 0`; 28 baselines at **0.000 %**.

- [ ] **Step 2: Append the checkpoint entry**

```markdown
## Edit Mode Table Enhancements: Milestone M2 (column resizing)

Status: Complete
Date: 2026-08-0X

### Included

- `core.applyWidths` freezes every visible header cell at its stored or rendered width and flips the machine to `table-layout: fixed`, leaving `table.style.width` unset — fixed layout reads row 1 only, so repainted data cells cannot disturb the columns. Body cells are never touched.
- `core.columnMinimums` derives a per-column floor from the widest `input`/`select`/`textarea` in that column, clamped up from the absolute 50px floor (`src/styles/netsuite.css:2999-3001` sizes machine inputs at `width: calc(100% - 21px)`, so a column under ~50 px leaves the widget unusable). The View Mode global 30px floor is never used: it would clip a text input to unusability.
- Runtime resize: a 5px right-edge zone on header cells, delegated `pointermove`/`pointerdown` on the container only (never per cell), pointer capture on `document` for the drag, one serialized save on pointer-up. Widths restore from the new key on install and re-apply after every repaint through the shared `applyAll` seam.

### Verification

- Full `npm test`: 224 passing; 28 screenshot baselines untouched at 0.000 percent.
- Fixture: one drag gesture produced EXACTLY one storage write and then nothing for 500ms; computed header widths survived a full `<tbody>` regenerate plus add-line and remove-line unchanged; seeded storage + reload re-applied the widths with ZERO writes; computed `table-layout` was `fixed` and `table.style.width` stayed unset.
- Live on `id=16342809&e=T`: widths held across open-line, add-line, remove-line, recalc and horizontal scroll; no double scrollbar; native field help still opens outside the 5px edge zone; `suiteMateV3ColumnOrder` byte-identical before and after the session.
- View Mode regression on the same record: personalization, sort, filter, widths, Export view, tab titles and internal-id badges all behave; zero SuiteMate console errors. `git diff --name-only main | grep so-columns` returns exactly `src/so-columns/core.js`.
```

- [ ] **Step 3: Commit**

```bash
git add save/CHECKPOINTS.md
git commit -m "docs: M2 checkpoint — Edit Mode column resizing shipped"
```

---

# Milestone M3 — Hide / show columns

Four tasks. Closes the display-defeats-hidden defect class for a fourth time, with computed-level evidence.

### Task 15: `core.applyHidden` and the label reader

**Files:**
- Modify: `src/edit-grid/core.js` (new functions after `applyWidths`; export block)
- Test: `tests/edit-grid.test.mjs` (two tests before the source-purity test)

**Interfaces:**
- Consumes: `headerRow`, `visibleCells`, `alignsToHeader`, `isExcludedRow`, `tableRows`, `CLASSES.colHidden`, `FOREIGN_NODE_SELECTOR` (Task 5).
- Produces: `core.applyHidden(table, hiddenIds, columnIds) -> boolean`, `core.readCellText(cell) -> string`, `core.readHeaderLabels(table, columnIds) -> string[]`. Task 16 uses all three; M6/M7 reuse `readCellText` for filter and sort keys.

- [ ] **Step 1: Write the failing tests** — insert before the source-purity test:

```js
test("hides a column across the header and every aligned row only", () => {
  const core = createApi();
  const table = createMachine();
  const columnIds = core.readColumnIds(table);
  assert.equal(core.applyHidden(table, ["quantity"], columnIds), true);

  const hiddenFlags = (row) => core.visibleCells(row)
    .map((cell) => cell.classList.contains("suitemate-v3-edit-grid-col-hidden"));
  assert.deepEqual(hiddenFlags(table.rows[0]), [false, true, false]);
  assert.deepEqual(hiddenFlags(table.rows[1]), [false, true, false]);
  assert.deepEqual(hiddenFlags(table.rows[2]), [false, true, false]);
  // The system cell keeps its own inline display:none and is never classed.
  assert.equal(table.rows[1].cells[3].classList.contains("suitemate-v3-edit-grid-col-hidden"), false);
  // machineButtonRow and the totals row are never touched.
  assert.equal(table.rows[3].cells[0].classList.contains("suitemate-v3-edit-grid-col-hidden"), false);
  assert.equal(table.rows[4].cells[0].classList.contains("suitemate-v3-edit-grid-col-hidden"), false);

  // The class does not change the axis: a SuiteMate-hidden column stays on it.
  assert.deepEqual(plain(core.readColumnIds(table)), ["item", "quantity", "rate"]);
  // Idempotent, and revealing is a clean toggle back.
  assert.equal(core.applyHidden(table, ["quantity"], columnIds), true);
  assert.deepEqual(hiddenFlags(table.rows[1]), [false, true, false]);
  assert.equal(core.applyHidden(table, [], columnIds), true);
  assert.deepEqual(hiddenFlags(table.rows[1]), [false, false, false]);
  assert.equal(core.applyHidden(null, ["quantity"], columnIds), false);
});

test("reads header labels with SuiteMate's own injected nodes excluded", () => {
  const core = createApi();
  const table = createMachine();
  const badge = { textContent: "42", matches: () => true };
  table.rows[0].cells[0] = {
    ...table.rows[0].cells[0],
    textContent: "Item42",
    cloneNode: () => ({
      textContent: "Item",
      querySelectorAll: () => [badge]
    }),
    querySelector: (selector) => (selector.includes("suitemate") ? badge : null)
  };
  assert.deepEqual(
    plain(core.readHeaderLabels(table, core.readColumnIds(table))),
    ["Item", "Quantity", "Rate"]
  );
  assert.equal(core.readCellText({ textContent: "  Rate  ", querySelector: () => null }), "Rate");
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test tests/edit-grid.test.mjs 2>&1 | grep -E "not ok|ℹ fail"
```

Expected: FAIL — `core.applyHidden is not a function`.

- [ ] **Step 3: Implement in `src/edit-grid/core.js`** — add after `applyWidths`:

```js
  // ===== Hide / show =====
  function readCellText(cell) {
    try {
      if (typeof cell?.querySelector === "function" && !cell.querySelector(FOREIGN_NODE_SELECTOR)) {
        return String(cell.textContent ?? "").trim();
      }
      const clone = cell?.cloneNode?.(true);
      if (clone?.querySelectorAll) {
        // Labels must come from NetSuite's own text only: SuiteMate and any
        // future feature may inject badge nodes into these cells.
        for (const foreign of Array.from(clone.querySelectorAll(FOREIGN_NODE_SELECTOR))) {
          foreign.remove?.();
        }
        return String(clone.textContent ?? "").trim();
      }
    } catch {}
    return String(cell?.textContent ?? "").trim();
  }

  function readHeaderLabels(table, columnIds) {
    const cells = visibleCells(headerRow(table));
    return cells.map((cell, index) => readCellText(cell) || columnIds?.[index] || "");
  }

  function applyHidden(table, hiddenIds, columnIds) {
    try {
      if (!headerRow(table) || !Array.isArray(columnIds) || !columnIds.length) {
        return false;
      }
      const hidden = new Set(Array.isArray(hiddenIds) ? hiddenIds : []);
      const flags = columnIds.map((id) => hidden.has(id));
      for (const row of tableRows(table)) {
        // An open line carries focus-only spacer cells, so it does not align and
        // is therefore never hidden — force-reveal rule 3, for free.
        if (isExcludedRow(row) || !alignsToHeader(row, columnIds)) {
          continue;
        }
        visibleCells(row).forEach((cell, index) => {
          cell?.classList?.toggle?.(CLASSES.colHidden, flags[index]);
        });
      }
      return true;
    } catch {
      return false;
    }
  }
```

Add `readCellText,`, `readHeaderLabels,` and `applyHidden,` to the frozen export object.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 226`, `ℹ pass 226`, `ℹ fail 0`; 28 baselines at 0.000 %.

- [ ] **Step 5: Commit**

```bash
git add src/edit-grid/core.js tests/edit-grid.test.mjs
git commit -m "feat: edit-grid hide planner with foreign-node-safe header labels"
```

### Task 16: Runtime hide/show, control bar and force-reveal

**Files:**
- Modify: `src/edit-grid/runtime.js` (module state; new control-bar and hide sections; `renderSignature`, `targetSignature`, `applyAll`, `installEditGrid`, `removeEditGrid`, `DELEGATED_LISTENERS`)

**Interfaces:**
- Consumes: `core.applyHidden`, `core.readHeaderLabels`, `core.withHidden` (Tasks 5, 15); `enqueueSave`, `queueApply`, `isLineOpen`, `showToast`, `headerCellsOf` (Tasks 6, 12).
- Produces: `hiddenColumns: Set<string>`, `sessionRevealed: Set<string>`, `effectiveHidden() -> Set<string>`, `applyCurrentHidden(table, columnIds)`, `saveHidden()`, `ensureControls(container)`, `renderChips(table, columnIds)`, `setColumnHidden(columnId, hidden)`, `revealColumn(columnId)`, `revealAll(message)`, `handleFocusIn(event)`, `handleContainerClick(event)`, `controlButtons` (`{ bar, columnsButton, chips, menu }`). M5 extends `ensureControls`; M6/M7 extend `handleContainerClick`.

- [ ] **Step 1: Add module state.** Beside `let columnWidths = {};` add:

```js
  let hiddenColumns = new Set();
  let sessionRevealed = new Set();
  let controlButtons = null;
  let revealToasted = false;
```

- [ ] **Step 2: Add the control bar** after the resize section:

```js
  // ===== Control bar =====
  function ownedButton(role, text) {
    const button = document.createElement("button");
    // type="button" is safety-critical inside main_form: a bare <button>
    // defaults to submit and would save the record.
    button.type = "button";
    button.className = core.CLASSES.button;
    button.setAttribute(core.DATA_ATTRIBUTE, role);
    button.textContent = text;
    return button;
  }

  function ensureControls(container) {
    if (controlButtons?.bar?.isConnected) {
      return controlButtons;
    }
    const bar = document.createElement("div");
    bar.className = core.CLASSES.controls;
    bar.setAttribute(core.DATA_ATTRIBUTE, "controls");
    const columnsButton = ownedButton("columns-button", "Columns");
    const chips = document.createElement("span");
    chips.setAttribute(core.DATA_ATTRIBUTE, "chips");
    bar.append(columnsButton, chips);
    container.prepend(bar);
    controlButtons = { bar, columnsButton, chips, menu: null };
    return controlButtons;
  }

  function closeColumnMenu() {
    controlButtons?.menu?.remove();
    if (controlButtons) {
      controlButtons.menu = null;
    }
  }

  function openColumnMenu(table, columnIds) {
    closeColumnMenu();
    const labels = core.readHeaderLabels(table, columnIds);
    const menu = document.createElement("div");
    menu.className = core.CLASSES.menu;
    menu.setAttribute(core.DATA_ATTRIBUTE, "menu");
    columnIds.forEach((columnId, index) => {
      const row = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !hiddenColumns.has(columnId);
      box.setAttribute(core.DATA_ATTRIBUTE, "column-toggle");
      box.dataset.columnId = columnId;
      const text = document.createElement("span");
      text.textContent = labels[index] || columnId;
      row.append(box, text);
      menu.append(row);
    });
    const rect = controlButtons.columnsButton.getBoundingClientRect();
    menu.style.left = `${Math.round(rect.left + window.scrollX)}px`;
    menu.style.top = `${Math.round(rect.bottom + window.scrollY + 2)}px`;
    document.body.append(menu);
    controlButtons.menu = menu;
  }

  function renderChips(table, columnIds) {
    const chips = controlButtons?.chips;
    if (!chips) {
      return;
    }
    while (chips.firstChild) {
      chips.firstChild.remove();
    }
    const labels = core.readHeaderLabels(table, columnIds);
    for (const columnId of hiddenColumns) {
      const index = columnIds.indexOf(columnId);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = core.CLASSES.chip;
      chip.setAttribute(core.DATA_ATTRIBUTE, "chip");
      chip.dataset.columnId = columnId;
      chip.textContent = `${(index >= 0 ? labels[index] : columnId) || columnId} ✕`;
      chips.append(chip);
    }
  }
```

- [ ] **Step 3: Add the hide/reveal section**

```js
  // ===== Hide, show and force-reveal =====
  function effectiveHidden() {
    return new Set([...hiddenColumns].filter((columnId) => !sessionRevealed.has(columnId)));
  }

  function applyCurrentHidden(table, columnIds) {
    core.applyHidden(table, [...effectiveHidden()], columnIds);
    renderChips(table, columnIds);
  }

  function setColumnHidden(columnId, hidden) {
    if (hidden) {
      hiddenColumns.add(columnId);
      sessionRevealed.delete(columnId);
    } else {
      hiddenColumns.delete(columnId);
      sessionRevealed.delete(columnId);
    }
    queueApply("hide-toggle");
    saveHidden();
  }

  function revealColumn(columnId) {
    if (!columnId || sessionRevealed.has(columnId)) {
      return;
    }
    // Session-only: the stored hidden list is unchanged, so this never writes.
    sessionRevealed.add(columnId);
    if (!revealToasted) {
      revealToasted = true;
      showToast("A hidden column was revealed because it took focus.", "info");
    }
    queueApply("force-reveal");
  }

  function revealAll(message) {
    if (!hiddenColumns.size || [...hiddenColumns].every((id) => sessionRevealed.has(id))) {
      return;
    }
    for (const columnId of hiddenColumns) {
      sessionRevealed.add(columnId);
    }
    showToast(message, "warning");
    queueApply("force-reveal-all");
  }

  function handleFocusIn(event) {
    // validateField() focusing a widget inside a display:none cell is a no-op,
    // so the machine can refuse to commit with no visible error. Revealing on
    // focus is mandatory, not polish.
    const cell = event.target?.closest?.("td");
    if (!cell?.classList?.contains?.(core.CLASSES.colHidden)) {
      return;
    }
    const table = machineTable();
    const columnIds = table ? core.readColumnIds(table) : [];
    const index = core.visibleCells(cell.parentElement).indexOf(cell);
    const columnId = index >= 0 ? columnIds[index] ?? null : null;
    if (columnId) {
      revealColumn(columnId);
    } else {
      revealAll("All columns were shown so the line can be completed.");
    }
  }

  function handleCommitAttempt(event) {
    if (!event.target?.closest?.("tr.machineButtonRow") || !effectiveHidden().size) {
      return;
    }
    const table = machineTable();
    setTimeout(() => {
      // A line still open one tick after a commit click is the observable
      // signature of a validation failure. Reveal everything and drop the
      // layout change, never the user's edit.
      if (table?.isConnected && isLineOpen()) {
        revealAll("A required column was hidden. All columns are shown so the line can be completed.");
      }
    }, 0);
  }

  function handleContainerClick(event) {
    handleCommitAttempt(event);
    const table = machineTable();
    const columnIds = table ? core.readColumnIds(table) : [];
    const owned = event.target?.closest?.(`[${core.DATA_ATTRIBUTE}]`);
    if (!owned || !table) {
      return;
    }
    const role = owned.getAttribute(core.DATA_ATTRIBUTE);
    if (role === "columns-button") {
      event.preventDefault();
      if (controlButtons?.menu) {
        closeColumnMenu();
      } else {
        openColumnMenu(table, columnIds);
      }
      return;
    }
    if (role === "chip") {
      event.preventDefault();
      setColumnHidden(owned.dataset.columnId, false);
    }
  }

  function handleMenuChange(event) {
    const box = event.target?.closest?.(`[${core.DATA_ATTRIBUTE}="column-toggle"]`);
    if (!box) {
      return;
    }
    setColumnHidden(box.dataset.columnId, !box.checked);
  }

  function saveHidden() {
    return enqueueSave(async () => {
      try {
        if (!scopeKey) {
          return;
        }
        const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
        const next = core.withHidden(
          stored[core.STORAGE_KEY],
          scopeKey,
          hiddenColumns.size ? [...hiddenColumns] : null
        );
        if (!next) {
          showToast("Column layout could not be saved.", "warning");
          return;
        }
        await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
      } catch {
        showToast("Column layout could not be saved.", "warning");
      }
    });
  }
```

The menu lives on `document.body` (it must escape the machine's overflow), so its `change` listener is attached to the menu node itself inside `openColumnMenu` — add `menu.addEventListener("change", handleMenuChange);` immediately before `document.body.append(menu);`. The menu is removed by `closeColumnMenu` and by the `OWNED_SELECTOR` sweep in `removeEditGrid`, so the listener cannot leak.

- [ ] **Step 4: Extend the three seams and the lifecycle hooks.**

(a) `renderSignature` — add a `hidden` member:

```js
      hidden: headerCellsOf(table).map((cell) => cell.classList.contains(core.CLASSES.colHidden))
```

(b) `targetSignature` — add the matching member:

```js
      hidden: columnIds.map((id) => effectiveHidden().has(id))
```

(c) `applyAll` becomes:

```js
  function applyAll(table, columnIds) {
    applyCurrentWidths(table, columnIds);
    applyCurrentHidden(table, columnIds);
  }
```

(d) In `installEditGrid`, after `columnWidths = { ...(entry.widths ?? {}) };` add:

```js
      hiddenColumns = new Set(entry.hidden ?? []);
      ensureControls(container);
```

(e) In `removeEditGrid`, inside the `try` after `core.applyWidths(table, null, {});` add:

```js
      closeColumnMenu();
      core.applyHidden(table, [], core.readColumnIds(table));
      hiddenColumns = new Set();
      sessionRevealed = new Set();
```

and after the `OWNED_SELECTOR` sweep add `controlButtons = null;` and `revealToasted = false;`.

(f) `DELEGATED_LISTENERS` becomes:

```js
  const DELEGATED_LISTENERS = [
    ["pointermove", handleResizeHover],
    ["pointerdown", handleResizeDown],
    ["focusin", handleFocusIn],
    ["click", handleContainerClick]
    // M5 reuses the click handler for Personalize/Done/Reset; M6/M7 for the
    // header menu. One listener per event type, on the container, forever.
  ];
```

- [ ] **Step 5: Syntax and suite**

```bash
node --check src/edit-grid/runtime.js && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: no syntax error; `ℹ tests 226`, `ℹ pass 226`, `ℹ fail 0`; 28 baselines at 0.000 %.

- [ ] **Step 6: Fixture round-trip — computed display, force-reveal, one write per gesture**

Open `http://localhost:8931/tests/fixtures/sales-order-edit.html?salesOrderColumnsEdit=true` and run:

```js
const table = document.querySelector("#item_splits");
const columnCells = (index) => [...table.rows]
  .filter((r) => [...r.cells].filter((c) => c.style.display !== "none").length === 4)
  .map((r) => [...r.cells].filter((c) => c.style.display !== "none")[index]);

// Hide "Quantity" through the UI, exactly as a user would.
delete document.documentElement.dataset.editGridWrites;
document.querySelector('[data-suitemate-v3-edit-grid="columns-button"]').click();
const box = [...document.querySelectorAll('[data-suitemate-v3-edit-grid="column-toggle"]')]
  .find((b) => b.dataset.columnId === "quantity");
box.checked = false;
box.dispatchEvent(new Event("change", { bubbles: true }));
await new Promise((r) => setTimeout(r, 500));
console.log("writes:", document.documentElement.dataset.editGridWrites);          // "1"
console.log("computed display:", columnCells(1).map((c) => getComputedStyle(c).display));
console.log("stored:", JSON.stringify(SuiteMateV3Fixture.editColumns));
console.log("chip:", document.querySelector('[data-suitemate-v3-edit-grid="chip"]')?.textContent);

// The cell, its _fs span and its <input> are all still in the DOM and in main_form.
const hiddenCell = columnCells(1)[1];
console.log("still in form:", Boolean(hiddenCell.querySelector('span[id$="_fs"]')),
  Boolean(hiddenCell.closest("#main_form")));

// Survives add-line and a full regenerate, still with zero further writes.
delete document.documentElement.dataset.editGridWrites;
SuiteMateV3EditFixture.addLine();
SuiteMateV3EditFixture.repaint();
await new Promise((r) => setTimeout(r, 300));
console.log("after repaint:", columnCells(1).map((c) => getComputedStyle(c).display),
  "writes:", document.documentElement.dataset.editGridWrites ?? "0");

// Force-reveal: focus inside the hidden column reveals it for the session only.
delete document.documentElement.dataset.editGridWrites;
SuiteMateV3EditFixture.openLine(1);
await new Promise((r) => setTimeout(r, 100));
const input = table.querySelector("#item_quantity1_fs input");
input?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
await new Promise((r) => setTimeout(r, 300));
console.log("revealed:", columnCells(1).map((c) => getComputedStyle(c).display),
  "writes:", document.documentElement.dataset.editGridWrites ?? "0");             // "0"
console.log("stored unchanged:", JSON.stringify(SuiteMateV3Fixture.editColumns));
```

Expected: `writes: "1"`; every Quantity cell computes `display: "none"` (**assert at computed display — never `.hidden` or a class name**); stored container holds `hidden: ["quantity"]`; the chip reads `Quantity ✕`; the cell, its `_fs` span and its `<input>` remain inside `#main_form`; after add-line + repaint the column is still hidden with **zero** further writes; after `focusin` the column computes `display: "table-cell"` with **zero** writes and the stored container unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/edit-grid/runtime.js
git commit -m "feat: Edit Mode hide/show columns with mandatory force-reveal"
```

### Task 17: M3 live pass and View Mode regression

**Files:**
- Modify: `docs/testing-log.md`

**SAFETY PROTOCOL — restated in full because it binds every browser action in this task:**

1. **Record lock.** Account `6998262`, `id=16342809`, and no other record or transaction; the lock explicitly covers **the same record with `&e=T` appended** (Q2). Confirm the URL bar before ANY interaction. Any other record or account: **stop and report**. Never create additional test Sales Orders. Never open other transactions in Edit Mode.
2. **Safety triple — verify all three BEFORE testing begins and again BEFORE every save:** `custbody_salesorder_issue` checked (true); Status = Pending Approval; Memo clearly indicates a testing record. Any failure: do **not** save, stop, report.
3. **Four-eyes save gate.** Before every save: captain gathers evidence (URL bar with account + id, the three safety fields, a one-paragraph statement of what the save changes and why), dispatches an **Opus 5** save-gate subagent, which answers exactly **GO** or **NO-GO**. Default **NO-GO**. Save only on GO; on NO-GO stop and report. The first save of a session also needs the owner's explicit go-ahead in chat.
4. **This milestone requires no save.** If a step appears to need one, stop and report.
5. **Forbidden regardless of anything else:** Approve, Reject, Bill, Fulfill, Email, Print, Delete, Make Copy, or any status-changing or document-sending action.
6. **Every interpretation question is answered by an Opus 5 subagent from DOM evidence.** Browser testing stays sequential.
7. **Append one line to `docs/testing-log.md`** and ship it in the M3 checkpoint commit.

- [ ] **Step 1: Ask the owner for the reload in one interrupt** — reload the unpacked extension; the Edit Mode toggle stays ON from M2. Wait for confirmation.

- [ ] **Step 2: Verify the safety triple** on `…salesord.nl?id=16342809&e=T` (snippet in Task 9 Step 1). Any deviation: stop and report.

- [ ] **Step 3: Exercise hide/show, including probe 11's hazard**

- Hide two columns (one optional, one **required**) through the Columns menu; confirm at computed level that every cell in those columns is `display: none` while the `_fs` span and `<input>` remain in `#main_form`:

```js
(() => {
  const t = document.querySelector('#item_splits');
  const rows = [...t.rows].filter((r) => /_row_\d+$/.test(r.id));
  const vis = (r) => [...r.cells].filter((c) => c.style.display !== 'none');
  const hidden = vis(t.querySelector('tr.uir-machine-headerrow'))
    .map((c, i) => [i, getComputedStyle(c).display]).filter(([, d]) => d === 'none');
  return {
    hiddenHeaderIndexes: hidden.map(([i]) => i),
    bodyDisplay: rows.slice(0, 3).map((r) => hidden.map(([i]) => getComputedStyle(vis(r)[i]).display)),
    spansPresent: rows.slice(0, 3).map((r) => hidden.map(([i]) => Boolean(vis(r)[i].querySelector('span[id$="_fs"]')))),
    inForm: rows.slice(0, 3).map((r) => hidden.map(([i]) => Boolean(vis(r)[i].closest('#main_form'))))
  };
})()
```

- With a column hidden: open a line, edit a **visible** field, click OK — the line must commit and the value must persist in the machine.
- **Probe 11 live:** with a **required** column hidden, open a line, clear that field's value if reachable, and click OK. Expected: SuiteMate force-reveals every hidden column and toasts; the line then commits normally. Record the transcript.
- Focus a widget inside a hidden column (Tab into it): expected — that one column reveals for the session, one toast, and `chrome.storage.sync.get("suiteMateV3EditColumns")` is **unchanged**.
- Add a line and remove a line with a column hidden; confirm the hidden state re-applies to the new rows.

An **Opus 5** subagent reads the captures and states pass/fail for each.

- [ ] **Step 4: Confirm mode isolation**

```js
await chrome.storage.sync.get(["suiteMateV3EditColumns", "suiteMateV3ColumnOrder"])
```

Expected: only the `…:salesord:edit` scope touched; `suiteMateV3ColumnOrder` byte-identical to the value captured before the session.

- [ ] **Step 5: View Mode regression (explicit)**

(a) Load `…salesord.nl?id=16342809` (view mode, same record): column personalization, sort, filter and widths behave; Export view produces data rows, not headers-only; tab titles and internal-id badges unaffected; **zero SuiteMate console errors**. Opus 5 subagent states pass/fail from DOM evidence.

(b) ```bash
git diff --name-only main | grep so-columns
```
Expected: exactly `src/so-columns/core.js`.

- [ ] **Step 6: Append the log line**

```markdown
| 2026-08-0X <HH:MM> AEST | M3 | Hide/show on `id=16342809&e=T`: two columns hidden (one required), computed display none with `_fs` spans and inputs still in `main_form`; line commits with a column hidden; probe 11 validation failure force-revealed all columns and the line then committed; focus-into-hidden revealed one column session-only with zero storage writes; add/remove line re-applied | `save/CHECKPOINTS.md` M3 entry | No save; four-eyes gate not invoked |
```

- [ ] **Step 7: Commit**

```bash
git add docs/testing-log.md
git commit -m "docs: record the M3 live hide/show pass"
```

### Task 18: M3 checkpoint

**Files:**
- Modify: `save/CHECKPOINTS.md`

- [ ] **Step 1: Full gate**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
npm run fixtures:verify 2>&1 | tail -5
```

Expected: `ℹ tests 226`, `ℹ pass 226`, `ℹ fail 0`; 28 baselines at **0.000 %**.

- [ ] **Step 2: Append the checkpoint entry**

```markdown
## Edit Mode Table Enhancements: Milestone M3 (hide / show columns)

Status: Complete
Date: 2026-08-0X

### Included

- `core.applyHidden` toggles one class on the header cell and on every aligned row's cell; `edit-grid.css` renders it `display: none !important`. The cell, its `_fs` span and its `<input>` stay in the DOM and in `main_form` — the same mechanism NetSuite uses for its own system cells. Because the class does not touch inline `style.display`, a SuiteMate-hidden column stays on the column axis and identity survives hiding.
- Force-reveal, mandatory rather than polish: `focusin` inside a hidden cell reveals that one column for the session with one toast; a line that stays open one tick after a commit click reveals every hidden column and toasts. Both are session-only and write nothing — the layout change is dropped, never the user's edit. An open line carries focus-only spacer cells, so it never aligns to the header and is therefore never hidden.
- Control bar: a `Columns` menu of checkboxes and a chip per hidden column that unhides in one click. Every injected button is `type="button"` (a bare `<button>` inside `main_form` defaults to submit); no `innerHTML` anywhere; every node is stamped with `DATA_ATTRIBUTE` at creation and swept on teardown. Listeners stay delegated on the container under the bound-attribute guard.
- Fourth closure of the display-defeats-hidden defect class (`CHECKPOINTS.md:858`, `:972`, `:1143`), this time with computed-level evidence in both the fixture and the live pass.

### Verification

- Full `npm test`: 226 passing; 28 screenshot baselines untouched at 0.000 percent.
- Fixture: hiding one column through the menu produced EXACTLY one storage write; every cell in that column computed `display: none` while its `_fs` span and `<input>` stayed inside `#main_form`; add-line plus a full `<tbody>` regenerate re-applied the hidden state with ZERO further writes; `focusin` revealed the column for the session with ZERO writes and an unchanged stored container.
- Live on `id=16342809&e=T`: two columns hidden including a required one; a line committed normally with a column hidden; probe 11's validation failure force-revealed every column and the line then committed; Tab-into-hidden revealed exactly one column session-only; add/remove line re-applied. `suiteMateV3ColumnOrder` byte-identical before and after.
- View Mode regression on the same record: all features behave; zero SuiteMate console errors. `git diff --name-only main | grep so-columns` returns exactly `src/so-columns/core.js`.
```

- [ ] **Step 3: Commit**

```bash
git add save/CHECKPOINTS.md
git commit -m "docs: M3 checkpoint — Edit Mode hide/show shipped with force-reveal"
```

---

# Milestone M4 — Drag-and-drop column reorder — GATE A DECISION POINT

Five tasks on the GO path (19-23), or two on the NO-GO path (19 then 23A). **No reorder code is written before Task 19 records the verdict.**

### Task 19: Read the Gate A verdict and branch

**Files:**
- No changes.

**Interfaces:**
- Consumes: the M1 checkpoint entry's "Binding verdicts" block (Task 10) and `docs/testing-log.md`.
- Produces: the branch decision for the rest of M4.

- [ ] **Step 1: Read the recorded verdict**

```bash
grep -n -A6 "#### Binding verdicts" save/CHECKPOINTS.md | tail -12
```

Expected: the M1 entry states **Gate A (probe 8)** as either `PASS — repaint is id-addressed` or `FAIL — repaint is index-addressed`, with the probe transcript above it.

- [ ] **Step 2: Confirm the transcript actually supports the verdict.** Dispatch an **Opus 5** subagent with the pasted probe-8 transcript (baseline pairs, post-permutation pairs, post-commit pairs) and ask it to state independently whether the repaint addressed cells by element id or by index. The captain does not interpret this alone. If the subagent disagrees with the recorded verdict, or the transcript is missing/ambiguous, **stop and report** — re-run probe 8 rather than guessing.

- [ ] **Step 3: Branch**

- **Gate A PASS (id-addressed)** → continue with Task 20.
- **Gate A FAIL (index-addressed)** → **skip Tasks 20, 21 and 22 entirely** and go straight to **Task 23A**. Reorder is declared not technically possible in Edit Mode (Q3); no substitute is built — not the read-only overlay, not a warned-but-shipped reorder. M5 proceeds unaffected.

### Task 20: `core.planOrder`, `core.moveColumn`, `core.applyOrderEdit`

*(Gate A PASS only.)*

**Files:**
- Modify: `src/edit-grid/core.js` (new functions after `applyHidden`; export block)
- Test: `tests/edit-grid.test.mjs` (three tests before the source-purity test)

**Interfaces:**
- Consumes: `tableRows`, `visibleCells`, `alignsToHeader`, `isExcludedRow` (Task 5).
- Produces: `core.planOrder(nativeIds, savedIds) -> string[]` (never throws; unmatched ids ignored), `core.moveColumn(columnIds, fromId, toId) -> string[]|null`, `core.applyOrderEdit(table, targetIds, columnIds) -> boolean`. Task 21 uses all three.

- [ ] **Step 1: Write the failing tests** — insert before the source-purity test:

```js
test("plans saved orders by column id with stable native fallbacks", () => {
  const core = createApi();
  const native = ["item", "description", "quantity", "rate", "amount"];
  assert.deepEqual(plain(core.planOrder(native, [])), native);
  assert.deepEqual(plain(core.planOrder(native, null)), native);
  assert.deepEqual(plain(core.planOrder(native, native)), native);
  assert.deepEqual(
    plain(core.planOrder(native, ["quantity", "item"])),
    ["quantity", "description", "item", "rate", "amount"]
  );
  // Ids absent from the machine are ignored for this render, never fatal.
  assert.deepEqual(
    plain(core.planOrder(native, ["custcol_gone", "rate", "item"])),
    ["rate", "description", "quantity", "item", "amount"]
  );
});

test("moveColumn produces a permutation or refuses", () => {
  const core = createApi();
  assert.deepEqual(plain(core.moveColumn(["item", "quantity", "rate"], "rate", "item")),
    ["rate", "item", "quantity"]);
  assert.deepEqual(plain(core.moveColumn(["item", "quantity", "rate"], "item", "rate")),
    ["quantity", "rate", "item"]);
  assert.equal(core.moveColumn(["item", "quantity"], "item", "item"), null);
  assert.equal(core.moveColumn(["item", "quantity"], "gone", "item"), null);
  assert.equal(core.moveColumn(["item", "item"], "item", "item"), null);
});

test("permutes visible cells only, across rows that carry extra hidden cells", () => {
  const core = createApi();
  const table = createMachine();
  const columnIds = core.readColumnIds(table);
  assert.deepEqual(plain(columnIds), ["item", "quantity", "rate"]);

  assert.equal(core.applyOrderEdit(table, ["rate", "item", "quantity"], columnIds), true);
  assert.deepEqual(plain(core.readColumnIds(table)), ["rate", "item", "quantity"]);
  assert.deepEqual(
    core.visibleCells(table.rows[0]).map((cell) => cell.textContent),
    ["Rate", "Item", "Quantity"]
  );
  // Values travel with their own cells, never with an index.
  assert.deepEqual(
    core.visibleCells(table.rows[1]).map((cell) => cell.querySelector("span[id$=\"_fs\"]").id),
    ["item_rate1_fs", "item_item1_fs", "item_quantity1_fs"]
  );
  // The system cell is untouched and stays off the axis.
  assert.equal(table.rows[1].cells[table.rows[1].cells.length - 1].style.display, "none");
  // machineButtonRow and the totals row are never permuted.
  assert.equal(table.rows[3].cells.length, 1);
  assert.equal(table.rows[4].cells.length, 1);

  assert.equal(core.applyOrderEdit(table, ["rate", "item"], core.readColumnIds(table)), false);
  assert.equal(core.applyOrderEdit(table, ["rate", "item", "gone"], core.readColumnIds(table)), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test tests/edit-grid.test.mjs 2>&1 | grep -E "not ok|ℹ fail"
```

Expected: FAIL — `core.planOrder is not a function`.

- [ ] **Step 3: Implement in `src/edit-grid/core.js`** — add after `applyHidden`:

```js
  // ===== Order planning and application =====
  function planOrder(nativeIds, savedIds) {
    const native = Array.isArray(nativeIds)
      ? nativeIds.map((id) => typeof id === "string" ? id : "")
      : [];
    const counts = new Map();
    for (const id of native) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const matched = [];
    const matchedSet = new Set();
    for (const id of Array.isArray(savedIds) ? savedIds : []) {
      if (typeof id === "string" && id && counts.get(id) === 1 && !matchedSet.has(id)) {
        matchedSet.add(id);
        matched.push(id);
      }
    }
    const target = native.slice();
    let matchedIndex = 0;
    for (let index = 0; index < target.length; index += 1) {
      if (matchedSet.has(target[index])) {
        target[index] = matched[matchedIndex];
        matchedIndex += 1;
      }
    }
    return target;
  }

  function moveColumn(columnIds, fromId, toId) {
    const list = Array.isArray(columnIds)
      ? columnIds.filter((id) => typeof id === "string" && id)
      : [];
    const from = list.indexOf(fromId);
    const to = list.indexOf(toId);
    if (from < 0 || to < 0 || from === to || list.length !== new Set(list).size) {
      return null;
    }
    const next = list.slice();
    next.splice(from, 1);
    next.splice(to, 0, fromId);
    return next;
  }

  function applyOrderEdit(table, targetIds, columnIds) {
    try {
      if (
        !Array.isArray(targetIds)
        || !Array.isArray(columnIds)
        || targetIds.length !== columnIds.length
        || targetIds.length < 2
      ) {
        return false;
      }
      const used = new Array(columnIds.length).fill(false);
      const permutation = [];
      for (const id of targetIds) {
        const index = columnIds.findIndex((current, at) => !used[at] && current === id);
        if (index < 0) {
          return false;
        }
        used[index] = true;
        permutation.push(index);
      }
      for (const row of tableRows(table)) {
        if (isExcludedRow(row) || !alignsToHeader(row, columnIds)) {
          continue;
        }
        const cells = visibleCells(row);
        if (cells.length !== columnIds.length) {
          continue;
        }
        // Permute the VISIBLE cells with insertBefore, walking left to right.
        // NetSuite's own inline-hidden system cells keep their positions, and
        // row.cells[i] is never used as identity (spec section 8, Gate A).
        const ordered = permutation.map((source) => cells[source]);
        const working = cells.slice();
        for (let slot = 0; slot < ordered.length; slot += 1) {
          if (working[slot] === ordered[slot]) {
            continue;
          }
          const from = working.indexOf(ordered[slot], slot);
          row.insertBefore(ordered[slot], working[slot]);
          working.splice(from, 1);
          working.splice(slot, 0, ordered[slot]);
        }
      }
      return true;
    } catch {
      return false;
    }
  }
```

Add `planOrder,`, `moveColumn,` and `applyOrderEdit,` to the frozen export object.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: `ℹ tests 229`, `ℹ pass 229`, `ℹ fail 0`; 28 baselines at 0.000 %.

- [ ] **Step 5: Commit**

```bash
git add src/edit-grid/core.js tests/edit-grid.test.mjs
git commit -m "feat: edit-grid column-order planner permuting visible cells only"
```

### Task 21: Runtime drag reorder inside Personalize mode

*(Gate A PASS only.)*

**Files:**
- Modify: `src/edit-grid/runtime.js` (module state; new reorder section; `ensureControls`, `renderSignature`, `targetSignature`, `applyAll`, `installEditGrid`, `removeEditGrid`, `DELEGATED_LISTENERS`)

**Interfaces:**
- Consumes: `core.planOrder`, `core.moveColumn`, `core.applyOrderEdit`, `core.withOrder` (Tasks 5, 20); `ensureControls`, `handleContainerClick`, `queueApply`, `isLineOpen`, `showToast` (Tasks 6, 16).
- Produces: `REORDER_ENABLED = true`, `columnOrder: string[]`, `personalizing: boolean`, `enterPersonalize()`, `exitPersonalize()`, `applyCurrentOrder(table, columnIds)`, `saveOrder()`, `handleDragStart/Over/Drop/End`. Task 25 (M5) reuses `personalizing` and the Personalize/Done buttons.

- [ ] **Step 1: Add module state.** Beside `let hiddenColumns = new Set();` add:

```js
  const REORDER_ENABLED = true; // Gate A passed: the repaint is id-addressed.
  let columnOrder = [];
  let personalizing = false;
  let dragColumnId = null;
  let dropCell = null;
```

- [ ] **Step 2: Add the reorder section** after the hide/reveal section:

```js
  // ===== Reorder (Personalize mode) =====
  function applyCurrentOrder(table, columnIds) {
    if (!REORDER_ENABLED || !columnOrder.length) {
      return;
    }
    core.applyOrderEdit(table, core.planOrder(columnIds, columnOrder), columnIds);
  }

  function setHeaderDraggable(table, draggable) {
    for (const cell of headerCellsOf(table)) {
      cell.draggable = draggable;
    }
    table.classList.toggle(core.CLASSES.personalizing, draggable);
  }

  function enterPersonalize() {
    const table = machineTable();
    if (!table) {
      return;
    }
    personalizing = true;
    setHeaderDraggable(table, true);
    updateControls();
  }

  function exitPersonalize() {
    const table = machineTable();
    personalizing = false;
    dragColumnId = null;
    dropCell?.classList.remove(core.CLASSES.dropTarget);
    dropCell = null;
    if (table) {
      setHeaderDraggable(table, false);
    }
    updateControls();
  }

  function headerCellFromEvent(event) {
    const table = machineTable();
    const cell = event.target?.closest?.("td");
    if (!personalizing || !table || !cell || !table.contains(cell)) {
      return null;
    }
    return headerCellsOf(table).includes(cell) ? cell : null;
  }

  function handleDragStart(event) {
    const cell = headerCellFromEvent(event);
    if (!cell) {
      return;
    }
    if (isLineOpen()) {
      // Never queued into a surprise: moving cells under an open line would
      // blur the focused widget and can abort a sourcing round-trip.
      event.preventDefault();
      showToast("Finish editing the line first.", "warning");
      return;
    }
    const table = machineTable();
    dragColumnId = columnIdOfHeaderCell(table, cell);
    if (!dragColumnId) {
      event.preventDefault();
      return;
    }
    cell.classList.add(core.CLASSES.dragging);
    event.dataTransfer?.setData?.("text/plain", dragColumnId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  function handleDragOver(event) {
    const cell = headerCellFromEvent(event);
    if (!cell || !dragColumnId) {
      return;
    }
    event.preventDefault();
    if (dropCell !== cell) {
      dropCell?.classList.remove(core.CLASSES.dropTarget);
      dropCell = cell;
      cell.classList.add(core.CLASSES.dropTarget);
    }
  }

  function handleDrop(event) {
    const cell = headerCellFromEvent(event);
    if (!cell || !dragColumnId) {
      return;
    }
    event.preventDefault();
    const table = machineTable();
    if (isLineOpen()) {
      showToast("Finish editing the line first.", "warning");
      handleDragEnd();
      return;
    }
    const columnIds = core.readColumnIds(table);
    const targetId = columnIdOfHeaderCell(table, cell);
    const next = core.moveColumn(columnIds, dragColumnId, targetId);
    handleDragEnd();
    if (!next) {
      return;
    }
    columnOrder = next;
    queueApply("reorder");
    saveOrder();
  }

  function handleDragEnd() {
    const table = machineTable();
    for (const cell of table ? headerCellsOf(table) : []) {
      cell.classList.remove(core.CLASSES.dragging);
      cell.classList.remove(core.CLASSES.dropTarget);
    }
    dragColumnId = null;
    dropCell = null;
  }

  function saveOrder() {
    return enqueueSave(async () => {
      try {
        if (!scopeKey) {
          return;
        }
        const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
        const next = core.withOrder(
          stored[core.STORAGE_KEY],
          scopeKey,
          columnOrder.length ? columnOrder : null
        );
        if (!next) {
          showToast("Column layout could not be saved.", "warning");
          return;
        }
        await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
      } catch {
        showToast("Column layout could not be saved.", "warning");
      }
    });
  }
```

- [ ] **Step 3: Add the Personalize / Done controls.** In `ensureControls`, after `const columnsButton = ownedButton("columns-button", "Columns");` add:

```js
    const personalize = REORDER_ENABLED ? ownedButton("personalize", "Personalize") : null;
    const done = REORDER_ENABLED ? ownedButton("done", "Done") : null;
```

change the append to `bar.append(...[columnsButton, personalize, done, chips].filter(Boolean));`, store them in `controlButtons`, and add:

```js
  function updateControls() {
    if (!controlButtons) {
      return;
    }
    controlButtons.personalize?.toggleAttribute("hidden", personalizing);
    controlButtons.done?.toggleAttribute("hidden", !personalizing);
  }
```

Call `updateControls()` at the end of `ensureControls`. In `handleContainerClick`, add before the `chip` branch:

```js
    if (role === "personalize") {
      event.preventDefault();
      enterPersonalize();
      return;
    }
    if (role === "done") {
      event.preventDefault();
      exitPersonalize();
      return;
    }
```

- [ ] **Step 4: Extend the seams.**

(a) `applyAll` becomes:

```js
  function applyAll(table, columnIds) {
    applyCurrentOrder(table, columnIds);
    const applied = core.readColumnIds(table);
    applyCurrentWidths(table, applied);
    applyCurrentHidden(table, applied);
  }
```

(b) `targetSignature` — replace the `ids` member with the planned arrangement, and read widths/hidden against it:

```js
  function targetSignature(table, columnIds) {
    const planned = REORDER_ENABLED && columnOrder.length
      ? core.planOrder(columnIds, columnOrder)
      : columnIds;
    const active = Object.keys(columnWidths).length > 0;
    const minimums = core.columnMinimums(table, columnIds);
    return JSON.stringify({
      ids: planned,
      layout: active ? "fixed" : "",
      widths: planned.map((id) => {
        if (!active) {
          return "";
        }
        const stored = Number(columnWidths[id]);
        const index = columnIds.indexOf(id);
        const cell = headerCellsOf(table)[index];
        const rendered = Math.round(cell?.getBoundingClientRect?.().width ?? 0);
        const target = Number.isFinite(stored) ? stored : rendered;
        return target > 0 ? `${core.clampWidth(target, minimums[id])}px` : "";
      }),
      hidden: planned.map((id) => effectiveHidden().has(id))
    });
  }
```

(c) In `installEditGrid`, replace the unconditional `nativeColumnIds = columnIds;` with a guarded capture placed immediately before `applyAll(table, current);`:

```js
      const plannedOrder = REORDER_ENABLED && columnOrder.length
        ? core.planOrder(current, columnOrder)
        : current;
      if (current.join("|") !== plannedOrder.join("|")) {
        // A repaint reverted the machine, so what we just read IS the native
        // arrangement. Never overwrite it with our own applied order.
        nativeColumnIds = current;
      }
```

and add `columnOrder = [...(entry.order ?? [])];` beside `hiddenColumns = new Set(entry.hidden ?? []);`.

(d) In `removeEditGrid`, inside the `try`, before `core.applyWidths(table, null, {});` add:

```js
      exitPersonalize();
      if (table && nativeColumnIds) {
        core.applyOrderEdit(table, nativeColumnIds, core.readColumnIds(table));
      }
      columnOrder = [];
```

(e) `DELEGATED_LISTENERS` gains four entries:

```js
    ["dragstart", handleDragStart],
    ["dragover", handleDragOver],
    ["drop", handleDrop],
    ["dragend", handleDragEnd]
```

- [ ] **Step 5: Syntax and suite**

```bash
node --check src/edit-grid/runtime.js && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: no syntax error; `ℹ tests 229`, `ℹ pass 229`, `ℹ fail 0`; 28 baselines at 0.000 %.

- [ ] **Step 6: Fixture round-trip — order survives repaint, refused while a line is open**

Open `http://localhost:8931/tests/fixtures/sales-order-edit.html?salesOrderColumnsEdit=true` and run:

```js
const table = document.querySelector("#item_splits");
const ids = () => [...table.querySelector("tr.uir-machine-headerrow").cells]
  .filter((c) => c.style.display !== "none").map((c) => c.textContent.trim());
const rowSpans = (n) => [...document.querySelector(`#item_row_${n}`).cells]
  .filter((c) => c.style.display !== "none")
  .map((c) => [c.querySelector('span[id$="_fs"]')?.id, c.textContent.trim()]);

document.querySelector('[data-suitemate-v3-edit-grid="personalize"]').click();
const header = [...table.querySelector("tr.uir-machine-headerrow").cells]
  .filter((c) => c.style.display !== "none");
const dt = new DataTransfer();
delete document.documentElement.dataset.editGridWrites;
header[3].dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
header[0].dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true }));
header[0].dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true }));
await new Promise((r) => setTimeout(r, 500));
console.log("order:", ids(), "writes:", document.documentElement.dataset.editGridWrites);
console.log("pairs:", rowSpans(1));
console.log("stored:", JSON.stringify(SuiteMateV3Fixture.editColumns));

// Order survives a full regenerate and add/remove line, with zero more writes.
delete document.documentElement.dataset.editGridWrites;
SuiteMateV3EditFixture.repaint();
SuiteMateV3EditFixture.addLine();
SuiteMateV3EditFixture.removeLine(4);
await new Promise((r) => setTimeout(r, 300));
console.log("after repaint:", ids(), "writes:", document.documentElement.dataset.editGridWrites ?? "0");

// Refused while a line is open.
SuiteMateV3EditFixture.openLine(2);
await new Promise((r) => setTimeout(r, 100));
const before = ids();
const h2 = [...table.querySelector("tr.uir-machine-headerrow").cells].filter((c) => c.style.display !== "none");
h2[0].dispatchEvent(new DragEvent("dragstart", { dataTransfer: new DataTransfer(), bubbles: true }));
h2[2].dispatchEvent(new DragEvent("drop", { dataTransfer: new DataTransfer(), bubbles: true }));
await new Promise((r) => setTimeout(r, 300));
console.log("refused:", ids().join("|") === before.join("|"));
```

Expected: `order: ["Amount","Item","Quantity","Rate"]` with `writes: "1"`; every `pairs` entry keeps its own `_fs` span with its own value (no cross-column contamination); the stored container holds `order: ["amount","item","quantity","rate"]`; after repaint + add + remove the order is unchanged with **zero** further writes; `refused: true` with a "Finish editing the line first." toast.

- [ ] **Step 7: Commit**

```bash
git add src/edit-grid/runtime.js
git commit -m "feat: Edit Mode drag-and-drop column reorder in Personalize mode"
```

### Task 22: M4 live pass and View Mode regression

*(Gate A PASS only.)*

**Files:**
- Modify: `docs/testing-log.md`

**SAFETY PROTOCOL — restated in full because it binds every browser action in this task:**

1. **Record lock.** Account `6998262`, `id=16342809`, and no other record or transaction; the lock explicitly covers **the same record with `&e=T` appended** (Q2). Confirm the URL bar before ANY interaction. Any other record or account: **stop and report**. Never create additional test Sales Orders. Never open other transactions in Edit Mode.
2. **Safety triple — verify all three BEFORE testing begins and again BEFORE every save:** `custbody_salesorder_issue` checked (true); Status = Pending Approval; Memo clearly indicates a testing record. Any failure: do **not** save, stop, report.
3. **Four-eyes save gate.** Before every save: captain gathers evidence (URL bar with account + id, the three safety fields, a one-paragraph statement of what the save changes and why), dispatches an **Opus 5** save-gate subagent, which answers exactly **GO** or **NO-GO**. Default **NO-GO**. Save only on GO; on NO-GO stop and report. The first save of a session also needs the owner's explicit go-ahead in chat.
4. **This milestone requires no save.** The reorder verification is an in-page line commit, exactly like probe 8. If a step appears to need a record save, stop and report.
5. **Forbidden regardless of anything else:** Approve, Reject, Bill, Fulfill, Email, Print, Delete, Make Copy, or any status-changing or document-sending action.
6. **Every interpretation question is answered by an Opus 5 subagent from DOM evidence.** Browser testing stays sequential.
7. **Append one line to `docs/testing-log.md`** and ship it in the M4 checkpoint commit.

- [ ] **Step 1: Ask the owner to reload the extension** (one interrupt; the Edit Mode toggle stays ON). Wait for confirmation.

- [ ] **Step 2: Verify the safety triple** on `…salesord.nl?id=16342809&e=T` (snippet in Task 9 Step 1). Any deviation: stop and report.

- [ ] **Step 3: Reorder, then prove no cross-column contamination**

Capture the id↔value pairing of two data rows before and after each stage:

```js
globalThis.__smPairs = () => [...document.querySelectorAll('#item_splits tr[id^="item_row_"]')]
  .slice(0, 3)
  .map((r) => [r.id, [...r.cells].filter((c) => c.style.display !== 'none')
    .map((c) => [c.querySelector('span[id$="_fs"]')?.id, c.textContent.trim()])]);
globalThis.__smPairs()
```

Stages: (a) click **Personalize**, drag one header column two positions left, click **Done**; (b) open an **adjacent** line, change one field, click OK (in-page commit, **no save**); (c) trigger a page-level recalculation (commit a Quantity change on another line); (d) add a line and remove it.

After every stage re-run `__smPairs()` and confirm **each value is still paired with its own `_fs` span id**. An **Opus 5** subagent compares the captures and states pass/fail. Any drift ⇒ stop immediately, revert the reorder code, and re-open Gate A.

- [ ] **Step 4: Confirm persistence and reload behaviour**

```js
await chrome.storage.sync.get(["suiteMateV3EditColumns", "suiteMateV3ColumnOrder"])
```

Then reload `…?id=16342809&e=T` and confirm the arrangement re-applies. `suiteMateV3ColumnOrder` must be byte-identical to the value captured before the session.

- [ ] **Step 5: View Mode regression (explicit)**

(a) Load `…salesord.nl?id=16342809` (view mode, same record): personalization, sort, filter and widths behave; Export view produces data rows, not headers-only; tab titles and internal-id badges unaffected; **zero SuiteMate console errors**. Opus 5 subagent states pass/fail from DOM evidence.

(b) ```bash
git diff --name-only main | grep so-columns
```
Expected: exactly `src/so-columns/core.js`.

- [ ] **Step 6: Append the log line**

```markdown
| 2026-08-0X <HH:MM> AEST | M4 | Column reorder on `id=16342809&e=T`: one column moved two positions in Personalize mode, then adjacent-line commit, recalc, add-line and remove-line; every value stayed paired with its own `_fs` span id; arrangement re-applied after reload; reorder refused while a line was open | `save/CHECKPOINTS.md` M4 entry | No save; four-eyes gate not invoked |
```

- [ ] **Step 7: Commit**

```bash
git add docs/testing-log.md
git commit -m "docs: record the M4 live reorder pass"
```

### Task 23: M4 checkpoint (Gate A PASS)

**Files:**
- Modify: `save/CHECKPOINTS.md`

- [ ] **Step 1: Full gate**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
npm run fixtures:verify 2>&1 | tail -5
```

Expected: `ℹ tests 229`, `ℹ pass 229`, `ℹ fail 0`; 28 baselines at **0.000 %**.

- [ ] **Step 2: Append the checkpoint entry**

```markdown
## Edit Mode Table Enhancements: Milestone M4 (drag-and-drop column reorder)

Status: Complete — Gate A passed
Date: 2026-08-0X

### Included

- Gate A (M1 probe 8) returned an id-addressed repaint, verified independently by an Opus 5 reader of the transcript, so reorder ships. `core.applyOrderEdit` permutes the VISIBLE, `_fs`-identified cells with `insertBefore`, walking left to right; `row.cells[i]` is never used as identity and NetSuite's inline-hidden system cells keep their positions. `core.planOrder` maps a saved id list onto the current machine, ignoring ids the machine does not have (paging and form variants must not erase a valid preference).
- HTML5 drag on the header row inside a Personalize/Done mode; the drag is **refused with a toast while any line is open** — never queued into a surprise, because moving cells under an open line blurs the focused widget and can abort a sourcing round-trip.
- Re-apply after every repaint through the shared `applyAll` seam, with the native arrangement captured only when the machine is observed in its native state — so the runtime can always restore it on teardown.

### Verification

- Full `npm test`: 229 passing; 28 screenshot baselines untouched at 0.000 percent.
- Fixture: one drag produced EXACTLY one storage write; every value stayed paired with its own `_fs` span; the arrangement survived a full `<tbody>` regenerate plus add-line and remove-line with ZERO further writes; a drag attempted while a line was open was refused and toasted.
- Live on `id=16342809&e=T`: one column moved two positions, then an adjacent-line in-page commit, a recalc, an add-line and a remove-line — every value remained paired with its own `_fs` span id at every stage; the arrangement re-applied after a real reload. No save occurred.
- View Mode regression on the same record: all features behave; zero SuiteMate console errors. `git diff --name-only main | grep so-columns` returns exactly `src/so-columns/core.js`.
```

- [ ] **Step 3: Commit**

```bash
git add save/CHECKPOINTS.md
git commit -m "docs: M4 checkpoint — Edit Mode column reorder shipped behind Gate A"
```

### Task 23A: M4 close-out — reorder declared not technically possible (Gate A FAIL)

*(Alternative final task for M4. Run this **instead of** Tasks 20-23 when Task 19 recorded a FAIL. No reorder code is written, and **no substitute is built** — Q3 closed the read-only overlay, and shipping reorder with a warning was rejected outright because it risks corrupting real sales order data.)*

**Files:**
- Modify: `docs/superpowers/specs/2026-08-02-edit-mode-table-enhancements-design.md` (§8 feature-status table, the reorder row)
- Modify: `docs/testing-log.md`, `save/CHECKPOINTS.md`

**Interfaces:**
- Consumes: Task 19's verdict and the probe-8 transcript in the M1 checkpoint entry.
- Produces: the binding "not possible" verdict M5, M6 and M7 build on unaffected. `REORDER_ENABLED` never enters the runtime, so `applyAll`, `targetSignature` and `ensureControls` keep their M3 shapes.

- [ ] **Step 1: Update the spec's feature-status table.** In §8, replace the **Drag-and-drop column reorder** row's Verdict cell with:

```markdown
| **Drag-and-drop column reorder** | **Not technically possible in Edit Mode.** Gate A (M1 probe 8) returned an **index-addressed** repaint: after permuting two `<td>`s in a non-focused row and committing an adjacent line in-page, values re-appeared under different `_fs` span ids. Any shipped reorder would therefore let values land in the wrong columns and serialize that way. Closed per Q3: no substitute is built. Evidence: the probe 8 transcript in `save/CHECKPOINTS.md`, M1 entry. |
```

Leave the Mechanism, Key risk and Verification cells intact as the record of what was designed and why it was refused.

- [ ] **Step 2: Confirm no reorder code exists**

```bash
grep -rn "applyOrderEdit\|moveColumn\|planOrder\|REORDER_ENABLED\|dragstart" src/edit-grid/ | wc -l
```

Expected: `0`. If anything appears, remove it — a closed milestone leaves no dead affordance.

- [ ] **Step 3: Full gate**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
npm run fixtures:verify 2>&1 | tail -5
```

Expected: `ℹ tests 226`, `ℹ pass 226`, `ℹ fail 0` (unchanged from M3); 28 baselines at **0.000 %**.

- [ ] **Step 4: Append the log line** to `docs/testing-log.md`:

```markdown
| 2026-08-0X <HH:MM> AEST | M4 | No live session: Gate A (M1 probe 8) returned an index-addressed repaint, so column reorder is closed as not technically possible. No reorder code was written and no substitute was built (Q3) | `save/CHECKPOINTS.md` M1 probe 8 transcript + M4 entry | No save; four-eyes gate not invoked |
```

- [ ] **Step 5: Append the checkpoint entry** to `save/CHECKPOINTS.md`:

```markdown
## Edit Mode Table Enhancements: Milestone M4 (column reorder — CLOSED, not technically possible)

Status: Closed with evidence; no code shipped
Date: 2026-08-0X

### Included

- Nothing. Gate A (M1 probe 8) returned an **index-addressed** repaint: after two `<td>`s were permuted in a non-focused row and an adjacent line was committed in-page, values re-appeared under different `_fs` span ids. A shipped reorder would put values in the wrong columns and serialize them that way, so drag-and-drop column reorder is declared **not technically possible in Edit Mode**.
- Per owner decision Q3, **no substitute was built**: not the read-only sorted/filtered overlay (a different product deserving its own brief), and not a warned-but-shipped reorder (it risks corrupting real sales order data). The spec's §8 reorder row now records the verdict with the probe transcript as its citation.
- M5 proceeds unaffected; nothing already shipped in M2 or M3 is touched.

### Verification

- Probe 8 transcript, verbatim, in the M1 checkpoint entry, read independently by an Opus 5 subagent that confirmed the index-addressed interpretation.
- `grep -rn "applyOrderEdit\|moveColumn\|planOrder\|REORDER_ENABLED\|dragstart" src/edit-grid/` returns nothing: the closed milestone leaves no dead affordance.
- Full `npm test`: 226 passing; 28 screenshot baselines untouched at 0.000 percent.
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-02-edit-mode-table-enhancements-design.md docs/testing-log.md save/CHECKPOINTS.md
git commit -m "docs: close column reorder as not technically possible on Gate A evidence"
```

---

# Milestone M5 — Column personalization (UI mode + scope hardening)

Four tasks. Runs identically on both Gate A branches; only the Personalize/Done buttons differ.

**Test-count note for every step below:** the Gate A PASS path starts from 229 tests, the close-out path from 226. Both add 2 in Task 24. State the observed number; **all-green plus 28 baselines at 0.000 % is the bar**.

### Task 24: Cross-record merge semantics in the core

**Files:**
- Modify: `src/edit-grid/core.js` (new functions after the storage writers; export block)
- Test: `tests/edit-grid.test.mjs` (two tests before the source-purity test)

**Interfaces:**
- Consumes: `MAX_COLUMN_IDS`, `normalizeColumnId` (Task 5).
- Produces: `core.mergeOrder(storedIds, machineIds, nextIds) -> string[]` and `core.mergeHidden(storedIds, machineIds, hiddenIds) -> string[]`. Task 25's `saveOrder`/`saveHidden` call these before writing, so a column that this form variant or page does not render is **retained in storage**, never silently erased (spec §7).

- [ ] **Step 1: Write the failing tests** — insert before the source-purity test:

```js
test("merging retains stored columns the current machine does not render", () => {
  const core = createApi();
  const stored = ["item", "custcol_variant", "quantity", "rate"];
  const machine = ["item", "quantity", "rate"];
  // A reorder on a machine that never rendered custcol_variant keeps it,
  // anchored after the stored predecessor that survives.
  assert.deepEqual(
    plain(core.mergeOrder(stored, machine, ["rate", "item", "quantity"])),
    ["rate", "item", "custcol_variant", "quantity"]
  );
  // No orphans: the merge is the identity.
  assert.deepEqual(
    plain(core.mergeOrder(machine, machine, ["rate", "item", "quantity"])),
    ["rate", "item", "quantity"]
  );
  // An orphan stored first anchors at the head.
  assert.deepEqual(
    plain(core.mergeOrder(["custcol_first", "item"], machine, ["quantity", "item", "rate"])),
    ["custcol_first", "quantity", "item", "rate"]
  );
  assert.deepEqual(plain(core.mergeOrder(null, machine, ["item", "rate", "quantity"])),
    ["item", "rate", "quantity"]);
});

test("merging hidden columns keeps off-machine ids and de-duplicates", () => {
  const core = createApi();
  assert.deepEqual(
    plain(core.mergeHidden(["custcol_variant", "quantity"], ["item", "quantity", "rate"], ["rate"])),
    ["custcol_variant", "rate"]
  );
  assert.deepEqual(
    plain(core.mergeHidden(["quantity"], ["item", "quantity"], ["quantity", "quantity"])),
    ["quantity"]
  );
  assert.deepEqual(plain(core.mergeHidden(null, ["item"], [])), []);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test tests/edit-grid.test.mjs 2>&1 | grep -E "not ok|ℹ fail"
```

Expected: FAIL — `core.mergeOrder is not a function`.

- [ ] **Step 3: Implement in `src/edit-grid/core.js`** — add after `withWidths`:

```js
  // ===== Cross-record merge: never erase a preference this page cannot see =====
  function cleanIdList(value) {
    const seen = new Set();
    const ids = [];
    for (const candidate of Array.isArray(value) ? value : []) {
      const id = typeof candidate === "string" ? normalizeColumnId(candidate) : null;
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    return ids;
  }

  function mergeOrder(storedIds, machineIds, nextIds) {
    const stored = cleanIdList(storedIds);
    const merged = cleanIdList(nextIds);
    const machine = new Set(cleanIdList(machineIds));
    for (const orphan of stored.filter((id) => !machine.has(id) && !merged.includes(id))) {
      const at = stored.indexOf(orphan);
      let anchor = -1;
      for (let index = at - 1; index >= 0; index -= 1) {
        const found = merged.indexOf(stored[index]);
        if (found >= 0) {
          anchor = found;
          break;
        }
      }
      merged.splice(anchor + 1, 0, orphan);
    }
    return merged.slice(0, MAX_COLUMN_IDS);
  }

  function mergeHidden(storedIds, machineIds, hiddenIds) {
    const machine = new Set(cleanIdList(machineIds));
    const offMachine = cleanIdList(storedIds).filter((id) => !machine.has(id));
    return cleanIdList([...offMachine, ...cleanIdList(hiddenIds)]).slice(0, MAX_COLUMN_IDS);
  }
```

Add `mergeOrder,` and `mergeHidden,` to the frozen export object.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: all green — 231 on the Gate A PASS path, 228 on the close-out path; 28 baselines at 0.000 %.

- [ ] **Step 5: Commit**

```bash
git add src/edit-grid/core.js tests/edit-grid.test.mjs
git commit -m "feat: retain off-machine column preferences when merging edit-grid saves"
```

### Task 25: Control bar completion — Reset, scope note, merged and hardened saves

**Files:**
- Modify: `src/edit-grid/runtime.js` (`ensureControls`, `updateControls`, `handleContainerClick`, `saveOrder`, `saveHidden`, `saveWidths`, `installEditGrid`)

**Interfaces:**
- Consumes: `core.mergeOrder`, `core.mergeHidden` (Task 24); `enqueueSave`, `ownedButton`, `controlButtons`, `queueApply` (Tasks 6, 16).
- Produces: `handleReset()`, `machineColumnIds()`, and save functions that merge against stored state before writing. `controlButtons` gains `reset` and `note`. No new storage fields.

- [ ] **Step 1: Add the Reset control and the scope note.** In `ensureControls`, after the `personalize`/`done` buttons add:

```js
    const reset = ownedButton("reset", "Reset");
    const note = document.createElement("span");
    note.className = core.CLASSES.note;
    note.setAttribute(core.DATA_ATTRIBUTE, "note");
    note.textContent = "Layout is saved for you on Sales Orders in Edit Mode.";
```

append them (`bar.append(...[columnsButton, personalize, done, reset, chips, note].filter(Boolean));`) and store both in `controlButtons`. On the Gate A close-out path `personalize` and `done` are `null` and filter out — the bar is `[Columns] [Reset] [chips] [note]` and nothing else changes.

- [ ] **Step 2: Add the Reset handler** beside `setColumnHidden`:

```js
  function machineColumnIds() {
    const table = machineTable();
    return table ? core.readColumnIds(table) : [];
  }

  function handleReset() {
    // Reset clears only THIS scope's entry. Deleting the whole entry shrinks the
    // stored item instead of growing it (empty-entry deletion, spec section 5).
    columnOrder = [];
    hiddenColumns = new Set();
    sessionRevealed = new Set();
    columnWidths = {};
    const table = machineTable();
    if (table && nativeColumnIds) {
      core.applyOrderEdit?.(table, nativeColumnIds, core.readColumnIds(table));
    }
    queueApply("reset");
    enqueueSave(async () => {
      try {
        if (!scopeKey) {
          return;
        }
        const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
        let next = core.withOrder(stored[core.STORAGE_KEY], scopeKey, null);
        next = next && core.withHidden(next, scopeKey, null);
        next = next && core.withWidths(next, scopeKey, null);
        if (!next) {
          showToast("Column layout could not be saved.", "warning");
          return;
        }
        await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
      } catch {
        showToast("Column layout could not be saved.", "warning");
      }
    });
  }
```

In `handleContainerClick`, add before the `chip` branch:

```js
    if (role === "reset") {
      event.preventDefault();
      handleReset();
      return;
    }
```

- [ ] **Step 3: Merge before writing.** In `saveOrder`, replace the `core.withOrder(…, columnOrder.length ? columnOrder : null)` argument with a merged list:

```js
        const container = core.normalizeStored(stored[core.STORAGE_KEY]);
        const previous = container.grids[scopeKey] ?? {};
        const merged = columnOrder.length
          ? core.mergeOrder(previous.order, machineColumnIds(), columnOrder)
          : null;
        const next = core.withOrder(stored[core.STORAGE_KEY], scopeKey, merged);
```

In `saveHidden`, the same shape with `mergeHidden`:

```js
        const container = core.normalizeStored(stored[core.STORAGE_KEY]);
        const previous = container.grids[scopeKey] ?? {};
        const merged = core.mergeHidden(previous.hidden, machineColumnIds(), [...hiddenColumns]);
        const next = core.withHidden(stored[core.STORAGE_KEY], scopeKey, merged.length ? merged : null);
```

In `saveWidths`, keep off-machine widths by merging the stored map under the current one:

```js
        const container = core.normalizeStored(stored[core.STORAGE_KEY]);
        const previous = container.grids[scopeKey]?.widths ?? {};
        const machine = new Set(machineColumnIds());
        const retained = Object.fromEntries(
          Object.entries(previous).filter(([id]) => !machine.has(id))
        );
        const merged = { ...retained, ...columnWidths };
        const next = core.withWidths(
          stored[core.STORAGE_KEY],
          scopeKey,
          Object.keys(merged).length ? merged : null
        );
```

- [ ] **Step 4: Report a rejected write once, without a retry storm.** In all three save functions the existing `if (!next) { showToast("Column layout could not be saved.", "warning"); return; }` already leaves the in-memory state and the DOM as the user sees them. Add the quota-pressure disclosure after a successful `set` in `saveOrder` only (one message, not three):

```js
        await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
        if (Object.keys(core.normalizeStored(next).grids).length === 1
          && Object.keys(core.normalizeStored(stored[core.STORAGE_KEY]).grids).length > 1) {
          // evictOverQuota kept only this scope: tell the user rather than
          // letting other Edit Mode scopes vanish silently.
          showToast("Other saved Edit Mode layouts were dropped to stay within the sync quota.", "warning");
        }
```

- [ ] **Step 5: Syntax and suite**

```bash
node --check src/edit-grid/runtime.js && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: no syntax error; all green (231 / 228); 28 baselines at 0.000 %.

- [ ] **Step 6: Fixture round-trip — one gesture one write, reload re-applies with zero writes, Reset shrinks the item**

Open `http://localhost:8931/tests/fixtures/sales-order-edit.html?salesOrderColumnsEdit=true` and run:

```js
// Seed a stored entry that mentions a column this machine does not render.
await chrome.storage.sync.set({
  suiteMateV3EditColumns: {
    schemaVersion: 1,
    grids: { "FIXTURE:1:salesord:edit": { hidden: ["custcol_ghost", "rate"], widths: { custcol_ghost: 120 } } }
  }
});
location.reload();
// after reload:
const cells = (index) => [...document.querySelectorAll('#item_splits tr[id^="item_row_"]')]
  .map((r) => [...r.cells].filter((c) => c.style.display !== "none")[index]);
delete document.documentElement.dataset.editGridWrites;
await new Promise((r) => setTimeout(r, 500));
console.log("reload writes:", document.documentElement.dataset.editGridWrites ?? "0");   // "0"
console.log("rate hidden:", cells(2).map((c) => getComputedStyle(c).display));

// Hiding another column keeps the ghost preference.
const box = (id) => {
  document.querySelector('[data-suitemate-v3-edit-grid="columns-button"]').click();
  return [...document.querySelectorAll('[data-suitemate-v3-edit-grid="column-toggle"]')]
    .find((b) => b.dataset.columnId === id);
};
const quantity = box("quantity");
quantity.checked = false;
quantity.dispatchEvent(new Event("change", { bubbles: true }));
await new Promise((r) => setTimeout(r, 500));
console.log("writes:", document.documentElement.dataset.editGridWrites);                 // "1"
console.log("stored:", JSON.stringify(SuiteMateV3Fixture.editColumns));

// Reset deletes the whole entry rather than growing the item.
delete document.documentElement.dataset.editGridWrites;
document.querySelector('[data-suitemate-v3-edit-grid="reset"]').click();
await new Promise((r) => setTimeout(r, 500));
console.log("after reset:", JSON.stringify(SuiteMateV3Fixture.editColumns),
  "writes:", document.documentElement.dataset.editGridWrites);
console.log("all visible:", cells(2).map((c) => getComputedStyle(c).display));
```

Expected: `reload writes: 0` with Rate computing `display: none`; hiding Quantity produces exactly `1` write and the stored `hidden` list is `["custcol_ghost","rate","quantity"]` (the ghost retained) with `widths.custcol_ghost` still `120`; Reset produces exactly `1` write, leaves `grids` empty (`{"schemaVersion":1,"grids":{}}`), and every column computes visible.

- [ ] **Step 7: Commit**

```bash
git add src/edit-grid/runtime.js
git commit -m "feat: Edit Mode personalization control bar with merged, quota-safe saves"
```

### Task 26: M5 live pass — the H2 mode-isolation regression

**Files:**
- Modify: `docs/testing-log.md`

**SAFETY PROTOCOL — restated in full because it binds every browser action in this task:**

1. **Record lock.** Account `6998262`, `id=16342809`, and no other record or transaction; the lock explicitly covers **the same record with `&e=T` appended** (Q2). Confirm the URL bar before ANY interaction. Any other record or account: **stop and report**. Never create additional test Sales Orders. Never open other transactions in Edit Mode.
2. **Safety triple — verify all three BEFORE testing begins and again BEFORE every save:** `custbody_salesorder_issue` checked (true); Status = Pending Approval; Memo clearly indicates a testing record. Any failure: do **not** save, stop, report.
3. **Four-eyes save gate.** Before every save: captain gathers evidence (URL bar with account + id, the three safety fields, a one-paragraph statement of what the save changes and why), dispatches an **Opus 5** save-gate subagent, which answers exactly **GO** or **NO-GO**. Default **NO-GO**. Save only on GO; on NO-GO stop and report. The first save of a session also needs the owner's explicit go-ahead in chat.
4. **This milestone requires no save.**
5. **Forbidden regardless of anything else:** Approve, Reject, Bill, Fulfill, Email, Print, Delete, Make Copy, or any status-changing or document-sending action.
6. **Every interpretation question is answered by an Opus 5 subagent from DOM evidence.** Browser testing stays sequential.
7. **Append one line to `docs/testing-log.md`** and ship it in the M5 checkpoint commit.

- [ ] **Step 1: Ask the owner to reload the extension** (one interrupt; the Edit Mode toggle stays ON). Wait for confirmation.

- [ ] **Step 2: Capture the View Mode storage BEFORE anything else**

```js
globalThis.__smViewBefore = JSON.stringify(
  (await chrome.storage.sync.get("suiteMateV3ColumnOrder")).suiteMateV3ColumnOrder ?? null);
globalThis.__smViewBefore.length
```

- [ ] **Step 3: Verify the safety triple** on `…salesord.nl?id=16342809&e=T` (snippet in Task 9 Step 1). Any deviation: stop and report.

- [ ] **Step 4: Exercise the full personalization cycle**

Resize two columns, hide two columns, (Gate A PASS only) reorder one column in Personalize mode, then reload the page and confirm everything re-applies. Then click **Reset** and confirm the machine returns to native. After each gesture, confirm exactly one storage write by reading the entry before and after:

```js
JSON.stringify((await chrome.storage.sync.get("suiteMateV3EditColumns")).suiteMateV3EditColumns)
```

An **Opus 5** subagent reads the captures and states pass/fail.

- [ ] **Step 5: The H2 regression — `suiteMateV3ColumnOrder` byte-identical**

```js
const after = JSON.stringify(
  (await chrome.storage.sync.get("suiteMateV3ColumnOrder")).suiteMateV3ColumnOrder ?? null);
console.log("view mode storage unchanged:", after === globalThis.__smViewBefore);
```

Expected: `true`. Also confirm the Edit Mode container only ever contains `…:salesord:edit` scopes. **Any difference is a stop-and-report: it would mean the two modes are not storage-isolated, which is the entire reason for the separate key.**

- [ ] **Step 6: View Mode regression (explicit)**

(a) Load `…salesord.nl?id=16342809` (view mode, same record): personalization, sort, filter and widths behave — specifically, the owner's **existing saved View Mode layout is intact**; Export view produces data rows, not headers-only; tab titles and internal-id badges unaffected; **zero SuiteMate console errors**. Opus 5 subagent states pass/fail from DOM evidence.

(b) ```bash
git diff --name-only main | grep so-columns
```
Expected: exactly `src/so-columns/core.js`.

- [ ] **Step 7: Append the log line**

```markdown
| 2026-08-0X <HH:MM> AEST | M5 | Personalization cycle on `id=16342809&e=T`: two resizes, two hides, one reorder (Gate A path), reload re-applied everything, Reset returned the machine to native and emptied the scope; `suiteMateV3ColumnOrder` byte-identical before and after (H2 regression) | `save/CHECKPOINTS.md` M5 entry | No save; four-eyes gate not invoked |
```

- [ ] **Step 8: Commit**

```bash
git add docs/testing-log.md
git commit -m "docs: record the M5 live personalization pass and H2 isolation check"
```

### Task 27: M5 checkpoint

**Files:**
- Modify: `save/CHECKPOINTS.md`

- [ ] **Step 1: Full gate**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
npm run fixtures:verify 2>&1 | tail -5
```

Expected: all green (231 on the Gate A PASS path, 228 on the close-out path); 28 baselines at **0.000 %**.

- [ ] **Step 2: Append the checkpoint entry**

```markdown
## Edit Mode Table Enhancements: Milestone M5 (personalization UI and scope hardening)

Status: Complete
Date: 2026-08-0X

### Included

- Control bar completed: Columns menu, hidden chips, Reset, and an in-UI scope note ("Layout is saved for you on Sales Orders in Edit Mode"), plus Personalize/Done where Gate A allowed reorder. Every button is `type="button"`; no `innerHTML`; every node stamped and swept.
- Cross-record merge semantics: `core.mergeOrder` and `core.mergeHidden` retain stored column ids the current machine does not render — a form variant or a later page can no longer silently erase a valid preference (spec section 7). Widths merge the same way.
- Quota and eviction hardening: eviction stays scoped to this feature's own `grids` container, so the worst case is losing other **Edit Mode** scopes, never a View Mode layout; when it fires the user is told rather than left to discover it. Reset deletes the whole entry, shrinking the stored item instead of growing it. All writes still flow through the single serialized save queue — at most one in-flight `set`, newest state wins.

### Verification

- Full `npm test`: <231 / 228> passing; 28 screenshot baselines untouched at 0.000 percent.
- Fixture: a seeded entry naming a column this machine does not render re-applied on reload with ZERO writes and survived a subsequent hide (one write, ghost preference retained); Reset produced exactly one write and left `grids` empty with every column visible again.
- Live on `id=16342809&e=T`: full cycle — two resizes, two hides, reorder where shipped, reload, Reset — each gesture exactly one storage write; only `…:salesord:edit` scopes touched.
- **H2 regression: `suiteMateV3ColumnOrder` byte-identical before and after the Edit Mode session**, and the owner's saved View Mode layout intact on the same record. Persistence is provably mode-isolated.
- View Mode regression on the same record: all features behave; zero SuiteMate console errors. `git diff --name-only main | grep so-columns` returns exactly `src/so-columns/core.js`.
```

- [ ] **Step 3: Commit**

```bash
git add save/CHECKPOINTS.md
git commit -m "docs: M5 checkpoint — Edit Mode personalization provably mode-isolated"
```

---

# Milestone M6 — Excel-style filtering (degraded, session-only, page-scope disclosed)

Four tasks. **Prerequisite:** M1 probe 6b recorded the machine as **not** natively drag-ordered. If it did record an ordered machine, filtering refuses permanently for that machine — run Task 28 (the refusal is an unconditional precondition either way), then close M6 with the same shape as Task 23A, citing the probe 6b transcript, and go to M7's close-out.

**Test-count note:** Gate A PASS path starts from 231, close-out path from 228; both add 3 in Task 28.

### Task 28: `core.applyRowFilters`, query parsing and distinct values

**Files:**
- Modify: `src/edit-grid/core.js` (new functions after the order section; export block)
- Test: `tests/edit-grid.test.mjs` (three tests before the source-purity test)

**Interfaces:**
- Consumes: `isDataRow`, `isExcludedRow`, `visibleCells`, `readCellText`, `headerRow`, `tableRows`, `isOrderedMachine`, `isPlainObject`, `CLASSES.rowFiltered` (Tasks 5, 15).
- Produces: `core.parseFilterQuery(raw) -> {op, value}|null`, `core.matchesFilter(cellText, query) -> boolean`, `core.applyRowFilters(table, queries, columnIds, forcedRows) -> boolean` where `queries` is `{ [columnId]: { anyOf?: string[], op?, value? } }`, and `core.distinctColumnValuesEdit(table, columnIndex, columnIds, cap) -> string[]`. Task 29 uses all four.

- [ ] **Step 1: Write the failing tests** — insert before the source-purity test:

```js
test("parses filter queries and matches values", () => {
  const core = createApi();
  assert.deepEqual(plain(core.parseFilterQuery(">= 100")), { op: ">=", value: 100 });
  assert.deepEqual(plain(core.parseFilterQuery("sku")), { op: "contains", value: "sku" });
  assert.equal(core.parseFilterQuery("   "), null);
  assert.equal(core.matchesFilter("SKU-1001", { op: "contains", value: "sku" }), true);
  assert.equal(core.matchesFilter("$36.00", { op: ">", value: 30 }), true);
  assert.equal(core.matchesFilter("$12.00", { op: ">", value: 30 }), false);
  assert.equal(core.matchesFilter("SKU-1001", { anyOf: ["SKU-1001", "SKU-2004"] }), true);
  assert.equal(core.matchesFilter("SKU-3300", { anyOf: ["SKU-1001"] }), false);
  assert.equal(core.matchesFilter("anything", null), true);
});

test("filters data rows by column id, never the excluded or forced rows", () => {
  const core = createApi();
  const table = createMachine({ lines: 3 });
  const columnIds = core.readColumnIds(table);
  const filtered = () => core.tableRows(table)
    .map((row) => row.cells[0]?.classList?.contains("suitemate-v3-edit-grid-row-filtered") ?? false);

  assert.equal(core.applyRowFilters(table, { item: { anyOf: ["SKU-1002"] } }, columnIds, []), true);
  // Header, machineButtonRow and totals row are never filtered.
  assert.deepEqual(filtered(), [false, true, false, true, false, false]);

  // A forced row (the open or dirty line) is always revealed.
  assert.equal(core.applyRowFilters(table, { item: { anyOf: ["SKU-1002"] } }, columnIds, [table.rows[1]]), true);
  assert.deepEqual(filtered(), [false, false, false, true, false, false]);

  // Clearing restores every row.
  assert.equal(core.applyRowFilters(table, {}, columnIds, []), true);
  assert.deepEqual(filtered(), [false, false, false, false, false, false]);
});

test("refuses to filter a natively drag-ordered machine and caps distinct values", () => {
  const core = createApi();
  const ordered = createMachine({ className: "uir-machine-table uir-draggable-table" });
  assert.equal(
    core.applyRowFilters(ordered, { item: { anyOf: ["SKU-1001"] } }, core.readColumnIds(ordered), []),
    false
  );
  const table = createMachine({ lines: 3 });
  const columnIds = core.readColumnIds(table);
  assert.deepEqual(plain(core.distinctColumnValuesEdit(table, 0, columnIds, 200)),
    ["SKU-1001", "SKU-1002", "SKU-1003"]);
  assert.deepEqual(plain(core.distinctColumnValuesEdit(table, 0, columnIds, 2)), []);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test tests/edit-grid.test.mjs 2>&1 | grep -E "not ok|ℹ fail"
```

Expected: FAIL — `core.parseFilterQuery is not a function`.

- [ ] **Step 3: Implement in `src/edit-grid/core.js`** — add after the order section:

```js
  // ===== Filtering (session-only, page-scoped) =====
  const NUMERIC_NOISE_PATTERN = /[$,%\s]/g;

  function cleanNumber(text) {
    return Number(String(text).replace(NUMERIC_NOISE_PATTERN, ""));
  }

  function parseFilterQuery(raw) {
    const text = String(raw ?? "").trim();
    if (!text) {
      return null;
    }
    const match = /^(>=|<=|>|<|=)\s*(.+)$/.exec(text);
    if (match) {
      const value = cleanNumber(match[2]);
      if (Number.isFinite(value)) {
        return { op: match[1], value };
      }
    }
    return { op: "contains", value: text.toLowerCase() };
  }

  function matchesFilter(cellText, query) {
    if (!query) {
      return true;
    }
    const raw = String(cellText ?? "").trim();
    if (Array.isArray(query.anyOf) && query.anyOf.length && !query.anyOf.includes(raw)) {
      return false;
    }
    if (!query.op) {
      return true;
    }
    if (query.op === "contains") {
      return raw.toLowerCase().includes(query.value);
    }
    const value = cleanNumber(raw);
    if (!Number.isFinite(value)) {
      return false;
    }
    switch (query.op) {
      case ">": return value > query.value;
      case "<": return value < query.value;
      case ">=": return value >= query.value;
      case "<=": return value <= query.value;
      default: return value === query.value;
    }
  }

  function applyRowFilters(table, queries, columnIds, forcedRows) {
    try {
      if (isOrderedMachine(table)) {
        // Row order is record data on a natively drag-ordered machine: hiding
        // rows there misleads about record content. Refuse, unconditionally.
        return false;
      }
      if (!headerRow(table) || !Array.isArray(columnIds) || !columnIds.length) {
        return false;
      }
      const active = isPlainObject(queries) ? queries : {};
      const forced = new Set(Array.isArray(forcedRows) ? forcedRows : []);
      for (const row of tableRows(table)) {
        // An open line does not align to the header, so it is never a data row
        // and can never be filtered out from under the user.
        if (isExcludedRow(row) || !isDataRow(row, columnIds)) {
          continue;
        }
        if (forced.has(row)) {
          row.classList?.toggle?.(CLASSES.rowFiltered, false);
          continue;
        }
        const cells = visibleCells(row);
        let visible = true;
        for (let index = 0; index < columnIds.length && visible; index += 1) {
          const query = active[columnIds[index]];
          if (query) {
            visible = matchesFilter(readCellText(cells[index]), query);
          }
        }
        row.classList?.toggle?.(CLASSES.rowFiltered, !visible);
      }
      return true;
    } catch {
      return false;
    }
  }

  function distinctColumnValuesEdit(table, columnIndex, columnIds, cap) {
    try {
      const values = new Set();
      for (const row of tableRows(table)) {
        if (!isDataRow(row, columnIds)) {
          continue;
        }
        const value = readCellText(visibleCells(row)[columnIndex]);
        if (value) {
          values.add(value);
        }
        if (values.size > cap) {
          return [];
        }
      }
      return Array.from(values).sort();
    } catch {
      return [];
    }
  }
```

Add `parseFilterQuery,`, `matchesFilter,`, `applyRowFilters,` and `distinctColumnValuesEdit,` to the frozen export object.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: all green (234 / 231); 28 baselines at 0.000 %.

- [ ] **Step 5: Commit**

```bash
git add src/edit-grid/core.js tests/edit-grid.test.mjs
git commit -m "feat: edit-grid row filtering with an unconditional ordered-machine refusal"
```

### Task 29: Runtime filter menu with page-scope disclosure

**Files:**
- Modify: `src/edit-grid/runtime.js` (module state; new filter section; `ensureControls`, `renderSignature`, `targetSignature`, `applyAll`, `handleContainerClick`, `installEditGrid`, `removeEditGrid`)

**Interfaces:**
- Consumes: `core.applyRowFilters`, `core.parseFilterQuery`, `core.distinctColumnValuesEdit`, `core.isOrderedMachine` (Tasks 5, 15, 28).
- Produces: `rowFilters: { [columnId]: { anyOf?: string[], op?, value? } }` (**session-only, never persisted**), `filterQueryText: { [columnId]: string }`, `applyCurrentFilters(table, columnIds)`, `forcedFilterRows(table, columnIds)`, `openFilterMenu(table, columnId)`, `setColumnFilter(columnId, next)`, `renderScopeNote(table, columnIds)`. M7 reuses `openFilterMenu` for its sort entries.

- [ ] **Step 1: Add module state.** Beside `let columnOrder = [];` add:

```js
  let rowFilters = {};
  let filterQueryText = {};
  let revealedRowIds = new Set();
  let lastDataRowCount = 0;
```

- [ ] **Step 2: Add the filter section** after the reorder (or hide) section:

```js
  // ===== Filtering: session-only, page-scoped, never persisted =====
  function dataRowsOf(table, columnIds) {
    return core.tableRows(table).filter((row) => core.isDataRow(row, columnIds));
  }

  function forcedFilterRows(table, columnIds) {
    const rows = dataRowsOf(table, columnIds);
    // Adding a line while filtered must not produce an invisible line.
    if (rows.length > lastDataRowCount && rows.length) {
      revealedRowIds.add(rows[rows.length - 1].id);
    }
    lastDataRowCount = rows.length;
    const forced = [...forcedRows()];
    for (const row of rows) {
      if (revealedRowIds.has(row.id)) {
        forced.push(row);
      }
    }
    return forced;
  }

  function filtersActive() {
    return Object.keys(rowFilters).length > 0;
  }

  function applyCurrentFilters(table, columnIds) {
    core.applyRowFilters(table, rowFilters, columnIds, forcedFilterRows(table, columnIds));
    renderScopeNote(table, columnIds);
  }

  function renderScopeNote(table, columnIds) {
    const note = controlButtons?.note;
    if (!note) {
      return;
    }
    const rows = dataRowsOf(table, columnIds);
    const shown = rows.filter((row) => !row.classList.contains(core.CLASSES.rowFiltered)).length;
    note.textContent = filtersActive()
      // Q4: the page scope is disclosed in the UI, not left to be discovered.
      ? `Showing ${shown} of ${rows.length} lines on this page. Filters are not saved.`
      : "Layout is saved for you on Sales Orders in Edit Mode.";
  }

  function setColumnFilter(columnId, next) {
    if (next) {
      rowFilters = { ...rowFilters, [columnId]: next };
    } else {
      const { [columnId]: removed, ...rest } = rowFilters;
      void removed;
      rowFilters = rest;
    }
    queueApply("filter");
  }

  function openFilterMenu(table, columnId) {
    closeColumnMenu();
    if (core.isOrderedMachine(table)) {
      showToast("This sublist is ordered by hand, so its rows cannot be filtered.", "warning");
      return;
    }
    const columnIds = core.readColumnIds(table);
    const index = columnIds.indexOf(columnId);
    if (index < 0) {
      return;
    }
    const menu = document.createElement("div");
    menu.className = core.CLASSES.menu;
    menu.setAttribute(core.DATA_ATTRIBUTE, "filter-menu");
    menu.dataset.columnId = columnId;

    const scope = document.createElement("div");
    scope.className = core.CLASSES.note;
    scope.textContent = `Filters ${dataRowsOf(table, columnIds).length} lines on this page only.`;
    const search = document.createElement("input");
    search.type = "search";
    search.setAttribute(core.DATA_ATTRIBUTE, "filter-search");
    search.placeholder = "Contains, or > 100";
    search.value = filterQueryText[columnId] ?? "";
    const clear = ownedButton("filter-clear", "Clear filter");
    menu.append(scope, search, clear);

    for (const value of core.distinctColumnValuesEdit(table, index, columnIds, 200)) {
      const row = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.setAttribute(core.DATA_ATTRIBUTE, "filter-value");
      box.dataset.value = value;
      box.checked = !rowFilters[columnId]?.anyOf || rowFilters[columnId].anyOf.includes(value);
      const text = document.createElement("span");
      text.textContent = value;
      row.append(box, text);
      menu.append(row);
    }

    menu.addEventListener("change", handleFilterMenuChange);
    menu.addEventListener("input", handleFilterMenuInput);
    menu.addEventListener("click", handleFilterMenuClick);
    const rect = headerCellsOf(table)[index].getBoundingClientRect();
    menu.style.left = `${Math.round(rect.left + window.scrollX)}px`;
    menu.style.top = `${Math.round(rect.bottom + window.scrollY + 2)}px`;
    document.body.append(menu);
    controlButtons.menu = menu;
  }

  function currentMenuColumnId() {
    return controlButtons?.menu?.dataset.columnId ?? null;
  }

  function recomputeColumnFilter(columnId) {
    // One place computes a column's query from the menu's own state, so the
    // checkbox path and the search-text path can never disagree — including on
    // a column with zero distinct values, where there are no checkboxes at all.
    const boxes = [...(controlButtons?.menu?.querySelectorAll(`[${core.DATA_ATTRIBUTE}="filter-value"]`) ?? [])];
    const checked = boxes.filter((entry) => entry.checked).map((entry) => entry.dataset.value);
    const anyOf = boxes.length && checked.length !== boxes.length ? checked : null;
    const query = core.parseFilterQuery(filterQueryText[columnId] ?? "");
    setColumnFilter(
      columnId,
      anyOf || query ? { ...(anyOf ? { anyOf } : {}), ...(query ?? {}) } : null
    );
  }

  function handleFilterMenuChange(event) {
    const box = event.target?.closest?.(`[${core.DATA_ATTRIBUTE}="filter-value"]`);
    const columnId = currentMenuColumnId();
    if (!box || !columnId) {
      return;
    }
    recomputeColumnFilter(columnId);
  }

  function handleFilterMenuInput(event) {
    const field = event.target?.closest?.(`[${core.DATA_ATTRIBUTE}="filter-search"]`);
    const columnId = currentMenuColumnId();
    if (!field || !columnId) {
      return;
    }
    filterQueryText = { ...filterQueryText, [columnId]: field.value };
    recomputeColumnFilter(columnId);
  }

  function handleFilterMenuClick(event) {
    const columnId = currentMenuColumnId();
    if (!event.target?.closest?.(`[${core.DATA_ATTRIBUTE}="filter-clear"]`) || !columnId) {
      return;
    }
    event.preventDefault();
    filterQueryText = { ...filterQueryText, [columnId]: "" };
    setColumnFilter(columnId, null);
    closeColumnMenu();
  }
```

- [ ] **Step 3: Open the menu from a header click.** A header cell is **not** a SuiteMate-owned node, so it never reaches the role branches — the header case has to be handled where the owned-node guard bails out. In `handleContainerClick`, replace

```js
    if (!owned || !table) {
      return;
    }
```

with

```js
    if (!table) {
      return;
    }
    if (!owned) {
      const headerCell = event.target?.closest?.("td");
      if (!personalizing && headerCell && headerCellsOf(table).includes(headerCell)) {
        const columnId = columnIdOfHeaderCell(table, headerCell);
        if (columnId) {
          event.preventDefault();
          openFilterMenu(table, columnId);
        }
      }
      return;
    }
```

(On the Gate A close-out path `personalizing` is always `false`; the guard still reads correctly.)

- [ ] **Step 4: Extend the seams and lifecycle hooks.**

(a) `renderSignature` — add:

```js
      filtered: core.tableRows(table).map((row) => row.classList?.contains(core.CLASSES.rowFiltered) === true)
```

(b) `targetSignature` — add the matching member computed from state:

```js
      filtered: (() => {
        const forced = new Set(forcedFilterRows(table, columnIds));
        return core.tableRows(table).map((row) => {
          if (!core.isDataRow(row, columnIds) || forced.has(row) || !filtersActive()) {
            return false;
          }
          const cells = core.visibleCells(row);
          return !columnIds.every((id, index) =>
            core.matchesFilter(core.readCellText(cells[index]), rowFilters[id]));
        });
      })()
```

(c) `applyAll` gains `applyCurrentFilters(table, applied);` as its last line.

(d) In `removeEditGrid`, inside the `try`, add:

```js
      core.applyRowFilters(table, {}, core.readColumnIds(table), []);
      rowFilters = {};
      filterQueryText = {};
      revealedRowIds = new Set();
      lastDataRowCount = 0;
```

(e) `installEditGrid` needs no restore line: **filters are session-only and never persisted** (spec §5 — the container reserves no keys for them).

- [ ] **Step 5: Syntax and suite**

```bash
node --check src/edit-grid/runtime.js && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: no syntax error; all green (234 / 231); 28 baselines at 0.000 %.

- [ ] **Step 6: Fixture round-trip — computed display per row, add-while-filtered, zero writes**

Open `http://localhost:8931/tests/fixtures/sales-order-edit.html?salesOrderColumnsEdit=true` and run:

```js
const table = document.querySelector("#item_splits");
const rowDisplay = () => [...table.querySelectorAll('tr[id^="item_row_"]')]
  .map((r) => [r.id, getComputedStyle(r).display]);

delete document.documentElement.dataset.editGridWrites;
const header = [...table.querySelector("tr.uir-machine-headerrow").cells]
  .filter((c) => c.style.display !== "none");
header[0].click();
const menu = document.querySelector('[data-suitemate-v3-edit-grid="filter-menu"]');
const boxes = [...menu.querySelectorAll('[data-suitemate-v3-edit-grid="filter-value"]')];
boxes.filter((b) => b.dataset.value !== "SKU-1001").forEach((b) => {
  b.checked = false;
  b.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 300));
console.log("rows:", rowDisplay());
console.log("note:", document.querySelector('[data-suitemate-v3-edit-grid="note"]').textContent);
console.log("writes:", document.documentElement.dataset.editGridWrites ?? "0");   // "0" — never persisted

// Adding a line while filtered must reveal the new line.
SuiteMateV3EditFixture.addLine();
await new Promise((r) => setTimeout(r, 300));
console.log("after add:", rowDisplay());

// Opening a line keeps its row visible even when it does not match.
SuiteMateV3EditFixture.openLine(2);
await new Promise((r) => setTimeout(r, 300));
console.log("open row visible:", getComputedStyle(document.querySelector("#item_row_2")).display);
SuiteMateV3EditFixture.closeLine();

// Clearing restores every row.
header[0].click();
document.querySelector('[data-suitemate-v3-edit-grid="filter-clear"]').click();
await new Promise((r) => setTimeout(r, 300));
console.log("cleared:", rowDisplay());
```

Expected: only `item_row_1` computes `display: table-row` while the others compute `none` (**assert at computed display**); the control-bar note reads `Showing 1 of 3 lines on this page. Filters are not saved.`; `writes: 0` throughout — filtering never touches storage; after `addLine` the new row is visible; the opened row computes visible even though it does not match; after Clear every row computes visible again.

- [ ] **Step 7: Commit**

```bash
git add src/edit-grid/runtime.js
git commit -m "feat: Edit Mode row filtering, session-only with page scope disclosed"
```

### Task 30: M6 live pass and View Mode regression

**Files:**
- Modify: `docs/testing-log.md`

**SAFETY PROTOCOL — restated in full because it binds every browser action in this task:**

1. **Record lock.** Account `6998262`, `id=16342809`, and no other record or transaction; the lock explicitly covers **the same record with `&e=T` appended** (Q2). Confirm the URL bar before ANY interaction. Any other record or account: **stop and report**. Never create additional test Sales Orders. Never open other transactions in Edit Mode.
2. **Safety triple — verify all three BEFORE testing begins and again BEFORE every save:** `custbody_salesorder_issue` checked (true); Status = Pending Approval; Memo clearly indicates a testing record. Any failure: do **not** save, stop, report.
3. **Four-eyes save gate.** Before every save: captain gathers evidence (URL bar with account + id, the three safety fields, a one-paragraph statement of what the save changes and why), dispatches an **Opus 5** save-gate subagent, which answers exactly **GO** or **NO-GO**. Default **NO-GO**. Save only on GO; on NO-GO stop and report. The first save of a session also needs the owner's explicit go-ahead in chat.
4. **This milestone requires no save.**
5. **Forbidden regardless of anything else:** Approve, Reject, Bill, Fulfill, Email, Print, Delete, Make Copy, or any status-changing or document-sending action.
6. **Every interpretation question is answered by an Opus 5 subagent from DOM evidence.** Browser testing stays sequential.
7. **Append one line to `docs/testing-log.md`** and ship it in the M6 checkpoint commit.

- [ ] **Step 1: Ask the owner to reload the extension** (one interrupt; the Edit Mode toggle stays ON). Wait for confirmation.

- [ ] **Step 2: Verify the safety triple** on `…salesord.nl?id=16342809&e=T` (snippet in Task 9 Step 1). Any deviation: stop and report.

- [ ] **Step 3: Re-run probe 12 and confirm the disclosure is truthful**

```js
[
  document.querySelectorAll('#item_splits tr[id^="item_row_"]').length,
  globalThis.nlapiGetLineItemCount?.('item') ?? null,
  document.querySelector('[data-suitemate-v3-edit-grid="note"]')?.textContent
]
```

The note's "N lines on this page" must match the rendered row count, and the disclosure must be visible **in the control bar**, not only in a doc.

- [ ] **Step 4: Exercise filtering around NetSuite's own behaviours**

- Filter a column to a single value; confirm at computed level which rows are hidden.
- **Filter → Add a line:** the new line must be visible immediately.
- **Filter → open a line that does not match:** its row must stay visible, and the line must commit normally (in-page OK, no save).
- Confirm the totals row still shows full totals and is never hidden, and that `machineButtonRow` is never hidden.
- Clear the filter and confirm every row returns.
- Confirm `chrome.storage.sync.get("suiteMateV3EditColumns")` is **unchanged** across all of the above — filters are session-only.

An **Opus 5** subagent reads the captures and states pass/fail.

- [ ] **Step 5: View Mode regression (explicit)**

(a) Load `…salesord.nl?id=16342809` (view mode, same record): personalization, sort, filter and widths behave; Export view produces data rows, not headers-only; tab titles and internal-id badges unaffected; **zero SuiteMate console errors**. Opus 5 subagent states pass/fail from DOM evidence.

(a2) The H2 mode-isolation check (spec §9 tier 4 — mandatory from M5 onward):

```js
await chrome.storage.sync.get(["suiteMateV3EditColumns", "suiteMateV3ColumnOrder"])
```

Expected: only a `…:salesord:edit` scope appears under `suiteMateV3EditColumns`; `suiteMateV3ColumnOrder` is byte-identical to the value captured before this session (capture it before Step 3 and diff the JSON strings).

(b) ```bash
git diff --name-only main | grep so-columns
```
Expected: exactly `src/so-columns/core.js`.

- [ ] **Step 6: Append the log line**

```markdown
| 2026-08-0X <HH:MM> AEST | M6 | Filtering on `id=16342809&e=T`: probe 12 re-run (<rendered> rendered vs <total> lines); single-value filter, add-while-filtered revealed the new line, opening a non-matching line kept its row visible and the line committed, totals and button rows never hidden, Clear restored every row; `suiteMateV3EditColumns` unchanged throughout | `save/CHECKPOINTS.md` M6 entry | No save; four-eyes gate not invoked |
```

- [ ] **Step 7: Commit**

```bash
git add docs/testing-log.md
git commit -m "docs: record the M6 live filtering pass"
```

### Task 31: M6 checkpoint

**Files:**
- Modify: `save/CHECKPOINTS.md`

- [ ] **Step 1: Full gate**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
npm run fixtures:verify 2>&1 | tail -5
```

Expected: all green (234 / 231); 28 baselines at **0.000 %**.

- [ ] **Step 2: Append the checkpoint entry**

```markdown
## Edit Mode Table Enhancements: Milestone M6 (Excel-style filtering)

Status: Complete — degraded and disclosed
Date: 2026-08-0X

### Included

- `core.applyRowFilters` toggles one class on `<tr>` rendered `display: none !important`. No node movement, no focus loss, row ids untouched — the safest mechanism available in a live editing surface.
- Refusals and reveals are structural, not best-effort: a natively drag-ordered machine (`.uir-draggable-table` / `.uir-list-machine-ordered` / `td.movable`) is refused outright because there row order is record data; an open line does not align to the header, so it is never a data row and can never be filtered out from under the user; a line added while a filter is active is force-revealed; `machineButtonRow`, totals, loading and nodata rows are never filtered.
- **Page scope is disclosed in the control bar** (Q4): "Showing N of M lines on this page. Filters are not saved." Filters are session-only and never persisted — the storage container reserves no keys for them, so adding persistence later is a schema bump, not a silent extension.

### Verification

- Full `npm test`: <234 / 231> passing; 28 screenshot baselines untouched at 0.000 percent.
- Fixture: computed `display` per row matched the filter exactly; ZERO storage writes across every filter gesture; a line added while filtered was revealed; an opened non-matching line stayed visible; Clear restored every row.
- Live on `id=16342809&e=T`: probe 12 re-run and the control-bar disclosure matched the rendered row count; filter → add → open → in-page commit all behaved; totals row kept showing full totals; `suiteMateV3EditColumns` unchanged throughout.
- View Mode regression on the same record: all features behave; zero SuiteMate console errors. `git diff --name-only main | grep so-columns` returns exactly `src/so-columns/core.js`.
```

- [ ] **Step 3: Commit**

```bash
git add save/CHECKPOINTS.md
git commit -m "docs: M6 checkpoint — Edit Mode filtering shipped degraded and disclosed"
```

---

# Milestone M7 — Excel-style sorting, with a live-evidence exit

Six tasks (32-33 build, 34 live with the exit branch or 34A close-out, then 35-37 close the project). **Prerequisite:** M1 probe 6b recorded the machine as **not** natively drag-ordered; if it did, run Task 32 (the refusal is unconditional) and then Task 34A directly.

**Test-count note:** Gate A PASS path starts from 234, close-out path from 231; both add 3 in Task 32.

### Task 32: `core.sortRowsEdit` with an Edit-Mode contiguity definition

**Files:**
- Modify: `src/edit-grid/core.js` (new functions after the filter section; export block)
- Test: `tests/edit-grid.test.mjs` (stub helper + three tests before the source-purity test)

**Interfaces:**
- Consumes: `isDataRow`, `visibleCells`, `readCellText`, `isOrderedMachine`, `tableRows`, `NATIVE_ROW_ATTRIBUTE` (Tasks 5, 15) and the private helper `cleanNumber` (Task 28) — `parseSortValue`/`detectColumnKind` do not parse without it, so **Task 28 must be run even on the branch where M6 is closed**.
- Produces: `core.parseSortValue(text, kind) -> {empty, value}`, `core.detectColumnKind(values) -> "text"|"number"|"date"`, `core.sortRowsEdit(table, columnIndex, direction, columnIds) -> boolean` with `direction ∈ {"asc","desc","native"}`. Task 33 uses all three.

- [ ] **Step 1: Give the stub a parent node.** In `tests/edit-grid.test.mjs`, add this helper beside `createTable` and call it at the end of `createMachine` (`return attachParent(createTable([...]));`):

```js
function attachParent(table) {
  const parent = {
    insertBefore(node, reference) {
      const from = table.rows.indexOf(node);
      if (from >= 0) {
        table.rows.splice(from, 1);
      }
      const at = reference ? table.rows.indexOf(reference) : -1;
      table.rows.splice(at < 0 ? table.rows.length : at, 0, node);
      return node;
    }
  };
  for (const row of table.rows) {
    row.parentNode = parent;
    Object.defineProperty(row, "nextSibling", {
      get: () => table.rows[table.rows.indexOf(row) + 1] ?? null,
      configurable: true
    });
  }
  return table;
}
```

- [ ] **Step 2: Write the failing tests** — insert before the source-purity test:

```js
test("detects column kinds and parses sort values", () => {
  const core = createApi();
  assert.equal(core.detectColumnKind(["1", "2", "13"]), "number");
  assert.equal(core.detectColumnKind(["$18.00", "$4.50"]), "number");
  assert.equal(core.detectColumnKind(["13/07/2026", "01/01/2025"]), "date");
  assert.equal(core.detectColumnKind(["SKU-1", "SKU-2"]), "text");
  assert.deepEqual(plain(core.parseSortValue("$36.00", "number")), { empty: false, value: 36 });
  assert.deepEqual(plain(core.parseSortValue("", "number")), { empty: true, value: 0 });
  assert.deepEqual(plain(core.parseSortValue("SKU-2", "text")), { empty: false, value: "sku-2" });
});

test("sorts Edit Mode data rows and restores native order from stamps", () => {
  const core = createApi();
  const table = createMachine({ lines: 3 });
  const columnIds = core.readColumnIds(table);
  const items = () => core.tableRows(table)
    .filter((row) => core.isDataRow(row, columnIds))
    .map((row) => core.visibleCells(row)[0].textContent);

  assert.equal(core.sortRowsEdit(table, 0, "desc", columnIds), true);
  assert.deepEqual(items(), ["SKU-1003", "SKU-1002", "SKU-1001"]);
  assert.equal(core.sortRowsEdit(table, 0, "asc", columnIds), true);
  assert.deepEqual(items(), ["SKU-1001", "SKU-1002", "SKU-1003"]);
  assert.equal(core.sortRowsEdit(table, 0, "native", columnIds), true);
  assert.deepEqual(items(), ["SKU-1001", "SKU-1002", "SKU-1003"]);
  // The totals row stays put: only data rows move, and the anchor is the last
  // data row's next sibling.
  assert.equal(core.tableRows(table).at(-1).className, "totalrow");
  assert.equal(core.sortRowsEdit(table, 9, "asc", columnIds), false);
  assert.equal(core.sortRowsEdit(table, 0, "sideways", columnIds), false);
});

test("sorting refuses an open line and a natively drag-ordered machine", () => {
  const core = createApi();
  const table = createMachine({ lines: 3 });
  const columnIds = core.readColumnIds(table);
  // Move the machineButtonRow between two data rows: an open line.
  const buttonRow = table.rows.splice(table.rows.findIndex((r) => r.className === "machineButtonRow"), 1)[0];
  table.rows.splice(2, 0, buttonRow);
  assert.equal(core.sortRowsEdit(table, 0, "asc", columnIds), false);

  const ordered = createMachine({ lines: 3, className: "uir-machine-table uir-draggable-table" });
  assert.equal(core.sortRowsEdit(ordered, 0, "asc", core.readColumnIds(ordered)), false);
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
node --test tests/edit-grid.test.mjs 2>&1 | grep -E "not ok|ℹ fail"
```

Expected: FAIL — `core.detectColumnKind is not a function`.

- [ ] **Step 4: Implement in `src/edit-grid/core.js`** — add after the filter section:

```js
  // ===== Sorting (session-only, true <tr> movement — no CSS alternative) =====
  const DATE_PATTERN = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;

  function parseSortValue(text, kind) {
    const raw = String(text ?? "").trim();
    if (!raw) {
      return { empty: true, value: 0 };
    }
    if (kind === "number") {
      const value = cleanNumber(raw);
      return Number.isFinite(value) ? { empty: false, value } : { empty: true, value: 0 };
    }
    if (kind === "date") {
      const match = DATE_PATTERN.exec(raw);
      if (!match) {
        return { empty: true, value: 0 };
      }
      // Day-first (dd/mm/yyyy) matching this account's locale, as View Mode does.
      const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
      return { empty: false, value: year * 10000 + Number(match[2]) * 100 + Number(match[1]) };
    }
    return { empty: false, value: raw.toLowerCase() };
  }

  function detectColumnKind(values) {
    const raw = Array.isArray(values)
      ? values.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    if (!raw.length) {
      return "text";
    }
    const numbers = raw.filter((value) => /\d/.test(value) && Number.isFinite(cleanNumber(value))).length;
    const dates = raw.filter((value) => DATE_PATTERN.test(value)).length;
    if (dates >= raw.length * 0.6) {
      return "date";
    }
    if (numbers >= raw.length * 0.6) {
      return "number";
    }
    return "text";
  }

  function sortRowsEdit(table, columnIndex, direction, columnIds) {
    try {
      if (isOrderedMachine(table)) {
        return false;
      }
      const all = tableRows(table);
      const dataRows = all.filter((row) => isDataRow(row, columnIds));
      if (dataRows.length < 2 || typeof dataRows[0]?.getAttribute !== "function") {
        return false;
      }
      const first = all.indexOf(dataRows[0]);
      const last = all.indexOf(dataRows[dataRows.length - 1]);
      for (let index = first; index <= last; index += 1) {
        if (!isDataRow(all[index], columnIds)) {
          // Edit-Mode contiguity: a machineButtonRow (an open line), a totals row
          // or any non-data row INSIDE the data range means the machine is
          // mid-edit or structured in a way this sort cannot honour. Fail closed.
          return false;
        }
      }
      dataRows.forEach((row, index) => {
        if (row.getAttribute(NATIVE_ROW_ATTRIBUTE) === null) {
          row.setAttribute(NATIVE_ROW_ATTRIBUTE, String(index));
        }
      });
      const stampOf = (row, fallback) => {
        const stamp = Number(row.getAttribute(NATIVE_ROW_ATTRIBUTE));
        return Number.isFinite(stamp) ? stamp : fallback;
      };

      let ordered;
      if (direction === "native") {
        ordered = dataRows.slice().sort((a, b) => stampOf(a, 0) - stampOf(b, 0));
      } else if (direction === "asc" || direction === "desc") {
        if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= columnIds.length) {
          return false;
        }
        const texts = dataRows.map((row) => readCellText(visibleCells(row)[columnIndex]));
        const kind = detectColumnKind(texts);
        const sign = direction === "desc" ? -1 : 1;
        ordered = dataRows
          .map((row, index) => ({
            row,
            key: parseSortValue(texts[index], kind),
            tie: stampOf(row, index)
          }))
          .sort((a, b) => {
            if (a.key.empty !== b.key.empty) {
              return a.key.empty ? 1 : -1;
            }
            const cmp = a.key.value < b.key.value ? -1 : a.key.value > b.key.value ? 1 : 0;
            return cmp !== 0 ? sign * cmp : a.tie - b.tie;
          })
          .map((mapped) => mapped.row);
      } else {
        return false;
      }

      const parent = dataRows[0].parentNode;
      const anchor = dataRows[dataRows.length - 1].nextSibling ?? null;
      if (!parent?.insertBefore) {
        return false;
      }
      for (const row of ordered) {
        parent.insertBefore(row, anchor);
      }
      return true;
    } catch {
      return false;
    }
  }
```

Add `parseSortValue,`, `detectColumnKind,` and `sortRowsEdit,` to the frozen export object.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: all green (237 / 234); 28 baselines at 0.000 %.

- [ ] **Step 6: Commit**

```bash
git add src/edit-grid/core.js tests/edit-grid.test.mjs
git commit -m "feat: edit-grid row sorting with an Edit Mode contiguity definition"
```

### Task 33: Runtime sort entries, refusal while a line is open, line-number suppression

**Files:**
- Modify: `src/edit-grid/runtime.js` (module state; sort section; `openFilterMenu`, `renderScopeNote`, `renderSignature`, `targetSignature`, `applyAll`, `removeEditGrid`)
- Modify: `src/edit-grid/edit-grid.css` (one rule)

**Interfaces:**
- Consumes: `core.sortRowsEdit`, `core.isOrderedMachine` (Tasks 5, 32); `openFilterMenu`, `queueApply`, `isLineOpen`, `showToast`, `renderScopeNote` (Tasks 6, 16, 29).
- Produces: `sortState: { columnId, dir } | null` (**session-only, never persisted**), `applyCurrentSort(table, columnIds)`, `setSort(columnId, dir)`, `handleSortClick(event)`.

- [ ] **Step 1: Suppress the native line numbers while sorted.** Append to `src/edit-grid/edit-grid.css`:

```css
/* .sln line numbers count VISUAL position, so they read wrong while sorted.
   Suppress the display and disclose it in the control bar rather than showing
   a number that lies about which line the user is editing. */
#item_splits.suitemate-v3-edit-grid-sorted td.sln,
#item_splits.suitemate-v3-edit-grid-sorted .sln {
    visibility: hidden !important
}
```

- [ ] **Step 2: Add module state.** Beside `let rowFilters = {};` add:

```js
  let sortState = null;
```

- [ ] **Step 3: Add the sort section** after the filter section:

```js
  // ===== Sorting: session-only, refused while a line is open =====
  function applyCurrentSort(table, columnIds) {
    if (!sortState) {
      table.classList.remove("suitemate-v3-edit-grid-sorted");
      return;
    }
    const index = columnIds.indexOf(sortState.columnId);
    if (index < 0) {
      return;
    }
    const applied = core.sortRowsEdit(table, index, sortState.dir, columnIds);
    table.classList.toggle("suitemate-v3-edit-grid-sorted", applied && sortState.dir !== "native");
  }

  function setSort(columnId, dir) {
    const table = machineTable();
    if (!table) {
      return;
    }
    if (core.isOrderedMachine(table)) {
      showToast("This sublist is ordered by hand, so its rows cannot be sorted.", "warning");
      return;
    }
    if (isLineOpen()) {
      // Refused, never queued: moving a <tr> that contains the focused widget
      // blurs it and can abort a sourcing round-trip.
      showToast("Finish editing the line first.", "warning");
      return;
    }
    sortState = dir === "native" ? null : { columnId, dir };
    if (dir === "native") {
      core.sortRowsEdit(table, 0, "native", core.readColumnIds(table));
      table.classList.remove("suitemate-v3-edit-grid-sorted");
    }
    queueApply("sort");
  }

  function handleSortClick(event) {
    const button = event.target?.closest?.(`[${core.DATA_ATTRIBUTE}="sort"]`);
    const columnId = currentMenuColumnId();
    if (!button || !columnId) {
      return;
    }
    event.preventDefault();
    setSort(columnId, button.dataset.dir);
    closeColumnMenu();
  }
```

- [ ] **Step 4: Add the three sort entries to the header menu.** In `openFilterMenu`, immediately after `const clear = ownedButton("filter-clear", "Clear filter");` add:

```js
    const sortAsc = ownedButton("sort", "Sort ascending");
    sortAsc.dataset.dir = "asc";
    const sortDesc = ownedButton("sort", "Sort descending");
    sortDesc.dataset.dir = "desc";
    const sortNative = ownedButton("sort", "Native order");
    sortNative.dataset.dir = "native";
```

change the first `menu.append(...)` to `menu.append(scope, sortAsc, sortDesc, sortNative, search, clear);` and add `menu.addEventListener("click", handleSortClick);` beside the existing menu listeners.

- [ ] **Step 5: Disclose the sort in the control bar.** In `renderScopeNote`, replace the assignment with:

```js
    const parts = [];
    if (filtersActive()) {
      parts.push(`Showing ${shown} of ${rows.length} lines on this page`);
    }
    if (sortState) {
      parts.push("sorted for viewing only — line numbers are hidden while sorted");
    }
    note.textContent = parts.length
      ? `${parts.join(" · ")}. Sorting and filters are not saved.`
      : "Layout is saved for you on Sales Orders in Edit Mode.";
```

- [ ] **Step 6: Extend the seams and teardown.**

(a) `renderSignature` — add:

```js
      order: core.tableRows(table)
        .filter((row) => core.isDataRow(row, columnIds))
        .map((row) => row.id)
```

(b) `targetSignature` — add the matching member. When no sort is active the target is whatever the DOM currently has (sorting is not re-derived from storage — it is session state applied by `applyCurrentSort`), so mirror the render value and let `applyCurrentSort` be idempotent:

```js
      order: core.tableRows(table)
        .filter((row) => core.isDataRow(row, columnIds))
        .map((row) => row.id)
```

(c) `applyAll` gains `applyCurrentSort(table, applied);` immediately before `applyCurrentFilters(table, applied);` — sort moves rows, filter then hides them.

(d) In `removeEditGrid`, inside the `try`, before the filter reset add:

```js
      if (table) {
        core.sortRowsEdit(table, 0, "native", core.readColumnIds(table));
        table.classList.remove("suitemate-v3-edit-grid-sorted");
      }
      sortState = null;
```

- [ ] **Step 7: Syntax and suite**

```bash
node --check src/edit-grid/runtime.js && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
```

Expected: no syntax error; all green (237 / 234); 28 baselines at 0.000 %.

- [ ] **Step 8: Fixture round-trip — sort, repaint, refusal while focused**

Open `http://localhost:8931/tests/fixtures/sales-order-edit.html?salesOrderColumnsEdit=true` and run:

```js
const table = document.querySelector("#item_splits");
const order = () => [...table.querySelectorAll('tr[id^="item_row_"]')]
  .map((r) => [...r.cells].filter((c) => c.style.display !== "none")[0].textContent.trim());

delete document.documentElement.dataset.editGridWrites;
const header = [...table.querySelector("tr.uir-machine-headerrow").cells]
  .filter((c) => c.style.display !== "none");
header[0].click();
[...document.querySelectorAll('[data-suitemate-v3-edit-grid="sort"]')]
  .find((b) => b.dataset.dir === "desc").click();
await new Promise((r) => setTimeout(r, 300));
console.log("sorted:", order(), "writes:", document.documentElement.dataset.editGridWrites ?? "0");
console.log("note:", document.querySelector('[data-suitemate-v3-edit-grid="note"]').textContent);
console.log("sorted class:", table.classList.contains("suitemate-v3-edit-grid-sorted"));
console.log("totals last:", [...table.rows].at(-1).className);

// Re-applied after a full <tbody> regenerate, still with zero writes.
SuiteMateV3EditFixture.repaint();
await new Promise((r) => setTimeout(r, 300));
console.log("after repaint:", order(), "writes:", document.documentElement.dataset.editGridWrites ?? "0");

// Refused while a line is open.
SuiteMateV3EditFixture.openLine(2);
await new Promise((r) => setTimeout(r, 100));
const before = order();
[...table.querySelector("tr.uir-machine-headerrow").cells].filter((c) => c.style.display !== "none")[0].click();
[...document.querySelectorAll('[data-suitemate-v3-edit-grid="sort"]')]
  .find((b) => b.dataset.dir === "asc").click();
await new Promise((r) => setTimeout(r, 300));
console.log("refused:", order().join("|") === before.join("|"));
SuiteMateV3EditFixture.closeLine();

// Native order restores from the row stamps.
[...table.querySelector("tr.uir-machine-headerrow").cells].filter((c) => c.style.display !== "none")[0].click();
[...document.querySelectorAll('[data-suitemate-v3-edit-grid="sort"]')]
  .find((b) => b.dataset.dir === "native").click();
await new Promise((r) => setTimeout(r, 300));
console.log("native:", order(), "sorted class:", table.classList.contains("suitemate-v3-edit-grid-sorted"));
```

Expected: `sorted: ["SKU-3300","SKU-2004","SKU-1001"]` with `writes: 0` (**sorting is never persisted**); the note discloses "sorted for viewing only — line numbers are hidden while sorted"; the sorted class is present and the totals row is still last; the order survives a full regenerate with zero writes; `refused: true` with a "Finish editing the line first." toast; Native order restores the original sequence and drops the class.

- [ ] **Step 9: Commit**

```bash
git add src/edit-grid/runtime.js src/edit-grid/edit-grid.css
git commit -m "feat: Edit Mode row sorting, session-only and refused while a line is open"
```

### Task 34: M7 live pass — with the Q4 exit condition

**Files:**
- Modify: `docs/testing-log.md`

**SAFETY PROTOCOL — restated in full because it binds every browser action in this task:**

1. **Record lock.** Account `6998262`, `id=16342809`, and no other record or transaction; the lock explicitly covers **the same record with `&e=T` appended** (Q2). Confirm the URL bar before ANY interaction. Any other record or account: **stop and report**. Never create additional test Sales Orders. Never open other transactions in Edit Mode.
2. **Safety triple — verify all three BEFORE testing begins and again BEFORE every save:** `custbody_salesorder_issue` checked (true); Status = Pending Approval; Memo clearly indicates a testing record. Any failure: do **not** save, stop, report.
3. **Four-eyes save gate.** Before every save: captain gathers evidence (URL bar with account + id, the three safety fields, a one-paragraph statement of what the save changes and why), dispatches an **Opus 5** save-gate subagent, which answers exactly **GO** or **NO-GO**. Default **NO-GO**. Save only on GO; on NO-GO stop and report. The first save of a session also needs the owner's explicit go-ahead in chat.
4. **This milestone requires no save.** Line commits are in-page only.
5. **Forbidden regardless of anything else:** Approve, Reject, Bill, Fulfill, Email, Print, Delete, Make Copy, or any status-changing or document-sending action.
6. **Every interpretation question is answered by an Opus 5 subagent from DOM evidence.** Browser testing stays sequential.
7. **Append one line to `docs/testing-log.md`** and ship it in the M7 checkpoint commit.

- [ ] **Step 1: Ask the owner to reload the extension** (one interrupt; the Edit Mode toggle stays ON). Wait for confirmation.

- [ ] **Step 2: Verify the safety triple** on `…salesord.nl?id=16342809&e=T` (snippet in Task 9 Step 1). Any deviation: stop and report.

- [ ] **Step 3: Sort, then exercise every native behaviour around it**

Sort a column descending, then in order: **add** a line, **remove** a line, trigger a **recalc** (commit a Quantity change in-page), and open + commit a line. After each, capture:

```js
(() => {
  const t = document.querySelector('#item_splits');
  const rows = [...t.querySelectorAll('tr[id^="item_row_"]')];
  return {
    order: rows.map((r) => r.id),
    firstCells: rows.map((r) => [...r.cells].filter((c) => c.style.display !== 'none')[0].textContent.trim()),
    slnVisible: [...t.querySelectorAll('.sln')].map((n) => getComputedStyle(n).visibility),
    note: document.querySelector('[data-suitemate-v3-edit-grid="note"]')?.textContent,
    errors: null
  };
})()
```

Also confirm: sorting is **refused with a toast while a line is open**; `.sln` line numbers are suppressed while sorted; **zero SuiteMate console errors** throughout; and that every in-page commit landed on the **intended** line (read the value back from the row whose `_fs` span ids you edited, not from a position).

An **Opus 5** subagent reads all four captures and states pass/fail.

- [ ] **Step 4: Apply the Q4 exit condition**

- **No interference observed** (commits land on the intended lines, sourcing completes, no console errors) → M7 ships. Continue to Step 5.
- **Any interference with line commits or sourcing** → **M7 is closed as not-shipped.** Do not iterate, do not attempt a fix: go to **Task 34A** and revert the code. This is Q4's explicit exit, and the ladder was ordered so abandoning M7 costs nothing already shipped.

- [ ] **Step 5: View Mode regression (explicit)**

(a) Load `…salesord.nl?id=16342809` (view mode, same record): personalization, sort, filter and widths behave; Export view produces data rows, not headers-only; tab titles and internal-id badges unaffected; **zero SuiteMate console errors**. Opus 5 subagent states pass/fail from DOM evidence.

(a2) The H2 mode-isolation check (spec §9 tier 4 — mandatory from M5 onward):

```js
await chrome.storage.sync.get(["suiteMateV3EditColumns", "suiteMateV3ColumnOrder"])
```

Expected: only a `…:salesord:edit` scope appears under `suiteMateV3EditColumns`; `suiteMateV3ColumnOrder` is byte-identical to the value captured before this session (capture it before Step 3 and diff the JSON strings).

(b) ```bash
git diff --name-only main | grep so-columns
```
Expected: exactly `src/so-columns/core.js`.

- [ ] **Step 6: Append the log line**

```markdown
| 2026-08-0X <HH:MM> AEST | M7 | Sorting on `id=16342809&e=T`: column sorted descending, then add-line, remove-line, recalc and an in-page line commit; commits landed on the intended lines; `.sln` numbers suppressed while sorted and disclosed in the control bar; sort refused while a line was open; zero SuiteMate console errors | `save/CHECKPOINTS.md` M7 entry | No save; four-eyes gate not invoked |
```

- [ ] **Step 7: Commit**

```bash
git add docs/testing-log.md
git commit -m "docs: record the M7 live sorting pass"
```

### Task 34A: M7 close-out — sorting not shipped (Q4 exit condition fired)

*(Alternative to Tasks 34 Steps 5-7. Run this when the live pass showed interference with line commits or sourcing, or when M1 probe 6b recorded a natively drag-ordered machine. The code is reverted rather than iterated.)*

**Files:**
- Modify: `docs/superpowers/specs/2026-08-02-edit-mode-table-enhancements-design.md` (§8 sorting row)
- Modify: `docs/testing-log.md`
- Revert: the Task 32 and Task 33 commits

**Interfaces:**
- Consumes: the live transcript from Task 34 Step 3, or the probe 6b transcript from the M1 checkpoint entry.
- Produces: a tree identical to the end of M6, plus the recorded verdict. Nothing already shipped (M2, M3, M4 where applicable, M5, M6) is affected.

- [ ] **Step 1: Revert the sorting commits**

```bash
git revert --no-edit <task-33-sha> <task-32-sha>
grep -rn "sortRowsEdit\|applyCurrentSort\|sortState\|edit-grid-sorted" src/edit-grid/ | wc -l
```

Expected: `0` — a closed milestone leaves no dead affordance and no unreachable menu entry.

- [ ] **Step 2: Update the spec's feature-status table.** In §8, replace the **Excel-style sorting** row's Verdict cell with:

```markdown
| **Excel-style sorting** | **Not shipped.** Closed under the Q4 live-evidence exit: <the live pass on id=16342809&e=T showed [exact interference observed] / M1 probe 6b recorded a natively drag-ordered machine, where row order is record data>. Per Q4 the code was reverted rather than iterated. Evidence: `docs/testing-log.md` M7 line and the transcript in `save/CHECKPOINTS.md`. |
```

- [ ] **Step 3: Full gate**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
npm run fixtures:verify 2>&1 | tail -5
```

Expected: back to the M6 numbers (234 / 231); 28 baselines at **0.000 %**.

- [ ] **Step 4: Append the log line** to `docs/testing-log.md`:

```markdown
| 2026-08-0X <HH:MM> AEST | M7 | Sorting closed as not-shipped under the Q4 live-evidence exit: <exact interference observed / probe 6b recorded an ordered machine>. Code reverted, not iterated; nothing already shipped was affected | `save/CHECKPOINTS.md` M7 entry | No save; four-eyes gate not invoked |
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-02-edit-mode-table-enhancements-design.md docs/testing-log.md
git commit -m "docs: close Edit Mode sorting as not-shipped under the live-evidence exit"
```

### Task 35: End-to-end Edit Mode pass and final View Mode regression

**Files:**
- Modify: `docs/testing-log.md`

**Interfaces:**
- Consumes: every shipped milestone.
- Produces: the end-to-end evidence quoted in the completion doc (Task 36).

**SAFETY PROTOCOL — restated in full because it binds every browser action in this task:**

1. **Record lock.** Account `6998262`, `id=16342809`, and no other record or transaction; the lock explicitly covers **the same record with `&e=T` appended** (Q2). Confirm the URL bar before ANY interaction. Any other record or account: **stop and report**. Never create additional test Sales Orders. Never open other transactions in Edit Mode.
2. **Safety triple — verify all three BEFORE testing begins and again BEFORE every save:** `custbody_salesorder_issue` checked (true); Status = Pending Approval; Memo clearly indicates a testing record. Any failure: do **not** save, stop, report.
3. **Four-eyes save gate.** Before every save: captain gathers evidence (URL bar with account + id, the three safety fields, a one-paragraph statement of what the save changes and why), dispatches an **Opus 5** save-gate subagent, which answers exactly **GO** or **NO-GO**. Default **NO-GO**. Save only on GO; on NO-GO stop and report. The first save of a session also needs the owner's explicit go-ahead in chat.
4. **This pass requires no save.**
5. **Forbidden regardless of anything else:** Approve, Reject, Bill, Fulfill, Email, Print, Delete, Make Copy, or any status-changing or document-sending action.
6. **Every interpretation question is answered by an Opus 5 subagent from DOM evidence.** Browser testing stays sequential.
7. **Append one line to `docs/testing-log.md`** and ship it in the final checkpoint commit.

- [ ] **Step 1: Ask the owner for the final reload** and confirm the Edit Mode toggle is ON. Wait for confirmation.

- [ ] **Step 2: Capture the View Mode storage baseline**

```js
globalThis.__smViewBefore = JSON.stringify(
  (await chrome.storage.sync.get("suiteMateV3ColumnOrder")).suiteMateV3ColumnOrder ?? null);
```

- [ ] **Step 3: Verify the safety triple** on `…salesord.nl?id=16342809&e=T`. Any deviation: stop and report.

- [ ] **Step 4: Run the whole feature set in one sitting**

In order, with a DOM capture after each: resize two columns → hide two columns → reorder one column (**where M4 shipped**) → reload and confirm everything re-applies → filter a column → add a line → remove a line → sort a column (**where M7 shipped**) → open a line and commit it in-page → trigger a recalc → Reset.

Confirm at every stage: values stay paired with their own `_fs` span ids; commits land on the intended lines; `machineButtonRow`, totals, loading and nodata rows are never hidden, moved or counted; the control-bar note discloses page scope and session-only state honestly; **zero SuiteMate console errors**. An **Opus 5** subagent reads the full capture set and states pass/fail.

- [ ] **Step 5: Toggle the feature off and confirm a clean teardown**

Ask the owner to switch **"Sales Order columns (Edit Mode)" OFF** in the popup, then, on the still-open page:

```js
({
  ownedNodes: document.querySelectorAll('[data-suitemate-v3-edit-grid]').length,
  bound: document.querySelector('.uir-machine-table-container')
    ?.hasAttribute('data-suitemate-v3-edit-grid-bound'),
  tableLayout: getComputedStyle(document.querySelector('#item_splits')).tableLayout,
  hiddenCells: document.querySelectorAll('.suitemate-v3-edit-grid-col-hidden').length,
  filteredRows: document.querySelectorAll('.suitemate-v3-edit-grid-row-filtered').length
})
```

Expected: `ownedNodes: 0`, `bound: false`, `tableLayout: "auto"`, `hiddenCells: 0`, `filteredRows: 0` — the machine is left exactly as NetSuite emitted it. Ask the owner to switch it back ON and confirm it reinstalls **without a page refresh**.

- [ ] **Step 6: Final View Mode regression (explicit)**

(a) Load `…salesord.nl?id=16342809` (view mode, same record): column personalization, sort, filter and widths behave and the owner's saved layout is intact; Export view produces data rows, not headers-only; tab titles and internal-id badges unaffected; **zero SuiteMate console errors**. Opus 5 subagent states pass/fail from DOM evidence.

(b) The H2 check:

```js
JSON.stringify((await chrome.storage.sync.get("suiteMateV3ColumnOrder")).suiteMateV3ColumnOrder ?? null)
  === globalThis.__smViewBefore
```

Expected: `true`.

(c) ```bash
git diff --name-only main | grep so-columns
```
Expected: exactly `src/so-columns/core.js`.

- [ ] **Step 7: Append the log line**

```markdown
| 2026-08-0X <HH:MM> AEST | Final | End-to-end on `id=16342809&e=T`: resize, hide, reorder (where shipped), reload re-apply, filter, add, remove, sort (where shipped), in-page line commit, recalc, Reset; toggle OFF left zero owned nodes and a native machine, toggle ON reinstalled without a refresh; `suiteMateV3ColumnOrder` byte-identical; zero SuiteMate console errors | `save/CHECKPOINTS.md` final entry | No save; four-eyes gate not invoked |
```

- [ ] **Step 8: Commit**

```bash
git add docs/testing-log.md
git commit -m "docs: record the end-to-end Edit Mode pass and final View Mode regression"
```

### Task 36: Completion doc and final checkpoint

**Files:**
- Create: `docs/superpowers/completion/2026-08-02-edit-mode-table-enhancements.md`
- Modify: `save/CHECKPOINTS.md`

**Interfaces:**
- Consumes: every milestone's checkpoint entry and `docs/testing-log.md`.
- Produces: the as-built record the brief's COMPLETION section requires.

- [ ] **Step 1: Full gate**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
npm run fixtures:verify 2>&1 | tail -5
git diff --name-only main
```

Expected: all green at the final count; 28 baselines at **0.000 %**; the changed-file list contains only the files enumerated in this plan's File Structure section — and `grep so-columns` on it returns exactly `src/so-columns/core.js`.

- [ ] **Step 2: Write the completion doc**

```markdown
# Edit Mode Table Enhancements — Completion Record (Sales Orders)

Date: 2026-08-0X · Branch: `feature/edit-mode-table-enhancements` · Version at completion: 3.21.1 (bump is owner-gated)
Spec: `docs/superpowers/specs/2026-08-02-edit-mode-table-enhancements-design.md` · Plan: `docs/superpowers/plans/2026-08-02-edit-mode-table-enhancements.md` · Testing log: `docs/testing-log.md`

## What was implemented

`src/edit-grid/{core.js,runtime.js,edit-grid.css}` — a parallel module family for the Sales Order `#item_splits` machine in Edit Mode, sharing no code, no storage key and no CSS with `src/so-columns/`. Mode separation is a route gate: `TRANSACTION_COLUMN_PERSONALIZATION_EDIT` requires `hasParam("e")`, the exact byte-complement of the two view-mode rules. Opt-in behind the default-off `salesOrderColumnsEdit` flag (settings schema 6).

## Feature status, as built

| Feature | Shipped | Mechanism | Limitations |
|---|---|---|---|
| Column resizing | <yes> | Header-cell widths + `table-layout: fixed`; per-column minimum = widest widget, floor 50px | None observed |
| Hide / show columns | <yes> | Class + `display: none !important` on the header and every aligned cell; force-reveal on focus and on validation failure | Revealing is session-only; the stored list is unchanged |
| Column personalization | <yes> | Own key `suiteMateV3EditColumns`, container schema 1, scope `{company}:{user}:{type}:edit`, entries keyed by column id | Sync quota eviction is scoped to Edit Mode scopes and disclosed |
| Drag-and-drop column reorder | <yes / NO — not technically possible> | <True `<td>` movement over visible `_fs`-identified cells, refused while a line is open / Gate A returned an index-addressed repaint> | <Refused while a line is open / n/a> |
| Excel-style filtering | <yes / NO> | `display: none !important` on `<tr>`, session-only | Page-scoped (~25 lines) and disclosed in the control bar; refused on natively drag-ordered machines |
| Excel-style sorting | <yes / NO — closed under the Q4 exit> | True `<tr>` movement, session-only, refused while a line is open | Page-scoped; `.sln` line numbers suppressed while sorted; refused on natively drag-ordered machines |

## Known limitations

- Sales Orders only. The route rule is one line (`context.path.toLowerCase() === PATHS.SALES_ORDER`); widening it is the whole generalization step.
- Sorting and filtering are page-scoped (machines paginate at ~25 lines) and session-only by design; the storage container reserves no keys for them, so persisting them later is a schema-2 bump, not a silent extension.
- Everything applied is discarded on every repaint and re-applied by the lifecycle watcher; attachment is MutationObserver-only. If `machine.postBuildTableListeners` is ever adopted it goes behind the same `queueApply()` seam as an optimization, never as a dependency, and would be a privilege-tier escalation this feature does not need.
- Reveal state (force-reveal) is session-only and intentionally never written.

## Testing log

`docs/testing-log.md` — one line per live session, all on the locked record `6998262 / id=16342809` (and the same record with `&e=T`). **No milestone required a record save**, so the four-eyes save gate was never invoked.

## What to do next to generalize beyond Sales Orders

1. Widen the route rule in `src/shared/routes.js` from `path === PATHS.SALES_ORDER` to the transaction-path shape the view-mode capability already uses (`path.startsWith(PATHS.TRANSACTIONS) && path.endsWith(".nl")`), and extend `tests/routes.test.mjs` with the new positives.
2. Replace the hard-coded `MACHINE_TABLE_SELECTOR = "#item_splits"` with a machine discovery pass (`.uir-machine-table-container table[id$="_splits"]`) and make the scope key include the machine name, so two machines on one page cannot collide.
3. Re-run the M1 probe list against one non-Sales-Order transaction before shipping: Gate A and the ordered-machine check are per-machine facts, not global ones.
4. Only then consider Architecture B — extracting a shared column engine consumed by both modes. It is the right refactor once Edit Mode is stable, and it was correctly refused while the gates were unanswered.
```

Replace every `<…>` with the as-built value. **No `<`-bracketed placeholder may survive the commit.**

- [ ] **Step 3: Append the final checkpoint entry** to `save/CHECKPOINTS.md`

```markdown
## Edit Mode Table Enhancements: Milestone M7 and completion

Status: Complete
Date: 2026-08-0X

### Included

- <Excel-style sorting: true `<tr>` movement with an Edit-Mode contiguity definition that excludes machineButtonRow, totals, loading and nodata rows; session-only; refused while a line is open and on natively drag-ordered machines; `.sln` line numbers suppressed while sorted and the reason disclosed in the control bar. / Sorting closed as not-shipped under the Q4 live-evidence exit; code reverted rather than iterated.>
- Completion doc at `docs/superpowers/completion/2026-08-02-edit-mode-table-enhancements.md`: as-built feature table, known limitations, the testing log, and the four concrete steps to generalize beyond Sales Orders.
- Version deliberately still 3.21.1 — the release bump is owner-gated and is the last task of the plan.

### Verification

- Full `npm test`: <final count> passing; 28 screenshot baselines untouched at 0.000 percent.
- End-to-end live on `id=16342809&e=T`: resize, hide, reorder (where shipped), reload re-apply, filter, add-line, remove-line, sort (where shipped), in-page line commit, recalc and Reset — values stayed paired with their own `_fs` span ids, commits landed on the intended lines, zero SuiteMate console errors. Toggling the feature off left zero owned nodes and a native machine; toggling it back on reinstalled without a page refresh.
- View Mode regression on the same record: personalization, sort, filter, widths, Export view, tab titles and internal-id badges all behave; the owner's saved View Mode layout intact; `suiteMateV3ColumnOrder` byte-identical before and after. `git diff --name-only main | grep so-columns` returns exactly `src/so-columns/core.js` — the single one-token `FOREIGN_NODE_SELECTOR` addition.
- No record save occurred at any point in the project, so the four-eyes save gate was never invoked.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/completion/2026-08-02-edit-mode-table-enhancements.md save/CHECKPOINTS.md
git commit -m "docs: Edit Mode table enhancements completion record and final checkpoint"
```

### Task 37: Release version bump — OWNER-GATED, run LAST

**⚠️ This task is owner-gated. Do not start it without the owner's explicit "yes, cut the release" in chat. Everything before it is complete and shippable without it; the version stays frozen at 3.21.1 until the owner says otherwise.**

**Files:**
- Modify: `package.json:3`, `manifest.json:5`, `tests/verify.mjs:13`
- Modify: `save/CHECKPOINTS.md`

- [ ] **Step 1: Ask the owner.** Confirm explicitly that they want the release cut and which version number (the plan assumes `3.22.0` — a new opt-in feature, no breaking change). **Do not proceed without an explicit yes.** If the owner declines, stop here: the branch is complete as-is.

- [ ] **Step 2: Locate and bump every pin**

```bash
grep -n "3\.21\.1" package.json manifest.json tests/verify.mjs
```

Expected: exactly three hits (`package.json:3`, `manifest.json:5`, `tests/verify.mjs:13`). Change all three to `3.22.0`.

- [ ] **Step 3: Full gate**

```bash
npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"
npm run fixtures:verify 2>&1 | tail -5
```

Expected: all green at the final count; 28 baselines at **0.000 %**.

- [ ] **Step 4: Commit, push, tag and release**

```bash
git add package.json manifest.json tests/verify.mjs
git commit -m "chore: prepare v3.22.0"
git push -u origin feature/edit-mode-table-enhancements
git tag v3.22.0 && git push origin v3.22.0
gh release create v3.22.0 --title "v3.22.0 — Sales Order Edit Mode table enhancements" --notes "Opt-in Edit Mode column tools for Sales Orders: resizing, hide/show with mandatory force-reveal, drag-and-drop reorder (where the machine's repaint is id-addressed), per-user personalization on its own storage key, and page-scoped session-only filtering and sorting. View Mode is unchanged apart from four one-token coexistence selectors. Default off behind the new 'Sales Order columns (Edit Mode)' toggle (settings schema 6)."
```

- [ ] **Step 5: Append the release checkpoint entry** to `save/CHECKPOINTS.md` (house shape: `## …: Release v3.22.0`, Status/Date/Included/Verification, with the release URL), then:

```bash
git add save/CHECKPOINTS.md && git commit -m "docs: record the v3.22.0 release" && git push
```

---

## Self-review (performed at write time)

**1. Spec coverage — every section mapped to a task**

| Spec section | Task(s) |
|---|---|
| §1 Goal — resize, hide/show, reorder, personalization, filter, sort on `#item_splits` in Edit Mode | M2 (11-14), M3 (15-18), M4 (19-23/23A), M5 (24-27), M6 (28-31), M7 (32-37) |
| §2 Non-goals (no generalization, no other machines/record types, no Architecture B, no read-only overlay, no MAIN-world/page-JS bridge, no `so-columns` changes) | Global Constraints; Task 23A (overlay explicitly not built); Task 9 Step 7 (probe 6 informational only); Task 36 completion doc (generalization deferred with steps) |
| §3 H1 — View Mode row predicates match zero rows | Task 5 (`visibleCells`/`alignsToHeader`/`isDataRow` reimplemented, tested against rows with extra `display:none` cells); Tasks 20, 28, 32 reuse them |
| §3 H2 — separate storage key, quota eviction blast radius | Tasks 5 (`evictOverQuota` scoped to `grids`), 24, 25 (disclosure), 26 Step 5 (live byte-identical check), 35 Step 6b |
| §3 H3 — route gate is the enforcement mechanism | Task 2 (capability + case + mutual-exclusion test), Task 7 Step 4 item 4 (asserted at the gate, not the DOM) |
| §3 H4 — no CSS-order escape hatch | Tasks 20 (true `<td>` movement) and 32 (true `<tr>` movement) |
| §3 H5 — repaint discards everything; re-apply cheap, idempotent, self-suppressing | Task 6 (`renderSignature`/`targetSignature`/`applyAll`/`queueApply`, stamp exclusion in `relevant`), extended in 12, 16, 21, 29, 33; write-counter assertions in every fixture step |
| §4.1 new files (core, runtime, css, unit suite, fixture) | Tasks 5, 6, 7 |
| §4.2 reused as-is (lifecycle, settings, notifications, routes mechanics, fixture loop) | Task 6 (registration + settings gate + `showToast`), Tasks 7, 12, 16, 21, 25, 29, 33 (served fixture loop) |
| §4.3 shared files that change (manifest, verify, package, routes, routes tests, settings, settings-transfer, popup, settings tests, chrome-stub, four selectors) | Tasks 2, 3, 4, 5, 6, 7, 8 — the complete list, nothing else touched |
| §4.4 the four one-token View Mode touches | Task 8 (with the `git diff --stat` proof of exactly 4 insertions) |
| §5 Persistence — key, container, scope key, column-id keying, six-part doctrine, caps, quota isolation | Task 5 (key/container/doctrine/caps, `resolveScopeKey` in Task 6), Task 24 (retention), Task 25 (merge + quota disclosure + Reset) |
| §6 Attachment — capability gate, settings gate, lifecycle registration, `relevant()` stamp exclusion, identity early-return, identity re-derivation, open-line state machine, delegated listeners, force-reveal, no `innerHTML` | Task 6 (all of the mechanics), Task 16 (force-reveal rules 1-2), Tasks 15/28 (rules 3-4 structurally), Task 21 (reorder refusal), Task 33 (sort refusal) |
| §7 Error-handling inventory (12 rows) | Not-expected container → Task 5 `normalizeStored`; newer schema → Task 5 + Task 6 install toast; unrecognized DOM → Task 6 install fail-closed; ordered machine → Tasks 28, 32, 29, 33; line open + reorder/sort → Tasks 21, 33; line open + hide/width/filter → Task 6 `queueApply`; force-reveal → Task 16; width below minimum → Tasks 5, 11; write rejected → Tasks 12, 16, 21, 25 toasts; id absent from machine → Task 24 merges; exception in install → Task 6 `logOnce` |
| §8 Feature-status table (6 rows + contingency) | resize → 11-14; hide/show → 15-18; personalization → 24-27; reorder → 19-23 or 23A; filtering → 28-31; sorting → 32-34 or 34A; contingency overlay → explicitly not built (Task 23A Step 2 grep + completion doc) |
| §9 Testing strategy tiers 1-4 + gate arithmetic | Tier 1 in Tasks 5, 11, 15, 20, 24, 28, 32; tier 2 in Tasks 7, 12, 16, 25, 29, 33; tier 3 in Tasks 9, 13, 17, 22, 26, 30, 34, 35; tier 4 in every checkpoint and every live task's View Mode step; gate arithmetic in Tasks 5, 6, 7 (manifest mirrors, `node --check`, `--test`, link list, `route-catalog.js` deliberately untouched) |
| §10 Milestone ladder + checkpoint definition | M1-M7 headings; checkpoint Tasks 10, 14, 18, 23/23A, 27, 31, 36; sequential-build rule in Global Constraints; version freeze until Task 37 |
| §11 Q1 own toggle | Task 3 |
| §11 Q2 authorized in-page Gate A probe, never save, `&e=T` in the lock | Task 9 (protocol + probe 8 + teardown by navigating away) |
| §11 Q3 nothing replaces reorder if Gate A fails | Task 23A |
| §11 Q4 ship filter then sort, page scope disclosed in the UI, live-evidence exit for sort | Tasks 29 (`renderScopeNote`), 33 (sort disclosure), 34 Step 4 (exit branch), 34A |
| §12 U1 payload format | Task 9 Step 6 — probe 5 deferred, reason recorded |
| §12 U2 Gate A | Task 9 Step 15, Task 19 |
| §12 U3 `data-machine-name` | Task 9 Steps 2, 9 — informational; no selector depends on it (Global Constraints) |
| §12 U4 native drag-order machines | Task 9 Step 8; unconditional refusals in Tasks 28, 32 regardless of the probe result |
| §12 U5 widths under repaint | Task 11 (`table-layout: fixed`), Task 13 Step 3 (live gate) |

**2. Placeholder scan.** Every code step carries real code; every command step carries the exact command and its expected output. The only `<…>` markers are in document templates (checkpoint verdicts, log lines, completion-doc cells) where the value is an observation that cannot exist before the step runs — each is accompanied by the instruction "**No `<`-bracketed placeholder may survive the commit.**" No "TBD", no "add error handling", no "similar to Task N" (the safety protocol and the View Mode regression steps are repeated in full in every task that needs them, deliberately, because tasks are read out of order).

**3. Type and name consistency.** Verified across all tasks: `readColumnIds`/`visibleCells`/`alignsToHeader`/`isDataRow`/`isExcludedRow`/`columnIdFromSpanId`/`rowLineNumber`/`machineIdFromTable`/`isOrderedMachine`/`clampWidth`/`columnMinimums`/`applyWidths`/`readCellText`/`readHeaderLabels`/`applyHidden`/`planOrder`/`moveColumn`/`applyOrderEdit`/`mergeOrder`/`mergeHidden`/`parseFilterQuery`/`matchesFilter`/`applyRowFilters`/`distinctColumnValuesEdit`/`parseSortValue`/`detectColumnKind`/`sortRowsEdit`/`normalizeStored`/`refusesNewerSchema`/`withOrder`/`withHidden`/`withWidths` are defined once and called with the same argument lists everywhere. Runtime seams `installEditGrid`/`removeEditGrid`/`relevant`/`renderSignature(table, columnIds)`/`targetSignature(table, columnIds)`/`applyAll(table, columnIds)`/`queueApply(reason)`/`enqueueSave`/`ensureBindings`/`releaseBindings`/`ensureControls`/`headerCellsOf`/`columnIdOfHeaderCell`/`machineColumnIds`/`forcedRows`/`effectiveHidden` keep one signature from M1 to M7. Storage shapes are uniform: container `{schemaVersion:1, grids:{[scope]:{order?,hidden?,widths?}}}`; `rowFilters` and `sortState` are session-only module state and never enter that container. Constant names (`STORAGE_KEY`, `DATA_ATTRIBUTE`, `NATIVE_ROW_ATTRIBUTE`, `BOUND_ATTRIBUTE`, `ABSOLUTE_MIN_COLUMN_WIDTH`, `MAX_COLUMN_IDS`, `MAX_COLUMN_ID_LENGTH`) match the frozen-contract test in Task 5. **Known gap (see review findings):** the frozen-contract test asserts only `CLASSES.colHidden` and `CLASSES.rowFiltered` of the eleven keys, and `FOCUSED_ROW_SELECTOR`, `EXCLUDED_ROW_SELECTOR` and `FOREIGN_NODE_SELECTOR` are exported but unasserted; `suitemate-v3-edit-grid-resizing` and `-sorted` are bare string literals that never enter `CLASSES`.

**4. Two interpretations pinned while writing (neither is a spec deviation; both are recorded so a reviewer can challenge them).**

- **`_fs` decode.** Spec §4.1 says decode `span[id$="1_fs"]`. Task 5 decodes `span[id$="{line}_fs"]` using the row's own line number from `{machine}_row_{n}` — **byte-identical to the spec for line 1**, and it additionally (a) prevents line 21 being mistaken for line 1 (`item_quantity21_fs` would otherwise decode as `quantity2`) and (b) keeps the feature working on a paged machine whose first rendered line is 26. Task 5's unit test asserts both.
- **Width clamp split.** Spec §5 says widths are clamped to `[perColumnMin, 1000]` where `perColumnMin` is the widest widget `offsetWidth`. `perColumnMin` is a DOM measurement and the storage normalizer must stay DOM-free (the source-purity test in §9 tier 1 bans DOM access in the storage half). So `normalizeWidths` clamps to the static floor `ABSOLUTE_MIN_COLUMN_WIDTH = 50` (`src/styles/netsuite.css:2999-3001` sizes machine inputs at `width: calc(100% - 21px)`, so a column under ~50 px leaves the widget unusable) and `applyWidths` applies the per-column widget minimum at render time. The effective clamp a user sees is exactly `[perColumnMin, 1000]`, and it is never the View Mode `MIN_COLUMN_WIDTH = 30`.
