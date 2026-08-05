# Edit Mode Sublist Machines — Risk & Mechanics Dossier

**Date:** 2026-08-02
**Scope:** NetSuite Classic UI (2024.2/2025.1), Sales Order `?id=…&e=T`, Items sublist (`item` machine).
**For:** SuiteMate v3 — `docs/BUILD-BRIEF-edit-mode.md` planning phase.
**Method:** read-only codebase forensics + NetSuite platform analysis + external source corroboration. No files modified other than this one; no browser used.
**Revised 2026-08-02** — external corroboration folded in. Corrections are marked inline and consolidated in **§15**.

---

## 0. Bottom line up front

1. **The DOM is a projection, not the record — now sourced.** Each machine owns a `machine.dataManager` with `getLineArray()` as the authoritative line store; `machine.buildtable()` **regenerates the whole table from that model**. Third-party code that needs a line changed calls `machine.insertdata()` / `deleteline()` / `clearline()` + `buildtable()` — it never edits `<td>`s. So visually reordering, hiding or filtering DOM nodes **cannot corrupt a commit**: NetSuite rebuilds from its model and never reads our arrangement. **[SOURCED — §15]**
2. **What that costs instead: everything we write into the table is discarded on repaint.** The risk shifts from *corruption* to *survival*. The mitigation is sourced too: **`machine.postBuildTableListeners` is an array you can push a re-apply callback onto**, giving a first-class re-attach hook instead of inferring one from mutations. **[SOURCED — §15]**
3. **Residual corruption risk is narrow but not zero.** `buildtable()` is a full regenerate; *incremental* updates during field sourcing may still patch cells in place. If any such path addresses cells by `row.cells[i]`, column reorder is unsafe. Probe 8 still decides — but the prior has moved strongly toward safe.
4. **A verified blocker already exists in this repo**: in Edit Mode, machine data rows carry **more `<td>`s than the header row** (extra system cells with inline `display:none`). Every shared predicate in `so-columns/core.js` uses `cells.length === headerCount` and therefore matches **zero rows** in Edit Mode. This is not speculation — it is the recorded root cause of the "headers-only CSV" defect (`save/CHECKPOINTS.md:1094`).
5. **Column identity must change.** View Mode keys columns by header *label text*. Edit Mode exposes real identity per cell: **`data-field-name` on the cell [SOURCED]**, with `span[id="{machine}_{columnid}{line}_fs"]` as fallback (already decoded by `src/internal-ids/core.js:40`).
6. **Sorting and filtering are page-scoped only.** Edit-mode machines paginate (evidence in-repo, §9).
7. **New hard exclusion:** NetSuite has **native row drag-reorder** on some machines (`.uir-draggable-table`, `.uir-machine-row-drag-guidance-up/-down`, container `.uir-list-machine-ordered`). On those, **row order is data**. Sorting and row-filtering must refuse outright there. **[SOURCED — §15]**

---

## 1. Confidence legend

| Tag | Meaning |
|---|---|
| **[REPO]** | Proven by code/docs in this repository — highest confidence, already runs against live NetSuite |
| **[EST]** | Established NetSuite platform behavior; stable across releases |
| **[INF]** | Inferred from strong in-repo evidence; very likely, worth a cheap confirm |
| **[ASSUME]** | Platform reasoning only — **requires live-browser verification before any code depends on it** |

> An external web-corroboration sweep was dispatched in parallel and had not returned at time of writing. Nothing below depends on it; every claim carries its own tag. Treat **[ASSUME]** items as the live-probe backlog in §12.

---

## 2. What the codebase already knows (and where)

