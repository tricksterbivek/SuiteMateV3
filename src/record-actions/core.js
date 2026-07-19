(function defineSuiteMateV3RecordActionsCore(global) {
  "use strict";

  const routeApi = global.SuiteMateV3Routes;
  const RECORD_TYPE_MESSAGE = "SUITEMATE_V3_RECORD_TYPE";
  const CSV_IMPORT_PATH = routeApi.PATHS.IMPORT_ASSISTANT;
  const ITEM_BASE_TYPE_PATTERN = /^(noninventory|othercharge|service)item$/;
  const RECORD_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;
  const SEARCH_TYPE_MAP = Object.freeze({
    Budget: "budgetimport",
    Opprtnty: "opportunity",
    Case: "supportcase",
    CardholderAuthenticationEvent: "cardholderauthenticationevent",
    Class: "classification",
    Document: "files",
    Calendar: "calendarevent",
    CRMGroup: "entitygroup",
    Call: "phonecall",
    RsrcAllocation: "resourceallocation",
    OutboundEmailLog: "sentemail",
    ScriptNote: "scriptexecutionlog",
    TaxItem: "salestaxitem",
    Time: "timebill",
    UserNote: "note"
  });

  function normalizeRecordType(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!RECORD_TYPE_PATTERN.test(normalized)) {
      return null;
    }
    return normalized === "clientscript" ? "script" : normalized;
  }

  function normalizeItemSubtype(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return /^[a-z0-9]+$/.test(normalized) ? normalized : "";
  }

  function deriveImportSubtype(recordType, itemSubtype) {
    const normalizedRecordType = normalizeRecordType(recordType);
    if (!normalizedRecordType) {
      return null;
    }
    if (!ITEM_BASE_TYPE_PATTERN.test(normalizedRecordType)) {
      return normalizedRecordType;
    }

    const normalizedItemSubtype = normalizeItemSubtype(itemSubtype);
    return normalizedItemSubtype
      ? normalizedRecordType.replace(/item$/, `${normalizedItemSubtype}item`)
      : normalizedRecordType;
  }

  function readElementValue(documentRef, selector) {
    return documentRef?.querySelector?.(selector)?.value;
  }

  function readFieldHelpRecordType(documentRef) {
    const fieldHelp = documentRef?.querySelector?.(
      '[data-nsps-type="label"] > a[onclick^="return nlFieldHelp("], a[onclick^="return nlFieldHelp("]'
    );
    const onclick = fieldHelp?.getAttribute?.("onclick") ?? "";
    const quotedArguments = [...onclick.matchAll(/(['"])(.*?)\1/g)].map((match) => match[2]);
    return normalizeRecordType(quotedArguments[2]);
  }

  function resolveRecordTypeFromDocument(documentRef, pathname = "") {
    const directSelectors = [
      "#baserecordtype",
      'input[name="baserecordtype"]',
      "#main_form > #type",
      '#main_form > input[name="type"]',
      "#scripttype"
    ];

    for (const selector of directSelectors) {
      const recordType = normalizeRecordType(readElementValue(documentRef, selector));
      if (recordType) {
        return recordType;
      }
    }

    if (pathname === "/app/common/search/search.nl") {
      const recordType = normalizeRecordType(readElementValue(documentRef, "#rectype"));
      if (recordType) {
        return recordType;
      }

      const searchType = String(readElementValue(documentRef, "#searchtype") ?? "").trim();
      return normalizeRecordType(SEARCH_TYPE_MAP[searchType] ?? searchType);
    }

    return readFieldHelpRecordType(documentRef);
  }

  function createCsvImportUrl(recordSubtype, origin) {
    const normalizedRecordSubtype = normalizeRecordType(recordSubtype);
    if (!normalizedRecordSubtype) {
      return null;
    }

    try {
      const url = new URL(CSV_IMPORT_PATH, origin);
      url.searchParams.set("recordsubtype", normalizedRecordSubtype);
      return `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }

  function isSupportedRecordPage(locationRef) {
    const context = routeApi.createPageContext(locationRef, {
      isTopFrame: true,
      trustedContentScript: true
    });
    return routeApi.supports(routeApi.CAPABILITIES.CSV_IMPORT_TOOLBAR, context);
  }

  function isAllowedNetSuiteUrl(value) {
    return routeApi.isAllowedNetSuiteUrl(value);
  }

  function isAllowedRecordSender(sender) {
    return routeApi.isAllowedSender(sender, routeApi.CAPABILITIES.RECORD_TYPE_BRIDGE);
  }

  global.SuiteMateV3RecordActionsCore = Object.freeze({
    RECORD_TYPE_MESSAGE,
    CSV_IMPORT_PATH,
    deriveImportSubtype,
    resolveRecordTypeFromDocument,
    createCsvImportUrl,
    isSupportedRecordPage,
    isAllowedNetSuiteUrl,
    isAllowedRecordSender,
    normalizeRecordType
  });
})(globalThis);
