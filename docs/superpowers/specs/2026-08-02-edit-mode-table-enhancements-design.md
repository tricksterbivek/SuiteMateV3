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

## Amendment 1 — M1.5 column identity (2026-08-02)

Status: binding. Amends §5 (column-id keying), §6 (identity re-derivation, open-line state machine), §7 (fail-closed inventory), §8 (three rows) and H1. **Nothing shipped in M1 is reverted** — this amendment only extends. Source of authority: the M1 checkpoint entry `save/CHECKPOINTS.md:1229-1296`, the raw probe transcripts `.superpowers/sdd/2026-08-02-edit-mode-table-enhancements/probe-transcripts.md`, and the M1.5 identity payload `.superpowers/sdd/2026-08-02-edit-mode-table-enhancements/m15-identity-payload.json` (account `6998262`, SO `id=16342809&e=T`).

Throughout this amendment the machine's serialization delimiters are written as their code points: `\u0001` = SOH (field separator), `\u0002` = STX (line separator), `\u0005` = ENQ (intra-field option-list separator).

### A1.1 What was falsified

| Spec claim | Live evidence | Verdict |
|---|---|---|
| §5 "Entries are keyed by the internal **column id** decoded from `span[id="{machine}_{columnid}{line}_fs"]`"; §4.1 `readColumnIds` decodes `_fs` spans; §6 "identity is re-derived from the machine's own `_fs` spans on **every** install" | Static data rows carry **zero `span[id]`, zero `<input>`, zero `data-field-name`** — cells are bare text (`<td>MCH376</td>`). Header cells carry no ids either. `probe-transcripts.md:19`, checkpoint `:1270`. | **Falsified on this form.** `readColumnIds()` returns `[]` permanently, so the runtime declines to install (`probe-transcripts.md:20`, checkpoint `:1272`). The fail-closed path behaved exactly as designed; the *axis* is what is unreachable. |
| §6 open-line state machine: "`isLineOpen()` is true while a `tr.uir-machine-row-focused` exists or the **button row** is attached" | The permanent entry row **always** carries `uir-machine-row-focused` and its `uir-machine-button-row` is **always** attached. `probe-transcripts.md:15,33`, checkpoint `:1275`. | **Falsified.** `isLineOpen()` is `true` permanently as coded and would starve every M2+ queued apply. `isDataRow` likewise accepts the id-less entry row. |
| H1: "Edit Mode data rows carry extra system `<td>`s with inline `display:none`, so `cells.length > headerCount` and **every one of those predicates matches zero rows**" | 43 header cells / 43 visible; data rows 1-7 symmetric at 43/43. **No hidden system cells on this record/form.** `probe-transcripts.md:12`, checkpoint `:1273`. | **Premise not manifest.** See A1.5. |
| §12 U1: the hidden-input format is "already decoded at `src/internal-ids/core.js:67-89`" | The *container* format is decoded there (`\u0001` fields, `\u0002` rows), but `customizationScriptIds` strips a `{prefix}` derived from the input name: with `itemfields` the prefix is `item`, so `item_display` becomes `_display`, `item` becomes `""`, and `itempicked` becomes `picked`. | **Reusable as a format reference, not as code.** The item machine's field names are unprefixed. M1.5 ships its own parser. |
| `m15-identity-payload.json` `delimiters`: `"line": "\u0005 (ENQ) observed in itemdata"` | `itemdata` splits into exactly **9** segments on **`\u0002`**, each with exactly 154 values — matching `nlapiGetLineItemCount('item') = 9` (`probe-transcripts.md:46`). `\u0005` occurs 776 times *inside* fields as the option-list separator (`unitslist`, `pricelevels`, `costestimatetypelist`). | **Payload note is mislabelled.** The shipped `src/internal-ids/core.js:81` already splits rows on `\u0002` and is correct. **Line delimiter = `\u0002`; `\u0005` = intra-field option-list delimiter.** |

### A1.2 The new identity mechanism

**Principle.** The hidden `{machine}fields` input is the **primary** identity source: it carries the machine's internal field ids, in machine order, unprefixed, form-determined and therefore i18n-proof and record-independent. It is a **superset** — 154 field ids against 43 rendered columns — so a *selection* step is required. Header labels supply that selection: they are the only signal that stands in 1:1 order with the rendered columns. Labels are used **as a correlation signal only**; the *output* and every *storage key* remain internal field ids. Duplicate labels are therefore harmless: the two `GST` headers correlate to `taxrate1` (visible 14) and `tax1amt` (visible 19) purely by monotonic position.

This is the one place the evidence forced a choice beyond the recorded rulings. The ruling directed the correlation to be driven by aligning `itemdata` values against rendered cell text. **Worked on the real payload, that method cannot succeed**, for three independently fatal reasons:

1. **It has no solution.** A monotonic value-alignment of the 43 visible cells against the 154 serialized values yields **zero** valid alignments. Seven of 43 cells are not rendered from their raw value at all — two list-rendered (`orderallocationstrategy` raw `-2` renders "Predefined On Hand Available Allocation Strategy"; `custcol_item_origin` raw `1` renders "People Republic of China") and five blank-rendered from a non-empty raw (`commitmentfirm`, `isclosed`, `excludefromraterequest`, `custcol_online_oversell` all raw `"F"`; `custcol_anx_mco_line_id` raw `"1"` renders `""`).
2. **Relaxed, it is still ambiguous.** Turning those mismatches into a score penalty rather than an exclusion — so the true field is always reachable — leaves **18** equally-good alignments until the structural reductions described below are also applied. Runs of identical values (`quantitycommitted`, `quantitypickpackship`, `quantityfulfilled` and `quantitybilled` are all `"0"` on every line) and 17 empty cells carry no discriminating information at all.
3. **It would not be stable.** `itemdata` is *record*-dependent. A value-driven mapping resolves differently on a record where `quantityfulfilled` is non-zero, so the derived column ids — and therefore the storage keys — would drift between records of the same type. Saved widths and orders would silently stop applying. `{machine}fields` and the header labels are both *form*-determined and do not drift.

