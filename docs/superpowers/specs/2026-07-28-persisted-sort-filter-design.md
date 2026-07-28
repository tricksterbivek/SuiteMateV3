# Persisted Sort & Filter Preferences — Design Spec

Date: 2026-07-28
Status: Awaiting owner review
Baseline: v3.18.1 stable (post-restore, commit `24d715a`)

Owner decisions already made:

1. Feature selected from the ranked candidates brief (artifact `b7ef6f65`): the transaction grid remembers its sort and filters per user, per company, per record type, and reapplies them on every visit — completing the personalization story alongside the persisted column order/hidden/widths.
2. Reapply UX: **auto-apply with a visible indicator** and a one-click clear (not offer-on-click, not a preference).
3. Approach: **extend the existing per-scope storage entry** (approach A) — same key, same quota, same eviction, same Reset. A separate storage key and tab-session stickiness were considered and rejected.

## 1. Objective

When a user sorts or filters a transaction sublist, that view state persists to `chrome.storage.sync` under the grid's existing scope key (`companyId:userId:recordType`) and reapplies automatically the next time any record of that type is opened — exactly the mental model column layout already has. A control-bar chip makes the restored view visible and clearable in one gesture.

## 2. Stored shape

The `suiteMateV3ColumnOrder` item's schema version bumps **2 → 3** (this is the so-columns storage schema, distinct from the settings schema). Per-scope entries gain two optional fields beside `order`/`hidden`/`widths`:

```
sort:    { label: string, dir: "asc" | "desc" }
filters: { [columnLabel: string]: { anyOf?: string[], q?: string } }
```

- `filters` mirrors the runtime per-column state: `anyOf` is the multi-select value set (OR within column, AND across columns), `q` the operator/contains query text.
- `textAsRowFilter` is NOT stored — it is a property of column cardinality and is re-derived at apply time, as it is today.
- Normalization (fail-closed, matching existing style): labels and values are trimmed non-empty strings capped at 200 chars; `q` capped at 100 chars; `dir` must be exactly `asc` or `desc`; anything else is dropped.
- Quota caps: at most **8 filtered columns per scope** and **50 values per column's `anyOf`**. State beyond the caps stays session-only, and the save path surfaces the existing quota-warning toast. The 7,800-byte item guard and single-entry eviction are unchanged.

Migration: stored v2 objects are valid v3 objects with no `sort`/`filters` fields — migration stamps the version and passes entries through. `refusesNewerSchema` means a v3.18.1-or-older build refuses to overwrite v3 data instead of silently dropping the new fields.

## 3. Core API (pure, in `src/so-columns/core.js`)

- `withSort(stored, scopeKey, sort | null)` — merge or delete the scope's sort; returns the next stored object or `null` on rejection (quota/newer-schema), the exact `withWidths` contract.
- `withFilters(stored, scopeKey, filters | null)` — same contract; applies the normalization and caps above.
- `normalizeEntry`/`normalizeStored` extended for the new fields; an entry whose last field is removed is deleted whole, as `withOrder(null)` does today.

## 4. Apply path (in `src/so-columns/runtime.js`)

`installSoColumns` currently applies `order → hidden → widths`. It gains `→ sort → filters`:

- **Sort:** find the header cell whose label matches `sort.label` (the established label identity); run the shipped `sortRows` with the stored direction. Native-order stamps are captured before the sort, so clearing returns to native exactly as a manual sort cycle does. A label with no match is skipped silently — the same graceful degradation `planOrder` has. A sort label that is currently hidden still sorts the rows (harmless, and the chip discloses it).
- **Filters:** rebuild the per-column filter state for each stored label that matches a header, re-derive `textAsRowFilter` from current distinct-value cardinality, then run the shipped `applyFilters`. Stored values absent from this record simply match nothing — with the chip and the existing "n of m items" status, an unexpected empty grid is explainable and one click from native.
- Works identically for both row families (`uir-machine-row` and `uir-list-row-tr`) because it reuses the shipped predicates.

## 5. Save path

- Sort save triggers: the menu's Sort Ascending / Sort Descending / clear-sort actions.
- Filter save triggers: checkbox toggle, Select all, Clear filter, and operator/contains query commit — i.e., every point where the runtime already recomputes filters.
- Each trigger persists through `withSort`/`withFilters`; a `null` return leaves session state live and shows the warning toast (existing pattern).
- Query-text commits debounce ~800ms before writing — `chrome.storage.sync` throttles write operations per minute, and per-keystroke saves would trip it. Checkbox/sort actions save immediately.
- **Reset** keeps its single-write semantics: `withOrder(null)` already deletes the whole scope entry, which now includes sort and filters.

## 6. Indicator chip

One control-bar element (`data-suitemate-v3-so-columns="view-chip"`), same chrome family as the hidden-column chips:

- Text composes from active persisted state, e.g. `Amount ↓ · 2 filters`, with a `✕` affordance.
- Click clears sort AND filters (session + storage) in one gesture; column layout is untouched.
- The chip reflects the ACTIVE sort/filter state, whether or not it fit under the persistence caps (its ✕ clears whatever is active); it renders only when such state exists, updates live as state changes, and is dark-mode styled via the existing literal-plus-`isDarkMode` pattern of the so-columns stylesheet.

## 7. Error handling

- Quota or newer-schema rejection: `null` from core, warning toast, session state unaffected.
- Hostile stored data: normalizers drop malformed fields fail-closed; nothing throws into the page.
- Zero-row outcomes from restored filters are a legitimate state, made legible by chip + status line.

## 8. Testing

- **Unit (vm harness, `tests/so-columns.test.mjs`):** `withSort`/`withFilters` merge/delete/reject paths; v2→v3 migration and pass-through; cap enforcement (9th filter column and 51st value dropped); hostile-input normalization; `refusesNewerSchema` on v4; source-purity rules stay green.
- **Fixture browser pass:** seed storage with a saved view, load the sales-order fixture, assert at computed-pixel level that rows are sorted/filtered on install, the chip renders, and clearing restores native order and all rows.
- **Live pass (tricksterbivek profile):** SO 16302518, PO 16295656, Item Fulfillment 14953684 (both row families) — sort+filter, reload, verify auto-reapply and chip; destructive cycles confined to the known-empty-scope PO; the owner's real saved layouts untouched; zero console errors.

## 9. Out of scope (YAGNI)

Multi-column sort; named filter presets; cross-record-type or cross-user sharing; popup UI changes; cross-tab live sync of view state (parity with column layout, which also applies at install only); persisting `textAsRowFilter` as a flag.
