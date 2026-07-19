import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(
  resolve(root, "src/netsuite/data-adapter.js"),
  "utf8"
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function response(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    url: options.url ?? "",
    headers: {
      get(name) {
        return name === "content-length" && options.contentLength !== undefined
          ? String(options.contentLength)
          : null;
      }
    },
    async text() {
      return body;
    }
  };
}

function createHarness({
  url = "https://123456.app.netsuite.com/app/common/search/ubersearchresults.nl?suiteql",
  fetchImpl = async () => response("{}"),
  currentRecord
} = {}) {
  const location = new URL(url);
  const documentElement = { dataset: {} };
  let lastExecution = null;
  const harnessSetTimeout = (...args) => {
    const timeout = setTimeout(...args);
    timeout.unref?.();
    return timeout;
  };
  const sandbox = {
    URL,
    AbortController,
    location,
    navigator: { language: "en-AU" },
    document: { documentElement },
    performance: { now: () => 10 },
    setTimeout: harnessSetTimeout,
    clearTimeout,
    fetch: fetchImpl,
    console
  };
  sandbox.window = sandbox;
  sandbox.require = (_modules, onSuccess) => {
    onSuccess({
      get() {
        return currentRecord ?? {
          id: "123",
          type: "salesorder",
          isReadOnly: false,
          getField({ fieldId }) {
            return fieldId === "entity"
              ? {
                  label: "Customer",
                  type: "select",
                  isDisabled: false,
                  isReadOnly: false,
                  value: "blocked"
                }
              : null;
          },
          getSublist() {
            return null;
          }
        };
      }
    });
  };
  sandbox.nlapiGetRecordType = () => "salesorder";
  sandbox.globalThis = sandbox;
  runInNewContext(source, sandbox);

  const scripting = {
    async executeScript(options) {
      lastExecution = options;
      return [{ result: await options.func(...options.args) }];
    }
  };
  return {
    api: sandbox.SuiteMateV3NetSuiteDataAdapter,
    documentElement,
    get lastExecution() {
      return lastExecution;
    },
    request(requestId = "adapter-request") {
      return {
        requestId,
        senderContext: {
          tabId: 17,
          documentId: "document-17",
          href: location.href
        },
        signal: new AbortController().signal
      };
    },
    createAdapter() {
      return sandbox.SuiteMateV3NetSuiteDataAdapter.create({ scripting });
    }
  };
}

test("exports one frozen closed operation registry", async () => {
  const harness = createHarness();
  assert.equal(harness.api.VERSION, 1);
  assert.equal(Object.isFrozen(harness.api.OPERATIONS), true);
  assert.deepEqual(plain(harness.api.OPERATIONS), {
    SUITEQL_START: "suiteql.start",
    SUITEQL_PAGE: "suiteql.page",
    SUITEQL_DISPOSE: "suiteql.dispose",
    SEARCH_RUN: "search.run",
    RECORD_DESCRIBE: "record.describe",
    RECORD_GET_TYPE: "record.getType",
    IMPORT_ASSISTANT_SET_VALUES: "importAssistant.setValues",
    IMPORT_ASSISTANT_RESOLVE_CATEGORY: "importAssistant.resolveCategory"
  });
  await assert.rejects(
    () => harness.createAdapter().execute(
      harness.request(),
      "fetch.anything",
      { url: "https://evil.example" }
    ),
    (error) => error.code === "UNKNOWN_ADAPTER_OPERATION"
  );
});

test("binds SuiteQL to the fixed private bridge and authorized document", async () => {
  const calls = [];
  const harness = createHarness({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(JSON.stringify({
        result: {
          result: {
            aliases: ["id", "name"],
            count: 1,
            v0: [10, "Example"]
          }
        }
      }));
    }
  });
  const result = await harness.createAdapter().execute(
    harness.request("suiteql-fixed"),
    harness.api.OPERATIONS.SUITEQL_START,
    { query: "SELECT 10 AS id, 'Example' AS name", paged: false, pageSize: 1000 }
  );
  assert.deepEqual(plain(result.rows), [{ id: 10, name: "Example" }]);
  assert.equal(
    calls[0].url,
    "/app/common/scripting/PlatformClientScriptHandler.nl"
  );
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    method: "remoteObject.bridgeCall",
    params: [
      "queryApiBridge",
      "runSuiteQL",
      JSON.stringify([
        "SELECT 10 AS id, 'Example' AS name",
        "[]",
        "SUITE_QL",
        ""
      ])
    ]
  });
  assert.deepEqual(plain(harness.lastExecution.target), {
    tabId: 17,
    documentIds: ["document-17"]
  });
  assert.equal(harness.lastExecution.world, "MAIN");
  assert.equal(harness.documentElement.dataset.suitemateV3DataAdapter, "1");
});

