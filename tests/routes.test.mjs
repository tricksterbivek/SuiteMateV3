import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "src/shared/routes.js"), "utf8");

function createApi() {
  const sandbox = { URL, URLSearchParams };
  sandbox.globalThis = sandbox;
  runInNewContext(source, sandbox);
  return sandbox.SuiteMateV3Routes;
}

const routes = createApi();
const { CAPABILITIES, PATHS, ROUTE_IDS } = routes;

function page(path, options = {}) {
  const {
    host = "123456.app.netsuite.com",
    protocol = "https:",
    isTopFrame = true
  } = options;
  return routes.createPageContext(`${protocol}//${host}${path}`, { isTopFrame });
}

test("exports stable route and capability constants", () => {
  assert.equal(PATHS.SUITEQL_CONSOLE, "/app/common/search/ubersearchresults.nl");
  assert.equal(PATHS.IMPORT_ASSISTANT, "/app/setup/assistants/nsimport/importassistant.nl");
  assert.equal(CAPABILITIES.GLOBAL_THEME, "global-theme");
  assert.equal(CAPABILITIES.SUITEQL_BRIDGE, "suiteql-bridge");
  assert.equal(Object.isFrozen(CAPABILITIES), true);
  assert.equal(Object.isFrozen(PATHS), true);
  assert.equal(Object.isFrozen(ROUTE_IDS), true);
});

test("normalizes repeated path separators without decoding or changing case", () => {
  assert.equal(routes.normalizePath("/app//common///search/Search.nl"), "/app/common/search/Search.nl");
  assert.equal(routes.normalizePath("/app/common/search/%2Fhidden.nl"), "/app/common/search/%2Fhidden.nl");
  assert.equal(routes.normalizePath(""), "");
});

test("enforces one strict NetSuite account-host policy", () => {
  for (const value of [
    "https://123456.app.netsuite.com/app/center/card.nl",
    "https://6998262-sb1.app.netsuite.com/app/center/card.nl",
    "https://system.netsuite.com/pages/customerlogin.jsp",
    "https://123456.sandbox.netsuite.com/app/center/card.nl",
    "https://123456.beta.netsuite.com/app/center/card.nl",
    "https://debugger.netsuite.com/app/common/scripting/scriptdebugger.nl"
  ]) {
    assert.equal(routes.isAllowedNetSuiteUrl(value), true, value);
  }

  for (const value of [
    "http://123456.app.netsuite.com/app/center/card.nl",
    "https://netsuite.com/app/center/card.nl",
    "https://www.netsuite.com/portal/home.shtml",
    "https://extforms.netsuite.com/app/site/hosting/scriptlet.nl",
    "https://123.extforms.netsuite.com/app/site/hosting/scriptlet.nl",
    "https://nested.123.extforms.netsuite.com/app/site/hosting/scriptlet.nl",
    "https://evilnetsuite.com/app/center/card.nl",
    "https://netsuite.com.evil.example/app/center/card.nl",
    "javascript:alert(1)",
    "/app/center/card.nl",
    ""
  ]) {
    assert.equal(routes.isAllowedNetSuiteUrl(value), false, value);
  }
});

test("classifies environments and frame state independently from page family", () => {
  const sandbox = page("/app/center/card.nl?ifrmcntnr=T", {
    host: "6998262-sb1.app.netsuite.com",
    isTopFrame: false
  });
  assert.equal(sandbox.routeId, ROUTE_IDS.DASHBOARD);
  assert.equal(sandbox.flags.isSandbox, true);
  assert.equal(sandbox.flags.isReleasePreview, false);
  assert.equal(sandbox.flags.isInIframe, true);
  assert.equal(sandbox.flags.isIfrmcntnr, true);

  assert.equal(page("/app/center/card.nl", { host: "123456.beta.netsuite.com" }).flags.isReleasePreview, true);
  assert.equal(page("/app/common/scripting/scriptdebugger.nl", { host: "debugger.netsuite.com" }).flags.isDebugger, true);
});

