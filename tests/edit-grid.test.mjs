import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "src/edit-grid/core.js"), "utf8");
const runtimeSource = await readFile(resolve(root, "src/edit-grid/runtime.js"), "utf8");
const stylesheet = await readFile(resolve(root, "src/edit-grid/edit-grid.css"), "utf8");
const sharedSources = Object.fromEntries(await Promise.all(
  ["src/shared/utilities.js", "src/shared/routes.js", "src/shared/settings.js"]
    .map(async (file) => [file, await readFile(resolve(root, file), "utf8")])
));

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
function createCell({ text = "", spanId = null, systemHidden = false, width = 100, widget = 0 } = {}) {
  const classes = new Set();
  // The machine's materialised field widgets. Live 2026-08-02: only the OPEN line
  // carries them and they are materialised PER CELL, which is why columnMinimums
  // measures per cell rather than per row. A number is one widget; an array is
  // several, so "the widest one wins" is measured rather than assumed, and an
  // array entry may be hostile (NaN, a string) to prove a bad offsetWidth cannot
  // poison the minimum.
  const widgets = (Array.isArray(widget) ? widget : [widget])
    .filter((size) => size !== 0)
    .map((size) => ({ offsetWidth: size }));
  return {
    nodeType: 1,
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
    classNames: () => Array.from(classes),
    querySelector: (selector) => (spanId && selector.includes("_fs") ? { id: spanId } : null),
    querySelectorAll: (selector) => (String(selector).includes("input") ? widgets : [])
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
    nodeType: 1,
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

function createTable(rows, { id = "item_splits", className = "uir-machine-table", container = null, form = null } = {}) {
  const table = {
    nodeType: 1,
    id,
    className,
    rows,
    isConnected: true,
    style: { tableLayout: "", width: "" },
    // The machine table answers to its id as well as its classes: a stub that
    // only matched classes would make `#item_splits` invisible to its own
    // container and hide real relevance behaviour.
    matches: (selector) => String(selector)
      .split(",")
      .some((part) => part.trim() === `#${id}` || classMatcher(className)(part)),
    // closest() starts at the element itself, so #item_splits is its own
    // nearest #item_splits — the runtime relies on that for target matching.
    closest: (selector) => {
      if (table.matches(selector)) {
        return table;
      }
      if (container?.matches?.(selector)) {
        return container;
      }
      return form?.matches?.(selector) ? form : null;
    },
    querySelector: (selector) => rows.find((row) => row.matches(selector)) ?? null,
    querySelectorAll: (selector) => rows.filter((row) => row.matches(selector))
  };
  container?.adopt?.(table);
  return table;
}

// Three data columns (item, quantity, rate) plus one NetSuite system cell that
// carries inline display:none — the extra <td> that breaks View Mode.
// `spans: false` is the read-only ?e=F shape: cells without the _fs widgets M2+
// resolves a materialised widget through. `duplicate: true` decodes two cells to
// one id. `form` carries the hidden {machine}fields / {machine}data inputs the
// M1.5 axis is decoded from; it defaults to null so a bare createMachine() is
// the M1 live condition — a machine whose axis cannot be read at all.
function createMachine({ lines = 2, className, container = null, spans = true, duplicate = false, form = null } = {}) {
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
    const spanId = (columnId) => (spans ? `item_${columnId}${line}_fs` : null);
    return createRow({
      id: `item_row_${line}`,
      className: "uir-machine-row",
      cells: [
        createCell({ text: `SKU-100${line}`, spanId: spanId("item") }),
        createCell({ text: String(line * 2), spanId: spanId(duplicate ? "item" : "quantity") }),
        createCell({ text: `$1${line}.00`, spanId: spanId("rate") }),
        createCell({ text: "sys", spanId: spanId("sys"), systemHidden: true })
      ]
    });
  });
  const buttonRow = createRow({ className: "machineButtonRow", cells: [createCell({ text: "OK Cancel" })] });
  const totalsRow = createRow({ className: "totalrow", cells: [createCell({ text: "Total" })] });
  return createTable([header, ...dataRows, buttonRow, totalsRow], {
    ...(className ? { className } : {}),
    container,
    form
  });
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
  assert.equal(core.AXIS_ATTRIBUTE, "data-suitemate-v3-edit-grid-axis");
  // Distinct attribute NAMES, not a prefix family: [data-suitemate-v3-edit-grid]
  // must not select a container carrying only the axis or bound stamp, or the
  // teardown sweep would remove the machine's own container.
  assert.equal(core.AXIS_ATTRIBUTE.startsWith(`${core.DATA_ATTRIBUTE}-`), true);
  assert.notEqual(core.AXIS_ATTRIBUTE, core.DATA_ATTRIBUTE);
  assert.notEqual(core.AXIS_ATTRIBUTE, core.BOUND_ATTRIBUTE);
  assert.equal(core.FOCUSED_ROW_SELECTOR, "tr.uir-machine-row-focused, tr.listfocusedrow");
  // Union of the spec's four names and the four src/styles/netsuite.css carries,
  // plus tr.uir-machine-row-last, observed live 2026-08-02 and in neither half.
  assert.equal(
    core.EXCLUDED_ROW_SELECTOR,
    "tr.machineButtonRow, tr.totalrow, tr.uir-machine-loading-row, tr.uir-machine-nodata-row, "
    + "tr.uir-machine-button-row, tr.uir-machine-totals-row, tr.uir-loading-row, tr.uir-nodata-row, "
    + "tr.uir-machine-row-last"
  );
  assert.equal(
    core.FOREIGN_NODE_SELECTOR,
    "[data-suitemate-v3-internal-id], [data-suitemate-v3-so-columns], [data-suitemate-v3-form-views], [data-suitemate-v3-edit-grid]"
  );
  // Every class this feature can put on a NetSuite node is pinned here: the
  // CSS file and the runtime both read them from CLASSES, so a rename that
  // misses one side fails this test instead of silently breaking a rule.
  assert.deepEqual(plain(core.CLASSES), {
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
    resizeEdge: "suitemate-v3-edit-grid-resize-edge",
    resizing: "suitemate-v3-edit-grid-resizing",
    sorted: "suitemate-v3-edit-grid-sorted"
  });
  assert.equal(Object.isFrozen(core.CLASSES), true);
  assert.equal(core.MAX_MACHINE_FIELDS, 400);
  assert.equal(core.MAX_SAMPLE_ROWS, 8);
  assert.equal(core.HEADER_LABEL_SELECTOR, "div.listheader");
  assert.equal(core.FIELD_DELIMITER, "\u0001");
  assert.equal(core.LINE_DELIMITER, "\u0002");
  assert.equal(core.OPTION_DELIMITER, "\u0005");
  // M1 froze 37 names; M1.5 adds exactly the thirteen the amendment enumerates,
  // and T6a adds ONE more — readColumnIdsFrom, 50 -> 51, sanctioned by
  // adjudication #13 as the fix for the live mini-form boundary failure.
  // M2-T0 adds ONE more — AXIS_ATTRIBUTE, 51 -> 52 — the checkpoint's MAIN-world
  // axis-evidence precondition (save/CHECKPOINTS.md "Next: M2 preconditions" #1).
  // M2 Task 11 adds TWO — columnMinimums and applyWidths, 52 -> 54 — the two names
  // the task brief's Step 4 sanctions ("Add `columnMinimums,` and `applyWidths,`
  // to the frozen export object beside `isOrderedMachine`").
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
    "DATA_ATTRIBUTE", "NATIVE_ROW_ATTRIBUTE", "BOUND_ATTRIBUTE", "AXIS_ATTRIBUTE",
    "FOREIGN_NODE_SELECTOR", "CLASSES",
    "clampWidth", "normalizeStored", "refusesNewerSchema", "withOrder", "withHidden", "withWidths",
    "machineIdFromTable", "rowLineNumber", "columnIdFromSpanId", "visibleCells", "tableRows",
    "headerRow", "isExcludedRow", "alignsToHeader", "isDataRow", "readColumnIds", "readColumnIdsFrom",
    "isOrderedMachine", "columnMinimums", "applyWidths",
    "parseMachineFieldData", "readMachineFieldData", "collapseDisplayTwins", "readHeaderLabels",
    "readSampleRowTexts", "labelAffinity", "correlateColumnIds"
  ]);
});

test("decodes column ids from _fs spans against the row's own line number", () => {
  const core = createApi();
  assert.equal(core.machineIdFromTable(createMachine()), "item");
  assert.equal(core.columnIdFromSpanId("item_quantity1_fs", "item", 1), "quantity");
  // Line 21 must not be mistaken for line 1 — the ambiguity that makes a naive
  // span[id$="1_fs"] scan decode "quantity2" on a paged machine.
  assert.equal(core.columnIdFromSpanId("item_quantity21_fs", "item", 21), "quantity");
  // A span whose trailing digits don't match the passed line is refused outright.
  // Passing the WRONG line truncates rather than refusing — line 1 against a line-21
  // span yields "quantity2" — which is exactly why every caller derives the line from
  // the row's own id instead of scanning for a hard-coded 1.
  assert.equal(core.columnIdFromSpanId("item_quantity21_fs", "item", 2), null);
  assert.equal(core.columnIdFromSpanId("item_custcol_abc21_fs", "item", 1), "custcol_abc2");
  assert.equal(core.columnIdFromSpanId("item_item1_fs_lbl", "item", 1), null);
  assert.equal(core.columnIdFromSpanId(null, "item", 1), null);
  assert.equal(core.columnIdFromSpanId(`item_${"x".repeat(201)}1_fs`, "item", 1), null);
  assert.equal(core.rowLineNumber(createMachine().rows[1], "item"), 1);
  assert.equal(core.rowLineNumber(createMachine().rows[2], "item"), 2);
  // The open line and the permanent entry row materialise line-LESS span ids
  // (item_item_fs, not item_item1_fs) — live 2026-08-02, probe 7. Passing an
  // explicit null line is how a caller says "this row has no line number".
  assert.equal(core.columnIdFromSpanId("item_item_fs", "item", null), "item");
  assert.equal(core.columnIdFromSpanId("item_custcol_rrp_fs", "item", null), "custcol_rrp");
  assert.equal(core.columnIdFromSpanId("actionbuttons_item_item_fs", "item", null),
    "actionbuttons_item_item", "an unrelated prefix is kept, not silently trimmed");
  assert.equal(core.columnIdFromSpanId("parent_actionbuttons_item_item_fs", "item", null),
    "parent_actionbuttons_item_item", "only a LEADING {machine}_ is stripped, and only once");
  assert.equal(core.columnIdFromSpanId("item_item1_fs", "item", null), "item1",
    "line-less mode does not strip digits — taxrate1 is a real column");
  assert.equal(core.columnIdFromSpanId("item_item_fs_lbl", "item", null), null);
  assert.equal(core.columnIdFromSpanId("", "item", null), null);
  assert.equal(core.columnIdFromSpanId(null, "item", null), null);
  // The numbered decode is UNCHANGED: a line-less span is refused when a line is
  // given, and a mismatched line still refuses rather than truncating.
  assert.equal(core.columnIdFromSpanId("item_item_fs", "item", 1), null);
  assert.equal(core.columnIdFromSpanId("item_quantity21_fs", "item", 2), null);
});

