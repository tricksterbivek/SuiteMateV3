# Form Layout Builder — Personal Form Views v2 Design

**Date:** 2026-07-31
**Status:** Awaiting approval
**Supersedes (extends):** `2026-07-30-personal-form-views-design.md` (v1: hide fields + persist collapse)
**Record scope:** Sales Orders only (generalize later, same as v1)

## Goal

Evolve Personal Form Views from a hide/show feature into a personal layout
builder: drag-and-drop reordering of form sections and of fields, persisted
per `companyId:userId:salesord` scope, applied automatically on load — while
keeping every v1 principle: client-side only, no NetSuite configuration
changes, native behavior preserved, no impact on other SuiteMate features.

This spec is grounded in three live probes of production SO 16302518
(account 6998262) plus an Opus assessment pass over the NetSuite client
sources (`NS.UI.Personalization`, `ShowTab`, `toggleFieldGroupVisibility`)
and the existing so-columns drag machinery.

## Ground truth: live SO form topology

The 11 field groups do **not** live in one table. They sit in four layout
tables across four subtab panels (verified live, twice):

| Panel | Groups (slot shape) |
|---|---|
| `div__body` → `#detail_table_lay` | Primary Information, Classification, Delivery Instructions, Sales Information — each its own row, one `colspan=3` slot TD |
| `shipping_div` | Shipping Information + Shipping Address (one row, `colspan=1` TDs, 3 cells) and Ship Central - Other Party Billing (own row, `colspan=3`) |
| `billingtab_div` | Billing Information + Billing Address (one row, two `colspan=1` TDs) |
| `accntingtab_div` | Account Information + Tax Information (one row, two `colspan=1` TDs) |

Load-bearing facts:

- Each group is a self-contained `<table width=100%>` inside its slot TD.
  Slot width lives on the TD (`width=33%|50%`, netsuite.css:3839), not the
  group — so a group table renders correctly in any slot **of the same
  width class**, and squishes in a narrower one.
- `#detail_table_lay` also contains a row of 3 `td.uir-table-fields-wrapper`
  holding **ungrouped** fields. These TDs are not slots and must be skipped.
- Fields inside a group: each content-row cell holds an inner
  `table.table_fields` whose rows are `tr.uir-field-wrapper-cell` (one TD
  per row). A row's TD holds one field wrapper — or occasionally two packed
  together (`tranid` + `custbody_salesorder_issue`, `shipdate` +
  `actualshipdate`, `tobeemailed` + `email`, `tobefaxed` + `fax`).
- 154/154 wrappers carry `data-field-name`; zero carry an `id`. All internal
  ids (`entity_fs_lbl`, field-help anchors) travel inside the wrapper.
- Native collapse (`NS.UI.Personalization.FieldGroup.collapse`) is 100%
  `getElementById`-based on rows *inside* the group table — moving whole
  group tables is collapse-atomic. Moving rows between tables would break it.
- `ShowTab` toggles panel `display` only; header layout is never re-rendered
  — an applied order survives subtab switches.
- Sticky group titles (netsuite.css:993) are per-table (each group table has
  exactly one title row) — reordering whole tables preserves them.
- The one positional walk in the blast radius:
  `toggleFieldGroupVisibility` resolves a field's group via
  `.closest(".uir-fieldgroup-content").siblings(...)`. It fires in edit
  mode. It makes **cross-group field moves unsafe** — a moved field would
  show/hide the wrong group's title. Within-group moves never trip it.

## What ships

One feature, four capabilities, all inside the existing **Personalize Form**
mode (no new mode, no new settings toggle — the `formViews` toggle governs
everything):

### 1. Section reorder (drag section titles)

- A `⠿` grip is injected into each group's title (inside the inner
  `div.fgroup_title` content, carrying the existing `DATA_ATTRIBUTE` so
  `sectionKey`'s clone-strip ignores it). Only the grip is `draggable` —
  the title TD is `role="button"` on collapsible groups and must keep
  click-to-collapse. `setDragImage` uses the whole title bar.
