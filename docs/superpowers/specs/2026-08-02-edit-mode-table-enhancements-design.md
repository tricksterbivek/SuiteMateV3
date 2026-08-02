# Edit Mode Table Enhancements — Design Spec (Sales Orders)

Date: 2026-08-02
Status: Approved. Architecture A adopted; owner decisions Q1–Q4 recorded in §11. This document is the working contract for implementation.
Baseline: v3.21.1 @ `main` (213 tests, 28 screenshot baselines at 0.000 %)
Design input: `docs/superpowers/research/2026-08-02-edit-mode/synthesis-and-approaches.md` (§1 constraints, §3 feature status, §4 ladder carry into this spec). Workflow, testing and completion rules: `docs/BUILD-BRIEF-edit-mode.md` — binding, not restated except where this spec pins an interpretation.

## 1. Goal

Bring SuiteMate's table enhancements to the **Sales Order sublist machine in Edit Mode** (`salesord.nl?id=…&e=…`, the `#item_splits` machine): column resizing, hide/show, drag-and-drop reorder, personalization persistence, and Excel-style filtering and sorting — each shipped only to the extent the feature-status table in §8 declares supportable, with "not technically possible" an accepted outcome when justified by live evidence.

The implementation is a **parallel module family**, `src/edit-grid/`, that shares no code, no storage key and no CSS with `src/so-columns/`. View Mode is left byte-identical apart from four one-token additions enumerated in §4.4. Enforcement is mechanical: `git diff --name-only main | grep so-columns` returns only `src/so-columns/core.js` for the single-token `FOREIGN_NODE_SELECTOR` line, and nothing else.

## 2. Non-goals

Generalizing beyond Sales Orders (widen the route rule later, never rewrite); other machines on the same page; other record types; other transaction types in Edit Mode; a shared multi-mode column engine (Architecture B — the right refactor *after* Edit Mode is stable, not in this phase); the read-only sorted/filtered overlay (closed by Q3, §11); persisting sort or filter state; MAIN-world injection or any page-JS bridge (`tests/verify.mjs:69-76` forbids declaring MAIN-world injection in the manifest, and reaching page JS is a privilege-tier escalation `so-columns` never needed); modifying `src/so-columns/` behaviour, storage or tests.

## 3. Hard constraints

**H1 — The View Mode DOM layer is mechanically unusable in Edit Mode.** Every row-touching function in `src/so-columns/core.js` gates on `row.cells.length === headerCount`: `applyHidden` (`:380`), `isDataRow` (`:568`, called from `:500`, `:621`, `:643`) and `applyOrder` (`:711`). Edit Mode data rows carry extra system `<td>`s with inline `display:none`, so `cells.length > headerCount` and **every one of those predicates matches zero rows**. This is the recorded root cause of the headers-only-CSV defect (`save/CHECKPOINTS.md:1094`; identical predicate at `src/csv-export/core.js:268`). `applyOrder` is the worst case — the header row *does* match, so it would reorder the header and no data row, a silent column/value mismatch. `src/edit-grid/core.js` therefore reimplements every row predicate against an Edit-Mode definition and imports nothing from `so-columns`.

**H2 — The View Mode storage layer must not be reused, even though it would validate.** `normalizeScopeKey` (`src/so-columns/core.js:49-56`) and `normalizeLabels` (`:58-69`) accept any string ≤ `MAX_LABEL_LENGTH` (200, `:8`), so column ids would pass. But `evictOverQuota` (`:185-193`), when the shared `suiteMateV3ColumnOrder` item exceeds `MAX_SYNC_ITEM_BYTES = 7800` (`:7`), executes `next.orders = key in next.orders ? { [key]: next.orders[key] } : {}` — it keeps **only the entry being written**. One Edit Mode save that tips the item over quota would silently delete every View Mode layout: a View Mode data-loss regression produced without editing a View Mode file. Compounding it, `save/CHECKPOINTS.md:1199` records the v3.21.1 lesson — a feature that bumps a shared persisted schema cannot be reverted by code revert alone; live storage is a one-way door. **Edit Mode gets its own `chrome.storage.sync` key (§5).**

**H3 — Mode separation is a route gate, and the gate is the whole enforcement mechanism.** `src/shared/routes.js:282-295`: both `TRANSACTION_COLUMN_PERSONALIZATION` and `FORM_VIEWS` end in `&& !hasParam(context, "e")`, asserted negative for `?id=1&e=T` and `?id=1&e=F` at `tests/routes.test.mjs:273-274` and `:312-313`. A new capability whose rule requires `hasParam(context, "e")` is the exact complement: the two are mutually exclusive **by construction**, and every existing case stays byte-identical. This is the strongest available proof of "View Mode untouched" and costs one additive `case`.

**H4 — There is no CSS-order escape hatch.** `order:` requires flex or grid; making `<tbody>` flex destroys column alignment; `<td>` cannot be reordered by CSS at all. Column reorder and row sort are **true DOM node movement or nothing** — any "visual-only" plan for those two is void. Hide/show and filter *do* have a display-only mechanism, and it is proven safe on live Edit Mode pages: `src/internal-ids/runtime.js:167-181` already filters machine cells by `cell.style.display !== "none"`, which establishes both that NetSuite hides its own system cells that way and that their values still serialize.