| Fact | Evidence |
|---|---|
| All table personalization is **hard-gated to view mode**: `!hasParam(context, "e")` | `src/shared/routes.js:282-288` (`TRANSACTION_COLUMN_PERSONALIZATION`), `:289-295` (`FORM_VIEWS`) |
| Content scripts already load on Edit Mode pages at `document_start`, all frames — only the capability gate stops the feature | `manifest.json:34-76` |
| CSV "Export view" **explicitly refuses** Edit Mode: *"Edit-mode machines render input widgets whose text does not match the screen"* | `src/csv-export/main-world.js:517-525` |
| Edit Mode produced *"input machinery as junk **or a headers-only CSV**"* — the headers-only branch means **no data row matched `cells.length === headerCells.length`** | `save/CHECKPOINTS.md:1094`; predicate at `src/csv-export/core.js:268` |
| The extension **already reads Edit Mode machine DOM successfully in production**: internal-ids decorates sublist columns by reading `span[id$="1_fs"]` from `tr:nth-child(2)` and **filtering out cells with `cell.style.display !== "none"`** | `src/internal-ids/runtime.js:167-181` |
| Edit-mode `.listheader` is **already interactive** (`cursor: help`, hover underline = native field help) | `src/styles/netsuite.css:1616-1623` |
| ⚠️ **DISPUTED — `data-machine-name`**: this repo's CSS selects `.uir-machine-table-container[data-machine-name]`, but external code search finds **no evidence NetSuite emits it** (only Drupal/Backdrop hits). Either V1 stamped it itself (in which case that CSS rule is **dead in V3** — nothing in `src/` sets it), or it is real but unreferenced publicly. **Do not build on it — confirm in probe 1.** | `netsuite.css:1616` vs §15 |
| Focused/open line classes: `.uir-machine-row-focused`, `.listfocusedrow`; its cells: `.listinlinefocusedrowleft`, `.listinlinefocusedrowleftright`, `.listinlinefocusedrow`, `.listinlinefocusedrowright`, `.uir-spacer`, `td.uir-disabled` | `netsuite.css:2833-2836`, `4858-4872`, `1625` |
| Machine has an **inline button row**: `.uir-machine-button-row .machineButtonRow` (Add/Insert/Cancel) | `netsuite.css:604-612`, `4877+` |
| Rows carry ids encoding the **absolute line number**: `[id$=_row_N]` and `[id$=rowN]` families | `netsuite.css:3136-3220` (`.sln` line-number counters) |
| **Machines paginate**: `--sln-start` cascade at row ids 101, 126, 151 … 501 (steps of 25) infers page starts; V1 shipped "Sublist navigation: First, Previous, Next, Last and keyboard paging" | `netsuite.css:3152-3220`; `save/SUITEMATE_V1_MASTER_FEATURE_INVENTORY.md:152` |
| Other machine substructure: `.uir-machine-totals-row`, `.uir-loading-row`, `.uir-nodata-row`, `.uir-list-machine-ordered` (native drag-order machines), `td.movable` (native drag handle), `.uir-machine-tooltip` | `netsuite.css:178-206`, `189` |
| Machine cells wrap fields in `span[data-fieldtype]` (incl. `popupselect`, `.nldropdown`, `.uir-select-input-container`) | `netsuite.css:2935-3012` |
| NetSuite's own **serialization wire format is already decoded in-repo**: `#main_form > input[type=hidden][name$="fields"]` (`\u0001`-joined field names, machine-prefixed) paired with `[name$="data"]` (`\u0002`-joined rows, `\u0001`-joined values) | `src/internal-ids/core.js:67-89`; `runtime.js:196-203` |
| NetSuite client 1.0 globals are reachable from the MAIN world; the extension already calls `window.nlapiGetRecordType()` and NetSuite's own inline handlers call `nlapiSetFieldValue(` | `src/netsuite/data-adapter.js:732,755`; `netsuite.css:5412` |
| A **MAIN-world injection path already exists** (`chrome.scripting.executeScript({world:"MAIN"})` + CustomEvent request/response) | `src/background/service-worker.js:127-150` |
| Prior form-layout work named exactly one edit-mode hazard: NetSuite's `toggleFieldGroupVisibility` **fires in edit mode** and resolves targets by a `.closest(…).siblings(…)` **positional walk** | parked branch `0a04764` design spec |
| No Edit Mode DOM fixture exists anywhere in `tests/` — `tests/fixtures/sales-order.html:118-125` is a 5-column view-mode stub | — |

---

## 3. The Edit Mode DOM model

Reconstructed from `internal-ids` (which runs in Edit Mode today), `netsuite.css`, and external corroboration (§15):

```
window.machines            // page-global MAP keyed by machine name (NOT an array,      [SOURCED]
                           // and there is NO getMachine() / nlapiGetMachine)
machines.item = {
  name, currentRowNum,                                                              // [SOURCED]
  dataManager: { getLineArray(), findFieldValueLineNum(fieldMap, fieldId) },        // [SOURCED]
  buildtable(),            // regenerates the ENTIRE table from dataManager          // [SOURCED]
  postBuildTableListeners, // Array — push(fn) to re-attach after every repaint      // [SOURCED]
  insertdata(v,row), deleteline(n,b), clearline(b)                                   // [SOURCED]
}                          // NB: members are lowercase, not camelCase

<form name="main_form" id="main_form">
  <!-- serialized payload field names + separators NOT sourced; see §15 / probe 5 -->
  <div class="uir-machine-table-container">                                        ← [REPO]
    <table id="item_splits" class="uir-machine-table" data-nsps-id="…">            ← [SOURCED]
      <tr class="uir-machine-headerrow">                                           ← [REPO]
        <td><div class="listheader">Item</div></td>  … (VISIBLE columns only)      ← [INF]
      </tr>
      <tr id="item_row_1" class="uir-machine-row">                                 ← [SOURCED]
        <td data-field-name="item" data-nsps-label="Item" data-ns-tooltip="…">     ← [SOURCED]
          <span id="item_item1_fs" data-fieldtype="select|popupselect">…</span>
          </td>                                                                    ← [REPO]
        <td style="display:none">…</td>      ← extra system cells, hidden inline   ← [REPO]
      </tr>
      <tr id="item_row_2" class="uir-machine-row uir-machine-row-focused listfocusedrow">
        <td class="uir-machine-focused-cell listinlinefocusedrowleft">             ← [SOURCED]
          <div class="listinlinefocusedrowcell">       ← editable                  ← [SOURCED]
          <div class="listinlinefocusedrowcellnoedit"> ← read-only                 ← [SOURCED]
            <input …></div></td>
        …
      </tr>
      <tr class="uir-machine-button-row"><td colspan="N"><table class="machineButtonRow">
          Add / Insert / Cancel </table></td></tr>                                 ← [REPO]
      <tr class="uir-machine-totals-row">…</tr>                                     ← [REPO]
    </table>
  </div>
  <!-- ORDERED machines only: .uir-draggable-table +
       tr.uir-machine-row-drag-guidance-up/-down — row order IS data -->           ← [SOURCED]
```

**Derived rules:**

- Column identity, in preference order: **`td[data-field-name]` [SOURCED]** → `^{machineId}_(?<columnId>.+?)(?<line>\d+)_fs$` on the cell's `<span id>` **[REPO]** (`src/internal-ids/core.js:40`) → header label, **never in Edit Mode**.
- Row addressing: `document.getElementById(sublistId + '_row_' + n)` — **`item_row_1`, not `itemrow1`**. **[SOURCED]** Consistent with the `[id$=_row_N]` family in `netsuite.css:3136`.
- Non-focused rows render `listtextnonedit`; the focused cell is `td.uir-machine-focused-cell`; editability is signalled by `div.listinlinefocusedrowcell` vs `…cellnoedit`. **[SOURCED]**
- `row.cells.length !== headerRow.cells.length` in Edit Mode. `row.cells` is a DOM collection — CSS `display:none` does **not** remove entries from it, but *does* remove the cell from table layout. So the mismatch is a **scripting** hazard, not a layout one: rendered column count still equals header count. **[REPO for the mismatch, INF for the mechanism]**
- Visible-cell alignment = `[...row.cells].filter(c => c.style.display !== "none")` — the exact filter internal-ids already uses successfully. **[REPO]**

