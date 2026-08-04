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
// THE OWNER'S OTHER ENTRY FORM, captured live 2026-08-04 from salesord 16357099
// and trimmed to the eight sample lines core keeps. It is a JSON file rather than
// an inline constant for one reason: 62 labels, 179 field ids and eight 62-cell
// rows is a payload no reviewer can proofread inline, and every byte of it is
// evidence rather than fixture-writing. It is NOT an HTML fixture and carries no
// src/href of its own, so it is deliberately absent from tests/verify.mjs' link
// list — that loop exists to access-check the references INSIDE a fixture page,
// and there are none to check here.
const FORM_B = JSON.parse(
  await readFile(resolve(root, "tests/fixtures/salesord-form-b-identity.json"), "utf8")
);

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
  // A cell THIS FEATURE has hidden measures ZERO. `display: none !important`
  // removes it from layout entirely, so its border box has no width at all —
  // and that zero is an artifact of our own rendering, not a fact about the
  // column. Modelled here because adjudication #20's whole hazard is a
  // measurement taken in this state: without it the stub reports a hidden
  // column at its full offsetWidth, no apply can ever read the floor, and the
  // defect is unreachable by any test (A3.3 — a stub that flattens a quantity
  // the production code derives from its own output is blindness).
  if (cell.classList?.contains?.("suitemate-v3-edit-grid-col-hidden") === true) {
    return 0;
  }
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
  injected = [],
  // NetSuite's star on a mandatory column: `<span class="listheaderreq"
  // title="Required Field">` inside the header cell's div.listheader, with the *
  // itself rendered from CSS rather than written into the text (probed on the
  // locked order 2026-08-04 — Item and Tax Code carry it there, Quantity does
  // not). Modelled as a queryable child rather than as text, because that is how
  // the runtime has to find it and because a text-shaped stub would let a reader
  // that matched on "*" look correct.
  required = false
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
    querySelector: (selector) => {
      if (String(selector).includes("listheaderreq")) {
        return required ? { className: "listheaderreq", title: "Required Field" } : null;
      }
      return spanId && selector.includes("_fs") ? { id: spanId } : null;
    },
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
  widgets = {}, rectDelta = null,
  // Which columns NetSuite has STARRED, by id. Defaults to ["item"] because that
  // is the live shape — the locked order stars Item and Tax Code and nothing
  // else, and a machine with no mandatory column at all is a machine this
  // feature never meets. A test that needs the other arrangements says so:
  // `required: []` for a form that stars nothing, `["item", "rate"]` for two.
  required = ["item"]
} = {}) {
  const starred = (id) => required.includes(id);
  const header = createRow({
    className: "uir-machine-headerrow",
    cells: [
      createCell({ text: "Item", rectDelta, required: starred("item") }),
      createCell({ text: "Quantity", rectDelta, required: starred("quantity") }),
      createCell({ text: "Rate", rectDelta, required: starred("rate") }),
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
  // NetSuite's star on a mandatory column, and the whole of the required-column
  // detection's DOM contract (owner directive 2026-08-04). Pinned as a STRING
  // because the runtime reads it straight from the header: a rename would
  // otherwise surface only as "no column is required any more", which renders
  // exactly like the feature working.
  assert.equal(core.REQUIRED_FIELD_SELECTOR, "span.listheaderreq");
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
    "HEADER_LABEL_SELECTOR", "REQUIRED_FIELD_SELECTOR",
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
  miniForm = false,
  // The line number the FIRST rendered row carries. The machine pages its lines
  // (inpt_item_segment_select), so a rendered row's line number is a fact about
  // which segment the user is looking at and not about how many rows exist:
  // "26 - 50 of 202" renders item_row_26 first. Defaults to 1, which is the
  // unpaged machine every earlier test models.
  firstLine = 1
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
    id: `item_row_${firstLine + index}`,
    className: index === focusedRowIndex
      ? "uir-machine-row uir-machine-row-focused"
      : "uir-machine-row",
    cells: texts.map((text) => createCell({ text }))
  }));
  return createTable([header, ...dataRows], { form });
}

// ===== The segment-paged machine =====
// NetSuite pages a large sublist through inpt_item_segment_select and renders one
// segment at a time: 202 lines are shown 25 at a time, and choosing "26 - 50 of
// 202" REPLACES the header and tbody with rows whose ids start at item_row_26.
// Live on the owner's record 16365465 that turned the feature off — every rendered
// line number was past the 8 lines parseMachineFieldData kept, so no sample could
// be read at all and identity declined on a machine that had not changed.
//
// The data is the live 25-field slice repeated to `count` lines, so line N's raw
// values and line N's rendered text are the same pair the two-line tests use — the
// only thing that varies is WHICH lines the DOM is showing.
function liveSegmentData(count) {
  return Array.from({ length: count }, (_, index) => (index % 2 === 0 ? LIVE_LINE_1 : LIVE_LINE_2).join(SOH))
    .join(STX);
}

function liveSegmentRows(firstLine, count) {
  return Array.from({ length: count }, (_, index) => ((firstLine + index - 1) % 2 === 0 ? LIVE_ROW_1 : LIVE_ROW_2));
}

test("a segment-paged machine is read from the rows it is SHOWING, not its first lines", () => {
  const core = createApi();
  // 30 lines of data; the DOM renders ONLY lines 26-30, which is segment two of a
  // paged machine and the exact shape that declined live.
  const dataValue = liveSegmentData(30);
  const machine = createLiveMachine({
    miniForm: true,
    dataValue,
    rows: liveSegmentRows(26, 5),
    firstLine: 26
  });
  assert.deepEqual(plain(machine.rows.slice(1).map((row) => row.id)),
    ["item_row_26", "item_row_27", "item_row_28", "item_row_29", "item_row_30"]);
  // THE DECLINE, PINNED — this assertion IS the owner's bug. The SAME axis the
  // unpaged machine derives: line 26's rendered text is scored against line 26's
  // raw values, because both are indexed by the line number.
  assert.deepEqual(plain(core.readColumnIdsFrom(machine, LIVE_FIELDS_VALUE, dataValue)), LIVE_AXIS);
  // …and the data it was read from really is longer than the sample cap, so the
  // assertion above cannot pass by the machine being small.
  const parsed = core.parseMachineFieldData(LIVE_FIELDS_VALUE, dataValue);
  assert.equal(parsed.lines.length, 30, "the parse still truncates the machine's own data");
  // Sample collection is line-indexed and sparse: the 25 lines this segment is not
  // showing are holes, not zeros, and nothing is shifted up to fill them.
  const samples = core.readSampleRowTexts(machine, LIVE_LABELS.length, 30);
  assert.equal(samples.length, 30);
  assert.equal(samples[0], undefined, "a line this segment is not showing became a sample");
  assert.deepEqual(plain(samples[25]), LIVE_ROW_2);
  assert.deepEqual(plain(samples[29]), LIVE_ROW_2);
  // THE CAP MOVED, and this is where it is measured: it now bounds how many
  // RENDERED rows are read, not how far into the data a line index may reach. A
  // segment showing 12 rows contributes the first MAX_SAMPLE_ROWS of them.
  const wide = createLiveMachine({
    miniForm: true, dataValue, rows: liveSegmentRows(19, 12), firstLine: 19
  });
  const wideSamples = core.readSampleRowTexts(wide, LIVE_LABELS.length, 30);
  assert.equal(wideSamples.filter((row) => row !== undefined).length, core.MAX_SAMPLE_ROWS);
  assert.deepEqual(plain(wideSamples[18]), LIVE_ROW_1, "collection did not start at the first rendered row");
  assert.equal(wideSamples[26], undefined, "the 9th rendered row was read");
  assert.deepEqual(plain(core.readColumnIdsFrom(wide, LIVE_FIELDS_VALUE, dataValue)), LIVE_AXIS);
  // The last segment after an add-line — lines 201-202 of 202 — is the owner's
  // original report, and it is the same shape with a bigger index.
  const tail = liveSegmentData(202);
  const lastSegment = createLiveMachine({
    miniForm: true, dataValue: tail, rows: liveSegmentRows(201, 2), firstLine: 201
  });
  assert.deepEqual(plain(core.readColumnIdsFrom(lastSegment, LIVE_FIELDS_VALUE, tail)), LIVE_AXIS);
});

test("correlation cost depends on how many rows are shown, never on WHICH lines", () => {
  // A COST CEILING, pinned as a COUNT rather than as a clock — a timing assertion
  // in a test suite is a flake, and this measures the thing that actually grew.
  //
  // `sampleTexts` is sparse and line-indexed, so a machine paged to lines 995-1002
  // hands correlation a ~1000-slot array holding eight rows. Scoring runs once per
  // (label x candidate) pair — 62 x 163 on the owner's form — so a sweep over the
  // whole index space touches every hole 10,106 times instead of once: measured at
  // 1182ms against 85ms for the identical eight rows at lines 1-8, on the content
  // script's own thread, on every repaint-driven install. Un-capping the parse
  // (which the segment fix requires) is what made that reachable.
  //
  // The census reads each index once; nothing after it may touch a hole at all.
  const core = createApi();
  const parsed = core.parseMachineFieldData(LIVE_FIELDS_VALUE, liveSegmentData(400));
  const columns = core.collapseDisplayTwins(parsed.fieldIds, parsed.lines);
  const base = [];
  base[397] = LIVE_ROW_2;
  base[398] = LIVE_ROW_1;
  base[399] = LIVE_ROW_2;
  base.length = 400;
  let holeReads = 0;
  const counted = new Proxy(base, {
    get(target, key) {
      if (typeof key === "string" && /^[0-9]+$/.test(key) && !(key in target)) {
        holeReads += 1;
      }
      return Reflect.get(target, key);
    }
  });
  const axis = core.correlateColumnIds(LIVE_LABELS, columns, counted);
  // Non-vacuous: the sparse far-end samples really do carry the derivation.
  assert.deepEqual(plain(axis), LIVE_AXIS);
  // AN INEQUALITY, deliberately: the property is "no hole is touched per
  // (label x candidate) pair", not "the census reads each index exactly once".
  // An exact count pinned the census's own implementation — a hole-SKIPPING
  // census (for…in, strictly cheaper) read zero holes and FAILED the equality
  // with a message claiming a sweep, measured in review. The ceiling still
  // kills the real regression: an index-space sweep reads 397 holes x every
  // scoring pair (95,677 measured), which no bound tied to base.length admits.
  assert.ok(holeReads <= base.length,
    "a hole was read per scoring pair — the index-space sweep is back");
});

test("the absolute line cap bounds the parse and degrades instead of refusing", () => {
  const core = createApi();
  // MAX_MACHINE_LINES is private (the MIN_RESOLVED_COLUMNS precedent — a pathology
  // bound is not contract), so its value is asserted through what the parse keeps.
  const CAP = 1000;
  const dataValue = liveSegmentData(CAP + 5);
  const parsed = core.parseMachineFieldData(LIVE_FIELDS_VALUE, dataValue);
  assert.equal(parsed.lines.length, CAP, "the parse is unbounded, or the cap moved");
  // A segment rendered entirely INSIDE the cap resolves exactly as any other.
  const inside = createLiveMachine({
    miniForm: true, dataValue, rows: liveSegmentRows(CAP - 4, 5), firstLine: CAP - 4
  });
  assert.deepEqual(plain(core.readColumnIdsFrom(inside, LIVE_FIELDS_VALUE, dataValue)), LIVE_AXIS);
  // A segment STRADDLING the cap: the rows past it have no data to be scored
  // against, so they contribute no sample — and the rows within it still carry the
  // derivation. Degrading, not refusing.
  const straddling = createLiveMachine({
    miniForm: true, dataValue, rows: liveSegmentRows(CAP - 2, 5), firstLine: CAP - 2
  });
  const straddlingSamples = core.readSampleRowTexts(straddling, LIVE_LABELS.length, CAP);
  assert.equal(straddlingSamples.filter((row) => row !== undefined).length, 3, "a row past the cap was sampled");
  assert.deepEqual(plain(core.readColumnIdsFrom(straddling, LIVE_FIELDS_VALUE, dataValue)), LIVE_AXIS);
  // And when EVERY rendered row is past the cap there is no evidence at all, so
  // the no-samples pre-gate refuses — the fail-closed shape, not a guess.
  const beyond = createLiveMachine({
    miniForm: true, dataValue, rows: liveSegmentRows(CAP + 1, 5), firstLine: CAP + 1
  });
  assert.deepEqual(plain(core.readSampleRowTexts(beyond, LIVE_LABELS.length, CAP)), []);
  assert.deepEqual(plain(core.readColumnIdsFrom(beyond, LIVE_FIELDS_VALUE, dataValue)), []);
});

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

  // AN OPTION LIST IS A SHAPE, NOT A BYTE. Form B's line-7 `description` is
  // ordinary free text carrying one stray TRAILING ENQ, and "contains an ENQ"
  // deleted the whole column over it — after which the DP handed the
  // "Description" label `unitconversionrate`, unanimously, and the axis named the
  // wrong field while looking perfectly healthy. Splitting yields ONE non-empty
  // segment, so it is a cell.
  const strays = core.collapseDisplayTwins(
    ["description", "leading", "onlyenq", "unitslist"],
    [[`Brow Pencil - Light/Medium${ENQ}`, `${ENQ}Ea`, ENQ, `3${ENQ}4${ENQ}5`]]
  );
  assert.deepEqual(plain(strays.map((column) => column.id)), ["description", "leading", "onlyenq"]);
  // The VALUE is kept whole, ENQ and all: this rule decides what is a column, and
  // must not quietly rewrite the text correlation then scores against.
  assert.equal(strays[0].values[0], `Brow Pencil - Light/Medium${ENQ}`);
  // A real serialized list still goes — two non-empty segments is enough, so the
  // narrowing costs nothing on the shape it was written for.
  assert.deepEqual(
    plain(core.collapseDisplayTwins(["a", "b"], [[`3${ENQ}4`, "x"]]).map((column) => column.id)),
    ["b"]
  );
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
  // One sampled row is enough here; zero is not — the no-samples pre-gate fires,
  // and it is the EXPLICIT statement of a refusal the old unique-optimum gate used
  // to make incidentally. With no rendered row there is no value evidence at all
  // and identity would rest on header text, which is what A1.2 refuses.
  assert.deepEqual(plain(core.correlateColumnIds(LIVE_LABELS, columns, [LIVE_ROW_1])), LIVE_AXIS);
  assert.deepEqual(plain(core.correlateColumnIds(LIVE_LABELS, columns, [])), []);
  assert.deepEqual(plain(core.correlateColumnIds(LIVE_LABELS, columns, [[], []])), [], "rows with no cells");
  // Unrecognised locale: no label affinity anywhere. Under per-column unanimity
  // this no longer throws the machine away — it resolves the columns VALUE
  // corroboration alone pins and leaves the rest as holes. Every id it emits is
  // the true one; nothing is guessed. This is the generalization's whole claim,
  // measured on a machine where the label evidence is gone entirely.
  const localeAxis = plain(
    core.correlateColumnIds(LIVE_LABELS.map((_, i) => `Colonne ${i}`), columns, [LIVE_ROW_1, LIVE_ROW_2])
  );
  assert.equal(localeAxis.length, LIVE_LABELS.length);
  assert.deepEqual(
    localeAxis,
    ["item", null, null, null, null, "quantityavailable", null, "units", "description", "price", "custcol_rrp", "rate"]
  );
  // NO MIS-KEY, stated as its own assertion because it is the property that
  // matters and the deepEqual above would still pass if both sides were wrong
  // together: every id the unanimity walk emitted agrees with the corroborated
  // axis derived from the real labels.
  localeAxis.forEach((id, index) => {
    if (id !== null) {
      assert.equal(id, LIVE_AXIS[index], `position ${index} disagrees with the corroborated axis`);
    }
  });
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

// ===== Per-column unanimity =====
// A UNANIMITY UNIT, built small enough to reason about by hand rather than
// measured off a live payload: the fixture test below proves the mechanism on the
// real form, and this proves it is the mechanism claimed and not a coincidence of
// that form's numbers.
//
// Three labels, four candidates. `ratecard` and `rateschedule` are
// INDISTINGUISHABLE to every piece of evidence this correlator has: both score
// labelAffinity 3 against "Rate" (each flat id starts with "rate"), both hold ""
// on every line so both take the same missing-value penalty, and neither
// corroborates. So the optimum is reached by exactly two alignments that agree
// everywhere except the last position — which is the shape the whole design turns
// on, and which the old gate answered by throwing all three columns away.
const TIE_FIELDS = ["item_display", "item", "quantity", "ratecard", "rateschedule"];
const TIE_LINES = [
  ["SKU-1001", "4998", "2", "", ""],
  ["SKU-1002", "1405", "4", "", ""]
];
const TIE_LABELS = ["Item", "Quantity", "Rate"];
const TIE_ROWS = [["SKU-1001", "2", "$11.00"], ["SKU-1002", "4", "$12.00"]];

test("per-column unanimity resolves what every optimum agrees on and holes the rest", () => {
  const core = createApi();
  const parsed = core.parseMachineFieldData(
    TIE_FIELDS.join(SOH),
    TIE_LINES.map((values) => values.join(SOH)).join(STX)
  );
  const columns = core.collapseDisplayTwins(parsed.fieldIds, parsed.lines);
  assert.deepEqual(plain(columns.map((column) => column.id)),
    ["item", "quantity", "ratecard", "rateschedule"]);
  // Two optima, differing at exactly one position: that position is a HOLE and
  // the two the optima agree on are adopted. Under the old whole-machine gate
  // this whole axis was [].
  assert.deepEqual(plain(core.correlateColumnIds(TIE_LABELS, columns, TIE_ROWS)), ["item", "quantity", null]);
  // …and the SINGLE-optimum variant of the same machine, which is the byte-identity
  // claim in miniature: give `rateschedule` a value the Rate cell corroborates and
  // the tie is broken, so nothing is holed. Nothing else about the machine moves.
  const brokenTie = core.parseMachineFieldData(
    TIE_FIELDS.join(SOH),
    [["SKU-1001", "4998", "2", "", "11.00"], ["SKU-1002", "1405", "4", "", "12.00"]]
      .map((values) => values.join(SOH)).join(STX)
  );
  assert.deepEqual(
    plain(core.correlateColumnIds(
      TIE_LABELS,
      core.collapseDisplayTwins(brokenTie.fieldIds, brokenTie.lines),
      [["SKU-1001", "2", "11.00"], ["SKU-1002", "4", "12.00"]]
    )),
    ["item", "quantity", "rateschedule"]
  );
  // THE FAIL-CLOSED FLOOR. Two resolved columns is an axis; one is a column and a
  // row of holes, and nothing can be keyed against it — so the machine is refused
  // outright, exactly as `width < 2` is. Built by holing a SECOND position the
  // same way the first was: `quantitya`/`quantityb` are as indistinguishable to
  // "Quantity" as the rate pair is to "Rate", so only `item` survives.
  const floorFields = ["item_display", "item", "quantitya", "quantityb", "ratecard", "rateschedule"];
  const floorParsed = core.parseMachineFieldData(
    floorFields.join(SOH),
    [["SKU-1001", "4998", "", "", "", ""], ["SKU-1002", "1405", "", "", "", ""]]
      .map((values) => values.join(SOH)).join(STX)
  );
  assert.deepEqual(
    plain(core.correlateColumnIds(
      TIE_LABELS,
      core.collapseDisplayTwins(floorParsed.fieldIds, floorParsed.lines),
      TIE_ROWS
    )),
    []
  );
  // A candidate whose id cannot survive normalizeColumnId is refused rather than
  // counted toward that floor — this function is exported and directly callable,
  // so the emission sites are not the only place an id can enter an axis. The
  // optimum here is unique and NAMES the reserved key, so the gate is genuinely
  // the thing that refuses.
  assert.deepEqual(
    plain(core.correlateColumnIds(["Item", "Proto"], [
      { id: "item", values: ["a"] },
      { id: "__proto__", values: ["b"] }
    ], [["a", "b"]])),
    []
  );
  // Non-vacuous: rename that one candidate and the identical machine resolves.
  assert.deepEqual(
    plain(core.correlateColumnIds(["Item", "Proto"], [
      { id: "item", values: ["a"] },
      { id: "proto", values: ["b"] }
    ], [["a", "b"]])),
    ["item", "proto"]
  );
});