- A group can be dropped on another slot **within the same panel and the
  same width class** — equivalence class = (slot `colSpan`, cells in slot
  row). In practice: the four main-panel groups reorder freely among
  themselves; Shipping Information ↔ Shipping Address swap; Billing pair
  swaps; Account/Tax pair swaps. **Ship Central is immovable** (sole member
  of its class) — its grip is simply not rendered. Only occupied slots
  participate; the ungrouped-fields row is never a slot.
- The move is one `appendChild` of the group table into the target slot TD
  (plus the displaced table into the vacated slot) — never row surgery.
- Collapsed sections drag as-is (compact units); a drop never toggles
  collapse (`justDropped` guard on the capture-phase collapse listener,
  same shape as the shipped `replayingCollapse` flag).

### 2. Field reorder (drag fields within their column)

- During personalize mode every visible field wrapper becomes a drag source
  (`cursor: grab` on the wrapper, no extra glyph — the label already hosts
  `⊖`). Descendant links get `draggable="false"` for the duration of the
  mode (removed on exit), the so-columns precedent, so link fields don't
  hijack the drag.
- The reorder unit is the **row** (`tr.uir-field-wrapper-cell`) and the
  reachable targets are **rows of the same inner `table.table_fields`** —
  i.e. a field moves up/down within its own column of its own group.
  Packed pairs share a row and travel together. Cross-column and
  cross-group moves are out (see Out of scope) — ineligible targets never
  `preventDefault()`, so the OS no-drop cursor does the explaining.
- Ghosted (hidden) fields stay draggable and stay valid targets — otherwise
  un-hiding later strands a field the user can't reposition.
- A row's identity is the `fieldKey` of its first wrapper.

### 3. Persistence (storage schema v2)

`suiteMateV3FormViews` bumps to `schemaVersion: 2`. v1 entries read through
unchanged (`normalizeStored` already accepts `<= STORAGE_SCHEMA_VERSION`);
no migration code. New optional per-entry keys:

```json
{
  "schemaVersion": 2,
  "views": {
    "6998262:2462:salesord": {
      "hiddenFields": ["entity"],
      "collapsedSections": ["Classification"],
      "sectionOrder": ["Sales Information", "Primary Information", "..."],
      "fieldOrder": { "Primary Information": ["entity", "tranid", "..."] }
    }
  }
}
```

- **Delta-only storage** (both keys): written only when the current order
  differs from the native stamps; the key is deleted when a drag returns
  things to native (self-cleaning). Measured quota math (154 fields, real
  name lengths): full field order = 4.0–5.7 KB per scope — two scopes evict
  each other under the 7800-byte guard. Delta with a couple of customized
  sections = ~1.2–1.6 KB; `sectionOrder` alone ≈ 334 B. Delta keeps 4+
  scopes comfortably.
- `sectionOrder` is one flat list (section titles are unique on the form);
  `fieldOrder` is keyed by section title, one flat row-key list per section.
  Apply-time scoping does the partitioning: section order is applied per
  panel per width class, field order per column — stored names absent from
  the current partition just drop out (`planOrder` graceful degradation),
  so stale or variant data is inert by construction, and no stored value
  can ever cause a cross-panel, cross-class, or cross-column move.
- Saves merge off-page sections exactly like `saveCollapsedSections`
  already does, so other SO form variants' preferences survive.
- Reorder saves are silent on success (a toast per drag is spam — matches
  the sibling hide action); failures surface through the existing
  save-failure handling.

Three required hardening edits in `core.js` that the new keys expose:

1. `entryIsEmpty` must learn `sectionOrder`/`fieldOrder` — today it would
   delete an entry holding only the new keys on the next unrelated write.
2. `withField`'s "clear" test is array-only — an empty `{}` `fieldOrder`
   must clear the key rather than fall through to the normalizer and
   nullify the whole write.
3. `evictOverQuota` must return `null` when even the single surviving
   entry is over budget (Chrome hard-fails at 8192 bytes; with field
   orders this stops being a pathological case) so the write fails loudly
   through the existing failure path instead of silently corrupting.

### 4. Reset, disable, keyboard

