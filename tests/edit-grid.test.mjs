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
// View Mode's own feature, READ ONLY and never executed against its runtime: the
// cross-mode isolation tests below need both sides of the boundary in one file,
// and so-columns is a View Mode file the plan forbids modifying.
const soColumnsSource = await readFile(resolve(root, "src/so-columns/core.js"), "utf8");
const soColumnsRuntimeSource = await readFile(resolve(root, "src/so-columns/runtime.js"), "utf8");
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

function createSoColumnsApi() {
  const sandbox = { TextEncoder };
  sandbox.globalThis = sandbox;
  runInNewContext(soColumnsSource, sandbox);
  return sandbox.SuiteMateV3SoColumnsCore;
}

// A View Mode header table, in the shape so-columns' own applyWidths reads it:
// keyed by the header's visible LABEL, not by a column id. Deliberately minimal —
// it exists to prove the two key spaces are disjoint, not to re-test so-columns.
function createSoColumnsTable(labels, rendered) {
  const cells = labels.map((label) => ({
    textContent: label,
    style: {},
    classList: { contains: () => false },
    querySelector: () => null,
    getBoundingClientRect: () => ({ width: rendered })
  }));
  const headerRow = { className: "uir-machine-headerrow", cells };
  return {
    style: {},
    cells,
    widths: () => cells.map((cell) => cell.style.width ?? ""),
    querySelector: (selector) =>
      (String(selector).includes("uir-machine-headerrow") ? headerRow : null)
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// ===== Edit-Mode DOM stub =====
// Rows carry extra system cells with inline display:none, _fs spans, an
// item_row_N id, a machineButtonRow and a totals row — the shapes that make
// every View Mode row predicate match zero rows (spec H1).
// What a cell RENDERS, as distinct from what was written on it. `rectDelta: null`
// — the default — is the flat model every pre-M2 test was built on: the rect is a
// constant, so nothing an apply writes can feed back into what the next apply
// measures. A NUMBER makes the rect follow the inline width plus that many pixels,
// which is what a real cell does (0 = border-box, 2 = this repo's own measured
// collapsed-border figure, 11 = the View Mode observation). Without it no
// edit-grid test could model the rect-follows-style feedback loop at all — the
// same residual blindness diagnosed in the so-columns stub and fixed there first
// (tests/so-columns.test.mjs createMeasuredTable), left here by oversight.
function renderedWidth(cell) {
  const styled = Number.parseInt(cell.style?.width ?? "", 10);
  return cell.rectDelta === null || cell.rectDelta === undefined || !Number.isFinite(styled)
    ? cell.offsetWidth
    : styled + cell.rectDelta;
}

// A node ANOTHER feature injected into a NetSuite cell. Live, internal-ids
// appends a badge span carrying data-suitemate-v3-internal-id into
// `.uir-machine-headerrow > td`; M3/M4 add this feature's own chips, which
// FOREIGN_NODE_SELECTOR also names. Modelled with the removal genuinely WORKING
// and the clone genuinely DETACHED, because the obvious shortcut — a clone that
// already answers the stripped text — measures nothing at all: a reader that
// strips nothing passes it exactly as well as one that strips (spec A3.3, "a
// stub that flattens a quantity the production code derives from its own output
// is blindness, not simplification").
function isForeignSelector(selector) {
  return String(selector).includes("data-suitemate-v3");
}

// `injected` entries are a string, or { text, detaches } — detaches:false models
// a node that will not come off, so "the strip is verified, not assumed" has
// something to be measured against.
function withInjectedNodes(node, ownText, injected) {
  const nodes = [];
  for (const entry of injected) {
    const spec = typeof entry === "string" ? { text: entry } : entry;
    const child = {
      nodeType: 1,
      textContent: String(spec.text ?? ""),
      matches: isForeignSelector,
      ...(spec.detaches === false ? {} : {
        remove: () => {
          const at = nodes.indexOf(child);
          if (at >= 0) {
            nodes.splice(at, 1);
          }
        }
      })
    };
    nodes.push(child);
  }
  const innerQuery = node.querySelector;
  const innerQueryAll = node.querySelectorAll;
  // A real <td> reports its descendants' text, so the badge is part of
  // textContent until something removes the badge.
  Object.defineProperty(node, "textContent", {
    get: () => nodes.reduce((text, child) => text + child.textContent, String(ownText)),
    configurable: true
  });
  node.querySelector = (selector) => (isForeignSelector(selector)
    ? nodes[0] ?? null
    : innerQuery?.(selector) ?? null);
  node.querySelectorAll = (selector) => (isForeignSelector(selector)
    ? nodes.slice()
    : innerQueryAll?.(selector) ?? []);
  // A DETACHED deep copy with its own nodes: stripping the clone cannot touch the
  // page, which is the property that keeps this reader from destroying another
  // feature's output while reading past it.
  node.cloneNode = (deep) => withInjectedNodes(
    { nodeType: 1 },
    ownText,
    deep === false ? [] : nodes.map((child) => ({ text: child.textContent, detaches: "remove" in child }))
  );
  return node;
}

function createCell({
  text = "", spanId = null, systemHidden = false, width = 100, widget = 0, rectDelta = null,
  injected = []
} = {}) {
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
  const cell = {
    nodeType: 1,
    textContent: text,
    style: { display: systemHidden ? "none" : "", width: "" },
    offsetWidth: width,
    rectDelta,
    // Delegated handlers reach the machine through event.target.closest(), so a
    // cell has to know its own table exactly as a real <td> does. createTable
    // adopts every cell it is handed; a cell built after the fact has no owner
    // and answers null, which is what an orphaned node does live too.
    owner: null,
    closest: (selector) => cell.owner?.closest?.(selector) ?? null,
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
    getBoundingClientRect: () => ({ width: renderedWidth(cell) }),
    classNames: () => Array.from(classes),
    querySelector: (selector) => (spanId && selector.includes("_fs") ? { id: spanId } : null),
    querySelectorAll: (selector) => (String(selector).includes("input") ? widgets : [])
  };
  return injected.length ? withInjectedNodes(cell, text, injected) : cell;
}

// Gives a row's VISIBLE cells real page coordinates, left to right. The resize
// edge is a 5px zone hanging off a header cell's right edge, so without this the
// geometry the gesture is built on does not exist and every hit test answers
// false for the wrong reason. System-hidden cells occupy no space, exactly as
// display:none does live.
function layoutCells(cells, { top = 0, height = 20 } = {}) {
  let left = 0;
  for (const cell of cells) {
    if (cell.style?.display === "none") {
      cell.getBoundingClientRect = () => ({ width: 0, height: 0, left, right: left, top, bottom: top });
      continue;
    }
    // The left edge is fixed at layout time; the width and the right edge are
    // read live. A cached box would be wrong for a rect-following cell — caching
    // is exactly what would hide the feedback loop renderedWidth exists to model —
    // and is indistinguishable from live for a flat one, whose renderedWidth is
    // just its offsetWidth. One path, so there is no branch to get wrong.
    const at = left;
    cell.getBoundingClientRect = () => {
      const measured = renderedWidth(cell);
      return { width: measured, height, left: at, right: at + measured, top, bottom: top + height };
    };
    left += renderedWidth(cell);
  }
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
function createHeaderCell(label, { wrapped = true, systemHidden = false, injected = [] } = {}) {
  const cell = createCell({ text: label, systemHidden });
  cell.querySelector = (selector) =>
    wrapped && String(selector).includes("listheader") ? { textContent: label } : null;
  return injected.length ? withInjectedNodes(cell, label, injected) : cell;
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
  for (const row of rows) {
    for (const cell of row.cells ?? []) {
      cell.owner = table;
    }
  }
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
//
// `widgets` maps a column id to the offsetWidth of a materialised widget in that
// column, present from the moment the machine is built. It models the fact this
// harness had no way to express before M2 Task 13, and whose absence is what made
// defect D1 unreachable by any runtime test: NetSuite's entry row is PERMANENT
// and always materialised, so live a widget-bearing column has a non-zero
// columnMinimums floor on every single apply — not only while a numbered line is
// open. Every column defaults to 0, which is the pre-M2 model, so no existing
// test changes shape.
// `rectDelta` is threaded to the HEADER cells only — they are the only cells
// core.applyWidths writes to, so they are the only place a written width can feed
// back into a later measurement. See renderedWidth.
function createMachine({
  lines = 2, className, container = null, spans = true, duplicate = false, form = null,
  widgets = {}, rectDelta = null
} = {}) {
  const header = createRow({
    className: "uir-machine-headerrow",
    cells: [
      createCell({ text: "Item", rectDelta }),
      createCell({ text: "Quantity", rectDelta }),
      createCell({ text: "Rate", rectDelta }),
      createCell({ text: "", systemHidden: true, rectDelta })
    ]
  });
  const dataRows = Array.from({ length: lines }, (_, index) => {
    const line = index + 1;
    const spanId = (columnId) => (spans ? `item_${columnId}${line}_fs` : null);
    return createRow({
      id: `item_row_${line}`,
      className: "uir-machine-row",
      cells: [
        createCell({ text: `SKU-100${line}`, spanId: spanId("item"), widget: widgets.item ?? 0 }),
        createCell({
          text: String(line * 2),
          spanId: spanId(duplicate ? "item" : "quantity"),
          widget: widgets.quantity ?? 0
        }),
        createCell({ text: `$1${line}.00`, spanId: spanId("rate"), widget: widgets.rate ?? 0 }),
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
  // to the frozen export object beside `isOrderedMachine`"), re-sanctioned by
  // adjudication #14 together with applyWidths' axis-TAKING signature.
  // M3 Task 15 adds TWO — readCellText and applyHidden, 54 -> 56. The task brief
  // sanctions THREE Produces names; the third, readHeaderLabels, has been on the
  // contract since M1.5, so it grows by two rather than three. That function is
  // EXTENDED in place (an optional second parameter) rather than redeclared —
  // a second `function readHeaderLabels` in the same scope silently wins and
  // would have re-pointed readColumnIds' and readColumnIdsFrom's label reads at
  // it without a single test noticing.
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
    "isOrderedMachine", "columnMinimums", "applyWidths", "applyHidden",
    "parseMachineFieldData", "readMachineFieldData", "collapseDisplayTwins",
    "readCellText", "readHeaderLabels",
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

test("applies widths to header cells only, clamped to the static bounds, and restores on clear", () => {
  const core = createApi();
  const table = createMachine();
  table.rows[1].cells[1] = createCell({ text: "2", spanId: "item_quantity1_fs", widget: 180 });
  // The axis is HANDED to core, never derived inside it: core's only route to the
  // identity inputs is table.closest("form"), which live lands in NetSuite's
  // machine mini-form and holds nothing (M1.5), and re-deriving under a
  // permutation is never correct (spec A1.2 rule 3). runtime applyAll holds the
  // pin and passes it. Pinned as a behaviour in the next test.
  const columnIds = ["item", "quantity", "rate"];
  // A REAL, non-zero floor is handed to every call below, so the assertions that
  // it changes nothing are not vacuous — parameter 3 is still #14's ruled
  // signature slot, and core is proven to ignore it rather than to have been
  // handed nothing to ignore.
  const minimums = core.columnMinimums(table, columnIds);
  assert.deepEqual(plain(minimums), { item: 0, quantity: 180, rate: 0 });

  assert.equal(core.applyWidths(table, { item: 240, quantity: 60, rate: 20 }, minimums, columnIds), true);
  const header = core.visibleCells(table.rows[0]);
  // 240 and 60 exactly as handed; rate's 20 floored at the absolute 50px input
  // floor. Quantity is NOT raised to its 180px widget — an apply clamps to the
  // static bounds and nothing else (M2 Task 13 verdict, defect D1). The widget
  // floor belongs to handleResizeMove, where a width is chosen; here it would
  // widen a column on a plan that never asked for it, on every single apply.
  assert.deepEqual(plain(header.map((cell) => cell.style.width)), ["240px", "60px", "50px"]);
  // The pin, stated as the invariant rather than as a consequence: whatever a
  // caller puts in parameter 3, an apply cannot widen a column past its plan.
  // A 5000px "minimum" is refused as flatly as the real 180px one.
  assert.equal(core.applyWidths(table, { item: 240, quantity: 60, rate: 20 }, { quantity: 5000 }, columnIds), true);
  assert.deepEqual(plain(header.map((cell) => cell.style.width)), ["240px", "60px", "50px"]);
  // And it is IDEMPOTENT: two consecutive applies of the same plan leave
  // byte-identical strings. This is what walked live — Committed 72 -> 111 ->
  // 174px — because each apply's output was the next measurement's input.
  const first = plain(header.map((cell) => cell.style.width));
  assert.equal(core.applyWidths(table, { item: 240, quantity: 60, rate: 20 }, minimums, columnIds), true);
  assert.deepEqual(plain(header.map((cell) => cell.style.width)), first);
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
  // to "NaNpx" or to an unfrozen column — Number(null) is 0, not absent. Item
  // carries the 0, so the fallback is visible: the rendered 100px, never the
  // 50px floor a 0 target would land on. That is what keeps the inner
  // `stored > 0` guard observable now that the assignment itself is
  // unconditional (adjudication #15).
  assert.equal(core.applyWidths(table, { item: null, quantity: "abc", rate: 240 }, minimums, columnIds), true);
  assert.deepEqual(plain(header.map((cell) => cell.style.width)), ["100px", "100px", "240px"]);

  // A header cell that measures 0 and has no stored width takes the clamp floor,
  // never `width: ""` (adjudication #15). Left unfrozen it would be the ONE
  // column still fluid under fixed layout — the partial freeze this function
  // exists to prevent — and the runtime's targetSignature carries the same
  // folded shape so the two cannot disagree about what an apply will write.
  const zeroRendered = createMachine();
  zeroRendered.rows[0].cells[0] = createCell({ text: "Item", width: 0 });
  assert.equal(core.applyWidths(zeroRendered, { rate: 240 }, {}, columnIds), true);
  assert.deepEqual(
    plain(core.visibleCells(zeroRendered.rows[0]).map((cell) => cell.style.width)),
    ["50px", "100px", "240px"]
  );

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

test("applyWidths is idempotent under a TOTAL plan, and walks the columns a PARTIAL plan omits", () => {
  // M2 Task 13a review, Important #2. The D1 fix made an apply a pure function of
  // the widths it is HANDED — but a column the plan does not name still falls back
  // to `rendered`, and `rendered` is a border box that includes what the inline
  // width does not. Apply twice with a partial plan and that column grows by the
  // difference every time: the same shape as the so-columns defect this task
  // escalated, sitting in our own core, and stated unconditionally in the comment
  // until this test was written.
  //
  // Production never hits it because plannedWidths() is TOTAL from the freezing
  // apply onward. That is a runtime property, so it is asserted here as a
  // PRECONDITION rather than assumed away.
  const core = createApi();
  const columnIds = ["item", "quantity", "rate"];
  const naturals = [120, 90, 100];
  const build = (rectDelta) => {
    const table = createMachine();
    table.rows[0].cells.forEach((cell, index) => {
      if (index < naturals.length) {
        cell.offsetWidth = naturals[index];
        cell.rectDelta = rectDelta;
      }
    });
    return table;
  };
  const applyFourTimes = (table, plan) => {
    const seen = [];
    for (let round = 0; round < 4; round += 1) {
      assert.equal(core.applyWidths(table, plan, {}, columnIds), true);
      seen.push(plain(core.visibleCells(table.rows[0]).map((cell) => cell.style.width)));
    }
    return seen;
  };

  // A TOTAL plan is idempotent at every delta — including the two that model a
  // real cell. This is the property the runtime actually relies on.
  for (const rectDelta of [0, 2, 11]) {
    const total = applyFourTimes(build(rectDelta), { item: 120, quantity: 160, rate: 100 });
    assert.deepEqual(total, new Array(4).fill(["120px", "160px", "100px"]),
      `a total plan drifted at rectDelta ${rectDelta}`);
  }

  // rectDelta 0 — the rect equals the inline width, so even a partial plan is
  // stable. This isolates the cause: it is the border-box excess, not the
  // fallback itself.
  assert.deepEqual(
    applyFourTimes(build(0), { quantity: 160 }),
    new Array(4).fill(["120px", "160px", "100px"]),
    "with rect == style even a partial plan must be stable"
  );

  // rectDelta 2 and 11 — the unnamed columns walk, by exactly the delta, every
  // apply. The NAMED column never moves: it is read from the plan, not the
  // rendering, which is what makes this a fallback defect and not a clamp defect.
  const twoPx = applyFourTimes(build(2), { quantity: 160 });
  assert.deepEqual(twoPx.map((widths) => widths[0]), ["120px", "122px", "124px", "126px"]);
  assert.deepEqual(twoPx.map((widths) => widths[2]), ["100px", "102px", "104px", "106px"]);
  assert.deepEqual(twoPx.map((widths) => widths[1]), new Array(4).fill("160px"),
    "the column the plan names must not move at all");

  const elevenPx = applyFourTimes(build(11), { quantity: 160 });
  assert.deepEqual(elevenPx.map((widths) => widths[0]), ["120px", "131px", "142px", "153px"]);
  assert.deepEqual(elevenPx.map((widths) => widths[1]), new Array(4).fill("160px"));

  // THE PRECONDITION, asserted rather than assumed: the runtime's own planner
  // yields a plan that names every column on the axis once a freeze has happened,
  // so the partial-plan path above is unreachable from the second apply onward.
  const [planner] = runtimeSource.match(/ {2}function plannedWidths\(\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(planner), true, "plannedWidths is no longer a named function in runtime.js");
  const sandbox = { frozenWidths: { item: 120, quantity: 160, rate: 100 }, columnWidths: { quantity: 160 } };
  sandbox.globalThis = sandbox;
  runInNewContext(`${planner}\nglobalThis.result = plannedWidths();`, sandbox);
  assert.deepEqual(Object.keys(plain(sandbox.result)).sort(), [...columnIds].sort(),
    "plannedWidths stopped naming every column — the partial-plan walk above becomes reachable");
});

test("applyWidths' minimums parameter is provably inert — nothing passed there can move a width", () => {
  // ADJUDICATION #17. Parameter 3 stays (it holds #14's ruled arity, and dropping
  // it would let a surviving three-argument call — the clear path is
  // `applyWidths(table, null, {})` — slide columnIds into the minimums slot and
  // mis-key every column silently). This is the pin that keeps it HARMLESS:
  // whatever a caller puts there, the widths written are a function of
  // (table, widths, columnIds) alone. Without it, an apply-time floor could be
  // reintroduced through the slot later and nothing would notice — which is
  // exactly how defect D1 reached a live gate.
  const core = createApi();
  const columnIds = ["item", "quantity", "rate"];
  const widths = { item: 240, quantity: 60, rate: 20 };

  // The control: the empty map every apply call site actually passes.
  const control = createMachine();
  control.rows[1].cells[1] = createCell({ text: "2", spanId: "item_quantity1_fs", widget: 180 });
  assert.equal(core.applyWidths(control, widths, {}, columnIds), true);
  const expected = plain(core.visibleCells(control.rows[0]).map((cell) => cell.style.width));
  // Not vacuous: a real apply happened and the numbers are the plan's, clamped
  // only to the static bounds (rate's 20 floored at the absolute 50px).
  assert.deepEqual(expected, ["240px", "60px", "50px"]);

  // Every one of these must leave byte-identical output. The measured map is the
  // real one this machine yields (quantity: 180) — the floor that used to widen
  // the column; the rest are hostile shapes a future caller might hand over.
  const hostile = [
    ["a real measured map", core.columnMinimums(control, columnIds)],
    ["a huge floor on every column", { item: 5000, quantity: 5000, rate: 5000 }],
    ["a floor above the maximum", { item: Number.MAX_SAFE_INTEGER }],
    ["negative and zero floors", { item: -400, quantity: 0, rate: -1 }],
    ["poisoned numbers", { item: Number.NaN, quantity: Number.POSITIVE_INFINITY, rate: "abc" }],
    ["floors keyed by index rather than id", { 0: 5000, 1: 5000, 2: 5000 }],
    ["null and undefined", null],
    ["undefined", undefined],
    ["not an object at all", "quantity:5000"],
    ["an array", [5000, 5000, 5000]],
    ["a map whose lookups throw", new Proxy({}, { get() { throw new Error("hostile"); } })]
  ];
  for (const [label, minimums] of hostile) {
    const table = createMachine();
    table.rows[1].cells[1] = createCell({ text: "2", spanId: "item_quantity1_fs", widget: 180 });
    assert.equal(core.applyWidths(table, widths, minimums, columnIds), true, `${label}: the apply was refused`);
    assert.deepEqual(
      plain(core.visibleCells(table.rows[0]).map((cell) => cell.style.width)),
      expected,
      `${label}: parameter 3 moved a width`
    );
    assert.equal(table.style.tableLayout, "fixed", `${label}: the layout flip changed`);
  }

  // The same holds on the rendered-fallback path, where there is no stored width
  // to dominate the floor — the case a re-admitted floor would bite first, and
  // (review addendum) the load-bearing half against a floor gated on a stored
  // width's ABSENCE, which the hostile loop above cannot reach at all because
  // every column in it carries one.
  const unplanned = createMachine();
  unplanned.rows[1].cells[1] = createCell({ text: "2", spanId: "item_quantity1_fs", widget: 180 });
  assert.equal(core.applyWidths(unplanned, { item: 240 }, { quantity: 5000, rate: 5000 }, columnIds), true);
  assert.deepEqual(
    plain(core.visibleCells(unplanned.rows[0]).map((cell) => cell.style.width)),
    ["240px", "100px", "100px"],
    "an unplanned column took a floor instead of what it renders"
  );

  // And on a LONGER axis, so the pin is not proven over one geometry. Everything
  // above runs on the three-column stub, and so does every other test that hands
  // applyWidths a non-empty minimums map — the twelve-column machine is only ever
  // given `{}`. A floor re-admitted for wide machines alone
  // (`columnIds.length > 3 ? minimums?.[id] : 0`) therefore survives the whole
  // suite without this. Contrived rather than plausible, but it is one case.
  const wide = createLiveMachine();
  const wideAxis = plain(core.readColumnIds(wide));
  assert.deepEqual(wideAxis, LIVE_AXIS, "the live machine's axis moved — re-check the indices below");
  const wideFloors = Object.fromEntries(wideAxis.map((id) => [id, 5000]));
  assert.equal(core.applyWidths(wide, { rate: 240 }, wideFloors, wideAxis), true);
  const wideHeader = core.visibleCells(wide.rows[0]);
  const rateAt = wideAxis.indexOf("rate");
  assert.equal(wideHeader[rateAt].style.width, "240px", "the planned column moved on a twelve-column axis");
  assert.deepEqual(
    plain(wideHeader.filter((_, index) => index !== rateAt).map((cell) => cell.style.width)),
    new Array(wideAxis.length - 1).fill("100px"),
    "a 5000px floor moved a column on a twelve-column axis"
  );
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

// ===== M3: hide / show =====
const HIDDEN_CLASS = "suitemate-v3-edit-grid-col-hidden";
const EDIT_AXIS = ["item", "quantity", "rate"];

// plain(): visibleCells builds its array inside the vm sandbox, so its prototype
// is the sandbox's Array.prototype and deepStrictEqual refuses it against a
// literal built out here — the same reason every other assertion in this file
// goes through plain().
function hiddenFlags(core, row) {
  return plain(core.visibleCells(row).map((cell) => cell.classList.contains(HIDDEN_CLASS)));
}

// Every class on every cell, system cells included — the shape an idempotence
// claim has to be measured against, since "byte-identical DOM" is a statement
// about what an apply wrote, not about the columns it meant to write to.
function classSnapshot(core, table) {
  return plain(core.tableRows(table).map((row) => Array.from(row.cells).map((cell) => cell.classNames())));
}

function anythingClassed(core, table) {
  return core.tableRows(table)
    .some((row) => Array.from(row.cells).some((cell) => cell.classNames().length > 0));
}

test("hides a column across the header and every aligned row, and nothing else", () => {
  const core = createApi();
  const table = createMachine();
  // The axis is HANDED in and never derived here — adjudication #14, and the
  // reason a bare createMachine() is used: its axis is not derivable at all
  // (no {machine}fields input), so an implementation that reached for
  // readColumnIds internally would refuse every call this test makes.
  assert.deepEqual(plain(core.readColumnIds(table)), [], "the fixture became self-deriving");
  const displays = () => plain(core.tableRows(table)
    .map((row) => Array.from(row.cells).map((cell) => cell.style.display)));
  const nativeDisplays = displays();

  assert.equal(core.applyHidden(table, ["quantity"], EDIT_AXIS), true);
  assert.deepEqual(hiddenFlags(core, table.rows[0]), [false, true, false], "the header cell is hidden too");
  assert.deepEqual(hiddenFlags(core, table.rows[1]), [false, true, false]);
  assert.deepEqual(hiddenFlags(core, table.rows[2]), [false, true, false]);
  // The system cell keeps its own inline display:none and is never classed.
  assert.equal(table.rows[1].cells[3].classList.contains(HIDDEN_CLASS), false);
  // machineButtonRow and the totals row are never touched.
  assert.equal(table.rows[3].cells[0].classList.contains(HIDDEN_CLASS), false);
  assert.equal(table.rows[4].cells[0].classList.contains(HIDDEN_CLASS), false);

  // BINDING RULE 3 and the spec's A3.2 carve-out (design doc :605-615): hiding is
  // by CLASS ONLY. Not one inline display moved. The moment core writes one,
  // visibleCells — which reads inline display, and is right to, because that is
  // how NetSuite hides its OWN cells — drops the hidden cell, the column leaves
  // the axis, and the next install keys storage by a two-column axis. That is
  // laundering our own output into column IDENTITY, strictly worse than a width.
  assert.deepEqual(displays(), nativeDisplays, "applyHidden wrote an inline display");
  // Which is the same statement, made positively: the column is still on the axis.
  assert.equal(core.alignsToHeader(table.rows[1], EDIT_AXIS), true);
  assert.equal(core.visibleCells(table.rows[0]).length, 3);
  assert.equal(core.isDataRow(table.rows[1], EDIT_AXIS), true);

  // Idempotent (A3.3): a second identical apply leaves byte-identical classes.
  const applied = classSnapshot(core, table);
  assert.equal(core.applyHidden(table, ["quantity"], EDIT_AXIS), true);
  assert.deepEqual(classSnapshot(core, table), applied, "a second identical apply moved the DOM");

  // Hiding a DIFFERENT column reveals the first one. The reveal path below runs
  // on an EMPTY set and so never exercises the toggle's off branch at all — an
  // add-only implementation ("hide what is named, leave the rest") passes every
  // other assertion in this file and strands a column hidden the moment the user
  // unchecks it, which is the ordinary way Task 16's menu will call this.
  assert.equal(core.applyHidden(table, ["rate"], EDIT_AXIS), true);
  assert.deepEqual(hiddenFlags(core, table.rows[0]), [false, false, true]);
  assert.deepEqual(hiddenFlags(core, table.rows[1]), [false, false, true], "the previous column stayed hidden");
  assert.equal(core.applyHidden(table, ["item", "rate"], EDIT_AXIS), true);
  assert.deepEqual(hiddenFlags(core, table.rows[1]), [true, false, true]);
  assert.equal(core.applyHidden(table, ["quantity"], EDIT_AXIS), true);
  assert.deepEqual(classSnapshot(core, table), applied,
    "the set is the whole plan: arriving back at it must reproduce it exactly");

  // Revealing is a clean toggle back that leaves nothing behind anywhere.
  assert.equal(core.applyHidden(table, [], EDIT_AXIS), true);
  assert.deepEqual(hiddenFlags(core, table.rows[1]), [false, false, false]);
  assert.equal(anythingClassed(core, table), false, "a reveal left a class behind");
  assert.deepEqual(displays(), nativeDisplays, "a reveal wrote an inline display");
  assert.equal(core.applyHidden(null, ["quantity"], EDIT_AXIS), false);
});

test("applyHidden fails closed on an axis that is absent, empty or misaligned", () => {
  // BINDING RULE 1. alignsToHeader is the house gate and is stronger than the
  // length compare the task brief carried: a two-id axis against a three-column
  // header passes `Array.isArray(columnIds) && columnIds.length` and then hides
  // by index against an axis that is not the one rendered — a silent mis-hide of
  // the same family as the mis-keyed width M2 was spent on.
  const core = createApi();
  const refused = [null, undefined, [], "item,quantity,rate", { 0: "item" },
    ["item", "quantity"], ["item", "quantity", "rate", "extra"]];
  for (const axis of refused) {
    const table = createMachine();
    assert.equal(core.applyHidden(table, ["quantity"], axis), false,
      `axis ${JSON.stringify(axis) ?? "undefined"} was accepted`);
    assert.equal(anythingClassed(core, table), false, "a refused apply classed a cell anyway");
  }
  // Not vacuous: the very same call with the aligned axis hides.
  const good = createMachine();
  assert.equal(core.applyHidden(good, ["quantity"], EDIT_AXIS), true);
  assert.equal(anythingClassed(core, good), true);

  // No header row at all, and no table at all.
  const headless = createTable([createRow({ id: "item_row_1", cells: [createCell({ text: "SKU" })] })]);
  assert.equal(core.applyHidden(headless, ["quantity"], EDIT_AXIS), false);
  assert.equal(core.applyHidden(headless, [], EDIT_AXIS), false, "a reveal still needs a machine");
  assert.equal(core.applyHidden(null, ["quantity"], EDIT_AXIS), false);
  assert.equal(core.applyHidden(undefined, [], EDIT_AXIS), false);
});

test("an excluded row is never hidden, even when it aligns to the header", () => {
  // createMachine's button and totals rows carry ONE cell each, so the alignment
  // gate alone already skips them and isExcludedRow is not load-bearing there —
  // it can be deleted and the suite stays green. A totals row rendered at the
  // machine's full width is what makes it load-bearing: it aligns, and hiding a
  // column must still not take its total with it.
  const core = createApi();
  const table = createMachine();
  const totals = createRow({
    className: "totalrow",
    cells: [
      createCell({ text: "" }), createCell({ text: "12" }), createCell({ text: "$24.00" }),
      createCell({ text: "", systemHidden: true })
    ]
  });
  table.rows.push(totals);
  assert.equal(core.alignsToHeader(totals, EDIT_AXIS), true, "the fixture no longer aligns");
  assert.equal(core.isExcludedRow(totals), true);

  assert.equal(core.applyHidden(table, ["quantity"], EDIT_AXIS), true);
  assert.deepEqual(totals.cells.map((cell) => cell.classNames()), [[], [], [], []],
    "an aligned totals row was hidden with the column");
  assert.equal(table.rows[1].cells[1].classList.contains(HIDDEN_CLASS), true, "the data row was not hidden");
});

test("revealing needs no axis, and reaches the rows an apply can no longer key", () => {
  const core = createApi();
  const table = createMachine();
  assert.equal(core.applyHidden(table, ["quantity"], EDIT_AXIS), true);

  // DELIBERATE DEPARTURE from binding rule 1's letter, mirroring applyWidths'
  // restore path verbatim (core.js:812-826) and disclosed as such: an EMPTY hidden
  // set is a restore and needs no axis, because teardown runs after the pin has
  // been dropped and a mount that cannot key its columns must still be able to
  // undo what it set. It cannot mis-key anything — it makes no per-column
  // decision at all; the rule guards the ACTIVE path, which still refuses.
  assert.equal(core.applyHidden(table, [], null), true);
  assert.equal(anythingClassed(core, table), false);
  // A hidden set that is not an array is that same restore, exactly as a `widths`
  // that is not a plain object is for applyWidths — never a success that silently
  // hides nothing while claiming to have hidden something.
  assert.equal(core.applyHidden(table, ["quantity"], EDIT_AXIS), true);
  assert.equal(core.applyHidden(table, "quantity", EDIT_AXIS), true);
  assert.equal(anythingClassed(core, table), false);
  // Nothing in the set survives normalization -> nothing to hide -> restore.
  assert.equal(core.applyHidden(table, ["quantity"], EDIT_AXIS), true);
  assert.equal(core.applyHidden(table, [null, "", undefined], EDIT_AXIS), true);
  assert.equal(anythingClassed(core, table), false);

  // What the alignment gate does NOT buy, stated because the task brief claims it
  // does ("force-reveal rule 3, for free"): a row that was aligned when the apply
  // ran KEEPS its class when it later goes ragged — an open line grows spacer
  // cells around its widgets. The gate only stops a ragged row being NEWLY
  // hidden. Task 16's force-reveal is a runtime duty and is not free.
  assert.equal(core.applyHidden(table, ["quantity"], EDIT_AXIS), true);
  const opened = table.rows[1];
  opened.cells.push(createCell({ text: "" }));
  assert.equal(core.alignsToHeader(opened, EDIT_AXIS), false);
  const ragged = plain(opened.cells.map((cell) => cell.classNames()));
  assert.equal(core.applyHidden(table, ["quantity"], EDIT_AXIS), true);
  assert.equal(opened.cells[1].classList.contains(HIDDEN_CLASS), true,
    "the stale class on a ragged row is exactly what force-reveal has to clear");
  // Untouched, not merely still-hidden. A ragged row indexed against the axis
  // anyway would run out of flags at its extra cell and `toggle(class, undefined)`
  // flips rather than sets — so the spacer cell an open line grew would go hidden
  // on every apply, which is the same off-by-one column shift that made every
  // View Mode row predicate match zero rows here (spec H1).
  assert.deepEqual(plain(opened.cells.map((cell) => cell.classNames())), ragged,
    "an apply reached into a row it cannot index against the axis");
  // The reveal sweep does reach it: every cell of every row, aligned or not.
  assert.equal(core.applyHidden(table, [], EDIT_AXIS), true);
  assert.equal(anythingClassed(core, table), false, "a ragged row kept a class through a reveal");
});

test("a hidden column stays on the axis, measured on the live twelve-column machine", () => {
  // Everything above runs on the three-column stub. A gate written against one
  // geometry (`columnIds.length > 3 ? … : …`) survives all of it, and the
  // laundering this pins is only visible where the axis is re-derivable at all.
  const core = createApi();
  const table = createLiveMachine();
  assert.deepEqual(plain(core.readColumnIds(table)), LIVE_AXIS);
  assert.equal(core.applyHidden(table, ["quantity", "rate", "not_a_column"], LIVE_AXIS), true);

  // THE laundering pin. Re-derived AFTER the hide, from the same machine: an
  // inline write would have taken two labels off visibleCells, and readColumnIds
  // would answer a ten-column axis (or nothing) — which is what would then key
  // storage on the next install.
  assert.deepEqual(plain(core.readColumnIds(table)), LIVE_AXIS, "hiding moved the column axis");
  assert.deepEqual(plain(core.readHeaderLabels(table)), LIVE_LABELS);
  const expected = LIVE_AXIS.map((id) => id === "quantity" || id === "rate");
  for (const row of core.tableRows(table)) {
    assert.deepEqual(hiddenFlags(core, row), expected, "the wrong columns hid on a twelve-column axis");
  }
  // An id that is not on the axis is ignored, not an error and not an extra hide.
  assert.equal(expected.filter(Boolean).length, 2);
});

test("readCellText reads NetSuite's own text and never a node SuiteMate injected", () => {
  const core = createApi();
  // Static data cells are BARE TEXT live (probe 11): no _fs span, no input, no id,
  // nothing to unwrap — so the cheap path has to be the correct one. Whitespace
  // collapses exactly as the label reader has always collapsed it, which is what
  // keeps an M6/M7 filter or sort key free of a newline no user could type.
  assert.equal(core.readCellText(createCell({ text: "  Rate  " })), "Rate");
  assert.equal(core.readCellText(createCell({ text: " Back\n\tOrdered " })), "Back Ordered");
  assert.equal(core.readCellText(createCell({ text: "" })), "");
  assert.equal(core.readCellText(null), "");
  assert.equal(core.readCellText(undefined), "");
  // A node with no query surface at all — the div.listheader wrapper's shape.
  // Collapsed on this path too: it is the path every wrapped header label takes.
  assert.equal(core.readCellText({ textContent: "  Rate  " }), "Rate");
  assert.equal(core.readCellText({ textContent: " Back\n\tOrdered " }), "Back Ordered");

  // A3.2. internal-ids appends a badge span into these cells (live-confirmed) and
  // this feature's own chips land there from Task 16 on; FOREIGN_NODE_SELECTOR
  // names both. Neither is NetSuite's text.
  const badged = createCell({ text: "Item", injected: ["42"] });
  assert.equal(badged.textContent, "Item42", "the fixture stopped modelling the pollution");
  assert.equal(core.readCellText(badged), "Item");
  // And the page is NOT mutated: the badge is another feature's output, still there.
  assert.equal(badged.textContent, "Item42", "readCellText removed another feature's node from the page");
  // Our own node is the case A3.2 is actually about.
  assert.equal(core.readCellText(createCell({ text: "Quantity", injected: ["×"] })), "Quantity");
  assert.equal(core.readCellText(createCell({ text: " Rate ", injected: ["1", "2", "3"] })), "Rate");
  // Fail closed rather than dirty, both ways it can fail: a cell that carries an
  // injected node and cannot be cloned, and a clone whose node will not detach.
  // Returning the polluted text instead is the one outcome A3.2 forbids.
  assert.equal(core.readCellText({ textContent: "Item42", querySelector: () => ({ nodeType: 1 }) }), "");
  assert.equal(core.readCellText(createCell({ text: "Item", injected: [{ text: "42", detaches: false }] })), "");
  assert.equal(core.readCellText({
    textContent: "Item",
    querySelector: () => { throw new Error("hostile"); }
  }), "");
});

test("readHeaderLabels reads both header shapes, strips injections, and never opens the blank-label gate", () => {
  const core = createApi();
  // Both shapes are already pinned clean above ("reads the column axis from the
  // machine's hidden inputs and header labels"). Here they carry pollution.
  const bare = createLiveMachine({ wrappedHeaders: false });
  bare.rows[0].cells[0] = createHeaderCell("Item", { wrapped: false, injected: ["42"] });
  assert.deepEqual(plain(core.readHeaderLabels(bare)), LIVE_LABELS);
  // The identity path reads through the same function, so it is unpolluted too —
  // today internal-ids costs affinity 4 -> 3 on every badged header.
  assert.deepEqual(plain(core.readColumnIds(bare)), LIVE_AXIS);
  // Wrapped: the badge sits in the td beside div.listheader, so the wrapper read
  // already excludes it. Belt and braces, deliberately: either mechanism alone
  // gives the clean label.
  const wrapped = createLiveMachine();
  wrapped.rows[0].cells[0] = createHeaderCell("Item", { wrapped: true, injected: ["42"] });
  assert.deepEqual(plain(core.readHeaderLabels(wrapped)), LIVE_LABELS);
  assert.deepEqual(plain(core.readColumnIds(wrapped)), LIVE_AXIS);

  // The axis parameter is a FALLBACK for a blank label and nothing else: the
  // header of a machine that renders one column with no text still names that
  // column in a control bar, and its id is the only name left.
  const blanked = LIVE_LABELS.slice();
  blanked[3] = "   ";
  const table = createLiveMachine({ labels: blanked });
  const withAxis = plain(core.readHeaderLabels(table, LIVE_AXIS));
  assert.equal(withAxis[3], "quantitybilled");
  assert.deepEqual(withAxis.filter((_, index) => index !== 3), LIVE_LABELS.filter((_, index) => index !== 3));
  // And ONLY that. With no axis the blank stays blank — which is what keeps
  // A1.2's blank-label gate shut, since readColumnIds calls this with one
  // argument and refuses a machine whose header has a hole.
  assert.equal(plain(core.readHeaderLabels(table))[3], "");
  assert.deepEqual(plain(core.readColumnIds(table)), [], "a fallback label reopened the A1.2 blank gate");
  // A short axis fills what it has and leaves the rest blank — never an index shift.
  assert.deepEqual(plain(core.readHeaderLabels(table, ["item"])), blanked.map((label, index) =>
    (index === 3 ? "" : label)));
  assert.deepEqual(plain(core.readHeaderLabels(null, LIVE_AXIS)), []);
});

test("core has no DOM, storage, bridge or network authority", () => {
  assert.doesNotMatch(source, /document\.|chrome\.|fetch\(|XMLHttpRequest|innerHTML|localStorage|sessionStorage/);
  assert.doesNotMatch(source, /suiteMateV3ColumnOrder/);
  assert.doesNotMatch(source, /SuiteMateV3SoColumnsCore/);
});

test("neither mode can read the other's storage key, in EITHER direction", () => {
  // The forward half (edit-grid never names View Mode's key) is asserted above
  // and in the runtime purity test. The REVERSE half was missing, and its absence
  // is why a View Mode width delta could be suspected of being an edit-grid leak
  // at all: nothing in the suite said View Mode cannot see this feature's key.
  // Both directions now, so the isolation is a proven property rather than an
  // argument that has to be re-made from the source each time it is doubted.
  assert.doesNotMatch(soColumnsSource, /suiteMateV3EditColumns/,
    "so-columns/core.js names Edit Mode's storage key");
  assert.doesNotMatch(soColumnsRuntimeSource, /suiteMateV3EditColumns/,
    "so-columns/runtime.js names Edit Mode's storage key");
  // The cross-core handles too: neither feature may reach the other's API object.
  assert.doesNotMatch(soColumnsSource, /SuiteMateV3EditGridCore/);
  assert.doesNotMatch(soColumnsRuntimeSource, /SuiteMateV3EditGridCore/);
  // Not vacuous — each file really does name its OWN key, so these regexes are
  // looking at source that would match if the string were there.
  assert.match(soColumnsSource, /suiteMateV3ColumnOrder/);
  assert.match(source, /suiteMateV3EditColumns/);
  // And the two keys are genuinely different constants, not one aliased twice.
  const soColumns = createSoColumnsApi();
  assert.equal(createApi().STORAGE_KEY, "suiteMateV3EditColumns");
  assert.equal(soColumns.STORAGE_KEY, "suiteMateV3ColumnOrder");
  assert.notEqual(createApi().STORAGE_KEY, soColumns.STORAGE_KEY);
});

test("the two modes write widths to disjoint key spaces, and neither reads the other's", () => {
  // The DOM-writing layer of both features, side by side. This is the level at
  // which a leak would actually be VISIBLE — a width appearing on a table the
  // other mode owns — and both applyWidths functions are pure DOM, so it needs no
  // runtime harness. (A full runtime-level cross-mode mount does: so-columns has
  // no vm harness anywhere in the suite, only core tests and the browser fixture.
  // ESCALATED as disproportionate rather than half-built.)
  const core = createApi();
  const soColumns = createSoColumnsApi();

  // Edit Mode keys by COLUMN ID, decoded from _fs spans. View Mode keys by the
  // header's visible LABEL. The two key spaces cannot collide, and that is the
  // structural reason a stored width cannot cross: "quantity" is not "Quantity".
  const machine = createMachine();
  const editWidths = { item: 240, quantity: 161, rate: 137 };
  const viewWidths = { Item: 310, Quantity: 222, Rate: 199 };
  assert.equal(core.applyWidths(machine, editWidths, {}, ["item", "quantity", "rate"]), true);
  const applied = core.visibleCells(machine.rows[0]).map((cell) => cell.style.width);
  assert.deepEqual(plain(applied), ["240px", "161px", "137px"], "Edit Mode wrote its own widths");
  // Not one of View Mode's numbers reached the machine table.
  for (const width of Object.values(viewWidths)) {
    assert.equal(applied.includes(`${width}px`), false, `a View Mode width (${width}px) landed in Edit Mode`);
  }

  // Handing Edit Mode's core the View Mode map keys NOTHING: every column falls
  // back to its rendered width. A shared key space would have resized three.
  const crossed = createMachine();
  assert.equal(core.applyWidths(crossed, viewWidths, {}, ["item", "quantity", "rate"]), true);
  assert.deepEqual(
    plain(core.visibleCells(crossed.rows[0]).map((cell) => cell.style.width)),
    ["100px", "100px", "100px"],
    "a View Mode width map resized an Edit Mode column"
  );

  // And the mirror: so-columns handed Edit Mode's id-keyed map freezes every
  // column at what it renders and honours none of the ids.
  const viewTable = createSoColumnsTable(["Item", "Quantity", "Rate"], 80);
  assert.equal(soColumns.applyWidths(viewTable, editWidths), true);
  assert.deepEqual(viewTable.widths(), ["80px", "80px", "80px"],
    "an Edit Mode width map resized a View Mode column");
  // Non-vacuous: its OWN label-keyed map is honoured on the very same table.
  assert.equal(soColumns.applyWidths(viewTable, viewWidths), true);
  assert.deepEqual(viewTable.widths(), ["310px", "222px", "199px"]);
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
  if (table) {
    // The header row is the only row the resize gesture measures, and it is the
    // only row core.applyWidths writes to.
    layoutCells(table.rows[0].cells);
  }
  const counts = { editReads: 0, settingsReads: 0, writes: 0 };
  const toasts = [];
  const errors = [];
  const writes = [];
  const storageListeners = [];
  const windowListeners = [];
  const documentListeners = [];
  const bodyClasses = new Set();
  const lifecycle = createLifecycleStub();
  const location = createLocation(url);
  let settingsValue = settings;
  // How many upcoming edit-key reads must park, and the resolvers of the ones
  // that already have. A count rather than one shared promise (M2 Task 13): with
  // a single gate every parked read is released together, and a test cannot put
  // a save's read and an install's read on opposite sides of the same write —
  // which is the only way to tell the two halves of the reseed guard apart.
  // gateReads() with no argument gates every read until releaseRead(), exactly
  // as the single-gate version did.
  let gatedReads = holdRead ? Number.POSITIVE_INFINITY : 0;
  let parkedReads = [];

  const sandbox = {
    URL,
    URLSearchParams,
    TextEncoder,
    location,
    document: {
      readyState: "complete",
      documentElement: { dataset: {} },
      // The drag cursor lands on <body> for the life of a gesture, and the drag
      // pair is bound on the document under capture — neither exists in the M1
      // stub, and a runtime that reached for either would have thrown.
      body: {
        classList: {
          add: (name) => bodyClasses.add(name),
          remove: (name) => bodyClasses.delete(name),
          contains: (name) => bodyClasses.has(name)
        }
      },
      addEventListener(type, handler, options) {
        documentListeners.push({ type, handler, options });
      },
      removeEventListener(type, handler, options) {
        const at = documentListeners.findIndex((entry) =>
          entry.type === type && entry.handler === handler && entry.options === options);
        if (at >= 0) {
          documentListeners.splice(at, 1);
        }
      },
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
      createElement: (tagName) => createOwnedNode(tagName)
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
              // Snapshotted at CALL time, which is what a real request does: a
              // write that lands while this read is in flight does not
              // retroactively change the answer it already committed to. That
              // staleness IS defect D2's hazard, so a stub that resolved with
              // whatever storage held at RELEASE time could not model it.
              const snapshot = stored;
              if (gatedReads > 0) {
                gatedReads -= 1;
                await new Promise((done) => {
                  parkedReads.push(done);
                });
              }
              return { [key]: snapshot };
            }
            counts.settingsReads += 1;
            return { [key]: settingsValue };
          },
          async set(items) {
            counts.writes += 1;
            // Recorded AND kept: the container a write leaves behind is what the
            // next install reads, so a round trip through this stub is the
            // "seeded storage re-applies with zero writes" claim in miniature.
            writes.push(plain(items));
            if (EDIT_STORAGE_KEY in items) {
              stored = plain(items)[EDIT_STORAGE_KEY];
            }
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
    writes,
    lifecycle,
    windowListeners,
    documentListeners,
    bodyClasses: () => Array.from(bodyClasses),
    storedNow: () => stored,
    // Replaces the container the next install will read WITHOUT going through a
    // save — storage changing under a settled mount, which is the only way to
    // prove that an install still reads it once the reseed guard has disarmed.
    setStored: (next) => { stored = next; },
    // Re-arms the edit-key read gate so the NEXT `count` reads park. holdRead
    // gates the install's read; this gates a save's own read, which is where the
    // second half of the writer's generation guard lives. A finite count parks
    // only the reads a test names and lets the rest run to completion.
    gateReads(count = Number.POSITIVE_INFINITY) {
      gatedReads += count;
    },
    // Dispatches to what the runtime actually bound, in the order a real DOM
    // would deliver it: the document's capture-phase drag pair first, then the
    // container's delegated listener. Nothing is invoked by name.
    pointer(type, { target, ...init } = {}) {
      const event = {
        type,
        button: 0,
        clientX: 0,
        clientY: 0,
        ...init,
        target: target ?? container,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() {
          event.defaultPrevented = true;
        },
        stopPropagation() {
          event.propagationStopped = true;
        }
      };
      for (const entry of [...documentListeners, ...container.listeners]) {
        if (entry.type === type) {
          entry.handler(event);
        }
      }
      return event;
    },
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
    // Opens the gate and lets every parked read through, oldest first.
    releaseRead() {
      gatedReads = 0;
      const waiting = parkedReads;
      parkedReads = [];
      for (const done of waiting) {
        done();
      }
    },
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
  // A stored entry that carries no widths applies NOTHING: no class and no
  // inline width reaches any machine cell, and the machine keeps its own layout.
  // The 28 screenshot baselines depend on this staying true for every user who
  // has never dragged a column edge.
  for (const row of harness.table.rows) {
    for (const cell of row.cells) {
      assert.deepEqual(cell.classNames(), []);
      assert.equal(cell.style.width, "");
    }
  }
  assert.equal(harness.table.style.tableLayout, "");
  // A repaint re-installs: the marker, the binding and the axis stamp stay
  // singular. The stamp is re-derived through the pin, so it cannot drift.
  await harness.run("mutation");
  assert.equal(harness.mounts().length, 1);
  // One listener per event type, bound once — a second install must not stack a
  // second copy of the delegated set on the container.
  assert.deepEqual(
    harness.container.listeners.map(({ type }) => type),
    ["pointermove", "pointerleave", "pointerdown"]
  );
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

test("an install whose second axis read comes back empty never reaches applyAll, and reseeds nothing", async () => {
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
      warnedNewerSchema: false,
      // A gesture's width, already in module state when this install starts.
      columnWidths: { quantity: 161 },
      pendingWrites: 0,
      saveEpoch: 0
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
  const short = await run([["item", "quantity", "rate"], ["item"]]);
  assert.deepEqual(short.applied, []);

  // M2 Task 13 verdict, defect D2, second clause: a REFUSING install has mutated
  // nothing the user owns. The reseed used to sit above this gate, so an install
  // that gave up here had already replaced columnWidths — the sole record of the
  // user's gestures — with a storage snapshot, and the next gesture's write then
  // carried a map the lost column was no longer in. Both refusal shapes are
  // checked: the empty second read and the one-column one.
  assert.deepEqual(plain(latched.sandbox.columnWidths), { quantity: 161 },
    "an install that refused on an empty second axis read still reseeded columnWidths");
  assert.deepEqual(plain(short.sandbox.columnWidths), { quantity: 161 },
    "an install that refused on a one-column second axis read still reseeded columnWidths");

  // Not vacuous: the identical install DOES apply when the second read holds —
  // and THAT one reseeds, because storage is authoritative on every install that
  // gets far enough to use what it read. The stub's storage is empty, so the
  // gesture's 161px is correctly dropped here and only here.
  const applying = await run([["item", "quantity", "rate"], ["item", "quantity", "rate"]]);
  assert.deepEqual(plain(applying.applied), [["item", "quantity", "rate"]]);
  assert.deepEqual(plain(applying.sandbox.columnWidths), {},
    "a usable install must still take storage as authoritative");
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

// ===== M2: the resize gesture and width persistence =====
// The seams M1 shipped without callers — applyAll, enqueueSave — get them here,
// so these drive the runtime through the registration and the delegated
// listeners it actually bound (the standing M2 slice -> behavioural obligation).
const SCOPE = "FIXTURE:2462:salesord:edit";

function headerOf(harness, core) {
  return core.visibleCells(core.headerRow(harness.table));
}

function storedWidths(harness) {
  return harness.storedNow()?.grids?.[SCOPE]?.widths ?? null;
}

test("a drag on a header edge resizes that column, freezes the machine and writes once", async () => {
  const core = createApi();
  const harness = createRuntimeHarness();
  await harness.flush();
  const cells = headerOf(harness, core);
  const quantity = cells[1].getBoundingClientRect();
  assert.deepEqual(plain(cells.map((cell) => cell.style.width)), ["", "", ""], "nothing is applied before a gesture");

  const down = harness.pointer("pointerdown", {
    target: cells[1],
    clientX: quantity.right - 1,
    clientY: quantity.top + 4
  });
  // The 5px zone is ours; the rest of the header cell stays native. Both are
  // needed: NetSuite's own field help lives on .listheader inside the cell.
  assert.equal(down.defaultPrevented, true);
  assert.equal(down.propagationStopped, true);
  assert.deepEqual(harness.bodyClasses(), ["suitemate-v3-edit-grid-resizing"]);
  assert.deepEqual(harness.documentListeners.map(({ type }) => type), ["pointermove", "pointerup"]);
  assert.equal(harness.counts.writes, 0);

  harness.pointer("pointermove", { clientX: quantity.right + 60, clientY: quantity.top + 4 });
  // 100 rendered + 61 dragged. EVERY column is frozen, not just the dragged one:
  // a partial freeze under table-layout:fixed is the reflow this exists to stop.
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "161px", "100px"]);
  assert.equal(harness.table.style.tableLayout, "fixed");
  assert.equal(harness.counts.writes, 0, "a move is a repaint, never a write");

  harness.pointer("pointerup", { clientX: quantity.right + 60, clientY: quantity.top + 4 });
  assert.equal(harness.counts.writes, 0, "the save is queued, never synchronous");
  await harness.tick();

  // ONE write for the whole gesture, under this feature's own key, keyed by the
  // column id the PINNED axis puts under the pointer — not by a visible index
  // and not by a freshly derived axis.
  assert.equal(harness.counts.writes, 1);
  assert.deepEqual(harness.writes, [{
    [EDIT_STORAGE_KEY]: { schemaVersion: 1, grids: { [SCOPE]: { widths: { quantity: 161 } } } }
  }]);
  assert.deepEqual(harness.bodyClasses(), []);
  assert.deepEqual(harness.documentListeners, [], "the drag pair is unbound the moment the gesture ends");
  assert.deepEqual(harness.toasts, []);

  // A repaint-driven install re-applies from storage and writes NOTHING more.
  await harness.run("mutation");
  assert.equal(harness.counts.writes, 1);
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "161px", "100px"]);

  // A SECOND gesture starts from the width that was APPLIED, not from the one
  // the machine renders. Live, collapsed borders render ~2px over the style
  // value, so a rect-based start would hand every gesture a 2px head start and
  // walk the column wider every time it is touched. Modelled here by rendering
  // the frozen 161px column at 163px and dragging it by nothing at all.
  cells[1].offsetWidth = 163;
  layoutCells(harness.table.rows[0].cells);
  const drifted = cells[1].getBoundingClientRect();
  assert.equal(drifted.width, 163, "the stub must render wider than the applied width for this to mean anything");
  harness.pointer("pointerdown", { target: cells[1], clientX: drifted.right - 1, clientY: drifted.top + 4 });
  harness.pointer("pointermove", { clientX: drifted.right - 1, clientY: drifted.top + 4 });
  harness.pointer("pointerup", { clientX: drifted.right - 1, clientY: drifted.top + 4 });
  await harness.tick();
  assert.equal(harness.counts.writes, 2, "the second gesture is its own single write");
  assert.deepEqual(
    plain(harness.writes[1][EDIT_STORAGE_KEY].grids[SCOPE].widths),
    { quantity: 161 },
    "a zero-pixel drag moved the column, so the gesture started from the rect"
  );
});

test("only the 5px edge zone starts a gesture, and the hover marker never lingers", async () => {
  const core = createApi();
  const harness = createRuntimeHarness();
  await harness.flush();
  const cells = headerOf(harness, core);
  const quantity = cells[1].getBoundingClientRect();
  const marks = () => cells.map((cell) => cell.classNames());
  const hover = (clientX, clientY = quantity.top + 4) =>
    harness.pointer("pointermove", { target: cells[1], clientX, clientY });

  // Six pixels in is native territory: no marker, and no gesture starts there.
  hover(quantity.right - 6);
  assert.deepEqual(plain(marks()), [[], [], []]);
  harness.pointer("pointerdown", { target: cells[1], clientX: quantity.right - 6, clientY: quantity.top + 4 });
  assert.deepEqual(harness.documentListeners, [], "a click 6px inside the cell started a resize");
  assert.deepEqual(harness.bodyClasses(), []);

  // Five pixels in is the zone, and it marks exactly one cell.
  hover(quantity.right - 5);
  assert.deepEqual(plain(marks()), [[], ["suitemate-v3-edit-grid-resize-edge"], []]);
  // Above or below the header row is not the zone at all.
  hover(quantity.right - 1, quantity.bottom + 1);
  assert.deepEqual(plain(marks()), [[], [], []]);
  // The left edge belongs to the PREVIOUS column, which is what makes the zone
  // unambiguous when two cells meet.
  hover(cells[1].getBoundingClientRect().left);
  assert.deepEqual(plain(marks()), [["suitemate-v3-edit-grid-resize-edge"], [], []]);

  // Leaving the container clears the marker: pointermove stops firing at the
  // boundary, so without pointerleave the bar stays painted on a cold table.
  hover(quantity.right - 1);
  assert.deepEqual(plain(marks()), [[], ["suitemate-v3-edit-grid-resize-edge"], []]);
  harness.pointer("pointerleave");
  assert.deepEqual(plain(marks()), [[], [], []]);

  // A non-primary button never resizes, and a pointer over the container but
  // outside the machine is not a header edge at all.
  harness.pointer("pointerdown", {
    target: cells[1],
    clientX: quantity.right - 1,
    clientY: quantity.top + 4,
    button: 2
  });
  assert.deepEqual(harness.documentListeners, []);
  harness.pointer("pointerdown", { clientX: quantity.right - 1, clientY: quantity.top + 4 });
  assert.deepEqual(harness.documentListeners, []);
  assert.equal(harness.counts.writes, 0, "nothing so far was a gesture, so nothing was written");

  // The marker survives a pointerleave DURING a gesture. Dragging out past the
  // edge of the container is how a column gets wider, and the marker is the
  // user's evidence of which edge they have hold of.
  hover(quantity.right - 1);
  harness.pointer("pointerdown", { target: cells[1], clientX: quantity.right - 1, clientY: quantity.top + 4 });
  harness.pointer("pointerleave");
  assert.deepEqual(plain(marks()), [[], ["suitemate-v3-edit-grid-resize-edge"], []]);
  harness.pointer("pointerup", { clientX: quantity.right - 1, clientY: quantity.top + 4 });
  await harness.tick();
  // A zero-pixel drag is still a gesture, and a gesture is still exactly one write.
  assert.equal(harness.counts.writes, 1);
});

test("the column floor is measured at the moment of the clamp, never carried from pointerdown", async () => {
  // task-11-report.md open item 2 and the reviewer's +108px demonstration:
  // netsuite.css:2999-3001 sizes a materialised widget at calc(100% - 21px) of
  // its own cell, so a column minimum is a function of the width the column HAS
  // when it is measured. With no line open every minimum is 0.
  const core = createApi();
  const harness = createRuntimeHarness();
  await harness.flush();
  const cells = headerOf(harness, core);
  const quantity = cells[1].getBoundingClientRect();
  harness.pointer("pointerdown", { target: cells[1], clientX: quantity.right - 1, clientY: quantity.top + 4 });
  // A first move with no line open: every minimum is 0 and clampWidth floors at
  // the absolute 50px.
  harness.pointer("pointermove", { clientX: quantity.right - 90, clientY: quantity.top + 4 });
  assert.equal(headerOf(harness, core)[1].style.width, "50px");
  // NOW the line opens — live, widgets materialise per cell on the open line
  // only — and the very next move must see the floor that did not exist one
  // move ago. A minimum captured at pointerdown, or memoised on the first move,
  // is still 0 here and lets the column shrink under its own widget.
  harness.table.rows[1].cells[1] = createCell({ text: "2", widget: 180 });
  harness.pointer("pointermove", { clientX: quantity.right - 90, clientY: quantity.top + 4 });
  harness.pointer("pointerup", { clientX: quantity.right - 90, clientY: quantity.top + 4 });
  await harness.tick();
  // 100 - 89 = 11px asked for, floored at the 180px widget: never at 50, never
  // at the 30 View Mode uses, and never at the 0 pointerdown would have cached.
  assert.deepEqual(plain(storedWidths(harness)), { quantity: 180 });
  assert.equal(headerOf(harness, core)[1].style.width, "180px");
  assert.equal(harness.counts.writes, 1);
});

test("stored widths are restored on install, applied through the pinned axis, and cost no write", async () => {
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { widths: { rate: 240, quantity: 20 } } } }
  });
  await harness.flush();
  // rate takes its stored 240; quantity's 20 was already raised to the absolute
  // 50px floor on the way into storage; item, with nothing stored, is frozen at
  // what it renders so the flip to fixed layout moves nothing.
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "50px", "240px"]);
  assert.equal(harness.table.style.tableLayout, "fixed");
  assert.equal(harness.table.style.width, "", "the machine keeps its own overall sizing");
  // Body cells are never touched: under fixed layout row 1 is authoritative.
  assert.deepEqual(plain(core.visibleCells(harness.table.rows[1]).map((cell) => cell.style.width)), ["", "", ""]);
  assert.equal(harness.counts.writes, 0, "seeded storage plus install is a read, never a write");
});

// A repaint, modelled exactly as the machine performs it (probe 7: every row
// object is replaced, the header included): the header cells lose their inline
// widths, and `table.style.tableLayout` — which sits on the <table>, not on the
// <tbody> — does NOT. Measured on the fixture, the browser then redistributes
// the machine into equal columns, so `rendered` reads the redistribution rather
// than the machine's own layout; the stub models that by re-rendering every
// column at the same width.
function repaintHeader(harness, core, width = 120) {
  for (const cell of core.visibleCells(core.headerRow(harness.table))) {
    cell.style.width = "";
    cell.offsetWidth = width;
  }
  layoutCells(harness.table.rows[0].cells);
}

test("a repaint restores the widths the mount froze, never a re-measured redistribution", async () => {
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { widths: { quantity: 160 } } } }
  });
  await harness.flush();
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "160px", "100px"]);
  assert.equal(harness.table.style.tableLayout, "fixed");

  repaintHeader(harness, core);
  assert.equal(harness.table.style.tableLayout, "fixed", "the fixed layout survives a tbody swap");
  await harness.run("repaint");
  // 100px, not the 120px the redistributed table now renders: a re-measuring
  // apply is what collapsed a 325px Description to 111px on the fixture.
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "160px", "100px"]);
  assert.equal(harness.counts.writes, 0);
  // And again, so the frozen set cannot decay one repaint at a time.
  repaintHeader(harness, core, 140);
  await harness.run("repaint");
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "160px", "100px"]);
  // The restored layout is also STABLE: the target the next install computes
  // equals what the cells already carry, so it applies nothing further even
  // though the machine now renders every column at a different width than it
  // was frozen at — the live border-collapse divergence, which would otherwise
  // walk the columns 2px wider on every repaint.
  const written = [];
  for (const cell of headerOf(harness, core)) {
    let value = cell.style.width;
    Object.defineProperty(cell.style, "width", {
      configurable: true,
      get: () => value,
      set: (next) => {
        written.push(next);
        value = next;
      }
    });
  }
  await harness.run("repaint");
  assert.deepEqual(written, [], "a restored layout re-applied itself, which is how a width drifts");
});

test("a widget wider than its column never raises that column, and never becomes its frozen width", async () => {
  // The self-referential minimum (ledger note to probe 9): netsuite.css:2999-3001
  // sizes a materialised widget at calc(100% - 21px) of its own cell, so a widget
  // measured while its column is temporarily wide reports a large minimum.
  //
  // MEANING CHANGED at M2 Task 13 (defect D1). This test used to assert that an
  // apply HONOURED that minimum — "the floor is honoured while it stands" — and
  // only that the raise was never recorded as a frozen width. Live, that was the
  // defect: the raise is not transient at all, because NetSuite's entry row is
  // permanent and always materialised, so every apply re-measured, re-raised, and
  // fed its own output back into the next measurement. The assertion below is now
  // the opposite one — an apply reproduces the plan and nothing else — and the
  // frozen-set half it was written for stands unchanged underneath it.
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { widths: { rate: 60 } } } }
  });
  await harness.flush();
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "100px", "60px"]);

  // A line opens in the rate column while the machine is mid-redistribution, so
  // the widget measures the 200px the column momentarily has.
  harness.table.rows[1].cells[2] = createCell({ text: "$11.00", widget: 200 });
  repaintHeader(harness, core, 200);
  await harness.run("line-open");
  assert.equal(headerOf(harness, core)[2].style.width, "60px",
    "a widget widened a column the user had already sized");

  // The line closes, the widget goes with it, and the column is still the 60px
  // the user actually stored — it never inherited the floor in the first place.
  harness.table.rows[1].cells[2] = createCell({ text: "$11.00" });
  repaintHeader(harness, core);
  await harness.run("line-closed");
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "100px", "60px"]);
  assert.equal(harness.counts.writes, 0, "a clamp is not a user decision and is never persisted");
});

