import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, "SuiteMate V3");
assert.equal(manifest.version, "3.1.0");
assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
assert.deepEqual(manifest.host_permissions, ["https://*.netsuite.com/*"]);
assert.equal(manifest.background.service_worker, "src/background/service-worker.js");

const globalThemeContentScript = manifest.content_scripts.find((entry) =>
  entry.css?.includes("src/styles/netsuite.css")
);
assert.ok(globalThemeContentScript, "The global NetSuite theme content script is missing");
assert.deepEqual(globalThemeContentScript.matches, ["https://*.netsuite.com/*"]);
assert.equal(globalThemeContentScript.run_at, "document_start");
assert.equal(globalThemeContentScript.all_frames, true);
assert.deepEqual(globalThemeContentScript.css, [
  "src/styles/font.css",
  "src/styles/code.css",
  "src/styles/netsuite.css",
  "src/styles/v3-compat.css"
]);

const referencedFiles = new Set([
  ...Object.values(manifest.icons),
  manifest.action.default_popup,
  manifest.background.service_worker,
  ...Object.values(manifest.action.default_icon)
]);

for (const contentScript of manifest.content_scripts) {
  for (const file of [...(contentScript.css ?? []), ...(contentScript.js ?? [])]) {
    referencedFiles.add(file);
  }
}

for (const file of referencedFiles) {
  await access(resolve(root, file));
}

const popupHtml = await readFile(resolve(root, manifest.action.default_popup), "utf8");
for (const match of popupHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const reference = match[1];
  if (!reference.startsWith("#")) {
    await access(resolve(root, dirname(manifest.action.default_popup), reference));
  }
}

for (const fixture of [
  "tests/fixtures/classic.html",
  "tests/fixtures/redwood.html",
  "tests/fixtures/sales-order.html",
  "tests/fixtures/saved-search-results.html",
  "tests/fixtures/saved-search-edit.html",
  "tests/fixtures/popup-role.html",
  "tests/fixtures/theme-runtime.html",
  "tests/fixtures/suiteql-classic.html",
  "tests/fixtures/suiteql-redwood.html",
  "tests/fixtures/suiteql-normal-search.html"
]) {
  const html = await readFile(resolve(root, fixture), "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    if (
      !reference.startsWith("#") &&
      !reference.startsWith("data:") &&
      !reference.startsWith("/javascript/")
    ) {
      const target = reference.startsWith("/")
        ? resolve(root, `.${reference}`)
        : resolve(root, dirname(fixture), reference);
      await access(target);
    }
  }
}

const extensionSources = [
  "src/shared/settings.js",
  "src/runtime/theme-runtime.js",
  "src/popup/popup.html",
  "src/popup/popup.css",
  "src/popup/popup.js",
  "src/suiteql/core.js",
  "src/suiteql/studio-entry.js",
  "src/suiteql/studio.css",
  "src/background/service-worker.js"
];