test("constructs the constrained search RPC internally and normalizes rows", async () => {
  let call;
  const harness = createHarness({
    fetchImpl: async (url, options) => {
      call = { url, options };
      return response(JSON.stringify({
        result: {
          rows: [
            {
              id: 42,
              cells: [
                { name: "internalid", value: "42", text: "42" },
                { name: "title", value: "Visible", text: "Visible" }
              ]
            },
            {
              id: 43,
              cells: [
                { name: "internalid", value: "43", text: "43" },
                { name: "title", value: "Hidden", text: "Hidden" }
              ]
            }
          ]
        }
      }));
    }
  });
  const payload = {
    recordType: "savedsearch",
    filters: [
      { field: "internalid", operator: "anyof", values: ["42"] },
      { field: "title", operator: "isnotempty", values: [] }
    ],
    columns: [{ field: "internalid" }, { field: "title" }],
    limit: 1
  };
  const result = await harness.createAdapter().execute(
    harness.request("search-fixed"),
    harness.api.OPERATIONS.SEARCH_RUN,
    payload
  );
  assert.equal(
    call.url,
    "/app/common/scripting/nlapijsonhandler.nl"
  );
  const body = JSON.parse(call.options.body);
  assert.equal(body.method, "remoteObject.searchRecord");
  assert.equal(body.params[0], "savedsearch");
  assert.equal(body.params[2][0].name, "internalid");
  assert.equal(body.params[2][0].formula, null);
  assert.equal(body.params[2][0].join, null);
  assert.deepEqual(body.params[2][1].values, [""]);
  assert.equal(body.params[3][0].sortdir, null);
  assert.equal(result.truncated, true);
  assert.deepEqual(plain(result), {
    columns: [
      { key: "c0", field: "internalid" },
      { key: "c1", field: "title" }
    ],
    rows: [{
      id: "42",
      cells: [
        { value: "42", text: "42" },
        { value: "Visible", text: "Visible" }
      ]
    }],
    truncated: true
  });
});

test("returns bounded record metadata without field values", async () => {
  const harness = createHarness();
  const result = await harness.createAdapter().execute(
    harness.request("record-metadata"),
    harness.api.OPERATIONS.RECORD_DESCRIBE,
    { fields: [{ fieldId: "entity" }, { fieldId: "missing" }] }
  );
  assert.deepEqual(plain(result), {
    recordType: "salesorder",
    recordId: "123",
    isReadOnly: false,
    fields: [
      {
        fieldId: "entity",
        sublistId: null,
        exists: true,
        label: "Customer",
        type: "select",
        disabled: false,
        readOnly: false
      },
      {
        fieldId: "missing",
        sublistId: null,
        exists: false,
        label: null,
        type: null,
        disabled: false,
        readOnly: false
      }
    ]
  });
  assert.equal(JSON.stringify(result).includes("blocked"), false);
});

test("describes sublist columns through the legacy signature without leaking values", async () => {
  const harness = createHarness({
    currentRecord: {
      id: "55",
      type: "purchaseorder",
      isReadOnly: true,
      getField() {
        return null;
      },
      getSublist(options) {
        if (typeof options === "object") {
          throw new TypeError("Positional API required.");
        }
        assert.equal(options, "item");
        return {
          getColumn(columnOptions) {
            if (typeof columnOptions === "object") {
              throw new TypeError("Positional API required.");
            }
            assert.equal(columnOptions, "quantity");
            return {
              label: "Quantity",
              type: "float",
              isDisabled: true,
              isReadOnly: true,
              value: "must-not-leak"
            };
          }
        };
      }
    }
  });
  const result = await harness.createAdapter().execute(
    harness.request("sublist-metadata"),
    harness.api.OPERATIONS.RECORD_DESCRIBE,
    { fields: [{ fieldId: "quantity", sublistId: "item" }] }
  );
  assert.deepEqual(plain(result), {
    recordType: "purchaseorder",
    recordId: "55",
    isReadOnly: true,
    fields: [{
      fieldId: "quantity",
      sublistId: "item",
      exists: true,
      label: "Quantity",
      type: "float",
      disabled: true,
      readOnly: true
    }]
  });
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
});