Labels were demoted by ruling from **key** duty — correctly, since `GST` is duplicated and labels cannot key storage — not from **correlation** duty. Readmitting them as the correlation signal satisfies both the letter and the purpose of that ruling. `itemdata` is retained as a corroborator and a structural gate, never as the deriver.

**Decode algorithm** (`parseMachineFieldData`, pure, no DOM):

1. Read `{machine}fields` and `{machine}data` from `input[name="…"]` (falling back to `#…`) inside `table.closest("form")`, where `{machine}` is `machineIdFromTable(table)` (`#item_splits` → `item`).
2. `fieldIds = fieldsValue.split("\u0001")`. Gate: length in `[2, MAX_MACHINE_FIELDS = 400]`, every id passes `normalizeColumnId` (non-empty, ≤ 200 chars, not a reserved key), and **no duplicates**.
3. `lines = dataValue === "" ? [] : dataValue.split("\u0002").map((line) => line.split("\u0001"))`. Gate: **every** line has exactly `fieldIds.length` values. Truncate to the first `MAX_SAMPLE_ROWS = 8` lines.
4. Any gate failure returns `null`, which makes `readColumnIds` return `[]`. **No prefix is stripped** — the item machine's names are already the canonical ids that `nlapiGetLineItemValue('item', …)` takes, and that `columnIdFromSpanId("item_quantity1_fs", "item", 1)` already yields.

**Candidate construction** (`collapseDisplayTwins`) — three structural reductions, 154 → 140 candidates on the live record:

- **Display twins.** When `fieldIds[i] === fieldIds[i+1] + "_display"`, the pair is one column: id `fieldIds[i+1]`, rendered value `values[i]`, and index `i+1` is consumed. Live pairs: `item`, `units`, `price`, `taxcode`, `class`, `costestimatetype`, `custcol_mcol_mystery_original`.
- **Option lists.** A field whose value contains `\u0005` is a serialized select option list and is never a rendered cell. Drops `unitslist`, `pricelevels`, `costestimatetypelist`.
- **Bookkeeping mirrors.** A field whose id is `"old"` or `"default"` concatenated with another id **present in the same list** is a shadow copy, not a column. Drops `oldcommitmentfirm`, `oldexpectedshipdate`, `oldquantity`, `defaultorderallocationstrategy`. (`olditemid`, `olditemcount` and `quantitypickpackship` survive as candidates and are excluded by the alignment itself — the rule is deliberately narrow.)

**Correlation algorithm** (`correlateColumnIds`): the 43 labels are aligned to a strictly increasing subsequence of the 140 candidates, maximising a score, with the optimum required to be **unique**.

```
score(label k, candidate c) = missingValuePenalty + 2 × labelAffinity(label, c.id) + (corroborated ? 1 : 0)

labelAffinity  — both sides lowercased and split on non-alphanumerics; a leading
                 cust/custcol/custcolsd/… token and pure-digit tokens are dropped
                 from the id; then joined:
                 4 exact · 3 either is a prefix or suffix of the other ·
                 2 either contains the other, or every label word (>= 3 chars)
                   occurs in the id · 1 at least half the label words occur ·
                 0 otherwise
corroborated   — some sampled row's non-empty cell text equals the candidate's raw
                 value for that line, comparing numerically when both parse
                 (so "1,701" matches 1701)
missingValuePenalty = -4 when a sampled row renders non-empty text for this column
                 while the candidate's raw value on that line is empty. A penalty,
                 never an exclusion: a render transform we have not modelled must
                 not put the true field out of reach.
```

The maximum-score monotonic alignment is computed by a backward DP over `(labelIndex, candidateIndex)` that also **counts** optimal alignments. Sampled rows are the closed, numbered `{machine}_row_{n}` data rows, indexed **by their own line number** so that skipping an open line leaves a hole rather than shifting every later row against `{machine}data`; open and focused rows are excluded because their cells hold widgets, not text.

**Precondition P-MONO, and it is load-bearing.** The correlator emits only *strictly increasing* subsequences of `{machine}fields` order. It is therefore correct only while

> **P-MONO** — the machine's rendered column order is a monotone subsequence of its `{machine}fields` order.

P-MONO holds on the probed form: the 43 rendered columns map to strictly increasing field indices (0/1, 3, 5, 6, 7, 8, 9, 11/12, …, 76/77). It is believed structural — NetSuite appears to generate the field list and the column layout from the same form column list — but that is **one form's evidence and it cannot be verified from the DOM**, because verifying it would require the mapping the correlator is trying to produce.

Violating P-MONO does **not** degrade gracefully. Measured against the live payload, re-deriving the axis from a permuted rendering is *never* right:

| Rendering perturbation | correct | declines | **mis-keys** |
|---|---|---|---|
| all 903 pairwise column transpositions | 0 (0 %) | 619 (69 %) | **284 (31 %)** |
| all 1 806 single-column moves — the M4 gesture | 0 (0 %) | 1 002 (55 %) | **804 (45 %)** |

A mis-key is silent: `readColumnIds` returns 43 plausible, unique, well-formed internal ids that are attached to the wrong columns, so widths and hidden sets land on the wrong fields and are persisted that way. This is the one failure mode in the whole design that is not fail-closed, so it is closed by construction instead:

**Axis pinning — the derivation is native-order-only, derived once, and never re-derived under our own permutation.**

1. **Derive only from a native-order DOM.** The runtime attempts derivation only when it has applied no column order. Immediately after any repaint the machine regenerates in native order (H5), which is exactly when re-derivation is safe.
2. **Pin it.** The derived axis is held in runtime module state for the mounted machine and survives repaints, which DOM stamps do not.
3. **Refuse to re-derive while permuted.** While a non-native order is applied, the pinned axis is reused verbatim and `readColumnIds` is not called. Because the table above shows re-derivation under permutation is *never* correct, refusing it costs nothing and removes the entire mis-key class our own feature could cause.
4. **Change-detect, never swap — and the refusal is latched.** A fresh derivation on a native DOM that differs from the pin means the machine's own layout changed underneath us (a form switch, a role change, a different record shape). The pin is cleared, a **sticky mismatch latch** is set, and the feature declines. The latch is essential rather than decorative: installs are repaint-driven and arrive milliseconds apart, so *clearing the pin alone would let the very next install re-pin the new axis* — the silent swap this rule exists to forbid, reintroduced through the back door. The latch is consulted before anything else in the derivation path and is cleared **only** by teardown.
5. **Teardown clears all three** — the pin, the applied-order state and the mismatch latch. It is the only thing that may clear the latch, so a feature that has seen its axis change stays declined for the life of the mount.

