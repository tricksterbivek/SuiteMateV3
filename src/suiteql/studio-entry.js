import { basicSetup, EditorView } from "codemirror";
import { sql, StandardSQL } from "@codemirror/lang-sql";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";

(function initializeSuiteQLStudio() {
  "use strict";

  const core = globalThis.SuiteMateV3SuiteQLCore;
  const path = location.pathname.replace(/\/{2,}/g, "/");
  const params = new URLSearchParams(location.search);
  if (window !== window.top || path !== core?.STUDIO_PATH || !params.has("suiteql")) {
    return;
  }

  const { MESSAGE_TYPES, SESSION_KEYS } = core;
  const state = {
    columns: [],
    rows: [],
    sortColumn: "",
    sortDirection: "asc",
    clientPageIndex: 0,
    requestId: "",
    responseEpoch: 0,
    busy: false,
    paged: false,
    loadedCount: 0,
    totalCount: 0,
    totalPages: 0,
    elapsedMs: 0,
    hasExecuted: false,
    loadedNetSuitePages: new Set()
  };

  let editor;
  let draftSaveTimer = 0;
  let root;
  let executeButton;
  let abortButton;
  let pagedInput;
  let exportButton;
  let clearButton;
  let notice;
  let rowCount;
  let executionTime;
  let table;
  let tableHead;
  let tableBody;
  let emptyState;
  let previousButton;
  let nextButton;
  let loadNextButton;
  let pageStatus;
  let editorPanel;
  let resizeHandle;

  function createRequestId() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function setNotice(message = "", type = "info") {
    notice.textContent = message;
    notice.dataset.type = type;
    notice.hidden = !message;
  }

  function setBusy(value, label = "") {
    state.busy = value;
    executeButton.disabled = value;
    abortButton.disabled = !value;
    pagedInput.disabled = value;
    loadNextButton.disabled = value || loadNextButton.hidden;
    root.setAttribute("aria-busy", String(value));
    if (value && label) {
      setNotice(label, "loading");
    }
  }

  function resetResultState({ dispose = true } = {}) {
    if (dispose && state.requestId) {
      void disposeRequest(state.requestId);
    }
    state.columns = [];
    state.rows = [];
    state.sortColumn = "";
    state.sortDirection = "asc";
    state.clientPageIndex = 0;
    state.requestId = "";
    state.paged = false;
    state.loadedCount = 0;
    state.totalCount = 0;
    state.totalPages = 0;
    state.elapsedMs = 0;
    state.hasExecuted = false;
    state.loadedNetSuitePages.clear();
  }

  function getSortedRows() {
    return state.sortColumn
      ? core.sortRows(state.rows, state.sortColumn, state.sortDirection)
      : [...state.rows];
  }

  function makeCell(value) {
    const cell = document.createElement("td");
    const content = document.createElement("div");
    const type = core.valueType(value);
    cell.dataset.type = type;
    content.textContent = core.displayValue(value);
    cell.append(content);
    return cell;
  }

  function renderStats() {
    if (!state.hasExecuted) {
      rowCount.textContent = "";
      executionTime.textContent = "";
      return;
    }

    rowCount.textContent = state.paged
      ? `${state.rows.length.toLocaleString()} loaded / ${state.totalCount.toLocaleString()} total`
      : state.rows.length.toLocaleString();
    executionTime.textContent = `${state.elapsedMs.toLocaleString()} ms`;
  }

  function renderPagination(page) {
    const hasRows = state.rows.length > 0;
    previousButton.disabled = !hasRows || page.pageIndex <= 0;
    nextButton.disabled = !hasRows || page.pageIndex >= page.totalPages - 1;
    pageStatus.textContent = hasRows
      ? `Rows ${(page.start + 1).toLocaleString()}-${page.end.toLocaleString()} of ${state.rows.length.toLocaleString()} loaded`
      : "";

    const nextNetSuitePage = state.loadedNetSuitePages.size
      ? Math.max(...state.loadedNetSuitePages) + 1
      : 0;
    loadNextButton.hidden = !state.paged || nextNetSuitePage >= state.totalPages;
    loadNextButton.disabled = state.busy || loadNextButton.hidden;
    loadNextButton.textContent = loadNextButton.hidden
      ? "All pages loaded"
      : `Load next ${core.NETSUITE_PAGE_SIZE.toLocaleString()}`;
  }

  function renderTable() {
    const rows = getSortedRows();
    const page = core.getClientPage(rows, state.clientPageIndex);
    state.clientPageIndex = page.pageIndex;
    tableHead.replaceChildren();
    tableBody.replaceChildren();

    if (state.columns.length) {
      const headerRow = document.createElement("tr");
      for (const column of state.columns) {
        const header = document.createElement("th");
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.column = column;
        button.textContent = column;
        if (state.sortColumn === column) {
          button.dataset.sort = state.sortDirection;
          header.setAttribute("aria-sort", state.sortDirection === "asc" ? "ascending" : "descending");
        }
        header.append(button);
        headerRow.append(header);
      }
      tableHead.append(headerRow);
    }

    for (const row of page.rows) {
      const tableRow = document.createElement("tr");
      for (const column of state.columns) {
        tableRow.append(makeCell(row?.[column]));
      }
      tableBody.append(tableRow);
    }

    const hasColumns = state.columns.length > 0;
    table.hidden = !hasColumns;
    emptyState.hidden = hasColumns || state.busy;
    emptyState.textContent = state.hasExecuted
      ? state.rows.length
        ? "No columns were returned."
        : "The query returned no rows."
      : "Run a SuiteQL query to see results.";
    exportButton.disabled = !state.rows.length || state.busy;
    clearButton.disabled = !state.hasExecuted || state.busy;
    renderPagination(page);
    renderStats();
  }

  function renderError(error) {
    const normalized = core.normalizeError(error);
    resetResultState({ dispose: false });
    renderTable();
    setNotice(
      [normalized.code, normalized.message, normalized.details].filter(Boolean).join("\n"),
      normalized.code === "ABORTED" ? "warning" : "error"
    );
  }

  async function disposeRequest(requestId) {
    if (!requestId) {
      return;
    }
    try {
      await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.DISPOSE, requestId });
    } catch {}
  }

  async function executeQuery() {
    const selection = editor.state.selection.main;
    const selectedText = selection.empty
      ? ""
      : editor.state.sliceDoc(selection.from, selection.to);
    const validation = core.validateQuery(selectedText || editor.state.doc.toString());
    if (!validation.valid) {
      setNotice(validation.message, "error");
      return;
    }
    if (pagedInput.checked && !core.hasOrderBy(validation.query)) {
      const proceed = confirm(
        "Paged SuiteQL requires a unique ORDER BY to prevent duplicate or missing rows. Run this query anyway?"
      );
      if (!proceed) {
        return;
      }
    }

    const previousRequestId = state.requestId;
    const requestId = createRequestId();
    const epoch = ++state.responseEpoch;
    if (previousRequestId) {
      void disposeRequest(previousRequestId);
    }
    resetResultState({ dispose: false });
    state.requestId = requestId;
    state.paged = pagedInput.checked;
    renderTable();
    setBusy(true, "Running SuiteQL...");

    try {
      const rawResponse = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.START,
        requestId,
        query: validation.query,
        paged: state.paged
      });
      const response = core.normalizeResponse(rawResponse, requestId);
      if (epoch !== state.responseEpoch || requestId !== state.requestId) {
        return;
      }
      if (!response.ok) {
        renderError(response.error);
        return;
      }

      state.columns = Array.isArray(response.columns) ? response.columns : [];
      state.rows = Array.isArray(response.rows) ? response.rows : [];
      state.hasExecuted = true;
      state.paged = response.paged === true;
      state.loadedCount = Number(response.loadedCount) || state.rows.length;
      state.totalCount = Number(response.totalCount) || state.rows.length;
      state.totalPages = Number(response.totalPages) || (state.rows.length ? 1 : 0);
      state.elapsedMs = Number(response.elapsedMs) || 0;
      state.loadedNetSuitePages.add(Number(response.pageIndex) || 0);
      setNotice(
        !state.paged && state.rows.length === 5000
          ? "Unpaged SuiteQL returned 5,000 rows. Enable Paged mode to retrieve more."
          : state.rows.length
            ? ""
            : "The query completed successfully and returned no rows.",
        !state.paged && state.rows.length === 5000 ? "warning" : "info"
      );
      renderTable();
    } catch (error) {
      if (epoch === state.responseEpoch) {
        renderError(error);
      }
    } finally {
      if (epoch === state.responseEpoch) {
        setBusy(false);
        renderTable();
      }
    }
  }

  async function loadNextNetSuitePage() {
    if (!state.requestId || !state.paged || state.busy) {
      return;
    }
    const pageIndex = state.loadedNetSuitePages.size
      ? Math.max(...state.loadedNetSuitePages) + 1
      : 0;
    if (pageIndex >= state.totalPages) {
      return;
    }

    const requestId = state.requestId;
    const epoch = ++state.responseEpoch;
    setBusy(true, `Loading SuiteQL page ${(pageIndex + 1).toLocaleString()}...`);
    try {
      const rawResponse = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.PAGE,
        requestId,
        pageIndex
      });
      const response = core.normalizeResponse(rawResponse, requestId);
      if (epoch !== state.responseEpoch || requestId !== state.requestId) {
        return;
      }
      if (!response.ok) {
        setNotice(response.error.message, "error");
        return;
      }

      state.rows.push(...(Array.isArray(response.rows) ? response.rows : []));
      state.loadedCount = Number(response.loadedCount) || state.rows.length;
      state.totalCount = Number(response.totalCount) || state.totalCount;
      state.totalPages = Number(response.totalPages) || state.totalPages;
      state.elapsedMs += Number(response.elapsedMs) || 0;
      state.loadedNetSuitePages.add(pageIndex);
      setNotice("");
      renderTable();
    } catch (error) {
      if (epoch === state.responseEpoch) {
        setNotice(core.normalizeError(error).message, "error");
      }
    } finally {
      if (epoch === state.responseEpoch) {
        setBusy(false);
        renderTable();
      }
    }
  }

  function abortExecution() {
    if (!state.busy || !state.requestId) {
      return;
    }
    const requestId = state.requestId;
    state.responseEpoch++;
    state.requestId = "";
    state.paged = false;
    state.loadedCount = state.rows.length;
    state.totalCount = state.rows.length;
    state.totalPages = state.rows.length ? 1 : 0;
    void disposeRequest(requestId);
    setBusy(false);
    setNotice("Execution stopped. NetSuite may still finish the query in the background.", "warning");
    renderTable();
  }

  function clearResults() {
    state.responseEpoch++;
    resetResultState();
    setNotice("");
    setBusy(false);
    renderTable();
  }

  function exportLoadedRows() {
    if (!state.rows.length) {
      return;
    }
    const csv = core.toCsv(state.columns, getSortedRows());
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = core.createExportFilename(getAccountIdentifier());
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported ${state.rows.length.toLocaleString()} loaded rows.`, "success");
  }

  function getAccountIdentifier() {
    const sessionScript = document.querySelector(
      'script[src^="/javascript/sessionstatus/session_status_init.jsp?"]'
    );
    if (sessionScript?.src) {
      const companyId = new URL(sessionScript.src, location.origin).searchParams.get("companyId");
      if (companyId) {
        return companyId;
      }
    }
    return location.hostname.split(".")[0];
  }

  function inspectTable() {
    const tableName = prompt("Table name");
    if (tableName === null) {
      return;
    }
    const normalized = tableName.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(normalized)) {
      setNotice("Enter a valid SuiteQL table name using letters, numbers and underscores.", "error");
      return;
    }
    open(`/app/recordscatalog/rcbrowser.nl#/record_ss/${encodeURIComponent(normalized)}`, "_blank", "noopener");
  }

  function persistDraft() {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      sessionStorage.setItem(SESSION_KEYS.draft, editor.state.doc.toString());
    }, 250);
  }

  function installResizeBehavior() {
    const savedHeight = Number.parseInt(sessionStorage.getItem(SESSION_KEYS.editorHeight), 10);
    if (Number.isFinite(savedHeight)) {
      editorPanel.style.height = `${Math.max(120, savedHeight)}px`;
    }

    resizeHandle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = editorPanel.getBoundingClientRect().height;
      const maximumHeight = Math.max(180, window.innerHeight * 0.7);
      root.classList.add("is-resizing");
      resizeHandle.setPointerCapture(event.pointerId);

      const move = (moveEvent) => {
        const height = Math.min(maximumHeight, Math.max(120, startHeight + moveEvent.clientY - startY));
        editorPanel.style.height = `${Math.round(height)}px`;
        editor.requestMeasure();
      };
      const stop = () => {
        resizeHandle.removeEventListener("pointermove", move);
        resizeHandle.removeEventListener("pointerup", stop);
        resizeHandle.removeEventListener("pointercancel", stop);
        root.classList.remove("is-resizing");
        sessionStorage.setItem(
          SESSION_KEYS.editorHeight,
          String(Math.round(editorPanel.getBoundingClientRect().height))
        );
      };

      resizeHandle.addEventListener("pointermove", move);
      resizeHandle.addEventListener("pointerup", stop);
      resizeHandle.addEventListener("pointercancel", stop);
    });
  }

  function installEvents() {
    executeButton.addEventListener("click", executeQuery);
    abortButton.addEventListener("click", abortExecution);
    exportButton.addEventListener("click", exportLoadedRows);
    clearButton.addEventListener("click", clearResults);
    loadNextButton.addEventListener("click", loadNextNetSuitePage);
    pagedInput.addEventListener("change", () => {
      sessionStorage.setItem(SESSION_KEYS.paged, String(pagedInput.checked));
    });
    previousButton.addEventListener("click", () => {
      state.clientPageIndex--;
      renderTable();
    });
    nextButton.addEventListener("click", () => {
      state.clientPageIndex++;
      renderTable();
    });
    tableHead.addEventListener("click", ({ target }) => {
      const button = target.closest("button[data-column]");
      if (!button) {
        return;
      }
      const column = button.dataset.column;
      state.sortDirection = state.sortColumn === column && state.sortDirection === "asc" ? "desc" : "asc";
      state.sortColumn = column;
      state.clientPageIndex = 0;
      renderTable();
    });
    root.querySelector("#suiteql-inspect-table").addEventListener("click", inspectTable);
    window.addEventListener("pagehide", () => {
      clearTimeout(draftSaveTimer);
      sessionStorage.setItem(SESSION_KEYS.draft, editor.state.doc.toString());
      void disposeRequest(state.requestId);
    });
  }

  function shortcutExtensions() {
    const run = (callback) => () => {
      callback();
      return true;
    };
    return Prec.high(
      keymap.of([
        { key: "Mod-e", run: run(executeQuery) },
        { key: "Escape", run: () => state.busy && (abortExecution(), true) },
        {
          key: "Mod-Shift-p",
          run: run(() => {
            pagedInput.checked = !pagedInput.checked;
            pagedInput.dispatchEvent(new Event("change"));
          })
        },
        { key: "Mod-Shift-e", run: run(exportLoadedRows) },
        { key: "Mod-Shift-l", run: run(clearResults) }
      ])
    );
  }

  function createMarkup() {
    root = document.createElement("main");
    root.id = "suitemate-suiteql-studio";
    root.innerHTML = `
      <header class="suiteql-studio-header">
        <div>
          <h1>SuiteQL Console</h1>
          <p>Query NetSuite with the permissions of the current role.</p>
        </div>
        <nav aria-label="SuiteQL resources">
          <a id="suiteql-suitesense" href="https://suitesense.vercel.app/" target="_blank" rel="noopener noreferrer" title="Generate SuiteQL from plain English with SuiteSense">Generate with SuiteSense</a>
          <button id="suiteql-inspect-table" type="button" hidden>Inspect Table</button>
          <a id="suiteql-records-catalog" href="/app/recordscatalog/rcbrowser.nl" target="_blank" rel="noopener" hidden>Records Catalog</a>
        </nav>
      </header>
      <section id="suiteql-control-bar" aria-label="SuiteQL controls">
        <div id="suiteql-buttons">
          <button id="suiteql-execute" class="primary" type="button" aria-keyshortcuts="Control+E Meta+E" title="Execute query (Ctrl or Command + E)">Execute</button>
          <button id="suiteql-abort" type="button" aria-keyshortcuts="Escape" title="Stop waiting for the active query (Escape)" disabled>Abort</button>
          <label class="suiteql-toggle" title="Toggle progressive paging (Ctrl or Command + Shift + P)"><input id="suiteql-paged" type="checkbox"> Paged</label>
          <span class="buttons-divider" aria-hidden="true"></span>
          <button id="suiteql-export" type="button" aria-keyshortcuts="Control+Shift+E Meta+Shift+E" title="Export loaded rows as CSV (Ctrl or Command + Shift + E)" disabled>Export CSV</button>
          <button id="suiteql-clear" type="button" aria-keyshortcuts="Control+Shift+L Meta+Shift+L" title="Clear results (Ctrl or Command + Shift + L)" disabled>Clear Results</button>
        </div>
        <div id="suiteql-stats" aria-live="polite">
          <span id="suiteql-row-count" data-label="Rows"></span>
          <span id="suiteql-execution-time" data-label="Time"></span>
        </div>
      </section>
      <section id="suiteql-editor-panel" aria-label="SuiteQL editor">
        <div id="suiteql-container"></div>
      </section>
      <div id="suiteql-resize-handle" role="separator" aria-label="Resize SuiteQL editor" aria-orientation="horizontal" tabindex="0"></div>
      <section id="suitemate-suiteql-results" aria-label="SuiteQL results">
        <div id="suiteql-notice" role="status" aria-live="polite" hidden></div>
        <div class="suiteql-table-scroller">
          <table id="suiteql-result-table" hidden>
            <thead></thead>
            <tbody></tbody>
          </table>
          <p id="suiteql-empty-state">Run a SuiteQL query to see results.</p>
        </div>
        <footer id="suiteql-pagination">
          <div>
            <button id="suiteql-previous" type="button" disabled>Previous 250</button>
            <button id="suiteql-next" type="button" disabled>Next 250</button>
          </div>
          <span id="suiteql-page-status" aria-live="polite"></span>
          <button id="suiteql-load-next" type="button" hidden>Load next 1,000</button>
        </footer>
      </section>`;

    const workspaceHost = document.querySelector("#body");
    const nativeBody = document.querySelector("#div__body") || document.querySelector("#body_actions");
    if (workspaceHost) {
      workspaceHost.append(root);
    } else if (nativeBody?.parentNode) {
      nativeBody.parentNode.insertBefore(root, nativeBody);
    } else {
      document.body.append(root);
    }

    executeButton = root.querySelector("#suiteql-execute");
    abortButton = root.querySelector("#suiteql-abort");
    pagedInput = root.querySelector("#suiteql-paged");
    exportButton = root.querySelector("#suiteql-export");
    clearButton = root.querySelector("#suiteql-clear");
    notice = root.querySelector("#suiteql-notice");
    rowCount = root.querySelector("#suiteql-row-count");
    executionTime = root.querySelector("#suiteql-execution-time");
    table = root.querySelector("#suiteql-result-table");
    tableHead = table.tHead;
    tableBody = table.tBodies[0];
    emptyState = root.querySelector("#suiteql-empty-state");
    previousButton = root.querySelector("#suiteql-previous");
    nextButton = root.querySelector("#suiteql-next");
    loadNextButton = root.querySelector("#suiteql-load-next");
    pageStatus = root.querySelector("#suiteql-page-status");
    editorPanel = root.querySelector("#suiteql-editor-panel");
    resizeHandle = root.querySelector("#suiteql-resize-handle");
  }

  function initialize() {
    document.documentElement.classList.add("suiteql-results", "suiteql-v3");
    document.title = "SuiteQL Console";
    createMarkup();

    const urlQuery = params.get("suiteql")?.trim() || "";
    const draft = urlQuery || sessionStorage.getItem(SESSION_KEYS.draft) || "";
    if (urlQuery) {
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.set("suiteql", "");
      history.replaceState(history.state, "", cleanUrl);
    }
    pagedInput.checked = sessionStorage.getItem(SESSION_KEYS.paged) === "true";

    editor = new EditorView({
      parent: root.querySelector("#suiteql-container"),
      doc: draft,
      extensions: [
        basicSetup,
        sql({ dialect: StandardSQL }),
        shortcutExtensions(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            persistDraft();
          }
        })
      ]
    });

    installEvents();
    installResizeBehavior();
    renderTable();
    editor.focus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
