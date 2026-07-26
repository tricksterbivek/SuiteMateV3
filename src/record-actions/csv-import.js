(function initializeSuiteMateV3CsvUtils(globalScope) {
  "use strict";

  const core = globalScope.SuiteMateV3RecordActionsCore;
  const bridgeApi = globalScope.SuiteMateV3Bridge;
  const commandApi = globalScope.SuiteMateV3Commands;
  const lifecycleApi = globalScope.SuiteMateV3Lifecycle;
  const routeApi = globalScope.SuiteMateV3Routes;
  const settingsApi = globalScope.SuiteMateV3Settings;
  if (
    !core
    || !bridgeApi
    || !commandApi
    || !lifecycleApi
    || !routeApi
    || !settingsApi
    || !globalScope.document
    || !globalScope.location
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

  const pageContext = routeApi.createPageContext(globalScope.location, {
    isTopFrame: topFrame,
    trustedContentScript: true
  });
  if (!pageContext.allowedNetSuite || !topFrame) {
    return;
  }

  const CSV_EXPORT_RUNTIME_KEY = Symbol.for("SuiteMateV3.csvExport.runtime.v3");
  const ACTION_SELECTOR = '[data-suitemate-v3-action="csv-utils-toolbar"]';
  const LEGACY_ACTION_SELECTOR = [
    '[data-suitemate-v3-action="csv-import-toolbar"]',
    '[data-suitemate-v3-action="csv-import"]',
    '[data-suitemate-v3-action="csv-export"]'
  ].join(", ");
  const TOP_TOOLBAR_SELECTOR = ".uir-buttons-top.uir-header-buttons";
  const ACTIONS_CELL_SELECTOR = `${TOP_TOOLBAR_SELECTOR} td.uir-button-menu`;
  let settingsRevision = 0;
  let currentSettings = null;

  const csvImportCommand = commandApi.IDS.RECORD_CSV_IMPORT;
  const csvExportCommand = commandApi.IDS.RECORD_CSV_EXPORT;
  const csvTemplateCommand = commandApi.IDS.RECORD_CSV_TEMPLATE;
  const commandScope = commandApi.createScope(commandApi.SURFACES.RECORD, {
    getContext: () => ({
      pageContext: routeApi.createPageContext(globalScope.location, {
        isTopFrame: true,
        trustedContentScript: true
      }),
      settings: currentSettings
    }),
    onError: ({ commandId, error }) => {
      globalScope.console?.error(
        `SuiteMate V3 command ${commandId || "(context)"} failed.`,
        error
      );
    }
  });
  commandScope.register(csvImportCommand, {
    run: ({ payload }) => payload?.href ?? ""
  });

  function findActionsCell() {
    return [...globalScope.document.querySelectorAll(ACTIONS_CELL_SELECTOR)]
      .find((cell) => {
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
    return core.resolveRecordTypeFromDocument(
      globalScope.document,
      globalScope.location.pathname
    ) ?? await requestMainWorldRecordType(signal);
  }

  function setMenuOpen(parentItem, trigger, open) {
    parentItem.dataset.open = open ? "true" : "false";
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function createChildItem(label, commandId, href, action) {
    const item = globalScope.document.createElement("li");
    item.className = "ns-menuitem suitemate-v3-csv-utils-option";
    item.setAttribute("role", "none");

    const link = globalScope.document.createElement("a");
    link.href = href;
    link.textContent = label;
    link.dataset.suitemateV3Action = action;
    link.setAttribute("role", "menuitem");
    commandApi.applyMetadata(link, commandId);
    link.textContent = label;
    item.append(link);
    return { item, link };
  }

  function createToolbarMenu(importHref) {
    const cell = globalScope.document.createElement("td");
    cell.className = "suitemate-v3-csv-utils-cell";
    cell.dataset.suitemateV3Action = "csv-utils-toolbar";

    const menu = globalScope.document.createElement("ul");
    menu.className = "ns-menu suitemate-v3-csv-utils-menu";
    menu.setAttribute("role", "menubar");

    const parentItem = globalScope.document.createElement("li");
    parentItem.className = "ns-menuitem suitemate-v3-csv-utils-parent";
    parentItem.dataset.open = "false";
    parentItem.setAttribute("role", "none");

    const trigger = globalScope.document.createElement("a");
    trigger.href = "#";
    trigger.className = "suitemate-v3-csv-utils-trigger";
    trigger.dataset.suitemateV3Action = "csv-utils-trigger";
    trigger.textContent = "CSV Utils";
    trigger.setAttribute("role", "menuitem");
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");

    const dropdown = globalScope.document.createElement("ul");
    dropdown.className = "ns-menu suitemate-v3-csv-utils-dropdown";
    dropdown.setAttribute("role", "menu");
    dropdown.setAttribute("aria-label", "CSV Utils");

    const exportOption = createChildItem(
      "Export",
      csvExportCommand,
      "#",
      "csv-utils-export"
    );
    const importOption = createChildItem(
      "Import",
      csvImportCommand,
      importHref,
      "csv-utils-import"
    );
    const templateOption = createChildItem(
      "Template",
      csvTemplateCommand,
      "#",
      "csv-utils-template"
    );

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      setMenuOpen(
        parentItem,
        trigger,
        parentItem.dataset.open !== "true"
      );
    });
    parentItem.addEventListener("focusout", (event) => {
      if (!parentItem.contains(event.relatedTarget)) {
        setMenuOpen(parentItem, trigger, false);
      }
    });
    parentItem.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(parentItem, trigger, false);
        trigger.focus();
      }
    });

    exportOption.link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(parentItem, trigger, false);
      const exportRuntime = globalScope[CSV_EXPORT_RUNTIME_KEY];
      const result = exportRuntime?.invoke();
      if (!result) {
        globalScope.console?.error("SuiteMate V3 CSV Export runtime is unavailable.");
      }
    });
    importOption.link.addEventListener("click", (event) => {
      const result = commandScope.invoke(
        csvImportCommand,
        { href: importOption.link.href },
        { source: commandApi.SOURCES.LINK }
      );
      if (!result.ok) {
        event.preventDefault();
      }
      setMenuOpen(parentItem, trigger, false);
    });
    templateOption.link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(parentItem, trigger, false);
      const exportRuntime = globalScope[CSV_EXPORT_RUNTIME_KEY];
      const result = exportRuntime?.invoke("template");
      if (!result) {
        globalScope.console?.error("SuiteMate V3 CSV Template runtime is unavailable.");
      }
    });

    dropdown.append(
      exportOption.item,
      importOption.item,
      templateOption.item
    );
    parentItem.append(trigger, dropdown);
    menu.append(parentItem);
    cell.append(menu);
    return cell;
  }

  async function installCsvUtilsMenu({ signal, isCurrent }) {
    if (
      signal.aborted
      || !isCurrent()
      || !globalScope.document.querySelector("#main_form")
      || !commandScope.isAvailable(csvImportCommand)
    ) {
      return false;
    }

    globalScope.document.querySelectorAll(LEGACY_ACTION_SELECTOR)
      .forEach((item) => item.remove());

    const actionsCell = findActionsCell();
    if (!actionsCell || globalScope.document.querySelector(ACTION_SELECTOR)) {
      return Boolean(actionsCell);
    }

    const recordType = await resolveRecordType(signal);
    if (signal.aborted || !isCurrent()) {
      return false;
    }
    const recordSubtype = core.deriveImportSubtype(
      recordType,
      globalScope.document.querySelector("#subtype")?.value
    );
    const href = core.createCsvImportUrl(
      recordSubtype,
      globalScope.location.origin
    );
    if (
      !href
      || signal.aborted
      || !isCurrent()
      || !actionsCell.isConnected
      || globalScope.document.querySelector(ACTION_SELECTOR)
    ) {
      return false;
    }

    actionsCell.after(createToolbarMenu(href));
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
      [...mutation.addedNodes, ...mutation.removedNodes]
        .some(nodeContainsRelevantToolbar));
  }

  function removeCsvUtilsMenu() {
    globalScope.document.querySelectorAll(
      `${ACTION_SELECTOR}, ${LEGACY_ACTION_SELECTOR}`
    ).forEach((item) => item.remove());
  }

  const lifecycleHandle = lifecycleApi.register({
    id: "record.csv-utils-toolbar",
    replace: true,
    capability: routeApi.CAPABILITIES.CSV_EXPORT_RECORD,
    startPaused: true,
    observe: {
      childList: true,
      subtree: true
    },
    relevant: containsRelevantMutation,
    evaluate: installCsvUtilsMenu,
    cleanup: removeCsvUtilsMenu
  });

  async function start() {
    const revision = settingsRevision;
    try {
      const settings = settingsApi?.get
        ? await settingsApi.get()
        : { enabled: true };
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

  globalScope.chrome.storage?.onChanged?.addListener((changes, areaName) => {
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

  globalScope.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      commandScope.dispose();
    }
  });

  start();
})(globalThis);