test("a restore never widens a column nobody dragged, and re-applying it writes the same bytes", async () => {
  // M2 Task 13 LIVE GATE, defect D1, and the regression net the suite did not
  // have. `rate` renders at 100px and carries a 260px widget from the moment the
  // machine is built — the live shape, because NetSuite's entry row is permanent
  // and always materialised, so the floor is there on EVERY apply. Nobody ever
  // drags rate in this test. Live, that column class went 72 -> 111 -> 174px.
  //
  // `rectDelta: 2` runs the WHOLE test with header cells whose rect is two pixels
  // over whatever was written on them — this repo's own measured collapsed-border
  // figure. That closes the second feedback loop end-to-end through the runtime:
  // not just "a floor must not widen a column" but "nothing an apply writes may
  // come back as the next apply's input", which is the general form of D1 and of
  // the so-columns defect this task escalated.
  const core = createApi();
  const harness = createRuntimeHarness({ machine: { widgets: { rate: 260 }, rectDelta: 2 } });
  await harness.flush();
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["", "", ""],
    "a machine nobody has resized keeps its own layout");

  // One gesture, on QUANTITY. The freeze it triggers covers every column, and
  // rate must be frozen at the 100px it renders — not at its widget.
  const cells = headerOf(harness, core);
  const box = cells[1].getBoundingClientRect();
  harness.pointer("pointerdown", { target: cells[1], clientX: box.right - 1, clientY: box.top + 4 });
  harness.pointer("pointermove", { clientX: box.right - 1 + 60, clientY: box.top + 4 });
  harness.pointer("pointerup", { clientX: box.right - 1 + 60, clientY: box.top + 4 });
  await harness.tick();
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "160px", "100px"],
    "the freezing apply widened a column the gesture never touched");
  assert.deepEqual(plain(storedWidths(harness)), { quantity: 160 });

  // Three restores in a row. Each used to re-measure the floor and hand it to
  // core, and because a widget is sized off its own cell, each apply's output
  // was the next measurement's input — that is the WALK, not a one-off raise.
  const seen = [];
  for (let round = 0; round < 3; round += 1) {
    repaintHeader(harness, core);
    await harness.run("repaint");
    seen.push(plain(headerOf(harness, core).map((cell) => cell.style.width)));
  }
  assert.deepEqual(seen, [
    ["100px", "160px", "100px"],
    ["100px", "160px", "100px"],
    ["100px", "160px", "100px"]
  ], "a restore widened a column nobody dragged");
  assert.equal(harness.counts.writes, 1, "the walk never reached storage, and neither does the fix");

  // IDEMPOTENCE, asserted on the assignments themselves rather than on the state
  // they leave behind: two consecutive applies of the same plan write
  // byte-identical strings to every cell.
  const written = [];
  for (const cell of headerOf(harness, core)) {
    let value = cell.style.width;
    Object.defineProperty(cell.style, "width", {
      configurable: true,
      get: () => value,
      set: (next) => {
        written.push(next);
        value = next;
      }
    });
  }
  repaintHeader(harness, core);
  await harness.run("repaint");
  const firstPass = written.splice(0);
  repaintHeader(harness, core);
  await harness.run("repaint");
  // The three "" are repaintHeader wiping the inline widths, the three pixel
  // values are the apply that follows. Pinned literally so an apply that writes
  // nothing at all cannot pass this as "identical".
  assert.deepEqual(firstPass, ["", "", "", "100px", "160px", "100px"]);
  assert.deepEqual(written, firstPass, "two applies of the same plan disagreed");

  // And the settled layout is STABLE: an install against it writes nothing at
  // all. The floor came out of core and out of targetSignature together, and
  // this is the assertion that holds them together — a column with a widget
  // wider than itself is exactly where the two can drift, and a signature that
  // predicts 260px for a cell core writes 100px to never converges, so every
  // repaint-driven install re-applies forever.
  written.length = 0;
  await harness.run("mutation");
  await harness.run("mutation");
  assert.deepEqual(written, [], "the target signature and core disagree about a widget-bearing column");

  // The floor still exists where a width is CHOSEN: a drag cannot pull rate
  // under its own 260px widget, which is the whole reason a floor is measured.
  const rate = headerOf(harness, core)[2].getBoundingClientRect();
  harness.pointer("pointerdown", { target: headerOf(harness, core)[2], clientX: rate.right - 1, clientY: rate.top + 4 });
  harness.pointer("pointermove", { clientX: rate.right - 90, clientY: rate.top + 4 });
  harness.pointer("pointerup", { clientX: rate.right - 90, clientY: rate.top + 4 });
  await harness.tick();
  assert.deepEqual(plain(storedWidths(harness)), { quantity: 160, rate: 260 },
    "the widget floor was dropped from the gesture as well as from the apply");
});

