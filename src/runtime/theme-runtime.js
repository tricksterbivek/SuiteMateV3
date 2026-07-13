(function initializeSuiteMateV3() {
  "use strict";

  const settingsApi = globalThis.SuiteMateV3Settings;
  const root = document.documentElement;
  const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function setClass(name, enabled) {
    root.classList.toggle(name, Boolean(enabled));
  }

  function normalizePath(pathname) {
    return pathname.replace(/\/{2,}/g, "/");
  }

  function hasPath(...paths) {
    return paths.includes(normalizePath(location.pathname));
  }

  function pathStartsWith(prefix) {
    return normalizePath(location.pathname).startsWith(prefix);
  }

  function updateLocationMetadata() {
    const path = normalizePath(location.pathname);
    const params = new URLSearchParams(location.search);
    const flattenedParams = [...params]
      .filter(([name]) => name !== "suiteql")
      .map(([name, value]) => `${name}=${value}`)
      .join("|");

    root.dataset.path = path;
    root.dataset.url = `${path}${location.search}${location.hash}`;
    root.dataset.params = `|${flattenedParams}|`;
    root.dataset.history = history.length > 1 ? "T" : "F";

    if (document.referrer.startsWith(location.origin)) {
      root.dataset.referrerUrl = document.referrer.slice(location.origin.length).replace(/\/{2,}/g, "/");
    } else {
      delete root.dataset.referrerUrl;
    }
  }

  function classifyPage() {
    const path = normalizePath(location.pathname);
    const host = location.hostname.toLowerCase();
    const params = new URLSearchParams(location.search);
    const isLogin = hasPath(
      "/app/login/secure/enterpriselogin.nl",
      "/pages/customerlogin.jsp"
    );
    const isSearch = hasPath("/app/common/search/search.nl");

    setClass("isChrome", true);
    setClass("mac", navigator.platform.toLowerCase().includes("mac"));
    setClass("isSandbox", host.includes(".sandbox.netsuite.com") || /-sb\d*(?:\.|$)/i.test(host));
    setClass("isReleasePreview", host.includes(".beta.netsuite.com") || /-rp\d*(?:\.|$)/i.test(host));
    setClass("isDebugger", host.startsWith("debugger.") || host.includes(".debugger."));
    setClass("isInIframe", window !== window.top);
    setClass("isIfrmcntnr", params.get("ifrmcntnr") === "T");
    setClass("isLoginURL", isLogin);
    setClass("isFileCabinetURL", hasPath("/app/common/media/mediaitemfolders.nl") && params.get("frame") !== "bf");
    setClass("isScriptEditor", hasPath("/app/common/record/edittextmediaitem.nl") && params.has("id"));
    setClass("isScriptURL", /^\/app\/common\/scripting\/(?:script|webapp|plugin|plugintype)\.nl$/.test(path));
    setClass("isDeploymentURL", hasPath("/app/common/scripting/scriptrecord.nl"));
    setClass("isScriptStatusURL", /^\/app\/common\/scripting\/(?:scriptstatus|mapreducescriptstatus)\.nl$/.test(path));
    setClass("isSearchURL", isSearch);
    setClass("isSearchEditURL", isSearch && params.get("e") === "T");
    setClass("isSearchResultsURL", hasPath("/app/common/search/searchresults.nl"));
    setClass("isHelpCenterURL", hasPath("/app/help/helpcenter.nl"));
    setClass("isSRBrowserURL", hasPath("/app/recordscatalog/rcbrowser.nl"));
    setClass("isRedwood", isLogin || hasRedwoodMarker());
    setClass("isWorkflowURL", pathStartsWith("/app/common/workflow/setup/"));
  }

  function hasRedwoodMarker() {
    return Boolean(
      document.querySelector(
        'link[href*="/uiredwood/"], script[src*="/uiredwood/"], [data-widget="NetsuiteSystemHeader"], [data-widget="RedwoodAppShell"]'
      )
    );
  }

  function detectRedwoodWhenRendered() {
    if (root.classList.contains("isRedwood")) {
      return;
    }

    const observer = new MutationObserver(() => {
      if (hasRedwoodMarker()) {
        setClass("isRedwood", true);
        observer.disconnect();
      }
    });

    observer.observe(root, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 15000);
  }

  function resolveDarkMode(mode) {
    return mode === "dark" || (mode === "system" && darkModeQuery.matches);
  }

  function applySettings(settings) {
    const value = settingsApi.normalize(settings);
    const enabled = value.enabled;

    setClass("ext-f", !enabled);
    setClass("isDarkMode", enabled && resolveDarkMode(value.mode));
    setClass("disable_radii", enabled && value.squareCorners);
    root.dataset.suitemateV3 = enabled ? "active" : "disabled";
    root.dataset.suitemateV3Mode = value.mode;
  }

  async function loadSettings() {
    try {
      applySettings(await settingsApi.get());
    } catch (error) {
      console.error("SuiteMate V3 could not load styling settings.", error);
      applySettings(settingsApi.DEFAULTS);
    }
  }

  updateLocationMetadata();
  classifyPage();
  detectRedwoodWhenRendered();
  loadSettings();

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        setClass("document-ready", true);
        classifyPage();
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

  window.addEventListener("popstate", () => {
    updateLocationMetadata();
    classifyPage();
  });
  window.addEventListener("hashchange", updateLocationMetadata);
  darkModeQuery.addEventListener("change", loadSettings);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    const change = changes[settingsApi.STORAGE_KEY];
    if (areaName === "sync" && change) {
      applySettings(change.newValue);
    }
  });
})();