test("reads the column axis from visible cells only and ignores excluded rows", () => {
  const core = createApi();
  const table = createMachine();
  // M1.5: the axis no longer comes from _fs spans (spec Amendment A1.2). This
  // machine carries no {machine}fields input, so it declines — the M1 expectation
  // of ["item","quantity","rate"] from spans alone is the falsified mechanism.
  assert.deepEqual(plain(core.readColumnIds(table)), []);
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

test("refuses ordered machines, failing closed on anything unreadable", () => {
  const core = createApi();
  assert.equal(core.isOrderedMachine(createMachine()), false);
  assert.equal(core.isOrderedMachine(createMachine({ className: "uir-machine-table uir-draggable-table" })), true);
  assert.equal(core.isOrderedMachine(null), true);
});

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
  wrappedHeaders = true,
  // The live ancestry (m15-t6-live-capture.json: itemfieldsInMainForm true,
  // tableInsideMainForm FALSE): the table's own closest("form") is NetSuite's
  // machine mini-form, which carries no identity inputs at all. readColumnIds
  // must decline on it — that is the live MOUNT FAIL — while readColumnIdsFrom,
  // which is HANDED the values, must not care.
  miniForm = false
} = {}) {
  // dataValue: null omits the {machine}data input entirely, which is a different
  // machine from one whose input is present and empty. A1.2 refuses both.
  const form = createForm(miniForm ? {} : {
    itemfields: fieldsValue,
    ...(dataValue === null ? {} : { itemdata: dataValue })
  });
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
  // An empty data value PARSES — the field list alone is well-formed — but it is
  // not usable identity: A1.2's gate row requires at least one closed, numbered
  // data line, so readColumnIds refuses it. Pinned in the fails-closed test.
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
  // plain(): collapseDisplayTwins returns an array built inside the VM realm, so
  // deepStrictEqual against a host-realm literal fails on the prototype alone.
  assert.deepEqual(plain(mirrored), ["commitmentfirm", "orderallocationstrategy"]);
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

test("an empty raw value under a rendered cell is penalised, not excluded", () => {
  const core = createApi();
  // Constructed from live ids and live values, because the penalty is an
  // AGGREGATE effect: measured against the real payload it is load-bearing at 22
  // labels and above — with the penalty at 0 the full 43-label correlation stops
  // being unique and declines — but the twelve-label slice above resolves either
  // way. `rateschedule` holds "" on every line of SO 16342809, so it can absorb
  // any label whose cell renders text unless it is pushed below the true column.
  const parsed = core.parseMachineFieldData(
    ["item_display", "item", "rateschedule", "marginal"].join(SOH),
    ["MCH376", "4998", "", "F"].join(SOH)
  );
  const columns = core.collapseDisplayTwins(parsed.fieldIds, parsed.lines);
  assert.deepEqual(plain(columns.map((column) => column.id)), ["item", "rateschedule", "marginal"]);
  // Neither label has any affinity to rateschedule or marginal, so the empty raw
  // value is the ONLY thing separating them: penalised, `marginal` wins outright.
  assert.deepEqual(
    plain(core.correlateColumnIds(["Item", "Oversell?"], columns, [["MCH376", "Yes"]])),
    ["item", "marginal"]
  );
  // A penalty, never an exclusion: rateschedule stays reachable, which is what
  // keeps a render transform we have not modelled from hiding the true field.
  assert.deepEqual(
    plain(core.correlateColumnIds(["Item", "Schedule"], columns, [["MCH376", "Yes"]])),
    ["item", "rateschedule"]
  );
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
  // The emitted axis is the NORMALIZED id, not the raw {machine}fields token:
  // validating through normalizeColumnId while emitting the raw string lets a
  // padded entry key storage under " rate " while every other core entry point
  // stores "rate" — the same column under two keys (T1 review, minor 2).
  assert.deepEqual(
    plain(core.readColumnIds(createLiveMachine({
      fieldsValue: LIVE_FIELDS.map((id) => (id === "rate" ? " rate " : id)).join(SOH)
    }))),
    LIVE_AXIS
  );
});

test("readColumnIds fails closed on every unusable machine", () => {
  const core = createApi();
  // No hidden inputs at all — the M1 live condition, and still a clean decline.
  assert.deepEqual(plain(core.readColumnIds(createMachine())), []);
  assert.deepEqual(plain(core.readColumnIds(createLiveMachine({ fieldsValue: "" }))), []);
  assert.deepEqual(plain(core.readColumnIds(createLiveMachine({ dataValue: `a${SOH}b` }))), []);
  // A1.2 gate row "no {machine}fields / {machine}data input", plus its
  // requirement of at least one closed, numbered data line. Both shapes of a
  // missing line set refuse: the input absent, and the input present but empty.
  // The machine below is deliberately NARROW — six field ids collapsing to five
  // candidates against three labels — because label affinity alone has a unique
  // optimum there ("item","quantity","rate"). On the twelve-label live slice the
  // ambiguity gate fires regardless, so only a machine this narrow can prove the
  // data-line refusal is load-bearing rather than incidental. Without it the
  // feature would key storage on header text, which is what A1.2 exists to refuse.
  const narrowFields = ["item_display", "item", "olditemid", "quantity", "rate", "amount"].join(SOH);
  for (const dataValue of [null, ""]) {
    assert.deepEqual(
      plain(core.readColumnIds(createLiveMachine({
        fieldsValue: narrowFields,
        dataValue,
        labels: ["Item", "Quantity", "Rate"],
        rows: []
      }))),
      [],
      `narrow machine, {machine}data ${dataValue === null ? "absent" : "present but empty"}`
    );
  }
  // An empty header label is unusable: the live census found 43 labels, 0 empty.
  const blanked = LIVE_LABELS.slice();
  blanked[4] = "";
  assert.deepEqual(plain(core.readColumnIds(createLiveMachine({ labels: blanked }))), []);
  // No rendered lines: correlation is ambiguous, so the feature declines.
  assert.deepEqual(plain(core.readColumnIds(createLiveMachine({ rows: [] }))), []);
  assert.deepEqual(plain(core.readColumnIds(null)), []);
  assert.deepEqual(plain(core.readColumnIds({})), []);
});

test("readColumnIdsFrom derives the axis across the mini-form boundary", () => {
  const core = createApi();
  // The live shape, and the live failure: the table's own form holds NOTHING, so
  // the form-scoped entry declines while the value-taking entry resolves the
  // identical axis. This is the whole of adjudication #13 in two assertions.
  const machine = createLiveMachine({ miniForm: true });
  assert.deepEqual(plain(core.readColumnIds(machine)), [], "the mini-form route cannot reach the inputs");
  assert.deepEqual(plain(core.readColumnIdsFrom(machine, LIVE_FIELDS_VALUE, LIVE_DATA_VALUE)), LIVE_AXIS);
  // Same derivation, same answer, whether or not the form happens to be reachable:
  // the entry never consults the form at all.
  assert.deepEqual(
    plain(core.readColumnIdsFrom(createLiveMachine(), LIVE_FIELDS_VALUE, LIVE_DATA_VALUE)),
    LIVE_AXIS
  );
  // Both header shapes read, exactly as through readColumnIds.
  assert.deepEqual(
    plain(core.readColumnIdsFrom(
      createLiveMachine({ miniForm: true, wrappedHeaders: false }), LIVE_FIELDS_VALUE, LIVE_DATA_VALUE
    )),
    LIVE_AXIS
  );
  // An open first line contributes no text; the axis still resolves from line 2.
  assert.deepEqual(
    plain(core.readColumnIdsFrom(
      createLiveMachine({ miniForm: true, focusedRowIndex: 0 }), LIVE_FIELDS_VALUE, LIVE_DATA_VALUE
    )),
    LIVE_AXIS
  );
  // The emitted axis is the NORMALIZED id, never the raw {machine}fields token.
  assert.deepEqual(
    plain(core.readColumnIdsFrom(
      machine, LIVE_FIELDS.map((id) => (id === "rate" ? " rate " : id)).join(SOH), LIVE_DATA_VALUE
    )),
    LIVE_AXIS
  );
});

test("readColumnIdsFrom fails closed on every gate readColumnIds does", () => {
  const core = createApi();
  const from = (fieldsValue, dataValue, options = {}) =>
    plain(core.readColumnIdsFrom(createLiveMachine({ miniForm: true, ...options }), fieldsValue, dataValue));
  // Absent and empty values — the shape the runtime's own fallback branch turns
  // on, asserted here so a caller that hands nulls through can never mount.
  assert.deepEqual(from(null, null), []);
  assert.deepEqual(from(undefined, undefined), []);
  assert.deepEqual(from("", LIVE_DATA_VALUE), []);
  assert.deepEqual(from(LIVE_FIELDS_VALUE, null), [], "no data lines at all");
  assert.deepEqual(from(LIVE_FIELDS_VALUE, ""), [], "the input is present but empty");
  // A1.2's data-line requirement is load-bearing only on a machine narrow enough
  // for label affinity alone to have a unique optimum — same construction as the
  // readColumnIds gate test, so both entries are measured on the same machine.
  const narrowFields = ["item_display", "item", "olditemid", "quantity", "rate", "amount"].join(SOH);
  for (const dataValue of [null, ""]) {
    assert.deepEqual(
      from(narrowFields, dataValue, { labels: ["Item", "Quantity", "Rate"], rows: [] }),
      [],
      `narrow machine, {machine}data ${dataValue === null ? "absent" : "present but empty"}`
    );
  }
  // parseMachineFieldData's own gates reach through unchanged.
  assert.deepEqual(from(LIVE_FIELDS_VALUE, `a${SOH}b`), [], "ragged line");
  assert.deepEqual(from(["a", "a"].join(SOH), ["1", "2"].join(SOH)), [], "duplicate field id");
  assert.deepEqual(from("solo", "1"), [], "single field");
  assert.deepEqual(from(`a${SOH}`, `1${SOH}2`), [], "empty field id");
  // Ambiguity: an unrecognised locale carries no label affinity anywhere.
  assert.deepEqual(
    from(LIVE_FIELDS_VALUE, LIVE_DATA_VALUE, { labels: LIVE_LABELS.map((_, index) => `Colonne ${index}`) }),
    []
  );
  // A blank header label, and a header narrower than two columns.
  const blanked = LIVE_LABELS.slice();
  blanked[4] = "";
  assert.deepEqual(from(LIVE_FIELDS_VALUE, LIVE_DATA_VALUE, { labels: blanked }), []);
  assert.deepEqual(from(LIVE_FIELDS_VALUE, LIVE_DATA_VALUE, { labels: ["Item"], rows: [["MCH376"]] }), []);
  // No rendered lines: correlation is ambiguous, so the feature declines.
  assert.deepEqual(from(LIVE_FIELDS_VALUE, LIVE_DATA_VALUE, { rows: [] }), []);
  // An unusable or hostile table fails closed rather than escaping.
  assert.deepEqual(plain(core.readColumnIdsFrom(null, LIVE_FIELDS_VALUE, LIVE_DATA_VALUE)), []);
  assert.deepEqual(plain(core.readColumnIdsFrom({}, LIVE_FIELDS_VALUE, LIVE_DATA_VALUE)), []);
  assert.deepEqual(
    plain(core.readColumnIdsFrom(
      { querySelector() { throw new Error("boom"); } }, LIVE_FIELDS_VALUE, LIVE_DATA_VALUE
    )),
    []
  );
});

test("clampWidth refuses a non-numeric width and honours the per-column floor", () => {
  const core = createApi();
  // normalizeWidths screens with Number.isFinite before it clamps, so these are
  // M2's DIRECT callers: a measured getBoundingClientRect on a detached cell, a
  // "" style.width, a parsed data attribute. Every one of them can hand over a
  // non-number, and NaN survives Math.max/Math.min silently — the poisoned width
  // only surfaces as `style.width = "NaNpx"` on a real cell.
  for (const hostile of [NaN, "abc", "", null, undefined, {}, [1, 2], Infinity, -Infinity]) {
    assert.equal(
      core.clampWidth(hostile, core.ABSOLUTE_MIN_COLUMN_WIDTH),
      core.ABSOLUTE_MIN_COLUMN_WIDTH,
      `clampWidth(${JSON.stringify(hostile)}) did not fail closed onto the minimum`
    );
  }
  // A refusal lands on the FLOOR THAT APPLIES, not on the static one: a column
  // whose own minimum is larger wins, and the cap still bounds it.
  assert.equal(core.clampWidth("abc", 120), 120);
  assert.equal(core.clampWidth(NaN, 5000), core.MAX_COLUMN_WIDTH);
  // The minimum parameter is the per-column floor, and it beats the static 50
  // only when it is larger — a caller may never lower the absolute minimum.
  assert.equal(core.clampWidth(60, 120), 120);
  assert.equal(core.clampWidth(200, 120), 200);
  assert.equal(core.clampWidth(10, 20), core.ABSOLUTE_MIN_COLUMN_WIDTH);
  assert.equal(core.clampWidth(10, undefined), core.ABSOLUTE_MIN_COLUMN_WIDTH);
  // Ordinary clamping is unchanged: cap, floor, rounding, numeric strings.
  assert.equal(core.clampWidth(5000, core.ABSOLUTE_MIN_COLUMN_WIDTH), core.MAX_COLUMN_WIDTH);
  assert.equal(core.clampWidth(120.4, core.ABSOLUTE_MIN_COLUMN_WIDTH), 120);
  assert.equal(core.clampWidth("120.6", core.ABSOLUTE_MIN_COLUMN_WIDTH), 121);
  assert.equal(core.clampWidth(-40, core.ABSOLUTE_MIN_COLUMN_WIDTH), core.ABSOLUTE_MIN_COLUMN_WIDTH);
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

test("quota eviction spares other scopes on a clearing write and refuses an oversized entry", () => {
  const core = createApi();
  const size = (value) => new TextEncoder().encode(`${core.STORAGE_KEY}${JSON.stringify(value)}`).length;
  // A clearing write only ever shrinks the container, so eviction must not run:
  // evicting here would destroy every other scope's layout on a single delete.
  const crowded = { schemaVersion: 1, grids: {} };
  for (let index = 0; index < 187; index += 1) {
    crowded.grids[`scope${index}`] = { order: ["item", "quantity", "rate"] };
  }
  assert.equal(size(crowded) > core.MAX_SYNC_ITEM_BYTES, true);
  const cleared = core.withOrder(crowded, "scope5", null);
  assert.equal("scope5" in cleared.grids, false);
  assert.equal(Object.keys(cleared.grids).length, 186);
  assert.deepEqual(plain(cleared.grids.scope0), { order: ["item", "quantity", "rate"] });
  assert.deepEqual(plain(cleared.grids.scope186), { order: ["item", "quantity", "rate"] });
  // An entry that alone exceeds the cap is refused through the same channel as
  // every other writer failure, never returned as a success storage would reject.
  const oversized = Array.from({ length: 100 }, (_, index) => String(index).padEnd(200, "c"));
  assert.equal(core.withOrder(undefined, "1:2:salesord:edit", oversized), null);
  assert.equal(core.withHidden(undefined, "1:2:salesord:edit", oversized), null);
});

// ===== M2: width planning =====
test("derives a per-column minimum from the widest widget in that column", () => {
  const core = createApi();
  const table = createMachine();
  // Live 2026-08-02: static cells are bare text and widgets are materialised PER
  // CELL on the open line only, so the minimum is measured cell by cell across
  // every aligned row rather than read off one designated row.
  table.rows[1].cells[1] = createCell({ text: "2", spanId: "item_quantity1_fs", widget: 180 });
  // The WIDEST across rows survives, not the last one seen.
  table.rows[2].cells[1] = createCell({ text: "4", spanId: "item_quantity2_fs", widget: 90 });
  // A cell may materialise more than one widget — a field plus its popup trigger.
  // A hostile offsetWidth contributes 0, never NaN: a poisoned minimum would come
  // back out of clampWidth as the floor for every column that shares it.
  table.rows[1].cells[2] = createCell({ text: "$11.00", widget: [40, 120, NaN, "abc"] });
  // A header widget is never a column minimum: the header row is skipped outright.
  table.rows[0].cells[1] = createCell({ text: "Quantity", widget: 999 });
  // A row that does not align to the header is skipped, so a ragged row caught
  // mid-repaint cannot contribute a 900px floor to a column it is not under.
  table.rows.push(createRow({
    id: "item_row_9",
    className: "uir-machine-row",
    cells: [createCell({ text: "?" }), createCell({ text: "?", widget: 900 })]
  }));

  const columnIds = ["item", "quantity", "rate"];
  assert.deepEqual(plain(core.columnMinimums(table, columnIds)), { item: 0, quantity: 180, rate: 120 });
  // Every id on the axis is present, including the ones with no widget at all —
  // applyWidths indexes this map positionally and a hole would read as undefined.
  assert.deepEqual(Object.keys(core.columnMinimums(table, columnIds)), columnIds);
  // The button row and the totals row carry one cell each, so alignsToHeader
  // already excludes them; this pins that they are counted by nobody.
  assert.equal(core.columnMinimums(table, columnIds).item, 0);
  // Fail closed on an unusable axis and on an unreadable table — never throw.
  assert.deepEqual(plain(core.columnMinimums(table, [])), {});
  assert.deepEqual(plain(core.columnMinimums(table, null)), {});
  assert.deepEqual(plain(core.columnMinimums(table, "item,quantity")), {});
  assert.deepEqual(plain(core.columnMinimums(null, columnIds)), { item: 0, quantity: 0, rate: 0 });
  assert.deepEqual(plain(core.columnMinimums({}, columnIds)), { item: 0, quantity: 0, rate: 0 });
});

test("applies widths to header cells only, clamped per column, and restores on clear", () => {
  const core = createApi();
  const table = createMachine();
  table.rows[1].cells[1] = createCell({ text: "2", spanId: "item_quantity1_fs", widget: 180 });
  // The axis is HANDED to core, never derived inside it: core's only route to the
  // identity inputs is table.closest("form"), which live lands in NetSuite's
  // machine mini-form and holds nothing (M1.5), and re-deriving under a
  // permutation is never correct (spec A1.2 rule 3). runtime applyAll holds the
  // pin and passes it. Pinned as a behaviour in the next test.
  const columnIds = ["item", "quantity", "rate"];
  const minimums = core.columnMinimums(table, columnIds);
  assert.deepEqual(plain(minimums), { item: 0, quantity: 180, rate: 0 });

  assert.equal(core.applyWidths(table, { item: 240, quantity: 60, rate: 20 }, minimums, columnIds), true);
  const header = core.visibleCells(table.rows[0]);
  // 240 as stored; quantity floored at its 180px widget, never at 30 or 50;
  // rate floored at the absolute 50px input floor.
  assert.deepEqual(plain(header.map((cell) => cell.style.width)), ["240px", "180px", "50px"]);
  assert.equal(table.style.tableLayout, "fixed");
  // table.style.width is left unset so the machine keeps its own sizing.
  assert.equal(table.style.width, "");
  // Body cells are never touched: fixed layout makes row 1 authoritative.
  assert.deepEqual(plain(core.visibleCells(table.rows[1]).map((cell) => cell.style.width)), ["", "", ""]);
  // The system cells are off the axis and never receive a width, in either row.
  assert.equal(table.rows[0].cells[3].style.width, "");
  assert.equal(table.rows[1].cells[3].style.width, "");

  // EVERY column is frozen, not just the stored ones: a column with no stored
  // width takes its currently rendered width, which is what makes the flip to
  // fixed layout pixel-identical instead of a reflow.
  assert.equal(core.applyWidths(table, { quantity: 300 }, minimums, columnIds), true);
  assert.deepEqual(plain(header.map((cell) => cell.style.width)), ["100px", "300px", "100px"]);
  // A hostile stored width falls back to that same rendered freeze rather than
  // to "NaNpx" or to an unfrozen column — Number(null) is 0, not absent.
  assert.equal(core.applyWidths(table, { item: "abc", quantity: null, rate: 240 }, minimums, columnIds), true);
  assert.deepEqual(plain(header.map((cell) => cell.style.width)), ["100px", "180px", "240px"]);

  // Clearing restores the native layout, and needs no axis: teardown calls it
  // with three arguments after the pin has already been dropped.
  assert.equal(core.applyWidths(table, null, minimums, columnIds), true);
  assert.deepEqual(plain(header.map((cell) => cell.style.width)), ["", "", ""]);
  assert.equal(table.style.tableLayout, "");
  assert.equal(core.applyWidths(table, { item: 240 }, minimums, columnIds), true);
  assert.equal(core.applyWidths(table, {}, minimums, columnIds), true, "an empty width set clears too");
  assert.deepEqual(plain(header.map((cell) => cell.style.width)), ["", "", ""]);
  assert.equal(core.applyWidths(table, { item: 240 }, minimums, columnIds), true);
  assert.equal(core.applyWidths(table, null, {}), true, "the teardown call shape carries no axis");
  assert.deepEqual(plain(header.map((cell) => cell.style.width)), ["", "", ""]);
  assert.equal(table.style.tableLayout, "");

  // Fail closed, and write NOTHING when refusing.
  assert.equal(core.applyWidths(null, { item: 100 }, {}, columnIds), false);
  assert.equal(core.applyWidths(undefined, { item: 100 }, {}, columnIds), false);
  assert.equal(core.applyWidths({}, { item: 100 }, {}, columnIds), false, "a table with no header row");
  // An ACTIVE apply with no usable axis is refused outright — never re-derived.
  assert.equal(core.applyWidths(table, { item: 100 }, {}), false, "no axis");
  assert.equal(core.applyWidths(table, { item: 100 }, {}, []), false, "empty axis");
  assert.equal(core.applyWidths(table, { item: 100 }, {}, "item,quantity,rate"), false, "not an array");
  // An axis that does not align to the visible header cannot be indexed onto it.
  assert.equal(core.applyWidths(table, { item: 100 }, {}, ["item", "quantity"]), false, "short axis");
  assert.equal(
    core.applyWidths(table, { item: 100 }, {}, ["item", "quantity", "rate", "sys"]),
    false,
    "an axis counting the hidden system cell"
  );
  assert.deepEqual(plain(header.map((cell) => cell.style.width)), ["", "", ""]);
  assert.equal(table.style.tableLayout, "");
});

test("applyWidths keys widths by the axis it is handed, never by one it derives", () => {
  const core = createApi();
  const table = createLiveMachine();
  // This machine's own hidden inputs DO decode through core, so a re-deriving
  // implementation would find a perfectly good — and wrong — axis here.
  assert.deepEqual(plain(core.readColumnIds(table)), LIVE_AXIS);
  // The M4 condition: a stored non-native order is applied, so the pin says
  // visible column 0 is now "rate". Re-deriving would key 240px onto "item" and
  // silently resize the wrong column (spec A1.2 rule 3, measured never-correct).
  const permuted = [LIVE_AXIS[11], ...LIVE_AXIS.slice(0, 11)];
  assert.equal(core.applyWidths(table, { rate: 240 }, {}, permuted), true);
  const header = core.visibleCells(table.rows[0]);
  assert.equal(header[0].style.width, "240px", "the handed axis governs, not the derivable one");
  assert.equal(header[11].style.width, "100px", "the natively-eleventh column is not the one resized");
  assert.deepEqual(plain(header.slice(1).map((cell) => cell.style.width)), new Array(11).fill("100px"));
});

test("core has no DOM, storage, bridge or network authority", () => {
  assert.doesNotMatch(source, /document\.|chrome\.|fetch\(|XMLHttpRequest|innerHTML|localStorage|sessionStorage/);
  assert.doesNotMatch(source, /suiteMateV3ColumnOrder/);
  assert.doesNotMatch(source, /SuiteMateV3SoColumnsCore/);
});

// ===== Runtime harness =====
// The runtime is an IIFE with no exports. Its seams are reached the way
// production reaches them: through the registration handed to
// SuiteMateV3Lifecycle.register and through the storage change listener.
const EDIT_STORAGE_KEY = "suiteMateV3EditColumns";
const SETTINGS_STORAGE_KEY = "suiteMateV3Style";
const DATA_ATTRIBUTE = "data-suitemate-v3-edit-grid";
const BOUND_ATTRIBUTE = "data-suitemate-v3-edit-grid-bound";
const AXIS_ATTRIBUTE = "data-suitemate-v3-edit-grid-axis";
const RECORD_PATH = "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl";
const EDIT_URL = `${RECORD_PATH}?id=16342809&e=T`;
const READ_ONLY_EDIT_URL = `${RECORD_PATH}?id=16342809&e=F`;
const VIEW_URL = `${RECORD_PATH}?id=16342809`;
const SESSION_SRC = "/javascript/sessionstatus/session_status_init.jsp?companyId=FIXTURE&id=FIXTURE~2462~3~N";

function ownedMatch(node, selector) {
  const wanted = /\[data-suitemate-v3-edit-grid(?:="([^"]*)")?\]/.exec(String(selector));
  const value = node.getAttribute(DATA_ATTRIBUTE);
  return Boolean(wanted) && value !== null && (wanted[1] === undefined || wanted[1] === value);
}

function createOwnedNode(tagName) {
  const attributes = new Map();
  const node = {
    nodeType: 1,
    tagName,
    hidden: false,
    parent: null,
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    matches: (selector) => ownedMatch(node, selector),
    closest: (selector) => (ownedMatch(node, selector) ? node : null),
    querySelector: () => null,
    remove() {
      node.parent?.removeChild(node);
      node.parent = null;
    }
  };
  return node;
}

function createContainer() {
  const attributes = new Map();
  const children = [];
  const listeners = [];
  // The machine table is a descendant of the container in the real DOM
  // (tests/fixtures/sales-order.html:118-119), so the container must be able to
  // find it — otherwise `isMachineNode(container)` reads false in the stub and
  // true in production.
  let machine = null;
  const container = {
    adopt(table) {
      machine = table;
    },
    nodeType: 1,
    children,
    listeners,
    matches: (selector) => String(selector).includes("uir-machine-table-container"),
    closest: (selector) => (container.matches(selector) ? container : null),
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    hasAttribute: (name) => attributes.has(name),
    removeAttribute: (name) => attributes.delete(name),
    append(node) {
      node.parent = container;
      children.push(node);
    },
    removeChild(node) {
      const at = children.indexOf(node);
      if (at >= 0) {
        children.splice(at, 1);
      }
    },
    querySelector(selector) {
      const owned = children.find((child) => child.matches(selector));
      if (owned) {
        return owned;
      }
      if (machine?.matches(selector)) {
        return machine;
      }
      return machine?.querySelector(selector) ?? null;
    },
    querySelectorAll: (selector) => children.filter((child) => child.matches(selector)),
    addEventListener(type, handler, options) {
      listeners.push({ type, handler, options });
    },
    removeEventListener(type, handler, options) {
      const at = listeners.findIndex((entry) =>
        entry.type === type && entry.handler === handler && entry.options === options);
      if (at >= 0) {
        listeners.splice(at, 1);
      }
    }
  };
  return container;
}

function createLifecycleStub() {
  let registration = null;
  let controller = null;
  let generation = 0;
  let active = false;
  let lastRun = Promise.resolve();
  let evaluations = 0;
  let disposals = 0;
  let lastResult = null;

  function run(reason = "initial") {
    if (!registration || !active) {
      return Promise.resolve();
    }
    const runGeneration = generation;
    evaluations += 1;
    lastRun = Promise.resolve(registration.evaluate({
      id: registration.id,
      reason,
      records: [],
      signal: controller.signal,
      isCurrent: () => active && generation === runGeneration && !controller.signal.aborted
    })).then((result) => {
      lastResult = result;
      return result;
    });
    return lastRun;
  }

  return {
    register(config) {
      registration = config;
      controller = new AbortController();
      active = config.startPaused !== true;
      generation += 1;
      if (active) {
        void run("initial");
      }
      return {
        pause(reason = "paused") {
          if (!active) {
            return false;
          }
          active = false;
          generation += 1;
          controller.abort(reason);
          registration.cleanup?.({ id: registration.id, reason });
          return true;
        },
        resume(reason = "resumed") {
          if (active) {
            return false;
          }
          active = true;
          generation += 1;
          controller = new AbortController();
          void run(reason);
          return true;
        },
        dispose(reason = "disposed") {
          active = false;
          generation += 1;
          disposals += 1;
          registration.cleanup?.({ id: registration.id, reason });
          return true;
        }
      };
    },
    run,
    get registration() {
      return registration;
    },
    get lastRun() {
      return lastRun;
    },
    get evaluations() {
      return evaluations;
    },
    get disposals() {
      return disposals;
    },
    get lastResult() {
      return lastResult;
    }
  };
}

function createLocation(value) {
  const url = new URL(value);
  return {
    href: url.href,
    origin: url.origin,
    hostname: url.hostname,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash
  };
}

// The hidden inputs the harness machine decodes its axis from. Six field ids
// collapse to five candidates (item_display/item is a display twin) against the
// three header labels Item/Quantity/Rate, so the monotonic optimum is unique.
// `olditemid` is carried deliberately: it is the live payload's proof that the
// bookkeeping-mirror rule is narrow, and it must not disturb the alignment.
const HARNESS_FIELDS = ["item_display", "item", "olditemid", "quantity", "rate", "amount"];
const HARNESS_LINES = [
  ["SKU-1001", "4998", "4998", "2", "11.00", "22.00"],
  ["SKU-1002", "1405", "1405", "4", "12.00", "48.00"]
];
const HARNESS_FIELDS_VALUE = HARNESS_FIELDS.join(SOH);
const HARNESS_DATA_VALUE = HARNESS_LINES.map((values) => values.join(SOH)).join(STX);

function createRuntimeHarness({
  url = EDIT_URL,
  settings = { salesOrderColumnsEdit: true },
  stored,
  machine = {},
  // null omits the hidden inputs entirely, which is how a harness models a
  // machine whose axis cannot be decoded.
  machineFields = HARNESS_FIELDS_VALUE,
  machineData = HARNESS_DATA_VALUE,
  // Where the identity inputs live, which is the whole of the T6a fix:
  //   false        — inside the table's own ancestor form (every pre-T6a test)
  //   "main-form"  — the LIVE shape: the table's form is NetSuite's empty
  //                  mini-form and the inputs sit in #main_form, which does not
  //                  contain the table (m15-t6-live-capture.json)
  //   "unscoped"   — in the document but with no #main_form at all: the
  //                  runtime's bare-name fallback
  //   "orphaned"   — nowhere reachable: the live MOUNT FAIL, modelled
  inputsAt = false,
  sessionSrc = SESSION_SRC,
  readError = null,
  holdRead = false
} = {}) {
  const container = createContainer();
  const form = machineFields === null
    ? null
    : createForm(inputsAt === false ? { itemfields: machineFields, itemdata: machineData } : {});
  const documentInputs = machineFields !== null && (inputsAt === "main-form" || inputsAt === "unscoped")
    ? { itemfields: machineFields, itemdata: machineData }
    : null;
  const table = machine ? createMachine({ ...machine, container, form }) : null;
  const counts = { editReads: 0, settingsReads: 0, writes: 0 };
  const toasts = [];
  const errors = [];
  const storageListeners = [];
  const windowListeners = [];
  const lifecycle = createLifecycleStub();
  const location = createLocation(url);
  let settingsValue = settings;
  let releaseRead = null;
  const readGate = holdRead ? new Promise((done) => { releaseRead = done; }) : null;

  const sandbox = {
    URL,
    URLSearchParams,
    TextEncoder,
    location,
    document: {
      readyState: "complete",
      documentElement: { dataset: {} },
      querySelector(selector) {
        if (selector === "#item_splits") {
          return table;
        }
        if (selector.startsWith("script[")) {
          return sessionSrc ? { src: `${location.origin}${sessionSrc}` } : null;
        }
        // The document-scoped identity inputs the runtime resolves before it
        // asks core. The #main_form-scoped selector answers only when the page
        // has a #main_form holding them; the bare-name selector is the fallback.
        const scoped = /^#main_form input\[type="hidden"\]\[name="([^"]+)"\]$/.exec(selector);
        if (scoped) {
          return inputsAt === "main-form" && documentInputs && scoped[1] in documentInputs
            ? { value: documentInputs[scoped[1]] }
            : null;
        }
        const bare = /^input\[name="([^"]+)"\]$/.exec(selector);
        if (bare) {
          return documentInputs && bare[1] in documentInputs ? { value: documentInputs[bare[1]] } : null;
        }
        return null;
      },
      querySelectorAll: (selector) => container.querySelectorAll(selector),
      createElement: (tagName) => createOwnedNode(tagName),
      addEventListener() {}
    },
    chrome: {
      runtime: {},
      storage: {
        sync: {
          async get(key) {
            if (key === EDIT_STORAGE_KEY) {
              counts.editReads += 1;
              if (readError) {
                throw readError;
              }
              await readGate;
              return { [key]: stored };
            }
            counts.settingsReads += 1;
            return { [key]: settingsValue };
          },
          async set() {
            counts.writes += 1;
          }
        },
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          }
        }
      }
    },
    console: {
      error(...args) {
        errors.push(args);
      }
    },
    SuiteMateV3Lifecycle: lifecycle,
    SuiteMateV3Notifications: {
      showToast(message, options) {
        toasts.push({ message, type: options?.type });
      }
    },
    addEventListener(type, handler) {
      windowListeners.push({ type, handler });
    },
    setTimeout,
    clearTimeout
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  runInNewContext(sharedSources["src/shared/utilities.js"], sandbox);
  runInNewContext(sharedSources["src/shared/routes.js"], sandbox);
  runInNewContext(sharedSources["src/shared/settings.js"], sandbox);
  runInNewContext(source, sandbox);
  runInNewContext(runtimeSource, sandbox);

  const harness = {
    container,
    table,
    counts,
    toasts,
    errors,
    lifecycle,
    windowListeners,
    // tick() drains microtasks without awaiting the install: an install parked
    // on a held storage read would deadlock flush().
    async tick(rounds = 4) {
      for (let index = 0; index < rounds; index += 1) {
        await new Promise((done) => setImmediate(done));
      }
    },
    async flush() {
      await harness.tick();
      await lifecycle.lastRun;
    },
    async run(reason = "mutation") {
      await lifecycle.run(reason);
      await harness.tick();
    },
    async changeSettings(next, areaName = "sync") {
      settingsValue = next;
      for (const listener of storageListeners) {
        listener({ [SETTINGS_STORAGE_KEY]: { newValue: next } }, areaName);
      }
      await harness.tick();
    },
    releaseRead: () => releaseRead?.(),
    pagehide: (persisted) =>
      windowListeners.filter(({ type }) => type === "pagehide").forEach(({ handler }) => handler({ persisted })),
    mounts: () => container.querySelectorAll(`[${DATA_ATTRIBUTE}]`)
  };
  return harness;
}

function assertNotMounted(harness, message) {
  assert.equal(harness.container.children.length, 0, `${message}: a node was mounted`);
  assert.equal(harness.container.hasAttribute(BOUND_ATTRIBUTE), false, `${message}: the container was stamped`);
  // The axis stamp is the ONLY thing this feature leaves on a node it does not
  // own, and the owned-node sweep cannot reach it — every teardown path has to
  // take it off by name or a torn-down page keeps advertising a live axis.
  assert.equal(harness.container.hasAttribute(AXIS_ATTRIBUTE), false, `${message}: the axis stamp survived`);
  assert.equal(harness.container.listeners.length, 0, `${message}: a listener was bound`);
  assert.equal(harness.counts.writes, 0, `${message}: storage was written`);
}

test("registers paused against the edit capability with a synchronous cleanup", async () => {
  const harness = createRuntimeHarness({ settings: { salesOrderColumnsEdit: false } });
  await harness.flush();
  const registration = harness.lifecycle.registration;
  assert.equal(registration.id, "record.edit-grid");
  assert.equal(registration.capability, "transaction-column-personalization-edit");
  assert.equal(registration.replace, true);
  assert.equal(registration.startPaused, true);
  assert.deepEqual(plain(registration.observe), { childList: true, subtree: true });
  // lifecycle.js:479-481 throws at register() when cleanup is declared async.
  assert.equal(registration.cleanup.constructor.name, "Function");
  assert.equal(registration.cleanup({ reason: "test" }), undefined);
  assert.deepEqual(harness.windowListeners.map(({ type }) => type), ["pagehide"]);
  // Default-off: the watcher never evaluates and the page is never touched.
  assert.equal(harness.lifecycle.evaluations, 0);
  assert.equal(harness.counts.editReads, 0);
  assertNotMounted(harness, "settings off");
});

test("never registers on a View Mode record", async () => {
  const harness = createRuntimeHarness({ url: VIEW_URL });
  await harness.flush();
  assert.equal(harness.lifecycle.registration, null);
  assert.equal(harness.counts.settingsReads, 0);
  assertNotMounted(harness, "view mode");
});

test("declines to install when the machine table is absent", async () => {
  const harness = createRuntimeHarness({ machine: null });
  await harness.flush();
  assert.equal(harness.lifecycle.evaluations, 1);
  assert.equal(harness.lifecycle.lastResult, false);
  assert.equal(harness.counts.editReads, 0, "storage was read before the machine was confirmed");
  assertNotMounted(harness, "no machine table");
});

test("declines to install on a read-only edit page whose column axis cannot be decoded", async () => {
  // ?e=F satisfies the route rule by design, so the install path is the only
  // gate: no decodable {machine}fields input means no column identity, and
  // identity is mandatory. Whether a real ?e=F page actually omits those hidden
  // inputs was NOT probed — this asserts the decline, never the ?e=F shape.
  const harness = createRuntimeHarness({
    url: READ_ONLY_EDIT_URL,
    machine: { spans: false },
    machineFields: null
  });
  await harness.flush();
  assert.equal(harness.lifecycle.evaluations, 1);
  assert.equal(harness.lifecycle.lastResult, false);
  assert.equal(harness.counts.editReads, 0);
  assert.equal(harness.errors.length, 0, "a fail-closed decline is not an error");
  assertNotMounted(harness, "undecodable axis");
});

test("declines to install when the decoded axis carries duplicate ids", async () => {
  // M1.5 moves the duplicate check to the field list itself: a {machine}fields
  // input naming one id twice is refused by parseMachineFieldData before any
  // correlation runs, so the axis is never decoded and the install declines.
  const harness = createRuntimeHarness({
    machine: { duplicate: true },
    machineFields: ["item_display", "item", "olditemid", "quantity", "quantity", "amount"].join(SOH)
  });
  await harness.flush();
  assert.equal(harness.lifecycle.lastResult, false);
  assert.equal(harness.counts.editReads, 0);
  assertNotMounted(harness, "duplicate ids");
});

test("mounts across the mini-form boundary, and declines when nothing holds the inputs", async () => {
  // The live 2026-08-03 failure, and its fix, at the runtime seam. NetSuite
  // wraps the machine in form[name="item_form"] and keeps itemfields/itemdata in
  // form[name="main_form"], which does NOT contain the table, so core's
  // closest("form") route reads nothing and M1.5 mounted on no live page.
  const core = createApi();
  const mainForm = createRuntimeHarness({ inputsAt: "main-form" });
  await mainForm.flush();
  // The fallback route genuinely cannot see them — the mount below is the
  // document-scoped resolution and nothing else.
  assert.deepEqual(plain(core.readColumnIds(mainForm.table)), [], "the mini-form holds no inputs");
  assert.equal(mainForm.lifecycle.lastResult, true);
  assert.equal(mainForm.mounts().length, 1);
  assert.equal(mainForm.container.hasAttribute(BOUND_ATTRIBUTE), true);
  assert.equal(mainForm.counts.writes, 0);
  // A page with no #main_form at all falls back to the bare input name.
  const unscoped = createRuntimeHarness({ inputsAt: "unscoped" });
  await unscoped.flush();
  assert.equal(unscoped.lifecycle.lastResult, true);
  assert.equal(unscoped.mounts().length, 1);
  // …and with the inputs nowhere reachable — the pre-fix live condition — the
  // install declines exactly as it did on the real page: no stamp, no binding.
  const orphaned = createRuntimeHarness({ inputsAt: "orphaned" });
  await orphaned.flush();
  assert.equal(orphaned.lifecycle.lastResult, false);
  assert.equal(orphaned.counts.editReads, 0, "it declines before the storage read");
  assertNotMounted(orphaned, "identity inputs unreachable");
});

test("declines to install when the machine has no container to bind to", async () => {
  const harness = createRuntimeHarness();
  harness.table.closest = () => null;
  await harness.run("mutation");
  assert.equal(harness.lifecycle.lastResult, false);
  assertNotMounted(harness, "no container");
});

test("mounts one hidden marker, binds once and writes nothing", async () => {
  // The seeded entry proves a stored layout is read without being applied; it
  // cannot prove the scope key, because nothing in M1 makes `entry` observable
  // (task-6-report.md §6.2 — Task 7's fixture round-trip pins the key).
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { "FIXTURE:2462:salesord:edit": { hidden: ["quantity"] } } }
  });
  await harness.flush();
  assert.equal(harness.lifecycle.lastResult, true);
  // The harness mounts because its axis DECODES, not by accident: pin the axis
  // the runtime tests all run against, so a later edit to the hidden inputs
  // cannot silently change what "mounted" means.
  assert.deepEqual(plain(createApi().readColumnIds(harness.table)), ["item", "quantity", "rate"]);
  const mounted = harness.mounts();
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0].tagName, "span");
  assert.equal(mounted[0].getAttribute(DATA_ATTRIBUTE), "mount");
  assert.equal(mounted[0].hidden, true);
  assert.equal(harness.container.hasAttribute(BOUND_ATTRIBUTE), true);
  // MAIN-world axis evidence: the pinned axis, comma-joined, on the bound
  // container — the same three ids the derivation above returns, so a probe
  // running in page script reads exactly what this mount keyed its storage to.
  assert.equal(harness.container.getAttribute(AXIS_ATTRIBUTE), "item,quantity,rate");
  assert.equal(harness.counts.editReads, 1);
  // Seeded storage plus install is a read, never a write (spec: count writes).
  assert.equal(harness.counts.writes, 0);
  // M1 is invisible: no class and no inline width reaches any machine cell.
  for (const row of harness.table.rows) {
    for (const cell of row.cells) {
      assert.deepEqual(cell.classNames(), []);
      assert.equal(cell.style.width, "");
    }
  }
  // A repaint re-installs: the marker, the binding and the axis stamp stay
  // singular. The stamp is re-derived through the pin, so it cannot drift.
  await harness.run("mutation");
  assert.equal(harness.mounts().length, 1);
  assert.equal(harness.container.listeners.length, 0);
  assert.equal(harness.container.getAttribute(AXIS_ATTRIBUTE), "item,quantity,rate");
  assert.equal(harness.counts.writes, 0);
});

