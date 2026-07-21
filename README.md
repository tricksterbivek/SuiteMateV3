# SuiteMate V3

SuiteMate V3 restores the SuiteMate V1 NetSuite visual system and adds focused developer tools on top of that stable foundation.

## Current scope

- V1 core NetSuite styles
- V1 page-specific styles
- Light, dark, and system appearance modes
- Original rounded and boxy corner treatments
- V1 Main and Secondary colors scoped to each NetSuite role
- V1 color-derived light and dark theme variants
- Main controls the primary sublist bar and active tab accents; Secondary controls field-group and table surfaces
- Immediate Main and Secondary color preview with throttled `chrome.storage.sync` persistence
- Unified Main and Secondary color picker with live HSV controls, hex editing, and dynamic Material shades
- Versioned shared UI command registry for popup, record, and SuiteQL Console actions and shortcuts
- Versioned optional permission broker with a closed Chrome capability allowlist
- Versioned shared utility core for errors, colors, byte limits, CSV, filenames, JSON and browser-safe adapters
- SuiteQL Console on `/app/common/search/ubersearchresults.nl?suiteql`
- Locally bundled CodeMirror SQL editor with per-tab drafts and resize persistence
- Authenticated V1-style SuiteQL execution, optional progressive paging, sorting, loaded-row CSV export, and table inspection
- SuiteSense link for generating SuiteQL from plain English

Saved queries, query history, variables, datasets, special result rendering, multi-tab query workflows, and Export All remain deferred.

## Source boundary

The 15 V1 CSS sources under `src/styles` are copied byte-for-byte from `../suitematev1` and protected by hash checks. The V3-owned `src/styles/radii.css` and `src/styles/v3-compat.css` files contain the live NetSuite compatibility corrections identified during V3 testing. V3 does not execute V1 feature scripts.

The popup uses `activeTab` to read the current NetSuite role identity and open SuiteQL Console on the same account domain. Theme colors are saved against that role identity in `chrome.storage.sync`, matching V1's role-specific behavior. Main and Secondary each open a SuiteMate-owned modal containing saturation, brightness, hue, hex, and locally generated Material shade controls. Adjustments retain the existing live NetSuite preview and throttled save behavior. Only the selected Main and Secondary hex values are stored.

Privileged NetSuite operations use one versioned runtime protocol with allowlisted commands, exact route and top-frame sender checks, typed payload validation, bounded client timeouts, abort handling and response identity checks. One closed data adapter constructs the fixed NetSuite requests for SuiteQL, constrained Saved Search execution, bounded record metadata, record type lookup and Import Assistant context. Content scripts cannot supply arbitrary URLs, request methods, headers, RPC methods, AMD modules or request bodies.

User-facing actions use a separate immutable command registry. Stable command IDs define labels, descriptions, surfaces, route capabilities, settings requirements and platform-aware shortcuts. Per-surface scopes own availability, invocation, re-entry, failure isolation and cleanup. Popup appearance actions, contextual CSV Import and SuiteQL Console controls use this registry without coupling UI commands to the privileged NetSuite transport protocol.

Optional Chrome access is centralized in one immutable broker for bookmarks, context menus, history and Side Panel capabilities. The broker accepts only registered permission IDs, reads live state from Chrome, starts requests inside the originating extension-UI user gesture, serializes mutations, handles addition and revocation events, and invalidates stale work after disposal. It is loaded only in extension-owned popup and service-worker contexts and is not injected into NetSuite pages.

No dormant optional permission is declared in the manifest. Chrome Web Store policy applies the minimum-permission rule to optional permissions, so each permission must be added only with its first user-facing consumer. Permission mutations belong to the extension UI that receives the direct user gesture. The service worker may inspect state or subscribe to changes, but it must not independently request or remove access. The Promise-based broker requires Chrome 96 or later. A future Side Panel consumer must enforce Chrome 114 or later when that capability ships.

Shared utilities are split by execution context. The pure core has no DOM, Chrome or network dependency and owns bounded error normalization, deep freezing of SuiteMate-owned data, hex normalization, UTF-8 sizing, formula-safe CSV, filename safety and bounded JSON formatting. Browser adapters receive their capabilities explicitly and own clipboard writes, Blob downloads, extension notices, modal focus and inert state, and text-only XML formatting. They do not request permissions, make network requests, render arbitrary HTML or use the broad Chrome downloads API.

SuiteQL Console uses the shared CSV, download and notice paths without changing its public behavior or export format. The popup color picker uses the shared modal and notice lifecycle while retaining the same live preview, final-value flush, backdrop, X, Done and Escape behavior. Native NetSuite alert dismissal remains separate because it operates on NetSuite-owned UI rather than SuiteMate notices.

The adapter executes only in the authorized top-frame document, verifies the exact account origin and route again in NetSuite's main world, blocks redirects and cross-account responses, enforces response-size and operation limits, and normalizes failures into typed errors. Import Assistant writes remain separately validated and atomic.

SuiteQL execution is isolated behind the extension service worker and runs in the current NetSuite tab through NetSuite's internal `PlatformClientScriptHandler.nl` `queryApiBridge`, matching the SuiteMate V1 execution model. Requests use only the active authenticated NetSuite session. Query results are rendered only as text and are not sent to external services.

The query bridge is an undocumented NetSuite interface. SuiteMate V3 detects bridge failures and keeps the execution adapter isolated so it can be updated when NetSuite changes the internal contract. Release Preview testing is required before each NetSuite release.

Paged bridge metadata does not expose an exact row total. Studio reads the final NetSuite page once to calculate the total count, but it does not add that page to the displayed or exported rows until the user explicitly loads it.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this `suitematev3` folder.
5. Open NetSuite and reload the page.

After dependency changes, rebuild the bundled editor before reloading the extension:

```sh
npm install
npm run build
```

## Verification

Run:

```sh
npm test
```

Run the styling and SuiteQL checks in `docs/SMOKE_TEST.md` before treating the current state as a release baseline.

The master V1 feature inventory is saved at `save/SUITEMATE_V1_MASTER_FEATURE_INVENTORY.md`.