---

## 4. Risk Area 1 — Line index integrity

### How NetSuite tracks lines

- **The authoritative store is `machine.dataManager`**, read via `getLineArray()` (array-of-arrays of line values) and searched via `findFieldValueLineNum()`. The `<table>` is regenerated from it by `machine.buildtable()`. Hidden inputs carry a back-reference (`hddn.machine`), so the form payload is machine-built, not scraped from `<td>`s. **[SOURCED — §15]**
- **The serialized payload's field names and separators are NOT sourced.** This repo parses `{prefix}fields` / `{prefix}data` with `U+0001`/`U+0002` separators for *customization list grids* (`internal-ids/core.js:67-89`) — real, but a different machine family. **Do not assume `itemfields`/`itemdata` for a transaction sublist.** Settle it by inspecting the save POST body in DevTools (probe 5).
- **Line addressing is 1-based positional** throughout the client API: `nlapiGetLineItemValue(type, fld, line)`, `nlapiSelectLineItem(type, line)`, `nlapiGetCurrentLineItemIndex(type)`, `nlapiRemoveLineItem(type, line)`. **[EST]** Note there is **no** `getMachine()` / `nlapiGetMachine` / `NLMachine`, and no camelCase `selectLine`/`commitLine`/`getLineCount`/`dirty` on the DOM machine — those are SuiteScript 2.x *record* APIs and conflating them is the folklore. **[SOURCED — §15]**
- **DOM row ids encode the absolute line number**: `{sublistId}_row_{n}` → `item_row_1`. **[SOURCED]** NetSuite's own lookup is `document.getElementById(sublistId + '_row_' + linenum)`, i.e. **by id, not by sibling position** — which is exactly the property that makes visual row reordering non-corrupting. **[SOURCED]**
- **NetSuite natively drag-reorders rows on ordered machines** (`.uir-draggable-table`, `tr.uir-machine-row-drag-guidance-up/-down`, container `.uir-list-machine-ordered`, `td.movable` handle). **On those machines row order is data** — user-land reordering bypasses the native operation and is forbidden. **[SOURCED]**
- Per-line bookkeeping: `line` and `lineuniquekey` are documented **record-level** sublist field ids, but there is **no evidence they render as per-row hidden `<input>`s**. **[ASSUME — probe 5]**

### What actually corrupts a commit

| Operation | Commit safety | Why |
|---|---|---|
| Reorder `<tr>` nodes | **Safe for the commit** | Row ids stay glued to their rows; the buffer is untouched. Renumbering after Add/Remove makes ids disagree with visual order — cosmetic only. **[INF]** |
| `display:none` on a `<tr>` | **Safe for the commit** | Node stays in the DOM and in the buffer. **[EST]** |
| Reorder `<td>` nodes inside a row | **Conditionally fatal** | Safe iff repaint writes by element id. **Fatal iff repaint writes by `row.cells[i]`** — values land in the wrong columns on the next repaint, then get serialized into the buffer. **[ASSUME — THE decisive probe]** |
| `display:none` on a `<td>` | **Safe for the commit** | The `<input>` remains in `main_form` and remains readable/writable by the machine. **[EST]** |
| **Remove** a `<td>` or `<tr>` | **Fatal** | Machine loses its write target; a repaint will throw or write to `undefined`. **Never remove native nodes.** **[EST]** |
| Rewrite a cell's `innerHTML` | **Fatal** | Destroys `_fs` spans and inputs. **[EST]** |

### Verdict on the brief's question

> *"Is true DOM reordering safe, or only visual/CSS-order approaches?"*

**There is no CSS-order approach available for tables.** `order:` requires a flex/grid container; making `<tbody>` a flex container destroys column alignment, and `<td>` cannot be reordered by CSS at all. So the choice is **true DOM node movement or nothing**. Any plan that assumed a "visual-only, CSS-order" escape hatch must be rewritten. **[EST]**

The residual safe alternative for the riskiest features is a **read-only overlay**: a cloned, non-editable table that supports arbitrary sort/filter, with a one-click return to the live machine. That is a real fallback, not a consolation prize — but it is a different feature from "sort the live grid".

---

## 5. Risk Area 2 — Inline editing events and what they rebuild

Classic machines are **single-open-line** editors: exactly one line is "open" (widgets live), all others are static text. **[EST]**

| Trigger | DOM impact | Survives? |
|---|---|---|
| Click a line (select) | Old open row repainted to static; new row repainted with widgets; `machineButtonRow` relocated | **2 rows + button row replaced** |
| Field change on open line (`fieldChanged`) | Cell contents of dependent columns rewritten in place | **Cells within the open row replaced** |
| Field sourcing (e.g. pick an Item) — server round-trip, then `postSourcing` | Multiple widgets in the open row rewritten; may also rewrite amount/total cells | **Open row + totals** |
| `validateField` rejection | Alert/inline error; **focus forced back to the offending widget** | Focus hazard for hidden cells (§7) |
| **Add / Insert line** | New `<tr>` inserted; **all subsequent lines renumbered** → their `<tr id>` and every `_fs` span id change | **Mass rebuild** |
| **Remove line** | Row removed; renumbering as above | **Mass rebuild** |
| Server-side recalc (tax/shipping/discount) | Totals row rewritten; amount column may be rewritten across all rows | **Up to whole `<tbody>`** |
| **Sublist paging** (Next 25 / Previous) | Entire `<tbody>` replaced | **Full rebuild** |
| Subtab switch (`ShowTab`) | `display` toggle only | **Survives** (repo-proven for form panels) |

