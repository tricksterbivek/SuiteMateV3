# SuiteMate v3 — View Mode Table Enhancement Architecture

**Research report (read-only survey) — 2026-08-02**
Supports planning for `docs/BUILD-BRIEF-edit-mode.md` (Edit Mode table enhancements, Sales Orders only).

Repo: `/Users/Bivek.Shah/Documents/suitemate/suitematev3` @ `main`, v3.21.1.
All line references are from the working tree as read on 2026-08-02.
Produced by direct source reading plus three parallel Opus 5 research agents (docs survey, test/build survey, git forensics on the parked branch).

---

## 0. Orientation — two things to know before anything else

**0.1 "Table enhancements" is ONE module, not several.** Everything the build brief lists (drag-reorder, hide/show, resize, personalization, sort, filter) lives in exactly two files: `src/so-columns/core.js` + `src/so-columns/runtime.js`. There is no separate resize module, no separate sort module. A second, adjacent feature — **Personal Form Views** (`src/form-views/`) — does *body-field* hide/show and section collapse; it is not a table feature but it is the closest architectural sibling and the newest code, so it is the best template to copy.

**0.2 `design.md` is a trap.** It is **not** an architecture document. It is a Meta.com commerce design-language token spec (colors, Optimistic VF typography, spacing, radii, `button-buy-cta`-style components). `grep -cE "bridge|runtime|content script|manifest|IIFE" design.md` → **0**. It landed as an owner-supplied UI direction (`save/CHECKPOINTS.md:1019-1029`, tag `checkpoint-pre-ui-enhancement-2026-07-28`) and the UI experiment built on it was **rolled back** (`save/CHECKPOINTS.md:1036-1044`). The file remains at the repo root as dead reference only.

The real doctrine lives in:

| What you need | Where it actually is |
|---|---|
| Architectural layer model | `README.md:27-51` ("Source boundary") |
| Module conventions / IIFE style | `docs/superpowers/plans/2026-07-28-persisted-sort-filter.md:9`; enforced by `manifest.json`, `tests/verify.mjs:23-100`, `tests/so-columns.test.mjs:648` |
| Milestone / checkpoint / versioning convention | `save/CHECKPOINTS.md` (preamble at `:3`) |
| Project rules / parked work | `CLAUDE.md` |
| The live task | `docs/BUILD-BRIEF-edit-mode.md` |

---

## 1. Module inventory for table enhancements

| Path | Lines | Role |
|---|---|---|
| `src/so-columns/core.js` | 770 | **Pure logic + DOM-thin helpers.** Storage schema v3 (normalize/validate/writers), order planning, cell-label reading, sort comparators + `sortRows`, filter parsing/matching/`applyFilters`, `applyHidden`, `applyWidths`, `captureNativeOrder`, `applyOrder`. No `document.`, no `chrome.`, no network — enforced by test (§5.2). |
| `src/so-columns/runtime.js` | 1165 | **The entire UI and wiring.** Scope-key resolution, control bar (Personalize / Done / Reset / view-chip / hidden-chips), HTML5 drag-and-drop reorder, per-header ▼ menu (Excel-style sort + checkbox value filter + operator queries), pointer-based edge resize, all five storage savers, lifecycle registration, settings reaction. |
| `src/so-columns/so-columns.css` | 412 | Presentation hooks. Load-bearing rules: `.suitemate-v3-so-columns-col-hidden{display:none}` (`:24`), `.suitemate-v3-so-columns-filtered{display:none}` (`:402`), resize-edge cursor (`:37`), personalizing ghost `display:table-cell;opacity:.35` (`:48`). |
| `src/shared/routes.js` | 405 | Capability gate `TRANSACTION_COLUMN_PERSONALIZATION` (`:282-288`) — **this is where Edit Mode is excluded**. |
| `src/shared/lifecycle.js` | 712 | Shared MutationObserver + watcher / generation / abort machinery every feature attaches through. |
| `src/shared/settings.js` | 401 | `suiteMateV3Style` schema v5; the `salesOrderColumns` opt-in flag. |
| `src/popup/popup.html:59-65`, `src/popup/popup.js:19,414,423,442` | — | The "Enable Transaction Column Personalization" toggle. Its subtitle literally reads *"Drag to reorder Sales Order item columns in view mode"*. |

**Adjacent (newest template, not a table feature):** `src/form-views/core.js` (260) + `src/form-views/runtime.js` (508) + `src/form-views/form-views.css` — Personal Form Views, Milestone 24, Sales Orders only.

**Read-only consumers of the table's state:**

- `src/csv-export/core.js:210-274` `readViewSnapshot()` — exports the grid *as personalized*.
- `src/csv-export/main-world.js:517-553` `runViewExport()` — contains an **explicit Edit Mode refusal** (§3.2).
- `src/internal-ids/runtime.js:167-181` `decorateMachineColumns()` — injects badges *into the same header cells*, in **both** modes.

---

## 2. Attachment mechanism — the actual runtime layer model

### 2.1 The privilege layers

`README.md:27-51` describes five privilege tiers. Table enhancements use only the lowest.

| Layer | Where it runs | Files | Powers |
|---|---|---|---|
| **Content script (isolated world)** | NetSuite page, isolated JS world | all `src/*/runtime.js`, `src/*/core.js` | DOM read/write, `chrome.storage`, `chrome.runtime` messaging. **No** page-JS access, **no** `fetch` to NetSuite RPCs. |
| **Bridge (protocol)** | isolated world ↔ service worker | `src/shared/bridge.js` (1315) | Versioned envelope, closed `COMMANDS` allowlist, typed payload + response validators, exact route and top-frame sender checks, bounded timeouts. |
| **Service worker (broker)** | extension background | `src/background/service-worker.js` | The only holder of the `scripting` privilege. Validates sender, then dispatches to the adapter or to MAIN-world injection. |
| **MAIN world (page JS)** | NetSuite page's own JS realm | `src/csv-export/main-world.js`, `src/netsuite/data-adapter.js` | Injected **on demand** via `chrome.scripting.executeScript({world:"MAIN"})` (`service-worker.js:127-146`), never via the manifest. Can call `nlapi*` / `N/record`. |
| **Permission broker** | extension pages only | `src/shared/permissions.js` | Optional Chrome capabilities. **Never injected into NetSuite pages** — asserted at `tests/verify.mjs:63-67`. |

Key constraints, quoted:

- `README.md:33` — *"Content scripts cannot supply arbitrary URLs, request methods, headers, RPC methods, AMD modules or request bodies."*
- `README.md:45` — *"The adapter executes only in the authorized top-frame document, verifies the exact account origin and route again in NetSuite's main world, blocks redirects and cross-account responses, enforces response-size and operation limits, and normalizes failures into typed errors."*
- `README.md:35` — the UI command registry stays decoupled: *"...without coupling UI commands to the privileged NetSuite transport protocol."*
- `README.md:41` — *"The pure core has no DOM, Chrome or network dependency... Browser adapters receive their capabilities explicitly... They do not request permissions, make network requests, render arbitrary HTML or use the broad Chrome downloads API."*
- `README.md:49` — the SuiteQL query bridge is *"an undocumented NetSuite interface... Release Preview testing is required before each NetSuite release."*

**Consequence for Edit Mode:** `so-columns` uses **none** of the upper layers. `so-columns/runtime.js:4-7` imports `SoColumnsCore`, `Lifecycle`, `Routes`, `Settings` — no `bridgeApi`. An Edit Mode grid feature can therefore also be pure isolated-world DOM work, **unless** it needs NetSuite's sublist model (`nlapiGetLineItemValue`, the `machine()` API), which would require a new bridge command + MAIN-world handler + service-worker allowlist entry + four validators. Note `tests/verify.mjs:69-76` forbids declaring MAIN-world injection in the manifest.

### 2.2 Content-script entry and ordering

One `document_start`, `all_frames: true` content script on `https://*.netsuite.com/*` (`manifest.json:32-77`) injecting 20 JS files in a strictly asserted order: **shared → every `core.js` → every `runtime.js`**. `tests/verify.mjs:30-63` asserts both the `css` (10 entries) and `js` (20 entries) arrays **byte-for-byte with `deepEqual`**. Adding an Edit Mode module means editing `manifest.json` and `tests/verify.mjs` in lockstep.

