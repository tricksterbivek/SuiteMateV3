import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [routesSource, bridgeSource] = await Promise.all([
  readFile(resolve(root, "src/shared/routes.js"), "utf8"),
  readFile(resolve(root, "src/shared/bridge.js"), "utf8")
]);

function createApi() {
  const sandbox = {
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    console
  };
  sandbox.globalThis = sandbox;
  runInNewContext(routesSource, sandbox);
  runInNewContext(bridgeSource, sandbox);
  return {
    bridge: sandbox.SuiteMateV3Bridge,
    routes: sandbox.SuiteMateV3Routes
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function sender(url, tabId = 7, frameId = 0) {
  return {
    frameId,
    tab: { id: tabId, url },
    url
  };
}

const { bridge, routes } = createApi();
const studioUrl = `https://123456.app.netsuite.com${routes.PATHS.SUITEQL_CONSOLE}?suiteql`;
const recordUrl = "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=1";
const importUrl = `https://123456.app.netsuite.com${routes.PATHS.IMPORT_ASSISTANT}?recordsubtype=salesorder`;

test("exports one frozen versioned command registry", () => {
  assert.equal(bridge.VERSION, 1);
  assert.equal(bridge.MESSAGE_TYPE, "SUITEMATE_V3_NETSUITE_BRIDGE");
  assert.equal(bridge.RESPONSE_TYPE, "SUITEMATE_V3_NETSUITE_BRIDGE_RESPONSE");
  assert.deepEqual(plain(bridge.COMMANDS), {
    CANCEL: "bridge.cancel",
    SUITEQL_START: "suiteql.start",
    SUITEQL_PAGE: "suiteql.page",
    SUITEQL_DISPOSE: "suiteql.dispose",
    RECORD_GET_TYPE: "record.getType",
    IMPORT_ASSISTANT_SET_VALUES: "importAssistant.setValues"
  });
  assert.equal(Object.isFrozen(bridge.COMMANDS), true);
  assert.equal(Object.isFrozen(bridge.IMPORT_ASSISTANT_FIELDS), true);
});

test("reuses the same bridge API and reports its live protocol version", () => {
  const documentElement = { dataset: {} };
  const sandbox = {
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    document: { documentElement }
  };
  sandbox.globalThis = sandbox;
  runInNewContext(routesSource, sandbox);
  runInNewContext(bridgeSource, sandbox);
  const first = sandbox.SuiteMateV3Bridge;
  runInNewContext(bridgeSource, sandbox);
  assert.equal(sandbox.SuiteMateV3Bridge, first);
  assert.equal(documentElement.dataset.suitemateV3Bridge, "1");
});

test("creates canonical requests and rejects malformed command payloads", () => {
  assert.deepEqual(
    plain(bridge.createRequest(
      bridge.COMMANDS.SUITEQL_START,
      { query: "SELECT 1", paged: true },
      { requestId: "query-1" }
    )),
    {
      type: bridge.MESSAGE_TYPE,
      version: 1,
      requestId: "query-1",
      command: "suiteql.start",
      payload: { query: "SELECT 1", paged: true }
    }
  );
  assert.deepEqual(
    plain(bridge.createRequest(
      bridge.COMMANDS.RECORD_GET_TYPE,
      {},
      { requestId: "record-1" }
    ).payload),
    {}
  );
  assert.throws(
    () => bridge.createRequest("record.delete", {}, { requestId: "blocked-1" }),
    (error) => error.code === "UNKNOWN_BRIDGE_COMMAND"
  );
  assert.throws(
    () => bridge.createRequest(
      bridge.COMMANDS.SUITEQL_PAGE,
      { pageIndex: "1" },
      { requestId: "page-1" }
    ),
    (error) => error.code === "INVALID_PAGE"
  );
  assert.throws(
    () => bridge.createRequest(
      bridge.COMMANDS.SUITEQL_START,
      { query: "SELECT 1", arbitrary: true },
      { requestId: "query-2" }
    ),
    (error) => error.code === "UNEXPECTED_PAYLOAD_FIELD"
  );
  assert.throws(
    () => bridge.createRequest(
      bridge.COMMANDS.IMPORT_ASSISTANT_SET_VALUES,
      { values: { recordtype: "TRANSACTION", arbitrary: "BLOCKED" } },
      { requestId: "import-1" }
    ),
    (error) => error.code === "UNSUPPORTED_IMPORT_FIELD"
  );
  assert.throws(
    () => bridge.createRequest(
      bridge.COMMANDS.RECORD_GET_TYPE,
      {},
      { requestId: "invalid request id" }
    ),
    (error) => error.code === "INVALID_REQUEST_ID"
  );
});

test("rejects oversized payloads before runtime messaging", () => {
  const oversized = "x".repeat(bridge.MAX_PAYLOAD_BYTES + 1);
  assert.throws(
    () => bridge.createRequest(
      bridge.COMMANDS.SUITEQL_START,
      { query: oversized, paged: false },
      { requestId: "oversized-1" }
    ),
    (error) => error.code === "BRIDGE_PAYLOAD_TOO_LARGE"
  );
});

test("enforces command-specific route and frame authority", () => {
  const suiteRequest = bridge.createRequest(
    bridge.COMMANDS.SUITEQL_START,
    { query: "SELECT 1", paged: false },
    { requestId: "query-auth" }
  );
  assert.equal(bridge.validateRequest(suiteRequest, sender(studioUrl)).ok, true);
  assert.equal(
    bridge.validateRequest(suiteRequest, sender(studioUrl, 7, 1)).response.error.code,
    "INVALID_SENDER"
  );
  assert.equal(
    bridge.validateRequest(suiteRequest, sender(recordUrl)).response.error.code,
    "INVALID_SENDER"
  );

  const recordRequest = bridge.createRequest(
    bridge.COMMANDS.RECORD_GET_TYPE,
    {},
    { requestId: "record-auth" }
  );
  assert.equal(bridge.validateRequest(recordRequest, sender(recordUrl)).ok, true);
  assert.equal(
    bridge.validateRequest(recordRequest, sender(studioUrl)).response.error.code,
    "INVALID_SENDER"
  );

  const importRequest = bridge.createRequest(
    bridge.COMMANDS.IMPORT_ASSISTANT_SET_VALUES,
    { values: { recordtype: "TRANSACTION" } },
    { requestId: "import-auth" }
  );
  assert.equal(bridge.validateRequest(importRequest, sender(importUrl)).ok, true);
  assert.equal(
    bridge.validateRequest(importRequest, sender(recordUrl)).response.error.code,
    "INVALID_SENDER"
  );
  assert.equal(
    bridge.validateRequest(
      importRequest,
      sender("https://example.com/app/setup/assistants/nsimport/importassistant.nl")
    ).response.error.code,
    "INVALID_SENDER"
  );
});

test("rejects unsupported versions, unknown commands, and invalid request IDs", () => {
  const valid = bridge.createRequest(
    bridge.COMMANDS.SUITEQL_DISPOSE,
    {},
    { requestId: "dispose-1" }
  );
  assert.equal(
    bridge.validateRequest({ ...valid, version: 99 }, sender(studioUrl)).response.error.code,
    "UNSUPPORTED_BRIDGE_VERSION"
  );
  assert.equal(
    bridge.validateRequest({ ...valid, command: "unknown.command" }, sender(studioUrl)).response.error.code,
    "UNKNOWN_BRIDGE_COMMAND"
  );
  assert.equal(
    bridge.validateRequest({ ...valid, requestId: "" }, sender(studioUrl)).response.error.code,
    "INVALID_REQUEST_ID"
  );
  assert.equal(
    bridge.validateRequest({ ...valid, arbitrary: true }, sender(studioUrl)).response.error.code,
    "UNEXPECTED_PAYLOAD_FIELD"
  );
  assert.equal(bridge.isBridgeMessage({ type: "SUITEMATE_V3_SUITEQL_START" }), false);
});

test("normalizes response envelopes and rejects stale or malformed responses", () => {
  const expected = {
    requestId: "query-response",
    command: bridge.COMMANDS.SUITEQL_START
  };
  const success = bridge.createSuccessResponse(
    expected.requestId,
    expected.command,
    {
      columns: ["id"],
      rows: [{ id: 1 }],
      elapsedMs: 4,
      paged: false,
      pageIndex: 0,
      pageSize: 1,
      loadedCount: 1,
      totalCount: 1,
      totalPages: 1
    }
  );
  assert.deepEqual(
    plain(bridge.toCommandResult(bridge.normalizeResponse(success, expected))),
    {
      columns: ["id"],
      rows: [{ id: 1 }],
      elapsedMs: 4,
      paged: false,
      pageIndex: 0,
      pageSize: 1,
      loadedCount: 1,
      totalCount: 1,
      totalPages: 1,
      ok: true,
      requestId: "query-response"
    }
  );

  const failure = bridge.createErrorResponse(
    expected.requestId,
    expected.command,
    { code: "PERMISSION_VIOLATION", message: "Permission denied." }
  );
  assert.equal(
    bridge.normalizeResponse(failure, expected).error.code,
    "PERMISSION_VIOLATION"
  );
  assert.equal(
    bridge.normalizeResponse(
      { ...success, requestId: "stale-response" },
      expected
    ).error.code,
    "BRIDGE_RESPONSE_MISMATCH"
  );
  assert.equal(
    bridge.normalizeResponse(
      { ...success, version: 2 },
      expected
    ).error.code,
    "INVALID_BRIDGE_RESPONSE"
  );
  assert.equal(
    bridge.normalizeResponse(
      {
        ...success,
        data: {
          ...success.data,
          rows: [{ id: 1, undeclared: "blocked" }]
        }
      },
      expected
    ).error.code,
    "INVALID_SUITEQL_RESPONSE"
  );
  assert.equal(
    bridge.normalizeResponse(
      { ...success, arbitrary: true },
      expected
    ).error.code,
    "INVALID_BRIDGE_RESPONSE"
  );
});

test("client request validates the response and forwards no extra fields", async () => {
  let sentMessage;
  const response = await bridge.request(
    bridge.COMMANDS.RECORD_GET_TYPE,
    {},
    {
      requestId: "record-client",
      timeoutMs: 100,
      runtime: {
        async sendMessage(message) {
          sentMessage = plain(message);
          return bridge.createSuccessResponse(
            message.requestId,
            message.command,
            { recordType: "salesorder" }
          );
        }
      }
    }
  );
  assert.deepEqual(sentMessage, {
    type: bridge.MESSAGE_TYPE,
    version: 1,
    requestId: "record-client",
    command: "record.getType",
    payload: {}
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.recordType, "salesorder");
});

test("client request maps runtime failures, timeouts, and aborts", async () => {
  const failed = await bridge.request(
    bridge.COMMANDS.RECORD_GET_TYPE,
    {},
    {
      requestId: "failed-client",
      timeoutMs: 100,
      runtime: {
        async sendMessage() {
          throw Object.assign(new Error("Service worker stopped."), { code: "WORKER_STOPPED" });
        }
      }
    }
  );
  assert.equal(failed.error.code, "WORKER_STOPPED");

  const plainFailure = await bridge.request(
    bridge.COMMANDS.RECORD_GET_TYPE,
    {},
    {
      requestId: "plain-failed-client",
      timeoutMs: 100,
      runtime: {
        async sendMessage() {
          throw new Error("Service worker stopped.");
        }
      }
    }
  );
  assert.equal(plainFailure.error.code, "BRIDGE_SEND_FAILED");

  const timeoutMessages = [];
  const timedOut = await bridge.request(
    bridge.COMMANDS.RECORD_GET_TYPE,
    {},
    {
      requestId: "timeout-client",
      timeoutMs: 5,
      runtime: {
        sendMessage(message) {
          timeoutMessages.push(plain(message));
          if (message.command === bridge.COMMANDS.CANCEL) {
            return bridge.createSuccessResponse(
              message.requestId,
              message.command,
              { canceled: true }
            );
          }
          return new Promise(() => {});
        }
      }
    }
  );
  assert.equal(timedOut.error.code, "BRIDGE_TIMEOUT");
  assert.equal(timeoutMessages.at(-1).command, bridge.COMMANDS.CANCEL);
  assert.equal(timeoutMessages.at(-1).payload.targetRequestId, "timeout-client");

  const controller = new AbortController();
  let resolveLateResponse;
  const abortMessages = [];
  const pending = bridge.request(
    bridge.COMMANDS.RECORD_GET_TYPE,
    {},
    {
      requestId: "abort-client",
      timeoutMs: 100,
      signal: controller.signal,
      runtime: {
        sendMessage(message) {
          abortMessages.push(plain(message));
          if (message.command === bridge.COMMANDS.CANCEL) {
            return bridge.createSuccessResponse(
              message.requestId,
              message.command,
              { canceled: true }
            );
          }
          return new Promise((resolveResponse) => {
            resolveLateResponse = () => resolveResponse(
              bridge.createSuccessResponse(
                message.requestId,
                message.command,
                { recordType: "salesorder" }
              )
            );
          });
        }
      }
    }
  );
  controller.abort();
  const aborted = await pending;
  assert.equal(aborted.error.code, "ABORTED");
  assert.equal(abortMessages.at(-1).command, bridge.COMMANDS.CANCEL);
  assert.equal(abortMessages.at(-1).payload.targetRequestId, "abort-client");
  resolveLateResponse();
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(aborted.error.code, "ABORTED");
});

test("dispatcher invokes only allowlisted handlers and normalizes failures", async () => {
  const calls = [];
  const dispatcher = bridge.createDispatcher({
    [bridge.COMMANDS.RECORD_GET_TYPE]: async (request) => {
      calls.push(request.command);
      return { recordType: "salesorder" };
    },
    [bridge.COMMANDS.SUITEQL_START]: async () => {
      throw { code: "SUITEQL_ERROR", message: "Invalid query." };
    }
  });

  const recordRequest = bridge.createRequest(
    bridge.COMMANDS.RECORD_GET_TYPE,
    {},
    { requestId: "dispatch-record" }
  );
  const recordResponse = await dispatcher.dispatch(recordRequest, sender(recordUrl));
  assert.equal(recordResponse.ok, true);
  assert.equal(recordResponse.data.recordType, "salesorder");
  assert.deepEqual(calls, ["record.getType"]);

  const queryRequest = bridge.createRequest(
    bridge.COMMANDS.SUITEQL_START,
    { query: "SELECT invalid", paged: false },
    { requestId: "dispatch-query" }
  );
  const queryResponse = await dispatcher.dispatch(queryRequest, sender(studioUrl));
  assert.equal(queryResponse.ok, false);
  assert.equal(queryResponse.error.code, "SUITEQL_ERROR");

  const unavailable = bridge.createDispatcher({});
  const unavailableResponse = await unavailable.dispatch(recordRequest, sender(recordUrl));
  assert.equal(unavailableResponse.error.code, "BRIDGE_COMMAND_UNAVAILABLE");

  const malformed = bridge.createDispatcher({
    [bridge.COMMANDS.RECORD_GET_TYPE]: async () => ({ recordType: 42 })
  });
  const malformedResponse = await malformed.dispatch(recordRequest, sender(recordUrl));
  assert.equal(malformedResponse.error.code, "INVALID_BRIDGE_RESPONSE");
});

test("dispatcher rejects duplicate in-flight request IDs per tab", async () => {
  let release;
  const blocker = new Promise((resolvePromise) => {
    release = resolvePromise;
  });
  const dispatcher = bridge.createDispatcher({
    [bridge.COMMANDS.RECORD_GET_TYPE]: async () => {
      await blocker;
      return { recordType: "salesorder" };
    }
  });
  const request = bridge.createRequest(
    bridge.COMMANDS.RECORD_GET_TYPE,
    {},
    { requestId: "duplicate-request" }
  );

  const first = dispatcher.dispatch(request, sender(recordUrl));
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(dispatcher.activeCount, 1);
  const duplicate = await dispatcher.dispatch(request, sender(recordUrl));
  assert.equal(duplicate.error.code, "DUPLICATE_BRIDGE_REQUEST");
  release();
  assert.equal((await first).ok, true);
  assert.equal(dispatcher.activeCount, 0);
});

test("dispatcher cancellation aborts the active handler and releases its request", async () => {
  let observedAbort = false;
  const dispatcher = bridge.createDispatcher({
    [bridge.COMMANDS.IMPORT_ASSISTANT_SET_VALUES]: async ({ signal }) => {
      await new Promise((resolvePromise) => {
        signal.addEventListener("abort", () => {
          observedAbort = true;
          resolvePromise();
        }, { once: true });
      });
      return { applied: [] };
    }
  });
  const importRequest = bridge.createRequest(
    bridge.COMMANDS.IMPORT_ASSISTANT_SET_VALUES,
    { values: { recordtype: "TRANSACTION" } },
    { requestId: "cancel-import" }
  );
  const pendingImport = dispatcher.dispatch(importRequest, sender(importUrl));
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  const cancelRequest = bridge.createRequest(
    bridge.COMMANDS.CANCEL,
    {
      targetCommand: bridge.COMMANDS.IMPORT_ASSISTANT_SET_VALUES,
      targetRequestId: "cancel-import"
    },
    { requestId: "cancel-command" }
  );
  const canceled = await dispatcher.dispatch(cancelRequest, sender(importUrl));
  assert.equal(canceled.ok, true);
  assert.equal(canceled.data.canceled, true);
  assert.equal(observedAbort, true);
  assert.equal((await pendingImport).error.code, "ABORTED");
  assert.equal(dispatcher.activeCount, 0);
});

test("dispatcher deadline aborts a silent handler and releases its request", async () => {
  const timeoutSandbox = {
    URL,
    URLSearchParams,
    AbortController,
    setTimeout(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {}
  };
  timeoutSandbox.globalThis = timeoutSandbox;
  runInNewContext(routesSource, timeoutSandbox);
  runInNewContext(bridgeSource, timeoutSandbox);
  const timeoutBridge = timeoutSandbox.SuiteMateV3Bridge;
  let observedAbort = false;
  const dispatcher = timeoutBridge.createDispatcher({
    [timeoutBridge.COMMANDS.RECORD_GET_TYPE]: ({ signal }) => new Promise(() => {
      signal.addEventListener("abort", () => {
        observedAbort = true;
      }, { once: true });
    })
  });
  const request = timeoutBridge.createRequest(
    timeoutBridge.COMMANDS.RECORD_GET_TYPE,
    {},
    { requestId: "server-timeout" }
  );
  const response = await dispatcher.dispatch(request, sender(recordUrl));
  assert.equal(response.error.code, "BRIDGE_HANDLER_TIMEOUT");
  assert.equal(observedAbort, true);
  assert.equal(dispatcher.activeCount, 0);
});

test("dispatcher allows SuiteQL dispose to interrupt a start with the same request ID", async () => {
  let releaseStart;
  const startBlocker = new Promise((resolvePromise) => {
    releaseStart = resolvePromise;
  });
  const calls = [];
  const dispatcher = bridge.createDispatcher({
    [bridge.COMMANDS.SUITEQL_START]: async () => {
      calls.push("start");
      await startBlocker;
      return {
        columns: [],
        rows: [],
        elapsedMs: 0,
        paged: false,
        pageIndex: 0,
        pageSize: 0,
        loadedCount: 0,
        totalCount: 0,
        totalPages: 0
      };
    },
    [bridge.COMMANDS.SUITEQL_DISPOSE]: async () => {
      calls.push("dispose");
      return { disposed: true };
    }
  });
  const startRequest = bridge.createRequest(
    bridge.COMMANDS.SUITEQL_START,
    { query: "SELECT 1", paged: false },
    { requestId: "interrupt-query" }
  );
  const disposeRequest = bridge.createRequest(
    bridge.COMMANDS.SUITEQL_DISPOSE,
    {},
    { requestId: "interrupt-query" }
  );

  const pendingStart = dispatcher.dispatch(startRequest, sender(studioUrl));
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  const disposed = await dispatcher.dispatch(disposeRequest, sender(studioUrl));
  assert.equal(disposed.ok, true);
  assert.equal(disposed.data.disposed, true);
  assert.deepEqual(calls, ["start", "dispose"]);
  releaseStart();
  await pendingStart;
});