The residual — a *custom form* whose native layout order is not machine order — is undetectable and is recorded as **U6**.

**Worked evidence — the first 12 visible columns of SO `16342809`** (produced by the shipped algorithm from the payload, not by hand; the full 43 follow):

| vis | header label | `itemfields` index | derived column id | affinity | row-1 cell | row-1 raw value | value corroborates |
|---|---|---|---|---|---|---|---|
| 0 | Item | 0/1 | `item` (twin of `item_display`) | 4 | `"MCH376"` | `"MCH376"` | yes |
| 1 | Committed | 3 | `quantitycommitted` | 3 | `"0"` | `"0"` | yes |
| 2 | Fulfilled | 5 | `quantityfulfilled` | 3 | `"0"` | `"0"` | yes |
| 3 | Invoiced | 6 | `quantitybilled` | 0 | `"0"` | `"0"` | yes |
| 4 | Back Ordered | 7 | `quantitybackordered` | 3 | `""` | `""` | n/a (empty cell) |
| 5 | Available | 8 | `quantityavailable` | 3 | `"82"` | `"82"` | yes |
| 6 | Quantity | 9 | `quantity` | 4 | `"1"` | `"1"` | yes |
| 7 | Units | 11/12 | `units` (twin of `units_display`) | 4 | `"Ea"` | `"Ea"` | yes |
| 8 | Description | 15 | `description` | 4 | `"Magic Makeup Blender with Hard Case"` | same | yes |
| 9 | Price Level | 16/17 | `price` (twin of `price_display`) | 3 | `"Custom"` | `"Custom"` | yes |
| 10 | RRP | 19 | `custcol_rrp` | 4 | `""` | `""` | n/a (empty cell) |
| 11 | Unit Price | 20 | `rate` | 0 | `"14.545"` | `"14.545"` | yes |

Three of these twelve are decided by evidence that neither signal supplies alone, which is exactly why the score combines them:

- **visible 2 and 3** — `quantitypickpackship` (index 4) sits between `quantitycommitted` and `quantityfulfilled` and holds `"0"` on every line, so values cannot exclude it. `labelAffinity("Fulfilled", "quantityfulfilled") = 3` against `0` for `quantitypickpackship` settles visible 2, and monotonicity then forces visible 3 onto `quantitybilled` — whose affinity to "Invoiced" is **0**. The right answer is reached with no label evidence at all for that column.
- **visible 6** — `"1"` also matches `olditemcount` (index 10), `unitconversionrate`, `initquantity`, `origquantity` and three more. `labelAffinity("Quantity", "quantity") = 4` wins outright.
- **visible 11** — `labelAffinity("Unit Price", "rate") = 0`; `rate` is selected purely by value corroboration (`"14.545"`) inside the gap monotonicity leaves between `custcol_rrp` and `amount`.

Full derived axis, visible index 0 → 42: `item, quantitycommitted, quantityfulfilled, quantitybilled, quantitybackordered, quantityavailable, quantity, units, description, price, custcol_rrp, rate, amount, taxcode, taxrate1, class, commitmentfirm, orderpriority, grossamt, tax1amt, quantityallocated, orderallocationstrategy, requesteddate, expectedshipdate, inventorydetail, isclosed, options, createpo, excludefromraterequest, custcol_online_oversell, costestimatetype, costestimate, allocationalert, dayslate, custcol_item_shipper_qty, custcol_item_origin, custcol_salesorder_tun_qty, custcol_custom_original_quantity, custcol_hs_code, custcol_anx_order_line, custcolsd_closure_reason, custcol_anx_mco_line_id, custcol_mcol_mystery_original`.

All 43 match the labels-and-machine-order ground truth, the optimum is unique, and the ids are distinct.

**Fail-closed gates.** `readColumnIds(table)` returns `[]` — and the runtime declines to install, exactly as it does today — on any of:

| Gate | Condition |
|---|---|
| Labels unreadable | header row missing, fewer than 2 visible header cells, or **any** empty label (live census: 43 labels, 0 empty) |
| Hidden input missing | no `form` ancestor, or no `{machine}fields` / `{machine}data` input |
| Field list malformed | fewer than 2 or more than 400 ids, any id failing `normalizeColumnId`, or **any duplicate id** |
| Data ragged | any `{machine}data` line whose value count differs from `fieldIds.length` |
| Too few candidates | fewer candidate columns than labels after twin, option-list and mirror reduction |
| Width out of range | fewer than 2 or more than `MAX_COLUMN_IDS = 100` labels |
| **Correlation ambiguous** | more than one maximum-score alignment — measured, not estimated |
| Output invalid | fewer ids than labels, any id failing `normalizeColumnId`, or duplicate ids |
| **Axis changed under the pin** | a fresh native-DOM derivation differs from the pinned axis — pin cleared, sticky mismatch latch set, decline for the life of the mount; never a silent swap on the next repaint |
| Any throw | caught; `[]` |

One condition is deliberately **not** a gate on `readColumnIds` but a rule on its *caller*: **P-MONO cannot be checked, so it is never tested — it is guaranteed.** While a non-native order is applied the runtime does not call `readColumnIds` at all; it reuses the pinned axis. A caller that re-derives mid-permutation is a defect, not a degraded mode.

Measured behaviour of the ambiguity gate against the live payload — obtained by instrumenting `correlateColumnIds` to return `paths[0][0]` (the optimal-alignment count it normally discards) instead of applying the `!== 1` gate, over the full 43 labels and 140 candidates:

| Input | optimal alignments | outcome |
|---|---|---|
| live labels + both sampled rows | **1** | mounts |
| live labels, no sampled rows | 56 | declines |
| labels replaced by opaque strings (`Colonne 0…42`), rows sampled | **11 218 446 198 960** (1.12 × 10^13) | declines |
| opaque labels, no sampled rows | ≈ 2.3 × 10^36 | declines |

