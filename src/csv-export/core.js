(function defineSuiteMateV3CsvExportCore(globalScope) {
  "use strict";

  const VERSION = 1;
  const REQUEST_EVENT = "suitemate:v3:csv-export:request";
  const RESULT_EVENT = "suitemate:v3:csv-export:result";
  const ACTION_ID = "suitemate-v3-export-csv";
  const ACTION_SELECTOR = '[data-suitemate-v3-action="csv-export"]';
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
    if (typeof value === "object") {
      try {
        const serialized = JSON.stringify(value);
        if (serialized !== undefined) {
          return serialized;
        }
      } catch {}
    }
    try {
      return String(value);
    } catch {
      return "";
    }
  }

  function protectCsvValue(value) {
    const text = safeValueToText(value);
    return typeof value === "string" && FORMULA_PREFIX.test(text) ? `'${text}` : text;
  }

  function escapeCsvValue(value) {
    const text = protectCsvValue(value);
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

  function normalizeFieldDescriptor(value) {
    const fieldId = boundedText(value?.fieldId).toLowerCase();
    const label = boundedText(value?.label, fieldId || "Field");
    return fieldId ? Object.freeze({ fieldId, label }) : null;
  }

  function makeUniqueHeaders(descriptors) {
    if (!Array.isArray(descriptors)) {
      return Object.freeze([]);
    }

    const normalized = descriptors.map(normalizeFieldDescriptor);
    const labelCounts = new Map();
    for (const descriptor of normalized) {
      if (descriptor) {
        labelCounts.set(descriptor.label, (labelCounts.get(descriptor.label) ?? 0) + 1);
      }
    }

    const used = new Map();
    return Object.freeze(normalized.map((descriptor, index) => {
      if (!descriptor) {
        return `Column ${index + 1}`;
      }
      const base = labelCounts.get(descriptor.label) > 1
        ? `${descriptor.label} [${descriptor.fieldId}]`
        : descriptor.label;
      const count = (used.get(base) ?? 0) + 1;
      used.set(base, count);
      return count === 1 ? base : `${base} ${count}`;
    }));
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
    return Object.freeze({ requestId: String(value.requestId) });
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

    const rowCount = Number(value.rowCount);
    const columnCount = Number(value.columnCount);
    return Object.freeze({
      ok: true,
      requestId: String(value.requestId),
      filename: createFilename(value.filename),
      recordType: boundedText(value.recordType),
      sublistId: boundedText(value.sublistId),
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
    CANDIDATE_SUBLISTS,
    protectCsvValue,
    escapeCsvValue,
    serializeCsv,
    makeUniqueHeaders,
    sanitizeFilenamePart,
    createFilename,
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
