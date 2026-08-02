(function initializeSuiteMateV3EditGrid() {
  "use strict";

  const core = globalThis.SuiteMateV3EditGridCore;
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
  if (!routeApi.supports(routeApi.CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT, pageContext)) {
    return;
  }

  const OWNED_SELECTOR = `[${core.DATA_ATTRIBUTE}]`;
  const RELEVANT_SELECTOR =
    `${core.MACHINE_TABLE_SELECTOR}, ${core.HEADER_ROW_SELECTOR}, ${core.DATA_ROW_SELECTOR}`;
  let settingsRevision = 0;
  let scopeKey = null;
  let activeTable = null;
  let nativeColumnIds = null;
  let entry = {};
  let pendingApply = false;
  let installErrorLogged = false;
  let warnedNewerSchema = false;

  function showToast(message, type) {
    globalThis.SuiteMateV3Notifications?.showToast(message, { type });
  }

  function logOnce(error) {
    if (installErrorLogged) {
      return;
    }
    installErrorLogged = true;
    console.error("SuiteMate V3 edit grid install failed.", error);
  }

  // ===== Scope =====
  function recordType() {
    const match = /\/([a-z0-9_]+)\.nl$/i.exec(location.pathname);
    return (match?.[1] ?? "record").toLowerCase();
  }

  function resolveScopeKey() {
    const type = recordType();
    try {
      const sessionScript = document.querySelector(
        'script[src^="/javascript/sessionstatus/session_status_init.jsp?"]'
      );
      if (sessionScript?.src) {
        const params = new URL(sessionScript.src, location.origin).searchParams;
        const companyId = params.get("companyId");
        // Session id is COMPANY~USER~ROLE~FLAG; segment 2 is the user id.
        const userId = params.get("id")?.split("~")[1];
        if (companyId && userId) {
          return `${companyId}:${userId}:${type}:edit`;
        }
      }
    } catch {}
    return `${location.hostname}:${type}:edit`;
  }

  // ===== Machine state =====
  function machineTable() {
    return document.querySelector(core.MACHINE_TABLE_SELECTOR);
  }

  function machineContainer(table) {
    return table?.closest?.(core.MACHINE_CONTAINER_SELECTOR) ?? null;
  }

  function isLineOpen() {
    const table = activeTable ?? machineTable();
    if (!table) {
      return false;
    }
    // Live 2026-08-02: the permanent entry row ALWAYS carries
    // uir-machine-row-focused and its uir-machine-button-row is ALWAYS attached,
    // so "any focused row or any button row" is true for the entire session and
    // every queued apply starves. An open EXISTING line is a focused row that
    // also carries a numbered {machine}_row_{n} id.
    const machineId = core.machineIdFromTable(table);
    return Array.from(table.querySelectorAll(core.FOCUSED_ROW_SELECTOR))
      .some((row) => core.rowLineNumber(row, machineId) !== null);
  }

  function fieldIsDirty(field) {
    if (field.tagName !== "SELECT") {
      return field.value !== field.defaultValue;
    }
    // HTMLSelectElement has no defaultValue, so comparing against it reports
    // every untouched select as dirty — and a machine row always has selects.
    // The pristine value is the defaultSelected option, or the first option
    // when the markup names none.
    const options = Array.from(field.options ?? []);
    const pristine = options.find((option) => option.defaultSelected) ?? options[0];
    return field.value !== (pristine?.value ?? "");
  }

  function isDirty() {
    const table = activeTable ?? machineTable();
    const openRow = table?.querySelector?.(core.FOCUSED_ROW_SELECTOR);
    if (!openRow) {
      return false;
    }
    return Array.from(openRow.querySelectorAll("input, select, textarea")).some(fieldIsDirty);
  }

  function forcedRows() {
    // The open row and any dirty row are exempt from every hide/filter/move set.
    const table = activeTable ?? machineTable();
    return Array.from(table?.querySelectorAll?.(core.FOCUSED_ROW_SELECTOR) ?? []);
  }

  // ===== Delegated listeners (one per event type, on the container) =====
  const DELEGATED_LISTENERS = [
    // M2 adds the resize pair, M3 the focusin reveal, M5 the control clicks,
    // M6/M7 the header menu. Nothing is bound per row: rows are destroyed on
    // every repaint and per-row binding is how duplicate handlers accumulate.
  ];

  function ensureBindings(container) {
    if (!container || container.hasAttribute(core.BOUND_ATTRIBUTE)) {
      return;
    }
    container.setAttribute(core.BOUND_ATTRIBUTE, "");
    for (const [type, handler, options] of DELEGATED_LISTENERS) {
      container.addEventListener(type, handler, options);
    }
  }

  function releaseBindings(container) {
    if (!container?.hasAttribute?.(core.BOUND_ATTRIBUTE)) {
      return;
    }
    container.removeAttribute(core.BOUND_ATTRIBUTE);
    for (const [type, handler, options] of DELEGATED_LISTENERS) {
      container.removeEventListener(type, handler, options);
    }
  }

  function ensureMountMarker(container) {
    if (container.querySelector(`:scope > [${core.DATA_ATTRIBUTE}="mount"]`)) {
      return;
    }
    const marker = document.createElement("span");
    marker.setAttribute(core.DATA_ATTRIBUTE, "mount");
    marker.hidden = true;
    container.append(marker);
  }

  // ===== Serialized save queue =====
  let saveQueue = Promise.resolve();
  function enqueueSave(operation) {
    saveQueue = saveQueue.then(operation, operation);
    return saveQueue;
  }

  // ===== Apply =====
  function renderSignature(table, columnIds) {
    // Everything the runtime applies MUST appear here. An install whose current
    // signature already equals the target performs zero DOM and zero storage
    // writes — that is what makes "one gesture = exactly one write" testable.
    return JSON.stringify({ ids: columnIds });
  }

  function targetSignature(table, columnIds) {
    void table;
    return JSON.stringify({ ids: columnIds });
  }

  function applyAll(table, columnIds) {
    // M2 appends applyCurrentWidths, M3 applyCurrentHidden, M6 applyCurrent
    // Filters, M7 applyCurrentSort. M1 applies nothing: the foundation must be
    // invisible so the 28 screenshot baselines cannot move.
    void table;
    void columnIds;
  }

  function queueApply(reason) {
    if (isLineOpen()) {
      // Hide/show, width and filter changes queue while a line is open and
      // flush when it closes; reorder and sort are refused outright (M4/M7).
      pendingApply = true;
      return;
    }
    pendingApply = false;
    const table = machineTable();
    const columnIds = table ? core.readColumnIds(table) : [];
    if (!table || columnIds.length < 2) {
      return;
    }
    activeTable = table;
    applyAll(table, columnIds);
    void reason;
  }

  async function installEditGrid({ signal, isCurrent }) {
    try {
      const table = machineTable();
      const container = machineContainer(table);
      if (!table || !container) {
        return false;
      }
      const columnIds = core.readColumnIds(table);
      // Fail closed on an unrecognized machine: no header, no _fs spans,
      // duplicate or undecodable ids (spec section 7).
      if (
        columnIds.length < 2
        || columnIds.some((id) => !id)
        || new Set(columnIds).size !== columnIds.length
      ) {
        return false;
      }
      activeTable = table;
      nativeColumnIds = columnIds;
      scopeKey = resolveScopeKey();
      ensureMountMarker(container);
      ensureBindings(container);
      const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
      if (signal.aborted || !isCurrent() || !table.isConnected) {
        return false;
      }
      if (core.refusesNewerSchema(stored[core.STORAGE_KEY])) {
        // Latched: install re-runs on every machine repaint, and one warning
        // per repaint is a toast storm for the exact user it exists to inform.
        if (!warnedNewerSchema) {
          warnedNewerSchema = true;
          showToast("This layout was saved by a newer SuiteMate.", "warning");
        }
        entry = {};
        return true;
      }
      entry = core.normalizeStored(stored[core.STORAGE_KEY]).grids[scopeKey] ?? {};
      // Identity re-derivation: Add/Insert/Remove renumbers every row id and
      // _fs span, so identity is re-read here on every install and a surviving
      // stamp on a <td> is never trusted as identity.
      const current = core.readColumnIds(table);
      if (renderSignature(table, current) === targetSignature(table, current)) {
        return true;
      }
      if (isLineOpen()) {
        pendingApply = true;
        return true;
      }
      applyAll(table, current);
      return !signal.aborted && isCurrent();
    } catch (error) {
      logOnce(error);
      return false;
    }
  }

  function removeEditGrid() {
    try {
      const table = activeTable ?? machineTable();
      releaseBindings(machineContainer(table));
      // M2 appends core.applyWidths(table, null, {}), M3 the hidden reset, M6 the
      // filter reset, M7 the native row-order restore.
    } catch {}
    for (const node of document.querySelectorAll(OWNED_SELECTOR)) {
      node.remove();
    }
    activeTable = null;
    nativeColumnIds = null;
    scopeKey = null;
    entry = {};
    pendingApply = false;
    warnedNewerSchema = false;
  }

  // ===== Relevance: stamp exclusion =====
  function isOwned(node) {
    return node?.nodeType === 1
      && (node.matches?.(OWNED_SELECTOR) === true || Boolean(node.closest?.(OWNED_SELECTOR)));
  }

  function isMachineNode(node) {
    if (node?.nodeType !== 1) {
      return false;
    }
    return node.matches?.(RELEVANT_SELECTOR) === true
      || Boolean(node.querySelector?.(RELEVANT_SELECTOR))
      || Boolean(node.closest?.(core.MACHINE_TABLE_SELECTOR));
  }

  function isMachineTarget(node) {
    // Containment only — deliberately not isMachineNode(). Its descendant
    // clause makes every ancestor of the machine (body, portal hosts, tooltip
    // and dropdown containers, all of which churn constantly on a NetSuite
    // page) look like a machine node, and each one would cost an install and a
    // storage read. A sourcing rewrite mutates cells *inside* the table, which
    // closest() still catches, and which produces no addedNodes to catch.
    return node?.nodeType === 1 && Boolean(node.closest?.(core.MACHINE_TABLE_SELECTOR));
  }

  function relevant(records) {
    return records.some((record) => {
      if (isOwned(record.target)) {
        return false;
      }
      const touched = [...record.addedNodes, ...record.removedNodes];
      // Our own mount and teardown must never schedule another install. This
      // has to short-circuit before the target is consulted: the target of
      // those records is the machine container, which legitimately contains
      // the machine table and so always reads as a machine node.
      if (touched.length > 0 && touched.every(isOwned)) {
        return false;
      }
      return touched.some((node) => !isOwned(node) && isMachineNode(node))
        || isMachineTarget(record.target);
    });
  }

  const lifecycleHandle = lifecycleApi.register({
    id: "record.edit-grid",
    replace: true,
    capability: routeApi.CAPABILITIES.TRANSACTION_COLUMN_PERSONALIZATION_EDIT,
    mode: "continuous",
    startPaused: true,
    observe: {
      childList: true,
      subtree: true
    },
    relevant,
    evaluate: installEditGrid,
    cleanup: removeEditGrid
  });

  function applySettings(value, reason) {
    const settings = settingsApi.normalize(value);
    if (settings.salesOrderColumnsEdit) {
      lifecycleHandle.resume(reason);
    } else {
      lifecycleHandle.pause(reason);
      removeEditGrid();
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
        removeEditGrid();
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
      removeEditGrid();
    }
  });

  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      lifecycleHandle.dispose("page-hidden");
    }
  });

  start();
})();