test("refuses a newer stored schema with one warning across repaints", async () => {
  const harness = createRuntimeHarness({ stored: { schemaVersion: 2, grids: {} } });
  await harness.flush();
  assert.equal(harness.lifecycle.lastResult, true);
  assert.deepEqual(harness.toasts, [
    { message: "This layout was saved by a newer SuiteMate.", type: "warning" }
  ]);
  // Install re-runs on every machine repaint; the warning is latched, so two
  // more repaints must not produce two more toasts.
  await harness.run("mutation");
  await harness.run("mutation");
  assert.equal(harness.counts.editReads, 3);
  assert.equal(harness.toasts.length, 1, "the newer-schema warning is not latched");
  assert.equal(harness.counts.writes, 0);
  // Teardown resets the latch: a fresh page state warns again.
  harness.lifecycle.registration.cleanup({ reason: "paused" });
  await harness.run("resumed");
  assert.equal(harness.toasts.length, 2);
});

test("absorbs a rejected storage read as an ordinary failure, logged once", async () => {
  const harness = createRuntimeHarness({ readError: new Error("QUOTA_BYTES_PER_ITEM quota exceeded") });
  await harness.flush();
  assert.equal(harness.lifecycle.lastResult, false);
  assert.equal(harness.counts.editReads, 1, "a failed read must not be retried inside one install");
  assert.equal(harness.errors.length, 1);
  await harness.run("mutation");
  assert.equal(harness.lifecycle.lastResult, false);
  assert.equal(harness.counts.editReads, 2);
  assert.equal(harness.errors.length, 1, "the install failure is logged once, not once per repaint");
  assert.equal(harness.counts.writes, 0);
});

