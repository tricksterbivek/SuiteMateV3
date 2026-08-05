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
  const ACTIVATION_DELAY_MS = 200;
  const GROUPS = Object.freeze(["Today", "Yesterday", "This week", "Older"]);
  const ICON_LABELS = Object.freeze({
    employee: "E",
    customer: "C",
    vendor: "V",
    contact: "C",
    partner: "P",
    item: "I",
    file: "F",
    transaction: "T",
    "custom-record-type": "R",
    "custom-record": "R",
    "custom-field": "F",
    form: "F",
    role: "R",
    script: "S",
    workflow: "W",
    search: "Q",
    crm: "C",
    setup: "S",
    record: "R"
  });

  let enabled = false;
  let disposed = false;
  let store = core.normalizeStored(undefined, location.origin);
  let scopeKey = resolveScopeKey();
  let activationTimer = 0;
  let activationController = null;
  let fetchController = null;
  let activePanel = null;
  let waitSequence = 0;
  let storeWriteQueue = Promise.resolve();
  let settingsRevision = 0;

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

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createActionLink(label, title, href, options = {}) {
    const link = createElement("a", "suitemate-v3-rr-action", label);
    link.href = href;
    link.title = title;
    link.setAttribute("aria-label", title);
    if (options.newTab) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
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

  function createRecordRow(record) {
    const row = createElement("div", "suitemate-v3-rr-row");
    row.dataset.recordIdentity = record.identity;
    row.setAttribute("role", "listitem");

    const icon = createElement(
      "span",
      `suitemate-v3-rr-icon suitemate-v3-rr-icon-${record.kind}`,
      ICON_LABELS[record.kind] ?? "R"
    );
    icon.setAttribute("aria-hidden", "true");

    const main = createElement("a", "suitemate-v3-rr-main");
    main.href = record.url;
    const name = createElement("span", "suitemate-v3-rr-name", record.name);
    main.append(name);
    if (record.secondary) {
      main.append(createElement("span", "suitemate-v3-rr-secondary", record.secondary));
    }
    const date = createElement("span", "suitemate-v3-rr-date", core.displayDate(record));
    main.append(date);

    const actions = createElement("div", "suitemate-v3-rr-row-actions");
    actions.append(createActionLink("↗", `Open ${record.name} in a new tab`, record.url, { newTab: true }));
    actions.append(createActionLink("✎", `Edit ${record.name}`, record.editUrl));
    const pin = createElement("button", "suitemate-v3-rr-action", record.pinned ? "●" : "○");
    pin.type = "button";
    pin.title = record.pinned ? `Unpin ${record.name}` : `Pin ${record.name}`;
    pin.setAttribute("aria-label", pin.title);
    pin.setAttribute("aria-pressed", String(Boolean(record.pinned)));
    pin.addEventListener("click", () => {
      void updateStore((value) => core.withPinned(
        value,
        scopeKey,
        record,
        !record.pinned,
        location.origin
      ));
    });
    actions.append(pin);
    row.append(icon, main, actions);
    return row;
  }

  function appendGroup(container, title, records) {
    if (records.length === 0) {
      return;
    }
    const heading = createElement("h3", "suitemate-v3-rr-group-title", title);
    container.append(heading);
    const list = createElement("div", "suitemate-v3-rr-list");
    list.setAttribute("role", "list");
    for (const record of records) {
      list.append(createRecordRow(record));
    }
    container.append(list);
  }

  function focusRows(panel) {
    return [...panel.querySelectorAll(".suitemate-v3-rr-main")];
  }

  function handlePanelKeydown(event) {
    const panel = event.currentTarget;
    const search = panel.querySelector(".suitemate-v3-rr-search");
    if (event.key === "Escape" && search?.value) {
      event.preventDefault();
      search.value = "";
      activePanel.query = "";
      renderActivePanel({ focusSearch: true });
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
    panel.replaceChildren();

    const header = createElement("header", "suitemate-v3-rr-header");
    const titleWrap = createElement("div", "suitemate-v3-rr-title-wrap");
    titleWrap.append(createElement("h2", "suitemate-v3-rr-title", "Recent Records"));
    const model = core.mergeRecords(getScope(), location.origin);
    const total = model.pinned.length + model.recent.length;
    const filtered = matchingRecords(model, state.query);
    const filteredTotal = filtered.pinned.length + filtered.recent.length;
    titleWrap.append(createElement(
      "span",
      "suitemate-v3-rr-count",
      state.query ? `${filteredTotal} / ${total}` : String(total)
    ));
    const viewAll = createActionLink("View all", "View all recent NetSuite records", state.viewAllHref);
    header.append(titleWrap, viewAll);

    const searchWrap = createElement("div", "suitemate-v3-rr-search-wrap");
    const search = createElement("input", "suitemate-v3-rr-search");
    search.type = "search";
    search.placeholder = "Search recent records";
    search.setAttribute("aria-label", "Search recent records");
    search.value = state.query;
    search.addEventListener("input", () => {
      state.query = search.value;
      renderActivePanel({ focusSearch: true });
    });
    searchWrap.append(search);

    const body = createElement("div", "suitemate-v3-rr-body");
    if (state.status === "loading" && total === 0) {
      body.append(createElement("div", "suitemate-v3-rr-message", "Loading recent records..."));
    } else if (state.status === "error" && total === 0) {
      body.append(createElement("div", "suitemate-v3-rr-message suitemate-v3-rr-error", "Recent records could not be loaded."));
    } else if (filteredTotal === 0) {
      body.append(createElement(
        "div",
        "suitemate-v3-rr-message",
        state.query ? "No matching records." : "No recent records yet."
      ));
    } else {
      appendGroup(body, "Pinned", filtered.pinned);
      for (const group of GROUPS) {
        appendGroup(body, group, filtered.recent.filter((record) =>
          core.groupForTimestamp(record.timestamp || core.parseRecentDate(record.dateText)) === group));
      }
    }
    panel.append(header, searchWrap, body);
    if (options.focusSearch) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    } else if (focusIdentity) {
      panel.querySelector(`[data-record-identity="${CSS.escape(focusIdentity)}"] .suitemate-v3-rr-main`)?.focus();
    }
  }

  function injectPanel(popover) {
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
    body.replaceChildren(panel);
    popover.setAttribute(INJECTED_ATTRIBUTE, "true");
    popover.removeAttribute(BAILOUT_ATTRIBUTE);
    activePanel = { popover, panel, query: "", viewAllHref, status: "ready" };
    renderActivePanel();
    setTimeout(() => activePanel?.panel === panel && panel.querySelector("input")?.focus(), 60);
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
    fetchController?.abort("new-request");
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

  function scheduleActivation() {
    clearTimeout(activationTimer);
    activationTimer = setTimeout(() => {
      activationTimer = 0;
      if (!enabled || disposed) {
        return;
      }
      scopeKey = resolveScopeKey();
      activationController?.abort("new-activation");
      activationController = new AbortController();
      const controller = activationController;
      document.documentElement.classList.add("suitemate-v3-recent-records-armed");
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
          injectPanel(popover);
          return;
        }
        findRecentPopover()?.setAttribute(BAILOUT_ATTRIBUTE, "true");
      });
    }, ACTIVATION_DELAY_MS);
  }

  function handleActivation(event) {
    if (enabled && event.target?.closest?.(TRIGGER_SELECTOR)) {
      scheduleActivation();
    }
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
    historyWatcher.resume("feature-enabled");
  }

  function disableFeature() {
    if (!enabled) {
      return;
    }
    enabled = false;
    clearTimeout(activationTimer);
    activationTimer = 0;
    activationController?.abort("feature-disabled");
    activationController = null;
    fetchController?.abort("feature-disabled");
    fetchController = null;
    historyWatcher.pause("feature-disabled");
    document.removeEventListener("mouseover", handleActivation, true);
    document.removeEventListener("focusin", handleActivation, true);
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
  globalThis.addEventListener("pagehide", () => {
    disposed = true;
    disableFeature();
    historyWatcher.dispose("pagehide");
    chrome.storage.onChanged.removeListener(handleStorageChange);
  }, { once: true });

  void start();
})();
