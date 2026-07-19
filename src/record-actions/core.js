(function defineSuiteMateV3RecordActionsCore(global) {
  "use strict";

  const RECORD_TYPE_MESSAGE = "SUITEMATE_V3_RECORD_TYPE";
  const CSV_IMPORT_PATH = "/app/setup/assistants/nsimport/importassistant.nl";
  const SEARCH_RESULTS_PATH = "/app/common/search/searchresults.nl";
  const SUITEQL_PATH = "/app/common/search/ubersearchresults.nl";
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
    const pathname = String(locationRef?.pathname ?? "").replace(/\/{2,}/g, "/");
    if (!pathname || pathname === SEARCH_RESULTS_PATH) {
      return false;
    }
    if (pathname === SUITEQL_PATH && new URLSearchParams(locationRef?.search ?? "").has("suiteql")) {
      return false;
    }
    return true;
  }

  function isAllowedNetSuiteUrl(value) {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();
      return url.protocol === "https:"
        && hostname.endsWith(".netsuite.com")
        && hostname !== "www.netsuite.com"
        && !hostname.endsWith(".extforms.netsuite.com");
    } catch {
      return false;
    }
  }

  function isAllowedRecordSender(sender) {
    return sender?.frameId === 0
      && Number.isInteger(sender?.tab?.id)
      && isAllowedNetSuiteUrl(sender?.url ?? sender?.tab?.url);
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