for (const file of extensionSources) {
  const source = await readFile(resolve(root, file), "utf8");
  const sourceWithoutApprovedLinks = source.replaceAll("https://suitesense.vercel.app/", "");
  assert.equal(/https?:\/\//.test(sourceWithoutApprovedLinks), false, `${file} contains an unapproved remote dependency`);
  assert.equal(/SuiteAdvanced|ExtPay|payment|license/i.test(source), false, `${file} contains an excluded V1 integration`);
}

const themeRuntimeSource = await readFile(resolve(root, "src/runtime/theme-runtime.js"), "utf8");
assert.match(themeRuntimeSource, /setClass\("sfc", enabled\)/, "V1 frozen-column styling is not enabled");
assert.match(themeRuntimeSource, /setClass\("sln", enabled\)/, "V1 sublist line-number styling is not enabled");
assert.match(
  themeRuntimeSource,
  /message\?\.type === settingsApi\.THEME_PREVIEW_MESSAGE/,
  "Live theme preview messages are not handled"
);
const popupSource = await readFile(resolve(root, "src/popup/popup.js"), "utf8");
assert.match(popupSource, /addEventListener\("input"/, "Color input does not trigger live preview");
assert.match(popupSource, /addEventListener\("pagehide"/, "Pending live colors are not flushed when the popup closes");
assert.match(popupSource, /createStudioUrl\(activeNetSuiteTab\?\.url\)/, "The popup does not build the account-scoped Studio URL");
assert.match(popupSource, /chrome\.tabs\.update/, "The popup does not open Studio in the active tab");

const compatibilityStyles = await readFile(resolve(root, "src/styles/v3-compat.css"), "utf8");
assert.match(
  compatibilityStyles,
  /--suitemate-v3-table-header-bg: var\(--theme-secondary-light\)/,
  "Global NetSuite table headers are not controlled by Secondary"
);
assert.match(
  compatibilityStyles,
  /:is\(\.uir-list-headerrow, \.uir-list-header-td, \.uir-machine-headerrow>td\)/,
  "The global table-header selector is missing"
);
assert.match(
  compatibilityStyles,
  /\.uir-list-body \.uir-list-headerrow>td\.uir-list-header-td,[\s\S]*?\.uir-machine-table-container \.uir-machine-headerrow>td[\s\S]*?border-bottom: 1px solid var\(--suitemate-v3-table-header-border\) !important/,
  "Global NetSuite table-header borders are not controlled by Secondary"
);
assert.match(
  compatibilityStyles,
  /\.uir-machine-table-container \.uir-machine-table \.uir-machine-headerrow>td[\s\S]*?border-bottom: 1px solid var\(--suitemate-v3-table-header-border\) !important/,
  "Editable NetSuite machine-table borders are not controlled by Secondary"
);
assert.match(
  compatibilityStyles,
  /\.uir-machine-table-container \{\s+--sln-header-bg-color: var\(--suitemate-v3-table-header-bg\)/,
  "Sublist line-number headers are not controlled by Secondary"
);
assert.match(
  compatibilityStyles,
  /border-bottom-color: light-dark\(var\(--theme-main\), var\(--theme-main-light\)\)/,
  "Global NetSuite tabs are not controlled by Main"
);
assert.match(
  compatibilityStyles,
  /html:not\(\.ext-f\) \.uir-tab-list-tabs \.formtaboff,[\s\S]*?background-color: var\(--theme-main\) !important/,
  "Inactive global NetSuite tabs are not controlled by Main"
);
assert.match(
  compatibilityStyles,
  /html:not\(\.ext-f\) \.uir-tab-list-tabs \.formtabon,[\s\S]*?background-color: var\(--theme-main-light\) !important/,
  "The active global NetSuite tab is not controlled by Main Light"
);
assert.match(
  compatibilityStyles,
  /\.uir-tab-list-tabs>\.bgtabbar/,
  "The global NetSuite tab bar background is not controlled by Main"
);
assert.match(
  compatibilityStyles,
  /\.uir-tab-list-tabs \.uir-unroll-tabs-button[\s\S]*?background-color: var\(--theme-main\) !important/,
  "The global NetSuite tab overflow control is not controlled by Main"
);
assert.match(
  compatibilityStyles,
  /\.uir-tab-list>\.uir-unroll-tabs-button[\s\S]*?background-color: var\(--theme-main\) !important/,
  "The legacy NetSuite tab overflow control is not controlled by Main"
);
assert.match(
  compatibilityStyles,
  /\.uir-subtab-panel-tabs-row \.formsubtaboff[\s\S]*?background-color: var\(--theme-secondary-light\) !important/,
  "Inactive nested NetSuite tabs are not controlled by Secondary Light"
);
assert.match(
  compatibilityStyles,
  /\.uir-subtab-panel-tabs-row \.formsubtabon,[\s\S]*?background-color: var\(--theme-secondary\) !important/,
  "The active nested NetSuite tab is not controlled by Secondary"
);
assert.match(
  compatibilityStyles,
  /td\.fgroup_title\.uir-field-group>div\.fgroup_title[\s\S]*?background-color: var\(--theme-secondary-light\) !important/,
  "Global NetSuite field groups are not controlled by Secondary"
);
assert.doesNotMatch(
  compatibilityStyles,
  /suitemate-v3-table-header-(?:bg|border): var\(--theme-main/,
  "Global NetSuite table headers still depend on Main"
);
assert.doesNotMatch(
  compatibilityStyles,
  /data-path=|salesord\.nl|#item_splits/,
  "The compatibility layer still contains page-specific styling"
);

const settingsSource = await readFile(resolve(root, "src/shared/settings.js"), "utf8");
const settingsSandbox = {};
settingsSandbox.globalThis = settingsSandbox;
runInNewContext(settingsSource, settingsSandbox);
const settingsApi = settingsSandbox.SuiteMateV3Settings;
assert.equal(settingsApi.THEME_PREVIEW_MESSAGE, "SUITEMATE_V3_PREVIEW_ROLE_THEME");
const roleContext = { id: "9845683_SB2~11596~3~N", name: "DBG Health (SB2) - Administrator" };
const roleSettings = settingsApi.withRoleTheme(settingsApi.DEFAULTS, roleContext, {
  main: "#123456",
  secondary: "#abcdef"
});
assert.equal(settingsApi.getRoleTheme(roleSettings, roleContext.id).customized, true);
assert.deepEqual(
  JSON.parse(JSON.stringify(settingsApi.deriveThemeVariables(settingsApi.getRoleTheme(roleSettings, roleContext.id)))),
  {
    "--custom-theme-main": "light-dark(#123456, #102f4d)",
    "--custom-theme-main-light": "light-dark(#597189, #415d78)",
    "--custom-theme-secondary": "light-dark(#abcdef, #89a4bf)",
    "--custom-theme-secondary-light": "light-dark(#c4dcf4, #b3d2f1)",
    "--custom-theme-secondary-light-light": "light-dark(#ddebf9, #cde1f5)"
  },
  "V1 theme color variants changed"
);
const mainOnlySettings = settingsApi.withRoleTheme(settingsApi.DEFAULTS, roleContext, { main: "#ff0000" });
const mainOnlyTheme = settingsApi.getRoleTheme(mainOnlySettings, roleContext.id);
assert.equal(mainOnlyTheme.mainCustomized, true);
assert.equal(mainOnlyTheme.secondaryCustomized, false);
assert.deepEqual(Object.keys(settingsApi.deriveThemeVariables(mainOnlyTheme)), [
  "--custom-theme-main",
  "--custom-theme-main-light"
]);
const swappedTheme = settingsApi.getRoleTheme(
  settingsApi.swapRoleTheme(mainOnlySettings, roleContext),
  roleContext.id
);
assert.equal(swappedTheme.mainCustomized, false);
assert.equal(swappedTheme.secondaryCustomized, true);
assert.equal(swappedTheme.secondary, "#ff0000");
assert.equal(
  settingsApi.getRoleTheme(settingsApi.withoutRoleTheme(roleSettings, roleContext.id), roleContext.id).customized,
  false
);

const coreSource = await readFile(resolve(root, "src/suiteql/core.js"), "utf8");
const coreSandbox = { URL, Date };
coreSandbox.globalThis = coreSandbox;
runInNewContext(coreSource, coreSandbox);
const suiteqlCore = coreSandbox.SuiteMateV3SuiteQLCore;
const studioUrl = "https://123456.app.netsuite.com/app/common/search/ubersearchresults.nl?suiteql";

assert.equal(suiteqlCore.isAllowedNetSuiteUrl(studioUrl), true);
assert.equal(suiteqlCore.isAllowedNetSuiteUrl("https://www.netsuite.com/portal/home.shtml"), false);
assert.equal(suiteqlCore.isAllowedNetSuiteUrl("https://123.extforms.netsuite.com/app/site/hosting/scriptlet.nl"), false);
assert.equal(suiteqlCore.isSuiteQLStudioUrl(studioUrl), true);
assert.equal(
  suiteqlCore.isSuiteQLStudioUrl("https://123456.app.netsuite.com/app/common/search/ubersearchresults.nl?search=customer"),
  false
);
assert.equal(
  suiteqlCore.createStudioUrl("https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=10"),
  studioUrl
);
assert.equal(
  suiteqlCore.isAllowedStudioSender({ frameId: 0, tab: { id: 44 }, url: studioUrl }),
  true
);
assert.equal(
  suiteqlCore.isAllowedStudioSender({ frameId: 2, tab: { id: 44 }, url: studioUrl }),
  false
);
assert.equal(
  suiteqlCore.isAllowedStudioSender({ frameId: 0, tab: { id: 44 }, url: "https://example.com/app/common/search/ubersearchresults.nl?suiteql" }),
  false
);

assert.equal(suiteqlCore.validateQuery("").code, "EMPTY_QUERY");
assert.equal(suiteqlCore.validateQuery("UPDATE transaction SET memo = 'x'").code, "READ_ONLY_QUERY_REQUIRED");
assert.equal(suiteqlCore.validateQuery("SELECT 1; DELETE FROM transaction").code, "MULTIPLE_STATEMENTS_NOT_ALLOWED");
assert.equal(suiteqlCore.validateQuery("SELECT '--'; DELETE FROM transaction").code, "MULTIPLE_STATEMENTS_NOT_ALLOWED");
assert.equal(suiteqlCore.validateQuery("-- comment\nSELECT id FROM transaction;").valid, true);
assert.equal(suiteqlCore.validateQuery("WITH ids AS (SELECT id FROM transaction) SELECT id FROM ids").valid, true);
assert.equal(suiteqlCore.validateQuery(`SELECT '${"x".repeat(100001)}'`).code, "QUERY_TOO_LARGE");
assert.equal(suiteqlCore.hasOrderBy("SELECT * FROM transaction ORDER BY id"), true);
assert.equal(suiteqlCore.hasOrderBy("SELECT 'ORDER BY id' AS note FROM transaction"), false);

assert.deepEqual(
  JSON.parse(JSON.stringify(suiteqlCore.normalizeError({ name: "SSS_SEARCH_ERROR_OCCURRED", message: "Invalid field" }))),
  { code: "SSS_SEARCH_ERROR_OCCURRED", message: "Invalid field", details: "" }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(suiteqlCore.normalizeResponse({
    ok: true,
    requestId: "request-1",
    columns: ["id"],
    rows: [{ id: 1 }],
    elapsedMs: 18,
    paged: false,
    pageIndex: 0,
    pageSize: 1,
    loadedCount: 1,
    totalCount: 1,
    totalPages: 1
  }))),
  {
    ok: true,
    requestId: "request-1",
    columns: ["id"],
    rows: [{ id: 1 }],
    elapsedMs: 18,
    paged: false,
    pageIndex: 0,
    pageSize: 1,
    loadedCount: 1,
    totalCount: 1,
    totalPages: 1
  }
);
assert.equal(suiteqlCore.normalizeResponse(undefined, "request-2").error.code, "SUITEQL_ERROR");

const sortableRows = [{ value: null }, { value: 10 }, { value: 2 }, { value: "3" }];
assert.deepEqual(
  JSON.parse(JSON.stringify(suiteqlCore.sortRows(sortableRows, "value", "asc"))).map((row) => row.value),
  [2, "3", 10, null]
);
assert.deepEqual(
  JSON.parse(JSON.stringify(suiteqlCore.sortRows(sortableRows, "value", "desc"))).map((row) => row.value),
  [10, "3", 2, null]
);
const clientPage = suiteqlCore.getClientPage(Array.from({ length: 620 }, (_, id) => ({ id })), 2);
assert.equal(clientPage.pageSize, 250);
assert.equal(clientPage.rows.length, 120);
assert.equal(clientPage.start, 500);
assert.equal(clientPage.end, 620);

assert.equal(suiteqlCore.protectCsvValue("=SUM(A1:A2)"), "'=SUM(A1:A2)");
assert.equal(suiteqlCore.protectCsvValue("  @SUM(A1:A2)"), "'  @SUM(A1:A2)");
assert.equal(suiteqlCore.protectCsvValue(-2), "-2");
assert.equal(
  suiteqlCore.toCsv(["name", "note"], [{ name: "+formula", note: "line 1\nline \"2\"" }]),
  "name,note\r\n'+formula,\"line 1\nline \"\"2\"\"\""
);
assert.equal(
  suiteqlCore.createExportFilename("ACME AU", new Date("2026-07-13T03:04:05.678Z")),
  "SuiteQL-ACME-AU-2026-07-13T03-04-05-678Z.csv"
);

const backgroundSource = await readFile(resolve(root, "src/background/service-worker.js"), "utf8");
const studioSource = await readFile(resolve(root, "src/suiteql/studio-entry.js"), "utf8");
assert.match(backgroundSource, /PlatformClientScriptHandler\.nl/, "SuiteQL does not use the V1 NetSuite bridge endpoint");
assert.match(backgroundSource, /"queryApiBridge"/, "SuiteQL does not call NetSuite's queryApiBridge");
assert.match(backgroundSource, /"runSuiteQL"/, "Unpaged SuiteQL bridge execution is missing");
assert.match(backgroundSource, /"suiteQLPagedQuery"/, "Paged SuiteQL bridge execution is missing");
assert.match(backgroundSource, /"getSuiteQLQueryPage"/, "Progressive SuiteQL bridge paging is missing");
assert.match(backgroundSource, /"SUITE_QL"/, "SuiteQL permission errors can be hidden by a static metadata provider");
assert.match(backgroundSource, /credentials: "include"/, "SuiteQL bridge requests do not use the authenticated NetSuite session");
assert.match(backgroundSource, /world: "MAIN"/, "SuiteQL is not executed in NetSuite's main world");
assert.doesNotMatch(backgroundSource, /\["N\/query"\]/, "SuiteQL still depends on an unavailable page-level N/query loader");
assert.match(studioSource, /state\.selection\.main/, "Selected editor text is not executed");
assert.match(studioSource, /document\.querySelector\("#body"\)/, "Studio is not mounted in NetSuite's visible workspace host");
assert.match(studioSource, /sessionStorage\.setItem\(SESSION_KEYS\.draft/, "Per-tab draft persistence is missing");
assert.match(studioSource, /content\.textContent = core\.displayValue\(value\)/, "Query values are not rendered as text");
assert.match(studioSource, /Mod-Shift-p/, "Paged keyboard shortcut is missing");
assert.match(studioSource, /Mod-Shift-e/, "Export keyboard shortcut is missing");
assert.match(studioSource, /Mod-Shift-l/, "Clear keyboard shortcut is missing");
assert.match(
  studioSource,
  /id="suiteql-suitesense" href="https:\/\/suitesense\.vercel\.app\/" target="_blank" rel="noopener noreferrer"/,
  "SuiteSense is not exposed as a safe external SuiteQL resource"
);
assert.match(studioSource, />Generate with SuiteSense<\//, "SuiteSense action text is missing");
assert.match(studioSource, /id="suiteql-inspect-table" type="button" hidden/, "Inspect Table is visible");
assert.match(studioSource, /id="suiteql-records-catalog"[^>]+hidden/, "Records Catalog is visible");
assert.doesNotMatch(backgroundSource, /nlapijsonhandler/i, "SuiteQL uses the unrelated legacy NLAPI JSON endpoint");

let backgroundMessageListener;
let mockNow = 100;
const pagedRows = [
  Array.from({ length: 1000 }, (_, index) => [index + 1, `row_${index + 1}`]),
  [[1001, "last"]]
];
const bridgeCalls = [];
const bridgeResult = (result) => ({
  ok: true,
  status: 200,
  async text() {
    return JSON.stringify({ result: { result } });
  }
});
const bridgeRows = (rows) => ({
  count: rows.length,
  aliases: ["id", "scriptid"],
  ...Object.fromEntries(rows.map((values, index) => [`v${index}`, values]))
});
const mockBridgeFetch = async (url, options) => {
  const request = JSON.parse(options.body);
  const [bridgeName, operation, serializedArguments] = request.params;
  const operationArguments = JSON.parse(serializedArguments);
  bridgeCalls.push({ url, options, method: request.method, bridgeName, operation, operationArguments });

  const query = operation === "suiteQLPagedQuery" ? operationArguments[1] : operationArguments[0];
  if (String(query).includes("invalid_field")) {
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          result: "error",
          error: {
            code: "SSS_SEARCH_ERROR_OCCURRED",
            detail: "Field 'invalid_field' was not found."
          }
        });
      }
    };
  }

  if (operation === "runSuiteQL") {
    return bridgeResult(bridgeRows([[10, "ten"], [11, "eleven"]]));
  }
  if (operation === "suiteQLPagedQuery") {
    if (String(query).includes("empty_result")) {
      return bridgeResult({ count: 0, numPages: 0, pages: [] });
    }
    return bridgeResult({ numPages: 2, pages: [{ index: 0 }, { index: 1 }] });
  }
  if (operation === "getSuiteQLQueryPage") {
    const pageIndex = Number(operationArguments[0]?.index) || 0;
    return bridgeResult(bridgeRows(pagedRows[pageIndex] ?? []));
  }
  throw new Error(`Unexpected bridge operation: ${operation}`);
};
const backgroundSetTimeout = (...args) => {
  const timeout = setTimeout(...args);
  timeout.unref?.();
  return timeout;
};
const backgroundSandbox = {
  SuiteMateV3SuiteQLCore: suiteqlCore,
  Symbol,
  Map,
  Set,
  Promise,
  Number,
  String,
  Array,
  Object,
  AbortController,
  performance: { now: () => mockNow++ },
  setTimeout: backgroundSetTimeout,
  clearTimeout,
  window: {},
  navigator: { language: "en-US" },
  fetch: mockBridgeFetch,
  importScripts() {},
  chrome: {
    runtime: {
      getURL: (path) => path,
      onMessage: {
        addListener(listener) {
          backgroundMessageListener = listener;
        }
      }
    },
    scripting: {
      async executeScript({ func, args }) {
        return [{ result: await func(...args) }];
      }
    }
  }
};
backgroundSandbox.globalThis = backgroundSandbox;
runInNewContext(backgroundSource, backgroundSandbox);

function sendBackgroundMessage(message, sender) {
  return new Promise((resolveResponse, rejectResponse) => {
    const handled = backgroundMessageListener(message, sender, resolveResponse);
    if (handled !== true) {
      rejectResponse(new Error(`Background did not handle ${message.type}`));
    }
  });
}

const validBackgroundSender = { frameId: 0, tab: { id: 71, url: studioUrl }, url: studioUrl };
const rejectedBackgroundResponse = await sendBackgroundMessage(
  { type: suiteqlCore.MESSAGE_TYPES.START, requestId: "rejected", query: "SELECT 1", paged: false },
  { frameId: 1, tab: { id: 71, url: studioUrl }, url: studioUrl }
);
assert.equal(rejectedBackgroundResponse.error.code, "INVALID_SENDER");

const unpagedBackgroundResponse = await sendBackgroundMessage(
  { type: suiteqlCore.MESSAGE_TYPES.START, requestId: "unpaged", query: "SELECT id, scriptid FROM customrecordtype", paged: false },
  validBackgroundSender
);
assert.equal(unpagedBackgroundResponse.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(unpagedBackgroundResponse.columns)), ["id", "scriptid"]);
assert.deepEqual(JSON.parse(JSON.stringify(unpagedBackgroundResponse.rows)), [
  { id: 10, scriptid: "ten" },
  { id: 11, scriptid: "eleven" }
]);
const unpagedBridgeCall = bridgeCalls.find((call) => call.operation === "runSuiteQL");
assert.equal(unpagedBridgeCall.url, "/app/common/scripting/PlatformClientScriptHandler.nl");
assert.equal(unpagedBridgeCall.method, "remoteObject.bridgeCall");
assert.equal(unpagedBridgeCall.bridgeName, "queryApiBridge");
assert.equal(unpagedBridgeCall.options.credentials, "include");
assert.equal(unpagedBridgeCall.options.headers.nsxmlhttprequest, "NSXMLHttpRequest");
assert.deepEqual(JSON.parse(JSON.stringify(unpagedBridgeCall.operationArguments)), [
  "SELECT id, scriptid FROM customrecordtype",
  "[]",
  "SUITE_QL",
  ""
]);

const pagedBackgroundResponse = await sendBackgroundMessage(
  { type: suiteqlCore.MESSAGE_TYPES.START, requestId: "paged", query: "SELECT id, scriptid FROM customrecordtype ORDER BY id", paged: true },
  validBackgroundSender
);
assert.equal(pagedBackgroundResponse.ok, true);
assert.equal(pagedBackgroundResponse.loadedCount, 1000);
assert.equal(pagedBackgroundResponse.totalCount, 1001);
assert.equal(pagedBackgroundResponse.totalPages, 2);
const pagedBridgeCall = bridgeCalls.find((call) => call.operation === "suiteQLPagedQuery");
assert.deepEqual(JSON.parse(JSON.stringify(pagedBridgeCall.operationArguments)), [
  1000,
  "SELECT id, scriptid FROM customrecordtype ORDER BY id",
  "[]",
  "SUITE_QL",
  ""
]);

const nextBackgroundPage = await sendBackgroundMessage(
  { type: suiteqlCore.MESSAGE_TYPES.PAGE, requestId: "paged", pageIndex: 1 },
  validBackgroundSender
);
assert.equal(nextBackgroundPage.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(nextBackgroundPage.rows)), [{ id: 1001, scriptid: "last" }]);
assert.equal(nextBackgroundPage.loadedCount, 1001);
const disposedBackgroundResponse = await sendBackgroundMessage(
  { type: suiteqlCore.MESSAGE_TYPES.DISPOSE, requestId: "paged" },
  validBackgroundSender
);
assert.equal(disposedBackgroundResponse.disposed, true);