test("teardown is synchronous, unstamps the page and can remount afterwards", async () => {
  const harness = createRuntimeHarness();
  await harness.flush();
  assert.equal(harness.mounts().length, 1);
  const result = harness.lifecycle.registration.cleanup({ id: "record.edit-grid", reason: "paused" });
  assert.equal(result, undefined, "a thenable cleanup is only reported, never awaited");
  assertNotMounted(harness, "after cleanup");
  await harness.run("mutation");
  assert.equal(harness.mounts().length, 1);
  assert.equal(harness.container.hasAttribute(BOUND_ATTRIBUTE), true);
  assert.equal(harness.container.getAttribute(AXIS_ATTRIBUTE), "item,quantity,rate");
});

test("turning the setting off tears down and turning it back on remounts", async () => {
  const harness = createRuntimeHarness();
  await harness.flush();
  assert.equal(harness.mounts().length, 1);
  await harness.changeSettings({ salesOrderColumnsEdit: false });
  assertNotMounted(harness, "setting turned off");
  // A non-sync area cannot revive the feature.
  await harness.changeSettings({ salesOrderColumnsEdit: true }, "local");
  assertNotMounted(harness, "local storage change");
  await harness.changeSettings({ salesOrderColumnsEdit: true });
  assert.equal(harness.mounts().length, 1);
  assert.equal(harness.counts.writes, 0);
});

