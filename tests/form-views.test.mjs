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

test("planOrder matches so-columns semantics for section and field lists", () => {
  const core = createApi();
  // Matched saved labels fill the matched natives' POSITIONS in saved order;
  // unmatched natives (B) keep their slots.
  assert.deepEqual(core.planOrder(["A", "B", "C"], ["C", "A"]), ["C", "B", "A"]);
  assert.deepEqual(core.planOrder(["A", "B", "C"], []), ["A", "B", "C"]);
  assert.deepEqual(core.planOrder(["A", "B", "C"], ["Z", "B"]), ["A", "B", "C"]);
  assert.deepEqual(core.planOrder(["A", "B", "A"], ["A", "B"]), ["A", "B", "A"]);
  assert.deepEqual(core.planOrder(["A", "B", "C"], ["B", "B", "A"]), ["B", "A", "C"]);
});

test("moveLabel splices one label next to another and fails closed", () => {
  const core = createApi();
  assert.deepEqual(core.moveLabel(["A", "B", "C"], "A", "C"), ["B", "C", "A"]);
  assert.deepEqual(core.moveLabel(["A", "B", "C"], "C", "A"), ["C", "A", "B"]);
  assert.equal(core.moveLabel(["A", "B"], "A", "A"), null);
  assert.equal(core.moveLabel(["A", "B"], "Z", "A"), null);
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

// ===== Stub DOM harness for the section/field topology helpers =====
function stubMatches(node, selector) {
  if (selector.startsWith("[")) {
    const parsed = selector.match(/^\[([\w-]+)(?:\^="([^"]*)")?\]$/);
    if (!parsed) {
      return false;
    }
    const value = node.attributes?.[parsed[1]];
    return parsed[2] === undefined ? value != null : typeof value === "string" && value.startsWith(parsed[2]);
  }
  const [tagPart, ...classes] = selector.split(".");
  if (tagPart && node.tagName !== tagPart.toUpperCase()) {
    return false;
  }
  return classes.every((cls) => String(node.className ?? "").split(/\s+/).includes(cls));
}

function el(tag, props = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(),
    className: props.cls ?? "",
    colSpan: props.colspan ?? 1,
    text: props.text ?? "",
    attributes: { ...(props.attrs ?? {}) },
    children: [],
    parentElement: null,
    appendCount: 0,
    nodeType: 1,
    get textContent() {
      return this.text + this.children.map((child) => child.textContent).join("");
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    matches(selector) {
      return stubMatches(this, selector);
    },
    closest(selector) {
      let current = this;
      while (current) {
        if (stubMatches(current, selector)) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    },
    appendChild(child) {
      this.appendCount += 1;
      const from = child.parentElement;
      if (from) {
        from.children.splice(from.children.indexOf(child), 1);
      }
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    cloneNode() {
      return { textContent: this.textContent, querySelectorAll: () => [] };
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      if (selector.startsWith(":scope")) {
        let level = [this];
        for (const part of selector.split(" > ").slice(1)) {
          level = level.flatMap((parent) => parent.children.filter((child) => stubMatches(child, part)));
        }
        return level;
      }
      const out = [];
      const walk = (parent) => {
        for (const child of parent.children) {
          if (stubMatches(child, selector)) {
            out.push(child);
          }
          walk(child);
        }
      };
      walk(this);
      return out;
    }
  };
  for (const child of children) {
    child.parentElement = node;
    node.children.push(child);
  }
  return node;
}

function totalAppends(root) {
  let sum = root.appendCount;
  const walk = (parent) => {
    for (const child of parent.children) {
      sum += child.appendCount;
      walk(child);
    }
  };
  walk(root);
  return sum;
}

function stubWrapper(name) {
  return el("div", { cls: "uir-field-wrapper", attrs: { "data-field-name": name, "data-walkthrough": `Field:${name}` }, text: name });
}

function stubFieldRow(wrappers) {
  return el("tr", { cls: "uir-field-wrapper-cell" }, [el("td", {}, wrappers)]);
}

function stubColumn(rows) {
  return el("table", { cls: "table_fields" }, [el("tbody", {}, rows)]);
}

function stubGroup(title, columns, { collapsible = false } = {}) {
  return el("table", {}, [el("tbody", {}, [
    el("tr", {}, [el("td", { cls: `fgroup_title uir-field-group${collapsible ? " uir-field-group--collapsible" : ""}`, colspan: 3 }, [
      el("div", { cls: "fgroup_title uir-field-group-title", text: title })
    ])]),
    el("tr", { cls: "uir-fieldgroup-content uir-field-group-content" }, columns.map((column) => el("td", {}, [column])))
  ])]);
}

function buildFormStub({ duplicateTitle = false, unkeyedRowInColumn = -1 } = {}) {
  const primaryRows = [
    stubFieldRow([stubWrapper("tranid"), stubWrapper("custbody_issue")]),
    stubFieldRow([stubWrapper("entity")])
  ];
  if (unkeyedRowInColumn === 1) {
    primaryRows.push(stubFieldRow([])); // wrapper-less row makes the column unkeyable
  }
  const primaryColumn1 = stubColumn(primaryRows);
  const primaryColumn2 = stubColumn([
    stubFieldRow([stubWrapper("trandate")]),
    stubFieldRow([stubWrapper("otherrefnum")])
  ]);
  const layoutA = el("table", {}, [el("tbody", {}, [
    el("tr", {}, [el("td", { colspan: 3 }, [stubGroup("Primary Information", [primaryColumn1, primaryColumn2], { collapsible: true })])]),
    el("tr", {}, [el("td", { colspan: 3 }, [stubGroup(duplicateTitle ? "Primary Information" : "Classification", [
      stubColumn([stubFieldRow([stubWrapper("subsidiary")]), stubFieldRow([stubWrapper("location")])])
    ], { collapsible: true })])]),
    el("tr", {}, [el("td", { cls: "uir-table-fields-wrapper", colspan: 1 }, [stubWrapper("memo")])])
  ])]);
  const layoutB = el("table", {}, [el("tbody", {}, [
    el("tr", {}, [
      el("td", { colspan: 1 }, [stubGroup("Billing Information", [stubColumn([stubFieldRow([stubWrapper("terms")])])])]),
      el("td", { colspan: 1 }, [stubGroup("Billing Address", [stubColumn([stubFieldRow([stubWrapper("billaddress")])])])]),
      el("td", { colspan: 1 }, [el("table", {}, [el("tbody", {}, [])])])
    ]),
    el("tr", {}, [el("td", { colspan: 3 }, [stubGroup("Ship Central", [stubColumn([stubFieldRow([stubWrapper("custbody_third_party")])])])])])
  ])]);
  const root = el("body", {}, [layoutA, layoutB]);
  const keyApi = createApi();
  const columnKeys = (groupTable) =>
    [...groupTable.querySelectorAll(":scope > tbody > tr.uir-fieldgroup-content > td > table.table_fields")]
      .map((column) => column.querySelectorAll(":scope > tbody > tr")
        .map((row) => keyApi.fieldKey(row.querySelector('[data-walkthrough^="Field:"]'))));
  return { root, columnKeys };
}

test("sectionSlots finds slots, skips ungrouped wrappers, partitions by table and class", () => {
  const core = createApi();
  const { root } = buildFormStub();
  const slots = core.sectionSlots(root);
  assert.deepEqual(plain(slots.map((slot) => core.sectionTitleKey(slot.title))),
    ["Primary Information", "Classification", "Billing Information", "Billing Address", "Ship Central"]);
  const partitions = core.sectionPartitions(root).map((partition) => plain(partition.map((slot) => core.sectionTitleKey(slot.title))));
  assert.deepEqual(plain(partitions), [
    ["Primary Information", "Classification"],
    ["Billing Information", "Billing Address"],
    ["Ship Central"]
  ]);
});

test("applySectionOrder stamps natives, permutes within class, and is identity-stable", () => {
  const core = createApi();
  const { root } = buildFormStub();
  assert.equal(core.applySectionOrder(root, null), true);
  assert.equal(totalAppends(root), 0);
  // planOrder only permutes among labels present in the saved list, so a pair
  // swap needs BOTH members saved — this mirrors real saves (full flat list).
  assert.equal(core.applySectionOrder(root, ["Classification", "Primary Information", "Billing Address", "Billing Information"]), true);
  assert.deepEqual(plain(core.sectionSlots(root).map((slot) => core.sectionTitleKey(slot.title))),
    ["Classification", "Primary Information", "Billing Address", "Billing Information", "Ship Central"]);
  const before = totalAppends(root);
  core.applySectionOrder(root, ["Classification", "Primary Information", "Billing Address", "Billing Information"]);
  assert.equal(totalAppends(root), before);
});

test("sectionOrderDelta is null at native, lists titles when moved, self-cleans on move-back", () => {
  const core = createApi();
  const { root } = buildFormStub();
  assert.equal(core.sectionOrderDelta(root), null);
  core.applySectionOrder(root, ["Classification", "Primary Information"]);
  assert.deepEqual(plain(core.sectionOrderDelta(root)),
    ["Classification", "Primary Information", "Billing Information", "Billing Address", "Ship Central"]);
  core.applySectionOrder(root, null);
  assert.equal(core.sectionOrderDelta(root), null);
});

test("applySectionOrder never moves across width classes and fails closed on duplicate titles", () => {
  const core = createApi();
  const { root } = buildFormStub();
  core.applySectionOrder(root, ["Ship Central", "Billing Information", "Primary Information"]);
  assert.deepEqual(plain(core.sectionSlots(root).map((slot) => core.sectionTitleKey(slot.title))),
    ["Primary Information", "Classification", "Billing Information", "Billing Address", "Ship Central"]);
  const dup = buildFormStub({ duplicateTitle: true });
  const before = totalAppends(dup.root);
  core.applySectionOrder(dup.root, ["Primary Information", "Billing Address", "Billing Information"]);
  assert.equal(totalAppends(dup.root), before + 2); // billing still swaps; duplicate-title partition skipped
  assert.deepEqual(plain(core.sectionSlots(dup.root).map((slot) => core.sectionTitleKey(slot.title))),
    ["Primary Information", "Primary Information", "Billing Address", "Billing Information", "Ship Central"]);
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
