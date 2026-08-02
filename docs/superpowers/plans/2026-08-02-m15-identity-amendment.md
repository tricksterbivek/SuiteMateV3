# M1.5 — Edit Mode Column Identity Amendment: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `src/edit-grid/` actually mount on the real Sales Order Edit Mode machine. M1 shipped a foundation whose column axis was decoded from `_fs` spans that the live form does not emit, so `readColumnIds()` returns `[]` and the runtime declines forever. M1.5 replaces the axis source with the machine's own hidden `{machine}fields` / `{machine}data` inputs correlated against the header labels, **pins the derived axis so it is never re-derived under a permutation**, fixes the two row predicates the live pass falsified, rebuilds the fixture to the real DOM shape, and proves `bound=true` live. **M2 does not start until this milestone's live re-probe passes.**

**Architecture:** Additive only. `src/edit-grid/core.js` gains a machine-field decode block and a monotonic label-to-field correlator; `readColumnIds(table)` keeps its signature and its fail-closed `[]` contract and simply gets a new interior. `src/edit-grid/runtime.js` gains a corrected `isLineOpen()` and the axis pin. Storage is untouched — column ids remain bare internal field ids, so `STORAGE_KEY`, the container schema and the scope key are byte-identical to M1.

**The one non-obvious constraint, read this before Task 1.** The correlator emits only *increasing* subsequences of `{machine}fields` order, so it is correct only under **P-MONO** — rendered column order is a monotone subsequence of machine-field order (spec Amendment A1.2). Re-deriving the axis from a rendering that has been permuted is **never** correct: measured against the live payload, all 903 pairwise transpositions give 619 declines and 284 silent mis-keys, and all 1 806 single-column moves — the M4 gesture — give 1 002 declines and 804 silent mis-keys, with **zero** correct results in either sweep. A mis-key returns 43 plausible, unique, well-formed ids attached to the wrong columns and persists them. Task 4 closes this by construction; nothing else in the plan may work around it.

**Tech Stack:** Vanilla JS IIFEs (`Object.freeze` exports on `globalThis`), `node:test` + `node:vm` `runInNewContext` harness, served-fixture browser verification (`python3 -m http.server 8931`), Claude in Chrome for the live pass.

**Spec:** `docs/superpowers/specs/2026-08-02-edit-mode-table-enhancements-design.md`, **including Amendment 1 (M1.5 column identity)** — binding, and the authority for every algorithm and gate below.
**Parent plan:** `docs/superpowers/plans/2026-08-02-edit-mode-table-enhancements.md` (M1 tasks 1-10 complete at `0c94c31`).
**Workflow/testing rules:** `docs/BUILD-BRIEF-edit-mode.md` (binding).
**Live evidence:** `.superpowers/sdd/2026-08-02-edit-mode-table-enhancements/probe-transcripts.md`, `…/m15-identity-payload.json`, checkpoint `save/CHECKPOINTS.md:1229-1296`.

## Global Constraints

Every task's requirements implicitly include this section. **The parent plan's Global Constraints block is inherited in full and unchanged** (`docs/superpowers/plans/2026-08-02-edit-mode-table-enhancements.md`, "## Global Constraints") — branch, View-Mode-untouched rule, no `suiteMateV3ColumnOrder`, storage key and container, scope key, capability rule, settings flag, caps, computed-style fixture assertions, write-counting, `!important` hide rules, `type="button"`, no `innerHTML`, synchronous cleanup, delegated listeners only, no MAIN-world, fixture not in `route-catalog.js`, version frozen at 3.21.1, live record lock and safety triple, sequential build, no surviving `<…>` placeholder, commit authorship.

The following are **additional** and specific to M1.5.

- **Additive only — nothing shipped in M1 is reverted.** The interpreter's ruling stands: the fail-closed behaviour was correct, only the axis source was wrong. Every M1 test that is not listed in a task below must stay green **and unedited**.
- **`readColumnIds(table)` keeps its exact signature and its contract:** one argument, returns `string[]`, returns `[]` on every failure, never throws. Its three `runtime.js` call sites (`:207`, `:223`, `:256`) are re-pointed at `currentColumnIds(table)` in Task 4 and nowhere else.
- **P-MONO is a precondition, not a check** (spec Amendment A1.2). The correlator only emits increasing subsequences of `{machine}fields` order, so it is correct only while the rendered column order is a monotone subsequence of it. Re-deriving from a rendering **we** have permuted is never correct — measured, 0 % correct across every transposition and every single-column move — so no task may call `readColumnIds` while a non-native order is applied. The axis is derived on a native DOM, pinned, and reused (Task 4).
- **The frozen contract may gain only the thirteen names T1 enumerates**, and the frozen-contract test is updated in the same task that adds them. Nothing else is exported. Helpers not on that list (`machineFieldInputValue`, `nodeText`, `isFocusedRow`, `hasNumberedRowId`, `identifierTokens`, `columnIdTokens`, `comparableNumber`, `textMatchesValue`, `correlationScore`, `normalizeColumnId`) stay **module-scoped**.
- **Storage schema is unchanged.** No task may touch `STORAGE_KEY`, `STORAGE_SCHEMA_VERSION`, `normalizeStored`, `refusesNewerSchema`, `withOrder`, `withHidden`, `withWidths`, `evictOverQuota` or the scope-key shape. If a task believes it must, it stops and reports.
- **`src/edit-grid/core.js` stays source-pure.** The existing last test asserts `assert.doesNotMatch(source, /document\.|chrome\.|fetch\(|XMLHttpRequest|innerHTML|localStorage|sessionStorage/)`. Note the trap: `ownerDocument.` matches `document\.`. Reach the hidden inputs through `table.closest("form")` only — never `ownerDocument`, never a document global.
- **Delimiters are written as escapes in source**, never as raw bytes: `"\u0001"` (SOH, field), `"\u0002"` (STX, line), `"\u0005"` (ENQ, intra-field option list). A raw control byte in a tracked file is a defect. The payload JSON's `delimiters` note claiming ENQ is the line separator is **wrong**; `src/internal-ids/core.js:81` is right.
- **No new files.** M1.5 modifies `src/edit-grid/core.js`, `src/edit-grid/runtime.js`, `tests/edit-grid.test.mjs`, `tests/fixtures/sales-order-edit.html`, `docs/testing-log.md` and `save/CHECKPOINTS.md`. Manifest arrays, `tests/verify.mjs`, `package.json` and `route-catalog.js` are **not** touched, so the gate arithmetic and the 28 baselines cannot move.
- **Mutation discipline (the M1 Task 7 rule, applied to every test task).** Every new assertion must be shown to fail when the line it protects is broken, and to pass when it is restored. Record the mutation and both outcomes in the task report. A test that passes under mutation is not a test.
- **Baseline: observed governs.** M1 ended at **245/245**. Re-run `npm test` before writing anything and use the observed number; if it differs, record the observed number and continue.
- **Fail-closed is the default outcome.** Where the evidence is thin (unrecognised locale, machine with no lines, paged machine), the correct behaviour is `[]` and no mount. No task may add a "best effort" fallback.

---

## File Structure

**Modified**

| Path | Change |
|---|---|
| `src/edit-grid/core.js` | +1 identity block (machine-field decode, twin collapse, label affinity, monotonic correlator); `readColumnIds` interior replaced; `isDataRow` gains the numbered-row-id clause; `EXCLUDED_ROW_SELECTOR` gains one class; `columnIdFromSpanId` gains the line-less branch; frozen export list 37 → 50 names. |
| `src/edit-grid/runtime.js` | `isLineOpen()` redefined (Task 2); axis pinning — `pinnedColumnIds`, `appliedOrder`, `axisMismatch`, `sameColumnIds`, `currentColumnIds`, three re-pointed call sites, three teardown resets (Task 4). Nothing else. |
| `tests/edit-grid.test.mjs` | New identity tests, pinned 50-name contract assertion, updated `isLineOpen` slice test, pinning tests, extended DOM stub (form + hidden inputs + both header shapes). |
| `tests/fixtures/sales-order-edit.html` | Rebuilt to the real machine shape. |
| `docs/testing-log.md` | +1 line for the M1.5 live session. |
| `save/CHECKPOINTS.md` | +1 M1.5 checkpoint entry. |

**Not created, not modified:** `manifest.json`, `tests/verify.mjs`, `package.json`, `tests/fixtures/route-catalog.js`, anything under `src/so-columns/`, `src/form-views/`, `src/csv-export/`, `src/tab-title/`, `src/shared/`.

---

### Task 1: `src/edit-grid/core.js` — machine-field identity (decode, correlate, gate)

**Files:**
- Modify: `src/edit-grid/core.js`
- Modify: `tests/edit-grid.test.mjs`

**Interfaces:**
- Consumes: `TextEncoder` (unchanged; the only sandbox global).
- Produces — the **thirteen** additions to the frozen contract, bringing it from 37 names to **50**:
  - Constants: `FIELD_DELIMITER = "\u0001"`, `LINE_DELIMITER = "\u0002"`, `OPTION_DELIMITER = "\u0005"`, `HEADER_LABEL_SELECTOR = "div.listheader"`, `MAX_MACHINE_FIELDS = 400`, `MAX_SAMPLE_ROWS = 8`.
  - Functions: `parseMachineFieldData(fieldsValue, dataValue)`, `readMachineFieldData(table)`, `collapseDisplayTwins(fieldIds, lines)`, `readHeaderLabels(table)`, `readSampleRowTexts(table, width, lineCount)`, `labelAffinity(label, columnId)`, `correlateColumnIds(labels, columns, sampleTexts)`.
- `readColumnIds(table)` — **signature and contract unchanged**; interior replaced.

- [ ] **Step 1: Record the baseline.** Run `npm test`; record the observed pass count (expected 245/245). Run `npm run fixtures:verify`; record 28 baselines at 0.000 %.

- [ ] **Step 2: Extend the DOM stub in `tests/edit-grid.test.mjs`.** The machine needs a form ancestor carrying the hidden inputs, and header cells must be testable **both** with and without a label wrapper. Add beside the existing helpers:

