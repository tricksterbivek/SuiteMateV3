# SuiteMate V3 Checkpoints

This file records verified development baselines. New feature work must not begin until the preceding checkpoint has passed automated tests, live NetSuite verification, pull request review and release publication.

## v3.14.0: CSV Export Baseline

Status: Automated verification complete; authenticated V3 retest required

Date: 2026-07-26

Pull request: <https://github.com/tricksterbivek/SuiteMateV3/pull/17>

Planned release: <https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.14.0>

### Included

- Integrates the external CSV Export proof of concept without replacing its `N/record` and `N/currentRecord` architecture.
- Adds one native `Export CSV` record-menu action through the shared route, command, settings and observer-lifecycle foundations.
- Preserves Custom Form field selection, display-text output and first-populated-sublist behavior.
- Falls back safely when a Custom Form is missing, a candidate sublist is unsupported or a field API is unavailable.
- Produces RFC 4180 CSV with CRLF rows, UTF-8 BOM, stable duplicate headers and spreadsheet-formula protection.
- Sanitizes download filenames and revokes temporary Blob URLs.
- Reports success and readable errors through text-only NetSuite-native notices.
- Keeps all record data inside the current NetSuite tab with no Chrome storage write or external request.
- Saves the proof-of-concept architecture, quality, performance, security and maintainability review at `save/CSV_EXPORT_BASELINE_REVIEW.md`.

### Verification

- Full `npm test` regression suite with 150 passing tests.
- All 26 screenshot baselines reproduced at 0.000 percent difference.
- Protected 15-file SuiteMate V1 styling hash suite unchanged.
- Focused route, command, request-envelope, CSV encoding, formula protection, missing-Custom-Form, unsupported-sublist, download and error tests.
- `git diff --check`.
- `npm audit --omit=dev` with zero vulnerabilities.
- The submitted Sales Order, Item Receipt and Purchase Order CSVs were structurally valid, but byte-level inspection proved they came from the separately installed proof-of-concept exporter rather than SuiteMate V3.
- Chrome inspection confirmed both exporters were active on the same Purchase Order page. The SuiteMate V3 action had `data-suitemate-v3-action="csv-export"` while the proof-of-concept action had `id="export_csv_file"`.
- Authenticated SuiteMate V3 export verification therefore remains open and must be repeated with the proof-of-concept extension disabled.

### Restore

```bash
git switch --detach v3.14.0
```

To resume normal development after inspecting the checkpoint:

```bash
git switch main
```

### Next feature

Disable the separate proof-of-concept exporter, reload SuiteMate V3, repeat one authenticated export through the sole remaining action and verify the downloaded file signature before starting any improvement work.

## v3.13.0: Internal IDs Toolkit

Status: Verified

Date: 2026-07-26

Pull request: <https://github.com/tricksterbivek/SuiteMateV3/pull/16>

Planned release: <https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.13.0>

### Included

- Adds an independent `Show Internal IDs` checkbox to the SuiteMate popup, disabled by default.
- Recreates V1 identifier extraction for record types, body fields, tabs, subtabs, sublists, sublist columns, buttons, list headers and customization-grid script IDs.
- Applies the preference immediately without a page reload and removes only SuiteMate-owned badges when disabled.
- Uses the shared route registry and observer lifecycle across trusted top-level NetSuite pages and same-account frames.
- Keeps Internal IDs independent of the global NetSuite styling toggle.
- Adds a bounded typed record-type fallback without exposing record field values.
- Migrates existing settings to schema 2 and preserves import compatibility with canonical schema 1 SuiteMate V3 backups.
- Adds no keyboard shortcut, browser permission, host access, external request or arbitrary HTML rendering.

### Verification

- Full `npm test` regression suite with 142 passing tests.
- All 26 screenshot baselines reproduced at 0.000 percent difference.
- Protected 15-file SuiteMate V1 styling hash suite unchanged.
- Focused identifier parsing, hostile-input, lifecycle, live setting, route authority, settings migration and backup compatibility tests.
- `git diff --check`.
- `npm audit --omit=dev` with zero vulnerabilities.
- User-confirmed live Chrome smoke test passed after reloading the extension.

### Restore

```bash
git switch --detach v3.13.0
```

To resume normal development after inspecting the checkpoint:

```bash
git switch main
```

### Next feature

Integrate the reviewed CSV Export proof of concept as a working SuiteMate V3 baseline before any major redesign.

## v3.12.0: Settings Backup and Restore

Status: Verified

Date: 2026-07-22

Pull request: <https://github.com/tricksterbivek/SuiteMateV3/pull/15>

Planned release: <https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.12.0>

### Included

- Recreates V1's encoded text export and paste-to-import workflow in the existing SuiteMate V3 popup.
- Adds a versioned `suitemate-v3-settings` backup envelope with an explicit backup format version, settings schema version and export timestamp.
- Uses UTF-8-safe Base64 so Unicode role names survive export and import. The encoded text is transport data, not encryption.
- Copies exports through the shared direct-user-gesture clipboard adapter without adding a clipboard permission.
- Validates the prefix, Base64, UTF-8, JSON, envelope, timestamp, settings version, canonical settings structure and Chrome sync quota before showing the overwrite confirmation.
- Rejects malformed, foreign, non-canonical, oversized and future-version backups without modifying stored settings.
- Requires explicit confirmation before replacing all settings and reports the number of role themes included.
- Serializes imports through the existing settings write queue, blocks concurrent popup edits during the overwrite and restores the prior in-memory state if Chrome rejects the write.
- Keeps the backup text available after a failed import for correction or retry, and clears it only after a successful import.
- Adds no browser permission, host access, network request, remote dependency or permanent query/history storage.

### Verification

- Full `npm test` regression suite with 133 passing tests.
- All 26 screenshot baselines reproduced at 0.000 percent difference.
- Protected 15-file SuiteMate V1 styling hash suite unchanged.
- Focused export, Unicode round-trip, validation, cancellation, atomic overwrite, storage rollback and hostile-input tests.
- Local 400 by 900 popup render confirmed the collapsed Backup and restore control fits the existing popup layout.
- `git diff --check`.
- `npm audit --omit=dev` with zero vulnerabilities.
- Authenticated NetSuite SB1 dashboard check after full load plus ten seconds confirmed the `dashboard` route, Light mode, the active custom Main theme token and no unexpected SuiteQL Console mount.
- Authenticated dashboard browser logs contained no warnings or errors after the extension reload.
- User-confirmed installed popup verification passed: Backup and restore expanded, Export settings produced and copied the encoded backup, a setting was changed, Import settings was approved and the original setting and active NetSuite theme were restored without a page reload.
- Cancelled overwrite, malformed backup, future version, oversized backup and rejected Chrome storage write paths remain covered by focused automated tests.

### Restore

```bash
git switch --detach v3.12.0
```

To resume normal development after inspecting the checkpoint:

```bash
git switch main
```

### Next feature

`GEN-17`: Internal IDs toolkit is the next recommendation, but it must not begin until this pull request is merged and `v3.12.0` is published.

## v3.11.0: Regression Fixtures

Status: Verified

Date: 2026-07-22

Pull request: <https://github.com/tricksterbivek/SuiteMateV3/pull/14>

Planned release: <https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.11.0>

### Included

- Adds one versioned fixture catalog with a primary Classic baseline for every classified NetSuite route except the intentionally unsupported `unknown` route.
- Adds Classic variants for Customer Center login, Field Help and Map/Reduce status.
- Retains the existing Redwood record and SuiteQL Console visual contracts without expanding Redwood ahead of Classic.
- Adds a local headless Chrome capture harness with deterministic 1440 by 1000 screenshots and a one-percent visual-difference release gate.
- Verifies route classification, required and forbidden DOM selectors, every page-specific manifest stylesheet, local-only resources and screenshot dimensions.
- Prevents SuiteQL Console from mounting on all non-SuiteQL route fixtures.
- Corrects the focused Saved Search results fixture to use the actual `searchresults.nl` route.
- Restores the FND-08 browser utility load order in the Classic, Redwood and normal Global Search SuiteQL fixtures.
- Adds no user-facing feature, browser permission, host access, remote dependency or external request.

