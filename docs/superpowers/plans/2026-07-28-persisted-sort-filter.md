# Persisted Sort & Filter Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The transaction grid's sort and filters persist per `companyId:userId:recordType` scope and auto-reapply on load, with an active-view chip that clears them in one click.

**Architecture:** Extend the so-columns storage schema (v2→v3) inside the existing `suiteMateV3ColumnOrder` sync item: per-scope entries gain optional `sort`/`filters` fields with fail-closed normalizers and caps. The runtime saves at the existing sort/filter mutation points (debounced for query text), reapplies in `installSoColumns` after widths, and renders one control-bar chip. Spec: `docs/superpowers/specs/2026-07-28-persisted-sort-filter-design.md`.

**Tech Stack:** Vanilla JS IIFEs (`Object.freeze` exports on `globalThis`), node:test vm harness, chrome.storage.sync, served-fixture browser verification.

## Global Constraints

- Repo `/Users/Bivek.Shah/Documents/suitemate/suitematev3`, branch `main`, in place (session convention; owner-approved workflow).
- Zero behavior change to shipped layout persistence (order/hidden/widths) beyond the shared empty-entry check gaining the new fields.
- Caps verbatim from spec: **8 filtered columns per scope, 50 `anyOf` values per column, `q` ≤ 100 chars, labels/values ≤ 200 chars (`MAX_LABEL_LENGTH`)**; `dir` ∈ {`asc`,`desc`}. Beyond-cap state stays session-only + warning toast. Query-text saves debounce **800ms**.
- `textAsRowFilter` is never stored; re-derive from `core.distinctColumnValues(table, cellIndex, 200).length === 0` at apply time.
- Source-purity rules in `tests/so-columns.test.mjs` ban certain substrings in core.js — run the suite after every core edit; keep core DOM-thin/pure.
- Commits: conventional messages; author = signed-in git user; NEVER add Claude co-author trailers.
- Live testing: view-mode only, production account 6998262; destructive cycles only on the known-empty-scope PO 16295656; never touch the owner's real saved layouts.
- `npm test` must end fully green (incl. `fixtures:verify` at 0.000% — this feature adds no visual change to any captured fixture page, so baselines must NOT move; any diff is a defect).
- Version stays `3.18.1` until the final release task.

---

## File Structure

- `src/so-columns/core.js` — schema v3: constants, `normalizeSort`, `normalizeFilters`, `entryIsEmpty` helper, `withSort`, `withFilters`, extended `normalizeEntry`, exports. Stays pure.
- `src/so-columns/runtime.js` — save triggers, restore-on-install, view chip, debounce.
- `src/so-columns/so-columns.css` — view-chip shares the hidden-chip rules (selector addition only).
- `tests/so-columns.test.mjs` — new unit tests beside the existing `withWidths` tests.
- `save/CHECKPOINTS.md` — per-task verification entries.

### Task 1: Core schema v3 — `withSort`, `withFilters`, migration

**Files:**
- Modify: `src/so-columns/core.js` (constants at :6, `normalizeEntry` :87-104, empty-entry checks in `withHidden` :185 and `withWidths` :212, new functions after `withWidths`, exports block at tail)
- Test: `tests/so-columns.test.mjs` (add after the `withWidths` test at :184)

**Interfaces:**
- Consumes: existing `isPlainObject`, `normalizeScopeKey`, `normalizeStored`, `refusesNewerSchema`, `evictOverQuota`, `MAX_LABEL_LENGTH`.
- Produces (Tasks 2-4 rely on these exact names): `core.withSort(stored, scopeKey, sort|null) -> storedV3|null`; `core.withFilters(stored, scopeKey, filters|null) -> storedV3|null`; `core.normalizeFilters(value) -> filters|null` (trimmed to caps); constants `core.MAX_FILTER_COLUMNS = 8`, `core.MAX_FILTER_VALUES = 50`. Sort shape `{label, dir}`; filters shape `{[label]: {anyOf?: string[], q?: string}}`.

