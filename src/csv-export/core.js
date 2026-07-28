(function defineSuiteMateV3CsvExportCore(globalScope) {
  "use strict";

  const VERSION = 3;
  const REQUEST_EVENT = "suitemate:v3:csv-export:request";
  const RESULT_EVENT = "suitemate:v3:csv-export:result";
  const ACTION_ID = "suitemate-v3-csv-utils-export";
  const ACTION_SELECTOR = '[data-suitemate-v3-action="csv-utils-export"]';
  const TEMPLATE_ACTION_SELECTOR =
    '[data-suitemate-v3-action="csv-utils-template"]';
  const REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{7,99}$/i;
  const FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/;
  const MAX_TEXT_LENGTH = 1000;
  const RECORD_ID_PATTERN = /^[1-9]\d*$/;
  const CANDIDATE_SUBLISTS = Object.freeze([
    "item",
    "expense",
    "account",
    "line",
    "inventory",
    "invt"
  ]);
  const FIELD_LABEL_OVERRIDES = Object.freeze({
    billaddress: "Billing Address",
    billisresidential: "Billing Address Is Residential",
    billingaddress_text: "Billing Address Text",
    costestimate: "Estimated Cost",
    currencyname: "Currency Name",
    discounttotal: "Discount Total",
    entity_nexus_country: "Entity Nexus Country",
    entitynexus: "Entity Nexus",
    externalid: "Record External ID",
    foreignamount: "Foreign Amount",
    internalid: "Record Internal ID",
    itemdescription: "Item Description",
    nexus_country: "Nexus Country",
    orderstatus: "Order Status",
    overrideholdchecked: "Override Hold Checked",
    shipaddress: "Shipping Address",
    shipisresidential: "Shipping Address Is Residential",
    shippingaddress_text: "Shipping Address Text",
    totalcostestimate: "Total Estimated Cost"
  });

  function boundedText(value, fallback = "") {
    const text = typeof value === "string" ? value.trim() : "";
    return (text || fallback).slice(0, MAX_TEXT_LENGTH);
  }

  function safeValueToText(value) {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value)) {
      return value
        .filter((entry) =>
          entry === null
          || entry === undefined
          || ["string", "number", "boolean"].includes(typeof entry))
        .map((entry) => entry === null || entry === undefined ? "" : String(entry))
        .join("; ");
    }
    if (typeof value === "object" || typeof value === "function") {
      return "";
    }
    try {
      return String(value);
    } catch {
      return "";
    }
  }

  function protectCsvValue(value) {
    const text = safeValueToText(value);
    return (typeof value === "string" || Array.isArray(value))
      && FORMULA_PREFIX.test(text)
      ? `'${text}`
      : text;
  }

  function escapeCsvValue(value) {
    const text = protectCsvValue(value).replace(/\r\n?|\n/g, " ");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function serializeCsv(rows) {
    if (!Array.isArray(rows)) {
      return "";
    }
    return rows
      .map((row) => (Array.isArray(row) ? row : [row])
        .map(escapeCsvValue)
        .join(","))
      .join("\r\n");
  }

  function removeEmptyColumns(rows, alwaysIncludeIndexes = []) {
    if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(rows[0])) {
      return Object.freeze([]);
    }

    const columnCount = rows[0].length;
    const preserved = new Set(
      Array.isArray(alwaysIncludeIndexes)
        ? alwaysIncludeIndexes.filter((index) =>
          Number.isSafeInteger(index) && index >= 0 && index < columnCount)
        : []
    );
    const populatedIndexes = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      let populated = preserved.has(columnIndex);
      for (let rowIndex = 1; !populated && rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        if (
          safeValueToText(Array.isArray(row) ? row[columnIndex] : "").trim() !== ""
        ) {
          populated = true;
          break;
        }
      }
      if (populated) {
        populatedIndexes.push(columnIndex);
      }
    }

    return Object.freeze(rows.map((row) => Object.freeze(
      populatedIndexes.map((columnIndex) =>
        Array.isArray(row) ? row[columnIndex] : "")
    )));
  }

  function humanizeFieldId(fieldId) {
    return boundedText(fieldId)
      .replace(/^cust(?:body|col|record|entity|item)_?/i, "")
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase())
      .trim();
  }

  function readableFieldLabel(fieldId, label) {
    const normalizedId = boundedText(fieldId).toLowerCase();
    const landedCostSource = normalizedId.match(/^landedcostsource(\d+)$/);
    if (landedCostSource) {
      return `Landed Cost Source ${landedCostSource[1]}`;
    }
    return FIELD_LABEL_OVERRIDES[normalizedId]
      || boundedText(label, humanizeFieldId(normalizedId) || "Field");
  }

  function readableScopeLabel(scope) {
    const normalized = boundedText(scope).toLowerCase();
    if (!normalized) {
      return "";
    }
    return normalized === "record" ? "Record" : humanizeFieldId(normalized);
  }

  function normalizeFieldDescriptor(value) {
    const fieldId = boundedText(value?.fieldId).toLowerCase();
    const label = readableFieldLabel(fieldId, value?.label);
    const scope = boundedText(value?.scope).toLowerCase();
    return fieldId ? Object.freeze({ fieldId, label, scope }) : null;
  }

  function makeUniqueHeaders(descriptors) {
    if (!Array.isArray(descriptors)) {
      return Object.freeze([]);
    }

    const normalized = descriptors.map(normalizeFieldDescriptor);
    const labelCounts = new Map();
    const labelScopeCounts = new Map();
    for (const descriptor of normalized) {
      if (descriptor) {
        labelCounts.set(descriptor.label, (labelCounts.get(descriptor.label) ?? 0) + 1);
        const labelScopeKey = `${descriptor.label}\u0000${descriptor.scope}`;
        labelScopeCounts.set(
          labelScopeKey,
          (labelScopeCounts.get(labelScopeKey) ?? 0) + 1
        );
      }
    }

    const used = new Map();
    return Object.freeze(normalized.map((descriptor, index) => {
      if (!descriptor) {
        return `Column ${index + 1}`;
      }
      let base = descriptor.label;
      if (labelCounts.get(descriptor.label) > 1) {
        const labelScopeKey = `${descriptor.label}\u0000${descriptor.scope}`;
        const scopeLabel = readableScopeLabel(descriptor.scope);
        const fieldLabel = humanizeFieldId(descriptor.fieldId);
        if (scopeLabel && labelScopeCounts.get(labelScopeKey) === 1) {
          base = `${scopeLabel} ${descriptor.label}`;
        } else if (fieldLabel.toLowerCase() !== descriptor.label.toLowerCase()) {
          base = `${descriptor.label} (${fieldLabel || "Field"})`;
        }
      }
      const count = (used.get(base) ?? 0) + 1;
      used.set(base, count);
      return count === 1 ? base : `${base} ${count}`;
    }));
  }

  // ===== View snapshot (Export view reads the personalized grid DOM) =====
  const VIEW_FOREIGN_NODE_SELECTOR = "[data-suitemate-v3-so-columns], [data-suitemate-v3-internal-id]";

  function readViewCellLabel(cell) {
    if (!cell) {
      return "";
    }
    if (typeof cell.querySelector === "function" && !cell.querySelector(VIEW_FOREIGN_NODE_SELECTOR)) {
      return String(cell.textContent ?? "").trim();
    }
    if (typeof cell.cloneNode === "function") {
      const clone = cell.cloneNode(true);
      clone.querySelectorAll?.(VIEW_FOREIGN_NODE_SELECTOR)?.forEach((node) => node.remove());
      return String(clone.textContent ?? "").trim();
    }
    return String(cell.textContent ?? "").trim();
  }

  function readViewSnapshot(table, isHidden) {
    if (typeof isHidden !== "function") {
      return null;
    }
    const headerRow = table?.querySelector?.("tr.uir-machine-headerrow");
    const headerCells = Array.from(headerRow?.cells ?? []);
    if (!headerCells.length) {
      return null;
    }
    const keptIndexes = [];
    const labels = [];
    headerCells.forEach((cell, index) => {
      if (isHidden(cell)) {
        return;
      }
      keptIndexes.push(index);
      labels.push(readViewCellLabel(cell) || `Column ${index + 1}`);
    });
    if (!keptIndexes.length) {
      return null;
    }
    const used = new Map();
    const taken = new Set();
    const headers = labels.map((label) => {
      let count = used.get(label) ?? 0;
      let candidate;
      do {
        count += 1;
        candidate = count === 1 ? label : `${label} ${count}`;
      } while (taken.has(candidate));
      used.set(label, count);
      taken.add(candidate);
      return candidate;
    });
    const rows = [];
    for (const row of Array.from(table.querySelectorAll?.("tr.uir-machine-row, tr.uir-list-row-tr") ?? [])) {
      if (isHidden(row)) {
        continue;
      }
      const cells = Array.from(row.cells ?? []);
      if (cells.length !== headerCells.length) {
        continue;
      }
      rows.push(Object.freeze(keptIndexes.map((index) => String(cells[index]?.textContent ?? "").trim())));
    }
    return Object.freeze({ headers: Object.freeze(headers), rows: Object.freeze(rows) });
  }

  function sanitizeFilenamePart(value, fallback = "netsuite-record") {
    function sanitize(valueToSanitize) {
      return safeValueToText(valueToSanitize)
        .trim()
        .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "-")
        .replace(/\.{2,}/g, ".")
        .replace(/^[. -]+|[. -]+$/g, "")
        .slice(0, 180);
    }
    return sanitize(value) || sanitize(fallback) || "netsuite-record";
  }

  function createFilename(value) {
    const part = sanitizeFilenamePart(value);
    return part.toLowerCase().endsWith(".csv") ? part : `${part}.csv`;
  }

  function createTemplateFilename(value) {
    const filename = createFilename(value);
    return `${filename.slice(0, -4)}-template.csv`;
  }

  function parseLocation(value) {
    try {
      if (typeof value === "string" || value instanceof URL) {
        return new URL(String(value));
      }
      if (typeof value?.href === "string") {
        return new URL(value.href);
      }
    } catch {}
    return null;
  }

  function isExportableLocation(value) {
    const url = parseLocation(value);
    if (!url || !RECORD_ID_PATTERN.test(url.searchParams.get("id") ?? "")) {
      return false;
    }
    return !url.pathname.toLowerCase().endsWith("/custlist.nl");
  }

  function normalizeRequestDetail(value) {
    if (
      !value
      || typeof value !== "object"
      || !REQUEST_ID_PATTERN.test(String(value.requestId ?? ""))
    ) {
      return null;
    }
    const mode = value.mode ?? "export";
    if (!["export", "template", "exportView"].includes(mode)) {
      return null;
    }
    return Object.freeze({
      requestId: String(value.requestId),
      mode
    });
  }

  function normalizeResultDetail(value, expectedRequestId = "") {
    if (
      !value
      || typeof value !== "object"
      || !REQUEST_ID_PATTERN.test(String(value.requestId ?? ""))
      || (expectedRequestId && value.requestId !== expectedRequestId)
      || typeof value.ok !== "boolean"
    ) {
      return null;
    }

    if (!value.ok) {
      return Object.freeze({
        ok: false,
        requestId: String(value.requestId),
        error: Object.freeze({
          code: boundedText(value.error?.code, "CSV_EXPORT_FAILED"),
          message: boundedText(value.error?.message, "The CSV export failed.")
        })
      });
    }

    if (!["export", "template", "exportView"].includes(value.mode)) {
      return null;
    }
    const rowCount = Number(value.rowCount);
    const columnCount = Number(value.columnCount);
    if (
      value.mode === "template"
      && (!Number.isSafeInteger(rowCount) || rowCount !== 0)
    ) {
      return null;
    }
    return Object.freeze({
      ok: true,
      requestId: String(value.requestId),
      filename: createFilename(value.filename),
      recordType: boundedText(value.recordType),
      sublistId: boundedText(value.sublistId),
      mode: value.mode,
      rowCount: Number.isSafeInteger(rowCount) && rowCount >= 0 ? rowCount : 0,
      columnCount: Number.isSafeInteger(columnCount) && columnCount >= 0 ? columnCount : 0
    });
  }

  const api = Object.freeze({
    VERSION,
    REQUEST_EVENT,
    RESULT_EVENT,
    ACTION_ID,
    ACTION_SELECTOR,
    TEMPLATE_ACTION_SELECTOR,
    CANDIDATE_SUBLISTS,
    toCellText: safeValueToText,
    protectCsvValue,
    escapeCsvValue,
    serializeCsv,
    removeEmptyColumns,
    makeUniqueHeaders,
    readViewSnapshot,
    sanitizeFilenamePart,
    createFilename,
    createTemplateFilename,
    isExportableLocation,
    normalizeRequestDetail,
    normalizeResultDetail
  });

  const existing = globalScope.SuiteMateV3CsvExportCore;
  if (existing?.VERSION === VERSION) {
    return;
  }
  if (existing !== undefined) {
    return;
  }
  Object.defineProperty(globalScope, "SuiteMateV3CsvExportCore", {
    value: api,
    configurable: false,
    enumerable: true,
    writable: false
  });
})(globalThis);