test("the runtime's own pagehide handler disposes only on a real navigation", async () => {
  const harness = createRuntimeHarness();
  await harness.flush();
  assert.equal(harness.mounts().length, 1);
  // The bfcache path belongs to the shared lifecycle: lifecycle.js:692-698
  // suspends every watcher on a persisted pagehide (running cleanup) and
  // pageshow force-refreshes the route. The runtime must not *dispose* there —
  // a disposed watcher can never be resumed. This asserts the runtime's own
  // handler only, which is all it owns; the mount's fate on bfcache is the
  // lifecycle's, and this stub deliberately does not simulate it.
  harness.pagehide(true);
  assert.equal(harness.lifecycle.disposals, 0);
  harness.pagehide(false);
  assert.equal(harness.lifecycle.disposals, 1);
  assertNotMounted(harness, "after a real navigation");
});

test("an install interrupted by teardown never lands on the stale generation", async () => {
  const harness = createRuntimeHarness({ holdRead: true });
  await harness.tick();
  // The marker is placed before the read, so teardown must remove it even
  // though the install that placed it has not finished.
  assert.equal(harness.mounts().length, 1);
  assert.equal(harness.counts.editReads, 1);
  await harness.changeSettings({ salesOrderColumnsEdit: false });
  assertNotMounted(harness, "torn down mid-install");
  harness.releaseRead();
  await harness.flush();
  assert.equal(harness.lifecycle.lastResult, false, "the aborted install reported success");
  assertNotMounted(harness, "stale install after teardown");
});

