(function registerSuiteMateV3Utilities(globalScope) {
  "use strict";

  const VERSION = 1;
  const MAX_ERROR_CODE_LENGTH = 128;
  const MAX_ERROR_MESSAGE_LENGTH = 4000;
  const MAX_ERROR_DETAILS_LENGTH = 12000;
  const MAX_FORMAT_BYTES = 1000000;
  const FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/;

  if (globalScope.SuiteMateV3Utilities?.VERSION === VERSION) {
    return;
  }
  if (globalScope.SuiteMateV3Utilities !== undefined) {
    return;
  }

  function isObjectLike(value) {
    return value !== null && (typeof value === "object" || typeof value === "function");
  }

  function isFreezableContainer(value) {
    if (!isObjectLike(value)) {
      return false;
    }
    try {
      const prototype = Object.getPrototypeOf(value);
      return Array.isArray(value)
        || prototype === Object.prototype
        || prototype === null
        || Object.prototype.toString.call(value) === "[object Object]";
    } catch {
      return false;
    }
  }

  function deepFreeze(value, seen = new Set()) {
    if (!isFreezableContainer(value) || seen.has(value)) {
      return value;
    }
    seen.add(value);
    let descriptors;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return value;
    }
    for (const descriptor of Object.values(descriptors)) {
      if (Object.hasOwn(descriptor, "value")) {
        deepFreeze(descriptor.value, seen);
      }
    }
    try {
      return Object.freeze(value);
    } catch {
      return value;
    }
  }

  function safeString(value, fallback = "") {
    try {
      return String(value ?? fallback);
    } catch {
      return String(fallback);
    }
  }

  function boundedText(value, maximum, fallback = "") {
    return safeString(value, fallback).trim().slice(0, maximum);
  }

  function safeRead(value, key) {
    if (!isObjectLike(value)) {
      return undefined;
    }
    try {
      return value[key];
    } catch {
      return undefined;
    }
  }

  function normalizeHexColor(value) {
    if (typeof value !== "string") {
      return null;
    }
    const compact = value.trim().replace(/^#/, "");
    const expanded = /^[0-9a-f]{3}$/i.test(compact)
      ? compact.replace(/(.)/g, "$1$1")
      : compact;
    return /^[0-9a-f]{6}$/i.test(expanded) ? `#${expanded.toLowerCase()}` : null;
  }

  function utf8ByteLength(value) {
    const text = safeString(value);
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          index += 1;
        } else {
          bytes += 3;
        }
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  function normalizeError(value, options = {}) {
    const fallbackCode = boundedText(options.fallbackCode || "ERROR", MAX_ERROR_CODE_LENGTH, "ERROR") || "ERROR";
    const fallbackMessage = boundedText(
      options.fallbackMessage || "The operation failed.",
      MAX_ERROR_MESSAGE_LENGTH,
      "The operation failed."
    ) || "The operation failed.";
    const name = safeRead(value, "name");
    const namedCode = typeof name === "string" && name !== "Error" ? name : "";
    const rawCode = safeRead(value, "code") || namedCode || fallbackCode;
    const messageCandidates = [
      safeRead(value, "message"),
      safeRead(value, "description"),
      safeRead(value, "details"),
      safeRead(value, "detail")
    ];
    const message = messageCandidates
      .find((candidate) => typeof candidate === "string" && candidate.trim());
    const detailCandidates = [safeRead(value, "details"), safeRead(value, "detail")];
    if (options.includeStack === true) {
      detailCandidates.push(safeRead(value, "stack"));
    }
    const details = detailCandidates.find((candidate) =>
      typeof candidate === "string" && candidate.trim() && candidate !== message);
    const primitiveMessage = !isObjectLike(value) ? boundedText(value, MAX_ERROR_MESSAGE_LENGTH) : "";

    return Object.freeze({
      code: boundedText(rawCode, MAX_ERROR_CODE_LENGTH, fallbackCode) || fallbackCode,
      message: boundedText(message || primitiveMessage || fallbackMessage, MAX_ERROR_MESSAGE_LENGTH, fallbackMessage)
        || fallbackMessage,
      details: boundedText(details || "", MAX_ERROR_DETAILS_LENGTH)
    });
  }

  function valueToText(value, nullValue = "") {
    if (value === null || value === undefined) {
      return nullValue;
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
    return safeString(value);
  }

  function protectCsvValue(value, options = {}) {
    const text = valueToText(value, options.nullValue ?? "");
    return typeof value === "string" && FORMULA_PREFIX.test(text) ? `'${text}` : text;
  }

  function escapeCsvValue(value, options = {}) {
    const text = protectCsvValue(value, options);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function toCsv(rows, options = {}) {
    if (!Array.isArray(rows)) {
      return "";
    }
    return rows
      .map((row) => (Array.isArray(row) ? row : [row])
        .map((value) => escapeCsvValue(value, options))
        .join(","))
      .join("\r\n");
  }

  function sanitizeFilenamePart(value, fallback = "file") {
    const safeFallback = safeString(fallback, "file") || "file";
    const sanitized = safeString(value)
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return sanitized || safeFallback.slice(0, 80);
  }

  function sanitizeDownloadFilename(value, fallback = "download.txt") {
    function sanitize(valueToSanitize) {
      const source = safeString(valueToSanitize).split(/[\\/]/).pop() || "";
      return source
        .trim()
        .replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, "-")
        .replace(/\.{2,}/g, ".")
        .replace(/^[. -]+|[. -]+$/g, "")
        .slice(0, 160);
    }
    return sanitize(value) || sanitize(fallback) || "download.txt";
  }

  function syntaxResult(ok, language, text, error = null) {
    return Object.freeze({ ok, language, text, error });
  }

  function formatJson(value, options = {}) {
    const maximumBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
      ? Math.min(options.maxBytes, MAX_FORMAT_BYTES)
      : MAX_FORMAT_BYTES;
    const indentation = Number.isInteger(options.indentation)
      ? Math.min(8, Math.max(0, options.indentation))
      : 2;
    let parsed = value;

    if (typeof value === "string") {
      if (utf8ByteLength(value) > maximumBytes) {
        return syntaxResult(false, "json", "", normalizeError({
          code: "FORMAT_INPUT_TOO_LARGE",
          message: `JSON formatting is limited to ${maximumBytes.toLocaleString()} bytes.`
        }));
      }
      try {
        parsed = JSON.parse(value);
      } catch (error) {
        return syntaxResult(false, "json", "", normalizeError({
          code: "INVALID_JSON",
          message: "The value is not valid JSON.",
          details: safeRead(error, "message")
        }));
      }
    }

    try {
      const text = JSON.stringify(parsed, null, indentation);
      if (text === undefined) {
        return syntaxResult(false, "json", "", normalizeError({
          code: "UNSUPPORTED_JSON_VALUE",
          message: "The value cannot be represented as JSON."
        }));
      }
      if (utf8ByteLength(text) > maximumBytes) {
        return syntaxResult(false, "json", "", normalizeError({
          code: "FORMAT_OUTPUT_TOO_LARGE",
          message: `Formatted JSON is limited to ${maximumBytes.toLocaleString()} bytes.`
        }));
      }
      return syntaxResult(true, "json", text);
    } catch (error) {
      return syntaxResult(false, "json", "", normalizeError({
        code: "JSON_FORMAT_FAILED",
        message: "JSON formatting failed.",
        details: safeRead(error, "message")
      }));
    }
  }

  const api = Object.freeze({
    VERSION,
    LIMITS: Object.freeze({
      MAX_ERROR_CODE_LENGTH,
      MAX_ERROR_MESSAGE_LENGTH,
      MAX_ERROR_DETAILS_LENGTH,
      MAX_FORMAT_BYTES
    }),
    deepFreeze,
    safeString,
    normalizeHexColor,
    utf8ByteLength,
    normalizeError,
    valueToText,
    csv: Object.freeze({
      protectValue: protectCsvValue,
      escapeValue: escapeCsvValue,
      serialize: toCsv
    }),
    files: Object.freeze({
      sanitizePart: sanitizeFilenamePart,
      sanitizeDownloadName: sanitizeDownloadFilename
    }),
    syntax: Object.freeze({
      formatJson
    })
  });

  Object.defineProperty(globalScope, "SuiteMateV3Utilities", {
    value: api,
    configurable: false,
    enumerable: true,
    writable: false
  });
})(globalThis);