test("restricts authenticated category lookup to the current Import Assistant", async () => {
  const calls = [];
  const url = "https://123456.app.netsuite.com/app/setup/assistants/nsimport/importassistant.nl?recordsubtype=customtype";
  const harness = createHarness({
    url,
    fetchImpl: async (requestUrl) => {
      calls.push(String(requestUrl));
      const category = new URL(requestUrl).searchParams.get("rectype");
      return response(
        category === "TRANSACTION"
          ? `Transactions\u0001CUSTOMTYPE\u0005ignored`
          : "Items\u0001INVENTORYITEM\u0005ignored",
        { url: String(requestUrl) }
      );
    }
  });
  const result = await harness.createAdapter().execute(
    harness.request("import-category"),
    harness.api.OPERATIONS.IMPORT_ASSISTANT_RESOLVE_CATEGORY,
    {
      recordSubtype: "CUSTOMTYPE",
      candidateCategories: ["ITEM", "TRANSACTION"]
    }
  );
  assert.deepEqual(plain(result), { category: "TRANSACTION" });
  assert.equal(calls.length, 2);
  for (const calledUrl of calls) {
    const parsed = new URL(calledUrl);
    assert.equal(parsed.origin, "https://123456.app.netsuite.com");
    assert.equal(
      parsed.pathname,
      "/app/setup/assistants/nsimport/importassistant.nl"
    );
    assert.equal(parsed.searchParams.get("importmethod"), "filegroups");
    assert.equal([...parsed.searchParams.keys()].sort().join(","), "importmethod,rectype");
  }
});

test("rejects stale documents, login redirects, and oversized responses", async () => {
  const staleHarness = createHarness();
  const staleRequest = staleHarness.request("stale-document");
  staleRequest.senderContext.href = `${staleRequest.senderContext.href}&changed=true`;
  await assert.rejects(
    () => staleHarness.createAdapter().execute(
      staleRequest,
      staleHarness.api.OPERATIONS.RECORD_GET_TYPE
    ),
    (error) => error.code === "INVALID_MAIN_WORLD_DOCUMENT"
  );

  const missingDocumentHarness = createHarness();
  const missingDocumentRequest = missingDocumentHarness.request("missing-document");
  missingDocumentRequest.senderContext.documentId = null;
  await assert.rejects(
    () => missingDocumentHarness.createAdapter().execute(
      missingDocumentRequest,
      missingDocumentHarness.api.OPERATIONS.RECORD_GET_TYPE
    ),
    (error) => error.code === "INVALID_ADAPTER_DOCUMENT"
  );

  const loginHarness = createHarness({
    fetchImpl: async () => response("login", {
      url: "https://123456.app.netsuite.com/app/login/secure/enterpriselogin.nl"
    })
  });
  await assert.rejects(
    () => loginHarness.createAdapter().execute(
      loginHarness.request("login-redirect"),
      loginHarness.api.OPERATIONS.SUITEQL_START,
      { query: "SELECT 1", paged: false, pageSize: 1000 }
    ),
    (error) => error.code === "NETSUITE_LOGIN_REQUIRED"
  );

  const oversizedHarness = createHarness({
    fetchImpl: async () => response("{}", { contentLength: 50000001 })
  });
  await assert.rejects(
    () => oversizedHarness.createAdapter().execute(
      oversizedHarness.request("oversized-response"),
      oversizedHarness.api.OPERATIONS.SUITEQL_START,
      { query: "SELECT 1", paged: false, pageSize: 1000 }
    ),
    (error) => error.code === "NETSUITE_RESPONSE_TOO_LARGE"
  );

  const blockedRedirectHarness = createHarness({
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, "error");
      throw new TypeError("Failed to fetch");
    }
  });
  await assert.rejects(
    () => blockedRedirectHarness.createAdapter().execute(
      blockedRedirectHarness.request("blocked-redirect"),
      blockedRedirectHarness.api.OPERATIONS.SUITEQL_START,
      { query: "SELECT 1", paged: false, pageSize: 1000 }
    ),
    (error) => (
      error.code === "NETSUITE_REQUEST_BLOCKED"
      && error.message.includes("Confirm the session is active")
    )
  );
});

