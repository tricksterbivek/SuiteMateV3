(function defineSuiteMateV3ImportAssistantCore(global) {
  "use strict";

  const routeApi = global.SuiteMateV3Routes;
  const IMPORT_ASSISTANT_PATH = routeApi.PATHS.IMPORT_ASSISTANT;
  const ALLOWED_FIELDS = Object.freeze(["charencoding", "recordtype", "recordsubtype"]);
  const CATEGORY_RECORD_TYPES = Object.freeze({
    ACCOUNTING: Object.freeze([
      "BUDGETEXCHANGERATE",
      "ACCOUNT",
      "CONSOLIDATEDEXCHANGERATE",
      "EXPENSECATEGORY",
      "ITEMCOLLECTION",
      "ITEMCOLLECTIONITEMMAP"
    ]),
    ACTIVITY: Object.freeze(["CALENDAREVENT", "PHONECALL", "TASK"]),
    COMMUNICATION: Object.freeze(["MESSAGE", "NOTE"]),
    EMPLOYEE: Object.freeze(["EMPLOYEE", "EXPENSEREPORT", "IMPORTEDEMPLOYEEEXPENSE", "TIMEBILL"]),
    ITEM: Object.freeze([
      "ASSEMBLYITEM",
      "DESCRIPTIONITEM",
      "DISCOUNTITEM",
      "INVENTORYITEM",
      "ITEMGROUP",
      "KITITEM",
      "LOTNUMBEREDASSEMBLYITEM",
      "LOTNUMBEREDINVENTORYITEM",
      "MARKUPITEM",
      "NONINVENTORYPURCHASEITEM",
      "NONINVENTORYRESALEITEM",
      "NONINVENTORYSALEITEM",
      "OTHERCHARGEPURCHASEITEM",
      "OTHERCHARGERESALEITEM",
      "OTHERCHARGESALEITEM",
      "PAYMENTITEM",
      "SERIALIZEDASSEMBLYITEM",
      "SERIALIZEDINVENTORYITEM",
      "SERVICEPURCHASEITEM",
      "SERVICERESALEITEM",
      "SERVICESALEITEM",
      "SUBTOTALITEM"
    ]),
    PAYMENTINSTRUMENTS: Object.freeze(["GENERALTOKEN", "PAYMENTCARD", "PAYMENTCARDTOKEN"]),
    RELATIONSHIP: Object.freeze([
      "CUSTOMER",
      "CONTACT",
      "CUSTOMERSUBSIDIARYRELATIONSHIP",
      "LEAD",
      "PARTNER",
      "JOB",
      "PROSPECT",
      "VENDORSUBSIDIARYRELATIONSHIP",
      "VENDOR"
    ]),
    SUPPLYCHAIN: Object.freeze([
      "BIN",
      "BOM",
      "BOMREVISION",
      "INBOUNDSHIPMENT",
      "ITEMLOCATIONCONFIGURATION",
      "ITEMREVISION",
      "MANUFACTURINGCOSTTEMPLATE",
      "MANUFACTURINGROUTING"
    ]),
    SUPPORT: Object.freeze(["SOLUTION", "SUPPORTCASE", "TOPIC"]),
    // The static map is a fast path, not an authority: a type resolved here
    // primes instantly, anything unknown falls back to the live category
    // probe, and a type an account does not actually expose simply reports
    // unavailable when its option never appears. The transaction set below
    // was reconciled against a live assistant's own list — the previous set
    // was missing a dozen real record types (Item Fulfillment/Receipt, Work
    // Order, Customer Deposit/Refund…), which sent every one of them down
    // the slow multi-request probe.
    TRANSACTION: Object.freeze([
      "ADVINTERCOMPANYJOURNALENTRY",
      "BINTRANSFER",
      "BINWORKSHEET",
      "CASHREFUND",
      "CASHSALE",
      "CHECK",
      "CUSTOMERDEPOSIT",
      "CUSTOMERPAYMENT",
      "CUSTOMERREFUND",
      "CREDITCARDCHARGE",
      "CREDITCARDREFUND",
      "CREDITMEMO",
      "INTERCOMPANYJOURNALENTRY",
      "INVENTORYADJUSTMENT",
      "INVENTORYCOSTREVALUATION",
      "INVENTORYTRANSFER",
      "INVOICE",
      "ITEMDEMANDPLAN",
      "ITEMFULFILLMENT",
      "ITEMRECEIPT",
      "ITEMSUPPLYPLAN",
      "JOURNALENTRY",
      "OPPORTUNITY",
      "ORDERRESERVATION",
      "PURCHASECONTRACT",
      "PURCHASEORDER",
      "PURCHASEREQUISITION",
      "ESTIMATE",
      "RETURNAUTHORIZATION",
      "SALESORDER",
      "STATISTICALJOURNALENTRY",
      "TRANSFERORDER",
      "VENDORBILL",
      "VENDORCREDIT",
      "VENDORPAYMENT",
      "VENDORPREPAYMENT",
      "VENDORRETURNAUTHORIZATION",
      "WORKORDER"
    ])
  });

  function normalizeImportValue(value) {
    const normalized = String(value ?? "").trim().toUpperCase();
    return /^[A-Z][A-Z0-9_-]*$/.test(normalized) ? normalized : null;
  }

  function resolveStaticCategory(recordSubtype) {
    const subtype = normalizeImportValue(recordSubtype);
    if (!subtype) {
      return null;
    }
    if (subtype.startsWith("CUSTOMRECORD")) {
      return "CUSTOMRECORD";
    }
    if (/^CUSTOM(?:TRANSACTION|SALE|PURCHASE)/.test(subtype)) {
      return "TRANSACTION";
    }
    return Object.entries(CATEGORY_RECORD_TYPES)
      .find(([, recordTypes]) => recordTypes.includes(subtype))?.[0] ?? null;
  }

  function parseOptionsData(value) {
    try {
      const options = JSON.parse(String(value ?? ""));
      return Array.isArray(options)
        ? options.flatMap((option) => {
            const normalizedValue = normalizeImportValue(option?.value);
            return normalizedValue ? [{ value: normalizedValue, text: String(option?.text ?? "") }] : [];
          })
        : [];
    } catch {
      return [];
    }
  }

  function normalizeFieldValues(values) {
    const normalized = {};
    for (const fieldId of ALLOWED_FIELDS) {
      const value = normalizeImportValue(values?.[fieldId]);
      if (value) {
        normalized[fieldId] = value;
      }
    }
    return normalized;
  }

  global.SuiteMateV3ImportAssistantCore = Object.freeze({
    IMPORT_ASSISTANT_PATH,
    ALLOWED_FIELDS,
    CATEGORY_RECORD_TYPES,
    normalizeImportValue,
    resolveStaticCategory,
    parseOptionsData,
    normalizeFieldValues,
  });
})(globalThis);
