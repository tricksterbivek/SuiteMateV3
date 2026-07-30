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
  assert.equal(core.VERSION, 1);
  assert.equal(core.STORAGE_KEY, "suiteMateV3FormViews");
  assert.equal(core.STORAGE_SCHEMA_VERSION, 1);
  assert.equal(Object.isFrozen(core), true);
  assert.equal(Object.isFrozen(core.CLASSES), true);
});

test("withHiddenFields stores, dedupes, lowercases, clears and fails closed", () => {
  const core = createApi();
  const stored = core.withHiddenFields(undefined, "123:7:salesord", ["Memo", "custbody_route", "memo"]);
  assert.deepEqual(plain(stored), {
    schemaVersion: 1,
    views: { "123:7:salesord": { hiddenFields: ["memo", "custbody_route"] } }
  });
  const cleared = core.withHiddenFields(stored, "123:7:salesord", []);
  assert.deepEqual(plain(cleared.views), {});
  assert.equal(core.withHiddenFields(undefined, "123:7:salesord", ["bad name with spaces"]), null);
  assert.equal(core.withHiddenFields(undefined, "123:7:salesord", [""]), null);
  assert.equal(core.withHiddenFields(undefined, "__proto__", ["memo"]), null);
  assert.equal(core.withHiddenFields({ schemaVersion: 2, views: {} }, "123:7:salesord", ["memo"]), null);
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
  const empty = { schemaVersion: 1, views: {} };
  for (const value of [null, "views", 9, { schemaVersion: 2, views: { a: { hiddenFields: ["x"] } } }, { views: {} }]) {
    assert.deepEqual(plain(core.normalizeStored(value)), empty);
  }
  const hostile = JSON.parse(
    '{"schemaVersion":1,"views":{"__proto__":{"hiddenFields":["memo"]},"":{"hiddenFields":["memo"]},"ok:1:salesord":{"hiddenFields":["memo"],"junk":true}}}'
  );
  assert.deepEqual(plain(core.normalizeStored(hostile)), {
    schemaVersion: 1,
    views: { "ok:1:salesord": { hiddenFields: ["memo"] } }
  });
});

test("quota eviction keeps only the entry being written", () => {
  const core = createApi();
  const fat = (prefix) => Array.from({ length: 90 }, (_, index) => `${prefix}_${index}_${"x".repeat(70)}`);
  let stored = core.withHiddenFields(undefined, "scope-a", fat("aaa"));
  stored = core.withHiddenFields(stored, "scope-b", fat("bbb"));
  assert.deepEqual(Object.keys(plain(stored.views)), ["scope-b"]);
  assert.equal(stored.schemaVersion, 1);
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