```js
// Whether the machine wraps its header text in div.listheader was NOT probed —
// the only live evidence is that header cells carry text and no ids
// (probe-transcripts.md:19). readHeaderLabels must therefore work either way, so
// the stub builds both shapes and every header test runs against both.
function createHeaderCell(label, { wrapped = true, systemHidden = false } = {}) {
  const cell = createCell({ text: label, systemHidden });
  cell.querySelector = (selector) =>
    wrapped && String(selector).includes("listheader") ? { textContent: label } : null;
  return cell;
}

// The machine lives inside <form id="main_form">, which is where NetSuite puts
// the serialized {machine}fields / {machine}data inputs. closest("form") is the
// only route core.js may take to them: ownerDocument trips the purity test.
function createForm(inputs) {
  const form = {
    nodeType: 1,
    matches: (selector) => String(selector).split(",").some((part) => part.trim() === "form"),
    querySelector: (selector) => {
      const byName = /^input\[name="(.+)"\]$/.exec(String(selector).trim());
      const byId = /^#(.+)$/.exec(String(selector).trim());
      const key = byName?.[1] ?? byId?.[1] ?? null;
      return key !== null && key in inputs ? { value: inputs[key] } : null;
    }
  };
  return form;
}
```

Then teach `createTable` to reach the form. Add `form = null` to its options destructure —

```js
function createTable(rows, { id = "item_splits", className = "uir-machine-table", container = null, form = null } = {}) {
```

— and consult it last in `closest`, after the element itself and the container:

```js
    closest: (selector) => {
      if (table.matches(selector)) {
        return table;
      }
      if (container?.matches?.(selector)) {
        return container;
      }
      return form?.matches?.(selector) ? form : null;
    },
```

- [ ] **Step 3: Write the failing tests.** Add to `tests/edit-grid.test.mjs`. The first block is a **verbatim slice of the live payload** — 25 real `itemfields` ids, the real line-1 and line-2 values for those fields, the real first twelve header labels and the real first twelve visible cell texts of rows 1 and 2 on SO `16342809`. It is the regression net for the worked mapping in spec Amendment A1.2.

```js
// ===== M1.5 identity: a verbatim slice of the live machine =====
// Fields 0-24 of itemfields on SO 16342809, with the real line-1/line-2 values
// and the real first twelve header labels and cell texts. Option-list values are
// shortened; every other byte is as probed. This slice carries every pitfall the
// full 154-field payload carries: a display twin (item_display/item), a
// bookkeeping mirror that holds the same "0" as the real column
// (quantitypickpackship), an ENQ option list (unitslist, pricelevels), a
// comma-formatted number ("1,701" against raw 1701), and empty cells.
const SOH = "\u0001";
const STX = "\u0002";
const ENQ = "\u0005";
const LIVE_FIELDS = [
  "item_display", "item", "olditemid", "quantitycommitted", "quantitypickpackship",
  "quantityfulfilled", "quantitybilled", "quantitybackordered", "quantityavailable",
  "quantity", "olditemcount", "units_display", "units", "unitslist", "unitconversionrate",
  "description", "price_display", "price", "pricelevels", "custcol_rrp", "rate",
  "rateschedule", "marginal", "oqpbucket", "amount"
];
const LIVE_LINE_1 = [
  "MCH376", "4998", "4998", "0", "0", "0", "0", "", "82", "1", "1", "Ea", "3",
  `3${ENQ}4${ENQ}5`, "1", "Magic Makeup Blender with Hard Case", "Custom", "-1",
  `22${ENQ}50${ENQ}-1`, "", "14.545", "", "F", "", "14.55"
];
const LIVE_LINE_2 = [
  "MCH214", "1405", "1405", "0", "0", "0", "0", "", "1701", "1", "1", "Ea", "3",
  `3${ENQ}4${ENQ}5`, "1", "Everyday 6 Piece Essentials Set", "Custom", "-1",
  `1${ENQ}22${ENQ}-1`, "", "30.909", "", "F", "", "30.91"
];
const LIVE_LABELS = [
  "Item", "Committed", "Fulfilled", "Invoiced", "Back Ordered", "Available",
  "Quantity", "Units", "Description", "Price Level", "RRP", "Unit Price"
];
const LIVE_ROW_1 = [
  "MCH376", "0", "0", "0", "", "82", "1", "Ea",
  "Magic Makeup Blender with Hard Case", "Custom", "", "14.545"
];
const LIVE_ROW_2 = [
  "MCH214", "0", "0", "0", "", "1,701", "1", "Ea",
  "Everyday 6 Piece Essentials Set", "Custom", "", "30.909"
];
const LIVE_AXIS = [
  "item", "quantitycommitted", "quantityfulfilled", "quantitybilled",
  "quantitybackordered", "quantityavailable", "quantity", "units", "description",
  "price", "custcol_rrp", "rate"
];
const LIVE_FIELDS_VALUE = LIVE_FIELDS.join(SOH);
const LIVE_DATA_VALUE = [LIVE_LINE_1.join(SOH), LIVE_LINE_2.join(SOH)].join(STX);

// Builds the machine in the shape the live pass observed: bare-text data cells,
// numbered {machine}_row_{n} ids, symmetric cell counts, and the hidden inputs on
// the form. wrappedHeaders toggles the unprobed div.listheader wrapper.
function createLiveMachine({
  fieldsValue = LIVE_FIELDS_VALUE,
  dataValue = LIVE_DATA_VALUE,
  labels = LIVE_LABELS,
  rows = [LIVE_ROW_1, LIVE_ROW_2],
  focusedRowIndex = null,
  wrappedHeaders = true
} = {}) {
  const form = createForm({ itemfields: fieldsValue, itemdata: dataValue });
  const header = createRow({
    className: "uir-machine-headerrow",
    cells: labels.map((label) => createHeaderCell(label, { wrapped: wrappedHeaders }))
  });
  const dataRows = rows.map((texts, index) => createRow({
    id: `item_row_${index + 1}`,
    className: index === focusedRowIndex
      ? "uir-machine-row uir-machine-row-focused"
      : "uir-machine-row",
    cells: texts.map((text) => createCell({ text }))
  }));
  return createTable([header, ...dataRows], { form });
}

test("parses the machine's serialized field list and line data", () => {
  const core = createApi();
  assert.equal(core.FIELD_DELIMITER, "\u0001");
  assert.equal(core.LINE_DELIMITER, "\u0002");
  assert.equal(core.OPTION_DELIMITER, "\u0005");
  const parsed = core.parseMachineFieldData(LIVE_FIELDS_VALUE, LIVE_DATA_VALUE);
  assert.equal(parsed.fieldIds.length, 25);
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0].length, 25);
  // The row separator is STX. The payload note calling ENQ the line separator is
  // wrong: splitting on ENQ would shatter unitslist into dozens of phantom lines.
  assert.equal(parsed.lines[1][0], "MCH214");
  // No prefix stripping: internal-ids/core.js:75 would turn item_display into
  // "_display" and item into "" for this machine.
  assert.equal(parsed.fieldIds[0], "item_display");
  assert.equal(parsed.fieldIds[1], "item");
  // Gates.
  assert.equal(core.parseMachineFieldData(LIVE_FIELDS_VALUE, `a${SOH}b`), null, "ragged line");
  assert.equal(core.parseMachineFieldData(["a", "a"].join(SOH), ""), null, "duplicate field id");
  assert.equal(core.parseMachineFieldData("solo", ""), null, "single field");
  assert.equal(core.parseMachineFieldData(`a${SOH}`, ""), null, "empty field id");
  assert.equal(core.parseMachineFieldData(null, null), null);
  assert.equal(
    core.parseMachineFieldData(new Array(core.MAX_MACHINE_FIELDS + 1).fill("f").map((f, i) => f + i).join(SOH), ""),
    null,
    "over MAX_MACHINE_FIELDS"
  );
  // An empty data value is legal — it just leaves the correlator no corroboration.
  assert.deepEqual(plain(core.parseMachineFieldData(`a${SOH}b`, "").lines), []);
});

test("collapses display twins and drops option lists and bookkeeping mirrors", () => {
  const core = createApi();
  const parsed = core.parseMachineFieldData(LIVE_FIELDS_VALUE, LIVE_DATA_VALUE);
  const columns = core.collapseDisplayTwins(parsed.fieldIds, parsed.lines);
  const ids = columns.map((column) => column.id);
  // item_display + item -> one candidate carrying the DISPLAY value.
  assert.equal(ids.includes("item_display"), false);
  assert.equal(columns.find((column) => column.id === "item").values[0], "MCH376");
  assert.equal(columns.find((column) => column.id === "units").values[0], "Ea");
  // ENQ-bearing option lists are never rendered cells.
  assert.equal(ids.includes("unitslist"), false);
  assert.equal(ids.includes("pricelevels"), false);
  // The narrow mirror rule: "old"/"default" + an id present in the same list.
  const mirrored = core.collapseDisplayTwins(
    ["commitmentfirm", "oldcommitmentfirm", "orderallocationstrategy", "defaultorderallocationstrategy"],
    [["F", "F", "-2", "-2"]]
  ).map((column) => column.id);
  assert.deepEqual(mirrored, ["commitmentfirm", "orderallocationstrategy"]);
  // …and it is narrow on purpose: olditemid's base ("itemid") is not in the list.
  assert.equal(ids.includes("olditemid"), true);
  assert.equal(ids.includes("quantitypickpackship"), true);
  assert.equal(columns.length, 20);
});

test("scores label-to-field affinity in five tiers", () => {
  const core = createApi();
  assert.equal(core.labelAffinity("Quantity", "quantity"), 4);
  assert.equal(core.labelAffinity("HS Code", "custcol_hs_code"), 4, "cust prefix dropped");
  assert.equal(core.labelAffinity("Committed", "quantitycommitted"), 3, "suffix");
  assert.equal(core.labelAffinity("Price Level", "price"), 3, "label starts with id");
  assert.equal(core.labelAffinity("Allocation Strategy", "orderallocationstrategy"), 3);
  assert.equal(core.labelAffinity("Exclude Item from Rate Request", "excludefromraterequest"), 1,
    "4 of 5 label words occur in the id");
  assert.equal(core.labelAffinity("Unit Price", "rate"), 0, "no lexical relation at all");
  assert.equal(core.labelAffinity("Invoiced", "quantitybilled"), 0);
  assert.equal(core.labelAffinity("", "quantity"), 0);
  assert.equal(core.labelAffinity("Quantity", ""), 0);
});

test("correlates the live label set onto the live field list", () => {
  const core = createApi();
  const parsed = core.parseMachineFieldData(LIVE_FIELDS_VALUE, LIVE_DATA_VALUE);
  const columns = core.collapseDisplayTwins(parsed.fieldIds, parsed.lines);
  assert.deepEqual(
    plain(core.correlateColumnIds(LIVE_LABELS, columns, [LIVE_ROW_1, LIVE_ROW_2])),
    LIVE_AXIS
  );
  // "Fulfilled" is separated from quantitypickpackship — which holds the same "0"
  // on every line — by label affinity alone; monotonicity then forces "Invoiced"
  // onto quantitybilled, for which the label evidence is zero.
  assert.equal(LIVE_AXIS[2], "quantityfulfilled");
  assert.equal(LIVE_AXIS[3], "quantitybilled");
  // "Available" corroborates through a thousands separator: "1,701" against 1701.
  assert.equal(LIVE_AXIS[5], "quantityavailable");
  // One sampled row is enough here; zero is not — the ambiguity gate then fires.
  assert.deepEqual(plain(core.correlateColumnIds(LIVE_LABELS, columns, [LIVE_ROW_1])), LIVE_AXIS);
  assert.deepEqual(plain(core.correlateColumnIds(LIVE_LABELS, columns, [])), []);
  // Unrecognised locale: no label affinity anywhere, optimum wildly non-unique.
  assert.deepEqual(
    plain(core.correlateColumnIds(LIVE_LABELS.map((_, i) => `Colonne ${i}`), columns, [LIVE_ROW_1, LIVE_ROW_2])),
    []
  );
  // Fewer candidates than labels, and a width below 2, both refuse.
  assert.deepEqual(plain(core.correlateColumnIds(LIVE_LABELS, columns.slice(0, 5), [LIVE_ROW_1])), []);
  assert.deepEqual(plain(core.correlateColumnIds(["Item"], columns, [LIVE_ROW_1])), []);
});

test("duplicate header labels are separated by position, never by name", () => {
  const core = createApi();
  // The live form carries "GST" twice: the tax RATE and the tax AMOUNT. Pure
  // label keying is refused by its own uniqueness gate; monotonic correlation
  // resolves both because they sit at different points in the field list.
  const fields = ["taxcode_display", "taxcode", "taxrate1", "grossamt", "tax1amt"].join(SOH);
  const data = ["GST:GST", "7", "10.0%", "16.00", "1.45"].join(SOH);
  const parsed = core.parseMachineFieldData(fields, data);
  const columns = core.collapseDisplayTwins(parsed.fieldIds, parsed.lines);
  const labels = ["Tax Code", "GST", "Gross Amt", "GST"];
  const texts = [["GST:GST", "10.0%", "16.00", "1.45"]];
  assert.deepEqual(
    plain(core.correlateColumnIds(labels, columns, texts)),
    ["taxcode", "taxrate1", "grossamt", "tax1amt"]
  );
});

test("reads the column axis from the machine's hidden inputs and header labels", () => {
  const core = createApi();
  assert.equal(core.HEADER_LABEL_SELECTOR, "div.listheader");
  assert.deepEqual(plain(core.readColumnIds(createLiveMachine())), LIVE_AXIS);
  assert.deepEqual(plain(core.readHeaderLabels(createLiveMachine())), LIVE_LABELS);
  // The wrapper is an optimisation, not a requirement: it was never probed, so
  // bare-text header cells must read identically.
  assert.deepEqual(plain(core.readHeaderLabels(createLiveMachine({ wrappedHeaders: false }))), LIVE_LABELS);
  assert.deepEqual(plain(core.readColumnIds(createLiveMachine({ wrappedHeaders: false }))), LIVE_AXIS);
  // Sample rows are indexed by their own line number, so skipping the open line
  // leaves a hole instead of shifting every later row against {machine}data.
  const withOpenFirstLine = createLiveMachine({ focusedRowIndex: 0 });
  const samples = core.readSampleRowTexts(withOpenFirstLine, LIVE_LABELS.length, 2);
  assert.equal(samples[0], undefined, "the open line contributes no text");
  assert.deepEqual(plain(samples[1]), LIVE_ROW_2);
  // …and the axis still resolves with only line 2 sampled.
  assert.deepEqual(plain(core.readColumnIds(withOpenFirstLine)), LIVE_AXIS);
});

test("readColumnIds fails closed on every unusable machine", () => {
  const core = createApi();
  // No hidden inputs at all — the M1 live condition, and still a clean decline.
  assert.deepEqual(plain(core.readColumnIds(createMachine())), []);
  assert.deepEqual(plain(core.readColumnIds(createLiveMachine({ fieldsValue: "" }))), []);
  assert.deepEqual(plain(core.readColumnIds(createLiveMachine({ dataValue: `a${SOH}b` }))), []);
  // An empty header label is unusable: the live census found 43 labels, 0 empty.
  const blanked = LIVE_LABELS.slice();
  blanked[4] = "";
  assert.deepEqual(plain(core.readColumnIds(createLiveMachine({ labels: blanked }))), []);
  // No rendered lines: correlation is ambiguous, so the feature declines.
  assert.deepEqual(plain(core.readColumnIds(createLiveMachine({ rows: [] }))), []);
  assert.deepEqual(plain(core.readColumnIds(null)), []);
  assert.deepEqual(plain(core.readColumnIds({})), []);
});
```

