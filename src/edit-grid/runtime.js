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
  // The axis is derived ONCE from a native-order DOM and pinned here. It survives
  // repaints, which DOM stamps cannot. appliedOrder is the non-native column order
  // this runtime has applied, or null while the machine is in native order.
  // axisMismatch latches when the machine's own axis changes underneath the pin;
  // only removeEditGrid clears it.
  let pinnedColumnIds = null;
  let appliedOrder = null;
  let axisMismatch = false;
  let entry = {};
  let pendingApply = false;
  let installErrorLogged = false;
  let warnedNewerSchema = false;
  // The widths THIS mount will apply, keyed by column id: seeded from the stored
  // entry on install, replaced wholesale by a resize gesture, emptied on teardown.
  // Only these are ever persisted.
  let columnWidths = {};
  // What the first freeze of this mount actually put on the header cells, for
  // EVERY column — the user's and the ones that merely kept what they rendered.
  // Session-only and never written to storage. Measured 2026-08-03 on the
  // fixture: `table-layout: fixed` lives on the <table> and survives the <tbody>
  // repaint, while the header cells' inline widths do not, so between a repaint
  // and the next apply the browser redistributes the machine into equal columns.
  // An apply that re-measured then would freeze THOSE — a 325px Description
  // collapsed to 111px on the first repaint after a resize. Re-applying what was
  // frozen while the machine still had its own layout is what makes widths
  // survive a repaint at all.
  let frozenWidths = {};
  // The live gesture, or null. Never a cached column minimum — see handleResizeMove.
  let resizing = null;
  // Bumped by every teardown, captured by every save operation at ENQUEUE time.
  // The queue's own reset (see enqueueSave) only guarantees that an operation
  // resuming after a teardown finds a FRESH chain; it neither cancels the
  // in-flight operation nor checks whose mount it belongs to. This is that
  // check, and it is the writer's, exactly as the queue's comment says.
  let mountGeneration = 0;
  // The two halves of the reseed guard (M2 Task 13 verdict, defect D2). An
  // install re-seeds columnWidths from a storage snapshot taken BEFORE its own
  // await, so a gesture that lands inside that await is newer than the snapshot
  // and must outrank it — live, a reseed in that gap dropped Quantity's 119px
  // from module state, and the NEXT gesture's write then replaced entry.widths
  // wholesale (core writeField) with a map the lost column was no longer in.
  //   pendingWrites — saves this mount has enqueued and not yet finished. A
  //     reseed while one is in flight is reading storage the write has not
  //     reached yet, by definition.
  //   saveEpoch — monotonic, bumped at every enqueue. An install captures it
  //     before its await and refuses the reseed if it moved, which covers the
  //     narrower gap where the save COMPLETED during the await and the install's
  //     own snapshot is simply older than the write.
  // Both are needed: the counter cannot see a save that has already finished,
  // and the epoch cannot see one that has not started writing yet.
  let pendingWrites = 0;
  let saveEpoch = 0;
  const RESIZE_EDGE_PX = 5;

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

  function sameColumnIds(left, right) {
    return left.length === right.length && left.every((id, index) => id === right[index]);
  }

  function currentColumnIds(table) {
    // Latched refusal comes first. Installs are repaint-driven and arrive
    // milliseconds apart, so clearing the pin alone would let the very NEXT
    // install re-pin the changed axis — the silent swap spec A1.2 rule 4
    // forbids, reintroduced through the back door. Only teardown clears this.
    if (axisMismatch) {
      return [];
    }
    // P-MONO (spec Amendment A1.2): core.correlateColumnIds only ever emits an
    // increasing subsequence of the machine's own field order, so once WE have
    // permuted the rendering it cannot recover the axis — measured on the live
    // payload, every single-column move either declines (55%) or silently
    // mis-keys (45%), and none is correct. Reuse the pin instead of asking.
    if (appliedOrder) {
      return pinnedColumnIds ?? [];
    }
    // The mini-form boundary (live 2026-08-03, M1.5 re-probe): NetSuite wraps
    // the machine table in its OWN form — form[name="item_form"] — while the
    // serialized identity inputs live in form[name="main_form"]. sameForm was
    // FALSE live, so core's table.closest("form") route reaches a form that can
    // never hold them and every live install died on an empty axis. Resolve them
    // here, where the whole document is in scope, exactly the way the repo's
    // live-verified route does (src/internal-ids/runtime.js:56,198,202): under
    // #main_form, falling back to the bare name for a page with no #main_form.
    // core.readColumnIds stays the fallback for a machine whose inputs are only
    // reachable through its own form — the shape every unit harness models.
    const machineId = core.machineIdFromTable(table);
    const machineFieldInput = (suffix) => {
      const name = `${machineId}${suffix}`;
      return document.querySelector(`#main_form input[type="hidden"][name="${name}"]`)
        ?? document.querySelector(`input[name="${name}"]`);
    };
    // A machine id that is not a bare identifier cannot be spliced into a
    // selector safely, so it declines to the fallback instead of throwing.
    const fields = /^[A-Za-z_][A-Za-z0-9_]*$/.test(machineId) ? machineFieldInput("fields") : null;
    const data = fields ? machineFieldInput("data") : null;
    const derived = fields && data
      ? core.readColumnIdsFrom(table, fields.value, data.value)
      : core.readColumnIds(table);
    if (!derived.length) {
      // A transient read during a repaint must not discard a still-valid pin.
      return [];
    }
    if (pinnedColumnIds && !sameColumnIds(pinnedColumnIds, derived)) {
      // The machine's own layout changed under us. The stored entry is keyed to
      // the old axis, so adopting the new one silently would relabel the user's
      // saved layout: drop the pin, latch, and decline for the life of the mount.
      pinnedColumnIds = null;
      axisMismatch = true;
      return [];
    }
    pinnedColumnIds = derived;
    return derived;
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
    // ENTRY-ROW DIRTINESS — decided at M2 Task 12, KEPT unqualified, and this is
    // the record. FOCUSED_ROW_SELECTOR matches the permanent entry row too (live
    // 2026-08-02: it is always present and always focused), so with no line open
    // this answers about the entry row, and a user who has typed into it reads as
    // dirty. That is the MITIGATION, not the defect: a half-typed new line is
    // exactly the state that must not have an apply yank the table out from under
    // it, and the cost of the alternative — qualifying the selector to numbered
    // rows — is that mid-typing users get their layout rewritten under the caret.
    // querySelector takes the FIRST focused row in document order, so an open
    // numbered line (which renders above the entry row) still governs whenever
    // there is one. Pinned behaviourally by "typing into the permanent entry row
    // reads as dirty, and an open line still governs" in tests/edit-grid.test.mjs.
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

  // ===== Resize =====
  function headerCellsOf(table) {
    return core.visibleCells(core.headerRow(table));
  }

  function resizeEdgeCell(table, event) {
    // A 5px zone on the right edge of a header cell. NetSuite's own field help
    // lives on .listheader inside the cell, so anything outside this zone stays
    // native (src/styles/netsuite.css:1616-1623).
    for (const cell of headerCellsOf(table)) {
      const rect = cell.getBoundingClientRect?.();
      if (
        rect
        && event.clientX >= rect.right - RESIZE_EDGE_PX
        && event.clientX <= rect.right + 1
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom
      ) {
        return cell;
      }
    }
    return null;
  }

  function columnIdOfHeaderCell(table, cell) {
    // currentColumnIds, never core.readColumnIds: the pin is the only sanctioned
    // axis read in this runtime (spec A1.2 rule 3, and the "every axis read goes
    // through the pin" test), and a gesture keyed to a freshly derived axis would
    // resize a different column than the one under the pointer.
    const columnIds = currentColumnIds(table);
    const cells = headerCellsOf(table);
    const index = cells.indexOf(cell);
    // The visible index is only a key while the axis and the rendered header are
    // the same width — the very gate core.applyWidths refuses on. A 43-id axis
    // indexed onto a 42-cell header caught mid-repaint would silently key the
    // gesture to a neighbouring column.
    if (index < 0 || cells.length !== columnIds.length) {
      return null;
    }
    return columnIds[index] ?? null;
  }

  function handleResizeHover(event) {
    const table = event.target?.closest?.(core.MACHINE_TABLE_SELECTOR);
    if (!table || resizing) {
      return;
    }
    const edge = resizeEdgeCell(table, event);
    for (const cell of headerCellsOf(table)) {
      cell.classList.toggle(core.CLASSES.resizeEdge, cell === edge);
    }
  }

  function handleResizeLeave() {
    // pointermove stops firing the moment the pointer leaves the container, so
    // without this the edge marker (a 3px inset bar, edit-grid.css) stays painted
    // on whichever cell was under the pointer as it left. Third delegated type,
    // still one handler per type on the container — the rule is one listener per
    // event type, not two events total.
    if (resizing) {
      return;
    }
    for (const cell of headerCellsOf(activeTable ?? machineTable())) {
      cell.classList.remove(core.CLASSES.resizeEdge);
    }
  }

  function handleResizeDown(event) {
    try {
      const table = event.target?.closest?.(core.MACHINE_TABLE_SELECTOR);
      if (!table || event.button !== 0) {
        return;
      }
      const cell = resizeEdgeCell(table, event);
      const columnId = cell ? columnIdOfHeaderCell(table, cell) : null;
      if (!cell || !columnId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Prefer the applied style width: live NetSuite collapsed borders render
      // ~2px over the style value and re-measuring rects would accumulate it.
      const styleWidth = Number.parseInt(cell.style?.width ?? "", 10);
      resizing = {
        table,
        columnId,
        startX: event.clientX,
        startWidth: Number.isFinite(styleWidth) ? styleWidth : cell.getBoundingClientRect().width
      };
      document.body?.classList?.add(core.CLASSES.resizing);
      document.addEventListener("pointermove", handleResizeMove, true);
      document.addEventListener("pointerup", handleResizeUp, true);
    } catch {
      handleResizeUp();
    }
  }

  function handleResizeMove(event) {
    if (!resizing) {
      return;
    }
    const columnIds = currentColumnIds(resizing.table);
    // MEASURED HERE, on every move, and never carried over from pointerdown.
    // src/styles/netsuite.css:2999-3001 sizes a materialised widget at
    // calc(100% - 21px) of its own cell, so a column minimum is a function of the
    // width the column HAS when it is measured: a floor captured at pointerdown
    // would sit 21px under the starting width and refuse every shrink for the
    // rest of the gesture (task-11-report.md open item 2).
    //
    // The other half of that note — that a floor cached across a line close
    // would raise a later FREEZE — no longer describes this code and is left
    // here only to be struck: an apply takes no floor at all now, so a stale
    // minimum cannot reach one. It is quoted because the assumption behind it,
    // that a raise on the apply path is transient and self-correcting, is what
    // concealed defect D1 through an entire task and a live gate.
    //
    // This is the ONLY floor in the feature (M2 Task 13 verdict, defect D1): the
    // widget minimum applies where the user is CHOOSING a width and nowhere else.
    // An apply is a pure function of the widths it is handed — see
    // core.applyWidths' clamp — so the value floored here is the value stored,
    // re-applied and re-restored, unchanged, for the rest of the session.
    const minimums = core.columnMinimums(resizing.table, columnIds);
    const next = core.clampWidth(
      resizing.startWidth + (event.clientX - resizing.startX),
      minimums[resizing.columnId]
    );
    columnWidths = { ...columnWidths, [resizing.columnId]: next };
    applyCurrentWidths(resizing.table, columnIds);
  }

  function handleResizeUp() {
    document.removeEventListener("pointermove", handleResizeMove, true);
    document.removeEventListener("pointerup", handleResizeUp, true);
    document.body?.classList?.remove(core.CLASSES.resizing);
    if (!resizing) {
      return;
    }
    resizing = null;
    // One gesture, one write. Nothing else in this file writes storage.
    saveWidths();
  }

  function plannedWidths() {
    // The user's widths over the ones this mount froze. Nothing is planned at all
    // until the user has set one: a machine nobody has resized keeps its own
    // layout, which is what leaves the 28 screenshot baselines untouched.
    return Object.keys(columnWidths).length ? { ...frozenWidths, ...columnWidths } : null;
  }

  function applyCurrentWidths(table, columnIds) {
    // Adjudication #14: the axis is a PARAMETER of core.applyWidths and every
    // apply hands it the pinned one — core never derives its own.
    //
    // No minimums are measured here, and core is handed the same empty map the
    // teardown clear passes (M2 Task 13 verdict, defect D1). This function used
    // to hand core a FRESH core.columnMinimums on every non-drag apply, which is
    // what turned every apply into a re-measurement of the live table and walked
    // every widget-bearing column wider each time. The floor lives at the choice
    // — handleResizeMove — and an apply now reproduces plannedWidths() exactly.
    const planned = plannedWidths();
    // Whether this apply is the one that takes the machine OUT of its own layout.
    // Only that one may record what it froze: a later apply runs against a table
    // the browser has already redistributed into equal columns, so the width it
    // would record for an unresized column is the redistribution's, not the
    // machine's own. Recording that would make a transient collapse permanent for
    // the session — the 325px Description that came back as 111px.
    const freezing = planned !== null && table?.style?.tableLayout !== "fixed";
    const applied = core.applyWidths(table, planned, {}, columnIds);
    if (!applied) {
      return false;
    }
    if (planned === null) {
      frozenWidths = {};
    } else if (freezing) {
      const frozen = {};
      headerCellsOf(table).forEach((cell, index) => {
        const id = columnIds[index];
        const width = Number.parseInt(cell.style?.width ?? "", 10);
        if (id && Number.isFinite(width) && width > 0) {
          frozen[id] = width;
        }
      });
      frozenWidths = frozen;
    }
    return true;
  }

  function applyWhileLineOpen(table, columnIds) {
    // The queue-while-open rule is spec section 6, the open-line state machine
    // (design :119-122), and its fail-closed row at :145. It named width
    // alongside hide/show and filter; SPEC AMENDMENT 2 (adjudication #16) takes
    // width out of that set and this is the code it amends to. Hide/show and
    // filter are still queued, reorder and sort are still refused outright.
    //
    // The grounds: `table-layout: fixed` is set on the <table> and the <table>
    // survives the <tbody> regeneration while the header cells' inline widths do
    // not, so between a repaint and the next apply the machine is laid out as
    // fixed-with-no-widths and the browser distributes the space equally. An
    // apply that does not run IS the yank the rule exists to prevent — measured
    // on the fixture: opening a line collapsed all twelve columns to 120px and
    // they stayed collapsed until the line was closed. Re-applying the same
    // pixels is invisible: style.width on the header row and nothing else, no
    // row moved, revealed or hidden, no widget touched, no focus moved, and the
    // observer watches childList only so it cannot feed back.
    pendingApply = true;
    // Latched here and cleared only by queueApply and removeEditGrid, so in
    // practice it latches until teardown: nothing flushes it yet, because the
    // sets that need flushing do not exist yet. Deliberately left that way —
    // M3 owns the flush trigger (focusin, or the line-closed repaint) and
    // designing it here would be pre-empting a decision with no caller. Widths
    // do not depend on it: they are applied on the line below, not queued.
    applyCurrentWidths(table, columnIds);
  }

  function saveWidths() {
    // Everything the operation needs is captured HERE, at enqueue time: the queue
    // hands the operation `undefined` (the stored chain resolves to nothing and
    // its rejections are swallowed), so nothing may be read off the chain, and
    // module state read at run time would be the NEXT mount's, not this gesture's.
    const generation = mountGeneration;
    const scope = scopeKey;
    const widths = Object.keys(columnWidths).length ? { ...columnWidths } : null;
    // Both halves of the reseed guard are armed HERE, at enqueue, for the same
    // reason the snapshot is taken here: the gesture is over the moment
    // pointerup returns, and an install that lands from now until this operation
    // finishes is looking at storage that predates it.
    pendingWrites += 1;
    saveEpoch += 1;
    return enqueueSave(async () => {
      try {
        // Checked twice — once before the read and once after it — because the
        // await is where a teardown lands. Without this a gesture interrupted by
        // a settings toggle, a pagehide or a remount would write the dead mount's
        // widths, and with columnWidths already emptied it would write a CLEAR.
        if (!scope || generation !== mountGeneration) {
          return;
        }
        const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
        if (generation !== mountGeneration) {
          return;
        }
        const next = core.withWidths(stored[core.STORAGE_KEY], scope, widths);
        if (!next) {
          showToast("Column layout could not be saved.", "warning");
          return;
        }
        await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
      } catch {
        showToast("Column layout could not be saved.", "warning");
      } finally {
        // Every enqueue is balanced here, including the ones that return early
        // on a dead generation: the operation always runs, because the queue
        // chains it with (operation, operation) and a teardown replaces the
        // module's chain without unchaining what is already on it. Floored at 0
        // so the teardown reset below cannot drive the counter negative.
        pendingWrites = Math.max(0, pendingWrites - 1);
      }
    });
  }

  // ===== Delegated listeners (one per event type, on the container) =====
  const DELEGATED_LISTENERS = [
    ["pointermove", handleResizeHover],
    ["pointerleave", handleResizeLeave],
    ["pointerdown", handleResizeDown]
    // M3 adds focusin, M5 the control clicks, M6/M7 the header menu. Nothing is
    // bound per row: rows are destroyed on every repaint and per-row binding is
    // how duplicate handlers accumulate. The drag pair (pointermove/pointerup
    // under capture) is bound on the document for the life of one gesture only,
    // by handleResizeDown, and removed by handleResizeUp.
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

  function stampAxis(container, columnIds) {
    // Publishes the axis THIS mount pinned onto the bound container, where a
    // MAIN-world probe can read it (core.AXIS_ATTRIBUTE carries the reasoning
    // for why that discloses nothing the page does not already hold). Written
    // only when the value changes: installs are repaint-driven and the pin
    // cannot change without a teardown, so this is one write per mount.
    const value = columnIds.join(",");
    if (container.getAttribute(core.AXIS_ATTRIBUTE) !== value) {
      container.setAttribute(core.AXIS_ATTRIBUTE, value);
    }
  }

  function clearAxisStamp(container) {
    // The teardown sweep below removes owned NODES; this stamp sits on the
    // machine's own container, which we do not own and must not remove, so it
    // comes off by name — exactly like BOUND_ATTRIBUTE.
    container?.removeAttribute?.(core.AXIS_ATTRIBUTE);
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
    // Two promises, deliberately. `next` is the CALLER'S: it carries the
    // operation's own rejection, so a caller that awaits still sees its failure.
    // The STORED chain is `next` with that rejection swallowed, so one failed
    // write can neither reject the queue for the operation behind it nor
    // surface as an unhandled rejection when the caller fires and forgets —
    // and a writer that fires and forgets is exactly what M2 wires.
    // The (operation, operation) pair stays the serializer: belt and braces now
    // that the stored chain cannot reject, and the thing that keeps ordering
    // correct if saveQueue is ever assigned from anywhere but here.
    const next = saveQueue.then(operation, operation);
    saveQueue = next.catch(() => {});
    return next;
  }

  // ===== Apply =====
  function renderSignature(table, columnIds) {
    // Everything the runtime applies MUST appear here. An install whose current
    // signature already equals the target performs zero DOM and zero storage
    // writes — that is what makes "one gesture = exactly one write" testable.
    return JSON.stringify({
      ids: columnIds,
      layout: table?.style?.tableLayout ?? "",
      widths: headerCellsOf(table).map((cell) => cell.style?.width ?? "")
    });
  }

  function targetSignature(table, columnIds) {
    // The exact strings applyCurrentWidths WILL leave behind, computed the same
    // way core.applyWidths computes them — stored width when there is one, the
    // currently rendered width otherwise, clamped to the STATIC bounds only, and
    // NOT gated on a positive target: a zero-rendered column takes the clamp
    // floor there (adjudication #15) and must take it here too.
    // The two must not drift in either direction: a target core cannot reproduce
    // means every install re-applies forever, and a target that overstates what
    // core writes means an apply that is genuinely needed never runs. The
    // per-column widget floor came out of BOTH sides together (M2 Task 13 verdict,
    // defect D1) for exactly that reason: leave it here alone and the signature
    // predicts a width core no longer writes, so every install re-applies forever.
    const planned = plannedWidths();
    return JSON.stringify({
      ids: columnIds,
      layout: planned ? "fixed" : "",
      widths: headerCellsOf(table).map((cell, index) => {
        if (!planned) {
          return "";
        }
        const id = columnIds[index];
        const stored = Number(planned[id]);
        const rendered = Math.round(cell.getBoundingClientRect?.().width ?? 0);
        const target = Number.isFinite(stored) && stored > 0 ? stored : rendered;
        return `${core.clampWidth(target, 0)}px`;
      })
    });
  }

  function applyAll(table, columnIds) {
    // M3 appends applyCurrentHidden, M6 applyCurrentFilters, M7 applyCurrentSort.
    applyCurrentWidths(table, columnIds);
  }

  function queueApply(reason) {
    // Read first, gate second: the open-line path applies the widths too and
    // needs the same table and the same pinned axis the full apply would use.
    const table = machineTable();
    const columnIds = table ? currentColumnIds(table) : [];
    if (!table || columnIds.length < 2) {
      return;
    }
    activeTable = table;
    if (isLineOpen()) {
      // Hide/show and filter changes queue while a line is open and flush when it
      // closes; reorder and sort are refused outright (M4/M7). Widths are applied
      // — see applyWhileLineOpen.
      applyWhileLineOpen(table, columnIds);
      return;
    }
    pendingApply = false;
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
      const columnIds = currentColumnIds(table);
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
      stampAxis(container, columnIds);
      // Captured BEFORE the await, because the await is the gap a gesture lands
      // in and this is what tells the reseed below that it did (defect D2).
      const epoch = saveEpoch;
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
      const current = currentColumnIds(table);
      // This second read sits AFTER an awaited storage read, so a repaint that
      // lands mid-await can change the machine's own axis, latch the mismatch
      // and answer [] on an install whose first read succeeded. Today the two
      // signatures below agree on an empty axis and return before applyAll; the
      // moment M2 gives targetSignature real content they diverge and
      // applyAll(table, []) — an apply keyed to no columns — becomes reachable.
      // Refuse here instead. The mount stands: the marker, the bindings and the
      // stored entry are already in place, and the next repaint re-reads.
      if (current.length < 2) {
        return true;
      }
      // Storage is authoritative on every install, not only the first: installs
      // are repaint-driven, and a copy that drifted from the stored entry would
      // re-apply a width the user's last gesture had already replaced.
      //
      // It lands HERE, below the usability gate, and not beside the read that
      // produced it (M2 Task 13 verdict, defect D2). Two things were wrong with
      // the old position. It ran before the install had decided it was usable,
      // so an install that refuses above still mutated the one record of the
      // user's gestures. And it ran unconditionally, so a snapshot taken before
      // the await outranked a gesture made during it: live, an install in that
      // gap dropped Quantity's 119px from columnWidths while leaving the DOM
      // alone, the next gesture's snapshot was therefore missing it, and
      // core.withWidths replaced entry.widths wholesale — so gesture 2's write
      // DELETED gesture 1's column. The invariant: a width the user has set
      // leaves columnWidths only via teardown or a newer value for the same
      // column, and a storage read that predates a gesture never outranks it.
      if (pendingWrites === 0 && saveEpoch === epoch) {
        columnWidths = { ...(entry.widths ?? {}) };
      }
      if (renderSignature(table, current) === targetSignature(table, current)) {
        return true;
      }
      if (isLineOpen()) {
        applyWhileLineOpen(table, current);
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
      const container = machineContainer(table);
      releaseBindings(container);
      clearAxisStamp(container);
      // Dropped BEFORE handleResizeUp so the teardown takes the document drag
      // listeners and the body cursor off without queueing a save for a mount
      // that is being dismantled: a gesture cannot outlive its own mount.
      resizing = null;
      handleResizeUp();
      // Three arguments deliberately (adjudication #14): the clear path needs no
      // axis and must not, since the pin is dropped below and a mount that can no
      // longer key its columns must still be able to undo what it set.
      core.applyWidths(table, null, {});
      columnWidths = {};
      // M3 appends the hidden reset, M6 the filter reset, M7 the native row order.
    } catch {}
    for (const node of document.querySelectorAll(OWNED_SELECTOR)) {
      node.remove();
    }
    activeTable = null;
    nativeColumnIds = null;
    pinnedColumnIds = null;
    appliedOrder = null;
    axisMismatch = false;
    scopeKey = null;
    entry = {};
    columnWidths = {};
    frozenWidths = {};
    resizing = null;
    pendingApply = false;
    warnedNewerSchema = false;
    // The counter is mount-scoped: every operation this mount enqueued balances
    // itself in its own `finally`, so this only matters for one that never
    // settles at all — without it, such an operation would refuse the reseed for
    // every future mount. saveEpoch is deliberately NOT reset: it is monotonic,
    // and each install captures it fresh, so there is nothing for a reset to buy.
    pendingWrites = 0;
    // Retires every save this mount enqueued. saveWidths captured the old value,
    // so an operation the queue has not reached yet — or one parked on its own
    // storage read — now finds a generation that moved and writes nothing.
    mountGeneration += 1;
    // Module state like the eight above it, and it buys exactly one thing: an
    // operation queued before teardown that resumes AFTER it finds a fresh
    // queue and cannot chain the next mount's writes behind the old mount's.
    // That is ALL. The in-flight operation is not cancelled and is not
    // generation-checked here — whether a write that outlives its own teardown
    // may still touch storage is the WRITER's problem, and M2's runtime task
    // owns that isCurrent/generation guard. Do not read this as one.
    saveQueue = Promise.resolve();
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
