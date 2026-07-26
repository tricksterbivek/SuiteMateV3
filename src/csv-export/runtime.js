(function initializeSuiteMateV3CsvExportRuntime(globalScope) {
  "use strict";

  const commandApi = globalScope.SuiteMateV3Commands;
  const bridgeApi = globalScope.SuiteMateV3Bridge;
  const core = globalScope.SuiteMateV3CsvExportCore;
  const routeApi = globalScope.SuiteMateV3Routes;
  const settingsApi = globalScope.SuiteMateV3Settings;
  if (
    !commandApi
    || !bridgeApi
    || !core
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

  const STATUS_SELECTOR = '[data-suitemate-v3-action="csv-export-status"]';
  let currentSettings = null;
  let settingsRevision = 0;
  let statusTimer = null;

  const exportCommand = commandApi.IDS.RECORD_CSV_EXPORT;
  const templateCommand = commandApi.IDS.RECORD_CSV_TEMPLATE;
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

  function clearStatus() {
    if (statusTimer !== null) {
      globalScope.clearTimeout(statusTimer);
      statusTimer = null;
    }
    globalScope.document.querySelectorAll(STATUS_SELECTOR)
      .forEach((element) => element.remove());
  }

  function showStatus(message, type = "info") {
    clearStatus();
    const alert = globalScope.document.createElement("div");
    alert.className = [
      "uir-alert-box",
      "suitemate-v3-csv-export-status",
      type === "success" ? "confirmation" : type,
      type === "error" ? "" : "auto-dismiss"
    ].filter(Boolean).join(" ");
    alert.dataset.suitemateV3Action = "csv-export-status";
    alert.setAttribute("role", type === "error" ? "alert" : "status");

    const content = globalScope.document.createElement("div");
    content.className = "uir-alert-box-content";
    const description = globalScope.document.createElement("div");
    description.className = "uir-alert-box-description";
    description.textContent = String(message ?? "");
    content.append(description);
    alert.append(content);

    const target = globalScope.document.querySelector("#div__alert");
    if (target) {
      target.append(alert);
    } else {
      globalScope.document.querySelector("#main_form")?.prepend(alert);
    }

    if (type !== "error") {
      statusTimer = globalScope.setTimeout(() => {
        statusTimer = null;
        alert.remove();
      }, 8000);
    }
  }

  function setBusy(mode, busy) {
    const link = findActionLink(mode);
    if (!link) {
      return;
    }
    const label = mode === "template" ? "Template" : "Export";
    link.textContent = busy
      ? mode === "template" ? "Preparing..." : "Exporting..."
      : label;
    link.setAttribute("aria-busy", busy ? "true" : "false");
    link.setAttribute("aria-disabled", busy ? "true" : "false");
    link.style.pointerEvents = busy ? "none" : "";
    link.style.opacity = busy ? "0.6" : "";
  }

  function showExportResult(result) {
    if (result.ok) {
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
    clearStatus();
    try {
      const response = await bridgeApi.request(
        bridgeApi.COMMANDS.RECORD_EXPORT_CSV,
        { mode },
        { timeoutMs: bridgeApi.MAX_TIMEOUT_MS }
      );
      const result = bridgeApi.toCommandResult(response);
      showExportResult(result);
      return result;
    } finally {
      setBusy(mode, false);
    }
  }

  commandScope.register(exportCommand, {
    run: () => beginExport("export")
  });
  commandScope.register(templateCommand, {
    run: () => beginExport("template")
  });

  const runtimeApi = Object.freeze({
    VERSION: 3,
    isAvailable(mode = "export") {
      return commandScope.isAvailable(
        mode === "template" ? templateCommand : exportCommand
      );
    },
    invoke(mode = "export") {
      const command = mode === "template" ? templateCommand : exportCommand;
      return commandScope.invoke(command, {}, {
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
      clearStatus();
    }
  });

  start();
})(globalThis);
