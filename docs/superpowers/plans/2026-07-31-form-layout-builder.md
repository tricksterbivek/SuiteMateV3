# Form Layout Builder (Personal Form Views v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-and-drop section reorder and within-column field reorder to Personal Form Views (Sales Orders only), persisted per scope in `suiteMateV3FormViews` schema v2.

**Architecture:** Pure helpers (storage v2, order planning, DOM capture/apply) live in `src/form-views/core.js` and are vm/stub-testable; `src/form-views/runtime.js` adds grips, drag + keyboard handlers, and save/restore wiring inside the existing Personalize mode. Observer self-trigger is prevented by stamp exclusion in `nodeRelevant` plus identity early-return in the apply helpers.

**Tech Stack:** Vanilla JS (MV3 content scripts), node:test + node:vm harness, static fixture pages served over `python3 -m http.server`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-form-layout-builder-design.md`. All scope limits there are binding: same-panel + same-width-class section moves only; within-column field moves only; no cross-group/cross-cell/cross-panel; Ship Central immovable; no new settings key.
- Client-side only; never modify NetSuite configuration; move whole `<table>` / whole `<tr>` elements via `appendChild` — never td surgery.
- Storage doctrine: fail-closed normalizers, proto-key blocklist (`__proto__`, `constructor`, `prototype`), 7800-byte quota guard, `refusesNewerSchema`, null-on-rejection writers, merge-on-save for off-page sections, delta-only order keys (self-clean at native).
- Visibility/effect CSS needs `!important` (M11/M17 doctrine). Controls/affordance nodes carry `data-suitemate-v3-form-views` (`DATA_ATTRIBUTE`); the native-index stamp attribute is a *different* attribute name and must never equal `DATA_ATTRIBUTE`.
- vm tests wrap cross-realm asserts in `plain()` (JSON round-trip). Each core is sandboxed alone — no cross-core references (copy `planOrder`/`moveLabel`, don't import).
- Live testing: view mode only; never click native Edit/Submit; **never press Reset on the live scope** `6998262:2462:salesord` (holds the user's real hidden-field prefs); teardown = drag back to native (delta self-cleans).
- Git: commit as `git config user.email`; never Claude as author; no Co-Authored-By lines.
- Full gate per task: `npm test` (build → node --check → node --test → verify.mjs → fixtures:verify). Fixture screenshot changes: `npm run fixtures:update` + eyeball each changed baseline.
- Live SO topology (probed twice, SO 16302518): groups = self-contained `<table width="100%">` in slot TDs; 4 layout tables (`#detail_table_lay` in `div__body`: 4 × colspan-3 slots; `shipping_div`: row of 3 colspan-1 TDs [Shipping Information, Shipping Address, empty spacer table] + colspan-3 Ship Central row; `billingtab_div` and `accntingtab_div`: rows of 2 colspan-1 TDs). Title TD: `td.fgroup_title.uir-field-group[.uir-field-group--collapsible][role=button]` containing `div.fgroup_title.uir-field-group-title` (+ icon span when collapsible). Content row: `tr.uir-fieldgroup-content.uir-field-group-content` (id `tr_fg_*` — NetSuite collapse targets these ids). Columns: `td > table.table_fields > tbody > tr.uir-field-wrapper-cell` (one TD per row, 1–2 wrapper DIVs per TD). `#detail_table_lay` also has a row of 3 `td.uir-table-fields-wrapper` (ungrouped fields — never slots).

---

### Task 1: Storage schema v2 (core.js)

**Files:**
- Modify: `src/form-views/core.js`
- Test: `tests/form-views.test.mjs`

**Interfaces:**
- Consumes: existing `withField`, `normalizeSections`, `normalizeFieldNames`, `isPlainObject`.
- Produces: `STORAGE_SCHEMA_VERSION = 2`, `VERSION = 2`, `withSectionOrder(stored, scopeKey, sections)`, `withFieldOrder(stored, scopeKey, orders)` (orders = `{[sectionTitle]: fieldNames[]}`), `normalizeFieldOrder(value)`. Entries may now carry optional `sectionOrder: string[]` and `fieldOrder: {[title]: string[]}`.

- [ ] **Step 1: Write the failing tests** (append to `tests/form-views.test.mjs`)

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/form-views.test.mjs`
Expected: FAIL — `withSectionOrder is not a function`, plus the frozen-contract test still asserting version 1 (leave it failing until Step 3).

- [ ] **Step 3: Implement in `src/form-views/core.js`**

Change constants (`VERSION = 2`, `STORAGE_SCHEMA_VERSION = 2`). Replace `entryIsEmpty`, extend `normalizeEntry`, fix `withField`'s clear test, harden `evictOverQuota`, add `normalizeFieldOrder` + two writers, and export them:

```js
  const VERSION = 2;
  const STORAGE_SCHEMA_VERSION = 2;
```

```js
  function normalizeFieldOrder(value) {
    if (!isPlainObject(value)) {
      return null;
    }
    const orders = {};
    let count = 0;
    for (const [section, names] of Object.entries(value)) {
      const validKey = typeof section === "string"
        && section.length > 0
        && section.length <= MAX_SECTION_LENGTH
        && section.trim() === section
        && !["__proto__", "constructor", "prototype"].includes(section);
      const normalized = normalizeFieldNames(names);
      // Skip-bad-key, not fail-closed: one hostile section must not void the
      // rest (so-columns normalizeFilters precedent).
      if (!validKey || !normalized || count >= MAX_SECTIONS) {
        continue;
      }
      orders[section] = normalized;
      count += 1;
    }
    return count ? orders : null;
  }

  function entryIsEmpty(entry) {
    return !entry.hiddenFields && !entry.collapsedSections && !entry.sectionOrder && !entry.fieldOrder;
  }

  function normalizeEntry(value) {
    if (!isPlainObject(value)) {
      return null;
    }
    const hiddenFields = normalizeFieldNames(value.hiddenFields);
    const collapsedSections = normalizeSections(value.collapsedSections);
    const sectionOrder = normalizeSections(value.sectionOrder);
    const fieldOrder = normalizeFieldOrder(value.fieldOrder);
    if (!hiddenFields && !collapsedSections && !sectionOrder && !fieldOrder) {
      return null;
    }
    return {
      ...(hiddenFields ? { hiddenFields } : {}),
      ...(collapsedSections ? { collapsedSections } : {}),
      ...(sectionOrder ? { sectionOrder } : {}),
      ...(fieldOrder ? { fieldOrder } : {})
    };
  }
