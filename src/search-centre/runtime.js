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
  // header (release preview, uif 10.0.15). Two data paths share the work:
  // records and files come from OUR direct autosuggest.nl fetch (NetSuite's
  // own endpoint, on our 150ms debounce instead of uif's 500ms — ~350ms
  // faster per query — and carrying the full 25-row payload instead of the
  // dropdown's 8-row display cap); "Current Page Results" (menus and field
  // jumps) are computed client-side inside uif and never appear in that
  // payload, so the hidden native dropdown is still ridden for exactly that
  // group: query pushed into div[data-automation-id="GlobalSearchTextBox"]'s
  // input, rows read back from the body-level Popover holding
  // [data-automation-id="GlobalSearchListBox"], which keeps re-rendering
  // even while its input is blurred.
  const NATIVE_INPUT_SELECTOR = 'div[data-automation-id="GlobalSearchTextBox"] input';
  const NATIVE_LISTBOX_SELECTOR = '[data-automation-id="GlobalSearchListBox"]';
  // The classic uber search starts matching at three characters.
  const SEARCH_MIN_QUERY_LENGTH = 3;
  const RESULTS_PATH = "/app/common/search/ubersearchresults.nl";
  // The suggest endpoint, exactly as the native dropdown calls it (verified
  // live: plain same-origin GET, no CSRF token, JSON body behind a lying
  // text/html Content-Type).
  const AUTOSUGGEST_PATH = "/app/common/autosuggest.nl";
  const FETCH_DEBOUNCE_MS = 150;
  const MAX_RESPONSE_BYTES = 2_000_000;
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
    if (input.value === query) {
      // The setter bypasses uif's value tracker, so re-writing an identical
      // value would still fire its onChange and restart the 500ms debounce
      // for nothing (worst on open, where the seed equals the native value).
      return true;
    }
    // The uif TextBox is a controlled component: the prototype setter plus a
    // bubbled input event is the combination its listeners accept (a plain
    // .value write is swallowed). The input event ALONE arms the 500ms
    // trailing debounce — measured identical to real typing (Δ~500ms).
    nativeValueSetter.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  // Only the pageSearch group is mirrored now (the fetch owns the rest).
  // Rows are li[role=option] wrapping a SearchItem: a main-link anchor whose
  // visible text is "Type: Name" (with any secondary anchors NESTED inside
  // it — invalid HTML that survives because uif builds it via DOM APIs); an
  // additional-link counts as an edit action only when NetSuite labels it
  // so; field-jump rows carry no href and are opened through their native
  // row index.
  function parseNativePageResults() {
    const listbox = findNativeListbox();
    if (!listbox) {
      return null;
    }
    const results = [];
    for (const option of listbox.querySelectorAll('[data-automation-id="pageSearch"] li[role="option"]')) {
      const item = option.querySelector("[data-search-item-type]");
      const mainLink = option.querySelector('a[data-automation-id="main-link"]');
      if (!item || !mainLink || item.getAttribute("data-search-item-type") !== "result") {
        continue;
      }
      const additional = option.querySelector('a[data-automation-id="additional-link"]');
      // Rows label themselves in two spans ("Menu:&nbsp;" + name); only
      // rows without them pay for the clone-minus-nested-links fallback.
      const description = mainLink.querySelector('[data-automation-id="link-description"]')?.textContent ?? "";
      const name = mainLink.querySelector('[data-automation-id="link-name"]')?.textContent ?? "";
      let text = `${description}${name}`;
      if (!text) {
        const clone = mainLink.cloneNode(true);
        for (const nested of clone.querySelectorAll('a[data-automation-id="additional-link"]')) {
          nested.remove();
        }
        text = clone.textContent;
      }
      const result = core.normalizeResult({
        text,
        group: "pageSearch",
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
    return results;
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
  let pushFrame = 0;
  let fetchTimer = 0;
  let fetchController = null;
  let fetchSequence = 0;
  let modal = null;
  const state = {
    open: false,
    query: "",
    category: "all",
    // results is always the merge: fetched records/files first, then the
    // mirrored current-page rows — the same order the native dropdown uses.
    results: [],
    fetchedResults: [],
    pageResults: [],
    pageSignature: "",
    pending: false,
    // "The current query got an answer" — real empty answers read as
    // "No results found", never-answered reads as "Suggestions unavailable".
    everParsed: false,
    selectedIndex: 0,
    focusBounces: 0,
    navigating: false,
    transactionMenu: false,
    transactionTypeIndex: 0,
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
    } else if (name === "person") {
      add("path", { d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" });
      add("circle", { cx: "12", cy: "7", r: "4" });
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
    } else if (name === "bolt") {
      add("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" });
    } else if (name === "chevron") {
      add("polyline", { points: "9 18 15 12 9 6" });
    } else {
      add("circle", { cx: "12", cy: "12", r: "9" });
    }
    return svg;
  }

  const CATEGORY_ICONS = Object.freeze({
    all: "search",
    customers: "person",
    records: "record",
    files: "file",
    navigation: "list"
  });

  const flatTransactionTypes = core.TRANSACTION_MENU.flatMap((group) =>
    group.types.map((type) => Object.freeze({ ...type, group: group.group })));

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
        state.transactionMenu = false;
        state.category = category.id;
        state.selectedIndex = 0;
        render();
      });
      filterButtons[category.id] = { filter, count };
      rail.append(filter);
    }
    rail.append(createElement("div", "suitemate-v3-sc-rail-divider"));
    rail.append(createElement("h3", "suitemate-v3-sc-rail-heading", "Quick access"));
    const transactionMenuButton = createElement("button", "suitemate-v3-sc-filter suitemate-v3-sc-quick");
    transactionMenuButton.type = "button";
    const quickIcon = createElement("span", "suitemate-v3-sc-quick-icon");
    quickIcon.setAttribute("aria-hidden", "true");
    quickIcon.append(createSvgIcon("bolt"));
    transactionMenuButton.append(
      quickIcon,
      createElement("span", "suitemate-v3-sc-filter-label", "Transaction Menu"),
      createSvgIcon("chevron", "suitemate-v3-sc-chevron")
    );
    transactionMenuButton.addEventListener("click", () => {
      state.transactionMenu = true;
      state.transactionTypeIndex = 0;
      render();
    });
    rail.append(transactionMenuButton);

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
      if (isPlainActivation(event)) {
        enterNavigatingState(null, "Opening all search results…");
      }
    });
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
      transactionMenuButton,
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
    if (state.navigating) {
      // The loading surface owns the dialog: only Escape acts.
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
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (state.transactionMenu) {
        const total = flatTransactionTypes.length;
        state.transactionTypeIndex = (state.transactionTypeIndex + direction + total) % total;
        renderTransactionSelection({ revealSelection: true });
        return;
      }
      const total = filteredResults().length;
      if (total === 0) {
        return;
      }
      state.selectedIndex = (state.selectedIndex + direction + total) % total;
      renderSelection({ revealSelection: true });
      return;
    }
    if (event.key === "Enter" && event.target === modal.input) {
      event.preventDefault();
      if (state.transactionMenu) {
        const type = flatTransactionTypes[state.transactionTypeIndex];
        const urls = type ? core.transactionUrls(type) : null;
        if (urls) {
          transactionNavigate(urls.newUrl, `Opening new ${type.label}…`);
        }
        return;
      }
      const result = selectedResult();
      if (result) {
        openResult(result);
      } else if (state.query.trim().length >= SEARCH_MIN_QUERY_LENGTH) {
        // No suggestions (Auto Suggest preference off, timeout, or zero
        // matches): Enter falls through to the full results page so the
        // search never dead-ends.
        closeSearchCentre({ restoreFocus: false });
        location.assign(buildResultsUrl(state.query));
      }
    }
  }

  // The dialog stays visible as the loading surface until NetSuite's next
  // page replaces it — closing instantly left the stale page on screen with
  // zero feedback, which read as a freeze on slow loads. Escape (or a
  // backdrop click) still dismisses the overlay; the navigation itself is
  // the browser's and continues untouched either way.
  function enterNavigatingState(result, label) {
    if (!modal || state.navigating) {
      return;
    }
    state.navigating = true;
    const cover = createElement("div", "suitemate-v3-sc-navigating");
    cover.setAttribute("role", "status");
    cover.setAttribute("aria-live", "polite");
    const icon = createElement(
      "span",
      `suitemate-v3-sc-row-icon suitemate-v3-sc-tint-${result?.category ?? "navigation"}`
    );
    icon.setAttribute("aria-hidden", "true");
    icon.append(createSvgIcon(CATEGORY_ICONS[result?.category] ?? "search"));
    cover.append(
      icon,
      createElement("strong", "suitemate-v3-sc-navigating-title", label),
      createElement("div", "suitemate-v3-sc-progress"),
      createElement("span", "suitemate-v3-sc-navigating-hint", "NetSuite is loading — press Esc to dismiss")
    );
    modal.dialog.setAttribute("aria-busy", "true");
    modal.dialog.append(cover);
    modal.navigatingCover = cover;
  }

  // Modified clicks (new tab, window) belong to the browser: no loading
  // surface, the modal stays where it is.
  function isPlainActivation(event) {
    return event.button === 0
      && !event.metaKey
      && !event.ctrlKey
      && !event.shiftKey
      && !event.altKey;
  }

  function openResult(result) {
    if (state.navigating) {
      return;
    }
    if (result?.href) {
      enterNavigatingState(result, `Opening ${result.title}…`);
      location.assign(result.href);
      return;
    }
    if (result?.nativeIndex) {
      // Hrefless current-page rows (field jumps) only navigate through
      // NetSuite's own click handler — click the hidden native row first,
      // which also unmounts the popover, then fold the modal away. Same-page
      // jumps are instant, so no loading surface here.
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

  function cancelSuggestFetch() {
    if (fetchTimer) {
      clearTimeout(fetchTimer);
      fetchTimer = 0;
    }
    fetchController?.abort("superseded");
    fetchController = null;
  }

  async function fetchSuggestions(query) {
    const controller = new AbortController();
    fetchController = controller;
    try {
      const url = new URL(AUTOSUGGEST_PATH, location.origin);
      url.searchParams.set("cur_val", query);
      url.searchParams.set("mapkey", "uberautosuggest");
      url.searchParams.set("circid", String(++fetchSequence));
      const response = await fetch(`${url.pathname}${url.search}`, {
        credentials: "include",
        signal: controller.signal
      });
      const responseUrl = new URL(response.url, location.origin);
      if (
        !response.ok
        || responseUrl.origin !== location.origin
        || responseUrl.pathname !== AUTOSUGGEST_PATH
      ) {
        throw new Error("Unexpected autosuggest response.");
      }
      const body = await response.text();
      if (body.length > MAX_RESPONSE_BYTES) {
        throw new Error("Autosuggest response exceeded the supported size.");
      }
      const autofill = JSON.parse(body)?.autofill;
      if (!state.open || query !== state.query.trim()) {
        return;
      }
      clearPendingTimer();
      state.pending = false;
      state.everParsed = true;
      state.fetchedResults = (Array.isArray(autofill) ? autofill : [])
        .map((entry) => core.fromAutofill(entry, location.origin))
        .filter(Boolean);
      commitResults();
    } catch {
      if (controller.signal.aborted || !state.open || query !== state.query.trim()) {
        return;
      }
      // Failed fetch (offline, endpoint changed): everParsed stays false so
      // the empty state reads "Suggestions are not available" and Enter
      // still reaches the full results page.
      clearPendingTimer();
      state.pending = false;
      render();
    } finally {
      if (fetchController === controller) {
        fetchController = null;
      }
    }
  }

  function commitResults() {
    state.results = [...state.fetchedResults, ...state.pageResults];
    if (
      state.category !== "all"
      && core.filterByCategory(state.results, state.category).length === 0
    ) {
      state.category = "all";
    }
    state.selectedIndex = Math.min(
      state.selectedIndex,
      Math.max(0, filteredResults().length - 1)
    );
    render();
  }

  function setQuery(query) {
    state.query = query;
    state.selectedIndex = 0;
    // Typing is search intent: leave the transaction browser.
    state.transactionMenu = false;
    clearPendingTimer();
    cancelSuggestFetch();
    const trimmed = query.trim();
    const searching = trimmed.length >= SEARCH_MIN_QUERY_LENGTH;
    // The native ride survives only for "Current Page Results": the push
    // runs one frame later so the typed character paints before uif's
    // synchronous input pipeline (heavy on SuiteApp-laden pages) sees it.
    if (pushFrame) {
      cancelAnimationFrame(pushFrame);
    }
    pushFrame = requestAnimationFrame(() => {
      pushFrame = 0;
      pushQueryToNative(query);
    });
    if (!searching) {
      state.results = [];
      state.fetchedResults = [];
      state.pageResults = [];
      state.pageSignature = "";
      state.everParsed = false;
      state.pending = false;
      render();
      return;
    }
    // Previous rows stay on screen while the fetch runs (native-dropdown
    // behaviour); the timeout is the fail-out for a request that never
    // answers.
    state.pending = true;
    fetchTimer = setTimeout(() => {
      fetchTimer = 0;
      void fetchSuggestions(trimmed);
    }, FETCH_DEBOUNCE_MS);
    pendingTimer = setTimeout(() => {
      pendingTimer = 0;
      state.pending = false;
      render();
    }, PENDING_TIMEOUT_MS);
    render();
  }

  function syncResultsFromNative() {
    if (!state.open || state.query.trim().length < SEARCH_MIN_QUERY_LENGTH) {
      return;
    }
    // The listbox must belong to the query the modal is showing: during the
    // focus-steal window the native input runs its own search for whatever
    // it briefly held, and adopting that render flip-flopped the list with
    // results that didn't match the visible query.
    if (findNativeInput()?.value.trim() !== state.query.trim()) {
      return;
    }
    const parsed = parseNativePageResults();
    if (parsed === null) {
      return;
    }
    const signature = JSON.stringify(parsed);
    if (signature === state.pageSignature) {
      // Identical listbox re-render — nothing to redraw. Skipping keeps
      // busy pages from rebuilding the modal for no visible change.
      return;
    }
    state.pageSignature = signature;
    state.pageResults = parsed;
    commitResults();
  }

  // Selection moves must not rebuild the list: replaceChildren() destroyed
  // the hovered row mid-hover (restarting its background transition — a
  // visible flicker) and made held arrow keys rebuild per repeat.
  function renderSelection(options = {}) {
    if (!modal) {
      return;
    }
    const rows = [...modal.list.querySelectorAll(".suitemate-v3-sc-row")];
    for (const [index, row] of rows.entries()) {
      row.classList.toggle("is-selected", index === state.selectedIndex);
      row.setAttribute("aria-selected", String(index === state.selectedIndex));
    }
    const selected = selectedResult();
    if (selected) {
      modal.input.setAttribute("aria-activedescendant", `suitemate-v3-sc-option-${state.selectedIndex}`);
    } else {
      modal.input.removeAttribute("aria-activedescendant");
    }
    renderPreview(selected);
    if (options.revealSelection) {
      modal.list.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
    }
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
        if (isPlainActivation(event)) {
          enterNavigatingState(result, `Opening ${result.title}…`);
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
        if (isPlainActivation(event)) {
          enterNavigatingState(result, `Editing ${result.title}…`);
        }
      });
      actions.append(edit);
    }
    preview.append(actions);
  }

  // ===== Transaction Menu (Quick Access) =====

  function transactionNavigate(url, label) {
    enterNavigatingState(null, label);
    location.assign(url);
  }

  function renderTransactionPanel() {
    const type = flatTransactionTypes[state.transactionTypeIndex];
    const preview = modal.preview;
    preview.replaceChildren();
    if (!type) {
      preview.hidden = true;
      return;
    }
    preview.hidden = false;
    preview.append(createElement("span", "suitemate-v3-sc-chip", type.group));
    const icon = createElement(
      "span",
      "suitemate-v3-sc-row-icon suitemate-v3-sc-tint-records suitemate-v3-sc-panel-icon"
    );
    icon.setAttribute("aria-hidden", "true");
    icon.append(createSvgIcon("record"));
    preview.append(icon);
    preview.append(createElement("h3", "suitemate-v3-sc-preview-title", type.label));
    preview.append(createElement("p", "suitemate-v3-sc-preview-meta", "Choose what you want to do"));
    const urls = core.transactionUrls(type);
    if (!urls) {
      return;
    }
    const actions = createElement("div", "suitemate-v3-sc-preview-actions");
    const create = createElement("a", "suitemate-v3-sc-open-action");
    create.href = urls.newUrl;
    create.append(createElement("span", "", `New ${type.label}`), createSvgIcon("external"));
    create.addEventListener("click", (event) => {
      if (isPlainActivation(event)) {
        enterNavigatingState(null, `Opening new ${type.label}…`);
      }
    });
    const listAction = createElement("a", "suitemate-v3-sc-edit-action");
    listAction.href = urls.listUrl;
    listAction.append(createElement("span", "", `${type.label} List`), createSvgIcon("list"));
    listAction.addEventListener("click", (event) => {
      if (isPlainActivation(event)) {
        enterNavigatingState(null, `Opening ${type.label} list…`);
      }
    });
    actions.append(create, listAction);
    preview.append(actions);
  }

  function renderTransactionSelection(options = {}) {
    const rows = [...modal.list.querySelectorAll(".suitemate-v3-sc-type-row")];
    for (const [index, row] of rows.entries()) {
      row.classList.toggle("is-selected", index === state.transactionTypeIndex);
    }
    renderTransactionPanel();
    if (options.revealSelection) {
      modal.list.querySelector(".suitemate-v3-sc-type-row.is-selected")
        ?.scrollIntoView({ block: "nearest" });
    }
  }

  function renderTransactionBrowser() {
    const list = modal.list;
    list.replaceChildren();
    modal.resultsLabel.hidden = false;
    modal.resultsLabel.textContent = "Transactions";
    modal.input.removeAttribute("aria-activedescendant");
    let index = 0;
    for (const group of core.TRANSACTION_MENU) {
      list.append(createElement("h3", "suitemate-v3-sc-results-label", group.group));
      for (const type of group.types) {
        const rowIndex = index;
        const row = createElement("button", "suitemate-v3-sc-row suitemate-v3-sc-type-row");
        row.type = "button";
        if (rowIndex === state.transactionTypeIndex) {
          row.classList.add("is-selected");
        }
        const icon = createElement(
          "span",
          "suitemate-v3-sc-row-icon suitemate-v3-sc-tint-records"
        );
        icon.setAttribute("aria-hidden", "true");
        icon.append(createSvgIcon("record"));
        const text = createElement("div", "suitemate-v3-sc-row-text");
        text.append(createElement("span", "suitemate-v3-sc-row-title", type.label));
        row.append(icon, text, createSvgIcon("chevron", "suitemate-v3-sc-chevron"));
        row.addEventListener("click", () => {
          state.transactionTypeIndex = rowIndex;
          renderTransactionSelection();
        });
        row.addEventListener("mouseenter", () => {
          if (state.transactionTypeIndex !== rowIndex) {
            state.transactionTypeIndex = rowIndex;
            renderTransactionSelection();
          }
        });
        list.append(row);
        index += 1;
      }
    }
    renderTransactionPanel();
    modal.allLink.href = buildResultsUrl(state.query);
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
      filter.setAttribute(
        "aria-selected",
        String(!state.transactionMenu && state.category === category.id)
      );
    }
    modal.transactionMenuButton.classList.toggle("is-active", state.transactionMenu);
    if (state.transactionMenu) {
      renderTransactionBrowser();
      return;
    }
    modal.resultsLabel.textContent = "Top results";

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
    } else if (state.pending && visible.length === 0) {
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
        // One click opens, exactly like the native dropdown: rows with hrefs
        // are real anchors carrying NetSuite's own URLs, so the browser (and
        // middle/modified clicks) handle navigation natively; hover keeps
        // the preview in sync, so nothing needs a selection click first.
        const row = createElement(result.href ? "a" : "div", "suitemate-v3-sc-row");
        if (result.href) {
          row.href = result.href;
        }
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
        row.addEventListener("click", (event) => {
          state.selectedIndex = index;
          if (!isPlainActivation(event)) {
            renderSelection();
            return;
          }
          if (result.href) {
            enterNavigatingState(result, `Opening ${result.title}…`);
          } else {
            openResult(result);
          }
        });
        row.addEventListener("mouseenter", () => {
          if (state.selectedIndex !== index) {
            state.selectedIndex = index;
            renderSelection();
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
    modal.allLink.href = buildResultsUrl(state.query);
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
    state.transactionMenu = false;
    state.transactionTypeIndex = 0;
    state.results = [];
    state.fetchedResults = [];
    state.pageResults = [];
    state.pageSignature = "";
    state.pending = false;
    state.everParsed = false;
    document.documentElement.classList.add(OPEN_CLASS);
    stampNativePopover();
    document.body.append(modal.overlay);
    resultsObserver = new MutationObserver((records) => {
      // Busy pages (SuiteApps, refreshing portlets) mutate the body
      // constantly; only the native popover's own re-renders are search
      // signal. Anything else — including the modal's own renders — would
      // rebuild the modal mid-keystroke for nothing.
      const popover = stampNativePopover();
      const relevant = popover
        ? records.some((record) => popover.contains(record.target))
        : records.some((record) => [...record.addedNodes].some((node) =>
          node.nodeType === Node.ELEMENT_NODE
          && (node.matches?.('[data-widget="Popover"]') || node.querySelector?.(NATIVE_LISTBOX_SELECTOR))));
      if (relevant) {
        syncResultsFromNative();
      }
    });
    resultsObserver.observe(document.body, { childList: true, subtree: true });
    const query = options.query ?? nativeInput.value ?? "";
    modal.input.value = query;
    setQuery(query);
    syncResultsFromNative();
    grabModalFocus();
    setTimeout(grabModalFocus, 60);
  }

  // NetSuite's TextBox re-asserts focus into its own input after the
  // triggering event finishes; the deferred grab (the same 60ms the Recent
  // Records panel uses) runs after uif's focus pass and wins. Keystrokes
  // that landed in the native box during the steal window are the user's
  // query — adopt them instead of dropping them.
  function grabModalFocus() {
    if (!state.open || !modal) {
      return;
    }
    const nativeInput = findNativeInput();
    // Adopt on value divergence alone — waiting for activeElement missed
    // steals that ended before this tick. The pushFrame guard keeps a
    // just-typed modal query (push still in flight) from being clobbered
    // by the older native value.
    if (nativeInput && !pushFrame && nativeInput.value !== state.query) {
      modal.input.value = nativeInput.value;
      setQuery(nativeInput.value);
    }
    modal.input.focus();
    modal.input.setSelectionRange(modal.input.value.length, modal.input.value.length);
  }

  function closeSearchCentre(options = {}) {
    if (!state.open) {
      return;
    }
    state.open = false;
    state.navigating = false;
    suppressOpenUntil = Date.now() + REOPEN_SUPPRESS_MS;
    clearPendingTimer();
    cancelSuggestFetch();
    if (pushFrame) {
      cancelAnimationFrame(pushFrame);
      pushFrame = 0;
    }
    resultsObserver?.disconnect();
    resultsObserver = null;
    dismissNativeDropdown();
    if (modal) {
      modal.navigatingCover?.remove();
      modal.navigatingCover = null;
      modal.dialog.removeAttribute("aria-busy");
    }
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
        setTimeout(grabModalFocus, 0);
      }
      return;
    }
    openSearchCentre({ opener: target, query: target.value });
  }

  // Belt for the CSS hide: the data-system-search attribute selector could
  // silently stop matching if Oracle drops it; this class derives from the
  // same listbox anchor the parser depends on, so both would break loudly
  // together instead of the popover quietly reappearing.
  function stampNativePopover() {
    const popover = findNativeListbox()?.closest('[data-widget="Popover"]');
    popover?.classList.add("suitemate-v3-sc-native-popover");
    return popover;
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