test("normalizes NetSuite online errors and blocks cross-account category responses", async () => {
  const onlineError = [
    "<onlineError>",
    "<code>SSS_PERMISSION_VIOLATION</code>",
    "<detail>Permission denied.</detail>",
    "<description>Role access is required.</description>",
    "</onlineError>"
  ].join("");
  const searchHarness = createHarness({
    fetchImpl: async () => response(onlineError, { ok: false, status: 500 })
  });
  await assert.rejects(
    () => searchHarness.createAdapter().execute(
      searchHarness.request("online-error"),
      searchHarness.api.OPERATIONS.SEARCH_RUN,
      {
        recordType: "savedsearch",
        filters: [],
        columns: [{ field: "internalid" }],
        limit: 20
      }
    ),
    (error) => (
      error.code === "SSS_PERMISSION_VIOLATION"
      && error.message === "Permission denied."
      && error.details === "Role access is required."
    )
  );

  const importUrl = "https://123456.app.netsuite.com/app/setup/assistants/nsimport/importassistant.nl";
  const crossAccountHarness = createHarness({
    url: importUrl,
    fetchImpl: async () => response("Items\u0001CUSTOMTYPE", {
      url: "https://999999.app.netsuite.com/app/setup/assistants/nsimport/importassistant.nl"
    })
  });
  await assert.rejects(
    () => crossAccountHarness.createAdapter().execute(
      crossAccountHarness.request("cross-account"),
      crossAccountHarness.api.OPERATIONS.IMPORT_ASSISTANT_RESOLVE_CATEGORY,
      {
        recordSubtype: "CUSTOMTYPE",
        candidateCategories: ["ITEM"]
      }
    ),
    (error) => error.code === "CROSS_ACCOUNT_RESPONSE"
  );
});

test("preserves pre-start cancellation tombstones and rejects malformed search successes", async () => {
  let fetchCalls = 0;
  const canceledHarness = createHarness({
    fetchImpl: async () => {
      fetchCalls += 1;
      return response("{}");
    }
  });
  const canceledAdapter = canceledHarness.createAdapter();
  const canceledRequest = canceledHarness.request("cancel-before-start");
  await canceledAdapter.cancel(
    canceledRequest.senderContext,
    canceledRequest.requestId
  );
  await assert.rejects(
    () => canceledAdapter.execute(
      canceledRequest,
      canceledHarness.api.OPERATIONS.SUITEQL_START,
      { query: "SELECT 1", paged: false, pageSize: 1000 }
    ),
    (error) => error.code === "ABORTED"
  );
  assert.equal(fetchCalls, 0);

  for (const invalidResult of [null, {}, { rows: "not-an-array" }]) {
    const malformedHarness = createHarness({
      fetchImpl: async () => response(JSON.stringify({ result: invalidResult }))
    });
    await assert.rejects(
      () => malformedHarness.createAdapter().execute(
        malformedHarness.request(`malformed-${String(invalidResult)}`),
        malformedHarness.api.OPERATIONS.SEARCH_RUN,
        {
          recordType: "savedsearch",
          filters: [],
          columns: [{ field: "internalid" }],
          limit: 20
        }
      ),
      (error) => error.code === "INVALID_SEARCH_RESPONSE"
    );
  }
});

test("returns a later category match but does not misreport total transport failure", async () => {
  const importUrl = "https://123456.app.netsuite.com/app/setup/assistants/nsimport/importassistant.nl";
  const matchHarness = createHarness({
    url: importUrl,
    fetchImpl: async (requestUrl) => {
      const category = new URL(requestUrl).searchParams.get("rectype");
      return category === "ITEM"
        ? response("temporary failure", { ok: false, status: 503 })
        : response(`Transactions\u0001CUSTOMTYPE\u0005ignored`, {
            url: String(requestUrl)
          });
    }
  });
  const match = await matchHarness.createAdapter().execute(
    matchHarness.request("category-later-match"),
    matchHarness.api.OPERATIONS.IMPORT_ASSISTANT_RESOLVE_CATEGORY,
    {
      recordSubtype: "CUSTOMTYPE",
      candidateCategories: ["ITEM", "TRANSACTION"]
    }
  );
  assert.deepEqual(plain(match), { category: "TRANSACTION" });

  const failedHarness = createHarness({
    url: importUrl,
    fetchImpl: async () => response("temporary failure", {
      ok: false,
      status: 503
    })
  });
  await assert.rejects(
    () => failedHarness.createAdapter().execute(
      failedHarness.request("category-all-failed"),
      failedHarness.api.OPERATIONS.IMPORT_ASSISTANT_RESOLVE_CATEGORY,
      {
        recordSubtype: "CUSTOMTYPE",
        candidateCategories: ["ITEM", "TRANSACTION"]
      }
    ),
    (error) => error.code === "NETSUITE_HTTP_503"
  );
});