### Verification

- Full `npm test` regression suite with 122 passing tests.
- All 26 screenshot baselines reproduced at 0.000 percent difference.
- Protected 15-file SuiteMate V1 styling hash suite unchanged.
- `git diff --check`.
- `npm audit --omit=dev` with zero vulnerabilities.
- Authenticated NetSuite SB2 checks after allowing each page to load completely plus ten seconds.
- Confirmed the dashboard initialized the `dashboard` route, lifecycle generation 4 and active Main and Secondary theme tokens without mounting SuiteQL Console.
- Confirmed normal Global Search initialized the `global-search-results` route, retained its native results body and did not mount SuiteQL Console.
- Confirmed a blank Sales Order initialized the general NetSuite record route and retained exactly one visible CSV Import action targeting `recordsubtype=salesorder` immediately after Actions.
- Confirmed SuiteQL Console mounted exactly once, returned ten transaction rows with the expected `id` and `tranid` columns in 773 ms and produced no browser warnings or errors.
- Confirmed CSV export reported `Exported 10 loaded rows.` with the loaded result set unchanged.
- Confirmed SuiteQL Console, Global Search and Sales Order browser logs were clean. Dashboard errors were isolated to an account-owned Suitelet iframe at `script=29`, with no SuiteMate or extension source involved.

### Restore

```bash
git switch --detach v3.11.0
```

To resume normal development after inspecting the checkpoint:

```bash
git switch main
```

### Next feature

`SET-14`: Settings export and import

## v3.10.0: Shared Utilities

Status: Verified

Date: 2026-07-21

Pull request: <https://github.com/tricksterbivek/SuiteMateV3/pull/13>

Planned release: <https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.10.0>

### Included

- Adds one versioned, side-effect-free utility core for deep freezing SuiteMate-owned structures, color normalization, UTF-8 sizing, bounded error normalization, formula-safe CSV, filename safety and bounded JSON formatting.
- Adds capability-injected browser adapters for direct clipboard writes, local Blob downloads, extension-owned notices, modal lifecycle and text-only XML formatting.
- Keeps the pure core safe in content scripts, popup and the extension service worker without requiring DOM, Chrome or network globals at module initialization.
- Starts clipboard writes in the originating UI gesture, reports typed failures and adds no clipboard permission or deprecated DOM fallback.
- Removes temporary download anchors, revokes every Blob URL and adds no Chrome downloads permission.
- Preserves prior inert and `aria-hidden` state, focus ownership and command-owned Escape behavior for the unified color picker.
- Migrates commands, permissions, settings, the typed bridge, Material palette, SuiteQL CSV, SuiteQL downloads, Console notices and popup status to shared primitives or adapters.
- Leaves NetSuite-owned alerts, route policy, domain error contracts and the serialized main-world data adapter independent.
- Adds no dependent user-facing feature, host access, remote dependency or external request.

### Verification

- Full `npm test` regression suite with 118 passing tests.
- Focused hostile-input, cross-context, CSV, clipboard, download, notice, modal, JSON and XML utility coverage.
- Existing typed bridge, data adapter, lifecycle, settings, permission broker, command framework, role theme, CSV Import and SuiteQL behavior checks.
- Protected 15-file SuiteMate V1 styling hash suite unchanged.
- `git diff --check`.
- `npm audit --omit=dev` with zero vulnerabilities.
- Independent architecture review passed with no release blocker.
- Authenticated NetSuite Sandbox checks after allowing each page to load completely plus ten seconds.
- Confirmed the dashboard initialized the `dashboard` route once, retained the shared lifecycle state, did not mount SuiteQL Console and produced no browser warnings or errors.
- Confirmed SuiteQL Console executed the restored Customer query, returned one row with the expected three columns in 368 ms and produced no browser warnings or errors.
- Confirmed CSV export reported `Exported 1 loaded rows.` without requiring an added Chrome permission. Chrome automation did not expose the resulting download event, so file-level behavior remains covered by the dedicated adapter tests.
- Confirmed a Customer record retained exactly one visible contextual CSV Import action immediately after the Actions area, targeting the native Import Assistant with `recordsubtype=customer`.
- Chrome does not expose extension toolbar popups to this automation session. Popup notice and modal behavior therefore remain verified by dedicated DOM lifecycle tests rather than mislabeled as a live toolbar-popup assertion.

### Restore

```bash
git switch --detach v3.10.0
```

To resume normal development after inspecting the checkpoint:

```bash
git switch main
```

### Next feature

`FND-09`: Regression Fixtures

## v3.9.0: Optional Permission Broker

Status: Verified

Date: 2026-07-21

Pull request: <https://github.com/tricksterbivek/SuiteMateV3/pull/12>

Release: <https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.9.0>

### Included

- Adds one immutable and versioned optional permission registry for bookmarks, context menus, history and Side Panel capabilities.
- Records plain-language explanations and every known dependent V1 feature against the exact Chrome permission ID.
- Adds permission discovery, live state checks, direct user-gesture requests, revocation, filtered snapshots, subscriptions and deterministic disposal.
- Rejects arbitrary permissions, origins, URL parameters and overlapping mutations before privileged Chrome calls can occur.
- Keeps Chrome as the only permission-state authority and writes no permission state to SuiteMate settings.
- Handles both permission addition and revocation events, isolates failing subscribers and removes listeners after the final subscriber or broker disposal.
- Invalidates late successes and failures after disposal and never claims a pending Chrome permission prompt can be canceled.
- Loads the broker only in extension-owned popup and service-worker contexts, not inside NetSuite pages.
- Leaves dormant permissions out of the manifest until the first user-facing consumer ships, complying with Chrome Web Store minimum-permission policy.
- Does not migrate bookmarks, context menus, history, Side Panel, saved queries or any other dependent feature.

### Verification

- Full `npm test` regression suite with 104 passing tests.
- Focused broker coverage for immutable definitions, unknown IDs, user-gesture timing, grant and denial outcomes, removal, Chrome failures, unavailable APIs, snapshots, events, listener cleanup, mutation races and stale disposal results.
- Manifest checks proving dormant optional permissions are absent and the broker is not injected into NetSuite content scripts.
- Existing typed bridge, data adapter, lifecycle, versioned settings, protected V1 styling, role-theme, CSV Import and SuiteQL Console checks.
- `git diff --check`.
- `npm audit --omit=dev` with zero vulnerabilities.
- Independent V1, architecture, security and regression reviews with identified blockers corrected before release.
- Authenticated NetSuite Sandbox checks after allowing each page to load completely plus ten seconds.
- Confirmed the dashboard retained active SuiteMate theming, route metadata, lifecycle state and clean browser logs.
- Confirmed SuiteQL Console returned one row through bridge and adapter version 1 in 268 ms with no permission prompt or browser error.
- Confirmed a Customer record retained exactly one contextual CSV Import action with the native `customer` Import Assistant URL.

### Restore

```bash
git switch --detach v3.9.0
```

To resume normal development after inspecting the checkpoint:

```bash
git switch main
```

### Next feature

`FND-08`: Shared Utilities

## v3.8.0: Shared Command Framework

Status: Verified

Date: 2026-07-20

Pull request: <https://github.com/tricksterbivek/SuiteMateV3/pull/11>

Release: <https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.8.0>

### Included

