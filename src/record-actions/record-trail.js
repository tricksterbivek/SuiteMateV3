(function initializeSuiteMateV3RecordTrail(globalScope) {
  "use strict";

  const bridgeApi = globalScope.SuiteMateV3Bridge;
  const browserApi = globalScope.SuiteMateV3BrowserUtilities;
  const commandApi = globalScope.SuiteMateV3Commands;
  const lifecycleApi = globalScope.SuiteMateV3Lifecycle;
  const routeApi = globalScope.SuiteMateV3Routes;
  const settingsApi = globalScope.SuiteMateV3Settings;
  if (
    !bridgeApi
    || !browserApi
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

  try {
    if (globalScope !== globalScope.top) {
      return;
    }
  } catch {
    return;
  }

  const ACTION_SELECTOR = '[data-suitemate-v3-action="record-trail"]';
  const OVERLAY_SELECTOR = '[data-suitemate-v3-ui="record-trail"]';
  const TOOLS_MENU_SELECTOR = '[data-suitemate-v3-menu="tools-actions"]';
  const TOOLS_TRIGGER_SELECTOR = '[data-suitemate-v3-action="tools-trigger"]';
  const TOP_TOOLBAR_SELECTOR = ".uir-buttons-top.uir-header-buttons";
  const recordTrailCommand = commandApi.IDS.RECORD_SHOW_TRAIL;
  let currentSettings = null;
  let settingsRevision = 0;
  let activeView = null;

  function pageContext() {
    return routeApi.createPageContext(globalScope.location, {
      isTopFrame: true,
      trustedContentScript: true
    });
  }

  const commandScope = commandApi.createScope(commandApi.SURFACES.RECORD, {
    getContext: () => ({ pageContext: pageContext(), settings: currentSettings }),
    onError: ({ error }) => {
      globalScope.console?.error("SuiteMate V3 Record Trail command failed.", error);
    }
  });
  commandScope.register(recordTrailCommand, {
    run: ({ payload }) => openRecordTrail(payload?.trigger ?? null)
  });

  function notify(message, type) {
    globalScope.SuiteMateV3Notifications?.showToast?.(message, { type });
  }

  function closeRecordTrail(restoreFocus = true) {
    const view = activeView;
    if (!view) {
      return false;
    }
    activeView = null;
    view.controller?.abort("closed");
    // close() restores focus to the opener natively; restoreFocus only
    // documents the teardown callers where the page is going away anyway.
    void restoreFocus;
    view.overlay.close?.();
    globalScope.document.body.classList?.remove?.("suitemate-v3-record-trail-open");
    view.clipboard.dispose();
    view.overlay.remove();
    return true;
  }

  function renderState(view, message, type = "status") {
    const state = globalScope.document.createElement("p");
    state.className = `suitemate-v3-record-trail-state is-${type}`;
    state.setAttribute("role", type === "error" ? "alert" : "status");
    state.textContent = message;
    view.body.replaceChildren(state);
  }

  function createRecordCard(view, transaction, current) {
    const card = globalScope.document.createElement("article");
    const heading = globalScope.document.createElement("div");
    const type = globalScope.document.createElement("span");
    const number = globalScope.document.createElement("strong");
    const meta = globalScope.document.createElement("p");
    const status = globalScope.document.createElement("p");
    const footer = globalScope.document.createElement("footer");
    const copy = globalScope.document.createElement("button");

    card.className = `suitemate-v3-record-trail-card${current ? " is-current" : ""}`;
    heading.className = "suitemate-v3-record-trail-card-heading";
    type.textContent = transaction.type || transaction.typeName || "Transaction";
    number.textContent = transaction.tranId || `#${transaction.id}`;
    heading.append(type, number);

    meta.className = "suitemate-v3-record-trail-meta";
    meta.textContent = [transaction.typeName || transaction.type, transaction.tranDate]
      .filter(Boolean)
      .join(" · ");
    status.className = "suitemate-v3-record-trail-status";
    status.textContent = transaction.status;

    footer.className = "suitemate-v3-record-trail-footer";
    copy.type = "button";
    copy.textContent = `#${transaction.id}`;
    copy.title = `Copy Internal ID ${transaction.id}`;
    copy.addEventListener("click", async () => {
      const result = await view.clipboard.writeText(transaction.id);
      notify(
        result.ok ? `Internal ID ${transaction.id} copied.` : result.error.message,
        result.ok ? "success" : "error"
      );
    });
    footer.append(copy);

    if (!current) {
      const open = globalScope.document.createElement("a");
      const url = new URL("/app/accounting/transactions/transaction.nl", globalScope.location.origin);
      url.searchParams.set("id", transaction.id);
      open.href = url.href;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.textContent = "Open";
      open.title = `Open ${number.textContent} in a new tab`;
      footer.append(open);
    }

    card.append(heading);
    if (meta.textContent) {
      card.append(meta);
    }
    if (status.textContent) {
      card.append(status);
    }
    card.append(footer);
    return card;
  }

  function createColumn(view, title, transactions, emptyMessage, current = false) {
    const section = globalScope.document.createElement("section");
    const heading = globalScope.document.createElement("h3");
    const count = globalScope.document.createElement("span");
    section.className = `suitemate-v3-record-trail-column${current ? " is-current" : ""}`;
    heading.textContent = title;
    if (!current) {
      count.textContent = String(transactions.length);
      count.setAttribute("aria-label", `${transactions.length} transactions`);
      heading.append(count);
    }
    section.append(heading);
    if (!transactions.length) {
      const empty = globalScope.document.createElement("p");
      empty.className = "suitemate-v3-record-trail-empty";
      empty.textContent = emptyMessage;
      section.append(empty);
    } else {
      transactions.forEach((transaction) => {
        section.append(createRecordCard(view, transaction, current));
      });
    }
    return section;
  }

  function renderTrail(view, trail) {
    const grid = globalScope.document.createElement("div");
    grid.className = "suitemate-v3-record-trail-grid";
    grid.append(
      createColumn(view, "Sources", trail.sources, "No direct source transactions found."),
      createColumn(view, "You are here", [trail.current], "Current transaction unavailable.", true),
      createColumn(
        view,
        "Targets",
        trail.targets,
        "This record doesn't generate any direct target transactions yet."
      )
    );
    view.body.replaceChildren(grid);
  }

  async function loadRecordTrail(view) {
    view.controller?.abort("refreshed");
    const controller = new AbortController();
    view.controller = controller;
    renderState(view, "Loading direct transaction links…", "loading");
    try {
      const response = await bridgeApi.request(
        bridgeApi.COMMANDS.RECORD_GET_TRAIL,
        {},
        { signal: controller.signal, timeoutMs: 125000 }
      );
      if (controller.signal.aborted || activeView !== view) {
        return;
      }
      const result = bridgeApi.toCommandResult(response);
      if (!result.ok) {
        throw result.error;
      }
      renderTrail(view, result);
    } catch (error) {
      if (controller.signal.aborted || activeView !== view) {
        return;
      }
      const permissionDenied = /permission|privilege|access/i.test(
        `${error?.code ?? ""} ${error?.message ?? ""}`
      );
      renderState(
        view,
        permissionDenied
          ? "Your NetSuite role cannot read transaction links."
          : String(error?.message || "Record Trail could not be loaded."),
        "error"
      );
    } finally {
      if (activeView === view && view.controller === controller) {
        view.controller = null;
      }
    }
  }

  function openRecordTrail(trigger) {
    closeRecordTrail(false);
    const overlay = globalScope.document.createElement("dialog");
    const panel = globalScope.document.createElement("section");
    const header = globalScope.document.createElement("header");
    const headerMain = globalScope.document.createElement("div");
    const icon = globalScope.document.createElement("span");
    const titles = globalScope.document.createElement("div");
    const title = globalScope.document.createElement("h2");
    const subtitle = globalScope.document.createElement("p");
    const actions = globalScope.document.createElement("div");
    const refresh = globalScope.document.createElement("button");
    const close = globalScope.document.createElement("button");
    const body = globalScope.document.createElement("div");

    overlay.className = "suitemate-v3-record-trail-overlay";
    overlay.dataset.suitemateV3Ui = "record-trail";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "suitemate-v3-record-trail-title");
    overlay.setAttribute("aria-describedby", "suitemate-v3-record-trail-subtitle");
    panel.className = "suitemate-v3-record-trail-panel";
    header.className = "suitemate-v3-record-trail-header";
    headerMain.className = "suitemate-v3-record-trail-header-main";
    icon.className = "suitemate-v3-record-trail-icon";
    icon.setAttribute("aria-hidden", "true");
    title.id = "suitemate-v3-record-trail-title";
    title.textContent = "Record Trail";
    subtitle.id = "suitemate-v3-record-trail-subtitle";
    subtitle.textContent = "Records related to this transaction";
    titles.append(title, subtitle);
    headerMain.append(icon, titles);

    actions.className = "suitemate-v3-record-trail-actions";
    refresh.type = "button";
    refresh.className = "suitemate-v3-record-trail-refresh";
    refresh.textContent = "↻";
    refresh.setAttribute("aria-label", "Refresh Record Trail");
    refresh.title = "Refresh";
    close.type = "button";
    close.className = "suitemate-v3-record-trail-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close Record Trail");
    actions.append(refresh, close);
    header.append(headerMain, actions);

    body.className = "suitemate-v3-record-trail-body";
    body.setAttribute("aria-live", "polite");
    panel.append(header, body);
    overlay.append(panel);
    globalScope.document.body.append(overlay);

    const view = {
      overlay,
      body,
      clipboard: browserApi.clipboard.create(),
      controller: null
    };
    activeView = view;
    refresh.addEventListener("click", () => void loadRecordTrail(view));
    close.addEventListener("click", () => closeRecordTrail());
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) {
        closeRecordTrail();
      }
    });
    overlay.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeRecordTrail();
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRecordTrail();
      }
    });
    // Native <dialog>: top layer, focus trap, background inerting, and
    // focus restoration to the opener are browser-managed.
    overlay.showModal?.();
    globalScope.document.body.classList.add("suitemate-v3-record-trail-open");
    close.focus?.();
    void loadRecordTrail(view);
    return true;
  }

  function createToolbarAction() {
    const item = globalScope.document.createElement("li");
    const link = globalScope.document.createElement("a");
    const icon = globalScope.document.createElement("span");
    const label = globalScope.document.createElement("span");
    item.className = "ns-menuitem suitemate-v3-tools-action suitemate-v3-tools-record-action";
    item.dataset.suitemateV3Action = "record-trail";
    item.setAttribute("role", "none");
    link.href = "#";
    link.setAttribute("role", "menuitem");
    link.setAttribute("aria-haspopup", "dialog");
    commandApi.applyMetadata(link, recordTrailCommand);
    icon.className = "suitemate-v3-tools-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⌁";
    label.className = "suitemate-v3-tools-label";
    label.textContent = "Record Trail";
    link.append(icon, label);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const returnFocus = globalScope.document.querySelector(TOOLS_TRIGGER_SELECTOR) ?? link;
      returnFocus.focus?.();
      const result = commandScope.invoke(
        recordTrailCommand,
        { trigger: returnFocus },
        { source: commandApi.SOURCES.LINK }
      );
      if (!result.ok) {
        globalScope.console?.error("SuiteMate V3 Record Trail is unavailable.", result.error);
      }
    });
    item.append(link);
    return item;
  }

  function installRecordTrail({ signal, isCurrent }) {
    if (
      signal.aborted
      || !isCurrent()
      || !globalScope.document.querySelector("#main_form")
      || !commandScope.isAvailable(recordTrailCommand)
    ) {
      return false;
    }
    const existing = globalScope.document.querySelector(ACTION_SELECTOR);
    if (existing) {
      return true;
    }
    const toolsMenu = globalScope.document.querySelector(TOOLS_MENU_SELECTOR);
    if (!toolsMenu || !toolsMenu.isConnected) {
      return false;
    }
    toolsMenu.append(createToolbarAction());
    return true;
  }

  function nodeContainsToolbar(node) {
    if (node?.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    return node.matches?.(`#main_form, ${TOP_TOOLBAR_SELECTOR}, ${TOOLS_MENU_SELECTOR}, ${ACTION_SELECTOR}`)
      || Boolean(node.querySelector?.(
        `#main_form, ${TOP_TOOLBAR_SELECTOR}, ${TOOLS_MENU_SELECTOR}, ${ACTION_SELECTOR}`
      ));
  }

  function removeRecordTrail() {
    closeRecordTrail(false);
    globalScope.document.querySelectorAll(`${ACTION_SELECTOR}, ${OVERLAY_SELECTOR}`)
      .forEach((element) => element.remove());
  }

  const lifecycleHandle = lifecycleApi.register({
    id: "record.record-trail",
    replace: true,
    capability: routeApi.CAPABILITIES.RECORD_TRAIL,
    startPaused: true,
    observe: { childList: true, subtree: true },
    relevant: (mutations) => mutations.some((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].some(nodeContainsToolbar)),
    evaluate: installRecordTrail,
    cleanup: removeRecordTrail
  });

  async function start() {
    const revision = settingsRevision;
    try {
      const settings = await settingsApi.get();
      if (revision !== settingsRevision) {
        return;
      }
      currentSettings = settings;
      if (settings.enabled) {
        lifecycleHandle.resume("settings-enabled");
      } else {
        lifecycleHandle.pause("settings-disabled");
      }
    } catch {
      currentSettings = null;
      lifecycleHandle.pause("settings-failed");
    }
  }

  globalScope.chrome.storage?.onChanged?.addListener((changes, areaName) => {
    const change = changes[settingsApi.STORAGE_KEY];
    if (areaName !== "sync" || !change) {
      return;
    }
    settingsRevision += 1;
    try {
      currentSettings = settingsApi.normalize(change.newValue);
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
      lifecycleHandle.dispose("pagehide");
      commandScope.dispose();
    }
  });

  void start();
})(globalThis);
