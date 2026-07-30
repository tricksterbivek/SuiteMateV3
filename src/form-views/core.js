(function defineSuiteMateV3FormViewsCore(globalScope) {
  "use strict";

  const VERSION = 1;
  const STORAGE_KEY = "suiteMateV3FormViews";
  const STORAGE_SCHEMA_VERSION = 1;
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
  const CLASSES = Object.freeze({
    hiddenField: "suitemate-v3-form-views-hidden-field",
    personalizing: "suitemate-v3-form-views-personalizing"
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

  function entryIsEmpty(entry) {
    return !entry.hiddenFields && !entry.collapsedSections;
  }

  function normalizeEntry(value) {
    if (!isPlainObject(value)) {
      return null;
    }
    const hiddenFields = normalizeFieldNames(value.hiddenFields);
    const collapsedSections = normalizeSections(value.collapsedSections);
    if (!hiddenFields && !collapsedSections) {
      return null;
    }
    return {
      ...(hiddenFields ? { hiddenFields } : {}),
      ...(collapsedSections ? { collapsedSections } : {})
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
    const bytes = new TextEncoder().encode(`${STORAGE_KEY}${JSON.stringify(next)}`).length;
    if (bytes > MAX_SYNC_ITEM_BYTES) {
      // ponytail: single-entry eviction — over quota we keep only the entry
      // being written; one pathological oversize entry can still fail the write.
      next.views = key in next.views ? { [key]: next.views[key] } : {};
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
    if (!values || (Array.isArray(values) && values.length === 0)) {
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
      fieldKey,
      sectionKey,
      applyFieldVisibility
    }),
    configurable: false,
    enumerable: true,
    writable: false
  });
})(globalThis);
