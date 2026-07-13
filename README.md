# SuiteMate V3

SuiteMate V3 starts with one job: reproduce the SuiteMate V1 NetSuite visual styling accurately and safely.

## Current scope

- V1 core NetSuite styles
- V1 page-specific styles
- Light, dark, and system appearance modes
- Original rounded and boxy corner treatments
- Live styling changes through `chrome.storage.sync`

This foundation intentionally excludes table tools, SuiteQL, side panels, record inspection, licensing, payment code, and all other product features.

## Source boundary

The CSS under `src/styles` is copied byte-for-byte from `../suitematev1`. V3 does not execute V1 feature scripts. `src/runtime/theme-runtime.js` only supplies the document state that the styles require.

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