- [ ] **Step 1: Write the failing tests** (append after the `withWidths` test, same style — `createApi()` + `plain()`):

```js
test("withSort stores, merges, clears and fails closed", () => {
  const core = createApi();
  const withSort = core.withSort(undefined, "123:7", { label: "Amount", dir: "desc" });
  assert.deepEqual(plain(withSort), {
    schemaVersion: 3,
    orders: { "123:7": { sort: { label: "Amount", dir: "desc" } } }
  });
  const merged = core.withSort({ schemaVersion: 2, orders: { "123:7": { order: ["Item", "Amount"] } } }, "123:7", { label: "Item", dir: "asc" });
  assert.deepEqual(plain(merged.orders["123:7"]), { order: ["Item", "Amount"], sort: { label: "Item", dir: "asc" } });
  const cleared = core.withSort(withSort, "123:7", null);
  assert.deepEqual(plain(cleared.orders), {});
  assert.equal(core.withSort(undefined, "123:7", { label: "Amount", dir: "sideways" }), null);
  assert.equal(core.withSort(undefined, "123:7", { label: "", dir: "asc" }), null);
  assert.equal(core.withSort({ schemaVersion: 4, orders: {} }, "123:7", { label: "A", dir: "asc" }), null);
});

test("withFilters normalizes, caps and clears", () => {
  const core = createApi();
  const stored = core.withFilters(undefined, "123:7", {
    Location: { anyOf: ["Sydney", "Melbourne"] },
    Amount: { q: "> 100" }
  });
  assert.deepEqual(plain(stored), {
    schemaVersion: 3,
    orders: { "123:7": { filters: { Location: { anyOf: ["Sydney", "Melbourne"] }, Amount: { q: "> 100" } } } }
  });
  const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`Col${i}`, { q: String(i) }]));
  assert.equal(Object.keys(plain(core.withFilters(undefined, "123:7", nine).orders["123:7"].filters)).length, 8);
  const fatValues = { Item: { anyOf: Array.from({ length: 51 }, (_, i) => `V${i}`) } };
  assert.equal(plain(core.withFilters(undefined, "123:7", fatValues).orders["123:7"].filters.Item.anyOf).length, 50);
  const hostile = core.withFilters(undefined, "123:7", {
    __proto__: { q: "x" },
    Ok: { anyOf: ["a", 7, ""], q: "x".repeat(101) },
    Bad: { anyOf: [] }
  });
  assert.deepEqual(plain(hostile.orders["123:7"].filters), { Ok: { anyOf: ["a"], q: "x".repeat(100) } });
  assert.deepEqual(plain(core.withFilters(stored, "123:7", null).orders), {});
  assert.equal(core.withFilters(undefined, "123:7", { Only: { note: true } }), null);
});

test("schema v2 passes through under v3 and v4 is refused", () => {
  const core = createApi();
  const v2 = { schemaVersion: 2, orders: { "123:7": { order: ["A", "B"], widths: { A: 120 } } } };
  assert.deepEqual(plain(core.normalizeStored(v2)), {
    schemaVersion: 3,
    orders: { "123:7": { order: ["A", "B"], widths: { A: 120 } } }
  });
  const entrySurvives = core.normalizeStored({ schemaVersion: 3, orders: { "9:9": { sort: { label: "Qty", dir: "asc" } } } });
  assert.deepEqual(plain(entrySurvives.orders["9:9"]), { sort: { label: "Qty", dir: "asc" } });
  assert.equal(core.withWidths({ schemaVersion: 4, orders: {} }, "123:7", { A: 100 }), null);
  assert.deepEqual(plain(core.normalizeStored({ schemaVersion: 4, orders: { a: { order: ["x"] } } }).orders), {});
});

test("clearing the last field deletes the whole entry across all writers", () => {
  const core = createApi();
  let stored = core.withSort(undefined, "123:7", { label: "A", dir: "asc" });
  stored = core.withFilters(stored, "123:7", { A: { q: "1" } });
  stored = core.withSort(stored, "123:7", null);
  assert.deepEqual(Object.keys(plain(stored.orders)), ["123:7"]);
  stored = core.withFilters(stored, "123:7", null);
  assert.deepEqual(plain(stored.orders), {});
});
```