All rows **[EST]** except paging scope **[INF]**.

**Design consequence:** do not try to enumerate rebuild scopes. **Assume every interaction may replace the whole `<tbody>`, and make re-apply cheap, idempotent, and self-suppressing.**

**Never swallow native events.** Delegated listeners must be non-capturing where possible, must not `preventDefault()` on native machine targets, and every injected control must be `type="button"` — inside `main_form` a bare `<button>` defaults to `type=submit` and **would save the record**. (`so-columns/runtime.js:952` already does this; it is merely cosmetic in view mode and **safety-critical** in edit mode.)

---

## 6. Risk Area 3 — Re-render timing and clean re-attach

### Observable signals

| Signal | Reliability |
|---|---|
| **`machines[name].postBuildTableListeners.push(fn)`** — NetSuite's own post-repaint callback array, fired after every `buildtable()` | **PRIMARY. [SOURCED — §15]** This is a first-class re-attach hook, not an inference. Requires MAIN-world access (already available via `executeScript({world:"MAIN"})`). It is also the *only* correct answer to "everything we write is discarded on repaint" |
| Shared `MutationObserver` on `documentElement` (`childList`+`subtree`) — already running via `src/shared/lifecycle.js:143-171` | **FALLBACK.** Catches everything, but needs a much tighter `relevant()` predicate in Edit Mode or it will fire on every keystroke-driven repaint. Keep it for paths `postBuildTableListeners` does not cover (incremental sourcing updates) |
| Scoped observer on `#item_splits` `childList` (+ `subtree` for cell rewrites) | Best signal-to-noise **[recommended]** |
| `attributes` observer on `tr` `class` — `uir-machine-row-focused` add/remove | **The open-line transition signal.** Cheap, precise **[INF]** |
| `document.activeElement.closest('tr.uir-machine-row')` | Synchronous "which line is open" read **[EST]** |
| Polling / `setTimeout` after clicks | **Do not.** Loses to sourcing round-trips |
| A named "machine repaint" hook to wrap | **[ASSUME]** — do not design for one until probe 6 finds it |

### Re-attach without duplicate handlers or lost state — reuse what already exists

The parked `feature/form-layout-builder` branch (`0a04764`, read-only, stays parked) plus shipped `so-columns` already contain the full toolkit. Nothing new needs inventing:

| # | Technique | Where |
|---|---|---|
| T1 | **First-touch native stamping** — write pristine ordinal into `data-*`, reconstruct native order from stamps, never from current DOM | `so-columns/core.js:661`; branch `form-views/core.js:397,484` |
| T2 | **Stamped-node observer guard** — relevance predicate returns `false` for any added node carrying the stamp attribute or matching the owned-node selector. Deterministic; a boolean "I'm mutating now" flag **does not work** because observer callbacks land after it clears | branch `form-views/core.js:549`; commit `3e546f3` |
| T3 | **Identity early-return** — join current order to a key string, compare to target, perform **zero** DOM writes when equal. Starves any feedback loop that slips past T2 | branch `form-views/core.js:436,513` (null-separator join) |
| T4 | **Delta-only + merge-on-save** — store only deviations from native; merge so entries for columns not rendered on this variant survive | branch `form-views/runtime.js:192`, `core.js:358` |
| T5 | **Replay-suppression flag** — only for *synchronous* re-dispatch of NetSuite's own gesture (e.g. `el.click()`), never for observers | branch `form-views/runtime.js:44,247,267` |
| T6 | **In-flight guard** — refuse re-apply while personalizing or while a save is pending. **Edit-mode analogue: refuse re-apply while a line is open or dirty** | branch `form-views/runtime.js:177-190` |
| T7 | **Serialized save queue** — one promise chain for all read-modify-write storage ops | `so-columns/runtime.js:503` |
| T8 | **Ownership markers + idempotent ensure** — `data-suitemate-v3-*` on every injected node; `ensureX()` early-returns; `controls.isConnected === false` is the "was my node replaced?" test; handler duplication blocked by a marker-attribute gate (`if (!table.hasAttribute(SORTABLE_ATTRIBUTE)) { set; addEventListener }`) | `so-columns/runtime.js:961,1007,1013-1017` |
| T9 | **Generation-guarded async evaluate** — `signal.aborted \|\| !isCurrent() \|\| !table.isConnected` after every `await`; cleanup must be synchronous | `shared/lifecycle.js:287,327,186-198` |
| T10 | **One shared observer + microtask coalescing + two-stage relevance** (declared `observe` options, then per-watcher `relevant(records)`) | `shared/lifecycle.js:143-171,370-395` |
| T11 | **Fail-closed on ambiguous identity** — disable the feature rather than reorder a subset | branch `form-views/core.js:349,417,474` |
| T12 | **Full-restore teardown** — stamps double as the undo log | branch `form-views/runtime.js:824`; `so-columns/runtime.js:1066` |
| T13 | **Row stamping for stable sort / native restore** — `data-suitemate-v3-native-row`, doubles as sort tie-breaker | `so-columns/core.js:495-537` |
| T14 | **`planOrder` graceful degradation** — only uniquely-matching saved keys are permuted; stale/foreign entries are inert | `so-columns/core.js:392` |
| — | **Loop probe as an acceptance test** — one user gesture must produce exactly **one** storage write, and the count must stay flat for 500 ms | branch `save/CHECKPOINTS.md:1237` |

**Edit-mode additions required on top:**