**H5 — Everything written into the table is discarded on repaint; survival is the engineering problem, not corruption.** Add/Insert/Remove renumbers every `<tr id>` and every `_fs` span id; paging replaces the whole `<tbody>`; sourcing rewrites the open row. Doctrine: **do not enumerate rebuild scopes** — assume any interaction may replace the entire `<tbody>`, and make re-apply cheap, idempotent and self-suppressing. The toolkit exists in-repo: ownership attributes plus `ensureX()` idempotence and the listener-duplication guard at `src/so-columns/runtime.js:1014-1017`; generation-guarded watchers with synchronous cleanup enforced at `src/shared/lifecycle.js:193` and `:287-292`; and the acceptance test that proves absence of a feedback loop — **count storage writes, not DOM operations** (one gesture = exactly one write, flat for 500 ms; the pattern that caught the form-views round-trip defect, `save/CHECKPOINTS.md:1182`, readable from the `tests/fixtures/chrome-stub.js` write counters).

## 4. Architecture — the `src/edit-grid/` module family

### 4.1 New files

| Path | Est. lines | Role |
|---|---|---|
| `src/edit-grid/core.js` | 500–650 | `SuiteMateV3EditGridCore`. Frozen contract: `VERSION = 1`, `STORAGE_KEY = "suiteMateV3EditColumns"`, `STORAGE_SCHEMA_VERSION = 1`, `DATA_ATTRIBUTE = "data-suitemate-v3-edit-grid"`, `NATIVE_ROW_ATTRIBUTE = "data-suitemate-v3-edit-grid-native-row"`, `BOUND_ATTRIBUTE = "data-suitemate-v3-edit-grid-bound"`, every selector and class. Storage half: the six-part doctrine (§5). DOM half, all Edit-Mode-native: `readColumnIds(table)` (decode `span[id$="1_fs"]` per the `sublistColumnId` logic at `src/internal-ids/core.js:40-52`, copied not imported), `visibleCells(row)` (`style.display !== "none"`), `alignsToHeader(row, columnIds)`, `planOrder`/`moveColumn` (copied per the `06d9cfe` precedent), `applyWidths`, `applyHidden`, `applyRowFilters`, `sortRowsEdit` with an Edit-Mode contiguity definition excluding button/totals/loading/nodata rows. Zero DOM-global, storage, bridge or network authority — asserted by a source-purity test. |
| `src/edit-grid/runtime.js` | 800–1000 | Top-frame check → capability gate → `lifecycleApi.register({ id: "record.edit-grid", mode: "continuous", startPaused: true, … })` → settings gate → idempotent `installEditGrid` / synchronous `removeEditGrid`. Scoped `relevant()` with stamp exclusion; identity re-derivation per install; open-line state machine and apply queue; delegated listeners on the container only; force-reveal rules; serialized save queue; toasts via `globalThis.SuiteMateV3Notifications?.showToast` (pattern at `src/form-views/runtime.js:46-47`). |
| `src/edit-grid/edit-grid.css` | 100–150 | Every rule scoped under `[data-suitemate-v3-edit-grid]` or the feature's own classes. Hide rules carry `display: none !important`, plus the `[data-suitemate-v3-edit-grid][hidden] { display: none !important }` guard that closes the display-defeats-hidden class for a fourth time (prior sightings: `save/CHECKPOINTS.md:858`, `:972`, `:1143`). |
| `tests/edit-grid.test.mjs` | 250–350 | `runInNewContext(source, { TextEncoder })` harness in the house shape (`tests/so-columns.test.mjs:11-16`) with an Edit-Mode stub: rows carrying extra `display:none` cells, `_fs` spans, a `machineButtonRow`, a totals row. Frozen-contract asserts first, source-purity test last (`tests/so-columns.test.mjs:647-649` shape). |
| `tests/fixtures/sales-order-edit.html` | ~150 | Self-loading, `replaceState` to `salesord.nl?id=1&e=T`, realistic `#item_splits` markup plus a small script emulating open-line and add-line repaints. **Not** registered in `tests/fixtures/route-catalog.js` — which keeps the baseline PNG and the `tests/fixtures.test.mjs:101` count of 28 untouched. |

### 4.2 Reused as-is (zero modification)

`src/shared/lifecycle.js` (multi-tenant by design; generation guards and the synchronous-cleanup contract are exactly what H5 needs); the `src/shared/settings.js` read/subscribe path; `globalThis.SuiteMateV3Notifications.showToast`; `src/shared/routes.js` `createPageContext`/`supports` mechanics; the four-tier verification ladder and `python3 -m http.server 8931` fixture loop.

### 4.3 Shared files that change — the complete flagged list

Every entry is **additive**: no existing line changes meaning, and each is required by the gate arithmetic, not by preference.