const emptyPagedBackgroundResponse = await sendBackgroundMessage(
  { type: suiteqlCore.MESSAGE_TYPES.START, requestId: "empty-paged", query: "SELECT empty_result FROM customrecordtype ORDER BY id", paged: true },
  validBackgroundSender
);
assert.equal(emptyPagedBackgroundResponse.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(emptyPagedBackgroundResponse.rows)), []);
assert.equal(emptyPagedBackgroundResponse.totalCount, 0);
assert.equal(emptyPagedBackgroundResponse.totalPages, 0);

const invalidFieldBackgroundResponse = await sendBackgroundMessage(
  { type: suiteqlCore.MESSAGE_TYPES.START, requestId: "invalid-field", query: "SELECT invalid_field FROM customrecordtype", paged: false },
  validBackgroundSender
);
assert.equal(invalidFieldBackgroundResponse.ok, false);
assert.equal(invalidFieldBackgroundResponse.error.code, "SSS_SEARCH_ERROR_OCCURRED");
assert.equal(invalidFieldBackgroundResponse.error.message, "Field 'invalid_field' was not found.");

await access(resolve(root, "dist/suiteql-studio.js"));
await access(resolve(root, "save/SUITEMATE_V1_MASTER_FEATURE_INVENTORY.md"));

const expectedStyleHashes = {
  "src/styles/font.css": "ecc7a99f6b820ee9290ab4a3ca2ff1ea4829c1a539c0d42becb19a3d5ea446cf",
  "src/styles/code.css": "e5607100c7432fd7028176ce74c4c999e181108861ea6b992ed3058d92d0d698",
  "src/styles/netsuite.css": "56c4251792aa7884469cb6904ae2ce0fa68731db5e9d660ead7bff2144b2af56",
  "src/styles/pages/bundlebuilder.css": "bb9cae83f75b192d0a913233a33b6a8e557df656f7251a6e48e3105532e9f8fa",
  "src/styles/pages/codeeditor.css": "b58efb6517cfc13ca04cb621bdf269599ad9d6a589f38dee268743dda60f84df",
  "src/styles/pages/dashboard.css": "024b4ea648cf4227bdb7fabe762255a36180ce34c8291e1ba0400ee8295d6a68",
  "src/styles/pages/fieldhelp.css": "8515c1f4faff7978138f7d1c4cff631703af0b550c5deb6eb4ea95351bb78e2d",
  "src/styles/pages/file.css": "7932445f8a76bf76b6d9ce6d02bc8d69f071e4c8f600171a8a26c03e8a3eb1b2",
  "src/styles/pages/filecabinet.css": "cac334ebfece700d1f4ab625b120226900c692ded5889e91227d3f266d41b0a5",
  "src/styles/pages/helpcenter.css": "a55d71f695b9e0d3b10208042336e39825812a4851f2fea0271561a07354dd2d",
  "src/styles/pages/login.css": "1fccdd4e23bcea525cae2d97f0b07f570cae3ffc2b008c488cc50efa17699a85",
  "src/styles/pages/pdftemplate.css": "b1494b7aad20982b6fe5e38866c6c733de9a1e0bb356b98e26fdbd24660f991a",
  "src/styles/pages/scripting.css": "fe85ad7e89062db75dcce2b604f6e8c02c1d4aa913ba942a76a341a992d2102c",
  "src/styles/pages/suiteql.css": "a7828bfb563baf36dc1d9b51ddf7b7077e8e8d37471dd0c31544705f69851cda",
  "src/styles/pages/workflow.css": "8c4dee7e097f533613dc10792c29d8465e50288f5498fe82b0942cd1185b115d"
};

for (const [file, expectedHash] of Object.entries(expectedStyleHashes)) {
  const source = await readFile(resolve(root, file));
  const actualHash = createHash("sha256").update(source).digest("hex");
  assert.equal(actualHash, expectedHash, `${file} no longer matches the V1 styling source`);
}

console.log(
  `Verified ${referencedFiles.size} manifest resources, ${Object.keys(expectedStyleHashes).length} V1 style hashes, role themes, and SuiteQL Core behavior.`
);