- Adds one immutable and versioned UI command registry for popup, record and SuiteQL Console surfaces.
- Defines stable command IDs, labels, descriptions, route capabilities, settings requirements, link metadata and platform-aware keyboard shortcuts in one source of truth.
- Adds per-surface command scopes with registration, availability, invocation, re-entry, running state, normalized results, failure isolation, subscriptions, shortcut ownership and deterministic disposal.
- Keeps the UI command registry separate from the privileged FND-04 NetSuite bridge registry.
- Migrates popup appearance actions, contextual CSV Import activation and SuiteQL Console controls to shared command scopes.
- Preserves native CSV Import links, SuiteSense and Records Catalog links, CodeMirror editing, progressive paging, loaded-row export and per-tab drafts.
- Fixes stale popup settings writes so rapid color and appearance actions compose without restoring old values.
- Fixes Abort and immediate restart, aborted progressive page loading, BFCache request disposal, stale handler replacement, disposed-scope shortcut binding, async availability and handler-owned return-value races.

### Verification

- Full `npm test` regression suite with 87 passing tests.
- Focused registry coverage for command identity, shortcut parsing, platform mapping, collision detection, route and settings authority, re-entry, disposal, stale completion, handler replacement, subscriber re-entry, async availability and hostile return values.
- Real-module harnesses proving one SuiteQL shortcut produces one request, Abort permits immediate restart, late results are discarded, aborted page requests do not lock later paging and rapid popup settings actions preserve every update.
- Existing typed bridge, data adapter, lifecycle, versioned settings, protected V1 styling, role-theme, CSV Import and SuiteQL Console checks.
- `git diff --check`.
- `npm audit --omit=dev` with zero vulnerabilities.
- Independent security and regression reviews with no checkpoint blockers.
- Authenticated NetSuite Sandbox checks after allowing every page to load completely plus ten seconds.
- Confirmed one contextual CSV Import action immediately after Actions with command metadata and a native Sales Order Import Assistant URL.
- Confirmed Import Assistant applied `TRANSACTION`, `SALESORDER` and `UTF-8`.
- Confirmed readable SuiteQL errors, button and Command+E execution, sorting, execution timing, export confirmation, Paged toggle, progressive 1,000-row loading and distinct loaded and total counts.
- Confirmed Abort released the UI during a page request and allowed an immediate five-row query while the abandoned request could still finish.
- Confirmed refresh and browser history navigation restored the SuiteQL draft and Paged setting without duplicating the Console.
- Confirmed normal Global Search remained native and did not mount SuiteQL Console.
- Confirmed browser logs contained no extension errors.

### Restore

```bash
git switch --detach v3.8.0
```

To resume normal development after inspecting the checkpoint:

```bash
git switch main
```

### Next feature

`FND-07`: Optional Permission Broker

## v3.7.0: General Query and Fetch Adapter

Status: Verified

Date: 2026-07-20

Pull request: <https://github.com/tricksterbivek/SuiteMateV3/pull/10>

Release: <https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.7.0>

### Included

- Adds one closed NetSuite data adapter behind the FND-04 typed bridge.
- Registers fixed operations for SuiteQL, constrained Saved Search execution, bounded record metadata, record type lookup and Import Assistant category detection.
- Prevents content scripts from supplying arbitrary URLs, HTTP methods, headers, RPC methods, AMD modules or request bodies.
- Enforces exact document, top-frame, account, route, redirect, response-size, operation-time and cancellation boundaries.
- Blocks cross-account and login responses and reports transport, redirect and NetSuite failures through typed errors.
- Preserves cancellation tombstones so cancel-before-start requests cannot be resurrected.
- Migrates Import Assistant category detection to the adapter while preserving the existing atomic context writes.
- Reduces the background service worker to a typed command router.

### Verification

- Full `npm test` regression suite with 63 passing tests.
- Focused adapter coverage for every operation, malformed successes, response bounds, stale documents, cross-account responses, login redirects, browser-blocked redirects, cancellation races and transport failures.
- Full service-worker integration coverage for SuiteQL paging and errors, constrained search, record metadata, Import Assistant category lookup and exact document targeting.
- Protected 15-file V1 styling hash suite.
- `git diff --check`.
- `npm audit --omit=dev` with zero vulnerabilities.
- Independent final regression review with no release blockers.
- Authenticated NetSuite Sandbox checks after allowing each page to load completely plus ten seconds.
- Confirmed Purchase Order opened Import Assistant with `TRANSACTION`, `PURCHASEORDER` and `UTF-8` through the adapter.
- Confirmed SuiteQL Console returned unpaged and paged results, surfaced a readable NetSuite error and discarded results after Abort.
- Confirmed normal Global Search and Saved Search remained native and did not mount SuiteQL Console.
- Confirmed browser logs contained no extension errors.

### Restore

```bash
git switch --detach v3.7.0
```

To resume normal development after inspecting the checkpoint:

```bash
git switch main
```

### Next feature

`FND-06`: Shared Command Framework

## v3.6.0: General Typed NetSuite Bridge

Status: Verified

Date: 2026-07-20

Pull request: <https://github.com/tricksterbivek/SuiteMateV3/pull/9>

Release: <https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.6.0>

### Included

- Adds one versioned and allowlisted runtime protocol for privileged NetSuite operations.
- Defines exact request and response schemas, bounded payloads, response identity checks and typed errors for every command.
- Enforces command-specific route, account host and top-frame authority through the shared route registry.
- Targets the originating Chrome document for main-world execution when available and verifies the exact source URL as a fallback.
- Provides client and server timeouts, AbortSignal propagation, generic cancellation and duplicate in-flight request protection.
- Migrates SuiteQL execution, record type lookup and Import Assistant context updates from separate message contracts.
- Prevents partial Import Assistant writes by validating every requested field before applying any value.
- Fixes SuiteQL Console initialization so URL query parsing has no dependency on an undeclared page global.
- Exposes protocol diagnostics through `data-suitemate-v3-bridge`.

### Verification

- Full `npm test` regression suite with 51 passing tests.
- Focused bridge coverage for schema validation, route authority, response identity, runtime failures, client and server timeouts, cancellation, duplicate requests, stale-document blocking and malformed handler output.
- Service-worker integration coverage for SuiteQL paging, disposal, cancellation, readable NetSuite errors, document-targeted execution and Import Assistant partial-write prevention.
- Existing route, lifecycle, versioned settings, protected V1 styling, role-theme, CSV Import and SuiteQL Console checks.
- `git diff --check`.
- `npm audit --omit=dev` with zero vulnerabilities.
- Authenticated NetSuite Sandbox checks after reloading the extension and allowing each page to complete its render cycle plus ten seconds.
- Confirmed Purchase Order retained one CSV Import action immediately after Actions.
- Confirmed SuiteQL Console rendered one editor, returned results through unpaged and paged execution, surfaced a readable NetSuite schema error and released the UI after Abort.
- Confirmed Import Assistant applied `TRANSACTION`, `PURCHASEORDER` and `UTF-8`.
- Confirmed normal Global Search and Saved Search results did not mount SuiteQL Console.

### Restore

```bash
git switch --detach v3.6.0
```

To resume normal development after inspecting the checkpoint:

```bash
git switch main
```

### Next feature

`FND-05`: General Query and Fetch Adapter

## v3.5.0: Observer Lifecycle

Status: Verified

Date: 2026-07-19

Pull request: <https://github.com/tricksterbivek/SuiteMateV3/pull/8>

Release: <https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.5.0>

### Included

- Adds one per-document lifecycle registry backed by a shared native `MutationObserver`.
- Supports stable registration IDs, explicit replacement, immediate evaluation, batched mutations, one-shot and continuous modes.
- Gates consumers through the route capability registry and refreshes them across route, history and BFCache transitions.
- Provides bounded DOM waits, abort signals, stale-generation guards, pause, resume, disposal and deterministic cleanup.
- Migrates theme route metadata, Classic and Redwood detection, CSV Import toolbar placement and Import Assistant context sourcing.
- Adds live diagnostics through `data-suitemate-v3-lifecycle` and `data-suitemate-v3-observer`.