test("relevance reacts to machine mutations and drops records targeted at owned nodes", async () => {
  const harness = createRuntimeHarness();
  await harness.flush();
  const { relevant } = harness.lifecycle.registration;
  const owned = harness.mounts()[0];
  const dataRow = harness.table.rows[1];
  const headerRow = harness.table.rows[0];
  assert.equal(relevant([{ target: harness.container, addedNodes: [dataRow], removedNodes: [] }]), true);
  assert.equal(relevant([{ target: harness.container, addedNodes: [], removedNodes: [headerRow] }]), true);
  // A record whose target is one of our own nodes is dropped outright.
  assert.equal(relevant([{ target: owned, addedNodes: [dataRow], removedNodes: [] }]), false);
  // Our own mount is what produces this record — target is the machine
  // container, which contains the table and so reads as a machine node. It must
  // still be refused, or every install would schedule the next one.
  assert.equal(relevant([{ target: harness.container, addedNodes: [owned], removedNodes: [] }]), false);
  assert.equal(relevant([{ target: harness.container, addedNodes: [], removedNodes: [owned] }]), false);
  // A repaint that removes our marker *and* rebuilds machine rows is still ours
  // to act on — the refusal covers records that touch nothing but our nodes.
  assert.equal(relevant([{ target: harness.container, addedNodes: [dataRow], removedNodes: [owned] }]), true);
});