### 2.3 Module style — IIFE + frozen global

```js
(function defineSuiteMateV3XCore(globalScope) {
  "use strict";
  const VERSION = 1;
  if (globalScope.SuiteMateV3XCore?.VERSION === VERSION) return;   // idempotent re-injection guard
  // ...
  Object.defineProperty(globalScope, "SuiteMateV3XCore", {
    value: Object.freeze({ /* exports */ }),
    configurable: false, enumerable: true, writable: false
  });
})(globalThis);
```

Runtimes are `(function initializeSuiteMateV3X(){ ... })()` that **bail early** if any dependency or capability is missing (`so-columns/runtime.js:4-33`). No ES modules in extension source — ESM only in `tests/*.mjs` and `scripts/*.mjs`.

### 2.4 Attachment sequence (`so-columns/runtime.js`)

1. **Top-frame check** — `window === window.top` inside `try/catch`, returning on cross-origin throw (`:20-25`).
2. **Capability gate** — `routeApi.createPageContext(location, {isTopFrame, trustedContentScript:true})` then `supports(TRANSACTION_COLUMN_PERSONALIZATION, ctx)`; hard `return` if false (`:27-33`).
3. **Lifecycle registration** (`:1105-1117`):
   ```js
   lifecycleApi.register({
     id: "record.so-columns",
     replace: true,
     capability: routeApi.CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION,
     startPaused: true,
     observe: { childList: true, subtree: true },
     relevant: containsRelevantMutation,
     evaluate: installSoColumns,
     cleanup: removeSoColumns
   });
   ```
4. **Settings gate** — `applySettings()` (`:1119-1127`) calls `handle.resume()` or `handle.pause() + removeSoColumns()`. Live-reactive through `chrome.storage.onChanged` (`:1144-1156`) with a `settingsRevision` counter that discards stale async loads.
5. **`installSoColumns({signal, isCurrent})`** (`:993-1064`) — the idempotent install, in this order:
   `whenDomReady()` → find `#item_splits` → bail if fewer than 2 header labels → **exit personalize if the previous table is detached** (`:1007-1010`) → `captureNativeOrder` → `resolveScopeKey` → `ensureControls` → attach resize listeners **once**, guarded by the `data-suitemate-v3-so-columns-sortable` attribute (`:1014-1018`) → `ensureHeaderMenus` → `await chrome.storage.sync.get` → **re-check `signal.aborted || !isCurrent() || !table.isConnected`** (`:1021-1023`) → apply order → hidden → widths → sort → filters → render chips.
6. **`removeSoColumns()`** (`:1066-1092`) — must be **synchronous** (lifecycle throws on an async cleanup, `lifecycle.js:479-481`). Restores native order, clears widths/hidden/filters, removes listeners and the `SORTABLE_ATTRIBUTE`, and deletes every `[data-suitemate-v3-so-columns]` node.

### 2.5 The shared MutationObserver (`src/shared/lifecycle.js`)

- **One** `MutationObserver` on `document.documentElement` for the whole extension. Options are the union of all active watchers (`createObserverOptions:83-101`), hashed into an `observerSignature`, and only re-`observe()`d when the signature changes; `takeRecords()` is drained before every disconnect so nothing is lost across a reconfigure (`rebuildSharedObserver:137-173`).
- Records are batched into a **microtask** flush (`handleMutations:398-408` → `flushMutationRecords:370-396`), filtered per watcher by `matchesObserveOptions`, then by the watcher's own `relevant()` predicate.
- **Generation counters + AbortController** prevent cross-generation races. `watcher.generation` increments on activate/invalidate (`:205`, `:265`); `evaluate()` receives `{signal, isCurrent()}` and every async continuation must re-check both. Re-entrancy: if evaluate is already running for the current generation, `scheduleWatcher` sets `rerun = true` rather than stacking calls (`:314-320`).
- `mode:"continuous"` (the default) re-runs `evaluate` on every relevant mutation — **this is the re-attach-after-rebuild mechanism**. It re-runs `installSoColumns`, which is written to be idempotent.
- Route changes: `popstate` / `hashchange` / `pageshow` listeners plus an href-drift check inside `handleMutations` (`:399-401`) call `scheduleRouteRefresh` → `refreshRoute` → `resetWatcher` for every watcher (cleanup, then reactivate if the capability still holds).
- `pagehide`: `persisted` → `suspendAll`; otherwise `disposeAll` (`:692-698`).
- Module-replacement singleton: `lifecycle.js:4-10` — a different `VERSION` triggers the old instance's `disposeAll("module-replaced")` first, so re-injection cannot leave two registries observing.
- Live diagnostics: `document.documentElement.dataset.suitemateV3Lifecycle` (watcher count) and `.suitemateV3Observer` (`active`/`idle`) — attach state readable from DevTools without instrumentation (`:103-111`).

### 2.6 Relevance filter — the anti-feedback-loop pattern

```js
// so-columns/runtime.js:1094-1103
function nodeContainsRelevantTable(node) {
  if (node?.nodeType !== 1 || node.matches?.(OWNED_SELECTOR) || node.closest?.(OWNED_SELECTOR)) return false;
  return node.matches?.(RELEVANT_SELECTOR) || Boolean(node.querySelector?.(RELEVANT_SELECTOR));
}
```

`OWNED_SELECTOR = '[data-suitemate-v3-so-columns]'`. **Every SuiteMate-injected node carries its feature's `data-` attribute so the observer ignores its own writes.** `form-views` additionally excludes `[data-suitemate-v3-internal-id]` (`:431-442`). This is mandatory — Milestone 24c recorded a real bug where a missing `observe` block meant late-rendered content was never picked up (§7.2).

### 2.7 DOM selectors used — the complete list

```
TABLE_SELECTOR        = "#item_splits"                            runtime.js:35
CONTAINER_SELECTOR    = ".uir-machine-table-container"            runtime.js:36
HEADER_ROW_SELECTOR   = "tr.uir-machine-headerrow"                core.js:15
DATA_ROW_SELECTOR     = "tr.uir-machine-row, tr.uir-list-row-tr"  core.js:23
DATA_ROW_CLASSES      = ["uir-machine-row", "uir-list-row-tr"]    core.js:22
FOREIGN_NODE_SELECTOR = "[data-suitemate-v3-internal-id], [data-suitemate-v3-so-columns], [data-suitemate-v3-form-views]"
                                                                  core.js:24
label host inside a header cell: ".listheader"                    runtime.js:466
scope identity: 'script[src^="/javascript/sessionstatus/session_status_init.jsp?"]'
                                                                  runtime.js:69-71
```

`#item_splits` is hard-coded and singular — the module manages exactly one sublist.

### 2.8 How each feature is actually implemented

- **Reorder** — HTML5 drag-and-drop (`dragstart`/`dragover`/`dragleave`/`drop`/`dragend` on the table, `:876-880`), active only while `personalizing`. `applyOrder()` (`core.js:686-722`) computes a permutation from labels then **physically `row.appendChild(cells[i])` for every row**. Real DOM cell movement, not CSS `order`. Columns with duplicate labels are non-movable (`isMovable:97-99`).
- **Hide/show** — `applyHidden()` (`core.js:370-389`) toggles `col-hidden` on the Nth cell of every row whose `cells.length === headerCount`. CSS `display:none`.
- **Resize** — pointer-based. Hover within 5 px of a header cell's right edge (`resizeEdgeCell:582-594`) → `pointerdown` starts a drag with document-level capture listeners (`:659-660`) → `applyWidths()` (`core.js:325-368`) **freezes every visible column's width and flips `table.style.tableLayout = "fixed"`**, sizing the table to the sum.
- **Sort** — `sortRows()` (`core.js:495-561`) physically re-inserts `<tr>` elements. It stamps `data-suitemate-v3-native-row` on first touch so native order can be restored, and **fails closed if data rows are non-contiguous** (`:506-510`). Type detection is heuristic (number / date / text at a 60 % threshold); dates parse **day-first** (documented `ponytail:` at `:471-473`).
- **Filter** — `applyFilters()` (`core.js:613-636`) toggles `.suitemate-v3-so-columns-filtered` (`display:none`) on data rows. The menu offers a distinct-value checkbox list (cap 200) or a contains / `> < >= <= =` query when cardinality is too high.
- **Menus** — appended to `document.body` and `position:fixed`, deliberately escaping the machine container's clipping and paint order (`:403-404`).

