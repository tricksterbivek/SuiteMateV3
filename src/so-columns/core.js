(function defineSuiteMateV3SoColumnsCore(globalScope) {
  "use strict";

  const VERSION = 1;
  const STORAGE_KEY = "suiteMateV3ColumnOrder";
  const STORAGE_SCHEMA_VERSION = 3;
  const MAX_SYNC_ITEM_BYTES = 7800;
  const MAX_LABEL_LENGTH = 200;
  const MAX_LABELS = 100;
  const MAX_FILTER_COLUMNS = 8;
  const MAX_FILTER_VALUES = 50;
  const MAX_QUERY_LENGTH = 100;
  const MIN_COLUMN_WIDTH = 30;
  const MAX_COLUMN_WIDTH = 1000;
  const HEADER_ROW_SELECTOR = "tr.uir-machine-headerrow";
  const DATA_ATTRIBUTE = "data-suitemate-v3-so-columns";
  const NATIVE_INDEX_ATTRIBUTE = "data-suitemate-v3-native-index";
  const NATIVE_ROW_ATTRIBUTE = "data-suitemate-v3-native-row";
  const SORTABLE_ATTRIBUTE = "data-suitemate-v3-so-columns-sortable";
  // Transaction sublists render data rows as uir-machine-row (e.g. Sales
  // Orders) or uir-list-row-tr (e.g. Item Fulfillments).
  const DATA_ROW_CLASSES = Object.freeze(["uir-machine-row", "uir-list-row-tr"]);
  const DATA_ROW_SELECTOR = "tr.uir-machine-row, tr.uir-list-row-tr";
  const FOREIGN_NODE_SELECTOR = "[data-suitemate-v3-internal-id], [data-suitemate-v3-so-columns], [data-suitemate-v3-form-views]";
  const CLASSES = Object.freeze({
    controls: "suitemate-v3-so-columns-controls",
    colHidden: "suitemate-v3-so-columns-col-hidden",
    button: "suitemate-v3-so-columns-button",
    personalizing: "suitemate-v3-so-columns-personalizing",
    dragging: "suitemate-v3-so-columns-dragging",
    dropTarget: "suitemate-v3-so-columns-drop-target",
    filtered: "suitemate-v3-so-columns-filtered"
  });

  if (globalScope.SuiteMateV3SoColumnsCore?.VERSION === VERSION) {
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

  function normalizeWidths(value) {
    if (!isPlainObject(value)) {
      return null;
    }
    const widths = {};
    for (const [label, width] of Object.entries(value)) {
      if (!label || label.length > MAX_LABEL_LENGTH || ["__proto__", "constructor", "prototype"].includes(label)) {
        continue;
      }
      const pixels = Number(width);
      if (!Number.isFinite(pixels)) {
        continue;
      }
      widths[label] = Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, pixels)));
    }
    return Object.keys(widths).length && Object.keys(widths).length <= MAX_LABELS ? widths : null;
  }

  function normalizeSort(value) {
    if (!isPlainObject(value)
      || typeof value.label !== "string"
      || !value.label
      || value.label.length > MAX_LABEL_LENGTH
      || !["asc", "desc"].includes(value.dir)) {
      return null;
    }
    return { label: value.label, dir: value.dir };
  }

  function normalizeFilters(value) {
    if (!isPlainObject(value)) {
      return null;
    }
    const filters = {};
    for (const [label, candidate] of Object.entries(value)) {
      if (Object.keys(filters).length >= MAX_FILTER_COLUMNS) {
        break;
      }
      if (!label || label.length > MAX_LABEL_LENGTH
        || ["__proto__", "constructor", "prototype"].includes(label)
        || !isPlainObject(candidate)) {
        continue;
      }
      const anyOf = Array.isArray(candidate.anyOf)
        ? candidate.anyOf
          .filter((entry) => typeof entry === "string" && entry && entry.length <= MAX_LABEL_LENGTH)
          .slice(0, MAX_FILTER_VALUES)
        : [];
      const q = typeof candidate.q === "string" ? candidate.q.trim().slice(0, MAX_QUERY_LENGTH) : "";
      if (!anyOf.length && !q) {
        continue;
      }
      filters[label] = { ...(anyOf.length ? { anyOf } : {}), ...(q ? { q } : {}) };
    }
    return Object.keys(filters).length ? filters : null;
  }

  function entryIsEmpty(entry) {
    return !entry.order && !entry.hidden && !entry.widths && !entry.sort && !entry.filters;
  }

  function normalizeEntry(value) {
    // Schema v1 entries were bare label arrays (column order only).
    const candidate = Array.isArray(value) ? { order: value } : value;
    if (!isPlainObject(candidate)) {
      return null;
    }
    const order = normalizeLabels(candidate.order);
    const hidden = normalizeLabels(candidate.hidden);
    const widths = normalizeWidths(candidate.widths);
    const sort = normalizeSort(candidate.sort);
    const filters = normalizeFilters(candidate.filters);
    if (!order && !hidden && !widths && !sort && !filters) {
      return null;
    }
    return {
      ...(order ? { order } : {}),
      ...(hidden ? { hidden } : {}),
      ...(widths ? { widths } : {}),
      ...(sort ? { sort } : {}),
      ...(filters ? { filters } : {})
    };
  }

  function normalizeStored(value) {
    const normalized = { schemaVersion: STORAGE_SCHEMA_VERSION, orders: {} };
    if (
      !isPlainObject(value)
      || !Number.isSafeInteger(value.schemaVersion)
      || value.schemaVersion < 1
      || value.schemaVersion > STORAGE_SCHEMA_VERSION
      || !isPlainObject(value.orders)
    ) {
      return normalized;
    }
    for (const [scopeKey, entry] of Object.entries(value.orders)) {
      const key = normalizeScopeKey(scopeKey);
      const normalizedEntry = normalizeEntry(entry);
      if (key && normalizedEntry) {
        normalized.orders[key] = normalizedEntry;
      }
    }
    return normalized;
  }

  function refusesNewerSchema(stored) {
    // Never rewrite a newer schema synced from another machine (mirrors
    // settings.js assertStoredVersionIsWritable).
    return isPlainObject(stored)
      && Number.isSafeInteger(stored.schemaVersion)
      && stored.schemaVersion > STORAGE_SCHEMA_VERSION;
  }

  function evictOverQuota(next, key) {
    const bytes = new TextEncoder().encode(`${STORAGE_KEY}${JSON.stringify(next)}`).length;
    if (bytes > MAX_SYNC_ITEM_BYTES) {
      // ponytail: single-entry eviction — over quota we keep only the entry
      // being written; one pathological oversize entry can still fail the write.
      next.orders = key in next.orders ? { [key]: next.orders[key] } : {};
    }
    return next;
  }

  function withOrder(stored, scopeKey, labels) {
    if (refusesNewerSchema(stored)) {
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
    const order = normalizeLabels(labels);
    if (!order) {
      return null;
    }
    next.orders[key] = { ...(next.orders[key] ?? {}), order };
    return evictOverQuota(next, key);
  }

  function withHidden(stored, scopeKey, labels) {
    if (refusesNewerSchema(stored)) {
      return null;
    }
    const next = normalizeStored(stored);
    const key = normalizeScopeKey(scopeKey);
    if (!key) {
      return null;
    }
    const entry = { ...(next.orders[key] ?? {}) };
    if (!labels || (Array.isArray(labels) && labels.length === 0)) {
      delete entry.hidden;
    } else {
      const hidden = normalizeLabels(labels);
      if (!hidden) {
        return null;
      }
      entry.hidden = hidden;
    }
    if (entryIsEmpty(entry)) {
      delete next.orders[key];
    } else {
      next.orders[key] = entry;
    }
    return evictOverQuota(next, key);
  }

  function withWidths(stored, scopeKey, widths) {
    if (refusesNewerSchema(stored)) {
      return null;
    }
    const next = normalizeStored(stored);
    const key = normalizeScopeKey(scopeKey);
    if (!key) {
      return null;
    }
    const entry = { ...(next.orders[key] ?? {}) };
    if (!widths || !Object.keys(widths).length) {
      delete entry.widths;
    } else {
      const normalized = normalizeWidths(widths);
      if (!normalized) {
        return null;
      }
      entry.widths = normalized;
    }
    if (entryIsEmpty(entry)) {
      delete next.orders[key];
    } else {
      next.orders[key] = entry;
    }
    return evictOverQuota(next, key);
  }

  function withSort(stored, scopeKey, sort) {
    if (refusesNewerSchema(stored)) {
      return null;
    }
    const next = normalizeStored(stored);
    const key = normalizeScopeKey(scopeKey);
    if (!key) {
      return null;
    }
    const entry = { ...(next.orders[key] ?? {}) };
    if (sort === null || sort === undefined) {
      delete entry.sort;
    } else {
      const normalized = normalizeSort(sort);
      if (!normalized) {
        return null;
      }
      entry.sort = normalized;
    }
    if (entryIsEmpty(entry)) {
      delete next.orders[key];
    } else {
      next.orders[key] = entry;
    }
    return evictOverQuota(next, key);
  }

  function withFilters(stored, scopeKey, filters) {
    if (refusesNewerSchema(stored)) {
      return null;
    }
    const next = normalizeStored(stored);
    const key = normalizeScopeKey(scopeKey);
    if (!key) {
      return null;
    }
    const entry = { ...(next.orders[key] ?? {}) };
    if (!filters || !Object.keys(filters).length) {
      delete entry.filters;
    } else {
      const normalized = normalizeFilters(filters);
      if (!normalized) {
        return null;
      }
      entry.filters = normalized;
    }
    if (entryIsEmpty(entry)) {
      delete next.orders[key];
    } else {
      next.orders[key] = entry;
    }
    return evictOverQuota(next, key);
  }

  // ===== Table cells: widths and visibility (DOM layer) =====
  function applyWidths(table, widths) {
    try {
      const headerRow = table?.querySelector?.(HEADER_ROW_SELECTOR);
      if (!headerRow?.cells) {
        return false;
      }
      const cells = Array.from(headerRow.cells);
      const active = widths && Object.keys(widths).length > 0;
      if (!active) {
        for (const cell of cells) {
          if (cell.style) {
            cell.style.width = "";
          }
        }
        if (table.style) {
          table.style.tableLayout = "";
          table.style.width = "";
        }
        return true;
      }
      // Freeze every visible column (stored width or current rendered width)
      // so flipping to table-layout: fixed is pixel-identical, then the
      // resized column obeys exactly; body cells follow the header row.
      let total = 0;
      for (const cell of cells) {
        if (cell.classList?.contains?.(CLASSES.colHidden)) {
          continue;
        }
        const label = readCellLabel(cell);
        const target = Math.round(widths[label] ?? cell.getBoundingClientRect?.().width ?? 0);
        if (target > 0 && cell.style) {
          cell.style.width = `${target}px`;
          total += target;
        }
      }
      if (table.style) {
        table.style.tableLayout = "fixed";
        table.style.width = total > 0 ? `${total}px` : "";
      }
      return true;
    } catch {
      return false;
    }
  }

  function applyHidden(table, hiddenLabels) {
    try {
      const headerCount = table?.querySelector?.(HEADER_ROW_SELECTOR)?.cells?.length ?? 0;
      if (!headerCount) {
        return false;
      }
      const hidden = new Set(Array.isArray(hiddenLabels) ? hiddenLabels : []);
      const flags = readHeaderLabels(table).map((label) => hidden.has(label));
      for (const row of Array.from(table.rows ?? [])) {
        const cells = Array.from(row.cells ?? []);
        if (cells.length !== headerCount || typeof cells[0]?.classList?.toggle !== "function") {
          continue;
        }
        cells.forEach((cellNode, index) => cellNode.classList.toggle(CLASSES.colHidden, flags[index]));
      }
      return true;
    } catch {
      return false;
    }
  }

  // ===== Order planning by label =====
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

  // ===== Label reads: foreign injected nodes excluded =====
  function readCellLabel(cell) {
    try {
      if (typeof cell?.querySelector === "function" && !cell.querySelector(FOREIGN_NODE_SELECTOR)) {
        return String(cell.textContent ?? "").trim();
      }
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

  // ===== Sorting: value parsing, kind detection, row ordering =====
  const DATE_PATTERN = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;
  const NUMERIC_NOISE_PATTERN = /[$,%\s]/g;

  function cleanNumber(text) {
    return Number(text.replace(NUMERIC_NOISE_PATTERN, ""));
  }

  function parseSortValue(text, kind) {
    const raw = String(text ?? "").trim();
    if (!raw) {
      return { empty: true, value: 0 };
    }
    if (kind === "number") {
      const value = cleanNumber(raw);
      return Number.isFinite(value) ? { empty: false, value } : { empty: true, value: 0 };
    }
    if (kind === "date") {
      const match = DATE_PATTERN.exec(raw);
      if (!match) {
        return { empty: true, value: 0 };
      }
      // ponytail: day-first (dd/mm/yyyy) matching this account's locale;
      // upgrade path is reading the NetSuite date-format preference.
      const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
      return { empty: false, value: year * 10000 + Number(match[2]) * 100 + Number(match[1]) };
    }
    return { empty: false, value: raw.toLowerCase() };
  }

  function detectColumnKind(values) {
    const raw = Array.isArray(values) ? values.map((value) => String(value ?? "").trim()).filter(Boolean) : [];
    if (!raw.length) {
      return "text";
    }
    const numbers = raw.filter((value) => /\d/.test(value) && Number.isFinite(cleanNumber(value))).length;
    const dates = raw.filter((value) => DATE_PATTERN.test(value)).length;
    if (dates >= raw.length * 0.6) {
      return "date";
    }
    if (numbers >= raw.length * 0.6) {
      return "number";
    }
    return "text";
  }

  function sortRows(table, columnIndex, direction) {
    try {
      const headerRow = table?.querySelector?.(HEADER_ROW_SELECTOR);
      const headerCount = headerRow?.cells?.length ?? 0;
      const all = Array.from(table?.rows ?? []);
      const dataRows = all.filter((row) => isDataRow(row, headerCount));
      if (dataRows.length < 2 || typeof dataRows[0]?.getAttribute !== "function") {
        return false;
      }
      const firstIndex = all.indexOf(dataRows[0]);
      const lastIndex = all.indexOf(dataRows[dataRows.length - 1]);
      if (lastIndex - firstIndex + 1 !== dataRows.length) {
        // ponytail: non-contiguous data rows (expansion sub-rows between lines)
        // would be orphaned from their parents by sorting; fail closed.
        return false;
      }
      dataRows.forEach((row, index) => {
        if (row.getAttribute(NATIVE_ROW_ATTRIBUTE) === null) {
          row.setAttribute(NATIVE_ROW_ATTRIBUTE, String(index));
        }
      });
      const stampOf = (row, fallback) => {
        const stamp = Number(row.getAttribute(NATIVE_ROW_ATTRIBUTE));
        return Number.isFinite(stamp) ? stamp : fallback;
      };

      let ordered;
      if (direction === "native") {
        ordered = dataRows.slice().sort((a, b) => stampOf(a, 0) - stampOf(b, 0));
      } else if (direction === "asc" || direction === "desc") {
        if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= headerCount) {
          return false;
        }
        const labels = dataRows.map((row) => readCellLabel(row.cells[columnIndex]));
        const kind = detectColumnKind(labels);
        const sign = direction === "desc" ? -1 : 1;
        ordered = dataRows
          .map((row, index) => ({
            row,
            key: parseSortValue(labels[index], kind),
            tie: stampOf(row, index)
          }))
          .sort((a, b) => {
            if (a.key.empty !== b.key.empty) {
              return a.key.empty ? 1 : -1;
            }
            const cmp = a.key.value < b.key.value ? -1 : a.key.value > b.key.value ? 1 : 0;
            return cmp !== 0 ? sign * cmp : a.tie - b.tie;
          })
          .map((entry) => entry.row);
      } else {
        return false;
      }

      const parent = dataRows[0].parentNode;
      const anchor = dataRows[dataRows.length - 1].nextSibling ?? null;
      if (!parent?.insertBefore) {
        return false;
      }
      for (const row of ordered) {
        parent.insertBefore(row, anchor);
      }
      return true;
    } catch {
      return false;
    }
  }

  // ===== Filtering: row matching, queries, distinct values =====
  function isDataRow(row, headerCount) {
    const name = String(row?.className ?? "");
    return !name.includes("uir-machine-headerrow")
      && DATA_ROW_CLASSES.some((cls) => name.includes(cls))
      && row.cells?.length === headerCount;
  }

  function parseFilterQuery(raw) {
    const text = String(raw ?? "").trim();
    if (!text) {
      return null;
    }
    const match = /^(>=|<=|>|<|=)\s*(.+)$/.exec(text);
    if (match) {
      const value = cleanNumber(match[2]);
      if (Number.isFinite(value)) {
        return { op: match[1], value };
      }
    }
    return { op: "contains", value: text.toLowerCase() };
  }

  function matchesFilter(cellText, query) {
    if (!query) {
      return true;
    }
    const raw = String(cellText ?? "").trim();
    if (Array.isArray(query.anyOf) && query.anyOf.length && !query.anyOf.includes(raw)) {
      return false;
    }
    if (!query.op) {
      return true;
    }
    if (query.op === "contains") {
      return raw.toLowerCase().includes(query.value);
    }
    const value = cleanNumber(raw);
    if (!Number.isFinite(value)) {
      return false;
    }
    switch (query.op) {
      case ">": return value > query.value;
      case "<": return value < query.value;
      case ">=": return value >= query.value;
      case "<=": return value <= query.value;
      default: return value === query.value;
    }
  }

  function applyFilters(table, queries) {
    try {
      const headerCount = table?.querySelector?.(HEADER_ROW_SELECTOR)?.cells?.length ?? 0;
      if (!headerCount) {
        return false;
      }
      const active = Array.isArray(queries) ? queries : [];
      for (const row of Array.from(table.rows ?? [])) {
        if (!isDataRow(row, headerCount) || typeof row.classList?.toggle !== "function") {
          continue;
        }
        let visible = true;
        for (let index = 0; index < active.length && visible; index += 1) {
          if (active[index]) {
            visible = matchesFilter(readCellLabel(row.cells[index]), active[index]);
          }
        }
        row.classList.toggle(CLASSES.filtered, !visible);
      }
      return true;
    } catch {
      return false;
    }
  }

  function distinctColumnValues(table, columnIndex, cap) {
    try {
      const headerCount = table?.querySelector?.(HEADER_ROW_SELECTOR)?.cells?.length ?? 0;
      const values = new Set();
      for (const row of Array.from(table?.rows ?? [])) {
        if (!isDataRow(row, headerCount)) {
          continue;
        }
        const value = readCellLabel(row.cells[columnIndex]);
        if (value) {
          values.add(value);
        }
        if (values.size > cap) {
          return [];
        }
      }
      return Array.from(values).sort();
    } catch {
      return [];
    }
  }

  // ===== Native order capture and column apply =====
  function captureNativeOrder(table) {
    try {
      const headerRow = table?.querySelector?.(HEADER_ROW_SELECTOR);
      const cells = headerRow?.cells ? Array.from(headerRow.cells) : [];
      if (!cells.length || typeof cells[0]?.getAttribute !== "function") {
        return readHeaderLabels(table);
      }
      const stamped = cells.every((cell) => cell.getAttribute(NATIVE_INDEX_ATTRIBUTE) !== null);
      if (!stamped) {
        // First touch: record the pristine order in the DOM itself so later
        // evaluations can never mistake a reordered table for native.
        // ponytail: a partially stamped table (another tool injecting columns
        // mid-life) restamps from current order; acceptable ceiling.
        cells.forEach((cell, index) => cell.setAttribute(NATIVE_INDEX_ATTRIBUTE, String(index)));
        return cells.map(readCellLabel);
      }
      return cells
        .map((cell) => ({ cell, index: Number(cell.getAttribute(NATIVE_INDEX_ATTRIBUTE)) }))
        .sort((a, b) => a.index - b.index)
        .map((entry) => readCellLabel(entry.cell));
    } catch {
      return readHeaderLabels(table);
    }
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

  // ===== Frozen export surface =====
  Object.defineProperty(globalScope, "SuiteMateV3SoColumnsCore", {
    value: Object.freeze({
      VERSION,
      STORAGE_KEY,
      STORAGE_SCHEMA_VERSION,
      MAX_SYNC_ITEM_BYTES,
      MAX_LABEL_LENGTH,
      MAX_LABELS,
      HEADER_ROW_SELECTOR,
      DATA_ROW_SELECTOR,
      DATA_ATTRIBUTE,
      CLASSES,
      NATIVE_INDEX_ATTRIBUTE,
      NATIVE_ROW_ATTRIBUTE,
      SORTABLE_ATTRIBUTE,
      parseSortValue,
      detectColumnKind,
      sortRows,
      parseFilterQuery,
      matchesFilter,
      applyFilters,
      distinctColumnValues,
      readCellLabel,
      readHeaderLabels,
      captureNativeOrder,
      planOrder,
      applyOrder,
      normalizeStored,
      normalizeFilters,
      withOrder,
      withHidden,
      withWidths,
      withSort,
      withFilters,
      MAX_FILTER_COLUMNS,
      MAX_FILTER_VALUES,
      applyHidden,
      applyWidths,
      MIN_COLUMN_WIDTH,
      MAX_COLUMN_WIDTH
    }),
    configurable: false,
    enumerable: true,
    writable: false
  });
})(globalThis);