### Verification

- Full `npm test` regression suite with 37 passing tests.
- Focused lifecycle coverage for singleton behavior, shared observation, batching, replacement, cleanup, timeout, abort, route changes, stale asynchronous work and BFCache.
- Existing route, versioned settings, protected V1 styling, role-theme, CSV Import and SuiteQL Console checks.
- `git diff --check`.
- Authenticated NetSuite checks after reloading the extension and allowing the Sandbox render cycle to settle.
- Confirmed SuiteQL Console rendered once and did not leak onto Global Search.
- Confirmed Purchase Order rendered one CSV Import action immediately after Actions.
- Confirmed Import Assistant applied the requested `PURCHASEORDER` subtype after NetSuite completed native category sourcing.
- Confirmed normal Global Search and Saved Search results remained native and themed.

### Restore

```bash
git switch --detach v3.5.0
```

To resume normal development after inspecting the checkpoint:

```bash
git switch main
```

### Next feature

`FND-04`: General Typed NetSuite Bridge

## v3.4.0: Route Capability Registry

Status: Verified

Date: 2026-07-19

Pull request: <https://github.com/tricksterbivek/SuiteMateV3/pull/7>

Release: <https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.4.0>

### Included

- Adds one immutable registry for NetSuite host, route, frame and capability decisions.
- Migrates theme, notification, CSV Import, Import Assistant, SuiteQL Console, popup and service worker route checks to the shared policy.
- Restricts privileged bridges to allowed account hosts, exact routes and top-frame senders.
- Excludes known non-record tools and result routes from the CSV Import toolbar while preserving standard, custom and uncommon record-page support.
- Adds document route metadata for live diagnostics.
- Keeps observer registration and lifecycle behavior unchanged for the separate `FND-02` checkpoint.

### Verification

- Full `npm test` regression suite.
- Twelve focused route, host, environment, frame, capability and sender tests.
- Twenty-three focused route and settings tests passed in total.
- Existing V1 styling hash, role-theme, CSV Import and SuiteQL Console checks.
- Authenticated NetSuite checks after reloading the extension.
- Confirmed correct isolation on Import Assistant, SuiteQL Console, Purchase Order, Global Search and Saved Search results.
- Confirmed Import Assistant does not advertise or render the CSV Import toolbar capability.

### Restore

```bash
git switch --detach v3.4.0
```

To resume normal development after inspecting the checkpoint:

```bash
git switch main
```

### Next feature

`FND-02`: Observer Lifecycle

## v3.3.0: Versioned Settings Schema

Status: Verified

Date: 2026-07-19

Pull request: <https://github.com/tricksterbivek/SuiteMateV3/pull/6>

Release: <https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.3.0>

### Included

- Adds schema version 1 without changing the existing flat settings contract or storage key.
- Migrates legacy appearance and role-theme settings once through the popup.
- Prevents older SuiteMate releases from overwriting settings created by a newer schema.
- Reports invalid and unsupported versions through typed errors.
- Rejects oversized settings before Chrome sync returns an opaque quota failure.
- Keeps theme, CSV Import and Import Assistant runtimes safe when settings cannot be loaded.

### Verification

- Full `npm test` regression suite.
- Eleven focused settings migration, compatibility, quota and storage-failure tests.
- Existing V1 styling hash, role-theme, CSV Import and SuiteQL Console checks.
- Authenticated NetSuite Purchase Order smoke test after reloading the extension.
- Confirmed SuiteMate loaded existing settings with no fallback or unsupported marker.
- Confirmed the contextual CSV Import action remained visible and styled after Actions.

### Restore

```bash
git switch --detach v3.3.0
```

To resume normal development after inspecting the checkpoint:

```bash
git switch main
```

### Next feature

`FND-01`: Route Capability Registry

## v3.2.0: Contextual CSV Import

Status: Verified

Date: 2026-07-19

Pull request: <https://github.com/tricksterbivek/SuiteMateV3/pull/5>

Release: <https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.2.0>

### Included

- Adds CSV Import as a visible record toolbar action immediately after Actions.
- Carries the originating record type into NetSuite Import Assistant.
- Preselects supported Import Assistant category and subtype fields.
- Restores click-to-close behavior for NetSuite warning and success notifications.
- Preserves the existing SuiteMate theme and global radius behavior.

### Verification

- Full `npm test` regression suite.
- Authenticated NetSuite Purchase Order smoke test.
- Confirmed CSV Import placement immediately after Actions.
- Confirmed `recordsubtype=purchaseorder` context propagation.
- Confirmed themed styling and 4px radius.

### Restore

```bash
git switch --detach v3.2.0
```

To resume normal development after inspecting the checkpoint:

```bash
git switch main
```

### Next feature

`FND-03`: Versioned Settings Schema

## Transaction Column Personalization: Milestone 1 (Sales Order baseline)

Status: Complete; superseded by Milestone 3 live verification

Date: 2026-07-27

Commit: d2f7c1a (`feat: Sales Order item column personalization (stable baseline)`)

### Included

- Per-user drag-and-drop column reordering for the Sales Order item sublist in view mode only, behind the default-off `salesOrderColumns` setting (schema v3 migration).
- Label-based column identity with graceful fallback; native order capture and one-click Reset.
- `chrome.storage.sync` storage under `suiteMateV3ColumnOrder`, account+user scoped, quota-guarded, newer-schema write protection.
- Fail-closed guards at every layer: route capability, DOM detection, try/catch on all entry points.

### Verification

- Full `npm test` suite: 171 passing tests, 28 screenshot baselines at 0.000 percent difference.
- Browser functional pass (served fixture, real Chrome): personalize mode, drag indicators, header+row reorder, persistence, reset, live setting toggle on/off.

## Transaction Column Personalization: Milestone 2 (generalized engine)

Status: Complete; superseded by Milestone 3 live verification

Date: 2026-07-27

### Included

- Capability generalized to `transaction-column-personalization`: any top-frame `/app/accounting/transactions/*.nl` view-mode page (`id` param, no `e` param); the item-sublist DOM guard remains the runtime detector, so no per-type duplication.
- Storage scope extended to `company:user:recordType` — separate saved order per transaction type.
- Route-change robustness: pristine-order capture keyed to the table node, scope recomputed per evaluation.
- Popup label generalized to "Enable Transaction Column Personalization" (setting key unchanged).

### Verification

- Full `npm test` suite green; route tests cover salesord, custinvc, purchord, estimate, itemship positive cases and edit-mode/list/entity negatives.
- Browser pass across simulated salesord, custinvc and purchord routes: per-type drag, isolated per-type persistence, edit-mode and entity-page fail-closed, saved order re-applied on return.
- Performance: 500 rows x 20 columns full reversal in ~24ms.

## Transaction Column Personalization: Milestone 3 (live NetSuite hardening)

Status: Live NetSuite verification complete

Date: 2026-07-28

### Included

- Fixes the native-order capture defect found during live production testing: real record pages mutate during load, so deriving the pristine order from the current DOM could capture an already-personalized arrangement, breaking Reset. Header cells are now stamped with their original index (`data-suitemate-v3-native-index`) on first touch and the native order is always reconstructed from the stamps, never from the current visual order. An unstamped table is by definition pristine, so the capture is deterministic across watcher re-evaluations and node clones.
- Runtime simplification: per-evaluation scope resolution retained; table-identity cache removed in favor of stamps.

### Verification

