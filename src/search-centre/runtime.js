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
  // only sees the adapter's functions. Verified live on the 2026.1 refreshed
  // header (release preview, uif 10.0.15): the header input sits in
  // div[data-automation-id="GlobalSearchTextBox"]; its results render into a
  // body-level Popover holding [data-automation-id="GlobalSearchListBox"];
  // NetSuite keeps fetching and re-rendering that listbox even while its
  // input is BLURRED, which is what lets the modal own focus and still ride
  // the native machinery (one autosuggest.nl request per settled query,
  // debounced by NetSuite itself).
  const NATIVE_INPUT_SELECTOR = 'div[data-automation-id="GlobalSearchTextBox"] input';
  const NATIVE_LISTBOX_SELECTOR = '[data-automation-id="GlobalSearchListBox"]';
  // The classic uber search starts matching at three characters.
  const SEARCH_MIN_QUERY_LENGTH = 3;
  const RESULTS_PATH = "/app/common/search/ubersearchresults.nl";
  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement?.prototype ?? {},
    "value"
  )?.set;

  function findNativeInput() {
    return document.querySelector(NATIVE_INPUT_SELECTOR);
  }

  function findNativeListbox() {
    return document.querySelector(NATIVE_LISTBOX_SELECTOR);
  }

  function pushQueryToNative(query) {
    const input = findNativeInput();
    if (!input || !nativeValueSetter) {
      return false;
    }
    // The uif TextBox is a controlled component: the prototype setter plus a
    // bubbled input event is the combination its listeners accept (a plain
    // .value write is swallowed). The keyup nudge matches real typing;
    // measured live as the pair that makes NetSuite fetch while unfocused.
    nativeValueSetter.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));
    return true;
  }

  // Rows are li[role=option] wrapping a SearchItem: a main-link anchor whose
  // visible text is "Type: Name" (with the Edit/Dash anchors NESTED inside
  // it — invalid HTML that survives because uif builds it via DOM APIs), an
  // additional-link that is only an edit action when NetSuite labels it so,
  // and a show-more row whose href is the canonical full-results URL for the
  // current query. NetSuite caps the suggest dropdown at 8 rows by design
  // (Oracle N642700) — the mirror inherits that cap, and "View all search
  // results" carries the rest. ponytail: if the full 25-row payload is ever
  // wanted, fetch autosuggest.nl?cur_val=<q>&mapkey=uberautosuggest directly
  // instead of growing this parser.
  function parseNativeResults() {
    const listbox = findNativeListbox();
    if (!listbox) {
      return null;
    }
    const results = [];
    let seeAllHref = "";
    for (const option of listbox.querySelectorAll('li[role="option"]')) {
      const item = option.querySelector("[data-search-item-type]");
      const mainLink = option.querySelector('a[data-automation-id="main-link"]');
      if (!item || !mainLink) {
        continue;
      }
      const itemType = item.getAttribute("data-search-item-type");
      if (itemType === "show-more") {
        seeAllHref = core.sanitizeHref(mainLink.getAttribute("href"), location.origin);
        continue;
      }
      if (itemType !== "result") {
        continue;
      }
      const additional = option.querySelector('a[data-automation-id="additional-link"]');
      // Rows label themselves in two spans ("Customer:&nbsp;" + name); the
      // clone-minus-nested-links text is the fallback for rows without them.
      const description = mainLink.querySelector('[data-automation-id="link-description"]')?.textContent ?? "";
      const name = mainLink.querySelector('[data-automation-id="link-name"]')?.textContent ?? "";
      const clone = mainLink.cloneNode(true);
      for (const nested of clone.querySelectorAll('a[data-automation-id="additional-link"]')) {
        nested.remove();
      }
      const result = core.normalizeResult({
        text: description || name ? `${description}${name}` : clone.textContent,
        group: option.closest("[data-listbox-section]")?.getAttribute("data-automation-id") ?? "",
        href: mainLink.getAttribute("href"),
        editHref: /^edit\b/i.test(additional?.getAttribute("aria-label") ?? "")
          ? additional.getAttribute("href")
          : "",
        nativeIndex: option.getAttribute("data-index") ?? ""
      }, location.origin);
      if (result) {
        results.push(result);
      }
    }
    return { results, seeAllHref };
  }

  function buildResultsUrl(query) {
    try {
      const url = new URL(RESULTS_PATH, location.origin);
      url.searchParams.set("quicksearch", "T");
      url.searchParams.set("searchtype", "Uber");
      url.searchParams.set("frame", "be");
      url.searchParams.set("Uber_NAMEtype", "KEYWORDSTARTSWITH");
      url.searchParams.set("Uber_NAME", query.trim());
      return `${url.pathname}${url.search}`;
    } catch {
      return RESULTS_PATH;
    }
  }

  // Escape does not close the native popover, a body click does (both
  // measured); without this the popover would pop back into view the moment
  // the modal's hide class lifts.
  function dismissNativeDropdown() {
    if (findNativeListbox()) {
      document.body.click();
    }
  }
  // ===== End of native adapter =====

  const OPEN_CLASS = "suitemate-v3-sc-open";
  const REOPEN_SUPPRESS_MS = 400;
  const PENDING_TIMEOUT_MS = 5000;
  const svgNamespace = "http" + "://www.w3.org/2000/svg";

  let enabled = false;
  let disposed = false;
  let settingsRevision = 0;
  let suppressOpenUntil = 0;
  let resultsObserver = null;
  let pendingTimer = 0;
  let modal = null;
  const state = {
    open: false,
    query: "",
    category: "all",
    results: [],
    seeAllHref: "",
    pending: false,
    everParsed: false,
    selectedIndex: 0,
    focusBounces: 0,
    navigating: false,
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
      return result.href ? "Open page" : "Show on page";
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
      if (!state.navigating) {
        setQuery(input.value);
      }
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
      input.value = "";
      setQuery("");
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
    allLink.addEventListener("click", (event) => {
      if (navigatesInPlace(event)) {
        showNavigating("Opening all search results…");
      }
    });
    footer.append(navigateHint, openHint, closeHint, allLink);

    // Navigation veil: record pages can take seconds to answer, and a modal
    // that simply vanishes on click reads as a freeze. The veil holds the
    // dialog with an immediate "Opening …" status until the new page's
    // unload sweeps everything away; Escape still bails out underneath it.
    const veil = createElement("div", "suitemate-v3-sc-veil");
    veil.hidden = true;
    veil.setAttribute("role", "status");
    veil.setAttribute("aria-live", "polite");
    veil.append(createElement("div", "suitemate-v3-sc-spinner"));
    const veilLabel = createElement("span", "suitemate-v3-sc-veil-label");
    veil.append(veilLabel);
    veil.append(createElement("span", "suitemate-v3-sc-veil-hint", "Press Esc to dismiss"));
    dialog.append(header, body, footer, veil);
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
      allLink,
      veil,
      veilLabel
    };
  }

  function showNavigating(label) {
    state.navigating = true;
    modal.veilLabel.textContent = label;
    modal.veil.hidden = false;
  }

  // Modified clicks open a new tab — THIS page never navigates, so a veil
  // would sit there "Opening…" forever.
  function navigatesInPlace(event) {
    return event.button === 0
      && !event.metaKey
      && !event.ctrlKey
      && !event.shiftKey
      && !event.altKey;
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
    if (state.navigating) {
      event.preventDefault();
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
      const result = selectedResult();
      if (result) {
        openResult(result);
      } else if (state.query.trim().length >= SEARCH_MIN_QUERY_LENGTH) {
        // No suggestions (Auto Suggest preference off, timeout, or zero
        // matches): Enter falls through to the full results page so the
        // search never dead-ends.
        showNavigating("Opening all search results…");
        location.assign(state.seeAllHref || buildResultsUrl(state.query));
      }
    }
  }

  function openResult(result) {
    if (state.navigating) {
      return;
    }
    if (result?.href) {
      showNavigating(`Opening ${result.title}…`);
      location.assign(result.href);
      return;
    }
    if (result?.nativeIndex) {
      // Hrefless current-page rows (field jumps) only navigate through
      // NetSuite's own click handler — click the hidden native row first,
      // which also unmounts the popover, then fold the modal away.
      findNativeListbox()
        ?.querySelector(`li[data-index="${CSS.escape(result.nativeIndex)}"] a[data-automation-id="main-link"]`)
        ?.click();
      closeSearchCentre({ restoreFocus: false });
    }
  }

  function clearPendingTimer() {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = 0;
    }
  }

  function setQuery(query) {
    state.query = query;
    state.selectedIndex = 0;
    // Old rows must never masquerade as answers for the new query.
    state.results = [];
    state.seeAllHref = "";
    state.everParsed = false;
    clearPendingTimer();
    const searching = query.trim().length >= SEARCH_MIN_QUERY_LENGTH;
    state.pending = pushQueryToNative(query) && searching;
    if (state.pending) {
      // If NetSuite never re-renders (offline, throttled), fall out of the
      // skeleton into the empty state instead of shimmering forever.
      pendingTimer = setTimeout(() => {
        pendingTimer = 0;
        state.pending = false;
        render();
      }, PENDING_TIMEOUT_MS);
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
    clearPendingTimer();
    state.results = parsed.results;
    state.seeAllHref = parsed.seeAllHref;
    state.pending = false;
    state.everParsed = true;
    if (core.filterByCategory(parsed.results, state.category).length === 0) {
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
    const open = createElement(result.href ? "a" : "button", "suitemate-v3-sc-open-action");
    if (result.href) {
      open.href = result.href;
      open.addEventListener("click", (event) => {
        if (navigatesInPlace(event)) {
          showNavigating(`Opening ${result.title}…`);
        }
      });
    } else {
      open.type = "button";
      open.addEventListener("click", () => openResult(result));
    }
    open.append(createElement("span", "", primaryActionLabel(result)), createSvgIcon("external"));
    actions.append(open);
    if (result.editHref) {
      const edit = createElement("a", "suitemate-v3-sc-edit-action");
      edit.href = result.editHref;
      edit.append(createElement("span", "", "Edit"), createSvgIcon("edit"));
      edit.addEventListener("click", (event) => {
        if (navigatesInPlace(event)) {
          showNavigating(`Opening ${result.title} to edit…`);
        }
      });
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
      // everParsed distinguishes a real empty answer from NetSuite never
      // rendering at all (Auto Suggest preference off, or the timeout).
      list.append(state.everParsed
        ? renderMessage(
          `No results found for “${trimmedQuery}”`,
          "Try a different phrase, or press Enter to open all search results."
        )
        : renderMessage(
          "Suggestions are not available",
          "Press Enter to open all search results."
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
    modal.allLink.href = state.seeAllHref || buildResultsUrl(state.query);
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
    state.category = "all";
    state.focusBounces = 0;
    state.navigating = false;
    modal.veil.hidden = true;
    document.documentElement.classList.add(OPEN_CLASS);
    document.body.append(modal.overlay);
    resultsObserver = new MutationObserver((records) => {
      // The modal's own re-renders land in this observer too; reacting to
      // them would render forever. Only NetSuite-side mutations count.
      if (records.every((record) => modal.overlay.contains(record.target))) {
        return;
      }
      syncResultsFromNative();
    });
    resultsObserver.observe(document.body, { childList: true, subtree: true });
    const query = options.query ?? nativeInput.value ?? "";
    modal.input.value = query;
    setQuery(query);
    syncResultsFromNative();
    // NetSuite's TextBox re-asserts focus into its own input after the
    // triggering event finishes; the deferred grab (the same 60ms the
    // Recent Records panel uses) runs after uif's focus pass and wins.
    const grabFocus = () => {
      if (!state.open) {
        return;
      }
      modal.input.focus();
      modal.input.setSelectionRange(modal.input.value.length, modal.input.value.length);
    };
    grabFocus();
    setTimeout(grabFocus, 60);
  }

  function closeSearchCentre(options = {}) {
    if (!state.open) {
      return;
    }
    state.open = false;
    state.navigating = false;
    if (modal) {
      modal.veil.hidden = true;
    }
    suppressOpenUntil = Date.now() + REOPEN_SUPPRESS_MS;
    clearPendingTimer();
    resultsObserver?.disconnect();
    resultsObserver = null;
    dismissNativeDropdown();
    modal?.overlay.remove();
    document.documentElement.classList.remove(OPEN_CLASS);
    if (options.restoreFocus !== false) {
      const target = state.opener?.isConnected ? state.opener : findNativeInput();
      target?.focus?.();
    }
    state.opener = null;
  }

  // Focusing or typing in the native box routes into the centre; the native
  // dropdown never gets a chance to unfold while the feature is on.
  function handleNativeIntent(event) {
    if (!enabled) {
      return;
    }
    const target = event.target;
    if (target?.nodeType !== Node.ELEMENT_NODE || !target.matches?.(NATIVE_INPUT_SELECTOR)) {
      return;
    }
    if (state.open) {
      // uif re-asserts focus into its own input well after the events that
      // opened the centre (measured: past the 60ms grab). Bounce it back on
      // the next tick — bounded so a pathological widget can never turn
      // this into a focus tug-of-war.
      if (event.type === "focusin" && state.focusBounces < 10) {
        state.focusBounces += 1;
        setTimeout(() => {
          if (state.open) {
            modal?.input.focus();
          }
        }, 0);
      }
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