test("an install landing between pointerup and the write does not discard the gesture", async () => {
  // M2 Task 13 LIVE GATE, defect D2 — the data-loss one. Live, Quantity's 119px
  // was set, an install landed before the write, and the width was gone after a
  // reload while Item's 200px survived. Nothing in the suite modelled an install
  // INTERLEAVED with a gesture: the I-2 snapshot pin runs two gestures with
  // nothing at all between them.
  const core = createApi();
  const harness = createRuntimeHarness();
  await harness.flush();
  const cells = headerOf(harness, core);
  const drag = (index, by) => {
    const box = cells[index].getBoundingClientRect();
    harness.pointer("pointerdown", { target: cells[index], clientX: box.right - 1, clientY: box.top + 4 });
    harness.pointer("pointermove", { clientX: box.right - 1 + by, clientY: box.top + 4 });
    harness.pointer("pointerup", { clientX: box.right - 1 + by, clientY: box.top + 4 });
  };

  // An install starts and parks on its storage read. Its snapshot is the
  // PRE-gesture value, because nothing has been written yet — that is the whole
  // hazard: the reseed at the far side of this await is about to be handed a
  // picture of the world that is one gesture out of date.
  harness.gateReads();
  const reads = harness.counts.editReads;
  const install = harness.lifecycle.run("install-in-the-save-gap");
  await harness.tick();
  assert.equal(harness.counts.editReads, reads + 1, "the install should be parked on its own read");

  // Gesture A lands inside that gap.
  drag(1, 60);
  await harness.tick();
  assert.equal(harness.counts.writes, 0, "the save has not run yet — that is the gap");

  // Everything resumes: the install first, then the save behind it.
  harness.releaseRead();
  await install;
  await harness.tick();
  assert.equal(harness.counts.writes, 1);
  assert.deepEqual(plain(harness.writes[0][EDIT_STORAGE_KEY].grids[SCOPE].widths), { quantity: 160 });

  // Gesture B, on a different column. Its snapshot is the whole of columnWidths
  // and core.withWidths replaces entry.widths WHOLESALE, so if the install had
  // reseeded quantity out of module state this write is what deletes it from
  // storage — a second gesture destroying the first one's column, which is
  // exactly what the live record showed.
  drag(2, 40);
  await harness.tick();
  assert.equal(harness.counts.writes, 2);
  assert.deepEqual(
    plain(harness.writes[1][EDIT_STORAGE_KEY].grids[SCOPE].widths),
    { quantity: 160, rate: 140 },
    "an install in the save gap discarded the gesture before it, and the next write deleted it"
  );
  assert.deepEqual(plain(storedWidths(harness)), { quantity: 160, rate: 140 });
  assert.deepEqual(harness.toasts, []);

  // Not vacuous: once the writes are done and no gesture has happened since, an
  // install DOES take storage as authoritative again. A guard that simply never
  // reseeded would pass everything above and fail here.
  harness.setStored({ schemaVersion: 1, grids: { [SCOPE]: { widths: { quantity: 160, rate: 140, item: 210 } } } });
  await harness.run("mutation");
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["210px", "160px", "140px"],
    "a settled install stopped reading storage");
  assert.equal(harness.counts.writes, 2, "a restore is not a write");
});

