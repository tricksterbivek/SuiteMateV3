(function registerSuiteMateV3SuiteQLCore(globalScope) {
  "use strict";

  const routeApi = globalScope.SuiteMateV3Routes;
  const MESSAGE_TYPES = Object.freeze({
    START: "SUITEMATE_V3_SUITEQL_START",
    PAGE: "SUITEMATE_V3_SUITEQL_PAGE",
    DISPOSE: "SUITEMATE_V3_SUITEQL_DISPOSE"
  });
  const STUDIO_PATH = routeApi.PATHS.SUITEQL_CONSOLE;
  const MAX_QUERY_LENGTH = 100000;
  const NETSUITE_PAGE_SIZE = 1000;
  const CLIENT_PAGE_SIZE = 250;
  const SESSION_KEYS = Object.freeze({
    draft: "suiteMateV3.suiteql.draft",
    paged: "suiteMateV3.suiteql.paged",
    editorHeight: "suiteMateV3.suiteql.editorHeight"
  });

  function isAllowedNetSuiteUrl(value) {
    return routeApi.isAllowedNetSuiteUrl(value);
  }

  function isSuiteQLStudioUrl(value) {
    return routeApi.supports(
      routeApi.CAPABILITIES.SUITEQL_CONSOLE,
      routeApi.createPageContext(value, { isTopFrame: true })
    );
  }

  function isAllowedStudioSender(sender) {
    return routeApi.isAllowedSender(sender, routeApi.CAPABILITIES.SUITEQL_BRIDGE);
  }

  function createStudioUrl(value) {
    const url = routeApi.parseUrl(value);
    if (!url || !isAllowedNetSuiteUrl(url.href)) {
      return null;
    }

    url.pathname = STUDIO_PATH;
    url.search = "?suiteql";
    url.hash = "";
    return url.href;
  }

  function stripSqlCommentsAndStrings(value) {
    const source = String(value ?? "");
    let output = "";
    let state = "normal";

    for (let index = 0; index < source.length; index++) {
      const character = source[index];
      const next = source[index + 1];

      if (state === "line-comment") {
        if (character === "\n" || character === "\r") {
          output += character;
          state = "normal";
        } else {
          output += " ";
        }
        continue;
      }
      if (state === "block-comment") {
        output += character === "\n" || character === "\r" ? character : " ";
        if (character === "*" && next === "/") {
          output += " ";
          index++;
          state = "normal";
        }
        continue;
      }
      if (state === "single-quote") {
        output += " ";
        if (character === "'" && next === "'") {
          output += " ";
          index++;
        } else if (character === "'") {
          state = "normal";
        }
        continue;
      }
      if (state === "double-quote") {
        output += " ";
        if (character === '"' && next === '"') {
          output += " ";
          index++;
        } else if (character === '"') {
          state = "normal";
        }
        continue;
      }

      if (character === "-" && next === "-") {
        output += "  ";
        index++;
        state = "line-comment";
      } else if (character === "/" && next === "*") {
        output += "  ";
        index++;
        state = "block-comment";
      } else if (character === "'") {
        output += " ";
        state = "single-quote";
      } else if (character === '"') {
        output += " ";
        state = "double-quote";
      } else {
        output += character;
      }
    }

    return output;
  }

  function validateQuery(value) {
    if (typeof value !== "string") {
      return { valid: false, code: "INVALID_QUERY", message: "SuiteQL must be text." };
    }

    const query = value.trim();
    if (!query) {
      return { valid: false, code: "EMPTY_QUERY", message: "Enter a SuiteQL query." };
    }
    if (query.length > MAX_QUERY_LENGTH) {
      return {
        valid: false,
        code: "QUERY_TOO_LARGE",
        message: `SuiteQL is limited to ${MAX_QUERY_LENGTH.toLocaleString()} characters.`
      };
    }

    const comparable = stripSqlCommentsAndStrings(query).trimStart();
    if (!/^(?:select|with)\b/i.test(comparable)) {
      return {
        valid: false,
        code: "READ_ONLY_QUERY_REQUIRED",
        message: "Core Studio accepts read-only SELECT or WITH queries only."
      };
    }
    const withoutTrailingTerminator = comparable.replace(/;\s*$/, "");
    if (withoutTrailingTerminator.includes(";")) {
      return {
        valid: false,
        code: "MULTIPLE_STATEMENTS_NOT_ALLOWED",
        message: "Run one read-only SuiteQL statement at a time."
      };
    }

    return { valid: true, query };
  }

  function hasOrderBy(value) {
    return /\border\s+by\b/i.test(stripSqlCommentsAndStrings(String(value ?? "")));
  }

  function normalizeError(value) {
    const error = value && typeof value === "object" ? value : {};
    const message = [error.message, error.description, error.details, error.detail]
      .find((candidate) => typeof candidate === "string" && candidate.trim());
    const details = [error.details, error.detail, error.stack]
      .find((candidate) => typeof candidate === "string" && candidate.trim() && candidate !== message);

    return {
      code: String(error.code || error.name || "SUITEQL_ERROR"),
      message: message?.trim() || String(value || "SuiteQL execution failed."),
      details: details?.trim() || ""
    };
  }

  function normalizeResponse(value, fallbackRequestId = "") {
    if (!value || typeof value !== "object" || value.ok !== true) {
      return {
        ok: false,
        requestId: String(value?.requestId || fallbackRequestId),
        error: normalizeError(value?.error || value || { message: "SuiteQL returned no response." })
      };
    }

    const rows = Array.isArray(value.rows) ? value.rows : [];
    return {
      ok: true,
      requestId: String(value.requestId || fallbackRequestId),
      columns: Array.isArray(value.columns) ? value.columns.map(String) : [],
      rows,
      elapsedMs: Math.max(0, Number(value.elapsedMs) || 0),
      paged: value.paged === true,
      pageIndex: Math.max(0, Number(value.pageIndex) || 0),
      pageSize: Math.max(0, Number(value.pageSize) || 0),
      loadedCount: Math.max(0, Number(value.loadedCount) || rows.length),
      totalCount: Math.max(0, Number(value.totalCount) || rows.length),
      totalPages: Math.max(0, Number(value.totalPages) || (rows.length ? 1 : 0))
    };
  }

  function valueType(value) {
    if (value === null || value === undefined) {
      return "null";
    }
    if (typeof value === "number" || typeof value === "bigint") {
      return "number";
    }
    if (typeof value === "boolean") {
      return "boolean";
    }
    if (typeof value === "object") {
      return "object";
    }
    return "string";
  }

  function displayValue(value) {
    if (value === null || value === undefined) {
      return "null";
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  function compareValues(left, right) {
    const leftNull = left === null || left === undefined;
    const rightNull = right === null || right === undefined;
    if (leftNull || rightNull) {
      return leftNull === rightNull ? 0 : leftNull ? 1 : -1;
    }

    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }
    if (typeof left === "boolean" && typeof right === "boolean") {
      return Number(left) - Number(right);
    }
    return displayValue(left).localeCompare(displayValue(right), undefined, {
      numeric: true,
      sensitivity: "base"
    });
  }

  function sortRows(rows, column, direction = "asc") {
    const multiplier = direction === "desc" ? -1 : 1;
    return [...rows].sort((left, right) => {
      const leftValue = left?.[column];
      const rightValue = right?.[column];
      const leftNull = leftValue === null || leftValue === undefined;
      const rightNull = rightValue === null || rightValue === undefined;
      if (leftNull || rightNull) {
        return leftNull === rightNull ? 0 : leftNull ? 1 : -1;
      }
      return compareValues(leftValue, rightValue) * multiplier;
    });
  }

  function getClientPage(rows, pageIndex, pageSize = CLIENT_PAGE_SIZE) {
    const safePageSize = Math.max(1, Number(pageSize) || CLIENT_PAGE_SIZE);
    const totalPages = Math.max(1, Math.ceil(rows.length / safePageSize));
    const safePageIndex = Math.min(Math.max(0, Number(pageIndex) || 0), totalPages - 1);
    const start = safePageIndex * safePageSize;
    return {
      rows: rows.slice(start, start + safePageSize),
      pageIndex: safePageIndex,
      pageSize: safePageSize,
      totalPages,
      start,
      end: Math.min(start + safePageSize, rows.length)
    };
  }

  function protectCsvValue(value) {
    const text = displayValue(value);
    if (typeof value === "string" && /^[\t\r\n ]*[=+\-@]/.test(text)) {
      return `'${text}`;
    }
    return text;
  }

  function escapeCsvValue(value) {
    const text = protectCsvValue(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function toCsv(columns, rows) {
    return [
      columns.map(escapeCsvValue).join(","),
      ...rows.map((row) => columns.map((column) => escapeCsvValue(row?.[column])).join(","))
    ].join("\r\n");
  }

  function sanitizeFilenamePart(value, fallback = "account") {
    const sanitized = String(value ?? "")
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return sanitized || fallback;
  }

  function createExportFilename(accountId, date = new Date()) {
    const timestamp = date.toISOString().replace(/[:.]/g, "-");
    return `SuiteQL-${sanitizeFilenamePart(accountId)}-${timestamp}.csv`;
  }

  globalScope.SuiteMateV3SuiteQLCore = Object.freeze({
    MESSAGE_TYPES,
    STUDIO_PATH,
    MAX_QUERY_LENGTH,
    NETSUITE_PAGE_SIZE,
    CLIENT_PAGE_SIZE,
    SESSION_KEYS,
    isAllowedNetSuiteUrl,
    isSuiteQLStudioUrl,
    isAllowedStudioSender,
    createStudioUrl,
    stripSqlCommentsAndStrings,
    validateQuery,
    hasOrderBy,
    normalizeError,
    normalizeResponse,
    valueType,
    displayValue,
    sortRows,
    getClientPage,
    protectCsvValue,
    escapeCsvValue,
    toCsv,
    sanitizeFilenamePart,
    createExportFilename
  });
})(globalThis);
