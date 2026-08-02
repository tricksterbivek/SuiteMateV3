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
- Owner confirmed the v3.19.1 build working live after reload (2026-07-29).

## Personalize Controls Overflow: Milestone 22

Status: Complete; live-verified at both scales 2026-07-30

Date: 2026-07-30

### Included

- Fixes the owner-reported UX defect where many hidden-column chips pushed Done/Reset off-screen with no way to scroll to them. Root cause: a single non-wrapping inline-flex controls row with the unbounded chip list ordered before the actions. Fix: actions-first child order (Personalize, view chip, hint, Done, Reset, then chips) plus `flex-wrap: wrap` and `max-width: 100%` containment on the bar and the chip list — chips flow onto extra rows below while the actions stay on row one. No sticky positioning, nothing NetSuite-owned touched.

### Verification

- Live on the 44-column PO 16295656 (empty scope): 29 hidden-column chips wrapped the bar to 84px across rows, bounded 37–1874px inside a 1920px viewport with zero horizontal page scroll; Done and Reset measured reachable on the first row and the last chip inside the viewport; Reset restored a clean 24px single-row bar, zero chips, zero hidden headers, empty storage. Small case (2 chips) stayed single-row. Item Fulfillment (list-row family) renders the wrapped bar and enters/exits Personalize cleanly. Zero console errors.
- Full `npm test` green at implementation time; screenshot baselines untouched (fixture pages render the controls only when the setting is on).

## Smart Tab Titles: Milestone 23

Status: Complete; live-verified across four record shapes 2026-07-30

Date: 2026-07-30

### Included

- New opt-in "Smart tab titles" popup toggle (settings schema v3→v4 with pass-through migration): on ~29 record types the browser tab reads `SO · SO886672 · 754 Online Sales - MCoBeauty, Inc. · Billed` instead of NetSuite's generic title. `src/tab-title/core.js` (pure: path-token map, clone-stripped header read excluding SuiteMate badges and the status pill, ALL-CAPS status humanizing, 60-char entity truncation, fewer-than-two-parts keeps the native title) plus a thin settings-gated runtime that restores the original title when toggled off. ponytail: fixed format; a user-configurable template is the named upgrade path.

### Verification