- [ ] **Step 2: Run to verify failure.** `npm run build >/dev/null 2>&1; node --test tests/so-columns.test.mjs 2>&1 | grep -E "fail|not ok" | head` — Expected: FAIL (`core.withSort is not a function`).

- [ ] **Step 3: Implement in `core.js`.** (a) Line 6: `STORAGE_SCHEMA_VERSION = 2` → `3`. (b) After line 11 add:

```js
  const MAX_FILTER_COLUMNS = 8;
  const MAX_FILTER_VALUES = 50;
  const MAX_QUERY_LENGTH = 100;
```

(c) After `normalizeWidths` add:

```js
  function normalizeSort(value) {
    if (!isPlainObject(value)
      || typeof value.label !== "string"
      || !value.label
      || value.label.length > MAX_LABEL_LENGTH
      || !["asc", "desc"].includes(value.dir)) {
      return null;
    }
    return { label: value.label, dir: value.dir };
  }

  function normalizeFilters(value) {
    if (!isPlainObject(value)) {
      return null;
    }
    const filters = {};
    for (const [label, candidate] of Object.entries(value)) {
      if (Object.keys(filters).length >= MAX_FILTER_COLUMNS) {
        break;
      }
      if (!label || label.length > MAX_LABEL_LENGTH
        || ["__proto__", "constructor", "prototype"].includes(label)
        || !isPlainObject(candidate)) {
        continue;
      }
      const anyOf = Array.isArray(candidate.anyOf)
        ? candidate.anyOf
          .filter((v) => typeof v === "string" && v && v.length <= MAX_LABEL_LENGTH)
          .slice(0, MAX_FILTER_VALUES)
        : [];
      const q = typeof candidate.q === "string" ? candidate.q.trim().slice(0, MAX_QUERY_LENGTH) : "";
      if (!anyOf.length && !q) {
        continue;
      }
      filters[label] = { ...(anyOf.length ? { anyOf } : {}), ...(q ? { q } : {}) };
    }
    return Object.keys(filters).length ? filters : null;
  }
```

(d) In `normalizeEntry`, normalize and include the two fields (the "nothing valid" guard gains them too):

```js
    const sort = normalizeSort(candidate.sort);
    const filters = normalizeFilters(candidate.filters);
    if (!order && !hidden && !widths && !sort && !filters) {
      return null;
    }
    return {
      ...(order ? { order } : {}),
      ...(hidden ? { hidden } : {}),
      ...(widths ? { widths } : {}),
      ...(sort ? { sort } : {}),
      ...(filters ? { filters } : {})
    };
```

(e) Add `function entryIsEmpty(entry) { return !entry.order && !entry.hidden && !entry.widths && !entry.sort && !entry.filters; }` and replace the two inline checks in `withHidden` (:185) and `withWidths` (:212) with `if (entryIsEmpty(entry))`. (f) After `withWidths` add `withSort`/`withFilters`, exact `withWidths` structure:

```js
  function withSort(stored, scopeKey, sort) {
    if (refusesNewerSchema(stored)) {
      return null;
    }
    const next = normalizeStored(stored);
    const key = normalizeScopeKey(scopeKey);
    if (!key) {
      return null;
    }
    const entry = { ...(next.orders[key] ?? {}) };
    if (sort === null || sort === undefined) {
      delete entry.sort;
    } else {
      const normalized = normalizeSort(sort);
      if (!normalized) {
        return null;
      }
      entry.sort = normalized;
    }
    if (entryIsEmpty(entry)) {
      delete next.orders[key];
    } else {
      next.orders[key] = entry;
    }
    return evictOverQuota(next, key);
  }

  function withFilters(stored, scopeKey, filters) {
    if (refusesNewerSchema(stored)) {
      return null;
    }
    const next = normalizeStored(stored);
    const key = normalizeScopeKey(scopeKey);
    if (!key) {
      return null;
    }
    const entry = { ...(next.orders[key] ?? {}) };
    if (!filters || !Object.keys(filters).length) {
      delete entry.filters;
    } else {
      const normalized = normalizeFilters(filters);
      if (!normalized) {
        return null;
      }
      entry.filters = normalized;
    }
    if (entryIsEmpty(entry)) {
      delete next.orders[key];
    } else {
      next.orders[key] = entry;
    }
    return evictOverQuota(next, key);
  }
```