test("preserves existing page flags used by the V1 CSS layer", () => {
  const cases = [
    ["/app/login/secure/enterpriselogin.nl", ROUTE_IDS.LOGIN, "isLoginURL"],
    ["/pages/customerlogin.jsp", ROUTE_IDS.LOGIN, "isLoginURL"],
    ["/app/common/media/mediaitemfolders.nl", ROUTE_IDS.FILE_CABINET, "isFileCabinetURL"],
    ["/app/common/record/edittextmediaitem.nl?id=1", ROUTE_IDS.SCRIPT_EDITOR, "isScriptEditor"],
    ["/app/common/scripting/script.nl?id=1", ROUTE_IDS.SCRIPT, "isScriptURL"],
    ["/app/common/scripting/scriptrecord.nl?id=1", ROUTE_IDS.SCRIPT_DEPLOYMENT, "isDeploymentURL"],
    ["/app/common/scripting/mapreducescriptstatus.nl", ROUTE_IDS.SCRIPT_STATUS, "isScriptStatusURL"],
    ["/app/common/search/search.nl", ROUTE_IDS.SAVED_SEARCH, "isSearchURL"],
    ["/app/common/search/search.nl?e=T", ROUTE_IDS.SAVED_SEARCH_EDIT, "isSearchEditURL"],
    ["/app/common/search/searchresults.nl", ROUTE_IDS.SAVED_SEARCH_RESULTS, "isSearchResultsURL"],
    ["/app/help/helpcenter.nl", ROUTE_IDS.HELP_CENTER, "isHelpCenterURL"],
    ["/app/recordscatalog/rcbrowser.nl", ROUTE_IDS.RECORDS_CATALOG, "isSRBrowserURL"],
    ["/app/common/workflow/setup/workflow.nl?id=1", ROUTE_IDS.WORKFLOW, "isWorkflowURL"]
  ];

  for (const [path, routeId, flag] of cases) {
    const context = page(path);
    assert.equal(context.routeId, routeId, path);
    assert.equal(context.flags[flag], true, `${path} ${flag}`);
  }

  assert.equal(page("/app/common/media/mediaitemfolders.nl?frame=bf").flags.isFileCabinetURL, false);
  assert.equal(page("/app/common/record/edittextmediaitem.nl").flags.isScriptEditor, false);
  assert.equal(page("/app/common/workflow/setupx/workflow.nl").flags.isWorkflowURL, false);
});

test("activates SuiteQL Console only from the exact route and parameter presence", () => {
  for (const query of ["?suiteql", "?suiteql=", "?suiteql=false", "?search=customer&suiteql&foo=1"]) {
    const context = page(`${PATHS.SUITEQL_CONSOLE}${query}`);
    assert.equal(context.routeId, ROUTE_IDS.SUITEQL_CONSOLE, query);
    assert.equal(routes.supports(CAPABILITIES.SUITEQL_CONSOLE, context), true, query);
    assert.equal(routes.supports(CAPABILITIES.CSV_IMPORT_TOOLBAR, context), false, query);
  }

  for (const query of ["", "?search=customer", "?suiteqlx", "?SuiteQL", "#suiteql"]) {
    const context = page(`${PATHS.SUITEQL_CONSOLE}${query}`);
    assert.equal(context.routeId, ROUTE_IDS.GLOBAL_SEARCH_RESULTS, query);
    assert.equal(routes.supports(CAPABILITIES.SUITEQL_CONSOLE, context), false, query);
  }

  assert.equal(
    routes.supports(CAPABILITIES.SUITEQL_CONSOLE, page("/app/common/search/searchresults.nl?suiteql")),
    false
  );
  assert.equal(
    routes.supports(CAPABILITIES.SUITEQL_CONSOLE, page(`${PATHS.SUITEQL_CONSOLE}?suiteql`, { isTopFrame: false })),
    false
  );
});

test("keeps global styling and notifications available in supported child frames", () => {
  const context = page("/app/site/hosting/scriptlet.nl?frameId=custpage_iframe", { isTopFrame: false });
  assert.equal(routes.supports(CAPABILITIES.GLOBAL_THEME, context), true);
  assert.equal(routes.supports(CAPABILITIES.NOTIFICATIONS, context), true);
  assert.equal(routes.supports(CAPABILITIES.CSV_IMPORT_TOOLBAR, context), false);
});

test("preserves the broad CSV Import route probe while excluding known non-record results", () => {
  for (const path of [
    "/app/accounting/transactions/salesord.nl?id=1",
    "/app/common/item/item.nl?id=2",
    "/app/common/custom/custrecordentry.nl?id=3",
    "/app/common/search/search.nl?e=T",
    "/app/uncommon/customrecordtool.nl?id=4"
  ]) {
    assert.equal(routes.supports(CAPABILITIES.CSV_IMPORT_TOOLBAR, page(path)), true, path);
  }

  assert.equal(routes.supports(CAPABILITIES.CSV_IMPORT_TOOLBAR, page(PATHS.SAVED_SEARCH_RESULTS)), false);
  assert.equal(routes.supports(CAPABILITIES.CSV_IMPORT_TOOLBAR, page(`${PATHS.SUITEQL_CONSOLE}?suiteql`)), false);
  for (const path of [
    PATHS.DASHBOARD,
    PATHS.LOGIN,
    PATHS.FILE,
    PATHS.FILE_CABINET,
    PATHS.IMPORT_ASSISTANT,
    PATHS.HELP_CENTER,
    PATHS.RECORDS_CATALOG,
    PATHS.BUNDLE_BUILDER,
    PATHS.PDF_TEMPLATE,
    "/app/common/scripting/scriptstatus.nl",
    "/app/common/workflow/setup/workflow.nl"
  ]) {
    assert.equal(routes.supports(CAPABILITIES.CSV_IMPORT_TOOLBAR, page(path)), false, path);
  }
  assert.equal(
    routes.supports(CAPABILITIES.CSV_IMPORT_TOOLBAR, page("/app/accounting/transactions/salesord.nl", { isTopFrame: false })),
    false
  );
});

