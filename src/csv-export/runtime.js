(function initializeSuiteMateV3CsvExportRuntime(globalScope) {
  "use strict";

  const commandApi = globalScope.SuiteMateV3Commands;
  const bridgeApi = globalScope.SuiteMateV3Bridge;
  const core = globalScope.SuiteMateV3CsvExportCore;
  const notificationApi = globalScope.SuiteMateV3Notifications;
  const routeApi = globalScope.SuiteMateV3Routes;
  const settingsApi = globalScope.SuiteMateV3Settings;
  if (
    !commandApi
    || !bridgeApi
    || !core
    || !notificationApi?.showToast
    || !routeApi
    || !settingsApi
    || !globalScope.document
    || !globalScope.location
    || !globalScope.chrome?.storage
    || !globalScope.chrome?.runtime
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

  const RUNTIME_KEY = Symbol.for("SuiteMateV3.csvExport.runtime.v3");
  if (globalScope[RUNTIME_KEY]) {
    return;
  }

  let currentSettings = null;
  let settingsRevision = 0;

  const exportCommand = commandApi.IDS.RECORD_CSV_EXPORT;
  const templateCommand = commandApi.IDS.RECORD_CSV_TEMPLATE;
  const viewCommand = commandApi.IDS.RECORD_CSV_EXPORT_VIEW;
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

  function findActionLink(mode) {
    return globalScope.document.querySelector(
      mode === "template"
        ? core.TEMPLATE_ACTION_SELECTOR
        : core.ACTION_SELECTOR
    );
  }

  function showStatus(message, type = "info") {
    return notificationApi.showToast(message, {
      type
    });
  }

  function setBusy(mode, busy) {
    if (mode === "exportView") {
      // The view export is invoked from the CSV Utils menu, which closes on
      // click; relabeling the record-menu Export action would mislead.
      return;
    }
    const link = findActionLink(mode);
    if (!link) {
      return;
    }
    const label = mode === "template" ? "Download Template" : "Export Record";
    // Swap only the label span: the Tools menu rows are icon+label pairs,
    // and writing link.textContent flattened both into the busy text — the
    // action came back from a download as a bare, renamed string.
    const labelNode = link.querySelector?.(".suitemate-v3-tools-label") ?? link;
    labelNode.textContent = busy
      ? mode === "template" ? "Preparing..." : "Exporting..."
      : label;
    link.setAttribute("aria-busy", busy ? "true" : "false");
    link.setAttribute("aria-disabled", busy ? "true" : "false");
    link.style.pointerEvents = busy ? "none" : "";
    link.style.opacity = busy ? "0.6" : "";
  }

  function showExportResult(result) {
    if (result.ok) {
      if (result.mode === "exportView") {
        showStatus(
          `Exported ${result.rowCount} visible row${result.rowCount === 1 ? "" : "s"} to ${result.filename}.`,
          "success"
        );
        return;
      }
      if (result.mode === "template") {
        showStatus(
          `Downloaded ${result.columnCount}-column template to ${result.filename}.`,
          "success"
        );
        return;
      }
      const target = result.sublistId
        ? `${result.rowCount} ${result.sublistId} rows`
        : `${result.rowCount} record row`;
      showStatus(`Exported ${target} to ${result.filename}.`, "success");
    } else {
      showStatus(result.error.message, "error");
    }
  }

  async function beginExport(mode = "export") {
    setBusy(mode, true);
    const progressToast = showStatus(
      mode === "template"
        ? "Preparing CSV template..."
        : "Exporting CSV. Larger exports may take a moment.",
      "loading"
    );
    try {
      const response = await bridgeApi.request(
        bridgeApi.COMMANDS.RECORD_EXPORT_CSV,
        { mode },
        { timeoutMs: bridgeApi.MAX_TIMEOUT_MS }
      );
      const result = bridgeApi.toCommandResult(response);
      progressToast?.dismiss();
      showExportResult(result);
      return result;
    } finally {
      progressToast?.dismiss();
      setBusy(mode, false);
    }
  }

  commandScope.register(exportCommand, {
    run: () => beginExport("export")
  });
  commandScope.register(templateCommand, {
    run: () => beginExport("template")
  });
  commandScope.register(viewCommand, {
    run: () => beginExport("exportView")
  });

  function commandForMode(mode) {
    if (mode === "template") {
      return templateCommand;
    }
    return mode === "exportView" ? viewCommand : exportCommand;
  }

  const runtimeApi = Object.freeze({
    VERSION: 3,
    invoke(mode = "export") {
      return commandScope.invoke(commandForMode(mode), {}, {
        source: commandApi.SOURCES.LINK
      });
    }
  });
  globalScope[RUNTIME_KEY] = runtimeApi;

  async function start() {
    const revision = settingsRevision;
    try {
      const settings = await settingsApi.get();
      if (revision !== settingsRevision) {
        return;
      }
      currentSettings = settings;
    } catch {
      currentSettings = null;
    }
  }

  globalScope.chrome.storage.onChanged.addListener((changes, areaName) => {
    const settingsChange = changes[settingsApi.STORAGE_KEY];
    if (areaName !== "sync" || !settingsChange) {
      return;
    }
    settingsRevision += 1;
    try {
      currentSettings = settingsApi.normalize(settingsChange.newValue);
    } catch {
      currentSettings = null;
    }
  });

  globalScope.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      commandScope.dispose();
    }
  });

  start();
})(globalThis);