- Full `npm test`: 202 passing (5 new core tests; settings v4 expectations updated across settings, transfer, popup-race and verify suites); 28 baselines at 0.000 percent.
- Live with the toggle enabled: Sales Order `SO · SO886672 · … · Billed` (correctly reflecting the record's status change since the prior day), Item Fulfillment `IF · IF773083 · 133 Big W #133 Parkes · Shipped`, Purchase Order `PO · PO6139 · Shanghai Xiafei Cosmetics Company Ltd · Pending Receipt`, Customer `CUST · 133 Big W #133 Parkes` (entity shape, no document number). Zero console errors. The toggle-off restore path is unit-covered and mirrors the shipped settings-reaction pattern; the popup itself is unreachable from the automation bridge, so that single click remains owner-verifiable.

## Personal Form Views: Milestone 24a (core + storage)

Status: Complete; unit-verified

Date: 2026-07-30

Spec: `docs/superpowers/specs/2026-07-30-personal-form-views-design.md` · Built via Opus 5 ultracode recon (4 mappers: form DOM, reuse surface, wiring ripple, risk screen).

### Included

- `src/form-views/core.js`: the `suiteMateV3FormViews` v1 store under the full house doctrine — fail-closed normalizers (field names lowercased/deduped/charset-checked, section titles trimmed/deduped), `withHiddenFields`/`withCollapsedSections` writers with null-on-rejection, newer-schema refusal, 7,800-byte quota guard with single-entry eviction, empty-entry deletion — plus identity helpers: `fieldKey` (prefers `data-field-name`, falls back to parsing the live-proven `data-walkthrough="Field:…"` hook), clone-stripping `sectionKey`, and `applyFieldVisibility`.
- Recon-driven decisions recorded: hide class applies at wrapper level with an `!important` guard (the third instance of the M11/M17 display-defeats-hidden defect class); section collapse will replay NetSuite's native collapsible machinery rather than invent a second one; sublist/filter wrappers are excluded territory.

### Verification

- 8 new vm-harness tests green (frozen contract, writers, hostile input, quota eviction, identity helpers, visibility application); full `npm test` 210 passing with the file wired into checks and the test list; 28 baselines untouched.

## Personal Form Views: Milestone 24b (runtime, UX and wiring)

Status: Complete; suite-verified, fixture functional pass and adversarial review next

Date: 2026-07-30

### Included

- `src/form-views/runtime.js` + `form-views.css`: Personalize Form mode on Sales Order view pages — per-field ⊖ affordances mounted inside `.uir-label` (internal-ids precedent), ghosts at reduced opacity while personalizing, actions-first wrapped chip bar (M22 lesson), Done/Reset, serialized saves, auto-reapply on load. Section collapse replays NetSuite's NATIVE collapsible (records `aria-expanded` after native clicks, re-clicks titles on load) instead of inventing a second mechanism. Field finder = the live-proven `[data-walkthrough^="Field:"]` hook with sublist/filter containment exclusion; wrapper-level hide class carries `!important` (third sighting of the display-defeats-hidden defect class). Lifecycle-registered under the new `FORM_VIEWS` capability (salesord + id + view mode + top frame), `startPaused`, opt-in via the new "Personal form views" toggle.
- Settings schema v4→v5 with the full ripple, plus two pre-existing gaps fixed en route: `settings-transfer` legacy key lists never learned v3/v4 (v4 backups failed restore with NON_CANONICAL — now table-driven through v4 with a direct acceptance test), and the tab-title files were absent from `verify.mjs` extension-source coverage.
- Coexistence hardening: all three sibling `FOREIGN_NODE_SELECTOR` lists (so-columns, csv-export view snapshot, tab-title) now exclude `[data-suitemate-v3-form-views]` nodes.
- Fixture upgraded with a realistic classic form: `.uir-field-wrapper` divs carrying `data-field-name`/`data-walkthrough`/`.uir-label` across two collapsible field groups, plus a fixture-native collapse script emulating NetSuite's handler; chrome-stub seeds `formViews` and serves the `suiteMateV3FormViews` key with write counters.

### Verification

- Full `npm test`: 212 passing (routes capability tests, settings v5 across four suites, transfer legacy acceptance, form-views core); 28 screenshot baselines untouched at 0.000 percent (feature is default-off and startPaused — the M22 precedent).

## Personal Form Views: Milestone 24c (adversarial review + fixture verification)

Status: Complete; confirmed findings fixed and re-proven

Date: 2026-07-31

### Included

- The Opus 5 review fan-out (4 lenses, 22 agents, refutation-verified with in-Chrome and Node mutation experiments) confirmed three real defects, all fixed:
  1. **Collapse-replay self-save data loss** (three lenses converged): load-time replay clicks re-entered our own capture listener, wholesale-rewriting the stored section list from whichever form variant was open — sections from other Sales Order forms were silently deleted, one sync write per section per load. Fixed twice over: a synchronous suppression flag makes replay write nothing, and user-gesture saves now MERGE (stored sections absent from the current page survive).
  2. **Missing observer**: the lifecycle registration had no `observe`, so the zero-wrapper bail never retried, late-rendered wrappers stayed unmanaged, and toggling the setting on an open page did nothing until refresh (matches the live symptom). Now observes childList/subtree with a relevance filter excluding SuiteMate-owned and internal-ids nodes.
  3. **Transfer test theater** (reviewer catch on my own test): `transfer.create()` migrates before enveloping, so the v3/v4 acceptance test never reached the legacy branch. Replaced with hand-built v3/v4 envelopes that drive it genuinely, plus two NON_CANONICAL negatives.

### Verification

- Full `npm test` 212 passing; 28 baselines untouched.
- Fixture round-trip re-proven at the review's exact failure scenario: stored sections `[Classification, Phantom Section]` + reload → replay collapsed Classification with ZERO storage writes; a user collapse then produced exactly one write and `Phantom Section` survived the merge. Earlier fixture pass (hide/ghost/chips/reset) and the live pass on SO 16302518 (154 fields, hide + native collapse + reload auto-reapply + chip unhide + Reset; PO negative; coexistence with grid personalization, tab titles; zero SuiteMate console errors) all recorded.

### Personal Form Views: Milestone 24d (final live verification, shipped build)

- The toggle-on-while-open path — the review's missing-observer finding — proved itself live: flipping the settings installed both form-views and the grid on an already-open Sales Order with no refresh.
- Full cycle on the shipped build: Personalize Form with ghosts and real-label chips, hide + native section collapse ("Ship Central - Other Party Billing"), real page reload auto-reapplied everything, chip un-hide surgical. The owner's own experimentation (two hidden fields from their earlier session) survived the toggle-off/on churn intact — the merge-on-save fix working as designed — so the pass ended by restoring their exact saved view rather than Reset.
- A non-install red herring was root-caused by storage forensics: both feature toggles had been switched off in stored settings (a popup save around the extension reload), not a code fault — the full-parity fixture had already exonerated the build.
- Coexistence green (45 grid arrows, smart tab titles); zero SuiteMate console errors throughout.

## Personal Form Views restored; Form Layout Builder deferred (v3.21.1)

Status: Complete
Date: 2026-07-31

### Included

- The complete drag-and-drop layout builder (spec, plan, phases A-D, adversarial-review fixes, live verification — v3.22.0 state at 0a04764) is preserved on the `feature/form-layout-builder` branch for a future major release, per the owner's direction.
- `main` restored byte-identical to the v3.21.0 tree (verified with `git diff 58b139d --quiet`) via a forward revert commit — no history rewrite — then patched with exactly one behavioral change: form-views `STORAGE_SCHEMA_VERSION` accepts/writes the schema-2 container. The layout-builder live tests left the owner's real storage on a schema-2 container (all order keys self-cleaned; the entry is hiddenFields-only), and the untouched v1 code would have refused it — silently dropping their two hidden fields on read and blocking every save. `normalizeEntry` keeps only the keys this build understands, so schema-2 entries read through cleanly; a save from this build drops branch-only order keys for the touched scope (accepted while the builder lives on its branch, noted in a ponytail comment).

### Verification

- New unit test drives the exact live shape: a schema-2 entry carrying hiddenFields + sectionOrder + fieldOrder reads through with hiddenFields intact and order keys dropped; writes stay on container 2. Full `npm test` green (213 tests, 28 baselines at 0.000%).


### Addendum (post-rollback forensics, 2026-07-31)

- LevelDB history showed the owner had been exercising the layout builder themselves after the live pass (field reorders across four groups, section moves, collapses, two Resets — the Resets are what cleared their earlier two hidden fields, before the rollback). The restored v3.21.1 build read the schema-2 container correctly; there was simply nothing hidden left to apply.
- The rollback verification's hide/unhide write then hit the documented compat ceiling and dropped the owner's final builder experiment for the touched scope. Recovered verbatim from the storage log for when `feature/form-layout-builder` resumes:

```json
{"schemaVersion":2,"views":{"6998262:2462:salesord":{"fieldOrder":{"Account Information":["exchangerate","currency"],"Primary Information":["entity","trandate","tranid","otherrefnum","memo","custbody_gwp_not_selected","custbody_shopify_order_number"]}}}}
```

## Rollback shipped: v3.21.1 released, layout builder parked on its branch

Status: Complete
Date: 2026-07-31

### Included

- GitHub release v3.21.1 published (https://github.com/tricksterbivek/SuiteMateV3/releases/tag/v3.21.1), tagged on main at dbda986: the classic Personal Form Views experience (hide/show fields, persistent section collapse, Sales Orders only) plus the schema-2 storage-compat fix, with the drag-and-drop layout builder deferred intact on `feature/form-layout-builder` (v3.22.0 state, adversarially reviewed and live-verified before deferral). Both refs pushed to origin.
- The rollback itself is documented two entries up: byte-identical restore of the v3.21.0 tree via forward revert (no history rewrite), one surgical compat constant, and the post-rollback forensics addendum with the owner's recovered fieldOrder experiment.

### Verification

- End-to-end on the released build against production SO 16302518: hide a field → real page reload → still hidden → chip unhide → storage clean; the schema-2 container written by the builder reads through correctly. Full `npm test` at 213 passing, 28 baselines at 0.000%. Owner declined re-hiding the two pre-builder fields (their own Resets had cleared them); fixture server shut down.

## Edit Mode Table Enhancements: Milestone M1 (shared foundation)

Status: Complete; foundation live-verified fail-closed, mount pending M1.5 identity amendment

Date: 2026-08-02

Spec: `docs/superpowers/specs/2026-08-02-edit-mode-table-enhancements-design.md` · Plan: `docs/superpowers/plans/2026-08-02-edit-mode-table-enhancements.md` · Built via Opus 5 subagent-driven development (implementer / reviewer / re-reviewer per task); 12 controller adjudications recorded in the SDD ledger. Commits `f0716b7..cea3726` on `feature/edit-mode-table-enhancements` — every commit range in this entry is **inclusive of both endpoints**, not git-exclusive.

### Included

- **Task 1** — branch cut at `f0716b7` with the baseline pinned (213/213, 28 baselines 0.000%, empty diff guard); plan-reviewer consistency edits `0862814`, CLASSES frozen-contract amendment `aaac481`.
- **Task 2** (`5dd5c9e`) — additive capability `TRANSACTION_COLUMN_PERSONALIZATION_EDIT` in `src/shared/routes.js` (Sales Orders, top frame, `id` **and** `e` present). Disjoint from the two `!hasParam(context, "e")` view-mode rules by construction, so the modes are mutually exclusive; existing cases untouched.
- **Task 3** (`f80a0e5..ed78108`) — settings schema v5→v6 with the full ripple and a new default-off opt-in toggle "Sales Order columns (Edit Mode)" (`salesOrderColumnsEdit`); registration is `startPaused`, which is why the 28 screenshot baselines cannot move.
- **Task 4** (`0ae822a`) — chrome-stub serves the new `suiteMateV3EditColumns` key with a write counter; en route it fixed a latent stub bug that clobbered settings (and the settings/role-theme counters) on every edit-columns write, which would have made a naive round-trip look green.
- **Task 5** (`3b80c42..f8aadb5`) — `src/edit-grid/core.js`: frozen contract (37 names), the six-part storage doctrine on its own key `suiteMateV3EditColumns` (container schema 1, `grids` keyed by `{company}:{user}:{type}:edit`), and Edit-Mode-native identity — column axis `visibleCells()` (inline `display:none` excluded, SuiteMate's class-based hiding retained), column ids decoded from `{machine}_{column}{line}_fs` spans against the row's own line number, `ids.every(Boolean)` fail-closed. Fix round closed two plan-mandated `evictOverQuota` defects (delete-path container wipe; no re-measure after eviction).
- **Task 6** (`c4cb68f..4406d93`, 6 commits) — `src/edit-grid/runtime.js` + `edit-grid.css`: mounts, stamps `BOUND_ATTRIBUTE` on the container, binds one delegated-listener set, early-returns on identity, tears down synchronously to zero owned nodes — and does nothing visible. Seven adjudicated deviations (#4-#10) fixed, all revert-verified: inert CSS selector re-anchored to the stamped container, `EXCLUDED_ROW_SELECTOR` widened to the old∪CSS-derived row-class union, `relevant()` de-self-triggered and then narrowed to containment-only targets, `isDirty()` taught `<select>`, newer-schema toast once-latched.
- **Task 7** (`55057eb..6f26989`) — `tests/fixtures/sales-order-edit.html`: self-loading Edit Mode fixture (`?id=1&e=T`) with a `buildtable()`-style full `<tbody>` repaint emulator. Deliberately **not** in `route-catalog.js`, which keeps the baseline count at 28. Fix round made it a genuine regression net (mutation-catching proven both ways).
- **Task 8** (`3c38ea9`) — coexistence: all four `FOREIGN_NODE_SELECTOR` lists (so-columns, form-views, csv-export view snapshot, tab-title) now exclude `[data-suitemate-v3-edit-grid]`; one token each, four insertions, zero test edits.
- **Task 9** (`cea3726`) — live probe pass on the locked record and `docs/testing-log.md`. Raw transcripts: `.superpowers/sdd/2026-08-02-edit-mode-table-enhancements/probe-transcripts.md`.

### Verification

- Full `npm test`: **245 tests, 245 pass, 0 fail**; `npm run fixtures:verify`: **28 screenshot baselines at 0.000%** (nothing visible shipped; the feature is default-off and `startPaused` — the M22/M24b precedent).
- Fixture round-trip: mounts on `?e=T` with the marker and the bound attribute present; the route gate returns `[edit true, view false]` on `?id=1&e=T` and `[edit false, view true]` on `?id=1` — the H3 complement asserted at the gate, not at the DOM; full `<tbody>` regenerate + add-line + open-line + close-line produced **zero** storage writes over 500 ms; teardown left zero owned nodes and removed the bound attribute; computed `table-layout` stayed `auto` and every row stayed visible.
- **Live probe pass** (account `6998262`, SO `id=16342809&e=T`, ~23:00-23:07 AEST): safety triple verified twice, read-only except **three** authorized in-page interactions — probe 8's Gate A cell permutation plus its quantity edit and OK commit on line 3, probe 10's Insert/Remove/Cancel cycle, and probe 11's line-open and OK commit with the Quantity column hidden; **no save at any point**; teardown by navigating to the view URL, owner-confirmed; the record is byte-identical to its pre-pass state and the in-page qty "2" was discarded. **Zero error-level console messages** across the whole pass (33 messages, 0 errors, 0 warnings).
- Live-proven this pass: the **route gate and byte-complement exclusivity** (View Mode after teardown: so-columns mounted with 55 nodes, edit-grid 0 nodes; in Edit Mode: so-columns/form-views absent, edit-grid 0 owned nodes — zero interference in both directions); **capability reach** on `&e=T`; the **fail-closed install path**, which declined cleanly (`bound=false`, `ownedNodes=0`) when `readColumnIds()` returned `[]`; and clean teardown.
- **Not proven live: attachment and re-render survival — FIXTURE-PROVEN ONLY.** The live form declined to mount (see the identity finding), so no live evidence exists for mount-through-repaint. The claim "attachment + re-render survival proven" is **not** made.
- View Mode was **not** interactively regression-swept this milestone. What is evidenced: the coexistence eyeball after teardown (so-columns mounted with 55 nodes on the view page, edit-grid 0 nodes), zero SuiteMate console errors across the pass, and the 28 pixel baselines at 0.000% as the automated View Mode net. The mechanical guard holds — `git diff --name-only main | grep so-columns` returns exactly `src/so-columns/core.js`, the one-token `FOREIGN_NODE_SELECTOR` addition. A full interactive sweep (personalization, sort, filter, widths, Export view, tab titles, internal-id badges) is **owed** — see Next item 7.

### Gate A — verdict of record: REFRAME

Independently interpreted by an Opus 5 subagent from the probe 8 transcript; the captain did not interpret it alone.

- The repaint is neither id-addressed nor index-addressed: it is **model-driven regeneration — the repaint replaces, never patches**. The permutation was destroyed on line-**OPEN**, before any commit (opening a *different* line rebuilt the whole `<tbody>` and discarded both the moved cell and the tracer stamps); after the commit every value sat under its correct header in native order, the permutation was not resurrected, zero stamps survived anywhere in the document, and the API model on the adjacent line was untouched (`quantity` line 2 still `"1"`, line 3 correctly `"2"`).
- **Corruption is not manifest** — no value landed in the wrong column.
- Therefore **M4 (drag-and-drop reorder) is blocked-pending-M1.5-identity + Gate A′** (a re-apply-then-commit probe: re-apply a stored order after a rebuild, then commit, then read back). It is **not** closed under owner decision Q3 — Q3's trigger was index-addressing, which did not occur.
- Static rows carry **no `_fs` spans**, so the brief's `_fs`-pair methodology was adapted to visible-index ↔ header-label ↔ cell-text triples plus tracer stamps.
- NetSuite fired a **native reorder-point advisory dialog** on the qty commit (probe 8c) — server-side sourcing runs on commit, so M4/M7 flows must expect native dialogs.

### Identity finding (falsifies spec §5 / §4.1 / §6 on this form)

- Static data rows carry **zero `span[id]`, zero `<input>`, zero `data-field-name`** — the cells are bare text (`<td>MCH376</td>`). Header cells likewise have no ids and no `data-field-name`.
- Open-line `_fs` ids carry **no line digits** (`item_item_fs`, `quantity_formattedValue`), and widgets materialize **per cell on click**, not per row.
- Consequence: `readColumnIds()` returns `[]` **permanently** on this form, so the runtime declines to install. The fail-closed path behaved exactly as designed — but the shipped identity axis cannot reach this record.
- **H1 (data rows carry extra hidden system cells) is NOT manifest**: 43 header cells / 43 visible, and rows 1-7 symmetric at 43/43. The spec's stop-condition never triggered. That makes **H3's route gate the sole mode barrier — load-bearing**.
- `data-machine-name` is **present** (U3 answered: `src/styles/netsuite.css:1616` is not dead code). The `machines` global and `item.postBuildTableListeners` exist but are MAIN-world — non-goal, future optimization only.
- `isLineOpen()` is **`true` permanently as coded** (the entry row always carries `uir-machine-row-focused`, and the button row is always attached) — it would starve every M2+ apply. `isDataRow` also accepts the id-less entry row. Both are M1.5 fixes.
- The `EXCLUDED_ROW_SELECTOR` union (adjudication #5) was vindicated live: `uir-machine-button-row` is real, the old `machineButtonRow` name does not exist. A **new** class `uir-machine-row-last` was observed and must be added in M1.5. No totals row exists on this form.
- The fixture encodes the two falsified assumptions (static-row `_fs` spans; an extra hidden system cell) — it passes where reality fails. **Nothing shipped in M1 needs reverting**; the fixture is what must be rebuilt.

### Feature-status deltas (spec §8, evidence-only updates)

- **Drag-and-drop column reorder** — was "Conditional — Gate A". Now **blocked-pending-M1.5-identity + Gate A′**, on the REFRAME verdict above. Not closed under Q3; no substitute is authorized or built.
- **Excel-style sorting / filtering (M6/M7)** — the hard precondition is **cleared**: probe 6b found the machine is **not** natively drag-ordered (`draggableTable false`, `orderedContainer false`, `movableCells 0`). `isOrderedMachine` stays as an unconditional guard regardless. Probe 12: 9 lines, `nlapiGetLineItemCount('item')` 9, **no pagination on this record** — the page-scope disclosure ships untested.
- **Column resizing (M2)** — mechanism **live-validated**: probe 9 found no `colgroup`, `table-layout: auto`, no width attributes on header cells → the design works exactly as specified.
- **Hide / show columns (M3)** — the safety claim **holds live**: probe 11 hid the required Quantity column and the line still committed cleanly (value preserved, no alerts). But per-cell widget materialization means the hidden cell's widget never materializes, so the spec's `focusin` force-reveal is **unimplementable as written** — M3's reveal must be **chip/menu-driven**.
- **Column personalization (persistence)** — unchanged (fully supportable); storage doctrine is unit- and fixture-proven, and the live pass never reached a write.
- Probe 11 also produced repaint evidence: the injected hide classes were **gone** after the commit repaint — the rebuild discards anything not in the model.

### Next: M1.5 (identity amendment — M2 cannot start before it)

1. Read-only live probes still owed: the hidden `{prefix}fields` / data inputs (probe 5's read-only half was **not run** — recorded as an open gap; its POST-body half stays deferred because it requires a save), a uniqueness census over the 43 header labels, and the label source node.
2. `readColumnIds` strategy chain with a fail-closed uniqueness gate — label-keyed identity, since `_fs` decoding is dead on this form.
3. `isLineOpen()` redefined to numbered focused rows (the always-focused entry row must not count).
4. `EXCLUDED_ROW_SELECTOR += uir-machine-row-last`; `isDataRow` requires a numbered row id.
5. `tests/fixtures/sales-order-edit.html` rebuilt to the real shape (bare-text static rows, symmetric 43/43 cells, per-cell widget materialization, `uir-machine-row-last`).
6. One live re-probe showing `bound=true` with **zero idle writes**.
7. Full interactive View Mode regression sweep (Tier 4 — personalization, sort, filter, widths, Export view, tab titles, internal-id badges), batched into the same M1.5 live re-probe session as (1) and (6). Owed from M1, where only the coexistence eyeball and the automated pixel net ran.

**M2 does not start until (6) and (7) pass.**

## Edit Mode Table Enhancements: Milestone M1.5 (column identity)

Status: Complete — MOUNT PASS live on the locked record; M2 unblocked subject to the preconditions below

Date: 2026-08-03

Spec: `docs/superpowers/specs/2026-08-02-edit-mode-table-enhancements-design.md` **Amendment 1** (`:234-440`, sections A1.1-A1.7) · Plan: `docs/superpowers/plans/2026-08-02-m15-identity-amendment.md` · Built via Opus 5 subagent-driven development (implementer / reviewer per task); one further controller adjudication (**#13**, document-scoped input resolution) and escalation **#6** (the inert length guard) recorded in the SDD ledger `.superpowers/sdd/2026-08-02-m15-identity-amendment/progress.md`. Commits `21ae0bd..0f88827` on `feature/edit-mode-table-enhancements` — **every commit range in this entry is inclusive of both endpoints**, meaning the first commit *of that item* and its last, not git's exclusive `A..B` revision syntax. The ledger's own per-task ranges are written git-exclusively and chain from `bbb4479` to `dd8143a`; rendered as a single exclusive span, `bbb4479..0f88827` covers the **nine task commits**, while the inclusive span above adds the **three pre-task amendment commits** — twelve in all. `bbb4479` is the last plan-review commit, not the first task commit.

**Range correction carried from M1:** the M1 entry's headline range (`:1235`) reads `f0716b7..cea3726`, but under this inclusive convention it should have read **`0862814..cea3726`** — `f0716b7` is the branch point, not an M1 commit.

### Included

- **Amendment (pre-task)** (`21ae0bd..bbb4479`, 3 commits) — spec Amendment 1 and the M1.5 plan, plus two plan-review fix rounds. Round 1 introduced axis **pinning** after the reviewer measured that re-deriving under an applied non-native order silently **mis-keys** in 31-45% of 2709 permutations rather than declining; round 2 latched the axis-mismatch refusal. Doc-only; no `src/` or `tests/` change.
- **Task 1** (`3311b96..9d70307`) — `src/edit-grid/core.js`: the identity core. The axis is derived from the machine's own hidden `{machine}fields` / `{machine}data` inputs (`parseMachineFieldData`, `collapseDisplayTwins`), correlated against the rendered header labels and sample row texts by `labelAffinity` / `correlateColumnIds` under a fail-closed **unique-optimum** gate. Fix round 1 closed the reviewer's Important: an empty or absent `{machine}data` now **declines** instead of proceeding on label affinity alone (spec decision table governs). The reviewer independently reproduced the 43-id ground-truth axis and the P-MONO table digit-for-digit from committed code.
- **Task 2** (`5ab27ef`) — predicates: `isLineOpen()` counts only **numbered** focused rows (the permanently focused entry row no longer makes it `true` forever — the M1 finding that would have starved every M2+ apply); `isDataRow` requires a numbered row id; `EXCLUDED_ROW_SELECTOR` gains `uir-machine-row-last`. Reviewed clean, zero fix rounds.
- **Task 3** (`3073c19`) — `columnIdFromSpanId` decodes the open line's **line-less** `_fs` span ids (`item_item_fs`), which is the only shape the live open line produces. Escalation #6 adjudicated the brief's mutation claim factually wrong: the length guard is provably **inert** both ways, so it is kept as belt-and-braces but is **never cited as tested**.
- **Task 4** (`173cc9d`) — axis **pinning**: derive on a native DOM only, pin for the mount's lifetime, and refuse to re-derive while our own permutation is applied. Closes P-MONO's self-inflicted half by construction. A discriminating mutation proves the guard is independent of the request count.
- **Task 5** (`f87cb13`) — `tests/fixtures/sales-order-edit.html` rebuilt to the real machine shape (bare-text static rows, symmetric cell counts, per-cell widget materialization, `uir-machine-row-last`, the hidden `{machine}fields`/`{machine}data` inputs). The fixture now **mounts**: 14/14 round-trip green, 0 console errors, 4/4 mutations caught both ways.
- **Task 6, first run** (`73e8975`) — live re-probe → **MOUNT FAIL**, recorded in `docs/testing-log.md` and in `probe-transcripts.md` § "M1.5 live re-probe". Root cause confirmed **on the live page**: the machine's mini-form boundary (`item_form`) means `table.closest("form")` can never reach the identity inputs, which live in `main_form` (`sameForm: false`). Live inputs were byte-identical to the proven payload — the algorithm was vindicated, the **lookup scope** was wrong.
- **Task 6a** (`dd8143a`) — adjudication #13's fix: the runtime resolves the machine field inputs **document-scoped** (`#main_form`, the repo's live-verified route used by internal-ids), through a new pure core entry `readColumnIdsFrom`, with the bare `readColumnIds` retained as fallback. The fixture was made **adversarial** — its inputs are unreachable via the table's own form, and the new `BOUNDARY` check measures `readColumnIds(table) === []` to prove it. Reverting the resolution reproduces the exact live failure signature.
- **Task 6, re-run** (`0f88827`) — live re-probe at `dd8143a` → **MOUNT PASS**, plus the Tier-4 View Mode sweep owed from M1. Recorded in `docs/testing-log.md` and in `probe-transcripts.md` § "M1.5 live re-probe RE-RUN + Tier-4 View Mode sweep"; independently interpreted, verdict of record at ledger `progress.md:42-43`.

### Verification

- Full `npm test`: **260 tests, 260 pass, 0 fail, 0 skipped** (re-run independently at T7; M1's 245 plus the 15 added by Tasks 1-6a). `npm run fixtures:verify`: **28 screenshot baselines at 0.000%** — nothing visible shipped; the feature is still default-off and `startPaused`.
- Mechanical guards: `git diff --name-only main | grep so-columns` returns exactly `src/so-columns/core.js` (still the one-token `FOREIGN_NODE_SELECTOR` addition from M1). `tests/fixtures/route-catalog.js` is unchanged against `main`, which is why the baseline count cannot move. `manifest.json`, `package.json` and `tests/verify.mjs` **do** differ from `main`, but are byte-unchanged since the M1 checkpoint commit `cea3726` (`git diff --name-only cea3726 --` on all four returns nothing) — they carry M1 changes only. `git diff --check` clean. Working tree clean apart from this edit and two untracked non-source paths (`.playwright-mcp/`, `docs/BUILD-BRIEF-edit-mode.md`). Version stays **3.21.1** — nothing released.
- **The identity mechanism, in two sentences.** The column axis is read from the machine's own hidden `{machine}fields` and `{machine}data` inputs — resolved **document-scoped**, not through the table's mini-form — and correlated against the rendered header labels and sample row texts by a monotone label-affinity match that must have a **unique optimum** or the whole axis declines. That axis is derived once on a **native** DOM, pinned for the mount's lifetime, and never re-derived while our own column order is applied. Full statement: spec **Amendment 1 §A1.2**; predicate redefinitions §A1.3; fail-closed additions §A1.4.
- **The storage schema did not change.** `STORAGE_KEY` remains `suiteMateV3EditColumns` and `STORAGE_SCHEMA_VERSION` remains `1`, on the same container/`grids` doctrine M1 shipped. The frozen contract went **37 → 51** names: 37 → 50 across Tasks 1-5, then 50 → 51 when Task 6a added `readColumnIdsFrom` under adjudication #13.
- **Fixture round-trip.** T5 harness at `f87cb13`: **14/14** green, 0 console errors — including the new **MOUNT** (`bound=true`, 1 owned node), **AXIS**, **AXIS SURVIVES REPAINT** and **AXIS PINNING** checks. Re-run at `dd8143a` with the adversarial fixture: **13/13** green, 0 console diagnostics, every T5 check retained (regrouped) plus the new **BOUNDARY** check, and re-run again end-to-end with a cache-busting query after both mutations were restored — 13/13 again. AXIS PINNING evidence: control marker `true`; permuted marker `false`, permuted axis `[]`, still bound; restored → identical ids; writes `0`.
- **Live re-probe — MOUNT PASS at `dd8143a`** (account `6998262`, SO `id=16342809&e=T`, ~09:13-09:22 AEST; safety triple verified at pass start; **no line opened, no column permuted, no save**). Live-proven: **bound = 1** container (the item machine's `.uir-machine-table-container[data-suitemate-v3-edit-grid-bound]`), **owned nodes = 1**, both stable across 700 ms; **predicates** — entry row present, id-less and focused, with **zero** numbered rows carrying focused classes, i.e. `isLineOpen` false; **coexistence** — 0 so-columns and 0 form-views nodes in Edit Mode; **console** — 0 errors, 0 warnings across the whole pass.
- **The 43-id axis was proven NODE-SIDE, not read live.** The isolated-world `SuiteMateV3EditGridCore` global is unreachable from the MAIN world, so the probe's direct read was unavailable as written. What was done instead: the committed core was run against the T6 live capture (`.superpowers/sdd/2026-08-02-m15-identity-amendment/m15-t6-live-capture.json`), whose `itemfields`/`itemdata`/labels/row-texts are **byte-identical** to the payload T1 was proven against. Re-derived again at T7: 154 machine fields → 140 candidate columns → **43 ids, 43 unique** —
  `["item","quantitycommitted","quantityfulfilled","quantitybilled","quantitybackordered","quantityavailable","quantity","units","description","price","custcol_rrp","rate","amount","taxcode","taxrate1","class","commitmentfirm","orderpriority","grossamt","tax1amt","quantityallocated","orderallocationstrategy","requesteddate","expectedshipdate","inventorydetail","isclosed","options","createpo","excludefromraterequest","custcol_online_oversell","costestimatetype","costestimate","allocationalert","dayslate","custcol_item_shipper_qty","custcol_item_origin","custcol_salesorder_tun_qty","custcol_custom_original_quantity","custcol_hs_code","custcol_anx_order_line","custcolsd_closure_reason","custcol_anx_mco_line_id","custcol_mcol_mystery_original"]`.
  The P-MONO converse was checked and **passes**: all 43 ids are strictly increasing in `itemfields` order. **Making this axis readable from the MAIN world — a debug-flag axis stamp, or an isolated-world read — is a precondition of M2's first live pass**, where the axis starts keying storage.
- **Zero idle writes was proven BY CODE, not by the live probe.** `chrome.storage` is invisible from the page context, so the counter could not be read live; the DOM-stability proxy (bound/owned unchanged across 700 ms) is all the probe gives. The code proof stands independently: the runtime contains no `.set(` on the install path, `enqueueSave` is callerless, and install only reads. Fixture-side, `editGridWrites` is `0` at mount and stays `0` across regenerate / add / open / close plus 500 ms.
- **Header shape, corrected.** Both live loads recorded `div.listheader` **present (43)** with `data-column-type` / `data-label` attributes. The first transcript's "0 / bare text confirmed" line was a captain bookkeeping error, corrected in `probe-transcripts.md` per the T6 verdict. **Only the wrapped header shape has ever been observed live**; the HTML fixture's bare-text headers model a shape never seen live, and that live branch of `readHeaderLabels` is covered by the `wrappedHeaders` unit stub only. Fixture header parity is backlogged.
- **Tier-4 View Mode sweep — PARTIALLY discharged** (view URL, so-columns 55 nodes, 0 edit-grid nodes; owner's real data in scope, reverse-interaction teardown only). **EXERCISED-PASS at computed level:** sort (A-Z applied, then cleared with native order byte-restored), filter (8 rows to `display:none`, then cleared to 9 visible), hide/show (48→47 visible cells, then restored via the unhide chip), personalize mode (entered on hide, exited via Done, verified at computed level — an initial text-grep read was wrong and was caught in-pass, the `:973` state-vs-pixels trap). **OBSERVED-PASS:** tab titles (smart format active in both modes) and column widths (the owner's saved 79 px applies on load and **re-applies after reload**). **Console across the entire sweep: 0 errors, 0 warnings.**
- **STILL OWED from Tier-4, four items, re-owed explicitly** — M1's Next item 7 is **not** logged complete: (a) **Export view** — the captain probed the wrong hook; the real one is `data-suitemate-v3-action="csv-utils-export"` and its route **is** satisfied on this page, so the "not present" reading does not stand; (b) **internal-id badges** — `showInternalIds` was off, so 0 badges is not evidence; (c) **drag-reorder** — the captain's pointer attempts could never have worked, because the handlers are `dragstart`/`dragover`/`drop` and need a synthesized `DragEvent` with a `DataTransfer`; header order was verified unperturbed after both attempts; (d) **interactive resize** — not exercised, and pointer-synthesizable.
- **Owner data delta: ZERO for every exercised surface**, reload-verified — width back at 79 px, sort byte-restored to native order, filter cleared to 9 visible, hide reversed, no chips, personalize exited. This claim is scoped to the exercised surfaces and says nothing about the unexercised ones.
- **Anomalies, adjudicated.** (1) The hidden-column chip carried a **0×0 bounding rect while functional** during active Personalize mode — this is a **real defect** in so-columns' `renderHiddenChips` gating and is backlogged with a repro (`wrap.hidden` + computed display + the personalizing flag). (2) An **80 px** width read mid-personalize did not persist (79 px after reload) — explained by the collapsed-border delta plus personalize ghost columns; no write is possible while personalizing, so nothing is owed. (3) The `listheader` discrepancy was **bookkeeping only**, corrected above.
- **What is now proven live that was not before: attachment on the real machine.** The M1 entry's disclaimer (`:1255`, "Not proven live: attachment and re-render survival — FIXTURE-PROVEN ONLY") is superseded **only** to the extent this pass exercised it — mount, and the bound/owned stability proxy. **Re-render survival across a commit remains fixture-proven only**, because this pass opened no line. **Axis pinning remains fixture-proven only**, because the live pass permuted no column.

### Gate A′ and identity status

- **Gate A′ is still owed and still blocks M4.** It is defined in spec §A1.6 around the **pin**, not around re-derivation: mount on a native DOM and pin the axis; apply a stored non-native order; open and commit a line so the machine regenerates the whole `<tbody>` in native order; confirm the runtime re-applies using the **pinned** axis and did **not** re-derive while permuted; read every visible cell against the pinned mapping; and read the model back through `nlapiGetLineItemValue` for the committed line and one adjacent line. It passes only if every value sits under its pinned column id **and** no value moved columns in the model.
- **P-MONO / U6 is the highest carried risk.** The correlator is correct only while rendered column order is a **monotone subsequence** of `{machine}fields` order. It holds on the one probed form and the converse check passed live, but **P-MONO cannot be checked from the DOM**. Our own violation is closed by construction through pinning; a *form's* violation is not — a custom Sales Order form whose sublist layout order differs from its field order would mis-key **silently**, producing 43 well-formed, unique, wrong ids, and persist them. No generalization beyond the probed form ships without re-verifying P-MONO on the target form.
- **Carried gaps.** The **entry row is no longer treated as an open line**, so M2/M3 must decide the entry-row dirtiness question deliberately before wiring the first apply — `isDirty()`/`forcedRows()` still count the permanent entry row through an unqualified `FOCUSED_ROW_SELECTOR`, which the reviewer reframed as the natural *closure* of that gap (typing reads as dirty) rather than a bug. **Page-scope disclosure ships untested** — this record has 9 lines and no pagination. **Locale portability declines by design** (U7). **A machine with no rendered lines declines to mount** (the Task 1 fix-round gate). Decoded span ids are **not** proof of a column — `actionbuttons_item_item` decodes non-null by design, so M2+ must intersect decoded ids with the pinned axis; and callers must never blind-pipe `rowLineNumber` into `columnIdFromSpanId`, because a `null` means *either* genuinely line-less *or* a malformed numbered id, and only the former may decode line-lessly.
- **Feature-status deltas: none new.** Amendment §A1.6's three amended rows are already recorded in the spec.

### Next: M2 preconditions

M1's condition **(6)** — "one live re-probe showing `bound=true` with zero idle writes" — is **MET**: mount is live-proven, and the zero-idle-writes half is discharged by code inspection rather than by the probe (see above). M1's condition **(7)** — the full Tier-4 sweep — is **PARTIALLY** discharged and is **not** logged complete. All of the following are binding before M2's first apply:

1. **MAIN-world-readable axis evidence** — a debug-flag axis stamp readable from the MAIN world, or an isolated-world read — landed **before** M2's first live pass, because that is where the axis starts keying storage.
2. **Close the four re-owed Tier-4 items**, or re-own them explicitly again: Export view (via `data-suitemate-v3-action="csv-utils-export"`), internal-id badges (toggle on), drag-reorder (synthesized `DragEvent` + `DataTransfer`), interactive resize.
3. **`applyAll` empty-axis guard** — the `currentColumnIds` read on the latched-install path (`runtime.js:326`, feeding `applyAll` at `:334`; the ledger recorded this as `installEditGrid:304`, before Task 6a shifted the line numbers) has no length guard. Inert today, because identical render/target signatures early-return at `:327`, but `applyAll(table, [])` becomes reachable on a latched install once `targetSignature` diverges. Close before wiring the first apply.
4. **The M4 ordering contract** — set `appliedOrder` **before** permuting the DOM, clear it only **after** the native restore; Gate A′ depends on it. `appliedOrder = []` refuses derivation by truthiness (fail-closed) and must **never** be used as a native sentinel.
5. **Decide entry-row dirtiness deliberately** (see Carried gaps).
6. **Upgrade slice tests to behavioral tests** where M2 gives them real callers. The six seams M1 recorded as caller-less are `fieldIsDirty`, `isLineOpen`, `forcedRows`, `queueApply`, `applyAll` and `enqueueSave`; two of them (`fieldIsDirty`, `isLineOpen`) carry M1 slice-test coverage only, and the remaining **four** (`forcedRows`, `queueApply`, `applyAll`, `enqueueSave`) have zero coverage today.
7. **Close `enqueueSave`'s rejected-queue handling and reset `saveQueue` on teardown** — carried from M1 as "MUST close before M2 wires the first writer".
8. Smaller carried items due at M2: the `readColumnIdsFrom` selector-injection guard — the bare-identifier regex test at `runtime.js:139`, which gates the machine id before it is spliced into the selectors at `:134-135` — is untested while `MACHINE_TABLE_SELECTOR` stays literal; one assertion, or `CSS.escape` as internal-ids does. (The ledger's deferred minor cites this as `runtime.js:135`, which is the bare-name fallback query — an injection **sink**, not the guard; corrected here and in the ledger's T7 append (`progress.md:37` itself still carries the original `:135`).) The fixture round-trip harness still has no committed home and lives in two report appendices that have already diverged once; and M2 re-adds the two elided harness checks (console diagnostics, duplicate ids).

**Backlog (post-feature, not M2-blocking):** the so-columns `renderHiddenChips` zero-rect chip defect; fixture header parity with the live wrapped shape; and the View Mode delete-path quota wipe found during M1, which belongs on a separate branch.