test("both halves of the reseed guard are load-bearing: a save in flight, and a save already done", async () => {
  // The verdict mandates a counter AND a belt, and they cover different gaps.
  // Each is given the case where it is the ONLY thing standing between the user
  // and a deleted column, so neither can rot into unpinned dead weight.
  const core = createApi();
  const drag = (harness, index, by) => {
    const cells = headerOf(harness, core);
    const box = cells[index].getBoundingClientRect();
    harness.pointer("pointerdown", { target: cells[index], clientX: box.right - 1, clientY: box.top + 4 });
    harness.pointer("pointermove", { clientX: box.right - 1 + by, clientY: box.top + 4 });
    harness.pointer("pointerup", { clientX: box.right - 1 + by, clientY: box.top + 4 });
  };
  const bothColumns = (harness) =>
    plain(harness.writes[1]?.[EDIT_STORAGE_KEY]?.grids?.[SCOPE]?.widths);

  // THE COUNTER, alone. The install starts AFTER the gesture, so it captures the
  // epoch the gesture already bumped and the belt is inert by construction. It
  // parks before the save's own read is even issued, so it resumes first — with
  // a snapshot that predates the write, and with that write still in flight.
  const inFlight = createRuntimeHarness();
  await inFlight.flush();
  inFlight.gateReads();
  drag(inFlight, 1, 60);
  const installA = inFlight.lifecycle.run("install-after-the-gesture");
  await inFlight.tick();
  assert.equal(inFlight.counts.writes, 0, "the save must still be in flight for this half to mean anything");
  inFlight.releaseRead();
  await installA;
  await inFlight.tick();
  drag(inFlight, 2, 40);
  await inFlight.tick();
  assert.deepEqual(bothColumns(inFlight), { quantity: 160, rate: 140 },
    "a reseed from a snapshot older than a save STILL IN FLIGHT dropped the gesture");

  // THE BELT, alone. Only the install's read parks, so the gesture that lands
  // inside its await runs its save all the way to completion — the counter is
  // back at zero by the time the install resumes, and the only thing that knows
  // the install's snapshot is out of date is the epoch it captured beforehand.
  const settled = createRuntimeHarness();
  await settled.flush();
  settled.gateReads(1);
  const installB = settled.lifecycle.run("install-before-the-gesture");
  await settled.tick();
  drag(settled, 1, 60);
  await settled.tick();
  assert.equal(settled.counts.writes, 1, "the save must have finished for this half to mean anything");
  settled.releaseRead();
  await installB;
  await settled.tick();
  drag(settled, 2, 40);
  await settled.tick();
  assert.deepEqual(bothColumns(settled), { quantity: 160, rate: 140 },
    "a reseed from a snapshot older than a COMPLETED save dropped the gesture");
});

