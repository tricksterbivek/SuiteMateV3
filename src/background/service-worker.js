importScripts(chrome.runtime.getURL("src/shared/utilities.js"));
importScripts(chrome.runtime.getURL("src/shared/routes.js"));
importScripts(chrome.runtime.getURL("src/shared/bridge.js"));
importScripts(chrome.runtime.getURL("src/suiteql/core.js"));
importScripts(chrome.runtime.getURL("src/record-actions/core.js"));
importScripts(chrome.runtime.getURL("src/import-assistant/core.js"));
importScripts(chrome.runtime.getURL("src/csv-export/core.js"));
importScripts(chrome.runtime.getURL("src/netsuite/data-adapter.js"));

(function initializeSuiteMateV3Background() {
  "use strict";

  const core = globalThis.SuiteMateV3SuiteQLCore;
  const bridgeApi = globalThis.SuiteMateV3Bridge;
  const recordActionsCore = globalThis.SuiteMateV3RecordActionsCore;
  const importAssistantCore = globalThis.SuiteMateV3ImportAssistantCore;
  const csvExportCore = globalThis.SuiteMateV3CsvExportCore;
  const adapterApi = globalThis.SuiteMateV3NetSuiteDataAdapter;
  const { COMMANDS } = bridgeApi;
  const { OPERATIONS } = adapterApi;
  const dataAdapter = adapterApi.create({ scripting: chrome.scripting });

  async function handleSuiteQLStart(request) {
    const validation = core.validateQuery(request.payload.query);
    if (!validation.valid) {
      throw { code: validation.code, message: validation.message };
    }
    return dataAdapter.execute(request, OPERATIONS.SUITEQL_START, {
      query: validation.query,
      paged: request.payload.paged === true,
      pageSize: core.NETSUITE_PAGE_SIZE
    });
  }

  function handleSuiteQLPage(request) {
    return dataAdapter.execute(request, OPERATIONS.SUITEQL_PAGE, {
      pageIndex: request.payload.pageIndex,
      pageSize: core.NETSUITE_PAGE_SIZE
    });
  }

  function handleSuiteQLDispose(request) {
    return dataAdapter.execute(request, OPERATIONS.SUITEQL_DISPOSE);
  }

  async function handleRecordTypeRequest(request) {
    try {
      const result = await dataAdapter.execute(request, OPERATIONS.RECORD_GET_TYPE);
      return {
        recordType: recordActionsCore.normalizeRecordType(result.recordType)
      };
    } catch (error) {
      throw {
        code: String(error?.code || "RECORD_TYPE_UNAVAILABLE"),
        message: String(error?.message || "NetSuite record type is unavailable."),
        details: String(error?.details || "")
      };
    }
  }

  function createExactDocumentTarget(senderContext) {
    if (
      !Number.isInteger(senderContext?.tabId)
      || typeof senderContext?.documentId !== "string"
      || !senderContext.documentId
    ) {
      throw {
        code: "INVALID_CSV_EXPORT_DOCUMENT",
        message: "CSV Export requires an exact NetSuite document target."
      };
    }
    return {
      tabId: senderContext.tabId,
      documentIds: [senderContext.documentId]
    };
  }

  function requestCsvExportInMainWorld(options) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        globalThis.clearTimeout(timeoutId);
        globalThis.removeEventListener(options.resultEvent, handleResult);
        resolve(result);
      };
      const handleResult = (event) => {
        if (event?.detail?.requestId === options.requestId) {
          finish(event.detail);
        }
      };
      const timeoutId = globalThis.setTimeout(() => {
        finish({
          ok: false,
          requestId: options.requestId,
          error: {
            code: "CSV_EXPORT_TIMEOUT",
            message: "NetSuite did not finish the CSV export within two minutes."
          }
        });
      }, options.timeoutMs);

      globalThis.addEventListener(options.resultEvent, handleResult);
      globalThis.dispatchEvent(new globalThis.CustomEvent(options.requestEvent, {
        detail: {
          requestId: options.requestId,
          mode: options.mode
        }
      }));
    });
  }

  async function handleRecordCsvExport(request) {
    const target = createExactDocumentTarget(request.senderContext);
    await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      files: [
        "src/csv-export/core.js",
        "src/csv-export/main-world.js"
      ]
    });
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      func: requestCsvExportInMainWorld,
      args: [{
        requestId: request.requestId,
        mode: request.payload.mode,
        requestEvent: csvExportCore.REQUEST_EVENT,
        resultEvent: csvExportCore.RESULT_EVENT,
        timeoutMs: 120000
      }]
    });
    const normalized = csvExportCore.normalizeResultDetail(result, request.requestId);
    if (!normalized) {
      throw {
        code: "INVALID_CSV_EXPORT_RESPONSE",
        message: "NetSuite returned an invalid CSV Export response."
      };
    }
    if (!normalized.ok) {
      throw normalized.error;
    }
    return {
      filename: normalized.filename,
      recordType: normalized.recordType,
      sublistId: normalized.sublistId,
      mode: normalized.mode,
      rowCount: normalized.rowCount,
      columnCount: normalized.columnCount
    };
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
      const result = await dataAdapter.execute(
        request,
        OPERATIONS.IMPORT_ASSISTANT_SET_VALUES,
        { values }
      );
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
      return { applied };
    } catch (error) {
      throw {
        code: String(error?.code || error?.name || "IMPORT_CONTEXT_ERROR"),
        message: String(error?.message || error || "CSV Import context could not be applied."),
        details: String(error?.details || "")
      };
    }
  }

  async function handleImportAssistantResolveCategory(request) {
    const recordSubtype = importAssistantCore.normalizeImportValue(
      request.payload.recordSubtype
    );
    const candidateCategories = request.payload.candidateCategories
      .map((category) => importAssistantCore.normalizeImportValue(category))
      .filter(Boolean);
    if (
      !recordSubtype
      || candidateCategories.length !== request.payload.candidateCategories.length
    ) {
      throw {
        code: "INVALID_IMPORT_CATEGORIES",
        message: "CSV Import category lookup parameters are invalid."
      };
    }
    const result = await dataAdapter.execute(
      request,
      OPERATIONS.IMPORT_ASSISTANT_RESOLVE_CATEGORY,
      { recordSubtype, candidateCategories }
    );
    const category = importAssistantCore.normalizeImportValue(result.category);
    return {
      category: category && candidateCategories.includes(category) ? category : null
    };
  }

  const dispatcher = bridgeApi.createDispatcher({
    [COMMANDS.SUITEQL_START]: handleSuiteQLStart,
    [COMMANDS.SUITEQL_PAGE]: handleSuiteQLPage,
    [COMMANDS.SUITEQL_DISPOSE]: handleSuiteQLDispose,
    [COMMANDS.RECORD_GET_TYPE]: handleRecordTypeRequest,
    [COMMANDS.RECORD_EXPORT_CSV]: handleRecordCsvExport,
    [COMMANDS.IMPORT_ASSISTANT_SET_VALUES]: handleImportAssistantSetValues,
    [COMMANDS.IMPORT_ASSISTANT_RESOLVE_CATEGORY]: handleImportAssistantResolveCategory
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
})(globalThis);
