(function initializeSuiteMateV3CsvImport() {
  "use strict";

  const core = globalThis.SuiteMateV3RecordActionsCore;
  const settingsApi = globalThis.SuiteMateV3Settings;
  if (!core || !globalThis.document || !globalThis.location || !globalThis.chrome?.runtime) {
    return;
  }

  try {
    if (window !== window.top) {
      return;
    }
  } catch {
    return;
  }

  if (!core.isSupportedRecordPage(location)) {
    return;
  }

  const ACTION_SELECTOR = '[data-suitemate-v3-action="csv-import-toolbar"]';
  const LEGACY_ACTION_SELECTOR = '[data-suitemate-v3-action="csv-import"]';
  const TOP_TOOLBAR_SELECTOR = ".uir-buttons-top.uir-header-buttons";
  const ACTIONS_CELL_SELECTOR = `${TOP_TOOLBAR_SELECTOR} td.uir-button-menu`;
  let observer = null;
  let installationPending = false;
  let active = false;

  function findActionsCell() {
    return [...document.querySelectorAll(ACTIONS_CELL_SELECTOR)].find((cell) => {
      const trigger = cell.querySelector(":scope > .ns-menu > .ns-menuitem > a");
      return trigger?.textContent?.trim() === "Actions";
    }) ?? null;
  }

  async function requestMainWorldRecordType() {
    try {
      const response = await chrome.runtime.sendMessage({ type: core.RECORD_TYPE_MESSAGE });
      return response?.ok ? core.normalizeRecordType(response.recordType) : null;
    } catch {
      return null;
    }
  }

  async function resolveRecordType() {
    return core.resolveRecordTypeFromDocument(document, location.pathname)
      ?? await requestMainWorldRecordType();
  }

  function createToolbarAction(href) {
    const cell = document.createElement("td");
    cell.className = "suitemate-v3-csv-import-cell";
    cell.dataset.suitemateV3Action = "csv-import-toolbar";

    const link = document.createElement("a");
    link.href = href;
    link.className = "suitemate-v3-csv-import-button";
    link.title = "Import this type of record into NetSuite";
    link.textContent = "CSV Import";
    cell.append(link);
    return cell;
  }

  async function installCsvImportAction() {
    installationPending = false;
    if (!active || !document.querySelector("#main_form")) {
      return false;
    }

    document.querySelectorAll(LEGACY_ACTION_SELECTOR).forEach((item) => item.remove());

    const actionsCell = findActionsCell();
    if (!actionsCell || document.querySelector(ACTION_SELECTOR)) {
      return Boolean(actionsCell);
    }

    const recordType = await resolveRecordType();
    const recordSubtype = core.deriveImportSubtype(
      recordType,
      document.querySelector("#subtype")?.value
    );
    const href = core.createCsvImportUrl(recordSubtype, location.origin);
    if (!href || !actionsCell.isConnected || document.querySelector(ACTION_SELECTOR)) {
      return false;
    }

    actionsCell.after(createToolbarAction(href));
    return true;
  }

  function scheduleInstallation() {
    if (!active || installationPending) {
      return;
    }
    installationPending = true;
    queueMicrotask(() => installCsvImportAction().catch(() => {
      installationPending = false;
    }));
  }

  function nodeContainsRelevantToolbar(node) {
    if (node?.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    return node.matches?.(TOP_TOOLBAR_SELECTOR)
      || node.matches?.(ACTIONS_CELL_SELECTOR)
      || node.matches?.(ACTION_SELECTOR)
      || Boolean(node.querySelector?.(`${TOP_TOOLBAR_SELECTOR}, ${ACTION_SELECTOR}`));
  }

  function observeToolbarLifecycle() {
    if (observer) {
      return;
    }
    observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) =>
        [...mutation.addedNodes, ...mutation.removedNodes].some(nodeContainsRelevantToolbar))) {
        scheduleInstallation();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function activate() {
    if (!document.querySelector("#main_form")) {
      return;
    }
    if (active) {
      scheduleInstallation();
      return;
    }
    active = true;
    observeToolbarLifecycle();
    scheduleInstallation();
  }

  function deactivate() {
    active = false;
    observer?.disconnect();
    observer = null;
    document.querySelectorAll(`${ACTION_SELECTOR}, ${LEGACY_ACTION_SELECTOR}`).forEach((item) => item.remove());
  }

  async function start() {
    try {
      const settings = settingsApi?.get ? await settingsApi.get() : { enabled: true };
      if (settings?.enabled === false) {
        return;
      }
    } catch {
      return;
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", activate, { once: true });
    } else {
      activate();
    }
  }

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    const settingsChange = changes[settingsApi?.STORAGE_KEY];
    if (areaName !== "sync" || !settingsChange) {
      return;
    }
    try {
      if (settingsApi.normalize(settingsChange.newValue).enabled) {
        activate();
      } else {
        deactivate();
      }
    } catch {
      deactivate();
    }
  });

  start();
})();