(g) In the frozen export object add `normalizeFilters, withSort, withFilters, MAX_FILTER_COLUMNS, MAX_FILTER_VALUES` beside `withWidths`.

- [ ] **Step 4: Run to verify pass.** `npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"` — Expected: 190 tests, 190 pass, 0 fail (186 + 4 new; if the existing count differs, all green is the bar). `fixtures:verify` untouched at 0.000%.

- [ ] **Step 5: Commit.** `git add src/so-columns/core.js tests/so-columns.test.mjs && git commit -m "feat: so-columns storage schema v3 with sort and filter persistence primitives"`

### Task 2: Runtime save path

**Files:**
- Modify: `src/so-columns/runtime.js` — module state (:53 area), sort menu items (:289-293), filter handlers (:328-335, :357-361, :370-389), `clearAllFilters` (:212), new save helpers after `saveWidths` (:485)

**Interfaces:**
- Consumes: Task 1's `core.withSort`/`core.withFilters`/`core.MAX_FILTER_COLUMNS`/`core.MAX_FILTER_VALUES`; existing `scopeKey`, `showToast`, `headerCells`, `cellLabel`, `columnFilters`, `filterState`, `sortCell`, `sortDirection`.
- Produces (Tasks 3-4 rely on): `serializeFilters(table) -> filtersObject|null`; `saveSort()`; `saveFilters()`; `scheduleFiltersSave(table)` (800ms debounce); `filtersSaveTimer` module var.

- [ ] **Step 1: Add module state.** Beside `let resizing = null;` (:52) add `let filtersSaveTimer = null;`.

- [ ] **Step 2: Add save helpers after `saveWidths` (:485):**

```js
  function serializeFilters(table) {
    const filters = {};
    for (const cell of headerCells(table)) {
      const state = columnFilters.get(cell);
      const label = cellLabel(cell);
      if (!state || !label) {
        continue;
      }
      const anyOf = state.selected.size ? Array.from(state.selected) : null;
      const q = state.queryText.trim();
      if (!anyOf && !q) {
        continue;
      }
      filters[label] = { ...(anyOf ? { anyOf } : {}), ...(q ? { q } : {}) };
    }
    return Object.keys(filters).length ? filters : null;
  }

  async function saveSort() {
    try {
      if (!scopeKey) {
        return;
      }
      const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
      const sort = sortCell && sortDirection ? { label: cellLabel(sortCell), dir: sortDirection } : null;
      const next = core.withSort(stored[core.STORAGE_KEY], scopeKey, sort?.label ? sort : null);
      if (!next) {
        showToast("Sort preference could not be saved.", "warning");
        return;
      }
      await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
    } catch {
      showToast("Sort preference could not be saved.", "warning");
    }
  }

  async function saveFilters() {
    try {
      if (!scopeKey) {
        return;
      }
      const table = document.querySelector(TABLE_SELECTOR);
      const filters = table ? serializeFilters(table) : null;
      const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
      const next = core.withFilters(stored[core.STORAGE_KEY], scopeKey, filters);
      if (!next) {
        showToast("Filters could not be saved.", "warning");
        return;
      }
      await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
      const overCap = filters && (Object.keys(filters).length > core.MAX_FILTER_COLUMNS
        || Object.values(filters).some((f) => (f.anyOf?.length ?? 0) > core.MAX_FILTER_VALUES));
      if (overCap) {
        showToast("Some filters were too large to save and will last this session only.", "warning");
      }
    } catch {
      showToast("Filters could not be saved.", "warning");
    }
  }

  function scheduleFiltersSave() {
    // Query keystrokes debounce: chrome.storage.sync throttles writes per minute.
    clearTimeout(filtersSaveTimer);
    filtersSaveTimer = setTimeout(() => { filtersSaveTimer = null; saveFilters(); }, 800);
  }
```

