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
  // One personalisation mode at a time, page-wide: every personalisation
  // feature dispatches this on entry and stands down when another enters.
  const MODE_EVENT = "suitemate:v3:personalize-mode";
  const MODE_FEATURE = "form-views";
  let settingsRevision = 0;
  let scopeKey = null;
  let personalizing = false;
  let hiddenFields = new Set();
  let controlButtons = null;
  let collapseListener = null;
  let replayingCollapse = false;

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
    // Hidden fields leave the layout in BOTH states (the Option 1 design:
    // no ghost placeholders while personalising — the toolbar chips are the
    // restore path). The ghost class is only ever cleaned up now.
    const wrappers = fieldWrappers();
    for (const wrapper of wrappers) {
      wrapper.classList.remove(GHOST_CLASS);
    }
    core.applyFieldVisibility(wrappers, hiddenFields);
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
    return core.sectionKey(title.querySelector("div.fgroup_title") ?? title);
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
      if (replayingCollapse || !event.target?.closest?.(COLLAPSIBLE_TITLE_SELECTOR)) {
        return;
      }
      // NetSuite's own handler flips aria-expanded after this click; read the
      // settled state on the next macrotask.
      setTimeout(saveCollapsedSections, 0);
    };
    document.addEventListener("click", collapseListener, true);
  }

  let modeListener = null;
  function watchOtherModes() {
    if (modeListener) {
      return;
    }
    modeListener = (event) => {
      if (event.detail?.feature !== MODE_FEATURE && personalizing) {
        exitPersonalize();
      }
    };
    document.addEventListener(MODE_EVENT, modeListener);
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
      button.textContent = "−";
      // Hide-only: a hidden field leaves the layout with its minus, and the
      // toolbar chip is the restore path.
      button.title = "Hide field";
      button.setAttribute("aria-label", "Hide field");
      button.setAttribute(core.DATA_ATTRIBUTE, "hide-toggle");
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const key = core.fieldKey(wrapper);
        if (!key) {
          return;
        }
        hiddenFields.add(key);
        applyVisibility();
        saveHiddenFields();
      });
      label.appendChild(button);
    }
  }

  function removeAffordances() {
    document.querySelectorAll(`[${core.DATA_ATTRIBUTE}="hide-toggle"]`).forEach((node) => node.remove());
  }

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
      chip.setAttribute("aria-label", `Restore ${labels.get(key) ?? key}`);
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
    controlButtons.title.hidden = !personalizing;
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
    // Announce first: any other personalisation mode stands down before this
    // one takes the page.
    document.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: { feature: MODE_FEATURE } }));
    personalizing = true;
    ensureAffordances();
    applyVisibility();
    updateControls();
  }

  function exitPersonalize() {
    personalizing = false;
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
      enqueueSave(async () => {
        try {
          if (!scopeKey) {
            return;
          }
          const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
          const afterFields = core.withHiddenFields(stored[core.STORAGE_KEY], scopeKey, null);
          const next = afterFields && core.withCollapsedSections(afterFields, scopeKey, null);
          if (!next) {
            showToast("Form view could not be reset.", "warning");
            return;
          }
          await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
          showToast("Form view reset.", "success");
        } catch {
          showToast("Form view could not be reset.", "warning");
        }
      });
      // Stay in the mode: Reset restores the defaults, Done is the exit.
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
    const personalize = createButton("Personalize form", "personalize", () => {
      try {
        enterPersonalize();
      } catch {
        exitPersonalize();
      }
      updateControls();
    });
    const title = document.createElement("span");
    title.setAttribute(core.DATA_ATTRIBUTE, "mode-title");
    title.textContent = "Personalizing form";
    title.hidden = true;
    const hint = document.createElement("span");
    hint.setAttribute(core.DATA_ATTRIBUTE, "mode-hint");
    hint.textContent = "Select the minus icon beside a field to hide it.";
    hint.hidden = true;
    const done = createButton("Done", "done", () => {
      exitPersonalize();
      updateControls();
    });
    const reset = createButton("Reset form", "reset", handleReset);
    const chips = document.createElement("span");
    chips.setAttribute(core.DATA_ATTRIBUTE, "hidden-chips");
    chips.hidden = true;
    // Actions before the unbounded chip list (Milestone 22 lesson).
    controls.append(personalize, title, hint, done, reset, chips);
    controlButtons = { controls, personalize, title, hint, done, reset, chips };
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
      watchOtherModes();
      const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
      if (signal.aborted || !isCurrent()) {
        return false;
      }
      const entry = core.normalizeStored(stored[core.STORAGE_KEY]).views[scopeKey];
      hiddenFields = new Set(entry?.hiddenFields ?? []);
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
      for (const wrapper of document.querySelectorAll(`.${core.CLASSES.hiddenField}, .${GHOST_CLASS}`)) {
        wrapper.classList.remove(core.CLASSES.hiddenField, GHOST_CLASS);
      }
      if (collapseListener) {
        document.removeEventListener("click", collapseListener, true);
        collapseListener = null;
      }
      if (modeListener) {
        document.removeEventListener(MODE_EVENT, modeListener);
        modeListener = null;
      }
    } catch {}
    document.querySelectorAll(OWNED_SELECTOR).forEach((node) => node.remove());
    controlButtons = null;
    hiddenFields = new Set();
    scopeKey = null;
  }

  function nodeRelevant(node) {
    if (
      node?.nodeType !== 1
      || node.matches?.(OWNED_SELECTOR)
      || node.closest?.(OWNED_SELECTOR)
      || node.matches?.("[data-suitemate-v3-internal-id]")
    ) {
      return false;
    }
    return node.matches?.(core.FIELD_WRAPPER_SELECTOR)
      || Boolean(node.querySelector?.(core.FIELD_WRAPPER_SELECTOR));
  }

  function containsRelevantMutation(records) {
    return records.some((record) => [...record.addedNodes].some(nodeRelevant));
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
