(function defineSuiteMateV3TabTitleCore(globalScope) {
  "use strict";

  const VERSION = 1;
  const FOREIGN_NODE_SELECTOR = "[data-suitemate-v3-internal-id], [data-suitemate-v3-so-columns], [data-suitemate-v3-form-views], [data-suitemate-v3-edit-grid]";
  const HEADLINE_SELECTOR = ".uir-page-title-secondline";
  const STATUS_SELECTOR = ".uir-record-status";
  const MAX_ENTITY_LENGTH = 60;
  // Path token (basename sans .nl) -> [abbreviation, header starts with a
  // document number]. ponytail: curated common types; unknown tokens keep the
  // native title, add here when a page matters.
  const RECORD_TYPES = Object.freeze({
    salesord: Object.freeze(["SO", true]),
    purchord: Object.freeze(["PO", true]),
    itemship: Object.freeze(["IF", true]),
    itemrcpt: Object.freeze(["IR", true]),
    custinvc: Object.freeze(["INV", true]),
    vendbill: Object.freeze(["BILL", true]),
    custcred: Object.freeze(["CM", true]),
    vendcred: Object.freeze(["VCM", true]),
    custpymt: Object.freeze(["PMT", true]),
    vendpymt: Object.freeze(["VPMT", true]),
    journal: Object.freeze(["JE", true]),
    estimate: Object.freeze(["EST", true]),
    rtnauth: Object.freeze(["RMA", true]),
    vendauth: Object.freeze(["VRMA", true]),
    transferord: Object.freeze(["TO", true]),
    cashsale: Object.freeze(["CS", true]),
    check: Object.freeze(["CHK", true]),
    custdep: Object.freeze(["DEP", true]),
    custrfnd: Object.freeze(["RFND", true]),
    workord: Object.freeze(["WO", true]),
    exprept: Object.freeze(["EXP", true]),
    opprtnty: Object.freeze(["OPP", true]),
    custjob: Object.freeze(["CUST", false]),
    vendor: Object.freeze(["VEND", false]),
    employee: Object.freeze(["EMP", false]),
    contact: Object.freeze(["CNTC", false]),
    partner: Object.freeze(["PRTN", false]),
    item: Object.freeze(["ITEM", false]),
    supportcase: Object.freeze(["CASE", false])
  });

  if (globalScope.SuiteMateV3TabTitleCore?.VERSION === VERSION) {
    return;
  }

  function parseRecordPath(pathname) {
    const token = /\/([a-z0-9_]+)\.nl$/i.exec(String(pathname ?? ""))?.[1]?.toLowerCase();
    const entry = token ? RECORD_TYPES[token] : null;
    return entry ? { abbrev: entry[0], leadingDocNumber: entry[1] } : null;
  }

  function titleCaseStatus(value) {
    const text = String(value ?? "").trim();
    return text === text.toUpperCase()
      ? text.toLowerCase().replace(/(^|[\s/-])[a-z]/g, (match) => match.toUpperCase())
      : text;
  }

  function cleanNodeText(node) {
    if (!node) {
      return "";
    }
    if (typeof node.cloneNode === "function") {
      const clone = node.cloneNode(true);
      clone.querySelectorAll?.(`${FOREIGN_NODE_SELECTOR}, ${STATUS_SELECTOR}`)?.forEach((child) => child.remove());
      return String(clone.textContent ?? "").replace(/\s+/g, " ").trim();
    }
    return String(node.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  function extractHeaderParts(doc, parsed) {
    const headline = cleanNodeText(doc?.querySelector?.(HEADLINE_SELECTOR));
    const status = titleCaseStatus(doc?.querySelector?.(STATUS_SELECTOR)?.textContent);
    let docNumber = "";
    let entity = headline;
    if (parsed?.leadingDocNumber && headline) {
      const space = headline.indexOf(" ");
      docNumber = space > 0 ? headline.slice(0, space) : headline;
      entity = space > 0 ? headline.slice(space + 1).trim() : "";
    }
    if (entity.length > MAX_ENTITY_LENGTH) {
      entity = `${entity.slice(0, MAX_ENTITY_LENGTH - 1).trimEnd()}…`;
    }
    return { docNumber, entity, status };
  }

  function composeTitle(parsed, parts) {
    const pieces = [parsed?.abbrev, parts?.docNumber, parts?.entity, parts?.status]
      .map((piece) => String(piece ?? "").trim())
      .filter(Boolean);
    // Fewer than two parts reads worse than NetSuite's native title.
    return pieces.length >= 2 ? pieces.join(" · ") : null;
  }

  Object.defineProperty(globalScope, "SuiteMateV3TabTitleCore", {
    value: Object.freeze({
      VERSION,
      RECORD_TYPES,
      parseRecordPath,
      titleCaseStatus,
      extractHeaderParts,
      composeTitle
    }),
    configurable: false,
    enumerable: true,
    writable: false
  });
})(globalThis);
