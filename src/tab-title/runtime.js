(function initializeSuiteMateV3TabTitle() {
  "use strict";

  const core = globalThis.SuiteMateV3TabTitleCore;
  const settingsApi = globalThis.SuiteMateV3Settings;
  const routeApi = globalThis.SuiteMateV3Routes;
  const lifecycleApi = globalThis.SuiteMateV3Lifecycle;
  if (
    !core
    || !settingsApi
    || !routeApi
    || !lifecycleApi
    || !globalThis.document
    || !globalThis.location
    || !globalThis.chrome?.storage
  ) {
    return;
  }

  let topFrame = false;
  try {
    topFrame = window === window.top;
  } catch {
    return;
  }

  const pageContext = routeApi.createPageContext(location, {
    isTopFrame: topFrame,
    trustedContentScript: true
  });
  if (!topFrame || !pageContext.allowedNetSuite) {
    return;
  }

  const parsed = core.parseRecordPath(location.pathname);
  if (!parsed) {
    return;
  }

  let originalTitle = null;
  let settingsRevision = 0;

  function applyTitle() {
    const title = core.composeTitle(parsed, core.extractHeaderParts(document, parsed));
    if (!title) {
      return;
    }
    if (originalTitle === null) {
      originalTitle = document.title;
    }
    document.title = title;
  }

  function restoreTitle() {
    if (originalTitle !== null) {
      document.title = originalTitle;
      originalTitle = null;
    }
  }

  function applySettings(value) {
    try {
      const settings = settingsApi.normalize(value);
      if (!settings.smartTabTitles) {
        restoreTitle();
        return;
      }
      const revision = settingsRevision;
      lifecycleApi.whenDomReady().then(() => {
        if (revision === settingsRevision) {
          applyTitle();
        }
      });
    } catch {
      restoreTitle();
    }
  }

  async function start() {
    const revision = ++settingsRevision;
    try {
      const settings = await settingsApi.get();
      if (revision === settingsRevision) {
        applySettings(settings);
      }
    } catch {}
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    const change = changes[settingsApi.STORAGE_KEY];
    if (areaName !== "sync" || !change) {
      return;
    }
    settingsRevision += 1;
    applySettings(change.newValue);
  });

  start();
})();
