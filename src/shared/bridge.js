(function defineSuiteMateV3Bridge(globalScope) {
  "use strict";

  const VERSION = 1;
  const existing = globalScope.SuiteMateV3Bridge;
  if (existing?.VERSION === VERSION) {
    if (globalScope.document?.documentElement?.dataset) {
      globalScope.document.documentElement.dataset.suitemateV3Bridge = String(VERSION);
    }
    return;
  }

  const MESSAGE_TYPE = "SUITEMATE_V3_NETSUITE_BRIDGE";
  const RESPONSE_TYPE = "SUITEMATE_V3_NETSUITE_BRIDGE_RESPONSE";
  const DEFAULT_TIMEOUT_MS = 125000;
  const MAX_TIMEOUT_MS = 130000;
  const MAX_REQUEST_ID_LENGTH = 128;
  const MAX_PAYLOAD_BYTES = 200000;
  const MAX_RESPONSE_BYTES = 50000000;
  const routeApi = globalScope.SuiteMateV3Routes;

  const COMMANDS = Object.freeze({
    CANCEL: "bridge.cancel",
    SUITEQL_START: "suiteql.start",
    SUITEQL_PAGE: "suiteql.page",
    SUITEQL_DISPOSE: "suiteql.dispose",
    RECORD_GET_TYPE: "record.getType",
    IMPORT_ASSISTANT_SET_VALUES: "importAssistant.setValues"
  });

  const IMPORT_ASSISTANT_FIELDS = Object.freeze([
    "charencoding",
    "recordtype",
    "recordsubtype"
  ]);

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeError(value, fallbackCode = "BRIDGE_ERROR") {
    const error = isObject(value) ? value : {};
    const message = [error.message, error.description, error.details, error.detail]
      .find((candidate) => typeof candidate === "string" && candidate.trim());
    const details = [error.details, error.detail, error.stack]
      .find((candidate) => typeof candidate === "string" && candidate.trim() && candidate !== message);
    const namedCode = error.name && error.name !== "Error" ? error.name : "";
    return {
      code: String(error.code || namedCode || fallbackCode),
      message: message?.trim() || String(value || "NetSuite bridge request failed."),
      details: details?.trim() || ""
    };
  }

  function createErrorResponse(requestId, command, value, fallbackCode) {
    return {
      type: RESPONSE_TYPE,
      version: VERSION,
      ok: false,
      requestId: typeof requestId === "string" ? requestId : "",
      command: typeof command === "string" ? command : "",
      error: normalizeError(value, fallbackCode)
    };
  }

  function createSuccessResponse(requestId, command, data = {}) {
    return {
      type: RESPONSE_TYPE,
      version: VERSION,
      ok: true,
      requestId,
      command,
      data: isObject(data) ? data : { value: data }
    };
  }

  function validationFailure(code, message, details = "") {
    return {
      ok: false,
      error: { code, message, details }
    };
  }

  function validationSuccess(payload) {
    return { ok: true, payload };
  }

  function validateExactKeys(value, allowedKeys) {
    if (!isObject(value)) {
      return validationFailure("INVALID_PAYLOAD", "Bridge payload must be an object.");
    }
    const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
    if (unexpected.length) {
      return validationFailure(
        "UNEXPECTED_PAYLOAD_FIELD",
        `Bridge payload contains unsupported field: ${unexpected[0]}.`
      );
    }
    return null;
  }

  function validateResponseKeys(value, allowedKeys) {
    const invalid = validateExactKeys(value, allowedKeys);
    if (!invalid) {
      return null;
    }
    return validationFailure(
      "INVALID_BRIDGE_RESPONSE",
      invalid.error.message.replace("payload", "response")
    );
  }

  function validateEmptyPayload(value) {
    const invalid = validateExactKeys(value, []);
    return invalid ?? validationSuccess({});
  }

  function validateCancel(value) {
    const invalid = validateExactKeys(value, ["targetCommand", "targetRequestId"]);
    if (invalid) {
      return invalid;
    }
    if (
      typeof value.targetCommand !== "string"
      || value.targetCommand === COMMANDS.CANCEL
      || !COMMAND_POLICIES[value.targetCommand]
    ) {
      return validationFailure(
        "INVALID_CANCEL_TARGET",
        "Bridge cancellation target command is invalid."
      );
    }
    if (!isValidRequestId(value.targetRequestId)) {
      return validationFailure(
        "INVALID_CANCEL_TARGET",
        "Bridge cancellation target request ID is invalid."
      );
    }
    return validationSuccess({
      targetCommand: value.targetCommand,
      targetRequestId: value.targetRequestId
    });
  }

  function validateSuiteQLStart(value) {
    const invalid = validateExactKeys(value, ["query", "paged"]);
    if (invalid) {
      return invalid;
    }
    if (typeof value.query !== "string") {
      return validationFailure("INVALID_QUERY", "SuiteQL query must be text.");
    }
    if (value.paged !== undefined && typeof value.paged !== "boolean") {
      return validationFailure("INVALID_PAGED_FLAG", "SuiteQL paged mode must be true or false.");
    }
    return validationSuccess({
      query: value.query,
      paged: value.paged === true
    });
  }

  function validateSuiteQLPage(value) {
    const invalid = validateExactKeys(value, ["pageIndex"]);
    if (invalid) {
      return invalid;
    }
    if (!Number.isInteger(value.pageIndex) || value.pageIndex < 0) {
      return validationFailure("INVALID_PAGE", "SuiteQL page index must be a non-negative integer.");
    }
    return validationSuccess({ pageIndex: value.pageIndex });
  }

  function validateImportAssistantValues(value) {
    const invalid = validateExactKeys(value, ["values"]);
    if (invalid) {
      return invalid;
    }
    if (!isObject(value.values)) {
      return validationFailure(
        "INVALID_IMPORT_VALUES",
        "Import Assistant values must be an object."
      );
    }

    const unexpected = Object.keys(value.values).filter(
      (fieldId) => !IMPORT_ASSISTANT_FIELDS.includes(fieldId)
    );
    if (unexpected.length) {
      return validationFailure(
        "UNSUPPORTED_IMPORT_FIELD",
        `Import Assistant field is not allowlisted: ${unexpected[0]}.`
      );
    }
    if (!Object.keys(value.values).length) {
      return validationFailure(
        "INVALID_IMPORT_VALUES",
        "At least one Import Assistant value is required."
      );
    }
    for (const [fieldId, fieldValue] of Object.entries(value.values)) {
      if (typeof fieldValue !== "string") {
        return validationFailure(
          "INVALID_IMPORT_VALUE",
          `Import Assistant field ${fieldId} must be text.`
        );
      }
    }
    return validationSuccess({ values: { ...value.values } });
  }

  function validateSuiteQLResponse(value) {
    const allowedKeys = [
      "columns",
      "rows",
      "elapsedMs",
      "paged",
      "pageIndex",
      "pageSize",
      "loadedCount",
      "totalCount",
      "totalPages"
    ];
    const invalid = validateResponseKeys(value, allowedKeys);
    if (invalid) {
      return invalid;
    }
    if (
      !Array.isArray(value.columns)
      || value.columns.some((column) => typeof column !== "string")
      || new Set(value.columns).size !== value.columns.length
    ) {
      return validationFailure(
        "INVALID_SUITEQL_RESPONSE",
        "SuiteQL response columns must be text."
      );
    }
    if (!Array.isArray(value.rows) || value.rows.some((row) => !isObject(row))) {
      return validationFailure(
        "INVALID_SUITEQL_RESPONSE",
        "SuiteQL response rows must be objects."
      );
    }

    const columns = new Set(value.columns);
    for (const row of value.rows) {
      if (Object.keys(row).some((column) => !columns.has(column))) {
        return validationFailure(
          "INVALID_SUITEQL_RESPONSE",
          "SuiteQL response row contains an undeclared column."
        );
      }
    }
    if (typeof value.paged !== "boolean") {
      return validationFailure(
        "INVALID_SUITEQL_RESPONSE",
        "SuiteQL response paged state must be true or false."
      );
    }
    for (const field of [
      "elapsedMs",
      "pageIndex",
      "pageSize",
      "loadedCount",
      "totalCount",
      "totalPages"
    ]) {
      if (!Number.isFinite(value[field]) || value[field] < 0) {
        return validationFailure(
          "INVALID_SUITEQL_RESPONSE",
          `SuiteQL response ${field} must be a non-negative number.`
        );
      }
    }
    for (const field of ["pageIndex", "pageSize", "loadedCount", "totalCount", "totalPages"]) {
      if (!Number.isInteger(value[field])) {
        return validationFailure(
          "INVALID_SUITEQL_RESPONSE",
          `SuiteQL response ${field} must be an integer.`
        );
      }
    }
    return validationSuccess(value);
  }

  function validateDisposeResponse(value) {
    const invalid = validateResponseKeys(value, ["disposed"]);
    if (invalid) {
      return invalid;
    }
    return typeof value.disposed === "boolean"
      ? validationSuccess({ disposed: value.disposed })
      : validationFailure(
          "INVALID_BRIDGE_RESPONSE",
          "SuiteQL dispose response must include a boolean disposed state."
        );
  }

  function validateRecordTypeResponse(value) {
    const invalid = validateResponseKeys(value, ["recordType"]);
    if (invalid) {
      return invalid;
    }
    return value.recordType === null || typeof value.recordType === "string"
      ? validationSuccess({ recordType: value.recordType })
      : validationFailure(
          "INVALID_BRIDGE_RESPONSE",
          "Record type response must contain text or null."
        );
  }

  function validateImportAssistantResponse(value) {
    const invalid = validateResponseKeys(value, ["applied"]);
    if (invalid) {
      return invalid;
    }
    if (
      !Array.isArray(value.applied)
      || value.applied.some((fieldId) => !IMPORT_ASSISTANT_FIELDS.includes(fieldId))
      || new Set(value.applied).size !== value.applied.length
    ) {
      return validationFailure(
        "INVALID_BRIDGE_RESPONSE",
        "Import Assistant response contains invalid applied fields."
      );
    }
    return validationSuccess({ applied: [...value.applied] });
  }

  function validateCancelResponse(value) {
    const invalid = validateResponseKeys(value, ["canceled"]);
    if (invalid) {
      return invalid;
    }
    return typeof value.canceled === "boolean"
      ? validationSuccess({ canceled: value.canceled })
      : validationFailure(
          "INVALID_BRIDGE_RESPONSE",
          "Bridge cancellation response must include a boolean canceled state."
        );
  }

  const COMMAND_POLICIES = Object.freeze({
    [COMMANDS.CANCEL]: Object.freeze({
      capability(payload) {
        return COMMAND_POLICIES[payload.targetCommand]?.capability;
      },
      handlerTimeoutMs: 10000,
      validate: validateCancel,
      validateResponse: validateCancelResponse
    }),
    [COMMANDS.SUITEQL_START]: Object.freeze({
      capability: routeApi?.CAPABILITIES?.SUITEQL_BRIDGE,
      handlerTimeoutMs: 125000,
      validate: validateSuiteQLStart,
      validateResponse: validateSuiteQLResponse
    }),
    [COMMANDS.SUITEQL_PAGE]: Object.freeze({
      capability: routeApi?.CAPABILITIES?.SUITEQL_BRIDGE,
      handlerTimeoutMs: 125000,
      validate: validateSuiteQLPage,
      validateResponse: validateSuiteQLResponse
    }),
    [COMMANDS.SUITEQL_DISPOSE]: Object.freeze({
      capability: routeApi?.CAPABILITIES?.SUITEQL_BRIDGE,
      handlerTimeoutMs: 10000,
      validate: validateEmptyPayload,
      validateResponse: validateDisposeResponse
    }),
    [COMMANDS.RECORD_GET_TYPE]: Object.freeze({
      capability: routeApi?.CAPABILITIES?.RECORD_TYPE_BRIDGE,
      handlerTimeoutMs: 10000,
      validate: validateEmptyPayload,
      validateResponse: validateRecordTypeResponse
    }),
    [COMMANDS.IMPORT_ASSISTANT_SET_VALUES]: Object.freeze({
      capability: routeApi?.CAPABILITIES?.IMPORT_ASSISTANT_BRIDGE,
      handlerTimeoutMs: 30000,
      validate: validateImportAssistantValues,
      validateResponse: validateImportAssistantResponse
    })
  });

  function jsonByteLength(value) {
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch {
      return Number.POSITIVE_INFINITY;
    }
    if (typeof serialized !== "string") {
      return Number.POSITIVE_INFINITY;
    }
    let bytes = 0;
    for (const character of serialized) {
      const codePoint = character.codePointAt(0);
      bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    }
    return bytes;
  }

  function isValidRequestId(value) {
    return typeof value === "string"
      && value.length > 0
      && value.length <= MAX_REQUEST_ID_LENGTH
      && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
  }

  function createRequestId() {
    return globalScope.crypto?.randomUUID?.()
      ?? `bridge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function validateCommandPayload(command, payload) {
    const policy = COMMAND_POLICIES[command];
    if (!policy) {
      return validationFailure(
        "UNKNOWN_BRIDGE_COMMAND",
        "NetSuite bridge command is not allowlisted."
      );
    }

    const result = policy.validate(payload);
    if (!result.ok) {
      return result;
    }
    if (jsonByteLength(result.payload) > MAX_PAYLOAD_BYTES) {
      return validationFailure(
        "BRIDGE_PAYLOAD_TOO_LARGE",
        `Bridge payload exceeds ${MAX_PAYLOAD_BYTES.toLocaleString()} bytes.`
      );
    }
    return result;
  }

  function validateCommandResponse(command, data) {
    const policy = COMMAND_POLICIES[command];
    if (!policy) {
      return validationFailure(
        "UNKNOWN_BRIDGE_COMMAND",
        "NetSuite bridge response command is not allowlisted."
      );
    }
    const result = policy.validateResponse(data);
    if (!result.ok) {
      return result;
    }
    if (jsonByteLength(result.payload) > MAX_RESPONSE_BYTES) {
      return validationFailure(
        "BRIDGE_RESPONSE_TOO_LARGE",
        `Bridge response exceeds ${MAX_RESPONSE_BYTES.toLocaleString()} bytes.`
      );
    }
    return result;
  }

  function createRequest(command, payload = {}, options = {}) {
    const requestId = options.requestId ?? createRequestId();
    if (!isValidRequestId(requestId)) {
      throw Object.assign(new TypeError("Bridge request ID is invalid."), {
        code: "INVALID_REQUEST_ID"
      });
    }
    const validation = validateCommandPayload(command, payload);
    if (!validation.ok) {
      throw Object.assign(new TypeError(validation.error.message), validation.error);
    }
    return {
      type: MESSAGE_TYPE,
      version: VERSION,
      requestId,
      command,
      payload: validation.payload
    };
  }

  function isBridgeMessage(value) {
    return value?.type === MESSAGE_TYPE;
  }

  function validateRequest(message, sender) {
    const requestId = typeof message?.requestId === "string" ? message.requestId : "";
    const command = typeof message?.command === "string" ? message.command : "";

    if (!isBridgeMessage(message)) {
      return {
        ok: false,
        response: createErrorResponse(
          requestId,
          command,
          { code: "INVALID_MESSAGE_TYPE", message: "Message is not a NetSuite bridge request." }
        )
      };
    }
    const envelopeValidation = validateExactKeys(
      message,
      ["type", "version", "requestId", "command", "payload"]
    );
    if (envelopeValidation) {
      return {
        ok: false,
        response: createErrorResponse(requestId, command, envelopeValidation.error)
      };
    }
    if (message.version !== VERSION) {
      return {
        ok: false,
        response: createErrorResponse(
          requestId,
          command,
          {
            code: "UNSUPPORTED_BRIDGE_VERSION",
            message: `Bridge protocol version ${String(message.version)} is not supported.`
          }
        )
      };
    }
    if (!isValidRequestId(requestId)) {
      return {
        ok: false,
        response: createErrorResponse(
          requestId,
          command,
          { code: "INVALID_REQUEST_ID", message: "Bridge request ID is invalid." }
        )
      };
    }

    const policy = COMMAND_POLICIES[command];
    if (!policy) {
      return {
        ok: false,
        response: createErrorResponse(
          requestId,
          command,
          { code: "UNKNOWN_BRIDGE_COMMAND", message: "NetSuite bridge command is not allowlisted." }
        )
      };
    }

    const payloadValidation = validateCommandPayload(command, message.payload);
    if (!payloadValidation.ok) {
      return {
        ok: false,
        response: createErrorResponse(requestId, command, payloadValidation.error)
      };
    }
    const capability = typeof policy.capability === "function"
      ? policy.capability(payloadValidation.payload)
      : policy.capability;
    if (!capability || routeApi?.isAllowedSender?.(sender, capability) !== true) {
      return {
        ok: false,
        response: createErrorResponse(
          requestId,
          command,
          {
            code: "INVALID_SENDER",
            message: "NetSuite bridge command is not allowed from this page."
          }
        )
      };
    }

    return {
      ok: true,
      request: Object.freeze({
        requestId,
        command,
        payload: payloadValidation.payload,
        sender,
        senderContext: routeApi.createSenderContext(sender)
      })
    };
  }

  function normalizeResponse(value, expected = {}) {
    const requestId = expected.requestId ?? "";
    const command = expected.command ?? "";
    if (!isObject(value)) {
      return createErrorResponse(
        requestId,
        command,
        { code: "EMPTY_BRIDGE_RESPONSE", message: "NetSuite bridge returned no response." }
      );
    }
    const responseEnvelopeValidation = validateResponseKeys(
      value,
      value.ok === true
        ? ["type", "version", "ok", "requestId", "command", "data"]
        : ["type", "version", "ok", "requestId", "command", "error"]
    );
    if (responseEnvelopeValidation) {
      return createErrorResponse(requestId, command, responseEnvelopeValidation.error);
    }
    if (value.type !== RESPONSE_TYPE || value.version !== VERSION) {
      return createErrorResponse(
        requestId,
        command,
        {
          code: "INVALID_BRIDGE_RESPONSE",
          message: "NetSuite bridge returned an unsupported response envelope."
        }
      );
    }
    if (value.requestId !== requestId || value.command !== command) {
      return createErrorResponse(
        requestId,
        command,
        {
          code: "BRIDGE_RESPONSE_MISMATCH",
          message: "NetSuite bridge returned a response for another request."
        }
      );
    }
    if (value.ok !== true) {
      return createErrorResponse(requestId, command, value.error);
    }
    if (!isObject(value.data)) {
      return createErrorResponse(
        requestId,
        command,
        {
          code: "INVALID_BRIDGE_RESPONSE",
          message: "NetSuite bridge response data must be an object."
        }
      );
    }
    const dataValidation = validateCommandResponse(command, value.data);
    if (!dataValidation.ok) {
      return createErrorResponse(requestId, command, dataValidation.error);
    }
    return createSuccessResponse(requestId, command, dataValidation.payload);
  }

  function toCommandResult(response) {
    if (response?.ok !== true) {
      return {
        ok: false,
        requestId: String(response?.requestId ?? ""),
        error: normalizeError(response?.error)
      };
    }
    return {
      ...response.data,
      ok: true,
      requestId: response.requestId
    };
  }

  function normalizeTimeout(value) {
    const timeout = Number(value);
    if (!Number.isFinite(timeout) || timeout <= 0) {
      return DEFAULT_TIMEOUT_MS;
    }
    return Math.min(Math.max(1, Math.round(timeout)), MAX_TIMEOUT_MS);
  }

  async function request(command, payload = {}, options = {}) {
    let bridgeRequest;
    try {
      bridgeRequest = createRequest(command, payload, options);
    } catch (error) {
      return createErrorResponse(options.requestId, command, error);
    }

    const runtime = options.runtime ?? globalScope.chrome?.runtime;
    if (typeof runtime?.sendMessage !== "function") {
      return createErrorResponse(
        bridgeRequest.requestId,
        command,
        {
          code: "BRIDGE_RUNTIME_UNAVAILABLE",
          message: "Chrome runtime messaging is unavailable."
        }
      );
    }
    if (options.signal?.aborted) {
      return createErrorResponse(
        bridgeRequest.requestId,
        command,
        { code: "ABORTED", message: "NetSuite bridge request was stopped." }
      );
    }

    const timeoutMs = normalizeTimeout(options.timeoutMs);
    let cancelSent = false;
    const cancelRemote = () => {
      if (cancelSent || command === COMMANDS.CANCEL) {
        return;
      }
      cancelSent = true;
      let cancelRequest;
      try {
        cancelRequest = createRequest(COMMANDS.CANCEL, {
          targetCommand: command,
          targetRequestId: bridgeRequest.requestId
        });
      } catch {
        return;
      }
      try {
        Promise.resolve(runtime.sendMessage(cancelRequest)).catch(() => {});
      } catch {}
    };

    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        globalScope.clearTimeout(timeoutId);
        options.signal?.removeEventListener?.("abort", onAbort);
        resolve(value);
      };
      const onAbort = () => {
        cancelRemote();
        settle(createErrorResponse(
          bridgeRequest.requestId,
          command,
          { code: "ABORTED", message: "NetSuite bridge request was stopped." }
        ));
      };
      const timeoutId = globalScope.setTimeout(() => {
        cancelRemote();
        settle(createErrorResponse(
          bridgeRequest.requestId,
          command,
          {
            code: "BRIDGE_TIMEOUT",
            message: `NetSuite bridge did not respond within ${timeoutMs.toLocaleString()} ms.`
          }
        ));
      }, timeoutMs);

      options.signal?.addEventListener?.("abort", onAbort, { once: true });
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      try {
        Promise.resolve(runtime.sendMessage(bridgeRequest))
          .then((response) => settle(normalizeResponse(response, bridgeRequest)))
          .catch((error) => settle(createErrorResponse(
            bridgeRequest.requestId,
            command,
            error,
            "BRIDGE_SEND_FAILED"
          )));
      } catch (error) {
        settle(createErrorResponse(
          bridgeRequest.requestId,
          command,
          error,
          "BRIDGE_SEND_FAILED"
        ));
      }
    });
  }

  function createDispatcher(handlers = {}) {
    const handlerMap = new Map(Object.entries(handlers));
    const activeRequests = new Map();

    function createRequestKey(senderContext, command, requestId) {
      return [senderContext.tabId, command, requestId].join(":");
    }

    async function dispatch(message, sender) {
      const validation = validateRequest(message, sender);
      if (!validation.ok) {
        return validation.response;
      }

      const requestValue = validation.request;
      if (requestValue.command === COMMANDS.CANCEL) {
        const targetKey = createRequestKey(
          requestValue.senderContext,
          requestValue.payload.targetCommand,
          requestValue.payload.targetRequestId
        );
        const target = activeRequests.get(targetKey);
        target?.controller.abort("bridge-cancel");
        return createSuccessResponse(
          requestValue.requestId,
          requestValue.command,
          { canceled: Boolean(target) }
        );
      }

      const handler = handlerMap.get(requestValue.command);
      if (typeof handler !== "function") {
        return createErrorResponse(
          requestValue.requestId,
          requestValue.command,
          {
            code: "BRIDGE_COMMAND_UNAVAILABLE",
            message: "NetSuite bridge command is not available in this release."
          }
        );
      }

      const requestKey = createRequestKey(
        requestValue.senderContext,
        requestValue.command,
        requestValue.requestId
      );
      if (activeRequests.has(requestKey)) {
        return createErrorResponse(
          requestValue.requestId,
          requestValue.command,
          {
            code: "DUPLICATE_BRIDGE_REQUEST",
            message: "A bridge request with this ID is already running."
          }
        );
      }

      const policy = COMMAND_POLICIES[requestValue.command];
      const controller = new AbortController();
      const requestToken = { controller };
      const executionRequest = Object.freeze({
        ...requestValue,
        signal: controller.signal
      });
      activeRequests.set(requestKey, requestToken);

      let timeoutId = null;
      let abortHandler = null;
      try {
        const data = await new Promise((resolve, reject) => {
          let settled = false;
          const settle = (callback, value) => {
            if (settled) {
              return;
            }
            settled = true;
            callback(value);
          };

          abortHandler = () => settle(reject, {
            code: "ABORTED",
            message: "NetSuite bridge request was stopped."
          });
          controller.signal.addEventListener("abort", abortHandler, { once: true });
          timeoutId = globalScope.setTimeout(() => {
            settle(reject, {
              code: "BRIDGE_HANDLER_TIMEOUT",
              message: `NetSuite bridge handler did not finish within ${policy.handlerTimeoutMs.toLocaleString()} ms.`
            });
            controller.abort("bridge-handler-timeout");
          }, policy.handlerTimeoutMs);

          try {
            Promise.resolve(handler(executionRequest))
              .then((value) => settle(resolve, value))
              .catch((error) => settle(reject, error));
          } catch (error) {
            settle(reject, error);
          }
        });
        const responseValidation = validateCommandResponse(requestValue.command, data);
        if (!responseValidation.ok) {
          throw responseValidation.error;
        }
        return createSuccessResponse(
          requestValue.requestId,
          requestValue.command,
          responseValidation.payload
        );
      } catch (error) {
        return createErrorResponse(
          requestValue.requestId,
          requestValue.command,
          error
        );
      } finally {
        if (timeoutId !== null) {
          globalScope.clearTimeout(timeoutId);
        }
        if (abortHandler) {
          controller.signal.removeEventListener("abort", abortHandler);
        }
        if (activeRequests.get(requestKey) === requestToken) {
          activeRequests.delete(requestKey);
        }
      }
    }

    return Object.freeze({
      dispatch,
      get activeCount() {
        return activeRequests.size;
      }
    });
  }

  const api = Object.freeze({
    VERSION,
    MESSAGE_TYPE,
    RESPONSE_TYPE,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    MAX_REQUEST_ID_LENGTH,
    MAX_PAYLOAD_BYTES,
    MAX_RESPONSE_BYTES,
    COMMANDS,
    IMPORT_ASSISTANT_FIELDS,
    isBridgeMessage,
    isValidRequestId,
    validateCommandPayload,
    validateCommandResponse,
    createRequest,
    validateRequest,
    createSuccessResponse,
    createErrorResponse,
    normalizeError,
    normalizeResponse,
    toCommandResult,
    request,
    createDispatcher
  });
  globalScope.SuiteMateV3Bridge = api;

  if (globalScope.document?.documentElement?.dataset) {
    globalScope.document.documentElement.dataset.suitemateV3Bridge = String(VERSION);
  }
})(globalThis);
