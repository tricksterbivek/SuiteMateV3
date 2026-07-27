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

  const columnFilters = new WeakMap();
  let openMenu = null;

  function filterState(cell) {
    let state = columnFilters.get(cell);
    if (!state) {
      state = { queryText: "", selected: new Set(), textAsRowFilter: false };
      columnFilters.set(cell, state);
    }
    return state;
  }

  function columnQuery(state) {
    if (!state) {
      return null;
    }
    const parsed = core.parseFilterQuery(state.queryText);
    const operator = parsed && parsed.op !== "contains" ? parsed : null;
    // Plain text narrows the value list (Excel semantics); it only becomes a
    // contains row-filter on columns with too many values for a checkbox list.
    const contains = state.textAsRowFilter && parsed?.op === "contains" ? parsed : null;
    const anyOf = state.selected.size ? Array.from(state.selected) : null;
    if (!operator && !contains && !anyOf) {
      return null;
    }
    return { ...(operator ?? contains ?? {}), ...(anyOf ? { anyOf } : {}) };
  }

  function updateArrowState(cell) {
    cell.querySelector(`[${core.DATA_ATTRIBUTE}="menu-toggle"]`)?.classList
      .toggle("suitemate-v3-so-columns-filter-active", Boolean(columnQuery(columnFilters.get(cell))));
  }

  function applyColumnFilters(table) {
    core.applyFilters(table, headerCells(table).map((cell) => columnQuery(columnFilters.get(cell))));
    for (const cell of headerCells(table)) {
      updateArrowState(cell);
    }
    updateMenuStatus();
  }

  function unhideAllRows(table) {
    table?.querySelectorAll?.(`.${core.CLASSES.filtered}`)?.forEach((row) => row.classList.remove(core.CLASSES.filtered));
  }

  function closeColumnMenu() {
    openMenu?.menu.remove();
    if (openMenu) {
      document.removeEventListener("mousedown", openMenu.onOutside, true);
      document.removeEventListener("keydown", openMenu.onKey, true);
      document.removeEventListener("scroll", openMenu.onScroll, true);
    }
    openMenu = null;
  }

  function clearAllFilters(table) {
    closeColumnMenu();
    for (const cell of headerCells(table)) {
      columnFilters.delete(cell);
      updateArrowState(cell);
    }
    unhideAllRows(table);
  }

  function setSortDirection(table, cell, direction) {
    if (!core.sortRows(table, direction === "native" ? -1 : cell.cellIndex, direction)) {
      return;
    }
    clearSortIndicators();
    sortCell = direction === "native" ? null : cell;
    sortDirection = direction === "native" ? null : direction;
    if (sortCell) {
      const indicator = document.createElement("span");
      indicator.setAttribute(core.DATA_ATTRIBUTE, "sort-indicator");
      indicator.textContent = direction === "asc" ? " ↑" : " ↓";
      sortCell.insertBefore(indicator, sortCell.querySelector(`[${core.DATA_ATTRIBUTE}="menu-toggle"]`));
    }
  }

  function menuItem(glyph, label, onClick, active) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute(core.DATA_ATTRIBUTE, "menu-item");
    if (active) {
      button.classList.add("suitemate-v3-so-columns-menu-item-active");
    }
    const icon = document.createElement("span");
    icon.setAttribute(core.DATA_ATTRIBUTE, "menu-item-icon");
    icon.textContent = glyph;
    const text = document.createElement("span");
    text.textContent = label;
    button.append(icon, text);
    button.addEventListener("click", onClick);
    return button;
  }

  function menuEyebrow(text) {
    const label = document.createElement("div");
    label.setAttribute(core.DATA_ATTRIBUTE, "menu-eyebrow");
    label.textContent = text;
    return label;
  }

  function updateMenuStatus() {
    if (!openMenu?.status) {
      return;
    }
    const table = document.querySelector(TABLE_SELECTOR);
    const rows = table ? Array.from(table.querySelectorAll("tr.uir-machine-row")) : [];
    const shown = rows.filter((row) => !row.classList.contains(core.CLASSES.filtered)).length;
    openMenu.status.textContent = shown === rows.length
      ? `${rows.length} items`
      : `${shown} of ${rows.length} items`;
  }

  function openColumnMenu(cell) {
    closeColumnMenu();
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) {
      return;
    }
    const state = filterState(cell);
    const menu = document.createElement("div");
    menu.setAttribute(core.DATA_ATTRIBUTE, "column-menu");

    menu.appendChild(menuEyebrow("Sort"));
    const sortedHere = sortCell === cell;
    menu.appendChild(menuItem("↑", "Sort A to Z", () => { setSortDirection(table, cell, "asc"); closeColumnMenu(); }, sortedHere && sortDirection === "asc"));
    menu.appendChild(menuItem("↓", "Sort Z to A", () => { setSortDirection(table, cell, "desc"); closeColumnMenu(); }, sortedHere && sortDirection === "desc"));
    if (sortedHere) {
      menu.appendChild(menuItem("✕", "Clear sort", () => { setSortDirection(table, cell, "native"); closeColumnMenu(); }));
    }

    menu.appendChild(menuEyebrow("Filter"));
    const values = core.distinctColumnValues(table, cell.cellIndex, 200);
    state.textAsRowFilter = !values.length;

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = values.length ? "Search values" : "Type to filter";
    search.value = state.queryText;
    search.setAttribute(core.DATA_ATTRIBUTE, "menu-search");
    menu.appendChild(search);

    const hint = document.createElement("div");
    hint.setAttribute(core.DATA_ATTRIBUTE, "menu-hint");
    hint.textContent = "Use > < = for numbers";
    menu.appendChild(hint);

    const optionRows = [];
    if (values.length) {
      const list = document.createElement("div");
      list.setAttribute(core.DATA_ATTRIBUTE, "menu-values");
      for (const value of values) {
        const label = document.createElement("label");
        label.title = value;
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = state.selected.has(value);
        box.addEventListener("change", () => {
          if (box.checked) {
            state.selected.add(value);
          } else {
            state.selected.delete(value);
          }
          applyColumnFilters(table);
        });
        const text = document.createElement("span");
        text.textContent = value;
        label.append(box, text);
        optionRows.push({ label, box, value });
        list.appendChild(label);
      }
      menu.appendChild(list);
    } else {
      const note = document.createElement("div");
      note.setAttribute(core.DATA_ATTRIBUTE, "menu-note");
      note.textContent = "Too many values to list — text filters as you type.";
      menu.appendChild(note);
    }

    const narrow = () => {
      const parsed = core.parseFilterQuery(search.value);
      const needle = parsed?.op === "contains" ? parsed.value : "";
      for (const option of optionRows) {
        option.label.hidden = Boolean(needle) && !option.value.toLowerCase().includes(needle);
      }
    };
    search.addEventListener("input", () => {
      state.queryText = search.value;
      narrow();
      applyColumnFilters(table);
    });
    narrow();

    const footer = document.createElement("div");
    footer.setAttribute(core.DATA_ATTRIBUTE, "menu-actions");
    const status = document.createElement("span");
    status.setAttribute(core.DATA_ATTRIBUTE, "menu-status");
    footer.appendChild(status);
    if (values.length) {
      footer.appendChild(menuItem("☑", "Select all", () => {
        for (const option of optionRows) {
          if (!option.label.hidden) {
            state.selected.add(option.value);
            option.box.checked = true;
          }
        }
        applyColumnFilters(table);
      }));
    }
    footer.appendChild(menuItem("✕", "Clear filter", () => {
      state.selected.clear();
      state.queryText = "";
      search.value = "";
      for (const option of optionRows) {
        option.box.checked = false;
      }
      narrow();
      applyColumnFilters(table);
    }));
    menu.appendChild(footer);

    // Body-appended and fixed-positioned: escapes the machine table's paint
    // order and the scroll container's clipping.
    document.body.appendChild(menu);
    const anchor = cell.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchor.left, (window.innerWidth || 1024) - (size.width || 224) - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 2, (window.innerHeight || 768) - (size.height || 320) - 8))}px`;
    const placed = menu.getBoundingClientRect();
    if (placed.right > (window.innerWidth || 1024) - 8) {
      menu.style.left = `${Math.max(8, (window.innerWidth || 1024) - placed.width - 8)}px`;
    }
    search.focus();
    const onOutside = (event) => {
      if (!cell.contains(event.target) && !menu.contains(event.target)) {
        closeColumnMenu();
      }
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        closeColumnMenu();
      }
    };
    const openedAt = Date.now();
    const onScroll = (event) => {
      // Grace period: ignore the trailing scroll events of a smooth scroll or
      // the focus() reveal so the menu doesn't self-close right after opening.
      if (Date.now() - openedAt < 350 || menu.contains(event.target)) {
        return;
      }
      closeColumnMenu();
    };
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onScroll, true);
    openMenu = { cell, menu, onOutside, onKey, onScroll, status };
    updateMenuStatus();
  }

  function toggleColumnMenu(cell) {
    if (personalizing) {
      return;
    }
    if (openMenu?.cell === cell) {
      closeColumnMenu();
      return;
    }
    openColumnMenu(cell);
  }

  function ensureHeaderMenus(table) {
    for (const cell of headerCells(table)) {
      if (!cell.querySelector(`[${core.DATA_ATTRIBUTE}="menu-toggle"]`)) {
        const arrow = document.createElement("button");
        arrow.type = "button";
        arrow.textContent = "▼";
        arrow.title = "Sort and filter";
        arrow.setAttribute(core.DATA_ATTRIBUTE, "menu-toggle");
        arrow.addEventListener("click", (event) => {
          event.stopPropagation();
          toggleColumnMenu(cell);
        });
        cell.appendChild(arrow);
      }
      updateArrowState(cell);
    }
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
      clearAllFilters(table);
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
    const done = createButton("Done", "done", handleDoneClick);
    const reset = createButton("Reset", "reset", handleResetClick);
    controls.append(personalize, done, reset);
    controlButtons = { controls, personalize, done, reset };
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
      }
      ensureHeaderMenus(table);
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
      closeColumnMenu();
      unhideAllRows(table);
      table?.removeAttribute?.(core.SORTABLE_ATTRIBUTE);
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
