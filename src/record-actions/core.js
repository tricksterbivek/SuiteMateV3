(function defineSuiteMateV3RecordActionsCore(global) {
  "use strict";

  const routeApi = global.SuiteMateV3Routes;
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
    let normalizedRecordType = normalizeRecordType(recordType);
    if (!normalizedRecordType) {
      return null;
    }
    normalizedRecordType = IMPORT_TYPE_ALIASES[normalizedRecordType] ?? normalizedRecordType;
    // Custom record types pass through verbatim: the Import Assistant's
    // option values are the uppercased script id in every observed and
    // documented case (Oracle "Custom Record IDs"; a 652-option live read
    // found zero CUSTOMRECORD<digits> values needing respelling), so any
    // string surgery here can only corrupt a legitimate id.
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

  // Page artifacts, not record types: custom record pages carry the literal
  // "custrecordentry" (the .nl script name) in #main_form's type input, and
  // their nlFieldHelp links name the base "customrecord". Neither can ever
  // match an Import Assistant subtype option — the assistant's priming does
  // exact value comparison against concrete option values, so these tokens
  // can only produce a broken link (measured live: the field-help token
  // shadowed customrecord_sps_cxref). Returning null lets the caller fall
  // through to the main-world record-type read. Defence-in-depth beneath the
  // DOM-ready gate in csv-import.js, which removes the mid-stream window
  // where these artifacts were the only thing rendered.
  const GENERIC_DOCUMENT_TYPES = Object.freeze(["customrecord", "custrecordentry", "dual"]);

  // Record pages whose #type token differs from the Import Assistant's
  // subtype vocabulary (live-verified): the Class page reports "class" but
  // the assistant's option is CLASSIFICATION; Custom List reports "custlist"
  // against CUSTOMLIST. Same record, two spellings — the alias keeps one
  // derivation site.
  const IMPORT_TYPE_ALIASES = Object.freeze({
    class: "classification",
    custlist: "customlist"
  });

  function specificRecordType(value) {
    const recordType = normalizeRecordType(value);
    return recordType && !GENERIC_DOCUMENT_TYPES.includes(recordType) ? recordType : null;
  }

  function readFieldHelpRecordType(documentRef) {
    const fieldHelp = documentRef?.querySelector?.(
      '[data-nsps-type="label"] > a[onclick^="return nlFieldHelp("], a[onclick^="return nlFieldHelp("]'
    );
    const onclick = fieldHelp?.getAttribute?.("onclick") ?? "";
    const quotedArguments = [...onclick.matchAll(/(['"])(.*?)\1/g)].map((match) => match[2]);
    return specificRecordType(quotedArguments[2]);
  }

  // Every signal below is an undocumented NetSuite internal with no contract
  // (Oracle: "SuiteScript does not support direct access to the NetSuite UI
  // through the DOM"), including the main-world nlapiGetRecordType fallback —
  // which itself just reads #baserecordtype from this same form, so it can
  // never rescue a read that fails here. #type is the .nl page basename
  // (salesord, custjob, custrecordentry…), which only OCCASIONALLY coincides
  // with a record type — hence the aliases and the generic-token denylist.
  function resolveRecordTypeFromDocument(documentRef, pathname = "") {
    const directSelectors = [
      "#baserecordtype",
      'input[name="baserecordtype"]',
      "#main_form > #type",
      '#main_form > input[name="type"]',
      "#scripttype"
    ];

    for (const selector of directSelectors) {
      const recordType = specificRecordType(readElementValue(documentRef, selector));
      if (recordType) {
        return recordType;
      }
    }

    if (pathname === "/app/common/search/search.nl") {
      const recordType = specificRecordType(readElementValue(documentRef, "#rectype"));
      if (recordType) {
        return recordType;
      }

      const searchType = String(readElementValue(documentRef, "#searchtype") ?? "").trim();
      return specificRecordType(SEARCH_TYPE_MAP[searchType] ?? searchType);
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

  global.SuiteMateV3RecordActionsCore = Object.freeze({
    CSV_IMPORT_PATH,
    deriveImportSubtype,
    resolveRecordTypeFromDocument,
    createCsvImportUrl,
    normalizeRecordType
  });
})(globalThis);
