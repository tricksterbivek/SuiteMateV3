(function initializeSuiteMateV3CsvExportRuntime(globalScope) {
  "use strict";

  const commandApi = globalScope.SuiteMateV3Commands;
  const core = globalScope.SuiteMateV3CsvExportCore;
  const lifecycleApi = globalScope.SuiteMateV3Lifecycle;
  const routeApi = globalScope.SuiteMateV3Routes;
  const settingsApi = globalScope.SuiteMateV3Settings;
  if (
    !commandApi
    || !core
    || !lifecycleApi
    || !routeApi
    || !settingsApi
    || !globalScope.document
    || !globalScope.location
    || !globalScope.chrome?.storage
  ) {
    return;
  }

  let topFrame = false;
  try {
    topFrame = globalScope === globalScope.top;
  } catch {
    return;
  }

  const initialContext = routeApi.createPageContext(globalScope.location, {
    isTopFrame: topFrame,
    trustedContentScript: true
  });
  if (!topFrame || !initialContext.allowedNetSuite) {
    return;
  }

  const MENU_IDS = Object.freeze(["NS_MENU_ID1", "NS_MENU_ID0"]);
  const FALLBACK_MENU_SELECTOR = [
    "#main_form",
    ".uir-page-title-record",
    ".uir-page-title-firstline-record",
    ".page-title-menu",
    "ul"
  ].join(" ");
  const STATUS_SELECTOR = '[data-suitemate-v3-action="csv-export-status"]';
  const EXPORT_TIMEOUT_MS = 120000;
  let currentSettings = null;
  let settingsRevision = 0;
  let pending = null;
  let actionLink = null;
  let statusTimer = null;

  const exportCommand = commandApi.IDS.RECORD_CSV_EXPORT;
  const commandScope = commandApi.createScope(commandApi.SURFACES.RECORD, {
    getContext: () => ({
      pageContext: routeApi.createPageContext(globalScope.location, {
        isTopFrame: true,
        trustedContentScript: true
      }),
      settings: currentSettings
    }),
    onError: ({ error }) => {
      showStatus(
        error?.message || "The CSV export could not be started.",
        "error"
      );
    }
  });

  function createRequestId() {
    try {
      return `csv-${globalScope.crypto.randomUUID()}`;
    } catch {
      return `csv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    }
  }

  function findMenu() {
    for (const id of MENU_IDS) {
      const menu = document.getElementById(id);
      if (menu) {
        return menu;
      }
    }
    return document.querySelector(FALLBACK_MENU_SELECTOR);
  }

  function clearStatus() {
    if (statusTimer !== null) {
      globalScope.clearTimeout(statusTimer);
      statusTimer = null;
    }
    document.querySelectorAll(STATUS_SELECTOR).forEach((element) => element.remove());
  }

  function showStatus(message, type = "info") {
    clearStatus();
    const alert = document.createElement("div");
    alert.className = [
      "uir-alert-box",
      "suitemate-v3-csv-export-status",
      type === "success" ? "confirmation" : type,
      type === "error" ? "" : "auto-dismiss"
    ].filter(Boolean).join(" ");
    alert.dataset.suitemateV3Action = "csv-export-status";
    alert.setAttribute("role", type === "error" ? "alert" : "status");

    const content = document.createElement("div");
    content.className = "uir-alert-box-content";
    const description = document.createElement("div");
    description.className = "uir-alert-box-description";
    description.textContent = String(message ?? "");
    content.append(description);
    alert.append(content);

    const target = document.querySelector("#div__alert");
    if (target) {
      target.append(alert);
    } else {
      document.querySelector("#main_form")?.prepend(alert);
    }

    if (type !== "error") {
      statusTimer = globalScope.setTimeout(() => {
        statusTimer = null;
        alert.remove();
      }, 8000);
    }
  }

  function setBusy(busy) {
    if (!actionLink?.isConnected) {
      actionLink = document.querySelector(core.ACTION_SELECTOR)?.querySelector("a") ?? null;
    }
    if (!actionLink) {
      return;
    }
    actionLink.textContent = busy ? "Exporting CSV..." : "Export CSV";
    actionLink.setAttribute("aria-busy", busy ? "true" : "false");
    actionLink.style.pointerEvents = busy ? "none" : "";
    actionLink.style.opacity = busy ? "0.6" : "";
  }

  function finishPending(result) {
    if (!pending || result.requestId !== pending.requestId) {
      return false;
    }
    globalScope.clearTimeout(pending.timer);
    const resolve = pending.resolve;
    pending = null;
    setBusy(false);
    resolve(result);
    return true;
  }

  function handleResult(event) {
    const result = core.normalizeResultDetail(event?.detail, pending?.requestId);
    if (!result || !finishPending(result)) {
      return;
    }
    if (result.ok) {
      const target = result.sublistId
        ? `${result.rowCount} ${result.sublistId} rows`
        : `${result.rowCount} record row`;
      showStatus(`Exported ${target} to ${result.filename}.`, "success");
    } else {
      showStatus(result.error.message, "error");
    }
  }

  function beginExport() {
    if (pending) {
      return Promise.reject(new Error("Another CSV export is already running."));
    }
    const requestId = createRequestId();
    setBusy(true);
    clearStatus();

    return new Promise((resolve) => {
      const timer = globalScope.setTimeout(() => {
        if (!pending || pending.requestId !== requestId) {
          return;
        }
        pending = null;
        setBusy(false);
        const result = Object.freeze({
          ok: false,
          requestId,
          error: Object.freeze({
            code: "CSV_EXPORT_TIMEOUT",
            message: "NetSuite did not finish the CSV export within two minutes."
          })
        });
        showStatus(result.error.message, "error");
        resolve(result);
      }, EXPORT_TIMEOUT_MS);

      pending = { requestId, resolve, timer };
      globalScope.dispatchEvent(new globalScope.CustomEvent(core.REQUEST_EVENT, {
        detail: { requestId }
      }));
    });
  }

  commandScope.register(exportCommand, {
    run: beginExport
  });

  function createAction() {
    const item = document.createElement("li");
    item.className = "ns-menuitem ns-header";
    item.id = core.ACTION_ID;
    item.dataset.suitemateV3Action = "csv-export";
    item.dataset.nspsType = "menu_top";
    item.dataset.nspsLabel = "Export CSV";
    item.setAttribute("role", "menuitem");

    const link = document.createElement("a");
    link.href = "#";
    link.tabIndex = 0;
    commandApi.applyMetadata(link, exportCommand, { setLabel: true });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      commandScope.invoke(exportCommand, {}, {
        source: commandApi.SOURCES.LINK
      });
    });
    item.append(link);
    actionLink = link;
    return item;
  }

  function installAction({ signal, isCurrent }) {
    if (
      signal.aborted
      || !isCurrent()
      || !core.isExportableLocation(globalScope.location)
      || !commandScope.isAvailable(exportCommand)
    ) {
      return false;
    }
    const menu = findMenu();
    if (!menu || document.querySelector(core.ACTION_SELECTOR)) {
      return Boolean(menu);
    }
    menu.append(createAction());
    return true;
  }

  function nodeContainsRelevantMenu(node) {
    if (node?.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    return MENU_IDS.some((id) => node.id === id)
      || node.matches?.(FALLBACK_MENU_SELECTOR)
      || node.matches?.(core.ACTION_SELECTOR)
      || MENU_IDS.some((id) => Boolean(node.querySelector?.(`#${id}`)))
      || Boolean(node.querySelector?.(`${FALLBACK_MENU_SELECTOR}, ${core.ACTION_SELECTOR}`));
  }

  function containsRelevantMutation(mutations) {
    return mutations.some((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].some(nodeContainsRelevantMenu));
  }

  function cleanup() {
    document.querySelectorAll(core.ACTION_SELECTOR).forEach((element) => element.remove());
    actionLink = null;
    if (pending) {
      globalScope.clearTimeout(pending.timer);
      const resolve = pending.resolve;
      const requestId = pending.requestId;
      pending = null;
      resolve(Object.freeze({
        ok: false,
        requestId,
        error: Object.freeze({
          code: "CSV_EXPORT_DISPOSED",
          message: "The CSV export page was closed before completion."
        })
      }));
    }
    clearStatus();
  }

  const lifecycleHandle = lifecycleApi.register({
    id: "record.csv-export",
    replace: true,
    capability: routeApi.CAPABILITIES.CSV_EXPORT_RECORD,
    startPaused: true,
    observe: {
      childList: true,
      subtree: true
    },
    relevant: containsRelevantMutation,
    evaluate: installAction,
    cleanup
  });

  async function start() {
    const revision = settingsRevision;
    try {
      const settings = await settingsApi.get();
      if (revision !== settingsRevision) {
        return;
      }
      currentSettings = settings;
      if (settings.enabled) {
        lifecycleHandle.resume("settings-enabled");
      } else {
        lifecycleHandle.pause("settings-disabled");
      }
    } catch {
      currentSettings = null;
      lifecycleHandle.pause("settings-failed");
    }
  }

  globalScope.addEventListener(core.RESULT_EVENT, handleResult);
  globalScope.chrome.storage.onChanged.addListener((changes, areaName) => {
    const settingsChange = changes[settingsApi.STORAGE_KEY];
    if (areaName !== "sync" || !settingsChange) {
      return;
    }
    settingsRevision += 1;
    try {
      currentSettings = settingsApi.normalize(settingsChange.newValue);
      if (currentSettings.enabled) {
        lifecycleHandle.resume("settings-enabled");
      } else {
        lifecycleHandle.pause("settings-disabled");
      }
    } catch {
      currentSettings = null;
      lifecycleHandle.pause("settings-failed");
    }
  });

  globalScope.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      commandScope.dispose();
      globalScope.removeEventListener(core.RESULT_EVENT, handleResult);
    }
  });

  start();
})(globalThis);
