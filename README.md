# SuiteMate V3

SuiteMate V3 starts with one job: reproduce the SuiteMate V1 NetSuite visual styling accurately and safely.

## Current scope

- V1 core NetSuite styles
- V1 page-specific styles
- Light, dark, and system appearance modes
- Original rounded and boxy corner treatments
- V1 Main and Secondary colors scoped to each NetSuite role
- V1 color-derived light and dark theme variants
- Main controls the primary sublist bar and active tab accents; Secondary controls field-group and table surfaces
- Immediate Main and Secondary color preview with throttled `chrome.storage.sync` persistence

This foundation intentionally excludes table tools, SuiteQL, side panels, record inspection, licensing, payment code, and all other product features.

## Source boundary

The 15 V1 CSS sources under `src/styles` are copied byte-for-byte from `../suitematev1` and protected by hash checks. `src/styles/v3-compat.css` contains only the live NetSuite compatibility corrections identified during V3 testing. V3 does not execute V1 feature scripts.

The popup uses `activeTab` only to ask the current NetSuite tab for its account and role identity. Theme colors are saved against that role identity in `chrome.storage.sync`, matching V1's role-specific behavior.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this `suitematev3` folder.
5. Open NetSuite and reload the page.

## Verification

Run:

```sh
npm test
```

Do not add features until the smoke-test checklist in `docs/SMOKE_TEST.md` passes.

The V1-derived feature sequence is documented in `docs/V1_FEATURE_BACKLOG.md`. It is planning material only until the styling gate passes.
