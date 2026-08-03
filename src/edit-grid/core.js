(function defineSuiteMateV3EditGridCore(globalScope) {
  "use strict";

  const VERSION = 1;
  const STORAGE_KEY = "suiteMateV3EditColumns";
  const STORAGE_SCHEMA_VERSION = 1;
  const MAX_SYNC_ITEM_BYTES = 7800;
  const MAX_COLUMN_ID_LENGTH = 200;
  const MAX_COLUMN_IDS = 100;
  const ABSOLUTE_MIN_COLUMN_WIDTH = 50;
  const MAX_COLUMN_WIDTH = 1000;

  const MACHINE_TABLE_SELECTOR = "#item_splits";
  const MACHINE_CONTAINER_SELECTOR = ".uir-machine-table-container";
  const HEADER_ROW_SELECTOR = "tr.uir-machine-headerrow";
  const DATA_ROW_SELECTOR = "tr.uir-machine-row";
  const FOCUSED_ROW_SELECTOR = "tr.uir-machine-row-focused, tr.listfocusedrow";
  // The union of the spec's names and the ones src/styles/netsuite.css actually
  // carries (tr.uir-machine-button-row + td.machineButtonRow, uir-machine-totals-row,
  // uir-loading-row, uir-nodata-row), plus tr.uir-machine-row-last — observed
  // live 2026-08-02 and named by neither half. A selector naming a class the
  // live DOM does not use matches nothing and costs nothing, so the union is
  // fail-closed whichever reality the machine holds; the Task 9 probe confirms
  // which half matches and M2+ may prune.
  const EXCLUDED_ROW_SELECTOR =
    "tr.machineButtonRow, tr.totalrow, tr.uir-machine-loading-row, tr.uir-machine-nodata-row, "
    + "tr.uir-machine-button-row, tr.uir-machine-totals-row, tr.uir-loading-row, tr.uir-nodata-row, "
    + "tr.uir-machine-row-last";
  const ORDERED_TABLE_SELECTOR = ".uir-draggable-table";
  const ORDERED_CONTAINER_SELECTOR = ".uir-list-machine-ordered";
  const MOVABLE_CELL_SELECTOR = "td.movable";
  const COLUMN_SPAN_SELECTOR = 'span[id$="_fs"]';

  // The machine's serialization delimiters, written as code points: SOH separates
  // fields, STX separates lines, and ENQ separates the options inside a single
  // select field's value — it is NOT a line separator (spec Amendment A1.1).
  const FIELD_DELIMITER = "\u0001";
  const LINE_DELIMITER = "\u0002";
  const OPTION_DELIMITER = "\u0005";
  const HEADER_LABEL_SELECTOR = "div.listheader";
  // The star NetSuite puts on a mandatory column, inside that same header label:
  // `<span class="listheaderreq" title="Required Field">`, with the * glyph
  // rendered from CSS rather than written into the text (probed on the locked
  // order 2026-08-04, where exactly two columns carry it — Item at visible index
  // 0 and Tax Code at 13, while Quantity does not). The SET IS FORM-SPECIFIC, so
  // it is read from the header every install and never written down anywhere.
  const REQUIRED_FIELD_SELECTOR = "span.listheaderreq";
  const MAX_MACHINE_FIELDS = 400;
  const MAX_SAMPLE_ROWS = 8;
  const DISPLAY_SUFFIX = "_display";
  const MIRROR_PREFIXES = Object.freeze(["old", "default"]);
  const CUSTOM_FIELD_PREFIX = /^cust(?:col|colsd|column|record|event|entity|body)?$/;
  const MACHINE_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const MISSING_VALUE_PENALTY = -4;
  const LABEL_WEIGHT = 2;

  const DATA_ATTRIBUTE = "data-suitemate-v3-edit-grid";
  const NATIVE_ROW_ATTRIBUTE = "data-suitemate-v3-edit-grid-native-row";
  const BOUND_ATTRIBUTE = "data-suitemate-v3-edit-grid-bound";
  // MAIN-world axis evidence. The runtime derives the column axis in an isolated
  // world, so page script — and every live verification pass that runs there —
  // cannot see which axis a mount actually pinned, and from M2 on that axis is
  // what keys the stored layout. The ids are ALREADY public in-page in the
  // machine's own {machine}fields hidden input, so republishing them on the
  // container exposes nothing new; it only makes the pinned axis readable where
  // the probe runs. Comma-joined, and cleared by removeEditGrid.
  const AXIS_ATTRIBUTE = "data-suitemate-v3-edit-grid-axis";
  const FOREIGN_NODE_SELECTOR =
    "[data-suitemate-v3-internal-id], [data-suitemate-v3-so-columns], [data-suitemate-v3-form-views], [data-suitemate-v3-edit-grid]";
  const RESERVED_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);
  const CLASSES = Object.freeze({
    controls: "suitemate-v3-edit-grid-controls",
    button: "suitemate-v3-edit-grid-button",
    chip: "suitemate-v3-edit-grid-chip",
    menu: "suitemate-v3-edit-grid-menu",
    note: "suitemate-v3-edit-grid-note",
    colHidden: "suitemate-v3-edit-grid-col-hidden",
    rowFiltered: "suitemate-v3-edit-grid-row-filtered",
    personalizing: "suitemate-v3-edit-grid-personalizing",
    dragging: "suitemate-v3-edit-grid-dragging",
    dropTarget: "suitemate-v3-edit-grid-drop-target",
    resizeEdge: "suitemate-v3-edit-grid-resize-edge",
    resizing: "suitemate-v3-edit-grid-resizing",
    sorted: "suitemate-v3-edit-grid-sorted"
  });

  if (globalScope.SuiteMateV3EditGridCore?.VERSION === VERSION) {
    return;
  }

  // ===== Storage schema: validation, normalization and writers =====
  function isPlainObject(value) {
    return Boolean(
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.prototype.toString.call(value) === "[object Object]"
    );
  }

  function normalizeScopeKey(value) {
    return typeof value === "string"
      && value.length > 0
      && value.length <= MAX_COLUMN_ID_LENGTH
      && !RESERVED_KEYS.includes(value)
      ? value
      : null;
  }

  function normalizeColumnId(value) {
    const identifier = String(value ?? "").trim();
    return identifier.length > 0
      && identifier.length <= MAX_COLUMN_ID_LENGTH
      && !RESERVED_KEYS.includes(identifier)
      ? identifier
      : null;
  }

  function normalizeColumnIds(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COLUMN_IDS) {
      return null;
    }
    const ids = [];
    for (const candidate of value) {
      const id = typeof candidate === "string" ? normalizeColumnId(candidate) : null;
      if (!id) {
        return null;
      }
      ids.push(id);
    }
    return ids;
  }

  function clampWidth(pixels, minimum) {
    // The floor is the per-column minimum a caller measured, never below the
    // static one and never above the cap — so the refusal below is bounded too.
    const floor = Math.min(
      MAX_COLUMN_WIDTH,
      Math.max(ABSOLUTE_MIN_COLUMN_WIDTH, Math.round(Number(minimum) || 0))
    );
    const width = Number(pixels);
    // Fail closed on anything that is not a finite number. NaN passes silently
    // through Math.max/Math.min and comes out of Math.round as NaN, which M2
    // would write to storage and set as `style.width = "NaNpx"` — a refused
    // width must land on the minimum, not on a poisoned one.
    if (!Number.isFinite(width)) {
      return floor;
    }
    return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(floor, width)));
  }

  function normalizeWidths(value) {
    if (!isPlainObject(value)) {
      return null;
    }
    const widths = {};
    for (const [candidateId, width] of Object.entries(value)) {
      const id = normalizeColumnId(candidateId);
      const pixels = Number(width);
      if (!id || !Number.isFinite(pixels)) {
        continue;
      }
      widths[id] = clampWidth(pixels, ABSOLUTE_MIN_COLUMN_WIDTH);
    }
    const keys = Object.keys(widths);
    return keys.length && keys.length <= MAX_COLUMN_IDS ? widths : null;
  }

  function entryIsEmpty(entry) {
    return !entry.order && !entry.hidden && !entry.widths;
  }

  function normalizeEntry(value) {
    if (!isPlainObject(value)) {
      return null;
    }
    const order = normalizeColumnIds(value.order);
    const hidden = normalizeColumnIds(value.hidden);
    const widths = normalizeWidths(value.widths);
    if (!order && !hidden && !widths) {
      return null;
    }
    return {
      ...(order ? { order } : {}),
      ...(hidden ? { hidden } : {}),
      ...(widths ? { widths } : {})
    };
  }

  function normalizeStored(value) {
    const normalized = { schemaVersion: STORAGE_SCHEMA_VERSION, grids: {} };
    if (
      !isPlainObject(value)
      || !Number.isSafeInteger(value.schemaVersion)
      || value.schemaVersion < 1
      || value.schemaVersion > STORAGE_SCHEMA_VERSION
      || !isPlainObject(value.grids)
    ) {
      return normalized;
    }
    for (const [scopeKey, entry] of Object.entries(value.grids)) {
      const key = normalizeScopeKey(scopeKey);
      const normalizedEntry = normalizeEntry(entry);
      if (key && normalizedEntry) {
        normalized.grids[key] = normalizedEntry;
      }
    }
    return normalized;
  }

  function refusesNewerSchema(stored) {
    return isPlainObject(stored)
      && Number.isSafeInteger(stored.schemaVersion)
      && stored.schemaVersion > STORAGE_SCHEMA_VERSION;
  }

  function measureBytes(value) {
    return new TextEncoder().encode(`${STORAGE_KEY}${JSON.stringify(value)}`).length;
  }

  function evictOverQuota(next, key) {
    if (measureBytes(next) <= MAX_SYNC_ITEM_BYTES) {
      return next;
    }
    // Single-entry eviction, scoped to this feature's own container: the
    // blast radius of a quota event stops at other Edit Mode scopes and can
    // never reach a View Mode layout (spec H2). Only ever reached for a write
    // that just set grids[key], so the entry is always present.
    next.grids = { [key]: next.grids[key] };
    // Re-measure: an entry that alone exceeds the cap is refused through the
    // same channel as every other writer failure, never handed back as a
    // success the storage layer would then reject.
    return measureBytes(next) <= MAX_SYNC_ITEM_BYTES ? next : null;
  }

  function writeField(stored, scopeKey, field, value, normalizer) {
    if (refusesNewerSchema(stored)) {
      return null;
    }
    const next = normalizeStored(stored);
    const key = normalizeScopeKey(scopeKey);
    if (!key) {
      return null;
    }
    const entry = { ...(next.grids[key] ?? {}) };
    const empty = value === null || value === undefined
      || (Array.isArray(value) && value.length === 0)
      || (isPlainObject(value) && Object.keys(value).length === 0);
    if (empty) {
      delete entry[field];
    } else {
      const normalized = normalizer(value);
      if (!normalized) {
        return null;
      }
      entry[field] = normalized;
    }
    if (entryIsEmpty(entry)) {
      // A clearing write only ever shrinks the container, so eviction can never
      // be needed here — and running it would destroy every other scope.
      delete next.grids[key];
      return next;
    }
    next.grids[key] = entry;
    return evictOverQuota(next, key);
  }

  function withOrder(stored, scopeKey, columnIds) {
    return writeField(stored, scopeKey, "order", columnIds, normalizeColumnIds);
  }

  function withHidden(stored, scopeKey, columnIds) {
    return writeField(stored, scopeKey, "hidden", columnIds, normalizeColumnIds);
  }

  function withWidths(stored, scopeKey, widths) {
    return writeField(stored, scopeKey, "widths", widths, normalizeWidths);
  }

  // ===== Machine field data: the primary identity source =====
  // The machine serializes its own field list and line values into two hidden
  // inputs on the form. The field list is form-determined, unprefixed and
  // i18n-proof, which is why it — and not the header text or the visible index —
  // supplies every column id this feature stores (spec Amendment A1.2).
  function parseMachineFieldData(fieldsValue, dataValue) {
    const fieldIds = String(fieldsValue ?? "").split(FIELD_DELIMITER);
    if (
      fieldIds.length < 2
      || fieldIds.length > MAX_MACHINE_FIELDS
      || !fieldIds.every((id) => normalizeColumnId(id))
      || new Set(fieldIds).size !== fieldIds.length
    ) {
      return null;
    }
    const serialized = String(dataValue ?? "");
    const lines = serialized === ""
      ? []
      : serialized.split(LINE_DELIMITER).map((line) => line.split(FIELD_DELIMITER));
    if (lines.some((values) => values.length !== fieldIds.length)) {
      return null;
    }
    return { fieldIds, lines: lines.slice(0, MAX_SAMPLE_ROWS) };
  }

  function machineFieldInputValue(table, suffix) {
    // closest("form") is the ONLY route to these inputs: core.js may not touch a
    // document global, and `ownerDocument.` trips the source-purity test.
    const machineId = machineIdFromTable(table);
    const form = table?.closest?.("form");
    if (!MACHINE_ID_PATTERN.test(machineId) || typeof form?.querySelector !== "function") {
      return null;
    }
    const name = `${machineId}${suffix}`;
    const input = form.querySelector(`input[name="${name}"]`) ?? form.querySelector(`#${name}`);
    return typeof input?.value === "string" ? input.value : null;
  }

  function readMachineFieldData(table) {
    try {
      return parseMachineFieldData(
        machineFieldInputValue(table, "fields"),
        machineFieldInputValue(table, "data")
      );
    } catch {
      return null;
    }
  }

  function collapseDisplayTwins(fieldIds, lines) {
    const present = new Set(fieldIds);
    const columns = [];
    for (let index = 0; index < fieldIds.length; index += 1) {
      const id = fieldIds[index];
      const base = id.endsWith(DISPLAY_SUFFIX) ? id.slice(0, -DISPLAY_SUFFIX.length) : null;
      // {X}_display immediately followed by {X} is one column rendered by its
      // display value; the raw id is what gets stored.
      const paired = base !== null && fieldIds[index + 1] === base;
      const values = lines.map((line) => String(line[index] ?? ""));
      // A value carrying ENQ is a serialized select option list, never a cell.
      const optionList = values.some((value) => value.includes(OPTION_DELIMITER));
      // "old"/"default" + an id present in the same list is a bookkeeping mirror.
      // Deliberately narrow: olditemid survives because "itemid" is not a field.
      const mirror = MIRROR_PREFIXES.some(
        (prefix) => id.startsWith(prefix) && present.has(id.slice(prefix.length))
      );
      if (!optionList && !mirror) {
        columns.push({ id: paired ? base : id, values });
      }
      if (paired) {
        index += 1;
      }
    }
    return columns;
  }

  // ===== Label-to-field correlation =====
  function identifierTokens(value) {
    return String(value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }

  function columnIdTokens(columnId) {
    const tokens = identifierTokens(columnId);
    const trimmed = tokens.filter(
      (token, index) => !(index === 0 && CUSTOM_FIELD_PREFIX.test(token)) && !/^[0-9]+$/.test(token)
    );
    return trimmed.length ? trimmed : tokens;
  }

  function labelAffinity(label, columnId) {
    const labelParts = identifierTokens(label);
    const idParts = columnIdTokens(columnId);
    if (!labelParts.length || !idParts.length) {
      return 0;
    }
    const flatLabel = labelParts.join("");
    const flatId = idParts.join("");
    if (flatLabel === flatId) {
      return 4;
    }
    if (
      flatId.startsWith(flatLabel) || flatId.endsWith(flatLabel)
      || flatLabel.startsWith(flatId) || flatLabel.endsWith(flatId)
    ) {
      return 3;
    }
    if (flatId.includes(flatLabel) || flatLabel.includes(flatId)) {
      return 2;
    }
    const words = labelParts.filter((token) => token.length >= 3);
    if (!words.length) {
      return 0;
    }
    const covered = words.filter((token) => flatId.includes(token)).length;
    if (covered === words.length) {
      return 2;
    }
    return covered * 2 >= words.length ? 1 : 0;
  }

  function comparableNumber(text) {
    const trimmed = String(text ?? "").trim().replace(/,/g, "");
    return trimmed !== "" && /^-?[0-9]*\.?[0-9]+$/.test(trimmed) ? Number(trimmed) : null;
  }

  function textMatchesValue(cellText, rawValue) {
    const cell = String(cellText ?? "").trim();
    const raw = String(rawValue ?? "").trim();
    if (cell === "" || raw === "") {
      return false;
    }
    if (cell === raw) {
      return true;
    }
    const cellNumber = comparableNumber(cell);
    const rawNumber = comparableNumber(raw);
    return cellNumber !== null && rawNumber !== null && cellNumber === rawNumber;
  }

  function correlationScore(label, column, sampleTexts, labelIndex) {
    let penalty = 0;
    let corroborated = false;
    for (let row = 0; row < sampleTexts.length; row += 1) {
      const text = String(sampleTexts[row]?.[labelIndex] ?? "").trim();
      if (text === "") {
        continue;
      }
      // A rendered non-empty cell backed by an empty raw value is evidence
      // against this pairing — but only evidence. Seven of the 43 live columns
      // render through a transform (list text, blank checkbox), so an exclusion
      // here would put the true field out of reach.
      if (String(column.values[row] ?? "").trim() === "") {
        penalty = MISSING_VALUE_PENALTY;
      }
      corroborated = corroborated || textMatchesValue(text, column.values[row]);
    }
    return penalty + LABEL_WEIGHT * labelAffinity(label, column.id) + (corroborated ? 1 : 0);
  }

  function correlateColumnIds(labels, columns, sampleTexts) {
    const width = labels.length;
    const count = columns.length;
    if (width < 2 || width > MAX_COLUMN_IDS || count < width) {
      return [];
    }
    const scores = labels.map(
      (label, labelIndex) => columns.map((column) => correlationScore(label, column, sampleTexts, labelIndex))
    );
    // Backward DP over (labelIndex, firstAllowedCandidate). best[] is the top
    // score for the remaining labels; paths[] COUNTS the alignments that reach
    // it, which is what makes the ambiguity gate a measurement, not a guess.
    const best = [];
    const paths = [];
    for (let k = 0; k <= width; k += 1) {
      best.push(new Array(count + 1).fill(Number.NEGATIVE_INFINITY));
      paths.push(new Array(count + 1).fill(0));
    }
    best[width].fill(0);
    paths[width].fill(1);
    for (let k = width - 1; k >= 0; k -= 1) {
      for (let c = count - (width - k); c >= 0; c -= 1) {
        let top = Number.NEGATIVE_INFINITY;
        let ways = 0;
        for (let i = c; i <= count - (width - k); i += 1) {
          const total = scores[k][i] + best[k + 1][i + 1];
          if (total > top) {
            top = total;
            ways = paths[k + 1][i + 1];
          } else if (total === top) {
            ways += paths[k + 1][i + 1];
          }
        }
        best[k][c] = top;
        paths[k][c] = ways;
      }
    }
    if (paths[0][0] !== 1) {
      return [];
    }
    const ids = [];
    let cursor = 0;
    for (let k = 0; k < width; k += 1) {
      for (let i = cursor; i <= count - (width - k); i += 1) {
        if (scores[k][i] + best[k + 1][i + 1] === best[k][cursor]) {
          ids.push(columns[i].id);
          cursor = i + 1;
          break;
        }
      }
    }
    return ids.length === width && new Set(ids).size === width ? ids : [];
  }

  // ===== Edit-Mode DOM identity =====
  function tableRows(table) {
    return Array.from(table?.rows ?? []);
  }

  function headerRow(table) {
    return table?.querySelector?.(HEADER_ROW_SELECTOR) ?? null;
  }

  function machineIdFromTable(table) {
    // #item_splits -> item, matching NetSuite's own {sublistId}_row_{n} ids.
    return String(table?.id ?? "").replace(/_+(?:splits|div)$/, "");
  }

  function rowLineNumber(row, machineId) {
    const prefix = `${machineId}_row_`;
    const id = String(row?.id ?? "");
    if (!id.startsWith(prefix)) {
      return null;
    }
    const line = Number(id.slice(prefix.length));
    return Number.isSafeInteger(line) && line > 0 ? line : null;
  }

  function columnIdFromSpanId(spanId, machineId, line) {
    // Mirrors src/internal-ids/core.js sublistColumnId, with the row's own line
    // number instead of a hard-coded 1 so a paged machine (line 26+) decodes and
    // line 21 can never be mistaken for line 1. When the caller passes no line —
    // the open line and the permanent entry row materialise line-LESS ids such as
    // item_item_fs — the bare _fs suffix is accepted instead. Numbered decoding is
    // untouched: a mismatched line still refuses.
    const raw = String(spanId ?? "");
    const numbered = Number.isSafeInteger(line) && line > 0;
    const suffix = numbered ? `${line}_fs` : "_fs";
    if (!raw.endsWith(suffix) || raw.length === suffix.length) {
      return null;
    }
    const withoutRow = raw.slice(0, -suffix.length);
    const prefix = machineId ? `${machineId}_` : "";
    const identifier = prefix && withoutRow.startsWith(prefix)
      ? withoutRow.slice(prefix.length)
      : withoutRow;
    return normalizeColumnId(identifier);
  }

  function visibleCells(row) {
    // Inline display:none is how NetSuite hides its own system cells; SuiteMate
    // hides columns with a class, so a SuiteMate-hidden column stays on the axis.
    return Array.from(row?.cells ?? []).filter((cell) => cell?.style?.display !== "none");
  }

  function isExcludedRow(row) {
    try {
      return row?.matches?.(EXCLUDED_ROW_SELECTOR) === true;
    } catch {
      return true;
    }
  }

  function nodeText(node) {
    return String(node?.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  function isFocusedRow(row) {
    try {
      // Fail closed: a row that cannot be interrogated is treated as open, so
      // its widget text can never be mistaken for cell data.
      return row?.matches?.(FOCUSED_ROW_SELECTOR) !== false;
    } catch {
      return true;
    }
  }

  // NetSuite's own text in one cell, with every node a SuiteMate feature injected
  // into it removed first (spec Amendment A3.2). Three consumers: the label
  // reader below, Task 16's control bar, and M6/M7's filter and sort keys.
  //
  // WHY THE STRIP IS NOT OPTIONAL. Header cells are shared furniture: internal-ids
  // appends a badge span carrying data-suitemate-v3-internal-id into
  // `.uir-machine-headerrow > td` (live-confirmed), and from Task 16 this feature
  // hangs its OWN chips there — which FOREIGN_NODE_SELECTOR also names. Reading a
  // cell whole would therefore feed another feature's output, and worse this
  // feature's own output, into a label that keys a control bar and correlates
  // column identity. That is A3.2's shape exactly: a value we wrote, laundered
  // back in through a read.
  //
  // It reads, and never writes: the strip happens on a DETACHED clone, because the
  // badge is another feature's node and removing it from the page would be this
  // feature reaching across the boundary the plan draws around every other one.
  //
  // Fail closed on a cell that carries an injected node and cannot be read clean —
  // an unclonable cell, a node that will not detach, a hostile query surface. The
  // one outcome A3.2 forbids is returning the polluted text as though it were
  // NetSuite's, so an unreadable cell reads as empty instead.
  function readCellText(cell) {
    try {
      if (typeof cell?.querySelector !== "function") {
        // No query surface at all: nothing can be hiding in it. This is the
        // div.listheader wrapper's shape, and a plain text node's.
        return nodeText(cell);
      }
      if (!cell.querySelector(FOREIGN_NODE_SELECTOR)) {
        // The overwhelmingly common case, and the one the live machine is in for
        // every static data cell: bare text, nothing injected, no clone needed.
        return nodeText(cell);
      }
      const clone = cell.cloneNode?.(true);
      if (typeof clone?.querySelectorAll !== "function") {
        return "";
      }
      for (const foreign of Array.from(clone.querySelectorAll(FOREIGN_NODE_SELECTOR))) {
        foreign.remove?.();
      }
      // Verified, not assumed: a node that did not detach leaves the text dirty,
      // and dirty is the one thing this must never return.
      return typeof clone.querySelector === "function" && clone.querySelector(FOREIGN_NODE_SELECTOR)
        ? ""
        : nodeText(clone);
    } catch {
      return "";
    }
  }

  // The visible header's labels, one per visible header cell.
  //
  // `columnIds` is OPTIONAL and is a FALLBACK ONLY — a name for a column whose
  // header renders no text, so Task 16's control bar can still list it. It is
  // never a substitute for a label: readColumnIds and readColumnIdsFrom call this
  // with ONE argument precisely so a blank header stays blank and A1.2's
  // blank-label gate refuses the machine instead of correlating an id against
  // itself. Extended in place rather than redeclared — a second declaration of
  // this name in this scope silently wins and would have re-pointed both identity
  // call sites at it.
  function readHeaderLabels(table, columnIds) {
    return visibleCells(headerRow(table)).map((cell, index) => {
      // div.listheader when the machine wraps its label, the cell itself when it
      // does not: both shapes are observed live and neither is guaranteed.
      const label = readCellText(cell?.querySelector?.(HEADER_LABEL_SELECTOR) ?? cell);
      return label || (Array.isArray(columnIds) ? String(columnIds[index] ?? "") : "");
    });
  }

  function readSampleRowTexts(table, width, lineCount) {
    const machineId = machineIdFromTable(table);
    const header = headerRow(table);
    const samples = [];
    for (const row of tableRows(table)) {
      const line = row === header ? null : rowLineNumber(row, machineId);
      if (line === null || line > lineCount || isExcludedRow(row) || isFocusedRow(row)) {
        continue;
      }
      const cells = visibleCells(row);
      if (cells.length !== width) {
        continue;
      }
      // Indexed by the row's OWN line number: an open line that is skipped must
      // leave a hole, not shift every later row against {machine}data.
      samples[line - 1] = cells.map(nodeText);
    }
    return samples;
  }

  function alignsToHeader(row, columnIds) {
    return Array.isArray(columnIds)
      && columnIds.length > 0
      && visibleCells(row).length === columnIds.length;
  }

  // NetSuite numbers only its committed lines. The permanent entry row — which is
  // always present, always focused and always full-width — carries no id at all,
  // so requiring a numbered id is what keeps it off the data-row axis.
  const NUMBERED_ROW_ID = /_row_[1-9][0-9]*$/;

  function hasNumberedRowId(row) {
    return NUMBERED_ROW_ID.test(String(row?.id ?? ""));
  }

  function isDataRow(row, columnIds) {
    try {
      return row?.matches?.(DATA_ROW_SELECTOR) === true
        && hasNumberedRowId(row)
        && !row.matches(HEADER_ROW_SELECTOR)
        && !isExcludedRow(row)
        && alignsToHeader(row, columnIds);
    } catch {
      return false;
    }
  }

  function readColumnIds(table) {
    try {
      const labels = readHeaderLabels(table);
      if (labels.length < 2 || labels.some((label) => !label)) {
        return [];
      }
      const machineData = readMachineFieldData(table);
      if (!machineData || machineData.lines.length === 0) {
        // A1.2's "Hidden input missing" gate row, and its requirement of at least
        // one closed, numbered data line: with no {machine}data there is no value
        // corroboration at all, so the axis would rest on label affinity alone —
        // which is precisely the label keying A1.2 exists to refuse. The probed
        // form declines here by measurement (56 optima); narrower machines would
        // not, so the refusal is by construction rather than by luck.
        return [];
      }
      const columns = collapseDisplayTwins(machineData.fieldIds, machineData.lines);
      const samples = readSampleRowTexts(table, labels.length, machineData.lines.length);
      const ids = correlateColumnIds(labels, columns, samples);
      // Emit the NORMALIZED form, not the raw {machine}fields token: validating
      // through normalizeColumnId while emitting the raw string would let a
      // padded id key storage under " rate " while every other entry point
      // (normalizeColumnIds, writeOrder, normalizeWidths) stores "rate".
      return ids.every((id) => normalizeColumnId(id)) ? ids.map(normalizeColumnId) : [];
    } catch {
      return [];
    }
  }

  function readColumnIdsFrom(table, fieldsValue, dataValue) {
    // The same derivation as readColumnIds, taking the two serialized VALUES
    // instead of reading them off table.closest("form"). Live 2026-08-03 (M1.5
    // re-probe): NetSuite wraps the machine table in its own mini-form —
    // form[name="item_form"] — while itemfields/itemdata live in
    // form[name="main_form"], so the form-scoped lookup can never see them and
    // readColumnIds declined on every live install. The caller that CAN see the
    // whole document resolves them (src/edit-grid/runtime.js currentColumnIds,
    // mirroring the live-verified route at src/internal-ids/runtime.js:56,198,202)
    // and hands them here; core stays document-free, which is what the
    // source-purity test measures.
    //
    // Deliberate duplication, not an oversight: readColumnIds keeps its body
    // byte-identical so the fallback path stays exactly the code the M1.5 unit
    // suite already pins, and the gate sequence below is asserted independently
    // on BOTH entries (tests/edit-grid.test.mjs, "readColumnIds fails closed on
    // every unusable machine" and "readColumnIdsFrom fails closed …"), so the
    // two cannot drift silently. Sanctioned by adjudication #13, which also
    // sanctions the frozen contract growing 50 -> 51 for this one name.
    try {
      const labels = readHeaderLabels(table);
      if (labels.length < 2 || labels.some((label) => !label)) {
        return [];
      }
      const machineData = parseMachineFieldData(fieldsValue, dataValue);
      if (!machineData || machineData.lines.length === 0) {
        // A1.2's "Hidden input missing" gate row and its requirement of at least
        // one closed, numbered data line — a null/empty value reaches here as an
        // unparseable field list or an empty line set and refuses either way.
        return [];
      }
      const columns = collapseDisplayTwins(machineData.fieldIds, machineData.lines);
      const samples = readSampleRowTexts(table, labels.length, machineData.lines.length);
      const ids = correlateColumnIds(labels, columns, samples);
      return ids.every((id) => normalizeColumnId(id)) ? ids.map(normalizeColumnId) : [];
    } catch {
      return [];
    }
  }

  function isOrderedMachine(table) {
    try {
      // Fail closed: a node that cannot be interrogated counts as ordered, so a
      // machine whose drag handles were never readable is never reordered.
      if (typeof table?.matches !== "function") {
        return true;
      }
      if (table.matches(ORDERED_TABLE_SELECTOR)) {
        return true;
      }
      if (table.closest?.(ORDERED_CONTAINER_SELECTOR)) {
        return true;
      }
      return Boolean(table.querySelector?.(MOVABLE_CELL_SELECTOR));
    } catch {
      return true;
    }
  }

  // ===== Widths =====
  // The per-column floor a width may never go under: the widest widget the
  // machine has materialised in that column. Live 2026-08-02, probe 7: static
  // cells are bare text and widgets exist only on the OPEN line, materialised per
  // cell — so this is measured cell by cell across every aligned row, not read
  // off one designated row, and a machine with no line open legitimately answers
  // 0 for every column. clampWidth then floors those at ABSOLUTE_MIN_COLUMN_WIDTH.
  //
  // "widgets exist only on the OPEN line" is probe 7's reading and it is WRONG as
  // a statement about the machine as a whole (M2 Task 13 live gate): NetSuite's
  // permanent entry row is always focused and always materialised, so on a real
  // machine this answers non-zero for every widget-bearing column, always. That
  // is why it has exactly one caller — handleResizeMove, where a user is choosing
  // a width — and why no apply may consult it: a floor that is always there is a
  // floor that widens every column on every apply. See core.applyWidths' clamp.
  //
  // The axis is a PARAMETER, never derived here (spec Amendment A1.2 rule 3): the
  // caller holds the pinned axis, and re-deriving under a permutation is never
  // correct.
  function columnMinimums(table, columnIds) {
    const minimums = {};
    if (!Array.isArray(columnIds) || !columnIds.length) {
      return minimums;
    }
    for (const id of columnIds) {
      if (id) {
        // Seeded for every column on the axis, including the ones that carry no
        // widget: the caller looks a column up by id and a hole reads as
        // undefined, which clampWidth would silently treat as "no floor".
        minimums[id] = 0;
      }
    }
    try {
      const header = headerRow(table);
      for (const row of tableRows(table)) {
        // A row that does not align to the header cannot be indexed against it —
        // that is what keeps the button row, the totals row and any ragged row
        // caught mid-repaint from contributing a floor to a column they are not
        // under. The header itself is skipped so its own furniture never counts.
        if (row === header || !alignsToHeader(row, columnIds)) {
          continue;
        }
        visibleCells(row).forEach((cell, index) => {
          const id = columnIds[index];
          if (!id) {
            return;
          }
          for (const widget of Array.from(cell?.querySelectorAll?.("input, select, textarea") ?? [])) {
            // `|| 0` and not `??`: a hostile or unmeasured offsetWidth arrives as
            // NaN, which survives Math.max silently and would come back out of
            // clampWidth as a poisoned floor for that column.
            minimums[id] = Math.max(minimums[id] ?? 0, Number(widget?.offsetWidth) || 0);
          }
        });
      }
    } catch {}
    return minimums;
  }

  // Freezes the header row's widths and flips the machine to fixed layout, which
  // is the whole mechanism: live 2026-08-02 the machine carries no <colgroup>, no
  // width attributes and table-layout:auto, and every repaint discards whatever
  // we set — so re-applying a frozen row 1 is the only sizing that survives.
  // `null`/`{}` widths restores the native layout.
  //
  // The axis is a PARAMETER. Two independent reasons, both binding:
  //   1. Core reaches the machine's identity inputs only through
  //      table.closest("form"), and live 2026-08-03 that route lands in
  //      NetSuite's machine mini-form (form[name="item_form"]), which never holds
  //      them — the M1.5 MOUNT FAIL fixed at dd8143a. A readColumnIds call in
  //      here would answer [] on every real install and refuse every width.
  //   2. Spec Amendment A1.2 rule 3: while a non-native order is applied the
  //      pinned axis is reused verbatim and readColumnIds is NOT called, because
  //      re-deriving from a permuted rendering is never correct (measured on the
  //      live payload: 55% decline, 45% silent mis-key, 0% correct).
  // The caller — runtime applyAll, which is handed the pin — already has it.
  //
  // Sanctioned by adjudication #14, which departs from the task brief's verbatim
  // Step 4 (an internal readColumnIds call), also sanctions the frozen contract
  // growing 52 -> 54 for this name and columnMinimums, and explicitly forbids a
  // "derive it if the caller passed none" fallback here: a silent re-derivation
  // is the A1.2 rule-4 back door and must not exist. An active apply with no
  // usable axis fails closed instead.
  //
  // `minimums` is parameter 3 and IS DELIBERATELY NEVER READ (adjudication #17).
  // It is retained, not removed, for three reasons:
  //
  //   1. SIGNATURE STABILITY. Adjudication #14 ruled this four-argument shape,
  //      and three call-site pins assert it. Reversing a ruled signature is a
  //      doctrine change and needs its own adjudication, not a quiet edit.
  //   2. ARITY COLLISION — the decisive one. The clear path is called as
  //      `applyWidths(table, null, {})` with no axis at all. Drop parameter 3
  //      and any surviving three-argument call silently feeds `columnIds` into
  //      the minimums slot: a positional shift that type-checks, throws nothing,
  //      and mis-keys every column. That is the exact bug class this milestone
  //      was spent on.
  //   3. It costs one unread parameter, against a silent-failure mode.
  //
  // WHAT A FUTURE READER MUST NOT CONCLUDE: that floors still apply here. They
  // do not. An apply clamps to the static bounds only (see the clamp below);
  // the per-column widget floor lives at handleResizeMove, where a width is
  // CHOSEN. This slot is inert, and that inertness is PINNED BY TEST — a hostile
  // or huge minimums map provably changes nothing this function writes.
  // Re-admitting an apply-time floor through this slot requires a FRESH
  // ADJUDICATION, because doing it silently is precisely how defect D1 happened.
  function applyWidths(table, widths, minimums, columnIds) {
    try {
      const header = headerRow(table);
      if (!header) {
        return false;
      }
      const cells = visibleCells(header);
      const active = isPlainObject(widths) && Object.keys(widths).length > 0;
      if (!active) {
        // The restore path needs no axis at all, and must not: teardown calls it
        // as applyWidths(table, null, {}) after the pin has already been dropped,
        // and a mount that cannot key its columns must still be able to undo
        // whatever it set.
        for (const cell of cells) {
          if (cell.style) {
            cell.style.width = "";
          }
        }
        if (table.style) {
          table.style.tableLayout = "";
        }
        return true;
      }
      if (!alignsToHeader(header, columnIds)) {
        return false;
      }
      // Freeze EVERY column at its stored or currently rendered width so the flip
      // to fixed layout is pixel-identical; fixed layout then reads row 1 only, so
      // repainted data cells cannot disturb the columns. table.style.width is
      // deliberately left unset so the machine keeps its own sizing.
      cells.forEach((cell, index) => {
        const id = columnIds[index];
        const stored = id ? Number(widths[id]) : Number.NaN;
        const rendered = Math.round(cell.getBoundingClientRect?.().width ?? 0);
        // `stored > 0`, not merely finite: Number(null) is 0, and a 0 target skips
        // the assignment below and leaves that ONE column unfrozen under fixed
        // layout — the partial freeze this mechanism exists to prevent. No real
        // value is lost, because a width storage can hold is already clamped to
        // [ABSOLUTE_MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH] before it is written.
        const target = Number.isFinite(stored) && stored > 0 ? stored : rendered;
        // No `target > 0` gate on the ASSIGNMENT (adjudication #15, closing the
        // Task 11 review's zero-rendered minor): a header cell that measures 0 —
        // and has no stored width to fall back on — would otherwise be the one
        // column left at width:"" under fixed layout, which is the partial freeze
        // this function exists to prevent. Zero falls through to clampWidth(0, …)
        // and lands on the floor instead. The `stored > 0` guard above is
        // untouched: that one keeps Number(null) === 0 from beating the rendered
        // width, and it is pinned by its own mutation.
        //
        // #15 AND #20 PARTITION ON ONE QUESTION — is this column currently
        // RENDERING? #15 is the rule for a column that renders and measures 0: it
        // participates in the fixed layout, so leaving it at width:"" shifts
        // pixels, and flooring it is the remedy. A column the RUNTIME is hiding
        // participates in nothing (`display: none !important` removes it from the
        // fixed-layout calculation), so #15's harm cannot arise and this same
        // floor becomes the damage — it makes our own rendering the column's width
        // for the session and, through handleResizeDown's seed, for storage.
        // That case is handled where the hidden set lives, in the runtime
        // (adjudication #20, runtime.js plannedWidths / the freeze's exclusion),
        // and NOT here: this function is axis-taking and hidden-set-blind by
        // design. Do not collapse the two rules — the clamp is right for #15 and
        // wrong for #20, and only the caller can tell them apart.
        //
        // `clampWidth(target, 0)` — the STATIC bounds only, never a per-column
        // widget floor. M2 Task 13 live gate, defect D1: this line used to pass
        // `minimums?.[id]`, and because the runtime handed it a freshly measured
        // map on every apply, every widget-bearing column was widened past its
        // plan on every apply — to a floor that NetSuite's permanent, always
        // materialised entry row guarantees is non-zero. It WALKED, because
        // netsuite.css:2999-3001 sizes a widget at calc(100% - 21px) of its own
        // cell: each apply's output is the next measurement's input. Live it took
        // Committed 72 -> 111 -> 174px and Units 75 -> 213px, neither ever
        // dragged. frozenWidths could not stop it — the freezing gate in
        // applyCurrentWidths guards RECORDING, not APPLYING.
        //
        // The invariant this restores, stated with its precondition because it is
        // NOT unconditional (M2 Task 13a review, Important #2): for every column
        // the plan NAMES, an apply is a pure function of the widths it is handed —
        // it never widens such a column, and two consecutive applies of the same
        // plan leave byte-identical style.width on it.
        //
        // A column the plan does NOT name takes `rendered` on the line above, and
        // `rendered` is a border box that includes whatever the inline width does
        // not — so if this function is called twice with a plan that omits a
        // column, that column grows by the difference each time. Measured: plan
        // {quantity:160}, naturals [120,90,100], four applies, rect 2px over the
        // inline value -> item 120/122/124/126; at 11px -> 120/131/142/153. It is
        // the same shape as the so-columns defect this task escalated, and it is
        // pinned by its own test rather than left as a claim.
        //
        // PRODUCTION IS SAFE BECAUSE THE PLAN IS TOTAL, and that is a property the
        // runtime maintains, not luck: plannedWidths() is {...frozenWidths,
        // ...columnWidths}, and the FREEZING apply records frozenWidths for EVERY
        // header cell (adjudication #15 made the assignment unconditional, so
        // every cell has a parseable width to record). The only apply that sees a
        // partial plan is therefore the first one, where falling back to the
        // rendered width is the intended behaviour — the freeze itself. Any future
        // caller that can apply a partial plan TWICE reopens this, so it must
        // bring its own total-plan guarantee.
        //
        // The widget floor still exists, at the only place a width is actually
        // CHOSEN — handleResizeMove's clamp — so a user cannot drag a column under
        // its own widget, and what reaches storage is already floored at the
        // moment the choice was made.
        if (cell.style) {
          cell.style.width = `${clampWidth(target, 0)}px`;
        }
      });
      if (table.style) {
        table.style.tableLayout = "fixed";
      }
      return true;
    } catch {
      return false;
    }
  }

  // ===== Hide / show =====
  // Hides exactly the columns `hiddenIds` names, across the header and every
  // aligned, non-excluded row, BY CLASS ONLY.
  //
  // CLASS ONLY, and this is the load-bearing sentence of the whole function
  // (spec A3.2's carve-out, design doc :605-615). `visibleCells` reads INLINE
  // `style.display`, and is right to: inline display:none is how NetSuite hides
  // its own system cells, a property this feature never writes, so a
  // SuiteMate-hidden column stays on the axis. The moment this function writes an
  // inline display it collapses the one property that tells NetSuite's hiding
  // apart from ours — the hidden column drops out of `visibleCells`, the axis
  // shortens, and the next install keys storage by an axis this feature's own
  // output shortened. That is laundering into column IDENTITY, strictly worse
  // than the width D1 laundered. The `display: none !important` lives in
  // edit-grid.css:10-12, where display-defeats-hidden is already closed.
  //
  // The value is untouched: the cell, its widget and its content stay in the DOM
  // and still submit — live-proven at probe 11, where a hidden required column
  // committed cleanly.
  //
  // The axis is a PARAMETER and is never derived here (Amendment A1.2 rule 3,
  // adjudication #14). No "derive it if the caller passed none" fallback exists,
  // by ruling: that is the rule-4 back door. An active hide with no usable axis
  // fails closed.
  //
  // `alignsToHeader(header, columnIds)` and not a bare length compare: a two-id
  // axis against a three-column header passes `Array.isArray && length` and then
  // hides by index against an axis that is not what is rendered — a silent
  // mis-hide of the same family as a mis-keyed width.
  function applyHidden(table, hiddenIds, columnIds) {
    try {
      if (!table) {
        return false;
      }
      const hidden = Array.isArray(hiddenIds) ? hiddenIds.filter((id) => id) : [];
      if (!hidden.length) {
        // ADJUDICATION #19: an empty hidden set is a RESTORE, it takes no axis,
        // and it is UNCONDITIONAL. It runs before every gate below — a broken,
        // empty or misaligned axis does not stop it, and neither does a missing
        // header row.
        //
        // Grounds. It cannot mis-key: it makes no per-column decision at all.
        // Teardown genuinely runs after the pin has been dropped, so demanding an
        // axis here would make teardown fail closed and STRAND THIS FEATURE'S OWN
        // CLASS on NetSuite's page — the one place in this feature where refusing
        // is worse than acting. The header gate is dropped for the same reason and
        // one more: applyWidths' restore keeps its header check because it writes
        // to header CELLS and mechanically cannot work without them, which is a
        // necessity of that function and not a policy to copy here. This sweep
        // needs no header at all.
        //
        // Every cell of every row, not just the visible ones and not just the
        // aligned ones: a row that has gone ragged since the apply — an open line
        // grows spacer cells around its widgets — still carries the class the
        // apply put there, and a reveal that could not reach it would strand it.
        for (const row of tableRows(table)) {
          for (const cell of Array.from(row?.cells ?? [])) {
            cell?.classList?.remove?.(CLASSES.colHidden);
          }
        }
        return true;
      }
      // One gate, not two: alignsToHeader already subsumes "there is a header" —
      // a null header has no visible cells, and an axis of length 0 is refused by
      // alignsToHeader itself, so no non-empty axis can ever match it. A separate
      // `!headerRow(table)` clause would be unreachable, and an unreachable gate
      // is one no mutation can kill and no reader can trust.
      if (!alignsToHeader(headerRow(table), columnIds)) {
        return false;
      }
      const wanted = new Set(hidden);
      const flags = columnIds.map((id) => wanted.has(id));
      for (const row of tableRows(table)) {
        // An excluded row is skipped even when it aligns — a totals row rendered
        // at full width does — so hiding a column never takes a total with it.
        // A ragged row is skipped because it cannot be indexed against the axis;
        // that keeps an open line from being NEWLY hidden, but it does NOT clear
        // a class an earlier apply already set on it, which is why force-reveal
        // is a runtime duty and not a free consequence of this gate.
        if (isExcludedRow(row) || !alignsToHeader(row, columnIds)) {
          continue;
        }
        // toggle(name, force) is idempotent by construction: two consecutive
        // applies of the same hidden set leave byte-identical class attributes.
        visibleCells(row).forEach((cell, index) => {
          cell?.classList?.toggle?.(CLASSES.colHidden, flags[index]);
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  // ===== Frozen export surface =====
  Object.defineProperty(globalScope, "SuiteMateV3EditGridCore", {
    value: Object.freeze({
      VERSION,
      STORAGE_KEY,
      STORAGE_SCHEMA_VERSION,
      MAX_SYNC_ITEM_BYTES,
      MAX_COLUMN_ID_LENGTH,
      MAX_COLUMN_IDS,
      ABSOLUTE_MIN_COLUMN_WIDTH,
      MAX_COLUMN_WIDTH,
      MAX_MACHINE_FIELDS,
      MAX_SAMPLE_ROWS,
      MACHINE_TABLE_SELECTOR,
      MACHINE_CONTAINER_SELECTOR,
      HEADER_ROW_SELECTOR,
      DATA_ROW_SELECTOR,
      FOCUSED_ROW_SELECTOR,
      EXCLUDED_ROW_SELECTOR,
      COLUMN_SPAN_SELECTOR,
      HEADER_LABEL_SELECTOR,
      REQUIRED_FIELD_SELECTOR,
      FIELD_DELIMITER,
      LINE_DELIMITER,
      OPTION_DELIMITER,
      DATA_ATTRIBUTE,
      NATIVE_ROW_ATTRIBUTE,
      BOUND_ATTRIBUTE,
      AXIS_ATTRIBUTE,
      FOREIGN_NODE_SELECTOR,
      CLASSES,
      clampWidth,
      normalizeStored,
      refusesNewerSchema,
      withOrder,
      withHidden,
      withWidths,
      machineIdFromTable,
      rowLineNumber,
      columnIdFromSpanId,
      visibleCells,
      tableRows,
      headerRow,
      isExcludedRow,
      alignsToHeader,
      isDataRow,
      readColumnIds,
      readColumnIdsFrom,
      isOrderedMachine,
      columnMinimums,
      applyWidths,
      applyHidden,
      parseMachineFieldData,
      readMachineFieldData,
      collapseDisplayTwins,
      readCellText,
      readHeaderLabels,
      readSampleRowTexts,
      labelAffinity,
      correlateColumnIds
    }),
    configurable: false,
    enumerable: true,
    writable: false
  });
})(globalThis);