- [ ] **Step 3: Wire the triggers.** (a) The three sort menu items (:289-292): append `saveSort();` immediately after each `setSortDirection(table, cell, …);` call (asc, desc, and the `"native"` clear). (b) Checkbox `change` handler (:334): after `applyColumnFilters(table);` add `saveFilters();`. (c) Search `input` handler (:360): after `applyColumnFilters(table);` add `scheduleFiltersSave();`. (d) Select all (:377) and Clear filter (:388): after `applyColumnFilters(table);` add `saveFilters();`. (e) In `clearAllFilters` (:212-219, the Reset path) add `clearTimeout(filtersSaveTimer); filtersSaveTimer = null;` at the top — Reset's `saveOrder(null)` already deletes the whole entry, and a trailing debounced write must not resurrect it.

- [ ] **Step 4: Verify.** `node --check src/so-columns/runtime.js && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"` — Expected: all green; fixtures untouched at 0.000%.

- [ ] **Step 5: Commit.** `git add src/so-columns/runtime.js && git commit -m "feat: persist grid sort and filters at their mutation points"`

### Task 3: Runtime restore on install

**Files:**
- Modify: `src/so-columns/runtime.js` — `installSoColumns` (:870-879 region, after `applyCurrentWidths(table)`)

**Interfaces:**
- Consumes: `entry.sort`/`entry.filters` (Task 1 shapes), `setSortDirection`, `filterState`, `applyColumnFilters`, `core.distinctColumnValues`.
- Produces: restore behavior Task 4's chip renders from (`sortCell`/`sortDirection`/`columnFilters` populated before `renderViewChip()` exists).

- [ ] **Step 1: Add the restore block** in `installSoColumns` directly after `applyCurrentWidths(table);` (:877) and before `renderHiddenChips();`:

```js
      const findCell = (label) => headerCells(table).find((cell) => cellLabel(cell) === label) ?? null;
      if (entry?.sort) {
        const cell = findCell(entry.sort.label);
        if (cell) {
          setSortDirection(table, cell, entry.sort.dir);
        }
      }
      if (entry?.filters) {
        let restored = false;
        for (const [label, filter] of Object.entries(entry.filters)) {
          const cell = findCell(label);
          if (!cell) {
            continue;
          }
          const state = filterState(cell);
          state.queryText = filter.q ?? "";
          state.selected = new Set(filter.anyOf ?? []);
          // Not stored: a property of current column cardinality (spec §2).
          state.textAsRowFilter = Boolean(filter.q)
            && !core.distinctColumnValues(table, cell.cellIndex, 200).length;
          restored = true;
        }
        if (restored) {
          applyColumnFilters(table);
        }
      }
```

- [ ] **Step 2: Verify restore does not write back.** Confirm by reading the touched call paths: `setSortDirection` and `applyColumnFilters` contain no save calls (saves live only at the Task 2 trigger sites), so install never writes storage. Run `node --check src/so-columns/runtime.js && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"` — all green.

- [ ] **Step 3: Fixture round-trip (manual browser step, served fixture).** Start `python3 -m http.server 8931` at repo root; in Chrome open the sales-order fixture via the fresh-eval recipe (replaceState to `?salesOrderColumns=true`, then chrome-stub → utilities → settings → routes → core → runtime with `cache:"no-store"`, inject `so-columns.css`). Sort a column asc + select one filter value; read `SuiteMateV3Fixture.columnOrders` (or `chrome.storage.sync.get`) and confirm `{sort:{label,dir:"asc"}, filters:{…}}` under the fixture scope. Reload the page, repeat injection WITHOUT interacting: assert at computed level that rows are sorted (first-cell text order), filtered rows are `display: none`, the sort indicator `↑` is present, and the arrow carries `suitemate-v3-so-columns-filter-active`.

