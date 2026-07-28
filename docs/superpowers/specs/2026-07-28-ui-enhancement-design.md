# SuiteMate V3 UI Enhancement Layer — Design Spec

Date: 2026-07-28
Status: Awaiting owner review
Source of truth: `design.md` (repo root) — Meta-commerce-derived design language
Baseline: `checkpoint-pre-ui-enhancement-2026-07-28` / release v3.18.1 (commit `7286bfa`)

Owner decisions already made:

1. Token values are **derived** by SuiteMate (design.md names tokens but defines almost no literals); the tables below are the authoritative proposal.
2. The new look **replaces the current styling in place**, under the existing "NetSuite styling" master toggle (`enabled` → `html.ext-f` opt-out). No second selectable theme.
3. Design approved at the approach level: token bridge first, then per-component milestones.

## 1. Objective

Apply the `design.md` design language — white canvas, ink/cobalt palette, pill buttons, soft-rounded flat cards, hairline borders, restrained elevation — across the UI SuiteMate already draws or restyles, so NetSuite feels more polished while remaining immediately recognizable. This is an enhancement layer, not a redesign: NetSuite's layout, navigation, density, and workflows are untouched.

## 2. Non-goals

- No change to NetSuite layout, positioning, or display of native elements (the sticky-header doctrine stands: never add `position`/`display` overrides to NetSuite elements).
- No behavior change to any protected feature: column personalization, drag-and-drop, hide/show, resizing, sticky headers, sorting, Excel-style filtering, filter-modal search, multi-select filtering, all-transaction-type support, toasts, CSV export/utils, SuiteQL Studio, internal IDs, role themes, dark mode.
- No React, no new dependencies, no build-pipeline changes, no `web_accessible_resources`.
- No font swap: Open Sans (already bundled in `font.css`) stands in for Optimistic VF. Montserrat bundling is a future option, not part of this work.
- No popup dark mode (that would be new functionality; the popup stays `color-scheme: light`).
- No marketing-scale typography (64px heroes have no place in an ERP) and no adoption of consumer-only tokens (`oculus-purple`, `meta-link`, pastel decorative tints — dropped for lack of a consumer).
- Hover styling on SuiteMate-owned components is retained where it exists today (design.md's "no-hover documentation" policy describes its capture method, not a prohibition).

## 3. Derived token set

New file `src/styles/tokens.css` defines the `--sm-*` namespace (short prefix because these appear hundreds of times; existing `--suitemate-radius-*` and `--theme-*` names stay). Light values below; dark values alias the existing `--dark-*` / `--dark-text-*` ramp so dark mode stays visually continuous — where no existing ramp slot fits, a derived value is recorded in that milestone's checkpoint entry. Tokens use `light-dark()` where the consuming context honors `color-scheme` (the `netsuite.css` pattern) and `.isDarkMode` overrides where `light-dark()` proved unreliable (the body-appended column-menu precedent).

### 3.1 Color

| Token | Light value | Derivation | Role |
|---|---|---|---|
| `--sm-primary` | `var(--theme-main)`, default `#0064E0` | Meta buy-CTA cobalt; **routed through the role-theme chain** | Accent: primary CTAs, active/selected states, focus |
| `--sm-primary-deep` | `#0143B5` | design.md literal | Pressed/active accent, selected borders |
| `--sm-primary-soft` | `color-mix(in srgb, var(--sm-primary) 15%, transparent)` | design.md "15% alpha" rule | Informational callout tint, selection wash |
| `--sm-ink-deep` | `#0A1317` | design.md literal `rgba(10,19,23,…)` | Headlines, black (ink) buttons |
| `--sm-ink` | `#1C2B33` | Meta primary text | Standard body text |
| `--sm-charcoal` | `#344854` | ramp step | Tertiary text, labels |
| `--sm-slate` | `#4E626F` | ramp step | Supporting microcopy |
| `--sm-steel` | `#68808F` | ramp step | Captions, quiet links |
| `--sm-stone` | `#8FA1AC` | ramp step | Disabled/de-emphasized |
| `--sm-canvas` | `#FFFFFF` | design.md | Page/card surface |
| `--sm-surface-soft` | `#F1F4F7` | Meta soft cloud (≈ current popup `#f4f6f8`) | Thumbnail/secondary surfaces, rest states |
| `--sm-hairline` | `#C9D1D9` | derived | 1px input borders, form dividers |
| `--sm-hairline-soft` | `#E7EBEF` | derived | Card borders, section separators |
| `--sm-success` | `#1C7C3C` | Meta green, darkened for AA white-on-fill | Affirmations, success toasts/badges |
| `--sm-attention` | `#B45309` | amber, AA white-on-fill | Mid-priority alerts |
| `--sm-warning` | `#FFD43B` | Meta promo yellow (ink text on it) | Promotional/limited-time surfaces |
| `--sm-critical` | `#C62828` | red, AA white-on-fill | Errors, destructive feedback |
| `--sm-critical-strong` | `#9F1D1D` | darker step | Error input borders, inline error labels |
| `--sm-focus` | `#0866FF` | Facebook blue | Focus rings, activated form controls |

The ink ramp (`ink-deep → stone`) is a single blue-gray hue family anchored on the two literals design.md embeds, so every text tier harmonizes.

### 3.2 Typography

Open Sans carries every role. SuiteMate-owned surfaces adopt the full scale; **NetSuite-native text keeps its current sizes** (size changes on native elements shift layout — the Milestone-10 strut lesson) and gains only weight/color/letter-spacing adjustments where safe. design.md's scale is compressed for ERP density:

| Token | Size/weight | Spacing/height | design.md ancestor | Use |
|---|---|---|---|---|
| `--sm-type-title` | 18px / 600 | lh 1.3 | heading-sm 24/500 | Popup title, SuiteQL Studio header |
| `--sm-type-subtitle` | 14px / 700 | lh 1.4 | subtitle-lg 18/700 | Card headers, section labels |
| `--sm-type-body` | 13px / 400 | −0.1px, lh 1.5 | body-md 16/400/−0.16px | Primary text on SuiteMate surfaces |
| `--sm-type-body-bold` | 13px / 700 | −0.1px, lh 1.5 | body-md-bold | Emphasis, links |
| `--sm-type-button` | 13px / 600 | −0.1px, lh 1.4 | button-md 14/700 | Button labels (700 reads too heavy at 13px) |
| `--sm-type-caption` | 11px / 400 | lh 1.35 | caption 12/400 | Status lines, fine print |
| `--sm-type-caption-bold` | 11px / 700 | lh 1.35 | caption-bold | Badges, chips |

Implementation note: these ship as grouped custom properties (`--sm-type-body-size`, `--sm-type-body-weight`, …); no utility classes.

### 3.3 Spacing

design.md's 4px-base scale, adopted through 32px (marketing sizes 40–120px dropped): `--sm-space-1` 4px · `-2` 8px · `-3` 12px · `-4` 16px · `-5` 20px · `-6` 24px · `-7` 32px. The odd 10px step is dropped.

### 3.4 Radius

Existing `--suitemate-radius-*` names are retuned to design.md's scale (values change in component milestones, never in UI-0): control (inputs) 8px · compact (chips/small controls) 6px · surface (cards, field groups, machine containers) 16px → conservative fallback 12px if 16px reads oversized live · overlay (menus/popovers) 16px · dialog 24px · pill 100px. Buttons move to pill — this converges with NetSuite Redwood's own fully-rounded buttons, so it reads native, not foreign. `squareCorners`/`disable_radii` keeps zeroing everything, unchanged.

### 3.5 Elevation

| Level | Treatment | Use |
|---|---|---|
| 0 | no shadow; `1px solid --sm-hairline-soft` | Cards, field groups, summary boxes |
| 1 | `0 1px 1px rgba(0,0,0,0.2)` | Active tab/chip indicators |
| 2 | `0 1px 4px rgba(20,22,26,0.3)` | Floating menus, dialogs, toasts, sticky panels |

Flat-first: elevation signals "floating over the page", never decoration.

## 4. Conflict resolutions

1. **Cobalt vs role themes.** Role-color theming is functionality and wins: `--sm-primary` resolves through `--theme-main`; cobalt `#0064E0` becomes the new *default* main color (today `#607799`). This is the spec's **only JS-adjacent change**: the default-color constants in `src/shared/settings.js` (and the popup's "Default colors" action + affected unit-test expectations). Users with saved role colors see no accent change. Default secondary stays `#A2A4A8`.
2. **Optimistic VF.** Proprietary; Open Sans (bundled, humanist, already the extension's face) carries the scale. No new font bytes.
3. **Marketing vs ERP density.** Type and spacing compressed as tabled above; design.md's geometry (pills, hairlines, soft radii, flatness) transfers at full strength — that is where the look lives.
4. **design.md dark-mode gap.** Dark values alias the existing dark ramp per §3.

## 5. Architecture

- **UI-0** adds `src/styles/tokens.css`, loaded before `netsuite.css` in the manifest's global CSS bundle. `tests/verify.mjs` pins manifest arrays — its expected list is updated in the same commit. Adding the file must produce **zero visual change** (no consumers yet).
- Component milestones then edit rules **in place** in the files that already own each surface (`netsuite.css`, `v3-compat.css`, `radii.css`, `so-columns.css`, `notifications.css`, `csv-import.css`, `studio.css`, `popup.css`), replacing literals with `--sm-*` tokens as they go. No parallel override stylesheet.
- All work stays inside the existing gates: `html:not(.ext-f)` scoping, `isDarkMode` blocks, `disable_radii`. The V1 style-hash suite (`tests/verify.mjs` `expectedStyleHashes`) pins 15 files **including `netsuite.css` and `code.css`** — every milestone that edits a pinned file re-pins its sha256 in the same commit as part of the intentional-change review. (`v3-compat.css`, `radii.css`, `so-columns.css`, `notifications.css`, `popup.css` are not pinned.)
- CSS only, with the single §4.1 exception. No selector may target NetSuite elements with `position`/`display` overrides.

## 6. Milestones

Each milestone: implement → `npm test` (186) → screenshot diffs eyeballed and intentionally re-blessed → live verification in the tricksterbivek profile on production records → checkpoint commit + `save/CHECKPOINTS.md` entry → push.

| # | Scope | Key surfaces |
|---|---|---|
| UI-0 | Token foundation | `tokens.css`, manifest, verify.mjs — **pass condition: all 28 baselines at 0.000%** |
| UI-1 | Buttons & control bars + accent swap | `.uir-button`, `.uir-action-button`, control bars, Redwood `n-w-button`: pill radius, ink primary / hairline ghost hierarchy, `--sm-type-button`. The §4.1 default role-color swap to cobalt lands here (it is a visible change, so it cannot ride UI-0) |
| UI-2 | Summary/total boxes | Transaction totals region: level-0 card (hairline border, surface radius, type hierarchy) |
| UI-3 | Sublist tables + column menu | Header/striping/hover tokens; the personalization menu, banner, chips adopt `--sm-*` (visual-only; `so-columns` JS untouched) |
| UI-4 | Cards, field groups, portlets | Field groups, dashboard/setup portlets, record-status pill as level-0 cards |
| UI-5 | Dropdowns & menus | Native select `::picker`, page-title menus, CSV Utils dropdown, legacy `.ddm*` |
| UI-6 | Modals, dialogs & toasts | `.ui-dialog`, `nlpopup*`, alert boxes, toast cards → level-2 elevation, semantic colors |
| UI-7 | Popup | `popup.css` re-skinned on the token set (structure and behavior unchanged, light-only) |

Ordering rationale: buttons are the highest-frequency surface and set the geometric signature; totals and tables are the user's named priorities; the popup goes last because it's isolated and zero-risk to NetSuite familiarity. Every milestone leaves a coherent, shippable look — the sequence can pause indefinitely at any checkpoint.

## 7. Verification protocol

1. `npm test` green (186 tests) at every milestone; no JS test expectation may change except the declared settings-default expectations, which change in UI-1 only.
2. Screenshot baselines: UI-0 must diff at 0.000%; UI-1..7 diffs are reviewed image-by-image before re-blessing — a diff in a surface outside the milestone's scope is a defect, not a re-bless.
3. Live pass per milestone on production NetSuite (account 6998262): at minimum one classic transaction page; UI-3 additionally SO + PO + Item Fulfillment (both row families); each milestone checks light and dark, plus one non-default role color to prove theme routing.
4. Functional smoke on protected features every milestone (personalize/sort/filter/resize/hide cycle), since they share the restyled surfaces.
5. Zero console errors; view-mode only; no destructive actions against real saved layouts.

## 8. Risks

- **Dark-mode collision zone**: `netsuite.css` 6530–7400 consolidates dark overrides; every component milestone greps its selectors against that block before re-blessing.
- **`!important` cascade**: `v3-compat.css` is near-fully `!important`; token substitutions there keep the flag to preserve winning specificity.
- **Redwood duality**: legacy and `.isRedwood` branches both exist; Redwood baselines (`redwood-record`, `redwood-suiteql`) gate every milestone.
- **16px surface radius may read oversized** on dense ERP chrome — the conservative fallback (12px) is pre-approved by this spec, per the owner's "conservative wins" rule.
- **Pill buttons on classic pages** are the boldest single change; UI-1 is deliberately early so it gets the longest soak, and rollback is one checkpoint.

## 9. Rollback

Per-milestone: revert to the previous milestone's checkpoint commit. Full: `checkpoint-pre-ui-enhancement-2026-07-28` tag or release v3.18.1. User-level escape hatch at runtime: the "NetSuite styling" master toggle.