- **Reset** stays one button: clears hidden fields, expands sections, and
  now also restores native section and field order — one write, one toast
  ("Form view reset."). Granular order undo is drag-it-back.
- Disabling the toggle (or `removeFormViews`) restores native order via the
  stamps, the so-columns precedent — no page state left behind.
- **Keyboard floor:** in personalize mode, section grips and field wrappers
  get `tabindex="0"`; `Alt+Arrow` moves the focused unit through the same
  move+apply+save path as a drop (one code path, two inputs); focus is
  restored after the move (`appendChild` blurs); `Escape` cancels an
  in-flight drag. `Alt` avoids colliding with page scroll.
  <!-- ponytail: plain tabindex=0 on all in-mode units; roving tabindex per
       group if 154 tab stops draws complaints -->
- Mode hint copy becomes: *"Personalizing — drag fields or section titles
  to reorder, ⊖ to hide. Click Done to finish."* Grip tooltip: *"Drag to
  move this section"*.

## Architecture

**Core (`src/form-views/core.js`)** — pure, vm-testable additions:

- `normalizeSectionOrder` (reuses `normalizeSections`) and
  `normalizeFieldOrder` (skip-bad-key object normalizer: proto-key
  blocklist, section-title key rules, values via `normalizeFieldNames`).
- `withSectionOrder` / `withFieldOrder` following the shipped
  `withHiddenFields` one-liner pattern over `withField`.
- `planOrder` and `moveLabel` **copied** from so-columns (the vm harness
  sandboxes each core alone; cross-core reach breaks tests — duplication
  is existing doctrine, and `moveLabel` finally gains unit coverage).
- `captureNativeSections` / `captureNativeFields`: first-touch stamping of
  a native-index attribute (`data-suitemate-v3-form-views-native-index`)
  on slot TDs, group tables, and field rows. Attribute selectors match
  exact names, so `FOREIGN_NODE_SELECTOR`'s `[data-suitemate-v3-form-views]`
  never matches stamped natives — `cleanNodeText` and the ownership checks
  keep treating them as NetSuite's.
- `applySectionOrder` / `applyFieldOrder`: enumerate partitions (panel ×
  width class; section × column), `planOrder` within each, move by
  `appendChild` — with an **identity early-return**: when current order
  already equals target, perform zero DOM writes.
- `nodeRelevant` moves into core so the observer guard is unit-testable.

**Runtime (`src/form-views/runtime.js`)** — apply pipeline on install:

```
stamp natives → applySectionOrder → applyFieldOrder
             → applyVisibility → applyCollapsedSections
```

Drag handlers mirror the so-columns contract (`dragstart/over/leave/drop/
end`, `.dragging` opacity, insertion-bar drop target) with a `dragKind`
discriminator (section vs field) and partition containment checks in place
of `activeTable.contains`. Insertion bars are axis-aware: top edge for
vertical stacks (fields, main-panel sections), leading edge for the
side-by-side narrow pairs, keyed off a `data-slot-axis` stamp.

**Observer self-trigger guard** (the one new failure mode this feature
creates): our own moves add exactly the nodes we stamped, so `nodeRelevant`
excludes any added node carrying the native-index attribute — plus the
identity early-return means a re-evaluate that does slip through performs
zero writes and the loop starves. Deterministic; no timing flags. (The
`replayingCollapse` pattern does **not** transfer here: it guards a
synchronous click listener, and observer callbacks land after any such
flag clears.) Stamping itself is attribute-only and the observer watches
`childList` only, so stamping generates no records.

**CSS (`src/form-views/form-views.css`)**: mirror the so-columns drag
vocabulary under form-views class names (source `.dragging` opacity .45,
inset insertion bar on targets, `cursor: grab` in-mode), theme-variable
driven with dark-mode blocks, `!important` on anything a NetSuite author
style could defeat (M11/M17 doctrine).

**Unchanged:** settings schema (no new key), routes capability, popup,
so-columns, csv-export, tab-title, internal-ids.

## Safety case (from the adversarial review)