- **Re-stamp from the machine's own column id**, not from a surviving `data-*` attribute. `<td>` stamps are lost whenever NetSuite recreates a row — and after Add/Remove, *every* row is recreated. The `_fs` span column id is the only durable identity. **[REPO-derived]**
- **Delegate all listeners to the stable container** (`#item_splits` or `.uir-machine-table-container`), never per-row — rows are disposable.
- **Queue, don't apply, while a line is open.** Flush on the `uir-machine-row-focused` removal signal.

---

## 7. Risk Area 4 — Hidden columns

**Do values still commit?** **Yes** — with high confidence, three ways:

1. The commit reads the buffer, not the rendered table. **[INF]**
2. Even on a raw form post, a `display:none` `<input>` is still submitted (unlike `disabled`). **[EST]**
3. **NetSuite already does this itself**: Edit Mode rows contain system `<td>`s hidden with inline `display:none` whose values plainly still save. Our `display:none` is the same mechanism. **[REPO]**

**Rules to keep it true:**

- Hide by adding a class to the `<td>` — **never** `remove()`, never `hidden` attribute on the input, never `disabled`.
- Hide the `<td>`, not the `<input>`; leave the `_fs` span and widget intact.
- Beware the **"display defeats hidden"** defect class — this repo has hit it three times (`save/CHECKPOINTS.md:1143,1157`). Edit-mode machine CSS is specificity-heavy; the hide rule will need `!important`, exactly as `form-views` concluded.

**What breaks when a cell is hidden:**

| Hazard | Severity | Mitigation |
|---|---|---|
| `validateField` rejection **focuses** a widget inside a `display:none` cell → `focus()` is a no-op → the machine may loop, or silently refuse to commit the line with no visible error | **High** **[EST]** | **Auto-reveal the column on validation failure**, or refuse to hide columns whose field is required/validated |
| Tab order skips hidden cells | Low (arguably desirable) **[EST]** | Disclose in UI |
| Popup pickers (`data-fieldtype=popupselect`, `.nldropdown`) anchored to a zero-box element position at 0,0 or off-screen | Medium **[ASSUME]** | Never hide the column that currently holds focus; force-reveal on `focusin` |
| Hiding a column whose sourcing drives others (e.g. Item) — user can't see why other columns changed | UX only | Disclose |
| Hiding the **first** column collides with the native sticky-first-column CSS (`SET-06`) | Low **[REPO]** | Test |

**Verdict: fully supportable**, with a mandatory force-reveal-on-focus/validation rule.

---

## 8. Risk Area 5 — Column resizing

- **Confirmed: no `<colgroup>` and no `table-layout` rule anywhere in NetSuite's stylesheet.** Widths are content-driven auto layout, with per-cell CSS `span[data-fieldtype] > input { width:100% !important; min-width:50px }`. **[SOURCED — §15]**
- NetSuite offers **no user column resizing** in Classic Edit Mode, so there is no competing resize handle to fight. **[EST]** No evidence NetSuite re-applies user widths on repaint — but `buildtable()` **discards** whatever we wrote, so widths must be re-applied from `postBuildTableListeners`. **[SOURCED]**
- **Hard floor:** that `min-width:50px` on every widget input is a per-column minimum we cannot go below without clipping. Raise `MIN_COLUMN_WIDTH` accordingly for Edit Mode.
- Sticky-header workarounds in the wild use `transform` on `.uir-machine-headerrow` **precisely to avoid touching layout** — a useful precedent for any header decoration we add. **[SOURCED]**

**Why the existing View Mode approach is actually *more* robust here:** `core.applyWidths` (`so-columns/core.js:325`) freezes every visible header cell's width and flips the table to `table-layout: fixed`. Under fixed layout the browser derives column widths from the **first row (or colgroup) only** — so any width attribute NetSuite writes onto a repainted *data* cell is ignored. Row repaints cannot disturb our widths. **[EST]**

**Edit-mode-specific conflicts:**

| Conflict | Mitigation |
|---|---|
| Widgets in the open row have NetSuite-assigned pixel widths; a column narrower than its `<input>` clips or overflows | Enforce a per-column **min-width = widest widget's `offsetWidth`**, not the global `MIN_COLUMN_WIDTH = 30` |
| `table.style.width = <total>` inside a horizontally scrolling `.uir-machine-table-container` — combined with NetSuite's own container width, can produce a double scrollbar or a squeezed grid | Set widths on cells; leave `table.style.width` unset in Edit Mode unless probing shows otherwise |
| `display:none` cells contribute nothing to layout but **do** appear in `row.cells` — width application must iterate **header** cells only (current code already does) | ✔ already correct |
| Resize drag uses `pointerdown` on the header row — Edit Mode headers already have a **native field-help click/hover** (`netsuite.css:1616`) | Existing code already `preventDefault()`s + `stopPropagation()`s only within the 5px edge zone — verify field help still works outside it |

**Verdict: fully supportable.** Lowest-risk feature; correctly placed first in the milestone ladder.

---

## 9. Risk Area 6 — Sorting and filtering feasibility

### Pagination — the sleeper constraint

Edit-mode machines paginate (default page size appears to be 25 given the `--sln-start` cascade at 101/126/…/501; V1 shipped explicit sublist paging navigation). **Any client-side sort or filter operates on the rendered page only.** Sorting page 1 of a 200-line order sorts 25 rows. This must be surfaced in the UI, not discovered by the user. **[INF]**

### Filtering — `display:none` on `<tr>`

Mechanically the safest thing in this whole dossier: no node movement, no focus loss, no index disturbance, and NetSuite locates rows by id regardless.

Hazards:

- A **dirty or open line can be filtered out from under the user** → they lose track of an uncommitted edit. **Must force-reveal the open row and any dirty row, always.**
- **Add a line while a filter is active** → the new line may be instantly hidden, reading as "the button did nothing". **Must auto-clear or auto-reveal on Add.**
- The `.uir-machine-totals-row` keeps showing full totals while rows are hidden → looks like a bug. Must be labelled.
- Never hide the `machineButtonRow`.