test("a header index is only a column key while the axis and the header are the same width", () => {
  // The gesture keys itself by the visible index of the cell under the pointer.
  // A 43-id axis indexed onto a 42-cell header caught mid-repaint would resize a
  // neighbouring column and store the width under the wrong id — the silent
  // mis-key class A1.2 exists to refuse.
  const [helper] = runtimeSource.match(
    / {2}function columnIdOfHeaderCell\(table, cell\) \{[\s\S]*?\n {2}\}/
  ) ?? [];
  assert.equal(Boolean(helper), true, "columnIdOfHeaderCell is no longer a named function in runtime.js");
  const cells = [createCell(), createCell(), createCell()];
  const ask = (columnIds, cell) => {
    const sandbox = {
      cell,
      currentColumnIds: () => columnIds,
      headerCellsOf: () => cells
    };
    sandbox.globalThis = sandbox;
    runInNewContext(`${helper}\nglobalThis.result = columnIdOfHeaderCell(null, cell);`, sandbox);
    return sandbox.result;
  };
  assert.equal(ask(["item", "quantity", "rate"], cells[1]), "quantity");
  assert.equal(ask(["item", "quantity"], cells[1]), null, "a short axis must not key by index");
  assert.equal(ask(["item", "quantity", "rate", "sys"], cells[1]), null, "a long axis must not key by index");
  assert.equal(ask([], cells[1]), null);
  assert.equal(ask(["item", "quantity", "rate"], createCell()), null, "a cell that is not in the header");
});