| File | Change | Why it is unavoidable |
|---|---|---|
| `manifest.json:41-52` (css array), `:53-74` (js array) | +1 css (`src/edit-grid/edit-grid.css`), +2 js (`src/edit-grid/core.js` after `src/form-views/core.js`; `src/edit-grid/runtime.js` appended last) | Content scripts are declared here or the module does not load. Core-before-runtime ordering is the existing invariant. |
| `tests/verify.mjs:30-41`, `:43-63` | Same two arrays, byte-for-byte | `deepEqual` mirrors of the manifest; the build fails otherwise. |
| `tests/verify.mjs:156-169` | +1 fixture in the link list | Every fixture's `src`/`href` references are access-checked here. |
| `package.json:10` | +2 `node --check`, +1 `--test tests/edit-grid.test.mjs` | Syntax gate and test discovery. |
| `src/shared/routes.js` | New `CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT: "transaction-column-personalization-edit"` in the block at `:10-20`, and a new `case` inserted after `:295` (before `RECORD_TYPE_BRIDGE` at `:296`). Existing cases untouched. | H3. The rule: `context.isTopFrame && Boolean(context.path) && context.path.toLowerCase() === PATHS.SALES_ORDER && hasParam(context, "id") && hasParam(context, "e")`. Sales-Order-only mirrors `FORM_VIEWS` (`:289-295`) and generalizes by widening one line. |
| `tests/routes.test.mjs` | +1 positive/negative block | Proves the complement: `supports()` returns true for `?id=1&e=T` and `?id=1&e=F`, false for view URLs, non-SO transactions, sub-frames and cross-origin. The existing negatives at `:273-274` and `:312-313` must stay green and unedited. |
| `src/shared/settings.js` | `SCHEMA_VERSION` 5→6 (`:9`); `salesOrderColumnsEdit: false` in `DEFAULTS` (`:29-38`); `=== true` normalization beside `:131-133`; pass-through migration `5 → 6` after `:170` | Q1. Own task inside M1 — the repo's highest-ripple change. |
| `src/shared/settings-transfer.js:118-119` | +1 legacy-field row for schema 5 | The transfer validator enumerates historic field sets per schema. |
| `src/popup/popup.html` (toggle row beside `:75-85`), `src/popup/popup.js:19-21`, `:414-416`, `:423-425`, `:442-444` | New opt-in toggle **"Sales Order columns (Edit Mode)"**, default off | Q1. Follows the `formViews` toggle exactly. |
| `tests/settings.test.mjs`, `tests/settings-transfer.test.mjs`, `tests/verify.mjs:946-962` | New flag added to every expected settings object; `schemaVersion: 6` | Known, bounded ripple with a working precedent (`b774797`). |
| `tests/fixtures/chrome-stub.js:206-216` (get) and the `set` branch below it | New `suiteMateV3EditColumns` case plus a `dataset.editGridWrites` counter, mirroring `formViewsWrites` | The write-counter assertions in §9 tier 2 are unreachable without it. |
| Four `FOREIGN_NODE_SELECTOR` lists | One token each — see §4.4 | Coexistence. |

### 4.4 The four one-token View Mode touches

These are the **only** edits to View Mode files in the entire feature. Each appends `, [data-suitemate-v3-edit-grid]` to an existing selector string and changes nothing else:

- `src/so-columns/core.js:24`
- `src/form-views/core.js:21`
- `src/csv-export/core.js:211` (`VIEW_FOREIGN_NODE_SELECTOR`)
- `src/tab-title/core.js:5`

Precedent: `save/CHECKPOINTS.md:1159`, where the same four-list sweep admitted `[data-suitemate-v3-form-views]`. Verified 2026-08-02: **no test file pins any of these four strings**, so the ripple is exactly four tokens and zero test edits. Each is a defensive exclusion — it prevents a future View Mode text read from ingesting an Edit Mode affordance — and none is reachable in Edit Mode, where these capabilities never fire (H3). They ship in M1 with the module family, not later.

## 5. Persistence

**Key.** `suiteMateV3EditColumns`, a `chrome.storage.sync` item owned solely by `src/edit-grid/`. `edit-grid` never reads or writes `suiteMateV3ColumnOrder`; asserted by the source-purity test (the string must not appear in `src/edit-grid/*`) and by the live H2 regression check in §9.

**Container, schema v1.**

```
{ schemaVersion: 1, grids: { [scopeKey]: { order?: string[], hidden?: string[], widths?: { [columnId]: number } } } }
```

Sort and filter are **session-only and never persisted** (§8); the container reserves no keys for them, and adding them later is a schema-2 bump, not a silent extension.

**Scope key.** `` `${companyId}:${userId}:${type}:edit` ``, resolved by the same `session_status_init.jsp` parse used at `src/so-columns/runtime.js:65-88` (session id is `COMPANY~USER~ROLE~FLAG`; segment 2 is the user id), copied into `edit-grid/runtime.js`, not imported. Fallback when the session script is absent: `` `${location.hostname}:${type}:edit` ``. With a separate key the `:edit` suffix is not strictly required; it costs one string and makes any stray cross-mode read obvious on inspection.

**Column-id keying.** Entries are keyed by the internal **column id** decoded from `span[id="{machine}_{columnid}{line}_fs"]`, never by header label text — in Edit Mode label text is unreliable and cell text is widget junk. Decode logic mirrors `src/internal-ids/core.js:40-52`.

**Six-part doctrine** (behaviour copied from `src/so-columns/core.js:40-268` — normalizers, `normalizeStored` `:156`, `refusesNewerSchema` `:177`, `evictOverQuota` `:185`, `entryIsEmpty` `:129`, the `with*` writers `:195-268` — reimplemented in `edit-grid/core.js`, never imported):