---

## 3. Mode detection and the explicit Edit Mode guards

### 3.1 There is no general "mode" abstraction — mode is the `e` query parameter

```
view:  /app/accounting/transactions/salesord.nl?id=16342809
edit:  /app/accounting/transactions/salesord.nl?id=16342809&e=T
```

### 3.2 The three explicit exclusions

**1 — `TRANSACTION_COLUMN_PERSONALIZATION`, `src/shared/routes.js:282-288`**

```js
case CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION:
  return context.isTopFrame
    && Boolean(context.path)
    && context.path.startsWith(PATHS.TRANSACTIONS)   // "/app/accounting/transactions/"
    && context.path.endsWith(".nl")
    && hasParam(context, "id")
    && !hasParam(context, "e");                      // <- EDIT MODE EXCLUDED
```

**2 — `FORM_VIEWS`, `src/shared/routes.js:289-295`**

```js
case CAPABILITIES.FORM_VIEWS:
  // Sales Orders only for the MVP; generalize by widening this rule.
  return context.isTopFrame
    && Boolean(context.path)
    && context.path.toLowerCase() === PATHS.SALES_ORDER
    && hasParam(context, "id")
    && !hasParam(context, "e");                      // <- EDIT MODE EXCLUDED
```

**3 — Export view, `src/csv-export/main-world.js:517-525`** (a runtime refusal, not a route gate)

```js
if (params.has("e")) {
  // Edit-mode machines render input widgets whose text does not match the
  // screen; the view snapshot is only truthful in view mode.
  const error = new Error("Export view is available in view mode only.");
  error.code = "VIEW_EXPORT_EDIT_MODE";
  throw error;
}
```

This third guard was **retrofitted after adversarial review** (`save/CHECKPOINTS.md:1094`): *"`?e=` pages rendered input machinery as junk or a headers-only CSV **under a success toast**."* Two lessons:

- **In Edit Mode, `textContent` reads return nothing useful** — cells contain `<input>` / `<select>` widgets. Any Edit Mode sort, filter, or label matching must read `input.value` / `select.selectedOptions`.
- **The route gate alone was not sufficient.** The main-world handler needed an independent mode check. Defense in depth is the established precedent.

Documented in-repo statements that the feature set is view-mode-only: `save/CHECKPOINTS.md:662` (Milestone 1, *"in view mode only"*), `:681`, `:687-688` (Milestone 2 route negatives and a browser pass proving *"edit-mode and entity-page fail-closed"*), `docs/superpowers/specs/2026-07-30-personal-form-views-design.md:19` (lists **edit-mode** among MVP exclusions), `docs/superpowers/specs/2026-07-28-export-view-csv-design.md:40` (*"View-mode only."*), `docs/superpowers/plans/2026-07-28-persisted-sort-filter.md:19`.

### 3.3 Test coverage of the exclusion

`tests/routes.test.mjs:274-276` and `:313` explicitly assert that `?e=T` and `?e=F` **disable** both capabilities. Those negatives must survive byte-identical — they are the cleanest available proof that View Mode is untouched.

### 3.4 Consequence for the new feature

The guard is evaluated both at injection (`runtime.js:31`) **and** on every lifecycle route refresh (`isCapabilitySupported`, `lifecycle.js:56-59`). An Edit Mode module therefore needs its **own new capability** (e.g. `TRANSACTION_COLUMN_PERSONALIZATION_EDIT`) that **requires** `hasParam(context, "e")`. The two capabilities are then mutually exclusive by construction — the strongest possible separation, and it satisfies "no View Mode module may be modified" except for the purely additive `routes.js` switch case.

---

## 4. Persistence

### 4.1 Three separate `chrome.storage.sync` items

| Key | Owner | Schema | Container |
|---|---|---|---|
| `suiteMateV3Style` | `src/shared/settings.js:8-9` | **5** | feature toggles + role themes |
| `suiteMateV3ColumnOrder` | `src/so-columns/core.js:5-6` | **3** | `{schemaVersion, orders:{[scope]: entry}}` |
| `suiteMateV3FormViews` | `src/form-views/core.js:5,12` | **2** | `{schemaVersion, views:{[scope]: entry}}` |

### 4.2 `suiteMateV3ColumnOrder` entry shape — the table's entire state

```jsonc
{ "schemaVersion": 3,
  "orders": {
    "6998262:2462:salesord": {
      "order":   ["Item", "Quantity", "Rate"],           // labels, <=100 entries, <=200 chars each
      "hidden":  ["Location"],
      "widths":  { "Item": 180 },                        // clamped 30..1000 px
      "sort":    { "label": "Amount", "dir": "asc" },    // dir in {asc, desc}
      "filters": { "Item": { "anyOf": ["A"], "q": "text" } }  // <=8 columns, <=50 values, q <=100 chars
    }
  }
}
```

Everything is keyed **by visible column label**, never by index or field id. `planOrder()` (`core.js:392-420`) tolerates added, removed and renamed columns; labels appearing more than once are skipped entirely. `textAsRowFilter` is deliberately **not stored** — it is re-derived at apply time from live column cardinality (`runtime.js:1049-1052`).

### 4.3 Scope key — per company : per user : per record type

`so-columns/runtime.js:66-86` parses `script[src^="/javascript/sessionstatus/session_status_init.jsp?"]`, taking the `companyId` param and segment 2 of the `id` param (`COMPANY~USER~ROLE~FLAG`), producing `` `${companyId}:${userId}:${type}` `` where `type` is the `.nl` filename (`salesord`). Fallback: `` `${location.hostname}:${type}` ``. **Preferences follow the user across roles; each transaction type keeps its own layout.** `form-views` uses the same shape but hard-codes `:salesord` (`:63`). Not per-form.

**Open decision for the Edit Mode plan:** share `…:salesord` (one layout across both modes) or namespace it (`…:salesord:edit`). Sharing risks View-Mode-only labels that do not exist in Edit Mode; namespacing means users personalize twice. It is one string either way.

### 4.4 The storage doctrine ("full house doctrine", `save/CHECKPOINTS.md:1142`)

Every store implements the same six things. Copy them verbatim.

1. **Fail-closed normalizers** returning `null` on any violation (`normalizeLabels`, `normalizeWidths`, `normalizeSort`, `normalizeFilters`).
2. **Prototype-pollution rejection** — `["__proto__","constructor","prototype"]` filtered from every key (`core.js:53, 78, 111`).
3. **Newer-schema refusal** — `refusesNewerSchema()` (`core.js:177-183`) so an older build never overwrites a newer sync from another machine. Mirrors `settings.js assertStoredVersionIsWritable` (`:82-94`).
4. **Quota guard** — `MAX_SYNC_ITEM_BYTES = 7800`, `evictOverQuota()` keeps only the entry being written (`core.js:185-193`). Chrome hard-fails at 8192 and a silent partial write corrupts.
5. **Empty-entry deletion** — `entryIsEmpty()` (`core.js:129-131`) deletes the scope rather than storing `{}`.
6. **Serialized writes** — one promise queue, `saveQueue = saveQueue.then(op, op)` (`runtime.js:503-507`). The double-argument `.then` means a rejected predecessor still runs the next op. Milestone 20 found back-to-back read-modify-write pairs clobbering each other; **all five savers now share one queue**. Query-text saves debounce 800 ms (`:573-580`) for the sync write-rate throttle.

### 4.5 The schema-2 form-views story (why v3.21.1 exists)

`src/form-views/core.js:6-12` is the primary source:

> `STORAGE_SCHEMA_VERSION = 2` — *"2, not 1: the deferred layout builder (feature/form-layout-builder) wrote schema-2 containers into live storage; refusing them would silently stop hidden fields from applying and block saves."*

What happened (`save/CHECKPOINTS.md:1191-1213`), in sequence:

1. The parked layout builder shipped to the owner's real account and wrote `schemaVersion: 2` entries containing `fieldOrder` / `sectionOrder`.
2. `42ad514` reverted `main` byte-identical to the v3.21.0 tree (verified `git diff 58b139d --quiet`) via a **forward revert — no history rewrite**.
3. The restored v1 `normalizeStored` rejects any container with `schemaVersion > STORAGE_SCHEMA_VERSION`, so it **refused the owner's own live storage**: hidden fields silently stopped applying, every save was blocked.
4. `d08854f` fixed it with **exactly one behavioral constant** (`1 → 2`) plus a five-line comment and a `ponytail:` debt marker. It works because `normalizeEntry` (`:96-109`) keeps only the keys this build understands — a schema-2 entry reads through with `hiddenFields` intact and order keys dropped; writes stay on container 2.
5. Accepted cost, documented: a save from v3.21.1 **drops branch-only order keys for the touched scope**.
6. `dbda986` added a LevelDB forensics addendum: the owner had been driving the builder themselves after the live pass, and **their own two Resets** — not the rollback — cleared their earlier hidden fields.
7. The rollback verification's own hide/unhide write then hit the ceiling from (5) and dropped the owner's final experiment. It was recovered verbatim from the storage log and pasted into `CHECKPOINTS.md:1211-1213` for whenever the branch resumes.

**Transferable lesson:** *a feature that bumps a shared persisted schema version cannot be reverted by code revert alone — live storage is a one-way door.* Either gate the version bump behind the feature flag, or plan the revert as **code revert + forward-compatible reader**. Prefer adding fields inside an existing entry (as sort/filter did, v2 → v3) over a new container, and keep `normalizeEntry` tolerant of unknown keys.

A throwaway artifact from that incident still sits on `main`: `tests/tmp-probe-fieldorder-wipe.mjs` (not in the test chain).

---

## 5. Coding standards, conventions, tests

### 5.1 Module conventions

- **Vanilla JS IIFEs, `Object.freeze` exports on `globalThis`** (`docs/superpowers/plans/2026-07-28-persisted-sort-filter.md:9`). No ES modules, no bundler for content scripts. React was evaluated and rejected twice (`save/CHECKPOINTS.md:786`, `:935`).
- **Strict `core.js` / `runtime.js` split.** `core` is pure and DOM-thin, unit-testable in a `node:vm` sandbox; `runtime` owns DOM, `chrome.*`, lifecycle and UI.
- **`VERSION` + idempotent re-definition guard** at the top of every core.
- **Namespacing:** globals `SuiteMateV3<Feature>Core`; CSS classes `suitemate-v3-<feature>-*`; DOM ownership attribute `data-suitemate-v3-<feature>`; lifecycle ids `record.so-columns`, `record.form-views`, `developer.internal-ids`, `record.csv-utils-toolbar`.
- **No `innerHTML` anywhere** — `createElement` + `textContent` only. `verify.mjs` greps for it in several modules (`:275, 280, 441, 549, 699`).
- **`try/catch` returning `false`/`null`** around every DOM operation. Failures are silent and fail-closed; nothing throws into the page. User-visible problems go through `SuiteMateV3Notifications.showToast(msg, {type})`.
- **`!important` on hide classes** — the "display-defeats-hidden" defect class, sighted three times (M11 buttons `:858`, M17 menu labels `:972`, M24a form fields `:1143`). NetSuite CSS otherwise wins.
- **Never touch NetSuite-owned positioning or display.** `save/CHECKPOINTS.md:826` (a sticky-header regression removed all header-cell positioning from `so-columns.css`); `:842` — the "strut lesson": inline children placed directly in a 16 px header cell inflate the line box ~5 px, so injected nodes mount **inside** `.listheader`.
- **`ponytail:` comments** mark deliberate shortcuts with a named upgrade path (`core.js:188, 471, 507`; `form-views/core.js:10`).
- **Cross-feature coexistence rule:** any feature reading text from a shared node must clone-strip the other features' injected nodes via `FOREIGN_NODE_SELECTOR`. All four lists (`so-columns`, `form-views`, `csv-export`, `tab-title`) must stay in sync (`save/CHECKPOINTS.md:1159`).
- **Cross-core imports are forbidden** — each core is vm-sandboxed alone, so `planOrder`/`moveLabel` were **copied verbatim** into `form-views` rather than imported (commit `06d9cfe`).
- **Commits:** conventional prefixes (`feat: fix: docs: test: chore: refactor: revert:`), lowercase, imperative, no scopes. Author = signed-in git user. *"NEVER add Claude co-author trailers"* (plan `:18`).

### 5.2 The source-purity gate

`tests/so-columns.test.mjs:648-650`:

```js
test("core has no DOM, storage, bridge or network authority", () => {
  assert.doesNotMatch(source, /document\.|chrome\.|fetch\(|XMLHttpRequest|innerHTML|localStorage|sessionStorage/);
});
```

Plan `:17` — *"Source-purity rules in `tests/so-columns.test.mjs` ban certain substrings in core.js — run the suite after every core edit; keep core DOM-thin/pure."*

### 5.3 `npm test` — what it actually runs

`package.json:10` is one chained command:

1. `npm run build`
2. `node --check` on **every** source file (33 of them)
3. `node --test` on 16 `*.test.mjs` files
4. `node tests/verify.mjs`
5. `npm run fixtures:verify`

**Current totals: 205 top-level `test()` calls (~213 including subtests, matching `save/CHECKPOINTS.md:1203`), 28 baseline PNGs.**

Test-count trajectory: 150 (v3.14.0) → 190 (persisted sort/filter) → 193 (export view) → 197 (adversarial hardening) → 202 (smart tab titles) → 210 → 212 (form-views) → **213** (schema-2 compat). Baselines pinned at 28 throughout.

### 5.4 Unit testing — `node:vm` plus hand-rolled stubs

No jsdom, no Playwright, no DOM library.

```js
// tests/so-columns.test.mjs:11-16
function createApi() {
  const sandbox = { TextEncoder };
  sandbox.globalThis = sandbox;
  runInNewContext(source, sandbox);
  return sandbox.SuiteMateV3SoColumnsCore;
}
```

Only the globals a core legitimately needs are injected — that *is* the isolation test (`form-views.test.mjs:11-16` uses `{TextEncoder}`; `routes.test.mjs:11-16` uses `{URL, URLSearchParams}`; `tab-title.test.mjs:15-20` uses an empty sandbox).

DOM is duck-typed by hand. `createRow`/`createTable` (`:22-53`) give `{className, cells:[{textContent, getAttribute, setAttribute}], appendChild()}` where `appendChild` emulates live-NodeList move semantics, plus a `querySelector` that only understands the header-row selector. `createSortableTable` (`:440-498`) adds `style:{}`, `getBoundingClientRect: () => ({width: 80})`, a `Set`-backed `classList` with only `toggle`/`contains`/`remove`, and a shared fake `parentNode` implementing `insertBefore` against a plain array with a getter-defined `nextSibling`. **That stub is the API contract** — it is why core functions only ever touch `table.rows`, `row.cells`, `cell.classList`, `cell.style` and `getBoundingClientRect`.

`plain(v) = JSON.parse(JSON.stringify(v))` (`:18-20`) is used everywhere because cores return deep-frozen objects that `assert.deepEqual` will not match directly.

**`chrome.storage.sync` is never stubbed in the so-columns unit tests** — the core is storage-free by design and the source scan proves it. The browser-side stub `tests/fixtures/chrome-stub.js` switch-dispatches on storage key (`:208-216`), and its `set()` (`:217-251`) **bumps write counters onto `document.documentElement.dataset`** (`columnOrderWrites`, `formViewsWrites`, `storageWrites`) then synchronously fans out to `onChanged` listeners. Initial settings come from URL query params (`:9-17`), e.g. `?salesOrderColumns=true&formViews=true`.

**⚠️ `src/so-columns/runtime.js` has ZERO unit-test coverage.** All 31 tests target `core.js`. The runtime is validated only by `node --check`, manifest ordering, and manual fixture/live passes. The same will be true of an Edit Mode runtime — **push as much logic as possible into `core.js`, because that is the only part with an automated net.**