test("a repaint with a line open still restores the widths", async () => {
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { widths: { quantity: 160 } } } }
  });
  await harness.flush();
  // Line 1 opens: the row keeps its numbered id and gains the focused classes,
  // and the machine rebuilds the whole tbody around it.
  harness.table.rows[1] = createRow({
    id: "item_row_1",
    className: "uir-machine-row uir-machine-row-focused listfocusedrow",
    cells: harness.table.rows[1].cells
  });
  repaintHeader(harness, core);
  await harness.run("line-open");
  // Skipping the apply here is not caution, it is the yank: the machine is in
  // fixed layout with no widths, which is what collapsed all twelve fixture
  // columns to 120px until the line was closed again.
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "160px", "100px"]);
  assert.equal(harness.counts.writes, 0);
  // Everything that MOVES or REMOVES a row still queues — that is what
  // pendingApply carries, and both gates route through the same helper so they
  // cannot drift apart.
  const [helper] = runtimeSource.match(/ {2}function applyWhileLineOpen\(table, columnIds\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(helper), true, "applyWhileLineOpen is no longer a named function in runtime.js");
  assert.match(helper, /pendingApply = true;/);
  assert.match(helper, /applyCurrentWidths\(table, columnIds\);/);
  const [install] = runtimeSource.match(
    / {2}async function installEditGrid\(\{ signal, isCurrent \}\) \{[\s\S]*?\n {2}\}/
  ) ?? [];
  const [queue] = runtimeSource.match(/ {2}function queueApply\(reason\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.match(install, /applyWhileLineOpen\(table, current\);/);
  assert.match(queue, /applyWhileLineOpen\(table, columnIds\);/);
});

test("an install whose rendering already equals the target touches no cell", async () => {
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { widths: { rate: 240 } } } }
  });
  await harness.flush();
  const cells = headerOf(harness, core);
  assert.deepEqual(plain(cells.map((cell) => cell.style.width)), ["100px", "100px", "240px"]);
  // Every width assignment from here on is recorded. renderSignature and
  // targetSignature agree once the layout is applied, so the next install must
  // perform ZERO DOM writes — that agreement is what makes "one gesture = one
  // write, then flat for 500ms" measurable at all.
  const written = [];
  for (const cell of cells) {
    let value = cell.style.width;
    Object.defineProperty(cell.style, "width", {
      configurable: true,
      get: () => value,
      set: (next) => {
        written.push(next);
        value = next;
      }
    });
  }
  await harness.run("mutation");
  await harness.run("mutation");
  assert.deepEqual(written, [], "an install re-applied a layout that was already correct");
  assert.equal(harness.counts.writes, 0);
  // Not vacuous: a width the DOM does not carry yet IS applied through the very
  // same recorder.
  harness.table.rows[0].cells[0].style.width = "";
  await harness.run("mutation");
  assert.deepEqual(written, ["", "100px", "100px", "240px"]);
});