1. **Fail-closed normalizers** — anything not exactly the expected shape normalizes to the empty container; a rejected write returns `null` and the caller does nothing.
2. **Prototype-pollution rejection** — `__proto__`, `constructor`, `prototype` refused as scope keys and as column ids.
3. **`refusesNewerSchema`** — a stored `schemaVersion > 1` is read as empty and **never written over**.
4. **Quota guard** — `MAX_SYNC_ITEM_BYTES = 7800` measured as `TextEncoder().encode(STORAGE_KEY + JSON.stringify(next)).length`; over quota, single-entry eviction scoped to `grids` keeps only the entry being written.
5. **Empty-entry deletion** — an entry whose `order`, `hidden` and `widths` are all absent or empty is removed, so Reset shrinks the item instead of growing it.
6. **Null-on-rejection writers** — `withOrder`, `withHidden`, `withWidths`, each pure and string-keyed, driven by one **serialized save queue** in the runtime (at most one in-flight `set`; the newest pending state wins).

**Caps.** ≤ 100 column ids per list; ≤ 200 characters per id; widths clamped to `[perColumnMin, 1000]` where `perColumnMin` is the widest widget `offsetWidth` in that column — **not** the View Mode global `MIN_COLUMN_WIDTH = 30` (`src/so-columns/core.js:13`), which would clip a text input to unusability.

**Quota isolation rationale (H2).** Eviction is destructive by design; isolating the key bounds the blast radius to Edit Mode's own scopes. Worst case an Edit Mode save evicts other Edit Mode scopes — recoverable by re-personalizing. Under a shared key the same event destroys View Mode layouts silently. The isolation also makes the feature genuinely revertible: delete `src/edit-grid/` plus the additive lines, and `main` simply ignores an unknown storage key.

## 6. Attachment & re-render survival

**Capability gate.** `routes.supports(CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT, context)` per §4.3 — requires `hasParam(context, "e")` rather than `e === "T"`, which makes it the exact byte-complement of the two `!hasParam(context, "e")` rules (H3). A non-editable `?e=F` page therefore reaches the runtime and then **fails closed at install**, because install requires a `#item_splits` machine containing `_fs` spans; nothing is injected.

**Settings gate.** `salesOrderColumnsEdit === true`, default false. Registration uses `startPaused: true` so the watcher performs no work until settings resolve — which is also why the 28 screenshot baselines cannot move.

**Lifecycle registration.** `lifecycleApi.register({ id: "record.edit-grid", mode: "continuous", startPaused: true })`. Cleanup is synchronous — `src/shared/lifecycle.js:193` throws on an async cleanup to prevent cross-generation races — and removes every node carrying `DATA_ATTRIBUTE`, every listener, and every applied style, leaving the machine as NetSuite emitted it.

**`relevant()` predicate.** Scoped to the `#item_splits` machine and its `.uir-machine-table-container`. It returns **false** for any mutation whose target or ancestor carries `DATA_ATTRIBUTE` or `NATIVE_ROW_ATTRIBUTE` (**stamp exclusion**), which is the first of the two deterministic feedback-loop breakers.

**Identity early-return.** The second breaker. `installEditGrid` reads the machine's current column ids, joins them, and compares against the target arrangement; on equality it performs **zero DOM writes and zero storage writes** and returns. Together, stamp exclusion and identity early-return make "one gesture = exactly one storage write, flat for 500 ms" a testable property rather than a hope.

**Identity re-derivation per install.** Because Add/Insert/Remove renumbers every `<tr id>` and every `_fs` span id, identity is re-derived from the machine's own `_fs` spans on **every** install. A surviving `data-*` stamp on a `<td>` is never trusted as identity — only as an ownership marker.

**Open-line state machine.** `isLineOpen()` is true while a `tr.uir-machine-row-focused` exists or the **button row** is attached — the transient `<tr>` NetSuite appends beneath the open line carrying a single colspan cell with the line buttons (`machineButtonRow`). `isDirty()` tracks whether the open line has uncommitted edits. While a line is open:

- **reorder and sort are refused** (toast: "Finish editing the line first."), never queued into a surprise;
- **hide/show, width and filter changes are queued** and flushed on removal of the focused-row state;
- the open row and any dirty row are **force-revealed** and exempt from every hide/filter/move set.

**Delegated listeners.** Exactly one listener per event type, on the container, added under a `BOUND_ATTRIBUTE` guard — the `SORTABLE_ATTRIBUTE` pattern at `src/so-columns/runtime.js:1014-1017`. Never on rows or cells: those are destroyed on repaint, and per-row binding is how duplicate handlers accumulate. Every injected button is `type="button"` — cosmetic in View Mode, safety-critical inside `main_form` where a bare `<button>` defaults to submit (habit at `src/so-columns/runtime.js:250,456,740,952,977`).

**Force-reveal rules** (mandatory, not polish — `validateField` focusing a widget inside a `display:none` cell is a no-op, so the machine can refuse to commit with no visible error):

1. `focusin` landing inside a hidden cell reveals that column for the session and toasts once.
2. A validation failure on the open line reveals **all** hidden columns and toasts.
3. `machineButtonRow`, totals, loading and nodata rows are never hidden, never moved, and never counted as data rows.
4. Filtering never removes the open or a dirty row; adding a line while filtered reveals the new line.

