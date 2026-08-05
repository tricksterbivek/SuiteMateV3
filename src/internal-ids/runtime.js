(function initializeSuiteMateV3InternalIds() {
  "use strict";

  const core = globalThis.SuiteMateV3InternalIdsCore;
  const bridgeApi = globalThis.SuiteMateV3Bridge;
  const lifecycleApi = globalThis.SuiteMateV3Lifecycle;
  const recordCore = globalThis.SuiteMateV3RecordActionsCore;
  const routeApi = globalThis.SuiteMateV3Routes;
  const settingsApi = globalThis.SuiteMateV3Settings;
  if (
    !core
    || !bridgeApi
    || !lifecycleApi
    || !recordCore
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
  if (!routeApi.supports(routeApi.CAPABILITIES.INTERNAL_IDS, pageContext)) {
    return;
  }

  const ROOT_CLASS = "show-field-ids";
  const BADGE_CLASS = "ns-field-id";
  const OWNED_ATTRIBUTE = "data-suitemate-v3-internal-id";
  const OWNED_SELECTOR = `.${BADGE_CLASS}[${OWNED_ATTRIBUTE}]`;
  const CANDIDATE_SELECTOR = [
    ".uir-record-type",
    '[data-walkthrough^="Field:"]',
    ".uir-label",
    ".uir-label > span",
    ".formtabtext[data-nsps-id]",
    ".formsubtabtext[data-nsps-id]",
    '.uir-button[id^="tbl_"]',
    ".uir-machine-table-container",
    ".uir-machine-table",
    ".uir-machine-headerrow",
    '.uir-machine-table-container span[id$="1_fs"]',
    ".listheader",
    '#main_form > [type="hidden"][name$="fields"][value]'
  ].join(",");
  const root = document.documentElement;
  let settingsRevision = 0;
  let recordType = null;
  let recordTypeAttempted = false;

  function createBadge(identifier, kind) {
    const normalized = core.normalizeIdentifier(identifier);
    if (!normalized) {
      return null;
    }
    const badge = document.createElement("span");
    badge.className = BADGE_CLASS;
    badge.dataset.suitemateV3InternalId = kind;
    badge.textContent = normalized;
    badge.title = `${kind} ID: ${normalized}`;
    if (["list-column", "sublist-column", "script"].includes(kind)) {
      const stopNetSuiteHeaderAction = (event) => event.stopPropagation();
      badge.addEventListener("click", stopNetSuiteHeaderAction);
      badge.addEventListener("mousedown", stopNetSuiteHeaderAction);
    }
    return badge;
  }

  function placeBadge(target, identifier, kind, placement) {
    if (!target) {
      return false;
    }
    const owned = `${OWNED_SELECTOR}[${OWNED_ATTRIBUTE}="${kind}"]`;
    const duplicate = placement === "append"
      ? target.querySelector?.(`:scope > ${owned}`)
      : (placement === "after" ? target.nextElementSibling : target.previousElementSibling)?.matches?.(owned);
    if (duplicate) {
      return false;
    }
    const badge = createBadge(identifier, kind);
    if (!badge) {
      return false;
    }
    if (placement === "append") {
      target.append(badge);
    } else if (placement === "after") {
      target.after(badge);
    } else {
      target.before(badge);
    }
    return true;
  }

  function appendBadge(container, identifier, kind) {
    return placeBadge(container, identifier, kind, "append");
  }

  function insertBadgeAfter(target, identifier, kind) {
    return placeBadge(target, identifier, kind, "after");
  }

  function insertBadgeBefore(target, identifier, kind) {
    return placeBadge(target, identifier, kind, "before");
  }

  function decorateFields() {
    for (const wrapper of document.querySelectorAll('[data-walkthrough^="Field:"]')) {
      const label = wrapper.querySelector(".uir-label > span");
      appendBadge(label, core.fieldIdFromWalkthrough(wrapper.dataset.walkthrough), "field");
    }
  }

  function decorateTabs() {
    for (const tab of document.querySelectorAll(
      ".formtabtext[data-nsps-id], .formsubtabtext[data-nsps-id]"
    )) {
      insertBadgeAfter(tab, tab.dataset.nspsId, tab.classList.contains("formtabtext") ? "tab" : "subtab");
    }
  }

  function decorateButtons() {
    for (const button of document.querySelectorAll('.uir-button[id^="tbl_"]')) {
      if (button.closest(".uir-secondary-buttons")) {
        continue;
      }
      insertBadgeAfter(button, core.buttonIdFromElementId(button.id), "button");
    }
  }

  function machineDisplayTarget(element) {
    return element.parentElement?.matches?.(".uir-machine-table-container")
      ? element.parentElement
      : element;
  }

  function decorateMachines() {
    const targets = new Set(
      [...document.querySelectorAll(".uir-machine-table-container, .uir-machine-table")]
        .map(machineDisplayTarget)
    );
    for (const target of targets) {
      const machineId = core.machineIdFromElementId(target.id)
        ?? core.machineIdFromElementId(target.querySelector?.(".uir-machine-table")?.id);
      insertBadgeBefore(target, machineId, "sublist");
    }
  }

  function decorateMachineColumns() {
    for (const machine of document.querySelectorAll(".uir-machine-table-container")) {
      const headers = [...machine.querySelectorAll(".uir-machine-headerrow > td")];
      const cells = [...machine.querySelectorAll("tr:nth-child(2) > td")]
        .filter((cell) => cell.style.display !== "none");
      cells.forEach((cell, index) => {
        const spanId = cell.querySelector('span[id$="1_fs"]')?.id;
        appendBadge(
          headers[index],
          core.sublistColumnId(spanId, machine.id),
          "sublist-column"
        );
      });
    }
  }

  function decorateListHeaders() {
    const selector = [
      '.uir-machine-headerrow > [onclick^="if (getFormElementViaFormName("]',
      '.uir-machine-headerrow > [onclick^="l_sort("]'
    ].join(",");
    for (const header of document.querySelectorAll(selector)) {
      if (!header.querySelector(":scope > .listheader")) {
        continue;
      }
      appendBadge(header, core.listHeaderId(header.getAttribute("onclick")), "list-column");
    }
  }

  function decorateCustomizationRows() {
    const fieldInputs = document.querySelectorAll(
      '#main_form > [type="hidden"][name$="fields"][value]:not([name="rolesfields"]):not([name$="groupsfields"])'
    );
    for (const fieldsInput of fieldInputs) {
      const prefix = fieldsInput.name.slice(0, -6);
      const dataInput = document.querySelector(`#main_form > [name="${CSS.escape(`${prefix}data`)}"]`);
      if (!dataInput) {
        continue;
      }
      const identifiers = core.customizationScriptIds(
        fieldsInput.name,
        fieldsInput.value,
        dataInput.value
      );
      const cells = document.querySelectorAll(
        `#${CSS.escape(prefix)}_splits .uir-list-row-tr > .uir-list-row-cell:nth-child(2)`
      );
      cells.forEach((cell, index) => appendBadge(cell, identifiers[index], "script"));
    }
  }

  async function resolveRecordType(signal) {
    const fromDocument = recordCore.resolveRecordTypeFromDocument(document, location.pathname);
    if (fromDocument) {
      return fromDocument;
    }
    const currentContext = routeApi.createPageContext(location, {
      isTopFrame: true,
      trustedContentScript: true
    });
    if (!routeApi.supports(routeApi.CAPABILITIES.RECORD_TYPE_BRIDGE, currentContext)) {
      return null;
    }
    try {
      const response = await bridgeApi.request(
        bridgeApi.COMMANDS.RECORD_GET_TYPE,
        {},
        { signal, timeoutMs: 10000 }
      );
      const result = bridgeApi.toCommandResult(response);
      return result.ok ? recordCore.normalizeRecordType(result.recordType) : null;
    } catch {
      return null;
    }
  }

  async function decorateRecordType(signal, isCurrent) {
    const target = document.querySelector(".uir-record-type");
    if (!target || target.querySelector(`:scope > ${OWNED_SELECTOR}[${OWNED_ATTRIBUTE}="record-type"]`)) {
      return;
    }
    if (!recordTypeAttempted) {
      recordTypeAttempted = true;
      recordType = await resolveRecordType(signal);
    }
    if (!signal.aborted && isCurrent() && target.isConnected) {
      appendBadge(target, recordType, "record-type");
    }
  }

  function decorateStaticIds() {
    decorateFields();
    decorateTabs();
    decorateButtons();
    decorateMachines();
    decorateMachineColumns();
    decorateListHeaders();
    decorateCustomizationRows();
  }

  function nodeContainsCandidate(node) {
    if (node?.nodeType !== 1 || node.matches?.(OWNED_SELECTOR) || node.closest?.(OWNED_SELECTOR)) {
      return false;
    }
    return node.matches?.(CANDIDATE_SELECTOR)
      || Boolean(node.querySelector?.(CANDIDATE_SELECTOR));
  }

  function containsRelevantMutation(records) {
    return records.some((record) => [...record.addedNodes].some(nodeContainsCandidate));
  }

  async function installInternalIds({ signal, isCurrent }) {
    if (signal.aborted || !isCurrent()) {
      return false;
    }
    root.classList.add(ROOT_CLASS);
    root.dataset.suitemateV3InternalIds = "visible";
    decorateStaticIds();
    await decorateRecordType(signal, isCurrent);
    return !signal.aborted && isCurrent();
  }

  function removeInternalIds() {
    root.classList.remove(ROOT_CLASS);
    root.dataset.suitemateV3InternalIds = "hidden";
    document.querySelectorAll(OWNED_SELECTOR).forEach((badge) => badge.remove());
    recordType = null;
    recordTypeAttempted = false;
  }

  const lifecycleHandle = lifecycleApi.register({
    id: "developer.internal-ids",
    replace: true,
    capability: routeApi.CAPABILITIES.INTERNAL_IDS,
    startPaused: true,
    observe: {
      childList: true,
      subtree: true
    },
    relevant: containsRelevantMutation,
    evaluate: installInternalIds,
    cleanup: removeInternalIds
  });

  function applySettings(value, reason) {
    const settings = settingsApi.normalize(value);
    if (settings.showInternalIds) {
      lifecycleHandle.resume(reason);
    } else {
      lifecycleHandle.pause(reason);
      removeInternalIds();
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
        removeInternalIds();
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
      removeInternalIds();
    }
  });

  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      lifecycleHandle.dispose("page-hidden");
    }
  });

  start();
})();