- Full `npm test` suite: 172 passing tests (new stamp-survival unit test), 28 screenshot baselines at 0.000 percent difference.
- Live production pass (account 6998262, 45-column Sales Order, real pointer drags via Playwright bridge): native load, drag, persistence across reload, Reset restoring the exact stamped native order, native retained after final reload, zero console errors.
- Storage forensics (Sync Extension Settings LevelDB) confirmed per-user, per-type scope keys (`company:user:recordType`) in production and correct entry deletion on Reset; pre-existing user personalizations preserved.

## Transaction Column Personalization: Milestone 4 (column sorting)

Status: Complete; live NetSuite verification passed 2026-07-28

Date: 2026-07-28

### Included

- Click-to-sort on transaction item sublist headers: ascending, descending, third click restores the native line order (rows are stamped with their original index on first sort, mirroring the column-stamp pattern).
- Visual ↑/↓ indicator span (owned, label-stripped, travels with the column when dragged).
- Type-aware comparison: currency/number (strips $ , %), day-first dates, case-insensitive text; column kind detected by majority; empty and non-conforming cells always sort last; equal keys keep native relative order.
- Client-side only by design: NetSuite has no native sorting on view-mode machine tables; session-only (nothing persisted), fail-closed — non-contiguous data rows (expansion sub-rows) refuse to sort rather than orphan children.
- Composes with personalization: sort clicks suppressed in personalize mode, sort survives column drags, Reset clears sort and restores native rows.

### Verification

- Full `npm test`: 175 passing tests (sort engine unit coverage: kinds, currency, dates, empties, stability, contiguity fail-closed), 28 screenshot baselines at 0.000 percent difference.
- Browser pass (served fixture, real clicks/drags via Playwright): asc/desc/native cycle with indicators, numeric ordering ($240 after $36), empty-last, indicator traveling with dragged column, sort retained across column reorder, Reset full restore.

## Transaction Column Personalization: Milestone 5 (column filtering)

Status: Complete; live NetSuite verification passed 2026-07-28

Date: 2026-07-28

### Included

- Filter button in the controls strip toggles an owned filter row under the header: one search input per column, native `datalist` suggestions when a column has 20 or fewer distinct values (Excel-style dropdown via platform feature, zero dependencies).
- Case-insensitive contains matching for text; `>` `<` `>=` `<=` `=` prefixes for numeric/currency comparison; filters AND-combine across columns; display-only (a hide class — no NetSuite data touched), session-only.
- Composes with everything: the filter row's cells reorder in lockstep with column drags (inputs travel), sorting operates on filtered tables, Filter toggle-off and Reset unhide all rows, feature toggle-off removes every trace.

### Verification

- Full `npm test`: 178 passing tests (query parsing, operator matching, AND-combining, distinct-value cap, fail-closed), 28 screenshot baselines at 0.000 percent difference.
- Browser pass (served fixture, real typing/clicks/drags): text filter, combined text+numeric filter, sort-while-filtered, filter inputs traveling with a column drag, toggle-off restore, full Reset.

### Milestone 4 + 5 live verification (2026-07-28)

- Production account 6998262, real pointer interaction via Playwright bridge.
- Sales Order (45 columns): sort asc/desc/native on Amount including a negative value (-8.54) ordered correctly; indicators shown and cleared; filter row rendered 45 inputs with 30 datalist dropdowns; text filter and combined text + `>1` numeric filter correct; Reset restored columns, rows, filters and indicators; native item links intact.
- Purchase Orders via generic transaction.nl dispatcher links: controls active across types; zero-item expense POs fail closed gracefully.
- Scale check on real 44-column PO DOM cloned to 300 rows: first sort ~0.9s wall-clock (includes one-time row stamping and automation round-trip), subsequent sorts ~0.36s, live filter ~0.14s, correct visible counts; page reload discarded all test rows.
- Zero JavaScript errors across the session.

## Transaction Column Personalization: Milestone 6 (multi-select column filters)

Status: Complete; live NetSuite verification passed 2026-07-28

Date: 2026-07-28

### Included

- Excel-style multi-select per column: a ▾ toggle beside each filter input opens a checkbox panel of distinct column values (up to 50, scrollable, system-color themed); checked values OR-combine within the column and AND-combine with the column's text/numeric query and with other columns' filters.
- Filter query object gains an optional `anyOf` value list; single-value filtering behavior unchanged.
- Selection state lives in a WeakMap keyed by the filter cell, so selections travel automatically when columns are dragged; active selections highlight the toggle; outside click closes the panel; per-column Clear button; Reset/toggle-off remove everything.

### Verification

- Full `npm test`: 180 passing tests (anyOf matching, OR-within/AND-across combinations), 28 screenshot baselines at 0.000 percent difference.
- Browser pass (served fixture, real checkbox clicks/typing/drags): Sydney+Melbourne OR example, combined text + multi-select, sort on multi-filtered rows, selections surviving a column drag, Clear, outside-click close, full Reset.

### Milestone 6 live verification (2026-07-28)

- Production Sales Order (45 columns, 45 filter toggles rendered): Item panel listed the real distinct values; selecting two SKUs showed exactly those rows (OR within column); Quantity `>0` text query AND-combined; Amount sort ran on the filtered set with its indicator; selections survived a personalize-mode round trip with the toggle still highlighted; Reset restored all rows, native columns, and removed the filter row and indicator.
- Real low-cardinality columns confirmed present for the Excel-style use case (e.g. Product Category: Lips/Face).
- Zero JavaScript errors.

## Transaction Column Personalization: Milestone 7 (Excel-style column menu)

Status: Automated + browser verification complete; live NetSuite retest pending

Date: 2026-07-28

### Included

- Sorting and filtering unified into one Excel-style menu per column: a ▼ arrow on every header opens Sort A to Z / Sort Z to A (plus Clear Sort when that column is sorted), a search box, the distinct-value checkbox list (up to 200, scrollable), Select All (applies to searched subset) and Clear Filter.
- Excel search semantics: plain text narrows the value list; operator prefixes (> < >= <= =) apply live as a row condition; on columns with too many distinct values for a list, plain text falls back to a live contains row-filter — no capability lost from the previous UI.
- Removed the separate Filter button, filter row and header click-to-sort; controls strip is back to Personalize/Done/Reset. Filter state is WeakMap-keyed to header cells so it travels with column drags; active columns highlight their arrow; sort indicator sits beside the arrow.
- Zero core-engine changes — the redesign reuses sortRows/applyFilters/matchesFilter/distinctColumnValues untouched, all vanilla (React evaluated and rejected: it would mount into NetSuite-owned cells, add a dependency and build step for ~150 lines of owned-DOM popover).

### Verification

- Full `npm test`: 180 passing tests unchanged, 28 screenshot baselines at 0.000 percent difference.
- Browser pass (served fixture, real clicks/typing/drags): menu structure, sort via menu with indicator and auto-close, contextual Clear Sort, multi-select OR, search narrowing, operator filter AND-combining across columns, filters surviving column drag, outside-click close, full Reset; old filter UI absent.

## Transaction Column Personalization: Milestone 8 (column menu visual polish)

Status: Complete; live NetSuite verification passed 2026-07-28

Date: 2026-07-28

### Included

- Column menu rebuilt on the SuiteMate design system (toast family): solid overlay surface with `--suitemate-radius-overlay`, theme-main accent edge, 0 8px 24px shadow, 13px `--normal-font`, 0.16s ease-out entry (reduced-motion respected), explicit `html.isDarkMode` overrides using the dark tokens.
- Structure: SORT / FILTER eyebrow sections, glyphed sort items with an active-direction check state, focus-visible rings on every control, theme-colored checkboxes via native accent-color, ellipsized long values with full-text tooltips, thin scrollbars with overscroll containment.
- Feedback: live "n of m items" status in the footer, sentence-case action copy (Select all, Clear filter, Clear sort), operator hint under the search box, empty-state note for high-cardinality columns.
- Root-cause fix uncovered by visual verification: the menu previously rendered inside the machine table's paint order with a failing background (transparent surface, rows painting over it) and was clippable by the scroll container. The menu is now appended to document.body with fixed positioning, viewport-clamped coordinates, and closes on scroll and Escape.