- [ ] **Step 4: Commit.** `git add src/so-columns/runtime.js && git commit -m "feat: auto-reapply persisted sort and filters on grid install"`

### Task 4: Active-view chip

**Files:**
- Modify: `src/so-columns/runtime.js` — `ensureControls` (:814-836), new `renderViewChip` + `clearViewState` beside `renderHiddenChips` (:589), call sites in `setSortDirection`, `applyColumnFilters`, `handleResetClick`, `installSoColumns`
- Modify: `src/so-columns/so-columns.css` — extend the two `hidden-chip` rules

**Interfaces:**
- Consumes: `sortCell`/`sortDirection`, `columnQuery`, `columnFilters`, `headerCells`, `cellLabel`, `resetSort`, `clearAllFilters`, Task 2's `saveSort` pattern.
- Produces: `controlButtons.viewChip`; `renderViewChip()`; `clearViewState()` (single composed storage write).

- [ ] **Step 1: CSS.** In `so-columns.css` change the two selectors `[data-suitemate-v3-so-columns="hidden-chip"]` (:56) and `[data-suitemate-v3-so-columns="hidden-chip"]:hover` (:69) to selector lists also matching `[data-suitemate-v3-so-columns="view-chip"]` (same chrome, zero new rules).

- [ ] **Step 2: Runtime.** (a) In `ensureControls`, after the `hiddenChips` span create `const viewChip = document.createElement("button"); viewChip.type = "button"; viewChip.setAttribute(core.DATA_ATTRIBUTE, "view-chip"); viewChip.title = "Clear saved sort and filters"; viewChip.hidden = true; viewChip.addEventListener("click", clearViewState);` — append it in `controls.append(personalize, hint, hiddenChips, viewChip, done, reset)` and store it in `controlButtons`. (b) Beside `renderHiddenChips` add:

```js
  function renderViewChip() {
    const chip = controlButtons?.viewChip;
    if (!chip) {
      return;
    }
    const table = document.querySelector(TABLE_SELECTOR);
    const filterCount = table
      ? headerCells(table).filter((cell) => columnQuery(columnFilters.get(cell))).length
      : 0;
    const parts = [];
    if (sortCell && sortDirection) {
      parts.push(`${cellLabel(sortCell)} ${sortDirection === "asc" ? "↑" : "↓"}`);
    }
    if (filterCount) {
      parts.push(`${filterCount} filter${filterCount === 1 ? "" : "s"}`);
    }
    chip.textContent = parts.length ? `${parts.join(" · ")} ✕` : "";
    chip.hidden = parts.length === 0;
  }

  async function clearViewState() {
    try {
      const table = document.querySelector(TABLE_SELECTOR);
      clearTimeout(filtersSaveTimer);
      filtersSaveTimer = null;
      resetSort(table);
      clearAllFilters(table);
      renderViewChip();
      if (!scopeKey) {
        return;
      }
      const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
      const afterSort = core.withSort(stored[core.STORAGE_KEY], scopeKey, null);
      const next = afterSort && core.withFilters(afterSort, scopeKey, null);
      if (!next) {
        showToast("Saved view could not be cleared.", "warning");
        return;
      }
      await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
    } catch {
      showToast("Saved view could not be cleared.", "warning");
    }
  }
```

(c) Call `renderViewChip()` at: end of `setSortDirection`, end of `applyColumnFilters`, end of `handleResetClick` (inside the `try`, after `saveOrder(null, …)`), and in `installSoColumns` beside `renderHiddenChips()`. (Chip reflects ACTIVE state including over-cap session-only filters — spec §6.)

