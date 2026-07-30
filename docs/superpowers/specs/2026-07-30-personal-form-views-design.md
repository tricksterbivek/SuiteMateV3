# Personal Form Views — Design Spec (Sales Orders MVP)

Date: 2026-07-30
Status: Approved direction from owner (build autonomously, checkpoint at milestones); details below are the working contract
Baseline: v3.20.0

## 1. Objective

Let users personalize how the Sales Order record FORM displays — the Dynamics-style "my view of this form" — while the page stays recognizably NetSuite. MVP scope, chosen for reliability over ambition (ponytail):

1. **Hide/show header fields** in view mode, per user, per company, persisted and auto-reapplied.
2. **Collapse/expand field-group sections**, persisted the same way.
3. A **Personalize Form mode** mirroring the shipped column-personalization UX: enter mode → per-field hide affordances appear and hidden fields ghost at low opacity → wrapped chip list (actions-first, Milestone-22 lesson) shows hidden fields for one-click unhide → Done / Reset.

Sales Orders only (`salesord.nl`, view mode, numeric id, no `e` param). The architecture must generalize later by widening the route rule, not by rewrite.

## 2. Explicitly out (MVP)

Field reordering (cross-cell DOM surgery — high regression risk for low MVP value); edit-mode; other record types; field highlighting; sublist areas (owned by column personalization); popup management UI; cross-user sharing. Named upgrade paths, not built.

## 3. Identity & mechanism

- Field identity: the stable `data-field-name` on `.uir-field-wrapper` (observed live, e.g. `data-field-name="subtotal"`), NOT display labels — labels vary by form, field names do not. Wrappers lacking a field name are not personalizable (skipped silently).
- Hiding: a class on the field **wrapper div** (never the `td`, never `display` on NetSuite's table cells beyond the wrapper's own box) — `display: none` on the wrapper collapses the field while the form table keeps its geometry rules. In Personalize mode the same class renders as a ghost (reduced opacity) so users can un-hide in place.
- Sections: field groups identified by their `fgroup_title` text; collapse hides the group's content rows via a class on rows below the title, with an indicator on the title. Both classes live in extension CSS; nothing NetSuite-owned gets positioning/display overrides outside these feature-scoped classes on wrapper/row elements the feature owns the meaning of.
- All affordances (hide buttons, chips, controls) are extension-owned elements injected inside existing containers, following the so-columns arrow-in-listheader precedent.

## 4. Storage

New sync key `suiteMateV3FormViews`, schema v1: `{ schemaVersion: 1, views: { [scopeKey]: { hiddenFields?: string[], collapsedSections?: string[] } } }`. scopeKey = `companyId:userId:salesord` via the same session-derived resolution as so-columns. Same doctrine as the grid store: fail-closed normalizers, 7,800-byte quota guard with single-entry eviction, newer-schema write refusal, null-on-rejection writers (`withHiddenFields`, `withCollapsedSections`), empty-entry deletion, serialized save queue.

## 5. Settings & wiring

New opt-in toggle **"Personal form views"** (`formViews`, default false) — settings schema v4 → v5 with pass-through migration and the full known ripple (popup, race support, transfer, verify). New capability `FORM_VIEWS` in the route registry gated to salesord view pages. New files `src/form-views/{core,css,runtime}` registered in the manifest bundle + verify pins + package test wiring, mirroring so-columns.

## 6. Verification

Unit: core normalizers/writers + plan/apply helpers in the vm harness (`plain()` doctrine). Fixture: served sales-order fixture — hide fields, collapse a section, reload with seeded storage, assert computed-display reapplication and chip/ghost behavior at pixel level. Live: SO 16302518 full cycle (hide, collapse, reload auto-reapply, un-hide via chip, Reset clean), plus a non-SO record proving the capability does NOT fire there; existing features smoke (grid personalization on the same page must be untouched); zero console errors. Checkpoints at: core+storage landed, runtime+UX landed, fixture-verified, live-verified.

## 7. Risks to hold

NetSuite client scripts reading hidden fields' DOM (we hide wrappers, not remove nodes — reads keep working); mandatory-field indicators (view mode only, no form submission surface); Redwood-shell DOM variance (fixture + live probes before wiring); print/PDF views (different routes — capability never fires there); the strut lesson (no inline children added to bare cells — affordances mount inside the wrapper).
