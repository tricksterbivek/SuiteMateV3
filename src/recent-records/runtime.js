(function initializeSuiteMateV3RecentRecords() {
  "use strict";

  const core = globalThis.SuiteMateV3RecentRecordsCore;
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
    || !globalThis.chrome?.storage?.local
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
  if (!routeApi.supports(routeApi.CAPABILITIES.RECENT_RECORDS, pageContext)) {
    return;
  }

  const TRIGGER_SELECTOR = '[data-automation-id="recentRecords"]';
  const POPOVER_SELECTOR = 'div[data-widget="Popover"]';
  const RECENT_PATH = "/app/common/otherlists/recentrecords.nl";
  const PANEL_ATTRIBUTE = "data-suitemate-v3-recent-records";
  const INJECTED_ATTRIBUTE = "data-suitemate-v3-recent-records-injected";
  const BAILOUT_ATTRIBUTE = "data-suitemate-v3-recent-records-bailout";
  const CACHE_TTL_MS = 60_000;
  const MAX_RESPONSE_BYTES = 2_000_000;
  const ACTIVATION_THROTTLE_MS = 200;
  const HOVER_CLOSE_DELAY_MS = 200;
  const HOVER_RETAINED_CLASS = "suitemate-v3-rr-hover-retained";
  const FLOAT_CLASS = "suitemate-v3-rr-float";
  const GROUPS = Object.freeze(["Today", "Yesterday", "This week", "Older"]);
  const RECORD_ICONS = Object.freeze({
    employee: "person",
    customer: "person",
    vendor: "person",
    contact: "person",
    partner: "person",
    item: "item",
    transaction: "transaction",
    "custom-record-type": "table",
    "custom-record": "table",
    "custom-field": "gear",
    form: "form",
    role: "role",
    script: "script",
    workflow: "workflow",
    search: "search",
    crm: "crm",
    setup: "gear",
    file: "file",
    record: "file"
  });

  let enabled = false;
  let disposed = false;
  let store = core.normalizeStored(undefined, location.origin);
  let scopeKey = resolveScopeKey();
  let activationController = null;
  let fetchController = null;
  let activePanel = null;
  let waitSequence = 0;
  let storeWriteQueue = Promise.resolve();
  let settingsRevision = 0;
  let lastActivationAt = 0;
  let hoverCloseTimer = 0;
  let suppressActivationUntil = 0;
  const lastPointer = { x: 0, y: 0 };

  function resolveScopeKey() {
    let sessionId = "unknown";
    try {
      const script = document.querySelector(
        'script[src^="/javascript/sessionstatus/session_status_init.jsp?"]'
      );
      const value = script
        ? new URL(script.src, location.origin).searchParams.get("id")
        : "";
      if (value?.trim()) {
        sessionId = value.trim().slice(0, 300);
      }
    } catch {}
    return `${location.hostname.toLowerCase()}|${sessionId}`;
  }

  function getScope() {
    return store.scopes[scopeKey] ?? {
      updatedAt: 0,
      pinned: [],
      history: [],
      snapshot: { fetchedAt: 0, items: [] }
    };
  }

  function updateStore(mutator) {
    storeWriteQueue = storeWriteQueue
      .catch(() => undefined)
      .then(async () => {
        const stored = await chrome.storage.local.get(core.STORAGE_KEY);
        const current = core.normalizeStored(stored[core.STORAGE_KEY], location.origin);
        const next = core.normalizeStored(mutator(current), location.origin);
        await chrome.storage.local.set({ [core.STORAGE_KEY]: next });
        store = next;
        renderActivePanel();
        return next;
      });
    return storeWriteQueue;
  }

  function delay(milliseconds, signal) {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener?.("abort", abort);
        resolve(true);
      }, milliseconds);
      const abort = () => {
        clearTimeout(timer);
        resolve(false);
      };
      signal?.addEventListener?.("abort", abort, { once: true });
    });
  }

  function findRecentPopover() {
    for (const popover of document.querySelectorAll(POPOVER_SELECTOR)) {
      if (popover.querySelector(`a[href*="${RECENT_PATH}"]`)) {
        return popover;
      }
    }
    return null;
  }

  function isRelevantPopoverMutation(records) {
    return records.some((record) => [...record.addedNodes].some((node) =>
      node.nodeType === Node.ELEMENT_NODE
      && (node.matches?.(POPOVER_SELECTOR) || node.querySelector?.(POPOVER_SELECTOR))));
  }

  function clearHoverClose() {
    if (hoverCloseTimer) {
      clearTimeout(hoverCloseTimer);
      hoverCloseTimer = 0;
    }
  }

  function retainPopover(popover = activePanel?.popover) {
    clearHoverClose();
    if (!popover?.isConnected) {
      return;
    }
    popover.style.removeProperty("display");
    popover.classList.add(HOVER_RETAINED_CLASS);
  }

  function hidePopover(popover = activePanel?.popover) {
    clearHoverClose();
    if (!popover?.isConnected) {
      return;
    }
    if (popover.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    popover.classList.remove(HOVER_RETAINED_CLASS);
    popover.style.display = "none";
    if (popover.classList.contains(FLOAT_CLASS)) {
      popover.remove();
      if (activePanel?.popover === popover) {
        activePanel = null;
      }
    }
  }

  function bindHoverRegion(popover) {
    popover.addEventListener("mouseenter", () => retainPopover(popover));
    popover.addEventListener("mouseleave", (event) => {
      if (!isInsideActiveRegion(event.relatedTarget)) {
        schedulePopoverClose(popover);
      }
    });
    popover.addEventListener("focusin", () => retainPopover(popover));
    popover.addEventListener("focusout", (event) => {
      if (!isInsideActiveRegion(event.relatedTarget)) {
        schedulePopoverClose(popover);
      }
    });
  }

  // NetSuite unmounts its popover when the cursor clips a neighboring menu item
  // on the way in. The panel node survives detachment, so re-seat it in a
  // fixed-position holder anchored under the trigger and keep the same
  // retain/close lifecycle.
  function maybeRescuePanel() {
    const panel = activePanel?.panel;
    const trigger = document.querySelector(TRIGGER_SELECTOR);
    if (!panel || panel.isConnected || !trigger) {
      activePanel = null;
      return;
    }
    const anchor = trigger.getBoundingClientRect();
    const viewWidth = document.documentElement.clientWidth;
    const width = Math.min(412, viewWidth - 16);
    const left = Math.max(8, Math.min(anchor.left, viewWidth - width - 8));
    const headingIn = lastPointer.y >= anchor.bottom - 4
      && lastPointer.x >= left - 24
      && lastPointer.x <= left + width + 24;
    if (!headingIn) {
      activePanel = null;
      return;
    }
    const holder = createElement("div", FLOAT_CLASS);
    holder.style.left = `${left}px`;
    holder.style.top = `${anchor.bottom}px`;
    holder.style.width = `${width}px`;
    holder.append(panel);
    bindHoverRegion(holder);
    document.body.append(holder);
    activePanel.popover = holder;
    schedulePopoverClose(holder);
  }

  function schedulePopoverClose(popover = activePanel?.popover) {
    clearHoverClose();
    if (!popover?.isConnected) {
      return;
    }
    hoverCloseTimer = setTimeout(() => {
      hoverCloseTimer = 0;
      if (popover !== activePanel?.popover) {
        return;
      }
      if (!popover.isConnected) {
        maybeRescuePanel();
        return;
      }
      const trigger = document.querySelector(TRIGGER_SELECTOR);
      if (
        trigger?.matches(":hover")
        || popover.matches(":hover")
        || popover.contains(document.activeElement)
      ) {
        return;
      }
      hidePopover(popover);
    }, HOVER_CLOSE_DELAY_MS);
  }

  function isInsideActiveRegion(target) {
    return target?.nodeType === Node.ELEMENT_NODE
      && (
        Boolean(target.closest?.(TRIGGER_SELECTOR))
        || Boolean(activePanel?.popover?.contains(target))
      );
  }

  function handleTriggerExit(event) {
    if (event.type === "mouseout") {
      lastPointer.x = event.clientX;
      lastPointer.y = event.clientY;
    }
    const trigger = event.target?.closest?.(TRIGGER_SELECTOR);
    if (!trigger || isInsideActiveRegion(event.relatedTarget)) {
      return;
    }
    schedulePopoverClose();
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createSvgIcon(name, className = "") {
    const namespace = "http" + "://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    if (className) {
      svg.setAttribute("class", className);
    }
    const add = (tagName, attributes) => {
      const child = document.createElementNS(namespace, tagName);
      for (const [attribute, value] of Object.entries(attributes)) {
        child.setAttribute(attribute, value);
      }
      svg.append(child);
    };
    if (name === "person") {
      add("path", { d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" });
      add("circle", { cx: "12", cy: "7", r: "4" });
    } else if (name === "item") {
      add("path", { d: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" });
      add("polyline", { points: "3.27 6.96 12 12.01 20.73 6.96" });
      add("line", { x1: "12", y1: "22", x2: "12", y2: "12" });
    } else if (name === "transaction") {
      add("rect", { x: "2", y: "4", width: "20", height: "16", rx: "2" });
      add("line", { x1: "2", y1: "10", x2: "22", y2: "10" });
    } else if (name === "table") {
      add("rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" });
      add("line", { x1: "3", y1: "10", x2: "21", y2: "10" });
      add("line", { x1: "9", y1: "4", x2: "9", y2: "20" });
    } else if (name === "gear") {
      add("circle", { cx: "12", cy: "12", r: "3" });
      add("path", { d: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1-2.8-2.8.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.3 1.1z" });
    } else if (name === "role") {
      add("path", { d: "M12 1l9 4v6c0 5.6-3.8 10.7-9 12-5.2-1.3-9-6.4-9-12V5l9-4z" });
    } else if (name === "script") {
      add("polyline", { points: "16 18 22 12 16 6" });
      add("polyline", { points: "8 6 2 12 8 18" });
    } else if (name === "workflow") {
      add("circle", { cx: "6", cy: "6", r: "3" });
      add("circle", { cx: "18", cy: "18", r: "3" });
      add("path", { d: "M9 6h6a3 3 0 0 1 3 3v6" });
    } else if (name === "search") {
      add("circle", { cx: "11", cy: "11", r: "7" });
      add("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" });
    } else if (name === "crm") {
      add("path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" });
    } else if (name === "list") {
      for (const y of [6, 12, 18]) {
        add("line", { x1: "8", y1: String(y), x2: "21", y2: String(y) });
        add("line", { x1: "3", y1: String(y), x2: "3.01", y2: String(y) });
      }
    } else if (name === "arrow-right") {
      add("line", { x1: "5", y1: "12", x2: "19", y2: "12" });
      add("polyline", { points: "12 5 19 12 12 19" });
    } else if (name === "external") {
      add("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" });
      add("polyline", { points: "15 3 21 3 21 9" });
      add("line", { x1: "10", y1: "14", x2: "21", y2: "3" });
    } else if (name === "edit") {
      add("path", { d: "M12 20h9" });
      add("path", { d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" });
    } else if (name === "star") {
      add("polygon", { points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" });
    } else {
      add("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" });
      add("polyline", { points: "14 2 14 8 20 8" });
    }
    return svg;
  }

  function createActionLink(iconName, title, href, options = {}) {
    const suffix = options.className ? ` ${options.className}` : "";
    const link = createElement("a", `suitemate-v3-rr-action${suffix}`);
    link.href = href;
    link.title = title;
    link.setAttribute("aria-label", title);
    if (options.newTab) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    link.append(createSvgIcon(iconName));
    return link;
  }

  function matchingRecords(model, query) {
    const needle = query.toLocaleLowerCase();
    const matches = (record) => !needle
      || `${record.name} ${record.secondary}`.toLocaleLowerCase().includes(needle);
    return {
      pinned: model.pinned.filter(matches),
      recent: model.recent.filter(matches)
    };
  }

  function iconTint(record) {
    if (["employee", "customer", "vendor", "contact", "partner"].includes(record.kind)) {
      return "entity";
    }
    if (record.kind === "item") {
      return "item";
    }
    if (record.kind === "transaction") {
      const name = (record.name || "").toLowerCase();
      if (name.startsWith("purchase order")) return "po";
      if (name.startsWith("item receipt")) return "item";
      return "transaction";
    }
    if (/^(customer|vendor|employee|contact|partner)$/i.test((record.secondary || "").trim())) {
      return "entity";
    }
    return "neutral";
  }

  function iconGlyph(record) {
    if (iconTint(record) === "entity") {
      return "person";
    }
    if ((record.name || "").toLowerCase().startsWith("item receipt")) {
      return "file";
    }
    return RECORD_ICONS[record.kind] ?? "file";
  }

  function createRecordRow(record) {
    const row = createElement("div", "suitemate-v3-rr-row");
    row.dataset.recordIdentity = record.identity;
    row.setAttribute("role", "listitem");

    const icon = createElement("span", `suitemate-v3-rr-icon suitemate-v3-rr-icon-tint-${iconTint(record)}`);
    icon.append(createSvgIcon(iconGlyph(record)));
    icon.setAttribute("aria-hidden", "true");

    const main = createElement("a", "suitemate-v3-rr-main");
    main.href = record.url;
    const details = createElement("span", "suitemate-v3-rr-details");
    const name = createElement("span", "suitemate-v3-rr-name", record.name);
    details.append(name);
    if (record.secondary) {
      details.append(createElement("span", "suitemate-v3-rr-secondary", record.secondary));
    }
    main.append(icon, details);

    const actions = createElement("div", "suitemate-v3-rr-row-actions");
    actions.append(createActionLink("external", `Open ${record.name} in a new tab`, record.url, {
      className: "suitemate-v3-rr-action-view",
      newTab: true
    }));
    actions.append(createActionLink("edit", `Edit ${record.name}`, record.editUrl, {
      className: "suitemate-v3-rr-action-edit"
    }));
    const pinnedClass = record.pinned ? " is-pinned" : "";
    const pin = createElement(
      "button",
      `suitemate-v3-rr-action suitemate-v3-rr-action-pin${pinnedClass}`
    );
    pin.type = "button";
    pin.title = record.pinned ? `Unpin ${record.name}` : `Pin ${record.name}`;
    pin.setAttribute("aria-label", pin.title);
    pin.setAttribute("aria-pressed", String(Boolean(record.pinned)));
    pin.append(createSvgIcon("star"));
    pin.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void updateStore((value) => core.withPinned(
        value,
        scopeKey,
        record,
        !record.pinned,
        location.origin
      ));
    });
    actions.append(pin);
    row.append(main);
    if (!record.pinned) {
      row.append(createElement(
        "span",
        "suitemate-v3-rr-date",
        core.displayDate(record).replace(/^(today|yesterday),\s*/i, "")
      ));
    }
    row.append(actions);
    return row;
  }

  function appendGroup(container, title, records, options = {}) {
    if (records.length === 0) {
      return;
    }
    const modifier = options.pinned ? " suitemate-v3-rr-group-title-pinned" : "";
    const heading = createElement("h3", `suitemate-v3-rr-group-title${modifier}`, title);
    container.append(heading);
    for (const record of records) {
      container.append(createRecordRow(record));
    }
  }

  function focusRows(panel) {
    return [...panel.querySelectorAll(".suitemate-v3-rr-main")];
  }

  function handlePanelEscape(panel) {
    const search = panel.querySelector(".suitemate-v3-rr-search");
    if (search?.value) {
      search.value = "";
      activePanel.query = "";
      renderActivePanel({ focusSearch: true });
      return;
    }
    suppressActivationUntil = Date.now() + 350;
    hidePopover();
  }

  function isPanelOpen() {
    const popover = activePanel?.popover;
    return Boolean(popover?.isConnected) && popover.style.display !== "none";
  }

  function isTypingTarget(target) {
    return target?.nodeType === Node.ELEMENT_NODE && (
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      || target.isContentEditable
    );
  }

  // Document-capture keyboard support: "/" focuses the search while the panel
  // is open, and Escape still works while the rescued float is up (NetSuite's
  // own capture handling can starve the panel's bubble listener there).
  // defaultPrevented guards against double handling.
  function handleGlobalKeydown(event) {
    if (event.defaultPrevented || !isPanelOpen()) {
      return;
    }
    if (event.key === "/" && !isTypingTarget(event.target)) {
      event.preventDefault();
      activePanel.panel.querySelector(".suitemate-v3-rr-search")?.focus();
      return;
    }
    const popover = activePanel.popover;
    if (
      event.key === "Escape"
      && popover.classList.contains(FLOAT_CLASS)
      && popover.contains(event.target)
    ) {
      event.preventDefault();
      handlePanelEscape(activePanel.panel);
    }
  }

  function handlePanelKeydown(event) {
    const panel = event.currentTarget;
    const search = panel.querySelector(".suitemate-v3-rr-search");
    if (event.key === "Escape") {
      if (event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      handlePanelEscape(panel);
      return;
    }
    const rows = focusRows(panel);
    if (rows.length === 0) {
      return;
    }
    if (event.key === "Enter" && event.target === search) {
      event.preventDefault();
      rows[0].click();
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const current = rows.indexOf(document.activeElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const next = current < 0
      ? (direction > 0 ? 0 : rows.length - 1)
      : (current + direction + rows.length) % rows.length;
    rows[next].focus();
  }

  function renderActivePanel(options = {}) {
    const state = activePanel;
    if (!state?.panel?.isConnected || !state.popover?.isConnected) {
      activePanel = null;
      return;
    }
    const focusIdentity = document.activeElement?.closest?.("[data-record-identity]")?.dataset.recordIdentity;
    const panel = state.panel;
    const previousScroll = panel.querySelector(".suitemate-v3-rr-list")?.scrollTop ?? 0;
    panel.replaceChildren();

    const header = createElement("header", "suitemate-v3-rr-header");
    const model = core.mergeRecords(getScope(), location.origin);
    const total = model.pinned.length + model.recent.length;
    const filtered = matchingRecords(model, state.query);
    const filteredTotal = filtered.pinned.length + filtered.recent.length;
    const titleRow = createElement("div", "suitemate-v3-rr-title-row");
    titleRow.append(createElement("h2", "suitemate-v3-rr-title", "Recent records"));
    const countText = state.query ? `${filteredTotal} / ${total}` : (total ? String(total) : "");
    if (countText) {
      titleRow.append(createElement("span", "suitemate-v3-rr-count", countText));
    }
    header.append(titleRow);
    const searchWrap = createElement("div", "suitemate-v3-rr-search-wrap");
    searchWrap.append(createSvgIcon("search", "suitemate-v3-rr-search-icon"));
    const search = createElement("input", "suitemate-v3-rr-search");
    search.type = "text";
    search.placeholder = "Search recent records";
    search.setAttribute("aria-label", "Search recent records");
    search.setAttribute("autocomplete", "off");
    search.setAttribute("spellcheck", "false");
    search.value = state.query;
    search.addEventListener("input", () => {
      state.query = search.value;
      renderActivePanel({ focusSearch: true });
    });
    const slashHint = createElement("kbd", "suitemate-v3-rr-slash-hint", "/");
    slashHint.setAttribute("aria-hidden", "true");
    searchWrap.append(search, slashHint);
    header.append(searchWrap);

    const footer = createElement("footer", "suitemate-v3-rr-footer");
    const viewAll = createElement("a", "suitemate-v3-rr-all-button");
    viewAll.href = state.viewAllHref;
    viewAll.title = "View all recent NetSuite records";
    viewAll.append(
      createElement("span", "", "View all recent records"),
      createSvgIcon("arrow-right")
    );
    footer.append(viewAll);

    const body = createElement("div", "suitemate-v3-rr-list");
    body.setAttribute("role", "list");
    if (state.status === "loading" && total === 0) {
      body.append(createElement("div", "suitemate-v3-rr-message", "Loading recent records..."));
    } else if (state.status === "error" && total === 0) {
      const failed = createElement("div", "suitemate-v3-rr-message");
      failed.append(createElement("strong", "suitemate-v3-rr-error", "Recent records could not be loaded."));
      const retry = createElement("button", "suitemate-v3-rr-retry", "Try again");
      retry.type = "button";
      retry.addEventListener("click", () => void refreshSnapshot());
      failed.append(retry);
      body.append(failed);
    } else if (filteredTotal === 0) {
      const empty = createElement("div", "suitemate-v3-rr-message");
      empty.append(
        createElement("strong", "", state.query ? "No matching records." : "No recent records yet."),
        createElement(
          "span",
          "suitemate-v3-rr-message-hint",
          state.query ? "Try a shorter or different search." : "Records you open in NetSuite will show up here."
        )
      );
      body.append(empty);
    } else {
      appendGroup(body, "Pinned", filtered.pinned, { pinned: true });
      for (const group of GROUPS) {
        appendGroup(body, group, filtered.recent.filter((record) =>
          core.groupForTimestamp(record.timestamp || core.parseRecentDate(record.dateText)) === group));
      }
    }
    panel.append(header, body, footer);
    body.scrollTop = previousScroll;
    if (options.focusSearch) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    } else if (focusIdentity) {
      panel.querySelector(`[data-record-identity="${CSS.escape(focusIdentity)}"] .suitemate-v3-rr-main`)?.focus();
    }
  }

  function injectPanel(popover, options = {}) {
    if (!enabled || disposed || !popover?.isConnected) {
      return;
    }
    const nativeLink = popover.querySelector(`a[href*="${RECENT_PATH}"]`);
    const viewAllHref = nativeLink?.getAttribute("href") || RECENT_PATH;
    const body = popover.querySelector('[data-widget="WindowBody"]')
      ?? popover.querySelector('[data-widget="ScrollPanel"]')
      ?? nativeLink?.closest("div")
      ?? popover;
    const panel = createElement("section", "suitemate-v3-rr-panel");
    panel.setAttribute(PANEL_ATTRIBUTE, "panel");
    panel.setAttribute("aria-label", "Recent Records");
    panel.addEventListener("keydown", handlePanelKeydown);
    panel.addEventListener("click", (event) => {
      if (event.target?.closest?.("a")) {
        hidePopover(popover);
      }
    });
    bindHoverRegion(popover);
    body.replaceChildren(panel);
    popover.setAttribute(INJECTED_ATTRIBUTE, "true");
    popover.removeAttribute(BAILOUT_ATTRIBUTE);
    activePanel = {
      popover,
      panel,
      query: "",
      viewAllHref,
      status: fetchController ? "loading" : "ready"
    };
    retainPopover(popover);
    renderActivePanel();
    if (options.focusSearch) {
      setTimeout(() => activePanel?.panel === panel && panel.querySelector("input")?.focus(), 60);
    }
    void refreshSnapshot();
  }

  function parseSnapshot(html) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const records = [];
    for (const row of parsed.querySelectorAll("tr.uir-list-row-tr")) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 4) {
        continue;
      }
      const links = cells[0].querySelectorAll("a.dottedlink");
      const edit = core.normalizeRecordUrl(links[0]?.getAttribute("href"), location.origin);
      const view = core.normalizeRecordUrl(
        links[1]?.getAttribute("href") || links[0]?.getAttribute("href"),
        location.origin,
        { removeTransient: true }
      );
      const identity = core.recordIdentity(view, location.origin);
      if (!identity || !view) {
        continue;
      }
      const dateText = core.cleanText(cells[3].textContent, 100);
      records.push({
        identity,
        url: view,
        editUrl: edit || core.editUrl(view, location.origin),
        name: core.cleanText(cells[1].textContent) || "NetSuite record",
        secondary: core.cleanText(cells[2].textContent),
        kind: core.classifyRecord(view),
        timestamp: core.parseRecentDate(dateText),
        dateText
      });
    }
    return records;
  }

  async function refreshSnapshot() {
    const scope = getScope();
    if (Date.now() - scope.snapshot.fetchedAt < CACHE_TTL_MS) {
      return;
    }
    if (fetchController) {
      return;
    }
    fetchController = new AbortController();
    const controller = fetchController;
    if (activePanel) {
      activePanel.status = "loading";
      renderActivePanel();
    }
    try {
      const response = await fetch(RECENT_PATH, {
        credentials: "include",
        headers: { Accept: "text/html" },
        signal: controller.signal
      });
      const responseUrl = new URL(response.url, location.origin);
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        !response.ok
        || responseUrl.origin !== location.origin
        || responseUrl.pathname !== RECENT_PATH
        || (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES)
      ) {
        throw new Error("Unexpected recent-record response.");
      }
      const html = await response.text();
      if (html.length > MAX_RESPONSE_BYTES || controller.signal.aborted) {
        throw new Error("Recent-record response exceeded the supported size.");
      }
      const items = parseSnapshot(html);
      await updateStore((value) => core.withSnapshot(
        value,
        scopeKey,
        items,
        location.origin
      ));
      if (activePanel) {
        activePanel.status = "ready";
        renderActivePanel();
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (activePanel) {
        activePanel.status = "error";
        renderActivePanel();
      }
    } finally {
      if (fetchController === controller) {
        fetchController = null;
      }
    }
  }

  function scheduleActivation(options = {}) {
    if (!enabled || disposed) {
      return;
    }
    scopeKey = resolveScopeKey();
    activationController?.abort("new-activation");
    activationController = new AbortController();
    const controller = activationController;
    document.documentElement.classList.add("suitemate-v3-recent-records-armed");
    void refreshSnapshot();
    void lifecycleApi.waitFor({
      id: `navigation.recent-records-popover.${++waitSequence}`,
      capability: routeApi.CAPABILITIES.RECENT_RECORDS,
      observe: { childList: true, subtree: true },
      relevant: isRelevantPopoverMutation,
      timeoutMs: 5000,
      signal: controller.signal,
      test: findRecentPopover
    }).then((popover) => {
      if (popover && enabled && !controller.signal.aborted) {
        if (popover.getAttribute(INJECTED_ATTRIBUTE) === "true") {
          retainPopover(popover);
          renderActivePanel();
          if (options.focusSearch) {
            setTimeout(() => activePanel?.popover === popover
              && activePanel.panel.querySelector("input")?.focus(), 60);
          }
        } else {
          injectPanel(popover, options);
        }
        return;
      }
      findRecentPopover()?.setAttribute(BAILOUT_ATTRIBUTE, "true");
    });
  }

  function handleActivation(event) {
    if (event.type === "mouseover") {
      lastPointer.x = event.clientX;
      lastPointer.y = event.clientY;
    }
    if (!enabled || !event.target?.closest?.(TRIGGER_SELECTOR)) {
      return;
    }
    if (Date.now() < suppressActivationUntil) {
      return;
    }
    if (activePanel?.popover?.isConnected) {
      retainPopover(activePanel.popover);
      renderActivePanel();
      if (event.type === "focusin") {
        setTimeout(() => activePanel?.panel?.querySelector("input")?.focus(), 60);
      }
      return;
    }
    const now = Date.now();
    if (now - lastActivationAt < ACTIVATION_THROTTLE_MS) {
      return;
    }
    lastActivationAt = now;
    scheduleActivation({ focusSearch: event.type === "focusin" });
  }

  const historyWatcher = lifecycleApi.register({
    id: "navigation.recent-records-history",
    capability: routeApi.CAPABILITIES.RECENT_RECORDS,
    mode: "once",
    startPaused: true,
    async evaluate({ signal, isCurrent }) {
      await lifecycleApi.whenDomReady();
      if (!await delay(3000, signal) || !isCurrent()) {
        return false;
      }
      scopeKey = resolveScopeKey();
      const record = core.prepareVisitedRecord(location.href, document.title, location.origin);
      if (record) {
        await updateStore((value) => core.withVisit(
          value,
          scopeKey,
          record,
          location.origin
        ));
      }
      return true;
    }
  });

  function enableFeature() {
    if (enabled || disposed) {
      return;
    }
    enabled = true;
    document.documentElement.classList.add(
      "suitemate-v3-recent-records-enabled",
      "suitemate-v3-recent-records-armed"
    );
    document.addEventListener("mouseover", handleActivation, true);
    document.addEventListener("focusin", handleActivation, true);
    document.addEventListener("mouseout", handleTriggerExit, true);
    document.addEventListener("focusout", handleTriggerExit, true);
    document.addEventListener("keydown", handleGlobalKeydown, true);
    historyWatcher.resume("feature-enabled");
  }

  function disableFeature() {
    if (!enabled) {
      return;
    }
    enabled = false;
    hidePopover();
    activationController?.abort("feature-disabled");
    activationController = null;
    fetchController?.abort("feature-disabled");
    fetchController = null;
    historyWatcher.pause("feature-disabled");
    document.removeEventListener("mouseover", handleActivation, true);
    document.removeEventListener("focusin", handleActivation, true);
    document.removeEventListener("mouseout", handleTriggerExit, true);
    document.removeEventListener("focusout", handleTriggerExit, true);
    document.removeEventListener("keydown", handleGlobalKeydown, true);
    document.documentElement.classList.remove(
      "suitemate-v3-recent-records-enabled",
      "suitemate-v3-recent-records-armed"
    );
    activePanel?.popover?.remove();
    activePanel = null;
  }

  function applySettings(value) {
    try {
      const settings = settingsApi.normalize(value);
      if (settings.recentRecords) {
        enableFeature();
      } else {
        disableFeature();
      }
    } catch {
      disableFeature();
    }
  }

  async function start() {
    const revision = ++settingsRevision;
    try {
      const [settings, stored] = await Promise.all([
        settingsApi.get(),
        chrome.storage.local.get(core.STORAGE_KEY)
      ]);
      if (revision !== settingsRevision || disposed) {
        return;
      }
      store = core.normalizeStored(stored[core.STORAGE_KEY], location.origin);
      scopeKey = resolveScopeKey();
      applySettings(settings);
    } catch {
      disableFeature();
    }
  }

  function handleStorageChange(changes, areaName) {
    if (areaName === "sync" && changes[settingsApi.STORAGE_KEY]) {
      settingsRevision += 1;
      applySettings(changes[settingsApi.STORAGE_KEY].newValue);
      return;
    }
    if (areaName === "local" && changes[core.STORAGE_KEY]) {
      store = core.normalizeStored(changes[core.STORAGE_KEY].newValue, location.origin);
      renderActivePanel();
    }
  }

  chrome.storage.onChanged.addListener(handleStorageChange);
  globalThis.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      disposed = true;
      disableFeature();
      historyWatcher.dispose("pagehide");
      chrome.storage.onChanged.removeListener(handleStorageChange);
    }
  });

  void start();
})();