test("the target signature predicts what core writes, zero-rendered column included", async () => {
  // Adjudication #15 lands in TWO files — core stopped gating the assignment on
  // a positive target, and targetSignature stopped gating the predicted string
  // the same way. Unfold either one alone and the two disagree about the
  // zero-rendered column forever: the signatures never converge, so every
  // repaint-driven install re-applies. Counted here through getBoundingClientRect,
  // which targetSignature reads once per header cell and core.applyWidths reads
  // once more — so an install that only computes the signature is n reads and one
  // that also applies is 2n, whether or not the apply changes anything.
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { widths: { rate: 240 } } } }
  });
  harness.table.rows[0].cells[0] = createCell({ text: "Item", width: 0 });
  layoutCells(harness.table.rows[0].cells);
  await harness.flush();
  const cells = headerOf(harness, core);
  // The zero-rendered column is frozen at the absolute floor, not left fluid.
  assert.deepEqual(plain(cells.map((cell) => cell.style.width)), ["50px", "100px", "240px"]);

  let reads = 0;
  for (const cell of cells) {
    const measure = cell.getBoundingClientRect;
    cell.getBoundingClientRect = (...args) => {
      reads += 1;
      return measure.apply(cell, args);
    };
  }
  await harness.run("repaint");
  assert.equal(reads, cells.length, "the install re-applied a layout it had already applied");
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["50px", "100px", "240px"]);
  assert.equal(harness.counts.writes, 0);

  // The counter above catches an unfolded CORE (it would leave the column at
  // width:"" while the target says 50px, and the two would never converge). The
  // signature side needs its own pin, because once a mount has frozen a layout
  // every axis column has a positive planned width and the zero branch is no
  // longer reachable through an install: it is the FIRST apply, with nothing
  // frozen yet, that has to predict the floor for a column measuring nothing.
  const [signature] = runtimeSource.match(
    / {2}function targetSignature\(table, columnIds\) \{[\s\S]*?\n {2}\}/
  ) ?? [];
  const [planner] = runtimeSource.match(/ {2}function plannedWidths\(\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(signature), true, "targetSignature is no longer a named function in runtime.js");
  const fresh = createMachine();
  fresh.rows[0].cells[0] = createCell({ text: "Item", width: 0 });
  const sandbox = {
    core,
    headerCellsOf: (target) => core.visibleCells(core.headerRow(target)),
    columnWidths: { rate: 240 },
    frozenWidths: {},
    table: fresh
  };
  sandbox.globalThis = sandbox;
  runInNewContext(
    `${planner}\n${signature}\nglobalThis.result = targetSignature(table, ["item", "quantity", "rate"]);`,
    sandbox
  );
  assert.deepEqual(JSON.parse(sandbox.result).widths, ["50px", "100px", "240px"],
    "the first apply's target left the zero-rendered column unpredicted");
});

test("each gesture writes its own snapshot, never a map a later gesture has moved", async () => {
  // Two gestures land before the queue drains either of them — one drag, then
  // another on a different column, with nothing awaited in between. That is a
  // fast user and a slow chrome.storage.sync, and it is what separates a
  // snapshot captured at ENQUEUE time from module state read when the operation
  // finally runs: a run-time read sees the LATEST map, so gesture A writes
  // gesture B's state.
  //
  // The severe form of the same defect is silent data loss, not a stale write.
  // An install landing in the same gap reseeds columnWidths from storage, and
  // for a user with no saved widths yet that is {} — so a run-time read hands
  // core.withWidths a null, and the entry the gesture was trying to create is
  // DELETED. The capture is what makes that unreachable.
  const core = createApi();
  const harness = createRuntimeHarness();
  await harness.flush();
  const cells = headerOf(harness, core);
  const drag = (index, by) => {
    const box = cells[index].getBoundingClientRect();
    harness.pointer("pointerdown", { target: cells[index], clientX: box.right - 1, clientY: box.top + 4 });
    harness.pointer("pointermove", { clientX: box.right - 1 + by, clientY: box.top + 4 });
    harness.pointer("pointerup", { clientX: box.right - 1 + by, clientY: box.top + 4 });
  };
  drag(1, 60);
  drag(2, 40);
  assert.equal(harness.counts.writes, 0, "neither save has run yet — that is the whole setup");
  await harness.tick();

  assert.equal(harness.counts.writes, 2, "two gestures are two writes");
  assert.deepEqual(
    plain(harness.writes[0][EDIT_STORAGE_KEY].grids[SCOPE].widths),
    { quantity: 160 },
    "the first gesture wrote a map that only existed after the second one"
  );
  assert.deepEqual(
    plain(harness.writes[1][EDIT_STORAGE_KEY].grids[SCOPE].widths),
    { quantity: 160, rate: 140 },
    "the second gesture must still carry both"
  );
  // Storage ends where the user left it, in order, with nothing dropped.
  assert.deepEqual(plain(storedWidths(harness)), { quantity: 160, rate: 140 });
});

