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
  const ACTION_SELECTOR = '[data-suitemate-v3-action="record-tools-toolbar"]';
  const TOOLS_MENU_SELECTOR = '[data-suitemate-v3-menu="tools-actions"]';
  const LEGACY_ACTION_SELECTOR = [
    '[data-suitemate-v3-action="csv-import-toolbar"]',
    '[data-suitemate-v3-action="csv-import"]',
    '[data-suitemate-v3-action="csv-export"]',
    '[data-suitemate-v3-action="csv-utils-toolbar"]',
    '.suitemate-v3-record-trail-cell'
  ].join(", ");
  const TOP_TOOLBAR_SELECTOR = ".uir-buttons-top.uir-header-buttons";
  const ACTIONS_CELL_SELECTOR = `${TOP_TOOLBAR_SELECTOR} td.uir-button-menu`;
  let settingsRevision = 0;
  let currentSettings = null;
  let activeToolsCell = null;
  let closeActiveToolsMenu = null;

  const csvImportCommand = commandApi.IDS.RECORD_CSV_IMPORT;
  const csvExportCommand = commandApi.IDS.RECORD_CSV_EXPORT;
  const csvTemplateCommand = commandApi.IDS.RECORD_CSV_TEMPLATE;
  const csvExportViewCommand = commandApi.IDS.RECORD_CSV_EXPORT_VIEW;
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

  function setExpanded(parentItem, trigger, panel, open) {
    parentItem.dataset.open = open ? "true" : "false";
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    panel.hidden = !open;
  }

  function createIcon(glyph, className = "") {
    const icon = globalScope.document.createElement("span");
    icon.className = `suitemate-v3-tools-icon${className ? ` ${className}` : ""}`;
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = glyph;
    return icon;
  }

  function createLabel(text) {
    const label = globalScope.document.createElement("span");
    label.className = "suitemate-v3-tools-label";
    label.textContent = text;
    return label;
  }

  function createChildItem(label, commandId, href, action, glyph) {
    const item = globalScope.document.createElement("li");
    item.className = "ns-menuitem suitemate-v3-tools-action suitemate-v3-csv-utils-option";
    item.setAttribute("role", "none");

    const link = globalScope.document.createElement("a");
    link.href = href;
    link.dataset.suitemateV3Action = action;
    link.setAttribute("role", "menuitem");
    commandApi.applyMetadata(link, commandId);
    link.append(createIcon(glyph), createLabel(label));
    item.append(link);
    return { item, link };
  }

  function createToolbarMenu(importHref, showExportView) {
    const cell = globalScope.document.createElement("td");
    cell.className = "suitemate-v3-tools-cell";
    cell.dataset.suitemateV3Action = "record-tools-toolbar";

    const menu = globalScope.document.createElement("ul");
    menu.className = "ns-menu suitemate-v3-tools-menu";
    menu.setAttribute("role", "none");

    const toolsItem = globalScope.document.createElement("li");
    toolsItem.className = "ns-menuitem suitemate-v3-tools-root";
    toolsItem.dataset.open = "false";
    toolsItem.setAttribute("role", "none");

    const toolsTrigger = globalScope.document.createElement("button");
    toolsTrigger.type = "button";
    toolsTrigger.className = "suitemate-v3-tools-trigger";
    toolsTrigger.dataset.suitemateV3Action = "tools-trigger";
    toolsTrigger.setAttribute("aria-label", "SuiteMate Tools");
    toolsTrigger.setAttribute("aria-haspopup", "menu");
    toolsTrigger.setAttribute("aria-expanded", "false");
    toolsTrigger.setAttribute("aria-controls", "suitemate-v3-tools-dropdown");
    toolsTrigger.append(
      createIcon("S", "suitemate-v3-tools-logo"),
      createLabel("Tools"),
      createIcon("▾", "suitemate-v3-tools-chevron")
    );

    const dropdown = globalScope.document.createElement("ul");
    dropdown.id = "suitemate-v3-tools-dropdown";
    dropdown.className = "ns-menu suitemate-v3-tools-dropdown";
    dropdown.dataset.suitemateV3Menu = "tools-actions";
    dropdown.dataset.align = "start";
    dropdown.setAttribute("role", "menu");
    dropdown.setAttribute("aria-label", "SuiteMate Tools");
    dropdown.hidden = true;

    const csvParent = globalScope.document.createElement("li");
    csvParent.className = "ns-menuitem suitemate-v3-tools-category suitemate-v3-csv-utils-parent";
    csvParent.dataset.open = "false";
    csvParent.setAttribute("role", "none");

    const csvTrigger = globalScope.document.createElement("button");
    csvTrigger.type = "button";
    csvTrigger.className = "suitemate-v3-tools-category-trigger";
    csvTrigger.dataset.suitemateV3Action = "csv-utils-trigger";
    csvTrigger.setAttribute("role", "menuitem");
    csvTrigger.setAttribute("aria-haspopup", "true");
    csvTrigger.setAttribute("aria-expanded", "false");
    csvTrigger.setAttribute("aria-controls", "suitemate-v3-csv-utils-group");
    csvTrigger.append(
      createIcon("⇄"),
      createLabel("CSV Utils"),
      createIcon("›", "suitemate-v3-tools-chevron")
    );

    const csvGroup = globalScope.document.createElement("ul");
    csvGroup.id = "suitemate-v3-csv-utils-group";
    csvGroup.className = "suitemate-v3-tools-children";
    csvGroup.setAttribute("role", "group");
    csvGroup.setAttribute("aria-label", "CSV Utils");
    csvGroup.hidden = true;

    const exportOption = createChildItem(
      "Export Record",
      csvExportCommand,
      "#",
      "csv-utils-export",
      "↓"
    );
    const templateOption = createChildItem(
      "Download Template",
      csvTemplateCommand,
      "#",
      "csv-utils-template",
      "□"
    );
    const exportViewOption = createChildItem(
      "Export Table View",
      csvExportViewCommand,
      "#",
      "csv-utils-export-view",
      "▦"
    );
    const importOption = importHref
      ? createChildItem(
        "Import Records",
        csvImportCommand,
        importHref,
        "csv-utils-import",
        "↑"
      )
      : null;

    function positionDropdown() {
      dropdown.dataset.align = "start";
      const rect = dropdown.getBoundingClientRect?.();
      const viewportWidth = globalScope.innerWidth
        || globalScope.document.documentElement?.clientWidth
        || 0;
      if (rect && viewportWidth > 0 && rect.right > viewportWidth - 8) {
        dropdown.dataset.align = "end";
      }
    }

    function setToolsOpen(open, focusFirst = false) {
      setExpanded(toolsItem, toolsTrigger, dropdown, open);
      if (!open) {
        setExpanded(csvParent, csvTrigger, csvGroup, false);
        return;
      }
      positionDropdown();
      if (focusFirst) {
        csvTrigger.focus?.();
      }
    }

    activeToolsCell = cell;
    closeActiveToolsMenu = () => setToolsOpen(false);

    function setCsvOpen(open, focusFirst = false) {
      setExpanded(csvParent, csvTrigger, csvGroup, open);
      if (open && focusFirst) {
        csvGroup.querySelector?.('[role="menuitem"]')?.focus?.();
      }
    }

    function visibleMenuItems() {
      return [...(dropdown.querySelectorAll?.('[role="menuitem"]') ?? [])]
        .filter((item) => !csvGroup.contains(item) || csvParent.dataset.open === "true");
    }

    function focusSibling(current, offset) {
      const items = visibleMenuItems();
      if (!items.length) {
        return;
      }
      const index = Math.max(0, items.indexOf(current));
      items[(index + offset + items.length) % items.length].focus?.();
    }

    toolsTrigger.addEventListener("click", (event) => {
      event.preventDefault();
      setToolsOpen(toolsItem.dataset.open !== "true");
    });

    csvTrigger.addEventListener("click", (event) => {
      event.preventDefault();
      setCsvOpen(csvParent.dataset.open !== "true");
    });

    cell.addEventListener("click", (event) => {
      const commandTarget = event.target?.closest?.("[data-suitemate-v3-command]")
        ?? (event.target?.dataset?.suitemateV3Command ? event.target : null);
      if (commandTarget) {
        setToolsOpen(false);
      }
    });

    cell.addEventListener("focusout", (event) => {
      if (!cell.contains(event.relatedTarget)) {
        setToolsOpen(false);
      }
    });

    cell.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setToolsOpen(false);
        toolsTrigger.focus?.();
        return;
      }
      if (event.target === toolsTrigger && event.key === "ArrowDown") {
        event.preventDefault();
        setToolsOpen(true, true);
        return;
      }
      if (toolsItem.dataset.open !== "true") {
        return;
      }
      const current = event.target?.closest?.('[role="menuitem"]') ?? event.target;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        focusSibling(current, event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const items = visibleMenuItems();
        items[event.key === "Home" ? 0 : items.length - 1]?.focus?.();
      } else if (event.key === "ArrowRight" && current === csvTrigger) {
        event.preventDefault();
        setCsvOpen(true, true);
      } else if (event.key === "ArrowLeft" && (
        current === csvTrigger || csvGroup.contains(current)
      )) {
        event.preventDefault();
        setCsvOpen(false);
        csvTrigger.focus?.();
      }
    });

    exportOption.link.addEventListener("click", (event) => {
      event.preventDefault();
      const exportRuntime = globalScope[CSV_EXPORT_RUNTIME_KEY];
      const result = exportRuntime?.invoke();
      if (!result) {
        globalScope.console?.error("SuiteMate V3 CSV Export runtime is unavailable.");
      }
    });
    importOption?.link.addEventListener("click", (event) => {
      const result = commandScope.invoke(csvImportCommand, {
        href: importOption.link.href
      }, { source: commandApi.SOURCES.LINK });
      if (!result.ok) event.preventDefault();
    });
    templateOption.link.addEventListener("click", (event) => {
      event.preventDefault();
      const exportRuntime = globalScope[CSV_EXPORT_RUNTIME_KEY];
      const result = exportRuntime?.invoke("template");
      if (!result) {
        globalScope.console?.error("SuiteMate V3 CSV Template runtime is unavailable.");
      }
    });
    exportViewOption.link.addEventListener("click", (event) => {
      event.preventDefault();
      const exportRuntime = globalScope[CSV_EXPORT_RUNTIME_KEY];
      const result = exportRuntime?.invoke("exportView");
      if (!result) {
        globalScope.console?.error("SuiteMate V3 CSV Export View runtime is unavailable.");
      }
    });

    csvGroup.append(exportOption.item);
    if (showExportView) csvGroup.append(exportViewOption.item);
    csvGroup.append(templateOption.item);
    if (importOption) csvGroup.append(importOption.item);
    csvParent.append(csvTrigger, csvGroup);
    dropdown.append(csvParent);
    toolsItem.append(toolsTrigger, dropdown);
    menu.append(toolsItem);
    cell.append(menu);
    return cell;
  }

  async function installCsvUtilsMenu({ signal, isCurrent }) {
    if (
      signal.aborted
      || !isCurrent()
      || !globalScope.document.querySelector("#main_form")
    ) {
      return false;
    }

    globalScope.document.querySelectorAll(LEGACY_ACTION_SELECTOR)
      .forEach((item) => item.remove());

    const actionsCell = findActionsCell();
    if (!actionsCell || globalScope.document.querySelector(ACTION_SELECTOR)) {
      return Boolean(actionsCell);
    }

    let href = null;
    const importAvailable = commandScope.isAvailable(csvImportCommand);
    const recordType = importAvailable ? await resolveRecordType(signal) : null;
    if (signal.aborted || !isCurrent()) {
      return false;
    }
    if (recordType) {
      const recordSubtype = core.deriveImportSubtype(
        recordType,
        globalScope.document.querySelector("#subtype")?.value
      );
      href = core.createCsvImportUrl(recordSubtype, globalScope.location.origin);
    }
    if (
      signal.aborted
      || !isCurrent()
      || !actionsCell.isConnected
      || globalScope.document.querySelector(ACTION_SELECTOR)
    ) {
      return false;
    }

    const params = new globalScope.URLSearchParams(globalScope.location.search);
    const showExportView = !params.has("e");
    actionsCell.after(createToolbarMenu(href, showExportView));
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
      || node.matches?.(TOOLS_MENU_SELECTOR)
      || Boolean(
        node.querySelector?.(
          `#main_form, ${TOP_TOOLBAR_SELECTOR}, ${ACTIONS_CELL_SELECTOR}, ${ACTION_SELECTOR}, ${TOOLS_MENU_SELECTOR}`
        )
      );
  }

  function containsRelevantMutation(mutations) {
    return mutations.some((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes]
        .some(nodeContainsRelevantToolbar));
  }

  function removeToolsMenu() {
    closeActiveToolsMenu?.();
    activeToolsCell = null;
    closeActiveToolsMenu = null;
    globalScope.document.querySelectorAll(
      `${ACTION_SELECTOR}, ${LEGACY_ACTION_SELECTOR}`
    ).forEach((item) => item.remove());
  }

  function closeOnOutsidePointer(event) {
    if (activeToolsCell && !activeToolsCell.contains(event.target)) {
      closeActiveToolsMenu?.();
    }
  }

  globalScope.document.addEventListener?.("pointerdown", closeOnOutsidePointer);

  const lifecycleHandle = lifecycleApi.register({
    id: "record.tools-toolbar",
    replace: true,
    capability: routeApi.CAPABILITIES.CSV_EXPORT_RECORD,
    startPaused: true,
    observe: {
      childList: true,
      subtree: true
    },
    relevant: containsRelevantMutation,
    evaluate: installCsvUtilsMenu,
    cleanup: removeToolsMenu
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
      globalScope.document.removeEventListener?.("pointerdown", closeOnOutsidePointer);
      commandScope.dispose();
    }
  });

  start();
})(globalThis);