test("body-level churn around the machine is not relevant, but churn inside it is", async () => {
  const harness = createRuntimeHarness();
  await harness.flush();
  const { relevant } = harness.lifecycle.registration;
  const readsAfterInstall = harness.counts.editReads;
  // An ancestor of the machine: body, a portal host, a tooltip or dropdown
  // container. Its querySelector finds the table, which is exactly the trap —
  // NetSuite churns these constantly and each one would cost a storage read.
  const ancestor = {
    nodeType: 1,
    matches: () => false,
    querySelector: (selector) => (selector.includes("#item_splits") ? harness.table : null),
    closest: () => null
  };
  const portal = { nodeType: 1, matches: () => false, querySelector: () => null, closest: () => null };
  assert.equal(relevant([{ target: ancestor, addedNodes: [portal], removedNodes: [] }]), false);
  assert.equal(harness.counts.editReads, readsAfterInstall, "irrelevant churn caused a storage read");
  // A cell inside the machine: a sourcing rewrite mutates existing cells and
  // adds no nodes, so the target path is the only thing that can catch it.
  const cellInside = {
    nodeType: 1,
    matches: () => false,
    querySelector: () => null,
    closest: (selector) => (selector === "#item_splits" ? harness.table : null)
  };
  assert.equal(relevant([{ target: cellInside, addedNodes: [], removedNodes: [] }]), true);
  // The table itself is inside itself as far as closest() is concerned.
  assert.equal(relevant([{ target: harness.table, addedNodes: [], removedNodes: [] }]), true);
});

test("the install that mounts does not schedule the next install", async () => {
  const harness = createRuntimeHarness();
  await harness.flush();
  const { relevant } = harness.lifecycle.registration;
  // Exactly the records the shared observer reports for our own mount
  // (childList on the container, addedNodes = the marker).
  const ownWrites = harness.mounts().map((node) => ({
    target: harness.container,
    addedNodes: [node],
    removedNodes: []
  }));
  assert.equal(ownWrites.length, 1);
  assert.equal(relevant(ownWrites), false, "the mount re-triggered install");
  assert.equal(harness.counts.editReads, 1);
});

test("installs without a session status script and without its identifiers", async () => {
  const withoutScript = createRuntimeHarness({ sessionSrc: null });
  await withoutScript.flush();
  assert.equal(withoutScript.lifecycle.lastResult, true);
  assert.equal(withoutScript.mounts().length, 1);
  const withoutIds = createRuntimeHarness({
    sessionSrc: "/javascript/sessionstatus/session_status_init.jsp?companyId=&id="
  });
  await withoutIds.flush();
  assert.equal(withoutIds.lifecycle.lastResult, true);
  assert.equal(withoutIds.mounts().length, 1);
});

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
      // T6a: the derivation branch resolves the identity inputs document-scoped
      // before it asks core. A document that finds nothing sends it down the
      // core.readColumnIds fallback — the seam these six assertions drive. The
      // resolved path has its own coverage (the mini-form runtime test and the
      // readColumnIdsFrom unit tests); what is pinned HERE is that resolution
      // changed nothing about pinning, reuse, the latch or the transient guard.
      document: { querySelector: () => null },
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

test("an install whose second axis read comes back empty never reaches applyAll", async () => {
  // save/CHECKPOINTS.md "Next: M2 preconditions" #3. The install reads the axis
  // TWICE, and the second read sits after the awaited storage read: a repaint
  // that lands mid-await can change the machine's own axis, latch the mismatch
  // and answer [] on an install whose first read succeeded. Inert today only
  // because both signatures stringify {"ids":[]} and return above applyAll —
  // and inertness is not a guard. Sliced from runtime.js, not re-typed.
  const [install] = runtimeSource.match(
    / {2}async function installEditGrid\(\{ signal, isCurrent \}\) \{[\s\S]*?\n {2}\}/
  ) ?? [];
  assert.equal(Boolean(install), true, "installEditGrid is no longer a named async function in runtime.js");
  const core = createApi();
  const run = async (reads) => {
    const applied = [];
    const stamped = [];
    const pending = [...reads];
    const container = createContainer();
    const sandbox = {
      core,
      chrome: { storage: { sync: { get: async () => ({}) } } },
      machineTable: () => ({ isConnected: true }),
      machineContainer: () => container,
      currentColumnIds: () => pending.shift() ?? [],
      resolveScopeKey: () => "FIXTURE:2462:salesord:edit",
      ensureMountMarker() {},
      ensureBindings() {},
      stampAxis: (node, ids) => stamped.push(ids),
      isLineOpen: () => false,
      renderSignature: (table, ids) => JSON.stringify({ ids }),
      // M2's target carries the stored widths, so it stops matching the render
      // signature the moment anything is stored. Stubbed diverging here: an
      // equal pair is exactly what hides the defect today.
      targetSignature: () => '{"target":"diverged"}',
      applyAll: (table, ids) => applied.push(ids),
      logOnce: (error) => { throw error; },
      showToast() {},
      activeTable: null,
      nativeColumnIds: null,
      scopeKey: null,
      entry: {},
      pendingApply: false,
      warnedNewerSchema: false
    };
    sandbox.globalThis = sandbox;
    runInNewContext(
      `${install}\nglobalThis.result = installEditGrid({ signal: { aborted: false }, isCurrent: () => true });`,
      sandbox
    );
    return { result: await sandbox.result, applied, stamped, sandbox };
  };

  const latched = await run([["item", "quantity", "rate"], []]);
  assert.deepEqual(latched.applied, [], "applyAll ran against an empty axis");
  assert.equal(latched.result, true, "the mount stands — marker, bindings and entry are already in place");
  // The mount really did happen, so this is the guard firing and not an earlier
  // decline: the FIRST read passed the identity gate and was stamped.
  assert.deepEqual(plain(latched.stamped), [["item", "quantity", "rate"]]);
  assert.deepEqual(plain(latched.sandbox.nativeColumnIds), ["item", "quantity", "rate"]);

  // A one-column second read is refused on the same gate the install's own
  // identity check uses — never applied against a machine with nothing to key.
  assert.deepEqual((await run([["item", "quantity", "rate"], ["item"]])).applied, []);

  // Not vacuous: the identical install DOES apply when the second read holds.
  const applying = await run([["item", "quantity", "rate"], ["item", "quantity", "rate"]]);
  assert.deepEqual(plain(applying.applied), [["item", "quantity", "rate"]]);
});