test("isolates Import Assistant context and bridge capabilities", () => {
  const top = page(`${PATHS.IMPORT_ASSISTANT}?recordsubtype=salesorder`);
  assert.equal(top.routeId, ROUTE_IDS.IMPORT_ASSISTANT);
  assert.equal(routes.supports(CAPABILITIES.IMPORT_ASSISTANT_CONTEXT, top), true);
  assert.equal(
    routes.supports(
      CAPABILITIES.IMPORT_ASSISTANT_CONTEXT,
      page(`${PATHS.IMPORT_ASSISTANT}?recordsubtype=salesorder`, { isTopFrame: false })
    ),
    false
  );
  assert.equal(routes.supports(CAPABILITIES.IMPORT_ASSISTANT_CONTEXT, page("/app/center/card.nl")), false);

  const url = `https://123456.app.netsuite.com${PATHS.IMPORT_ASSISTANT}?recordsubtype=salesorder`;
  assert.equal(routes.isAllowedSender({ frameId: 0, tab: { id: 9 }, url }, CAPABILITIES.IMPORT_ASSISTANT_BRIDGE), true);
  assert.equal(routes.isAllowedSender({ frameId: 1, tab: { id: 9 }, url }, CAPABILITIES.IMPORT_ASSISTANT_BRIDGE), false);
  assert.equal(
    routes.isAllowedSender(
      { frameId: 0, tab: { id: 9 }, url: "https://123456.app.netsuite.com/app/center/card.nl" },
      CAPABILITIES.IMPORT_ASSISTANT_BRIDGE
    ),
    false
  );
});

test("requires exact top-frame sender authority for privileged bridges", () => {
  const studioUrl = `https://123456.app.netsuite.com${PATHS.SUITEQL_CONSOLE}?suiteql`;
  assert.equal(routes.isAllowedSender({ frameId: 0, tab: { id: 7 }, url: studioUrl }, CAPABILITIES.SUITEQL_BRIDGE), true);
  assert.equal(routes.isAllowedSender({ frameId: 1, tab: { id: 7 }, url: studioUrl }, CAPABILITIES.SUITEQL_BRIDGE), false);
  assert.equal(routes.isAllowedSender({ frameId: 0, tab: {}, url: studioUrl }, CAPABILITIES.SUITEQL_BRIDGE), false);
  assert.equal(routes.isAllowedSender({ frameId: 0, tab: { id: "7" }, url: studioUrl }, CAPABILITIES.SUITEQL_BRIDGE), false);
  assert.equal(
    routes.isAllowedSender(
      {
        frameId: 0,
        tab: { id: 7, url: studioUrl },
        url: "https://example.com/app/common/search/ubersearchresults.nl?suiteql"
      },
      CAPABILITIES.SUITEQL_BRIDGE
    ),
    false
  );
  assert.equal(
    routes.isAllowedSender({ frameId: 0, tab: { id: 7, url: studioUrl } }, CAPABILITIES.SUITEQL_BRIDGE),
    true
  );

  const recordUrl = "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=1";
  assert.equal(
    routes.isAllowedSender({ frameId: 0, tab: { id: 8 }, url: recordUrl }, CAPABILITIES.RECORD_TYPE_BRIDGE),
    true
  );
  assert.equal(
    routes.isAllowedSender({ frameId: 0, tab: { id: 8 }, url: studioUrl }, CAPABILITIES.RECORD_TYPE_BRIDGE),
    false
  );
  assert.equal(
    routes.isAllowedSender(
      { frameId: 0, tab: { id: 8 }, url: `https://123456.app.netsuite.com${PATHS.IMPORT_ASSISTANT}` },
      CAPABILITIES.RECORD_TYPE_BRIDGE
    ),
    false
  );
});

test("keeps popup SuiteQL launch account-scoped and rejects excluded hosts", () => {
  assert.equal(
    routes.supports(CAPABILITIES.SUITEQL_LAUNCH, page("/app/center/card.nl")),
    true
  );
  const publicSite = routes.createPageContext("https://www.netsuite.com/portal/home.shtml");
  const externalForm = routes.createPageContext("https://123.extforms.netsuite.com/app/site/hosting/scriptlet.nl");
  assert.equal(routes.supports(CAPABILITIES.SUITEQL_LAUNCH, publicSite), false);
  assert.equal(routes.supports(CAPABILITIES.SUITEQL_LAUNCH, externalForm), false);
});

test("serializes route metadata without leaking the SuiteQL activation parameter", () => {
  const context = page(`${PATHS.SUITEQL_CONSOLE}?search=customer&suiteql&foo=1&foo=2`);
  assert.equal(routes.serializeParams(context, ["suiteql"]), "|search=customer|foo=1|foo=2|");
  assert.equal(routes.serializeParams(page("/app/center/card.nl"), ["suiteql"]), "||");
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.capabilities), true);
  assert.equal(Object.isFrozen(context.paramEntries), true);
});
