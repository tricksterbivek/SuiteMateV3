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
  // Resolved ONCE per mount and latched — see the install. Every stored read and
  // every write this mount makes is keyed by it, so it is pinned for the same
  // reason the axis below is.
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
  // The container this mount BOUND, kept as a handle rather than re-derived at
  // teardown — see ensureBindings.
  let boundContainer = null;
  // The record that the last hide/reveal did not finish. core.applyHidden walks
  // every row; renderSignature only reads the HEADER, so a walk that stops
  // part-way leaves a machine whose header agrees with the target and whose rows
  // below do not, and the install's early return would then skip the repair for
  // the life of the mount. This is what makes the next pass try again.
  let hideIncomplete = false;
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
  // ADJUDICATION #20. The width each column had the last time this mount saw it
  // NOT hidden by us. Session-only, never persisted, and never written while a
  // column is hidden — that is the whole point.
  //
  // A cell we are hiding carries `display: none !important`, so its border box
  // has NO width: it measures 0, and core.applyWidths' rendered-width fallback
  // turns that 0 into the static floor. The 0 is not a fact about the column, it
  // is an artifact of our own rendering, so a plan built from it launders our
  // output into a width exactly as defect D1 did — and worse, the frozen floor
  // then seeds the next drag on that column (handleResizeDown reads
  // cell.style.width), so it reaches STORAGE. Measured on the fixture: Quantity
  // natural 74px, hidden, another column resized, revealed at 50px, dragged +10,
  // stored as 60.
  let naturalWidths = {};
  // WHETHER THE `table-layout: fixed` ON THE MACHINE IS OURS. Session-only, and
  // the half of rememberNaturalWidths' guard that `fixed` cannot supply on its
  // own: the property sits on the <table>, which outlives the <tbody> and can
  // outlive a whole mount, so an install can meet a `fixed` that no live mount
  // set. It tracks the CURRENT plan and nothing older: an apply that lays the
  // machine out raises it, the apply that hands the machine back its own layout
  // — the null plan, whose restore clears `fixed` — drops it again, and teardown
  // drops it with the widths it belongs to.
  let ownsLayout = false;
  // The columns THIS mount will hide, by column id: seeded from the stored entry
  // on install under the same reseed guard the widths take, replaced by a
  // hide/show gesture, emptied on teardown. Only these are ever persisted, and
  // they are the ONLY seed a hide/show gesture may read (spec Amendment A3.2).
  let hiddenColumns = new Set();
  // The columns THIS FORM makes mandatory, by column id — NetSuite's own star,
  // read from the header on every install (OWNER DIRECTIVE 2026-08-04: a
  // required column must not be hideable). Never stored, never seeded from
  // storage, and never hardcoded: the set is a property of the FORM, and the
  // same id can be starred on one variant and freely hideable on another.
  let requiredColumns = new Set();
  // The control bar this mount owns: { bar, columnsButton, chips, menu }, or
  // null before the first install and after teardown.
  let controlButtons = null;
  // Whether the column menu's document-level dismissal pair is bound. The menu
  // is an owned NODE and dies with the sweep; these listeners are not, so they
  // come off by name — see closeColumnMenu and the teardown.
  let menuDismissBound = false;
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

  // WHETHER A FRESH DERIVATION MAY BE TRUSTED AGAINST THE PIN. It replaces a
  // strict equality compare (sameColumnIds, which had exactly one caller — this
  // one — and so is gone rather than kept dead beside it), and the rule it
  // encodes is: lengths equal, and every position where BOTH sides name a column
  // names the SAME column.
  //
  // WHY IT CANNOT BE EQUALITY ANY MORE. A hole is not a property of the machine,
  // it is a property of the EVIDENCE — core.correlateColumnIds holes a position
  // when the optimal alignments disagree about it, and how much they disagree
  // depends on which of the machine's lines happen to be rendered. A segment-paged
  // machine changes exactly that and nothing else: lines 26-50 corroborate a
  // different subset of columns than lines 1-25, so the same machine, same form,
  // same field list can derive a MORE holed axis on page two. Under equality that
  // reads as "the machine's own layout changed", which latches axisMismatch and
  // kills the mount for the session — the feature turning itself off because the
  // user paged the sublist. The axes are not in conflict; one is just less sure.
  //
  // THE ASYMMETRY IS DELIBERATE AND IS THE SAFETY PROPERTY. A derived hole defers
  // to the pin (the pin was derived from evidence too, and it is the axis every
  // stored key of this mount is already written against). A pin hole meeting a
  // derived id does NOT upgrade the pin: adopting it mid-mount would relabel a
  // column the user has been looking at — its menu row would silently go from
  // disabled to hideable, and a hide made against the new id would key storage
  // under a name the rest of the session never used. Identity is decided once per
  // mount, which is A1.2 rule 3 restated for holes.
  //
  // What still latches is a REAL conflict: both sides naming a column, and naming
  // different ones. That is the machine's layout actually moving underneath us,
  // and it is refused exactly as before.
  //
  // Element-wise, never a join() compare: that would fold ["a,b"] with ["a", "b"],
  // and a comma in a column id is permitted in principle (normalizeColumnId
  // screens length and the reserved keys, not punctuation) even though NetSuite
  // has never emitted one. Nothing here rests on that never happening.
  function axisCompatible(pinned, derived) {
    return pinned.length === derived.length
      && pinned.every((id, index) => id === null || derived[index] === null || id === derived[index]);
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
    if (pinnedColumnIds) {
      if (!axisCompatible(pinnedColumnIds, derived)) {
        // The machine's own layout changed under us — two ids in conflict at one
        // position, or a different width. The stored entry is keyed to the old
        // axis, so adopting the new one silently would relabel the user's saved
        // layout: drop the pin, latch, and decline for the life of the mount.
        pinnedColumnIds = null;
        axisMismatch = true;
        return [];
      }
      // THE PIN, NOT THE DERIVATION, on every read after the first. The two are
      // compatible but not necessarily equal, and the pin is the one that can only
      // ever be MORE resolved: returning the derivation would let a segment whose
      // lines corroborate less quietly hole a column this mount has been keying
      // all along — the hidden set would stop applying to it and its menu row
      // would go disabled, mid-session, because the user paged the sublist.
      return pinnedColumnIds;
    }
    pinnedColumnIds = derived;
    return derived;
  }

  // THE OPEN-LINE AND DIRTY PREDICATES LIVED HERE AND ARE GONE — isLineOpen,
  // isDirty, rowIsDirty and fieldIsDirty, with forcedRows before them.
  //
  // OWNER DIRECTIVE 2026-08-04, second half, from live use: once a user hides a
  // column it stays hidden AT ALL TIMES — editing an existing line, adding a new
  // one, selecting an item, changing a value, and through every repaint those
  // cause. It changes only when the user changes their column personalization.
  // That deletes the force-reveal, and the force-reveal was the sole consumer of
  // all four: nothing in this runtime now asks whether a line is open or whether
  // a field has been touched. Zero call sites is deletion, which is the ruling
  // forcedRows took and for the same reason.
  //
  // WHAT THEY KNEW, kept because it was measured live and the next reader should
  // not have to buy it a second time.
  //   Live 2026-08-02: the permanent entry row ALWAYS carries
  //   `uir-machine-row-focused` and its button row is ALWAYS attached, so "any
  //   focused row" is true for the whole session. An open EXISTING line is a
  //   focused row that ALSO carries a numbered {machine}_row_{n} id, and a
  //   predicate missing that qualifier starves every queued apply for the life
  //   of the mount.
  //   `defaultValue` on a checkbox or a radio is its VALUE attribute, not its
  //   pristine checked state, so `value !== defaultValue` calls a ticked box
  //   clean; the pristine state is `defaultChecked`. A <select> has no
  //   defaultValue at all — its pristine option is `defaultSelected`, or the
  //   first option when the markup names none.
  //
  // WHAT THE REVEAL PROTECTED IS NOT LOST, it is delivered upstream and by a
  // stronger mechanism. readRequiredColumns refuses to hide a column NetSuite
  // stars AT ALL (the same directive's first half, 08e3c1e), so the required-
  // field trap the reveal existed for cannot be entered. Live probe 11 measured
  // the rest: a line commits cleanly with a column hidden and its value
  // preserved, because widgets materialise PER CELL on click — a hidden cell's
  // widget never exists, so it can trap neither focus nor validation. The
  // residual is a custom client script validating a NON-starred field the user
  // chose to hide: an accepted trade, recorded in the M3 ledger, and NetSuite's
  // own alert for it is visible whatever we hide.

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
    // `?? null` covers BOTH holes an axis can have, and they are different
    // things: an out-of-range index (undefined) and an UNRESOLVED column — a
    // position core.correlateColumnIds left null because the optimal alignments
    // disagreed about it. Both answer null, and the callers below refuse on
    // null, which is the whole of the storage safety for the resize path: a
    // column with no identity cannot be keyed, so it cannot be dragged.
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
      // NO ID, NO GESTURE, and `!columnId` is the line that enforces it. A drag
      // is the only thing in this runtime that puts a NEW key into columnWidths,
      // and columnWidths is written to storage verbatim — so an unresolved
      // column allowed to start a drag would key the map with `null`, which
      // becomes the property name "null", which core.normalizeWidths accepts as
      // a perfectly ordinary column id and persists. Every unresolved column on
      // every form would then share that one stored width. The refusal is here,
      // at the START of the gesture, because that is the only point where
      // nothing has been written yet: handleResizeMove already assumes a key.
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
    // ADJUDICATION #20, and the ORDER is the ruling. Weakest first: the last
    // width we saw a column render while we were not hiding it, then what this
    // mount's freeze recorded, then the user's own gesture. A hidden column is
    // absent from `frozenWidths` by construction (the freeze refuses to record
    // one) and absent from `columnWidths` unless the user dragged it while it was
    // visible, so what it contributes here is always `naturalWidths` — a
    // measurement taken when the column was NOT hidden.
    //
    // WHY THE PLAN STILL NAMES IT, rather than omitting it as the ruling's
    // literal shape read. Omitting is necessary but not sufficient, and this was
    // measured rather than reasoned: core.applyWidths writes to EVERY visible
    // header cell, and a class-hidden cell is still a visible cell (that is the
    // A3.2 carve-out — we hide by class precisely so the column stays on the
    // axis). A column the plan omits therefore takes core's `rendered` fallback,
    // which for a hidden cell is 0, which clamps to the floor — the identical
    // 50px the ruling exists to prevent, now reached by a different line. The
    // exclusion that does the work is the one at the FREEZE, and the plan carries
    // the last honest measurement instead. It also keeps the plan TOTAL, which
    // core.applyWidths' partial-plan walk requires (M2 Task 13a's precondition).
    return Object.keys(columnWidths).length
      ? { ...naturalWidths, ...frozenWidths, ...columnWidths }
      : null;
  }

  function rememberNaturalWidths(table, columnIds) {
    // ONCE THE MACHINE HAS LEFT ITS OWN LAYOUT, NOTHING HERE IS MEASURABLE. This
    // is the same window frozenWidths documents above (:58-67) and the same one
    // its `freezing` gate refuses in: after a repaint the header's inline widths
    // are gone but `table-layout: fixed` survives on the <table>, so the browser
    // has redistributed the machine into equal columns and every cell reports a
    // number that is OUR layout's, not NetSuite's.
    //
    // Without this the class guard below is not enough and was measured not to
    // be — CRITICAL from the Task 16 review, D1's laundering shape reaching
    // storage for the third time. The repaint takes the header row with the
    // tbody, so OUR CLASS IS GONE too: the guard cannot fire, the redistribution
    // width overwrites the natural one, and for a column hidden at freeze time
    // frozenWidths is empty by #20's own exclusion, so nothing masks it and the
    // plan hands core the redistribution. Live shape: 74 natural, 62 after a
    // repaint, and a +10 drag then storing 72 where the truth is 84.
    //
    // This makes the code match this map's own definition — "the width each
    // column had the last time this mount saw it NOT hidden" is only meaningful
    // while the machine still owns its layout.
    //
    // AND `fixed` ALONE IS NOT THE PREDICATE. `ownsLayout` is the other half,
    // and it is what makes this guard fail-SAFE rather than fail-open: `fixed`
    // answers "is this table laid out by someone", never "is that someone us".
    // The window that separates the two is a teardown that lands mid-buildtable,
    // with the header row already gone with the <tbody>: removeEditGrid's
    // null-plan clear refuses at core's header gate, core.js:871-873, and never
    // reaches the restore that clears the layout at core.js:886-888, while the
    // state clears run regardless. Reading `fixed` alone there, the NEXT install
    // meets a laid-out table with an empty naturalWidths, refuses to measure
    // forever, never freezes, and plans a PARTIAL map — so a hidden column
    // renders 0, takes core's 50px floor, and a reveal-then-drag stores the
    // floor plus the delta (probe: 60 stored where the truth is 72). That is
    // #20's own defect re-entered through the guard meant to close it, and it
    // also breaks core.js:949-966's total-plan precondition. Teardown now clears
    // the layout unconditionally; this half means a `fixed` left by anything
    // else — a dead mount, a future caller — still cannot starve a fresh one.
    //
    // AND WHAT MAKES A TRUE FLAG SAFE TO REFUSE ON, stated because refusing to
    // measure is the dangerous direction. Two facts, both structural. The flag
    // is only ever raised by an apply, and every apply runs this function FIRST
    // (see applyCurrentWidths), so a true flag means the measurement pass has
    // already run at least once with the flag still false — on a machine this
    // mount had not laid out. And naturalWidths is emptied in exactly ONE place,
    // the teardown, which clears the flag in the same block. A refusal here can
    // therefore only decline to OVERWRITE what that pass found with post-layout
    // numbers; it can never be the reason the plan has nothing. The partial plan
    // is unreachable from a true flag by construction, not by luck.
    if (ownsLayout && table?.style?.tableLayout === "fixed") {
      return;
    }
    // Measured ONLY where we are not hiding, which is what makes this a record of
    // NetSuite's own layout rather than of ours. Runs before the hide pass of the
    // same apply (see applyAll), so on a fresh mount every column is recorded
    // before anything is hidden, and a column already hidden keeps whatever was
    // recorded the last time it was not.
    headerCellsOf(table).forEach((cell, index) => {
      const id = columnIds[index];
      if (!id || cell.classList?.contains?.(core.CLASSES.colHidden) === true) {
        return;
      }
      const width = Math.round(cell.getBoundingClientRect?.().width ?? 0);
      if (width > 0) {
        naturalWidths[id] = width;
      }
    });
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
    //
    // Recorded BEFORE the plan is built and before the freeze measures anything:
    // this is the only moment in an apply where a column we are about to hide is
    // still rendering NetSuite's own layout (adjudication #20).
    rememberNaturalWidths(table, columnIds);
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
    // THE OWNERSHIP RECORD: the CURRENT plan holds the layout, or nothing does.
    // Taken here because here is the only place it is knowable — core.applyWidths
    // has just returned true, and it is the one call in this feature that writes
    // `table-layout: fixed` for a real plan and clears it again for a null one.
    // An apply it REFUSED (a header the axis no longer aligns to) wrote neither,
    // so it must claim neither: a mount that claims a layout it did not set is
    // the fail-open half rememberNaturalWidths' guard exists to refuse.
    ownsLayout = planned !== null;
    if (planned === null) {
      frozenWidths = {};
      return true;
    }
    if (freezing) {
      const frozen = {};
      headerCellsOf(table).forEach((cell, index) => {
        const id = columnIds[index];
        // ADJUDICATION #20 — THE EXCLUSION THAT DOES THE WORK. A column we are
        // hiding contributes nothing to the freeze: the width core just wrote to
        // it is the static floor it derived from a zero border box, and recording
        // that would make this mount's own rendering the column's width for the
        // rest of the session. plannedWidths falls back to naturalWidths for it.
        //
        // THIS DOES NOT CONTRADICT ADJUDICATION #15, and the two partition on one
        // question — is this column currently RENDERING? #15 governs a column that
        // renders and measures 0: it participates in the fixed layout, so leaving
        // it unfrozen shifts pixels, and flooring it is the remedy. A column we
        // have hidden participates in nothing — `display: none !important` takes
        // it out of the fixed-layout calculation entirely — so #15's harm cannot
        // occur here and #15's remedy is what does the damage. Do not collapse
        // these into one rule; the same clamp is right there and wrong here.
        if (cell.classList?.contains?.(core.CLASSES.colHidden) === true) {
          return;
        }
        const width = Number.parseInt(cell.style?.width ?? "", 10);
        if (id && Number.isFinite(width) && width > 0) {
          frozen[id] = width;
        }
      });
      frozenWidths = frozen;
    }
    return true;
  }

  // applyWhileLineOpen() lived here and is GONE. It ran a DIFFERENT apply while
  // a line was open — widths yes, hide/show no — and after the owner directive
  // there is no difference left for it to run: its body and applyAll's became
  // character-identical, because the whole of the difference had always lived in
  // effectiveHidden's open-line answer and never in these two bodies. A branch
  // whose arms are the same is a line no mutation can kill and no reader can
  // trust, which is adjudication #19's objection and its remedy. applyAll is now
  // the only apply there is, it runs whatever the machine is doing, and the two
  // rules that used to be stated here are stated there.

  // The ONE write site in this runtime, shared by every field that persists.
  // `writeField` is handed the raw stored container and this mount's scope key
  // and returns the next container, or a falsy value the caller must refuse on —
  // it is the only thing a caller supplies, and it closes over a snapshot the
  // caller took at ENQUEUE time.
  //
  // Shared rather than copied per field on purpose. A second writer with its own
  // copy of the generation guard, the double check around the await and the
  // refusal toast is three chances to drift from the first, and the width writer
  // was where every one of those clauses was paid for.
  function saveField(writeField) {
    // Everything the operation needs is captured HERE, at enqueue time: the queue
    // hands the operation `undefined` (the stored chain resolves to nothing and
    // its rejections are swallowed), so nothing may be read off the chain, and
    // module state read at run time would be the NEXT mount's, not this gesture's.
    const generation = mountGeneration;
    const scope = scopeKey;
    return enqueueSave(async () => {
      // Checked twice — once before the read and once after it — because the
      // await is where a teardown lands. Without this a gesture interrupted by
      // a settings toggle, a pagehide or a remount would write the dead mount's
      // state, and with the module's own copy already emptied it would write a
      // CLEAR.
      try {
        if (!scope || generation !== mountGeneration) {
          return;
        }
        const stored = await chrome.storage.sync.get(core.STORAGE_KEY);
        if (generation !== mountGeneration) {
          return;
        }
        const next = writeField(stored[core.STORAGE_KEY], scope);
        if (!next) {
          showToast("Column layout could not be saved.", "warning");
          return;
        }
        await chrome.storage.sync.set({ [core.STORAGE_KEY]: next });
      } catch {
        showToast("Column layout could not be saved.", "warning");
      }
    });
  }

  function saveWidths() {
    // Snapshotted at enqueue, for the same reason the generation is: the gesture
    // is over the moment pointerup returns, and columnWidths read at run time
    // would be whatever the NEXT gesture or the next mount had left there.
    const widths = Object.keys(columnWidths).length ? { ...columnWidths } : null;
    return saveField((stored, scope) => core.withWidths(stored, scope, widths));
  }

  function saveHidden() {
    // The second writer, and the reason the reseed guard moved into enqueueSave:
    // a writer that armed only the width half would let an install landing in
    // THIS operation's gap reseed hiddenColumns from a pre-write snapshot, and
    // core.withHidden replaces the stored list wholesale — defect D2 for a new
    // field, by exactly the mechanism that deleted a width.
    const hidden = hiddenColumns.size ? [...hiddenColumns] : null;
    return saveField((stored, scope) => core.withHidden(stored, scope, hidden));
  }

  // ===== Control bar =====
  function ownedButton(role, text) {
    const button = document.createElement("button");
    // type="button" is safety-critical inside main_form: a bare <button>
    // defaults to submit and would save the record.
    button.type = "button";
    button.className = core.CLASSES.button;
    button.setAttribute(core.DATA_ATTRIBUTE, role);
    button.textContent = text;
    return button;
  }

  function ensureControls(container) {
    if (controlButtons?.bar?.isConnected) {
      return controlButtons;
    }
    const bar = document.createElement("div");
    bar.className = core.CLASSES.controls;
    bar.setAttribute(core.DATA_ATTRIBUTE, "controls");
    const columnsButton = ownedButton("columns-button", "Columns");
    const chips = document.createElement("span");
    // The bar's own class, reused: it is what lays a row of chips out with a gap
    // (edit-grid.css `.suitemate-v3-edit-grid-controls`), and a bare <span> would
    // leave them inline and touching. Deliberate reuse rather than a second class
    // and a second rule for one identical declaration block.
    chips.className = core.CLASSES.controls;
    chips.setAttribute(core.DATA_ATTRIBUTE, "chips");
    bar.append(columnsButton, chips);
    container.prepend(bar);
    controlButtons = { bar, columnsButton, chips, menu: null };
    return controlButtons;
  }

  // The menu is absolutely positioned on <body>, so the container's own click
  // handler — which already dismisses it for any click inside the machine —
  // cannot see a click that lands anywhere else on the page. These two are the
  // rest of the dismissal, and they follow the drag pair's precedent exactly:
  // document-level, bound while the thing that needs them exists, removed by
  // name when it does not. Nothing is bound per node, so nothing can accumulate.
  const MENU_DISMISS_LISTENERS = [
    ["click", handleMenuDismiss, true],
    ["keydown", handleMenuKey, true]
  ];

  function handleMenuDismiss(event) {
    const target = event.target;
    // The Columns button is exempt or the menu could never be closed BY it: this
    // runs in the capture phase, ahead of the container's delegated click, so
    // closing here would leave that handler seeing no menu and re-opening it.
    // The menu itself is exempt because ticking a box is not dismissing.
    if (
      target?.closest?.(`[${core.DATA_ATTRIBUTE}="menu"]`)
      || target?.closest?.(`[${core.DATA_ATTRIBUTE}="columns-button"]`)
    ) {
      return;
    }
    closeColumnMenu();
  }

  function handleMenuKey(event) {
    if (event.key === "Escape") {
      closeColumnMenu();
    }
  }

  function bindMenuDismissal() {
    if (menuDismissBound) {
      return;
    }
    menuDismissBound = true;
    for (const [type, handler, options] of MENU_DISMISS_LISTENERS) {
      document.addEventListener(type, handler, options);
    }
  }

  function releaseMenuDismissal() {
    if (!menuDismissBound) {
      return;
    }
    menuDismissBound = false;
    for (const [type, handler, options] of MENU_DISMISS_LISTENERS) {
      document.removeEventListener(type, handler, options);
    }
  }

  function closeColumnMenu() {
    releaseMenuDismissal();
    controlButtons?.menu?.remove();
    if (controlButtons) {
      controlButtons.menu = null;
    }
  }

  function openColumnMenu(table, columnIds) {
    closeColumnMenu();
    if (!controlButtons || columnIds.length < 2) {
      return;
    }
    const labels = core.readHeaderLabels(table, columnIds);
    const menu = document.createElement("div");
    menu.className = core.CLASSES.menu;
    menu.setAttribute(core.DATA_ATTRIBUTE, "menu");
    columnIds.forEach((columnId, index) => {
      const row = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      if (columnId === null) {
        // AN UNRESOLVED COLUMN — a position where core.correlateColumnIds found
        // the optimal alignments disagreeing, so this column has NO id at all.
        // It is listed, because the user can see it in the header and a menu
        // that silently omitted it would be a menu that does not describe the
        // machine. It is CHECKED because it is visible and always will be, and
        // DISABLED because there is nothing to key a hide by — the same
        // affordance shape a required column takes (08e3c1e), reached for the
        // opposite reason: that one may not be hidden, this one CANNOT be.
        //
        // IT DOES NOT SEED FROM STORAGE, and cannot: `hiddenColumns` is a set of
        // ids and this row has none, so there is nothing to look up. That is
        // stated rather than assumed because the seeding rule below is A3.2's
        // and a future reader must not "fix" this row to obey it.
        //
        // AND IT CARRIES NO dataset.columnId. handleMenuChange reads that
        // attribute and hands it to setColumnHidden, which refuses a non-string
        // — so this is belt to that brace, and it means a synthetic change event
        // aimed at this row writes nothing even if the disabled attribute is
        // stripped by hand.
        box.checked = true;
        box.disabled = true;
        box.setAttribute(core.DATA_ATTRIBUTE, "column-toggle");
        row.title = "Column identity could not be established on this form";
        const unresolvedText = document.createElement("span");
        // The HEADER's own label, never the id: there is no id. An empty header
        // cannot happen here — core.readColumnIds refuses a machine with a blank
        // label before correlation runs — but `|| ""` keeps textContent a string
        // rather than letting `null` reach it.
        unresolvedText.textContent = labels[index] || "";
        row.append(box, unresolvedText);
        menu.append(row);
        return;
      }
      // A3.2 GESTURE SEEDING. The tick seeds from `hiddenColumns` — this
      // feature's own stored model — and never from what the column RENDERS.
      // Rendered visibility is this feature's own output twice over (our class,
      // our `display: none !important`) and it says "visible" for a column the
      // user hid for the whole of every repaint window — our class dies with the
      // tbody and comes back only when the install's apply lands, and this menu
      // opens on a click that needs no install at all. A menu seeded from the
      // rendering would hand the next gesture a state the user never chose.
      box.checked = !hiddenColumns.has(columnId);
      box.setAttribute(core.DATA_ATTRIBUTE, "column-toggle");
      box.dataset.columnId = columnId;
      // THE ONE CARVE-OUT IN A3.2's SEEDING RULE, and it is deliberate (owner
      // directive 2026-08-04). For a required column the tick does NOT come from
      // storage: this form will not hide it whatever the container says, so a box
      // seeded from a stored hide would render UNTICKED against a column that is
      // plainly there — the menu claiming a hide the machine is not performing,
      // which is the same lie A3.2 exists to prevent, told from the other side.
      // Disabled with it, so the affordance and the model agree.
      if (requiredColumns.has(columnId)) {
        box.checked = true;
        box.disabled = true;
        row.title = "Required column — cannot be hidden";
      }
      const text = document.createElement("span");
      text.textContent = labels[index] || columnId;
      row.append(box, text);
      menu.append(row);
    });
    // The menu is absolutely positioned on <body> because the machine container
    // scrolls and would clip it. Its `change` listener therefore cannot be the
    // container's — it is bound to the menu node itself, which is created and
    // destroyed as ONE node by closeColumnMenu and by the OWNED_SELECTOR sweep,
    // so it can neither accumulate nor leak. That is the same guarantee the
    // container rule buys, not an exception to it: the rule bans binding to ROWS
    // and CELLS, which a repaint destroys underneath us.
    menu.addEventListener("change", handleMenuChange);
    const rect = controlButtons.columnsButton.getBoundingClientRect?.() ?? null;
    if (rect) {
      // A sandboxed window reports no scroll offset at all; `undefined` here
      // would render as "NaNpx" and drop the menu at the origin.
      menu.style.left = `${Math.round(rect.left + (Number(window.scrollX) || 0))}px`;
      menu.style.top = `${Math.round(rect.bottom + (Number(window.scrollY) || 0) + 2)}px`;
    }
    document.body?.append?.(menu);
    controlButtons.menu = menu;
    bindMenuDismissal();
  }

  function renderChips(table, columnIds) {
    const chips = controlButtons?.chips;
    if (!chips) {
      return;
    }
    while (chips.firstChild) {
      chips.firstChild.remove();
    }
    // The clear above is unconditional; the header read is not. This runs on
    // every install, and core.readHeaderLabels CLONES every header cell (that is
    // how readCellText reads past another feature's injected nodes without
    // destroying them), so reading it for a machine with nothing hidden is a
    // clone per column per repaint bought for nothing.
    // A CHIP IS A CLAIM THAT THE COLUMN IS HIDDEN, and for a required id that
    // claim is never true — this form will not hide it under any state, so it
    // gets no chip and no ✕ that would undo nothing.
    const shown = hideableHidden();
    if (!shown.size) {
      return;
    }
    const labels = core.readHeaderLabels(table, columnIds);
    // The chips show what the user has STORED, never what is currently rendered.
    // The two agree now that the reveal is gone, and the rule stands anyway: a
    // repaint destroys our class, so between the tbody regeneration and the
    // install's apply the machine renders nothing hidden while the user's
    // preference is unchanged, and chips derived from the rendering would blink
    // out with it.
    for (const columnId of shown) {
      const index = columnIds.indexOf(columnId);
      const chip = ownedButton("chip", `${(index >= 0 ? labels[index] : columnId) || columnId} ✕`);
      chip.className = core.CLASSES.chip;
      chip.dataset.columnId = columnId;
      chips.append(chip);
    }
  }

  // ===== Hide and show =====
  function readRequiredColumns(table, columnIds) {
    // OWNER DIRECTIVE 2026-08-04, from live use: the columns NetSuite stars are
    // the ones a line cannot be saved without, and a user who hides one has
    // hidden the field they are about to be asked for. Derived from the DOM on
    // every install, exactly like identity and for the same reason — a repaint
    // rebuilds the header, and a different form variant stars a different set.
    // Indexed against the PINNED axis over the same header cells the width
    // record measures, so a cell and an id can never disagree here.
    const required = new Set();
    headerCellsOf(table).forEach((cell, index) => {
      const id = columnIds[index];
      if (id && cell.querySelector?.(core.REQUIRED_FIELD_SELECTOR)) {
        required.add(id);
      }
    });
    return required;
  }

  function hideableHidden() {
    // The stored set MINUS what this form makes mandatory, and the single place
    // that subtraction happens — every consumer of "what is hidden" reads this.
    //
    // IT IS ALSO THE HIDDEN SET AS RENDERED, and the two are now one function
    // rather than two (OWNER DIRECTIVE 2026-08-04). effectiveHidden() used to sit
    // between this and the apply, answering the EMPTY set while a line was open;
    // with the reveal deleted it answered exactly this and nothing else, so it is
    // gone and its callers read this directly. Model and rendering agreeing is
    // the whole of the directive — "hidden at all times" is not a rule this
    // runtime applies, it is a shape it no longer has anywhere to break.
    //
    // RETAINED, NOT REWRITTEN (spec section 7's retention doctrine). The stored
    // container keeps a required id exactly as the user left it: the same id may
    // be freely hideable on another form variant, on another record type, or
    // after an administrator unstars it, and a mount that silently rewrote the
    // user's container would destroy a preference this form has no right to an
    // opinion about. So nothing is deleted anywhere — it is filtered here.
    return new Set([...hiddenColumns].filter((id) => !requiredColumns.has(id)));
  }

  // forceRevealed(), effectiveHidden() and noteDeferredHide() lived here and are
  // GONE, and with them pendingApply, revealToasted and the toast that read
  // "Hidden columns are shown while you edit a line." — a sentence this feature
  // can no longer truthfully say. Spec section 6's two force-reveal rules are
  // WITHDRAWN by the owner directive rather than left unimplemented, and their
  // as-built history is worth one paragraph so nobody re-derives it:
  //   Rule 1 — "focusin landing inside a hidden cell reveals that column" — was
  //   already unimplementable, not merely dropped. Widgets materialise PER CELL
  //   on click (live probe 11, design doc :431), so a hidden cell's widget never
  //   materialises and nothing inside it can take focus. The rule described an
  //   event that cannot fire, and that same fact is now what makes hiding safe.
  //   Rule 2 — "a validation failure on the open line reveals all hidden
  //   columns" — was delivered by prevention: every column was reachable for the
  //   whole time a line was open, so a field could not be unreachable when
  //   validation ran. What replaces it is the required-column exemption, which
  //   removes the trap instead of unspringing it: NetSuite's own starred fields
  //   cannot be hidden at all, so validation cannot ask for one that is.
  //
  // NOTHING SUPPRESSES A STORED HIDE ANY MORE, which is why the note and its
  // toast go rather than shrink. They explained a divergence this feature CHOSE
  // — a hide the user made and we refused to render — and no such choice is left
  // to explain. The repaint window still diverges (our class dies with the tbody
  // and returns when the apply lands, which is what the A3.2 seeding rule is
  // about), but that is a transient the very next apply closes, not a policy,
  // and a toast per repaint is the storm the latch existed to guard. The one
  // thing the user is still owed — WHICH columns they hid — is the chips, which
  // have always rendered from the model and still do.

  function applyCurrentHidden(table, columnIds) {
    const wanted = hideableHidden();
    // Adjudication #14: the axis is a PARAMETER and every ACTIVE apply hands
    // core the pinned one. The RESTORE takes none (adjudication #19) — passing
    // one would be harmless but misleading, since core ignores it on that route
    // and teardown genuinely has no pin left to hand over. It is reached by an
    // empty hidden set now, and by nothing else: the force-reveal that used to
    // route every open-line apply through it is gone.
    const applied = wanted.size
      ? core.applyHidden(table, [...wanted], columnIds)
      : core.applyHidden(table, [], null);
    // The return value is not decoration. core swallows a mid-walk throw and
    // answers false, and what it leaves behind is a PARTIAL machine — header and
    // the first rows hidden, the rest not. renderSignature reads the header
    // alone, so that state compares EQUAL to the target and every later install
    // takes the early return: the machine stays half-hidden until an unrelated
    // repaint happens to change the header. Recording the refusal is what makes
    // the next pass re-apply instead (see installEditGrid).
    hideIncomplete = !applied;
    renderChips(table, columnIds);
    return applied;
  }

  function setColumnHidden(columnId, hidden) {
    // A3.2 GESTURE SEEDING, stated as A3.2 requires of every new handler: this
    // gesture's starting state is `hiddenColumns`, the feature's own stored
    // model. It is never the rendered visibility of the column — that is this
    // feature's own output (our class plus our `display: none !important`), and
    // it disagrees with the model for the whole of every repaint window, which
    // begins the instant NetSuite regenerates the tbody and ends when the
    // install's apply lands. M2 lost a user's width to exactly this shape: a
    // handler that seeded from the inline style the apply path had just written.
    if (typeof columnId !== "string" || !columnId) {
      return;
    }
    // FAIL-CLOSED ON A REQUIRED COLUMN. Every hide in this feature passes through
    // here, so this is the one place that has to refuse: no model change, no DOM
    // change, no write. Silent, and that is not laziness — the menu's box for a
    // required id is DISABLED, so no gesture can reach this line, and a toast on
    // a path a user cannot take would need its own latch to guard a storm that
    // cannot happen. It stands as the choke point's own guarantee, not as
    // feedback: the affordance already says it, and the SHOW direction is
    // untouched (a required column is never hidden, so there is nothing to show).
    if (hidden && requiredColumns.has(columnId)) {
      return;
    }
    if (hidden === hiddenColumns.has(columnId)) {
      // Already in the requested state. One gesture is one write, and a gesture
      // that changes nothing is not a gesture.
      return;
    }
    if (hidden) {
      hiddenColumns.add(columnId);
    } else {
      hiddenColumns.delete(columnId);
    }
    queueApply("hide-toggle");
    saveHidden();
  }

  function handleMenuChange(event) {
    const box = event.target?.closest?.(`[${core.DATA_ATTRIBUTE}="column-toggle"]`);
    if (!box) {
      return;
    }
    setColumnHidden(box.dataset?.columnId, !box.checked);
  }

  // scheduleFlush() and its flushTimer lived here and are GONE with pendingApply.
  // It was THE flush trigger M1.5 and M2 left to M3: a click on the machine's own
  // OK or Cancel closes the line inside NetSuite's handler, which runs after ours
  // has returned, so a deferred hide had to be re-checked one tick later. Nothing
  // is deferred any more — a hide/show gesture applies on the spot whatever the
  // machine is doing — so the timer had no state left to flush, and a timer that
  // outlives its own mount is the shape this file has been bitten by twice. The
  // one repair path that survives is handleFocusIn's, below, and it is repairing
  // something else entirely.

  function handleFocusIn(event) {
    // NOT a reveal-on-focus repair, and no longer a flush trigger either: both
    // are deleted above. Focus is used here for the ONE thing it still buys —
    // the machine's rendering can drift from the target without the observer
    // seeing it, and a user clicking into a line is the likeliest next event
    // after the drift. Two drifts are reachable. A refused applyHidden leaves a
    // PARTIAL machine whose header agrees with the target (hideIncomplete, the
    // first conjunct below). And this runtime observes childList only, so a
    // rewrite that changes a cell's attributes without adding or removing a node
    // never schedules an install at all. Both are repaired here at the cost of
    // one signature compare per focus movement.
    const table = event.target?.closest?.(core.MACHINE_TABLE_SELECTOR);
    if (!table) {
      return;
    }
    const columnIds = currentColumnIds(table);
    if (columnIds.length < 2) {
      return;
    }
    // The same early return the install takes, and for the same reason: focus
    // moves constantly inside a machine, and a re-apply per movement would make
    // "zero DOM writes when nothing changed" untrue for the whole session. The
    // SAME means the same, `hideIncomplete` included — a half-applied machine
    // whose header agrees with the target is invisible to this pair too, and a
    // user who clicks into a line is the likeliest next event after the repaint
    // that interrupted the walk.
    if (!hideIncomplete && renderSignature(table, columnIds) === targetSignature(table, columnIds)) {
      return;
    }
    queueApply("focus-moved");
  }

  function handleContainerClick(event) {
    const owned = event.target?.closest?.(`[${core.DATA_ATTRIBUTE}]`);
    const role = owned?.getAttribute?.(core.DATA_ATTRIBUTE) ?? null;
    if (role === "columns-button") {
      event.preventDefault?.();
      if (controlButtons?.menu) {
        closeColumnMenu();
        return;
      }
      // Resolved HERE and not above: this is the only branch that needs the
      // machine, and a click anywhere in the container runs this handler.
      const table = machineTable();
      if (table) {
        openColumnMenu(table, currentColumnIds(table));
      }
      return;
    }
    if (role === "chip") {
      event.preventDefault?.();
      // Dismissed first: an open menu's ticks were built from the hidden set as
      // it was when the menu opened, and this click is about to change it. A
      // menu left standing would show the column unticked while the chip for it
      // has just disappeared.
      closeColumnMenu();
      setColumnHidden(owned.dataset?.columnId, false);
      return;
    }
    // Any other click inside the machine: dismiss the menu, and nothing else.
    // A deferred-hide flush used to be armed here (scheduleFlush, deleted above);
    // with nothing ever deferred, an ordinary click inside the machine costs the
    // menu teardown and no apply at all.
    closeColumnMenu();
  }

  // ===== Delegated listeners (one per event type, on the container) =====
  const DELEGATED_LISTENERS = [
    ["pointermove", handleResizeHover],
    ["pointerleave", handleResizeLeave],
    ["pointerdown", handleResizeDown],
    ["focusin", handleFocusIn],
    ["click", handleContainerClick]
    // M5 reuses the click handler for Personalize/Done/Reset; M6/M7 for the
    // header menu. Nothing is bound per row: rows are destroyed on every repaint
    // and per-row binding is how duplicate handlers accumulate. The drag pair
    // (pointermove/pointerup under capture) is bound on the document for the
    // life of one gesture only, by handleResizeDown, and removed by
    // handleResizeUp; the column menu's own `change` is bound to the menu node
    // and dies with it (see openColumnMenu).
  ];

  function ensureBindings(container) {
    if (!container) {
      return;
    }
    // STASHED BEFORE THE ALREADY-BOUND GATE, because teardown cannot re-derive
    // it: it reaches the container through the machine table, and a teardown
    // that fires while NetSuite is replacing that table finds it detached — the
    // closest() walk answers null, the release below no-ops, and the LIVE
    // container keeps this attribute and all five delegated listeners, so a
    // resize gesture can still fire and still write storage after the feature is
    // off. The node this mount actually bound is the only reliable handle on it.
    boundContainer = container;
    if (container.hasAttribute(core.BOUND_ATTRIBUTE)) {
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
    //
    // An UNRESOLVED column joins as an empty segment — "item,,rate" — and that
    // is unambiguous rather than lossy, because no real id can be empty
    // (normalizeColumnId refuses it). This attribute is evidence for a probe,
    // never an input: nothing reads it back, so the encoding owes only
    // legibility.
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
    //
    // BOTH HALVES OF THE RESEED GUARD ARE ARMED HERE, and this is where they
    // belong now that there is a second writer. They used to be armed by the
    // width writer itself, which made "increment at your own enqueue" a rule a
    // new field's writer had to know and could silently skip — and skipping it
    // reintroduces defect D2 for that field, because an install landing in the
    // write's gap reseeds from a snapshot the write has not reached and core's
    // writers replace their field wholesale. Arming it in the queue makes the
    // guard a property of writing at all.
    //   pendingWrites — saves enqueued and not yet finished.
    //   saveEpoch     — monotonic, so an install can tell that a save COMPLETED
    //                   inside its own await.
    // Both are armed synchronously, before this call returns: the gesture is
    // over the moment its handler returns, and an install that lands from now
    // until the operation finishes is looking at storage that predates it.
    pendingWrites += 1;
    saveEpoch += 1;
    // Every enqueue is balanced, including operations that return early on a
    // dead generation: the operation always runs, because the queue chains it
    // with (operation, operation) and a teardown replaces the module's chain
    // without unchaining what is already on it. Floored at 0 so the teardown
    // reset cannot drive the counter negative.
    const settle = () => {
      pendingWrites = Math.max(0, pendingWrites - 1);
    };
    const next = saveQueue.then(operation, operation).then(
      (value) => {
        settle();
        return value;
      },
      (error) => {
        settle();
        throw error;
      }
    );
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
      widths: headerCellsOf(table).map((cell) => cell.style?.width ?? ""),
      // Reading back our OWN class here is a comparison, not a seed, and the
      // distinction is the whole of A3.1/A3.2: nothing on this line reaches
      // storage or a gesture's starting state. It answers one question — is the
      // machine already rendering what the model says — exactly as the widths
      // member above it has since M2.
      hidden: headerCellsOf(table).map((cell) => cell.classList?.contains?.(core.CLASSES.colHidden) === true)
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
    // Indexed over the HEADER CELLS and not over the axis, so the two members
    // are the same length whatever the machine is doing: an axis and a header
    // that disagree is the state core.applyHidden refuses on, and a target of a
    // different length there would compare unequal for a reason that has
    // nothing to do with what is hidden.
    const wanted = hideableHidden();
    // MEMBER ORDER IS LOAD-BEARING. Both signatures are compared as JSON
    // STRINGS and JSON.stringify emits keys in insertion order, so `hidden`
    // last here because it is last there. Re-ordering one side alone makes the
    // two never equal and every install re-apply forever.
    return JSON.stringify({
      ids: columnIds,
      layout: planned ? "fixed" : "",
      widths: headerCellsOf(table).map((cell, index) => {
        if (!planned) {
          return "";
        }
        const id = columnIds[index];
        // `id ? … : NaN`, character for character what core.applyWidths does, and
        // for a reason beyond symmetry now that the axis can carry nulls: a bare
        // `planned[id]` would look the plan up under the property name "null" —
        // JavaScript stringifies the key — and any future plan that ever held
        // such a key would make this signature predict a width core does not
        // write. The plan cannot hold one today (see plannedWidths' three
        // sources, each of which drops a null id at its own guard), and this
        // line is what keeps the pair from drifting if one ever could.
        const stored = id ? Number(planned[id]) : Number.NaN;
        const rendered = Math.round(cell.getBoundingClientRect?.().width ?? 0);
        const target = Number.isFinite(stored) && stored > 0 ? stored : rendered;
        return `${core.clampWidth(target, 0)}px`;
      }),
      hidden: headerCellsOf(table).map((cell, index) => wanted.has(columnIds[index]))
    });
  }

  function applyAll(table, columnIds) {
    // THE ONLY APPLY, and it runs whatever the machine is doing — no open-line
    // branch, because there is no longer anything to branch to. The two rules
    // that used to be stated over in applyWhileLineOpen are stated here, because
    // this is now the code that carries them.
    //
    // WIDTHS, SPEC AMENDMENT 2 (adjudication #16). The queue-while-open rule of
    // spec section 6 named width alongside hide/show and filter; Amendment 2 took
    // width out of that set. The grounds: `table-layout: fixed` sits on the
    // <table> and the <table> survives the <tbody> regeneration while the header
    // cells' inline widths do not, so between a repaint and the next apply the
    // machine is laid out fixed-with-no-widths and the browser distributes the
    // space equally. An apply that does not run IS the yank the rule exists to
    // prevent — measured on the fixture: opening a line collapsed all twelve
    // columns to 120px and they stayed collapsed until the line closed.
    //
    // HIDE/SHOW, OWNER DIRECTIVE 2026-08-04, which is the amendment that follows
    // it. A column the user hid stays hidden while a line is open, while a new
    // line is typed, and across every repaint those cause, so this apply carries
    // the hidden set unconditionally too. What made that safe is the required-
    // column exemption (08e3c1e) plus probe 11's per-cell widget materialisation
    // — see the tombstone where forceRevealed used to live.
    //
    // Re-applying is invisible either way: style.width on the header row and our
    // own class, no row moved, no widget touched, no focus moved, and the
    // observer watches childList only so it cannot feed back.
    //
    // M6 appends applyCurrentFilters, M7 applyCurrentSort — and each has to
    // decide its OWN open-line policy at that point (A2.4: filter queues, sort
    // and reorder are refused outright). Neither inherits one from here.
    applyCurrentWidths(table, columnIds);
    applyCurrentHidden(table, columnIds);
  }

  function queueApply(reason) {
    // Read first, gate second: every caller needs the same table and the same
    // pinned axis, and an apply keyed to a freshly derived axis is the silent
    // mis-key spec A1.2 rule 3 forbids.
    const table = machineTable();
    const columnIds = table ? currentColumnIds(table) : [];
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
      const columnIds = currentColumnIds(table);
      // Fail closed on an unrecognized machine: no header, no {machine}fields,
      // duplicate or undecodable ids (spec section 7).
      //
      // ASKED OF THE RESOLVED IDS, not of the axis. An axis may now carry NULLS
      // — positions core.correlateColumnIds refused to name because the optimal
      // alignments disagreed — and the two clauses this used to run would both
      // have thrown the whole machine away for them: `some((id) => !id)` is true
      // of any hole, and a Set folds every hole into ONE member, so a 62-column
      // axis with three holes measured 60 against 62 and read as "duplicate
      // ids". That is the owner's bug, re-entered one level above core.
      //
      // What the gate still guarantees is what it was always for: at least two
      // columns this mount can actually KEY, and no id claimed twice. A hole is
      // neither — it is a column that renders and is never keyed by anything.
      const resolved = columnIds.filter((id) => id);
      if (
        columnIds.length < 2
        || resolved.length < 2
        || new Set(resolved).size !== resolved.length
      ) {
        return false;
      }
      activeTable = table;
      nativeColumnIds = columnIds;
      // LATCHED FOR THE LIFE OF THE MOUNT, exactly as the axis pin is and for the
      // same reason (currentColumnIds' mismatch branch): resolveScopeKey falls
      // back to a hostname-shaped key whenever the session-status script is not
      // in the document, and installs are repaint-driven, so one that lands while
      // NetSuite is rewriting <head> resolves the fallback for a mount that
      // already has a real key. Adopting the new one silently would relabel the
      // user's saved layout — the stored entry reads empty under it, the reseed
      // below (which is armed: no gesture is pending) empties hiddenColumns, every
      // hidden column pops back with no toast to say why, and every later gesture
      // persists under the shadow key, where core's single-entry eviction can
      // drop the real one. Only teardown clears this.
      scopeKey = scopeKey ?? resolveScopeKey();
      ensureMountMarker(container);
      ensureControls(container);
      ensureBindings(container);
      stampAxis(container, columnIds);
      // Derived BEFORE the await as well as after (post-await site below), and
      // for the same reason the epoch is: ensureControls and ensureBindings have
      // just made the Columns button clickable, so the await is a window a
      // GESTURE can land in — and on a mount's first install requiredColumns is
      // still empty here, so the choke point's refusal would not fire. A click
      // in that window could store a hide for a starred column that no UI can
      // then clear (its box is disabled, it gets no chip), and the retention
      // doctrine would render it on any form variant that does not star it. The
      // post-await derivation stays: it re-reads with identity because a repaint
      // rebuilds the header and the star goes with it.
      requiredColumns = readRequiredColumns(table, columnIds);
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
      // Re-derived HERE, with identity and against the same axis read, because a
      // repaint rebuilds the header and the star goes with it — and because
      // everything below reads it: the signature pair through hideableHidden,
      // the chips, and the menu the next click builds.
      requiredColumns = readRequiredColumns(table, current);
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
        // INSIDE the guard, with the widths and for the identical reason. A
        // reseed of the hidden set from a snapshot older than a gesture is
        // defect D2 for this field, and core.withHidden replaces the stored list
        // wholesale exactly as core.withWidths replaces the map — so the next
        // gesture's write would delete the column this reseed dropped.
        hiddenColumns = new Set(entry.hidden ?? []);
      }
      // The chips render from the model, so they must be re-rendered even on an
      // install that applies nothing: an already-correct machine takes the early
      // return below, and ensureControls builds an EMPTY chip row whenever the
      // bar it holds is no longer connected, so the two together are a mount
      // showing a stored hide with nothing left saying which columns it is. Our
      // own node, never a machine cell, so the zero-DOM-writes property below is
      // untouched.
      renderChips(table, current);
      // `hideIncomplete` first, because the signature cannot see what it hides: a
      // refused applyHidden leaves the header saying "done" over rows that are
      // not, and the two signatures then agree forever. It is cleared by the very
      // next applyCurrentHidden, so this costs one extra apply after a failure
      // and nothing at all otherwise.
      if (!hideIncomplete && renderSignature(table, current) === targetSignature(table, current)) {
        return true;
      }
      // Unconditional, and the open-line branch that used to sit here is gone
      // with applyWhileLineOpen: an install landing while a line is open applies
      // the same widths and the same hidden set as any other.
      applyAll(table, current);
      return !signal.aborted && isCurrent();
    } catch (error) {
      logOnce(error);
      return false;
    }
  }

  function removeEditGrid() {
    // Hoisted out of the try so the layout clear below can reach it whatever
    // happens inside: everything from here to the catch is DOM work that may
    // throw on a machine being replaced underneath us.
    let table = null;
    try {
      table = activeTable ?? machineTable();
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
      // The column menu is NOT closed here. It is an owned node and the
      // OWNED_SELECTOR sweep below removes it, `controlButtons = null` drops the
      // handle, and its `change` listener is bound to the node itself so it dies
      // with it. A closeColumnMenu() call here would be a line no mutation can
      // kill and no reader can trust — the same objection adjudication #19 raised
      // against the reveal's unreachable header gate. Its DOCUMENT-level
      // dismissal pair is the one part that cannot die with a node, so that comes
      // off by name below — and it is now the ONLY thing that does, the flush
      // timer it used to keep company having gone with the force-reveal.
      //
      // No axis, by adjudication #19, and for the same reason as the line above:
      // teardown runs after the pin has been dropped, and a mount that can no
      // longer key its columns must still be able to strip its own class. Left
      // behind, that class springs the column back hidden by `!important` the
      // moment NetSuite re-renders, with no feature left to un-hide it.
      core.applyHidden(table, [], null);
      hiddenColumns = new Set();
      // M6 appends the filter reset, M7 the native row order.
    } catch {}
    // OUTSIDE the try and off the STASH, not off a container re-derived from the
    // table: a teardown that lands while NetSuite is replacing the machine finds
    // the table detached, closest() answers null, and everything this feature put
    // on the live container survives the mount that owns it.
    //
    // BOTH LINES ARE THE LAST RESORT FOR WHAT THEY REMOVE, which is why neither
    // can be left inside the try. The sweep below is document-scoped but its
    // selector is the EXACT attribute [data-suitemate-v3-edit-grid], and the axis
    // stamp is a different attribute name (data-suitemate-v3-edit-grid-axis —
    // deliberately distinct, and pinned as distinct by the frozen-contract test),
    // so the sweep cannot reach it: clearAxisStamp is its only remover. The bound
    // stamp and the five delegated listeners have no other remover either.
    //
    // They carry different weights, and the comment should not flatten them. The
    // listeners are FUNCTIONAL: a resize gesture on a feature that is off still
    // runs and still writes storage. The stamp is DISCLOSURE HYGIENE: a page with
    // no feature on it goes on advertising the axis that mount pinned.
    releaseBindings(boundContainer);
    clearAxisStamp(boundContainer);
    // The menu's node is swept below; these are on the document and are not.
    releaseMenuDismissal();
    for (const node of document.querySelectorAll(OWNED_SELECTOR)) {
      node.remove();
    }
    activeTable = null;
    boundContainer = null;
    hideIncomplete = false;
    nativeColumnIds = null;
    pinnedColumnIds = null;
    appliedOrder = null;
    axisMismatch = false;
    scopeKey = null;
    entry = {};
    // The layout comes off HERE as well as through applyWidths' restore above,
    // because a teardown that lands mid-buildtable finds the header row already
    // gone with the <tbody> — core.applyWidths returns false at its header gate
    // (core.js:871-873) and never reaches the line that clears `table-layout`
    // (core.js:886-888), which would leave `fixed` on a table no mount owns
    // while the state below empties.
    if (table?.style) {
      table.style.tableLayout = "";
    }
    columnWidths = {};
    frozenWidths = {};
    naturalWidths = {};
    ownsLayout = false;
    hiddenColumns = new Set();
    // State hygiene, not load-bearing: every install re-derives this set before
    // its storage read and again after it, so a stale value can never be
    // consulted — the mutation that drops this line is equivalent, and disclosed
    // as such in the M3 checkpoint rather than pinned by a test.
    requiredColumns = new Set();
    // The bar and the menu were just swept as owned NODES; this drops the mount's
    // handle on them, so the next install builds its own rather than adopting a
    // detached one.
    controlButtons = null;
    resizing = null;
    // revealToasted, pendingApply and the flush timer were cleared here and are
    // gone with the force-reveal. No timer this runtime sets can outlive its own
    // mount any more, because it sets none: the resize pair is the only remaining
    // document-level state and it comes off through handleResizeUp above.
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