### Verification

- Full `npm test`: 180 passing tests, 28 screenshot baselines at 0.000 percent difference.
- Browser pass with screenshot review: solid surface confirmed visually, multi-select with live status, sort with indicators, Escape close, Reset; existing personalization unaffected.

### Milestone 8 live verification (2026-07-28)

- Production Sales Order (45 columns, light theme): menu renders as a solid body-appended overlay within the viewport, distinct values with checkboxes, live "n of m items" status (5 -> 2 of 5 on multi-select), sort via menu with indicator and auto-close, Escape close, Reset full restore. Screenshot reviewed.
- Two micro-fixes found during the pass, verified on the served fixture (live after next extension reload): a second-pass right-edge re-clamp (menu width settles wider than first measurement by ~1px), and a 350ms scroll-close grace period so the menu is not self-closed by the trailing events of a smooth scroll.
- Dark-mode overrides are token-derived (`html.isDarkMode`); account runs light theme, so dark styling is verified by construction against netsuite.css tokens rather than live.
- Zero JavaScript errors.

## Transaction Column Personalization: Milestone 9 (sticky header regression fix)

Status: Complete; live NetSuite verification passed 2026-07-28

Date: 2026-07-28

### Included

- Root cause: Milestone 8 added `position: relative` to `#item_splits` header cells to anchor the column menu inside them. SuiteMate/NetSuite pin those same cells with `position: sticky` when the body scrolls, and the override killed the pinning. The menu had since moved to body-appended fixed positioning, making the rule dead weight — the fix is its deletion; so-columns.css no longer touches header-cell positioning at all (the only remaining `position` rule is the menu's own `position: fixed`).

### Verification

- Full `npm test`: 180 passing tests, 28 screenshot baselines at 0.000 percent difference.
- Browser reconstruction of NetSuite's sticky mechanism (sticky header cells in a scrollable container, 44-row table): header cells compute `position: sticky` again (previously forced to `relative`), header stays pinned at the container top after scrolling 400px, column menu opens mid-scroll with its solid surface, arrows/personalization unaffected. Screenshot reviewed.

## Transaction Column Personalization: Milestone 10 (inline header arrows)

Status: Complete; live NetSuite verification passed 2026-07-28

Date: 2026-07-28

### Included

- The menu arrow now renders beside the column title ("Item ▼") instead of beneath it, vertically centered with consistent spacing; the sort indicator sits between label and arrow ("Item ↑ ▼").
- Mechanism: the arrow and sort indicator are appended inside the 12px `.listheader` div rather than directly into the header cell. The cell's own font is 16px, so any inline child directly in the cell inflates the line box by ~5px — riding the label's own line box keeps the header at exactly its native height. No CSS positioning or display overrides on NetSuite elements remain.

### Verification

- Full `npm test`: 180 passing tests, 28 screenshot baselines at 0.000 percent difference.
- Browser pass: header row height identical to native (29.5px) with arrows and an active sort indicator; label/arrow midpoints aligned; label text extraction stays clean ("Item"); menu, sorting and personalization unaffected. Screenshot reviewed.

## Transaction Column Personalization: Milestone 11 (personalize-mode visibility)

Status: Complete; live NetSuite verification passed 2026-07-28

Date: 2026-07-28

### Included

- Personalize mode is now unmistakable: the controls strip becomes a theme-accented banner reading "Personalizing — drag column headers to reorder. Click Done to finish.", Done switches to a filled primary button, and every header menu arrow dims to 25% with pointer-events disabled so filters cannot look clickable-but-broken during the mode. All indicators revert on Done.
- Latent bug fixed, caught by screenshot review: the buttons' `display: inline-flex` had silently defeated the `hidden` attribute since Milestone 7, so Personalize/Done/Reset were all visible at once in every mode. A generic `[data-suitemate-v3-so-columns][hidden] { display: none !important }` guard now enforces hidden across all owned elements.

### Verification

- Full `npm test`: 180 passing tests, 28 screenshot baselines at 0.000 percent difference.
- Browser pass at the computed-display level: normal mode shows only Personalize; personalize mode shows banner + filled Done + Reset with arrows inert (menu clicks blocked); Done restores everything and menus work again. Screenshot reviewed.

### Milestones 9-11 combined live verification (2026-07-28)

- Production Sales Order (45 columns): header cells compute `position: sticky` again (the regression had forced `relative`); the menu arrow renders inline inside `.listheader` on the same line as the title at a compact 28px header row; personalize mode shows the accent banner with filled Done and 25%-opacity inert arrows (menu clicks blocked), and Done restores arrows and menus fully.
- Zero JavaScript errors.

## Transaction Column Personalization: Milestone 12 (hide/show columns)

Status: Complete; live NetSuite verification passed 2026-07-28

Date: 2026-07-28

### Included

- Hide: a "Hide column" item in each column menu removes the column (header and every aligned row cell) via a display class — label-based identity, display-only, fail-closed.
- Show: personalize mode reveals hidden columns as 35%-opacity ghosts (still draggable) and lists them in the banner as click-to-restore chips; Reset restores everything.
- Persistence: storage schema v1 -> v2 with in-place migration — entries grow from bare order arrays to `{order?, hidden?}` objects, per user per transaction type; empty entries are dropped; the newer-schema write guard protects older extension versions in the field; quota eviction covers the whole entry.

### Verification

- Full `npm test`: 183 passing tests (schema migration, withHidden semantics, applyHidden row coverage), 28 screenshot baselines at 0.000 percent difference.
- Browser pass: hide via menu (5 -> 4 visible columns across header and rows, v2 payload persisted), ghost + chip in personalize mode, chip restore with empty-entry cleanup, sorting with a hidden column present, full Reset.

### Milestone 12 live verification (2026-07-28)

- Production Sales Order (45 columns): "Hide column" removed Committed across header and rows (45 -> 44 visible); the hidden state survived a full page reload (schema-v2 sync storage round-trip); personalize mode showed the 35%-opacity ghost and the "Committed" restore chip; chip click restored all 45 columns and the restore itself persisted through a final reload with clean storage.
- Zero JavaScript errors.

## Transaction Column Personalization: Milestone 13 (column width adjustment)

Status: Complete; live NetSuite verification passed 2026-07-28

Date: 2026-07-28

### Included

- Excel-style edge-drag resizing in normal mode: pointer edge-detection within 5px of a header cell's right boundary (col-resize cursor, no handle elements, no positioning on NetSuite cells), live width updates while dragging, 30-1000px clamp, resize disabled during personalize mode so the two drags never conflict.
- Seamless fixed-layout flip: on first resize every visible column is frozen at its current rendered width before switching the table to `table-layout: fixed` (pixel-identical at the flip), after which resized columns obey exactly and can shrink below natural content width; border-box sizing on header cells makes drag deltas pixel-exact; clearing widths restores native auto layout.
- Persistence: widths join the schema-v2 entry as `{order?, hidden?, widths?}` keyed by label (no schema bump needed pre-release); widths ride on header cells through drag reordering, survive hide/show re-application, and Reset clears them with the rest of the entry.

### Verification

- Full `npm test`: 185 passing tests (withWidths clamp/merge/clear/hostile-keys, applyWidths freeze/hidden-exclusion/clear), 28 screenshot baselines at 0.000 percent difference.
- Browser pass: edge-hover cursor class, +60px drag grew the column exactly 60px and -120px shrank it exactly 120px (below content width), v2 widths payload persisted, width traveled with a column drag, Reset cleared styles, layout and storage.

## Transaction Column Personalization: Milestone 14 (resize handle discoverability)

Status: Complete; live NetSuite verification passed 2026-07-28

Date: 2026-07-28

### Included

- Every header cell shows a faint vertical divider at its right edge (inset box-shadow — zero layout shift, zero border width-math, sticky-safe); hovering the draggable zone intensifies it to a 3px theme-colored bar alongside the col-resize cursor. Header-only by design: data rows carry no vertical lines.
- Dark-mode divider variant via `html.isDarkMode`; the affordance disappears entirely when the feature is off (gated on the sortable attribute).
- Fix found during verification: the hover highlight class lingered into personalize mode from the last-hovered edge; mode entry now clears it.

### Verification

- Full `npm test`: 185 passing tests, 28 screenshot baselines at 0.000 percent difference.
- Browser pass: dividers on header cells with body cells clean (computed box-shadow none), hover highlight + col-resize cursor, resize functional through the new affordance, highlight cleared on personalize entry. Screenshot reviewed.

## Transaction Column Personalization: Milestone 15 (Excel-style live search filtering)

Status: Automated + browser verification complete; live NetSuite retest pending

Date: 2026-07-28

### Included

- Typing in a column menu's search box now filters table rows live on every keystroke (case-insensitive contains), on every column — previously plain text only narrowed the checkbox list except on high-cardinality columns, so rows required a checkbox action to move. The value list still narrows in lockstep, checkbox multi-select still ORs within the column and persists after the search is cleared (the Excel search-then-select flow), numeric operator filtering is untouched, and everything continues to AND across columns.
- Implementation is a removed gate plus copy updates in the existing vanilla layer (the core contains path already existed); React was evaluated and rejected as adding a dependency to delete one conditional. Menu hint now reads "Filters rows as you type · > < = for numbers".

### Verification

- Full `npm test`: 185 passing tests, 28 screenshot baselines at 0.000 percent difference.
- Browser pass mirroring the spec examples: per-keystroke row filtering ("SKU00" -> SKU001/2/3; "sydney" -> Sydney Warehouse/Sydney DC), active-filter arrow while typing, multi-select persisting after search clear, operator + text filters AND-combined across columns, sorting on the filtered set, 3.6ms per keystroke against a 306-row table, full Reset.

## Transaction Column Personalization: Milestone 16 (modal-scoped filter search)

Status: Complete; live NetSuite verification passed 2026-07-28

Date: 2026-07-28

### Included

- Requirement clarified: typing in the column menu's search box narrows only the checkbox value list inside the menu (live, case-insensitive contains); table rows change only when filter values are selected — exactly Excel's dropdown behavior. This supersedes Milestone 15's live row filtering, restored via a surgical revert of that runtime change.
- Retained: checkbox multi-select applying live, numeric operator filtering (> < >= <= =) as live row conditions, the high-cardinality fallback (columns with more than 200 distinct values have no checkbox list, so typed text filters rows there and the menu says so), cross-column AND, Clear filter, and all personalization features.

### Verification

- Full `npm test`: 185 passing tests, 28 screenshot baselines at 0.000 percent difference.
- Browser pass: typing "SKU" narrowed the modal list with row count pinned; rows changed only on selection (7 -> 2); clearing the search preserved the applied filter and restored the list; Clear filter restored all rows. Identical behavior verified across simulated custinvc, purchord, itemship, vendbill, trnfrord and itemrcpt routes — no Sales Order-specific logic.

### Milestones 13, 14 and 16 combined live verification (2026-07-28)

- Verified on production Sales Order, Purchase Order and Item Fulfillment records: header dividers with clean body rows, hover highlight, edge-drag resizing flipping to fixed layout, modal search narrowing only the value list with table rows pinned while typing, and Reset clearing widths and layout on every type. A zero-line Item Fulfillment exercised the empty-table path gracefully (menu opens, no values, nothing breaks).
- Fix from the pass: live NetSuite collapsed borders render ~2px over the style width, and re-measuring rects on each drag would accumulate the offset per resize; drag math now starts from the applied style width when present (fixture-verified; live on next reload).
- Zero JavaScript errors.

## Transaction Column Personalization: Milestone 17 (menu value-list narrowing visual fix)

Status: Complete; confirmed working by user on live NetSuite 2026-07-28

Date: 2026-07-28

### Included

- Fixes the defect behind the Milestone 16 complaint: the search box set the `hidden` attribute on value-list labels, but their `display: flex` styling silently defeats `[hidden]` — the same defect class as the Milestone 11 button bug, unreachable by its guard because these labels carry no data attribute. One CSS rule extends the guard to `menu-values label[hidden]`.
- Verification-methodology correction recorded: prior checks read the `.hidden` property instead of computed display, passing while pixels never changed. Menu verifications now assert at the computed-display level.

### Verification

- Full `npm test`: 185 passing tests, 28 screenshot baselines at 0.000 percent difference.
- Fixture pass at pixel level: per-keystroke narrowing ("S" -> 5 including TEST001's contains match, "SKU" -> the 4 SKU values), rows pinned, backspace restoring all values.
- Live pass in the tricksterbivek profile with the one-rule fix injected over the stale extension CSS: production Sales Order value list narrowed 5 -> 1 in computed pixels with rows pinned; Purchase Order values all legitimately matched the probe (uniform MCW prefix). Native confirmation after next extension reload.

## Transaction Column Personalization: Milestone 18 (list-style sublist rows)

Status: Complete; confirmed working by user across transaction types 2026-07-28

Date: 2026-07-28

### Included

- Root cause of the empty Item Fulfillment filter menu: some transaction types render sublist data rows as `uir-list-row-tr` (odd/even) instead of `uir-machine-row` — evidenced by a live 16-row fulfillment the shared row predicate matched zero rows on, silently disabling values, sorting, filtering and hiding for those types. The predicate now accepts both row families via one shared `isDataRow` (used by filters, distinct values, sorting and hiding) and an exported `DATA_ROW_SELECTOR` for the runtime's status counts.

### Verification

- Full `npm test`: 186 passing tests including new list-row coverage (distinct values, filter, sort, hide on `uir-list-row-tr` rows), 28 screenshot baselines at 0.000 percent difference.
- User-confirmed working on live NetSuite across transaction types.

## Transaction Column Personalization: Milestone 19 (zero-behavior-change refactor)

Status: Complete; all seven approved steps applied and verified 2026-07-28

Date: 2026-07-28

### Included

- Applied the owner-approved refactor plan (8 screened candidates in 7 steps, ~53 LoC): deleted two dead module variables; hoisted headerCells() in the pointermove/filter hot paths; single-read of the sorted column's labels in sortRows; comment-only section banners in both files (no code moved, banner text constrained to the test suite's source-scan rules); a readCellLabel fast path that skips clone-and-strip when a cell provably contains no injected nodes; one shared cleanNumber helper replacing four hand-copied numeric-clean expressions; one provably subsumed CSS selector removed.
- Ponytail debt ledger: 4 markers in core.js (quota single-entry eviction, day-first dates, non-contiguous-row sort refusal, partial-stamp restamp) — 3 without upgrade triggers, recorded for future milestone decisions.

### Verification

- Full `npm test` after every step group: 186 passing tests, 28 screenshot baselines at 0.000 percent difference throughout.
- Final browser gate over every feature: drag reorder + persistence, hide/show with ghost and chip, resize with fixed-layout flip and stored widths, sorting asc with empties last and clear-sort, menu search narrowing only the value list with rows pinned, checkbox styling byte-identical after the CSS selector removal, multi-select with live status, Escape close, full Reset with empty storage.

### Milestone 19 live verification of the refactored build (2026-07-28, v3.18.1 loaded)

- Sales Order (45 columns): menu values, pixel-level search narrowing with rows pinned, sort asc + clear — all identical.
- Item Fulfillment (16 list-style rows): the filter menu lists all 16 values natively with narrowing and pinned rows — the list-row fix confirmed on the shipped build.
- Purchase Order: full destructive cycle — drag reorder, hide, edge-drag resize (146px + fixed layout), Reset restoring everything with clean storage. An initial composite-probe resize miss was diagnosed as a stale-rect test artifact; isolated verification passed.
- User's real saved layouts untouched (destructive checks confined to an empty-scope record). Zero JavaScript errors.

## Checkpoint: UI enhancement baseline (design.md landed)

Status: Stable rollback point tagged before UI experimentation

Date: 2026-07-28

Tag: `checkpoint-pre-ui-enhancement-2026-07-28` — shipped code byte-identical to release v3.18.1; this commit adds documentation only.

### Included

- Lands `design.md`, the owner-supplied design-language specification (token system for color, typography, spacing, radius, elevation and components) that will govern the upcoming UI enhancement layer. No source, manifest or test changes.

### Verification

- Full `npm test` on the checkpoint tree: 186 passing tests, 28 screenshot baselines at 0.000 percent difference.
- Working tree clean after commit; branch and tag pushed to GitHub.

## Restore: v3.18.1 stable checkpoint (UI enhancement layer rolled back)

Status: Restored and verified

Date: 2026-07-28

### Included

- Owner judged the design.md UI experimentation (UI-0 through the partial UI-4: tokens, cobalt accent, pill buttons, totals card, surface geometry) below the expected quality bar and requested restoration of the stable refactored release. Every tracked file was restored to `checkpoint-pre-ui-enhancement-2026-07-28` (shipped code byte-identical to release v3.18.1); the three files that work added (`tokens.css`, the UI spec and plan) were removed. `design.md` itself remains at the repo root, and the full UI-enhancement history stays reachable in git history (`db4730f..9ad949a`) if it is ever revisited.

### Verification

- `git diff checkpoint-pre-ui-enhancement-2026-07-28` empty — the tree is byte-identical to the rollback point.
- Full `npm test`: 186 passing tests; all 28 restored screenshot baselines verify at 0.000 percent; 15 V1 style hashes green.

## Persisted Sort & Filter: Milestone 20

Status: Complete; live-verified across three transaction types 2026-07-28

Date: 2026-07-28

Spec: `docs/superpowers/specs/2026-07-28-persisted-sort-filter-design.md` · Plan: `docs/superpowers/plans/2026-07-28-persisted-sort-filter.md`

### Included

- Storage schema v3 in `suiteMateV3ColumnOrder`: per-scope entries gain `sort {label, dir}` and `filters {[label]: {anyOf?, q?}}` beside order/hidden/widths. Fail-closed normalizers with caps (8 filter columns, 50 values, 100-char queries); v2 passes through; older builds refuse v3 writes; the shared empty-entry check spans all five fields.
- Save triggers at every sort/filter mutation point, with query keystrokes debounced 800ms for the sync write throttle and Reset cancelling pending debounces. The fixture round-trip caught back-to-back saves clobbering each other's read-modify-write — all five storage savers now serialize through one promise queue (the shipped three shared the latent race).
- Auto-reapply in the install chain after widths: label-matched sort via the shipped `sortRows`, filter-state rebuild with `textAsRowFilter` re-derived from live cardinality, silent skip for vanished labels.
- Active-view chip in the control bar (`Amount ↑ · 2 filters ✕`): reflects active state including over-cap session-only filters, one click clears sort+filters in a single composed storage write, layout fields untouched. Dark-mode contrast rule added for both chip kinds (pre-existing hidden-chip quirk fixed alongside).

### Verification

- Full `npm test`: 190 passing (4 new core suites; 8 schema-version expectations updated as declared consequences of the bump); 28 screenshot baselines untouched at 0.000 percent.
- Fixture round-trip on the served sales-order page: interact → captured storage carries both fields → cold reload with seeded storage → rows re-sorted and filtered at computed level, indicator and active-arrow rendered, restore wrote nothing back; chip clear emptied the entry.
- Live on production after reload: SO 16302518 — sort asc + two-value OR filter, real page reload auto-reapplied (2 of 5 rows, `Item ↑ · 1 filter ✕`, indicator, active arrow), chip clear restored native with the saved column layout intact; Item Fulfillment 14953684 — 16 `uir-list-row-tr` rows, 1-of-16 filter persisted through reload, chip clear restored; PO 16295656 (empty scope) — full destructive cycle, Reset cleared sort+filters+layout and nothing resurrected after reload. Zero SuiteMate console errors (only NetSuite's own SuitePhone CSP notice).

## Export View CSV: Milestone 21

Status: Complete; owner-confirmed working live 2026-07-28

Date: 2026-07-28

Spec: `docs/superpowers/specs/2026-07-28-export-view-csv-design.md` · Built via ultracode recon + adversarial-review workflows.

### Included

- CSV Utils gains **Export view**: downloads the `#item_splits` grid exactly as shown — visible columns in current order, visible rows in current (sorted/filtered) order, display text as rendered. New `record.csv-export-view` command flows through the existing registry/bridge as a third mode (`exportView`) beside export/template; the main-world handler needs no SuiteScript (pure DOM snapshot) and reuses `downloadCsv`, `serializeCsv` (formula protection + CRLF + BOM) and filename sanitization verbatim. `core.readViewSnapshot(table, isHidden)` clone-strips SuiteMate-injected arrows/indicators/badges from header labels, dedupes duplicate labels, and skips machinery rows with mismatched cell counts. Filename: `<recordtype>-<id>-view.csv`.
- Mode whitelists extended in all four validators: bridge request, bridge response, core request detail, core result detail. The fourth (response metadata) was caught by the owner's first live click — the full menu→command→bridge→main-world→snapshot path executed and only that gate rejected; fixed with a bridge test covering acceptance (including legitimate zero-row headers-only exports) and unknown-mode rejection.
- A source-pin test locks the runtime's mode→command mapping after a transient regression was caught during final re-verification.

### Verification

- Full `npm test`: 193 passing (view-snapshot suite, exportView mode acceptance in core details and bridge response, mapping pin); 28 screenshot baselines untouched at 0.000 percent; command-registry parity and csv source-purity gates green.
- Fixture proof on the served sales-order page against the real personalized grid (sorted desc, one column hidden, filtered to one row): snapshot exported exactly `Item,Description,Quantity,Amount` + the single visible row, CRLF-joined, with header decorations stripped despite being live in the DOM.
- Live on production: owner confirmed the Export view download working after the response-validator fix. Recon and 4-lens adversarial review ran as ultracode workflows; any late-arriving confirmed review findings will be triaged as follow-up.

### Milestone 21 adversarial-review hardening (2026-07-28, v3.19.1)

- The ultracode review fan-out (4 lenses, 12 raw findings, each adversarially verified — several by mutation testing) landed after the v3.19.0 release with three real defects beyond the already-fixed response validator, all now fixed: an edit-mode guard (`?e=` pages rendered input machinery as junk or a headers-only CSV under a success toast; Export view now refuses with "Export view is available in view mode only."); ghosted hidden columns during Personalize mode leaked past the computed-display test (the snapshot predicate now also treats `col-hidden` as hidden); and the header dedupe could emit colliding names for literal duplicates like `Qty, Qty, Qty 2` (now collision-proof).
- The review's test-coverage findings are closed: a main-world round-trip test drives the real `exportView` dispatch end to end (formula protection asserted in the downloaded bytes, ghost exclusion, edit-mode and missing-grid errors), plus dedupe-collision, zero-row result acceptance, and menu-wiring source pins.

### Verification

- Full `npm test`: 197 passing; 28 screenshot baselines untouched at 0.000 percent.