### 5.5 Baselines

Baselines are deterministic headless-Chrome PNG screenshots of local fixture pages, committed to git under `tests/fixtures/screenshots/{classic,redwood}/`. **28 PNGs** (26 classic, 2 redwood) at **1440 × 1000 @ DSF 1** (`route-catalog.js:274`). README `:76` and `SMOKE_TEST.md:196` still say 26 — stale; `tests/fixtures.test.mjs:101` asserts `entries.length === 28`.

`scripts/capture-fixtures.mjs` is fully hand-rolled: a local `http.createServer` with a path-traversal guard, headless Chrome (`--headless=new --disable-extensions --force-color-profile=srgb --hide-scrollbars`) driven over **raw CDP through a hand-written WebSocket client** (`class CdpClient:134-216`, no puppeteer), a **hand-written PNG decoder** (IHDR/IDAT parse, `inflateSync`, all five row filters including Paeth, `:306-359`) and differ.

- **Diff rule:** a pixel counts as changed when any RGB channel differs by **> 24**; the run fails when `changedRatio > 0.01` (1 %) — `:361-381`, `:433-435`.
- Before capture it injects a CSS kill-switch for all animation/transition/caret, scrolls to 0,0, awaits `document.fonts.ready`, runs the fixture's optional `beforeCapture`, sleeps 100 ms.
- `--update` overwrites baselines in place and prints sha256 digests; `--verify` (the default) compares in a scratch dir and treats a missing baseline as a hard error. Undocumented flags: `--list`, `--fixture=<id>`.
- Update rule (`README.md:78`, `SMOKE_TEST.md:200`): *"Review screenshot changes individually before running `npm run fixtures:update`. **Never refresh baselines merely to silence a failed comparison.**"*

**⚠️ CSS blast radius:** `netsuite-page`, `toast-notification` and `toast-loading` **all render the sales-order machine table** (`route-fixture.js:97-107`). An unconditional Edit Mode stylesheet rule that also matches View Mode markup moves three baselines. Scope every new selector under an Edit-Mode-only ownership attribute and this stays at 0.000 %.

Because so-columns and form-views are **default-off and `startPaused`**, they render nothing on fixture pages. An Edit Mode feature must be default-off the same way. Plan `:20`: *"this feature adds no visual change to any captured fixture page, so baselines must NOT move; any diff is a defect."*

### 5.6 `tests/verify.mjs` — the complete gate map

1908 lines, flat top-level `await`/`assert`, no test harness, first failure aborts.

| # | Category | Lines |
|---|---|---|
| 1 | Manifest identity — incl. **hard-coded `"3.21.1"`**, exact `permissions`, `optional_permissions` must be absent | 11-21 |
| 2 | **Global content-script ordering — exact `deepEqual` of the 10-entry `css` and 20-entry `js` arrays** | 30-63 |
| 3 | Negative injection: no `permissions.js` in page js; no MAIN-world manifest entry | 64-76 |
| 4 | SuiteQL + Import Assistant content-script exact arrays | 77-102 |
| 5 | Every manifest resource must `access()` on disk | 104-119 |
| 6 | Popup CSS width, script order, control IDs, forbidden legacy text | 125-154 |
| 7 | **Fixture link integrity — 12 named fixture HTML files, every `src`/`href` must resolve** | 156-184 |
| 8 | `extensionSources` (31 files) + forbidden-content scan: no `https?://` (one allow-listed SuiteSense URL), no `/SuiteAdvanced\|ExtPay\|payment\|license/i` | 186-233 |
| 9 | Permission-broker allowlist + `chrome.permissions.*` bypass scan | 235-271 |
| 10 | Layering purity greps on `utilities.js` / `browser-utilities.js` | 273-284 |
| 11 | Cores executed in VM sandboxes: routes, commands (`VERSION 2`), bridge (`VERSION 2`) | 286-351 |
| 12-16 | Per-module source contracts: theme, popup, internal-ids, SuiteQL studio, notifications, record-actions, CSV export | 353-704 |
| 17 | **`sales-order.html` DOM contract** — must keep `#main_form`, `#baserecordtype[value=salesorder]`, the Actions toolbar | 706-708 |
| 18 | Import Assistant + data adapter contracts | 710-757 |
| 19 | ~45 asserts on `v3-compat.css` / `radii.css` tokens | 759-930 |
| 20 | **Settings `SCHEMA_VERSION === 5`**, every `DEFAULTS` flag, literal `validateForStorage` output | 932-1003 |
| 21 | Material palette read from `dist/` + luminance ordering | 1005-1050 |
| 22 | SuiteQL core executed | 1052-1143 |
| 23 | Service worker bridge allowlist + main-world injection file list | 1145-1227 |
| 24 | **Full async simulation of the service worker against a mocked fetch — ~60 bridge round-trips** | 1228-1876 |
| 25 | Build artifacts must exist: `dist/suiteql-studio.js`, `dist/material-palette.js` | 1878-1880 |
| 26 | **15 sha256 hashes over V1 CSS sources — byte-for-byte immutability** | 1882-1904 |

Two nuances:

- **`extensionSources` is a scan list, not a strict allowlist.** A new file omitted from it is silently unscanned. It is already stale — `src/tab-title/*`, `src/form-views/*`, `src/csv-export/*`, `src/netsuite/data-adapter.js` are in the manifest but absent from it.
- **There is no central global-namespace registry.** Each core self-registers with `configurable:false, writable:false`; the only enforcement is your own `*.test.mjs` reading `sandbox.SuiteMateV3<Name>Core`.

### 5.7 Fixtures — and the absence of an Edit Mode one

`tests/fixtures/sales-order.html:118-126` is unambiguously VIEW mode:

```html
<section id="items" class="uir-machine-table-container">
  <table id="item_splits" class="uir-machine-table">
    <tbody>
      <tr class="uir-machine-headerrow"><td><div class="listheader">Item</div></td> ... x5</tr>
      <tr class="uir-machine-row"><td>SKU-1001</td><td>Sample product one</td><td>2</td><td>$18.00</td><td>$36.00</td></tr>
      <tr class="uir-machine-row"><td>SKU-2004</td><td>Sample product two</td><td>1</td><td>$24.00</td><td>$24.00</td></tr>
    </tbody>
  </table>
</section>
```

Data cells are bare `<td>` with plain text — **no `<input>`, no `<span class="inputreadonly">`, no line-number `<td>`, no summary row**. URL is `salesord.nl?id=1` with no `&e=T`; body fields render as `<span class="uir-field inputreadonly">`; header buttons are Edit / Fulfill.

Full fixture list:

| File | Mode / page |
|---|---|
| `sales-order.html` | Sales Order, Classic, **VIEW mode**. Full end-to-end harness — loads the real `so-columns/*`, `form-views/*`, `csv-export/*`, `csv-import.js`, `chrome-stub.js`. **Not a baseline** (absent from `route-catalog.js`). |
| `classic.html` | Generic Classic record, edit-ish styling probe (`Save`/`Cancel` buttons, editable inputs) but a plain `<table>` with no id — **styling-only, loads no so-columns script**, so capability never activates. |
| `redwood.html` | Redwood-skin record contract. Baseline `redwood/redwood-record.png`. |
| `route-classic.html` | The driver for all 26 Classic baselines; `?fixture=<id>` renders one of 15 layouts client-side. Its `machineTable()` emits a 4-column VIEW-mode `#item_splits`. |
| `saved-search-edit.html` | Saved Search **edit** page (`search.nl?id=5471&e=T&cu=T`) — a real `uir-machine-table` criteria machine. Closest thing to an edit-mode machine table, but not a transaction. |
| `saved-search-results.html` | Saved Search results list (`uir-list-*` rows). |
| `suiteql-classic.html` / `suiteql-redwood.html` / `suiteql-normal-search.html` | SuiteQL Console (both skins) + a negative fixture proving it does not mount on Global Search. |
| `import-assistant.html` | CSV Import Assistant. |
| `popup-role.html` / `theme-runtime.html` | Popup role-identity and theme harnesses. |

