import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "src/form-views/core.js"), "utf8");

function createApi() {
  const sandbox = { TextEncoder };
  sandbox.globalThis = sandbox;
  runInNewContext(source, sandbox);
  return sandbox.SuiteMateV3FormViewsCore;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("exports a frozen versioned form-views core", () => {
  const core = createApi();
  assert.equal(core.VERSION, 2);
  assert.equal(core.STORAGE_KEY, "suiteMateV3FormViews");
  assert.equal(core.STORAGE_SCHEMA_VERSION, 2);
  assert.equal(Object.isFrozen(core), true);
  assert.equal(Object.isFrozen(core.CLASSES), true);
});

test("withHiddenFields stores, dedupes, lowercases, clears and fails closed", () => {
  const core = createApi();
  const stored = core.withHiddenFields(undefined, "123:7:salesord", ["Memo", "custbody_route", "memo"]);
  assert.deepEqual(plain(stored), {
    schemaVersion: 2,
    views: { "123:7:salesord": { hiddenFields: ["memo", "custbody_route"] } }
  });
  const cleared = core.withHiddenFields(stored, "123:7:salesord", []);
  assert.deepEqual(plain(cleared.views), {});
  assert.equal(core.withHiddenFields(undefined, "123:7:salesord", ["bad name with spaces"]), null);
  assert.equal(core.withHiddenFields(undefined, "123:7:salesord", [""]), null);
  assert.equal(core.withHiddenFields(undefined, "__proto__", ["memo"]), null);
  assert.equal(core.withHiddenFields({ schemaVersion: 3, views: {} }, "123:7:salesord", ["memo"]), null);
});

test("withCollapsedSections trims, dedupes and coexists with hidden fields", () => {
  const core = createApi();
  let stored = core.withHiddenFields(undefined, "123:7:salesord", ["memo"]);
  stored = core.withCollapsedSections(stored, "123:7:salesord", [" Primary Information ", "Primary Information", "Classification"]);
  assert.deepEqual(plain(stored.views["123:7:salesord"]), {
    hiddenFields: ["memo"],
    collapsedSections: ["Primary Information", "Classification"]
  });
  stored = core.withHiddenFields(stored, "123:7:salesord", null);
  assert.deepEqual(plain(stored.views["123:7:salesord"]), {
    collapsedSections: ["Primary Information", "Classification"]
  });
  stored = core.withCollapsedSections(stored, "123:7:salesord", []);
  assert.deepEqual(plain(stored.views), {});
  assert.equal(core.withCollapsedSections(undefined, "123:7:salesord", [7]), null);
  assert.equal(core.withCollapsedSections(undefined, "123:7:salesord", ["   "]), null);
});

test("normalizeStored rejects garbage, newer schema and hostile keys", () => {
  const core = createApi();
  const empty = { schemaVersion: 2, views: {} };
  for (const value of [null, "views", 9, { schemaVersion: 3, views: { a: { hiddenFields: ["x"] } } }, { views: {} }]) {
    assert.deepEqual(plain(core.normalizeStored(value)), empty);
  }
  const hostile = JSON.parse(
    '{"schemaVersion":1,"views":{"__proto__":{"hiddenFields":["memo"]},"":{"hiddenFields":["memo"]},"ok:1:salesord":{"hiddenFields":["memo"],"junk":true}}}'
  );
  assert.deepEqual(plain(core.normalizeStored(hostile)), {
    schemaVersion: 2,
    views: { "ok:1:salesord": { hiddenFields: ["memo"] } }
  });
});

test("quota eviction keeps only the entry being written", () => {
  const core = createApi();
  const fat = (prefix) => Array.from({ length: 90 }, (_, index) => `${prefix}_${index}_${"x".repeat(70)}`);
  let stored = core.withHiddenFields(undefined, "scope-a", fat("aaa"));
  stored = core.withHiddenFields(stored, "scope-b", fat("bbb"));
  assert.deepEqual(Object.keys(plain(stored.views)), ["scope-b"]);
  assert.equal(stored.schemaVersion, 2);
});

test("withSectionOrder stores, merges, clears and fails closed", () => {
  const core = createApi();
  let stored = core.withHiddenFields(undefined, "123:7:salesord", ["memo"]);
  stored = core.withSectionOrder(stored, "123:7:salesord", ["Sales Information", " Primary Information ", "Sales Information"]);
  assert.deepEqual(plain(stored.views["123:7:salesord"]), {
    hiddenFields: ["memo"],
    sectionOrder: ["Sales Information", "Primary Information"]
  });
  stored = core.withHiddenFields(stored, "123:7:salesord", null);
  // entryIsEmpty regression: an order-only entry must survive unrelated clears
  assert.deepEqual(plain(stored.views["123:7:salesord"]), {
    sectionOrder: ["Sales Information", "Primary Information"]
  });
  stored = core.withSectionOrder(stored, "123:7:salesord", null);
  assert.deepEqual(plain(stored.views), {});
  assert.equal(core.withSectionOrder(undefined, "123:7:salesord", [7]), null);
  assert.equal(core.withSectionOrder({ schemaVersion: 3, views: {} }, "123:7:salesord", ["A"]), null);
});

test("withFieldOrder stores per-section lists, skips bad keys, clears on empty object", () => {
  const core = createApi();
  let stored = core.withFieldOrder(undefined, "123:7:salesord", {
    "Primary Information": ["TRANID", "entity", "tranid"],
    "__proto__": ["memo"],
    "": ["memo"],
    "Bad Values": ["not a field name!"]
  });
  assert.deepEqual(plain(stored.views["123:7:salesord"]), {
    fieldOrder: { "Primary Information": ["tranid", "entity"] }
  });
  assert.equal(core.withFieldOrder(undefined, "123:7:salesord", { "": ["x y"] }), null);
  stored = core.withFieldOrder(stored, "123:7:salesord", {});
  assert.deepEqual(plain(stored.views), {});
  assert.equal(core.withFieldOrder(undefined, "123:7:salesord", "junk"), null);
});

test("v1 stored data reads through schema v2 unchanged", () => {
  const core = createApi();
  const v1 = { schemaVersion: 1, views: { "ok:1:salesord": { hiddenFields: ["memo"] } } };
  assert.deepEqual(plain(core.normalizeStored(v1)), {
    schemaVersion: 2,
    views: { "ok:1:salesord": { hiddenFields: ["memo"] } }
  });
});

test("normalizeStored keeps order keys and drops hostile order shapes", () => {
  const core = createApi();
  const stored = {
    schemaVersion: 2,
    views: {
      "ok:1:salesord": {
        sectionOrder: ["B", "A"],
        fieldOrder: { "B": ["memo"] },
        junk: true
      },
      "bad:1:salesord": { sectionOrder: "nope", fieldOrder: [] }
    }
  };
  assert.deepEqual(plain(core.normalizeStored(stored)), {
    schemaVersion: 2,
    views: { "ok:1:salesord": { sectionOrder: ["B", "A"], fieldOrder: { "B": ["memo"] } } }
  });
});

test("evictOverQuota fails loudly when the written entry alone exceeds quota", () => {
  const core = createApi();
  const fat = Array.from({ length: 199 }, (_, i) => `f_${i}_${"x".repeat(60)}`);
  assert.equal(core.withHiddenFields(undefined, "scope-a", fat), null);
});

test("fieldKey prefers data-field-name and falls back to the walkthrough hook", () => {
  const core = createApi();
  const attrs = (map) => ({ getAttribute: (name) => map[name] ?? null });
  assert.equal(core.fieldKey(attrs({ "data-field-name": "Subtotal" })), "subtotal");
  assert.equal(core.fieldKey(attrs({ "data-walkthrough": "Field:custbody_route" })), "custbody_route");
  assert.equal(core.fieldKey(attrs({ "data-field-name": "bad name", "data-walkthrough": "Field:ok_name" })), "ok_name");
  assert.equal(core.fieldKey(attrs({ "data-walkthrough": "Sublist:item" })), "");
  assert.equal(core.fieldKey(null), "");
});

test("sectionKey clone-strips injected nodes and collapses whitespace", () => {
  const core = createApi();
  const badge = { removed: false, remove() { this.removed = true; } };
  const node = {
    cloneNode: () => ({
      querySelectorAll: (selector) => (selector.includes("data-suitemate-v3") ? [badge] : []),
      get textContent() {
        return badge.removed ? "  Primary   Information " : "Primary   InformationBADGE";
      }
    })
  };
  assert.equal(core.sectionKey(node), "Primary Information");
  assert.equal(core.sectionKey(null), "");
});

test("applyFieldVisibility toggles the hide class from the stored set", () => {
  const core = createApi();
  const wrapper = (name) => {
    const classes = new Set();
    return {
      getAttribute: (attr) => (attr === "data-field-name" ? name : null),
      classList: {
        toggle: (cls, on) => { if (on) { classes.add(cls); } else { classes.delete(cls); } },
        contains: (cls) => classes.has(cls)
      },
      classes
    };
  };
  const memo = wrapper("memo");
  const status = wrapper("status");
  const anonymous = wrapper(null);
  const hiddenCount = core.applyFieldVisibility([memo, status, anonymous], new Set(["memo"]));
  assert.equal(hiddenCount, 1);
  assert.equal(memo.classList.contains(core.CLASSES.hiddenField), true);
  assert.equal(status.classList.contains(core.CLASSES.hiddenField), false);
  const cleared = core.applyFieldVisibility([memo, status], new Set());
  assert.equal(cleared, 0);
  assert.equal(memo.classList.contains(core.CLASSES.hiddenField), false);
});
