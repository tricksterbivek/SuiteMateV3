(function initializeSuiteMateV3SoColumns() {
  "use strict";

  const core = globalThis.SuiteMateV3SoColumnsCore;
  const lifecycleApi = globalThis.SuiteMateV3Lifecycle;
  const routeApi = globalThis.SuiteMateV3Routes;
  const settingsApi = globalThis.SuiteMateV3Settings;
  if (
    !core
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
  if (!routeApi.supports(routeApi.CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION, pageContext)) {
    return;
  }

  const TABLE_SELECTOR = "#item_splits";
  const CONTAINER_SELECTOR = ".uir-machine-table-container";
  const OWNED_SELECTOR = `[${core.DATA_ATTRIBUTE}]`;
  const RELEVANT_SELECTOR = `${TABLE_SELECTOR}, ${core.HEADER_ROW_SELECTOR}`;
  let settingsRevision = 0;
  let scopeKey = null;
  let nativeLabels = null;
  let capturedScope = null;
  let savePending = false;
  let controlButtons = null;
  let personalizing = false;
  let activeTable = null;
  let dragCell = null;
  let dragLabel = null;
  let dropCell = null;
  let sortCell = null;
  let sortDirection = null;

  function showToast(message, type) {
    globalThis.SuiteMateV3Notifications?.showToast(message, { type });
  }

  function recordType() {
    const match = /\/([a-z0-9_]+)\.nl$/i.exec(location.pathname);
    return (match?.[1] ?? "record").toLowerCase();
  }

  function resolveScopeKey() {
    const type = recordType();
    try {
      const sessionScript = document.querySelector(
        'script[src^="/javascript/sessionstatus/session_status_init.jsp?"]'
      );
      if (sessionScript?.src) {
        const params = new URL(sessionScript.src, location.origin).searchParams;
        const companyId = params.get("companyId");
        // The session id param is COMPANY~USER~ROLE~FLAG (e.g. FIXTURE~1~3~N);
        // segment 2 is the NetSuite user id, so preferences follow the user
        // across roles. The record type keeps a separate order per
        // transaction type.
        const userId = params.get("id")?.split("~")[1];
        if (companyId && userId) {
          return `${companyId}:${userId}:${type}`;
        }
      }
    } catch {}
    return `${location.hostname}:${type}`;
  }

  function headerCells(table) {
    return Array.from(table?.querySelector?.(core.HEADER_ROW_SELECTOR)?.cells ?? []);
  }

  function cellLabel(cell) {
    return core.readCellLabel(cell);
  }

  function isMovable(labels, label) {
    return label !== "" && labels.indexOf(label) === labels.lastIndexOf(label);
  }

  function headerCellFromEvent(event) {
    const cell = event.target?.closest?.("td");
    if (
      !personalizing
      || !activeTable
      || !cell
      || !cell.parentElement?.matches?.(core.HEADER_ROW_SELECTOR)
      || !activeTable.contains(cell)
    ) {
      return null;
    }
    return cell;
  }

  function setDropTarget(cell) {
    if (dropCell === cell) {
      return;
    }
    dropCell?.classList.remove(core.CLASSES.dropTarget);
    dropCell = cell;
    dropCell?.classList.add(core.CLASSES.dropTarget);
  }

  function clearDragState() {
    dragCell?.classList.remove(core.CLASSES.dragging);
    dragCell = null;
    dragLabel = null;
    setDropTarget(null);
  }

  function moveLabel(labels, fromLabel, toLabel) {
    const from = labels.indexOf(fromLabel);
    const to = labels.indexOf(toLabel);
    if (from < 0 || to < 0 || from === to) {
      return null;
    }
    const next = labels.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  }

  function clearSortIndicators() {
    document.querySelectorAll(`[${core.DATA_ATTRIBUTE}="sort-indicator"]`).forEach((node) => node.remove());
  }

  function resetSort(table) {
    clearSortIndicators();
    if (sortDirection && table) {
      core.sortRows(table, -1, "native");
    }
    sortCell = null;
    sortDirection = null;
  }

  function handleSortClick(event) {
    try {
      if (personalizing) {
        return;
      }
      const table = event.currentTarget;
      const cell = event.target?.closest?.("td");
      if (!cell || !cell.parentElement?.matches?.(core.HEADER_ROW_SELECTOR) || !table.contains(cell)) {
        return;
      }
      const next = sortCell === cell
        ? (sortDirection === "asc" ? "desc" : sortDirection === "desc" ? "native" : "asc")
        : "asc";
      if (!core.sortRows(table, cell.cellIndex, next)) {
        return;
      }
      clearSortIndicators();
      sortCell = next === "native" ? null : cell;
      sortDirection = next === "native" ? null : next;
      if (sortCell) {
        const indicator = document.createElement("span");
        indicator.setAttribute(core.DATA_ATTRIBUTE, "sort-indicator");
        indicator.textContent = next === "asc" ? " ↑" : " ↓";
        sortCell.appendChild(indicator);
      }
    } catch {
      resetSort(document.querySelector(TABLE_SELECTOR));
    }
  }

  const FILTER_ROW_SELECTOR = `tr[${core.DATA_ATTRIBUTE}="filter-row"]`;
  const FILTER_INPUT_SELECTOR = `[${core.DATA_ATTRIBUTE}="filter-input"]`;
  const filterSelections = new WeakMap();
  let openPanel = null;

  function handleFilterInput() {
    try {
      const table = document.querySelector(TABLE_SELECTOR);
      const row = table?.querySelector(FILTER_ROW_SELECTOR);
      if (!table || !row) {
        return;
      }
      const queries = Array.from(row.cells, (cell) => {
        const query = core.parseFilterQuery(cell.querySelector(FILTER_INPUT_SELECTOR)?.value);
        const selected = filterSelections.get(cell);
        if (selected?.size) {
          return { ...(query ?? {}), anyOf: Array.from(selected) };
        }
        return query;
      });
      core.applyFilters(table, queries);
    } catch {}
  }

  function closeFilterPanel() {
    openPanel?.panel.remove();
    if (openPanel) {
      document.removeEventListener("mousedown", openPanel.onOutside, true);
    }
    openPanel = null;
  }

  function updateFilterToggleState(cell) {
    const active = (filterSelections.get(cell)?.size ?? 0) > 0;
    cell.querySelector(`[${core.DATA_ATTRIBUTE}="filter-toggle"]`)?.classList
      .toggle("suitemate-v3-so-columns-filter-active", active);
  }

  function toggleFilterPanel(cell) {
    if (openPanel?.cell === cell) {
      closeFilterPanel();
      return;
    }
    closeFilterPanel();
    const table = document.querySelector(TABLE_SELECTOR);
    const values = core.distinctColumnValues(table, cell.cellIndex, 50);
    if (!values.length) {
      return;
    }
    const panel = document.createElement("div");
    panel.setAttribute(core.DATA_ATTRIBUTE, "filter-panel");
    const selected = filterSelections.get(cell) ?? new Set();
    for (const value of values) {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = selected.has(value);
      box.addEventListener("change", () => {
        const current = filterSelections.get(cell) ?? new Set();
        if (box.checked) {
          current.add(value);
        } else {
          current.delete(value);
        }
        filterSelections.set(cell, current);
        updateFilterToggleState(cell);
        handleFilterInput();
      });
      label.append(box, document.createTextNode(` ${value}`));
      panel.appendChild(label);
    }
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Clear";
    clear.className = core.CLASSES.button;
    clear.setAttribute(core.DATA_ATTRIBUTE, "filter-panel-clear");
    clear.addEventListener("click", () => {
      filterSelections.set(cell, new Set());
      updateFilterToggleState(cell);
      closeFilterPanel();
      handleFilterInput();
    });
    panel.appendChild(clear);
    cell.appendChild(panel);
    const onOutside = (event) => {
      if (!cell.contains(event.target)) {
        closeFilterPanel();
      }
    };
    document.addEventListener("mousedown", onOutside, true);
    openPanel = { cell, panel, onOutside };
  }

  function removeFilters(table) {
    closeFilterPanel();
    table?.querySelectorAll?.(`.${core.CLASSES.filtered}`)?.forEach((row) => row.classList.remove(core.CLASSES.filtered));
    table?.querySelector?.(FILTER_ROW_SELECTOR)?.remove();
  }

  function buildFilterRow(table) {
    const headerRow = table.querySelector(core.HEADER_ROW_SELECTOR);
    if (!headerRow) {
      return;
    }
    const row = document.createElement("tr");
    row.setAttribute(core.DATA_ATTRIBUTE, "filter-row");
    headerCells(table).forEach((cell, index) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "search";
      input.placeholder = "Filter";
      input.setAttribute(core.DATA_ATTRIBUTE, "filter-input");
      const values = core.distinctColumnValues(table, index, 20);
      if (values.length) {
        const list = document.createElement("datalist");
        list.id = `suitemate-v3-so-columns-list-${index}`;
        for (const value of values) {
          const option = document.createElement("option");
          option.value = value;
          list.appendChild(option);
        }
        input.setAttribute("list", list.id);
        td.appendChild(list);
      }
      td.appendChild(input);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = "▾";
      toggle.title = "Select values";
      toggle.setAttribute(core.DATA_ATTRIBUTE, "filter-toggle");
      toggle.addEventListener("click", () => toggleFilterPanel(td));
      td.appendChild(toggle);
      row.appendChild(td);
    });
    row.addEventListener("input", handleFilterInput);
    headerRow.parentNode.insertBefore(row, headerRow.nextSibling);
  }

  function handleFilterClick() {
    try {
      const table = document.querySelector(TABLE_SELECTOR);
      if (!table) {
        return;
      }
      if (table.querySelector(FILTER_ROW_SELECTOR)) {
        removeFilters(table);
      } else {
        buildFilterRow(table);
      }
    } catch {}
  }

  async function saveOrder(labels, message) {
    try {
      if (!scopeKey) {
        return;
      }
      const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
      const next = core.withOrder(stored[core.STORAGE_KEY], scopeKey, labels);
      if (!next) {
        showToast("Column order could not be saved.", "warning");
        return;
      }
      await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
      showToast(message, "success");
    } catch {
      showToast("Column order could not be saved.", "warning");
    }
  }

  function handleDragStart(event) {
    try {
      const cell = headerCellFromEvent(event);
      const label = cell ? cellLabel(cell) : "";
      if (!cell || !isMovable(core.readHeaderLabels(activeTable), label)) {
        event.preventDefault();
        return;
      }
      dragCell = cell;
      dragLabel = label;
      cell.classList.add(core.CLASSES.dragging);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", label);
      }
    } catch {
      clearDragState();
    }
  }

  function handleDragOver(event) {
    try {
      const cell = dragLabel ? headerCellFromEvent(event) : null;
      if (
        !cell
        || cell === dragCell
        || !isMovable(core.readHeaderLabels(activeTable), cellLabel(cell))
      ) {
        setDropTarget(null);
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      setDropTarget(cell);
    } catch {
      setDropTarget(null);
    }
  }

  function handleDragLeave(event) {
    if (!activeTable?.contains?.(event.relatedTarget)) {
      setDropTarget(null);
    }
  }

  function handleDrop(event) {
    try {
      event.preventDefault();
      const table = activeTable;
      const targetCell = dropCell;
      const sourceLabel = dragLabel;
      clearDragState();
      if (!table || !targetCell || !sourceLabel) {
        return;
      }
      const next = moveLabel(core.readHeaderLabels(table), sourceLabel, cellLabel(targetCell));
      if (next && core.applyOrder(table, next)) {
        saveOrder(next, "Column order saved.");
      }
    } catch {
      clearDragState();
    }
  }

  function handleDragEnd() {
    clearDragState();
  }

  function enterPersonalize(table) {
    if (personalizing || !table) {
      return;
    }
    const labels = core.readHeaderLabels(table);
    if (labels.length < 2) {
      return;
    }
    personalizing = true;
    activeTable = table;
    table.classList.add(core.CLASSES.personalizing);
    for (const cell of headerCells(table)) {
      if (isMovable(labels, cellLabel(cell))) {
        cell.draggable = true;
      }
    }
    table.addEventListener("dragstart", handleDragStart);
    table.addEventListener("dragover", handleDragOver);
    table.addEventListener("dragleave", handleDragLeave);
    table.addEventListener("drop", handleDrop);
    table.addEventListener("dragend", handleDragEnd);
  }

  function exitPersonalize() {
    const table = activeTable;
    clearDragState();
    personalizing = false;
    activeTable = null;
    if (!table) {
      return;
    }
    table.removeEventListener("dragstart", handleDragStart);
    table.removeEventListener("dragover", handleDragOver);
    table.removeEventListener("dragleave", handleDragLeave);
    table.removeEventListener("drop", handleDrop);
    table.removeEventListener("dragend", handleDragEnd);
    table.classList.remove(core.CLASSES.personalizing);
    for (const cell of headerCells(table)) {
      cell.removeAttribute("draggable");
      cell.classList.remove(core.CLASSES.dragging, core.CLASSES.dropTarget);
    }
  }

  function updateControls() {
    if (!controlButtons) {
      return;
    }
    controlButtons.personalize.hidden = personalizing;
    controlButtons.done.hidden = !personalizing;
    controlButtons.reset.hidden = !personalizing;
  }

  function handlePersonalizeClick() {
    try {
      enterPersonalize(document.querySelector(TABLE_SELECTOR));
    } catch {
      exitPersonalize();
    }
    updateControls();
  }

  function handleDoneClick() {
    try {
      exitPersonalize();
    } catch {}
    updateControls();
  }

  function handleResetClick() {
    try {
      const table = document.querySelector(TABLE_SELECTOR);
      if (table && nativeLabels) {
        core.applyOrder(table, nativeLabels);
      }
      resetSort(table);
      removeFilters(table);
      saveOrder(null, "Column order reset.");
      exitPersonalize();
    } catch {}
    updateControls();
  }

  function createButton(label, action, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = core.CLASSES.button;
    button.setAttribute(core.DATA_ATTRIBUTE, action);
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function ensureControls(table) {
    if (controlButtons?.controls.isConnected) {
      return;
    }
    document.querySelectorAll(OWNED_SELECTOR).forEach((node) => node.remove());
    const controls = document.createElement("div");
    controls.className = core.CLASSES.controls;
    controls.setAttribute(core.DATA_ATTRIBUTE, "controls");
    const personalize = createButton("Personalize", "personalize", handlePersonalizeClick);
    const filter = createButton("Filter", "filter", handleFilterClick);
    const done = createButton("Done", "done", handleDoneClick);
    const reset = createButton("Reset", "reset", handleResetClick);
    controls.append(personalize, filter, done, reset);
    controlButtons = { controls, personalize, filter, done, reset };
    (table.closest(CONTAINER_SELECTOR) ?? table).before(controls);
    updateControls();
  }

  async function installSoColumns({ signal, isCurrent }) {
    try {
      if (signal.aborted || !isCurrent()) {
        return false;
      }
      await lifecycleApi.whenDomReady();
      if (signal.aborted || !isCurrent()) {
        return false;
      }
      const table = document.querySelector(TABLE_SELECTOR);
      const labels = core.readHeaderLabels(table);
      if (!table || labels.length < 2) {
        return false;
      }
      if (personalizing && activeTable && !activeTable.isConnected) {
        exitPersonalize();
        updateControls();
      }
      nativeLabels = core.captureNativeOrder(table);
      scopeKey = resolveScopeKey();
      ensureControls(table);
      if (!table.hasAttribute(core.SORTABLE_ATTRIBUTE)) {
        table.setAttribute(core.SORTABLE_ATTRIBUTE, "");
        table.addEventListener("click", handleSortClick);
      }
      const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
      if (signal.aborted || !isCurrent() || !table.isConnected) {
        return false;
      }
      const saved = core.normalizeStored(stored[core.STORAGE_KEY]).orders[scopeKey];
      if (saved) {
        core.applyOrder(table, core.planOrder(core.readHeaderLabels(table), saved));
      }
      return !signal.aborted && isCurrent();
    } catch {
      return false;
    }
  }

  function removeSoColumns() {
    try {
      exitPersonalize();
      const table = document.querySelector(TABLE_SELECTOR);
      resetSort(table);
      removeFilters(table);
      if (table?.hasAttribute?.(core.SORTABLE_ATTRIBUTE)) {
        table.removeAttribute(core.SORTABLE_ATTRIBUTE);
        table.removeEventListener("click", handleSortClick);
      }
      if (table && nativeLabels) {
        core.applyOrder(table, nativeLabels);
      }
    } catch {}
    document.querySelectorAll(OWNED_SELECTOR).forEach((node) => node.remove());
    controlButtons = null;
    nativeLabels = null;
    scopeKey = null;
  }

  function nodeContainsRelevantTable(node) {
    if (node?.nodeType !== 1 || node.matches?.(OWNED_SELECTOR) || node.closest?.(OWNED_SELECTOR)) {
      return false;
    }
    return node.matches?.(RELEVANT_SELECTOR) || Boolean(node.querySelector?.(RELEVANT_SELECTOR));
  }

  function containsRelevantMutation(records) {
    return records.some((record) => [...record.addedNodes].some(nodeContainsRelevantTable));
  }

  const lifecycleHandle = lifecycleApi.register({
    id: "record.so-columns",
    replace: true,
    capability: routeApi.CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION,
    startPaused: true,
    observe: {
      childList: true,
      subtree: true
    },
    relevant: containsRelevantMutation,
    evaluate: installSoColumns,
    cleanup: removeSoColumns
  });

  function applySettings(value, reason) {
    const settings = settingsApi.normalize(value);
    if (settings.salesOrderColumns) {
      lifecycleHandle.resume(reason);
    } else {
      lifecycleHandle.pause(reason);
      removeSoColumns();
    }
  }

  async function start() {
    const revision = settingsRevision;
    try {
      const settings = await settingsApi.get();
      if (revision === settingsRevision) {
        applySettings(settings, "settings-loaded");
      }
    } catch {
      if (revision === settingsRevision) {
        lifecycleHandle.pause("settings-failed");
        removeSoColumns();
      }
    }
  }

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    const change = changes[settingsApi.STORAGE_KEY];
    if (areaName !== "sync" || !change) {
      return;
    }
    settingsRevision += 1;
    try {
      applySettings(change.newValue, "settings-changed");
    } catch {
      lifecycleHandle.pause("settings-invalid");
      removeSoColumns();
    }
  });

  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      lifecycleHandle.dispose("page-hidden");
    }
  });

  start();
})();
