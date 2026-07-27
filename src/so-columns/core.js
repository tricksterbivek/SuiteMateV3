(function defineSuiteMateV3SoColumnsCore(globalScope) {
  "use strict";

  const VERSION = 1;
  const STORAGE_KEY = "suiteMateV3ColumnOrder";
  const STORAGE_SCHEMA_VERSION = 1;
  const MAX_SYNC_ITEM_BYTES = 7800;
  const MAX_LABEL_LENGTH = 200;
  const MAX_LABELS = 100;
  const HEADER_ROW_SELECTOR = "tr.uir-machine-headerrow";
  const DATA_ATTRIBUTE = "data-suitemate-v3-so-columns";
  const FOREIGN_NODE_SELECTOR = "[data-suitemate-v3-internal-id], [data-suitemate-v3-so-columns]";
  const CLASSES = Object.freeze({
    controls: "suitemate-v3-so-columns-controls",
    button: "suitemate-v3-so-columns-button",
    personalizing: "suitemate-v3-so-columns-personalizing",
    dragging: "suitemate-v3-so-columns-dragging",
    dropTarget: "suitemate-v3-so-columns-drop-target"
  });

  if (globalScope.SuiteMateV3SoColumnsCore?.VERSION === VERSION) {
    return;
  }

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
      && value.length <= MAX_LABEL_LENGTH
      && !["__proto__", "constructor", "prototype"].includes(value)
      ? value
      : null;
  }

  function normalizeLabels(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LABELS) {
      return null;
    }
    const labels = [];
    for (const label of value) {
      if (typeof label !== "string" || label.length > MAX_LABEL_LENGTH) {
        return null;
      }
      labels.push(label);
    }
    return labels;
  }

  function normalizeStored(value) {
    const normalized = { schemaVersion: STORAGE_SCHEMA_VERSION, orders: {} };
    if (
      !isPlainObject(value)
      || value.schemaVersion !== STORAGE_SCHEMA_VERSION
      || !isPlainObject(value.orders)
    ) {
      return normalized;
    }
    for (const [scopeKey, labels] of Object.entries(value.orders)) {
      const key = normalizeScopeKey(scopeKey);
      const normalizedLabels = normalizeLabels(labels);
      if (key && normalizedLabels) {
        normalized.orders[key] = normalizedLabels;
      }
    }
    return normalized;
  }

  function withOrder(stored, scopeKey, labels) {
    if (
      isPlainObject(stored)
      && Number.isSafeInteger(stored.schemaVersion)
      && stored.schemaVersion > STORAGE_SCHEMA_VERSION
    ) {
      // Never rewrite a newer schema synced from another machine (mirrors
      // settings.js assertStoredVersionIsWritable).
      return null;
    }
    const next = normalizeStored(stored);
    const key = normalizeScopeKey(scopeKey);
    if (!key) {
      return null;
    }
    if (labels === null || labels === undefined) {
      delete next.orders[key];
      return next;
    }
    const normalizedLabels = normalizeLabels(labels);
    if (!normalizedLabels) {
      return null;
    }
    next.orders[key] = normalizedLabels;
    const bytes = new TextEncoder().encode(`${STORAGE_KEY}${JSON.stringify(next)}`).length;
    if (bytes > MAX_SYNC_ITEM_BYTES) {
      // ponytail: single-order eviction — over quota we keep only the entry being
      // written; one pathological oversize order can still fail the sync write.
      next.orders = { [key]: normalizedLabels };
    }
    return next;
  }

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

  function readCellLabel(cell) {
    try {
      const clone = cell?.cloneNode?.(true);
      if (clone?.querySelectorAll) {
        // Internal IDs (and any future SuiteMate feature) may inject badge nodes
        // into header cells; labels must come from NetSuite's own text only.
        for (const foreign of Array.from(clone.querySelectorAll(FOREIGN_NODE_SELECTOR))) {
          foreign.remove?.();
        }
        return String(clone.textContent ?? "").trim();
      }
    } catch {}
    return String(cell?.textContent ?? "").trim();
  }

  function readHeaderLabels(table) {
    const headerRow = table?.querySelector?.(HEADER_ROW_SELECTOR);
    if (!headerRow?.cells) {
      return [];
    }
    return Array.from(headerRow.cells, readCellLabel);
  }

  function applyOrder(table, targetLabels) {
    try {
      if (!Array.isArray(targetLabels) || targetLabels.length < 2) {
        return false;
      }
      const currentLabels = readHeaderLabels(table);
      if (currentLabels.length !== targetLabels.length) {
        return false;
      }

      const used = new Array(currentLabels.length).fill(false);
      const permutation = [];
      for (const label of targetLabels) {
        const index = currentLabels.findIndex(
          (current, cellIndex) => !used[cellIndex] && current === label
        );
        if (index < 0) {
          return false;
        }
        used[index] = true;
        permutation.push(index);
      }

      for (const row of Array.from(table.rows ?? [])) {
        const cells = Array.from(row.cells ?? []);
        if (cells.length !== currentLabels.length) {
          continue;
        }
        for (const cellIndex of permutation) {
          row.appendChild(cells[cellIndex]);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  Object.defineProperty(globalScope, "SuiteMateV3SoColumnsCore", {
    value: Object.freeze({
      VERSION,
      STORAGE_KEY,
      STORAGE_SCHEMA_VERSION,
      MAX_SYNC_ITEM_BYTES,
      MAX_LABEL_LENGTH,
      MAX_LABELS,
      HEADER_ROW_SELECTOR,
      DATA_ATTRIBUTE,
      CLASSES,
      readCellLabel,
      readHeaderLabels,
      planOrder,
      applyOrder,
      normalizeStored,
      withOrder
    }),
    configurable: false,
    enumerable: true,
    writable: false
  });
})(globalThis);