**Verdict: supportable, degraded** — page-scoped, session-only, with forced reveal rules.

### Sorting — true `<tr>` movement

**Hard precondition [SOURCED]:** refuse entirely on **ordered machines** — `table.uir-draggable-table`, container `.uir-list-machine-ordered`, or any machine whose rows carry `td.movable`. There, row order is record data and NetSuite owns the reorder operation. Check this before offering the affordance, not after.

No CSS alternative exists (§4). Hazards:

- **Moving a `<tr>` that contains the focused widget blurs it** and may cancel an in-flight popup picker or sourcing round-trip. **Sorting must be refused while a line is open.** **[EST]**
- The `machineButtonRow` is positionally adjacent to the open row; sorting orphans it. Must be excluded from the sortable range and re-anchored.
- Existing `sortRows` **fails closed on non-contiguous data rows** (`so-columns/core.js:504-510`) — in Edit Mode the button row and totals row sit inside the range, so **the current implementation will refuse to sort at all**. It needs an Edit-Mode-aware contiguity definition, not a copy.
- Zebra striping via `:nth-child(even/odd)` (`netsuite.css:193-201`) desynchronizes — cosmetic.
- Any rebuild loses the order → re-apply (T1/T13 row stamps).
- Row ids after sorting no longer ascend with visual position. Harmless for commits **[INF]**, but it defeats the `.sln` line-number CSS counters (they count visual position). **Line numbers will be wrong while sorted** — disclose or suppress.

**Verdict: degraded** — session-only, page-scoped, disabled while a line is open, re-applied after rebuilds, line-number display suppressed.

### Column reorder — `<td>` movement

- Must permute against **visible/`_fs`-identified** cells, never `row.cells[i]` — Edit Mode rows have extra hidden cells. `core.applyOrder` as written (`so-columns/core.js:709-717`) skips any row whose cell count ≠ header count, so **in Edit Mode it will silently reorder the header row and nothing else**. That is a catastrophic-looking, easily-missed failure mode. It needs an Edit Mode variant.
- **Gated entirely on probe 8** (index-vs-id repaint). Index → not possible. Id → supportable.
- Refuse while a line is open (moving the focused cell blurs it).

**Verdict: degraded, conditional on probe 8.**

---

## 10. The currently-open line — why everything must special-case it

The open line is not "a row with a highlight". It is a structurally different object:

1. **It is the only row with live editors.** Other rows are static text. Anything that reads cell text (`readCellLabel`, `distinctColumnValues`, sort keys, filter matching) gets `<input>` *values* or empty strings from this row and rendered text from the others — **the sort/filter key space is inconsistent across rows**. This is precisely the "input machinery as junk" defect already recorded for CSV export.
2. **It owns focus.** Moving it, moving its cells, or hiding a cell that holds focus blurs the user mid-keystroke and can abort a sourcing round-trip.
3. **It has an attached sibling** — the `machineButtonRow` `<tr>`, with a different (colspan) cell structure. Every per-row loop must skip it; every range operation must exclude it.
4. **Its cells carry distinct classes** (`listinlinefocusedrow*`, `.uir-spacer`, `td.uir-disabled`) and may include spacer cells that exist only while focused → **cell count changes when a line opens/closes**. Any cached column↔cell mapping is invalidated by an open/close transition.
5. **It is transient.** Selecting another line rebuilds both rows.

**Rules:**

- Treat `tr.uir-machine-row-focused` / `.listfocusedrow` as an **exclusion set** for reorder, sort, hide and filter.
- Never sort or reorder while any line is open — queue and flush on the focus-class-removal signal.
- Always force-reveal the open row and its cells regardless of filter/hide state.
- Read sort/filter keys from **static rows only**, and treat the open row as always-matching.

---

## 11. Two things that will bite in the first hour

1. **The record-lock URL in the build brief is the *view* URL** (`salesord.nl?id=16342809&whence=&cmid=…`, no `e` param). Edit Mode is `…&e=T`. The safety check must accept `id=16342809` on account `6998262` **with** `e=T`, or it will refuse the very page under test.
2. **`routes.js` is a shared module.** Adding an Edit Mode capability means editing it. The brief forbids touching View Mode modules and allows shared-utility changes **only if the approved plan explicitly flags them**. Flag it: add a new `CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT` and a new `case` (`path === PATHS.SALES_ORDER && hasParam("id") && getParam(ctx,"e") === "T" && isTopFrame`). **Do not modify the existing view-mode `case`** — that keeps the diff provably additive.

---

## 12. Live-verification backlog (read-only, no save, run once in Edit Mode)

Ordered by decisiveness. All are read-only DOM/console reads on the locked record.

