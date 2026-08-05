import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "src/so-columns/core.js"), "utf8");

function createApi() {
  const sandbox = { TextEncoder };
  sandbox.globalThis = sandbox;
  runInNewContext(source, sandbox);
  return sandbox.SuiteMateV3SoColumnsCore;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createRow(labels, className = "uir-machine-row") {
  const row = {
    className,
    cells: labels.map((label) => {
      const attrs = {};
      return {
        textContent: label,
        getAttribute: (name) => (name in attrs ? attrs[name] : null),
        setAttribute: (name, value) => { attrs[name] = String(value); }
      };
    }),
    appendChild(cell) {
      const index = row.cells.indexOf(cell);
      if (index >= 0) {
        row.cells.splice(index, 1);
      }
      row.cells.push(cell);
      return cell;
    }
  };
  return row;
}

function createTable(headerLabels, bodyRows = []) {
  const headerRow = createRow(headerLabels, "uir-machine-headerrow");
  return {
    rows: [headerRow, ...bodyRows],
    querySelector(selector) {
      return selector.includes("uir-machine-headerrow") ? headerRow : null;
    }
  };
}

function rowLabels(row) {
  return row.cells.map((cell) => String(cell.textContent).trim());
}

test("exports a frozen core with the column-order storage contract", () => {
  const core = createApi();
  assert.equal(core.VERSION, 1);
  assert.equal(Object.isFrozen(core), true);
  assert.equal(core.STORAGE_KEY, "suiteMateV3ColumnOrder");
  assert.equal(core.STORAGE_SCHEMA_VERSION, 3);
  assert.equal(core.MAX_SYNC_ITEM_BYTES, 7800);
  assert.equal(core.HEADER_ROW_SELECTOR, "tr.uir-machine-headerrow");
  assert.equal(core.DATA_ATTRIBUTE, "data-suitemate-v3-so-columns");
  assert.equal(Object.isFrozen(core.CLASSES), true);
});

test("plans saved orders by label with stable native fallbacks", () => {
  const core = createApi();
  const native = ["Item", "Description", "Quantity", "Rate", "Amount"];
  assert.deepEqual(plain(core.planOrder(native, [])), native);
  assert.deepEqual(plain(core.planOrder(native, null)), native);
  assert.deepEqual(plain(core.planOrder(native, native)), native);
  assert.deepEqual(
    plain(core.planOrder(native, ["Quantity", "Item"])),
    ["Quantity", "Description", "Item", "Rate", "Amount"]
  );
  assert.deepEqual(
    plain(core.planOrder(native, ["Amount", "Stale Column", "Item"])),
    ["Amount", "Description", "Quantity", "Rate", "Item"]
  );
  assert.deepEqual(
    plain(core.planOrder(native, ["Rate", "Rate", "Quantity"])),
    ["Item", "Description", "Rate", "Quantity", "Amount"]
  );
});

test("pins duplicate and empty labels to their native positions", () => {
  const core = createApi();
  assert.deepEqual(
    plain(core.planOrder(["Item", "Amount", "Item", "Quantity"], ["Quantity", "Amount", "Item"])),
    ["Item", "Quantity", "Item", "Amount"]
  );
  assert.deepEqual(
    plain(core.planOrder(["Item", "", "Quantity"], ["Quantity", "", "Item"])),
    ["Quantity", "", "Item"]
  );
});

test("normalizeStored rejects garbage, newer versions and hostile keys", () => {
  const core = createApi();
  const empty = { schemaVersion: 3, orders: {} };
  for (const value of [
    null,
    undefined,
    "orders",
    12,
    ["Item"],
    { schemaVersion: 4, orders: { a: ["Item"] } },
    { orders: { a: ["Item"] } },
    { schemaVersion: 1, orders: ["Item"] }
  ]) {
    assert.deepEqual(plain(core.normalizeStored(value)), empty);
  }

  const hostile = JSON.parse(
    '{"schemaVersion":1,"orders":{"__proto__":["Item"],"constructor":["Item"],"prototype":["Item"],"":["Item"],"safe":["Item","Quantity"]}}'
  );
  const normalized = core.normalizeStored(hostile);
  assert.deepEqual(Object.keys(normalized.orders), ["safe"]);
  assert.deepEqual(plain(normalized.orders.safe), { order: ["Item", "Quantity"] });

  const mixed = {
    schemaVersion: 1,
    orders: {
      keep: ["Item"],
      notArray: "Item",
      hasNumber: ["Item", 7],
      empty: [],
      tooLong: ["x".repeat(201)],
      tooMany: Array.from({ length: 101 }, (_, index) => `Column ${index}`)
    }
  };
  assert.deepEqual(Object.keys(core.normalizeStored(mixed).orders), ["keep"]);
});

test("normalizeStored migrates v1 arrays and accepts v2 entries", () => {
  const core = createApi();
  const v1 = { schemaVersion: 1, orders: { "123:7:salesord": ["Item", "Quantity"] } };
  assert.deepEqual(plain(core.normalizeStored(v1)), {
    schemaVersion: 3,
    orders: { "123:7:salesord": { order: ["Item", "Quantity"] } }
  });

  const v2 = {
    schemaVersion: 2,
    orders: {
      a: { order: ["Item"], hidden: ["Rate"] },
      b: { hidden: ["Location"] },
      dropMe: { order: "nope" }
    }
  };
  assert.deepEqual(plain(core.normalizeStored(v2)), {
    schemaVersion: 3,
    orders: { a: { order: ["Item"], hidden: ["Rate"] }, b: { hidden: ["Location"] } }
  });
});

test("withHidden stores, clears and preserves order in the same entry", () => {
  const core = createApi();
  const base = core.withOrder(undefined, "123:7", ["Item", "Quantity"]);
  const withHidden = core.withHidden(base, "123:7", ["Rate"]);
  assert.deepEqual(plain(withHidden.orders["123:7"]), { order: ["Item", "Quantity"], hidden: ["Rate"] });

  const orderKept = core.withOrder(withHidden, "123:7", ["Quantity", "Item"]);
  assert.deepEqual(plain(orderKept.orders["123:7"]), { order: ["Quantity", "Item"], hidden: ["Rate"] });

  const cleared = core.withHidden(orderKept, "123:7", []);
  assert.deepEqual(plain(cleared.orders["123:7"]), { order: ["Quantity", "Item"] });

  const hiddenOnly = core.withHidden(undefined, "123:8", ["Location"]);
  assert.deepEqual(plain(hiddenOnly.orders["123:8"]), { hidden: ["Location"] });
  const dropped = core.withHidden(hiddenOnly, "123:8", []);
  assert.deepEqual(Object.keys(dropped.orders), []);

  assert.equal(core.withHidden(base, "__proto__", ["Item"]), null);
  assert.equal(core.withHidden(base, "123:7", ["x".repeat(201)]), null);
  assert.equal(core.withHidden({ schemaVersion: 4, orders: {} }, "123:7", ["Item"]), null);
});

test("withWidths stores clamped widths, merges with the entry and clears", () => {
  const core = createApi();
  const base = core.withOrder(undefined, "123:7", ["Item", "Rate"]);
  const withWidths = core.withWidths(base, "123:7", { Item: 250.6, Rate: 5, Amount: 5000 });
  assert.deepEqual(plain(withWidths.orders["123:7"]), {
    order: ["Item", "Rate"],
    widths: { Item: 251, Rate: 30, Amount: 1000 }
  });

  const cleared = core.withWidths(withWidths, "123:7", null);
  assert.deepEqual(plain(cleared.orders["123:7"]), { order: ["Item", "Rate"] });

  const widthsOnly = core.withWidths(undefined, "123:8", { Location: 120 });
  assert.deepEqual(plain(widthsOnly.orders["123:8"]), { widths: { Location: 120 } });
  assert.deepEqual(Object.keys(core.withWidths(widthsOnly, "123:8", {}).orders), []);

  const hostile = core.withWidths(undefined, "123:9", JSON.parse('{"__proto__":100,"Item":"wide","Rate":90}'));
  assert.deepEqual(plain(hostile.orders["123:9"]), { widths: { Rate: 90 } });
  assert.equal(core.withWidths(undefined, "123:9", { Item: "wide" }), null);
  assert.equal(core.withWidths({ schemaVersion: 4, orders: {} }, "123:7", { Item: 100 }), null);
});

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
  const hostile = core.withFilters(undefined, "123:7", JSON.parse(`{
    "__proto__": { "q": "x" },
    "Ok": { "anyOf": ["a", 7, ""], "q": "${"x".repeat(101)}" },
    "Bad": { "anyOf": [] }
  }`));
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

test("applyWidths freezes visible columns, honors stored widths and clears", () => {
  const core = createApi();
  const { table, header } = createSortableTable(["Item", "Rate", "Amount"], [["SKU", "$1", "$2"]]);
  header.cells[1].classList.toggle("suitemate-v3-so-columns-col-hidden", true);

  assert.equal(core.applyWidths(table, { Item: 200 }), true);
  assert.equal(header.cells[0].style.width, "200px");
  assert.equal(header.cells[1].style.width, undefined);
  assert.equal(header.cells[2].style.width, "80px");
  assert.equal(table.style.tableLayout, "fixed");
  assert.equal(table.style.width, "280px");

  assert.equal(core.applyWidths(table, null), true);
  assert.equal(header.cells[0].style.width, "");
  assert.equal(table.style.tableLayout, "");
  assert.equal(table.style.width, "");
  assert.equal(core.applyWidths(null, { Item: 100 }), false);
});

// A header whose BORDER-BOX rect is `delta` wider than the inline width that was
// set on it — which is what a real cell does, and what createSortableTable's flat
// `() => ({ width: 80 })` cannot express. delta 0 is the ideal (rect == style);
// delta 2 is this repo's own measured collapsed-border figure for the machine
// table (tests/edit-grid.test.mjs, "collapsed borders render ~2px over the style
// value"); delta 11 reproduces the View Mode observation that prompted this test,
// Committed 90px -> 101px on the apply after the one that froze it.
function createMeasuredTable(labels, natural, delta) {
  const cells = labels.map((label, index) => {
    const cell = {
      textContent: label,
      style: {},
      classList: { contains: () => false, toggle: () => {} },
      querySelector: () => null,
      getBoundingClientRect: () => ({
        width: cell.style.width ? Number.parseInt(cell.style.width, 10) + delta : natural[index]
      })
    };
    return cell;
  });
  const headerRow = { className: "uir-machine-headerrow", cells };
  return {
    style: {},
    cells,
    widths: () => cells.map((cell) => cell.style.width ?? ""),
    querySelector: (selector) =>
      (String(selector).includes("uir-machine-headerrow") ? headerRow : null)
  };
}

test("applyWidths re-measures unstored columns every call — DEFECT, pinned so it cannot resurface unnoticed", () => {
  // *** THIS TEST DOCUMENTS A DEFECT. IT IS NOT A CONTRACT. ***
  //
  // applyWidths freezes an unstored column at `cell.getBoundingClientRect().width`
  // and there is no record of what a previous apply froze — so the width it wrote
  // last time is the width it measures this time, PLUS whatever the border box
  // adds over the inline value. Every apply therefore grows every unstored column
  // by that delta. Stored columns are unaffected: they are read from the map.
  //
  // This is the same root-cause family as edit-grid's D1 (M2 Task 13): a value
  // that is re-derived from the rendering it produced. edit-grid closed it by
  // recording a frozen set on the FIRST apply and never re-measuring; so-columns
  // has no equivalent, so `columnWidths` holds only what the user stored.
  //
  // It is pinned rather than fixed because so-columns is a View Mode file and the
  // plan forbids modifying it. This test only READS it. ESCALATED to the owner —
  // when the fix is authorised, the delta-2 and delta-11 blocks below collapse
  // into the delta-0 one and this becomes the idempotence invariant it should be.
  const core = createApi();

  // The invariant that DOES hold today, at every delta: a STORED column is
  // byte-identical across applies, because it never consults the rendering.
  for (const delta of [0, 2, 11]) {
    const table = createMeasuredTable(["Item", "Committed", "Rate"], [120, 90, 100], delta);
    for (let round = 0; round < 4; round += 1) {
      assert.equal(core.applyWidths(table, { Item: 200 }), true);
      assert.equal(table.cells[0].style.width, "200px",
        `a stored column drifted at delta ${delta} on apply ${round + 1}`);
    }
  }

  // delta 0 — rect equals what was applied, so the re-measurement is a no-op and
  // the whole table is idempotent. This is the behaviour the fix must generalise.
  const ideal = createMeasuredTable(["Item", "Committed", "Rate"], [120, 90, 100], 0);
  core.applyWidths(ideal, { Item: 200 });
  const first = ideal.widths();
  core.applyWidths(ideal, { Item: 200 });
  assert.deepEqual(first, ["200px", "90px", "100px"]);
  assert.deepEqual(ideal.widths(), first, "even with rect == style the second apply moved a column");
  assert.equal(ideal.style.width, "390px");

  // delta 11 — the live shape. Committed goes 90 -> 101 -> 112 -> 123 and the
  // table grows with it. The first apply is correct; every one after it is not.
  const live = createMeasuredTable(["Item", "Committed", "Rate"], [120, 90, 100], 11);
  const seen = [];
  const totals = [];
  for (let round = 0; round < 4; round += 1) {
    core.applyWidths(live, { Item: 200 });
    seen.push(live.widths()[1]);
    totals.push(live.style.width);
  }
  assert.deepEqual(seen, ["90px", "101px", "112px", "123px"],
    "so-columns' unstored-column drift changed shape — re-check the escalation before editing this");
  assert.deepEqual(totals, ["390px", "412px", "434px", "456px"],
    "table.style.width compounds the same drift");
  // The stored column is the control: it did not move while the others walked.
  assert.equal(live.widths()[0], "200px");
});

test("applyWidths batches every layout read before the first width write", () => {
  // The 203x70 thrash: setColumnHidden runs applyHidden (geometry change) and
  // then applyWidths. Interleaved per-cell read-write means every width write
  // invalidates layout and the next getBoundingClientRect re-reflows the whole
  // machine — measured live at 11.5s for ONE hide on a 203-row, 70-column
  // order, ~69 full reflows. Batched (all reads, then all writes) the same
  // loop costs at most one reflow. This pins the batching: a read appearing
  // after the first write is the thrash coming back.
  const core = createApi();
  const events = [];
  const cells = ["Item", "Rate", "Amount", "Qty"].map((label) => {
    const cell = {
      textContent: label,
      classList: { contains: () => false, toggle: () => {} },
      querySelector: () => null,
      getBoundingClientRect: () => {
        events.push("read");
        return { width: 80 };
      },
      style: {}
    };
    Object.defineProperty(cell.style, "width", {
      get: () => cell.frozenWidth,
      set: (value) => {
        events.push("write");
        cell.frozenWidth = value;
      }
    });
    return cell;
  });
  const headerRow = { cells };
  const table = {
    style: {},
    querySelector: (selector) => (String(selector).includes("uir-machine-headerrow") ? headerRow : null)
  };
  assert.equal(core.applyWidths(table, { Item: 200 }), true);
  const lastRead = events.lastIndexOf("read");
  const firstWrite = events.indexOf("write");
  assert.ok(lastRead !== -1 && firstWrite !== -1, `expected both reads and writes, saw: ${events.join(",")}`);
  assert.ok(
    lastRead < firstWrite,
    `a layout read ran after a width write — the interleaved-reflow thrash is back: ${events.join(",")}`
  );
});

test("applyHidden hides matching columns in every aligned row and unhides", () => {
  const core = createApi();
  const { table, rows, trailingRows } = createSortableTable(
    ["Item", "Rate", "Amount"],
    [["SKU", "$1", "$2"], ["SKU2", "$3", "$4"]],
    [["Total", "$4"]]
  );
  const hiddenFlags = (row) => row.cells.map((cell) => cell.classList.contains("suitemate-v3-so-columns-col-hidden"));

  assert.equal(core.applyHidden(table, ["Rate"]), true);
  assert.deepEqual(hiddenFlags(rows[0]), [false, true, false]);
  assert.deepEqual(hiddenFlags(rows[1]), [false, true, false]);
  assert.deepEqual(hiddenFlags(trailingRows[0]), [false, false]);

  assert.equal(core.applyHidden(table, []), true);
  assert.deepEqual(hiddenFlags(rows[1]), [false, false, false]);
  assert.equal(core.applyHidden(null, ["Rate"]), false);
});

test("withOrder writes, deletes and preserves sibling scopes", () => {
  const core = createApi();
  const written = core.withOrder(undefined, "123:7", ["Item", "Quantity"]);
  assert.deepEqual(plain(written), { schemaVersion: 3, orders: { "123:7": { order: ["Item", "Quantity"] } } });

  const both = core.withOrder(written, "123:8", ["Amount", "Rate"]);
  assert.deepEqual(Object.keys(both.orders).sort(), ["123:7", "123:8"]);

  const deleted = core.withOrder(both, "123:7", null);
  assert.deepEqual(Object.keys(deleted.orders), ["123:8"]);

  assert.equal(core.withOrder(written, "123:7", ["Item", 9]), null);
  assert.equal(core.withOrder(written, "__proto__", ["Item"]), null);
  assert.equal(core.withOrder(written, "", ["Item"]), null);
});

test("withOrder refuses to rewrite a newer storage schema", () => {
  const core = createApi();
  const future = { schemaVersion: 4, orders: { "123:7": ["Item"] } };
  assert.equal(core.withOrder(future, "123:7", ["Item", "Quantity"]), null);
  assert.equal(core.withOrder(future, "123:7", null), null);
});

test("readCellLabel strips injected SuiteMate badge nodes", () => {
  const core = createApi();
  const badge = {
    removed: false,
    remove() {
      this.removed = true;
    }
  };
  const cell = {
    textContent: "Itemcustcol_field",
    cloneNode() {
      return {
        querySelectorAll(selector) {
          return selector.includes("data-suitemate-v3-internal-id") ? [badge] : [];
        },
        get textContent() {
          return badge.removed ? " Item " : "Itemcustcol_field";
        }
      };
    }
  };
  assert.equal(core.readCellLabel(cell), "Item");
  assert.equal(badge.removed, true);
  assert.equal(core.readCellLabel({ textContent: " Rate " }), "Rate");
  assert.equal(core.readCellLabel(null), "");
});

test("withOrder evicts sibling scopes when the payload would exceed the sync quota", () => {
  const core = createApi();
  const bigLabels = (prefix) => Array.from(
    { length: 15 },
    (_, index) => `${prefix} ${index} ${"x".repeat(180)}`
  );
  let stored = core.withOrder(undefined, "scope-a", bigLabels("Alpha"));
  stored = core.withOrder(stored, "scope-b", bigLabels("Beta"));
  assert.deepEqual(Object.keys(stored.orders).sort(), ["scope-a", "scope-b"]);

  stored = core.withOrder(stored, "scope-c", bigLabels("Gamma"));
  assert.deepEqual(Object.keys(stored.orders), ["scope-c"]);
  assert.equal(stored.schemaVersion, 3);
});

test("readHeaderLabels trims header-cell text and fails closed", () => {
  const core = createApi();
  const table = createTable([" Item ", "Description", "Quantity"]);
  assert.deepEqual(plain(core.readHeaderLabels(table)), ["Item", "Description", "Quantity"]);
  assert.deepEqual(plain(core.readHeaderLabels(null)), []);
  assert.deepEqual(plain(core.readHeaderLabels({ querySelector: () => null })), []);
});

test("captureNativeOrder stamps pristine order and survives reorders", () => {
  const core = createApi();
  const header = ["Item", "Description", "Quantity", "Rate", "Amount"];
  const table = createTable(header, [createRow(["SKU", "One", "2", "$1", "$2"])]);

  assert.deepEqual(plain(core.captureNativeOrder(table)), header);
  assert.equal(table.rows[0].cells[0].getAttribute(core.NATIVE_INDEX_ATTRIBUTE), "0");

  assert.equal(core.applyOrder(table, ["Amount", "Item", "Description", "Quantity", "Rate"]), true);
  assert.deepEqual(rowLabels(table.rows[0]), ["Amount", "Item", "Description", "Quantity", "Rate"]);
  assert.deepEqual(plain(core.captureNativeOrder(table)), header);

  assert.equal(core.applyOrder(table, core.captureNativeOrder(table)), true);
  assert.deepEqual(rowLabels(table.rows[0]), header);

  const bare = {
    querySelector: () => ({ cells: [{ textContent: " Item " }, { textContent: "Rate" }] })
  };
  assert.deepEqual(plain(core.captureNativeOrder(bare)), ["Item", "Rate"]);
});

test("applyOrder reorders every aligned row and skips colspan rows", () => {
  const core = createApi();
  const header = ["Item", "Description", "Quantity", "Rate", "Amount"];
  const rowOne = createRow(["SKU-1001", "Sample product one", "2", "$18.00", "$36.00"]);
  const rowTwo = createRow(["SKU-2004", "Sample product two", "1", "$24.00", "$24.00"]);
  const summary = createRow(["Total", "$60.00"], "uir-machine-summaryrow");
  const table = createTable(header, [rowOne, rowTwo, summary]);

  const target = core.planOrder(core.readHeaderLabels(table), ["Quantity", "Item"]);
  assert.equal(core.applyOrder(table, target), true);
  assert.deepEqual(rowLabels(table.rows[0]), ["Quantity", "Description", "Item", "Rate", "Amount"]);
  assert.deepEqual(rowLabels(rowOne), ["2", "Sample product one", "SKU-1001", "$18.00", "$36.00"]);
  assert.deepEqual(rowLabels(rowTwo), ["1", "Sample product two", "SKU-2004", "$24.00", "$24.00"]);
  assert.deepEqual(rowLabels(summary), ["Total", "$60.00"]);

  assert.equal(core.applyOrder(table, target), true);
  assert.deepEqual(rowLabels(table.rows[0]), ["Quantity", "Description", "Item", "Rate", "Amount"]);
  assert.deepEqual(rowLabels(rowOne), ["2", "Sample product one", "SKU-1001", "$18.00", "$36.00"]);

  assert.equal(core.applyOrder(table, header), true);
  assert.deepEqual(rowLabels(table.rows[0]), header);
  assert.deepEqual(rowLabels(rowOne), ["SKU-1001", "Sample product one", "2", "$18.00", "$36.00"]);
});

test("applyOrder fails closed without mutating on mismatched targets", () => {
  const core = createApi();
  const table = createTable(["Item", "Quantity"], [createRow(["SKU", "2"])]);
  assert.equal(core.applyOrder(table, ["Item", "Missing"]), false);
  assert.equal(core.applyOrder(table, ["Item"]), false);
  assert.equal(core.applyOrder(table, ["Item", "Quantity", "Extra"]), false);
  assert.equal(core.applyOrder(null, ["Item", "Quantity"]), false);
  assert.equal(
    core.applyOrder({ querySelector() { throw new Error("boom"); } }, ["Item", "Quantity"]),
    false
  );
  assert.deepEqual(rowLabels(table.rows[0]), ["Item", "Quantity"]);
  assert.deepEqual(rowLabels(table.rows[1]), ["SKU", "2"]);
});

function createSortableTable(headerLabels, dataRowsValues, trailing = [], rowClass = "uir-machine-row") {
  const rows = [];
  const parent = {
    insertBefore(row, anchor) {
      rows.splice(rows.indexOf(row), 1);
      const to = anchor ? rows.indexOf(anchor) : rows.length;
      rows.splice(to, 0, row);
    }
  };
  const makeRow = (labels, className) => {
    const attrs = {};
    const classes = new Set();
    const row = {
      className,
      parentNode: parent,
      cells: labels.map((label) => {
        const cellClasses = new Set();
        return {
          textContent: label,
          style: {},
          getBoundingClientRect: () => ({ width: 80 }),
          classList: {
            toggle: (name, force) => { if (force) { cellClasses.add(name); } else { cellClasses.delete(name); } },
            contains: (name) => cellClasses.has(name)
          }
        };
      }),
      getAttribute: (name) => (name in attrs ? attrs[name] : null),
      setAttribute: (name, value) => { attrs[name] = String(value); },
      classList: {
        toggle: (name, force) => { if (force) { classes.add(name); } else { classes.delete(name); } },
        contains: (name) => classes.has(name),
        remove: (name) => classes.delete(name)
      }
    };
    Object.defineProperty(row, "nextSibling", {
      get() {
        const index = rows.indexOf(row);
        return rows[index + 1] ?? null;
      }
    });
    rows.push(row);
    return row;
  };
  const header = makeRow(headerLabels, "uir-machine-headerrow");
  const dataRows = dataRowsValues.map((values) => makeRow(values, rowClass));
  const trailingRows = trailing.map((values) => makeRow(values, "uir-machine-summaryrow"));
  return {
    table: {
      rows,
      style: {},
      querySelector: (selector) => (selector.includes("uir-machine-headerrow") ? header : null)
    },
    rows,
    header,
    dataRows,
    trailingRows
  };
}

test("detectColumnKind and parseSortValue handle text, currency and dates", () => {
  const core = createApi();
  assert.equal(core.detectColumnKind(["$18.00", "$4.50", "$1,234.00"]), "number");
  assert.equal(core.detectColumnKind(["13/07/2026", "1/12/2025", "09/01/2026"]), "date");
  assert.equal(core.detectColumnKind(["SKU-1", "SKU-2", ""]), "text");
  assert.equal(core.parseSortValue("$1,234.50", "number").value, 1234.5);
  assert.equal(core.parseSortValue("13/07/2026", "date").value, 20260713);
  assert.equal(core.parseSortValue("2/1/26", "date").value, 20260102);
  assert.equal(core.parseSortValue("", "text").empty, true);
  assert.equal(core.parseSortValue("n/a", "number").empty, true);
});

test("sortRows sorts asc, desc and native with empties last and summary anchored", () => {
  const core = createApi();
  const { table, rows, trailingRows } = createSortableTable(
    ["Item", "Amount"],
    [["B", "$500.00"], ["A", "$100.00"], ["C", ""], ["D", "$50.00"]],
    [["Total", "$650.00"]]
  );
  const amounts = () => rows.slice(1).map((row) => row.cells[1].textContent);

  assert.equal(core.sortRows(table, 1, "asc"), true);
  assert.deepEqual(amounts(), ["$50.00", "$100.00", "$500.00", "", "$650.00"]);

  assert.equal(core.sortRows(table, 1, "desc"), true);
  assert.deepEqual(amounts(), ["$500.00", "$100.00", "$50.00", "", "$650.00"]);
  assert.equal(rows[rows.length - 1], trailingRows[0]);

  assert.equal(core.sortRows(table, 0, "asc"), true);
  assert.deepEqual(rows.slice(1, 5).map((row) => row.cells[0].textContent), ["A", "B", "C", "D"]);

  assert.equal(core.sortRows(table, 0, "native"), true);
  assert.deepEqual(rows.slice(1, 5).map((row) => row.cells[0].textContent), ["B", "A", "C", "D"]);
});

test("sortRows fails closed on non-contiguous rows and invalid input", () => {
  const core = createApi();
  const broken = createSortableTable(["Item", "Qty"], [["A", "1"], ["B", "2"]]);
  broken.rows.splice(2, 0, { className: "uir-machine-expansion", cells: [{ textContent: "detail" }] });
  assert.equal(core.sortRows(broken.table, 1, "asc"), false);

  const ok = createSortableTable(["A", "B"], [["1", "2"], ["3", "4"]]);
  assert.equal(core.sortRows(ok.table, 9, "asc"), false);
  assert.equal(core.sortRows(ok.table, 0, "sideways"), false);
  assert.equal(core.sortRows(null, 0, "asc"), false);
  assert.deepEqual(ok.rows[1].cells.map((c) => c.textContent), ["1", "2"]);
});

test("parseFilterQuery and matchesFilter cover text and numeric operators", () => {
  const core = createApi();
  assert.equal(core.parseFilterQuery(""), null);
  assert.equal(core.parseFilterQuery("   "), null);
  assert.deepEqual(plain(core.parseFilterQuery("SKU001")), { op: "contains", value: "sku001" });
  assert.deepEqual(plain(core.parseFilterQuery(">100")), { op: ">", value: 100 });
  assert.deepEqual(plain(core.parseFilterQuery(">= $1,500")), { op: ">=", value: 1500 });
  assert.deepEqual(plain(core.parseFilterQuery("> abc")), { op: "contains", value: "> abc" });

  assert.equal(core.matchesFilter("SKU001-Blue", core.parseFilterQuery("sku001")), true);
  assert.equal(core.matchesFilter("Sydney", core.parseFilterQuery("melb")), false);
  assert.equal(core.matchesFilter("$500.00", core.parseFilterQuery(">100")), true);
  assert.equal(core.matchesFilter("$50.00", core.parseFilterQuery(">100")), false);
  assert.equal(core.matchesFilter("$100.00", core.parseFilterQuery(">=100")), true);
  assert.equal(core.matchesFilter("no-number", core.parseFilterQuery(">100")), false);
  assert.equal(core.matchesFilter("anything", null), true);
});

test("matchesFilter supports multi-select anyOf within a column", () => {
  const core = createApi();
  assert.equal(core.matchesFilter("Sydney", { anyOf: ["Sydney", "Melbourne"] }), true);
  assert.equal(core.matchesFilter("Melbourne", { anyOf: ["Sydney", "Melbourne"] }), true);
  assert.equal(core.matchesFilter("Brisbane", { anyOf: ["Sydney", "Melbourne"] }), false);
  assert.equal(core.matchesFilter("Sydney", { anyOf: [] }), true);
  assert.equal(core.matchesFilter("$500.00", { op: ">", value: 100, anyOf: ["$500.00"] }), true);
  assert.equal(core.matchesFilter("$500.00", { op: ">", value: 1000, anyOf: ["$500.00"] }), false);
  assert.equal(core.matchesFilter("$50.00", { op: ">", value: 10, anyOf: ["$500.00"] }), false);
});

test("applyFilters ORs multi-select values within a column, ANDs across columns", () => {
  const core = createApi();
  const { table, dataRows } = createSortableTable(
    ["Item", "Location"],
    [["SKU001", "Sydney"], ["SKU002", "Melbourne"], ["SKU003", "Brisbane"]]
  );
  const hidden = () => dataRows.map((row) => row.classList.contains("suitemate-v3-so-columns-filtered"));

  assert.equal(core.applyFilters(table, [null, { anyOf: ["Sydney", "Melbourne"] }]), true);
  assert.deepEqual(hidden(), [false, false, true]);

  assert.equal(core.applyFilters(table, [{ op: "contains", value: "sku001" }, { anyOf: ["Sydney", "Melbourne"] }]), true);
  assert.deepEqual(hidden(), [false, true, true]);

  assert.equal(core.applyFilters(table, [{ anyOf: ["SKU001", "SKU002", "SKU003"] }, null]), true);
  assert.deepEqual(hidden(), [false, false, false]);
});

test("applyFilters hides non-matching rows, AND-combines and unhides", () => {
  const core = createApi();
  const { table, dataRows, trailingRows } = createSortableTable(
    ["Item", "Location", "Amount"],
    [["SKU001", "Sydney", "$500.00"], ["SKU002", "Sydney", "$50.00"], ["SKU001-B", "Melbourne", "$150.00"]],
    [["Total", "", "$700.00"]]
  );
  const hidden = () => dataRows.map((row) => row.classList.contains("suitemate-v3-so-columns-filtered"));

  assert.equal(core.applyFilters(table, [core.parseFilterQuery("SKU001"), null, null]), true);
  assert.deepEqual(hidden(), [false, true, false]);

  assert.equal(core.applyFilters(table, [core.parseFilterQuery("SKU001"), core.parseFilterQuery("sydney"), core.parseFilterQuery(">100")]), true);
  assert.deepEqual(hidden(), [false, true, true]);

  assert.equal(core.applyFilters(table, [null, null, null]), true);
  assert.deepEqual(hidden(), [false, false, false]);
  assert.equal(trailingRows[0].classList.contains("suitemate-v3-so-columns-filtered"), false);
  assert.equal(core.applyFilters(null, []), false);
});

test("distinctColumnValues lists unique values and respects the cap", () => {
  const core = createApi();
  const { table } = createSortableTable(
    ["Location"],
    [["Sydney"], ["Melbourne"], ["Sydney"], [""]]
  );
  assert.deepEqual(plain(core.distinctColumnValues(table, 0, 20)), ["Melbourne", "Sydney"]);
  assert.deepEqual(plain(core.distinctColumnValues(table, 0, 1)), []);
  assert.deepEqual(plain(core.distinctColumnValues(null, 0, 5)), []);
});

test("list-style rows (Item Fulfillment) sort, filter, hide and list values", () => {
  const core = createApi();
  const { table, rows, dataRows } = createSortableTable(
    ["Item", "Location"],
    [["MCW200", "Sydney"], ["MCW100", "Melbourne"], ["ABC300", "Sydney"]],
    [],
    "uir-list-row-tr uir-list-row-odd"
  );
  assert.deepEqual(plain(core.distinctColumnValues(table, 1, 20)), ["Melbourne", "Sydney"]);

  assert.equal(core.applyFilters(table, [null, { anyOf: ["Sydney"] }]), true);
  assert.deepEqual(dataRows.map((row) => row.classList.contains("suitemate-v3-so-columns-filtered")), [false, true, false]);
  core.applyFilters(table, [null, null]);

  assert.equal(core.sortRows(table, 0, "asc"), true);
  assert.deepEqual(rows.slice(1).map((row) => row.cells[0].textContent), ["ABC300", "MCW100", "MCW200"]);

  assert.equal(core.applyHidden(table, ["Location"]), true);
  assert.equal(dataRows[0].cells[1].classList.contains("suitemate-v3-so-columns-col-hidden"), true);
});

test("core has no DOM, storage, bridge or network authority", () => {
  assert.doesNotMatch(source, /document\.|chrome\.|fetch\(|XMLHttpRequest|innerHTML|localStorage|sessionStorage/);
});
