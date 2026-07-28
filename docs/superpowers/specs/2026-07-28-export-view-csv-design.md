# Export Current View to CSV — Design Spec

Date: 2026-07-28
Status: Awaiting owner review
Baseline: Milestone 20 (`b7b1b6f`); ships bundled with persisted sort & filter as v3.19.0.

## 1. Objective

CSV Utils gains a third item, **Export view**: it downloads exactly the personalized item grid the user sees — visible columns only, in current DOM order, visible (filtered) rows only, in current (sorted) row order, display text as shown. It closes the loop where users shape the grid and then rebuild it by hand in Excel from the native export.

## 2. Decisions

1. **Data source is a read-only DOM snapshot of `#item_splits`** — not the `N/record` bridge. "Exactly what you see" is a property of the DOM; the record API knows nothing about personalization, and mapping labels back to field ids would be the fragile coupling the candidates brief warned about. The existing record-API "Export" stays untouched for full-data needs.
2. **All export logic lives in the csv-export module.** A new command `RECORD_CSV_EXPORT_VIEW: "record.csv-export-view"` joins `src/shared/commands.js`; `src/csv-export/runtime.js` implements the handler; the CSV Utils menu (`src/record-actions/csv-import.js`) just adds the item and dispatches, exactly like Export and Template. The menu stays dumb; coupling stays one-directional: csv-export reads the DOM and optionally borrows the label reader in decision 3, never so-columns state.
3. **Column labels reuse `SuiteMateV3SoColumnsCore.readCellLabel` when present** (it already clone-strips SuiteMate's injected arrows/indicators/badges from header text); when the so-columns core is absent or the feature is off, fall back to trimmed `textContent`. The export works on any record with an `#item_splits` grid, personalized or not — an unpersonalized grid simply exports all columns and rows natively ordered.

## 3. Snapshot semantics

- **Columns:** header cells of `tr.uir-machine-headerrow` in DOM order, skipping cells carrying `suitemate-v3-so-columns-col-hidden` (hidden columns) — computed `display: none` is the authoritative visibility test, headers deduplicated through the existing `makeUniqueHeaders`.
- **Rows:** `tr.uir-machine-row, tr.uir-list-row-tr` in DOM order (sorted order when a sort is active), skipping rows whose computed `display` is `none` (covers `suitemate-v3-so-columns-filtered` and anything else hiding them). Cell text = trimmed `textContent` per visible column index — the display text on screen.
- **Zero visible rows** (filters matched nothing) still exports headers-only — it is what the user sees; the success notice states the row count so nothing is mysterious.
- Encoding reuses the shipped pipeline unchanged: `serializeCsv` (per-cell `escapeCsvValue` incl. formula protection, CRLF rows), UTF-8 BOM, and the existing runtime download helper (Blob URL, immediate revoke). RFC 4180 behavior is identical to the existing export.

## 4. UX

- Menu: `CSV Utils ▾ → Export view` beneath Export and Template, same chrome and command wiring.
- No grid on the page → the existing text-only NetSuite-native notice pattern reports "This page has no item grid to export." (csv-export's established error surface; no toasts).
- Filename: `createFilename(\`${recordType}-${recordId}-view\`)` via the existing sanitizer (e.g. `salesord-16302518-view.csv`); missing id falls back to the sanitizer's default part.
- Success notice mirrors the existing export copy, including exported row/column counts.

## 5. Error handling

- Missing table, zero visible columns, or a snapshot throw → readable native notice, no partial download, no console noise (existing csv-export catch conventions).
- The handler never mutates the grid, storage, or so-columns state — snapshot only.

## 6. Testing

- **Unit (`tests/csv-export.test.mjs` style):** a pure snapshot function exercised against table stubs — hidden column skipped, display-none row skipped, sorted DOM order preserved, header dedupe applied, formula-protected cell round-trips; command-registry expectations updated for the new ID (declared change in `tests/commands.test.mjs`/`verify.mjs` if pinned).
- **Fixture browser pass:** served sales-order fixture with so-columns active — sort + filter + hide a column, invoke Export view, assert the generated CSV string (intercepted pre-download) matches the visible grid exactly.
- **Live pass:** SO 16302518 with a saved view auto-applied — Export view downloads; verify header set/order and row subset against the screen; one unpersonalized record exports full grid; Item Fulfillment covers the list-row family. View-mode only.

## 7. Out of scope (YAGNI)

Expense/other sublists (follows the so-columns scope), exporting hidden data, multi-sublist choice UI, Excel formats beyond CSV, background/batch export, any change to the existing Export/Template actions.
