(function initializeSuiteMateV3FormViews() {
  "use strict";

  const core = globalThis.SuiteMateV3FormViewsCore;
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
  if (!routeApi.supports(routeApi.CAPABILITIES.FORM_VIEWS, pageContext)) {
    return;
  }

  const GHOST_CLASS = "suitemate-v3-form-views-ghost-field";
  const COLLAPSIBLE_TITLE_SELECTOR = "td.fgroup_title.uir-field-group--collapsible[role=\"button\"]";
  const OWNED_SELECTOR = `[${core.DATA_ATTRIBUTE}]`;
  let settingsRevision = 0;
  let scopeKey = null;
  let personalizing = false;
  let hiddenFields = new Set();
  let controlButtons = null;
  let collapseListener = null;
  let replayingCollapse = false;
  let dragSection = null;   // { title: string }
  let dragField = null;     // { row, columnTable, groupTable, key }
  let dropNode = null;      // element currently carrying the drop-target class
  let justDropped = false;

  function showToast(message, type) {
    globalThis.SuiteMateV3Notifications?.showToast(message, { type });
  }

  // ===== Scope =====
  function resolveScopeKey() {
    try {
      const sessionScript = document.querySelector(
        'script[src^="/javascript/sessionstatus/session_status_init.jsp?"]'
      );
      if (sessionScript) {
        const params = new URL(sessionScript.src, location.origin).searchParams;
        const companyId = params.get("companyId");
        const userId = params.get("id")?.split("~")[1];
        if (companyId && userId) {
          return `${companyId}:${userId}:salesord`;
        }
      }
    } catch {}
    return `${location.hostname}:salesord`;
  }

  // ===== Field collection =====
  function fieldWrappers() {
    return [...document.querySelectorAll(core.FIELD_WRAPPER_SELECTOR)].filter((wrapper) =>
      core.fieldKey(wrapper)
      && !wrapper.closest(core.EXCLUDED_CONTAINER_SELECTOR)
      && !wrapper.closest(OWNED_SELECTOR));
  }

  function fieldLabelText(wrapper) {
    const label = wrapper.querySelector(".uir-label");
    const clone = label?.cloneNode?.(true);
    clone?.querySelectorAll?.(core.FOREIGN_NODE_SELECTOR)?.forEach((node) => node.remove());
    const text = String(clone?.textContent ?? "").replace(/\s+/g, " ").trim();
    return text || core.fieldKey(wrapper);
  }

  // ===== Visibility application =====
  function applyVisibility() {
    const wrappers = fieldWrappers();
    if (personalizing) {
      core.applyFieldVisibility(wrappers, new Set());
      for (const wrapper of wrappers) {
        wrapper.classList.toggle(GHOST_CLASS, hiddenFields.has(core.fieldKey(wrapper)));
      }
    } else {
      for (const wrapper of wrappers) {
        wrapper.classList.remove(GHOST_CLASS);
      }
      core.applyFieldVisibility(wrappers, hiddenFields);
    }
    renderChips();
  }

  // ===== Persistence =====
  let saveQueue = Promise.resolve();
  function enqueueSave(operation) {
    saveQueue = saveQueue.then(operation, operation);
    return saveQueue;
  }

  function saveHiddenFields() {
    return enqueueSave(async () => {
      try {
        if (!scopeKey) {
          return;
        }
        const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
        const next = core.withHiddenFields(stored[core.STORAGE_KEY], scopeKey, Array.from(hiddenFields));
        if (!next) {
          showToast("Hidden fields could not be saved.", "warning");
          return;
        }
        await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
      } catch {
        showToast("Hidden fields could not be saved.", "warning");
      }
    });
  }

  function sectionTitleKey(title) {
    return core.sectionTitleKey(title);
  }

  function pageSectionKeys() {
    return [...document.querySelectorAll(COLLAPSIBLE_TITLE_SELECTOR)]
      .map(sectionTitleKey)
      .filter(Boolean);
  }

  function collapsedSectionKeys() {
    return [...document.querySelectorAll(COLLAPSIBLE_TITLE_SELECTOR)]
      .filter((title) => title.getAttribute("aria-expanded") === "false")
      .map(sectionTitleKey)
      .filter(Boolean);
  }

  function saveCollapsedSections() {
    return enqueueSave(async () => {
      try {
        if (!scopeKey) {
          return;
        }
        const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
        // Merge, don't replace: Sales Order forms vary per record, so stored
        // sections that this page does not render must survive the write.
        const entry = core.normalizeStored(stored[core.STORAGE_KEY]).views[scopeKey];
        const onThisPage = new Set(pageSectionKeys());
        const offPage = (entry?.collapsedSections ?? []).filter((section) => !onThisPage.has(section));
        const next = core.withCollapsedSections(
          stored[core.STORAGE_KEY],
          scopeKey,
          [...offPage, ...collapsedSectionKeys()]
        );
        if (!next) {
          showToast("Collapsed sections could not be saved.", "warning");
          return;
        }
        await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
      } catch {
        showToast("Collapsed sections could not be saved.", "warning");
      }
    });
  }

  // ===== Layout order: apply stored, save deltas (merge-on-save) =====
  let savePending = 0;

  function applyStoredOrders(entry) {
    if (personalizing || savePending > 0 || !core.sectionTitlesUnique(document)) {
      // Never rewind a user's in-progress edits or race a queued save with a
      // stale storage read (review finding); duplicate titles disable reorder.
      return;
    }
    core.applySectionOrder(document, entry?.sectionOrder ?? null);
    for (const slot of core.sectionSlots(document)) {
      const title = core.sectionTitleKey(slot.title);
      core.applyFieldOrder(slot.groupTable, title ? entry?.fieldOrder?.[title] ?? null : null);
    }
  }

  function saveOrders() {
    savePending += 1;
    return enqueueSave(async () => {
      try {
        if (!scopeKey || !core.sectionTitlesUnique(document)) {
          return;
        }
        const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
        const entry = core.normalizeStored(stored[core.STORAGE_KEY]).views[scopeKey];
        // Merge, don't replace: order data for sections and fields this form
        // variant does not render keeps its stored position (review findings:
        // prepending hoisted other variants' sections; deleting a key on a
        // null delta destroyed layouts that only exist on other records).
        const slots = core.sectionSlots(document);
        const onPage = new Set(slots.map((slot) => core.sectionTitleKey(slot.title)).filter(Boolean));
        const sections = core.mergeOrderList(
          entry?.sectionOrder,
          onPage,
          core.sectionOrderDelta(document),
          core.MAX_SECTIONS
        );
        let next = core.withSectionOrder(stored[core.STORAGE_KEY], scopeKey, sections);
        const orders = { ...(entry?.fieldOrder ?? {}) };
        for (const slot of slots) {
          const title = core.sectionTitleKey(slot.title);
          if (!title) {
            continue;
          }
          const merged = core.mergeOrderList(
            orders[title],
            new Set(core.groupFieldKeys(slot.groupTable)),
            core.fieldOrderDelta(slot.groupTable),
            core.MAX_FIELD_NAMES
          );
          if (merged) {
            orders[title] = merged;
          } else {
            delete orders[title];
          }
        }
        next = next && core.withFieldOrder(next, scopeKey, Object.keys(orders).length ? orders : null);
        if (!next) {
          showToast("Form layout could not be saved.", "warning");
          return;
        }
        await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
      } catch {
        showToast("Form layout could not be saved.", "warning");
      } finally {
        savePending -= 1;
      }
    });
  }

  // ===== Section collapse: replay NetSuite's native collapsible =====
  function applyCollapsedSections(sections) {
    const wanted = new Set(sections ?? []);
    // The replay clicks dispatch through our own capture listener; the flag
    // keeps a load-time reapply from re-entering the save path (the review
    // caught this shrinking stored views on every page load).
    replayingCollapse = true;
    try {
      for (const title of document.querySelectorAll(COLLAPSIBLE_TITLE_SELECTOR)) {
        const key = sectionTitleKey(title);
        if (key && wanted.has(key) && title.getAttribute("aria-expanded") === "true") {
          try {
            title.click();
          } catch {}
        }
      }
    } finally {
      replayingCollapse = false;
    }
  }

  function watchCollapses() {
    if (collapseListener) {
      return;
    }
    collapseListener = (event) => {
      if (replayingCollapse || justDropped || !event.target?.closest?.(COLLAPSIBLE_TITLE_SELECTOR)) {
        return;
      }
      // NetSuite's own handler flips aria-expanded after this click; read the
      // settled state on the next macrotask.
      setTimeout(saveCollapsedSections, 0);
    };
    document.addEventListener("click", collapseListener, true);
  }

  // ===== Personalize Form mode =====
  function ensureAffordances() {
    for (const wrapper of fieldWrappers()) {
      const label = wrapper.querySelector(".uir-label") ?? wrapper;
      if (label.querySelector(`[${core.DATA_ATTRIBUTE}="hide-toggle"]`)) {
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "⊖";
      button.title = "Hide or show this field";
      button.setAttribute(core.DATA_ATTRIBUTE, "hide-toggle");
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const key = core.fieldKey(wrapper);
        if (!key) {
          return;
        }
        if (hiddenFields.has(key)) {
          hiddenFields.delete(key);
        } else {
          hiddenFields.add(key);
        }
        applyVisibility();
        saveHiddenFields();
      });
      label.appendChild(button);
    }
  }

  function removeAffordances() {
    document.querySelectorAll(`[${core.DATA_ATTRIBUTE}="hide-toggle"]`).forEach((node) => node.remove());
  }

  // ===== Drag-and-drop reorder (sections now; fields fill their stubs) =====
  function reorderableSlots() {
    return core.sectionPartitions(document).filter((partition) => partition.length > 1).flat();
  }

  function ensureSectionGrips() {
    if (!core.sectionTitlesUnique(document)) {
      return; // ambiguous identity: no reorder affordances at all
    }
    for (const slot of reorderableSlots()) {
      const mount = slot.title.querySelector("div.fgroup_title");
      if (!mount || mount.querySelector(`[${core.DATA_ATTRIBUTE}="section-grip"]`)) {
        continue;
      }
      const grip = document.createElement("button");
      grip.type = "button";
      grip.textContent = "⠿";
      grip.title = "Drag to move this section";
      grip.draggable = true;
      grip.setAttribute(core.DATA_ATTRIBUTE, "section-grip");
      grip.addEventListener("click", (event) => {
        // The title TD is role=button on collapsible groups; a grip click
        // must not toggle collapse.
        event.preventDefault();
        event.stopPropagation();
      });
      grip.addEventListener("keydown", handleSectionKeydown);
      mount.prepend(grip);
    }
  }

  function removeSectionGrips() {
    document.querySelectorAll(`[${core.DATA_ATTRIBUTE}="section-grip"]`).forEach((node) => node.remove());
  }

  function setDropNode(node, side) {
    if (dropNode === node) {
      return;
    }
    dropNode?.classList.remove(core.CLASSES.dropTarget, core.CLASSES.dropTargetSide);
    dropNode = node;
    dropNode?.classList.add(side ? core.CLASSES.dropTargetSide : core.CLASSES.dropTarget);
  }

  function clearDragState() {
    document.querySelectorAll(`.${core.CLASSES.dragging}`).forEach((node) => node.classList.remove(core.CLASSES.dragging));
    dragSection = null;
    dragField = null;
    setDropNode(null, false);
  }

  function markJustDropped() {
    justDropped = true;
    setTimeout(() => {
      justDropped = false;
    }, 0);
  }

  function pageTitles() {
    return core.sectionSlots(document).map((slot) => core.sectionTitleKey(slot.title));
  }

  function slotFromEvent(event) {
    const slotTd = event.target?.closest?.(`td[${core.NATIVE_INDEX_ATTRIBUTE}]`);
    if (!slotTd || !dragSection) {
      return null;
    }
    const partition = core.sectionPartitions(document).find((slots) =>
      slots.some((slot) => core.sectionTitleKey(slot.title) === dragSection.title));
    const slot = partition?.find((candidate) => candidate.slotTd === slotTd);
    return slot && core.sectionTitleKey(slot.title) !== dragSection.title
      ? { slot, horizontal: slot.classKey.split(":")[1] !== "1" }
      : null;
  }

  function fieldRowOf(node) {
    const wrapper = node?.closest?.(core.FIELD_WRAPPER_SELECTOR);
    if (!wrapper || wrapper.closest(core.EXCLUDED_CONTAINER_SELECTOR) || wrapper.closest(OWNED_SELECTOR)) {
      return null;
    }
    const row = wrapper.closest("tr.uir-field-wrapper-cell");
    const columnTable = row?.closest?.("table.table_fields");
    const groupTable = columnTable?.closest?.(`table[${core.NATIVE_INDEX_ATTRIBUTE}]`);
    const key = row ? core.fieldKey(row.querySelector(core.FIELD_WRAPPER_SELECTOR)) : "";
    return row && columnTable && groupTable && key ? { row, columnTable, groupTable, key } : null;
  }

  function columnKeysOf(columnTable) {
    return [...columnTable.querySelectorAll(":scope > tbody > tr.uir-field-wrapper-cell")]
      .map((row) => core.fieldKey(row.querySelector(core.FIELD_WRAPPER_SELECTOR)));
  }

  function groupKeysWith(groupTable, columnTable, columnKeys) {
    const keys = [];
    for (const column of groupTable.querySelectorAll(":scope > tbody > tr.uir-fieldgroup-content > td > table.table_fields")) {
      keys.push(...(column === columnTable ? columnKeys : columnKeysOf(column)));
    }
    return keys;
  }

  function handleFieldDragStart(event) {
    const source = fieldRowOf(event.target);
    if (!source) {
      return;
    }
    dragField = source;
    source.row.classList.add(core.CLASSES.dragging);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", source.key);
    }
  }

  function handleFieldDragOver(event) {
    if (!dragField) {
      return;
    }
    const target = fieldRowOf(event.target);
    if (!target || target.columnTable !== dragField.columnTable || target.row === dragField.row) {
      setDropNode(null, false);
      return; // other columns and groups never preventDefault -> OS no-drop cursor
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    setDropNode(target.row, false);
  }

  function handleFieldDrop(event) {
    if (!dragField || !dropNode) {
      clearDragState();
      return;
    }
    event.preventDefault();
    const targetKey = core.fieldKey(dropNode.querySelector?.(core.FIELD_WRAPPER_SELECTOR));
    const { columnTable, groupTable, key } = dragField;
    clearDragState();
    const nextColumn = core.moveLabel(columnKeysOf(columnTable), key, targetKey);
    if (nextColumn && core.applyFieldOrder(groupTable, groupKeysWith(groupTable, columnTable, nextColumn))) {
      markJustDropped();
      saveOrders();
    }
  }

  function handleFieldKeydown(event) {
    if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }
    const source = fieldRowOf(event.target);
    if (!source) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const keys = columnKeysOf(source.columnTable);
    const index = keys.indexOf(source.key) + (event.key === "ArrowDown" ? 1 : -1);
    if (index < 0 || index >= keys.length) {
      return;
    }
    const nextColumn = core.moveLabel(keys, source.key, keys[index]);
    if (nextColumn && core.applyFieldOrder(source.groupTable, groupKeysWith(source.groupTable, source.columnTable, nextColumn))) {
      markJustDropped();
      saveOrders();
      const wrapper = source.row.querySelector(core.FIELD_WRAPPER_SELECTOR);
      wrapper?.focus?.(); // the row move blurred it
    }
  }

  function ensureFieldDragSources() {
    if (!core.sectionTitlesUnique(document)) {
      return; // fieldOrder is keyed by section title; ambiguity disables it too
    }
    for (const wrapper of fieldWrappers()) {
      wrapper.draggable = true;
      wrapper.tabIndex = 0;
      wrapper.addEventListener("keydown", handleFieldKeydown);
      for (const anchor of wrapper.querySelectorAll("a")) {
        anchor.setAttribute("draggable", "false"); // link fields must not hijack the drag
      }
    }
  }

  function removeFieldDragSources() {
    for (const wrapper of document.querySelectorAll(core.FIELD_WRAPPER_SELECTOR)) {
      wrapper.removeAttribute("draggable");
      wrapper.removeAttribute("tabindex");
      wrapper.removeEventListener("keydown", handleFieldKeydown);
      for (const anchor of wrapper.querySelectorAll("a")) {
        anchor.removeAttribute("draggable");
      }
    }
  }

  function handleDragStart(event) {
    try {
      justDropped = false;
      const grip = event.target?.closest?.(`[${core.DATA_ATTRIBUTE}="section-grip"]`);
      if (grip) {
        const title = grip.closest("td.fgroup_title");
        const key = title ? core.sectionTitleKey(title) : "";
        if (!key) {
          event.preventDefault();
          return;
        }
        event.stopPropagation();
        dragSection = { title: key };
        title.closest("table")?.classList.add(core.CLASSES.dragging);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", key);
          const bar = title.querySelector("div.fgroup_title");
          if (bar && event.dataTransfer.setDragImage) {
            event.dataTransfer.setDragImage(bar, 12, 12);
          }
        }
        return;
      }
      handleFieldDragStart(event);
    } catch {
      clearDragState();
    }
  }

  function handleDragOver(event) {
    try {
      if (dragSection) {
        const target = slotFromEvent(event);
        if (!target) {
          setDropNode(null, false);
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        setDropNode(target.slot.groupTable, target.horizontal);
        return;
      }
      handleFieldDragOver(event);
    } catch {
      setDropNode(null, false);
    }
  }

  function handleDragLeave(event) {
    if (!event.relatedTarget) {
      setDropNode(null, false);
    }
  }

  function handleDrop(event) {
    try {
      if (dragSection && dropNode) {
        event.preventDefault();
        const targetTitle = core.sectionTitleKey(dropNode.querySelector("td.fgroup_title"));
        const next = core.moveLabel(pageTitles(), dragSection.title, targetTitle);
        clearDragState();
        if (next && core.applySectionOrder(document, next)) {
          markJustDropped();
          saveOrders();
        }
        return;
      }
      handleFieldDrop(event);
    } catch {
      clearDragState();
    }
  }

  function handleDragEnd() {
    clearDragState();
  }

  function handleSectionKeydown(event) {
    if (!event.altKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      return;
    }
    const title = event.target.closest("td.fgroup_title");
    const key = title ? core.sectionTitleKey(title) : "";
    const partition = core.sectionPartitions(document).find((slots) =>
      slots.some((slot) => core.sectionTitleKey(slot.title) === key));
    if (!key || !partition || partition.length < 2) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const titles = partition.map((slot) => core.sectionTitleKey(slot.title));
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const index = titles.indexOf(key) + (forward ? 1 : -1);
    if (index < 0 || index >= titles.length) {
      return;
    }
    const next = core.moveLabel(pageTitles(), key, titles[index]);
    if (next && core.applySectionOrder(document, next)) {
      markJustDropped();
      saveOrders();
      document.querySelectorAll(`[${core.DATA_ATTRIBUTE}="section-grip"]`).forEach((grip) => {
        if (core.sectionTitleKey(grip.closest("td.fgroup_title")) === key) {
          grip.focus(); // the appendChild move blurred it
        }
      });
    }
  }

  const DRAG_LISTENERS = [
    ["dragstart", handleDragStart],
    ["dragover", handleDragOver],
    ["dragleave", handleDragLeave],
    ["drop", handleDrop],
    ["dragend", handleDragEnd]
  ];

  function renderChips() {
    const wrap = controlButtons?.chips;
    if (!wrap) {
      return;
    }
    wrap.textContent = "";
    const labels = new Map();
    for (const wrapper of fieldWrappers()) {
      const key = core.fieldKey(wrapper);
      if (hiddenFields.has(key) && !labels.has(key)) {
        labels.set(key, fieldLabelText(wrapper));
      }
    }
    for (const key of Array.from(hiddenFields).sort()) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.setAttribute(core.DATA_ATTRIBUTE, "hidden-chip");
      chip.title = "Show this field again";
      chip.textContent = `${labels.get(key) ?? key} ✕`;
      chip.addEventListener("click", () => {
        hiddenFields.delete(key);
        applyVisibility();
        saveHiddenFields();
      });
      wrap.appendChild(chip);
    }
    wrap.hidden = !personalizing || hiddenFields.size === 0;
  }

  function updateControls() {
    if (!controlButtons) {
      return;
    }
    controlButtons.personalize.hidden = personalizing;
    controlButtons.hint.hidden = !personalizing;
    controlButtons.done.hidden = !personalizing;
    controlButtons.reset.hidden = !personalizing;
    controlButtons.controls.classList.toggle("suitemate-v3-form-views-mode-active", personalizing);
    renderChips();
  }

  function enterPersonalize() {
    if (personalizing) {
      return;
    }
    personalizing = true;
    document.body.classList.add(core.CLASSES.personalizing);
    ensureAffordances();
    ensureSectionGrips();
    ensureFieldDragSources();
    for (const [type, listener] of DRAG_LISTENERS) {
      document.addEventListener(type, listener);
    }
    applyVisibility();
    updateControls();
  }

  function exitPersonalize() {
    personalizing = false;
    document.body.classList.remove(core.CLASSES.personalizing);
    clearDragState();
    for (const [type, listener] of DRAG_LISTENERS) {
      document.removeEventListener(type, listener);
    }
    removeSectionGrips();
    removeFieldDragSources();
    removeAffordances();
    applyVisibility();
    updateControls();
  }

  function handleReset() {
    try {
      hiddenFields = new Set();
      applyVisibility();
      for (const title of document.querySelectorAll(COLLAPSIBLE_TITLE_SELECTOR)) {
        if (title.getAttribute("aria-expanded") === "false") {
          try {
            title.click();
          } catch {}
        }
      }
      core.applySectionOrder(document, null);
      for (const slot of core.sectionSlots(document)) {
        core.applyFieldOrder(slot.groupTable, null);
      }
      savePending += 1;
      enqueueSave(async () => {
        try {
          if (!scopeKey) {
            return;
          }
          const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
          const afterFields = core.withHiddenFields(stored[core.STORAGE_KEY], scopeKey, null);
          const afterSections = afterFields && core.withCollapsedSections(afterFields, scopeKey, null);
          const afterOrder = afterSections && core.withSectionOrder(afterSections, scopeKey, null);
          const next = afterOrder && core.withFieldOrder(afterOrder, scopeKey, null);
          if (!next) {
            showToast("Form view could not be reset.", "warning");
            return;
          }
          await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
          showToast("Form view reset.", "success");
        } catch {
          showToast("Form view could not be reset.", "warning");
        } finally {
          savePending -= 1;
        }
      });
      exitPersonalize();
    } catch {}
    updateControls();
  }

  function createButton(label, action, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suitemate-v3-form-views-button";
    button.setAttribute(core.DATA_ATTRIBUTE, action);
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function ensureControls() {
    if (controlButtons?.controls.isConnected) {
      return;
    }
    document.querySelectorAll(OWNED_SELECTOR).forEach((node) => node.remove());
    const mainForm = document.querySelector("#main_form");
    if (!mainForm) {
      return;
    }
    const controls = document.createElement("div");
    controls.className = "suitemate-v3-form-views-controls";
    controls.setAttribute(core.DATA_ATTRIBUTE, "controls");
    const personalize = createButton("Personalize Form", "personalize", () => {
      try {
        enterPersonalize();
      } catch {
        exitPersonalize();
      }
      updateControls();
    });
    const hint = document.createElement("span");
    hint.setAttribute(core.DATA_ATTRIBUTE, "mode-hint");
    hint.textContent = "Personalizing — drag fields or section titles to reorder, ⊖ to hide. Click Done to finish.";
    hint.hidden = true;
    const done = createButton("Done", "done", () => {
      exitPersonalize();
      updateControls();
    });
    const reset = createButton("Reset", "reset", handleReset);
    const chips = document.createElement("span");
    chips.setAttribute(core.DATA_ATTRIBUTE, "hidden-chips");
    chips.hidden = true;
    // Actions before the unbounded chip list (Milestone 22 lesson).
    controls.append(personalize, hint, done, reset, chips);
    controlButtons = { controls, personalize, hint, done, reset, chips };
    mainForm.before(controls);
    updateControls();
  }

  // ===== Lifecycle =====
  async function installFormViews({ signal, isCurrent }) {
    try {
      if (signal.aborted || !isCurrent()) {
        return false;
      }
      await lifecycleApi.whenDomReady();
      if (signal.aborted || !isCurrent()) {
        return false;
      }
      if (!fieldWrappers().length) {
        return false;
      }
      scopeKey = resolveScopeKey();
      ensureControls();
      watchCollapses();
      const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
      if (signal.aborted || !isCurrent()) {
        return false;
      }
      const entry = core.normalizeStored(stored[core.STORAGE_KEY]).views[scopeKey];
      hiddenFields = new Set(entry?.hiddenFields ?? []);
      applyStoredOrders(entry);
      applyVisibility();
      applyCollapsedSections(entry?.collapsedSections);
      return !signal.aborted && isCurrent();
    } catch {
      return false;
    }
  }

  function removeFormViews() {
    try {
      exitPersonalize();
      core.applySectionOrder(document, null);
      for (const slot of core.sectionSlots(document)) {
        core.applyFieldOrder(slot.groupTable, null);
      }
      document.querySelectorAll(`[${core.NATIVE_INDEX_ATTRIBUTE}]`).forEach((node) =>
        node.removeAttribute(core.NATIVE_INDEX_ATTRIBUTE));
      for (const wrapper of document.querySelectorAll(`.${core.CLASSES.hiddenField}, .${GHOST_CLASS}`)) {
        wrapper.classList.remove(core.CLASSES.hiddenField, GHOST_CLASS);
      }
      if (collapseListener) {
        document.removeEventListener("click", collapseListener, true);
        collapseListener = null;
      }
    } catch {}
    document.querySelectorAll(OWNED_SELECTOR).forEach((node) => node.remove());
    controlButtons = null;
    hiddenFields = new Set();
    scopeKey = null;
  }

  function containsRelevantMutation(records) {
    return records.some((record) => [...record.addedNodes].some(core.nodeRelevant));
  }

  const lifecycleHandle = lifecycleApi.register({
    id: "record.form-views",
    replace: true,
    capability: routeApi.CAPABILITIES.FORM_VIEWS,
    startPaused: true,
    observe: {
      childList: true,
      subtree: true
    },
    relevant: containsRelevantMutation,
    evaluate: installFormViews,
    cleanup: removeFormViews
  });

  function applySettings(value, reason) {
    const settings = settingsApi.normalize(value);
    if (settings.formViews) {
      lifecycleHandle.resume(reason);
    } else {
      lifecycleHandle.pause(reason);
      removeFormViews();
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
        removeFormViews();
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
      removeFormViews();
    }
  });

  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      lifecycleHandle.dispose("page-hidden");
    }
  });

  start();
})();