**There is no Edit Mode sales-order fixture anywhere.** Building one should be an explicit milestone-1 deliverable. **Keep it OUT of `route-catalog.js`** — then it needs no baseline PNG and no bump of `tests/fixtures.test.mjs:101`; it only needs adding to the `verify.mjs:156-184` link-integrity list. That is the low-friction path.

### 5.8 Versioning and checkpoints

- **A checkpoint** = a git commit plus an appended entry in `save/CHECKPOINTS.md` with a fixed shape:
  ```
  ## <Feature>: Milestone N
  Status: ... / Date: ... / Spec: docs/superpowers/specs/... · Plan: docs/superpowers/plans/...
  ### Included      (what changed, prose, with reasoning and any ponytail ceilings)
  ### Verification  (npm test count + "N baselines at 0.000 percent" + fixture round-trip + LIVE evidence with record ids)
  ```
  Release-era entries additionally carry a PR URL, a release URL, a `### Restore` block (`git switch --detach vX.Y.Z`) and a `### Next feature` line.
- **Governing rule** (`save/CHECKPOINTS.md:3`): *"New feature work must not begin until the preceding checkpoint has passed automated tests, live NetSuite verification, pull request review and release publication."* Echoed by `docs/V1_FEATURE_BACKLOG.md:65` (*"a rollback point before the next capability begins"*) and `docs/SMOKE_TEST.md:206`.
- **Version bumping:** the version stays frozen through every feature task; the bump is the final, **owner-gated** task (*"Do not proceed without an explicit yes"*). Three pins move together — `manifest.json`, `package.json`, `tests/verify.mjs` — in a dedicated `chore: prepare vX.Y.Z` commit that also appends the release entry. Then tag and `gh release create`.
- **Two schema-version namespaces** are explicitly disambiguated: the so-columns storage schema (v3) is distinct from the settings schema (v5).
- **Rollbacks are forward reverts, never history rewrites.** Precedents: `24d715a` (UI enhancement layer) and `42ad514` (layout builder). Restore proof is a checkpoint entry with `git diff <tag>` empty.
- Pre-experiment tags exist (`checkpoint-pre-ui-enhancement-2026-07-28`, `checkpoint-suiteql-stable-2026-07-14`, ...). Note **`v3.21.1` does not exist as a local tag** (`git tag -l` tops out at `v3.21.0`) though `CHECKPOINTS.md:1222` records it as tagged at `dbda986` and pushed — GitHub-only, or never created locally.
- **Spec docs** live at `docs/superpowers/specs/YYYY-MM-DD-<name>-design.md` with numbered sections ending in "Out of scope (YAGNI)". **Plans** at `docs/superpowers/plans/YYYY-MM-DD-<name>.md` with Global Constraints → File Structure → Task N (Files / Interfaces / Steps) → Self-review.

### 5.9 The four-tier verification ladder

1. **Unit (vm harness)** — normalizers, writers, caps, hostile input, migration, `refusesNewerSchema` against a future version; source-purity stays green.
2. **Fixture browser pass** — served fixture, real Chrome, real pointer/keyboard events. **Must assert at the computed-display / computed-pixel level.** Formally recorded methodology correction, `save/CHECKPOINTS.md:973`: *"prior checks read the `.hidden` property instead of computed display, passing while pixels never changed."*
3. **Live NetSuite pass** — production account 6998262. Canonical records: **SO 16302518**, **PO 16295656** (known-empty scope, the only one destructive cycles are allowed on), **Item Fulfillment 14953684** (covers the `uir-list-row-tr` row family). Plus a negative record proving the capability does not fire, a coexistence check with other features, and zero console errors. Rule: *"never touch the owner's real saved layouts."*
4. **Checkpoint entry** in `save/CHECKPOINTS.md` + commit + push.

`docs/SMOKE_TEST.md` is the manual counterpart — 14 named passes with an Exit gate at `:206` and a release-blocker rule at `:13`: *"Treat any blocked click, hidden control, shifted field, clipped menu, or broken scroll area as a release blocker."*

### 5.10 Build and reload loop

`scripts/build.mjs` (24 lines) builds exactly two esbuild bundles in parallel: `src/suiteql/studio-entry.js` → `dist/suiteql-studio.js`, and `src/palette/material-palette.js` → `dist/material-palette.js`. Options: `bundle`, `format:"iife"`, `platform:"browser"`, `target:["chrome120"]`, `minify`, no sourcemap.

**Everything else in `src/` ships raw** — all 20 content-script entries, the popup and the service worker load straight from `src/`. `dist/` is committed.

- **A plain `src/` change needs no rebuild.** Only touching `src/suiteql/**` or `src/palette/**` (or upgrading those deps) requires `npm run build`. (`npm test` runs the build anyway, and `verify.mjs:1005, 1878-1879` read `dist/`.)
- **There is no watch mode and no automation.** Manual cycle every iteration: edit `src/` → click **↻ on the SuiteMate V3 card** in `chrome://extensions` → **reload the NetSuite tab** (content scripts are `document_start`, so an extension reload alone does not re-inject into an open page) → if the service worker changed, let it restart. After dependency changes only: `npm install && npm run build`.

### 5.11 Checklist — what a new module must do to pass `npm test`

1. Split into `core.js` (pure) + `runtime.js` (impure).
2. Register on `globalThis` via the IIFE + `Object.defineProperty(..., {value: Object.freeze({...}), configurable:false, enumerable:true, writable:false})`. Freeze nested `CLASSES` too.
3. Add both files to `manifest.json` `content_scripts[0].js` — cores in the core block, runtimes in the runtime block.
4. Add the identical lines, in identical positions, to `tests/verify.mjs:42-63` (and `:30-41` for CSS).
5. Add `node --check` for each new file to the `test` script in `package.json`.
6. Write `tests/<mod>.test.mjs` using `runInNewContext` + hand-rolled stubs, and **append it to the `node --test` list** — a test file not listed never runs.
7. Include the source-purity test as the last case.
8. Assert a frozen versioned contract — `VERSION`, `STORAGE_KEY`, `STORAGE_SCHEMA_VERSION`, every selector/attribute/class constant.
9. Gate the runtime on `routeApi.supports(CAPABILITIES.X, pageContext)`; a new capability needs a constant in `routes.js` and positive/negative tests in `tests/routes.test.mjs`.
10. Never `new MutationObserver` — use `lifecycleApi.register` / `waitFor`.
11. A new opt-in setting: add to `DEFAULTS` (`settings.js:35-37`), `normalizeCurrent` (`:131-133`), a migration step (`:166-172`), bump `SCHEMA_VERSION`, then update `verify.mjs:939-965`, `tests/settings.test.mjs`, `tests/settings-transfer.test.mjs`, `tests/popup-settings-race.test-support.mjs`, and the popup HTML/JS.
12. Storage writes: respect the 7800-byte quota with eviction; expose pure `with*(stored, scopeKey, value)` reducers returning `null` on refusal; reject `__proto__`/`constructor`/`prototype`/`""` keys.
13. Add the storage key to `tests/fixtures/chrome-stub.js` if you want fixture-level exercise.
14. No remote URLs and no `payment|license|ExtPay|SuiteAdvanced` strings in anything added to `extensionSources`.
15. Never modify the 15 hashed V1 CSS files. New CSS = a module-owned file added to the manifest CSS array **and** `verify.mjs:30-41`.
16. Run `npm run fixtures:verify`; baselines must stay at 0.000 %.
17. Only if you add a catalog fixture: bump `tests/fixtures.test.mjs:101` and generate the PNG.

**The minimal-friction precedent is commit `b774797`** ("feat: smart tab titles"), which touched exactly: `manifest.json` (+2 js lines), `package.json` (2 × `node --check` + 1 test file), `tests/verify.mjs` (+2 order lines + settings bump), `src/tab-title/{core,runtime}.js`, `tests/tab-title.test.mjs`, plus popup HTML/JS + `settings.js` + 3 settings suites. **No fixture, no baseline, no `extensionSources` entry.**

---

## 6. Reuse surface

### 6.1 Safe to reuse as-is (zero modification)

