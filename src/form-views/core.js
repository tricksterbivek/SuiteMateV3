(function defineSuiteMateV3FormViewsCore(globalScope) {
  "use strict";

  const VERSION = 2;
  const STORAGE_KEY = "suiteMateV3FormViews";
  const STORAGE_SCHEMA_VERSION = 2;
  const MAX_SYNC_ITEM_BYTES = 7800;
  const MAX_FIELD_NAMES = 200;
  const MAX_FIELD_NAME_LENGTH = 100;
  const MAX_SECTIONS = 50;
  const MAX_SECTION_LENGTH = 200;
  const FIELD_NAME_PATTERN = /^[a-z0-9_.:-]{1,100}$/i;
  const WALKTHROUGH_FIELD_PREFIX = "Field:";
  const DATA_ATTRIBUTE = "data-suitemate-v3-form-views";
  const FOREIGN_NODE_SELECTOR = "[data-suitemate-v3-internal-id], [data-suitemate-v3-so-columns], [data-suitemate-v3-form-views]";
  // Live-proven field finder (internal-ids uses the same walkthrough hook);
  // sublist and filter wrappers belong to other features and are excluded by
  // the runtime's containment check, not this selector.
  const FIELD_WRAPPER_SELECTOR = '[data-walkthrough^="Field:"]';
  const EXCLUDED_CONTAINER_SELECTOR = "#item_splits, .uir_list_filter_bar, .uir-filters-body";
  const NATIVE_INDEX_ATTRIBUTE = "data-suitemate-v3-form-views-native-index";
  const SECTION_TITLE_SELECTOR = "td.fgroup_title";
  const FIELD_ROW_SELECTOR = "tr.uir-field-wrapper-cell";
  const FIELD_COLUMN_SELECTOR = ":scope > tbody > tr.uir-fieldgroup-content > td > table.table_fields";
  const CLASSES = Object.freeze({
    hiddenField: "suitemate-v3-form-views-hidden-field",
    personalizing: "suitemate-v3-form-views-personalizing",
    dragging: "suitemate-v3-form-views-dragging",
    dropTarget: "suitemate-v3-form-views-drop-target",
    dropTargetSide: "suitemate-v3-form-views-drop-target-side"
  });

  if (globalScope.SuiteMateV3FormViewsCore?.VERSION === VERSION) {
    return;
  }

  // ===== Storage schema: validation, normalization and writers =====
  function isPlainObject(value) {
    return Boolean(
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.prototype.toString.call(value) === "[object Object]"
    );
  }

  function normalizeScopeKey(value) {
    return typeof value === "string"
      && value.length > 0
      && value.length <= MAX_SECTION_LENGTH
      && !["__proto__", "constructor", "prototype"].includes(value)
      ? value
      : null;
  }

  function normalizeFieldNames(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FIELD_NAMES) {
      return null;
    }
    const names = [];
    for (const name of value) {
      if (typeof name !== "string" || !FIELD_NAME_PATTERN.test(name)) {
        return null;
      }
      const normalized = name.toLowerCase();
      if (!names.includes(normalized)) {
        names.push(normalized);
      }
    }
    return names.length ? names : null;
  }

  function normalizeSections(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SECTIONS) {
      return null;
    }
    const sections = [];
    for (const section of value) {
      if (typeof section !== "string") {
        return null;
      }
      const trimmed = section.trim();
      if (!trimmed || trimmed.length > MAX_SECTION_LENGTH) {
        return null;
      }
      if (!sections.includes(trimmed)) {
        sections.push(trimmed);
      }
    }
    return sections.length ? sections : null;
  }

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

  function normalizeStored(value) {
    const normalized = { schemaVersion: STORAGE_SCHEMA_VERSION, views: {} };
    if (
      !isPlainObject(value)
      || !Number.isSafeInteger(value.schemaVersion)
      || value.schemaVersion < 1
      || value.schemaVersion > STORAGE_SCHEMA_VERSION
      || !isPlainObject(value.views)
    ) {
      return normalized;
    }
    for (const [scopeKey, entry] of Object.entries(value.views)) {
      const key = normalizeScopeKey(scopeKey);
      const normalizedEntry = normalizeEntry(entry);
      if (key && normalizedEntry) {
        normalized.views[key] = normalizedEntry;
      }
    }
    return normalized;
  }

  function refusesNewerSchema(stored) {
    // Never rewrite a newer schema synced from another machine.
    return isPlainObject(stored)
      && Number.isSafeInteger(stored.schemaVersion)
      && stored.schemaVersion > STORAGE_SCHEMA_VERSION;
  }

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

  function withField(stored, scopeKey, fieldName, values, normalizeValues) {
    if (refusesNewerSchema(stored)) {
      return null;
    }
    const next = normalizeStored(stored);
    const key = normalizeScopeKey(scopeKey);
    if (!key) {
      return null;
    }
    const entry = { ...(next.views[key] ?? {}) };
    if (
      !values
      || (Array.isArray(values) && values.length === 0)
      || (isPlainObject(values) && Object.keys(values).length === 0)
    ) {
      delete entry[fieldName];
    } else {
      const normalized = normalizeValues(values);
      if (!normalized) {
        return null;
      }
      entry[fieldName] = normalized;
    }
    if (entryIsEmpty(entry)) {
      delete next.views[key];
    } else {
      next.views[key] = entry;
    }
    return evictOverQuota(next, key);
  }

  function withHiddenFields(stored, scopeKey, fieldNames) {
    return withField(stored, scopeKey, "hiddenFields", fieldNames, normalizeFieldNames);
  }

  function withCollapsedSections(stored, scopeKey, sections) {
    return withField(stored, scopeKey, "collapsedSections", sections, normalizeSections);
  }

  function withSectionOrder(stored, scopeKey, sections) {
    return withField(stored, scopeKey, "sectionOrder", sections, normalizeSections);
  }

  function withFieldOrder(stored, scopeKey, orders) {
    return withField(stored, scopeKey, "fieldOrder", orders, normalizeFieldOrder);
  }

  // ===== Order planning (copied from so-columns core/runtime — each core is
  // vm-sandboxed alone, so cross-core reuse is impossible by doctrine) =====
  function planOrder(nativeLabels, savedLabels) {
    const native = Array.isArray(nativeLabels)
      ? nativeLabels.map((label) => typeof label === "string" ? label : "")
      : [];
    const counts = new Map();
    for (const label of native) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    const matched = [];
    const matchedSet = new Set();
    const saved = Array.isArray(savedLabels) ? savedLabels : [];
    for (const label of saved) {
      if (typeof label === "string" && label && counts.get(label) === 1 && !matchedSet.has(label)) {
        matchedSet.add(label);
        matched.push(label);
      }
    }

    const target = native.slice();
    let matchedIndex = 0;
    for (let index = 0; index < target.length; index += 1) {
      if (matchedSet.has(target[index])) {
        target[index] = matched[matchedIndex];
        matchedIndex += 1;
      }
    }
    return target;
  }

  function moveLabel(labels, fromLabel, toLabel) {
    const from = labels.indexOf(fromLabel);
    const to = labels.indexOf(toLabel);
    if (from < 0 || to < 0 || from === to) {
      return null;
    }
    const next = labels.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  }

  // ===== Field and section identity (DOM-thin, stub-testable) =====
  function fieldKey(wrapper) {
    if (!wrapper) {
      return "";
    }
    const named = typeof wrapper.getAttribute === "function" ? wrapper.getAttribute("data-field-name") : null;
    if (typeof named === "string" && FIELD_NAME_PATTERN.test(named)) {
      return named.toLowerCase();
    }
    const walkthrough = typeof wrapper.getAttribute === "function" ? wrapper.getAttribute("data-walkthrough") : null;
    if (typeof walkthrough === "string" && walkthrough.startsWith(WALKTHROUGH_FIELD_PREFIX)) {
      const parsed = walkthrough.slice(WALKTHROUGH_FIELD_PREFIX.length);
      if (FIELD_NAME_PATTERN.test(parsed)) {
        return parsed;
      }
    }
    return "";
  }

  function cleanNodeText(node) {
    if (!node) {
      return "";
    }
    if (typeof node.cloneNode === "function") {
      const clone = node.cloneNode(true);
      clone.querySelectorAll?.(FOREIGN_NODE_SELECTOR)?.forEach((child) => child.remove());
      return String(clone.textContent ?? "").replace(/\s+/g, " ").trim();
    }
    return String(node.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  function sectionKey(titleNode) {
    const text = cleanNodeText(titleNode);
    return text.length > MAX_SECTION_LENGTH ? "" : text;
  }

  // ===== Section topology: slots, native stamping, apply and delta =====
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
      // ceiling); acceptable because we always stamp before any move.
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
          continue; // identity: zero DOM writes, the observer has nothing to see
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

  // ===== Field topology: per-column rows, stamping, apply and delta =====
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
          .sort((a, b) =>
            Number(a.row.getAttribute(NATIVE_INDEX_ATTRIBUTE)) - Number(b.row.getAttribute(NATIVE_INDEX_ATTRIBUTE)))
          .map((entry) => entry.key);
        const target = planOrder(nativeKeys, Array.isArray(storedList) ? storedList : []);
        const currentKeys = keyed.map((entry) => entry.key);
        if (currentKeys.join(" ") === target.join(" ")) {
          continue; // identity: zero DOM writes
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

  // ===== Observer relevance (unit-testable; runtime feeds MutationRecords) =====
  function nodeRelevant(node) {
    if (
      node?.nodeType !== 1
      || node.matches?.(`[${DATA_ATTRIBUTE}]`)
      || node.closest?.(`[${DATA_ATTRIBUTE}]`)
      || node.matches?.("[data-suitemate-v3-internal-id]")
      || node.getAttribute?.(NATIVE_INDEX_ATTRIBUTE) !== null
    ) {
      // Stamped nodes are exactly what our own reorders move; excluding them
      // (plus identity early-returns in the apply helpers) keeps our own
      // mutations from re-triggering the lifecycle evaluate in a loop.
      return false;
    }
    return node.matches?.(FIELD_WRAPPER_SELECTOR)
      || Boolean(node.querySelector?.(FIELD_WRAPPER_SELECTOR));
  }

  function applyFieldVisibility(wrappers, hiddenSet) {
    if (!Array.isArray(wrappers) && !wrappers?.length && !wrappers?.[Symbol.iterator]) {
      return 0;
    }
    let hidden = 0;
    for (const wrapper of Array.from(wrappers)) {
      const key = fieldKey(wrapper);
      const hide = Boolean(key) && hiddenSet?.has?.(key) === true;
      wrapper.classList?.toggle?.(CLASSES.hiddenField, hide);
      if (hide) {
        hidden += 1;
      }
    }
    return hidden;
  }

  Object.defineProperty(globalScope, "SuiteMateV3FormViewsCore", {
    value: Object.freeze({
      VERSION,
      STORAGE_KEY,
      STORAGE_SCHEMA_VERSION,
      MAX_SYNC_ITEM_BYTES,
      MAX_FIELD_NAMES,
      MAX_SECTIONS,
      DATA_ATTRIBUTE,
      FOREIGN_NODE_SELECTOR,
      FIELD_WRAPPER_SELECTOR,
      EXCLUDED_CONTAINER_SELECTOR,
      CLASSES,
      normalizeStored,
      withHiddenFields,
      withCollapsedSections,
      withSectionOrder,
      withFieldOrder,
      planOrder,
      moveLabel,
      NATIVE_INDEX_ATTRIBUTE,
      sectionTitleKey,
      sectionSlots,
      sectionPartitions,
      applySectionOrder,
      sectionOrderDelta,
      applyFieldOrder,
      fieldOrderDelta,
      nodeRelevant,
      fieldKey,
      sectionKey,
      applyFieldVisibility
    }),
    configurable: false,
    enumerable: true,
    writable: false
  });
})(globalThis);
