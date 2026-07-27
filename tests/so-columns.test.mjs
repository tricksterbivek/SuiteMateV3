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
    cells: labels.map((label) => ({ textContent: label })),
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
  assert.equal(core.STORAGE_SCHEMA_VERSION, 1);
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

test("normalizeStored rejects garbage, wrong versions and hostile keys", () => {
  const core = createApi();
  const empty = { schemaVersion: 1, orders: {} };
  for (const value of [
    null,
    undefined,
    "orders",
    12,
    ["Item"],
    { schemaVersion: 2, orders: { a: ["Item"] } },
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
  assert.deepEqual(plain(normalized.orders.safe), ["Item", "Quantity"]);

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

test("withOrder writes, deletes and preserves sibling scopes", () => {
  const core = createApi();
  const written = core.withOrder(undefined, "123:7", ["Item", "Quantity"]);
  assert.deepEqual(plain(written), { schemaVersion: 1, orders: { "123:7": ["Item", "Quantity"] } });

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
  const future = { schemaVersion: 2, orders: { "123:7": ["Item"] } };
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
  assert.equal(stored.schemaVersion, 1);
});

test("readHeaderLabels trims header-cell text and fails closed", () => {
  const core = createApi();
  const table = createTable([" Item ", "Description", "Quantity"]);
  assert.deepEqual(plain(core.readHeaderLabels(table)), ["Item", "Description", "Quantity"]);
  assert.deepEqual(plain(core.readHeaderLabels(null)), []);
  assert.deepEqual(plain(core.readHeaderLabels({ querySelector: () => null })), []);
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

test("core has no DOM, storage, bridge or network authority", () => {
  assert.doesNotMatch(source, /document\.|chrome\.|fetch\(|XMLHttpRequest|innerHTML|localStorage|sessionStorage/);
});