| Asset | Why |
|---|---|
| `src/shared/lifecycle.js` | Multi-tenant by design — register a new watcher id with its own capability. No change needed. |
| `src/shared/settings.js` | Read-only via `settingsApi.get()` / `normalize()`. Adding a toggle is a separate, amber-listed change. |
| `src/shared/utilities.js`, `commands.js`, `bridge.js` | Untouched unless a bridge command becomes necessary. |
| `SuiteMateV3Notifications.showToast` | Straight reuse. |
| **Patterns (copy, do not import)** | Scope-key resolution from `session_status_init.jsp`; the six-part storage doctrine; the `saveQueue` serializer; `enterPersonalize`/`exitPersonalize` listener symmetry; actions-before-chips wrapped control bar (M22 lesson, `CHECKPOINTS:1110`); the `ensureX()` idempotent-install idiom. |

### 6.2 Shared files that must change — flag each explicitly in the plan

| File | Change | Risk |
|---|---|---|
| `manifest.json:53-74` | append new `core.js` + `runtime.js` (correct order) and `.css` | must mirror into `verify.mjs` |
| `tests/verify.mjs:30-63` | mirror the manifest arrays | none functional |
| `package.json:10` | add `node --check` + the new `*.test.mjs` | none |
| `src/shared/routes.js` | **additive** `CAPABILITIES` entry + new `case` requiring `hasParam(context,"e")` | Low. `tests/routes.test.mjs` and the frozen `CAPABILITY_VALUES` list need updating. **Do not modify the existing `TRANSACTION_COLUMN_PERSONALIZATION` case.** |
| `src/shared/settings.js` | new opt-in flag + migration `5(value){...schemaVersion:6...}` | **Highest ripple in the repo** — the v4→v5 bump touched settings, `settings-transfer.js` legacy key tables, popup, `verify.mjs` and four test suites. Give it its own task. |
| `src/popup/popup.html` + `popup.js` | new toggle row + 4 lines | low |
| `FOREIGN_NODE_SELECTOR` lists in `so-columns/core.js:24`, `form-views/core.js:21`, `csv-export/core.js:211`, `tab-title/core.js` | add `[data-suitemate-v3-<new>]` | **This edits View Mode files.** One additive token each, with a clear precedent (`CHECKPOINTS:1159`). Flag it in the plan and regression-test View Mode after. |

### 6.3 Do not modify — View-Mode-specific

- **`src/so-columns/runtime.js` — entirely.** Its assumptions are invalid in Edit Mode: `readCellLabel` reads `textContent` (empty or garbage over `<input>`s); `applyOrder` physically moves `<td>`s (would reorder NetSuite's positional line cells); `sortRows`/`applyFilters` reorder and `display:none` `<tr>`s (**line-index corruption risk on commit**); `applyWidths` sets `tableLayout:fixed` (fights NetSuite's own edit-grid width management).
- **`src/so-columns/so-columns.css`** — write a separate stylesheet. `.suitemate-v3-so-columns-col-hidden{display:none}` on an Edit Mode cell would very likely stop the input committing, which the brief forbids.
- **`src/csv-export/*`** — already refuses `?e=`; leave it refusing.
- **`src/internal-ids/*`** — but note it injects badges into `.uir-machine-headerrow > td` in **both** modes (no `e` guard on `INTERNAL_IDS`, `routes.js:271`). Coexistence testing with Internal IDs ON is mandatory.
- **`src/form-views/*`** — different feature, different DOM.

---

## 7. The parked layout builder — patterns only

`feature/form-layout-builder` holds the v3.22.0 state at `0a04764`. Per `CLAUDE.md` it **must not be continued, merged, or built on**. Nothing was checked out or modified during this research.

**Branch topology:** `0a04764` is an **ancestor of `main`** (built on main, then forward-reverted), so `git diff main...feature/form-layout-builder` is empty. The real diff is `git diff 58b139d...0a04764` — 11 files, +3231/−54, of which 1763 lines are two docs. It added **no new file under `src/`**; it grew inside `src/form-views/{core,runtime}.js` + `form-views.css` (622 / 911 / 183 lines at the tip). No new settings key, no new capability, no new content script.

> **Grep gotcha:** the branch's `core.js` contains two literal NUL bytes (line 433, a raw U+0000 where line 507 uses the escape). `grep` treats the blob as binary and returns nothing — use `grep -a` or pipe through `tr '\000' '@'`. Same for `save/CHECKPOINTS.md` and the branch plan doc, which quote that code.

### 7.1 ⭐ The observer self-trigger solution — the most transferable pattern

The builder had to move DOM nodes while a `childList/subtree` observer was watching. Its solution is **deterministic, with no timing flags**:

1. **Stamp exclusion.** Every node the feature can move carries `data-suitemate-v3-form-views-native-index`; `nodeRelevant()` rejects any record whose node has that attribute (`core.js:549-564`). Stamping is attribute-only and the observer watches `childList` only, so stamping itself emits no records.
2. **Identity early-return.** `applySectionOrder` / `applyFieldOrder` compare current against target and perform **zero `appendChild` when equal** (`core.js:433`, `:507`). Any record that slips through produces no writes, so the loop starves.

The design spec is explicit that the older `replayingCollapse` boolean **does not transfer**: *"it guards a synchronous click listener, and observer callbacks land after any such flag clears."* (`2026-07-31-form-layout-builder-design.md:211-220`)

**Naming constraint** (plan `:16`): the stamp attribute must **never equal** the ownership attribute, or the clone-strip in `cleanNodeText` would delete native nodes.

**The verification technique transfers too.** Phases C and D proved absence of a loop by asserting *"exactly ONE storage write, stable after 500 ms"* and *"toggle-on reapplied the stored order during install with ZERO writes"* using the chrome-stub write counter (`CHECKPOINTS:1237, 1251`). **Count storage writes, not DOM operations.**

### 7.2 Idempotent mount patterns

| Function | Idempotency key |
|---|---|
| `ensureControls()` | `controlButtons?.controls.isConnected` — a **liveness** check, not a null check; if NetSuite detached the toolbar it purges every owned node and rebuilds |
| `ensureAffordances()` / `ensureSectionGrips()` | per-element `querySelector('[...="hide-toggle"]')` → `continue` |
| `watchCollapses()` | `if (collapseListener) return;` — a stored function reference, so cleanup's `removeEventListener` uses the identical ref |
| `captureNativeSections/Fields()` | **first-touch** stamping — `slots.every(has attribute)` before stamping, so a re-run never re-baselines a user's reorder as "native" |

`removeFormViews()` is the exact mirror: restore native order → strip every stamp → remove classes → remove the stored listener → remove all owned nodes → null out state. Toggling the setting off leaves zero residue.

### 7.3 Drag-and-drop details

HTML5 native DnD, **five delegated document-level listeners** in a named-function array so `addEventListener`/`removeEventListener` see identical refs:

```js
const DRAG_LISTENERS = [["dragstart",handleDragStart],["dragover",handleDragOver],
  ["dragleave",handleDragLeave],["drop",handleDrop],["dragend",handleDragEnd]];
```

Five listeners total regardless of 154 fields; `handleDragStart` discriminates by `event.target.closest()`. Other guards worth copying:

- **`justDropped` one-macrotask flag** (`setTimeout(..., 0)`) so the click terminating a drop is not logged as a collapse toggle.
- Ineligible drop targets simply **never call `preventDefault()`** on `dragover` — the OS "no-drop" cursor is the entire rejection UI.
- `<a>` elements inside draggable wrappers get `draggable="false"` for the duration of the mode, restored on exit.
- **Every handler body is `try { ... } catch { clearDragState(); }`** — a thrown handler can never strand a stuck `.dragging` class.
- Keyboard parity (`Alt+Arrow`) reuses the identical `moveLabel → apply → save` path, then explicitly restores `.focus()` because `appendChild` blurs.
- All moves are `appendChild` of a **whole `<table>` or whole `<tr>`** — never `<td>` surgery.
- Drop feedback is CSS-only and axis-aware (`inset 0 3px 0 0` top bar vs `inset 3px 0 0 0` leading bar), with `!important` per M11/M17 doctrine.

### 7.4 Storage — delta-only with position-preserving merge

