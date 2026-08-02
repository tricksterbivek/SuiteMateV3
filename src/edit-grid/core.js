(function defineSuiteMateV3EditGridCore(globalScope) {
  "use strict";

  const VERSION = 1;
  const STORAGE_KEY = "suiteMateV3EditColumns";
  const STORAGE_SCHEMA_VERSION = 1;
  const MAX_SYNC_ITEM_BYTES = 7800;
  const MAX_COLUMN_ID_LENGTH = 200;
  const MAX_COLUMN_IDS = 100;
  const ABSOLUTE_MIN_COLUMN_WIDTH = 50;
  const MAX_COLUMN_WIDTH = 1000;

  const MACHINE_TABLE_SELECTOR = "#item_splits";
  const MACHINE_CONTAINER_SELECTOR = ".uir-machine-table-container";
  const HEADER_ROW_SELECTOR = "tr.uir-machine-headerrow";
  const DATA_ROW_SELECTOR = "tr.uir-machine-row";
  const FOCUSED_ROW_SELECTOR = "tr.uir-machine-row-focused, tr.listfocusedrow";
  const EXCLUDED_ROW_SELECTOR =
    "tr.machineButtonRow, tr.totalrow, tr.uir-machine-loading-row, tr.uir-machine-nodata-row";
  const ORDERED_TABLE_SELECTOR = ".uir-draggable-table";
  const ORDERED_CONTAINER_SELECTOR = ".uir-list-machine-ordered";
  const MOVABLE_CELL_SELECTOR = "td.movable";
  const COLUMN_SPAN_SELECTOR = 'span[id$="_fs"]';

  const DATA_ATTRIBUTE = "data-suitemate-v3-edit-grid";
  const NATIVE_ROW_ATTRIBUTE = "data-suitemate-v3-edit-grid-native-row";
  const BOUND_ATTRIBUTE = "data-suitemate-v3-edit-grid-bound";
  const FOREIGN_NODE_SELECTOR =
    "[data-suitemate-v3-internal-id], [data-suitemate-v3-so-columns], [data-suitemate-v3-form-views], [data-suitemate-v3-edit-grid]";
  const RESERVED_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);
  const CLASSES = Object.freeze({
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

  if (globalScope.SuiteMateV3EditGridCore?.VERSION === VERSION) {
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
      && value.length <= MAX_COLUMN_ID_LENGTH
      && !RESERVED_KEYS.includes(value)
      ? value
      : null;
  }

  function normalizeColumnId(value) {
    const identifier = String(value ?? "").trim();
    return identifier.length > 0
      && identifier.length <= MAX_COLUMN_ID_LENGTH
      && !RESERVED_KEYS.includes(identifier)
      ? identifier
      : null;
  }

  function normalizeColumnIds(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COLUMN_IDS) {
      return null;
    }
    const ids = [];
    for (const candidate of value) {
      const id = typeof candidate === "string" ? normalizeColumnId(candidate) : null;
      if (!id) {
        return null;
      }
      ids.push(id);
    }
    return ids;
  }

  function clampWidth(pixels, minimum) {
    const floor = Math.max(ABSOLUTE_MIN_COLUMN_WIDTH, Math.round(Number(minimum) || 0));
    return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(floor, pixels)));
  }

  function normalizeWidths(value) {
    if (!isPlainObject(value)) {
      return null;
    }
    const widths = {};
    for (const [candidateId, width] of Object.entries(value)) {
      const id = normalizeColumnId(candidateId);
      const pixels = Number(width);
      if (!id || !Number.isFinite(pixels)) {
        continue;
      }
      widths[id] = clampWidth(pixels, ABSOLUTE_MIN_COLUMN_WIDTH);
    }
    const keys = Object.keys(widths);
    return keys.length && keys.length <= MAX_COLUMN_IDS ? widths : null;
  }

  function entryIsEmpty(entry) {
    return !entry.order && !entry.hidden && !entry.widths;
  }

  function normalizeEntry(value) {
    if (!isPlainObject(value)) {
      return null;
    }
    const order = normalizeColumnIds(value.order);
    const hidden = normalizeColumnIds(value.hidden);
    const widths = normalizeWidths(value.widths);
    if (!order && !hidden && !widths) {
      return null;
    }
    return {
      ...(order ? { order } : {}),
      ...(hidden ? { hidden } : {}),
      ...(widths ? { widths } : {})
    };
  }

  function normalizeStored(value) {
    const normalized = { schemaVersion: STORAGE_SCHEMA_VERSION, grids: {} };
    if (
      !isPlainObject(value)
      || !Number.isSafeInteger(value.schemaVersion)
      || value.schemaVersion < 1
      || value.schemaVersion > STORAGE_SCHEMA_VERSION
      || !isPlainObject(value.grids)
    ) {
      return normalized;
    }
    for (const [scopeKey, entry] of Object.entries(value.grids)) {
      const key = normalizeScopeKey(scopeKey);
      const normalizedEntry = normalizeEntry(entry);
      if (key && normalizedEntry) {
        normalized.grids[key] = normalizedEntry;
      }
    }
    return normalized;
  }

  function refusesNewerSchema(stored) {
    return isPlainObject(stored)
      && Number.isSafeInteger(stored.schemaVersion)
      && stored.schemaVersion > STORAGE_SCHEMA_VERSION;
  }

  function measureBytes(value) {
    return new TextEncoder().encode(`${STORAGE_KEY}${JSON.stringify(value)}`).length;
  }

  function evictOverQuota(next, key) {
    if (measureBytes(next) <= MAX_SYNC_ITEM_BYTES) {
      return next;
    }
    // Single-entry eviction, scoped to this feature's own container: the
    // blast radius of a quota event stops at other Edit Mode scopes and can
    // never reach a View Mode layout (spec H2). Only ever reached for a write
    // that just set grids[key], so the entry is always present.
    next.grids = { [key]: next.grids[key] };
    // Re-measure: an entry that alone exceeds the cap is refused through the
    // same channel as every other writer failure, never handed back as a
    // success the storage layer would then reject.
    return measureBytes(next) <= MAX_SYNC_ITEM_BYTES ? next : null;
  }

  function writeField(stored, scopeKey, field, value, normalizer) {
    if (refusesNewerSchema(stored)) {
      return null;
    }
    const next = normalizeStored(stored);
    const key = normalizeScopeKey(scopeKey);
    if (!key) {
      return null;
    }
    const entry = { ...(next.grids[key] ?? {}) };
    const empty = value === null || value === undefined
      || (Array.isArray(value) && value.length === 0)
      || (isPlainObject(value) && Object.keys(value).length === 0);
    if (empty) {
      delete entry[field];
    } else {
      const normalized = normalizer(value);
      if (!normalized) {
        return null;
      }
      entry[field] = normalized;
    }
    if (entryIsEmpty(entry)) {
      // A clearing write only ever shrinks the container, so eviction can never
      // be needed here — and running it would destroy every other scope.
      delete next.grids[key];
      return next;
    }
    next.grids[key] = entry;
    return evictOverQuota(next, key);
  }

  function withOrder(stored, scopeKey, columnIds) {
    return writeField(stored, scopeKey, "order", columnIds, normalizeColumnIds);
  }

  function withHidden(stored, scopeKey, columnIds) {
    return writeField(stored, scopeKey, "hidden", columnIds, normalizeColumnIds);
  }

  function withWidths(stored, scopeKey, widths) {
    return writeField(stored, scopeKey, "widths", widths, normalizeWidths);
  }

  // ===== Edit-Mode DOM identity =====
  function tableRows(table) {
    return Array.from(table?.rows ?? []);
  }

  function headerRow(table) {
    return table?.querySelector?.(HEADER_ROW_SELECTOR) ?? null;
  }

  function machineIdFromTable(table) {
    // #item_splits -> item, matching NetSuite's own {sublistId}_row_{n} ids.
    return String(table?.id ?? "").replace(/_+(?:splits|div)$/, "");
  }

  function rowLineNumber(row, machineId) {
    const prefix = `${machineId}_row_`;
    const id = String(row?.id ?? "");
    if (!id.startsWith(prefix)) {
      return null;
    }
    const line = Number(id.slice(prefix.length));
    return Number.isSafeInteger(line) && line > 0 ? line : null;
  }

  function columnIdFromSpanId(spanId, machineId, line) {
    // Mirrors src/internal-ids/core.js sublistColumnId, with the row's own line
    // number instead of a hard-coded 1 so a paged machine (line 26+) decodes
    // and line 21 can never be mistaken for line 1.
    const raw = String(spanId ?? "");
    const suffix = `${line}_fs`;
    if (!Number.isSafeInteger(line) || line <= 0 || !raw.endsWith(suffix)) {
      return null;
    }
    const withoutRow = raw.slice(0, -suffix.length);
    const prefix = machineId ? `${machineId}_` : "";
    const identifier = prefix && withoutRow.startsWith(prefix)
      ? withoutRow.slice(prefix.length)
      : withoutRow;
    return normalizeColumnId(identifier);
  }

  function visibleCells(row) {
    // Inline display:none is how NetSuite hides its own system cells; SuiteMate
    // hides columns with a class, so a SuiteMate-hidden column stays on the axis.
    return Array.from(row?.cells ?? []).filter((cell) => cell?.style?.display !== "none");
  }

  function isExcludedRow(row) {
    try {
      return row?.matches?.(EXCLUDED_ROW_SELECTOR) === true;
    } catch {
      return true;
    }
  }

  function alignsToHeader(row, columnIds) {
    return Array.isArray(columnIds)
      && columnIds.length > 0
      && visibleCells(row).length === columnIds.length;
  }

  function isDataRow(row, columnIds) {
    try {
      return row?.matches?.(DATA_ROW_SELECTOR) === true
        && !row.matches(HEADER_ROW_SELECTOR)
        && !isExcludedRow(row)
        && alignsToHeader(row, columnIds);
    } catch {
      return false;
    }
  }

  function readColumnIds(table) {
    try {
      const header = headerRow(table);
      const width = visibleCells(header).length;
      if (!width) {
        return [];
      }
      const machineId = machineIdFromTable(table);
      for (const row of tableRows(table)) {
        if (row === header || isExcludedRow(row) || visibleCells(row).length !== width) {
          continue;
        }
        const line = rowLineNumber(row, machineId);
        if (line === null) {
          continue;
        }
        const ids = visibleCells(row).map((cell) =>
          columnIdFromSpanId(cell?.querySelector?.(COLUMN_SPAN_SELECTOR)?.id, machineId, line) ?? "");
        if (ids.every(Boolean)) {
          return ids;
        }
      }
      return [];
    } catch {
      return [];
    }
  }

  function isOrderedMachine(table) {
    try {
      // Fail closed: a node that cannot be interrogated counts as ordered, so a
      // machine whose drag handles were never readable is never reordered.
      if (typeof table?.matches !== "function") {
        return true;
      }
      if (table.matches(ORDERED_TABLE_SELECTOR)) {
        return true;
      }
      if (table.closest?.(ORDERED_CONTAINER_SELECTOR)) {
        return true;
      }
      return Boolean(table.querySelector?.(MOVABLE_CELL_SELECTOR));
    } catch {
      return true;
    }
  }

  // ===== Frozen export surface =====
  Object.defineProperty(globalScope, "SuiteMateV3EditGridCore", {
    value: Object.freeze({
      VERSION,
      STORAGE_KEY,
      STORAGE_SCHEMA_VERSION,
      MAX_SYNC_ITEM_BYTES,
      MAX_COLUMN_ID_LENGTH,
      MAX_COLUMN_IDS,
      ABSOLUTE_MIN_COLUMN_WIDTH,
      MAX_COLUMN_WIDTH,
      MACHINE_TABLE_SELECTOR,
      MACHINE_CONTAINER_SELECTOR,
      HEADER_ROW_SELECTOR,
      DATA_ROW_SELECTOR,
      FOCUSED_ROW_SELECTOR,
      EXCLUDED_ROW_SELECTOR,
      COLUMN_SPAN_SELECTOR,
      DATA_ATTRIBUTE,
      NATIVE_ROW_ATTRIBUTE,
      BOUND_ATTRIBUTE,
      FOREIGN_NODE_SELECTOR,
      CLASSES,
      clampWidth,
      normalizeStored,
      refusesNewerSchema,
      withOrder,
      withHidden,
      withWidths,
      machineIdFromTable,
      rowLineNumber,
      columnIdFromSpanId,
      visibleCells,
      tableRows,
      headerRow,
      isExcludedRow,
      alignsToHeader,
      isDataRow,
      readColumnIds,
      isOrderedMachine
    }),
    configurable: false,
    enumerable: true,
    writable: false
  });
})(globalThis);