test("the owner's other Sales Order form mounts: 62 columns, 3 holes, no mis-key", () => {
  // THE OWNER'S BUG, pinned. Live capture 2026-08-04 from salesord 16357099, the
  // record hide/show did nothing on: a DIFFERENT entry form from the one every
  // earlier test measures. 62 visible labels — "GST" appears TWICE, at 19 and 36 —
  // against 179 machine fields collapsing to 163 candidates, DP optimum 343
  // reached by 24 distinct alignments. The unique-optimum gate therefore declined
  // the ENTIRE form, on every record that uses it, forever.
  //
  // Across all 24 optima, 59 of the 62 positions are unanimous and exactly three
  // are not. The four the owner actually hides are among the 59.
  //
  // THE WHOLE AXIS IS ASSERTED, all 62 entries, and that is a correction to this
  // test rather than a flourish. Its first version asserted 8 of the 59 resolved
  // positions and passed green while position 8 named `unitconversionrate` for a
  // column labelled "Description" — a mis-key nothing in the suite was looking at.
  // The lesson is the round's own ruling read backwards: a hole is safe and a
  // confident wrong answer is not, so the wrong answers are exactly what a test
  // has to enumerate, and AN UNASSERTED POSITION IS WHERE THE NEXT ONE HIDES.
  // Holes are written as nulls in the literal so the three are legible in place
  // rather than only as indexes.
  const core = createApi();
  const machine = createLiveMachine({
    miniForm: true,
    fieldsValue: FORM_B.itemfields_full,
    dataValue: FORM_B.itemdata_8lines,
    labels: FORM_B.headerLabels,
    rows: FORM_B.sampleRowTexts
  });
  const axis = plain(core.readColumnIdsFrom(machine, FORM_B.itemfields_full, FORM_B.itemdata_8lines));
  assert.equal(axis.length, 62, "the form declined, or the capture is not the 62-column form");
  assert.deepEqual(axis, [
    "item", "quantity", "quantitycommitted", "quantityfulfilled", "quantitybilled",
    "quantitybackordered", "quantityavailable", "units", "description", "price",
    "custcol_salesorder_tun_qty", "custcol_item_shipper_qty", "custcol_custom_original_quantity",
    "location", "isclosed", "custcolsd_closure_reason", "custcol_sps_itemstatuscode1",
    "rate", "amount", "taxrate1", "taxcode", "grossamt", "custcol_sps_tp_order_qty",
    "custcol_anx_mco_line_id", "inventorydetail", "class", "quantityallocated",
    "orderallocationstrategy", "expectedshipdate", "requesteddate", "averagecost",
    "costestimatetype", "costestimate", "custcol_item_origin", "commitmentfirm",
    "orderpriority",
    null,                                   // 36 "GST"
    "options", "createpo",
    null,                                   // 39 "Reallocate Order Item"
    "excludefromraterequest", "custcol_online_oversell",
    null,                                   // 42 "Reason Code (SO)"
    "dayslate", "custcol_hs_code", "custcol_sps_linesequencenumber", "custcol_sps_bpn",
    "custcol_sps_vendorpartnumber", "custcol_sps_upc", "custcol_sps_gtin", "custcol_sps_ean",
    "custcol_sps_ndc", "custcol_sps_msr_unitprice", "custcol_sps_innerpack",
    "custcol_sps_purchaseprice", "custcol_sps_orderqtyuom", "custcol_sps_rtl_unitprice",
    "custcol_sps_productcolorcode", "custcol_sps_productsizedescription",
    "custcol_sps_productcolordescription", "custcol_sps_upccasecode",
    "custcol_mcol_mystery_original"
  ]);
  // EXACTLY three holes, and exactly these three. Named with their labels and the
  // candidate sets that made them ambiguous, because a test that only counted
  // nulls would pass just as well if the walk holed three arbitrary columns. The
  // sets are RE-DERIVED against the 163-candidate pool the narrowed option-list
  // rule produces, and are unchanged from the 162-pool measurement:
  //   36 "GST"                   {tax1amt, refamt}
  //   39 "Reallocate Order Item" {warnnodropship, kithasdropship, allocationalert}
  //   42 "Reason Code (SO)"      {waves, picktasks, itemfulfillments, custcol_atlas_rc_so}
  assert.deepEqual(axis.flatMap((id, index) => (id === null ? [index] : [])), [36, 39, 42]);
  // POSITION 8 IS ITS OWN ASSERTION, because it is the one the full-axis deepEqual
  // above was added for: a stray trailing ENQ in line 7's free-text description
  // used to delete `description` from the candidate pool, and the DP handed this
  // position `unitconversionrate` — unanimously, on every optimal alignment.
  assert.equal(FORM_B.headerLabels[8], "Description");
  assert.equal(axis[8], "description");
  assert.deepEqual(
    [36, 39, 42].map((index) => FORM_B.headerLabels[index]),
    ["GST", "Reallocate Order Item", "Reason Code (SO)"]
  );
  // THE OWNER'S ACTUAL HIDDEN SET, read off the labels rather than trusted:
  // Item, Quantity, Committed, Fulfilled, Invoiced, Back Ordered.
  assert.deepEqual(
    FORM_B.headerLabels.slice(0, 6),
    ["Item", "Quantity", "Committed", "Fulfilled", "Invoiced", "Back Ordered"]
  );
  assert.equal(axis[2], "quantitycommitted");
  assert.equal(axis[3], "quantityfulfilled");
  assert.equal(axis[4], "quantitybilled");
  assert.equal(axis[5], "quantitybackordered");
  assert.equal(axis[0], "item");
  assert.equal(axis[1], "quantity");
  // Every resolved id is unique and storable — the axis is a key space, and a
  // repeated id would key two columns to one stored width.
  const resolved = axis.filter((id) => id !== null);
  assert.equal(resolved.length, 59);
  assert.equal(new Set(resolved).size, 59, "an id was claimed by two positions");
  assert.equal(resolved.every((id) => typeof id === "string" && id === id.trim() && id.length > 0), true);
  // The duplicate "GST" label is not what holed position 36 — its twin at 19
  // resolves cleanly. Position is what separates them, exactly as the
  // duplicate-label test below asserts on the narrow machine.
  assert.equal(FORM_B.headerLabels[19], "GST");
  assert.equal(axis[19], "taxrate1");
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
  // An unrecognised locale carries no label affinity anywhere, and no longer
  // costs the whole machine: the columns value corroboration pins resolve, the
  // rest are holes, and every emitted id agrees with the corroborated axis. The
  // same measurement as the correlateColumnIds test, asserted on THIS entry too
  // because adjudication #13's duplication is what lets the two drift.
  const localeAxis = from(
    LIVE_FIELDS_VALUE, LIVE_DATA_VALUE, { labels: LIVE_LABELS.map((_, index) => `Colonne ${index}`) }
  );
  assert.equal(localeAxis.length, LIVE_LABELS.length);
  // Five holes — positions 1-4 and 6, the four quantity* columns that all render
  // "0" or "" and the Quantity column beside them; seven ids, every one correct.
  assert.equal(localeAxis.filter((id) => id === null).length, 5);
  localeAxis.forEach((id, index) => {
    if (id !== null) {
      assert.equal(id, LIVE_AXIS[index], `position ${index} disagrees with the corroborated axis`);
    }
  });
  // A blank header label, and a header narrower than two columns.
  const blanked = LIVE_LABELS.slice();
  blanked[4] = "";
  assert.deepEqual(from(LIVE_FIELDS_VALUE, LIVE_DATA_VALUE, { labels: blanked }), []);
  assert.deepEqual(from(LIVE_FIELDS_VALUE, LIVE_DATA_VALUE, { labels: ["Item"], rows: [["MCH376"]] }), []);
  // No rendered lines: no value evidence at all, so the no-samples pre-gate
  // refuses — the explicit form of what the unique-optimum gate used to do here.
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
  const plan = (state) => {
    const sandbox = { naturalWidths: {}, frozenWidths: {}, columnWidths: {}, ...state };
    sandbox.globalThis = sandbox;
    runInNewContext(`${planner}\nglobalThis.result = plannedWidths();`, sandbox);
    return plain(sandbox.result);
  };
  assert.deepEqual(
    Object.keys(plan({ frozenWidths: { item: 120, quantity: 160, rate: 100 }, columnWidths: { quantity: 160 } })).sort(),
    [...columnIds].sort(),
    "plannedWidths stopped naming every column — the partial-plan walk above becomes reachable");
  // ADJUDICATION #20 keeps that precondition rather than breaking it. A column
  // the runtime is hiding is absent from frozenWidths BY CONSTRUCTION (the freeze
  // refuses to record one), so if the plan simply omitted it — the ruling's
  // literal shape — this precondition would fail and core's partial-plan walk
  // would become reachable on every apply. naturalWidths is what keeps the plan
  // total, and what it contributes is a measurement taken while the column was
  // NOT hidden.
  assert.deepEqual(
    plan({
      naturalWidths: { item: 120, quantity: 74, rate: 100 },
      frozenWidths: { item: 120, rate: 100 },
      columnWidths: { rate: 100 }
    }),
    { item: 120, quantity: 74, rate: 100 },
    "a hidden column left the plan, or entered it at anything but its last unhidden width");
  // Precedence, weakest first: last-unhidden, then this mount's freeze, then the
  // user's own gesture.
  assert.deepEqual(
    plan({
      naturalWidths: { item: 1, quantity: 2, rate: 3 },
      frozenWidths: { item: 10, quantity: 20 },
      columnWidths: { item: 100 }
    }),
    { item: 100, quantity: 20, rate: 3 });
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
  // Every channel other than our own class that could make a cell invisible, or
  // make an invisible one visible. `style.display` is the axis-bearing one; the
  // `hidden` PROPERTY is the second, and it has its own recorded cost in this
  // repo (`save/CHECKPOINTS.md:972` — display-defeats-hidden), which is why the
  // pin is "our class and nothing else" rather than "no inline display".
  const written = () => plain(core.tableRows(table)
    .map((row) => Array.from(row.cells).map((cell) => [cell.style.display, cell.hidden ?? null])));
  const native = written();

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
  assert.deepEqual(written(), native, "applyHidden wrote outside its own class");
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
  assert.deepEqual(written(), native, "a reveal wrote outside its own class");
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
  assert.equal(core.applyHidden(null, ["quantity"], EDIT_AXIS), false);
  assert.equal(core.applyHidden(undefined, ["quantity"], EDIT_AXIS), false);
  // Only the ACTIVE path refuses. The reveal is ruled unconditional — its own
  // test, below.
});