Full field order measured **4.0–5.7 KB per scope** against the 7800-byte cap; two scopes would evict each other. So `sectionOrderDelta` / `fieldOrderDelta` return `null` when the DOM matches the native stamps (deleting the key), giving ~1.2–1.6 KB. `mergeOrderList(previous, onPage, delta, max)` replaces the on-page block **in place** so off-page labels keep relative position, and trims oldest-first on overflow rather than nulling the write. Relevant if Edit Mode ever stores per-column state for wide grids (the 44-column PO of Milestone 22).

`normalizeFieldOrder` is deliberately **skip-bad-key, not fail-closed** — *"one hostile section must not void the rest."* A principled, documented exception to the house rule.

### 7.5 ⚠️ A documented NetSuite Edit-Mode hazard

Design spec lines 55-59 and 292-294: NetSuite's own `toggleFieldGroupVisibility` **resolves a field's group positionally** via `.closest(".uir-fieldgroup-content").siblings(...)` — **and it fires in edit mode.** This made cross-group field moves permanently out of scope for the builder. It is direct evidence that NetSuite's edit-mode JS contains positional DOM walks — exactly the hazard class the build brief's "line index integrity" risk names. Assume more exist in the sublist machine.

Related: native collapse is entirely `getElementById`-based on rows *inside* the group table, so moving whole group tables is collapse-atomic while moving rows between tables would break it. `ShowTab` toggles panel `display` only and never re-renders header layout, so an applied order survives subtab switches.

### 7.6 The adversarial review's confirmed findings (8 of 24 raw)

Five were state-loss classes — read them as the failure taxonomy for this architecture:

1. **Duplicate section titles across partitions** corrupted sibling panels → a page-wide title-uniqueness gate that **disables reorder entirely (fail closed)**.
2. **`fieldOrder` erased by variant records (fatal)** — a section rendering native or unkeyable on *this* record deleted layout other records depend on → `mergeOrderList`.
3. **Off-page prepend** hoisted other variants' sections to the front of their partitions → in-place merge.
4. **Unbounded off-page accumulation** could pass `MAX_SECTIONS` and **permanently brick saving** → trim oldest-first, clear the key rather than nulling the write.
5. **Save / re-apply race** — a lifecycle re-evaluate mid-save could rewind a just-completed drag from a stale read → a `savePending` counter making `applyStoredOrders` bail while a save is in flight or while personalizing.

Plus self-caught `4057c35`: identity joins use a **null separator** so spaced section titles cannot collide.

Earlier, Milestone 24c (on `main`) found the two archetypal bugs of this problem space:

- **Collapse-replay self-save data loss** — load-time replay clicks re-entered the feature's own capture listener and wholesale-rewrote the stored section list from whichever form variant was open, silently deleting sections belonging to other variants, one sync write per section per load. Fixed twice over: a synchronous suppression flag **and** merge-on-save.
- **Missing observer** — the lifecycle registration had no `observe` block, so the zero-wrapper bail never retried, late-rendered wrappers stayed unmanaged, and toggling the setting on an open page did nothing until refresh.

### 7.7 Live-testing protocol recorded on the branch

View mode only; never click native Edit or Submit; **never press Reset on the live scope** — it holds the owner's real preferences. Teardown is "drag back to native" and let delta self-cleaning do the work. The forensics addendum shows this rule being broken by the owner themselves, which is what destroyed their two hidden fields.

---

## 8. Consolidated recommendation

The evidence converges on one shape:

- **A new sibling module** `src/edit-grid/{core,runtime}.js` + its own CSS + its own `tests/edit-grid.test.mjs`, following the `b774797` template. **Zero imports from `so-columns`** — copy `planOrder`/`moveLabel` verbatim if needed (house doctrine, precedent `06d9cfe`, because each core is vm-sandboxed alone).
- **A new capability** in `routes.js` **requiring** `hasParam(context,"e")`. The two existing `!hasParam("e")` cases and their negative tests stay byte-identical.
- **A new storage key** (e.g. `suiteMateV3EditColumns`) rather than a shared schema bump — this retires the entire v3.21.1 failure class, because `main` simply ignores a key it does not know and the branch stays revertible with zero storage debt.
- **Stamp exclusion + identity early-return** for re-attach survival (§7.1); prove absence of a loop with the chrome-stub write counter, not DOM inspection.
- **A new fixture `sales-order-edit.html` kept OUT of `route-catalog.js`** — no baseline, no `fixtures.test.mjs:101` bump; only the `verify.mjs:156-184` link list.
- **Default-off + `startPaused`**, so baselines stay at 0.000 %.
- The only unavoidable View-Mode-file edits are the four `FOREIGN_NODE_SELECTOR` lists (one token each). Flag them explicitly, per the brief's *"shared utilities may change only if the approved plan explicitly flagged them."*

---

## 9. Gaps this research could not close

1. **No Edit Mode DOM ground truth exists in this repo.** Nothing documents what `#item_splits` looks like with `?e=T` — whether the id and classes even hold, how `inpt_*` / `_display` inputs are structured, or how NetSuite's machine JS indexes lines. This must come from live inspection before any selector is written.
2. **No Edit Mode fixture** → no offline regression net. Build one in milestone 1, mirroring how Milestone 24b added a collapse-emulating fixture script.
3. **Scope-key decision** (share `…:salesord` with View Mode, or namespace it) is unmade.
4. **Hiding mechanism unresolved.** `display:none` conflicts with "hidden columns must still commit their values." Candidates (`visibility:hidden` + zero width, off-screen clip) need `!important` per §5.1 **and** empirical verification that values still commit.
5. **Sort/filter feasibility is genuinely open.** `sortRows` moves `<tr>`s and `applyFilters` sets `display:none` — both plausibly corrupt NetSuite's positional line model, and §7.5 proves NetSuite's edit-mode JS does positional DOM walks. `core.js:506-510` already fails closed on non-contiguous rows, which is the right instinct. The feature-status table should start from "visual-only, or not supported" and be upgraded only on evidence.
6. **The settings v5→v6 ripple** is a real, historically expensive task — give it its own milestone step.

---

## Appendix — files referenced

**Source:** `src/so-columns/{core,runtime}.js`, `src/so-columns/so-columns.css`, `src/form-views/{core,runtime}.js`, `src/form-views/form-views.css`, `src/shared/{routes,lifecycle,settings,bridge,commands,utilities,permissions,settings-transfer}.js`, `src/csv-export/{core,runtime,main-world}.js`, `src/internal-ids/{core,runtime}.js`, `src/record-actions/{core,csv-import}.js`, `src/tab-title/{core,runtime}.js`, `src/background/service-worker.js`, `src/netsuite/data-adapter.js`, `src/popup/{popup.html,popup.js}`

**Config:** `manifest.json`, `package.json`, `CLAUDE.md`

**Tests:** `tests/verify.mjs`, `tests/so-columns.test.mjs`, `tests/form-views.test.mjs`, `tests/routes.test.mjs`, `tests/lifecycle.test.mjs`, `tests/runtime-lifecycle.test.mjs`, `tests/fixtures.test.mjs`, `tests/fixtures/{chrome-stub.js,route-catalog.js,route-fixture.js,sales-order.html,...}`, `tests/tmp-probe-fieldorder-wipe.mjs`

**Scripts:** `scripts/build.mjs`, `scripts/capture-fixtures.mjs`

**Docs:** `README.md`, `save/CHECKPOINTS.md`, `save/SUITEMATE_V1_MASTER_FEATURE_INVENTORY.md`, `docs/SMOKE_TEST.md`, `docs/V1_FEATURE_BACKLOG.md`, `docs/BUILD-BRIEF-edit-mode.md`, `docs/superpowers/specs/2026-07-30-personal-form-views-design.md`, `docs/superpowers/specs/2026-07-28-persisted-sort-filter-design.md`, `docs/superpowers/specs/2026-07-28-export-view-csv-design.md`, `docs/superpowers/plans/2026-07-28-persisted-sort-filter.md`, and (read via git only, branch parked) `docs/superpowers/specs/2026-07-31-form-layout-builder-design.md`, `docs/superpowers/plans/2026-07-31-form-layout-builder.md`

**Not an architecture doc:** `design.md`