| # | Probe | Answers |
|---|---|---|
| 1 | `[...document.querySelectorAll('.uir-machine-table-container[data-machine-name]')].map(d=>[d.id,d.dataset.machineName,d.querySelector('table')?.id])` | Container/table ids, machine name |
| 2 | Header cell count vs each row's `cells.length` and count of `display:none` cells | Confirms the cell-count mismatch and its size |
| 3 | `[...t.rows].map(r=>[r.id,r.className])` | Row id pattern; where button/totals rows sit |
| 4 | `[...row.cells].map(c=>c.querySelector('span[id$="_fs"]')?.id)` | Column-id extraction viability per row |
| 5 | **DevTools Network tab: save once and read the POST body.** (Also `[...document.querySelectorAll('#main_form>input[type=hidden]')].map(i=>[i.name,i.value.slice(0,200)])`) | **Names the real payload fields and separators — the single biggest remaining gap, and 60 seconds of work.** Note: requires a save, so it goes through the four-eyes save gate |
| 6 | MAIN world: `Object.keys(machines)`, then `machines.item` — confirm `dataManager.getLineArray()`, `buildtable`, `postBuildTableListeners`, `currentRowNum` | **Confirms the primary re-attach hook.** Do this in milestone 1; it changes the foundation's design |
| 6b | `table.matches('.uir-draggable-table')`, container `.uir-list-machine-ordered`, any `td.movable` | Whether the SO item machine is **ordered** — if so, sorting is off the table entirely |
| 6c | `[...row.cells].map(c => c.dataset.fieldName)` | Confirms `data-field-name` as the column-identity hook (preferred over `_fs` parsing) |
| 6d | `document.querySelector('.uir-machine-table-container[data-machine-name]')` | Settles the DISPUTED `data-machine-name` attribute — if null, `netsuite.css:1616` is dead code |
| 7 | Open a line; diff the `<tbody>` before/after (record which nodes are new objects) | True rebuild scope of a select |
| 8 | **THE decisive one:** permute two `<td>`s in a *non-focused* row, then open + edit + commit an adjacent line, then read back with `nlapiGetLineItemValue` and re-inspect the permuted row | **Index vs id repaint.** Gates column reorder entirely |
| 9 | `getComputedStyle` widths + presence of `<colgroup>` + whether repainted cells gain `width` attributes | Resize conflict model |
| 10 | Add a line; observe renumbering of `<tr id>` and `_fs` span ids | Confirms mass-rebuild + stamp loss |
| 11 | Hide a column, then trigger a validation failure on that field | The focus-into-hidden-cell hazard |
| 12 | Count rendered rows vs `nlapiGetLineItemCount` | Confirms/refutes pagination and page size |

**Probes 2, 6, 6b and 8 are worth doing before writing a line of feature code.** Probe 6 decides the foundation's architecture (`postBuildTableListeners` vs MutationObserver), 6b decides whether sorting exists at all, and 8 decides the reorder milestone. Probe 5 requires a save and therefore the four-eyes gate — defer it until the read-only probes are done.

---

## 13. Feature-status table

| Feature | Verdict | Mechanism | Key risk |
|---|---|---|---|
| **Column resizing** | **Fully supportable** | Header-cell `style.width` + `table-layout: fixed`; widths survive row repaints because fixed layout reads row 1 only. Reuse `core.applyWidths` | Widget-bearing columns clip below their `<input>` width → per-column min-width from widest widget, not the global 30px floor |
| **Hide / show columns** | **Fully supportable** | Class-based `display:none` on `<td>` + header cell; cell and input stay in the DOM and in `main_form`; NetSuite hides its own system cells the same way | `validateField` focusing a widget inside a hidden cell → silent commit failure. **Mandatory force-reveal on focus and on validation error**; `!important` needed (3rd sighting of the display-defeats-hidden defect class) |
| **Column personalization (persistence)** | **Fully supportable** | Reuse `SuiteMateV3SoColumnsCore` storage layer unchanged; new scope key `{company}:{user}:{type}:edit`; **key columns by internal column id from `_fs` spans, not by header label** | Sharing the view-mode scope key would cross-contaminate the two modes. Label-keying is unreliable in Edit Mode (widget text, not header text) |
| **Drag-and-drop column reorder** | **Degraded — likely supportable (upgraded); confirm with probe 8** | True `<td>` movement, permuting cells keyed by `data-field-name`. No CSS alternative exists for table cells. Refused while a line is open; **re-applied from `postBuildTableListeners` after every `buildtable()`** | Corruption risk **downgraded**: `buildtable()` regenerates from `dataManager`, so NetSuite never reads our arrangement. Residual risk is incremental in-place cell patching during sourcing — probe 8. Cost risk is real: our order is destroyed on **every** repaint and must be re-applied each time. Secondary: `core.applyOrder` as written silently reorders only the header row in Edit Mode |
| **Excel-style filtering** | **Degraded — supportable** | `display:none` on `<tr>`; no node movement, no focus loss, row ids untouched | Page-scoped only (machines paginate). A dirty/open line can be hidden from under the user, and Add can produce an invisible line → **force-reveal open + dirty rows, auto-reveal on Add**; totals row keeps showing full totals |
| **Excel-style sorting** | **Degraded — supportable, session-only; NOT POSSIBLE on ordered machines** | True `<tr>` movement. **No CSS-order fallback exists for table rows.** Row stamps (T13) restore native order; re-applied from `postBuildTableListeners` | **Hard exclusion: refuse on `.uir-draggable-table` / `.uir-list-machine-ordered` / any machine with `td.movable` — there row order is record data (probe 6b).** Otherwise: refused while a line is open (moving a `<tr>` blurs its focused widget and can abort sourcing); page-scoped; `machineButtonRow` + totals row break the existing contiguity guard so `core.sortRows` currently refuses outright; native line numbers become wrong while sorted |
| *(fallback)* **Read-only sorted/filtered overlay** | **Fully supportable** | Cloned, non-editable projection of the machine with unrestricted sort/filter and a one-click return | Not the same feature — offer it only if probe 8 kills in-place reorder, or as a "power view" alongside |

---

## 14. Recommended architecture

New capability + new module pair (`src/so-columns-edit/{core,runtime}.js`), **zero edits to `so-columns/*`**; the only shared-module change is an additive `case` in `routes.js` (flag it in the plan). Column identity comes from `td[data-field-name]`, falling back to `internal-ids/core.js:sublistColumnId` semantics — re-derived, not imported, per the repo's vm-sandbox-per-core doctrine.

**Attachment is now a two-tier design, and the primary tier is NetSuite's own hook:**