test("a save whose mount was torn down before it ran writes nothing", async () => {
  // The queue's own guarantee is narrow (see enqueueSave): a continuation that
  // resumes after a teardown finds a FRESH chain, and nothing more. The
  // operation is neither cancelled nor generation-checked there, so this is the
  // writer's guard — checked before the read AND after it, because the await is
  // exactly where a teardown lands.
  const core = createApi();
  const drag = (harness) => {
    const cells = headerOf(harness, core);
    const box = cells[1].getBoundingClientRect();
    harness.pointer("pointerdown", { target: cells[1], clientX: box.right - 1, clientY: box.top + 4 });
    harness.pointer("pointermove", { clientX: box.right + 40, clientY: box.top + 4 });
    harness.pointer("pointerup", { clientX: box.right + 40, clientY: box.top + 4 });
  };

  // 1. Torn down before the queue reaches the operation at all.
  const early = createRuntimeHarness();
  await early.flush();
  const readsBefore = early.counts.editReads;
  drag(early);
  assert.equal(early.counts.writes, 0);
  await early.changeSettings({ salesOrderColumnsEdit: false });
  await early.tick();
  assert.equal(early.counts.writes, 0, "a save outlived its own mount");
  // Not even the READ happens: an operation that already knows its mount is gone
  // has no business touching storage at all, which is what the check in front of
  // the read buys over the one behind it.
  assert.equal(early.counts.editReads, readsBefore, "an abandoned save still read storage");
  assert.deepEqual(early.toasts, [], "an abandoned save is silent, not a failure");

  // 2. Torn down while the operation is parked on its OWN storage read.
  const parked = createRuntimeHarness();
  await parked.flush();
  parked.gateReads();
  drag(parked);
  await parked.tick();
  assert.equal(parked.counts.writes, 0, "the operation should be parked on its read");
  await parked.changeSettings({ salesOrderColumnsEdit: false });
  parked.releaseRead();
  await parked.tick();
  assert.equal(parked.counts.writes, 0, "a save parked on its read wrote after its mount was gone");

  // 3. Not vacuous: the identical gesture on a mount that is still standing
  //    writes exactly once.
  const standing = createRuntimeHarness();
  await standing.flush();
  drag(standing);
  await standing.tick();
  assert.equal(standing.counts.writes, 1);
});

test("teardown restores the native layout, drops a live gesture and forgets the widths", async () => {
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { widths: { rate: 240 } } } }
  });
  await harness.flush();
  assert.equal(harness.table.style.tableLayout, "fixed");
  const cells = headerOf(harness, core);
  // A gesture is in flight when the teardown lands.
  const box = cells[1].getBoundingClientRect();
  harness.pointer("pointerdown", { target: cells[1], clientX: box.right - 1, clientY: box.top + 4 });
  assert.deepEqual(harness.bodyClasses(), ["suitemate-v3-edit-grid-resizing"]);

  harness.lifecycle.registration.cleanup({ reason: "paused" });
  assert.deepEqual(plain(cells.map((cell) => cell.style.width)), ["", "", ""]);
  assert.equal(harness.table.style.tableLayout, "");
  assert.deepEqual(harness.documentListeners, [], "the drag pair survived a teardown");
  assert.deepEqual(harness.bodyClasses(), [], "the drag cursor survived a teardown");
  assert.equal(harness.counts.writes, 0, "teardown is not a save");
  // A pointerup arriving after the teardown finds no gesture and writes nothing.
  harness.pointer("pointerup", { clientX: box.right + 40, clientY: box.top + 4 });
  await harness.tick();
  assert.equal(harness.counts.writes, 0);
  // And the remount re-reads storage rather than replaying a stale in-memory map.
  await harness.run("resumed");
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "100px", "240px"]);
  assert.equal(harness.counts.writes, 0);
});

test("every width apply hands core the pinned axis, and only teardown clears without one", () => {
  // Adjudication #14: core.applyWidths is axis-TAKING. The brief predates it and
  // has applyCurrentWidths calling with three arguments; that shape would refuse
  // every active apply, because core fails closed on a missing axis.
  const [applier] = runtimeSource.match(
    / {2}function applyCurrentWidths\(table, columnIds\) \{[\s\S]*?\n {2}\}/
  ) ?? [];
  const [planner] = runtimeSource.match(/ {2}function plannedWidths\(\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(applier), true, "applyCurrentWidths is no longer a named function in runtime.js");
  assert.equal(Boolean(planner), true, "plannedWidths is no longer a named function in runtime.js");
  const calls = [];
  const measured = [];
  const cells = [{ style: { width: "" } }, { style: { width: "" } }, { style: { width: "" } }];
  const table = { style: { tableLayout: "" } };
  const sandbox = {
    core: {
      applyWidths: (target, widths, minimums, columnIds) => {
        calls.push([target, widths, minimums, columnIds]);
        // Stands in for core: freeze the header, flip the layout.
        cells.forEach((cell, index) => {
          cell.style.width = `${(widths ?? {})[columnIds[index]] ?? 100}px`;
        });
        table.style.tableLayout = widths ? "fixed" : "";
        return true;
      },
      // Answers a REAL floor for every column, and is expected never to be
      // called. The all-zeros stub that used to sit here is what made defect D1
      // structurally invisible to every runtime test: with no floor in the model
      // there was nothing for the apply path to widen (M2 Task 13 verdict).
      columnMinimums: (target, ids) => {
        measured.push(ids);
        return Object.fromEntries(ids.map((id) => [id, 400]));
      }
    },
    headerCellsOf: () => cells,
    columnWidths: { quantity: 160 },
    frozenWidths: {}
  };
  sandbox.globalThis = sandbox;
  runInNewContext(`${planner}\n${applier}\nglobalThis.run = applyCurrentWidths;`, sandbox);
  const axis = ["item", "quantity", "rate"];

  sandbox.run(table, axis);
  assert.equal(calls[0].length, 4, "core.applyWidths is the four-argument, axis-TAKING signature");
  assert.deepEqual(plain(calls[0][3]), axis, "the axis is the fourth argument");
  assert.deepEqual(plain(calls[0][1]), { quantity: 160 });
  // Parameter 3 is the empty map, and columnMinimums was never called at all:
  // the apply path stopped measuring the live table (M2 Task 13 verdict, defect
  // D1). It measured on EVERY apply before, which is what handed core a
  // non-zero floor for every widget-bearing column and walked them wider.
  assert.deepEqual(plain(calls[0][2]), {}, "the apply path measured a floor");
  assert.deepEqual(measured, [], "the apply path called core.columnMinimums");
  // The freezing apply — the one that took the machine out of its own layout —
  // records what it froze for EVERY column, so a repaint that wipes the inline
  // widths while table-layout:fixed survives it can be restored without
  // re-measuring a table the browser has already redistributed.
  assert.deepEqual(plain(sandbox.frozenWidths), { item: 100, quantity: 160, rate: 100 });

  // A later apply runs against an already-fixed table and records NOTHING: a
  // minimum measured there is inflated by the redistribution itself.
  sandbox.columnWidths = { quantity: 300 };
  sandbox.run(table, axis);
  assert.deepEqual(plain(calls[1][2]), {}, "a later apply measured a floor");
  assert.deepEqual(plain(calls[1][1]), { item: 100, quantity: 300, rate: 100 }, "the user's width wins over the frozen one");
  assert.deepEqual(plain(sandbox.frozenWidths), { item: 100, quantity: 160, rate: 100 }, "a restore re-recorded the frozen set");

  // With nothing the user set, core is handed null — the CLEAR shape, never a {}
  // that would freeze a machine nobody has resized — and the frozen set goes too.
  sandbox.columnWidths = {};
  sandbox.run(table, axis);
  assert.equal(calls[2][1], null);
  assert.deepEqual(plain(sandbox.frozenWidths), {});

  // The only other call site is the teardown clear, which carries no axis by
  // design: the pin is dropped in the same function and a mount that can no
  // longer key its columns must still be able to undo what it set.
  assert.equal((runtimeSource.match(/core\.applyWidths\(/g) ?? []).length, 2);
  const [teardown] = runtimeSource.match(/ {2}function removeEditGrid\(\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.match(teardown, /core\.applyWidths\(table, null, \{\}\);/);
  // Every axis that reaches an apply comes from the pin, never from core.
  const [move] = runtimeSource.match(/ {2}function handleResizeMove\(event\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.match(move, /currentColumnIds\(resizing\.table\)/);
  assert.doesNotMatch(move, /core\.readColumnIds/);
});

test("typing into the permanent entry row reads as dirty, and an open line still governs", () => {
  // THE M2 DECISION, pinned. isDirty()'s FOCUSED_ROW_SELECTOR is deliberately
  // unqualified: the permanent entry row is always focused, so a user halfway
  // through typing a new line reads as dirty — which is the mitigation, not the
  // defect. It has no caller until M3, so this drives the SHIPPED predicate
  // sliced out of runtime.js rather than a re-typed one.
  const [predicate] = runtimeSource.match(/ {2}function isDirty\(\) \{[\s\S]*?\n {2}\}/) ?? [];
  const [helper] = runtimeSource.match(/ {2}function fieldIsDirty\(field\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(predicate), true, "isDirty is no longer a named function in runtime.js");
  assert.equal(Boolean(helper), true, "fieldIsDirty is no longer a named function in runtime.js");
  // The decision is recorded where it is implemented, not only in a report.
  assert.match(predicate, /ENTRY-ROW DIRTINESS/);
  const core = createApi();
  const dirty = (rows) => {
    const table = createTable(rows);
    const sandbox = { core, activeTable: table, machineTable: () => table };
    sandbox.globalThis = sandbox;
    runInNewContext(`${helper}\n${predicate}\nglobalThis.result = isDirty();`, sandbox);
    return sandbox.result;
  };
  const field = (value, defaultValue) => ({ tagName: "INPUT", value, defaultValue });
  const focusedRow = (id, fields, extra = "") => {
    const row = createRow({ id, className: `uir-machine-row uir-machine-row-focused ${extra}`.trim() });
    row.querySelectorAll = () => fields;
    return row;
  };
  const header = createRow({ className: "uir-machine-headerrow", cells: [createCell()] });
  const entryPristine = focusedRow("", [field("", ""), field("1", "1")]);
  const entryTyped = focusedRow("", [field("SKU-1", ""), field("1", "1")]);

  assert.equal(dirty([header]), false, "no focused row at all");
  assert.equal(dirty([header, entryPristine]), false, "an untouched entry row is not dirty");
  assert.equal(dirty([header, entryTyped]), true, "typing into the permanent entry row reads as dirty");
  // An open numbered line renders ABOVE the entry row, so it is the row
  // querySelector finds first and the one that governs.
  const openClean = focusedRow("item_row_2", [field("2", "2")], "listfocusedrow");
  const openTyped = focusedRow("item_row_2", [field("9", "2")], "listfocusedrow");
  assert.equal(dirty([header, openClean, entryTyped]), false);
  assert.equal(dirty([header, openTyped, entryPristine]), true);
});

test("runtime owns no observer, no HTML sink and no View Mode storage", () => {
  assert.doesNotMatch(runtimeSource, /innerHTML|new MutationObserver|suiteMateV3ColumnOrder|SuiteMateV3SoColumnsCore/);
  // M2 is the first milestone that writes. Exactly ONE write site, inside
  // saveWidths, serialized through enqueueSave, and it writes only this
  // feature's own key — "one gesture = exactly one write" is not measurable
  // against a runtime with a second, unqueued writer somewhere else.
  assert.equal((runtimeSource.match(/chrome\.storage\.sync\.set\(/g) ?? []).length, 1);
  const [writer] = runtimeSource.match(/ {2}function saveWidths\(\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(writer), true, "saveWidths is no longer a named function in runtime.js");
  assert.match(writer, /await chrome\.storage\.sync\.set\(\{ \[core\.STORAGE_KEY\]: next \}\)/);
  assert.match(writer, /return enqueueSave\(/);
  assert.doesNotMatch(runtimeSource, /chrome\.storage\.local/);
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
