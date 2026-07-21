# SuiteMate V3 Checkpoints

This file records verified development baselines. New feature work must not begin until the preceding checkpoint has passed automated tests, live NetSuite verification, pull request review and release publication.

## v3.11.0: Regression Fixtures

Status: Awaiting authenticated smoke test

Date: 2026-07-21

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
- Authenticated dashboard, SuiteQL Console, normal search and record action checks remain pending after extension reload.

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
