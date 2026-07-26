(function initializeSuiteMateV3CsvExportMainWorld(globalScope) {
  "use strict";

  const core = globalScope.SuiteMateV3CsvExportCore;
  if (!core || !globalScope.document || !globalScope.location) {
    return;
  }

  const INSTANCE_KEY = Symbol.for("SuiteMateV3.csvExport.mainWorld.v3");
  if (globalScope[INSTANCE_KEY]) {
    return;
  }

  const PRICE_MATRIX_PATTERN = /price\d+quantity\d+|quantity\d+price\d+/;
  const FIELD_ERROR_PATTERN = /ERROR:\s*Field\s*'[^']+'\s*Not\s*Found/i;
  const UI_ONLY_FIELD_PATTERN = /inline_?html/i;
  let activeRequestId = "";

  function safeCall(callback, fallback = null) {
    try {
      const value = callback();
      return value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function toBoolean(value) {
    return value === true || value === "T";
  }

  function normalizeDisplayText(value) {
    return core.toCellText(value);
  }

  function safeTextValue(recordRef, fieldId) {
    const text = normalizeDisplayText(safeCall(
      () => recordRef.getText({ fieldId }),
      ""
    ));
    return FIELD_ERROR_PATTERN.test(text) ? "" : text;
  }

  function safeSublistTextValue(recordRef, sublistId, fieldId, line) {
    const text = safeCall(
      () => recordRef.getSublistText({ sublistId, fieldId, line }),
      ""
    );
    if (FIELD_ERROR_PATTERN.test(String(text))) {
      return "";
    }
    return normalizeDisplayText(text);
  }

  function safeIdentifierValue(recordRef, fieldId) {
    return normalizeDisplayText(safeCall(
      () => recordRef.getValue({ fieldId }),
      ""
    )).trim();
  }

  function safeSublistIdentifierValue(recordRef, sublistId, fieldId, line) {
    return normalizeDisplayText(safeCall(
      () => recordRef.getSublistValue({ sublistId, fieldId, line }),
      ""
    )).trim();
  }

  function normalizeDescriptor(fieldId, label, scope = "") {
    const normalizedId = String(fieldId ?? "").trim().toLowerCase();
    const normalizedLabel = String(label ?? "").trim();
    if (
      !normalizedId
      || !normalizedLabel
      || normalizedLabel.startsWith("_")
      || PRICE_MATRIX_PATTERN.test(normalizedId)
      || UI_ONLY_FIELD_PATTERN.test(normalizedId)
    ) {
      return null;
    }
    return {
      fieldId: normalizedId,
      label: normalizedLabel,
      scope: String(scope ?? "").trim().toLowerCase()
    };
  }

  function getFormField(form, line, sublistId) {
    const fieldId = safeCall(
      () => form.getSublistValue({
        sublistId,
        line,
        fieldId: `${sublistId}field`
      }),
      ""
    );
    const descriptor = normalizeDescriptor(
      fieldId,
      safeCall(
        () => form.getSublistValue({
          sublistId,
          line,
          fieldId: `${sublistId}label`
        }),
        ""
      )
    );
    if (!descriptor) {
      return null;
    }

    const mandatory = toBoolean(safeCall(
      () => form.getSublistValue({
        sublistId,
        line,
        fieldId: `${sublistId}mandatory`
      }),
      false
    ));
    const onScreen = toBoolean(safeCall(
      () => form.getSublistValue({
        sublistId,
        line,
        fieldId: `${sublistId}bscreen`
      }),
      false
    ));
    if (sublistId === "col" ? !onScreen : !mandatory && !onScreen) {
      return null;
    }
    return descriptor;
  }

  function recordHasField(recordRef, fieldId) {
    return Boolean(safeCall(() => recordRef.getField({ fieldId }), null));
  }

  function recordHasSublistField(recordRef, sublistId, fieldId) {
    return Boolean(safeCall(
      () => recordRef.getSublistField({ sublistId, fieldId, line: 0 }),
      null
    ));
  }

  function getFormFields(form, sublistId, recordRef, recordSublistId) {
    const lineCount = Number(safeCall(() => form.getLineCount({ sublistId }), -1));
    if (!Number.isSafeInteger(lineCount) || lineCount <= 0) {
      return [];
    }

    const fields = [];
    for (let line = 0; line < lineCount; line += 1) {
      const descriptor = getFormField(form, line, sublistId);
      if (!descriptor) {
        continue;
      }
      const exists = sublistId === "col"
        ? recordSublistId && recordHasSublistField(recordRef, recordSublistId, descriptor.fieldId)
        : recordHasField(recordRef, descriptor.fieldId);
      if (exists) {
        fields.push({
          ...descriptor,
          scope: sublistId === "col" ? recordSublistId : "record"
        });
      }
    }
    return fields;
  }

  function getRecordFields(recordRef, sublistId = "") {
    const fieldIds = sublistId
      ? safeCall(() => recordRef.getSublistFields({ sublistId }), [])
      : safeCall(() => recordRef.getFields(), []);
    if (!Array.isArray(fieldIds)) {
      return [];
    }

    const fields = [];
    for (const fieldId of fieldIds) {
      const field = sublistId
        ? safeCall(() => recordRef.getSublistField({ sublistId, fieldId, line: 0 }), null)
        : safeCall(() => recordRef.getField({ fieldId }), null);
      const descriptor = normalizeDescriptor(
        field?.id ?? fieldId,
        field?.label,
        sublistId || "record"
      );
      if (descriptor) {
        fields.push(descriptor);
      }
    }
    return fields;
  }

  function findPopulatedSublist(recordRef) {
    for (const sublistId of core.CANDIDATE_SUBLISTS) {
      const lineCount = Number(safeCall(() => recordRef.getLineCount({ sublistId }), -1));
      if (Number.isSafeInteger(lineCount) && lineCount > 0) {
        return { sublistId, lineCount };
      }
    }
    return { sublistId: "", lineCount: 0 };
  }

  function deduplicateDescriptors(descriptors) {
    const seen = new Set();
    return descriptors.filter((descriptor) => {
      if (!descriptor || seen.has(descriptor.fieldId)) {
        return false;
      }
      seen.add(descriptor.fieldId);
      return true;
    });
  }

  function createRecordIdentifierFields(recordRef) {
    const fields = [{
      fieldId: "internalid",
      label: "Record Internal ID",
      scope: "record",
      value: normalizeDisplayText(recordRef.id).trim(),
      alwaysInclude: true
    }];

    if (recordHasField(recordRef, "externalid")) {
      fields.push({
        fieldId: "externalid",
        label: "Record External ID",
        scope: "record",
        value: safeIdentifierValue(recordRef, "externalid"),
        alwaysInclude: true
      });
    }

    const entityField = safeCall(
      () => recordRef.getField({ fieldId: "entity" }),
      null
    );
    if (entityField) {
      const entityLabel = String(entityField.label ?? "").trim();
      const subject = /customer/i.test(entityLabel)
        ? "Customer"
        : /supplier/i.test(entityLabel)
          ? "Supplier"
          : /vendor/i.test(entityLabel)
            ? "Vendor"
            : "Entity";
      fields.push({
        fieldId: "entityinternalid",
        label: `${subject} Internal ID`,
        scope: "record",
        value: safeIdentifierValue(recordRef, "entity"),
        alwaysInclude: true
      });
    }
    return fields;
  }

  function createItemIdentifierField(recordRef, sublistId) {
    if (
      sublistId !== "item"
      || !recordHasSublistField(recordRef, sublistId, "item")
    ) {
      return [];
    }
    return [{
      fieldId: "iteminternalid",
      sourceFieldId: "item",
      label: "Item Internal ID",
      scope: sublistId,
      valueMode: "identifier",
      alwaysInclude: true
    }];
  }

  function prioritizeBodyFields(fields) {
    const primaryIds = new Set(["tranid", "name", "entityid"]);
    const identifierIds = new Set([
      "internalid",
      "externalid",
      "entityinternalid"
    ]);
    return [
      ...fields.filter(({ fieldId }) => primaryIds.has(fieldId)),
      ...fields.filter(({ fieldId }) => identifierIds.has(fieldId)),
      ...fields.filter(({ fieldId }) =>
        !primaryIds.has(fieldId) && !identifierIds.has(fieldId))
    ];
  }

  async function loadRecord(recordModule, options) {
    if (typeof recordModule?.load?.promise !== "function") {
      const error = new Error("NetSuite record.load.promise is unavailable on this page.");
      error.code = "RECORD_LOAD_UNAVAILABLE";
      throw error;
    }
    return recordModule.load.promise(options);
  }

  async function collectFormFields(recordModule, recordRef, recordType, recordSublistId) {
    const fields = { header: [], body: [], col: [] };
    if (String(recordType).startsWith("customrecord")) {
      return fields;
    }

    const formId = safeCall(() => recordRef.getValue({ fieldId: "customform" }), "");
    if (!formId) {
      return fields;
    }

    let form;
    try {
      form = await loadRecord(recordModule, {
        type: "custform",
        id: formId,
        isDynamic: true
      });
    } catch {
      return fields;
    }

    for (const sublistId of Object.keys(fields)) {
      fields[sublistId] = getFormFields(form, sublistId, recordRef, recordSublistId);
      if (sublistId !== "col") {
        fields[sublistId] = fields[sublistId].map((descriptor) => ({
          ...descriptor,
          value: safeTextValue(recordRef, descriptor.fieldId)
        }));
      }
    }
    return fields;
  }

  function addNativeBodyFields(recordRef, recordType, formFields) {
    const existingIds = new Set(
      [...formFields.header, ...formFields.body].map(({ fieldId }) => fieldId)
    );
    const isCustomRecord = String(recordType).startsWith("customrecord");
    return getRecordFields(recordRef)
      .filter(({ fieldId }) =>
        !existingIds.has(fieldId)
        && (isCustomRecord || !fieldId.startsWith("custbody")))
      .map((descriptor) => ({
        ...descriptor,
        value: safeTextValue(recordRef, descriptor.fieldId)
      }));
  }

  function addNativeSublistFields(recordRef, sublistId, formColumns) {
    if (!sublistId) {
      return [];
    }
    const existing = new Set(formColumns.map(({ fieldId }) => fieldId));
    const excluded = new Set(["itemname", "itemkey", "sitemname"]);
    return getRecordFields(recordRef, sublistId).filter(({ fieldId }) => {
      if (existing.has(fieldId) || excluded.has(fieldId)) {
        return false;
      }
      return fieldId.includes("custcol") || !fieldId.endsWith("display");
    });
  }

  function buildCsvMatrix(recordRef, bodyFields, sublistId, lineCount, sublistFields) {
    const fields = sublistId
      ? [
        ...bodyFields,
        { label: "Line ID", fieldId: "line", scope: sublistId },
        ...sublistFields
      ]
      : bodyFields;
    const headers = core.makeUniqueHeaders(fields);
    const alwaysIncludeIndexes = fields
      .map((field, index) => field.alwaysInclude ? index : -1)
      .filter((index) => index >= 0);
    const rows = [headers];

    if (!sublistId) {
      rows.push(bodyFields.map(({ value }) => value));
      const populatedRows = core.removeEmptyColumns(rows, alwaysIncludeIndexes);
      return {
        rows: populatedRows,
        dataRowCount: 1,
        columnCount: populatedRows[0]?.length ?? 0
      };
    }

    for (let line = 0; line < lineCount; line += 1) {
      rows.push([
        ...bodyFields.map(({ value }) => value),
        safeSublistTextValue(recordRef, sublistId, "line", line),
        ...sublistFields.map((field) =>
          field.valueMode === "identifier"
            ? safeSublistIdentifierValue(
              recordRef,
              sublistId,
              field.sourceFieldId || field.fieldId,
              line
            )
            : safeSublistTextValue(
              recordRef,
              sublistId,
              field.fieldId,
              line
            ))
      ]);
    }
    const populatedRows = core.removeEmptyColumns(rows, alwaysIncludeIndexes);
    return {
      rows: populatedRows,
      dataRowCount: lineCount,
      columnCount: populatedRows[0]?.length ?? 0
    };
  }

  function getRecordFilename(recordRef) {
    const name = safeCall(() => recordRef.getValue({ fieldId: "tranid" }), "")
      || safeCall(() => recordRef.getValue({ fieldId: "name" }), "")
      || recordRef.id;
    return core.createFilename(name);
  }

  function downloadCsv(csv, filename) {
    if (
      typeof globalScope.Blob !== "function"
      || typeof globalScope.URL?.createObjectURL !== "function"
      || typeof globalScope.URL?.revokeObjectURL !== "function"
      || !globalScope.document?.body
    ) {
      const error = new Error("CSV downloads are unavailable in this browser context.");
      error.code = "DOWNLOAD_UNAVAILABLE";
      throw error;
    }

    const blob = new globalScope.Blob([`\ufeff${csv}`], {
      type: "text/csv;charset=utf-8"
    });
    const url = globalScope.URL.createObjectURL(blob);
    const link = globalScope.document.createElement("a");
    try {
      link.href = url;
      link.download = filename;
      link.hidden = true;
      globalScope.document.body.append(link);
      link.click();
    } finally {
      link.remove();
      globalScope.setTimeout(() => globalScope.URL.revokeObjectURL(url), 1000);
    }
  }

  async function runExport(recordModule, currentRecordModule, mode = "export") {
    const currentRecord = currentRecordModule?.get?.();
    const recordId = currentRecord?.id;
    const recordType = String(currentRecord?.type ?? "").trim();
    if (!recordId || !recordType) {
      const error = new Error("This page does not expose a saved NetSuite record.");
      error.code = "CURRENT_RECORD_UNAVAILABLE";
      throw error;
    }

    const recordRef = await loadRecord(recordModule, {
      type: recordType,
      id: recordId
    });
    const { sublistId, lineCount } = findPopulatedSublist(recordRef);
    const formFields = await collectFormFields(
      recordModule,
      recordRef,
      recordType,
      sublistId
    );
    const bodyFields = prioritizeBodyFields(deduplicateDescriptors([
      ...createRecordIdentifierFields(recordRef),
      ...formFields.header,
      ...formFields.body,
      ...addNativeBodyFields(recordRef, recordType, formFields)
    ]));
    const sublistFields = deduplicateDescriptors([
      ...createItemIdentifierField(recordRef, sublistId),
      ...formFields.col,
      ...addNativeSublistFields(recordRef, sublistId, formFields.col)
    ]);
    const matrix = buildCsvMatrix(
      recordRef,
      bodyFields,
      sublistId,
      lineCount,
      sublistFields
    );
    if (matrix.columnCount === 0) {
      const error = new Error("No exportable fields were found on this record.");
      error.code = "NO_EXPORTABLE_FIELDS";
      throw error;
    }

    const recordFilename = getRecordFilename(recordRef);
    const filename = mode === "template"
      ? core.createTemplateFilename(recordFilename)
      : recordFilename;
    const downloadRows = mode === "template"
      ? [matrix.rows[0]]
      : matrix.rows;
    downloadCsv(core.serializeCsv(downloadRows), filename);
    return Object.freeze({
      filename,
      recordType,
      sublistId,
      mode,
      rowCount: mode === "template" ? 0 : matrix.dataRowCount,
      columnCount: matrix.columnCount
    });
  }

  function normalizeError(error) {
    return Object.freeze({
      code: String(error?.code || error?.name || "CSV_EXPORT_FAILED").slice(0, 100),
      message: String(
        error?.message || error?.details || "The CSV export failed."
      ).slice(0, 1000)
    });
  }

  function dispatchResult(detail) {
    globalScope.dispatchEvent(new globalScope.CustomEvent(core.RESULT_EVENT, {
      detail
    }));
  }

  function loadSuiteScriptModules() {
    return new Promise((resolve, reject) => {
      if (typeof globalScope.require !== "function") {
        const error = new Error("NetSuite SuiteScript modules are unavailable on this page.");
        error.code = "SUITESCRIPT_UNAVAILABLE";
        reject(error);
        return;
      }
      try {
        globalScope.require(
          ["N/record", "N/currentRecord"],
          (recordModule, currentRecordModule) =>
            resolve({ recordModule, currentRecordModule }),
          reject
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  async function handleRequest(event) {
    const request = core.normalizeRequestDetail(event?.detail);
    if (!request) {
      return;
    }
    if (!core.isExportableLocation(globalScope.location)) {
      dispatchResult({
        ok: false,
        requestId: request.requestId,
        error: {
          code: "UNSUPPORTED_RECORD_PAGE",
          message: "CSV Export is available only on a saved NetSuite record."
        }
      });
      return;
    }
    if (activeRequestId) {
      dispatchResult({
        ok: false,
        requestId: request.requestId,
        error: {
          code: "CSV_EXPORT_BUSY",
          message: "Another CSV export is already running."
        }
      });
      return;
    }

    activeRequestId = request.requestId;
    try {
      const { recordModule, currentRecordModule } = await loadSuiteScriptModules();
      const result = await runExport(
        recordModule,
        currentRecordModule,
        request.mode
      );
      dispatchResult({
        ok: true,
        requestId: request.requestId,
        ...result
      });
    } catch (error) {
      dispatchResult({
        ok: false,
        requestId: request.requestId,
        error: normalizeError(error)
      });
    } finally {
      activeRequestId = "";
    }
  }

  globalScope.addEventListener(core.REQUEST_EVENT, handleRequest);
  globalScope[INSTANCE_KEY] = Object.freeze({
    VERSION: 1,
    dispose() {
      globalScope.removeEventListener(core.REQUEST_EVENT, handleRequest);
      activeRequestId = "";
    }
  });
})(globalThis);
