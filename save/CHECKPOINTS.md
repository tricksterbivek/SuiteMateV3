# SuiteMate V3 Checkpoints

This file records verified development baselines. New feature work must not begin until the preceding checkpoint has passed automated tests, live NetSuite verification, pull request review and release publication.

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