**No `innerHTML` anywhere.** Nodes are built with `document.createElement` and stamped with `DATA_ATTRIBUTE` at creation.

## 7. Error handling — fail-closed inventory

| Condition | Behaviour |
|---|---|
| Stored value is not the expected container | Read as empty; **no write**, so a foreign or corrupt value is never overwritten blind. |
| Stored `schemaVersion > 1` | `refusesNewerSchema` — read as empty, all writes suppressed, one toast ("This layout was saved by a newer SuiteMate."). |
| Unrecognized DOM: no `#item_splits`, no header row, header count 0, no `_fs` spans, or duplicate/undecodable column ids | `installEditGrid` returns false. Nothing injected, nothing styled, nothing stored. |
| Machine is native-drag-ordered (`.uir-list-machine-ordered`, `.uir-draggable-table`) | Row order is data. **Sort and filter refuse permanently** for that machine, with a toast. Enforced as an unconditional precondition whether or not U4 is ever confirmed. |
| A line is open — reorder or sort requested | **Refused** with a toast; no queueing, no deferred surprise. |
| A line is open — hide/show, width or filter requested | Queued; flushed when the line closes; identity re-derived before the flush. |
| Focus enters a hidden cell, or the open line fails validation | Force-reveal per §6; the layout change is dropped, not the user's edit. |
| Width below the column's widest widget | Clamped to `perColumnMin`; never to 30 px. |
| Storage write rejected (quota, normalizer, `chrome.runtime.lastError`) | In-memory state and DOM are left as the user sees them; one toast ("Column layout could not be saved."); no retry storm. |
| Column id present in storage but absent from the current machine | Ignored for this render, **retained** in storage — paging and form variants must not silently erase a valid preference. |
| Any exception inside install | Caught, logged once, install returns false; the machine is left native. A broken enhancement must never break editing. |

## 8. Feature-status table — binding as-built

Semantics carried from `synthesis-and-approaches.md §3`. **This table is binding and updates only with evidence** (a probe transcript or a live pass), never with an opinion. **Gate A** = M1 probe 8: permute two `<td>`s in a non-focused row, edit and commit an adjacent line in-page, read back — does a repaint address cells by **element id** (supportable) or by `row.cells[i]` (not possible)?

| Feature | Verdict | Mechanism | Key risk | Verification |
|---|---|---|---|---|
| **Column resizing** | **Fully supportable** | `core.applyWidths`: freeze header-cell widths, set `table.style.tableLayout = "fixed"` so widths derive from row 1 and repainted data cells cannot disturb them. Per-column min = widest widget `offsetWidth`. `table.style.width` left unset. | Widget-bearing columns clipping below their `<input>`; double scrollbar inside `.uir-machine-table-container`; resize hover zone colliding with native field help on `.listheader` (`src/styles/netsuite.css:1616-1623`). | Unit: width clamp, header-only iteration. Fixture: computed px survive a simulated repaint. Live: probe 9; widths hold across open-line / add-line / remove-line / recalc; field help still works outside the 5 px edge. |
| **Hide / show columns** | **Fully supportable** | Class on the `<td>` and header cell, `display: none !important`. Cell, `_fs` span and `<input>` stay in the DOM and in `main_form` — the same mechanism NetSuite uses for its own system cells (`src/internal-ids/runtime.js:167-181`). Force-reveal on `focusin` and on validation failure. | `validateField` focusing a widget inside a hidden cell no-ops → line silently refuses to commit. Popup pickers anchored to a zero-box cell. Fourth sighting of the display-defeats-hidden class. | Unit: hide planning, reveal precedence. Fixture: **computed display**, never `.hidden` or a class name. Live: probe 11 (hide a required column, force a validation failure); values still commit after hide; add/remove line with a column hidden. |
| **Column personalization (persistence)** | **Fully supportable** | Own key `suiteMateV3EditColumns`, own container schema v1, scope `{company}:{user}:{type}:edit`, entries keyed by column id, six-part doctrine, one serialized save queue (§5). | Sharing `suiteMateV3ColumnOrder` would let an Edit write evict View layouts via `evictOverQuota` (H2 — this is why the key is separate). Quota pressure on 44–45-column grids. Re-apply racing a save. | Unit: normalizers, caps, `refusesNewerSchema`, eviction, hostile input. Fixture: one gesture = **exactly one** write, flat 500 ms; reload → re-apply with **zero** writes. Live: `chrome.storage.sync.get` shows only the `:edit` scope touched and `suiteMateV3ColumnOrder` byte-identical before and after. |
| **Drag-and-drop column reorder** | **Conditional — Gate A.** Supportable if repaint is id-addressed; **not technically possible** if index-addressed. **Until Gate A passes, treat as not possible.** | True `<td>` movement permuting **visible / `_fs`-identified** cells only — never `row.cells[i]`. HTML5 drag on the header row while personalizing. Refused while any line is open. Re-applied after every rebuild via stamp exclusion + identity early-return. | **Gate A failing = silent data corruption**: values land in the wrong columns and serialize that way. Secondary: `so-columns/core.applyOrder` (`:711`) in Edit Mode would reorder the header row and zero data rows — the Edit variant must not inherit that predicate. Native drag-order machines (U4) refuse. | **Gate A first, before any reorder code is written.** Then unit: permutation over rows with extra hidden cells. Fixture: order survives simulated add/remove/repaint. Live: reorder → open, edit and commit an adjacent line → read values back → no cross-column contamination; repeat after a page-level recalc. |
| **Excel-style filtering** | **Degraded — supportable** | `display: none` on `<tr>`. No node movement, no focus loss, row ids untouched. Force-reveal the open and any dirty row. Auto-reveal on Add. Session-only. | **Page-scoped** (~25 rows) — the UI must say so, in the control bar, not in a doc. A dirty line hidden from under the user. Totals row keeps showing full totals. `machineButtonRow` never hidden. Refuse on `.uir-list-machine-ordered` (U4). | Unit: matching + forced-reveal precedence. Fixture: computed display per row; add-line-while-filtered. Live: probe 12 (rendered rows vs `nlapiGetLineItemCount`); filter → add a line → line visible; filter → open a line → row stays visible; commit succeeds. |
| **Excel-style sorting** | **Degraded — supportable, session-only** | True `<tr>` movement (no CSS alternative — H4). Native order restored from row stamps (`NATIVE_ROW_ATTRIBUTE` precedent, `src/so-columns/core.js:512-517`). Refused while any line is open. Re-applied after rebuilds. Not persisted. | Moving a `<tr>` containing the focused widget blurs it and can abort a sourcing round-trip. `machineButtonRow` and the totals row sit inside the range, so the View Mode contiguity guard (`src/so-columns/core.js:506-510`) would refuse outright — the Edit variant needs its own definition. `.sln` line numbers count visual position and read **wrong** while sorted → suppress the display and disclose. Refuse on native drag-order machines. | Unit: Edit-Mode contiguity + exclusion sets. Fixture: sort → simulated repaint → re-applied; sort refused while a row is focused. Live: sort → add → remove → recalc; commits land on the intended lines; zero console errors. |
| *(contingency)* Read-only sorted/filtered overlay | **Not authorized.** Closed by owner decision Q3 (§11). | — | — | Not built, not designed, not costed. If Gate A fails, reorder is declared not technically possible with the probe transcript as justification, and no substitute ships. |

