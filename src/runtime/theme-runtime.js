(function initializeSuiteMateV3() {
  "use strict";

  const routeApi = globalThis.SuiteMateV3Routes;
  const lifecycleApi = globalThis.SuiteMateV3Lifecycle;
  const settingsApi = globalThis.SuiteMateV3Settings;
  if (!routeApi || !lifecycleApi || !settingsApi) {
    return;
  }

  const root = document.documentElement;
  const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  let currentSettings = settingsApi.DEFAULTS;
  let roleContext = null;
  let settingsRevision = 0;

  function setClass(name, enabled) {
    root.classList.toggle(name, Boolean(enabled));
  }

  function isTopFrame() {
    try {
      return window === window.top;
    } catch {
      return false;
    }
  }

  function createCurrentPageContext() {
    return routeApi.createPageContext(location, {
      isTopFrame: isTopFrame(),
      trustedContentScript: true
    });
  }

  function updateLocationMetadata(context = createCurrentPageContext()) {
    root.dataset.path = context.path;
    root.dataset.url = `${context.path}${context.search}${context.hash}`;
    root.dataset.params = routeApi.serializeParams(context, ["suiteql"]);
    root.dataset.history = history.length > 1 ? "T" : "F";
    root.dataset.suitemateV3Route = context.routeId;
    root.dataset.suitemateV3Capabilities = context.capabilities.join(" ");

    if (document.referrer.startsWith(location.origin)) {
      root.dataset.referrerUrl = document.referrer.slice(location.origin.length).replace(/\/{2,}/g, "/");
    } else {
      delete root.dataset.referrerUrl;
    }
  }

  function classifyPage(context = createCurrentPageContext()) {
    const flags = context.flags;

    setClass("isChrome", true);
    setClass("mac", navigator.platform.toLowerCase().includes("mac"));
    for (const [name, enabled] of Object.entries(flags)) {
      setClass(name, enabled);
    }
    setClass("isRedwood", flags.isLoginURL || hasRedwoodMarker());
    root.dataset.suitemateV3Route = context.routeId;
    root.dataset.suitemateV3Capabilities = context.capabilities.join(" ");
  }

  function hasRedwoodMarker() {
    return Boolean(
      document.querySelector(
        'link[href*="/uiredwood/"], script[src*="/uiredwood/"], [data-widget="NetsuiteSystemHeader"], [data-widget="RedwoodAppShell"]'
      )
    );
  }

  function detectRedwoodWhenRendered() {
    return lifecycleApi.register({
      id: "theme.redwood-marker",
      replace: true,
      capability: routeApi.CAPABILITIES.GLOBAL_THEME,
      mode: "once",
      timeoutMs: 60000,
      observe: {
        childList: true,
        subtree: true
      },
      evaluate() {
        const detected = hasRedwoodMarker();
        if (root.classList.contains("isRedwood") || detected) {
          setClass("isRedwood", detected || root.classList.contains("isRedwood"));
          return true;
        }
        return false;
      }
    });
  }

  function resolveDarkMode(mode) {
    return mode === "dark" || (mode === "system" && darkModeQuery.matches);
  }

  function readRoleContext(sourceDocument) {
    const sessionScript = sourceDocument.querySelector(
      'script[src^="/javascript/sessionstatus/session_status_init.jsp?"]'
    );
    if (!sessionScript?.src) {
      return null;
    }

    const params = new URL(sessionScript.src, location.origin).searchParams;
    const id = params.get("id")?.replace(/_RP(?=~)/, "");
    if (!id) {
      return null;
    }

    const companyName = params.get("companyName")?.trim() ?? "";
    const roleName = params.get("roleName")?.trim() ?? "";

    return {
      id,
      name: [companyName, roleName].filter(Boolean).join(" - ") || id,
      companyId: params.get("companyId") ?? "",
      roleId: params.get("roleId") ?? ""
    };
  }

  function findRoleContext() {
    const documents = [document];

    try {
      if (window.top !== window && window.top.document !== document) {
        documents.push(window.top.document);
      }
    } catch {}

    for (const sourceDocument of documents) {
      const context = readRoleContext(sourceDocument);
      if (context) {
        return context;
      }
    }

    return null;
  }

  function applyThemeVariables(theme, enabled) {
    for (const name of settingsApi.THEME_VARIABLE_NAMES) {
      root.style.removeProperty(name);
    }

    if (!enabled || !theme?.customized) {
      return;
    }

    const variables = settingsApi.deriveThemeVariables(theme);
    for (const [name, value] of Object.entries(variables)) {
      root.style.setProperty(name, value);
    }
  }

  function applyThemeColors(settings, enabled) {
    const theme = roleContext
      ? settingsApi.getRoleTheme(settings, roleContext.id)
      : null;
    applyThemeVariables(theme, enabled);
  }

  function previewThemeColors(message) {
    updateRoleContext();
    if (!roleContext || message?.roleId !== roleContext.id) {
      return false;
    }

    const main = settingsApi.normalizeHexColor(message.colors?.main);
    const secondary = settingsApi.normalizeHexColor(message.colors?.secondary);
    if (!main || !secondary) {
      return false;
    }

    const previewSettings = settingsApi.withRoleTheme(currentSettings, roleContext, { main, secondary });
    const theme = settingsApi.getRoleTheme(previewSettings, roleContext.id);
    applyThemeVariables(theme, currentSettings.enabled);
    return true;
  }

  function updateRoleContext() {
    const nextRoleContext = findRoleContext();
    if (!nextRoleContext || nextRoleContext.id === roleContext?.id) {
      return Boolean(nextRoleContext);
    }

    roleContext = nextRoleContext;
    applySettings(currentSettings);
    return true;
  }

  function detectRoleContextWhenRendered() {
    return lifecycleApi.register({
      id: "theme.role-context",
      replace: true,
      capability: routeApi.CAPABILITIES.GLOBAL_THEME,
      mode: "once",
      timeoutMs: 60000,
      observe: {
        childList: true,
        subtree: true
      },
      evaluate() {
        return updateRoleContext();
      }
    });
  }

  function applySettings(settings) {
    const value = settingsApi.normalize(settings);
    const enabled = value.enabled;

    currentSettings = value;

    setClass("ext-f", !enabled);
    setClass("isDarkMode", enabled && resolveDarkMode(value.mode));
    setClass("disable_radii", enabled && value.squareCorners);
    setClass("sfc", enabled);
    setClass("sln", enabled);
    applyThemeColors(value, enabled);
    root.dataset.suitemateV3 = enabled ? "active" : "disabled";
    root.dataset.suitemateV3Mode = value.mode;
  }

  function applySettingsFailure(error) {
    const versionError = settingsApi.isSettingsVersionError(error);
    applySettings(versionError ? { ...settingsApi.DEFAULTS, enabled: false } : settingsApi.DEFAULTS);
    root.dataset.suitemateV3Settings = versionError ? "unsupported" : "fallback";
  }

  async function loadSettings() {
    const revision = settingsRevision;
    try {
      const settings = await settingsApi.get();
      if (revision !== settingsRevision) {
        return;
      }
      applySettings(settings);
      delete root.dataset.suitemateV3Settings;
    } catch (error) {
      if (revision !== settingsRevision) {
        return;
      }
      console.error("SuiteMate V3 could not load styling settings.", error);
      applySettingsFailure(error);
    }
  }

  const initialPageContext = createCurrentPageContext();
  if (!routeApi.supports(routeApi.CAPABILITIES.GLOBAL_THEME, initialPageContext)) {
    return;
  }

  updateLocationMetadata(initialPageContext);
  classifyPage(initialPageContext);
  lifecycleApi.register({
    id: "theme.route-metadata",
    replace: true,
    capability: routeApi.CAPABILITIES.GLOBAL_THEME,
    evaluate() {
      const context = createCurrentPageContext();
      updateLocationMetadata(context);
      classifyPage(context);
      updateRoleContext();
    }
  });
  detectRedwoodWhenRendered();
  detectRoleContextWhenRendered();
  loadSettings();

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        setClass("document-ready", true);
        classifyPage();
        updateRoleContext();
      },
      { once: true }
    );
  } else {
    setClass("document-ready", true);
    classifyPage();
  }

  if (document.readyState === "complete") {
    setClass("window-loaded", true);
  } else {
    window.addEventListener("load", () => setClass("window-loaded", true), { once: true });
  }

  darkModeQuery.addEventListener("change", loadSettings);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === settingsApi.ROLE_CONTEXT_MESSAGE) {
      updateRoleContext();
      sendResponse({ roleContext });
      return;
    }

    if (message?.type === settingsApi.THEME_PREVIEW_MESSAGE) {
      sendResponse({ applied: previewThemeColors(message) });
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    const change = changes[settingsApi.STORAGE_KEY];
    if (areaName === "sync" && change) {
      settingsRevision += 1;
      try {
        applySettings(change.newValue);
        delete root.dataset.suitemateV3Settings;
      } catch (error) {
        applySettingsFailure(error);
      }
    }
  });
})();
