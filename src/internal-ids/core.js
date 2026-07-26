(function defineSuiteMateV3InternalIdsCore(globalScope) {
  "use strict";

  const VERSION = 1;
  const MAX_IDENTIFIER_LENGTH = 160;
  const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
  const FIELD_PREFIX = "Field:";

  if (globalScope.SuiteMateV3InternalIdsCore?.VERSION === VERSION) {
    return;
  }

  function normalizeIdentifier(value) {
    const identifier = String(value ?? "").trim();
    return identifier.length > 0
      && identifier.length <= MAX_IDENTIFIER_LENGTH
      && IDENTIFIER_PATTERN.test(identifier)
      ? identifier
      : null;
  }

  function fieldIdFromWalkthrough(value) {
    const walkthrough = String(value ?? "");
    return walkthrough.startsWith(FIELD_PREFIX)
      ? normalizeIdentifier(walkthrough.slice(FIELD_PREFIX.length))
      : null;
  }

  function buttonIdFromElementId(value) {
    const identifier = String(value ?? "");
    return identifier.startsWith("tbl_")
      ? normalizeIdentifier(identifier.slice(4))
      : null;
  }

  function machineIdFromElementId(value) {
    return normalizeIdentifier(String(value ?? "").replace(/_+(?:splits|div)$/, ""));
  }

  function sublistColumnId(spanId, machineElementId) {
    const rawSpanId = String(spanId ?? "");
    if (!rawSpanId.endsWith("1_fs")) {
      return null;
    }
    const machineId = String(machineElementId ?? "").replace(/_div$/, "");
    const prefix = machineId ? `${machineId}_` : "";
    const withoutRowSuffix = rawSpanId.slice(0, -4);
    const identifier = prefix && withoutRowSuffix.startsWith(prefix)
      ? withoutRowSuffix.slice(prefix.length)
      : withoutRowSuffix;
    return normalizeIdentifier(identifier);
  }

  function listHeaderId(onclickValue) {
    const onclick = String(onclickValue ?? "").trim();
    if (onclick.startsWith("l_sort(")) {
      const argumentsSource = onclick.slice(onclick.indexOf("(") + 1, onclick.lastIndexOf(")"));
      const identifier = argumentsSource.split(",")[5]?.trim().replace(/^(['"])(.*)\1$/, "$2");
      return normalizeIdentifier(identifier);
    }
    if (onclick.startsWith("if (getFormElementViaFormName(")) {
      return normalizeIdentifier(onclick.match(/value\s*!==?\s*['"]([A-Za-z_][A-Za-z0-9_.:-]*)['"]/)?.[1]);
    }
    return null;
  }

  function customizationScriptIds(fieldsName, fieldsValue, dataValue) {
    const fieldName = String(fieldsName ?? "");
    if (!fieldName.endsWith("fields")) {
      return [];
    }
    const prefix = fieldName.slice(0, -6);
    const fieldNames = String(fieldsValue ?? "")
      .split("\u0001")
      .map((name) => name.startsWith(prefix) ? name.slice(prefix.length) : name);
    if (!fieldNames.includes("scriptid") && !fieldNames.includes("id")) {
      return [];
    }

    return String(dataValue ?? "")
      .split("\u0002")
      .map((row) => {
        const values = row.split("\u0001");
        const record = Object.fromEntries(
          fieldNames.flatMap((name, index) => name ? [[name, values[index]]] : [])
        );
        return normalizeIdentifier(record.scriptid ?? record.id);
      });
  }

  Object.defineProperty(globalScope, "SuiteMateV3InternalIdsCore", {
    value: Object.freeze({
      VERSION,
      MAX_IDENTIFIER_LENGTH,
      normalizeIdentifier,
      fieldIdFromWalkthrough,
      buttonIdFromElementId,
      machineIdFromElementId,
      sublistColumnId,
      listHeaderId,
      customizationScriptIds
    }),
    configurable: false,
    enumerable: true,
    writable: false
  });
})(globalThis);
