(function defineSuiteMateV3NetSuiteDataAdapter(globalScope) {
  "use strict";

  const VERSION = 1;
  const OPERATIONS = Object.freeze({
    SUITEQL_START: "suiteql.start",
    SUITEQL_PAGE: "suiteql.page",
    SUITEQL_DISPOSE: "suiteql.dispose",
    SEARCH_RUN: "search.run",
    RECORD_DESCRIBE: "record.describe",
    RECORD_GET_TYPE: "record.getType",
    IMPORT_ASSISTANT_SET_VALUES: "importAssistant.setValues",
    IMPORT_ASSISTANT_RESOLVE_CATEGORY: "importAssistant.resolveCategory"
  });
  const OPERATION_VALUES = Object.freeze(Object.values(OPERATIONS));
  const CANCEL_OPERATION = "adapter.cancel";

  async function executeMainWorldOperation(envelope) {
    const operationValues = [
      "suiteql.start",
      "suiteql.page",
      "suiteql.dispose",
      "search.run",
      "record.describe",
      "record.getType",
      "importAssistant.setValues",
      "importAssistant.resolveCategory",
      "adapter.cancel"
    ];
    const IMPORT_ASSISTANT_PATH = "/app/setup/assistants/nsimport/importassistant.nl";
    const SUITEQL_BRIDGE_PATH = "/app/common/scripting/PlatformClientScriptHandler.nl";
    const SEARCH_BRIDGE_PATH = "/app/common/scripting/nlapijsonhandler.nl";
    const MAX_SUITEQL_RESPONSE_CHARS = 50000000;
    const MAX_SEARCH_RESPONSE_CHARS = 10000000;
    const MAX_IMPORT_RESPONSE_CHARS = 2000000;
    const stateKey = Symbol.for("suitemate.v3.netsuite.data-adapter");
    const state = window[stateKey] ??= {
      version: 1,
      suiteqlSessions: new Map(),
      controllers: new Map(),
      canceled: new Set()
    };

    if (document?.documentElement?.dataset) {
      document.documentElement.dataset.suitemateV3DataAdapter = "1";
    }

    function normalizeError(value, fallbackCode = "NETSUITE_ADAPTER_ERROR") {
      const error = value && typeof value === "object" ? value : {};
      const message = error.message
        || error.description
        || error.details
        || error.detail
        || String(value || "NetSuite data request failed.");
      return {
        code: String(error.code || error.name || fallbackCode),
        message: String(message),
        details: String(error.details || error.detail || "")
      };
    }

    function success(data) {
      return {
        ok: true,
        requestId: envelope.requestId,
        data
      };
    }

    function failure(error) {
      return {
        ok: false,
        requestId: envelope.requestId,
        error: normalizeError(error)
      };
    }

    function registerController(requestId, controller) {
      const controllers = state.controllers.get(requestId) ?? new Set();
      controllers.add(controller);
      state.controllers.set(requestId, controllers);
    }

    function releaseController(requestId, controller) {
      const controllers = state.controllers.get(requestId);
      controllers?.delete(controller);
      if (!controllers?.size) {
        state.controllers.delete(requestId);
      }
    }

    function cancelRequest(requestId) {
      state.canceled.add(requestId);
      const controllers = state.controllers.get(requestId);
      for (const controller of controllers ?? []) {
        controller.abort();
      }
      state.controllers.delete(requestId);
      return Boolean(controllers?.size);
    }

    function abortRequestControllers(requestId) {
      const controllers = state.controllers.get(requestId);
      for (const controller of controllers ?? []) {
        controller.abort();
      }
      state.controllers.delete(requestId);
    }

    function ensureActive(requestId, message) {
      if (state.canceled.has(requestId)) {
        throw {
          code: "ABORTED",
          message: message || "NetSuite data request was stopped."
        };
      }
    }

    function readContentLength(response) {
      const rawValue = response?.headers?.get?.("content-length");
      if (rawValue === null || rawValue === undefined || rawValue === "") {
        return null;
      }
      const value = Number(rawValue);
      return Number.isFinite(value) && value >= 0 ? value : null;
    }

    function ensureSameAccountResponse(response, requestedUrl) {
      if (!response?.url) {
        return;
      }
      let responseUrl;
      try {
        responseUrl = new URL(response.url, location.origin);
      } catch {
        throw {
          code: "INVALID_NETSUITE_RESPONSE_URL",
          message: "NetSuite returned an invalid response URL."
        };
      }
      if (responseUrl.origin !== location.origin) {
        throw {
          code: "CROSS_ACCOUNT_RESPONSE",
          message: "NetSuite redirected the request outside the active account."
        };
      }
      if (/\/(?:app\/)?login\//i.test(responseUrl.pathname)) {
        throw {
          code: "NETSUITE_LOGIN_REQUIRED",
          message: "The NetSuite session expired. Log in and try again."
        };
      }
      const expectedPath = new URL(requestedUrl, location.origin).pathname;
      if (responseUrl.pathname !== expectedPath) {
        throw {
          code: "UNEXPECTED_NETSUITE_RESPONSE_PATH",
          message: "NetSuite redirected the request to an unexpected page."
        };
      }
    }

    async function readBoundedText(response, maxBytes) {
      const reader = response?.body?.getReader?.();
      if (!reader || typeof TextDecoder !== "function") {
        const text = await response.text();
        if (text.length > maxBytes) {
          throw {
            code: "NETSUITE_RESPONSE_TOO_LARGE",
            message: "NetSuite returned more data than this adapter operation permits."
          };
        }
        return text;
      }

      const decoder = new TextDecoder();
      const chunks = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw {
            code: "NETSUITE_RESPONSE_TOO_LARGE",
            message: "NetSuite returned more data than this adapter operation permits."
          };
        }
        chunks.push(decoder.decode(chunk, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join("");
    }

    async function fetchText({
      requestId,
      url,
      options,
      maxChars,
      timeoutMs,
      timeoutCode,
      timeoutMessage,
      abortedMessage
    }) {
      ensureActive(requestId, abortedMessage);
      const controller = new AbortController();
      registerController(requestId, controller);
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetch(url, {
          ...options,
          credentials: "include",
          redirect: "error",
          signal: controller.signal
        });
        ensureSameAccountResponse(response, url);
        const contentLength = readContentLength(response);
        if (contentLength !== null && contentLength > maxChars) {
          throw {
            code: "NETSUITE_RESPONSE_TOO_LARGE",
            message: "NetSuite returned more data than this adapter operation permits."
          };
        }
        const text = await readBoundedText(response, maxChars);
        if (!response.ok) {
          throw {
            code: `NETSUITE_HTTP_${response.status}`,
            message: text || `NetSuite returned HTTP ${response.status}.`
          };
        }
        ensureActive(requestId, abortedMessage);
        return text;
      } catch (error) {
        if (timedOut) {
          throw { code: timeoutCode, message: timeoutMessage };
        }
        if (state.canceled.has(requestId) || error?.name === "AbortError") {
          throw { code: "ABORTED", message: abortedMessage };
        }
        if (error?.name === "TypeError" && !error?.code) {
          throw {
            code: "NETSUITE_REQUEST_BLOCKED",
            message: "NetSuite blocked or redirected the authenticated request. Confirm the session is active and try again.",
            details: String(error.message || "")
          };
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
        releaseController(requestId, controller);
      }
    }

    function uniqueColumnNames(rawNames) {
      const counts = new Map();
      return rawNames.map((rawName, index) => {
        const base = String(rawName || `column_${index + 1}`).trim() || `column_${index + 1}`;
        const count = (counts.get(base) || 0) + 1;
        counts.set(base, count);
        return count === 1 ? base : `${base}_${count}`;
      });
    }

    function serializeSuiteQLRows(result, existingColumns) {
      const aliases = Array.isArray(result?.aliases) ? result.aliases : [];
      if (aliases.length > 1000) {
        throw {
          code: "INVALID_BRIDGE_RESPONSE",
          message: "NetSuite returned too many SuiteQL columns."
        };
      }
      const columns = Array.isArray(existingColumns) && existingColumns.length
        ? existingColumns
        : uniqueColumnNames(aliases);
      const declaredCount = Number(result?.count);
      const indexedRows = Object.keys(result || {})
        .filter((key) => /^v\d+$/.test(key))
        .map((key) => Number(key.slice(1)))
        .filter(Number.isInteger);
      const count = Number.isFinite(declaredCount)
        ? Math.max(0, declaredCount)
        : indexedRows.length
          ? Math.max(...indexedRows) + 1
          : 0;
      if (count > 5000) {
        throw {
          code: "INVALID_BRIDGE_RESPONSE",
          message: "NetSuite returned too many rows in one SuiteQL response page."
        };
      }
      const rows = Array.from({ length: count }, (_, rowIndex) => {
        const values = Array.isArray(result?.[`v${rowIndex}`]) ? result[`v${rowIndex}`] : [];
        return Object.fromEntries(
          columns.map((column, columnIndex) => [column, values[columnIndex] ?? null])
        );
      });
      return { columns, rows };
    }

    function extractOnlineError(text) {
      const readTag = (name) => {
        const match = String(text).match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"));
        return match?.[1]
          ?.replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .trim() || "";
      };
      return {
        code: readTag("code") || "NETSUITE_HTTP_ERROR",
        message: readTag("detail")
          || readTag("description")
          || String(text || "NetSuite rejected the SuiteQL request."),
        details: readTag("description")
      };
    }

    async function callSuiteQLBridge(operation, operationArguments) {
      const responseText = await fetchText({
        requestId: envelope.requestId,
        url: SUITEQL_BRIDGE_PATH,
        options: {
          method: "POST",
          headers: {
            accept: "*/*",
            "accept-language": navigator.language || "en-US",
            "cache-control": "no-cache",
            nsxmlhttprequest: "NSXMLHttpRequest",
            pragma: "no-cache"
          },
          referrerPolicy: "no-referrer-when-downgrade",
          mode: "cors",
          body: JSON.stringify({
            method: "remoteObject.bridgeCall",
            params: ["queryApiBridge", operation, JSON.stringify(operationArguments)]
          })
        },
        maxChars: MAX_SUITEQL_RESPONSE_CHARS,
        timeoutMs: 120000,
        timeoutCode: "QUERY_TIMEOUT",
        timeoutMessage: "SuiteQL did not finish within two minutes.",
        abortedMessage: "SuiteQL execution was stopped."
      }).catch((error) => {
        if (
          typeof error?.message === "string"
          && error.code?.startsWith?.("NETSUITE_HTTP_")
          && error.message.includes("<onlineError>")
        ) {
          throw extractOnlineError(error.message);
        }
        throw error;
      });

      let decoded;
      try {
        decoded = JSON.parse(responseText);
      } catch {
        throw {
          code: "INVALID_BRIDGE_RESPONSE",
          message: "NetSuite returned an unreadable SuiteQL response.",
          details: responseText.slice(0, 500)
        };
      }
      if (!decoded || typeof decoded !== "object") {
        throw {
          code: "INVALID_BRIDGE_RESPONSE",
          message: "NetSuite returned an empty SuiteQL response."
        };
      }
      if (decoded.result === "error") {
        throw decoded.error || {
          code: "SUITEQL_ERROR",
          message: "NetSuite rejected the SuiteQL query."
        };
      }
      if (!("result" in decoded)) {
        if (decoded.code || decoded.details) {
          throw decoded;
        }
        throw {
          code: "INVALID_BRIDGE_RESPONSE",
          message: "NetSuite returned an unrecognized SuiteQL response."
        };
      }
      return decoded.result && typeof decoded.result === "object" && "result" in decoded.result
        ? decoded.result.result
        : decoded.result;
    }

    function elapsedSince(startedAt) {
      return Math.max(0, Math.round(performance.now() - startedAt));
    }

    async function startSuiteQL() {
      state.suiteqlSessions.clear();
      const startedAt = performance.now();
      const queryOptions = ["[]", "SUITE_QL", ""];
      if (!envelope.payload.paged) {
        const result = await callSuiteQLBridge(
          "runSuiteQL",
          [envelope.payload.query, ...queryOptions]
        );
        const serialized = serializeSuiteQLRows(result);
        return {
          ...serialized,
          elapsedMs: elapsedSince(startedAt),
          paged: false,
          pageIndex: 0,
          pageSize: serialized.rows.length,
          loadedCount: serialized.rows.length,
          totalCount: serialized.rows.length,
          totalPages: serialized.rows.length ? 1 : 0
        };
      }

      const metadata = await callSuiteQLBridge(
        "suiteQLPagedQuery",
        [envelope.payload.pageSize, envelope.payload.query, ...queryOptions]
      );
      const pages = Array.isArray(metadata?.pages)
        ? metadata.pages
        : Array.isArray(metadata?.pageRanges)
          ? metadata.pageRanges
          : [];
      const declaredTotalPages = Number(metadata?.numPages ?? metadata?.totalPages);
      const totalPages = Number.isFinite(declaredTotalPages)
        ? Math.max(0, declaredTotalPages)
        : pages.length;
      const declaredTotalCount = Number(metadata?.count ?? metadata?.totalCount);
      const totalCount = Number.isFinite(declaredTotalCount)
        ? Math.max(0, declaredTotalCount)
        : 0;

      if (!totalPages || !pages.length) {
        return {
          columns: [],
          rows: [],
          elapsedMs: elapsedSince(startedAt),
          paged: true,
          pageIndex: 0,
          pageSize: envelope.payload.pageSize,
          loadedCount: 0,
          totalCount,
          totalPages: 0
        };
      }

      const firstPageResult = await callSuiteQLBridge(
        "getSuiteQLQueryPage",
        [pages[0], envelope.payload.query, ...queryOptions]
      );
      const serialized = serializeSuiteQLRows(firstPageResult);
      let effectiveTotalCount = totalCount || (totalPages === 1 ? serialized.rows.length : 0);
      if (!effectiveTotalCount && totalPages > 1 && pages[totalPages - 1]) {
        const lastPageResult = await callSuiteQLBridge("getSuiteQLQueryPage", [
          pages[totalPages - 1],
          envelope.payload.query,
          ...queryOptions
        ]);
        const lastPage = serializeSuiteQLRows(lastPageResult, serialized.columns);
        effectiveTotalCount = (totalPages - 1) * envelope.payload.pageSize + lastPage.rows.length;
      }
      state.suiteqlSessions.set(envelope.requestId, {
        query: envelope.payload.query,
        pages,
        columns: serialized.columns,
        pageSize: envelope.payload.pageSize,
        totalCount: effectiveTotalCount,
        totalPages,
        loadedPageRows: new Map([[0, serialized.rows.length]])
      });
      return {
        ...serialized,
        elapsedMs: elapsedSince(startedAt),
        paged: true,
        pageIndex: 0,
        pageSize: envelope.payload.pageSize,
        loadedCount: serialized.rows.length,
        totalCount: effectiveTotalCount,
        totalPages
      };
    }

    async function readSuiteQLPage() {
      const session = state.suiteqlSessions.get(envelope.requestId);
      if (!session) {
        throw {
          code: "SUITEQL_SESSION_EXPIRED",
          message: "The paged SuiteQL session expired. Run the query again."
        };
      }
      const pageIndex = envelope.payload.pageIndex;
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= session.pages.length) {
        throw { code: "INVALID_PAGE", message: "SuiteQL page index is invalid." };
      }

      const startedAt = performance.now();
      const result = await callSuiteQLBridge("getSuiteQLQueryPage", [
        session.pages[pageIndex],
        session.query,
        "[]",
        "SUITE_QL",
        ""
      ]);
      const serialized = serializeSuiteQLRows(result, session.columns);
      session.loadedPageRows.set(pageIndex, serialized.rows.length);
      const loadedCount = [...session.loadedPageRows.values()]
        .reduce((total, count) => total + count, 0);
      const totalCount = session.totalCount
        || (pageIndex === session.totalPages - 1 ? loadedCount : 0);
      if (totalCount) {
        session.totalCount = totalCount;
      }
      return {
        ...serialized,
        elapsedMs: elapsedSince(startedAt),
        paged: true,
        pageIndex,
        pageSize: session.pageSize,
        loadedCount,
        totalCount,
        totalPages: session.totalPages
      };
    }

    function parseJsonResponse(responseText, invalidCode, invalidMessage) {
      try {
        return JSON.parse(responseText);
      } catch {
        throw {
          code: invalidCode,
          message: invalidMessage,
          details: responseText.slice(0, 500)
        };
      }
    }

    async function runSearch() {
      const filters = envelope.payload.filters.map((filter) => ({
        javaClass: "java.util.HashMap",
        name: filter.field,
        operator: filter.operator,
        values: filter.values.length ? [...filter.values] : [""],
        join: null,
        formula: null,
        summarytype: null,
        isor: false,
        isnot: false,
        leftparens: 0,
        rightparens: 0
      }));
      const columns = envelope.payload.columns.map((column) => ({
        name: column.field,
        join: null,
        summary: null,
        label: null,
        type: null,
        functionid: null,
        formula: null,
        sortdir: null,
        whenorderedby: null,
        whenorderedbyjoin: null,
        userindex: 1
      }));
      const responseText = await fetchText({
        requestId: envelope.requestId,
        url: SEARCH_BRIDGE_PATH,
        options: {
          method: "POST",
          headers: {
            accept: "*/*",
            "accept-language": navigator.language || "en-US",
            "cache-control": "no-cache",
            nsxmlhttprequest: "NSXMLHttpRequest",
            pragma: "no-cache"
          },
          referrerPolicy: "no-referrer-when-downgrade",
          mode: "cors",
          body: JSON.stringify({
            method: "remoteObject.searchRecord",
            params: [envelope.payload.recordType, null, filters, columns]
          })
        },
        maxChars: MAX_SEARCH_RESPONSE_CHARS,
        timeoutMs: 30000,
        timeoutCode: "SEARCH_TIMEOUT",
        timeoutMessage: "NetSuite search did not finish within 30 seconds.",
        abortedMessage: "NetSuite search was stopped."
      }).catch((error) => {
        if (
          typeof error?.message === "string"
          && error.code?.startsWith?.("NETSUITE_HTTP_")
          && error.message.includes("<onlineError>")
        ) {
          throw extractOnlineError(error.message);
        }
        throw error;
      });
      const decoded = parseJsonResponse(
        responseText,
        "INVALID_SEARCH_RESPONSE",
        "NetSuite returned an unreadable search response."
      );
      if (!decoded || typeof decoded !== "object") {
        throw {
          code: "INVALID_SEARCH_RESPONSE",
          message: "NetSuite returned an empty search response."
        };
      }
      if (decoded.result === "error") {
        throw decoded.error || {
          code: "SEARCH_ERROR",
          message: "NetSuite rejected the search."
        };
      }
      if (!("result" in decoded)) {
        if (decoded.code || decoded.details) {
          throw decoded;
        }
        throw {
          code: "INVALID_SEARCH_RESPONSE",
          message: "NetSuite returned an unrecognized search response."
        };
      }

      if (
        !decoded.result
        || typeof decoded.result !== "object"
        || !Array.isArray(decoded.result.rows)
      ) {
        throw {
          code: "INVALID_SEARCH_RESPONSE",
          message: "NetSuite returned malformed search rows."
        };
      }
      const rawRows = decoded.result.rows;
      const limitedRows = rawRows.slice(0, envelope.payload.limit);
      return {
        columns: envelope.payload.columns.map((column, index) => ({
          key: `c${index}`,
          field: column.field
        })),
        rows: limitedRows.map((row) => {
          const cells = Array.isArray(row?.cells) ? row.cells : [];
          const cellsByName = new Map();
          for (const cell of cells) {
            const name = typeof cell?.name === "string" ? cell.name : "";
            if (name) {
              const namedCells = cellsByName.get(name) ?? [];
              namedCells.push(cell);
              cellsByName.set(name, namedCells);
            }
          }
          return {
            id: String(row?.id ?? ""),
            cells: envelope.payload.columns.map((column, index) => {
              const cell = cellsByName.get(column.field)?.shift() ?? cells[index] ?? {};
              const value = ["string", "number", "boolean"].includes(typeof cell.value)
                ? cell.value
                : cell.value == null
                  ? null
                  : String(cell.value);
              return {
                value,
                text: cell.text == null ? null : String(cell.text)
              };
            })
          };
        }),
        truncated: rawRows.length > envelope.payload.limit
      };
    }

    function describeRecord() {
      return new Promise((resolve, reject) => {
        const amdRequire = window.require;
        if (typeof amdRequire !== "function") {
          reject({
            code: "NETSUITE_MODULE_LOADER_UNAVAILABLE",
            message: "NetSuite's module loader is unavailable."
          });
          return;
        }
        amdRequire(["N/currentRecord"], (currentRecord) => {
          try {
            ensureActive(envelope.requestId, "Record metadata request was stopped.");
            const record = currentRecord.get();
            const fields = envelope.payload.fields.map(({ fieldId, sublistId }) => {
              let field = null;
              try {
                if (sublistId) {
                  let sublist;
                  try {
                    sublist = record.getSublist({ sublistId });
                  } catch {
                    sublist = record.getSublist(sublistId);
                  }
                  if (sublist) {
                    try {
                      field = sublist.getColumn({ fieldId });
                    } catch {
                      field = sublist.getColumn(fieldId);
                    }
                  }
                } else {
                  try {
                    field = record.getField({ fieldId });
                  } catch {
                    field = record.getField(fieldId);
                  }
                }
              } catch {}
              return {
                fieldId,
                sublistId: sublistId || null,
                exists: Boolean(field),
                label: field?.label == null ? null : String(field.label),
                type: field?.type == null ? null : String(field.type),
                disabled: Boolean(field?.isDisabled),
                readOnly: Boolean(field?.isReadOnly)
              };
            });
            resolve({
              recordType: record?.type == null
                ? typeof window.nlapiGetRecordType === "function"
                  ? window.nlapiGetRecordType()
                  : null
                : String(record.type),
              recordId: record?.id == null ? null : String(record.id),
              isReadOnly: Boolean(record?.isReadOnly),
              fields
            });
          } catch (error) {
            reject(error);
          }
        }, (error) => {
          reject({
            code: "CURRENT_RECORD_UNAVAILABLE",
            message: String(error?.message || error || "N/currentRecord could not be loaded.")
          });
        });
      });
    }

    function readRecordType() {
      try {
        return {
          recordType: typeof window.nlapiGetRecordType === "function"
            ? window.nlapiGetRecordType()
            : null
        };
      } catch (error) {
        throw {
          code: "RECORD_TYPE_UNAVAILABLE",
          message: String(error?.message || "NetSuite record type is unavailable.")
        };
      }
    }

    function setImportAssistantValues() {
      return new Promise((resolve, reject) => {
        const finish = (callback, value) => {
          callback(value);
        };
        try {
          ensureActive(envelope.requestId, "Import Assistant update was stopped.");
        } catch (error) {
          finish(reject, error);
          return;
        }

        const amdRequire = window.require;
        if (typeof amdRequire !== "function") {
          finish(reject, {
            code: "NETSUITE_MODULE_LOADER_UNAVAILABLE",
            message: "NetSuite's module loader is unavailable."
          });
          return;
        }
        amdRequire(["N/currentRecord"], (currentRecord) => {
          try {
            ensureActive(envelope.requestId, "Import Assistant update was stopped.");
            const record = currentRecord.get();
            const entries = Object.entries(envelope.payload.values);
            for (const [fieldId] of entries) {
              let field;
              try {
                field = record.getField({ fieldId });
              } catch {
                field = record.getField(fieldId);
              }
              if (!field) {
                throw {
                  code: "IMPORT_FIELD_UNAVAILABLE",
                  message: `Import Assistant field is unavailable: ${fieldId}.`
                };
              }
            }

            ensureActive(envelope.requestId, "Import Assistant update was stopped.");
            const applied = [];
            for (const [fieldId, value] of entries) {
              try {
                record.setValue({
                  fieldId,
                  value,
                  ignoreFieldChange: false,
                  forceSyncSourcing: true
                });
              } catch {
                record.setValue(fieldId, value);
              }
              applied.push(fieldId);
            }
            finish(resolve, { applied });
          } catch (error) {
            finish(reject, error);
          }
        }, (error) => {
          finish(reject, {
            code: "CURRENT_RECORD_UNAVAILABLE",
            message: String(error?.message || error || "N/currentRecord could not be loaded.")
          });
        });
      });
    }

    function responseContainsSubtype(responseText, recordSubtype) {
      return String(responseText ?? "")
        .split("\u0005")[0]
        .split("\u0001")
        .some((value, index) => index % 2 === 1 && value === recordSubtype);
    }

    async function resolveImportAssistantCategory() {
      if (location.pathname !== IMPORT_ASSISTANT_PATH) {
        throw {
          code: "INVALID_IMPORT_ASSISTANT_ROUTE",
          message: "CSV Import category lookup is restricted to the Import Assistant."
        };
      }
      const categories = envelope.payload.candidateCategories;
      let nextIndex = 0;
      let match = null;
      let firstFailure = null;
      const deadline = performance.now() + 55000;

      async function worker() {
        while (match === null) {
          ensureActive(envelope.requestId, "CSV Import category lookup was stopped.");
          const remainingMs = Math.round(deadline - performance.now());
          if (remainingMs <= 0) {
            throw {
              code: "IMPORT_CATEGORY_TIMEOUT",
              message: "CSV Import category lookup timed out."
            };
          }
          const index = nextIndex;
          nextIndex += 1;
          if (index >= categories.length) {
            return;
          }
          const category = categories[index];
          const url = new URL(IMPORT_ASSISTANT_PATH, location.origin);
          url.searchParams.set("importmethod", "filegroups");
          url.searchParams.set("rectype", category);
          try {
            const responseText = await fetchText({
              requestId: envelope.requestId,
              url: url.href,
              options: { method: "GET" },
              maxChars: MAX_IMPORT_RESPONSE_CHARS,
              timeoutMs: Math.min(15000, remainingMs),
              timeoutCode: "IMPORT_CATEGORY_TIMEOUT",
              timeoutMessage: "CSV Import category lookup timed out.",
              abortedMessage: "CSV Import category lookup was stopped."
            });
            if (responseContainsSubtype(responseText, envelope.payload.recordSubtype)) {
              match = category;
              abortRequestControllers(envelope.requestId);
              return;
            }
          } catch (error) {
            if (match !== null && error?.code === "ABORTED") {
              return;
            }
            if ([
              "ABORTED",
              "NETSUITE_LOGIN_REQUIRED",
              "CROSS_ACCOUNT_RESPONSE",
              "INVALID_NETSUITE_RESPONSE_URL",
              "UNEXPECTED_NETSUITE_RESPONSE_PATH",
              "NETSUITE_RESPONSE_TOO_LARGE",
              "IMPORT_CATEGORY_TIMEOUT"
            ].includes(error?.code)) {
              throw error;
            }
            firstFailure ??= error;
          }
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(4, categories.length) }, () => worker())
      );
      if (match === null && firstFailure) {
        throw firstFailure;
      }
      return { category: match };
    }

    if (window.location?.href !== envelope.expectedUrl) {
      return failure({
        code: "INVALID_MAIN_WORLD_DOCUMENT",
        message: "NetSuite page changed before the data adapter command could run."
      });
    }
    if (!operationValues.includes(envelope.operation)) {
      return failure({
        code: "UNKNOWN_ADAPTER_OPERATION",
        message: "NetSuite data adapter operation is not allowlisted."
      });
    }
    if (envelope.operation === "adapter.cancel") {
      const canceled = cancelRequest(envelope.targetRequestId);
      setTimeout(() => state.canceled.delete(envelope.targetRequestId), 130000);
      return success({ canceled });
    }
    if (envelope.operation === "suiteql.dispose") {
      cancelRequest(envelope.requestId);
      state.suiteqlSessions.delete(envelope.requestId);
      setTimeout(() => state.canceled.delete(envelope.requestId), 130000);
      return success({ disposed: true });
    }

    try {
      ensureActive(envelope.requestId);
      switch (envelope.operation) {
        case "suiteql.start":
          return success(await startSuiteQL());
        case "suiteql.page":
          return success(await readSuiteQLPage());
        case "search.run":
          return success(await runSearch());
        case "record.describe":
          return success(await describeRecord());
        case "record.getType":
          return success(readRecordType());
        case "importAssistant.setValues":
          return success(await setImportAssistantValues());
        case "importAssistant.resolveCategory":
          return success(await resolveImportAssistantCategory());
        default:
          throw {
            code: "UNKNOWN_ADAPTER_OPERATION",
            message: "NetSuite data adapter operation is not allowlisted."
          };
      }
    } catch (error) {
      return failure(error);
    }
  }

  function create({ scripting }) {
    if (typeof scripting?.executeScript !== "function") {
      throw new TypeError("Chrome scripting execution is required.");
    }

    function createTarget(senderContext) {
      if (!senderContext.documentId) {
        throw {
          code: "INVALID_ADAPTER_DOCUMENT",
          message: "NetSuite data requests require an exact document target."
        };
      }
      return {
        tabId: senderContext.tabId,
        documentIds: [senderContext.documentId]
      };
    }

    async function executeEnvelope(senderContext, envelope) {
      const [{ result } = {}] = await scripting.executeScript({
        target: createTarget(senderContext),
        world: "MAIN",
        func: executeMainWorldOperation,
        args: [envelope]
      });
      return result;
    }

    async function cancel(senderContext, requestId) {
      try {
        const result = await executeEnvelope(senderContext, {
          operation: CANCEL_OPERATION,
          requestId,
          targetRequestId: requestId,
          expectedUrl: senderContext.href,
          payload: {}
        });
        return result?.ok === true && result?.data?.canceled === true;
      } catch {
        return false;
      }
    }

    async function execute(request, operation, payload = {}) {
      if (!OPERATION_VALUES.includes(operation)) {
        throw {
          code: "UNKNOWN_ADAPTER_OPERATION",
          message: "NetSuite data adapter operation is not allowlisted."
        };
      }
      if (request.signal?.aborted) {
        throw { code: "ABORTED", message: "NetSuite data request was stopped." };
      }

      const onAbort = () => {
        void cancel(request.senderContext, request.requestId);
      };
      request.signal?.addEventListener?.("abort", onAbort, { once: true });
      try {
        const result = await executeEnvelope(request.senderContext, {
          operation,
          requestId: request.requestId,
          expectedUrl: request.senderContext.href,
          payload
        });
        if (result?.requestId !== request.requestId) {
          throw {
            code: "NETSUITE_ADAPTER_RESPONSE_MISMATCH",
            message: "NetSuite data adapter returned a response for another request."
          };
        }
        if (result?.ok !== true) {
          throw result?.error || {
            code: "NETSUITE_ADAPTER_ERROR",
            message: "NetSuite data adapter request failed."
          };
        }
        return result.data;
      } finally {
        request.signal?.removeEventListener?.("abort", onAbort);
      }
    }

    return Object.freeze({
      execute,
      cancel
    });
  }

  globalScope.SuiteMateV3NetSuiteDataAdapter = Object.freeze({
    VERSION,
    OPERATIONS,
    create
  });
})(globalThis);