## 9. Testing strategy

Four tiers. Every milestone runs all four that apply to it before its checkpoint.

**Tier 1 — Unit (`tests/edit-grid.test.mjs`).** `runInNewContext(source, { TextEncoder })` with `sandbox.globalThis = sandbox` — the sandbox isolation *is* the test (`tests/so-columns.test.mjs:11-16`). Frozen-contract asserts on `VERSION`, `STORAGE_KEY`, `STORAGE_SCHEMA_VERSION` and every selector/class/attribute string; storage normalizers, caps, `refusesNewerSchema`, quota eviction, hostile input; every DOM planner exercised against an Edit-Mode stub whose rows carry extra `display:none` cells, `_fs` spans, a `machineButtonRow` and a totals row. Last test is source purity: `assert.doesNotMatch(source, /document\.|chrome\.|fetch\(|XMLHttpRequest|innerHTML|localStorage|sessionStorage/)`, extended to forbid the literal `suiteMateV3ColumnOrder`. Push everything testable into `core.js` — runtimes have no unit coverage in this repo and this is the highest-consequence surface SuiteMate has touched.

**Tier 2 — Fixture (`tests/fixtures/sales-order-edit.html`, served by `python3 -m http.server 8931`).** Needs no extension reload, so it is the default inner loop. Two non-negotiable assertion rules:

- **Assert at computed style or bounding rect**, never on a class name or the `hidden` attribute (`save/CHECKPOINTS.md:972` is the recorded cost of ignoring this).
- **Count storage writes, not DOM operations** via the `tests/fixtures/chrome-stub.js` counter added in §4.3: one gesture = exactly one write, then flat for 500 ms; seeded storage + reload = re-apply with **zero** writes.

Plus the negative that proves H3 on identical markup: with the URL rewritten to `?id=1` (no `e`), `edit-grid` does not mount and the View Mode capability's rule flips to true. The complement is asserted **at the route gate**, not at the DOM — H1 means `so-columns` would find zero data rows in this markup, and that is expected, not a defect to chase.

**Tier 3 — Live, batched per milestone, under `docs/BUILD-BRIEF-edit-mode.md`.** Restated because it binds every browser action:

