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
- SuiteQL Console on `/app/common/search/ubersearchresults.nl?suiteql`
- Locally bundled CodeMirror SQL editor with per-tab drafts and resize persistence
- Authenticated V1-style SuiteQL execution, optional progressive paging, sorting, loaded-row CSV export, and table inspection
- SuiteSense link for generating SuiteQL from plain English

Saved queries, query history, variables, datasets, special result rendering, multi-tab query workflows, and Export All remain deferred.

## Source boundary

The 15 V1 CSS sources under `src/styles` are copied byte-for-byte from `../suitematev1` and protected by hash checks. The V3-owned `src/styles/radii.css` and `src/styles/v3-compat.css` files contain the live NetSuite compatibility corrections identified during V3 testing. V3 does not execute V1 feature scripts.

The popup uses `activeTab` to read the current NetSuite role identity and open SuiteQL Console on the same account domain. Theme colors are saved against that role identity in `chrome.storage.sync`, matching V1's role-specific behavior. Main and Secondary each open a SuiteMate-owned modal containing saturation, brightness, hue, hex, and locally generated Material shade controls. Adjustments retain the existing live NetSuite preview and throttled save behavior. Only the selected Main and Secondary hex values are stored.

Privileged NetSuite operations use one versioned runtime protocol with allowlisted commands, exact route and top-frame sender checks, typed payload validation, bounded client timeouts, abort handling and response identity checks. SuiteQL execution, record type lookup and Import Assistant field updates share this protocol while keeping their feature-specific NetSuite adapters isolated in the service worker.

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