- [ ] **Step 3: Verify.** `node --check src/so-columns/runtime.js && npm test 2>&1 | grep -E "ℹ (tests|pass|fail)"` all green; fixture pass from Task 3 Step 3 repeated, now also asserting the chip: after sort+filter it shows e.g. `Amount ↑ · 1 filter ✕` with computed `display` ≠ none outside personalize mode; clicking it restores native row order, all rows visible, chip hidden, and storage entry gone (`plain` of the fixture store has no `sort`/`filters`).

- [ ] **Step 4: Commit.** `git add src/so-columns/runtime.js src/so-columns/so-columns.css && git commit -m "feat: active-view chip with one-click clear of saved sort and filters"`

### Task 5: Live verification + checkpoint

- [ ] **Step 1:** Ask the owner to reload the unpacked extension, then verify live (Playwright MCP, view-mode only): **SO 16302518** — sort a column, apply a two-value filter, reload the record: view auto-reapplies, chip text correct, "n of m items" status correct; chip ✕ restores native and empties the stored entry (verify via `chrome.storage.sync.get` in the console); **Item Fulfillment 14953684** (`uir-list-row-tr` family) — same cycle with one filter; **PO 16295656** (empty scope) — full destructive cycle including Reset, confirming Reset also clears sort+filters from storage and cancels any pending debounce. Both schemes (flip `isDarkMode`) for the chip. Zero console errors. The owner's real saved layouts untouched.
- [ ] **Step 2:** Append the `save/CHECKPOINTS.md` entry (existing format: `## Persisted Sort & Filter: Milestone 20` + Status/Date/Included/Verification with the live evidence), `git add save/CHECKPOINTS.md && git commit -m "docs: record persisted sort and filter live verification" && git push`.

### Task 6: Release v3.19.0 (owner-gated)

- [ ] **Step 1:** Confirm with the owner that they want the release cut. Do not proceed without an explicit yes.
- [ ] **Step 2:** Locate version pins: `grep -n "3.18.1" manifest.json package.json tests/verify.mjs` — bump all to `3.19.0`; `npm test` fully green.
- [ ] **Step 3:** `git add -A && git commit -m "chore: prepare v3.19.0" && git push && git tag v3.19.0 && git push origin v3.19.0 && gh release create v3.19.0 --title "v3.19.0 — Persisted Sort & Filter Preferences" --notes` covering: per-scope persisted sort + filters with auto-reapply, active-view chip with one-click clear, storage schema v3 with pass-through migration and older-build write refusal, caps + quota safety, debounced query saves. Append the release checkpoint entry and push.

---

## Self-review (performed at write time)

- **Spec coverage:** §2 stored shape/caps/migration → Task 1; §3 core API → Task 1; §4 apply path incl. `textAsRowFilter` re-derivation and hidden-sort-label tolerance (restore sorts whatever label matches; hidden columns still sort since `sortRows` is row-level) → Task 3; §5 save triggers + debounce + Reset single-write (plus the debounce-cancellation hardening) → Task 2; §6 chip incl. active-not-just-persisted rule → Task 4; §7 error handling → toasts in Tasks 2/4, fail-closed normalizers in Task 1; §8 testing → Task 1 (unit), Tasks 3/4 (fixture), Task 5 (live); §9 out-of-scope honored (no cross-tab sync, no popup changes, no multi-column sort).
- **Placeholder scan:** every code step carries the actual code; fixture steps name the exact recipe and assertions.
- **Type consistency:** `withSort`/`withFilters`/`normalizeFilters`/`MAX_FILTER_COLUMNS`/`MAX_FILTER_VALUES` names match across Tasks 1-4; `serializeFilters`/`saveFilters`/`scheduleFiltersSave`/`filtersSaveTimer`/`renderViewChip`/`clearViewState` consistent between Tasks 2-4; sort shape `{label, dir}` and filter shape `{anyOf?, q?}` uniform with the spec.
- **Coverage note:** `withSort(sort?.label ? sort : null)` in Task 2 guards a sorted cell whose label reads empty — falls back to clearing rather than writing junk.
