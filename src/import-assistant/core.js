(function defineSuiteMateV3ImportAssistantCore(global) {
  "use strict";

  const routeApi = global.SuiteMateV3Routes;
  const IMPORT_ASSISTANT_PATH = routeApi.PATHS.IMPORT_ASSISTANT;
  const SET_VALUES_MESSAGE = "SUITEMATE_V3_IMPORT_ASSISTANT_SET_VALUES";
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
    SUPPLYCHAIN: Object.freeze(["BIN", "ITEMREVISION", "MANUFACTURINGCOSTTEMPLATE", "MANUFACTURINGROUTING"]),
    SUPPORT: Object.freeze(["SOLUTION", "SUPPORTCASE", "TOPIC"]),
    TRANSACTION: Object.freeze([
      "ADVINTERCOMPANYJOURNALENTRY",
      "CASHSALE",
      "CHECK",
      "CUSTOMERPAYMENT",
      "CREDITCARDCHARGE",
      "CREDITCARDREFUND",
      "CREDITMEMO",
      "INTERCOMPANYJOURNALENTRY",
      "INVENTORYADJUSTMENT",
      "INVENTORYCOSTREVALUATION",
      "INVENTORYTRANSFER",
      "INVOICE",
      "ITEMDEMANDPLAN",
      "ITEMSUPPLYPLAN",
      "JOURNALENTRY",
      "OPPORTUNITY",
      "PURCHASEORDER",
      "ESTIMATE",
      "RETURNAUTHORIZATION",
      "SALESORDER",
      "TRANSFERORDER",
      "VENDORBILL",
      "VENDORCREDIT",
      "VENDORPAYMENT",
      "VENDORRETURNAUTHORIZATION"
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

  function responseContainsSubtype(responseText, recordSubtype) {
    const subtype = normalizeImportValue(recordSubtype);
    if (!subtype) {
      return false;
    }
    return String(responseText ?? "")
      .split("\u0005")[0]
      .split("\u0001")
      .some((value, index) => index % 2 === 1 && value === subtype);
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

  function isAllowedNetSuiteUrl(value) {
    return routeApi.isAllowedNetSuiteUrl(value);
  }

  function isAllowedImportAssistantSender(sender) {
    return routeApi.isAllowedSender(sender, routeApi.CAPABILITIES.IMPORT_ASSISTANT_BRIDGE);
  }

  global.SuiteMateV3ImportAssistantCore = Object.freeze({
    IMPORT_ASSISTANT_PATH,
    SET_VALUES_MESSAGE,
    ALLOWED_FIELDS,
    CATEGORY_RECORD_TYPES,
    normalizeImportValue,
    resolveStaticCategory,
    parseOptionsData,
    responseContainsSubtype,
    normalizeFieldValues,
    isAllowedImportAssistantSender
  });
})(globalThis);