- **Record lock** — account `6998262`, `id=16342809`, and no other record or transaction. Per Q2, the lock explicitly covers the same record with `&e=T` appended; any other URL is a stop-and-report.
- **Safety triple**, verified before testing begins and again before any save: `custbody_salesorder_issue` checked; Status = Pending Approval; Memo clearly marks a testing record. Any failure at any point: do not save, stop, report.
- **Four-eyes save gate** — evidence pack, an independent Opus 5 gate answering exactly GO or NO-GO, default NO-GO; the first save of a session additionally needs the owner's explicit go-ahead in chat. **No milestone in this plan requires a save.** The Gate A probe is explicitly never-save (Q2); teardown is navigating away.
- Forbidden verbs (Approve, Reject, Bill, Fulfill, Email, Print, Delete, Make Copy, any status-changing or document-sending action) are forbidden regardless of anything else. Every interpretation question — "does this render correctly?", "is this a regression?" — is answered by an Opus 5 subagent from DOM evidence, never by the captain's own reading.
- Live sessions are batched: the extension reload and popup toggles are human actions and cannot be automated, so each milestone asks for reload **and** toggles in one interrupt. A fix found mid-pass is recorded as *"fixture-verified; live on next reload"* rather than blocking the pass.
- **`docs/testing-log.md`** is created in M1 and appended in every subsequent live session: timestamp, milestone, what was exercised, evidence location, gate verdict where a gate ran. It ships in the same checkpoint commit. It is not save-only — it is the record of every live session, so a milestone with no save still leaves a log line.

**Tier 4 — View Mode regression, every milestone, same record.** Load `id=16342809` in view mode and confirm: column personalization, sort, filter and widths all behave; Export view produces data rows, not headers-only; tab titles and internal-id badges unaffected; zero SuiteMate console errors. Plus the H2 check from M5 onward — `suiteMateV3ColumnOrder` byte-identical before and after an Edit Mode session.

**Gate arithmetic per milestone that adds a file.** `npm test` must stay green, which means: manifest `js`/`css` arrays and their `tests/verify.mjs` `deepEqual` mirrors agree byte-for-byte; `node --check` covers every new source file; the new `*.test.mjs` is in the `--test` list; the new fixture is in the `tests/verify.mjs:156-169` link list. Keeping the fixture out of `route-catalog.js` deliberately avoids the baseline PNG and the `tests/fixtures.test.mjs:101` count bump.

## 10. Milestone ladder

Order is the brief's (`docs/BUILD-BRIEF-edit-mode.md:33-36`): foundation → resize → hide/show → reorder → personalization → filter → sort. Every milestone is independently shippable and ends in a **checkpoint**: `npm test` green (**213 + new tests**, **28 baselines at 0.000 %** — a moved baseline is a defect, never a baseline to refresh), a fixture round-trip, live evidence where applicable, a `save/CHECKPOINTS.md` entry in the house `### Included` / `### Verification` shape, a `docs/testing-log.md` line, and a git commit on `feature/edit-mode-table-enhancements`. Per `save/CHECKPOINTS.md:3`, **the next milestone does not begin until the previous checkpoint has passed.** Features are built strictly sequentially — parallel agents are for research, review and verification only. Version stays frozen at 3.21.1 until a final owner-gated bump across `package.json:3`, `manifest.json:5`, `tests/verify.mjs:13`.

**M1 — Shared Edit Mode foundation.**
Scope: the new capability + `case` in `src/shared/routes.js` with positive/negative route tests; `src/edit-grid/{core,runtime}.js` skeleton that mounts, stamps, tears down cleanly and does nothing visible; `src/edit-grid/edit-grid.css`; `tests/fixtures/sales-order-edit.html`; the four `FOREIGN_NODE_SELECTOR` tokens; the new settings flag + popup toggle (schema 5→6, its own task inside the milestone); and the **live probe pass**.
Gates — *fixture:* mounts on `?e=T`, does **not** mount on `?id=1` while View Mode does, cleanup leaves zero owned nodes, idle produces zero storage writes for 500 ms. *unit:* frozen contract, storage normalizers, source purity. *live:* the dossier §12 probes 1–12, **read-only except probe 8**, which is authorized by Q2 as in-page open/edit/commit with **no save**, safety triple verified first, teardown by navigating away. Every probe result is recorded verbatim in the checkpoint entry — probes 2, 5 and 8 gate later milestones and their transcripts become binding evidence.
Checkpoint means: attachment and re-render survival are proven, **Gate A is answered**, and `docs/testing-log.md` exists.

**M2 — Column resizing.** Widths persisted under the new key; `table-layout: fixed`; per-column min from the widest widget. Gates — unit: clamp + header-only iteration. fixture: computed px survive a simulated repaint. live: widths hold across open-line / add-line / remove-line / recalc; native field help intact. Checkpoint: the first user-visible Edit Mode feature ships, with a View Mode regression pass on the same record.

**M3 — Hide / show columns.** `display: none !important` on `<td>` + header, force-reveal on `focusin` and on validation failure, hidden-column chips. Gates — unit: hide planning + reveal precedence. fixture: **computed display**. live: probe 11; hidden columns still commit; add/remove line with a column hidden. Checkpoint: the display-defeats-hidden class is closed for a fourth time with computed-level evidence.

**M4 — Drag-and-drop column reorder — GATE A DECISION POINT.** Ships **only** if M1's probe 8 returned id-addressed repaint. If it did: minimal personalize affordance to enable dragging, permutation over visible/`_fs` cells, refused while a line is open. Gates — unit: permutation over rows with extra hidden cells. fixture: order survives simulated add/remove/repaint. live: reorder → commit an adjacent line → read back → no cross-column contamination. If probe 8 returned index-addressed: **this milestone is closed as not technically possible** (Q3), the probe transcript is pasted into the checkpoint entry as justification, §8's reorder row is updated to *not possible* with that citation, **no substitute is built**, and M5 proceeds unaffected.

