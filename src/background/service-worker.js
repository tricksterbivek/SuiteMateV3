importScripts(chrome.runtime.getURL("src/shared/routes.js"));
importScripts(chrome.runtime.getURL("src/shared/bridge.js"));
importScripts(chrome.runtime.getURL("src/suiteql/core.js"));
importScripts(chrome.runtime.getURL("src/record-actions/core.js"));
importScripts(chrome.runtime.getURL("src/import-assistant/core.js"));

(function initializeSuiteMateV3Background() {
  "use strict";

  const core = globalThis.SuiteMateV3SuiteQLCore;
  const bridgeApi = globalThis.SuiteMateV3Bridge;
  const recordActionsCore = globalThis.SuiteMateV3RecordActionsCore;
  const importAssistantCore = globalThis.SuiteMateV3ImportAssistantCore;
  const { COMMANDS } = bridgeApi;

  async function executeSuiteQLBridgeInMainWorld(payload) {
    if (window.location?.href !== payload.expectedUrl) {
      return {
        ok: false,
        requestId: payload.requestId,
        error: {
          code: "INVALID_MAIN_WORLD_DOCUMENT",
          message: "NetSuite page changed before the SuiteQL command could run."
        }
      };
    }

    const BRIDGE_PATH = "/app/common/scripting/PlatformClientScriptHandler.nl";
    const stateKey = Symbol.for("suitemate.v3.suiteql.bridge");
    const state = window[stateKey] ??= {
      sessions: new Map(),
      controllers: new Map(),
      canceled: new Set()
    };

    function normalizeError(value, fallbackCode = "SUITEQL_ERROR") {
      const error = value && typeof value === "object" ? value : {};
      const message = error.message || error.description || error.details || error.detail || String(value || "SuiteQL execution failed.");
      return {
        code: String(error.code || error.name || fallbackCode),
        message: String(message),
        details: String(error.details || error.detail || "")
      };
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

    function serializeBridgeRows(result, existingColumns) {
      const aliases = Array.isArray(result?.aliases) ? result.aliases : [];
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
      const rows = Array.from({ length: count }, (_, rowIndex) => {
        const values = Array.isArray(result?.[`v${rowIndex}`]) ? result[`v${rowIndex}`] : [];
        return Object.fromEntries(columns.map((column, columnIndex) => [column, values[columnIndex] ?? null]));
      });
      return { columns, rows };
    }

    function extractOnlineError(text) {
      const readTag = (name) => {
        const match = String(text).match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"));
        return match?.[1]?.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim() || "";
      };
      return {
        code: readTag("code") || "NETSUITE_HTTP_ERROR",
        message: readTag("detail") || readTag("description") || String(text || "NetSuite rejected the SuiteQL request."),
        details: readTag("description")
      };
    }

    async function callBridge(operation, operationArguments) {
      if (state.canceled.has(payload.requestId)) {
        throw { code: "ABORTED", message: "SuiteQL execution was stopped." };
      }

      const controller = new AbortController();
      state.controllers.get(payload.requestId)?.abort();
      state.controllers.set(payload.requestId, controller);
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 120000);

      try {
        const response = await fetch(BRIDGE_PATH, {
          method: "POST",
          credentials: "include",
          headers: {
            accept: "*/*",
            "accept-language": navigator.language || "en-US",
            "cache-control": "no-cache",
            nsxmlhttprequest: "NSXMLHttpRequest",
            pragma: "no-cache"
          },
          referrerPolicy: "no-referrer-when-downgrade",
          mode: "cors",
          signal: controller.signal,
          body: JSON.stringify({
            method: "remoteObject.bridgeCall",
            params: ["queryApiBridge", operation, JSON.stringify(operationArguments)]
          })
        });
        const responseText = await response.text();
        if (!response.ok) {
          throw responseText.includes("<onlineError>")
            ? extractOnlineError(responseText)
            : { code: `NETSUITE_HTTP_${response.status}`, message: responseText || `NetSuite returned HTTP ${response.status}.` };
        }

        let decoded;
        try {
          decoded = JSON.parse(responseText);
        } catch {
          throw { code: "INVALID_BRIDGE_RESPONSE", message: "NetSuite returned an unreadable SuiteQL response.", details: responseText.slice(0, 500) };
        }

        if (!decoded || typeof decoded !== "object") {
          throw { code: "INVALID_BRIDGE_RESPONSE", message: "NetSuite returned an empty SuiteQL response." };
        }
        if (decoded.result === "error") {
          throw decoded.error || { code: "SUITEQL_ERROR", message: "NetSuite rejected the SuiteQL query." };
        }
        if (!("result" in decoded)) {
          if (decoded.code || decoded.details) {
            throw decoded;
          }
          throw { code: "INVALID_BRIDGE_RESPONSE", message: "NetSuite returned an unrecognized SuiteQL response." };
        }

        return decoded.result && typeof decoded.result === "object" && "result" in decoded.result
          ? decoded.result.result
          : decoded.result;
      } catch (error) {
        if (timedOut) {
          throw { code: "QUERY_TIMEOUT", message: "SuiteQL did not finish within two minutes." };
        }
        if (state.canceled.has(payload.requestId) || error?.name === "AbortError") {
          throw { code: "ABORTED", message: "SuiteQL execution was stopped." };
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
        if (state.controllers.get(payload.requestId) === controller) {
          state.controllers.delete(payload.requestId);
        }
      }
    }

    function elapsedSince(startedAt) {
      return Math.max(0, Math.round(performance.now() - startedAt));
    }

    if (payload.action === "dispose") {
      state.canceled.add(payload.requestId);
      state.controllers.get(payload.requestId)?.abort();
      state.controllers.delete(payload.requestId);
      state.sessions.delete(payload.requestId);
      setTimeout(() => state.canceled.delete(payload.requestId), 130000);
      return { ok: true, requestId: payload.requestId, disposed: true };
    }

    try {
      if (payload.action === "start") {
        state.canceled.delete(payload.requestId);
        state.sessions.clear();
        const startedAt = performance.now();
        const queryOptions = ["[]", "SUITE_QL", ""];

        if (!payload.paged) {
          const result = await callBridge("runSuiteQL", [payload.query, ...queryOptions]);
          const serialized = serializeBridgeRows(result);
          return {
            ok: true,
            requestId: payload.requestId,
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

        const metadata = await callBridge("suiteQLPagedQuery", [payload.pageSize, payload.query, ...queryOptions]);
        const pages = Array.isArray(metadata?.pages)
          ? metadata.pages
          : Array.isArray(metadata?.pageRanges)
            ? metadata.pageRanges
            : [];
        const declaredTotalPages = Number(metadata?.numPages ?? metadata?.totalPages);
        const totalPages = Number.isFinite(declaredTotalPages) ? Math.max(0, declaredTotalPages) : pages.length;
        const declaredTotalCount = Number(metadata?.count ?? metadata?.totalCount);
        const totalCount = Number.isFinite(declaredTotalCount) ? Math.max(0, declaredTotalCount) : 0;

        if (!totalPages || !pages.length) {
          return {
            ok: true,
            requestId: payload.requestId,
            columns: [],
            rows: [],
            elapsedMs: elapsedSince(startedAt),
            paged: true,
            pageIndex: 0,
            pageSize: payload.pageSize,
            loadedCount: 0,
            totalCount,
            totalPages: 0
          };
        }

        const firstPageResult = await callBridge("getSuiteQLQueryPage", [pages[0], payload.query, ...queryOptions]);
        const serialized = serializeBridgeRows(firstPageResult);
        let effectiveTotalCount = totalCount || (totalPages === 1 ? serialized.rows.length : 0);
        if (!effectiveTotalCount && totalPages > 1 && pages[totalPages - 1]) {
          const lastPageResult = await callBridge("getSuiteQLQueryPage", [
            pages[totalPages - 1],
            payload.query,
            ...queryOptions
          ]);
          const lastPage = serializeBridgeRows(lastPageResult, serialized.columns);
          effectiveTotalCount = (totalPages - 1) * payload.pageSize + lastPage.rows.length;
        }
        state.sessions.set(payload.requestId, {
          query: payload.query,
          pages,
          columns: serialized.columns,
          pageSize: payload.pageSize,
          totalCount: effectiveTotalCount,
          totalPages,
          loadedPageRows: new Map([[0, serialized.rows.length]])
        });
        return {
          ok: true,
          requestId: payload.requestId,
          ...serialized,
          elapsedMs: elapsedSince(startedAt),
          paged: true,
          pageIndex: 0,
          pageSize: payload.pageSize,
          loadedCount: serialized.rows.length,
          totalCount: effectiveTotalCount,
          totalPages
        };
      }

      if (payload.action === "page") {
        const session = state.sessions.get(payload.requestId);
        if (!session) {
          throw {
            code: "SUITEQL_SESSION_EXPIRED",
            message: "The paged SuiteQL session expired. Run the query again."
          };
        }
        if (!Number.isInteger(payload.pageIndex) || payload.pageIndex < 0 || payload.pageIndex >= session.pages.length) {
          throw { code: "INVALID_PAGE", message: "SuiteQL page index is invalid." };
        }

        const startedAt = performance.now();
        const result = await callBridge("getSuiteQLQueryPage", [
          session.pages[payload.pageIndex],
          session.query,
          "[]",
          "SUITE_QL",
          ""
        ]);
        const serialized = serializeBridgeRows(result, session.columns);
        session.loadedPageRows.set(payload.pageIndex, serialized.rows.length);
        const loadedCount = [...session.loadedPageRows.values()].reduce((total, count) => total + count, 0);
        const totalCount = session.totalCount || (payload.pageIndex === session.totalPages - 1 ? loadedCount : 0);
        if (totalCount) {
          session.totalCount = totalCount;
        }
        return {
          ok: true,
          requestId: payload.requestId,
          ...serialized,
          elapsedMs: elapsedSince(startedAt),
          paged: true,
          pageIndex: payload.pageIndex,
          pageSize: session.pageSize,
          loadedCount,
          totalCount,
          totalPages: session.totalPages
        };
      }

      throw { code: "INVALID_BRIDGE_ACTION", message: "SuiteQL bridge action is invalid." };
    } catch (error) {
      return {
        ok: false,
        requestId: payload.requestId,
        error: normalizeError(error)
      };
    }
  }

  async function executeInMainWorld(senderContext, func, payload) {
    const target = { tabId: senderContext.tabId };
    if (senderContext.documentId) {
      target.documentIds = [senderContext.documentId];
    } else {
      target.frameIds = [0];
    }
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      func,
      args: payload === undefined ? [] : [payload]
    });
    return result;
  }

  function readMainWorldRecordType(payload) {
    if (window.location?.href !== payload.expectedUrl) {
      return {
        ok: false,
        error: {
          code: "INVALID_MAIN_WORLD_DOCUMENT",
          message: "NetSuite page changed before the record type command could run."
        }
      };
    }
    try {
      return {
        ok: true,
        recordType: typeof window.nlapiGetRecordType === "function"
          ? window.nlapiGetRecordType()
          : null
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "RECORD_TYPE_UNAVAILABLE",
          message: String(error?.message || "NetSuite record type is unavailable.")
        }
      };
    }
  }

  function cancelImportAssistantValuesInMainWorld(payload) {
    if (window.location?.href !== payload.expectedUrl) {
      return { canceled: false };
    }
    const stateKey = Symbol.for("suitemate.v3.import-assistant.bridge");
    const state = window[stateKey] ??= { canceled: new Set() };
    state.canceled.add(payload.requestId);
    return { canceled: true };
  }

  function setImportAssistantValuesInMainWorld(payload) {
    return new Promise((resolve) => {
      const stateKey = Symbol.for("suitemate.v3.import-assistant.bridge");
      const state = window[stateKey] ??= { canceled: new Set() };
      const finish = (result) => {
        state.canceled.delete(payload.requestId);
        resolve(result);
      };
      const canceledResult = () => ({
        ok: false,
        error: {
          code: "ABORTED",
          message: "Import Assistant update was stopped."
        }
      });
      if (window.location?.href !== payload.expectedUrl) {
        finish({
          ok: false,
          error: {
            code: "INVALID_MAIN_WORLD_DOCUMENT",
            message: "NetSuite page changed before the Import Assistant command could run."
          }
        });
        return;
      }
      if (state.canceled.has(payload.requestId)) {
        finish(canceledResult());
        return;
      }

      const amdRequire = window.require;
      if (typeof amdRequire !== "function") {
        finish({
          ok: false,
          error: { code: "NETSUITE_MODULE_LOADER_UNAVAILABLE", message: "NetSuite's module loader is unavailable." }
        });
        return;
      }

      amdRequire(["N/currentRecord"], (currentRecord) => {
        try {
          if (state.canceled.has(payload.requestId)) {
            finish(canceledResult());
            return;
          }
          const record = currentRecord.get();
          const entries = Object.entries(payload.values);
          for (const [fieldId] of entries) {
            let field;
            try {
              field = record.getField({ fieldId });
            } catch {
              field = record.getField(fieldId);
            }
            if (!field) {
              finish({
                ok: false,
                error: {
                  code: "IMPORT_FIELD_UNAVAILABLE",
                  message: `Import Assistant field is unavailable: ${fieldId}.`
                }
              });
              return;
            }
          }

          if (state.canceled.has(payload.requestId)) {
            finish(canceledResult());
            return;
          }
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
          finish({ ok: true, applied });
        } catch (error) {
          finish({
            ok: false,
            error: {
              code: String(error?.name || error?.code || "IMPORT_CONTEXT_ERROR"),
              message: String(error?.message || error || "NetSuite rejected the CSV Import context.")
            }
          });
        }
      }, (error) => {
        finish({
          ok: false,
          error: {
            code: "CURRENT_RECORD_UNAVAILABLE",
            message: String(error?.message || error || "N/currentRecord could not be loaded.")
          }
        });
      });
    });
  }

  async function handleRecordTypeRequest(request) {
    try {
      const result = await executeInMainWorld(
        request.senderContext,
        readMainWorldRecordType,
        { expectedUrl: request.senderContext.href }
      );
      if (result?.ok !== true) {
        throw result?.error || {
          code: "RECORD_TYPE_UNAVAILABLE",
          message: "NetSuite record type is unavailable."
        };
      }
      return {
        recordType: recordActionsCore.normalizeRecordType(result.recordType)
      };
    } catch (error) {
      throw {
        code: String(error?.code || "RECORD_TYPE_UNAVAILABLE"),
        message: String(error?.message || "NetSuite record type is unavailable.")
      };
    }
  }

  async function handleImportAssistantSetValues(request) {
    const values = importAssistantCore.normalizeFieldValues(request.payload.values);
    if (!Object.keys(values).length) {
      throw {
        code: "INVALID_IMPORT_VALUES",
        message: "No supported CSV Import values were provided."
      };
    }

    try {
      const cancellationPayload = {
        requestId: request.requestId,
        expectedUrl: request.senderContext.href
      };
      const cancelMainWorld = () => {
        void executeInMainWorld(
          request.senderContext,
          cancelImportAssistantValuesInMainWorld,
          cancellationPayload
        ).catch(() => {});
      };
      request.signal.addEventListener("abort", cancelMainWorld, { once: true });
      let result;
      try {
        if (request.signal.aborted) {
          throw { code: "ABORTED", message: "Import Assistant update was stopped." };
        }
        result = await executeInMainWorld(
          request.senderContext,
          setImportAssistantValuesInMainWorld,
          {
            ...cancellationPayload,
            values
          }
        );
      } finally {
        request.signal.removeEventListener("abort", cancelMainWorld);
      }
      if (result?.ok !== true) {
        throw result?.error || {
          code: "IMPORT_CONTEXT_ERROR",
          message: "CSV Import context could not be applied."
        };
      }
      const applied = Array.isArray(result.applied) ? result.applied.map(String) : [];
      const requestedFields = Object.keys(values);
      if (
        applied.length !== requestedFields.length
        || requestedFields.some((fieldId) => !applied.includes(fieldId))
      ) {
        throw {
          code: "IMPORT_CONTEXT_PARTIAL_APPLY",
          message: "NetSuite did not apply every requested Import Assistant field."
        };
      }
      return {
        applied
      };
    } catch (error) {
      throw {
        code: String(error?.code || error?.name || "IMPORT_CONTEXT_ERROR"),
        message: String(error?.message || error || "CSV Import context could not be applied."),
        details: String(error?.details || "")
      };
    }
  }

  function readSuiteQLMainWorldResult(result, requestId) {
    if (result?.requestId !== requestId) {
      throw {
        code: "SUITEQL_RESPONSE_MISMATCH",
        message: "NetSuite returned SuiteQL data for another request."
      };
    }
    if (result?.ok !== true) {
      throw result?.error || {
        code: "SUITEQL_ERROR",
        message: "SuiteQL execution failed."
      };
    }
    const { ok: _ok, requestId: _requestId, ...data } = result;
    return data;
  }

  async function executeSuiteQLCommand(request, payload) {
    const disposePayload = {
      action: "dispose",
      requestId: request.requestId,
      expectedUrl: request.senderContext.href
    };
    const cancelMainWorld = () => {
      void executeInMainWorld(
        request.senderContext,
        executeSuiteQLBridgeInMainWorld,
        disposePayload
      ).catch(() => {});
    };
    request.signal.addEventListener("abort", cancelMainWorld, { once: true });
    try {
      if (request.signal.aborted) {
        throw { code: "ABORTED", message: "SuiteQL execution was stopped." };
      }
      const result = await executeInMainWorld(
        request.senderContext,
        executeSuiteQLBridgeInMainWorld,
        {
          ...payload,
          expectedUrl: request.senderContext.href
        }
      );
      return readSuiteQLMainWorldResult(result, request.requestId);
    } finally {
      request.signal.removeEventListener("abort", cancelMainWorld);
    }
  }

  async function handleStart(request) {
    const validation = core.validateQuery(request.payload.query);
    if (!validation.valid) {
      throw { code: validation.code, message: validation.message };
    }

    const payload = {
      requestId: request.requestId,
      query: validation.query,
      paged: request.payload.paged === true,
      pageSize: core.NETSUITE_PAGE_SIZE
    };

    return executeSuiteQLCommand(request, {
      ...payload,
      action: "start"
    });
  }

  async function handlePage(request) {
    return executeSuiteQLCommand(request, {
      action: "page",
      requestId: request.requestId,
      pageIndex: request.payload.pageIndex,
      pageSize: core.NETSUITE_PAGE_SIZE
    });
  }

  async function handleDispose(request) {
    const result = await executeInMainWorld(
      request.senderContext,
      executeSuiteQLBridgeInMainWorld,
      {
        action: "dispose",
        requestId: request.requestId,
        expectedUrl: request.senderContext.href
      }
    );
    return readSuiteQLMainWorldResult(result, request.requestId);
  }

  const dispatcher = bridgeApi.createDispatcher({
    [COMMANDS.SUITEQL_START]: handleStart,
    [COMMANDS.SUITEQL_PAGE]: handlePage,
    [COMMANDS.SUITEQL_DISPOSE]: handleDispose,
    [COMMANDS.RECORD_GET_TYPE]: handleRecordTypeRequest,
    [COMMANDS.IMPORT_ASSISTANT_SET_VALUES]: handleImportAssistantSetValues
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!bridgeApi.isBridgeMessage(message)) {
      return undefined;
    }

    dispatcher.dispatch(message, sender).then(sendResponse).catch((error) => {
      sendResponse(bridgeApi.createErrorResponse(
        message?.requestId,
        message?.command,
        error
      ));
    });
    return true;
  });
})();