1. **Primary — `machine.postBuildTableListeners`.** A MAIN-world shim (reusing the existing `executeScript({world:"MAIN"})` + CustomEvent bridge) pushes one re-apply callback onto every relevant machine's listener array. NetSuite calls it after each `buildtable()`. This is the sanctioned answer to "everything we write is discarded on repaint" and removes most of the guesswork from milestone 1.
2. **Fallback — the existing lifecycle watcher** with a *scoped* observer on `#item_splits` plus an attribute watch on row `class` for the open-line signal, guarded by T2 stamps, T3 identity early-return and T8 ownership markers. Covers incremental sourcing updates that never call `buildtable()`.

A **machine-state gate** (`isLineOpen()`, `isDirty()`, `isOrderedMachine()`) sits in front of every apply and queues work until the machine is idle. Milestone ladder as the brief specifies — resize → hide/show → personalization → reorder (probe 8) → filter → sort (probe 6b) — each independently shippable, so a failed probe costs only one milestone.

**Milestone 0 (new, ~30 min): run the read-only probes.** Probes 2, 6, 6b, 6c, 6d, 8 change the design of everything after them and cost almost nothing. Do not skip straight to milestone 1.

---

## 15. External corroboration — corrections and upgrades

Sources: Oracle docs; `IrodoriCiel/netsuite-full-tools` (a Chrome extension that drives NetSuite's own machine objects — the strongest available evidence for the client-side API); a verbatim NetSuite stylesheet dump (`phat3004/sitetest`). NetSuite's machine implementation itself is proprietary and auth-gated — the public SuiteScript 1.0 stub (`nlapihandler.nl?downloadapi=T`, 184 KB) contains **zero** occurrences of "machine".

### Upgraded to [SOURCED]

| Claim | Detail |
|---|---|
| **`machines` global exists** | A page-global **map keyed by machine name** — `for (const machineName in machines)`. Members are **lowercase**: `name`, `currentRowNum`, `dataManager`, `buildtable()`, `postBuildTableListeners`, `insertdata()`, `deleteline()`, `clearline()` |
| **`postBuildTableListeners` is a push-able callback array** | `machine.postBuildTableListeners.push(() => …)` then `machine.buildtable()` — the documented-by-practice re-attach hook |
| **`dataManager` is the authoritative store** | `getLineArray()`, `findFieldValueLineNum()`. Hidden inputs hold a `hddn.machine` back-reference |
| **`buildtable()` regenerates the whole table** | Anything we wrote into it is discarded |
| **Row id = `{sublistId}_row_{n}`** | NetSuite's own lookup: `getElementById(sublistId + '_row_' + linenum)` — **by id, not sibling position** |
| **Cell/table identity attributes** | `table[data-nsps-id]`; cells carry `data-field-name`, `data-nsps-label`, `data-ns-tooltip`; sublist form is `{sublistId}_form` |
| **Focused-row structure** | `td.uir-machine-focused-cell`; editability = `div.listinlinefocusedrowcell` vs `div.listinlinefocusedrowcellnoedit`; non-focused cells `listtextnonedit`. Extensions literally swap that className to toggle editability |
| **Native row drag-reorder exists** | `.uir-draggable-table`, `tr.uir-machine-row-drag-guidance-up/-down` in NetSuite's own CSS |
| **No `<colgroup>`, no `table-layout` rule** | Content-driven auto layout; `span[data-fieldtype] > input { width:100% !important; min-width:50px }` |
| **Oracle's official stance** | *"You can't access the NetSuite UI directly using Document Object Model (DOM). Use SuiteScript APIs instead."* and *"Some third-party plugins and extensions in your browser can cause problems with the NetSuite interface."* Everything here is unsupported territory by definition — which is an argument for conservatism, not for stopping |

### Corrected / demoted

| Was | Now |
|---|---|
| Row ids `itemrow{N}` **[INF]** | **`item_row_1`** — the `_row_` form is the sourced one |
| Container `[data-machine-name]` **[REPO]** | **DISPUTED.** No external evidence NetSuite emits it; likely a V1 stamp, which would make `netsuite.css:1616` dead code in V3. Probe 6d |
| `itemfields` / `itemdata` + `U+0001`/`U+0002` **[INF]** | **[ASSUME].** That format is real for *customization list grids* (parsed in-repo) but unsourced for transaction sublists. Probe 5 (DevTools POST body) settles it |
| `getMachine()` / `nlapiGetMachine` / `NLMachine`; `selectLine`, `commitLine`, `buildRow`, `getLineCount`, `dirty` on the DOM machine | **Folklore.** Zero public evidence. The camelCase names are SuiteScript 2.x **record** APIs, a different layer |
| Per-line hidden inputs `line`, `lineuniquekey`, `uniquekey` | **Unsourced as DOM inputs.** They are record-level sublist field ids |
| Field widget ids `inpt_item1`, `item_display` | **Unsourced per-line.** `inpt_` is real for *body* fields; `{id}_fs` / `_fs_lbl` spans are confirmed |

### Convergent practice worth copying

The most mature NetSuite extension found **deliberately avoids structural DOM edits on machine tables**: sublist line numbers are injected via CSS `::before` (zero `<td>` insertion) and row hiding uses a CSS class rather than node removal. Sticky-header workarounds use `transform` on `.uir-machine-headerrow` specifically to avoid touching layout. This independently validates the dossier's core rule — **decorate and hide with CSS; never insert or remove native nodes** — and suggests our column-reorder feature is the one place we deviate from established practice, which is exactly where probe 8 belongs.

### Still not found anywhere

- Any public copy of the machine implementation JS.
- The serialized payload's field names / separators for a transaction sublist — **the biggest remaining gap; one DevTools observation closes it.**
- Any NetSuite support note or SuiteAnswers article specifically about sublist column reorder/hide breaking saves. Absence of evidence, not evidence of absence.