```

In `withField`, replace the clear test:

```js
    if (
      !values
      || (Array.isArray(values) && values.length === 0)
      || (isPlainObject(values) && Object.keys(values).length === 0)
    ) {
      delete entry[fieldName];
    } else {
```

Replace `evictOverQuota`:

```js
  function evictOverQuota(next, key) {
    const bytes = (value) => new TextEncoder().encode(`${STORAGE_KEY}${JSON.stringify(value)}`).length;
    if (bytes(next) > MAX_SYNC_ITEM_BYTES) {
      // ponytail: single-entry eviction — over quota we keep only the entry
      // being written; if even that entry is over budget, fail loudly (Chrome
      // hard-fails at 8192 and a silent partial write corrupts).
      next.views = key in next.views ? { [key]: next.views[key] } : {};
      if (bytes(next) > MAX_SYNC_ITEM_BYTES) {
        return null;
      }
    }
    return next;
  }
```

Add writers after `withCollapsedSections`:

```js
  function withSectionOrder(stored, scopeKey, sections) {
    return withField(stored, scopeKey, "sectionOrder", sections, normalizeSections);
  }

  function withFieldOrder(stored, scopeKey, orders) {
    return withField(stored, scopeKey, "fieldOrder", orders, normalizeFieldOrder);
  }
```

Add `withSectionOrder`, `withFieldOrder` to the frozen export object.

- [ ] **Step 4: Update existing tests for the declared version bump** (in `tests/form-views.test.mjs`)

- Frozen-contract test: `VERSION` 1 → 2, `STORAGE_SCHEMA_VERSION` 1 → 2.
- `withHiddenFields ...` test: expected `schemaVersion: 1` → `2`; newer-schema reject case `{ schemaVersion: 2, views: {} }` → `{ schemaVersion: 3, views: {} }`.
- `normalizeStored rejects garbage...`: `empty` becomes `{ schemaVersion: 2, views: {} }`; the rejected newer-schema vector `{ schemaVersion: 2, ... }` → `{ schemaVersion: 3, ... }`; the accepted hostile vector's container `"schemaVersion":1` stays 1 (now exercises v1 pass-through) but the expected output version becomes 2.
- Quota-eviction test: `stored.schemaVersion` assert 1 → 2.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/form-views.test.mjs`
Expected: PASS (all).

- [ ] **Step 6: Full gate + commit**

Run: `npm test`
Expected: PASS (fixture baselines untouched).

```bash
git add src/form-views/core.js tests/form-views.test.mjs
git commit -m "feat: form-views storage schema v2 with section and field order"
```

---

### Task 2: Order-planning primitives (planOrder + moveLabel copies)

**Files:**
- Modify: `src/form-views/core.js`
- Test: `tests/form-views.test.mjs`

**Interfaces:**
- Produces: `planOrder(nativeLabels, savedLabels) -> string[]` (full target order; saved labels absent from native, duplicated in native, or repeated are ignored), `moveLabel(labels, fromLabel, toLabel) -> string[] | null`. Both exported.

- [ ] **Step 1: Write the failing tests**

```js
test("planOrder matches so-columns semantics for section and field lists", () => {
  const core = createApi();
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/form-views.test.mjs` — Expected: FAIL, `planOrder is not a function`.

- [ ] **Step 3: Copy the two functions into `src/form-views/core.js`**

Copy `planOrder` verbatim from `src/so-columns/core.js:392-420` and `moveLabel` verbatim from `src/so-columns/runtime.js:131-140` (vm sandboxes each core alone — duplication is doctrine here; `moveLabel` finally gets unit coverage). Add both to the export object.

- [ ] **Step 4: Run tests, full gate, commit**

Run: `node --test tests/form-views.test.mjs` then `npm test` — Expected: PASS.

```bash
git add src/form-views/core.js tests/form-views.test.mjs
git commit -m "feat: copy planOrder and moveLabel into form-views core"
```

---

### Task 3: Section topology helpers (slots, stamping, apply, delta)

**Files:**
- Modify: `src/form-views/core.js`
- Test: `tests/form-views.test.mjs`

**Interfaces:**
- Produces (all exported): `NATIVE_INDEX_ATTRIBUTE = "data-suitemate-v3-form-views-native-index"`, `sectionTitleKey(titleTd) -> string`, `sectionSlots(root) -> {title, groupTable, slotTd, layoutTable, classKey}[]` (document order), `sectionPartitions(root) -> slot[][]` (grouped by layout table + width class), `applySectionOrder(root, storedOrder|null) -> boolean` (null = restore native; identity partitions perform zero appendChild), `sectionOrderDelta(root) -> string[] | null` (flat current titles when any slot is non-native, else null).
- Consumes: `planOrder`, `sectionKey`, `cleanNodeText` (Task 2 / existing).

- [ ] **Step 1: Write the stub-DOM harness and failing tests**

Append a minimal element stub to `tests/form-views.test.mjs` (the vm sandbox has no DOM; mirror the so-columns stub style — only what the helpers touch):

```js
function stubElement(tag, { cls = "", colspan = 1, text = "" } = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    className: cls,
    textContent: text,
    colSpan: colspan,
    attributes: {},
    children: [],
    parentElement: null,
    appendCount: 0,
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    matches(selector) {
      if (selector === "tr.uir-field-wrapper-cell") return this.tagName === "TR" && this.className.includes("uir-field-wrapper-cell");
      return false;
    },
    appendChild(child) {
      this.appendCount += 1;
      const from = child.parentElement;
      if (from) from.children.splice(from.children.indexOf(child), 1);
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    closest(selector) {
      let node = this;
      while (node) {
        if (selector === "table" && node.tagName === "TABLE") return node;
        node = node.parentElement;
      }
      return null;
    },
    cloneNode() { return { textContent: this.textContent, querySelectorAll: () => [] }; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
    querySelectorAll(selector) {
      const out = [];
      const walk = (node) => { node.children.forEach((child) => { if (stubMatch(child, selector, node)) out.push(child); walk(child); }); };
      walk(this);
      return out;
    }
  };
  return el;
}
```

with `stubMatch` handling exactly the selectors core uses (`td.fgroup_title`, `div.fgroup_title`, `:scope > tbody > tr.uir-fieldgroup-content > td > table.table_fields`, `:scope > tbody > tr`, `[data-walkthrough^="Field:"]`) — implement `:scope` selectors as dedicated helper functions on the harness side if simpler, but the core code under test must only ever call standard DOM methods. Build a `buildFormStub()` factory returning the four-panel topology of the Global Constraints section in miniature: one layout table with two colspan-3 slots (titles "Primary Information", "Classification"), one layout table with a 2-cell colspan-1 row ("Billing Information", "Billing Address") plus a colspan-3 row ("Ship Central") and a slotless spacer TD, and an ungrouped `td.uir-table-fields-wrapper` holding a wrapper (must never appear as a slot).

Then the tests:

```js
test("sectionSlots finds slots, skips ungrouped wrappers, partitions by table and class", () => {
  const core = createApi();
  const { root } = buildFormStub();
  const slots = core.sectionSlots(root);
  assert.deepEqual(slots.map((slot) => core.sectionTitleKey(slot.title)),
    ["Primary Information", "Classification", "Billing Information", "Billing Address", "Ship Central"]);
  const partitions = core.sectionPartitions(root).map((p) => p.map((slot) => core.sectionTitleKey(slot.title)));
  assert.deepEqual(partitions, [
    ["Primary Information", "Classification"],
    ["Billing Information", "Billing Address"],
    ["Ship Central"]
  ]);
});

test("applySectionOrder stamps natives, permutes within class, and is identity-stable", () => {
  const core = createApi();
  const { root } = buildFormStub();
  assert.equal(core.applySectionOrder(root, null), true);          // first touch stamps, no moves
  assert.equal(totalAppends(root), 0);
  // planOrder only permutes among labels present in the saved list, so a pair
  // swap needs BOTH members saved — this mirrors real saves (full flat list).
  assert.equal(core.applySectionOrder(root, ["Classification", "Primary Information", "Billing Address", "Billing Information"]), true);
  assert.deepEqual(core.sectionSlots(root).map((slot) => core.sectionTitleKey(slot.title)),
    ["Classification", "Primary Information", "Billing Address", "Billing Information", "Ship Central"]);
  const before = totalAppends(root);
  core.applySectionOrder(root, ["Classification", "Primary Information", "Billing Address", "Billing Information"]);
  assert.equal(totalAppends(root), before);                        // identity re-apply: zero DOM writes
});

test("sectionOrderDelta is null at native, lists titles when moved, self-cleans on move-back", () => {
  const core = createApi();
  const { root } = buildFormStub();
  assert.equal(core.sectionOrderDelta(root), null);
  core.applySectionOrder(root, ["Classification", "Primary Information"]);
  assert.deepEqual(core.sectionOrderDelta(root),
    ["Classification", "Primary Information", "Billing Information", "Billing Address", "Ship Central"]);
  core.applySectionOrder(root, null);
  assert.equal(core.sectionOrderDelta(root), null);
});

test("applySectionOrder never moves across width classes and fails closed on duplicate titles", () => {
  const core = createApi();
  const { root } = buildFormStub();
  core.applySectionOrder(root, ["Ship Central", "Billing Information", "Primary Information"]);
  // Ship Central is alone in its class; Billing pair and main pair each stay internally consistent
  assert.deepEqual(core.sectionSlots(root).map((slot) => core.sectionTitleKey(slot.title)),
    ["Primary Information", "Classification", "Billing Information", "Billing Address", "Ship Central"]);
  const dup = buildFormStub({ duplicateTitle: true });             // both main slots titled "Primary Information"
  const before = totalAppends(dup.root);
  core.applySectionOrder(dup.root, ["Primary Information"]);
  assert.equal(totalAppends(dup.root), before);                    // partition skipped entirely
});
```

`totalAppends(root)` sums `appendCount` over every stub node (walk `children`).

- [ ] **Step 2: Run tests to verify they fail** — `node --test tests/form-views.test.mjs`, FAIL on missing exports.

- [ ] **Step 3: Implement in `src/form-views/core.js`**

```js
  const NATIVE_INDEX_ATTRIBUTE = "data-suitemate-v3-form-views-native-index";
  const SECTION_TITLE_SELECTOR = "td.fgroup_title";
```

```js
  function sectionTitleKey(title) {
    return sectionKey(title?.querySelector?.("div.fgroup_title") ?? title);
  }

  function sectionSlots(root) {
    const slots = [];
    for (const title of root?.querySelectorAll?.(SECTION_TITLE_SELECTOR) ?? []) {
      const groupTable = title.closest?.("table");
      const slotTd = groupTable?.parentElement;
      const slotRow = slotTd?.parentElement;
      const layoutTable = slotTd?.closest?.("table");
      if (!groupTable || slotTd?.tagName !== "TD" || slotRow?.tagName !== "TR" || !layoutTable) {
        continue;
      }
      slots.push({
        title,
        groupTable,
        slotTd,
        layoutTable,
        classKey: `${slotTd.colSpan ?? 1}:${(slotRow.children ?? []).length}`
      });
    }
    return slots;
  }

  function sectionPartitions(root) {
    const byTable = new Map();
    for (const slot of sectionSlots(root)) {
      let byClass = byTable.get(slot.layoutTable);
      if (!byClass) {
        byClass = new Map();
        byTable.set(slot.layoutTable, byClass);
      }
      const list = byClass.get(slot.classKey) ?? [];
      list.push(slot);
      byClass.set(slot.classKey, list);
    }
    return [...byTable.values()].flatMap((byClass) => [...byClass.values()]);
  }

  function captureNativeSections(slots) {
    const stamped = slots.every((slot) =>
      slot.slotTd.getAttribute(NATIVE_INDEX_ATTRIBUTE) !== null
      && slot.groupTable.getAttribute(NATIVE_INDEX_ATTRIBUTE) !== null);
    if (!stamped) {
      // ponytail: partial stamping restamps from current order (so-columns
      // ceiling); acceptable because we stamp before any move.
      slots.forEach((slot, index) => {
        slot.slotTd.setAttribute(NATIVE_INDEX_ATTRIBUTE, String(index));
        slot.groupTable.setAttribute(NATIVE_INDEX_ATTRIBUTE, String(index));
      });
    }
  }

  function applySectionOrder(root, storedOrder) {
    try {
      const partitions = sectionPartitions(root);
      if (!partitions.length) {
        return false;
      }
      captureNativeSections(partitions.flat());
      for (const partition of partitions) {
        if (partition.length < 2) {
          continue;
        }
        const currentTitles = partition.map((slot) => sectionTitleKey(slot.title));
        if (new Set(currentTitles).size !== currentTitles.length) {
          continue; // duplicate titles: identity is ambiguous, fail closed
        }
        const nativeTitles = partition
          .slice()
          .sort((a, b) =>
            Number(a.groupTable.getAttribute(NATIVE_INDEX_ATTRIBUTE))
            - Number(b.groupTable.getAttribute(NATIVE_INDEX_ATTRIBUTE)))
          .map((slot) => sectionTitleKey(slot.title));
        const target = planOrder(nativeTitles, Array.isArray(storedOrder) ? storedOrder : []);
        if (currentTitles.join(" ") === target.join(" ")) {
          continue; // identity: zero DOM writes, observer starves
        }
        const tableByTitle = new Map(partition.map((slot) => [sectionTitleKey(slot.title), slot.groupTable]));
        partition.forEach((slot, index) => {
          const desired = tableByTitle.get(target[index]);
          if (desired && desired.parentElement !== slot.slotTd) {
            slot.slotTd.appendChild(desired);
          }
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  function sectionOrderDelta(root) {
    try {
      const slots = sectionSlots(root);
      if (!slots.length) {
        return null;
      }
      captureNativeSections(slots);
      const moved = slots.some((slot) =>
        slot.groupTable.getAttribute(NATIVE_INDEX_ATTRIBUTE) !== slot.slotTd.getAttribute(NATIVE_INDEX_ATTRIBUTE));
      if (!moved) {
        return null;
      }
      const titles = slots.map((slot) => sectionTitleKey(slot.title)).filter(Boolean);
      return titles.length ? titles : null;
    } catch {
      return null;
    }
  }
```

Export: `NATIVE_INDEX_ATTRIBUTE`, `sectionTitleKey`, `sectionSlots`, `sectionPartitions`, `applySectionOrder`, `sectionOrderDelta`.

- [ ] **Step 4: Run tests to verify they pass** — `node --test tests/form-views.test.mjs`.

- [ ] **Step 5: Full gate + commit**

```bash
git add src/form-views/core.js tests/form-views.test.mjs
git commit -m "feat: section slot model with native stamping, apply and delta"
```

---

### Task 4: Field column helpers + observer guard (core.js)

**Files:**
- Modify: `src/form-views/core.js`
- Test: `tests/form-views.test.mjs`

**Interfaces:**
- Produces (exported): `applyFieldOrder(groupTable, storedList|null) -> boolean` (per-column planOrder + row appendChild; null = native; identity = zero writes; a column with unkeyed/mixed/duplicate-key rows is skipped fail-closed), `fieldOrderDelta(groupTable) -> string[] | null` (flat current row keys across columns when any column is non-native), `nodeRelevant(node) -> boolean` (moved from runtime; now also returns false for nodes carrying `NATIVE_INDEX_ATTRIBUTE`), and CLASSES gains `dragging`, `dropTarget`, `dropTargetSide`.
- Consumes: `planOrder`, `fieldKey`, `NATIVE_INDEX_ATTRIBUTE`, `FIELD_WRAPPER_SELECTOR`, `DATA_ATTRIBUTE`.

- [ ] **Step 1: Write the failing tests**

Extend `buildFormStub()` so the "Primary Information" group has two `table.table_fields` columns: column 1 rows `[tranid+custbody_pair (two wrappers in one TD)], [entity]`, column 2 rows `[trandate], [otherrefnum]`. Then:

```js
test("applyFieldOrder reorders rows within a column, packed pair travels as one row", () => {
  const core = createApi();
  const { root, columnKeys } = buildFormStub();
  const group = core.sectionSlots(root)[0].groupTable;
  assert.equal(core.applyFieldOrder(group, null), false);           // native: nothing applied
  assert.equal(core.applyFieldOrder(group, ["entity", "tranid", "otherrefnum", "trandate"]), true);
  assert.deepEqual(columnKeys(group), [["entity", "tranid"], ["otherrefnum", "trandate"]]);
  const before = totalAppends(root);
  core.applyFieldOrder(group, ["entity", "tranid", "otherrefnum", "trandate"]);
  assert.equal(totalAppends(root), before);                          // identity: zero writes
});

test("applyFieldOrder never moves a key across columns and skips unkeyable columns", () => {
  const core = createApi();
  const { root, columnKeys } = buildFormStub();
  const group = core.sectionSlots(root)[0].groupTable;
  core.applyFieldOrder(group, ["trandate", "tranid", "entity"]);     // trandate belongs to column 2
  assert.deepEqual(columnKeys(group), [["tranid", "entity"], ["trandate", "otherrefnum"]]);
  const broken = buildFormStub({ unkeyedRowInColumn: 1 });
  const g2 = core.sectionSlots(broken.root)[0].groupTable;
  const before = totalAppends(broken.root);
  core.applyFieldOrder(g2, ["entity", "tranid"]);
  assert.equal(totalAppends(broken.root), before);                   // whole column skipped fail-closed
});

test("fieldOrderDelta null at native, flat keys when moved, self-cleans on move-back", () => {
  const core = createApi();
  const { root } = buildFormStub();
  const group = core.sectionSlots(root)[0].groupTable;
  assert.equal(core.fieldOrderDelta(group), null);
  core.applyFieldOrder(group, ["entity", "tranid"]);
  assert.deepEqual(core.fieldOrderDelta(group), ["entity", "tranid", "trandate", "otherrefnum"]);
  core.applyFieldOrder(group, null);
  assert.equal(core.fieldOrderDelta(group), null);
});

test("nodeRelevant excludes owned nodes, internal-id badges and our stamped moves", () => {
  const core = createApi();
  const wrapperish = { nodeType: 1, matches: (s) => s === core.FIELD_WRAPPER_SELECTOR, closest: () => null, getAttribute: () => null, querySelector: () => null };
  assert.equal(core.nodeRelevant(wrapperish), true);
  const stamped = { ...wrapperish, getAttribute: (n) => n === core.NATIVE_INDEX_ATTRIBUTE ? "3" : null };
  assert.equal(core.nodeRelevant(stamped), false);
  const owned = { ...wrapperish, matches: (s) => s === `[${core.DATA_ATTRIBUTE}]` };
  assert.equal(core.nodeRelevant(owned), false);
  assert.equal(core.nodeRelevant({ nodeType: 3 }), false);
});
```

`columnKeys(group)` is a harness helper returning each column's row keys in DOM order.

- [ ] **Step 2: Run tests to verify they fail** — `node --test tests/form-views.test.mjs`.

- [ ] **Step 3: Implement in `src/form-views/core.js`**

```js
  const FIELD_ROW_SELECTOR = "tr.uir-field-wrapper-cell";
  const FIELD_COLUMN_SELECTOR = ":scope > tbody > tr.uir-fieldgroup-content > td > table.table_fields";
```

```js
  function columnTables(groupTable) {
    return [...(groupTable?.querySelectorAll?.(FIELD_COLUMN_SELECTOR) ?? [])];
  }

  function columnRows(columnTable) {
    const rows = [...(columnTable?.querySelectorAll?.(":scope > tbody > tr") ?? [])];
    if (!rows.length || !rows.every((row) => row.matches?.(FIELD_ROW_SELECTOR))) {
      return null; // mixed row kinds: reordering a subset would sink the rest, fail closed
    }
    const keyed = rows.map((row) => ({ row, key: fieldKey(row.querySelector?.(FIELD_WRAPPER_SELECTOR)) }));
    const keys = keyed.map((entry) => entry.key);
    return keys.every(Boolean) && new Set(keys).size === keys.length ? keyed : null;
  }

  function captureNativeFields(keyed) {
    const stamped = keyed.every((entry) => entry.row.getAttribute(NATIVE_INDEX_ATTRIBUTE) !== null);
    if (!stamped) {
      keyed.forEach((entry, index) => entry.row.setAttribute(NATIVE_INDEX_ATTRIBUTE, String(index)));
    }
  }

  function applyFieldOrder(groupTable, storedList) {
    try {
      let applied = false;
      for (const columnTable of columnTables(groupTable)) {
        const keyed = columnRows(columnTable);
        if (!keyed || keyed.length < 2) {
          continue;
        }
        captureNativeFields(keyed);
        const nativeKeys = keyed
          .slice()
          .sort((a, b) => Number(a.row.getAttribute(NATIVE_INDEX_ATTRIBUTE)) - Number(b.row.getAttribute(NATIVE_INDEX_ATTRIBUTE)))
          .map((entry) => entry.key);
        const target = planOrder(nativeKeys, Array.isArray(storedList) ? storedList : []);
        const currentKeys = keyed.map((entry) => entry.key);
        if (currentKeys.join(" ") === target.join(" ")) {
          continue;
        }
        const rowByKey = new Map(keyed.map((entry) => [entry.key, entry.row]));
        const tbody = columnTable.querySelector(":scope > tbody");
        for (const key of target) {
          const row = rowByKey.get(key);
          if (row && tbody) {
            tbody.appendChild(row);
          }
        }
        applied = true;
      }
      return applied;
    } catch {
      return false;
    }
  }

  function fieldOrderDelta(groupTable) {
    try {
      const keys = [];
      let moved = false;
      for (const columnTable of columnTables(groupTable)) {
        const keyed = columnRows(columnTable);
        if (!keyed) {
          continue;
        }
        captureNativeFields(keyed);
        const stamps = keyed.map((entry) => Number(entry.row.getAttribute(NATIVE_INDEX_ATTRIBUTE)));
        if (stamps.some((value, index) => index > 0 && stamps[index - 1] > value)) {
          moved = true;
        }
        keys.push(...keyed.map((entry) => entry.key));
      }
      return moved && keys.length ? keys : null;
    } catch {
      return null;
    }
  }

  function nodeRelevant(node) {
    if (
      node?.nodeType !== 1
      || node.matches?.(`[${DATA_ATTRIBUTE}]`)
      || node.closest?.(`[${DATA_ATTRIBUTE}]`)
      || node.matches?.("[data-suitemate-v3-internal-id]")
      || node.getAttribute?.(NATIVE_INDEX_ATTRIBUTE) !== null
    ) {
      return false;
    }
    return node.matches?.(FIELD_WRAPPER_SELECTOR)
      || Boolean(node.querySelector?.(FIELD_WRAPPER_SELECTOR));
  }
```

Extend CLASSES:

```js
  const CLASSES = Object.freeze({
    hiddenField: "suitemate-v3-form-views-hidden-field",
    personalizing: "suitemate-v3-form-views-personalizing",
    dragging: "suitemate-v3-form-views-dragging",
    dropTarget: "suitemate-v3-form-views-drop-target",
    dropTargetSide: "suitemate-v3-form-views-drop-target-side"
  });
```

Export `applyFieldOrder`, `fieldOrderDelta`, `nodeRelevant`.

Note: `nodeRelevant`'s stamp check is deliberately on the moved node itself — MutationRecords list the exact `appendChild`-ed element, which is always a stamped group table or stamped row for our moves. Unstamped NetSuite subtrees containing wrappers stay relevant.

- [ ] **Step 4: Run tests, full gate, commit**

```bash
git add src/form-views/core.js tests/form-views.test.mjs
git commit -m "feat: field column reorder helpers and stamped observer guard"
```

**Checkpoint (Phase A):** append a `save/CHECKPOINTS.md` entry "Form Layout Builder: core v2 (Phase A)" with Status/Date/Included/Verification (`npm test` count), commit `docs: checkpoint form layout builder phase A`.

---

### Task 5: Fixture rebuild to live topology (Phase B)

**Files:**
- Modify: `tests/fixtures/sales-order.html`
- Possibly modify: `tests/fixtures.test.mjs` (only if it pins old form markup — check with `grep -n "fixture-form\|fgroup\|uir-field-wrapper" tests/fixtures.test.mjs`)

**Interfaces:**
- Produces: fixture DOM matching the live slot model so Tasks 6–7 round-trips exercise real selectors. Field set grows: existing keys (tranid, entity, trandate, subsidiary, custbody_biztype [walkthrough-only], location) stay; adds custbody_issue (packed with tranid), otherrefnum, shipdate, shipmethod, shipaddress, billaddress, memo (ungrouped).
- Existing collapse-emulation script works unchanged (title row's `nextElementSibling` inside the group table is the content row).

- [ ] **Step 1: Replace the `.fixture-form` table** with the live topology. Main panel:

```html
      <table id="detail_table_lay" class="uir-tab-fields" cellspacing="0" style="width: 100%">
        <tbody>
          <tr><td colspan="3">
            <table width="100%"><tbody>
              <tr><td id="fg_fieldGroup_1" class="fgroup_title uir-field-group uir-field-group--collapsible" role="button" aria-expanded="true"><div class="fgroup_title uir-field-group-title"><span class="uir-field-group--collapsible-icon"></span>Primary Information</div></td></tr>
              <tr id="tr_fg_fieldGroup_1" class="uir-fieldgroup-content uir-field-group-content">
                <td><table class="table_fields"><tbody>
                  <tr class="uir-field-wrapper-cell"><td>
                    <div class="uir-field-wrapper" data-field-name="tranid" data-walkthrough="Field:tranid" data-nsps-label="Order #"><span class="uir-label"><span class="uir-label-span smalltextnolink">Order #</span></span><span class="uir-field inputreadonly">SO10428</span></div>
                    <div class="uir-field-wrapper" data-field-name="custbody_issue" data-walkthrough="Field:custbody_issue" data-nsps-label="Issue"><span class="uir-label"><span class="uir-label-span smalltextnolink">Issue</span></span><span class="uir-field inputreadonly">None</span></div>
                  </td></tr>
                  <tr class="uir-field-wrapper-cell"><td><div class="uir-field-wrapper" data-field-name="entity" data-walkthrough="Field:entity" data-nsps-label="Customer"><span class="uir-label"><span class="uir-label-span smalltextnolink">Customer</span></span><span class="uir-field inputreadonly">Sample Customer</span></div></td></tr>
                </tbody></table></td>
                <td><table class="table_fields"><tbody>
                  <tr class="uir-field-wrapper-cell"><td><div class="uir-field-wrapper" data-field-name="trandate" data-walkthrough="Field:trandate" data-nsps-label="Date"><span class="uir-label"><span class="uir-label-span smalltextnolink">Date</span></span><span class="uir-field inputreadonly">13/07/2026</span></div></td></tr>
                  <tr class="uir-field-wrapper-cell"><td><div class="uir-field-wrapper" data-field-name="otherrefnum" data-walkthrough="Field:otherrefnum" data-nsps-label="PO #"><span class="uir-label"><span class="uir-label-span smalltextnolink">PO #</span></span><span class="uir-field inputreadonly">PO-2211</span></div></td></tr>
                </tbody></table></td>
              </tr>
            </tbody></table>
          </td></tr>
          <tr><td colspan="3">
            <table width="100%"><tbody>
              <tr><td id="fg_fieldGroup_2" class="fgroup_title uir-field-group uir-field-group--collapsible" role="button" aria-expanded="true"><div class="fgroup_title uir-field-group-title"><span class="uir-field-group--collapsible-icon"></span>Classification</div></td></tr>
              <tr id="tr_fg_fieldGroup_2" class="uir-fieldgroup-content uir-field-group-content">
                <td><table class="table_fields"><tbody>
                  <tr class="uir-field-wrapper-cell"><td><div class="uir-field-wrapper" data-field-name="subsidiary" data-walkthrough="Field:subsidiary" data-nsps-label="Subsidiary"><span class="uir-label"><span class="uir-label-span smalltextnolink">Subsidiary</span></span><span class="uir-field inputreadonly">Australia</span></div></td></tr>
                  <tr class="uir-field-wrapper-cell"><td><div class="uir-field-wrapper" data-walkthrough="Field:custbody_biztype" data-nsps-label="Business Type"><span class="uir-label"><span class="uir-label-span smalltextnolink">Business Type</span></span><span class="uir-field inputreadonly">Sales</span></div></td></tr>
                  <tr class="uir-field-wrapper-cell"><td><div class="uir-field-wrapper" data-field-name="location" data-walkthrough="Field:location" data-nsps-label="Location"><span class="uir-label"><span class="uir-label-span smalltextnolink">Location</span></span><span class="uir-field inputreadonly">Sydney</span></div></td></tr>
                </tbody></table></td>
              </tr>
            </tbody></table>
          </td></tr>
          <tr>
            <td width="33%" class="uir-table-fields-wrapper"><div class="uir-field-wrapper" data-field-name="memo" data-walkthrough="Field:memo" data-nsps-label="Memo"><span class="uir-label"><span class="uir-label-span smalltextnolink">Memo</span></span><span class="uir-field inputreadonly">Ungrouped memo</span></div></td>
            <td width="33%" class="uir-table-fields-wrapper"></td>
            <td width="33%" class="uir-table-fields-wrapper"></td>
          </tr>
        </tbody>
      </table>
```

- [ ] **Step 2: Add the shipping panel after the tab nav** (keeps the pattern honest: one narrow pair + spacer + one immovable wide group, all non-collapsible except none — matches live where the pair is non-collapsible):

```html
      <div id="shipping_div">
        <table style="width: 100%"><tbody>
          <tr>
            <td>
              <table width="100%"><tbody>
                <tr><td id="fg_fieldGroup_10" class="fgroup_title uir-field-group"><div class="fgroup_title uir-field-group-title">Shipping Information</div></td></tr>
                <tr id="tr_fg_fieldGroup_10" class="uir-fieldgroup-content uir-field-group-content">
                  <td><table class="table_fields"><tbody>
                    <tr class="uir-field-wrapper-cell"><td><div class="uir-field-wrapper" data-field-name="shipdate" data-walkthrough="Field:shipdate" data-nsps-label="Ship Date"><span class="uir-label"><span class="uir-label-span smalltextnolink">Ship Date</span></span><span class="uir-field inputreadonly">15/07/2026</span></div></td></tr>
                    <tr class="uir-field-wrapper-cell"><td><div class="uir-field-wrapper" data-field-name="shipmethod" data-walkthrough="Field:shipmethod" data-nsps-label="Ship Via"><span class="uir-label"><span class="uir-label-span smalltextnolink">Ship Via</span></span><span class="uir-field inputreadonly">Road Freight</span></div></td></tr>
                  </tbody></table></td>
                </tr>
              </tbody></table>
            </td>
            <td>
              <table width="100%"><tbody>
                <tr><td id="fg_fieldGroup_11" class="fgroup_title uir-field-group"><div class="fgroup_title uir-field-group-title">Shipping Address</div></td></tr>
                <tr id="tr_fg_fieldGroup_11" class="uir-fieldgroup-content uir-field-group-content">
                  <td><table class="table_fields"><tbody>
                    <tr class="uir-field-wrapper-cell"><td><div class="uir-field-wrapper" data-field-name="shipaddress" data-walkthrough="Field:shipaddress" data-nsps-label="Ship To"><span class="uir-label"><span class="uir-label-span smalltextnolink">Ship To</span></span><span class="uir-field inputreadonly">1 Sample St, Sydney</span></div></td></tr>
                  </tbody></table></td>
                </tr>
              </tbody></table>
            </td>
            <td><table cellspacing="0" cellpadding="0"> </table></td>
          </tr>
          <tr><td colspan="3">
            <table width="100%"><tbody>
              <tr><td id="fg_shipcentral" class="fgroup_title uir-field-group"><div class="fgroup_title uir-field-group-title">Ship Central - Other Party Billing</div></td></tr>
              <tr id="tr_fg_shipcentral" class="uir-fieldgroup-content uir-field-group-content">
                <td><table class="table_fields"><tbody>
                  <tr class="uir-field-wrapper-cell"><td><div class="uir-field-wrapper" data-field-name="custbody_third_party_acct" data-walkthrough="Field:custbody_third_party_acct" data-nsps-label="3P Account"><span class="uir-label"><span class="uir-label-span smalltextnolink">3P Account</span></span><span class="uir-field inputreadonly">—</span></div></td></tr>
                </tbody></table></td>
              </tr>
            </tbody></table>
          </td></tr>
        </tbody></table>
      </div>
```

- [ ] **Step 3: Adjust fixture CSS** — delete the `.fixture-form` / `.fixture-group-fields` rules; add minimal replacements so groups render legibly (borrow live spacing, keep it tiny):

```css
      #detail_table_lay > tbody > tr > td { padding: 0 0 14px }
      #shipping_div table { border-collapse: collapse }
      .table_fields td { padding: 3px 24px 3px 0; vertical-align: top }
```

Keep `.uir-field-group-title` / `.uir-field-group--collapsible-icon` rules.

- [ ] **Step 4: Run the collapse sanity check** — serve (`python3 -m http.server 8931` from repo root), load `http://localhost:8931/tests/fixtures/sales-order.html?formViews=true&salesOrderColumns=true`, click Primary Information title: content row hides, aria-expanded flips (existing emulation script — verify no edit needed because the content row is now the title row's sibling *inside* the group table).

- [ ] **Step 5: Full gate; re-bless baselines**

Run: `npm test` — fixtures:verify will fail on sales-order baselines (intended DOM change). Then:

Run: `npm run fixtures:update` and eyeball every regenerated sales-order screenshot (groups render, no overlap, dark-mode variant sane). Re-run `npm test` → PASS. If `tests/fixtures.test.mjs` pinned old markup, update those assertions to the new topology (declared change).

- [ ] **Step 6: Commit + checkpoint (Phase B)**

```bash
git add tests/fixtures/sales-order.html tests/fixtures.test.mjs tests/fixtures/baselines
git commit -m "test: rebuild sales-order fixture to live four-panel form topology"
```

Append `save/CHECKPOINTS.md` entry "Form Layout Builder: fixture topology (Phase B)"; commit.

---

### Task 6: Section reorder runtime (Phase C)

**Files:**
- Modify: `src/form-views/runtime.js`
- Modify: `src/form-views/form-views.css`

**Interfaces:**
- Consumes: everything Tasks 1–4 export.
- Produces: grips + drag + Alt+Arrow keyboard for sections; `saveOrders()` (covers sections *and* fields — field delta is simply null until Task 7 adds drag sources); install pipeline applies stored order; Reset/disable restore native; `justDropped` collapse guard; updated hint copy.

- [ ] **Step 1: Runtime state + core delegation**

Add to module state (after `replayingCollapse`):

```js
  let dragSection = null;   // { title: string }
  let dragField = null;     // { row, columnTable, key, groupTable }
  let dropNode = null;      // element currently carrying the drop-target class
  let dropAxisSide = false; // horizontal partitions get the side bar
  let justDropped = false;
```

Delete the local `nodeRelevant` (runtime.js:431-442) and `sectionTitleKey` body (keep the name, delegate):

```js
  function sectionTitleKey(title) {
    return core.sectionTitleKey(title);
  }

  function containsRelevantMutation(records) {
    return records.some((record) => [...record.addedNodes].some(core.nodeRelevant));
  }
```

- [ ] **Step 2: saveOrders + apply-all helper**

```js
  function applyStoredOrders(entry) {
    core.applySectionOrder(document, entry?.sectionOrder ?? null);
    for (const slot of core.sectionSlots(document)) {
      const title = core.sectionTitleKey(slot.title);
      core.applyFieldOrder(slot.groupTable, title ? entry?.fieldOrder?.[title] ?? null : null);
    }
  }

  function saveOrders() {
    return enqueueSave(async () => {
      try {
        if (!scopeKey) {
          return;
        }
        const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
        const entry = core.normalizeStored(stored[core.STORAGE_KEY]).views[scopeKey];
        // Merge, don't replace: order entries for sections this form variant
        // does not render must survive the write (collapse-save precedent).
        const slots = core.sectionSlots(document);
        const onPage = new Set(slots.map((slot) => core.sectionTitleKey(slot.title)).filter(Boolean));
        const offPage = (entry?.sectionOrder ?? []).filter((title) => !onPage.has(title));
        const delta = core.sectionOrderDelta(document);
        const sections = [...offPage, ...(delta ?? [])];
        let next = core.withSectionOrder(stored[core.STORAGE_KEY], scopeKey, sections.length ? sections : null);
        const orders = { ...(entry?.fieldOrder ?? {}) };
        for (const slot of slots) {
          const title = core.sectionTitleKey(slot.title);
          if (!title) {
            continue;
          }
          const fieldDelta = core.fieldOrderDelta(slot.groupTable);
          if (fieldDelta) {
            orders[title] = fieldDelta;
          } else {
            delete orders[title];
          }
        }
        next = next && core.withFieldOrder(next, scopeKey, Object.keys(orders).length ? orders : null);
        if (!next) {
          showToast("Form layout could not be saved.", "warning");
          return;
        }
        await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
      } catch {
        showToast("Form layout could not be saved.", "warning");
      }
    });
  }
```

- [ ] **Step 3: Grips**

```js
  function reorderableSlots() {
    return core.sectionPartitions(document).filter((partition) => partition.length > 1).flat();
  }

  function ensureSectionGrips() {
    for (const slot of reorderableSlots()) {
      const mount = slot.title.querySelector("div.fgroup_title");
      if (!mount || mount.querySelector(`[${core.DATA_ATTRIBUTE}="section-grip"]`)) {
        continue;
      }
      const grip = document.createElement("button");
      grip.type = "button";
      grip.textContent = "⠿";
      grip.title = "Drag to move this section";
      grip.draggable = true;
      grip.setAttribute(core.DATA_ATTRIBUTE, "section-grip");
      grip.addEventListener("click", (event) => {
        // The title TD is role=button on collapsible groups; a grip click
        // must not toggle collapse.
        event.preventDefault();
        event.stopPropagation();
      });
      grip.addEventListener("keydown", handleSectionKeydown);
      mount.prepend(grip);
    }
  }

  function removeSectionGrips() {
    document.querySelectorAll(`[${core.DATA_ATTRIBUTE}="section-grip"]`).forEach((node) => node.remove());
  }
```

- [ ] **Step 4: Drop-target visuals + drag handlers** (document-level, attached only in personalize mode)

```js
  function setDropNode(node, side) {
    if (dropNode === node) {
      return;
    }
    dropNode?.classList.remove(core.CLASSES.dropTarget, core.CLASSES.dropTargetSide);
    dropNode = node;
    dropAxisSide = Boolean(side);
    dropNode?.classList.add(side ? core.CLASSES.dropTargetSide : core.CLASSES.dropTarget);
  }

  function clearDragState() {
    document.querySelectorAll(`.${core.CLASSES.dragging}`).forEach((node) => node.classList.remove(core.CLASSES.dragging));
    dragSection = null;
    dragField = null;
    setDropNode(null, false);
  }

  function slotFromEvent(event) {
    const slotTd = event.target?.closest?.(`td[${core.NATIVE_INDEX_ATTRIBUTE}]`);
    if (!slotTd || !dragSection) {
      return null;
    }
    const partition = core.sectionPartitions(document).find((slots) =>
      slots.some((slot) => core.sectionTitleKey(slot.title) === dragSection.title));
    const slot = partition?.find((candidate) => candidate.slotTd === slotTd);
    return slot && core.sectionTitleKey(slot.title) !== dragSection.title
      ? { slot, horizontal: partition.length > 1 && slot.classKey.split(":")[1] !== "1" }
      : null;
  }

  function pageTitles() {
    return core.sectionSlots(document).map((slot) => core.sectionTitleKey(slot.title));
  }

  function handleDragStart(event) {
    try {
      justDropped = false;
      const grip = event.target?.closest?.(`[${core.DATA_ATTRIBUTE}="section-grip"]`);
      if (grip) {
        const title = grip.closest("td.fgroup_title");
        const key = title ? core.sectionTitleKey(title) : "";
        if (!key) {
          event.preventDefault();
          return;
        }
        event.stopPropagation();
        dragSection = { title: key };
        title.closest("table")?.classList.add(core.CLASSES.dragging);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", key);
          const bar = title.querySelector("div.fgroup_title");
          if (bar && event.dataTransfer.setDragImage) {
            event.dataTransfer.setDragImage(bar, 12, 12);
          }
        }
        return;
      }
      handleFieldDragStart(event); // Task 7 fills this in; stub as no-op until then
    } catch {
      clearDragState();
    }
  }

  function handleDragOver(event) {
    try {
      if (dragSection) {
        const target = slotFromEvent(event);
        if (!target) {
          setDropNode(null, false);
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        setDropNode(target.slot.groupTable, target.horizontal);
        return;
      }
      handleFieldDragOver(event);
    } catch {
      setDropNode(null, false);
    }
  }

  function handleDragLeave(event) {
    if (!event.relatedTarget) {
      setDropNode(null, false);
    }
  }

  function handleDrop(event) {
    try {
      if (dragSection && dropNode) {
        event.preventDefault();
        const targetTitle = core.sectionTitleKey(dropNode.querySelector("td.fgroup_title"));
        const next = core.moveLabel(pageTitles(), dragSection.title, targetTitle);
        clearDragState();
        if (next && core.applySectionOrder(document, next)) {
          markJustDropped();
          saveOrders();
        }
        return;
      }
      handleFieldDrop(event);
    } catch {
      clearDragState();
    }
  }

  function handleDragEnd() {
    clearDragState();
  }

  function markJustDropped() {
    justDropped = true;
    setTimeout(() => {
      justDropped = false;
    }, 0);
  }
```

(Declare `function handleFieldDragStart() {}`, `handleFieldDragOver() {}`, `handleFieldDrop() {}` as empty stubs in this task with a `// ponytail: filled by field-reorder task` comment.)

- [ ] **Step 5: Keyboard path (same code path as drop)**

```js
  function handleSectionKeydown(event) {
    if (!event.altKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      return;
    }
    const title = event.target.closest("td.fgroup_title");
    const key = title ? core.sectionTitleKey(title) : "";
    const partition = core.sectionPartitions(document).find((slots) =>
      slots.some((slot) => core.sectionTitleKey(slot.title) === key));
    if (!key || !partition || partition.length < 2) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const titles = partition.map((slot) => core.sectionTitleKey(slot.title));
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const index = titles.indexOf(key) + (forward ? 1 : -1);
    if (index < 0 || index >= titles.length) {
      return;
    }
    const next = core.moveLabel(pageTitles(), key, titles[index]);
    if (next && core.applySectionOrder(document, next)) {
      markJustDropped();
      saveOrders();
      document.querySelectorAll(`[${core.DATA_ATTRIBUTE}="section-grip"]`).forEach((grip) => {
        if (core.sectionTitleKey(grip.closest("td.fgroup_title")) === key) {
          grip.focus(); // appendChild blurred it
        }
      });
    }
  }
```

- [ ] **Step 6: Wire mode enter/exit, collapse guard, install, reset, remove**

- `enterPersonalize()`: after `ensureAffordances()` add `ensureSectionGrips();` and attach the five document listeners:

```js
    document.addEventListener("dragstart", handleDragStart);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);
    document.addEventListener("dragend", handleDragEnd);
```

- `exitPersonalize()`: symmetric `removeEventListener` × 5, `removeSectionGrips();`, `clearDragState();` before `removeAffordances()`.
- `collapseListener` guard becomes: `if (replayingCollapse || justDropped || !event.target?.closest?.(COLLAPSIBLE_TITLE_SELECTOR)) {`.
- `installFormViews`: after `hiddenFields = new Set(...)` insert `applyStoredOrders(entry);` (before `applyVisibility();`).
- `handleReset`: after the expand-all loop add `core.applySectionOrder(document, null);` and the per-group native restore loop `for (const slot of core.sectionSlots(document)) { core.applyFieldOrder(slot.groupTable, null); }`; extend the write chain:

```js
          const afterFields = core.withHiddenFields(stored[core.STORAGE_KEY], scopeKey, null);
          const afterSections = afterFields && core.withCollapsedSections(afterFields, scopeKey, null);
          const afterOrder = afterSections && core.withSectionOrder(afterSections, scopeKey, null);
          const next = afterOrder && core.withFieldOrder(afterOrder, scopeKey, null);
```

- `removeFormViews`: before the OWNED sweep add native restore + stamp removal:

```js
      core.applySectionOrder(document, null);
      for (const slot of core.sectionSlots(document)) {
        core.applyFieldOrder(slot.groupTable, null);
      }
      document.querySelectorAll(`[${core.NATIVE_INDEX_ATTRIBUTE}]`).forEach((node) =>
        node.removeAttribute(core.NATIVE_INDEX_ATTRIBUTE));
```

- Hint copy: `hint.textContent = "Personalizing — drag fields or section titles to reorder, ⊖ to hide. Click Done to finish.";`

- [ ] **Step 7: CSS** (append to `src/form-views/form-views.css`)

```css
[data-suitemate-v3-form-views="section-grip"] {
    margin-right: 6px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: #68808f;
    font-size: 12px;
    line-height: 1;
    cursor: grab;
    vertical-align: middle
}

[data-suitemate-v3-form-views="section-grip"]:hover {
    color: var(--theme-main, #607799)
}

[data-suitemate-v3-form-views="section-grip"]:focus-visible {
    outline: 2px solid var(--theme-main, #607799);
    outline-offset: 1px
}

html.isDarkMode [data-suitemate-v3-form-views="section-grip"] {
    color: var(--dark-text-2, #a7adb5)
}

.suitemate-v3-form-views-dragging {
    opacity: .45 !important
}

.suitemate-v3-form-views-drop-target {
    box-shadow: inset 0 3px 0 0 var(--theme-main, #607799) !important
}

.suitemate-v3-form-views-drop-target-side {
    box-shadow: inset 3px 0 0 0 var(--theme-main, #607799) !important
}
```

- [ ] **Step 8: Fixture round-trip (sections)** — serve on 8931, load `sales-order.html?formViews=true`, then via browser console/automation:

1. Click "Personalize Form" → grips visible on Primary/Classification (main pair) and Shipping pair; **no grip** on Ship Central.
2. Focus Primary grip, dispatch `Alt+ArrowDown` → Classification renders first; `SuiteMateV3Fixture.formViews` shows `sectionOrder` starting `["Classification", "Primary Information", ...]`; `formViewsWrites` incremented by exactly 1.
3. Reload with same params → order still Classification-first (stored order applied on install); `formViewsWrites` unchanged by the load (no save during apply).
4. `Alt+ArrowUp` back → DOM native; stored entry's `sectionOrder` key gone (self-clean).
5. Collapse Primary via title click → still saves collapsedSections only; drag/keyboard move of a collapsed section keeps it collapsed.
6. Toggle `formViews` off via popup-equivalent (chrome-stub settings change) → order restored native, stamps removed, grips/controls gone.
7. Observer loop probe: after step 2, wait 500 ms → `formViewsWrites` did not grow further; page stays stable.

- [ ] **Step 9: Full gate, commit, checkpoint (Phase C)**

Run: `npm test` (baselines unchanged — grips/drag visuals only exist inside personalize mode, which no baseline captures; if any baseline diff appears, stop and eyeball).

```bash
git add src/form-views/runtime.js src/form-views/form-views.css
git commit -m "feat: drag-and-drop section reorder with keyboard path and native restore"
```

Append checkpoint entry "Form Layout Builder: section reorder (Phase C)"; commit.

---

### Task 7: Field reorder runtime (Phase D)

**Files:**
- Modify: `src/form-views/runtime.js`
- Modify: `src/form-views/form-views.css`

**Interfaces:**
- Consumes: Task 6's drag skeleton (`handleFieldDragStart/Over/Drop` stubs), `core.applyFieldOrder`, `core.fieldOrderDelta`, `moveLabel`.
- Produces: wrappers as drag sources within their column; Alt+ArrowUp/Down on wrappers; anchors neutralized in-mode; ghosted fields draggable.

- [ ] **Step 1: Drag sources on mode enter**

```js
  function ensureFieldDragSources() {
    for (const wrapper of fieldWrappers()) {
      wrapper.draggable = true;
      wrapper.tabIndex = 0;
      wrapper.addEventListener("keydown", handleFieldKeydown);
      for (const anchor of wrapper.querySelectorAll("a")) {
        anchor.setAttribute("draggable", "false"); // link fields must not hijack the drag
      }
    }
  }

  function removeFieldDragSources() {
    for (const wrapper of document.querySelectorAll(core.FIELD_WRAPPER_SELECTOR)) {
      wrapper.removeAttribute("draggable");
      wrapper.removeAttribute("tabindex");
      wrapper.removeEventListener("keydown", handleFieldKeydown);
      for (const anchor of wrapper.querySelectorAll("a")) {
        anchor.removeAttribute("draggable");
      }
    }
  }
```

Call `ensureFieldDragSources()` in `enterPersonalize()` (after `ensureSectionGrips()`); `removeFieldDragSources()` in `exitPersonalize()`.

- [ ] **Step 2: Fill the three field stubs from Task 6**

```js
  function fieldRowOf(node) {
    const wrapper = node?.closest?.(core.FIELD_WRAPPER_SELECTOR);
    if (!wrapper || wrapper.closest(core.EXCLUDED_CONTAINER_SELECTOR) || wrapper.closest(OWNED_SELECTOR)) {
      return null;
    }
    const row = wrapper.closest("tr.uir-field-wrapper-cell");
    const columnTable = row?.closest?.("table.table_fields");
    const groupTable = columnTable?.closest?.(`table[${core.NATIVE_INDEX_ATTRIBUTE}]`);
    const key = row ? core.fieldKey(row.querySelector(core.FIELD_WRAPPER_SELECTOR)) : "";
    return row && columnTable && groupTable && key ? { row, columnTable, groupTable, key } : null;
  }

  function columnKeysOf(columnTable) {
    return [...columnTable.querySelectorAll(":scope > tbody > tr.uir-field-wrapper-cell")]
      .map((row) => core.fieldKey(row.querySelector(core.FIELD_WRAPPER_SELECTOR)));
  }

  function groupKeysWith(groupTable, columnTable, columnKeys) {
    const keys = [];
    for (const column of groupTable.querySelectorAll(":scope > tbody > tr.uir-fieldgroup-content > td > table.table_fields")) {
      keys.push(...(column === columnTable ? columnKeys : columnKeysOf(column)));
    }
    return keys;
  }

  function handleFieldDragStart(event) {
    const source = fieldRowOf(event.target);
    if (!source) {
      return;
    }
    dragField = source;
    source.row.classList.add(core.CLASSES.dragging);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", source.key);
    }
  }

  function handleFieldDragOver(event) {
    if (!dragField) {
      return;
    }
    const target = fieldRowOf(event.target);
    if (!target || target.columnTable !== dragField.columnTable || target.row === dragField.row) {
      setDropNode(null, false);
      return; // other columns/groups never preventDefault -> OS no-drop cursor
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    setDropNode(target.row, false);
  }

  function handleFieldDrop(event) {
    if (!dragField || !dropNode) {
      clearDragState();
      return;
    }
    event.preventDefault();
    const targetKey = core.fieldKey(dropNode.querySelector?.(core.FIELD_WRAPPER_SELECTOR));
    const { columnTable, groupTable, key } = dragField;
    clearDragState();
    const nextColumn = core.moveLabel(columnKeysOf(columnTable), key, targetKey);
    if (nextColumn && core.applyFieldOrder(groupTable, groupKeysWith(groupTable, columnTable, nextColumn))) {
      markJustDropped();
      saveOrders();
    }
  }
```

- [ ] **Step 3: Field keyboard path**

```js
  function handleFieldKeydown(event) {
    if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }
    const source = fieldRowOf(event.target);
    if (!source) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const keys = columnKeysOf(source.columnTable);
    const index = keys.indexOf(source.key) + (event.key === "ArrowDown" ? 1 : -1);
    if (index < 0 || index >= keys.length) {
      return;
    }
    const nextColumn = core.moveLabel(keys, source.key, keys[index]);
    if (nextColumn && core.applyFieldOrder(source.groupTable, groupKeysWith(source.groupTable, source.columnTable, nextColumn))) {
      markJustDropped();
      saveOrders();
      const wrapper = source.row.querySelector(core.FIELD_WRAPPER_SELECTOR);
      wrapper?.focus?.(); // the row move blurred it
    }
  }
```

- [ ] **Step 4: CSS** — append:

```css
.suitemate-v3-form-views-personalizing [data-walkthrough^="Field:"][draggable="true"] {
    cursor: grab
}
```

and in `enterPersonalize()` / `exitPersonalize()` toggle `document.body.classList.toggle(core.CLASSES.personalizing, personalizing)` so the selector has a scope hook (the class exists in CLASSES already, previously unused).

- [ ] **Step 5: Fixture round-trip (fields)** — same serve, `?formViews=true`:

1. Personalize → wrappers show grab cursor; ghost a field (⊖ on entity) → entity wrapper still draggable.
2. Focus tranid wrapper, `Alt+ArrowDown` → the tranid row (with its packed custbody_issue companion) lands below entity; stored `fieldOrder["Primary Information"]` = `["entity", "tranid", "trandate", "otherrefnum"]`; exactly one new write.
3. Reload → order persists; hidden entity stays hidden in its new position when mode is off.
4. `Alt+ArrowUp` back → `fieldOrder` key self-cleans from the stored entry.
5. Cross-column proof: drag tranid over trandate (other column) → no-drop cursor, nothing happens, zero writes.
6. Observer probe: after step 2, `formViewsWrites` stable at +1 after 500 ms.
7. Reset (fixture scope only!) → hidden cleared, native order restored, single write, toast "Form view reset."

- [ ] **Step 6: Full gate, commit, checkpoint (Phase D)**

Run: `npm test`.

```bash
git add src/form-views/runtime.js src/form-views/form-views.css
git commit -m "feat: within-column field drag reorder with keyboard path"
```

Append checkpoint entry "Form Layout Builder: field reorder (Phase D)"; commit.

---

### Task 8: Live verification + ship (Phase E)

**Files:**
- Modify: `package.json`, `manifest.json`, `tests/verify.mjs` (version pins 3.21.0 → 3.22.0)
- Modify: `save/CHECKPOINTS.md`

- [ ] **Step 1: Full regression** — `npm test` green; note test count.

- [ ] **Step 2: Live protocol** (user reloads extension first; my test tab on SO 16302518, view mode only):

1. Record the stored `suiteMateV3FormViews` entry bytes for scope `6998262:2462:salesord` (baseline).
2. Personalize → grips on the 4 main groups + Shipping pair + Billing pair + Account/Tax pair; none on Ship Central.
3. Drag Sales Information above Classification → applies; swap Billing pair; Alt+Arrow one field within Primary Information column 1.
4. Reload → all three survive; native collapse still works; subtab switch keeps order.
5. Drag/key everything back to native → stored entry byte-identical to baseline (delta self-clean). **No Reset.**
6. Toggle formViews off/on via popup → native restore on off, reorder reapplies on on (observer path, no refresh).

- [ ] **Step 3: Version bump** — `package.json` + `manifest.json` `"version": "3.22.0"`, verify.mjs version pin; `npm test` green.

- [ ] **Step 4: Checkpoint + push**

Append `save/CHECKPOINTS.md` entry "Form Layout Builder: Milestone 25 (v3.22.0)" with verification evidence.

```bash
git add package.json manifest.json tests/verify.mjs save/CHECKPOINTS.md
git commit -m "chore: prepare v3.22.0"
git push
```

Release/tag only on request.

---

## Self-review notes

- Spec coverage: section reorder (Task 3+6), field reorder (Task 4+7), storage v2 + three hardening edits (Task 1), delta-only + merge (Task 6 saveOrders), observer guard (Task 4 nodeRelevant + identity early-returns), fixture rebuild (Task 5), Reset/disable restore (Task 6), keyboard floor (Tasks 6–7), live protocol incl. no-Reset rule (Task 8). Out-of-scope items have no tasks — correct.
- Type consistency: `withFieldOrder` takes an object keyed by section title; `saveOrders` builds exactly that; `applyFieldOrder` takes the per-section flat list (`entry.fieldOrder[title]`); `sectionOrderDelta`/`fieldOrderDelta` produce what the writers consume.
- Known ceilings (all marked in code): duplicate section titles → partition skipped; partial stamps → restamp; `moveLabel` flat-list indexOf assumes unique titles (guaranteed by the duplicate-skip).