| Hazard | Verdict | Mitigation |
|---|---|---|
| Native collapse breaks on move | Cleared | Collapse is id-based within the group table; we move whole tables |
| `toggleFieldGroupVisibility` positional walk | Fatal for cross-group | Cross-group field moves are out of scope |
| Wide group in narrow slot (squish) | Real | Width-class equivalence partition; Ship Central immovable |
| Sticky titles / subtab switches | Cleared | Per-table sticky; panels toggle display only |
| Packed field pairs split | Real | Row is the reorder unit; pairs travel together |
| Empty slot dead-gap | Real | Only occupied slots permute |
| Observer self-trigger loop | Real (self-inflicted) | Stamp exclusion + identity early-return |
| Form-variant data loss | Real | Merge-on-save + planOrder graceful drop |
| Quota blowout / silent eviction | Real | Delta-only storage + `evictOverQuota` → null (loud failure) |
| Field identity lost on move | Cleared | Identity rides `data-field-name` inside the wrapper; no bare ids |
| Drag on `role=button` title fires collapse | Real | Grip-only draggable + `justDropped` guard |

## Testing

- **Unit (vm harness):** normalizer/writer suite for the v2 keys (hostile
  input, newer-schema refusal, `{}`-clear, `entryIsEmpty` regression,
  two-scope eviction, evict-to-null); `planOrder`/`moveLabel` parity with
  so-columns; capture/apply on the stub DOM — identity target performs
  **zero** `appendChild`, capacity and class partition respected, fails
  closed on malformed topology; `nodeRelevant` stamp exclusion.
- **Fixture rebuild (prerequisite):** the current sales-order fixture is
  one flat table with 2 wrappers — blind to every hazard above. Rebuild it
  to the live topology: `#detail_table_lay` with 4 groups + the ungrouped
  row, three subtab panels with display toggling, inner `table_fields`
  rows, at least one packed pair, native collapse emulation preserved.
  All existing M24 fixture tests must stay green on the rebuilt fixture.
- **Fixture round-trips:** reorder → storage write shape (delta-only,
  merge, self-clean on drag-back); reload → order reapplied; toggle off →
  native restored; Reset → native + cleared; no observer loop (write
  counter stays flat after apply); keyboard path produces identical
  writes to the drag path.
- **Live verification (view mode only, my test tab):** reorder sections
  and fields, reload, verify persistence, then drag back to native and
  verify the stored entry self-cleans to exactly its prior bytes. **Never
  press Reset live** — the user's real scope (`6998262:2462:salesord`)
  holds their deliberate hidden-field prefs; delta self-cleaning is the
  respectful teardown.
- **Regression:** full `npm test` (build, syntax, unit, verify pins incl.
  updated style hashes, 28 screenshot baselines — re-bless only fixture
  pages intentionally changed, eyeball each).

## Phased build plan (checkpoint after each)

- **A — Core v2:** schema bump + normalizers + writers + the three
  hardening edits + `planOrder`/`moveLabel` + capture/apply helpers +
  `nodeRelevant` export, with the full unit suite.
- **B — Fixture rebuild:** live-topology fixture + chrome-stub unchanged
  (already serves the key); existing tests green.
- **C — Section reorder:** grips, drag + keyboard, apply/save/merge,
  Reset/disable restore, observer guard. Fixture round-trips.
- **D — Field reorder:** wrapper drag sources, anchor neutralization,
  within-column drops, ghost handling. Fixture round-trips.
- **E — Live verification + ship:** full regression, live SO protocol
  above, checkpoint entry, release on request.

## Out of scope (named, deliberate)

- **Cross-group field moves** — unsafe today (`toggleFieldGroupVisibility`
  misfires in edit mode; homeless fields on form variants). Future path:
  an explicit "Move to group…" menu action, not a gesture.
- **Cross-column reflow within a group** (capacity-preserving repacking) —
  splits packed pairs and inherits `:first-child`/`:last-child` styling
  drift; within-column reorder ships first.
- **Cross-panel section moves** — panels are subtabs; the gesture is
  meaningless in NetSuite's model.
- Moving Ship Central; other record types; edit-mode support; a separate
  settings toggle; live-region announcements.