The opaque-label rows simulate an unrecognised locale: every affinity collapses to 0 and only the value corroboration remains, which is nowhere near enough to single out one alignment. The feature therefore fails closed on a non-English form rather than guessing, and **requires at least one closed, numbered data line**: an Edit Mode sales order with no existing lines declines to mount. Both are accepted limitations, disclosed here.

**Frozen contract.** `readColumnIds(table)` keeps its signature and its `[]`-on-failure contract. The contract grows from **37 names to 50** by exactly thirteen additions, and no others: constants `FIELD_DELIMITER`, `LINE_DELIMITER`, `OPTION_DELIMITER`, `HEADER_LABEL_SELECTOR`, `MAX_MACHINE_FIELDS`, `MAX_SAMPLE_ROWS`; functions `parseMachineFieldData`, `readMachineFieldData`, `collapseDisplayTwins`, `readHeaderLabels`, `readSampleRowTexts`, `labelAffinity`, `correlateColumnIds`. The axis pin and the applied-order state live in `runtime.js` module scope and are **not** exported.

**Header label node — unverified structure, tolerated either way.** The only live evidence is that header cells carry text and no ids (`probe-transcripts.md:19`); whether the text sits in a `div.listheader` wrapper was **not probed**. `readHeaderLabels` therefore reads `cell.querySelector(HEADER_LABEL_SELECTOR) ?? cell`, so a wrapper and bare text both work, and `HEADER_LABEL_SELECTOR` is an optimisation rather than a requirement. The M1.5 live pass records which shape the machine actually uses.

**Storage impact: none.** Column ids remain bare internal field ids (`item`, `quantity`, `custcol_rrp`) — the same values `columnIdFromSpanId("item_quantity1_fs", "item", 1)` already produces. The container, `STORAGE_KEY`, `STORAGE_SCHEMA_VERSION`, scope-key shape and the six-part doctrine of §5 are **unchanged**. §5's sentence "keyed by the internal column id decoded from `span[id="{machine}_{columnid}{line}_fs"]`" is amended to "keyed by the internal column id read from the machine's `{machine}fields` input"; every other word of §5 stands.

**`columnIdFromSpanId` is retained and extended, not replaced.** It gains acceptance of the line-less ids the open line materialises (`item_item_fs` → `item`) when the caller passes `line === null`; the numbered decode is byte-identical, so `columnIdFromSpanId("item_quantity21_fs", "item", 2) === null` still holds. It is no longer the axis source; it remains the per-cell resolver M2+ needs to map a materialised widget back to a column.

### A1.3 Predicate redefinitions

| Predicate | Was | Is |
|---|---|---|
| `isLineOpen()` (`src/edit-grid/runtime.js:93-103`) | any `FOCUSED_ROW_SELECTOR` match **or** any `tr.machineButtonRow, tr.uir-machine-button-row` | **only** a focused row that also carries a numbered `{machine}_row_{n}` id. The button-row clause is deleted outright: that row is permanently attached under the entry row. |
| `isDataRow(row, columnIds)` (`src/edit-grid/core.js:295-304`) | `DATA_ROW_SELECTOR` and not header and not excluded and aligns-to-header | the same **and** a numbered row id (`/_row_[1-9][0-9]*$/`), which is what excludes the id-less permanent entry row. |
| `EXCLUDED_ROW_SELECTOR` | the 8-name union | the same union **plus `tr.uir-machine-row-last`**, observed live and absent from both halves of the M1 union. |

**Consequence of the `isLineOpen` change, carried to M2/M3:** an in-progress **new** line typed into the permanent entry row is no longer "open", so a queued apply may run while the user is typing there. M1.5 applies nothing, so nothing is at risk now; M2 and M3 must decide whether entry-row dirtiness deserves its own guard before either wires the first apply. Recorded as a known gap, not closed.

### A1.4 Fail-closed inventory addition (§7)

| Condition | Behaviour |
|---|---|
| `{machine}fields` / `{machine}data` absent, malformed, ragged, or carrying duplicate field ids | `readColumnIds` returns `[]`; `installEditGrid` returns false. Nothing injected, nothing styled, nothing stored. |
| Header labels unreadable, or any label empty | As above. |
| Correlation optimum not unique (unrecognised locale, no data lines, unfamiliar machine) | As above — **the feature declines rather than guessing an axis**. |
| A non-native column order is currently applied | `readColumnIds` is **not called**. The pinned axis is reused verbatim. Re-deriving here is never correct (A1.2) and would mis-key silently. |
| Fresh native-DOM derivation differs from the pinned axis | Pin cleared, mismatch latch set, `installEditGrid` returns false, nothing applied — and every later install in this mount declines too, because installs are repaint-driven and an unlatched refusal would simply re-pin the new axis on the next one. The stored entry is keyed to the old axis, so adopting the new one silently would relabel the user's saved layout. Cleared only by teardown. |
| P-MONO violated by the form itself (custom layout order ≠ machine field order) | **Undetectable.** Mis-keys silently. Not mitigated in M1.5; recorded as U6 and gating any generalization beyond Sales Orders. |

§7's row "Unrecognized DOM: no `#item_splits`, no header row, header count 0, **no `_fs` spans**, or duplicate/undecodable column ids" is amended: `no _fs spans` is replaced by `no decodable {machine}fields input, unreadable header labels, or an ambiguous correlation`.

### A1.5 H1 correction

H1's **premise is not manifest on this form**: header and data rows are symmetric at 43/43 visible cells, and the probe found no hidden system `<td>` at all on this record (`probe-transcripts.md:12`). The stop-condition the M1 brief expected never triggered.

H1's **conclusion still stands** — `src/edit-grid/` reimplements every row predicate and imports nothing from `so-columns` — but it now rests on the storage- and behaviour-isolation arguments, not on the arithmetic. The safety-by-accident reading is void.

**Consequence, and it is the load-bearing one: the H3 route gate is the sole mode barrier.** Because the cell counts are symmetric, `so-columns`' `row.cells.length === headerCount` predicates would *match* rows in Edit Mode rather than matching zero — a View Mode feature that ever reached an Edit Mode page would act on it, keying by header label and visible index against a machine that regenerates from a model. Nothing downstream of the route gate would catch it. Therefore:

- the route rule's mutual exclusivity (`hasParam(context, "e")` against `!hasParam(context, "e")`) is a **safety-critical** invariant, not a tidiness one, and `tests/routes.test.mjs`'s negative assertions at `:273-274` and `:312-313` are a load-bearing regression net;
- the fixture's H3 assertion stays **at the route gate**, as §9 already requires — the DOM-level complement it was going to stand in for does not exist;
- the four `FOREIGN_NODE_SELECTOR` exclusions (§4.4) remain a second line of defence and must not be pruned as redundant.

H1's citation of the headers-only-CSV defect (`save/CHECKPOINTS.md:1094`, `src/csv-export/core.js:268`) is a View Mode observation and is **not** re-litigated here; this correction is scoped to the Edit Mode Sales Order form probed.

### A1.6 Feature-status table — amended rows (§8)

These three rows replace their §8 counterparts. Every other row is unchanged.

| Feature | Verdict | Change and evidence |
|---|---|---|
| **Drag-and-drop column reorder** | **Blocked pending M1.5 identity + Gate A′.** Was "Conditional — Gate A". | Gate A's verdict of record is **REFRAME** (checkpoint `:1258-1266`): the repaint is neither id-addressed nor index-addressed but **model-driven regeneration — it replaces, never patches**. The permutation was destroyed on line-**open**, before any commit; after the commit every value sat under its correct header in native order and the adjacent line's API value was untouched. **Corruption is not manifest**, so owner decision Q3 — whose trigger was index-addressing — **does not fire**, and reorder is *not* closed. No substitute is authorized or built. **Gate A′ is defined here**, and it is defined around the axis pin (A1.2) rather than around re-derivation, because re-deriving from a permuted rendering is never correct: (1) mount on a native DOM and **pin** the axis; (2) apply a stored non-native column order; (3) open and commit a line so the machine regenerates the whole `<tbody>` in native order; (4) confirm the runtime re-applies the stored order using the **pinned** axis and did **not** re-derive while permuted; (5) read every visible cell against the pinned mapping; and (6) read the model back through `nlapiGetLineItemValue` for the committed line and one adjacent line. Gate A′ passes only if every value sits under its pinned column id **and** no value moved columns in the model. It explicitly does **not** require re-derivation to work mid-permutation — that is designed out, not tested. Gate A′ runs on the locked record with no save, under the full live protocol restated in the M1.5 plan. M4 remains blocked until it passes. |
| **Excel-style sorting / filtering (M6/M7)** | Verdict unchanged — **hard precondition cleared**. | Probe 6b: `draggableTable false`, `orderedContainer false`, `movableCells 0` — the machine is **not** natively drag-ordered, so the U4 refusal will not fire on this form. `isOrderedMachine` stays an **unconditional** guard regardless (§7). Probe 12: 9 rendered rows, `nlapiGetLineItemCount('item') = 9`, **no pagination on this record** — the page-scope disclosure required by Q4 therefore ships **untested**, and must be re-checked on a record with more than one page before M6 is called complete. |
| **Hide / show columns (M3)** | Verdict unchanged — **one mechanism replaced**. | Probe 11: the required Quantity column was hidden across 12 rows and the line still committed cleanly, value preserved, zero alerts — the safety claim holds live. But widgets materialise **per cell on click**, so a hidden cell's widget never materialises and §6's `focusin` force-reveal rule 1 is **unimplementable as written**. M3's reveal must be **chip/menu-driven**; rule 2 (reveal-all on validation failure) is unaffected. Probe 11 also re-confirmed H5: the injected hide classes were **gone** after the commit repaint. |

### A1.7 Open risks — updates to §12

- **U1 — resolved.** The hidden `{machine}fields` / `{machine}data` inputs are the authority for identity, and they are reachable from the content-script world. `machine.dataManager`, `buildtable()` and `postBuildTableListeners` exist but are MAIN-world and remain a **non-goal** (§2), not a fallback.
- **U2 — superseded** by the Gate A REFRAME verdict, and re-opened as **Gate A′** (A1.6).
- **U3 — answered.** `data-machine-name` **is** present, so `src/styles/netsuite.css:1616` is not dead code. No `src/edit-grid/` selector depends on it; that constraint stands.
- **U4 — answered negative for this form** (probe 6b); the unconditional refusal is retained.
- **New — U6: P-MONO portability, and it is the highest carried risk in this design.** The correlator is correct only under **P-MONO** — rendered column order is a monotone subsequence of `{machine}fields` order (A1.2). It holds on the one probed form, and NetSuite appears to generate both orders from the same form column list, but **that is one form's evidence and P-MONO cannot be checked from the DOM**. Our own violation of it (M4 permuting columns) is closed by construction through axis pinning. A *form's* violation is not: a custom Sales Order form whose sublist layout order differs from its field order would mis-key silently — 43 well-formed, unique, wrong ids — and persist that. Consequences, all binding: no generalization beyond the probed Sales Order form ships without re-verifying P-MONO on the target form; any future work that reorders columns must go through the pin, never through re-derivation; and M4 cannot ship without Gate A′, which exists partly to prove the pin holds.
- **New — U7: correlation portability (benign half).** On an unrecognised locale, a machine with no rendered lines, or a paged machine whose rendered row numbering does not index `{machine}data`, the ambiguity gate declines. That is safe but silent: the first symptom of an unsupported form is "nothing appears". A user-visible diagnostic is deliberately **not** added in M1.5.

---

## Amendment 2 — width applies during an open line (2026-08-03)

Status: binding. Amends **§6:122** and **§7:145** only. Nothing else in §6 or §7 changes,
and nothing shipped is reverted. Source of authority: **adjudication #16**, taken on the
M2 Task 12 measurement below and an independent review of the apply's mechanics.

### A2.1 What the queue-while-open rule assumed, and what is true

§6:122 and §7:145 name **width** alongside hide/show and filter as queued while a line is
open, on the reasoning that an apply landing mid-edit yanks the table under the user. For
width that reasoning inverts, because of a fact about the mechanism that was not known
when §6 was written:

**`table-layout: fixed` is set on the `<table>`, and the `<table>` survives the machine's
`<tbody>` regeneration; the header cells' inline widths do not.** Between a repaint and
the next apply the machine is therefore laid out as *fixed with no column widths*, which
the browser resolves by distributing the available width **equally**. Measured on
`tests/fixtures/sales-order-edit.html` (2026-08-03, Task 12): opening a line collapsed all
twelve columns from `203/109/80/84/130/89/147/51/325/94/50/82` px to **120 px each**, and
they stayed collapsed for as long as the line stayed open. Skipping the apply *is* the
yank; re-applying the same pixels is invisible.

### A2.2 The amended rules

**§6:122 is replaced by:**

- **hide/show and filter changes are queued** and flushed on removal of the focused-row
  state; **width applies are exempt and run while a line is open** (A2.1, adjudication #16).

**§7:145 is replaced by:**

| Condition | Behaviour |
|---|---|
| A line is open — hide/show or filter requested | Queued; flushed when the line closes; identity re-derived before the flush. |
| A line is open — width apply | **Applied, not queued.** Header-row `style.width` only; no row is moved, revealed, hidden or re-parented, and no widget is touched. Identity is the pinned axis, re-derived per install as always. |

Everything else in §7 is unchanged. In particular **reorder and sort are still refused
outright** while a line is open, and the open row and any dirty row remain force-revealed
and exempt from every hide/filter/move set.

### A2.3 Why the exemption is safe, not merely convenient

- **Style-only, header-row-only.** A width apply writes `style.width` on the visible
  header cells and `style.tableLayout` on the table. It does not add, remove, move,
  reveal or hide a row or a cell, and it never touches a materialised widget — so it
  cannot disturb the caret, the selection, or an uncommitted value.
- **No focus movement**, so the open line cannot be closed or committed by it.
- **No observer feedback.** The lifecycle registration observes `childList` only, so the
  attribute writes an apply performs cannot schedule another install.
- **Scoped to widths by construction.** The exemption is implemented as a call to
  `applyCurrentWidths`, *not* `applyAll`; `pendingApply` still latches, so M3's hide/show
  and M6's filter sets inherit the queue unchanged when they are built.

### A2.4 What M3 and later inherit

M3, M6 and M7 read the amended text: **width is the only exempt set.** A later milestone
that wants a second exemption needs its own amendment and its own measurement — the
grounds here are specific to a freeze whose absence is itself a visible layout change, and
they do not generalise to a set that moves or removes rows.

---

## Amendment 3 — DOM-read laundering, gesture seeding and harness fidelity (2026-08-03)

Status: binding. **Adds** one invariant that M3, M4 and every later gesture inherit (A3.2) and
records three findings the M2 live pass and its storage-level re-probe produced. It **reverts
nothing shipped** and **amends no earlier rule** — A1.2's pinning rules, A1.4's fail-closed
inventory and Amendment 2's width exemption all stand exactly as written (A3.5). One earlier
*claim* is struck as false, and that is the whole of A3.1.

Source of authority: the M2 Task 13 verdict of record and its correction
(`.superpowers/sdd/2026-08-02-edit-mode-table-enhancements/progress.md:106`), the M2 re-probe
verdict — in which the interpreter read the owner's own `chrome.storage` LevelDB off disk and
recovered every write of `suiteMateV3EditColumns` in order (`progress.md:169-175`), the D2
storage-level verification (`:176`), the View Mode attribution entries (`:177-178`) and the
uncontrolled-variable by-catch (`:179`). Code state: the fixes are shipped at `051c5ae`, the
tree is `b43f6ec`, 290/290 with 28 screenshot baselines at 0.000 % (`progress.md:163`).

### A3.1 The DOM-read laundering hazard — the corrected D1 blast-radius account

The Task 13 verdict closed D1's blast radius with this syllogism: `saveWidths` is the one
write site, `columnWidths` has exactly four assignment sites, **none of them the floor**,
therefore an inflated width can never reach storage and every inflated value is a render
artifact (`progress.md:106`). Every clause of it is **true**. The conclusion is **false**.

Both halves of the enumeration still check out against the shipped file: `columnWidths` is
assigned at `src/edit-grid/runtime.js:382` (the drag), `:734` (the guarded reseed) and `:766`
and `:779` (teardown), over its `:57` initializer, and the only writer is `saveWidths`
(`:470`, called from `:395`). The floor is assigned to none of them. What the enumeration
never asked is **where the value assigned at `:382` comes from**, and the answer is the DOM:

| Link | Code | What moves |
|---|---|---|
| 1 | pre-fix `core.applyWidths` clamped every column against a live-measured widget floor | an inflated width is written to `cell.style.width` — the render artifact |
| 2 | `runtime.js:338`, seeded at `:343` | `handleResizeDown` parses **that same `cell.style.width`** into `startWidth` |
| 3 | `runtime.js:382` | `handleResizeMove` writes `startWidth + delta` into `columnWidths` — assignment site #1 of the four, carrying a value the apply path authored |
| 4 | `runtime.js:395` → `:470` | `handleResizeUp` persists it. One gesture, one write, and the drift is now in `chrome.storage.sync` |

The gesture never had to be a real resize: a near-zero delta is enough, because the *starting
point* is already the inflated value. Storage forensics confirmed it happened — writes 4-7 of
`suiteMateV3EditColumns` carry `quantitycommitted: 111 → 174`, `units: 213` and
`description: 103`, the **exact D1 drift figures, on columns nobody chose to resize**
(`progress.md:172`; the live D1 walk was Committed 72 → 111 → 174 and Units 75 → 213, neither
ever dragged, commit `051c5ae`). The most likely gestures are the near-zero-delta 5px-edge and
field-help probes. Storage was polluted for real and was cleaned by hand; the scope key is
`companyId:userId:salesord:edit` — per user per **record type**, not per record — so a
polluted layout applied to every sales order that user edited (`progress.md:173`).

**Named hazard — DOM-read laundering.** Any value the feature's apply path puts into the DOM
can be carried into storage by a later gesture that takes that DOM state as its starting
point. The persisted variable's assignment sites are clean at every step; the *provenance* of
the assigned value is the leak.

> **The general lesson, and it is the binding half of this subsection: enumerating the
> assignment sites of a persisted variable does not bound what can reach storage. You must
> also ask, transitively, where each assigned value comes from — and a value read back out of
> the feature's own rendering has the feature's own output as its source.**

**The read at `:338` is still there, byte-identical to its pre-fix form, and it is now safe —
for a reason that must not be mistaken for the read being harmless.** It is safe because
`core.applyWidths` now clamps to the static bounds only (`src/edit-grid/core.js:853`, `:895`)
and the apply is a pure function of the plan it is handed, so `cell.style.width` *is* the
feature's model, faithfully rendered. Reading it back is reading the model. Anything that
re-admits a value the apply path derives rather than reproduces — an apply-time floor above
all — re-arms this path in full, which is why `applyWidths`' now-unread `minimums` slot is
pinned provably inert (`tests/edit-grid.test.mjs:1191`, adjudication #17) and why re-admitting
a floor through it requires a fresh adjudication.

The `getBoundingClientRect().width` fallback on the same line (`:343`) is the *other* kind of
read and is the model for A3.2's carve-out: it fires only when the feature has written no
inline width on that cell, so the value it takes is NetSuite's native layout — a number the
feature could not have authored. It was exercised live: the re-probe's write arithmetic checks
against native starts (60 + 50 = 110, 57 + 45 = 102), which is that branch running
(`progress.md:176`).

### A3.2 Gesture seeding — binding on M3, M4 and every gesture after them

> **A gesture handler takes its starting value from the feature's own model — the plan,
> the stored entry, or the pinned axis — and never re-reads it from the DOM the feature
> itself rendered.**

**Carve-out, deliberately narrow.** A DOM read is permitted as a *seed* only when the quantity
read is one **the feature has never written on that node** — a native width, a native order,
NetSuite's own state — and then only as a fallback below the model. It must be justified
in-code at the read, and the justification must answer the authorship question explicitly:
*could this feature have written this value?* The existing note at `runtime.js:336-337` is the
right shape and is **not** sufficient on its own — it justifies preferring the style width on
rendering-accuracy grounds (collapsed borders render ~2px over the style value and re-measuring
rects accumulates it) and never asks who wrote that style value. That gap is exactly how D1's
output reached storage.

**Procedural requirement: every new gesture handler states in-code which model it seeds
from.** A handler whose seed cannot be named against a model is a defect at review, not a
style note.

| Gesture | Bound to seed from | Forbidden seed, and why |
|---|---|---|
| **M3 hide/show** | the stored hidden set and runtime module state | **rendered** visibility — `getComputedStyle(cell).display`, an offset/rect test, or anything downstream of our own class-based hide rules (`.suitemate-v3-edit-grid-col-hidden`, `src/edit-grid/edit-grid.css:10-12`, and `.suitemate-v3-edit-grid-row-filtered`, `:14-16`, both `display: none !important`). Computed display *is* our output, so a reveal seeded from it is A3.1's shape exactly. See the carve-out note below: the **inline** read is a different thing and must stay that way. |
| **M4 reorder** | the **pinned axis** (A1.2 rule 3, `:317`) and the applied-order module state | DOM column order or header position after we have permuted it. This already had one sufficient reason — re-derivation under permutation is *never* correct, measured: 0 of 903 transpositions and 0 of 1 806 single-column moves come back right (`:306-309`). A3.1 supplies a **second, independent** one: position read out of a rendering we permuted is our own output re-entering our input, and a mis-key laundered this way persists silently. Two independent reasons, one rule — the pin. |
| **any future gesture** | its own persisted state | any quantity the feature writes to the DOM and could read back |

**The carve-out, already implemented correctly in-source, and M3 must not break it.**
`visibleCells` reads **inline** `cell.style.display` (`src/edit-grid/core.js:531-534`) and is
right to: inline `display:none` is how *NetSuite* hides its own system cells — the same property
`src/internal-ids/runtime.js:171` filters on — while **SuiteMate hides columns with a class**, so
a SuiteMate-hidden column stays on the axis. The comment at `:532-533` says exactly that. This is
the A3.2 carve-out done properly: the read takes a property this feature never writes on that
node, and the code states why. **Binding consequence for M3: it hides by class only.** The moment
M3 writes an inline `display` on a machine cell it collapses the one property that distinguishes
NetSuite's hiding from ours, and `visibleCells` — which computes the axis every install — begins
laundering our own output into **column identity**, which is strictly worse than laundering a
width.

Already ledgered and restated here because it binds the same handlers: `pendingWrites` is
incremented only by the width writer and read only by the reseed guard (`runtime.js:733`), so
a second writer that does not increment at its **own** enqueue reintroduces D2 for its field.
Cheapest closure when M3's writer arrives is folding the counter into `enqueueSave` itself
(`progress.md:120`, `:132`).

### A3.3 Test-harness fidelity — a stub that flattens a feedback quantity is blindness

**The suite was 282/282 green with both defects live** (`progress.md:104`). It was not thin —
it was blind in one specific place: **D1 was structurally unobservable**, for two separable
reasons, and both are now closed. (D2's harness gap is deliberately not claimed here as a third:
the call-time storage snapshot added alongside these was reported as what makes D2 staleness
modellable and that claim was **false** — reverting it leaves the whole suite green. It is a
fidelity improvement, not a pin, `progress.md:154`.)

| Blindness | Then | Now |
|---|---|---|
| **The floor was flattened.** `columnMinimums` returned all zeros in the sliced apply harness and no test machine carried a materialised widget at all, so no floor existed anywhere in the model and there was nothing for the apply path to widen. | `eea4c25:tests/edit-grid.test.mjs:2813` — `columnMinimums: (target, ids) => Object.fromEntries(ids.map((id) => [id, 0]))` | the stub answers a real floor and records every call (`tests/edit-grid.test.mjs:3409-3416`), and `createMachine` takes a `widgets` map so machines carry real widget widths (`:258-271`) |
| **The feedback path was cut.** `createCell`'s rect was a constant independent of `style.width`, so no edit-grid test could model a rect that follows what an apply wrote — the loop D1 walked around was unrepresentable. | `eea4c25:tests/edit-grid.test.mjs:68` — `getBoundingClientRect: () => ({ width })` | `rectDelta` threads through `createCell` (`:65-82`) and `layoutCells` installs one **live** getter (`:145-148`); 0 = border-box, 2 = this repo's measured collapsed-border figure, 11 = the View Mode observation |

> **Standing requirement: any harness stub that flattens a quantity the production code derives
> from its own output is a blindness, not a simplification.** A measurement stub must model the
> feedback path — the rect follows the style, the floor answers a real value — or a test that
> exercises the loop proves nothing about the loop.

**Stated precisely, because this subsection is about false confidence and must not manufacture
any.** In the replacement stub the *number* is documentation, not detection: changing 400 to 0
changes nothing, and what actually catches a re-measuring apply is the call recording asserted
at `tests/edit-grid.test.mjs:3434-3435` (`progress.md:154`, which corrects an earlier
overclaim). The requirement is therefore two-part: the stub must model the feedback path **and
a test must assert against it**. A faithful stub nothing asserts on is a better-documented
blindness.

**The fixture analogue.** Before `051c5ae` all twelve fixture columns were wider than their own
widgets, so the width round trip was **green by geometry luck** — no column could ever be
raised by its widget, so the raise-and-walk was unreachable in the fixture as well as in the
unit harness. The Units `<select>` is now deliberately wider than the column that holds it
(`tests/fixtures/sales-order-edit.html:294-306`). **The same class recurred once more inside
the fix itself**: the residual flat `createCell` rect above was diagnosed and fixed in the
`so-columns` stub first (`createMeasuredTable` in `tests/so-columns.test.mjs`, whose predecessor
returned a flat `{width: 80}`) and left flat in our own until review caught it
(`progress.md:155`, `:138`).

**The sharpest form of the finding, and the reason the requirement is standing rather than
advisory:** an existing assertion *asserted D1 as correct*. "A floor measured on a redistributed
table is honoured while it stands" pinned `style.width === "200px"`; post-fix the same
assertion reads `60px` (`progress.md:111`, `:119`). A harness blind to a loop will not merely
miss the defect — it will let the defect be written down as the contract.

### A3.4 Uncontrolled variables in a live width baseline

`showInternalIds` was **ON for the entire failing M2 session** (write sequence 863 → 878) and
**OFF for the passing re-probe** (`progress.md:179`). `decorateMachineColumns`
(`src/internal-ids/runtime.js:167-181`) selects `.uir-machine-headerrow > td` at `:169` and
appends a badge into each at `:174-178` — the exact header cells `src/edit-grid` measures,
freezes and sizes. The two runs therefore did **not** execute against the same header-row DOM.

**Neither verdict is disturbed, and the reason is specific rather than reassuring.** D1 and D2
are code-level and storage-proven, and `columnMinimums` measures `input, select, textarea` only
(`src/edit-grid/core.js:746`), so a badge `<span>` can never enter a column floor. What the
uncontrolled variable *does* cost is comparability: a pass and a fail measured under different
header-row DOM cannot be set against each other on width evidence alone.

> **Requirement: every live width baseline pins and records the state of every toggle that
> injects into the machine header row, and any pass/fail comparison across sessions states
> whether that state matched.** Today the known injector is `showInternalIds`
> (`src/internal-ids/runtime.js:167-181`); the rule is written against the header row, not
> against that one feature, so a future injector inherits it without another amendment.

**Correction to the record.** The transcript's owed-item list carried "internal-id badges
(toggle off)" as unexercised through the M2 pass (`progress.md:107`, `:115`). That is **wrong**:
badges were ON for the whole of it, so the Tier-4 badges item was **partly exercised, though
unobserved** — exercised in the sense that edit-grid ran against a badged header row throughout
and produced no badge-attributable failure, unobserved in the sense that nobody was watching for
one. It is owed as a *deliberate* observation, not as first contact.

### A3.5 What is not amended

- **A1.2's axis-pinning rules are unchanged** (`:313-319`). A3.2 adds a second independent
  reason for rule 3 and changes none of the five rules, the latch, or Gate A′.
- **Amendment 2's width exemption is unchanged** (`:444-502`). Width remains the only set exempt
  from the queue-while-open rule; A2.4 still governs any second exemption.
- **A1.4's fail-closed inventory is unchanged** (`:396-407`). No gate is added, relaxed or removed.
- **Storage-key isolation is unchanged.** `STORAGE_KEY = "suiteMateV3EditColumns"` against View
  Mode's `suiteMateV3ColumnOrder`, asserted in both directions with each half shown non-vacuous
  (`tests/edit-grid.test.mjs:1299-1321`) and at the width-writing layer (`:1324`).
- **`suiteMateV3ColumnOrder` remains unreachable from `src/edit-grid`** — 0 occurrences in the
  directory, and the no-leak ruling is now **positively re-proven by the forensics rather than
  only by construction**: View's `Item: 200` was written at log offset 497863, *before* Edit's
  `item → 200` at 501384, so the View value it superficially resembles cannot be downstream of
  it (`progress.md:174`). Attribution of those two View writes to a human at the browser is
  **positively supported, not proof** (`progress.md:178`): the log carries no wall clock, so the
  support is ordering and content — `suiteMateV3Style` toggle flips at seq 861-863, which only a
  human clicking the extension popup produces, then an Edit write at 864, then the two View
  writes at 865-866 adjacent with zero intervening records. That places a person at the browser
  in that window and makes one short burst the likeliest source; it does not prove authorship,
  and the owner is still to confirm before anything is cleared.
- **No NetSuite record data was ever at risk, at any point in this.** Both defects were confined
  to the personalization layer: D1 to inline header widths and, through A3.1's laundering path,
  to the `suiteMateV3EditColumns` entry; D2 to stored widths in that same entry. Nothing wrote a
  record field, and the polluted entry has been cleaned.
- **Struck, and it is the only thing this amendment strikes:** the Task 13 verdict's claim that
  "D1 never reaches storage; inflated values are render artifacts" (`progress.md:106`). It was
  false. The corrected mechanism is the `startWidth` read-back of A3.1, storage was polluted for
  real, and D2's live proof came from a different scenario than the one first run — the first
  attempt put a full reload between the two gestures, which defuses the race and would have
  passed pre-fix too (`progress.md:171`).