**M5 — Column personalization (UI mode + scope hardening).** Personalize / Done / Reset control bar, hidden chips, cross-record merge semantics, quota and eviction hardening, serialized save queue. Gates — unit: reducers, caps, hostile input, `refusesNewerSchema`. fixture: one gesture = exactly one write, flat 500 ms; reload → re-apply with zero writes. live: `suiteMateV3ColumnOrder` byte-identical before and after an Edit Mode session — the H2 regression test. Checkpoint: persistence is provably mode-isolated.

**M6 — Excel-style filtering.** `display: none` on `<tr>`; **page scope disclosed in the control bar UI** (Q4), not left to be discovered; force-reveal open and dirty rows; auto-reveal on Add; refuse on native drag-order machines. Gates — unit: matching + reveal precedence. fixture: computed display per row; add-while-filtered. live: probe 12; filter → add → open → commit. Checkpoint: filtering ships degraded-and-disclosed.

**M7 — Excel-style sorting, with a live-evidence exit.** True `<tr>` movement with Edit-Mode contiguity, session-only, refused while a line is open, line-number display suppressed while sorted, page scope disclosed. Gates — unit: contiguity + exclusion sets. fixture: sort → repaint → re-applied; refused while focused. live: sort → add → remove → recalc; commits land on the intended lines. **Exit condition (Q4): if the live pass shows any interference with line commits or sourcing, M7 is closed as not-shipped** — §8's sorting row is updated with the live evidence, the code is reverted rather than iterated, and nothing already shipped is affected. Otherwise: end-to-end Edit Mode pass + View Mode regression + completion doc (as-built feature table, known limitations, the testing log, and what to do next to generalize beyond Sales Orders) + owner-gated version bump.

## 11. Decisions record

Owner decisions, taken 2026-08-02; all four adopt the `synthesis-and-approaches.md §5` recommendations.

**Q1 — Does Edit Mode get its own toggle, or ride the existing one?** → **New opt-in flag, default off**, accepting the settings schema 5→6 migration and its full ripple. Silently enabling a live-edit-surface feature on every existing install with `salesOrderColumns` already on is not a cost worth saving; the flag also makes Edit Mode independently switch-off-able if a live defect appears. Pinned name: `salesOrderColumnsEdit`.

**Q2 — May the Gate A probe open, edit and commit a sublist line on the locked record without saving?** → **Authorized**, with three conditions: the safety triple is verified before the probe; **no save occurs**, so the four-eyes gate is never invoked; the session ends by navigating away, never by Submit. The record lock explicitly covers `id=16342809` **with `&e=T` appended** — the brief's URL at `:89-93` is the view URL, and without this the probe would refuse its own page under test.

**Q3 — If Gate A fails, what replaces column reorder?** → **Nothing.** Reorder is declared not technically possible in Edit Mode, justified in §8 by the probe transcript, and the other features ship. The read-only overlay is **not** built as a substitute — it is a different product that deserves its own brief, not a consolation prize. Shipping reorder anyway with a warning was rejected outright: it risks corrupting real sales order data.

**Q4 — Are page-scoped, session-only sort and filter worth shipping?** → **Ship both**, filter (M6) before sort (M7), with the page scope disclosed in the UI rather than discovered. M7 carries a **live-evidence exit**: any interference with commits or sourcing closes it as not-shipped rather than triggering an iteration loop. The ladder is ordered so abandoning M7 costs nothing already shipped.

## 12. Open risks carried

- **U1 — Authority: in-memory model or hidden buffer?** `machine.dataManager.getLineArray()` vs the serialized `{machine}fields` / `{machine}data` hidden inputs on `#main_form` (format already decoded at `src/internal-ids/core.js:67-89`). Reconcilable but unverified. **Not blocking** — both models agree the DOM *arrangement* is not the source of truth, which is all this design depends on. Probes 5 and 6 settle it.
- **U2 — Gate A.** Does a repaint address cells by element id or by `row.cells[i]`? Index ⇒ reorder is not possible. Answered by M1's probe 8; nothing outside M4 depends on it.
- **U3 — `data-machine-name`.** Used by `src/styles/netsuite.css:1616` but nothing in `src/` sets it, and no external evidence that NetSuite emits it. **No selector in `src/edit-grid/` may depend on it**; probe 1 decides whether it is usable later.
- **U4 — Native drag-reorder machines.** If a machine is `.uir-list-machine-ordered` / `.uir-draggable-table`, row order is data and sort/filter must refuse. Unverified, but the refusal is an unconditional precondition (§7) so the risk is honoured regardless.
- **U5 — Widths under repaint.** Whether NetSuite re-emits `width` attributes on repainted cells is unverified. `table-layout: fixed` should make it moot (fixed layout reads row 1 only); this is M2's live gate, not a blocker for M1.
- **Carried from the reports, demoted.** Four dossier BLUF claims cite a §15 that does not exist in that file: `machine.dataManager`/`buildtable()`, `machine.postBuildTableListeners`, `data-field-name` on the cell, and native drag-reorder machines. All four are treated as **assumptions, not sources**, and none is load-bearing here. In particular, attachment is designed on the MutationObserver path only — if probe 6 finds a named repaint hook, it is adopted later as an optimization behind the same interface, never as a dependency.