test("the save queue survives a rejected operation and a teardown", async () => {
  // save/CHECKPOINTS.md "Next: M2 preconditions" #7, carried from M1 as "MUST
  // close before M2 wires the first writer". enqueueSave still has no caller,
  // so this drives the SHIPPED statements sliced out of runtime.js rather than
  // re-typed ones — including the teardown reset, lifted from removeEditGrid's
  // own body so the test cannot pass against a runtime that stopped resetting.
  const [declaration] = runtimeSource.match(/^ {2}let saveQueue = .*$/m) ?? [];
  const [enqueue] = runtimeSource.match(/ {2}function enqueueSave\(operation\) \{[\s\S]*?\n {2}\}/) ?? [];
  const [teardown] = runtimeSource.match(/ {2}function removeEditGrid\(\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(declaration), true, "saveQueue is no longer a module-scoped let in runtime.js");
  assert.equal(Boolean(enqueue), true, "enqueueSave is no longer a named function in runtime.js");
  const [reset] = teardown.match(/^ *saveQueue = .*$/m) ?? [];
  assert.equal(Boolean(reset), true, "removeEditGrid no longer resets saveQueue");
  // Built in THIS realm, not a vm context: process-level unhandledRejection
  // tracking and promise identity both have to be the real ones.
  const build = () => new Function(`
    ${declaration}
    ${enqueue}
    return {
      enqueue: enqueueSave,
      peek: () => saveQueue,
      teardown: () => { ${reset.trim()} }
    };
  `)();
  const drain = async (rounds = 3) => {
    for (let index = 0; index < rounds; index += 1) {
      await new Promise((done) => setImmediate(done));
    }
  };

  // Two detectors, and the honest note about which one wins: node:test fails a
  // test on ANY rejection that escapes it, and on the drop-the-swallow mutation
  // it does so — naming "dropped rejection" — before the assertion below can
  // run. The explicit capture is kept because it STATES the invariant and
  // proves zero events on the green path; it is the belt, not the braces.
  const unhandled = [];
  const record = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  try {
    const queue = build();
    const order = [];

    // A caller that AWAITS still sees its own failure — the swallow is on the
    // stored chain, never on the promise handed back.
    await assert.rejects(
      queue.enqueue(() => { order.push("awaited"); return Promise.reject(new Error("write failed")); }),
      /write failed/
    );
    // A caller that FIRES AND FORGETS — what M2 wires — must not poison the
    // process. Drained before the next enqueue on purpose: a handler attached
    // in the same turn would hide the missing swallow.
    queue.enqueue(() => { order.push("dropped"); return Promise.reject(new Error("dropped rejection")); });
    await drain();
    // A synchronous throw takes the same path (.then turns it into a rejection).
    queue.enqueue(() => { order.push("threw"); throw new Error("sync throw"); });
    await drain();
    assert.deepEqual(unhandled, [], "a failed save left an unhandled rejection behind");

    // The queue is still serialized and still running work after all three.
    assert.equal(await queue.enqueue(() => { order.push("after"); return "ok"; }), "ok");
    assert.deepEqual(order, ["awaited", "dropped", "threw", "after"]);
    // And the stored chain itself never rejects, so nothing downstream inherits
    // a poisoned queue.
    await queue.peek();

    // Teardown swaps the chain for a fresh one: a continuation queued before it
    // cannot chain the next mount's writes behind the old mount's.
    const before = queue.peek();
    queue.teardown();
    assert.notEqual(queue.peek(), before, "teardown did not reset the save queue");
    assert.equal(await queue.enqueue(() => "remounted"), "remounted");
    await drain();
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", record);
  }
});

test("every axis read in the runtime goes through the pin", () => {
  // The hazard is a caller that asks core directly while an order is applied.
  // There is exactly ONE core.readColumnIds call site and — since T6a — exactly
  // ONE core.readColumnIdsFrom call site, and BOTH sit inside currentColumnIds;
  // everything else asks currentColumnIds. `core.readColumnIds(` cannot match
  // `core.readColumnIdsFrom(`: the literal paren is part of the pattern.
  const direct = runtimeSource.match(/core\.readColumnIds\(/g) ?? [];
  const fromValues = runtimeSource.match(/core\.readColumnIdsFrom\(/g) ?? [];
  assert.equal(direct.length, 1, "core.readColumnIds must be reached only through currentColumnIds");
  assert.equal(fromValues.length, 1, "core.readColumnIdsFrom must be reached only through currentColumnIds");
  const [helper] = runtimeSource.match(/ {2}function currentColumnIds\(table\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(helper), true, "currentColumnIds is no longer a named function in runtime.js");
  assert.match(helper, /core\.readColumnIdsFrom\(table, fields\.value, data\.value\)/);
  assert.match(helper, /core\.readColumnIds\(table\)/);
  // The resolution is document-scoped and #main_form-first, mirroring the
  // live-verified route at src/internal-ids/runtime.js:56,198,202 — a lookup
  // that went back through table.closest("form") would reproduce the live
  // MOUNT FAIL with every unit test still green.
  assert.match(helper, /document\.querySelector\(`#main_form input\[type="hidden"\]\[name="\$\{name\}"\]`\)/);
  // Comments stripped: the prose above the resolution names the closest("form")
  // route it replaces, and the guard is about the CODE, not the explanation.
  const helperCode = helper.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(helperCode, /closest\("form"\)/);
});

test("a machine id that is not a bare identifier is never spliced into a selector", () => {
  // save/CHECKPOINTS.md "Next: M2 preconditions" #8. currentColumnIds splices
  // the machine id into two document-scoped selectors, and the machine id is
  // read off the TABLE'S OWN id attribute — page-controlled markup. The bare-
  // identifier test in front of that splice is the whole guard, and it is
  // dead-defensive only while MACHINE_TABLE_SELECTOR stays the literal
  // #item_splits: the moment M2+ resolves a machine by any other route, a
  // hostile id reaches a selector. Pinned here so the guard cannot be dropped
  // as unused. The ledger's cite (progress.md:37, runtime.js:135) names the
  // bare-name query — an injection SINK, not the guard; the guard is the
  // MACHINE_ID_PATTERN test one line below it.
  const [helper] = runtimeSource.match(/ {2}function currentColumnIds\(table\) \{[\s\S]*?\n {2}\}/) ?? [];
  const [comparer] = runtimeSource.match(/ {2}function sameColumnIds\(left, right\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(helper), true, "currentColumnIds is no longer a named function in runtime.js");
  const core = createApi();
  const ask = (machineId) => {
    const selectors = [];
    const sandbox = {
      core: {
        ...core,
        machineIdFromTable: () => machineId,
        // The fallback route, stubbed so the answer identifies which path ran.
        readColumnIds: () => ["item", "quantity", "rate"]
      },
      document: {
        querySelector(selector) {
          selectors.push(selector);
          return { value: "" };
        }
      },
      pinnedColumnIds: null,
      appliedOrder: null,
      axisMismatch: false
    };
    sandbox.globalThis = sandbox;
    runInNewContext(`${comparer}\n${helper}\nglobalThis.result = currentColumnIds(null);`, sandbox);
    return { ids: sandbox.result, selectors };
  };

  // A benign id DOES reach the selector — without this the assertion below
  // would pass on a runtime that had stopped querying the document entirely.
  const benign = ask("item");
  assert.equal(benign.selectors[0], '#main_form input[type="hidden"][name="itemfields"]');

  // Every hostile shape declines to the fallback: no selector is built at all,
  // nothing throws, and the axis still comes back from core.readColumnIds.
  for (const hostile of [
    'item"], script[src="x',            // closes the attribute and adds a selector
    "item_splits:has(script)",          // a functional pseudo-class
    "item\\", "item'", "item]", "item ",
    "1item",                            // a leading digit is not an identifier
    "", "item-splits"                   // a hyphen is legal in HTML, not in the pattern
  ]) {
    const asked = ask(hostile);
    assert.deepEqual(asked.selectors, [], `${JSON.stringify(hostile)} was spliced into a selector`);
    assert.deepEqual(plain(asked.ids), ["item", "quantity", "rate"],
      `${JSON.stringify(hostile)} did not fall back to core.readColumnIds`);
  }
  // Asserted on BEHAVIOUR, not on the regex literal: core.js already carries an
  // identical MACHINE_ID_PATTERN (unexported) that runtime.js re-inlines, and
  // collapsing the two is an improvement a source-shape assertion would veto.
});

test("an untouched select in the open row is not dirty", () => {
  // isDirty() has no caller until M3, so it cannot be reached through the
  // lifecycle registration. This evaluates the shipped predicate itself —
  // sliced out of runtime.js, not re-typed — which is the strongest coverage
  // available before a caller exists (see task-6-report.md §8).
  const [predicate] = runtimeSource.match(/ {2}function fieldIsDirty\(field\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(predicate), true, "fieldIsDirty is no longer a named function in runtime.js");
  const sandbox = {};
  sandbox.globalThis = sandbox;
  runInNewContext(`${predicate}\nglobalThis.fieldIsDirty = fieldIsDirty;`, sandbox);
  const select = (options, value) => ({
    tagName: "SELECT",
    value,
    // HTMLSelectElement genuinely has no defaultValue — omitted, not undefined
    // by accident: reading it is the bug this test exists for.
    options: options.map(([optionValue, defaultSelected]) => ({ value: optionValue, defaultSelected }))
  });
  const pristine = select([["", false], ["1", true], ["2", false]], "1");
  assert.equal(sandbox.fieldIsDirty(pristine), false, "an untouched select reads as dirty");
  assert.equal(sandbox.fieldIsDirty(select([["", false], ["1", true]], "")), true);
  // No option is defaultSelected: the browser selects the first one.
  assert.equal(sandbox.fieldIsDirty(select([["a", false], ["b", false]], "a")), false);
  assert.equal(sandbox.fieldIsDirty(select([["a", false], ["b", false]], "b")), true);
  assert.equal(sandbox.fieldIsDirty(select([], "")), false);
  // Inputs and textareas keep the defaultValue comparison.
  assert.equal(sandbox.fieldIsDirty({ tagName: "INPUT", value: "5", defaultValue: "5" }), false);
  assert.equal(sandbox.fieldIsDirty({ tagName: "INPUT", value: "6", defaultValue: "5" }), true);
  assert.equal(sandbox.fieldIsDirty({ tagName: "TEXTAREA", value: "x", defaultValue: "x" }), false);
});

test("runtime owns no observer, no HTML sink and no View Mode storage", () => {
  assert.doesNotMatch(runtimeSource, /innerHTML|new MutationObserver|suiteMateV3ColumnOrder|SuiteMateV3SoColumnsCore/);
  assert.doesNotMatch(runtimeSource, /chrome\.storage\.sync\.set/, "M1 performs no storage writes");
  assert.match(runtimeSource, /startPaused: true/);
  assert.match(runtimeSource, /capability: routeApi\.CAPABILITIES\.TRANSACTION_COLUMN_PERSONALIZATION_EDIT/);
});

test("every stylesheet rule is scoped to the feature and every hide rule wins", () => {
  const selectors = stylesheet
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((block) => block.split("{")[0].trim())
    .filter(Boolean);
  assert.equal(selectors.length > 0, true);
  // Per comma group, not per rule: `.suitemate-v3-edit-grid-menu, tr.uir-machine-row`
  // would pass a whole-string check while matching a View Mode node.
  for (const group of selectors.flatMap((selector) => selector.split(","))) {
    assert.match(group, /suitemate-v3-edit-grid/, `${group.trim()} can match a View Mode node`);
  }
  // display-defeats-hidden has three recorded sightings; all three hide rules
  // and the [hidden] guard carry !important.
  assert.match(stylesheet, /\[data-suitemate-v3-edit-grid\]\[hidden\]\s*\{\s*display: none !important/);
  assert.match(stylesheet, /\.suitemate-v3-edit-grid-col-hidden\s*\{\s*display: none !important/);
  assert.match(stylesheet, /\.suitemate-v3-edit-grid-row-filtered\s*\{\s*display: none !important/);
});

test("the bound-attribute rule is anchored where the runtime actually stamps", () => {
  const core = createApi();
  // ensureBindings() stamps BOUND_ATTRIBUTE on the machine container; the table
  // never carries it, so a rule anchored at #item_splits[...-bound] would be
  // inert — and M2's width arithmetic depends on this box-sizing landing.
  const rule =
    `${core.MACHINE_CONTAINER_SELECTOR}[${core.BOUND_ATTRIBUTE}] ${core.MACHINE_TABLE_SELECTOR} ${core.HEADER_ROW_SELECTOR} td`;
  assert.equal(stylesheet.includes(rule), true, `the stylesheet has no rule for ${rule}`);
  assert.doesNotMatch(stylesheet, /#item_splits\[data-suitemate-v3-edit-grid-bound\]/);
  assert.match(runtimeSource, /container\.setAttribute\(core\.BOUND_ATTRIBUTE, ""\)/);
});
