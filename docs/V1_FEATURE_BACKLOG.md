# SuiteMate V1 feature backlog for V3

This backlog was derived only from `/Users/Bivek.Shah/Documents/suitemate/suitematev1`.

## Release gate

No nonstyling feature should be implemented until the V3 styling smoke test passes. Until then, feature work is limited to analysis, interfaces, fixtures, and backlog preparation.

V1 is a behavior reference, not a safe code foundation. Its large runtime bundles couple unrelated features, `settings.js` contains duplicated bundled content, and some referenced dependencies are absent. Features must be rebuilt individually behind flags.

## Shared foundation required after styling approval

1. Versioned settings schema and migrations.
2. Feature registry with independent enablement and failure isolation.
3. Route and page-capability registry.
4. Strict content-script to main-world bridge for NetSuite APIs.
5. Reusable DOM observers with explicit cleanup.
6. Optional-permission broker.
7. Shared clipboard, CSV, download, and notification utilities.
8. Classic and Redwood fixtures for every supported page type.

## Prioritized features

| Priority | Feature | V1 evidence | Value | Complexity | Risk and dependencies |
| --- | --- | --- | --- | --- | --- |
| 1 | Developer IDs toolkit: reveal record, field, sublist, button, and subtab IDs; search field IDs; export fields | `netsuite.js:2779-2842`, `serviceworker.js:283-324` | Very high for NetSuite developers and administrators | Medium to large | Needs route detection, a command registry, main-world field discovery, and Sales Order fixtures |
| 2 | Settings backup, validated import, reset, and migration | `settings.html:399-459`, `settings.js:707-745` | Protects configuration and enables safe V3 upgrades | Medium | Low risk only after the V3 settings schema is versioned |
| 3 | Automatic script ID generation with configurable prefix | `netsuite.js:2535-2572`, setting description at `settings.js:167` | High daily value for developers | Medium | Must never overwrite a manually edited ID; needs field-pair and input tests |
| 4 | Read-only developer actions: View XML, copy generic URL, copy menu path, send record or search to console | `netsuite.js:1865-1902`, `netsuite.js:2887-2935` | High value with limited scope | Medium | Needs clipboard, URL normalization, route checks, and a controlled main-world bridge |
| 5 | JSON and XML formatting with syntax highlighting, line numbers, format, and copy | `netsuite.js:618-817`, `settings.html:185-233` | High for logs, exceptions, and long-text fields | Large | Requires safe rendering, size limits, themes, and observer cleanup |
| 6 | List productivity, delivered separately: Copy CSV first, Live View later | Copy and export logic around `netsuite.js:892-1014` and `netsuite.js:2114-2193`; Live View at `netsuite.js:3225-3288` | High operational value | Medium for CSV, large for Live View | Live View can interrupt users and needs visibility checks, pause-on-hover, timer cleanup, and strict route allowlists |
| 7 | Global shortcuts and shortcut import or export | `settings.html:348-397`, `settings.js:772-837`, `netsuite.js:2020-2050` | High for repeated cross-account navigation | Medium to large | Requires validated URLs, ordered storage, and a stable menu adapter |
| 8 | Saved Search toolkit in increments: recent searches, quick type selector, duplicate criteria or result rows, Run without Save, then Split View | `netsuite.js:2052-2111`, `netsuite.js:4315-4621` | Extremely high for consultants and administrators | Large to extra large | Search editor DOM and submission behavior are fragile; each increment needs isolated fixtures |
| 9 | Record Inspector side panel with fields, sublists, related records, filtering, copy, and SuiteScript snippets | `sidepanel.js:17-83`, `sidepanel.js:225-325`, `serviceworker.js:760-989` | One of V1's strongest developer tools | Extra large | Needs Side Panel, record and query adapters, bounded serialization, permissions handling, and large-record safeguards |
| 10 | Context menu tools: search selected text, edit linked record, inspect current record | `serviceworker.js:1395-1438` | High discoverability and good daily value | Medium | Needs optional `contextMenus` permission; Inspect depends on Record Inspector |
| 11 | Recent accounts, role switching, edit-role shortcut, omnibox search, and Help search | `serviceworker.js:59-117`, `netsuite.js:1911-2017`, `serviceworker.js:1447-1655` | High for multi-account consultants | Large | Adds bookmarks and omnibox concerns, authenticated navigation, privacy constraints, and redirect risk |
| 12 | SuiteQL Studio in layers: execute, abort, paging, results, CSV, variables, saved queries, and table inspection | `netsuite.js:6141-7518`, `nlapi.js:118-169` | Potentially the highest strategic value | Extra large | Very high query, performance, permission, and data-exposure risk; build only after the bridge is mature |
| 13 | File Cabinet and script-development tools: folders, file paths, previews, logs, Live Log, and deployment analysis | `netsuite.js:4680-5687`, `netsuite.js:8126-8292`, `netsuite.js:9325-9720` | Very high for developers | Extra large | Many page-specific selectors and state-changing operations; needs route adapters and preview limits |
| 14 | Admin tools: feature and preference exports, role permission comparison or bulk edit, bundle tools, Record Catalog export | `netsuite.js:3774-3870`, `netsuite.js:7818-8125`, `netsuite.js:8822-8860` | High but narrower audience | Large to extra large | Read-only exports must come first; permission mutations belong near the end because selector errors can change account governance |

## Parallel-safe implementation packets

After the styling gate and shared interfaces are frozen, these packets can be developed independently:

1. Settings backup, import, reset, and migration.
2. Read-only URL, XML, console, and Help actions.
3. Automatic script ID generation.
4. JSON and XML formatter.
5. Copy CSV.
6. Small isolated interactions such as checkbox range selection, calendar wheel navigation, and banner dismissal.
7. Optional-permission broker and context-menu registration.

Do not parallelize the Header Menu, Record Inspector, Live View, Saved Search editor changes, or SuiteQL Studio before the shared bridge and lifecycle contracts exist. They touch the same risky runtime surfaces and would create conflicting implementations.

## Defer or reject initially

- ExtPay, subscription, trial, install, terms, and commercial plumbing.
- External Google Apps Script organization flows.
- External SuiteQL libraries until ownership, privacy, and availability are reviewed.
- Obscure page-specific patches without proven user demand.
- Role permission mutation before read-only permission tools are stable.

## Delivery rule

Implement one isolated capability at a time behind a feature flag. Each capability must include fixtures, failure isolation, cleanup, a focused smoke test, and a rollback point before the next capability begins.