test("ADJUDICATION #19: the reveal is unconditional — a stale class comes off a broken machine", () => {
  // The ruling's requirement, pinned as its own test because it is the one place
  // in this feature where refusing is WORSE than acting: a teardown that fails
  // closed strands SuiteMate's class on NetSuite's page, and the class carries
  // `display: none !important`, so a stranded one hides a column of the user's
  // data with no UI left to un-hide it.
  const core = createApi();
  const stale = (options) => {
    const table = createMachine(options);
    assert.equal(core.applyHidden(table, ["quantity"], EDIT_AXIS), true);
    assert.equal(anythingClassed(core, table), true, "nothing was staged to clear");
    return table;
  };

  // 1. No axis at all, and an axis of the wrong width — neither blocks a reveal.
  for (const axis of [null, undefined, [], "item,quantity,rate", ["item", "quantity"],
    ["item", "quantity", "rate", "extra"]]) {
    const table = stale();
    assert.equal(core.applyHidden(table, [], axis), true,
      `a broken axis (${JSON.stringify(axis) ?? "undefined"}) blocked a reveal`);
    assert.equal(anythingClassed(core, table), false, "a stale class survived a reveal");
  }

  // 2. The header row itself is gone — a repaint that swapped the machine out
  // from under a teardown. applyWidths' restore refuses here because it writes to
  // header CELLS and cannot work without them; this sweep needs no header at all,
  // and the stale classes are on the DATA rows, which are still right there.
  const beheaded = stale();
  beheaded.rows.splice(0, 1);
  assert.equal(core.headerRow(beheaded), null, "the fixture still has a header row");
  assert.equal(anythingClassed(core, beheaded), true);
  assert.equal(core.applyHidden(beheaded, [], EDIT_AXIS), true, "a missing header row blocked a reveal");
  assert.equal(anythingClassed(core, beheaded), false, "a stale class survived a headerless reveal");

  // 3. Both at once: no header, no axis. Still cleared.
  const worst = stale();
  worst.rows.splice(0, 1);
  assert.equal(core.applyHidden(worst, [], null), true);
  assert.equal(anythingClassed(core, worst), false);

  // 4. A cell NetSuite has hidden with its OWN inline display since the apply.
  // That is the only way this feature's class can land on a cell visibleCells no
  // longer returns, and it is why the sweep runs over row.cells rather than
  // visibleCells: leave the class there and the column springs back hidden — by
  // SuiteMate's `!important` rule — the moment NetSuite shows the cell again,
  // with the feature long since torn down and nothing left to un-hide it.
  const swapped = stale();
  swapped.rows[1].cells[1].style.display = "none";
  assert.equal(core.visibleCells(swapped.rows[1]).length, 2, "the fixture is not modelling the swap");
  assert.equal(core.applyHidden(swapped, [], EDIT_AXIS), true);
  assert.equal(swapped.rows[1].cells[1].classList.contains(HIDDEN_CLASS), false,
    "a class was stranded on a cell NetSuite hid after the apply");
  // And the OTHER half of that same state, which the first version of this test
  // reached and then declined to measure. The laundering hazard is symmetric: a
  // reveal that cleared inline display only where it found its own class would be
  // a no-op everywhere except right here — and here it clears NETSUITE'S `none`,
  // the cell rejoins visibleCells, readColumnIds derives a LONGER axis, and that
  // axis keys storage on the next install. Shortening the axis (M5/M22) and
  // lengthening it (M27, which is this state's mutation) are the same defect
  // wearing opposite signs.
  //
  // M27 AND NOT M21, and the difference is the reason these two assertions exist
  // at all. Both clear inline display on the reveal, but M21 clears it on EVERY
  // cell in the sweep — so it wipes NetSuite's `none` off the system cells
  // wholesale and dies instantly on the ordinary three-column snapshot. M27
  // clears it only where it finds OUR OWN class: a strict subset, a no-op in
  // every state the suite otherwise inspects, and it survived all 298 tests.
  // Only M27 reaches the hazard, and only this fixture reaches M27.
  //
  // THE GENERAL RULE, because it is not about these two mutations: a mutation
  // GUARDED BY "only where our own output already is" can be invisible to a suite
  // that catches its unguarded twin. Mutation-proving that stops at the
  // unguarded form proves the wrong thing. This state is what exposes the class —
  // do not simplify it away.
  assert.equal(swapped.rows[1].cells[1].style.display, "none",
    "the reveal cleared NetSuite's OWN inline display");
  assert.equal(core.visibleCells(swapped.rows[1]).length, 2,
    "a NetSuite-hidden cell was resurrected onto the axis");

  // 5. A set whose every entry is falsy takes the RESTORE route, not the active
  // one. With a usable axis the two are indistinguishable — the active path would
  // match no id and toggle everything off — so the routing has to be measured
  // where they diverge: a BROKEN axis, where restore clears and returns true
  // while the active path refuses and strands.
  const falsy = stale();
  assert.equal(core.applyHidden(falsy, [null, "", undefined, 0, false], null), true,
    "an all-falsy set was routed into the active path");
  assert.equal(anythingClassed(core, falsy), false);

  // 6. The sweep does not consult isExcludedRow, and must not: that predicate
  // fails CLOSED (it answers true for a row it cannot interrogate), so a row that
  // throws at teardown would keep its class forever behind an exclusion the
  // reveal never needed to ask about.
  const hostile = stale();
  hostile.rows[1].matches = () => { throw new Error("hostile"); };
  assert.equal(core.isExcludedRow(hostile.rows[1]), true, "the fixture is not failing closed");
  assert.equal(core.applyHidden(hostile, [], EDIT_AXIS), true);
  assert.equal(anythingClassed(core, hostile), false, "a class was stranded on a fail-closed row");

  // 7. The floor: no machine at all is still a refusal, not a vacuous success.
  // There is nothing to sweep and a null reference is a caller defect, so the
  // carve-out does not extend to inventing a success signal for it.
  assert.equal(core.applyHidden(null, [], EDIT_AXIS), false);
  assert.equal(core.applyHidden(undefined, [], null), false);
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
  // The same statement one level down, at the function that computes the axis:
  // a hidden cell is still a VISIBLE cell as far as visibleCells is concerned,
  // because visibleCells reads inline display and this feature writes none.
  const widths = () => plain(core.tableRows(table).map((row) => core.visibleCells(row).length));
  assert.deepEqual(widths(), [12, 12, 12], "a hidden cell dropped off the axis");
  const expected = LIVE_AXIS.map((id) => id === "quantity" || id === "rate");
  for (const row of core.tableRows(table)) {
    assert.deepEqual(hiddenFlags(core, row), expected, "the wrong columns hid on a twelve-column axis");
  }
  // An id that is not on the axis is ignored, not an error and not an extra hide.
  assert.equal(expected.filter(Boolean).length, 2);

  // The round trip, because the hazard is asymmetric: an inline write left behind
  // by a reveal is exactly as laundering as one written by a hide, and a class
  // removed is not obviously the inverse of a class added.
  assert.equal(core.applyHidden(table, [], LIVE_AXIS), true);
  assert.deepEqual(widths(), [12, 12, 12], "a cell left the axis across the round trip");
  assert.deepEqual(plain(core.readColumnIds(table)), LIVE_AXIS, "revealing moved the column axis");
  assert.deepEqual(plain(core.readHeaderLabels(table)), LIVE_LABELS);
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
  // A non-array axis is not an axis. Without the `Array.isArray` guard a string
  // indexes like one: `"quantitybilled"[3]` is `"n"`, and Task 16's control bar
  // would label a column with a single letter. Task 16 is the first two-argument
  // caller, so this guard has had no caller to be wrong for until now.
  assert.equal(plain(core.readHeaderLabels(table, "quantitybilled"))[3], "");
  assert.equal(plain(core.readHeaderLabels(table, { 3: "quantitybilled" }))[3], "");
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

// An element built by document.createElement. M3 is the first milestone that
// builds a TREE — a control bar holding a button and a chip strip, and a column
// menu of labels holding checkboxes — so this models what that code actually
// touches: children, append/prepend/remove, textContent, dataset, className,
// type/checked, its own listeners, and a closest() that walks parents rather
// than answering only for itself. A stub that answered null for every
// descendant query could not tell a bar that mounted from one that did not.
function createOwnedNode(tagName) {
  const attributes = new Map();
  const children = [];
  const listeners = [];
  const node = {
    nodeType: 1,
    tagName,
    hidden: false,
    parent: null,
    children,
    listeners,
    className: "",
    textContent: "",
    dataset: {},
    style: {},
    // `type` and `checked` are real properties of the elements this feature
    // builds, and `type = "button"` is the safety-critical one: a bare <button>
    // inside main_form defaults to submit and would save the record.
    type: "",
    checked: false,
    // A real property of the boxes this feature builds, and the affordance half
    // of the required-column rule: a menu that ticked a required column without
    // disabling it would invite a click it then refuses.
    disabled: false,
    get isConnected() {
      return node.parent !== null;
    },
    get firstChild() {
      return children[0] ?? null;
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    hasAttribute: (name) => attributes.has(name),
    removeAttribute: (name) => attributes.delete(name),
    matches: (selector) => ownedMatch(node, selector),
    closest(selector) {
      if (node.matches(selector)) {
        return node;
      }
      return node.parent?.closest?.(selector) ?? null;
    },
    querySelector: (selector) => node.querySelectorAll(selector)[0] ?? null,
    querySelectorAll(selector) {
      const found = [];
      for (const child of children) {
        if (child.matches?.(selector)) {
          found.push(child);
        }
        found.push(...(child.querySelectorAll?.(selector) ?? []));
      }
      return found;
    },
    append(...nodes) {
      for (const child of nodes) {
        child.parent = node;
        children.push(child);
      }
    },
    prepend(...nodes) {
      for (const [index, child] of nodes.entries()) {
        child.parent = node;
        children.splice(index, 0, child);
      }
    },
    removeChild(child) {
      const at = children.indexOf(child);
      if (at >= 0) {
        children.splice(at, 1);
      }
    },
    remove() {
      node.parent?.removeChild(node);
      node.parent = null;
    },
    addEventListener(type, handler, options) {
      listeners.push({ type, handler, options });
    },
    removeEventListener(type, handler, options) {
      const at = listeners.findIndex((entry) =>
        entry.type === type && entry.handler === handler && entry.options === options);
      if (at >= 0) {
        listeners.splice(at, 1);
      }
    },
    // The column menu is positioned off the Columns button's box. A constant is
    // honest here: nothing this feature stores is derived from it.
    getBoundingClientRect: () => ({ width: 70, height: 20, left: 10, right: 80, top: 4, bottom: 24 })
  };
  return node;
}

// Every owned node in a subtree, the node itself included — what
// document.querySelectorAll(OWNED_SELECTOR) reaches at teardown.
function ownedNodesIn(root, selector) {
  const found = root.matches?.(selector) ? [root] : [];
  found.push(...(root.querySelectorAll?.(selector) ?? []));
  return found;
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
    // The control bar is PREPENDED, above the machine — the one node this
    // feature puts before the table rather than after it.
    prepend(node) {
      node.parent = container;
      children.unshift(node);
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
    // Direct children only — this answers "what did the feature MOUNT", which
    // stays two nodes however deep the control bar's own tree grows. The
    // document-scoped sweep below is the one that must reach descendants.
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

// The same machine with enough lines to PAGE. Line N's raw values are built to
// corroborate exactly what createMachine renders for line N — `SKU-100{N}` and
// `{N*2}` — so a segment showing lines 26-33 carries the identical evidence a
// segment showing lines 1-8 does, and the axis must come out the same.
function harnessLine(line) {
  return [`SKU-100${line}`, String(4997 + line), String(4997 + line), String(line * 2), `1${line}.00`, `${line * 22}.00`];
}
const HARNESS_SEGMENT_DATA_VALUE = Array.from({ length: 33 }, (_, index) => harnessLine(index + 1).join(SOH))
  .join(STX);

// A SEGMENT SWAP, modelled the way NetSuite performs it: choosing another segment
// REPLACES the header row and the tbody. Every cell is new, so every class this
// feature put on the old ones is gone with them — that is why the mount has to
// re-apply, and why the bar and chips (which live on the CONTAINER, not in the
// table) survive while the hiding does not. The line numbers the new rows carry
// are the whole point: they are the segment's, not 1..n.
function swapMachineSegment(harness, firstLine, count = 8) {
  const header = createRow({
    className: "uir-machine-headerrow",
    cells: [
      createCell({ text: "Item", required: true }),
      createCell({ text: "Quantity" }),
      createCell({ text: "Rate" }),
      createCell({ text: "", systemHidden: true })
    ]
  });
  const dataRows = Array.from({ length: count }, (_, index) => {
    const line = firstLine + index;
    return createRow({
      id: `item_row_${line}`,
      className: "uir-machine-row",
      cells: [
        createCell({ text: `SKU-100${line}` }),
        createCell({ text: String(line * 2) }),
        createCell({ text: `$1${line}.00` }),
        createCell({ text: "sys", systemHidden: true })
      ]
    });
  });
  const buttonRow = createRow({ className: "machineButtonRow", cells: [createCell({ text: "OK Cancel" })] });
  harness.table.rows.length = 0;
  harness.table.rows.push(header, ...dataRows, buttonRow);
  for (const row of harness.table.rows) {
    for (const cell of row.cells ?? []) {
      cell.owner = harness.table;
    }
  }
  layoutCells(header.cells);
  return header;
}

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
  // <body> is a real node from M3 on: the column menu is absolutely positioned
  // and appended to it, because the machine container scrolls and would clip it.
  // A body that could only carry the drag cursor would make the menu — and every
  // way it can leak past teardown — unobservable.
  const body = createOwnedNode("body");
  body.classList = {
    add: (name) => bodyClasses.add(name),
    remove: (name) => bodyClasses.delete(name),
    contains: (name) => bodyClasses.has(name)
  };
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
      body,
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
      // The teardown sweep is document-scoped in production, and from M3 on it
      // HAS to be: the column menu lives on <body>, outside the container, so a
      // document that only searched the container would report a leaked menu as
      // swept.
      querySelectorAll: (selector) => [
        ...container.children.flatMap((child) => ownedNodesIn(child, selector)),
        ...ownedNodesIn(body, selector)
      ],
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
    // The page the runtime is actually running against. Exposed so a test can
    // take something AWAY from it mid-session — the session-status script the
    // scope key is resolved from is the case that needs it, and a document that
    // could only be read at construction time cannot model a <head> NetSuite
    // rewrites under a settled mount.
    sandbox,
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
    body,
    // Dispatches to what the runtime actually bound, in the order a real DOM
    // would deliver it: the document's capture-phase drag pair first, then the
    // container's delegated listener. Nothing is invoked by name.
    //
    // `on` names the node whose OWN listeners receive the event instead of the
    // delegated pair — the column menu is the only such node, because it lives
    // on <body> where the container's delegation cannot reach it.
    //
    // `outside` says the event did not land inside the container at all, so the
    // container's delegated listeners do not see it and only the document-level
    // ones do. Delegation is containment in a real DOM; this stub cannot derive
    // containment for a machine cell (a cell knows its table, not its parents),
    // so the caller states it. It is what makes the menu's own dismissal
    // testable: on the real page a click on the menu — or on anything else on
    // the page — never reaches the container's handler.
    fire(type, { target, on, outside = false, ...init } = {}) {
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
      const bound = on
        ? on.listeners ?? []
        : [...documentListeners, ...(outside ? [] : container.listeners)];
      for (const entry of bound) {
        if (entry.type === type) {
          entry.handler(event);
        }
      }
      return event;
    },
    pointer(type, init) {
      return harness.fire(type, init);
    },
    // The control bar this mount owns, reached the way a user's click reaches
    // it — by the role stamped on the node at creation, never by construction
    // order or by a name the test made up.
    owned(role) {
      return sandbox.document.querySelectorAll(`[${DATA_ATTRIBUTE}="${role}"]`);
    },
    click(node) {
      return harness.fire("click", { target: node });
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
  assert.equal(mainForm.mounts().length, 2);
  assert.equal(mainForm.container.hasAttribute(BOUND_ATTRIBUTE), true);
  assert.equal(mainForm.counts.writes, 0);
  // A page with no #main_form at all falls back to the bare input name.
  const unscoped = createRuntimeHarness({ inputsAt: "unscoped" });
  await unscoped.flush();
  assert.equal(unscoped.lifecycle.lastResult, true);
  assert.equal(unscoped.mounts().length, 2);
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
  // Two owned nodes under the container from M3 on: the control bar, PREPENDED
  // above the machine, and the hidden marker appended below it.
  assert.deepEqual(
    plain(mounted.map((node) => [node.tagName, node.getAttribute(DATA_ATTRIBUTE)])),
    [["div", "controls"], ["span", "mount"]]
  );
  const [bar, marker] = mounted;
  assert.equal(marker.hidden, true);
  // Every injected button is type="button" — cosmetic in View Mode,
  // safety-critical inside main_form where a bare <button> defaults to submit
  // and would SAVE THE RECORD. Asserted on the node, not on the source.
  const [columnsButton] = harness.owned("columns-button");
  assert.equal(columnsButton.type, "button");
  assert.equal(columnsButton.textContent, "Columns");
  assert.equal(columnsButton.parent, bar);
  assert.equal(harness.container.hasAttribute(BOUND_ATTRIBUTE), true);
  // MAIN-world axis evidence: the pinned axis, comma-joined, on the bound
  // container — the same three ids the derivation above returns, so a probe
  // running in page script reads exactly what this mount keyed its storage to.
  assert.equal(harness.container.getAttribute(AXIS_ATTRIBUTE), "item,quantity,rate");
  assert.equal(harness.counts.editReads, 1);
  // Seeded storage plus install is a read, never a write (spec: count writes).
  assert.equal(harness.counts.writes, 0);
  // A stored entry that carries no WIDTHS applies no width: no inline width
  // reaches any machine cell and the machine keeps its own layout. The 28
  // screenshot baselines depend on this staying true for every user who has
  // never dragged a column edge.
  // The breadth here used to be `classNames()` deepEqual [] on every cell, which
  // M3's hidden seed made false — the hide is applied on install and IS a class.
  // Restated as an allowlist rather than dropped: whatever a machine cell
  // carries after an install must be one of THIS feature's own names. It is the
  // only assertion in the file that watches every cell of every row at once, so
  // a stray class — another feature's, a typo'd one, a NetSuite name we wrote
  // back — is caught here or nowhere.
  const ownClasses = new Set(Object.values(createApi().CLASSES));
  for (const row of harness.table.rows) {
    for (const cell of row.cells) {
      assert.equal(cell.style.width, "");
      for (const name of cell.classNames()) {
        assert.equal(ownClasses.has(name), true, `a class this feature does not own reached a machine cell: ${name}`);
      }
    }
  }
  assert.equal(harness.table.style.tableLayout, "");
  // The stored HIDE, on the other hand, is applied on install — that is M3 —
  // and it is applied BY CLASS, which is the property the whole feature's
  // column identity rests on (spec A3.2). Read through core, so this measures
  // what the axis reader measures rather than a name the test chose.
  const editCore = createApi();
  const aligned = editCore.tableRows(harness.table)
    .filter((row) => editCore.alignsToHeader(row, EDIT_AXIS));
  assert.equal(aligned.length, 3, "the fixture no longer has a header and two data rows");
  for (const row of aligned) {
    assert.deepEqual(hiddenFlags(editCore, row), [false, true, false],
      "the stored hidden set did not reach this row, or reached the wrong column");
  }
  // The button row and the totals row are excluded, so hiding a column never
  // takes a total or the line buttons with it.
  for (const row of editCore.tableRows(harness.table).filter((row) => !aligned.includes(row))) {
    assert.deepEqual(hiddenFlags(editCore, row), [false], "an excluded row was hidden");
  }
  // NOT by inline display, in either direction: the hidden cell must stay on
  // the axis, or the next install keys storage by an axis this feature's own
  // output shortened.
  assert.deepEqual(plain(editCore.readColumnIds(harness.table)), ["item", "quantity", "rate"]);
  // And the chip that lets the user undo it, labelled from the header.
  assert.deepEqual(plain(harness.owned("chip").map((node) => node.textContent)), ["Quantity ✕"]);
  // A repaint re-installs: the marker, the binding and the axis stamp stay
  // singular. The stamp is re-derived through the pin, so it cannot drift.
  await harness.run("mutation");
  assert.equal(harness.mounts().length, 2);
  // One listener per event type, bound once — a second install must not stack a
  // second copy of the delegated set on the container.
  assert.deepEqual(
    harness.container.listeners.map(({ type }) => type),
    ["pointermove", "pointerleave", "pointerdown", "focusin", "click"]
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
  assert.equal(harness.mounts().length, 2);
  const result = harness.lifecycle.registration.cleanup({ id: "record.edit-grid", reason: "paused" });
  assert.equal(result, undefined, "a thenable cleanup is only reported, never awaited");
  assertNotMounted(harness, "after cleanup");
  await harness.run("mutation");
  assert.equal(harness.mounts().length, 2);
  assert.equal(harness.container.hasAttribute(BOUND_ATTRIBUTE), true);
  assert.equal(harness.container.getAttribute(AXIS_ATTRIBUTE), "item,quantity,rate");
});

test("turning the setting off tears down and turning it back on remounts", async () => {
  const harness = createRuntimeHarness();
  await harness.flush();
  assert.equal(harness.mounts().length, 2);
  await harness.changeSettings({ salesOrderColumnsEdit: false });
  assertNotMounted(harness, "setting turned off");
  // A non-sync area cannot revive the feature.
  await harness.changeSettings({ salesOrderColumnsEdit: true }, "local");
  assertNotMounted(harness, "local storage change");
  await harness.changeSettings({ salesOrderColumnsEdit: true });
  assert.equal(harness.mounts().length, 2);
  assert.equal(harness.counts.writes, 0);
});

test("the runtime's own pagehide handler disposes only on a real navigation", async () => {
  const harness = createRuntimeHarness();
  await harness.flush();
  assert.equal(harness.mounts().length, 2);
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
  assert.equal(harness.mounts().length, 2);
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
  // (childList on the container, addedNodes = the control bar, then the marker).
  const ownWrites = harness.mounts().map((node) => ({
    target: harness.container,
    addedNodes: [node],
    removedNodes: []
  }));
  assert.equal(ownWrites.length, 2, "the mount no longer injects both of its own nodes");
  assert.equal(relevant(ownWrites), false, "the mount re-triggered install");
  assert.equal(harness.counts.editReads, 1);
});

test("installs without a session status script and without its identifiers", async () => {
  const withoutScript = createRuntimeHarness({ sessionSrc: null });
  await withoutScript.flush();
  assert.equal(withoutScript.lifecycle.lastResult, true);
  assert.equal(withoutScript.mounts().length, 2);
  const withoutIds = createRuntimeHarness({
    sessionSrc: "/javascript/sessionstatus/session_status_init.jsp?companyId=&id="
  });
  await withoutIds.flush();
  assert.equal(withoutIds.lifecycle.lastResult, true);
  assert.equal(withoutIds.mounts().length, 2);
});

// "an open line is a FOCUSED row carrying a numbered row id" lived here and is
// GONE with isLineOpen itself (OWNER DIRECTIVE 2026-08-04: nothing in this
// runtime asks whether a line is open any more). It sliced a predicate that no
// longer exists, which is a claim about the source and not about the feature —
// the forcedRows ruling, applied again. The DOM shapes it enumerated are not
// lost: both are built as fixtures in "an open line changes NOTHING about what
// is hidden", where they pin the wired behaviour instead of a deleted function.

test("the column axis is derived on a native DOM, pinned, and never re-derived under a permutation", () => {
  // P-MONO (spec A1.2): the correlator only emits increasing subsequences of
  // machine-field order, so re-deriving while WE have permuted the DOM silently
  // mis-keys. The runtime must reuse the pin instead of asking again.
  // BOTH functions are sliced. currentColumnIds calls axisCompatible, which is
  // module-scoped and reaches the sandbox through neither `core` nor a global —
  // slicing only the caller makes assertions 4 and 6 die on "axisCompatible is
  // not defined". (The deleted isLineOpen slice got away with one function
  // because every dependency it had went through core.)
  const [helper] = runtimeSource.match(/ {2}function currentColumnIds\(table\) \{[\s\S]*?\n {2}\}/) ?? [];
  const [comparer] = runtimeSource.match(/ {2}function axisCompatible\(pinned, derived\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(helper), true, "currentColumnIds is no longer a named function in runtime.js");
  assert.equal(Boolean(comparer), true, "axisCompatible is no longer a named function in runtime.js");
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
      ensureControls() {},
      ensureBindings() {},
      renderChips() {},
      stampAxis: (node, ids) => stamped.push(ids),
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
      // False, which is the state that lets the signature pair decide. The
      // install consults it before that pair — a refused applyHidden must not be
      // hidden behind a header-only signature — and this slice is about the axis.
      hideIncomplete: false,
      // The required-column read is stubbed away for the same reason
      // rememberNaturalWidths is elsewhere: this slice is about which axis
      // reaches which call, and the star has its own pins.
      readRequiredColumns: () => new Set(),
      requiredColumns: new Set(),
      warnedNewerSchema: false,
      // A gesture's width, already in module state when this install starts.
      columnWidths: { quantity: 161 },
      // And a gesture's HIDE, in module state for the same reason: M3 is the
      // second field the reseed can drop, and core.withHidden replaces the
      // stored list wholesale exactly as core.withWidths replaces the map, so
      // the D2 shape reaches it unchanged.
      hiddenColumns: new Set(["rate"]),
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
  assert.deepEqual([...latched.sandbox.hiddenColumns], ["rate"],
    "an install that refused on an empty second axis read still reseeded hiddenColumns");
  assert.deepEqual([...short.sandbox.hiddenColumns], ["rate"],
    "an install that refused on a one-column second axis read still reseeded hiddenColumns");

  // Not vacuous: the identical install DOES apply when the second read holds —
  // and THAT one reseeds, because storage is authoritative on every install that
  // gets far enough to use what it read. The stub's storage is empty, so the
  // gesture's 161px is correctly dropped here and only here.
  const applying = await run([["item", "quantity", "rate"], ["item", "quantity", "rate"]]);
  assert.deepEqual(plain(applying.applied), [["item", "quantity", "rate"]]);
  assert.deepEqual(plain(applying.sandbox.columnWidths), {},
    "a usable install must still take storage as authoritative");
  assert.deepEqual([...applying.sandbox.hiddenColumns], [],
    "a usable install must take storage as authoritative for the hidden set too");
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
  // M3 folded BOTH halves of the reseed guard into enqueueSave, so they are
  // part of what "enqueueing a save" means and no longer a rule each new
  // writer has to remember. Sliced from their own declarations, so a runtime
  // that stopped declaring them fails here rather than silently arming nothing.
  const [writes] = runtimeSource.match(/^ {2}let pendingWrites = .*$/m) ?? [];
  const [epoch] = runtimeSource.match(/^ {2}let saveEpoch = .*$/m) ?? [];
  assert.equal(Boolean(writes), true, "pendingWrites is no longer a module-scoped let in runtime.js");
  assert.equal(Boolean(epoch), true, "saveEpoch is no longer a module-scoped let in runtime.js");
  // Built in THIS realm, not a vm context: process-level unhandledRejection
  // tracking and promise identity both have to be the real ones.
  const build = () => new Function(`
    ${declaration}
    ${writes}
    ${epoch}
    ${enqueue}
    return {
      enqueue: enqueueSave,
      peek: () => saveQueue,
      counters: () => ({ pendingWrites, saveEpoch }),
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
  const [comparer] = runtimeSource.match(/ {2}function axisCompatible\(pinned, derived\) \{[\s\S]*?\n {2}\}/) ?? [];
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

// "an untouched select in the open row is not dirty" lived here and is GONE
// with fieldIsDirty itself. The select/checkbox/radio pristine-state knowledge
// it pinned is recorded in the runtime tombstone that replaced the predicates;
// the predicates had ONE consumer, the force-reveal, and the owner deleted it
// (2026-08-04). A slice of a function that no longer ships is a claim about the
// source and not about the feature — the forcedRows ruling, applied again.

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
// NetSuite regenerating the machine. Live, buildtable() replaces the whole
// <tbody> and the header row goes with it, so THREE things are true at once and
// all three matter: the header's inline widths are gone, `table-layout: fixed`
// survives on the <table> (so the browser has redistributed the columns
// equally), and EVERY class this feature applied is gone with the nodes that
// carried it. The third was missing here until the Task 16 review, and its
// absence is what let a measurement taken in this window look guarded.
function repaintHeader(harness, core, width = 120) {
  for (const cell of core.visibleCells(core.headerRow(harness.table))) {
    cell.style.width = "";
    cell.offsetWidth = width;
  }
  for (const row of core.tableRows(harness.table)) {
    for (const cell of Array.from(row.cells ?? [])) {
      cell.classList.remove(HIDDEN_CLASS);
    }
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
  // BOTH GATES ROUTE THROUGH THE SAME HELPER, which is the property this shape
  // assertion has always guarded — an install and a gesture that applied through
  // different code could drift apart, and the drift would show up as a width
  // restored on one path and not the other. It used to be stated over
  // applyWhileLineOpen; that function is deleted (OWNER DIRECTIVE 2026-08-04 left
  // it character-identical to applyAll, and a branch whose arms are the same is
  // unfalsifiable), so the helper the two gates share is now applyAll itself.
  const [helper] = runtimeSource.match(/ {2}function applyAll\(table, columnIds\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(helper), true, "applyAll is no longer a named function in runtime.js");
  assert.match(helper, /applyCurrentWidths\(table, columnIds\);/);
  const [install] = runtimeSource.match(
    / {2}async function installEditGrid\(\{ signal, isCurrent \}\) \{[\s\S]*?\n {2}\}/
  ) ?? [];
  const [queue] = runtimeSource.match(/ {2}function queueApply\(reason\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.match(install, /applyAll\(table, current\);/);
  assert.match(queue, /applyAll\(table, columnIds\);/);
  // And NEITHER gate asks whether a line is open before applying. This is a
  // source assertion because it is a statement about a branch that is ABSENT,
  // and an absent branch has no behaviour to drive: a re-introduced open-line
  // fork could re-implement the reveal without changing any single case this
  // suite drives, one machine state at a time.
  assert.doesNotMatch(install, /isLineOpen/, "the install grew an open-line branch again");
  assert.doesNotMatch(queue, /isLineOpen/, "queueApply grew an open-line branch again");
  assert.doesNotMatch(runtimeSource, /function isLineOpen/,
    "isLineOpen is back, and with it a state this feature must not have an opinion about");
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
    naturalWidths: {},
    // M3 gave the target a `hidden` member. It is stubbed AWAY here rather than
    // driven, because this test is about the width prediction alone; the hidden
    // member has its own pins. (It read effectiveHidden until that collapsed
    // into hideableHidden — see the runtime tombstone.)
    hideableHidden: () => new Set(),
    table: fresh
  };
  sandbox.globalThis = sandbox;
  runInNewContext(
    `${planner}\n${signature}\nglobalThis.result = targetSignature(table, ["item", "quantity", "rate"]);`,
    sandbox
  );
  assert.deepEqual(JSON.parse(sandbox.result).widths, ["50px", "100px", "240px"],
    "the first apply's target left the zero-rendered column unpredicted");
  // MEMBER ORDER. Both signatures are compared as JSON STRINGS, and
  // JSON.stringify emits keys in insertion order, so a member added to one side
  // in a different position makes the two NEVER equal — every install re-applies
  // forever and "one gesture = one write, then flat" stops being true. Pinned
  // as a shape, on both functions, because nothing else in the suite would
  // notice: the two agree on every VALUE while disagreeing on the string.
  const [render] = runtimeSource.match(
    / {2}function renderSignature\(table, columnIds\) \{[\s\S]*?\n {2}\}/
  ) ?? [];
  assert.equal(Boolean(render), true, "renderSignature is no longer a named function in runtime.js");
  const members = (body) => [...body.matchAll(/^ {6}(\w+):/gm)].map(([, name]) => name);
  assert.deepEqual(members(render), ["ids", "layout", "widths", "hidden"]);
  assert.deepEqual(members(signature), members(render), "the two signatures no longer agree on member order");
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
  // Every session-only width record is mount-scoped, naturalWidths included
  // (adjudication #20). Asserted at the SOURCE and disclosed as such: the leak is
  // self-healing behaviourally — every mount re-records before it hides anything,
  // so a stale entry is overwritten before it can be read — which makes it
  // unreachable by test and exactly the kind of module state this file has twice
  // been bitten by leaving behind.
  const [teardown] = runtimeSource.match(/ {2}function removeEditGrid\(\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.match(teardown, /naturalWidths = \{\};/, "removeEditGrid no longer resets naturalWidths");
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
    frozenWidths: {},
    naturalWidths: {},
    // Stubbed away: this test is about the axis core is HANDED, and the natural
    // width record has its own pins.
    rememberNaturalWidths() {}
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

// "typing into the permanent entry row reads as dirty, and so does a row nobody
// focused" lived here and is GONE with isDirty, rowIsDirty and fieldIsDirty.
// The decision it pinned — that the always-focused entry row counts, so a
// half-typed new line was exempt from a hide — is the very thing the owner
// REVERSED on 2026-08-04: a half-typed new line no longer exempts anything,
// and the columns the user hid stay hidden while they type it. That inversion
// is pinned behaviourally in "no edit anywhere brings a hidden column back",
// through the registration and the listeners, where a source slice never could.

// ===== M3: the hide/show gesture and the control bar =====
// Driven through the registration and the delegated listeners the runtime
// actually bound — never by calling a handler by name.
//
// OWNER DIRECTIVE 2026-08-04 governs this whole section: a column the user hides
// stays hidden AT ALL TIMES — editing an existing line, adding a new one,
// selecting an item, changing a value, and across every repaint those cause —
// and changes only when the user changes their column personalization. The
// force-reveal is deleted, so the tests that used to pin it are INVERTED here
// rather than dropped: an open line does not reveal, a dirty row does not
// reveal, and a hide gesture lands whatever the machine is doing.
//
// THIS FEATURE'S CHARACTERISTIC BLIND SPOT, stated here because every test below
// is one of the answers to it. A mutation GUARDED BY "only where our own output
// already is" can be invisible to a suite that catches its unguarded twin — M27
// survived 298 tests while M21, its unguarded form, died on the first snapshot
// (see the reveal test above). Every action in this runtime is scoped to where
// our own output already is: the control bar, the chips, the apply. So anyone
// mutation-proving an edit here must construct the NARROWED form and not stop at
// the obvious one.
//
// THE PATH WHERE A NARROWED MUTATION HIDES is the one where our class is NOT
// rendered — a repaint has just destroyed it and the install's apply has not
// landed yet. That path outlived the force-reveal: it is what the A3.2 seeding
// test now runs on, and it is why the chips test insists on a mount that applies
// nothing. The unit harness could not reach that state until the fixture found
// it, because its repaint used to leave classes alone. Keep those tests, and
// keep them on that path.
function alignedRows(core, table) {
  return core.tableRows(table).filter((row) => core.alignsToHeader(row, EDIT_AXIS));
}

// Every machine cell's INLINE display, which is NetSuite's own hiding mechanism
// and the one property this feature must never write. The system cell in each
// row carries "none" and must keep it; every other cell must stay "" whichever
// direction the gesture went.
function inlineDisplays(core, table) {
  return plain(core.tableRows(table).map((row) => Array.from(row.cells).map((cell) => cell.style.display)));
}

function storedHidden(harness) {
  return plain(harness.storedNow()?.grids?.[SCOPE]?.hidden ?? null);
}

function hiddenHeader(core, harness) {
  return hiddenFlags(core, core.headerRow(harness.table));
}

// NetSuite opening line N: the row keeps its numbered id and gains the focused
// classes. `fields` makes it a row a dirty scan can read.
function focusLine(harness, { line = 1, open = true, fields = null } = {}) {
  const row = harness.table.rows[line];
  const next = createRow({
    id: `item_row_${line}`,
    className: open ? "uir-machine-row uir-machine-row-focused listfocusedrow" : "uir-machine-row",
    cells: row.cells
  });
  if (fields) {
    next.querySelectorAll = () => fields;
  }
  harness.table.rows[line] = next;
  return next;
}

// The permanent entry row: ALWAYS focused (live 2026-08-02) and carrying no
// numbered id, which is what used to separate it from an open line. Nothing in
// the runtime tells the two apart any more — that is the point of the directive —
// so it is built here to prove the machine's most-focused, most-edited row still
// does not move a hidden column.
function entryRow(harness, fields) {
  const row = createRow({
    className: "uir-machine-row uir-machine-row-focused",
    cells: [createCell({ text: "" }), createCell({ text: "" }), createCell({ text: "" })]
  });
  row.querySelectorAll = () => fields;
  for (const cell of row.cells) {
    cell.owner = harness.table;
  }
  harness.table.rows.splice(3, 0, row);
  return row;
}

// The menu, opened the way a user opens it, and the checkbox for one column.
// The Columns button TOGGLES, so a menu already standing is closed first —
// which is the click sequence a real user performs, not a shortcut around it.
function openMenu(harness) {
  const button = harness.owned("columns-button")[0];
  if (harness.owned("menu").length) {
    harness.click(button);
  }
  harness.click(button);
  const [menu] = harness.owned("menu");
  return {
    menu,
    box: (columnId) => harness.owned("column-toggle").find((node) => node.dataset.columnId === columnId)
  };
}

async function toggleColumn(harness, columnId, checked) {
  const { menu, box } = openMenu(harness);
  const target = box(columnId);
  target.checked = checked;
  harness.fire("change", { on: menu, target });
  await harness.tick();
  return target;
}

test("hiding a column through the menu writes once, hides BY CLASS, and never moves the axis", async () => {
  const core = createApi();
  const harness = createRuntimeHarness();
  await harness.flush();
  assert.equal(harness.counts.writes, 0);
  const displaysBefore = inlineDisplays(core, harness.table);

  const { menu, box } = openMenu(harness);
  // On <body>, not in the container: the machine container scrolls and would
  // clip an absolutely positioned menu.
  assert.equal(menu.parent, harness.body);
  assert.deepEqual(plain(harness.owned("column-toggle").map((node) => node.dataset.columnId)), EDIT_AXIS);
  // Labelled from the HEADER, with the axis only as a fallback for a blank one.
  assert.deepEqual(plain(menu.children.map((row) => row.children[1].textContent)), ["Item", "Quantity", "Rate"]);
  assert.deepEqual(plain(harness.owned("column-toggle").map((node) => node.checked)), [true, true, true]);

  const target = box("quantity");
  target.checked = false;
  harness.fire("change", { on: menu, target });
  await harness.tick();

  assert.equal(harness.counts.writes, 1, "one gesture is not exactly one write");
  assert.deepEqual(storedHidden(harness), ["quantity"]);
  for (const row of alignedRows(core, harness.table)) {
    assert.deepEqual(hiddenFlags(core, row), [false, true, false], "the wrong column hid, or a row was missed");
  }
  // CLASS ONLY, and this is the assertion the whole feature's column identity
  // rests on. An inline `display` written alongside the class drops the cell out
  // of visibleCells, the axis SHORTENS, and the axis is what keys storage — the
  // runtime must not route around the pin core already carries.
  assert.deepEqual(inlineDisplays(core, harness.table), displaysBefore, "an inline display reached a machine cell");
  assert.deepEqual(plain(core.readColumnIds(harness.table)), EDIT_AXIS, "hiding moved the column axis");
  // The chip that names it, and the undo path for it.
  assert.deepEqual(plain(harness.owned("chip").map((node) => node.textContent)), ["Quantity ✕"]);
  assert.equal(harness.owned("chip")[0].type, "button");

  // Flat afterwards: a repaint re-applies the same state and writes nothing.
  await harness.run("repaint");
  assert.equal(harness.counts.writes, 1, "a repaint wrote storage");
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);
});

test("ADJUDICATION #20: a width is never planned from a column we are hiding", async () => {
  // THE DEFECT, measured on the fixture before it was ruled: Quantity's natural
  // width 74px -> hide it -> its header cell renders 0 -> the session's FIRST
  // width gesture, on ANOTHER column, runs the freeze -> core.applyWidths'
  // rendered-width fallback sees 0 and writes the static floor -> Quantity is
  // 50px for the rest of the session, and a later drag on it seeds from that
  // floor and stores a width the user never chose. Same transitive laundering as
  // defect D1, different collapse: our own `display: none !important` is what
  // zeroes the box.
  const core = createApi();
  const harness = createRuntimeHarness();
  await harness.flush();
  const natural = plain(headerOf(harness, core).map((cell) => Math.round(cell.getBoundingClientRect().width)));
  assert.deepEqual(natural, [100, 100, 100], "the fixture is not modelling a natural layout");

  await toggleColumn(harness, "quantity", false);
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);
  // The hidden column now measures nothing. That zero is OUR OUTPUT, and this is
  // the precondition the rest of the test depends on.
  assert.equal(Math.round(headerOf(harness, core)[1].getBoundingClientRect().width), 0,
    "the harness is not modelling a hidden cell as zero-width");

  // The session's first width gesture, on a DIFFERENT column. This is the apply
  // that freezes the machine.
  const cells = headerOf(harness, core);
  const box = cells[2].getBoundingClientRect();
  harness.pointer("pointerdown", { target: cells[2], clientX: box.right - 1, clientY: box.top + 4 });
  harness.pointer("pointermove", { clientX: box.right - 1 + 40, clientY: box.top + 4 });
  harness.pointer("pointerup", { clientX: box.right - 1 + 40, clientY: box.top + 4 });
  await harness.tick();
  assert.equal(harness.table.style.tableLayout, "fixed", "the gesture did not freeze the machine");

  // (b) The hidden column never reaches storage as a consequence of another
  // column's gesture.
  assert.deepEqual(plain(harness.writes.at(-1)[EDIT_STORAGE_KEY].grids[SCOPE].widths), { rate: 140 },
    "a column nobody dragged reached storage");

  // (a) Revealed, it renders at its NATURAL width — never the floor.
  harness.click(harness.owned("chip")[0]);
  await harness.tick();
  assert.deepEqual(hiddenHeader(core, harness), [false, false, false]);
  assert.equal(headerOf(harness, core)[1].style.width, "100px",
    "the revealed column came back at the clamp floor, not its own width");
  assert.equal(headerOf(harness, core)[0].style.width, "100px", "an untouched column moved");
  assert.equal(headerOf(harness, core)[2].style.width, "140px", "the dragged column lost its width");

  // And a drag on the revealed column now starts from its own width, so what it
  // stores is what the user chose — the storage half of the same defect.
  const revealed = headerOf(harness, core)[1];
  const rect = revealed.getBoundingClientRect();
  harness.pointer("pointerdown", { target: revealed, clientX: rect.right - 1, clientY: rect.top + 4 });
  harness.pointer("pointermove", { clientX: rect.right - 1 + 10, clientY: rect.top + 4 });
  harness.pointer("pointerup", { clientX: rect.right - 1 + 10, clientY: rect.top + 4 });
  await harness.tick();
  assert.deepEqual(plain(harness.writes.at(-1)[EDIT_STORAGE_KEY].grids[SCOPE].widths), { rate: 140, quantity: 110 },
    "a drag on a revealed column seeded from the floor instead of its own width");
});

test("ADJUDICATION #20 SURVIVES A REPAINT — no width is ever measured once the machine left its own layout", async () => {
  // CRITICAL from the Task 16 review, and D1's laundering shape reaching storage
  // for the THIRD time. #20's first form held with no repaint (74 -> 74) and
  // failed after one (74 -> 62), because rememberNaturalWidths ran inside the
  // exact post-repaint window frozenWidths' own comment documents as poisoned:
  // the header's inline widths are gone, `table-layout: fixed` survives on the
  // <table> so the browser has redistributed the columns equally, and OUR CLASS
  // IS GONE with the nodes that carried it — so the class guard never fires and
  // the redistribution width overwrites the natural one. For a visible column
  // frozenWidths masks it; for a hidden one #20's own freeze exclusion emptied
  // frozenWidths, so nothing masks it and the plan hands core the redistribution.
  //
  // 313/313 passed with the defect live. The suite could not see it, which is
  // why this test drives the sequence rather than the state.
  const core = createApi();
  const harness = createRuntimeHarness();
  await harness.flush();
  const natural = plain(headerOf(harness, core).map((cell) => Math.round(cell.getBoundingClientRect().width)));
  assert.deepEqual(natural, [100, 100, 100]);

  await toggleColumn(harness, "quantity", false);
  const cells = headerOf(harness, core);
  const box = cells[2].getBoundingClientRect();
  harness.pointer("pointerdown", { target: cells[2], clientX: box.right - 1, clientY: box.top + 4 });
  harness.pointer("pointermove", { clientX: box.right - 1 + 40, clientY: box.top + 4 });
  harness.pointer("pointerup", { clientX: box.right - 1 + 40, clientY: box.top + 4 });
  await harness.tick();
  assert.equal(harness.table.style.tableLayout, "fixed");

  // THE REPAINT. 62px is a redistribution — not what any column chose, and not
  // what any column was. It is the number the poisoned read would capture.
  repaintHeader(harness, core, 62);
  assert.equal(harness.table.style.tableLayout, "fixed", "the fixed layout must survive the tbody swap");
  await harness.run("repaint");

  // The hidden column comes back at what it MEASURED when the machine still had
  // its own layout, never at the redistribution.
  harness.click(harness.owned("chip")[0]);
  await harness.tick();
  assert.deepEqual(hiddenHeader(core, harness), [false, false, false]);
  assert.equal(headerOf(harness, core)[1].style.width, "100px",
    "the revealed column came back at a width measured after the machine left its own layout");

  // And the storage half: a drag on it stores what the user chose, from its own
  // width — ground truth 100 + 10.
  const revealed = headerOf(harness, core)[1];
  const rect = revealed.getBoundingClientRect();
  harness.pointer("pointerdown", { target: revealed, clientX: rect.right - 1, clientY: rect.top + 4 });
  harness.pointer("pointermove", { clientX: rect.right - 1 + 10, clientY: rect.top + 4 });
  harness.pointer("pointerup", { clientX: rect.right - 1 + 10, clientY: rect.top + 4 });
  await harness.tick();
  assert.deepEqual(plain(harness.writes.at(-1)[EDIT_STORAGE_KEY].grids[SCOPE].widths), { rate: 140, quantity: 110 },
    "a drag on the revealed column seeded from a post-repaint measurement");
});

test("ADJUDICATION #20 SURVIVES A TEARDOWN — a dead mount's `fixed` never starves the next one", async () => {
  // CRITICAL from the re-review, and D1's laundering shape reaching storage for
  // the FOURTH time — this time through the guard that closed the third. That
  // guard read `table-layout: fixed` and took it to mean "we set this", but the
  // layout sits on the <table>, which outlives the <tbody> and can outlive a
  // whole mount. A teardown that lands MID-BUILDTABLE is where the two come
  // apart: the header row has already gone with the <tbody>, so the null-plan
  // clear refuses at core's header gate (core.js:871-873) and never reaches the
  // restore that clears the layout (core.js:886-888) — while the state clears,
  // which run outside that try, empty the maps regardless.
  //
  // The next install then meets `fixed` with an EMPTY naturalWidths: it refuses
  // to measure forever, `freezing` is permanently false, and the plan degrades
  // to the user's widths alone — the PARTIAL plan core.js:949-966 says it must
  // never be handed twice. A hidden column renders 0, takes core's 50px floor,
  // and a reveal-then-drag stores 60 where the truth is 72.
  //
  // Driven through the REAL teardown and a real remount rather than through the
  // state, because the state clears were never the defect: they ran correctly
  // the whole time, and that is precisely what left the machine laid out by a
  // feature no longer installed.
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { widths: { rate: 140 }, hidden: ["quantity"] } } }
  });
  await harness.flush();
  assert.equal(harness.table.style.tableLayout, "fixed", "the stored width did not freeze the machine");
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);

  // THE WINDOW ITSELF: buildtable() has taken the header row and the teardown
  // fires against what is left, so every apply the teardown makes is refused.
  const [header] = harness.table.rows.splice(0, 1);
  assert.equal(core.headerRow(harness.table), null, "the fixture is not modelling a detached header");
  harness.lifecycle.registration.cleanup({ id: "record.edit-grid", reason: "paused" });
  // The layout comes off BY NAME, not as a side effect of an apply that cannot
  // run here. A mount that cannot undo its own layout must not leave one behind.
  assert.equal(harness.table.style.tableLayout, "",
    "a torn-down mount left the machine in ITS layout, with no mount left to undo it");

  // The repaint completes: the header is back, carrying no inline widths and
  // none of our classes, and every column renders the 62px an unstyled machine
  // gives here — the fresh mount's ground truth.
  harness.table.rows.unshift(header);
  repaintHeader(harness, core, 62);
  await harness.run("repaint");
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false], "the stored hide did not survive the remount");

  // The new mount MEASURED, and it is the UNCONDITIONAL CLEAR above that bought
  // it — not the ownership half of the guard, which this sequence never reaches:
  // teardown handed the machine back its own layout, so `fixed` is simply false
  // here and the measurement runs on the plain reading. The ownership half is
  // what saves a mount that meets a `fixed` NOBODY cleared, and it is pinned by
  // its own test below. Naming the wrong half here would leave the guard's
  // predicate looking covered when only one of its two terms is.
  harness.click(harness.owned("chip")[0]);
  await harness.tick();
  assert.deepEqual(hiddenHeader(core, harness), [false, false, false]);
  assert.equal(headerOf(harness, core)[1].style.width, "62px",
    "the revealed column came back at the clamp floor: the fresh mount never measured at all");

  const revealed = headerOf(harness, core)[1];
  const rect = revealed.getBoundingClientRect();
  harness.pointer("pointerdown", { target: revealed, clientX: rect.right - 1, clientY: rect.top + 4 });
  harness.pointer("pointermove", { clientX: rect.right - 1 + 10, clientY: rect.top + 4 });
  harness.pointer("pointerup", { clientX: rect.right - 1 + 10, clientY: rect.top + 4 });
  await harness.tick();
  // 72, not 60: the truth is the 62 the column rendered plus the 10 the user
  // dragged. 60 is the 50px floor plus the same 10, and it is what a mount
  // starved into a partial plan stores.
  assert.deepEqual(plain(harness.writes.at(-1)[EDIT_STORAGE_KEY].grids[SCOPE].widths), { rate: 140, quantity: 72 },
    "a drag on the revealed column seeded from the floor a partial plan left behind");
});

test("ADJUDICATION #20 SURVIVES A LEFTOVER LAYOUT — a `fixed` this mount did not set never blocks the measurement", async () => {
  // THE OWNERSHIP HALF OF rememberNaturalWidths' GUARD, and the only test that
  // reaches it. The two tests above pin the `fixed` half and the teardown clear;
  // both still pass with `ownsLayout &&` deleted, because in both sequences the
  // layout on the table is one THIS mount set. This one is the other case, and
  // it needs no teardown at all: the machine is ALREADY laid out when the mount
  // arrives — a dead mount's leftover, a mid-buildtable teardown that could not
  // reach its own restore, anything at all that is not us.
  //
  // Read `fixed` alone there and the mount is starved for its whole life:
  // naturalWidths never gets a single measurement, `freezing` can never be true
  // (the table is already fixed), and the plan degrades to the stored widths
  // alone — the partial plan core.js:949-966 forbids handing over twice. The
  // trail with the guard read that way, measured: ["62px","62px","140px"] after
  // the repaint, the revealed column at 50px, and 60 stored where the user's own
  // column measured 100.
  //
  // The stored WIDTH is what keeps the leftover alive and is not decoration: it
  // makes the mount's first plan non-null, so core never takes the restore route
  // that would have cleared the layout for us.
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { widths: { rate: 140 } } } }
  });
  // Before the first apply of this mount, and by something that is not it.
  harness.table.style.tableLayout = "fixed";
  await harness.flush();
  // The stored width lands and the other two keep what they render. This is the
  // setup, NOT the finding: a mount that refused to measure writes these same
  // three strings, because core's rendered-width fallback and the measurement
  // agree while the machine still renders 100. The refusal only becomes visible
  // once the repaint below moves what "rendered" means.
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "100px", "140px"],
    "the stored width did not reach the machine");

  await toggleColumn(harness, "quantity", false);
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);

  // The repaint the leftover was hiding behind: inline widths gone, our classes
  // gone with the nodes that carried them, every column redistributed to 62px.
  repaintHeader(harness, core, 62);
  assert.equal(harness.table.style.tableLayout, "fixed", "the fixed layout must survive the tbody swap");
  await harness.run("repaint");
  // 100, not 62. Now the guard IS right to refuse — this mount owns the layout —
  // and what it re-applies is the measurement it took while it did not.
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "100px", "140px"],
    "the plan came back from the redistribution instead of the mount's own measurement");

  harness.click(harness.owned("chip")[0]);
  await harness.tick();
  assert.deepEqual(hiddenHeader(core, harness), [false, false, false]);
  assert.equal(headerOf(harness, core)[1].style.width, "100px",
    "the revealed column came back at the clamp floor a partial plan leaves behind");

  const revealed = headerOf(harness, core)[1];
  const rect = revealed.getBoundingClientRect();
  harness.pointer("pointerdown", { target: revealed, clientX: rect.right - 1, clientY: rect.top + 4 });
  harness.pointer("pointermove", { clientX: rect.right - 1 + 10, clientY: rect.top + 4 });
  harness.pointer("pointerup", { clientX: rect.right - 1 + 10, clientY: rect.top + 4 });
  await harness.tick();
  // 110 — the column's own 100 plus the 10 the user dragged. 60 is the 50px
  // floor plus the same 10, and it is what a starved mount stores.
  assert.deepEqual(plain(harness.writes.at(-1)[EDIT_STORAGE_KEY].grids[SCOPE].widths), { rate: 140, quantity: 110 },
    "a drag on the revealed column seeded from the floor a starved mount left behind");
});

test("the Columns menu fails closed on a machine whose axis cannot be read", async () => {
  // The same usability gate the install fails closed on, at the one control that
  // can be clicked after the machine has moved underneath us. A menu built
  // against an unreadable axis lists columns by an index that is not what is
  // rendered, and every tick in it would key a stored hide to the wrong column.
  const harness = createRuntimeHarness();
  await harness.flush();
  assert.equal(harness.owned("columns-button").length, 1);

  // A repaint caught mid-flight: the header is gone, so the axis reads empty and
  // currentColumnIds declines WITHOUT discarding the pin.
  harness.table.rows.splice(0, 1);
  harness.click(harness.owned("columns-button")[0]);
  assert.deepEqual(plain(harness.owned("menu")), [], "a menu was built against an unreadable axis");
  assert.deepEqual(plain(harness.owned("column-toggle")), []);
  assert.equal(harness.counts.writes, 0);
});

// ===== An axis with a HOLE, end to end through the runtime =====
// The harness machine, keyed by a payload whose optimum is reached two ways at
// the last position only: `ratecard` and `rateschedule` are indistinguishable to
// every piece of evidence the correlator has (see the core unanimity test), so
// the axis is ["item", "quantity", null] and the Rate column has NO IDENTITY.
// The whole of the storage-safety claim is what the runtime does with that null.
const HOLED_FIELDS_VALUE = ["item_display", "item", "quantity", "ratecard", "rateschedule"].join(SOH);
const HOLED_DATA_VALUE = [
  ["SKU-1001", "4998", "2", "", ""],
  ["SKU-1002", "1405", "4", "", ""]
].map((values) => values.join(SOH)).join(STX);

function createHoledHarness(options = {}) {
  return createRuntimeHarness({
    machineFields: HOLED_FIELDS_VALUE,
    machineData: HOLED_DATA_VALUE,
    ...options
  });
}

test("the standard harness machine resolves every column — no hole, unchanged ids", async () => {
  // THE BYTE-IDENTITY CLAIM at the runtime boundary. Per-column unanimity must
  // change NOTHING about a machine whose optimum is unique, and the axis stamp is
  // where that is observable from outside: a hole joins as an empty segment, so
  // "item,quantity,rate" is proof there is none.
  const core = createApi();
  const harness = createRuntimeHarness();
  await harness.flush();
  assert.equal(harness.container.getAttribute(AXIS_ATTRIBUTE), "item,quantity,rate");
  const axis = plain(core.readColumnIds(harness.table));
  assert.deepEqual(axis, EDIT_AXIS);
  assert.equal(axis.some((id) => id === null), false, "the single-optimum machine grew a hole");
  // …and the holed machine is the same assertion from the other side, so neither
  // half can pass by measuring nothing.
  const holed = createHoledHarness();
  await holed.flush();
  assert.equal(holed.container.getAttribute(AXIS_ATTRIBUTE), "item,quantity,");
  assert.deepEqual(plain(core.readColumnIds(holed.table)), ["item", "quantity", null]);
});

test("an unresolved column is listed, checked, disabled and unkeyable", async () => {
  const harness = createHoledHarness();
  await harness.flush();
  assert.equal(harness.mounts().length > 0, true, "the holed machine did not mount");

  const { menu } = openMenu(harness);
  const boxes = harness.owned("column-toggle");
  const rows = menu.children;
  assert.equal(rows.length, 3, "the unresolved column was dropped from the menu");
  // Labelled from the HEADER, exactly like every other row — the user can see
  // the column, so a menu that omitted it would not describe the machine.
  assert.deepEqual(plain(rows.map((row) => row.children[1].textContent)), ["Item", "Quantity", "Rate"]);

  // The REQUIRED column (NetSuite's star, on Item here): ticked and disabled, and
  // its own title. Unchanged by this work, asserted beside the new row so the two
  // affordances cannot silently converge.
  assert.equal(boxes[0].dataset.columnId, "item");
  assert.deepEqual([boxes[0].checked, boxes[0].disabled], [true, true]);
  assert.equal(rows[0].title, "Required column — cannot be hidden");
  // The ORDINARY column: enabled, keyed, and seeded from the stored model.
  assert.equal(boxes[1].dataset.columnId, "quantity");
  assert.deepEqual([boxes[1].checked, boxes[1].disabled], [true, false]);
  assert.equal(rows[1].title, undefined);
  // The UNRESOLVED column: ticked because it is visible and always will be,
  // disabled because there is nothing to key a hide by, and carrying NO
  // dataset.columnId at all — which is what makes a synthetic change event on it
  // a no-op even with the disabled attribute stripped by hand.
  assert.deepEqual([boxes[2].checked, boxes[2].disabled], [true, true]);
  assert.equal(boxes[2].dataset.columnId, undefined);
  assert.equal(rows[2].title, "Column identity could not be established on this form");
  // NO CHIP, ever: chips are rendered from the STORED ids and an unresolved
  // column can never be one of them.
  assert.deepEqual(plain(harness.owned("chip")), []);
  assert.equal(harness.counts.writes, 0);
});

test("STORAGE SAFETY: nothing about an unresolved column can reach storage", async () => {
  const core = createApi();
  const harness = createHoledHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { hidden: ["quantity"], widths: { quantity: 160 } } } }
  });
  await harness.flush();

  // (iii) FIRST, because it is what makes the two refusals below non-vacuous: the
  // stored layout for the columns that DID resolve applies in full on the very
  // same machine. That is the per-column point — one ambiguous column costs that
  // column and nothing else.
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);
  assert.equal(harness.table.style.tableLayout, "fixed");
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "160px", "100px"]);
  assert.equal(harness.counts.writes, 0, "an install wrote storage");

  // (i) A synthetic change event aimed at the unresolved row — the shape a user
  // reaches by stripping `disabled` in devtools, and the shape a future refactor
  // reaches by forgetting it. It writes NOTHING and hides nothing.
  const { menu } = openMenu(harness);
  const unresolved = harness.owned("column-toggle")[2];
  unresolved.disabled = false;
  unresolved.checked = false;
  harness.fire("change", { on: menu, target: unresolved });
  await harness.tick();
  assert.equal(harness.counts.writes, 0, "an unresolved column reached storage through the menu");
  assert.deepEqual(storedHidden(harness), ["quantity"], "the stored hidden set was rewritten");
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false], "an unresolved column was hidden");

  // (ii) A resize gesture on the unresolved column's own edge. The drag never
  // STARTS: no cursor class, no document-level drag pair, no plan, no write. Were
  // it to start, columnWidths would be keyed by `null` — the property name "null",
  // which core.normalizeWidths accepts as an ordinary column id and persists, so
  // every unresolved column on every form would share one stored width.
  const cells = headerOf(harness, core);
  const holed = cells[2].getBoundingClientRect();
  const listenersBefore = harness.documentListeners.length;
  harness.pointer("pointerdown", { target: cells[2], clientX: holed.right - 1, clientY: holed.top + 4 });
  harness.pointer("pointermove", { clientX: holed.right - 1 + 40, clientY: holed.top + 4 });
  harness.pointer("pointerup", { clientX: holed.right - 1 + 40, clientY: holed.top + 4 });
  await harness.tick();
  assert.equal(harness.bodyClasses().includes(core.CLASSES.resizing), false, "a drag began on an unkeyable column");
  assert.equal(harness.documentListeners.length, listenersBefore, "the drag pair was bound for an unkeyable column");
  assert.equal(harness.counts.writes, 0, "a drag on an unresolved column wrote storage");
  assert.deepEqual(plain(storedWidths(harness)), { quantity: 160 }, "the stored width map gained a key");
  assert.deepEqual(plain(headerOf(harness, core).map((cell) => cell.style.width)), ["100px", "160px", "100px"]);

  // Non-vacuous: the identical gesture on a column that HAS an id — same harness,
  // same machine, same handler — does everything the refused one did not. (Item,
  // because Quantity is hidden here and a hidden cell measures zero, so its right
  // edge is Item's; a starred column is un-HIDEABLE, never un-resizable.)
  const keyed = cells[0].getBoundingClientRect();
  harness.pointer("pointerdown", { target: cells[0], clientX: keyed.right - 1, clientY: keyed.top + 4 });
  harness.pointer("pointermove", { clientX: keyed.right - 1 + 40, clientY: keyed.top + 4 });
  harness.pointer("pointerup", { clientX: keyed.right - 1 + 40, clientY: keyed.top + 4 });
  await harness.tick();
  assert.equal(harness.counts.writes, 1, "the keyed gesture did not write");
  assert.deepEqual(Object.keys(plain(storedWidths(harness))), ["quantity", "item"]);
  // And STILL no key for the hole, after a write that rewrote the whole map.
  assert.equal(Object.keys(plain(storedWidths(harness))).includes("null"), false);
});

test("paging to another segment re-hides the user's columns on the rows it swapped in", async () => {
  // THE OWNER'S REPORT, end to end. Record 16365465, form B, 202 lines: segment 1
  // mounts and 26 hidden headers apply; choosing "26 - 50 of 202" replaces the
  // header and tbody, headerHiddenCount drops to 0, and every hidden column comes
  // back — while the control bar and its chips, which live on the container,
  // survive and go on claiming the hide. Add-line lands on the last segment and
  // does the same thing, which is how the owner first hit it.
  const core = createApi();
  const harness = createRuntimeHarness({
    machineData: HARNESS_SEGMENT_DATA_VALUE,
    machine: { lines: 8 },
    stored: { schemaVersion: 1, grids: { [SCOPE]: { hidden: ["quantity"] } } }
  });
  await harness.flush();
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false], "segment one did not apply the stored hide");
  assert.deepEqual(plain(harness.owned("chip").map((node) => node.textContent)), ["Quantity ✕"]);
  const writesBefore = harness.counts.writes;

  // Segment two. Nothing about the machine's identity has changed — same form,
  // same field list, same header labels — but every rendered line number is now
  // past the eight lines the old parse kept.
  swapMachineSegment(harness, 26);
  assert.deepEqual(hiddenHeader(core, harness), [false, false, false], "the swap did not model a fresh header");
  assert.deepEqual(
    plain(harness.table.rows.slice(1, 9).map((row) => row.id)),
    ["item_row_26", "item_row_27", "item_row_28", "item_row_29", "item_row_30", "item_row_31", "item_row_32", "item_row_33"]
  );

  await harness.run("segment-swap");

  // The hide is back, on the rows the segment swapped IN — asserted at the row
  // level and not only on the header, because the header agreeing while the rows
  // do not is precisely the half-applied state hideIncomplete exists for.
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false], "the segment swap lost the hide");
  for (const row of alignedRows(core, harness.table)) {
    assert.deepEqual(hiddenFlags(core, row), [false, true, false], "a swapped-in row was missed");
  }
  // The axis is the SAME axis, so nothing was relabelled and the pin never moved.
  assert.equal(harness.container.getAttribute(AXIS_ATTRIBUTE), "item,quantity,rate");
  assert.deepEqual(plain(core.readColumnIds(harness.table)), EDIT_AXIS);
  // Re-applying a stored preference is not a gesture: paging writes nothing.
  assert.equal(harness.counts.writes, writesBefore, "paging a sublist wrote storage");
  assert.deepEqual(plain(harness.owned("chip").map((node) => node.textContent)), ["Quantity ✕"]);
  // And the LAST segment — two rows at lines 32-33, which is the add-line shape.
  swapMachineSegment(harness, 32, 2);
  await harness.run("add-line-segment");
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false], "the last segment lost the hide");
  assert.equal(harness.counts.writes, writesBefore);
});

test("a segment that corroborates less HOLES a column without latching the mount", () => {
  // A hole is a property of the EVIDENCE, not of the machine: which columns the
  // optima agree about depends on which lines are rendered, and paging changes
  // exactly that. Under the old strict-equality compare a less-resolved
  // derivation read as "the machine's layout changed", latched axisMismatch, and
  // killed the mount for the session — the feature switching itself off because
  // the user paged the sublist. Sliced from runtime.js, not re-typed.
  const [helper] = runtimeSource.match(/ {2}function currentColumnIds\(table\) \{[\s\S]*?\n {2}\}/) ?? [];
  const [comparer] = runtimeSource.match(/ {2}function axisCompatible\(pinned, derived\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(comparer), true, "axisCompatible is no longer a named function in runtime.js");
  const core = createApi();
  const build = (derived, state) => {
    const sandbox = {
      core: { ...core, readColumnIds: () => derived },
      document: { querySelector: () => null },
      pinnedColumnIds: null,
      appliedOrder: null,
      axisMismatch: false,
      ...state
    };
    sandbox.globalThis = sandbox;
    return sandbox;
  };
  const call = (sandbox) => {
    runInNewContext(`${comparer}\n${helper}\nglobalThis.result = currentColumnIds(null);`, sandbox);
    return sandbox.result;
  };

  // 1. A DERIVED HOLE defers to the pin: no latch, and the PIN comes back — not
  //    the derivation, which would silently un-key a column mid-session.
  const holed = build(["item", null, "rate"], { pinnedColumnIds: ["item", "quantity", "rate"] });
  assert.deepEqual(plain(call(holed)), ["item", "quantity", "rate"]);
  assert.equal(holed.axisMismatch, false, "a less-resolved segment latched the mismatch");
  assert.deepEqual(plain(holed.pinnedColumnIds), ["item", "quantity", "rate"], "the pin was downgraded");

  // 2. A PIN HOLE meeting a derived id does NOT upgrade. Adopting it would
  //    relabel a column mid-mount: its menu row would go from disabled to
  //    hideable, and a hide made against the new id would key storage under a
  //    name the rest of the session never used.
  const upgraded = build(["item", "quantity", "rate"], { pinnedColumnIds: ["item", null, "rate"] });
  assert.deepEqual(plain(call(upgraded)), ["item", null, "rate"]);
  assert.equal(upgraded.axisMismatch, false);
  assert.deepEqual(plain(upgraded.pinnedColumnIds), ["item", null, "rate"], "the pin was upgraded mid-mount");

  // 3. Holes on BOTH sides at the same position is still compatible.
  const both = build(["item", null, "rate"], { pinnedColumnIds: ["item", null, "rate"] });
  assert.deepEqual(plain(call(both)), ["item", null, "rate"]);
  assert.equal(both.axisMismatch, false);

  // 4. A REAL CONFLICT still latches, exactly as before: both sides name a
  //    column at the same position and name different ones.
  const conflict = build(["item", "custcol_rrp", "rate"], { pinnedColumnIds: ["item", "quantity", "rate"] });
  assert.deepEqual(plain(call(conflict)), []);
  assert.equal(conflict.axisMismatch, true, "a genuine axis change stopped latching");
  assert.equal(conflict.pinnedColumnIds, null);

  // 5. …and so does a different WIDTH, which no amount of hole tolerance excuses.
  const narrower = build(["item", "quantity"], { pinnedColumnIds: ["item", "quantity", "rate"] });
  assert.deepEqual(plain(call(narrower)), []);
  assert.equal(narrower.axisMismatch, true);

  // 6. A WIDER derivation latches too — and only the LENGTH clause can say so.
  //    The positional walk runs over the PIN's indexes, so every one agrees and
  //    the column the machine grew is never examined: compatible by omission.
  //    (The narrower case above cannot pin the clause — a shorter derivation
  //    reads undefined at the pin's last index, which the null checks already
  //    refuse.) The pin carries a hole so a resolved-count compare cannot stand
  //    in for the clause either.
  const wider = build(["item", null, "rate", "amount"], { pinnedColumnIds: ["item", null, "rate"] });
  assert.deepEqual(plain(call(wider)), []);
  assert.equal(wider.axisMismatch, true, "a machine that grew a column read as compatible");
  assert.equal(wider.pinnedColumnIds, null);
});

test("a chip reveals its column, and neither direction writes an inline display", async () => {
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { hidden: ["quantity"] } } }
  });
  await harness.flush();
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);
  const displaysWhileHidden = inlineDisplays(core, harness.table);

  // With the menu standing: its ticks were built from the hidden set as it was
  // when it opened, and this click is about to change that set. A menu left up
  // would show Quantity unticked while the chip for it has just vanished.
  openMenu(harness);
  harness.click(harness.owned("chip")[0]);
  await harness.tick();
  assert.deepEqual(plain(harness.owned("menu")), [], "a stale menu survived the gesture that invalidated it");

  assert.deepEqual(hiddenHeader(core, harness), [false, false, false]);
  assert.equal(harness.counts.writes, 1);
  // The entry is DELETED, not left as an empty list: an empty hidden set has
  // nothing to say and core's writers drop it.
  assert.equal(storedHidden(harness), null);
  assert.deepEqual(plain(harness.owned("chip")), []);
  // The INVERSE of the laundering defect, which is the half a hide-only pin
  // misses: a reveal that also cleared NetSuite's own inline `none` would
  // LENGTHEN the axis, and that axis keys storage on the next install.
  assert.deepEqual(inlineDisplays(core, harness.table), displaysWhileHidden,
    "the reveal touched an inline display");
  assert.deepEqual(plain(core.readColumnIds(harness.table)), EDIT_AXIS, "revealing moved the column axis");
  // Ticking a box that is already ticked is not a gesture and is not a write.
  await toggleColumn(harness, "quantity", true);
  assert.equal(harness.counts.writes, 1, "a no-op toggle wrote storage");
});

test("the CLASS is the only channel, and a cell NetSuite hides after our apply is never resurrected", async () => {
  // Task 15's parting refinement, applied to the runtime: a mutation guarded by
  // "only where our own output already is" can be invisible to a suite that
  // catches its unguarded twin. Both narrowed forms are reached here, and
  // neither is reachable from any assertion about what the column LOOKS like.
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { hidden: ["quantity"] } } }
  });
  await harness.flush();
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);

  // (1) The `hidden` PROPERTY is an unwatched channel. renderSignature reads the
  // class, so a column hidden this way never enters the convergence check, and
  // teardown's class strip cannot restore it — an invisible column with nothing
  // left able to show it.
  for (const row of core.tableRows(harness.table)) {
    for (const cell of row.cells) {
      assert.notEqual(cell.hidden, true, "a machine cell was hidden through the `hidden` property");
    }
  }

  // (2) THE M27 STATE, reached through the runtime this time. NetSuite hides a
  // cell with its OWN inline display AFTER our apply put a class on it — the one
  // way this feature's class can land on a cell visibleCells no longer returns.
  // A reveal that cleared inline display "only where our own class is" is a
  // no-op everywhere except right here, where it clears NETSUITE'S `none`, the
  // cell rejoins visibleCells, and the axis LENGTHENS. That axis keys storage on
  // the next install, so this is the identity blast radius, not a cosmetic one.
  const stranded = harness.table.rows[1].cells[1];
  stranded.style.display = "none";
  assert.equal(core.visibleCells(harness.table.rows[1]).length, 2, "the fixture is not modelling the swap");
  assert.equal(stranded.classList.contains(HIDDEN_CLASS), true, "the class was never on the stranded cell");
  const widths = () => plain(core.tableRows(harness.table).map((row) => core.visibleCells(row).length));
  const before = widths();

  harness.click(harness.owned("chip")[0]);
  await harness.tick();

  assert.equal(stranded.classList.contains(HIDDEN_CLASS), false,
    "a class was stranded on a cell NetSuite hid after the apply");
  assert.equal(stranded.style.display, "none", "the reveal cleared NetSuite's OWN inline display");
  assert.deepEqual(widths(), before, "a NetSuite-hidden cell was resurrected onto the axis");
});

test("an open line changes NOTHING about what is hidden, and the repaint it causes puts it back", async () => {
  // THE OWNER DIRECTIVE'S FIRST CLAUSE, and the inversion of the test that used
  // to stand here ("FORCE-REVEAL: an open line shows every hidden column"). A
  // column the user hid stays hidden while they edit an existing line.
  //
  // The repaint is the half that makes this more than a no-op assertion. Opening
  // a line regenerates the tbody, so OUR CLASS IS GONE by the time the install
  // runs: the machine renders nothing hidden, the model still says hidden, and
  // the apply has to run — with a NON-EMPTY set — against a machine that has a
  // line open. That is precisely the path the deleted force-reveal made
  // unreachable, so it is the one a re-introduction dies on.
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { hidden: ["quantity"] } } }
  });
  await harness.flush();
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);

  // Line 1 opens: the row keeps its numbered id and gains the focused classes —
  // the shape that used to be the whole of isLineOpen — and the machine rebuilds
  // the tbody around it.
  focusLine(harness);
  repaintHeader(harness, core);
  assert.deepEqual(hiddenHeader(core, harness), [false, false, false],
    "the fixture is not modelling the repaint that opening a line causes");
  await harness.run("line-open");
  for (const row of alignedRows(core, harness.table)) {
    assert.deepEqual(hiddenFlags(core, row), [false, true, false],
      "a column the user hid came back while a line was open");
  }
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);
  // A layout change, not a preference change: nothing is written and the stored
  // set is what it was.
  assert.equal(harness.counts.writes, 0, "opening a line wrote storage");
  assert.deepEqual(storedHidden(harness), ["quantity"]);
  // And no explanation, because there is nothing to explain: the toast that read
  // "Hidden columns are shown while you edit a line." is deleted, and a runtime
  // that says it is a runtime that has reverted.
  assert.deepEqual(harness.toasts, [], "the deleted force-reveal toast came back");
  // The chips still say what the user hid, through all of it.
  assert.deepEqual(plain(harness.owned("chip").map((node) => node.textContent)), ["Quantity ✕"]);

  // Closing the line changes nothing either, and still costs nothing.
  focusLine(harness, { open: false });
  await harness.run("line-closed");
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);
  assert.equal(harness.counts.writes, 0);
  assert.deepEqual(harness.toasts, []);
});

test("the hidden set survives the whole open → edit → commit cycle", async () => {
  // THE OWNER DIRECTIVE'S SECOND CLAUSE — "changing field values, and any other
  // Edit Mode interaction that refreshes rows". The live gate this models is the
  // one the M3 adjudication left INSUFFICIENT: open a line, change a value,
  // commit it, and confirm the hidden set is still applied on the other side.
  //
  // Every step is repaint-driven, because that is what the machine actually
  // does: NetSuite regenerates the tbody on open and again on commit, taking our
  // class with it each time, so each step is a fresh chance for the apply to
  // come back with the wrong set.
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { hidden: ["quantity"] } } }
  });
  await harness.flush();
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);

  // (1) OPEN.
  focusLine(harness);
  repaintHeader(harness, core);
  await harness.run("line-open");
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false], "open: the hide did not come back");

  // (2) EDIT — the open line now carries a changed value. Nothing in this
  // runtime reads a field any more (isDirty is deleted), and that is the claim:
  // an edit is not an event this feature has an opinion about.
  focusLine(harness, { line: 1, fields: [{ tagName: "INPUT", value: "9", defaultValue: "2" }] });
  await harness.run("field-edited");
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false], "edit: an edited value revealed a column");

  // (3) COMMIT. The line closes, the tbody is regenerated, and the row is plain
  // text again — the shape live probe 11 measured committing cleanly with a
  // column hidden and its value preserved.
  focusLine(harness, { open: false });
  repaintHeader(harness, core);
  assert.deepEqual(hiddenHeader(core, harness), [false, false, false],
    "the fixture is not modelling the commit repaint");
  await harness.run("commit-repaint");
  for (const row of alignedRows(core, harness.table)) {
    assert.deepEqual(hiddenFlags(core, row), [false, true, false],
      "commit: the hidden set was not re-applied across the commit repaint");
  }
  // Three repaints and an edit, and the user's preference was never touched.
  assert.equal(harness.counts.writes, 0);
  assert.deepEqual(storedHidden(harness), ["quantity"]);
  assert.deepEqual(harness.toasts, []);
});

test("no edit anywhere brings a hidden column back — entry row, open line, or a row nobody focused", async () => {
  // THE INVERSION OF RULE 7, which used to read "a half-entered new line keeps
  // the columns it still needs hidden" and now reads the opposite by owner
  // directive: "adding a new line, selecting an item, changing field values" are
  // named in it, and none of them moves a hidden column.
  //
  // Every shape the deleted dirty scan was built to see is driven here, because
  // each one used to be a reveal and each one is now a no-op: the always-focused
  // entry row half-typed, a ticked checkbox, a moved radio, and a row carrying
  // an edit that nobody focused. The checkbox and the radio are kept explicitly
  // — they were the two quadrants `value !== defaultValue` got wrong, so a
  // half-restored force-reveal that only handled text would still die here.
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { hidden: ["quantity"] } } }
  });
  await harness.flush();
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);

  // THE HEADER AND THE ROWS THAT WERE THERE, deliberately not every aligned row.
  // renderSignature reads the HEADER alone, so an edit that splices a row in
  // without touching the header leaves the two signatures equal and the install
  // takes its early return — the freshly spliced row is never walked, and
  // asserting over it would be asserting the fixture's own insertion. That gap
  // is pre-existing and NOT reachable on the live machine, where NetSuite
  // regenerates the whole tbody (header included) for every add, remove and
  // line open; step (5) closes the loop by driving exactly that repaint, and
  // there every aligned row is checked.
  const stillHidden = (path) => {
    assert.deepEqual(hiddenHeader(core, harness), [false, true, false],
      `${path}: an edit brought a hidden column back in the header`);
    for (const row of [harness.table.rows[1], harness.table.rows[2]]) {
      assert.deepEqual(hiddenFlags(core, row), [false, true, false],
        `${path}: an edit brought a hidden column back`);
    }
    assert.equal(harness.counts.writes, 0, `${path}: an edit wrote storage`);
    assert.deepEqual(storedHidden(harness), ["quantity"], `${path}: an edit changed the stored set`);
    assert.deepEqual(harness.toasts, [], `${path}: the deleted force-reveal toast came back`);
  };

  // (1) The permanent entry row, half-typed — "adding a new line", and the state
  // the owner watched their columns reappear in.
  entryRow(harness, [{ tagName: "INPUT", value: "SKU-9", defaultValue: "" }]);
  await harness.run("entry-row-typed");
  stillHidden("entry row, typed");

  // (2) A ticked box, and NOTHING else. NetSuite defaults plenty of line boxes
  // on — Tax, Print — so both directions are driven.
  harness.table.rows[3].querySelectorAll = () =>
    [{ tagName: "INPUT", type: "checkbox", value: "on", defaultValue: "on", checked: true, defaultChecked: false }];
  await harness.run("entry-row-checkbox");
  stillHidden("entry row, box ticked");
  harness.table.rows[3].querySelectorAll = () =>
    [{ tagName: "INPUT", type: "checkbox", value: "on", defaultValue: "on", checked: false, defaultChecked: true }];
  await harness.run("entry-row-unticked");
  stillHidden("entry row, box cleared from its default");

  // (3) A radio the user moved.
  harness.table.rows[3].querySelectorAll = () =>
    [{ tagName: "INPUT", type: "radio", value: "b", defaultValue: "b", checked: true, defaultChecked: false }];
  await harness.run("entry-row-radio");
  stillHidden("entry row, radio moved");

  // (4) A row NOBODY focused, carrying an edit. On the locked SO form a
  // committed row is plain text, but a read-only variant, a custom form or a row
  // the user clicked away from all render fields in an unfocused row — the case
  // the old dirty scan was widened to cover, and the widest reveal it had.
  const unfocused = harness.table.rows[1];
  assert.equal(/focused/.test(unfocused.className), false, "the fixture's row is focused after all");
  unfocused.querySelectorAll = () => [{ tagName: "INPUT", value: "9", defaultValue: "2" }];
  await harness.run("row-edited");
  stillHidden("unfocused row, edited");

  // (5) All of that, plus an open line and the repaint it causes. The apply has
  // to run with a non-empty set against the dirtiest machine this fixture can
  // build.
  focusLine(harness);
  repaintHeader(harness, core);
  await harness.run("line-open-over-dirty");
  stillHidden("open line over a dirty machine");
  // And HERE every aligned row is checked, the spliced entry row included: the
  // repaint destroyed our class everywhere, so the apply genuinely ran and
  // walked all of them.
  for (const row of alignedRows(core, harness.table)) {
    assert.deepEqual(hiddenFlags(core, row), [false, true, false],
      "the repaint an open line causes left a row showing a column the user hid");
  }
});
test("A3.2: the menu's tick seeds from the STORED set, never from what the column renders", async () => {
  // M2 lost a user's width to exactly this shape — a handler that seeded from
  // the inline style the apply path had just written — and this is the rule that
  // loss paid for. It needs a state where the model and the rendering DISAGREE,
  // or every seed reads the same and the test is tautological.
  //
  // RE-POINTED. The force-reveal used to be that state and it is deleted. The
  // divergence that outlives it is the REPAINT WINDOW, and it is the one the
  // live machine spends real time in: NetSuite regenerates the tbody, our class
  // dies with it, and the model still says hidden until the install's apply
  // lands — a window with an awaited storage read inside it. The Columns button
  // needs no install to open the menu, so a user can and does click it in there.
  //
  // The required carve-out is NOT the fixture, deliberately. A starred column
  // renders visible against a stored hide, but its box is forced ticked by the
  // carve-out and reads the same under either seed — "tautological" was the
  // review's word for that shape, and it applies to the starred column here for
  // the same reason it applied to Item below.
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { hidden: ["quantity"] } } }
  });
  await harness.flush();
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);
  repaintHeader(harness, core);
  assert.deepEqual(hiddenHeader(core, harness), [false, false, false],
    "the fixture is not modelling the repaint window");

  const { box } = openMenu(harness);
  assert.equal(box("quantity").checked, false, "the menu seeded from the rendering, not from the stored set");
  // Rate is the control for the seeding claim. Item cannot be: the harness
  // stars it, so its tick comes from the required carve-out and would read true
  // under either seed.
  assert.equal(box("rate").checked, true, "an unhidden, unstarred column lost its tick");
  assert.equal(harness.counts.writes, 0, "opening the menu wrote storage");
  // And opening the menu is not an apply: the repaint window is still open on
  // the way out, which is what makes the divergence above real rather than a
  // state the harness could only reach by hand.
  assert.deepEqual(hiddenHeader(core, harness), [false, false, false],
    "opening the menu applied the hidden set");
});

test("a column NetSuite stars is never hidden, whatever the container says — and the container is KEPT", async () => {
  // OWNER DIRECTIVE 2026-08-04, from live use: a required column must not be
  // hideable. NetSuite marks them in the header — span.listheaderreq inside
  // div.listheader, the * drawn by CSS — and on the locked order exactly two
  // carry it (Item and Tax Code); Quantity does not. The set is a property of
  // the FORM, so it is read from the DOM every install and never written down.
  //
  // The container is RETAINED and not corrected (spec section 7). A stored hide
  // for a column THIS form stars may be perfectly legitimate on another variant,
  // on another record type, or after an administrator unstars it — so the mount
  // filters what it renders and touches nothing the user owns. The last move of
  // this test is that retention paying off.
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { hidden: ["item", "quantity"] } } }
  });
  await harness.flush();

  // PER COLUMN, not globally: the unstarred one the user hid is still hidden.
  for (const row of alignedRows(core, harness.table)) {
    assert.deepEqual(hiddenFlags(core, row), [false, true, false],
      "a starred column was hidden, or the exemption took the whole set with it");
  }
  // Byte-untouched: no write at all, and the stored list still holds both ids.
  assert.equal(harness.counts.writes, 0, "the mount rewrote the user's own container");
  assert.deepEqual(storedHidden(harness), ["item", "quantity"],
    "the stored hide for a starred column was silently dropped");
  // A chip is a claim that the column is hidden. Item is not, so it has none.
  assert.deepEqual(plain(harness.owned("chip").map((node) => node.textContent)), ["Quantity ✕"]);

  // THE MENU'S CARVE-OUT IN A3.2's SEEDING RULE. Ticked because the column is
  // shown and always will be — NOT from the container, which says hidden — and
  // disabled so the affordance cannot promise what the model refuses.
  const { box } = openMenu(harness);
  assert.equal(box("item").checked, true, "the required column's tick came from the container");
  assert.equal(box("item").disabled, true, "a required column could be unticked");
  assert.equal(box("item").parent.title, "Required column — cannot be hidden");
  assert.equal(box("quantity").checked, false, "the ordinary tick stopped seeding from the container");
  assert.equal(box("quantity").disabled, false, "an ordinary column was disabled too");

  // RE-DERIVED, NOT PINNED PER MOUNT: the star leaves the header — an
  // administrator unstars the field, or NetSuite repaints a different form
  // variant — and the user's stored hide, which was never thrown away, now
  // finally renders.
  harness.table.rows[0].cells[0].querySelector = () => null;
  await harness.run("repaint");
  for (const row of alignedRows(core, harness.table)) {
    assert.deepEqual(hiddenFlags(core, row), [true, true, false],
      "the required set was decided once per mount instead of once per install");
  }
  assert.equal(harness.counts.writes, 0, "re-deriving the required set wrote storage");
  assert.deepEqual(plain(harness.owned("chip").map((node) => node.textContent)), ["Item ✕", "Quantity ✕"]);
});

test("the hide choke point refuses a starred column, with no write and no DOM change", async () => {
  // The disabled box is the affordance; this is the MODEL saying the same thing.
  // Every hide in this feature passes through setColumnHidden, and anything that
  // gets past a disabled attribute — an extension, a script, an assistive tool,
  // a future caller of our own — arrives here.
  const core = createApi();
  const harness = createRuntimeHarness();
  await harness.flush();
  assert.deepEqual(hiddenHeader(core, harness), [false, false, false]);

  const { menu, box } = openMenu(harness);
  const target = box("item");
  assert.equal(target.disabled, true, "the affordance is already open, so this is not the last line of defence");
  // The change a disabled box cannot raise, raised anyway.
  target.checked = false;
  harness.fire("change", { on: menu, target });
  await harness.tick();

  assert.equal(harness.counts.writes, 0, "a hide for a starred column reached storage");
  assert.equal(storedHidden(harness), null);
  assert.deepEqual(hiddenHeader(core, harness), [false, false, false], "a starred column was hidden");
  assert.deepEqual(plain(harness.owned("chip")), [], "a chip appeared for a column that is not hidden");
});

test("the choke point is armed BEFORE the install's storage read, not only after it", async () => {
  // The reviewer's window: ensureControls and ensureBindings run before the
  // storage await, so the Columns button is clickable while the read is parked
  // — and on a mount's FIRST install nothing had derived requiredColumns yet.
  // A gesture landing there stored a hide for a starred column that no UI could
  // then clear: the box is disabled for the rest of the mount's life, chips
  // filter required ids, and by the retention doctrine the stray hide WOULD
  // render on any form variant that does not star the column. The set needs
  // only the table and the axis, neither of which waits on storage — so the
  // install derives it before the read too, and this drives that exact window.
  const core = createApi();
  const harness = createRuntimeHarness({ holdRead: true });
  await harness.tick();
  assert.equal(harness.counts.editReads, 1, "the install never reached its storage read");

  const { menu, box } = openMenu(harness);
  const target = box("item");
  assert.equal(target.disabled, true,
    "the Columns menu opened inside the read window with the starred column enabled");
  // And the model refuses even the change a disabled box cannot raise.
  target.checked = false;
  harness.fire("change", { on: menu, target });
  await harness.tick();
  assert.equal(harness.counts.writes, 0,
    "a hide for a starred column reached storage from the read window");

  harness.releaseRead();
  await harness.flush();
  // Steady state agrees with the window: nothing stored, nothing hidden, and
  // the reopened menu says the same thing the parked one did.
  assert.equal(harness.counts.writes, 0);
  assert.equal(storedHidden(harness), null);
  assert.deepEqual(hiddenHeader(core, harness), [false, false, false]);
  const reopened = openMenu(harness);
  assert.equal(reopened.box("item").disabled, true);
  assert.equal(reopened.box("item").checked, true);
});

// "a stored hide this form refuses is not a DEFERRED hide, and owes the user no
// explanation" lived here and is GONE with noteDeferredHide, pendingApply and
// the toast. Its whole subject was an explanation the runtime no longer owes,
// because there is no longer any state in which the model and the rendering
// disagree about a hide. What it also asserted — that a stored hide for a
// starred column renders nothing, writes nothing, gets no chip and is RETAINED
// in the container — is pinned unchanged by "a column NetSuite stars is never
// hidden, whatever the container says", above.

test("the star is read from the FORM, so a machine that stars nothing hides that same column", async () => {
  // The set must be DERIVED, never a list of ids someone typed. A machine whose
  // header carries no star at all is the other half of the live shape — the same
  // sublist on a form variant where Item is not mandatory — and there the user's
  // hide is theirs to make.
  const core = createApi();
  const harness = createRuntimeHarness({
    machine: { required: [] },
    stored: { schemaVersion: 1, grids: { [SCOPE]: { hidden: ["item"] } } }
  });
  await harness.flush();
  for (const row of alignedRows(core, harness.table)) {
    assert.deepEqual(hiddenFlags(core, row), [true, false, false],
      "a column no form starred was treated as required");
  }
  assert.deepEqual(plain(harness.owned("chip").map((node) => node.textContent)), ["Item ✕"]);
  const { box } = openMenu(harness);
  assert.equal(box("item").disabled, false, "an unstarred column was disabled");
  assert.equal(box("item").checked, false, "an unstarred column's tick stopped following the container");
});

test("a hide made WHILE a line is open lands on the spot, and still writes exactly once", async () => {
  // THE QUEUE-WHILE-OPEN RULE, INVERTED FOR HIDE/SHOW. Spec section 6 queued
  // hide/show, filter and width while a line was open; SPEC AMENDMENT 2
  // (adjudication #16) took WIDTH out of that set, and the owner directive of
  // 2026-08-04 takes hide/show out too — "remain hidden at all times ... while
  // editing an existing line" is not a rule a queue can deliver, because a queue
  // is exactly the state where the machine disagrees with the model. Filter is
  // all that is left in the queued set, and it is not built.
  //
  // The gesture is one gesture either way: the DEFERRAL was always the rendering
  // and never the write, so the write count is the half of this test that did
  // not change.
  const core = createApi();
  const harness = createRuntimeHarness();
  await harness.flush();
  focusLine(harness);
  await harness.run("line-open");

  await toggleColumn(harness, "rate", false);
  assert.deepEqual(hiddenHeader(core, harness), [false, false, true],
    "a hide made while a line was open never reached the machine");
  for (const row of alignedRows(core, harness.table)) {
    assert.deepEqual(hiddenFlags(core, row), [false, false, true],
      "a hide made while a line was open reached the header and not the rows");
  }
  assert.equal(harness.counts.writes, 1);
  assert.deepEqual(storedHidden(harness), ["rate"]);

  // Closing the line changes NOTHING, and this is measured at the APPLY rather
  // than at its result: an idempotent re-apply leaves the DOM identical, so a
  // flush that survived the deletion would be invisible to every result-shaped
  // assertion. Counting the class writes core.applyHidden performs is what makes
  // "an ordinary click inside the machine costs no apply at all" testable.
  let toggles = 0;
  for (const cell of headerOf(harness, core)) {
    const inner = cell.classList.toggle;
    cell.classList.toggle = (...args) => {
      toggles += 1;
      return inner.apply(cell.classList, args);
    };
  }
  focusLine(harness, { open: false });
  harness.click(harness.table.rows[0].cells[0]);
  await new Promise((done) => setTimeout(done, 1));
  assert.equal(toggles, 0, "a click still re-applies — something is deferring the hide again");
  assert.equal(harness.counts.writes, 1, "closing the line wrote storage a second time");
  assert.deepEqual(hiddenHeader(core, harness), [false, false, true]);
});

test("two hide gestures with nothing between them each write their OWN snapshot", async () => {
  // The width analogue of this is the I-2 data-loss pin. It reaches the hidden
  // set unchanged: core.withHidden replaces the stored list wholesale, so an
  // operation that read hiddenColumns at RUN time instead of at enqueue would
  // give BOTH writes the final set — and the first write would then claim a
  // state the user had not reached when they made it.
  const core = createApi();
  const harness = createRuntimeHarness();
  await harness.flush();
  // NOTHING awaited between them, on one standing menu: both saves are enqueued
  // before either has run, which is the only arrangement where a run-time read
  // and an enqueue-time snapshot differ.
  const { menu, box } = openMenu(harness);
  const first = box("quantity");
  first.checked = false;
  harness.fire("change", { on: menu, target: first });
  const second = box("rate");
  second.checked = false;
  harness.fire("change", { on: menu, target: second });
  await harness.tick();
  assert.equal(harness.counts.writes, 2);
  assert.deepEqual(plain(harness.writes[0][EDIT_STORAGE_KEY].grids[SCOPE].hidden), ["quantity"],
    "the first write carried a set the second gesture had already moved");
  assert.deepEqual(plain(harness.writes[1][EDIT_STORAGE_KEY].grids[SCOPE].hidden), ["quantity", "rate"]);
  assert.deepEqual(hiddenHeader(core, harness), [false, true, true]);
});

test("an install that applies NOTHING still shows the chips for what is stored", async () => {
  // RE-POINTED. The old fixture was a force-reveal — the target said "nothing
  // hidden", the freshly repainted machine already rendered nothing hidden, the
  // signatures agreed and the install returned early with the chips still owed.
  // That state is deleted. The claim is not: renderChips is called from the
  // install and NOT only from the apply, and an install that applies nothing is
  // still reachable in exactly the shape below.
  //
  // The machine is settled and correct, so the signatures agree and the install
  // takes its early return. What is NOT settled is our own bar: ensureControls
  // rebuilds it — with an EMPTY chip row — whenever the bar it holds is no
  // longer connected, which is the container-replaced-without-a-teardown edge
  // this feature already carries as an anticipated machine-lifecycle shape —
  // ensureControls branches on it, but live reachability is unconfirmed. Put the two
  // together and the user is looking at a hidden column with nothing on screen
  // saying which one it is, or offering the ✕ that undoes it.
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { hidden: ["quantity"] } } }
  });
  await harness.flush();
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);
  assert.deepEqual(plain(harness.owned("chip").map((node) => node.textContent)), ["Quantity ✕"]);

  const [bar] = harness.owned("controls");
  bar.remove();
  assert.deepEqual(plain(harness.owned("chip").map((node) => node.textContent)), [],
    "the fixture is not modelling a bar the container took away");

  // Not vacuous, and this is the half that makes the claim about the INSTALL
  // rather than about the apply: the class writes core.applyHidden would perform
  // are counted, and there must be none.
  let toggles = 0;
  for (const cell of headerOf(harness, core)) {
    const inner = cell.classList.toggle;
    cell.classList.toggle = (...args) => {
      toggles += 1;
      return inner.apply(cell.classList, args);
    };
  }
  await harness.run("container-replaced");
  assert.equal(toggles, 0, "the fixture is not modelling an install that applies nothing");
  assert.deepEqual(plain(harness.owned("chip").map((node) => node.textContent)), ["Quantity ✕"],
    "an install that applied nothing left the user no way to see or undo their hide");
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);
  assert.equal(harness.counts.writes, 0);
});

test("focus moving inside the machine repairs a drifted render, and costs nothing when it is current", async () => {
  // RE-POINTED. handleFocusIn used to be half of the deferred-hide flush — a
  // line opened without a repaint moved the model and nothing else would notice.
  // Both the deferral and the open-line dependence are deleted, and what remains
  // is the drift this runtime genuinely cannot observe: it watches childList
  // only, so a rewrite that changes a cell's attributes without adding or
  // removing a node schedules no install at all.
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { hidden: ["quantity"] } } }
  });
  await harness.flush();
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);

  // Focus moves constantly inside a machine. When the render already matches the
  // model the handler must take the SAME early return the install takes, or
  // "zero DOM writes when nothing changed" stops being true for the session.
  const cell = harness.table.rows[1].cells[0];
  const written = [];
  for (const header of headerOf(harness, core)) {
    let value = header.style.width;
    Object.defineProperty(header.style, "width", {
      configurable: true,
      get: () => value,
      set: (next) => {
        written.push(next);
        value = next;
      }
    });
  }
  harness.fire("focusin", { target: cell });
  assert.deepEqual(written, [], "a focus movement re-applied a layout that was already correct");

  // OPENING A LINE IS NO LONGER ONE OF THOSE STATES, and that is worth an
  // assertion of its own: the model does not move when a line opens, so focus
  // moving into it must still cost nothing.
  focusLine(harness);
  harness.fire("focusin", { target: cell });
  await harness.tick();
  assert.deepEqual(written, [], "opening a line moved the target again");
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false],
    "focus moving into an opened line revealed a column");

  // THE DRIFT THAT IS STILL REACHABLE: our class comes off the machine with no
  // node added or removed, so the observer never fires and no install is
  // scheduled. The render and the target now disagree, and focus is the only
  // thing that will notice.
  for (const header of headerOf(harness, core)) {
    header.classList.remove(HIDDEN_CLASS);
  }
  assert.deepEqual(hiddenHeader(core, harness), [false, false, false],
    "the fixture is not modelling a rewrite the observer cannot see");
  harness.fire("focusin", { target: cell });
  await harness.tick();
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false],
    "focus moving inside a drifted machine left the user's hide unapplied");
  assert.equal(harness.counts.writes, 0);

  // Focus outside the machine is not ours to act on.
  for (const header of headerOf(harness, core)) {
    header.classList.remove(HIDDEN_CLASS);
  }
  harness.fire("focusin", { target: harness.container });
  await harness.tick();
  assert.deepEqual(hiddenHeader(core, harness), [false, false, false],
    "focus landing outside the machine ran an apply");
});

test("teardown strips the class, the bar and the menu, and a remount rebuilds them", async () => {
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { hidden: ["quantity"] } } }
  });
  await harness.flush();
  openMenu(harness);
  assert.equal(harness.owned("menu").length, 1);
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);

  await harness.changeSettings({ salesOrderColumnsEdit: false });
  // The class comes off EVERY cell. Left behind it springs the column back
  // hidden by `!important` the moment NetSuite re-renders, with no feature left
  // to un-hide it — and teardown runs after the pin is dropped, which is why the
  // reveal takes no axis (adjudication #19).
  for (const row of core.tableRows(harness.table)) {
    assert.deepEqual(hiddenFlags(core, row).filter(Boolean), [], "a hidden class survived teardown");
  }
  // The menu lives on <body>, outside the container, so the document-scoped
  // sweep is the only thing that can reach it.
  assert.deepEqual(plain(harness.owned("menu")), []);
  assert.equal(harness.body.children.length, 0, "the column menu leaked past teardown");
  assertNotMounted(harness, "settings off");
  // Storage is untouched by a teardown — the user's layout is a preference, not
  // a render.
  assert.deepEqual(storedHidden(harness), ["quantity"]);

  await harness.changeSettings({ salesOrderColumnsEdit: true });
  await harness.flush();
  assert.equal(harness.mounts().length, 2, "the remount did not rebuild the control bar");
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);
  assert.deepEqual(plain(harness.owned("chip").map((node) => node.textContent)), ["Quantity ✕"]);
  assert.equal(harness.counts.writes, 0);
});

test("an install landing in a hide's save gap does not discard the gesture", async () => {
  // Defect D2, for the SECOND field. core.withHidden replaces the stored list
  // wholesale exactly as core.withWidths replaces the map, so an install that
  // reseeds hiddenColumns from a snapshot older than the gesture makes the NEXT
  // gesture's write delete the column this one added. The guard is armed inside
  // enqueueSave now, which is what makes it true for this writer without the
  // writer knowing about it.
  const core = createApi();
  const harness = createRuntimeHarness();
  await harness.flush();

  harness.gateReads();
  const install = harness.lifecycle.run("install-in-the-save-gap");
  await harness.tick();
  await toggleColumn(harness, "quantity", false);
  assert.equal(harness.counts.writes, 0, "the save has not run yet — that is the gap");
  harness.releaseRead();
  await install;
  await harness.tick();
  assert.equal(harness.counts.writes, 1);
  assert.deepEqual(storedHidden(harness), ["quantity"]);

  // The second gesture is what would destroy the first one's column.
  await toggleColumn(harness, "rate", false);
  assert.equal(harness.counts.writes, 2);
  assert.deepEqual(storedHidden(harness), ["quantity", "rate"],
    "a reseed from a snapshot older than the gesture dropped the hidden column");
  assert.deepEqual(hiddenHeader(core, harness), [false, true, true]);
});

test("the scope key is latched: an install that cannot read the session keeps the user's key", async () => {
  // resolveScopeKey falls back to a hostname-shaped key whenever the session
  // status script is not in the document, and installs are repaint-driven, so
  // one can land while NetSuite is rewriting <head>. Re-resolving there relabels
  // the user's saved layout: the stored entry reads EMPTY under the fallback
  // key, the reseed guard is armed (no gesture is pending) so hiddenColumns is
  // emptied from it, every hidden column pops back with nothing to say why, and
  // every later gesture persists under the shadow key — where core's
  // single-entry eviction can drop the real one under quota pressure.
  //
  // Latched exactly like the axis pin, and pinned here the same way: through a
  // real repaint-driven re-install, not by calling the resolver.
  const core = createApi();
  const harness = createRuntimeHarness({
    stored: { schemaVersion: 1, grids: { [SCOPE]: { hidden: ["quantity"] } } }
  });
  await harness.flush();
  assert.deepEqual(hiddenHeader(core, harness), [false, true, false]);

  // The script leaves the document. Everything else about the page is unchanged,
  // so the ONLY thing this repaint can change is the key.
  const query = harness.sandbox.document.querySelector;
  harness.sandbox.document.querySelector = (selector) =>
    (String(selector).startsWith("script[") ? null : query(selector));
  await harness.run("repaint");

  assert.deepEqual(hiddenHeader(core, harness), [false, true, false],
    "an install that lost the session script revealed the user's hidden column");
  assert.deepEqual(storedHidden(harness), ["quantity"], "the stored set moved under a re-resolved key");
  // And the next gesture still writes where the user's layout lives — one grid
  // in the container, not the real one plus a shadow.
  await toggleColumn(harness, "rate", false);
  assert.deepEqual(Object.keys(harness.writes.at(-1)[EDIT_STORAGE_KEY].grids), [SCOPE],
    "a gesture after the session script vanished wrote under a second, shadow key");
  assert.deepEqual(storedHidden(harness), ["quantity", "rate"]);
});

test("a hide that only got half-way is re-applied, not sealed in by the header-only signature", async () => {
  // core.applyHidden walks EVERY row and swallows a mid-walk throw — the machine
  // being replaced under it — returning false with the header and the first rows
  // hidden and the rest not. renderSignature reads the HEADER alone, so that
  // half-applied machine compares EQUAL to the target and every later install
  // takes the early return: the columns stay half-hidden for the life of the
  // mount. The boolean was being discarded; recording it is what makes the next
  // pass try again.
  // BOTH GATES, because there are two and they must not drift: the install's and
  // handleFocusIn's, which its own comment calls "the same early return the
  // install takes". A user who clicks into a line is the likeliest next event
  // after the repaint that interrupted the walk, so the focus path is the one
  // most likely to meet the half-applied machine first.
  const core = createApi();
  const halfApplied = async () => {
    const harness = createRuntimeHarness();
    await harness.flush();
    // ONE cell refuses the class, which is all a mid-walk throw is from here: the
    // walk reaches row 2, throws inside it, and core answers false with row 2
    // still showing. Narrow on purpose — applyHidden is the only caller of
    // classList.toggle on a machine cell, so nothing else here is stubbed.
    const victim = harness.table.rows[2].cells[1];
    const realToggle = victim.classList.toggle;
    victim.classList.toggle = () => { throw new Error("the machine was replaced mid-walk"); };
    await toggleColumn(harness, "quantity", false);

    // The half-applied state itself, which is the precondition both halves rest
    // on: the header says done over a row that is not.
    assert.deepEqual(hiddenHeader(core, harness), [false, true, false], "the header was not reached");
    assert.deepEqual(hiddenFlags(core, harness.table.rows[1]), [false, true, false]);
    assert.deepEqual(hiddenFlags(core, harness.table.rows[2]), [false, false, false],
      "the fixture is not modelling a walk that stopped part-way");
    // The machine settles: nothing about the HEADER changes from here, so the
    // signature pair agrees and only the recorded refusal can reopen the apply.
    victim.classList.toggle = realToggle;
    return harness;
  };
  const repaired = (harness, path) => {
    for (const row of alignedRows(core, harness.table)) {
      assert.deepEqual(hiddenFlags(core, row), [false, true, false],
        `${path}: a row the failed walk never reached is still showing a column the user hid`);
    }
    // One gesture, still exactly one write: the retry is an APPLY, not a save.
    assert.equal(harness.counts.writes, 1);
  };

  // (1) A repaint re-installs.
  const byRepaint = await halfApplied();
  await byRepaint.run("repaint");
  repaired(byRepaint, "install");

  // (2) NO repaint at all — focus moves into the machine, which is the gate that
  // kept the bare signature check after the install's had been fixed.
  const byFocus = await halfApplied();
  byFocus.fire("focusin", { target: byFocus.table.rows[1].cells[0] });
  await byFocus.tick();
  repaired(byFocus, "focusin");
});

test("the column menu closes on an outside click and on Escape, and leaves no listener behind", async () => {
  // The menu is absolutely positioned on <body>, so the container's own click
  // handler cannot see a click that lands anywhere else on the page: without
  // these it stays up over whatever the user does next. Bound at open, off at
  // close, and off at teardown — the drag pair's own lifecycle, which is the
  // only precedent in this runtime for a document-level listener.
  const harness = createRuntimeHarness();
  await harness.flush();
  assert.deepEqual(harness.documentListeners.map(({ type }) => type), [],
    "the runtime bound a document listener before anything was open");

  openMenu(harness);
  assert.equal(harness.owned("menu").length, 1);
  assert.deepEqual(harness.documentListeners.map(({ type }) => type), ["click", "keydown"]);

  // THE BUTTON IS EXEMPT, and this is the assertion that proves it: the dismissal
  // runs in the capture phase, ahead of the container's delegated click, so a
  // handler that closed here would leave that one seeing no menu and re-opening
  // it — a Columns button that can never close what it opened.
  harness.click(harness.owned("columns-button")[0]);
  assert.deepEqual(plain(harness.owned("menu")), [], "the Columns button no longer closes its own menu");
  assert.deepEqual(harness.documentListeners, []);

  // A click that misses the machine entirely — `outside`, so the container's
  // delegated handler never sees it and this dismissal is the only one that can
  // fire. That is the live shape: the bar dismisses what lands on the machine,
  // and nothing dismissed what landed anywhere else.
  openMenu(harness);
  harness.fire("click", { target: harness.body, outside: true });
  assert.deepEqual(plain(harness.owned("menu")), [], "a click outside the menu left it standing");
  assert.deepEqual(harness.documentListeners, [], "the dismissal pair outlived the menu");

  // A click INSIDE it is not a dismissal. The menu lives on <body>, so this one
  // is `outside` the container too — and on a checkbox the browser fires click
  // BEFORE change, so a dismissal without this exemption would tear the menu
  // down under the pointer on every single tick.
  openMenu(harness);
  harness.fire("click", { target: harness.owned("column-toggle")[0], outside: true });
  assert.equal(harness.owned("menu").length, 1, "a click on a checkbox dismissed the menu");

  harness.fire("keydown", { key: "Escape" });
  assert.deepEqual(plain(harness.owned("menu")), [], "Escape left the menu standing");
  assert.deepEqual(harness.documentListeners, []);

  // Any other key is not Escape.
  openMenu(harness);
  harness.fire("keydown", { key: "a" });
  assert.equal(harness.owned("menu").length, 1, "an ordinary keystroke closed the menu");

  // Teardown with the menu STANDING: the node is swept as an owned node, but
  // these two are on the document and can only come off by name — the same
  // reason the flush timer does.
  harness.lifecycle.registration.cleanup({ id: "record.edit-grid", reason: "paused" });
  assert.deepEqual(harness.documentListeners, [], "the menu's dismissal pair outlived its mount");
  assert.deepEqual(plain(harness.owned("menu")), []);
});

test("teardown releases the bindings even when the machine table is already detached", async () => {
  // The same class as the layout defect above, on the other half of the mount.
  // removeEditGrid used to re-derive the container from the table, and a
  // teardown that lands while NetSuite is replacing the machine finds it
  // detached: closest() answers null, the release no-ops, and the LIVE container
  // keeps the bound stamp, the axis stamp and all five delegated listeners. The
  // listeners are the sharp half — a resize gesture on a feature that is off
  // still runs, and still writes storage.
  const core = createApi();
  const harness = createRuntimeHarness();
  await harness.flush();
  assert.equal(harness.container.hasAttribute(BOUND_ATTRIBUTE), true);
  assert.equal(harness.container.listeners.length > 0, true);

  // Detached: the table is no longer reachable from anything above it.
  harness.table.closest = () => null;
  harness.lifecycle.registration.cleanup({ id: "record.edit-grid", reason: "paused" });
  assert.equal(harness.container.hasAttribute(BOUND_ATTRIBUTE), false,
    "the container is still stamped as bound by a mount that is gone");
  assert.equal(harness.container.hasAttribute(AXIS_ATTRIBUTE), false,
    "a torn-down page still advertises a live axis");
  assert.deepEqual(harness.container.listeners, [],
    "the delegated listeners outlived the mount that bound them");

  // The behavioural half: a full drag on the dead machine writes NOTHING.
  const cells = headerOf(harness, core);
  const box = cells[1].getBoundingClientRect();
  harness.pointer("pointerdown", { target: cells[1], clientX: box.right - 1, clientY: box.top + 4 });
  harness.pointer("pointermove", { clientX: box.right + 40, clientY: box.top + 4 });
  harness.pointer("pointerup", { clientX: box.right + 40, clientY: box.top + 4 });
  await harness.tick();
  assert.equal(harness.counts.writes, 0, "a gesture on a torn-down mount reached storage");
});

// "a row NOBODY focused, carrying an edit, forces the hidden columns back" lived
// here and is GONE — INVERTED, not dropped. The row shape it found is still the
// widest one the deleted dirty scan reached (a read-only variant, a custom form,
// a row the user edited and clicked away from), so it is built as step (4) of
// "no edit anywhere brings a hidden column back", where it now pins the opposite
// answer: that row does NOT bring the column back, because nothing does.

test("runtime owns no observer, no HTML sink and no View Mode storage", () => {
  assert.doesNotMatch(runtimeSource, /innerHTML|new MutationObserver|suiteMateV3ColumnOrder|SuiteMateV3SoColumnsCore/);
  // M2 is the first milestone that writes and M3 is the second. STILL exactly
  // ONE write site — "one gesture = exactly one write" is not measurable against
  // a runtime with a second, unqueued writer somewhere else — and M3 kept it at
  // one by sharing `saveField` rather than copying it. A copied writer is three
  // chances to drift from the generation guard, the double check around the
  // await and the refusal toast, all of which the width writer paid for.
  assert.equal((runtimeSource.match(/chrome\.storage\.sync\.set\(/g) ?? []).length, 1);
  const [writer] = runtimeSource.match(/ {2}function saveField\(writeField\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.equal(Boolean(writer), true, "saveField is no longer a named function in runtime.js");
  assert.match(writer, /await chrome\.storage\.sync\.set\(\{ \[core\.STORAGE_KEY\]: next \}\)/);
  assert.match(writer, /return enqueueSave\(/);
  // Both fields go through it, and neither reaches storage any other way.
  for (const name of ["saveWidths", "saveHidden"]) {
    const [field] = runtimeSource.match(new RegExp(` {2}function ${name}\\(\\) \\{[\\s\\S]*?\\n {2}\\}`)) ?? [];
    assert.equal(Boolean(field), true, `${name} is no longer a named function in runtime.js`);
    assert.match(field, /return saveField\(/, `${name} does not go through the shared writer`);
  }
  // The reseed guard is armed by the QUEUE, not by each writer. That is what
  // makes a future third field's writer safe by default: a writer that forgot to
  // increment reintroduces defect D2 for its own field, and there is now no way
  // to enqueue a save without arming it.
  const [enqueue] = runtimeSource.match(/ {2}function enqueueSave\(operation\) \{[\s\S]*?\n {2}\}/) ?? [];
  assert.match(enqueue, /pendingWrites \+= 1;/);
  assert.match(enqueue, /saveEpoch \+= 1;/);
  assert.doesNotMatch(writer, /pendingWrites|saveEpoch/, "a writer is arming the guard by hand again");
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
  // display-defeats-hidden has FOUR recorded sightings; all three hide rules
  // and the [hidden] guard carry !important.
  assert.match(stylesheet, /\[data-suitemate-v3-edit-grid\]\[hidden\]\s*\{\s*display: none !important/);
  assert.match(stylesheet, /\.suitemate-v3-edit-grid-col-hidden\s*\{\s*display: none !important/);
  assert.match(stylesheet, /\.suitemate-v3-edit-grid-row-filtered\s*\{\s*display: none !important/);
  // SIGHTING FOUR: the doctrine reads BOTH ways. A rule of ours that makes an
  // injected node VISIBLE is exposed to the same hostile cascade as one that
  // hides, so every `display` this sheet sets carries !important — not just the
  // none ones.
  for (const [, value] of stylesheet.matchAll(/\n\s*(display:[^;\n}]+)/g)) {
    assert.match(value, /!important/, `a display rule without !important: ${value}`);
  }
});

test("SIGHTING FOUR: the control bar out-specifies the rule that was hiding it", async () => {
  // THE LIVE BUG. The bar mounted and computed `display: none` on the real page.
  // The rule that killed it is `.uir-machine-table-container>div` inside a
  // `display: none !important` list — and it is in SuiteMate's OWN View Mode
  // restyling sheet, reaching into Edit Mode through a View Mode selector. That
  // file is out of bounds, so the override belongs in ours.
  //
  // !important ALONE IS NOT THE FIX, and that is the half a doctrine stated as
  // "carry !important" does not cover: both rules are !important, so SPECIFICITY
  // decides, and a bare class rule loses. Measured on the fixture — a bare div
  // child of the container computes `none` even with a plain !important class.
  //
  // Pinned by computing specificity rather than by matching a selector string: a
  // string assertion passes the moment someone rewrites the selector into
  // something equally pretty and equally losing, which is exactly the failure
  // mode recorded at CHECKPOINTS.md:973 — an assertion that held while the pixels
  // were absent.
  const netsuiteCss = await readFile(resolve(root, "src/styles/netsuite.css"), "utf8");
  // (ids, classes/attrs/pseudo-classes, elements/pseudo-elements). :not() itself
  // adds nothing; its argument counts, which is why `html:not(.ext-f)` is one
  // class and one element.
  const specificity = (selector) => {
    const flat = selector.replace(/:not\(|:is\(|\)/g, " ");
    return [
      (flat.match(/#[\w-]+/g) ?? []).length,
      (flat.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) ?? []).length,
      (flat.match(/(?:^|[\s>+~])([a-z][\w-]*)/g) ?? []).length
    ];
  };
  const beats = (a, b) => {
    for (let i = 0; i < 3; i += 1) {
      if (a[i] !== b[i]) {
        return a[i] > b[i];
      }
    }
    return false;
  };
  // The hostile selector, located in the sheet rather than quoted from memory —
  // if it is ever removed this test says so instead of silently passing.
  const hostile = netsuiteCss
    .split("\n")
    .map((line) => line.trim().replace(/,$/, ""))
    .find((line) => /\.uir-machine-table-container>div$/.test(line));
  assert.equal(Boolean(hostile), true,
    "the rule that hid the control bar is gone from netsuite.css — re-check whether the override is still needed");
  // Our override, likewise found rather than quoted.
  const override = stylesheet
    .split("\n")
    .map((line) => line.trim().replace(/\s*\{$/, ""))
    .find((line) => /uir-machine-table-container.*suitemate-v3-edit-grid-controls/.test(line));
  assert.equal(Boolean(override), true, "the control bar has no container-anchored show rule");
  assert.equal(beats(specificity(override), specificity(hostile)), true,
    `the control bar's show rule (${specificity(override)}) does not out-specify the rule that hides it (${specificity(hostile)})`);
  // Not vacuous: the bare class rule that shipped and was invisible does NOT beat
  // it, which is the whole finding.
  assert.equal(beats(specificity(".suitemate-v3-edit-grid-controls"), specificity(hostile)), false,
    "the fixture's own measurement says a bare class rule loses — this arithmetic disagrees");
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
