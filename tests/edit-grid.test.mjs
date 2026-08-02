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
function createCell({ text = "", spanId = null, systemHidden = false, width = 100 } = {}) {
  const classes = new Set();
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
  assert.equal(core.FOCUSED_ROW_SELECTOR, "tr.uir-machine-row-focused, tr.listfocusedrow");
  // Union of the spec's four names and the four src/styles/netsuite.css carries:
  // the spec's four have zero occurrences there, so excluding only those would
  // leave the button, totals, loading and nodata rows counted as data rows.
  assert.equal(
    core.EXCLUDED_ROW_SELECTOR,
    "tr.machineButtonRow, tr.totalrow, tr.uir-machine-loading-row, tr.uir-machine-nodata-row, "
    + "tr.uir-machine-button-row, tr.uir-machine-totals-row, tr.uir-loading-row, tr.uir-nodata-row"
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
  wrappedHeaders = true
} = {}) {
  // dataValue: null omits the {machine}data input entirely, which is a different
  // machine from one whose input is present and empty. A1.2 refuses both.
  const form = createForm({
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
  sessionSrc = SESSION_SRC,
  readError = null,
  holdRead = false
} = {}) {
  const container = createContainer();
  const form = machineFields === null
    ? null
    : createForm({ itemfields: machineFields, itemdata: machineData });
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
  // A repaint re-installs: the marker and the binding stay singular.
  await harness.run("mutation");
  assert.equal(harness.mounts().length, 1);
  assert.equal(harness.container.listeners.length, 0);
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

test("an open line is detected under either button-row class name", () => {
  // Same slice technique as the dirty-field test below: isLineOpen() has no
  // reachable caller until M2 wires queue-while-open, so this evaluates the
  // shipped bytes with their three dependencies injected.
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
  const dataRow = createRow({ id: "item_row_1", cells: [createCell()] });
  assert.equal(lineOpen([header, dataRow]), false);
  assert.equal(lineOpen([header, createRow({ className: "uir-machine-row uir-machine-row-focused" })]), true);
  assert.equal(lineOpen([header, createRow({ className: "listfocusedrow" })]), true);
  // The name the spec used…
  assert.equal(lineOpen([header, dataRow, createRow({ className: "machineButtonRow" })]), true);
  // …and the one src/styles/netsuite.css actually puts on the <tr>.
  assert.equal(lineOpen([header, dataRow, createRow({ className: "uir-machine-button-row" })]), true);
  assert.equal(lineOpen([], { table: null }), false);
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
