(function defineSuiteMateV3Routes(globalScope) {
  "use strict";

  const CAPABILITIES = Object.freeze({
    GLOBAL_THEME: "global-theme",
    NOTIFICATIONS: "notifications",
    CSV_IMPORT_TOOLBAR: "csv-import-toolbar",
    RECORD_TYPE_BRIDGE: "record-type-bridge",
    RECORD_METADATA_BRIDGE: "record-metadata-bridge",
    SEARCH_QUERY_BRIDGE: "search-query-bridge",
    IMPORT_ASSISTANT_CONTEXT: "import-assistant-context",
    IMPORT_ASSISTANT_BRIDGE: "import-assistant-bridge",
    IMPORT_ASSISTANT_FETCH_BRIDGE: "import-assistant-fetch-bridge",
    SUITEQL_CONSOLE: "suiteql-console",
    SUITEQL_BRIDGE: "suiteql-bridge",
    SUITEQL_LAUNCH: "suiteql-launch"
  });

  const PATHS = Object.freeze({
    DASHBOARD: "/app/center/card.nl",
    LOGIN: "/app/login/secure/enterpriselogin.nl",
    CUSTOMER_LOGIN: "/pages/customerlogin.jsp",
    FILE: "/app/common/media/mediaitem.nl",
    FILE_CABINET: "/app/common/media/mediaitemfolders.nl",
    SCRIPT_EDITOR: "/app/common/record/edittextmediaitem.nl",
    SCRIPT_DEPLOYMENT: "/app/common/scripting/scriptrecord.nl",
    SAVED_SEARCH: "/app/common/search/search.nl",
    SAVED_SEARCH_RESULTS: "/app/common/search/searchresults.nl",
    SUITEQL_CONSOLE: "/app/common/search/ubersearchresults.nl",
    HELP_CENTER: "/app/help/helpcenter.nl",
    RECORDS_CATALOG: "/app/recordscatalog/rcbrowser.nl",
    IMPORT_ASSISTANT: "/app/setup/assistants/nsimport/importassistant.nl",
    BUNDLE_BUILDER: "/app/setup/assistants/bundlebuilder.nl",
    PDF_TEMPLATE: "/app/common/custom/advancedprint/pdftemplate.nl"
  });

  const ROUTE_IDS = Object.freeze({
    DASHBOARD: "dashboard",
    LOGIN: "login",
    FILE: "file",
    FILE_CABINET: "file-cabinet",
    SCRIPT_EDITOR: "script-editor",
    SCRIPT: "script",
    SCRIPT_DEPLOYMENT: "script-deployment",
    SCRIPT_STATUS: "script-status",
    SCRIPTING: "scripting",
    SAVED_SEARCH: "saved-search",
    SAVED_SEARCH_EDIT: "saved-search-edit",
    SAVED_SEARCH_RESULTS: "saved-search-results",
    GLOBAL_SEARCH_RESULTS: "global-search-results",
    SUITEQL_CONSOLE: "suiteql-console",
    HELP_CENTER: "help-center",
    RECORDS_CATALOG: "records-catalog",
    IMPORT_ASSISTANT: "import-assistant",
    BUNDLE_BUILDER: "bundle-builder",
    PDF_TEMPLATE: "pdf-template",
    WORKFLOW: "workflow",
    NETSUITE_PAGE: "netsuite-page",
    UNKNOWN: "unknown"
  });

  const CSV_IMPORT_EXCLUDED_ROUTES = new Set([
    ROUTE_IDS.DASHBOARD,
    ROUTE_IDS.LOGIN,
    ROUTE_IDS.FILE,
    ROUTE_IDS.FILE_CABINET,
    ROUTE_IDS.SCRIPT_EDITOR,
    ROUTE_IDS.SCRIPT_STATUS,
    ROUTE_IDS.SAVED_SEARCH_RESULTS,
    ROUTE_IDS.GLOBAL_SEARCH_RESULTS,
    ROUTE_IDS.SUITEQL_CONSOLE,
    ROUTE_IDS.HELP_CENTER,
    ROUTE_IDS.RECORDS_CATALOG,
    ROUTE_IDS.IMPORT_ASSISTANT,
    ROUTE_IDS.BUNDLE_BUILDER,
    ROUTE_IDS.PDF_TEMPLATE,
    ROUTE_IDS.WORKFLOW
  ]);
  const SEARCH_QUERY_ROUTES = new Set([
    ROUTE_IDS.SAVED_SEARCH,
    ROUTE_IDS.SAVED_SEARCH_EDIT,
    ROUTE_IDS.SAVED_SEARCH_RESULTS,
    ROUTE_IDS.SUITEQL_CONSOLE
  ]);
  const CAPABILITY_VALUES = Object.freeze(Object.values(CAPABILITIES));
  const SCRIPT_PATH_PATTERN = /^\/app\/common\/scripting\/(?:script|webapp|plugin|plugintype)\.nl$/;
  const SCRIPT_STATUS_PATH_PATTERN = /^\/app\/common\/scripting\/(?:scriptstatus|mapreducescriptstatus)\.nl$/;
  const SCRIPTING_PATH_PREFIX = "/app/common/scripting/";
  const WORKFLOW_PATH_PREFIX = "/app/common/workflow/setup/";

  function normalizePath(value) {
    return String(value ?? "").replace(/\/{2,}/g, "/");
  }

  function parseUrl(value) {
    try {
      if (typeof value === "string" || value instanceof URL) {
        return new URL(String(value));
      }
      if (typeof value?.href === "string") {
        return new URL(value.href);
      }
    } catch {}
    return null;
  }

  function isAllowedNetSuiteUrl(value) {
    const url = parseUrl(value);
    if (!url || url.protocol !== "https:") {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    return hostname.endsWith(".netsuite.com")
      && hostname !== "www.netsuite.com"
      && hostname !== "extforms.netsuite.com"
      && !hostname.endsWith(".extforms.netsuite.com");
  }

  function hasParam(context, name) {
    return context?.paramEntries?.some(([entryName]) => entryName === name) === true;
  }

  function getParam(context, name) {
    return context?.paramEntries?.find(([entryName]) => entryName === name)?.[1] ?? null;
  }

  function readLocationParts(value) {
    const url = parseUrl(value);
    if (url) {
      return {
        href: url.href,
        origin: url.origin,
        hostname: url.hostname.toLowerCase(),
        path: normalizePath(url.pathname),
        search: url.search,
        hash: url.hash,
        allowedNetSuite: isAllowedNetSuiteUrl(url)
      };
    }

    const path = normalizePath(value?.pathname);
    const search = String(value?.search ?? "");
    const hash = String(value?.hash ?? "");
    const hostname = String(value?.hostname ?? "").toLowerCase();
    const origin = String(value?.origin ?? "");
    return {
      href: String(value?.href ?? `${path}${search}${hash}`),
      origin,
      hostname,
      path,
      search,
      hash,
      allowedNetSuite: false
    };
  }

  function isSuiteQLRoute(context) {
    return context.path === PATHS.SUITEQL_CONSOLE && hasParam(context, "suiteql");
  }

  function getRouteId(context) {
    const { path } = context;
    if (!path) {
      return ROUTE_IDS.UNKNOWN;
    }
    if (isSuiteQLRoute(context)) {
      return ROUTE_IDS.SUITEQL_CONSOLE;
    }
    if (path === PATHS.SUITEQL_CONSOLE) {
      return ROUTE_IDS.GLOBAL_SEARCH_RESULTS;
    }
    if (path === PATHS.SAVED_SEARCH_RESULTS) {
      return ROUTE_IDS.SAVED_SEARCH_RESULTS;
    }
    if (path === PATHS.SAVED_SEARCH) {
      return getParam(context, "e") === "T" ? ROUTE_IDS.SAVED_SEARCH_EDIT : ROUTE_IDS.SAVED_SEARCH;
    }
    if (path === PATHS.IMPORT_ASSISTANT) {
      return ROUTE_IDS.IMPORT_ASSISTANT;
    }
    if (path === PATHS.DASHBOARD) {
      return ROUTE_IDS.DASHBOARD;
    }
    if (path === PATHS.LOGIN || path === PATHS.CUSTOMER_LOGIN) {
      return ROUTE_IDS.LOGIN;
    }
    if (path === PATHS.FILE_CABINET) {
      return ROUTE_IDS.FILE_CABINET;
    }
    if (path === PATHS.FILE) {
      return ROUTE_IDS.FILE;
    }
    if (path === PATHS.SCRIPT_EDITOR) {
      return ROUTE_IDS.SCRIPT_EDITOR;
    }
    if (path === PATHS.SCRIPT_DEPLOYMENT) {
      return ROUTE_IDS.SCRIPT_DEPLOYMENT;
    }
    if (SCRIPT_PATH_PATTERN.test(path)) {
      return ROUTE_IDS.SCRIPT;
    }
    if (SCRIPT_STATUS_PATH_PATTERN.test(path)) {
      return ROUTE_IDS.SCRIPT_STATUS;
    }
    if (path.startsWith(SCRIPTING_PATH_PREFIX)) {
      return ROUTE_IDS.SCRIPTING;
    }
    if (path === PATHS.HELP_CENTER) {
      return ROUTE_IDS.HELP_CENTER;
    }
    if (path === PATHS.RECORDS_CATALOG) {
      return ROUTE_IDS.RECORDS_CATALOG;
    }
    if (path === PATHS.BUNDLE_BUILDER) {
      return ROUTE_IDS.BUNDLE_BUILDER;
    }
    if (path === PATHS.PDF_TEMPLATE) {
      return ROUTE_IDS.PDF_TEMPLATE;
    }
    if (path.startsWith(WORKFLOW_PATH_PREFIX)) {
      return ROUTE_IDS.WORKFLOW;
    }
    return path.startsWith("/") ? ROUTE_IDS.NETSUITE_PAGE : ROUTE_IDS.UNKNOWN;
  }

  function getPageFlags(context) {
    const { hostname, isTopFrame, path } = context;
    const isLogin = path === PATHS.LOGIN || path === PATHS.CUSTOMER_LOGIN;
    const isSearch = path === PATHS.SAVED_SEARCH;

    return Object.freeze({
      isSandbox: hostname.includes(".sandbox.netsuite.com") || /-sb\d*(?:\.|$)/i.test(hostname),
      isReleasePreview: hostname.includes(".beta.netsuite.com") || /-rp\d*(?:\.|$)/i.test(hostname),
      isDebugger: hostname.startsWith("debugger.") || hostname.includes(".debugger."),
      isInIframe: !isTopFrame,
      isIfrmcntnr: getParam(context, "ifrmcntnr") === "T",
      isLoginURL: isLogin,
      isFileCabinetURL: path === PATHS.FILE_CABINET && getParam(context, "frame") !== "bf",
      isScriptEditor: path === PATHS.SCRIPT_EDITOR && hasParam(context, "id"),
      isScriptURL: SCRIPT_PATH_PATTERN.test(path),
      isDeploymentURL: path === PATHS.SCRIPT_DEPLOYMENT,
      isScriptStatusURL: SCRIPT_STATUS_PATH_PATTERN.test(path),
      isSearchURL: isSearch,
      isSearchEditURL: isSearch && getParam(context, "e") === "T",
      isSearchResultsURL: path === PATHS.SAVED_SEARCH_RESULTS,
      isHelpCenterURL: path === PATHS.HELP_CENTER,
      isSRBrowserURL: path === PATHS.RECORDS_CATALOG,
      isWorkflowURL: path.startsWith(WORKFLOW_PATH_PREFIX),
      isSuiteQLConsoleURL: isSuiteQLRoute(context)
    });
  }

  function supports(capability, context) {
    if (!context?.allowedNetSuite) {
      return false;
    }

    switch (capability) {
      case CAPABILITIES.GLOBAL_THEME:
      case CAPABILITIES.NOTIFICATIONS:
      case CAPABILITIES.SUITEQL_LAUNCH:
        return true;
      case CAPABILITIES.CSV_IMPORT_TOOLBAR:
        return context.isTopFrame
          && Boolean(context.path)
          && !CSV_IMPORT_EXCLUDED_ROUTES.has(context.routeId);
      case CAPABILITIES.RECORD_TYPE_BRIDGE:
      case CAPABILITIES.RECORD_METADATA_BRIDGE:
        return context.isTopFrame
          && context.hasValidTab === true
          && context.hasValidDocument === true
          && Boolean(context.path)
          && !CSV_IMPORT_EXCLUDED_ROUTES.has(context.routeId);
      case CAPABILITIES.SEARCH_QUERY_BRIDGE:
        return context.isTopFrame
          && context.hasValidTab === true
          && context.hasValidDocument === true
          && SEARCH_QUERY_ROUTES.has(context.routeId);
      case CAPABILITIES.IMPORT_ASSISTANT_CONTEXT:
        return context.isTopFrame && context.path === PATHS.IMPORT_ASSISTANT;
      case CAPABILITIES.IMPORT_ASSISTANT_BRIDGE:
      case CAPABILITIES.IMPORT_ASSISTANT_FETCH_BRIDGE:
        return context.isTopFrame
          && context.hasValidTab === true
          && context.hasValidDocument === true
          && context.path === PATHS.IMPORT_ASSISTANT;
      case CAPABILITIES.SUITEQL_CONSOLE:
        return context.isTopFrame && isSuiteQLRoute(context);
      case CAPABILITIES.SUITEQL_BRIDGE:
        return context.isTopFrame
          && context.hasValidTab === true
          && context.hasValidDocument === true
          && isSuiteQLRoute(context);
      default:
        return false;
    }
  }

  function createPageContext(value, options = {}) {
    const parts = readLocationParts(value);
    const paramEntries = Object.freeze(
      [...new URLSearchParams(parts.search)].map((entry) => Object.freeze(entry))
    );
    const base = {
      kind: "page",
      ...parts,
      allowedNetSuite: parts.allowedNetSuite || options.trustedContentScript === true,
      isTopFrame: options.isTopFrame !== false,
      isSubframe: options.isTopFrame === false,
      paramEntries
    };
    const routeId = getRouteId(base);
    const classified = { ...base, routeId };
    const flags = getPageFlags(classified);
    const capabilities = Object.freeze(CAPABILITY_VALUES.filter((capability) => supports(capability, classified)));
    return Object.freeze({
      ...classified,
      flags,
      capabilities
    });
  }

  function createSenderContext(sender) {
    const frameId = Number.isInteger(sender?.frameId) ? sender.frameId : null;
    const tabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
    const documentId = typeof sender?.documentId === "string" && sender.documentId.trim()
      ? sender.documentId
      : null;
    const sourceUrl = sender?.url ?? sender?.tab?.url;
    const page = createPageContext(sourceUrl, { isTopFrame: frameId === 0 });
    const base = {
      ...page,
      kind: "sender",
      frameId,
      tabId,
      documentId,
      hasValidDocument: documentId !== null,
      hasValidTab: tabId !== null
    };
    const capabilities = Object.freeze(CAPABILITY_VALUES.filter((capability) => supports(capability, base)));
    return Object.freeze({
      ...base,
      capabilities
    });
  }

  function isAllowedSender(sender, capability) {
    return supports(capability, createSenderContext(sender));
  }

  function serializeParams(context, excludedNames = []) {
    const excluded = new Set(excludedNames);
    const flattened = context.paramEntries
      .filter(([name]) => !excluded.has(name))
      .map(([name, value]) => `${name}=${value}`)
      .join("|");
    return `|${flattened}|`;
  }

  globalScope.SuiteMateV3Routes = Object.freeze({
    CAPABILITIES,
    PATHS,
    ROUTE_IDS,
    normalizePath,
    parseUrl,
    isAllowedNetSuiteUrl,
    hasParam,
    getParam,
    createPageContext,
    createSenderContext,
    getPageFlags,
    supports,
    isAllowedSender,
    serializeParams
  });
})(globalThis);
