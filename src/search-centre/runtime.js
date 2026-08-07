(function initializeSuiteMateV3SearchCentre() {
  "use strict";

  const core = globalThis.SuiteMateV3SearchCentreCore;
  const commandApi = globalThis.SuiteMateV3Commands;
  const lifecycleApi = globalThis.SuiteMateV3Lifecycle;
  const routeApi = globalThis.SuiteMateV3Routes;
  const settingsApi = globalThis.SuiteMateV3Settings;
  if (
    !core
    || !commandApi
    || !lifecycleApi
    || !routeApi
    || !settingsApi
    || !globalThis.document
    || !globalThis.location
    || !globalThis.chrome?.storage
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
  if (!routeApi.supports(routeApi.CAPABILITIES.SEARCH_CENTRE, pageContext)) {
    return;
  }

  // ===== Native uber-search adapter =====
  // Every NetSuite-internal assumption lives between these fences; the modal
  // above it only sees the adapter's five functions. Selectors verified live
  // on 2026.2 classic UI (release preview) — see the pins in tests/verify.mjs.
  const NATIVE_INPUT_SELECTOR = "#_searchstring";
  const NATIVE_DROPDOWN_SELECTOR = 'div[id^="menu_searchstring"], #ns-header-menu-search, .ns-menu-search';
  const SEARCH_MIN_QUERY_LENGTH = 2;
  const RESULTS_PATH = "/app/common/search/ubersearchresults.nl";

  function findNativeInput() {
    return document.querySelector(NATIVE_INPUT_SELECTOR);
  }

  function findNativeDropdown() {
    return document.querySelector(NATIVE_DROPDOWN_SELECTOR);
  }

  // Feed the modal's query through NetSuite's own machinery: write the native
  // input and let its listeners debounce, fetch and render as usual.
  function pushQueryToNative(query) {
    const input = findNativeInput();
    if (!input) {
      return false;
    }
    input.value = query;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));
    return true;
  }

  function parseNativeResults() {
    const dropdown = findNativeDropdown();
    if (!dropdown) {
      return null;
    }
    const rows = [];
    for (const anchor of dropdown.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) {
        continue;
      }
      const result = core.normalizeResult({
        title: anchor.textContent,
        typeText: anchor.getAttribute("data-type") ?? "",
        secondary: "",
        href
      }, location.origin);
      if (result) {
        rows.push(result);
      }
    }
    return rows;
  }

  function nativeSeeAllHref() {
    const query = state.query.trim();
    try {
      const url = new URL(RESULTS_PATH, location.origin);
      url.searchParams.set("quicksearch", "T");
      url.searchParams.set("searchtype", "Uber");
      url.searchParams.set("Uber_NAMEtext", query);
      return `${url.pathname}${url.search}`;
    } catch {
      return RESULTS_PATH;
    }
  }

  function hideNativeDropdown() {
    findNativeDropdown()?.style.setProperty("display", "none", "important");
  }

  function unhideNativeDropdown() {
    findNativeDropdown()?.style.removeProperty("display");
  }
  // ===== End of native adapter =====

  const OPEN_CLASS = "suitemate-v3-sc-open";
  const REOPEN_SUPPRESS_MS = 400;
  const svgNamespace = "http" + "://www.w3.org/2000/svg";

  let enabled = false;
  let disposed = false;
  let settingsRevision = 0;
  let suppressOpenUntil = 0;
  let resultsObserver = null;
  let modal = null;
  const state = {
    open: false,
    query: "",
    category: "all",
    results: [],
    pending: false,
    everParsed: false,
    selectedIndex: 0,
    opener: null
  };

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createSvgIcon(name, className = "") {
    const svg = document.createElementNS(svgNamespace, "svg");
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
      const child = document.createElementNS(svgNamespace, tagName);
      for (const [attribute, value] of Object.entries(attributes)) {
        child.setAttribute(attribute, value);
      }
      svg.append(child);
    };
    if (name === "search") {
      add("circle", { cx: "11", cy: "11", r: "7" });
      add("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" });
    } else if (name === "close") {
      add("line", { x1: "18", y1: "6", x2: "6", y2: "18" });
      add("line", { x1: "6", y1: "6", x2: "18", y2: "18" });
    } else if (name === "file") {
      add("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" });
      add("polyline", { points: "14 2 14 8 20 8" });
    } else if (name === "record") {
      add("rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" });
      add("line", { x1: "3", y1: "10", x2: "21", y2: "10" });
    } else if (name === "list") {
      for (const y of [6, 12, 18]) {
        add("line", { x1: "8", y1: String(y), x2: "21", y2: String(y) });
        add("line", { x1: "3", y1: String(y), x2: "3.01", y2: String(y) });
      }
    } else if (name === "external") {
      add("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" });
      add("polyline", { points: "15 3 21 3 21 9" });
      add("line", { x1: "10", y1: "14", x2: "21", y2: "3" });
    } else if (name === "edit") {
      add("path", { d: "M12 20h9" });
      add("path", { d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" });
    } else {
      add("circle", { cx: "12", cy: "12", r: "9" });
    }
    return svg;
  }

  const CATEGORY_ICONS = Object.freeze({
    all: "search",
    records: "record",
    files: "file",
    navigation: "list"
  });

  function shortcutDisplay() {
    return commandApi.getShortcut(
      commandApi.IDS.SEARCH_OPEN_CENTRE,
      commandApi.detectPlatform()
    )?.display ?? "";
  }

  function filteredResults() {
    return core.filterByCategory(state.results, state.category);
  }

  function selectedResult() {
    return filteredResults()[state.selectedIndex] ?? null;
  }

  function primaryActionLabel(result) {
    if (result.category === "files") {
      return "Open file";
    }
    if (result.category === "navigation") {
      return "Open page";
    }
    return "Open record";
  }

  // Built once; open/close only attach and detach the overlay node, so every
  // listener is bound exactly once no matter how often the centre opens.
  function buildModal() {
    const overlay = createElement("div", "suitemate-v3-sc-overlay");
    const dialog = createElement("section", "suitemate-v3-sc-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Search Centre");

    const header = createElement("header", "suitemate-v3-sc-header");
    const searchWrap = createElement("div", "suitemate-v3-sc-search-wrap");
    searchWrap.append(createSvgIcon("search", "suitemate-v3-sc-search-icon"));
    const input = createElement("input", "suitemate-v3-sc-search");
    input.type = "text";
    input.placeholder = "Search NetSuite";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "suitemate-v3-sc-listbox");
    input.setAttribute("aria-label", "Search NetSuite");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    input.addEventListener("input", () => {
      setQuery(input.value);
    });
    const tail = createElement("div", "suitemate-v3-sc-search-tail");
    const kbd = createElement("kbd", "suitemate-v3-sc-kbd", shortcutDisplay());
    kbd.setAttribute("aria-hidden", "true");
    const clear = createElement("button", "suitemate-v3-sc-clear");
    clear.type = "button";
    clear.title = "Clear search";
    clear.setAttribute("aria-label", "Clear search");
    clear.append(createSvgIcon("close"));
    clear.addEventListener("click", () => {
      setQuery("");
      input.value = "";
      input.focus();
    });
    tail.append(kbd, clear);
    searchWrap.append(input, tail);
    const close = createElement("button", "suitemate-v3-sc-close");
    close.type = "button";
    close.title = "Close Search Centre";
    close.setAttribute("aria-label", "Close Search Centre");
    close.append(createSvgIcon("close"));
    close.addEventListener("click", () => closeSearchCentre());
    header.append(searchWrap, close);

    const body = createElement("div", "suitemate-v3-sc-body");
    const rail = createElement("nav", "suitemate-v3-sc-rail");
    rail.setAttribute("aria-label", "Result filters");
    const filterButtons = {};
    for (const category of core.CATEGORIES) {
      const filter = createElement("button", "suitemate-v3-sc-filter");
      filter.type = "button";
      filter.append(createSvgIcon(CATEGORY_ICONS[category.id]));
      filter.append(createElement("span", "suitemate-v3-sc-filter-label", category.label));
      const count = createElement("span", "suitemate-v3-sc-filter-count");
      filter.append(count);
      filter.addEventListener("click", () => {
        if (filter.disabled) {
          return;
        }
        state.category = category.id;
        state.selectedIndex = 0;
        render();
      });
      filterButtons[category.id] = { filter, count };
      rail.append(filter);
    }

    const results = createElement("div", "suitemate-v3-sc-results");
    const resultsLabel = createElement("h2", "suitemate-v3-sc-results-label", "Top results");
    const list = createElement("div");
    list.id = "suitemate-v3-sc-listbox";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Search results");
    results.append(resultsLabel, list);

    const preview = createElement("aside", "suitemate-v3-sc-preview");
    preview.setAttribute("aria-label", "Selected result");

    body.append(rail, results, preview);

    const footer = createElement("footer", "suitemate-v3-sc-footer");
    const navigateHint = createElement("span", "suitemate-v3-sc-hint");
    navigateHint.append(
      createElement("kbd", "", "↑"),
      createElement("kbd", "", "↓"),
      createElement("span", "", "to navigate")
    );
    const openHint = createElement("span", "suitemate-v3-sc-hint");
    openHint.append(createElement("kbd", "", "↵"), createElement("span", "", "to open"));
    const closeHint = createElement("span", "suitemate-v3-sc-hint");
    closeHint.append(createElement("kbd", "", "esc"), createElement("span", "", "to close"));
    const allLink = createElement("a", "suitemate-v3-sc-all-link");
    allLink.append(
      createElement("span", "", "View all search results"),
      createSvgIcon("external")
    );
    allLink.addEventListener("click", () => closeSearchCentre({ restoreFocus: false }));
    footer.append(navigateHint, openHint, closeHint, allLink);

    dialog.append(header, body, footer);
    overlay.append(dialog);

    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) {
        event.preventDefault();
        closeSearchCentre();
      }
    });
    overlay.addEventListener("keydown", handleModalKeydown);

    return {
      overlay,
      dialog,
      input,
      filterButtons,
      resultsLabel,
      list,
      preview,
      allLink
    };
  }

  function focusableElements() {
    return [...modal.dialog.querySelectorAll("a[href], button:not([disabled]), input")]
      .filter((element) => element.offsetParent !== null || element === modal.input);
  }

  function handleModalKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearchCentre();
      return;
    }
    if (event.key === "Tab") {
      const focusables = focusableElements();
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const total = filteredResults().length;
      if (total === 0) {
        return;
      }
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      state.selectedIndex = (state.selectedIndex + direction + total) % total;
      render({ revealSelection: true });
      return;
    }
    if (event.key === "Enter" && event.target === modal.input) {
      event.preventDefault();
      openResult(selectedResult());
    }
  }

  function openResult(result) {
    if (!result?.href) {
      return;
    }
    closeSearchCentre({ restoreFocus: false });
    location.assign(result.href);
  }

  function setQuery(query) {
    state.query = query;
    state.selectedIndex = 0;
    const trimmed = query.trim();
    if (trimmed.length >= SEARCH_MIN_QUERY_LENGTH) {
      // Old rows must never masquerade as answers for the new query.
      state.pending = pushQueryToNative(query);
      state.results = [];
      state.everParsed = false;
    } else {
      pushQueryToNative(query);
      state.pending = false;
      state.results = [];
      state.everParsed = false;
    }
    render();
  }

  function syncResultsFromNative() {
    if (!state.open || state.query.trim().length < SEARCH_MIN_QUERY_LENGTH) {
      return;
    }
    const parsed = parseNativeResults();
    if (parsed === null) {
      return;
    }
    hideNativeDropdown();
    state.results = parsed;
    state.pending = false;
    state.everParsed = true;
    if (core.filterByCategory(parsed, state.category).length === 0) {
      state.category = "all";
    }
    state.selectedIndex = Math.min(
      state.selectedIndex,
      Math.max(0, filteredResults().length - 1)
    );
    render();
  }

  function renderMessage(title, hint) {
    const message = createElement("div", "suitemate-v3-sc-message");
    message.append(createElement("strong", "", title));
    if (hint) {
      message.append(createElement("span", "suitemate-v3-sc-message-hint", hint));
    }
    return message;
  }

  function renderSkeletons() {
    const holder = document.createDocumentFragment();
    for (let index = 0; index < 3; index += 1) {
      const row = createElement("div", "suitemate-v3-sc-skeleton");
      row.setAttribute("aria-hidden", "true");
      const lines = createElement("div");
      lines.style.flex = "1";
      lines.append(
        createElement("div", "suitemate-v3-sc-skeleton-line"),
        createElement("div", "suitemate-v3-sc-skeleton-line")
      );
      row.append(createElement("div", "suitemate-v3-sc-skeleton-icon"), lines);
      holder.append(row);
    }
    const status = createElement("div", "suitemate-v3-sc-message-hint", "Searching…");
    status.setAttribute("role", "status");
    status.style.padding = "0 16px 8px";
    holder.append(status);
    return holder;
  }

  function renderPreview(result) {
    const preview = modal.preview;
    preview.replaceChildren();
    if (!result) {
      preview.hidden = true;
      return;
    }
    preview.hidden = false;
    if (result.typeText) {
      preview.append(createElement("span", "suitemate-v3-sc-chip", result.typeText));
    }
    preview.append(createElement("h3", "suitemate-v3-sc-preview-title", result.title));
    if (result.secondary) {
      preview.append(createElement("p", "suitemate-v3-sc-preview-meta", result.secondary));
    }
    const actions = createElement("div", "suitemate-v3-sc-preview-actions");
    const open = createElement("a", "suitemate-v3-sc-open-action");
    open.href = result.href;
    open.append(createElement("span", "", primaryActionLabel(result)), createSvgIcon("external"));
    open.addEventListener("click", () => closeSearchCentre({ restoreFocus: false }));
    actions.append(open);
    if (result.editHref) {
      const edit = createElement("a", "suitemate-v3-sc-edit-action");
      edit.href = result.editHref;
      edit.append(createElement("span", "", "Edit"), createSvgIcon("edit"));
      edit.addEventListener("click", () => closeSearchCentre({ restoreFocus: false }));
      actions.append(edit);
    }
    preview.append(actions);
  }

  function render(options = {}) {
    if (!modal || !state.open) {
      return;
    }
    const counts = core.countByCategory(state.results);
    for (const category of core.CATEGORIES) {
      const { filter, count } = modal.filterButtons[category.id];
      const value = counts[category.id];
      count.textContent = state.everParsed && value > 0 ? String(value) : "";
      filter.disabled = category.id !== "all" && state.everParsed && value === 0;
      filter.setAttribute("aria-selected", String(state.category === category.id));
    }

    const visible = filteredResults();
    const trimmedQuery = state.query.trim();
    const list = modal.list;
    list.replaceChildren();
    modal.resultsLabel.hidden = visible.length === 0;

    if (trimmedQuery.length < SEARCH_MIN_QUERY_LENGTH) {
      list.append(renderMessage(
        "Search NetSuite",
        "Records, files and navigation — results appear as you type."
      ));
    } else if (state.pending && !state.everParsed) {
      list.append(renderSkeletons());
    } else if (visible.length === 0) {
      list.append(renderMessage(
        `No results found for “${trimmedQuery}”`,
        "Try a shorter phrase or a record number."
      ));
    } else {
      for (const [index, result] of visible.entries()) {
        const row = createElement("div", "suitemate-v3-sc-row");
        row.id = `suitemate-v3-sc-option-${index}`;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(index === state.selectedIndex));
        if (index === state.selectedIndex) {
          row.classList.add("is-selected");
        }
        const icon = createElement(
          "span",
          `suitemate-v3-sc-row-icon suitemate-v3-sc-tint-${result.category}`
        );
        icon.append(createSvgIcon(CATEGORY_ICONS[result.category]));
        const text = createElement("div", "suitemate-v3-sc-row-text");
        text.append(createElement("span", "suitemate-v3-sc-row-title", result.title));
        const secondary = [result.typeText, result.secondary].filter(Boolean).join(" · ");
        if (secondary) {
          text.append(createElement("span", "suitemate-v3-sc-row-secondary", secondary));
        }
        row.append(icon, text);
        row.addEventListener("click", () => {
          state.selectedIndex = index;
          render();
        });
        row.addEventListener("dblclick", () => openResult(result));
        row.addEventListener("mouseenter", () => {
          if (state.selectedIndex !== index) {
            state.selectedIndex = index;
            render();
          }
        });
        list.append(row);
      }
    }

    const selected = selectedResult();
    if (selected) {
      modal.input.setAttribute("aria-activedescendant", `suitemate-v3-sc-option-${state.selectedIndex}`);
    } else {
      modal.input.removeAttribute("aria-activedescendant");
    }
    renderPreview(selected);
    modal.allLink.href = nativeSeeAllHref();
    if (options.revealSelection) {
      list.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
    }
  }

  function openSearchCentre(options = {}) {
    if (!enabled || disposed || state.open || Date.now() < suppressOpenUntil) {
      return;
    }
    const nativeInput = findNativeInput();
    if (!nativeInput) {
      return;
    }
    modal ??= buildModal();
    state.open = true;
    state.opener = options.opener ?? document.activeElement ?? nativeInput;
    state.query = options.query ?? nativeInput.value ?? "";
    state.category = "all";
    state.results = [];
    state.pending = false;
    state.everParsed = false;
    state.selectedIndex = 0;
    modal.input.value = state.query;
    document.documentElement.classList.add(OPEN_CLASS);
    document.body.append(modal.overlay);
    hideNativeDropdown();
    resultsObserver = new MutationObserver((records) => {
      // The modal's own re-renders land in this observer too; reacting to
      // them would render forever. Only NetSuite-side mutations count.
      if (records.every((record) => modal.overlay.contains(record.target))) {
        return;
      }
      hideNativeDropdown();
      syncResultsFromNative();
    });
    resultsObserver.observe(document.body, { childList: true, subtree: true });
    if (state.query.trim().length >= SEARCH_MIN_QUERY_LENGTH) {
      state.pending = pushQueryToNative(state.query);
      syncResultsFromNative();
    }
    render();
    modal.input.focus();
    modal.input.setSelectionRange(modal.input.value.length, modal.input.value.length);
  }

  function closeSearchCentre(options = {}) {
    if (!state.open) {
      return;
    }
    state.open = false;
    suppressOpenUntil = Date.now() + REOPEN_SUPPRESS_MS;
    resultsObserver?.disconnect();
    resultsObserver = null;
    modal?.overlay.remove();
    document.documentElement.classList.remove(OPEN_CLASS);
    unhideNativeDropdown();
    if (options.restoreFocus !== false) {
      const target = state.opener?.isConnected ? state.opener : findNativeInput();
      target?.focus?.();
    }
    state.opener = null;
  }

  // Focusing or typing in the native box routes into the centre; the native
  // dropdown never gets a chance to unfold while the feature is on.
  function handleNativeIntent(event) {
    if (!enabled || state.open) {
      return;
    }
    const target = event.target;
    if (target?.nodeType !== Node.ELEMENT_NODE || !target.matches?.(NATIVE_INPUT_SELECTOR)) {
      return;
    }
    openSearchCentre({ opener: target, query: target.value });
  }

  const commandScope = commandApi.createScope(commandApi.SURFACES.SEARCH, {
    getContext: () => ({ pageContext })
  });
  commandScope.register(commandApi.IDS.SEARCH_OPEN_CENTRE, {
    isAvailable: () => enabled && !disposed,
    run() {
      if (state.open) {
        modal?.input.focus();
      } else {
        suppressOpenUntil = 0;
        openSearchCentre();
      }
    }
  });
  let shortcutBinding = null;

  function enableFeature() {
    if (enabled || disposed) {
      return;
    }
    enabled = true;
    document.addEventListener("focusin", handleNativeIntent, true);
    document.addEventListener("input", handleNativeIntent, true);
    shortcutBinding = commandScope.bindShortcuts(window, [commandApi.IDS.SEARCH_OPEN_CENTRE]);
  }

  function disableFeature() {
    if (!enabled) {
      return;
    }
    enabled = false;
    closeSearchCentre({ restoreFocus: false });
    document.removeEventListener("focusin", handleNativeIntent, true);
    document.removeEventListener("input", handleNativeIntent, true);
    shortcutBinding?.dispose();
    shortcutBinding = null;
  }

  function applySettings(value) {
    try {
      const settings = settingsApi.normalize(value);
      if (settings.searchCentre) {
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
      const settings = await settingsApi.get();
      if (revision !== settingsRevision || disposed) {
        return;
      }
      applySettings(settings);
    } catch {
      disableFeature();
    }
  }

  function handleStorageChange(changes, areaName) {
    if (areaName === "sync" && changes[settingsApi.STORAGE_KEY]) {
      settingsRevision += 1;
      applySettings(changes[settingsApi.STORAGE_KEY].newValue);
    }
  }

  chrome.storage.onChanged.addListener(handleStorageChange);
  globalThis.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      disposed = true;
      disableFeature();
      commandScope.dispose();
      chrome.storage.onChanged.removeListener(handleStorageChange);
    }
  });

  void start();
})();
