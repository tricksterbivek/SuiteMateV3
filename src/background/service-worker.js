importScripts(chrome.runtime.getURL("src/suiteql/core.js"));

(function initializeSuiteMateV3Background() {
  "use strict";

  const core = globalThis.SuiteMateV3SuiteQLCore;
  const { MESSAGE_TYPES } = core;

  function bridgeError(requestId, value) {
    return {
      ok: false,
      requestId,
      error: core.normalizeError(value)
    };
  }

  function validateSender(sender) {
    return core.isAllowedStudioSender(sender);
  }

  function validateRequest(message, sender) {
    if (!validateSender(sender)) {
      return bridgeError(message?.requestId, {
        code: "INVALID_SENDER",
        message: "SuiteQL requests are accepted only from SuiteQL Studio in the active NetSuite page."
      });
    }
    if (typeof message?.requestId !== "string" || !message.requestId.trim()) {
      return bridgeError(message?.requestId, {
        code: "INVALID_REQUEST_ID",
        message: "SuiteQL request ID is missing."
      });
    }
    return null;
  }

  async function executeSuiteQLBridgeInMainWorld(payload) {
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

  async function executeInMainWorld(tabId, func, payload) {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func,
      args: [payload]
    });
    return result;
  }

  async function handleStart(message, sender) {
    const invalid = validateRequest(message, sender);
    if (invalid) {
      return invalid;
    }

    const validation = core.validateQuery(message.query);
    if (!validation.valid) {
      return bridgeError(message.requestId, { code: validation.code, message: validation.message });
    }

    const payload = {
      requestId: message.requestId,
      query: validation.query,
      paged: message.paged === true,
      pageSize: core.NETSUITE_PAGE_SIZE
    };

    try {
      return await executeInMainWorld(sender.tab.id, executeSuiteQLBridgeInMainWorld, {
        ...payload,
        action: "start"
      });
    } catch (error) {
      return bridgeError(message.requestId, error);
    }
  }

  async function handlePage(message, sender) {
    const invalid = validateRequest(message, sender);
    if (invalid) {
      return invalid;
    }
    if (!Number.isInteger(message.pageIndex) || message.pageIndex < 0) {
      return bridgeError(message.requestId, {
        code: "INVALID_PAGE",
        message: "SuiteQL page index is invalid."
      });
    }

    try {
      return await executeInMainWorld(sender.tab.id, executeSuiteQLBridgeInMainWorld, {
        action: "page",
        requestId: message.requestId,
        pageIndex: message.pageIndex,
        pageSize: core.NETSUITE_PAGE_SIZE
      });
    } catch (error) {
      return bridgeError(message.requestId, error);
    }
  }

  async function handleDispose(message, sender) {
    const invalid = validateRequest(message, sender);
    if (invalid) {
      return invalid;
    }

    try {
      return await executeInMainWorld(sender.tab.id, executeSuiteQLBridgeInMainWorld, {
        action: "dispose",
        requestId: message.requestId
      });
    } catch (error) {
      return bridgeError(message.requestId, error);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let responsePromise;
    switch (message?.type) {
      case MESSAGE_TYPES.START:
        responsePromise = handleStart(message, sender);
        break;
      case MESSAGE_TYPES.PAGE:
        responsePromise = handlePage(message, sender);
        break;
      case MESSAGE_TYPES.DISPOSE:
        responsePromise = handleDispose(message, sender);
        break;
      default:
        return undefined;
    }

    responsePromise.then(sendResponse).catch((error) => sendResponse(bridgeError(message?.requestId, error)));
    return true;
  });
})();