- [ ] **Step 4: Run the tests and watch them fail** for the stated reason (`core.parseMachineFieldData is not a function`), not for a stub defect.

- [ ] **Step 5: Implement.** In `src/edit-grid/core.js`, add these constants beside the existing ones:

```js
  const FIELD_DELIMITER = "\u0001";
  const LINE_DELIMITER = "\u0002";
  const OPTION_DELIMITER = "\u0005";
  const HEADER_LABEL_SELECTOR = "div.listheader";
  const MAX_MACHINE_FIELDS = 400;
  const MAX_SAMPLE_ROWS = 8;
  const DISPLAY_SUFFIX = "_display";
  const MIRROR_PREFIXES = Object.freeze(["old", "default"]);
  const CUSTOM_FIELD_PREFIX = /^cust(?:col|colsd|column|record|event|entity|body)?$/;
  const MACHINE_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const MISSING_VALUE_PENALTY = -4;
  const LABEL_WEIGHT = 2;
```

Then replace the `// ===== Edit-Mode DOM identity =====` block's `readColumnIds` and add the new section above it:

```js
  // ===== Machine field data: the primary identity source =====
  // The machine serializes its own field list and line values into two hidden
  // inputs on the form. The field list is form-determined, unprefixed and
  // i18n-proof, which is why it — and not the header text or the visible index —
  // supplies every column id this feature stores (spec Amendment A1.2).
  function parseMachineFieldData(fieldsValue, dataValue) {
    const fieldIds = String(fieldsValue ?? "").split(FIELD_DELIMITER);
    if (
      fieldIds.length < 2
      || fieldIds.length > MAX_MACHINE_FIELDS
      || !fieldIds.every((id) => normalizeColumnId(id))
      || new Set(fieldIds).size !== fieldIds.length
    ) {
      return null;
    }
    const serialized = String(dataValue ?? "");
    const lines = serialized === ""
      ? []
      : serialized.split(LINE_DELIMITER).map((line) => line.split(FIELD_DELIMITER));
    if (lines.some((values) => values.length !== fieldIds.length)) {
      return null;
    }
    return { fieldIds, lines: lines.slice(0, MAX_SAMPLE_ROWS) };
  }

  function machineFieldInputValue(table, suffix) {
    // closest("form") is the ONLY route to these inputs: core.js may not touch a
    // document global, and `ownerDocument.` trips the source-purity test.
    const machineId = machineIdFromTable(table);
    const form = table?.closest?.("form");
    if (!MACHINE_ID_PATTERN.test(machineId) || typeof form?.querySelector !== "function") {
      return null;
    }
    const name = `${machineId}${suffix}`;
    const input = form.querySelector(`input[name="${name}"]`) ?? form.querySelector(`#${name}`);
    return typeof input?.value === "string" ? input.value : null;
  }

  function readMachineFieldData(table) {
    try {
      return parseMachineFieldData(
        machineFieldInputValue(table, "fields"),
        machineFieldInputValue(table, "data")
      );
    } catch {
      return null;
    }
  }

  function collapseDisplayTwins(fieldIds, lines) {
    const present = new Set(fieldIds);
    const columns = [];
    for (let index = 0; index < fieldIds.length; index += 1) {
      const id = fieldIds[index];
      const base = id.endsWith(DISPLAY_SUFFIX) ? id.slice(0, -DISPLAY_SUFFIX.length) : null;
      // {X}_display immediately followed by {X} is one column rendered by its
      // display value; the raw id is what gets stored.
      const paired = base !== null && fieldIds[index + 1] === base;
      const values = lines.map((line) => String(line[index] ?? ""));
      // A value carrying ENQ is a serialized select option list, never a cell.
      const optionList = values.some((value) => value.includes(OPTION_DELIMITER));
      // "old"/"default" + an id present in the same list is a bookkeeping mirror.
      // Deliberately narrow: olditemid survives because "itemid" is not a field.
      const mirror = MIRROR_PREFIXES.some(
        (prefix) => id.startsWith(prefix) && present.has(id.slice(prefix.length))
      );
      if (!optionList && !mirror) {
        columns.push({ id: paired ? base : id, values });
      }
      if (paired) {
        index += 1;
      }
    }
    return columns;
  }

  // ===== Label-to-field correlation =====
  function identifierTokens(value) {
    return String(value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }

  function columnIdTokens(columnId) {
    const tokens = identifierTokens(columnId);
    const trimmed = tokens.filter(
      (token, index) => !(index === 0 && CUSTOM_FIELD_PREFIX.test(token)) && !/^[0-9]+$/.test(token)
    );
    return trimmed.length ? trimmed : tokens;
  }

  function labelAffinity(label, columnId) {
    const labelParts = identifierTokens(label);
    const idParts = columnIdTokens(columnId);
    if (!labelParts.length || !idParts.length) {
      return 0;
    }
    const flatLabel = labelParts.join("");
    const flatId = idParts.join("");
    if (flatLabel === flatId) {
      return 4;
    }
    if (
      flatId.startsWith(flatLabel) || flatId.endsWith(flatLabel)
      || flatLabel.startsWith(flatId) || flatLabel.endsWith(flatId)
    ) {
      return 3;
    }
    if (flatId.includes(flatLabel) || flatLabel.includes(flatId)) {
      return 2;
    }
    const words = labelParts.filter((token) => token.length >= 3);
    if (!words.length) {
      return 0;
    }
    const covered = words.filter((token) => flatId.includes(token)).length;
    if (covered === words.length) {
      return 2;
    }
    return covered * 2 >= words.length ? 1 : 0;
  }

  function comparableNumber(text) {
    const trimmed = String(text ?? "").trim().replace(/,/g, "");
    return trimmed !== "" && /^-?[0-9]*\.?[0-9]+$/.test(trimmed) ? Number(trimmed) : null;
  }

  function textMatchesValue(cellText, rawValue) {
    const cell = String(cellText ?? "").trim();
    const raw = String(rawValue ?? "").trim();
    if (cell === "" || raw === "") {
      return false;
    }
    if (cell === raw) {
      return true;
    }
    const cellNumber = comparableNumber(cell);
    const rawNumber = comparableNumber(raw);
    return cellNumber !== null && rawNumber !== null && cellNumber === rawNumber;
  }

  function correlationScore(label, column, sampleTexts, labelIndex) {
    let penalty = 0;
    let corroborated = false;
    for (let row = 0; row < sampleTexts.length; row += 1) {
      const text = String(sampleTexts[row]?.[labelIndex] ?? "").trim();
      if (text === "") {
        continue;
      }
      // A rendered non-empty cell backed by an empty raw value is evidence
      // against this pairing — but only evidence. Seven of the 43 live columns
      // render through a transform (list text, blank checkbox), so an exclusion
      // here would put the true field out of reach.
      if (String(column.values[row] ?? "").trim() === "") {
        penalty = MISSING_VALUE_PENALTY;
      }
      corroborated = corroborated || textMatchesValue(text, column.values[row]);
    }
    return penalty + LABEL_WEIGHT * labelAffinity(label, column.id) + (corroborated ? 1 : 0);
  }

  function correlateColumnIds(labels, columns, sampleTexts) {
    const width = labels.length;
    const count = columns.length;
    if (width < 2 || width > MAX_COLUMN_IDS || count < width) {
      return [];
    }
    const scores = labels.map(
      (label, labelIndex) => columns.map((column) => correlationScore(label, column, sampleTexts, labelIndex))
    );
    // Backward DP over (labelIndex, firstAllowedCandidate). best[] is the top
    // score for the remaining labels; paths[] COUNTS the alignments that reach
    // it, which is what makes the ambiguity gate a measurement, not a guess.
    const best = [];
    const paths = [];
    for (let k = 0; k <= width; k += 1) {
      best.push(new Array(count + 1).fill(Number.NEGATIVE_INFINITY));
      paths.push(new Array(count + 1).fill(0));
    }
    best[width].fill(0);
    paths[width].fill(1);
    for (let k = width - 1; k >= 0; k -= 1) {
      for (let c = count - (width - k); c >= 0; c -= 1) {
        let top = Number.NEGATIVE_INFINITY;
        let ways = 0;
        for (let i = c; i <= count - (width - k); i += 1) {
          const total = scores[k][i] + best[k + 1][i + 1];
          if (total > top) {
            top = total;
            ways = paths[k + 1][i + 1];
          } else if (total === top) {
            ways += paths[k + 1][i + 1];
          }
        }
        best[k][c] = top;
        paths[k][c] = ways;
      }
    }
    if (paths[0][0] !== 1) {
      return [];
    }
    const ids = [];
    let cursor = 0;
    for (let k = 0; k < width; k += 1) {
      for (let i = cursor; i <= count - (width - k); i += 1) {
        if (scores[k][i] + best[k + 1][i + 1] === best[k][cursor]) {
          ids.push(columns[i].id);
          cursor = i + 1;
          break;
        }
      }
    }
    return ids.length === width && new Set(ids).size === width ? ids : [];
  }
```

Add the three DOM readers beside `visibleCells`:

```js
  function nodeText(node) {
    return String(node?.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  function isFocusedRow(row) {
    try {
      // Fail closed: a row that cannot be interrogated is treated as open, so
      // its widget text can never be mistaken for cell data.
      return row?.matches?.(FOCUSED_ROW_SELECTOR) !== false;
    } catch {
      return true;
    }
  }

  function readHeaderLabels(table) {
    return visibleCells(headerRow(table))
      .map((cell) => nodeText(cell?.querySelector?.(HEADER_LABEL_SELECTOR) ?? cell));
  }

  function readSampleRowTexts(table, width, lineCount) {
    const machineId = machineIdFromTable(table);
    const header = headerRow(table);
    const samples = [];
    for (const row of tableRows(table)) {
      const line = row === header ? null : rowLineNumber(row, machineId);
      if (line === null || line > lineCount || isExcludedRow(row) || isFocusedRow(row)) {
        continue;
      }
      const cells = visibleCells(row);
      if (cells.length !== width) {
        continue;
      }
      // Indexed by the row's OWN line number: an open line that is skipped must
      // leave a hole, not shift every later row against {machine}data.
      samples[line - 1] = cells.map(nodeText);
    }
    return samples;
  }
```

And replace `readColumnIds` entirely:

```js
  function readColumnIds(table) {
    try {
      const labels = readHeaderLabels(table);
      if (labels.length < 2 || labels.some((label) => !label)) {
        return [];
      }
      const machineData = readMachineFieldData(table);
      if (!machineData) {
        return [];
      }
      const columns = collapseDisplayTwins(machineData.fieldIds, machineData.lines);
      const samples = readSampleRowTexts(table, labels.length, machineData.lines.length);
      const ids = correlateColumnIds(labels, columns, samples);
      return ids.every((id) => normalizeColumnId(id)) ? ids : [];
    } catch {
      return [];
    }
  }
```

Add the thirteen names to the frozen export object at exactly the positions pinned by the `Object.keys` assertion in Step 6. Every M1 name keeps its current slot.

- [ ] **Step 6: Extend the frozen-contract test** in `tests/edit-grid.test.mjs` (the `exports a frozen core…` test) with the six new constant assertions, and add the name-count guard so a silent surface change cannot slip through:

```js
  assert.equal(core.MAX_MACHINE_FIELDS, 400);
  assert.equal(core.MAX_SAMPLE_ROWS, 8);
  assert.equal(core.HEADER_LABEL_SELECTOR, "div.listheader");
  assert.equal(core.FIELD_DELIMITER, "\u0001");
  assert.equal(core.LINE_DELIMITER, "\u0002");
  assert.equal(core.OPTION_DELIMITER, "\u0005");
  // M1 froze 37 names; M1.5 adds exactly the thirteen the amendment enumerates.
  // deepEqual on the NAMES, not a count: a count passes when one export is
  // renamed and another added, which is precisely the drift this guards.
  assert.deepEqual(Object.keys(core), [
    "VERSION", "STORAGE_KEY", "STORAGE_SCHEMA_VERSION", "MAX_SYNC_ITEM_BYTES",
    "MAX_COLUMN_ID_LENGTH", "MAX_COLUMN_IDS", "ABSOLUTE_MIN_COLUMN_WIDTH", "MAX_COLUMN_WIDTH",
    "MAX_MACHINE_FIELDS", "MAX_SAMPLE_ROWS",
    "MACHINE_TABLE_SELECTOR", "MACHINE_CONTAINER_SELECTOR", "HEADER_ROW_SELECTOR",
    "DATA_ROW_SELECTOR", "FOCUSED_ROW_SELECTOR", "EXCLUDED_ROW_SELECTOR", "COLUMN_SPAN_SELECTOR",
    "HEADER_LABEL_SELECTOR",
    "FIELD_DELIMITER", "LINE_DELIMITER", "OPTION_DELIMITER",
    "DATA_ATTRIBUTE", "NATIVE_ROW_ATTRIBUTE", "BOUND_ATTRIBUTE", "FOREIGN_NODE_SELECTOR", "CLASSES",
    "clampWidth", "normalizeStored", "refusesNewerSchema", "withOrder", "withHidden", "withWidths",
    "machineIdFromTable", "rowLineNumber", "columnIdFromSpanId", "visibleCells", "tableRows",
    "headerRow", "isExcludedRow", "alignsToHeader", "isDataRow", "readColumnIds", "isOrderedMachine",
    "parseMachineFieldData", "readMachineFieldData", "collapseDisplayTwins", "readHeaderLabels",
    "readSampleRowTexts", "labelAffinity", "correlateColumnIds"
  ]);
```

The list above is the **required export order** — the implementer inserts the new names at exactly these positions in the `Object.freeze({…})` literal, keeping every M1 name where it already sits. `Object.keys` on the frozen literal returns declaration order, so the assertion pins order as well as membership.

- [ ] **Step 7: Run `npm test`** — all green, count = observed baseline + the new tests.

- [ ] **Step 8: Mutation-proof each new assertion.** At minimum, verify each of these breaks at least one test and that restoring it turns everything green again; record the observed failure in the report:
  1. `LINE_DELIMITER` changed to `"\u0005"` — the parse test must fail.
  2. `if (paths[0][0] !== 1)` changed to `if (paths[0][0] < 1)` — the opaque-label and no-rows cases must fail.
  3. `MISSING_VALUE_PENALTY` changed to `0` — at least one correlation assertion must fail.
  4. `LABEL_WEIGHT` changed to `0` — the live-axis assertion must fail.
  5. `samples[line - 1] = …` changed to `samples.push(…)` — the open-first-line test must fail.
  6. The `mirror` clause deleted — the mirror test must fail.
  7. The `optionList` clause deleted — the twin/option test must fail.
  8. `labels.some((label) => !label)` deleted — the empty-label decline must fail.
  9. `new Set(fieldIds).size !== fieldIds.length` deleted — the duplicate-field-id gate must fail.

- [ ] **Step 9: Commit** — `feat(edit-grid): derive the column axis from the machine's hidden field data`.

---

### Task 2: Predicate fixes — `isLineOpen`, `isDataRow`, `EXCLUDED_ROW_SELECTOR`

**Files:**
- Modify: `src/edit-grid/core.js`, `src/edit-grid/runtime.js`, `tests/edit-grid.test.mjs`

**Interfaces:** No contract additions. `EXCLUDED_ROW_SELECTOR`'s *value* changes; `isDataRow(row, columnIds)` keeps its signature.

- [ ] **Step 1: Write the failing tests.** Update the frozen-contract assertion for `EXCLUDED_ROW_SELECTOR`:

```js
  // Union of the spec's four names and the four src/styles/netsuite.css carries,
  // plus tr.uir-machine-row-last, observed live 2026-08-02 and in neither half.
  assert.equal(
    core.EXCLUDED_ROW_SELECTOR,
    "tr.machineButtonRow, tr.totalrow, tr.uir-machine-loading-row, tr.uir-machine-nodata-row, "
    + "tr.uir-machine-button-row, tr.uir-machine-totals-row, tr.uir-loading-row, tr.uir-nodata-row, "
    + "tr.uir-machine-row-last"
  );
```

Add a new test for the row predicates:

```js
test("only numbered rows are data rows, and uir-machine-row-last never is", () => {
  const core = createApi();
  const ids = ["item", "quantity", "rate"];
  const cells = () => [createCell(), createCell(), createCell()];
  const numbered = createRow({ id: "item_row_1", cells: cells() });
  // The live machine's permanent entry row: uir-machine-row, uir-machine-row-focused,
  // 43 cells, and NO id. M1 counted it as a data row.
  const entryRow = createRow({
    className: "uir-machine-row uir-machine-row-even listtextnonedit uir-machine-row-focused",
    cells: cells()
  });
  const lastRow = createRow({ className: "uir-machine-row-last", cells: cells() });
  assert.equal(core.isDataRow(numbered, ids), true);
  assert.equal(core.isDataRow(entryRow, ids), false, "the id-less entry row is not a data row");
  assert.equal(core.isDataRow(lastRow, ids), false);
  assert.equal(core.isExcludedRow(lastRow), true);
  assert.equal(core.isDataRow(createRow({ id: "item_row_0", cells: cells() }), ids), false);
  assert.equal(core.isDataRow(createRow({ id: "item_row_x", cells: cells() }), ids), false);
});
```

Rewrite the existing `an open line is detected under either button-row class name` test — same slice technique, inverted expectations, renamed:

```js
test("an open line is a FOCUSED row carrying a numbered row id", () => {
  // Live 2026-08-02: the permanent entry row always carries
  // uir-machine-row-focused and its uir-machine-button-row is always attached,
  // so the M1 predicate was true forever and would starve every queued apply.
  const [predicate] = runtimeSource.match(/ {2}function isLineOpen\(\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(predicate), true, "isLineOpen is no longer a named function in runtime.js");
  const core = createApi();
  const lineOpen = (rows, { table = createTable(rows) } = {}) => {
    const sandbox = { core, activeTable: table, machineTable: () => table };
    sandbox.globalThis = sandbox;
    runInNewContext(`${predicate}\nglobalThis.result = isLineOpen();`, sandbox);
    return sandbox.result;
  };
  const header = createRow({ className: "uir-machine-headerrow", cells: [createCell()] });
  const closedRow = createRow({ id: "item_row_1", cells: [createCell()] });
  const entryRow = createRow({ className: "uir-machine-row uir-machine-row-focused" });
  const buttonRow = createRow({ className: "uir-machine-button-row" });
  const openLine = createRow({
    id: "item_row_2",
    className: "uir-machine-row uir-machine-row-focused listfocusedrow"
  });
  assert.equal(lineOpen([header, closedRow]), false);
  // The permanent entry row and its attached button row no longer count.
  assert.equal(lineOpen([header, closedRow, entryRow]), false);
  assert.equal(lineOpen([header, closedRow, entryRow, buttonRow]), false);
  assert.equal(lineOpen([header, createRow({ className: "machineButtonRow" })]), false);
  // A real open line does.
  assert.equal(lineOpen([header, closedRow, openLine, buttonRow, entryRow]), true);
  assert.equal(lineOpen([], { table: null }), false);
});
```

Note for the implementer: the stub's `createRow` defaults `id` to `""`, and `classMatcher` matches on class names only, so `openLine` needs both its numbered id and a focused class — that is exactly the live shape.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement.** In `src/edit-grid/core.js`:

```js
  const EXCLUDED_ROW_SELECTOR =
    "tr.machineButtonRow, tr.totalrow, tr.uir-machine-loading-row, tr.uir-machine-nodata-row, "
    + "tr.uir-machine-button-row, tr.uir-machine-totals-row, tr.uir-loading-row, tr.uir-nodata-row, "
    + "tr.uir-machine-row-last";
```

Add the module-scoped predicate and wire it into `isDataRow`:

```js
  // NetSuite numbers only its committed lines. The permanent entry row — which is
  // always present, always focused and always full-width — carries no id at all,
  // so requiring a numbered id is what keeps it off the data-row axis.
  const NUMBERED_ROW_ID = /_row_[1-9][0-9]*$/;

  function hasNumberedRowId(row) {
    return NUMBERED_ROW_ID.test(String(row?.id ?? ""));
  }

  function isDataRow(row, columnIds) {
    try {
      return row?.matches?.(DATA_ROW_SELECTOR) === true
        && hasNumberedRowId(row)
        && !row.matches(HEADER_ROW_SELECTOR)
        && !isExcludedRow(row)
        && alignsToHeader(row, columnIds);
    } catch {
      return false;
    }
  }
```

In `src/edit-grid/runtime.js`, replace `isLineOpen` entirely:

```js
  function isLineOpen() {
    const table = activeTable ?? machineTable();
    if (!table) {
      return false;
    }
    // Live 2026-08-02: the permanent entry row ALWAYS carries
    // uir-machine-row-focused and its uir-machine-button-row is ALWAYS attached,
    // so "any focused row or any button row" is true for the entire session and
    // every queued apply starves. An open EXISTING line is a focused row that
    // also carries a numbered {machine}_row_{n} id.
    const machineId = core.machineIdFromTable(table);
    return Array.from(table.querySelectorAll(core.FOCUSED_ROW_SELECTOR))
      .some((row) => core.rowLineNumber(row, machineId) !== null);
  }
```

- [ ] **Step 4: Run `npm test`** — all green.

- [ ] **Step 5: Mutation-proof.** Note for mutation 1: `isDataRow` reaches `uir-machine-row-last` only through `isExcludedRow`, so dropping the class from `EXCLUDED_ROW_SELECTOR` is what proves the new class is load-bearing — the `isExcludedRow(lastRow)` assertion is the one that pins it, and the `isDataRow(lastRow, ids)` assertion is its consequence. Say so in the report rather than claiming two independent proofs.
  1. Drop `tr.uir-machine-row-last` from the selector — the contract test and both `lastRow` assertions must fail.
  2. Drop `hasNumberedRowId(row)` from `isDataRow` — the entry-row assertion must fail.
  3. Change `NUMBERED_ROW_ID` to `/_row_[0-9]+$/` — the `item_row_0` assertion must fail.
  4. Restore the deleted button-row clause in `isLineOpen` — the two "no longer count" assertions must fail.

- [ ] **Step 6: Commit** — `fix(edit-grid): count only numbered focused rows as open lines`.

---

### Task 3: `columnIdFromSpanId` accepts the open line's line-less span ids

**Files:**
- Modify: `src/edit-grid/core.js`, `tests/edit-grid.test.mjs`

**Interfaces:** No contract change. `columnIdFromSpanId(spanId, machineId, line)` gains one branch, reached only when `line` is not a positive safe integer.

- [ ] **Step 1: Write the failing tests.** Append to the existing `decodes column ids from _fs spans against the row's own line number` test — every existing assertion in it stays byte-identical:

```js
  // The open line and the permanent entry row materialise line-LESS span ids
  // (item_item_fs, not item_item1_fs) — live 2026-08-02, probe 7. Passing an
  // explicit null line is how a caller says "this row has no line number".
  assert.equal(core.columnIdFromSpanId("item_item_fs", "item", null), "item");
  assert.equal(core.columnIdFromSpanId("item_custcol_rrp_fs", "item", null), "custcol_rrp");
  assert.equal(core.columnIdFromSpanId("actionbuttons_item_item_fs", "item", null),
    "actionbuttons_item_item", "an unrelated prefix is kept, not silently trimmed");
  assert.equal(core.columnIdFromSpanId("item_item1_fs", "item", null), "item1",
    "line-less mode does not strip digits — taxrate1 is a real column");
  assert.equal(core.columnIdFromSpanId("item_item_fs_lbl", "item", null), null);
  assert.equal(core.columnIdFromSpanId("", "item", null), null);
  assert.equal(core.columnIdFromSpanId(null, "item", null), null);
  // The numbered decode is UNCHANGED: a line-less span is refused when a line is
  // given, and a mismatched line still refuses rather than truncating.
  assert.equal(core.columnIdFromSpanId("item_item_fs", "item", 1), null);
  assert.equal(core.columnIdFromSpanId("item_quantity21_fs", "item", 2), null);
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement.** Replace `columnIdFromSpanId` in `src/edit-grid/core.js`:

```js
  function columnIdFromSpanId(spanId, machineId, line) {
    // Mirrors src/internal-ids/core.js sublistColumnId, with the row's own line
    // number instead of a hard-coded 1 so a paged machine (line 26+) decodes and
    // line 21 can never be mistaken for line 1. When the caller passes no line —
    // the open line and the permanent entry row materialise line-LESS ids such as
    // item_item_fs — the bare _fs suffix is accepted instead. Numbered decoding is
    // untouched: a mismatched line still refuses.
    const raw = String(spanId ?? "");
    const numbered = Number.isSafeInteger(line) && line > 0;
    const suffix = numbered ? `${line}_fs` : "_fs";
    if (!raw.endsWith(suffix) || raw.length === suffix.length) {
      return null;
    }
    const withoutRow = raw.slice(0, -suffix.length);
    const prefix = machineId ? `${machineId}_` : "";
    const identifier = prefix && withoutRow.startsWith(prefix)
      ? withoutRow.slice(prefix.length)
      : withoutRow;
    return normalizeColumnId(identifier);
  }
```

Implementer note: `raw.length === suffix.length` is what keeps a bare `"_fs"` from normalizing to the empty string; the old guard's `Number.isSafeInteger` early-return no longer covers it.

- [ ] **Step 4: Run `npm test`** — all green, and confirm none of the pre-existing assertions in that test changed.

- [ ] **Step 5: Mutation-proof.** (1) Force `numbered` to `true` always — the line-less assertions must fail. (2) Force it to `false` always — `columnIdFromSpanId("item_quantity21_fs", "item", 2)` must stop returning `null`. (3) Delete the `raw.length === suffix.length` guard — the `""` case must fail.

- [ ] **Step 6: Commit** — `feat(edit-grid): decode the open line's line-less _fs span ids`.

---

### Task 4: Axis pinning — derive on a native DOM only, never re-derive under our own permutation

**Files:**
- Modify: `src/edit-grid/runtime.js`, `tests/edit-grid.test.mjs`

**Interfaces:**
- Consumes: `core.readColumnIds(table)` (unchanged), `core.machineIdFromTable` — nothing new from `core`.
- Produces: **nothing exported.** Three module-scoped variables (`pinnedColumnIds`, `appliedOrder`, `axisMismatch`) and two module-scoped functions (`currentColumnIds(table)`, `sameColumnIds(left, right)`) in `runtime.js`. The frozen contract stays at the 50 names Task 1 pinned.
- Replaces: the three `core.readColumnIds(table)` call sites in `runtime.js` (`:207` in `queueApply`, `:223` and `:256` in `installEditGrid`) with `currentColumnIds(table)`.

**Why this task exists.** `correlateColumnIds` emits only strictly increasing subsequences of `{machine}fields` order, so it is correct only under **P-MONO** (spec Amendment A1.2). Measured against the live payload, re-deriving the axis from a *permuted* rendering is **never** correct — all 903 pairwise transpositions produce 619 declines and **284 silent mis-keys**, and all 1 806 single-column moves (the M4 gesture) produce 1 002 declines and **804 silent mis-keys**, with zero correct results in either sweep. A mis-key returns 43 plausible, unique, well-formed ids attached to the wrong columns and persists them. Since re-derivation under permutation is never right, refusing it costs nothing and removes the whole failure class. M1.5 applies no order, so `appliedOrder` stays `null` throughout this milestone — the machinery ships now so that M2 and M4 inherit it rather than rediscovering the hazard.

- [ ] **Step 1: Write the failing tests.** Add to `tests/edit-grid.test.mjs`, using the same slice technique the `isLineOpen` test uses:

```js
test("the column axis is derived on a native DOM, pinned, and never re-derived under a permutation", () => {
  // P-MONO (spec A1.2): the correlator only emits increasing subsequences of
  // machine-field order, so re-deriving while WE have permuted the DOM silently
  // mis-keys. The runtime must reuse the pin instead of asking again.
  // BOTH functions are sliced. currentColumnIds calls sameColumnIds, which is
  // module-scoped and reaches the sandbox through neither `core` nor a global —
  // slicing only the caller makes assertions 4 and 6 die on "sameColumnIds is
  // not defined". (The isLineOpen slice got away with one function because every
  // dependency it had went through core.)
  const [helper] = runtimeSource.match(/ {2}function currentColumnIds\(table\) \{[\s\S]*?\n {2}\}/) ?? [];
  const [comparer] = runtimeSource.match(/ {2}function sameColumnIds\(left, right\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(helper), true, "currentColumnIds is no longer a named function in runtime.js");
  assert.equal(Boolean(comparer), true, "sameColumnIds is no longer a named function in runtime.js");
  const core = createApi();
  const build = (readColumnIds, state = {}) => {
    const sandbox = {
      core: { ...core, readColumnIds },
      pinnedColumnIds: null,
      appliedOrder: null,
      axisMismatch: false,
      ...state
    };
    sandbox.globalThis = sandbox;
    return sandbox;
  };
  const call = (sandbox, table) => {
    runInNewContext(`${comparer}\n${helper}\nglobalThis.result = currentColumnIds(${table});`, sandbox);
    return sandbox.result;
  };

  // 1. First derivation on a native DOM pins the axis.
  const native = build(() => ["item", "quantity", "rate"]);
  assert.deepEqual(plain(call(native, "null")), ["item", "quantity", "rate"]);
  assert.deepEqual(plain(native.pinnedColumnIds), ["item", "quantity", "rate"]);

  // 2. While an order is applied, the pin is reused and readColumnIds is NOT called.
  let asked = 0;
  const permuted = build(() => { asked += 1; return ["rate", "item", "quantity"]; }, {
    pinnedColumnIds: ["item", "quantity", "rate"],
    appliedOrder: ["rate", "item", "quantity"]
  });
  assert.deepEqual(plain(call(permuted, "null")), ["item", "quantity", "rate"]);
  assert.equal(asked, 0, "re-derivation under a permutation is never correct, so it must not happen");

  // 3. An applied order with no pin yields nothing rather than a fresh guess.
  const orphaned = build(() => ["rate", "item", "quantity"], { appliedOrder: ["rate"] });
  assert.deepEqual(plain(call(orphaned, "null")), []);

  // 4. A fresh native derivation that DIFFERS from the pin clears it, LATCHES,
  //    and declines. The stored entry is keyed to the old axis; adopting the new
  //    one silently would relabel the user's saved layout.
  const changed = build(() => ["item", "quantity", "custcol_rrp"], {
    pinnedColumnIds: ["item", "quantity", "rate"]
  });
  assert.deepEqual(plain(call(changed, "null")), []);
  assert.equal(changed.pinnedColumnIds, null);
  assert.equal(changed.axisMismatch, true);
  // 4b. …and it STAYS declined. Installs are repaint-driven and arrive
  //     milliseconds apart, so without the latch this second call would find a
  //     null pin, skip the mismatch branch and re-pin the new axis — the silent
  //     swap the rule forbids, reintroduced through the back door.
  assert.deepEqual(plain(call(changed, "null")), []);
  assert.equal(changed.pinnedColumnIds, null);
  assert.deepEqual(plain(call(changed, "null")), []);

  // 5. A declining derivation leaves the pin alone — a transient repaint mid-read
  //    must not throw away an axis that is still valid.
  const transient = build(() => [], { pinnedColumnIds: ["item", "quantity", "rate"] });
  assert.deepEqual(plain(call(transient, "null")), []);
  assert.deepEqual(plain(transient.pinnedColumnIds), ["item", "quantity", "rate"]);

  // 6. Re-deriving the SAME axis is a no-op, not a churn.
  const stable = build(() => ["item", "quantity", "rate"], {
    pinnedColumnIds: ["item", "quantity", "rate"]
  });
  assert.deepEqual(plain(call(stable, "null")), ["item", "quantity", "rate"]);
});

test("teardown clears the pinned axis, the applied order and the mismatch latch", () => {
  // All three are module state that survives repaints by design, so removeEditGrid
  // is the only thing that may clear them — otherwise a toggle-off/toggle-on cycle
  // would re-mount against a stale axis. Teardown is also the ONLY place the latch
  // may be cleared: anywhere else and the silent swap comes back.
  const [teardown] = runtimeSource.match(/ {2}function removeEditGrid\(\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(teardown), true);
  assert.match(teardown, /pinnedColumnIds = null/);
  assert.match(teardown, /appliedOrder = null/);
  assert.match(teardown, /axisMismatch = false/);
  // Exactly one place RESETS the latch, and it is this one. The negative
  // lookbehind skips the module-scope declaration, which initialises to the
  // same value.
  assert.equal((runtimeSource.match(/(?<!let )axisMismatch = false/g) ?? []).length, 1);
});

test("every axis read in the runtime goes through the pin", () => {
  // The hazard is a caller that asks core directly while an order is applied.
  // After this task there is exactly ONE core.readColumnIds call site, inside
  // currentColumnIds; everything else asks currentColumnIds.
  const direct = runtimeSource.match(/core\.readColumnIds\(/g) ?? [];
  assert.equal(direct.length, 1, "core.readColumnIds must be reached only through currentColumnIds");
  assert.match(runtimeSource, / {2}function currentColumnIds\(table\) \{[\s\S]*?core\.readColumnIds\(table\)/);
});
```

- [ ] **Step 2: Run and watch them fail** (`currentColumnIds is no longer a named function`).

- [ ] **Step 3: Implement** in `src/edit-grid/runtime.js`. Add beside the other module state (`activeTable`, `nativeColumnIds`, …):

```js
  // The axis is derived ONCE from a native-order DOM and pinned here. It survives
  // repaints, which DOM stamps cannot. appliedOrder is the non-native column order
  // this runtime has applied, or null while the machine is in native order.
  // axisMismatch latches when the machine's own axis changes underneath the pin;
  // only removeEditGrid clears it.
  let pinnedColumnIds = null;
  let appliedOrder = null;
  let axisMismatch = false;
```

and, beside `machineContainer`:

```js
  function sameColumnIds(left, right) {
    return left.length === right.length && left.every((id, index) => id === right[index]);
  }

  function currentColumnIds(table) {
    // Latched refusal comes first. Installs are repaint-driven and arrive
    // milliseconds apart, so clearing the pin alone would let the very NEXT
    // install re-pin the changed axis — the silent swap spec A1.2 rule 4
    // forbids, reintroduced through the back door. Only teardown clears this.
    if (axisMismatch) {
      return [];
    }
    // P-MONO (spec Amendment A1.2): core.correlateColumnIds only ever emits an
    // increasing subsequence of the machine's own field order, so once WE have
    // permuted the rendering it cannot recover the axis — measured on the live
    // payload, every single-column move either declines (55%) or silently
    // mis-keys (45%), and none is correct. Reuse the pin instead of asking.
    if (appliedOrder) {
      return pinnedColumnIds ?? [];
    }
    const derived = core.readColumnIds(table);
    if (!derived.length) {
      // A transient read during a repaint must not discard a still-valid pin.
      return [];
    }
    if (pinnedColumnIds && !sameColumnIds(pinnedColumnIds, derived)) {
      // The machine's own layout changed under us. The stored entry is keyed to
      // the old axis, so adopting the new one silently would relabel the user's
      // saved layout: drop the pin, latch, and decline for the life of the mount.
      pinnedColumnIds = null;
      axisMismatch = true;
      return [];
    }
    pinnedColumnIds = derived;
    return derived;
  }
```

Replace all three `core.readColumnIds(table)` call sites with `currentColumnIds(table)`, and add the three resets to `removeEditGrid`:

```js
    pinnedColumnIds = null;
    appliedOrder = null;
    axisMismatch = false;
```

- [ ] **Step 4: Run `npm test`** — all green.

- [ ] **Step 5: Mutation-proof.**
  1. Delete the `if (appliedOrder)` early return — assertion 2 must fail (`asked` becomes 1).
  2. Change the change-detection branch to `pinnedColumnIds = derived; return derived;` — assertion 4 must fail.
  3. Delete the `if (!derived.length) return []` guard — assertion 5 must fail (the pin gets cleared).
  4. Remove one reset from `removeEditGrid` — the teardown test must fail.
  5. Point any one call site back at `core.readColumnIds` — the single-call-site test must fail.
  6. **Delete the `if (axisMismatch) return []` early return, keeping `axisMismatch = true` in the mismatch branch** — assertion **4b** must fail: the second call finds a null pin, skips the mismatch branch and re-pins the changed axis. This is the mutation that proves the latch is load-bearing rather than bookkeeping; without 4b, mutation 6 passes silently.

- [ ] **Step 6: Commit** — `fix(edit-grid): pin the column axis and never re-derive it under a permutation`.

---

### Task 5: Rebuild `tests/fixtures/sales-order-edit.html` to the real machine shape

**Files:**
- Modify: `tests/fixtures/sales-order-edit.html`

**Interfaces:** none. The fixture stays **out** of `tests/fixtures/route-catalog.js`, so the 28 baselines cannot move.

The M1 fixture encodes two falsified assumptions — `_fs` spans on static rows, and data rows carrying one more cell than the header. It passes where reality fails. Rebuilt, it must make the M1 round-trip checks prove the feature **mounts**.

- [ ] **Step 1: Rebuild the markup emulator** so it reproduces what the live pass observed:
  - **Header row** — `tr.uir-machine-headerrow`, one `td` per column, **bare text**, no ids, no `data-field-name`. That is the only shape the live pass evidences (`probe-transcripts.md:19`); whether NetSuite wraps the text in `div.listheader` was never probed, so the fixture must **not** assume the wrapper. Wrapping it here would repeat the exact M1 fixture sin of encoding an unverified assumption. The wrapped variant is covered in the unit stub (Task 1, `wrappedHeaders`), where it costs nothing to be wrong; Task 6 records which shape the machine really uses.
  - **Static data rows** — `tr.uir-machine-row` with `id="item_row_{n}"`, alternating `uir-machine-row-odd`/`-even`, **bare text cells** (`td.textContent = value`): no `_fs` spans, no `span[id]`, no `<input>`.
  - **Symmetric cell counts** — header and data rows carry the **same** number of cells, and none is inline-`display:none`. The M1 fix round's asymmetric shape is falsified; delete it.
  - **Hidden inputs on the form** — `<input type="hidden" name="itemfields" id="itemfields">` and the same for `itemdata`, values built from the fixture's own column list and line data with `String.fromCharCode(1)` / `(2)` / `(5)`, regenerated on **every** repaint so add/insert/remove stay consistent with the rendered rows.
  - **Permanent entry row** — after the last data row: `tr` with class `uir-machine-row uir-machine-row-even listtextnonedit uir-machine-row-focused`, **no id**, full cell count. Always present, always focused.
  - **Button row** — `tr.uir-machine-button-row`, always attached, relocating directly beneath whichever line is open.
  - **Last row** — `tr.uir-machine-row-last`, always present.
  - **No totals row** — the live machine has none.
  - **Per-cell widget materialization** — clicking a cell in an open line replaces that one cell's text with a widget whose id is line-less (`item_item_display` plus a `span#item_item_fs`, or `quantity_formattedValue`); sibling cells stay text. Opening a line must **not** materialize the whole row.
  - **`buildtable()`-style full `<tbody>` regenerate** — kept from M1, and now also regenerating the hidden inputs. Open-line, close-line, add-line, insert-line and remove-line all go through it.
  - Keep at least one `<select>` inside the open line so the `fieldIsDirty` select branch stays reachable (M1 Task 7 fix 4).

  Column list: use the live first twelve — `item, quantitycommitted, quantityfulfilled, quantitybilled, quantitybackordered, quantityavailable, quantity, units, description, price, custcol_rrp, rate` — with the matching labels `Item, Committed, Fulfilled, Invoiced, Back Ordered, Available, Quantity, Units, Description, Price Level, RRP, Unit Price`, and `itemfields` carrying the full 25-field superset from Task 1's `LIVE_FIELDS`, so the fixture exercises the *selection* problem and not just a 1:1 list.

- [ ] **Step 2: Update the round-trip checks** (the served-fixture pass at `python3 -m http.server 8931`, `?id=1&e=T`). Every M1 check stays; these change or are added:
  - **MOUNT (new, and the point of the task):** with the toggle on, `document.querySelector(".uir-machine-table-container").hasAttribute("data-suitemate-v3-edit-grid-bound")` is `true`, and `document.querySelectorAll("[data-suitemate-v3-edit-grid]").length` is ≥ 1. M1 could only assert this on markup reality does not produce.
  - **AXIS (new):** `SuiteMateV3EditGridCore.readColumnIds(document.querySelector("#item_splits"))` deep-equals the twelve live ids above.
  - **AXIS SURVIVES REPAINT (new):** trigger the full `<tbody>` regenerate, then add a line, then remove it; `readColumnIds` returns the identical array each time.
  - **AXIS PINNING (new, Task 4):** permute two `<td>`s in the header and in every data row, then force an install; the runtime must reuse the pinned axis and the array must be **unchanged**. Then restore native order and confirm a fresh derivation still returns the same array. This is the fixture-level proof that the M4 mis-key class is closed.
  - **OPEN LINE (new):** with line 2 open, the sliced `isLineOpen()` reads `true`; with every line closed but the entry row present and focused, it reads `false`.
  - **ZERO IDLE WRITES (kept):** `dataset.editGridWrites` is `0` after mount and stays `0` for 500 ms across regenerate / add / open / close, using the M1 counter capture-and-restore (Task 7 fix 1).
  - **TEARDOWN (kept):** toggling off leaves zero owned nodes and removes the bound attribute.
  - **H3 (kept, at the route gate):** `?id=1` gives `[edit false, view true]`; `?id=1&e=T` gives `[edit true, view false]`. Per spec Amendment A1.5 this stays a route-gate assertion — the DOM-level complement does not exist on symmetric rows.
  - **VISUALS (kept):** computed `table-layout` stays `auto`; every row's computed `display` is unchanged.

- [ ] **Step 3: Mutation-proof the fixture, both ways** (the M1 Task 7 discipline that made it a real net):
  1. Break `readColumnIds`'s label gate (`labels.some((label) => !label)` → `false`) and blank a header label in the fixture — MOUNT must fail. Restore both — green.
  2. Corrupt one byte of the fixture's `itemfields` value — MOUNT must fail (the axis declines). Restore — green.
  3. Delete the entry row from the fixture — the OPEN LINE `false` case must still pass, proving it is not the entry row that makes it false.
  4. Restore `_fs` spans on the static rows — every check must still pass, proving the fixture does not secretly depend on their **absence**.
  Record all four in the task report.

- [ ] **Step 4: Run `npm test` and `npm run fixtures:verify`** — 28 baselines still at 0.000 % (the fixture is unregistered, so this is a guard, not an expectation).

- [ ] **Step 5: Commit** — `test: rebuild the Edit Mode fixture to the real machine shape`.

---

### Task 6: Live re-probe — prove `bound=true` on the locked record

**Files:**
- Modify: `docs/testing-log.md`, `.superpowers/sdd/2026-08-02-edit-mode-table-enhancements/probe-transcripts.md`

**Interfaces:**
- Consumes: the shipped extension loaded from this working tree (Tasks 1-5 committed), and `globalThis.SuiteMateV3EditGridCore` as exposed on the page by the content script.
- Produces: a `## M1.5 live re-probe` section in `probe-transcripts.md` containing verbatim tool output for every check below; one appended line in `docs/testing-log.md`; and the **MOUNT PASS / MOUNT FAIL** verdict that Task 7 consumes.
- Produces nothing in `src/`. **No code is written in this task.** A defect found here is reported, not patched in place.

**This task is captain-driven** — a browser session, not an implementation task. The full live protocol is restated verbatim below rather than cited: `docs/BUILD-BRIEF-edit-mode.md` is untracked, has no "tiers", and must not be referenced as if it were a stable binding document.

**Live protocol — binding, restated in full:**

- **Record lock.** Account `6998262`, transaction `id=16342809`, **and that same record with `&e=T` appended** (owner decision Q2). No other record, no other transaction, no other account, no other URL. Any navigation outside the lock is a **stop-and-report**.
- **Safety triple**, verified before testing begins **and** again before any save: `custbody_salesorder_issue` checked; Status = *Pending Approval*; Memo clearly marks a testing record. Any failure at any point: **do not save, stop, report**.
- **No save.** This milestone requires none. The four-eyes save gate is therefore never invoked. Teardown is navigating away, never Submit.
- **Four-eyes save gate** (stated so it is not lost, though unreachable here): any save needs an evidence pack plus an independent Opus 5 gate answering exactly GO or NO-GO, default NO-GO; the first save of a session additionally needs the owner's explicit go-ahead in chat.
- **Forbidden verbs, regardless of anything else:** Approve, Reject, Bill, Fulfill, Email, Print, Delete, Make Copy, and any other status-changing or document-sending action.
- **Interpretation is not the captain's.** Every judgement question — "did it render correctly?", "is this a regression?" — is answered by an **Opus 5 subagent from DOM evidence**, never by the captain's own reading.
- **Batched human actions.** The extension reload and the popup toggle cannot be automated; ask for **both in one interrupt**. A fix found mid-pass is recorded as *"fixture-verified; live on next reload"* rather than blocking the pass.
- **`docs/testing-log.md`** gains one line after every live session — timestamp, milestone, what was exercised, evidence location, gate verdict.

- [ ] **Step 1: Pre-flight.** `npm test` green at the observed count; `npm run fixtures:verify` at 28 baselines / 0.000 %; `git status` clean; extension reloaded from this working tree; the popup toggle **"Sales Order columns (Edit Mode)"** switched **on**. Reload and toggle in one interrupt.

- [ ] **Step 2: Safety triple, verified before anything else** on `https://6998262.app.netsuite.com/app/accounting/transactions/salesord.nl?id=16342809&e=T`. Record the verbatim triple in the transcript. Any failure: **stop and report, do not proceed**.

- [ ] **Step 3: Read-only only.** No save. No Insert, no Remove, no OK, no Cancel, no forbidden verb. This pass opens **no** line and permutes **no** column. Teardown is navigating to the view URL and letting the owner confirm the leave-page dialog.

- [ ] **Step 4: Collect the mount proof.** Record every result verbatim into `.superpowers/sdd/2026-08-02-edit-mode-table-enhancements/probe-transcripts.md` under a new `## M1.5 live re-probe` heading:
  1. **Bound:** `document.querySelector(".uir-machine-table-container").hasAttribute("data-suitemate-v3-edit-grid-bound")` — must be `true`.
  2. **Ownership marker:** `document.querySelectorAll("[data-suitemate-v3-edit-grid]").length` — must be ≥ 1.
  3. **Axis:** `SuiteMateV3EditGridCore.readColumnIds(document.querySelector("#item_splits"))` — must be exactly the 43 ids listed in spec Amendment A1.2 ("Full derived axis"), in that order. Paste the returned array verbatim; a single divergence is a **stop-and-report**, not a note.
  4. **Axis length and uniqueness:** `43`, and `new Set(ids).size === 43`.
  5. **Idle writes:** read the extension's storage before and after a 500 ms idle window and confirm `suiteMateV3EditColumns` is **absent or unchanged** — the feature applies nothing in M1.5, so any write is a defect.
  6. **Predicates:** with no line open, the page's `isLineOpen()` equivalent must read `false` while the entry row is present and focused — evidence that the M1 permanent-true bug is closed. Verify by asserting the entry row exists (`tr.uir-machine-row-focused` with no `id`) **and** that no `tr[id^="item_row_"]` carries a focused class.
  7. **Console:** zero error-level messages across the pass.
  8. **Coexistence:** in Edit Mode, no `[data-suitemate-v3-so-columns]` and no `[data-suitemate-v3-form-views]` nodes.
  9. **Header label node — the open question from Task 1/Task 5.** Whether NetSuite wraps header text in a label element was never probed, and both documents currently tolerate either shape. Record verbatim: `document.querySelector("#item_splits tr.uir-machine-headerrow td").outerHTML` for the first three header cells, plus `document.querySelectorAll("#item_splits tr.uir-machine-headerrow td div.listheader").length`. Whatever it returns, **no code changes in this task** — the reader already handles both. This closes the evidence gap so `HEADER_LABEL_SELECTOR` stops being an assumption.
  10. **P-MONO spot check (informational, spec U6).** The derived axis is a monotone subsequence of `itemfields` by construction, so this checks the *converse*: read `document.querySelector('input[name="itemfields"]').value.split(String.fromCharCode(1))` and confirm the 43 derived ids appear in it in **strictly increasing** index order. A failure here would mean the live form violates P-MONO and the axis is mis-keyed — a **stop-and-report**.

- [ ] **Step 5: Teardown and View Mode regression.** Navigate to the view URL; owner confirms the dialog. Verify: View Mode loads, `so-columns` mounts, `edit-grid` nodes = 0. Then run the View Mode regression on the same record — personalization, sort, filter, widths, Export view (data rows, not headers-only), tab titles, internal-id badges — **and zero SuiteMate console errors across the whole View Mode pass**. Record what was **actually** exercised, item by item. Do not claim more than was run: the M1 checkpoint review caught exactly that overclaim.

- [ ] **Step 6: Append one line to `docs/testing-log.md`** in the house shape: timestamp, milestone (`M1.5`), what was exercised, evidence location (`probe-transcripts.md` heading), and the gate verdict (`MOUNT PASS` / `MOUNT FAIL`).

- [ ] **Step 7: Gate.** If any of checks 1-4 or 10 fails, **M1.5 is not complete**: record the divergence, stop, and report to the owner before touching code. `readColumnIds` returning `[]` live means the correlation is ambiguous on the real 43-column form — the sample-row set or the affinity tiers need re-derivation from the real data. A wrong-but-well-formed axis, or a P-MONO violation, is more serious still. Either is a new task, not a patch.

---

### Task 7: M1.5 checkpoint

**Files:**
- Modify: `save/CHECKPOINTS.md`

**Interfaces:**
- Consumes: the commit SHA ranges of Tasks 1-5, the gate numbers re-run in Step 1, and Task 6's `probe-transcripts.md` section plus its MOUNT PASS/FAIL verdict and `docs/testing-log.md` line.
- Produces: one `## Edit Mode Table Enhancements: Milestone M1.5 (column identity)` entry appended to `save/CHECKPOINTS.md`, and the checkpoint commit that unblocks M2.
- Produces nothing in `src/` or `tests/`. If Step 1's gates are not green, the checkpoint is **not** written — the failure is reported instead.

- [ ] **Step 1: Re-run the gates independently.** `npm test` — record the exact pass/fail count (**expected 245 + the tests Tasks 1-4 added; observed governs**). `npm run fixtures:verify` — record `28 baselines at 0.000 %`. `git diff --name-only main | grep so-columns` — must return exactly `src/so-columns/core.js`. `git diff --name-only main -- manifest.json tests/verify.mjs package.json tests/fixtures/route-catalog.js` — must return **nothing**. `git status` — clean apart from the checkpoint edit.

- [ ] **Step 2: Write the entry** in `save/CHECKPOINTS.md`, in the house `### Included` / `### Verification` shape, headed `## Edit Mode Table Enhancements: Milestone M1.5 (column identity)`. It must state:
  - **Status** — complete only if Task 6's mount proof returned **MOUNT PASS**; otherwise the milestone is not checkpointed.
  - **Included** — one bullet per task (1-6), each with its commit SHA range. **Range convention: `first..last`, inclusive of both endpoints** — the first commit *of that task* and its last, not git's exclusive `A..B` revision syntax. State the convention once in the entry so it cannot be misread. While here, correct the ledgered M1 nit: the M1 headline range should read **`0862814..cea3726`** inclusive (`f0716b7` is the branch point, not an M1 commit).
  - **Verification** — the observed `npm test` count (**expected 245 + the tests Tasks 1-4 add; record the observed number, which governs**), `npm run fixtures:verify` at **28 baselines / 0.000 %**, the fixture round-trip results including the new MOUNT, AXIS and AXIS PINNING checks, and the live re-probe results with the verbatim 43-id axis.
  - **The identity mechanism in two sentences**, with the pointer to spec Amendment 1, and the explicit statement that **the storage schema did not change** and the frozen contract went **37 → 50** names.
  - **What is now proven live that was not before:** attachment on the real machine. The M1 entry's honest disclaimer (`:1255`, "Not proven live: attachment and re-render survival — FIXTURE-PROVEN ONLY") is superseded **only to the extent Task 6 actually exercised it** — mount, axis, idle-write flatness. Re-render survival across a **commit** is still fixture-only, because this pass opens no line. Axis pinning is **fixture-proven only** — the live pass permutes no column. Say both.
  - **Carried gaps**, named: **P-MONO / U6 is the highest carried risk** — the correlator is only correct while rendered order is a monotone subsequence of machine-field order, it cannot be checked from the DOM, and a custom form that violates it mis-keys silently; Gate A′ still owed before M4 and now defined around the pin; the entry row is no longer treated as an open line, which M2/M3 must decide about before wiring the first apply; page-scope disclosure still untested (no paged record); locale portability declines by design (U7); a machine with no rendered lines declines to mount.
  - **Feature-status deltas** — none new; A1.6's three amended rows are already recorded in the spec.

- [ ] **Step 3: Honesty sweep.** Every claim in the entry maps to a command output or a transcript line. No `<…>` placeholder survives. No sentence claims a verification that was not run — in particular, do not write "re-render survival proven" or "pinning proven live". Read the entry against the Task 6 transcript line by line.

- [ ] **Step 4: Commit** — `docs: M1.5 checkpoint — identity amendment shipped, mount proven live`.

- [ ] **Step 5: Report** the checkpoint SHA, the gate numbers and the carried gaps. **M2 may now begin.**
