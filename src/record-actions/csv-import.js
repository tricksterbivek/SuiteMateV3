(function initializeSuiteMateV3CsvImport() {
  "use strict";

  const core = globalThis.SuiteMateV3RecordActionsCore;
  const bridgeApi = globalThis.SuiteMateV3Bridge;
  const commandApi = globalThis.SuiteMateV3Commands;
  const lifecycleApi = globalThis.SuiteMateV3Lifecycle;
  const routeApi = globalThis.SuiteMateV3Routes;
  const settingsApi = globalThis.SuiteMateV3Settings;
  if (
    !core
    || !bridgeApi
    || !commandApi
    || !lifecycleApi
    || !routeApi
    || !settingsApi
    || !globalThis.document
    || !globalThis.location
    || !globalThis.chrome?.runtime
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
  if (!pageContext.allowedNetSuite || !topFrame) {
    return;
  }

  const ACTION_SELECTOR = '[data-suitemate-v3-action="csv-import-toolbar"]';
  const LEGACY_ACTION_SELECTOR = '[data-suitemate-v3-action="csv-import"]';
  const TOP_TOOLBAR_SELECTOR = ".uir-buttons-top.uir-header-buttons";
  const ACTIONS_CELL_SELECTOR = `${TOP_TOOLBAR_SELECTOR} td.uir-button-menu`;
  let settingsRevision = 0;
  let currentSettings = null;
  const csvImportCommand = commandApi.IDS.RECORD_CSV_IMPORT;
  const commandScope = commandApi.createScope(commandApi.SURFACES.RECORD, {
    getContext: () => ({
      pageContext: routeApi.createPageContext(location, {
        isTopFrame: true,
        trustedContentScript: true
      }),
      settings: currentSettings
    }),
    onError: ({ commandId, error }) => {
      console.error(`SuiteMate V3 command ${commandId || "(context)"} failed.`, error);
    }
  });
  commandScope.register(csvImportCommand, {
    run: ({ payload }) => payload?.href ?? ""
  });

  function findActionsCell() {
    return [...document.querySelectorAll(ACTIONS_CELL_SELECTOR)].find((cell) => {
      const trigger = cell.querySelector(":scope > .ns-menu > .ns-menuitem > a");
      return trigger?.textContent?.trim() === "Actions";
    }) ?? null;
  }

  async function requestMainWorldRecordType(signal) {
    try {
      const response = await bridgeApi.request(
        bridgeApi.COMMANDS.RECORD_GET_TYPE,
        {},
        { signal, timeoutMs: 10000 }
      );
      const result = bridgeApi.toCommandResult(response);
      return result.ok ? core.normalizeRecordType(result.recordType) : null;
    } catch {
      return null;
    }
  }

  async function resolveRecordType(signal) {
    return core.resolveRecordTypeFromDocument(document, location.pathname)
      ?? await requestMainWorldRecordType(signal);
  }

  function createToolbarAction(href) {
    const cell = document.createElement("td");
    cell.className = "suitemate-v3-csv-import-cell";
    cell.dataset.suitemateV3Action = "csv-import-toolbar";

    const link = document.createElement("a");
    link.href = href;
    link.className = "suitemate-v3-csv-import-button";
    commandApi.applyMetadata(link, csvImportCommand, { setLabel: true });
    link.addEventListener("click", (event) => {
      const result = commandScope.invoke(
        csvImportCommand,
        { href: link.href },
        { source: commandApi.SOURCES.LINK }
      );
      if (!result.ok) {
        event.preventDefault();
      }
    });
    cell.append(link);
    return cell;
  }

  async function installCsvImportAction({ signal, isCurrent }) {
    if (
      signal.aborted
      || !isCurrent()
      || !document.querySelector("#main_form")
      || !commandScope.isAvailable(csvImportCommand)
    ) {
      return false;
    }

    document.querySelectorAll(LEGACY_ACTION_SELECTOR).forEach((item) => item.remove());

    const actionsCell = findActionsCell();
    if (!actionsCell || document.querySelector(ACTION_SELECTOR)) {
      return Boolean(actionsCell);
    }

    const recordType = await resolveRecordType(signal);
    if (signal.aborted || !isCurrent()) {
      return false;
    }
    const recordSubtype = core.deriveImportSubtype(
      recordType,
      document.querySelector("#subtype")?.value
    );
    const href = core.createCsvImportUrl(recordSubtype, location.origin);
    if (
      !href
      || signal.aborted
      || !isCurrent()
      || !actionsCell.isConnected
      || document.querySelector(ACTION_SELECTOR)
    ) {
      return false;
    }

    actionsCell.after(createToolbarAction(href));
    return true;
  }

  function nodeContainsRelevantToolbar(node) {
    if (node?.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    return node.matches?.("#main_form")
      || node.matches?.(TOP_TOOLBAR_SELECTOR)
      || node.matches?.(ACTIONS_CELL_SELECTOR)
      || node.matches?.(ACTION_SELECTOR)
      || Boolean(
        node.querySelector?.(
          `#main_form, ${TOP_TOOLBAR_SELECTOR}, ${ACTIONS_CELL_SELECTOR}, ${ACTION_SELECTOR}`
        )
      );
  }

  function containsRelevantMutation(mutations) {
    return mutations.some((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].some(nodeContainsRelevantToolbar));
  }

  function removeCsvImportAction() {
    document.querySelectorAll(`${ACTION_SELECTOR}, ${LEGACY_ACTION_SELECTOR}`).forEach((item) => item.remove());
  }

  const lifecycleHandle = lifecycleApi.register({
    id: "record.csv-import-toolbar",
    replace: true,
    capability: routeApi.CAPABILITIES.CSV_IMPORT_TOOLBAR,
    startPaused: true,
    observe: {
      childList: true,
      subtree: true
    },
    relevant: containsRelevantMutation,
    evaluate: installCsvImportAction,
    cleanup: removeCsvImportAction
  });

  async function start() {
    const revision = settingsRevision;
    try {
      const settings = settingsApi?.get ? await settingsApi.get() : { enabled: true };
      if (revision !== settingsRevision) {
        return;
      }
      currentSettings = settings;
      if (settings?.enabled === false) {
        lifecycleHandle.pause("settings-disabled");
      } else {
        lifecycleHandle.resume("settings-enabled");
      }
    } catch {
      currentSettings = null;
      lifecycleHandle.pause("settings-failed");
    }
  }

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    const settingsChange = changes[settingsApi?.STORAGE_KEY];
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

  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      commandScope.dispose();
    }
  });

  start();
})();
