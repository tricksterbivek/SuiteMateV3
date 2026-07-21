# SuiteMate V1 Remaining Feature Inventory

Status: Master backlog for SuiteMate V3 feature planning
Source boundary: `/Users/Bivek.Shah/Documents/suitemate/suitematev1` only
Audit date: 2026-07-13
Backlog refresh: 2026-07-20
Coverage: 44 recovered files, 28,232 source lines and 87 route cases

## Purpose

This is the canonical inventory for selecting the next SuiteMate V3 features. It contains only work that is not yet implemented. Stable ID gaps are intentional because completed features have been removed from the active backlog.

## Implemented V3 baseline excluded from this backlog

- Complete SuiteMate V1 styling foundation, including global NetSuite surfaces, page styles and Redwood compatibility corrections.
- `THM-01`: Per-role Main and Secondary colors with immediate preview.
- `THM-04`: Swap colors, restore default colors and remove the current role configuration.
- `THM-05`: Light, Dark and System appearance modes.
- `SET-02`: Rounded and Boxy UI modes.
- `SET-06` and `SET-07`: Sticky first sublist column and generated sublist line numbers. V3 activates the protected V1 CSS capabilities while styling is enabled.
- `GEN-28` and `GEN-39`: Header scroll shadow and responsive textarea sizing supplied by the active V1 CSS layer.
- `FND-01`: Immutable route capability registry with shared host, route, frame, environment and privileged sender policies.
- `FND-02`: Shared observer lifecycle with deduplicated registration, one native observer, capability gating, bounded waits, deterministic cleanup and stale-generation protection.
- `FND-03`: Versioned settings schema with legacy migration, typed compatibility errors, Chrome sync quota protection and safe failure handling.
- `FND-04`: General typed NetSuite bridge with one versioned command registry, command-specific schemas, route and document authority, response identity checks, timeouts, cancellation and duplicate-request protection.
- `FND-05`: Closed NetSuite data adapter for SuiteQL, constrained Saved Search execution, bounded record metadata and authenticated Import Assistant category lookup.
- `FND-06`: Immutable shared UI command framework with stable command identity, metadata, availability, platform-aware shortcuts, invocation, re-entry, failure isolation and per-surface lifecycle ownership.
- `FND-07`: Optional permission broker with a closed Chrome capability allowlist, direct user-gesture requests, live state, mutation serialization and deterministic disposal.
- `FND-08`: Versioned shared utility core and capability-injected browser adapters for errors, colors, UTF-8 limits, CSV, filenames, clipboard, downloads, notices, modal lifecycle and safe JSON/XML text formatting.
- `FND-09`: Route-complete Classic regression catalog, deterministic DOM contracts, 26 screenshot baselines and retained Redwood record and SuiteQL visual checks.
- `SET-14`: Versioned UTF-8 settings export and import with strict validation, overwrite confirmation, atomic Chrome sync persistence and rollback-safe popup state.
- `SQL-01`, `SQL-02`, `SQL-03`, `SQL-13` and `SQL-14`: SuiteQL Console shell, execution, progressive paging, abort handling, safe result rendering, sorting, client pagination, hidden table inspection support, selection execution and persistent resizing.
- Core portions of `SQL-05` and `SQL-06`: loaded-row CSV export, Clear Results, Execute, Abort, Paged toggle and their current keyboard shortcuts.
- Per-tab SuiteQL draft and Paged-mode persistence, 5,000-row warnings, SuiteSense promotion and popup launch into the active NetSuite account.

`SET-15`, `SQL-05` and `SQL-06` remain below only for their unfinished portions.

## Source integrity warning

The recovered V1 directory is not a complete loadable extension:

- `manifest.json` is missing.
- `ExtPay.js` is referenced but missing.
- `tribute.min.js` is referenced but missing.
- `changelog.txt` is referenced but missing.
- `terms.html` is referenced but missing.
- `settings.js` contains the same compiled bundle twice.
- `suitecommerce.js` is empty and `suitecommerce.css` contains no implementation.
- `netsuite.js` is a compiled 10,208-line monolith.
- Several capabilities use undocumented NetSuite globals, internal endpoints and private UI modules.

Migration labels:

- **Direct:** Recreate the behavior cleanly in V3. Do not copy the compiled bundle.
- **Adapt:** Preserve the behavior but rebuild the NetSuite, browser or DOM integration.
- **Rebuild:** Treat as an independent module or product-sized feature.
- **Drop:** Do not migrate without a separate business decision.

Complexity: **S**, **M**, **L**, **XL**.

Priority:

- **P0:** Shared foundation required before behavioral features.
- **P1:** Strongest next candidates.
- **P2:** Valuable second wave.
- **P3:** Major standalone modules.
- **P4:** Brittle, niche or mutating administration features.
- **P5:** Defer or remove.

## Recommended implementation order

1. IDs toolkit.
2. Automatic script ID generation.
3. Enhanced Field Help.
4. General sublist productivity controls.
5. JSON and XML formatting.
6. View XML, Copy Generic URL and Copy Menu Path.
7. Global Shortcuts.
8. Small Saved Search editing helpers.
9. Record Inspector.
10. Context menu actions.
11. Dashboard and execution-log monitoring.
12. Saved Search Split View.
13. File Cabinet tools.
14. Script execution and runtime tooling.
15. Role permission administration.

## 1. Required V3 foundation

No foundation features remain. All `FND-01` through `FND-09` checkpoints are implemented.

## 2. Theme and settings

| ID | Feature | Description | Complexity | Dependencies | Migration | Priority |
|---|---|---|---:|---|---|---:|
| THM-02 | Rainbow theme | Continuously cycles theme colors when enabled. | M | Theme runtime, reduced-motion support | Adapt | P2 |
| THM-03 | Logo-derived palette | Generates color suggestions from the company logo. | M | Logo access, palette extraction | Adapt | P3 |
| THM-06 | Code syntax themes | Seventeen JSON, XML and CodeMirror themes with line numbers. | M | Formatter, editor adapter | Direct | P1 |
| SET-01 | Privacy and header controls | Hide company information, Feedback, Redwood strip and environment roles. | S | CSS classes, header adapter | Direct | P1 |
| SET-03 | Disable sublist tooltips | Prevents native sublist hover tooltips. | S | CSS and DOM verification | Direct | P1 |
| SET-04 | Disable Guided Learning | Hides the Guided Learning launcher. | S | CSS selector | Direct | P1 |
| SET-05 | Indicate submenus | Adds visual submenu indicators to center navigation. | S | Header selectors | Direct | P1 |
| SET-08 | List View Shift control | Enables or disables native vertical list shifting. | S | CSS selector | Direct | P1 |
| SET-09 | Collapse unrolled records | Automatically collapses subtabs in unrolled view. | M | Record DOM adapter | Adapt | P2 |
| SET-10 | Scoped enable and disable | Disable SuiteMate by account, role, tab or page. | M | Settings and route identity | Adapt | P2 |
| SET-11 | Timing controls | Refresh intervals for lists, logs and dashboard portlets. | S | Live View engine | Direct | P2 |
| SET-12 | Auto-dismiss timing | Configurable alert dismissal with hover pause. | S | Banner observer | Direct | P1 |
| SET-13 | Global Shortcuts editor | Create, reorder, edit, delete and capture shortcuts. | M | Header menu, URL validation | Adapt | P1 |
| SET-15 | Clear cached NetSuite context | Clears cached account, role and route data without resetting appearance settings. Reset All is already implemented. | S | Storage framework | Direct | P1 |
| SET-16 | View XML preference | Open XML in a new tab or window. | S | View XML command | Direct | P2 |
| SET-17 | Open popups as tabs | Converts NetSuite popup windows into browser tabs. | M | Chrome tabs and windows | Adapt | P3 |
| SET-18 | Changelog viewer | Local changelog parser with versions and issue links. | M | Missing changelog source | Adapt | P5 |
| SET-19 | Videos and help pages | Playlist, review, discussions, issues and social links. | S | External URLs | Drop | P5 |

## 3. Cross-page navigation and productivity

| ID | Feature | Description | Complexity | Dependencies | Migration | Priority |
|---|---|---|---:|---|---|---:|
| GEN-01 | SuiteMate header menu | Adds the main command menu to NetSuite navigation. | L | Private header model, commands | Adapt | P2 |
| GEN-02 | Role switching enhancements | Open current page under another role and edit roles. | M | Role identity, header adapter | Adapt | P2 |
| GEN-03 | Recent Accounts menu | Shows recently used NetSuite accounts. | M | Bookmarks permission | Adapt | P2 |
| GEN-04 | Recent Saved Searches | Recent search list with edit and view actions. | M | Authenticated search request | Adapt | P2 |
| GEN-05 | Recent Records | Header navigation to recently accessed records. | M | Recent-record page | Adapt | P2 |
| GEN-06 | My Employee Record | Opens the current user Employee record. | S | Session identity | Adapt | P1 |
| GEN-07 | Copy Generic URL | Removes account-specific and temporary URL data. | S | URL normalizer | Adapt | P1 |
| GEN-08 | Copy Menu Path | Resolves and copies the NetSuite menu path. | M | Navigation menu data | Adapt | P1 |
| GEN-09 | View XML | Opens the current record XML with a shortcut. | S | Record identity | Adapt | P1 |
| GEN-10 | Send Record to Console | Loads and logs the current record through SuiteScript. | M | Typed bridge, record APIs | Adapt | P2 |
| GEN-11 | Send Saved Search to Console | Loads and logs the Saved Search definition. | M | Typed bridge, search API | Adapt | P2 |
| GEN-12 | Developer Help menu | Help Center, SuiteAnswers, catalogs, API browser and debugger links. | M | Session and record mapping | Adapt | P1 |
| GEN-13 | Recent Help articles | Tracks recently viewed Help Center articles. | M | Local storage, Help route | Adapt | P3 |
| GEN-14 | Global Search path navigation | Resolves File Cabinet paths, object IDs and record IDs. | L | Search adapter, SuiteQL | Adapt | P2 |
| GEN-15 | Global Search prefixes | Page, Search, Entity, Item, Transaction and File modes. | M | Global search adapter | Adapt | P2 |
| GEN-16 | Global Search icons | Adds record-type icons to results. | S | Result DOM adapter | Direct | P2 |
| GEN-17 | Internal IDs toolkit | Reveals record, field, sublist, column, button and subtab IDs. | M | DOM adapter, typed bridge | Adapt | P1 |
| GEN-18 | Search for Field ID | Searches a record form for an internal field ID. | M | IDs toolkit | Adapt | P1 |
| GEN-19 | Export Fields | Exports fields, options and help text. | L | Record API, field help, CSV | Adapt | P2 |
| GEN-20 | Automatic script ID | Generates script IDs from names using a prefix. | M | Form pairing, settings | Direct | P1 |
| GEN-21 | Definition links | Links custom lists, records, fields and Saved Searches. | M | Object recognition | Adapt | P2 |
| GEN-22 | JSON and XML formatting | Formats JSON, XML and error stacks in fields and logs. | L | Safe formatter, observer | Adapt | P1 |
| GEN-23 | Large-value warning | Warns before formatting values over 100 KB. | S | Formatter | Direct | P1 |
| GEN-24 | Clear all filters | Clears every active list filter. | S | List adapter | Direct | P1 |
| GEN-25 | Forced ascending sort | Middle-click or Ctrl-click to sort ascending. | S | List DOM adapter | Direct | P2 |
| GEN-26 | Copy CSV Results | Copies list results to the clipboard as CSV. | M | Pagination, CSV utility | Adapt | P1 |
| GEN-27 | Scroll controls | Scroll to active sublists or code and back to top. | S | DOM adapter | Direct | P2 |
| GEN-29 | Character counters | Live character counts for limited fields. | S | Input metadata | Direct | P1 |
| GEN-30 | Date and time hints | Account-format placeholders and tooltips. | S | NetSuite preferences | Direct | P1 |
| GEN-31 | Persistent field groups | Remembers expanded and collapsed groups. | M | Local storage, DOM adapter | Adapt | P2 |
| GEN-32 | Edit-mode mouse shortcut | Hold lowercase `e` while clicking to edit. | S | Link interceptor | Direct | P2 |
| GEN-33 | Sublist field help | Opens Field Help from sublist headers. | S | Header-to-field mapping | Adapt | P1 |
| GEN-34 | Sublist Refresh | Adds refresh buttons to supported sublists. | S | NetSuite refresh bridge | Adapt | P2 |
| GEN-35 | Sublist navigation | First, Previous, Next, Last and keyboard paging. | M | Pagination state | Adapt | P2 |
| GEN-36 | Save and Edit | Saves and stays in edit mode. | M | Form submission | Adapt | P2 |
| GEN-37 | View Without Save | Switches to view mode without saving. | M | Unsaved-state handling | Adapt | P2 |
| GEN-38 | Persistent selected tab | Stores selected tab in the URL and scrolls tab bars. | M | Tab lifecycle | Adapt | P2 |
| GEN-40 | Description-to-Help mirror | Copies Description into Help on request. | S | Field pairing | Direct | P2 |
| GEN-41 | Dropdown option metadata | Shows option text, value, ID and custom-record icons. | M | Private dropdown adapter | Adapt | P2 |
| GEN-42 | Subsidiary hierarchy | Indents hierarchical subsidiary options. | M | Private dropdown adapter | Adapt | P2 |
| GEN-43 | Bundle filter improvements | Current bundle, names, versions and sorting. | M | Bundle metadata | Adapt | P3 |
| GEN-44 | Default HTML display fix | Corrects default HTML formatting. | S | Form DOM | Direct | P2 |
| GEN-45 | Banner controls | Auto-dismiss, hover pause and click dismissal. | S | Alert observer | Direct | P1 |
| GEN-46 | Shift-click checkboxes | Range selection for Classic and Redwood grids. | M | Click safeguards | Adapt | P1 |
| GEN-47 | Calendar wheel navigation | Mouse wheel changes calendar month. | M | Private calendar adapter | Adapt | P2 |
| GEN-48 | Header account metadata | Sandbox number, first login, account ID and version. | M | Session extraction | Adapt | P3 |
| GEN-49 | Error-page Go Home | Adds a Home action to supported errors. | S | Session home URL | Direct | P3 |
| GEN-50 | Application version history | Tracks account application and version changes. | S | Local storage | Adapt | P4 |

## 4. Browser integrations

| ID | Feature | Description | Complexity | Dependencies | Migration | Priority |
|---|---|---|---:|---|---|---:|
| BRW-01 | Context menu search | Searches selected text in NetSuite. | M | Context menus, URL validation | Adapt | P2 |
| BRW-02 | Context menu Edit Record | Opens recognized record links in edit mode. | M | Context menus, URL parser | Adapt | P2 |
| BRW-03 | Context menu Inspect Record | Opens Record Inspector. | M | Side Panel, inspector | Adapt | P2 |
| BRW-04 | NetSuite omnibox | Global search suggestions from the address bar. | L | Omnibox, authenticated fetch | Adapt | P3 |
| BRW-05 | Help omnibox | Help Center address-bar search. | L | Omnibox, Help requests | Adapt | P3 |
| BRW-06 | SuiteQL omnibox | Detects SuiteQL and opens Studio. | M | Omnibox, Studio | Adapt | P3 |
| BRW-07 | Recent account bookmarks | Maintains a `NetSuite Accounts` bookmark folder. | M | Bookmarks permission | Adapt | P3 |
| BRW-08 | Dynamic extension icon | Generates a per-tab icon from theme colors. | M | Chrome action API | Adapt | P3 |
| BRW-09 | Update badge | Shows update and changelog state. | M | Missing changelog metadata | Adapt | P5 |

## 5. Saved Search and formula tools

| ID | Feature | Description | Complexity | Dependencies | Migration | Priority |
|---|---|---|---:|---|---|---:|
| SRCH-01 | New typed Saved Search | Creates a search from the selected type. | S | Search list adapter | Adapt | P1 |
| SRCH-02 | Set all Summary Types | Applies a summary type across result columns. | M | Search editor adapter | Adapt | P1 |
| SRCH-03 | Duplicate search rows | Make Copy and Copy Previous. | M | Search machine adapter | Adapt | P1 |
| SRCH-04 | Remove All Below | Removes rows below the selected line. | M | Search machine adapter | Adapt | P1 |
| SRCH-05 | Quick Search Type selector | Keyboard-accessible search type chooser. | M | Search type data | Adapt | P2 |
| SRCH-06 | Formula popup improvements | Autofocus and Enter-to-submit. | S | Formula dialog | Direct | P1 |
| SRCH-07 | Formula autocomplete | Functions, fields, joins and HTML patterns. | L | Missing Tribute, metadata | Rebuild | P2 |
| SRCH-08 | Explain Formula | Uses NetSuite text enhancement to explain formulas. | L | Private API, privacy disclosure | Adapt | P4 |
| SRCH-09 | Run Without Saving | Executes current editor state without saving. | M | Search submission | Adapt | P2 |
| SRCH-10 | Split View | Embeds live results below the search editor. | L | Iframe lifecycle, form state | Rebuild | P3 |
| SRCH-11 | Preview controls | Refresh Preview and Save and Preview. | M | Split View | Adapt | P3 |
| SRCH-12 | Quick Report selection | Clicking a report image selects its radio. | S | Report DOM | Direct | P4 |
| SRCH-13 | Item rate synchronization | Synchronizes formatted and raw item rates. | S | Item form DOM | Adapt | P4 |

## 6. File Cabinet suite

| ID | Feature | Description | Complexity | Dependencies | Migration | Priority |
|---|---|---|---:|---|---|---:|
| FILE-01 | Path-based navigation | Resolves file or folder paths. | M | Authenticated lookup | Adapt | P2 |
| FILE-02 | Bundle metadata in tree | Shows bundle names and versions. | M | Bundle metadata | Adapt | P3 |
| FILE-03 | Breadcrumb improvements | Normalizes breadcrumbs and remembers folder state. | M | Folder adapter, storage | Adapt | P2 |
| FILE-04 | Folder Refresh and Live View | Manual or timed folder refresh. | M | Timer lifecycle | Adapt | P2 |
| FILE-05 | PiP uploader | Picture-in-picture drag-and-drop uploads. | L | PiP, upload engine | Rebuild | P3 |
| FILE-06 | Script resources menu | SuiteScript resources and script actions. | M | File recognition | Adapt | P2 |
| FILE-07 | Drag-and-drop uploads | Drop files onto lists or tree folders. | L | Upload engine, folder mapping | Rebuild | P3 |
| FILE-08 | Inline rename | Rename files and folders inline. | M | Media APIs | Adapt | P3 |
| FILE-09 | Inline delete | Delete files or folders with confirmation. | L | Media APIs, safeguards | Adapt | P4 |
| FILE-10 | Script associations | Find scripts and plugins using a JS file. | M | SuiteQL, script metadata | Adapt | P2 |
| FILE-11 | Create Script Record | Creates a script record from a JS file. | M | Script navigation | Adapt | P2 |
| FILE-12 | Copy File Cabinet path | Copies the full file or folder path. | S | Breadcrumb state | Direct | P1 |
| FILE-13 | Advanced upload engine | Progress, ZIP extraction, overwrite and errors. | XL | Uploads, ZIP handling | Rebuild | P3 |
| FILE-14 | Inline folder creation | Creates a folder inline. | L | Media APIs | Adapt | P3 |
| FILE-15 | Row quick actions | Rename, Delete, Edit, Scripts, Create and Copy Path. | L | FILE-08 through FILE-14 | Adapt | P3 |
| FILE-16 | Resizable file tree | Persistent horizontal resizing. | M | Storage, frame layout | Direct | P2 |
| FILE-17 | File preview | Text, CSV, PDF and Office previews with size limits. | L | MIME handling, sandbox | Rebuild | P3 |

## 7. Script, deployment and execution tooling

| ID | Feature | Description | Complexity | Dependencies | Migration | Priority |
|---|---|---|---:|---|---|---:|
| SCRIPT-01 | Script List CSV | Exports scripts, lock state and file/library IDs. | M | List parser, CSV | Adapt | P1 |
| SCRIPT-02 | Script Record CSV | Exports Script Record List results. | S | List parser, CSV | Adapt | P1 |
| SCRIPT-03 | Script Note enhancements | Deployment links and syntax formatting. | M | Script metadata, formatter | Adapt | P2 |
| SCRIPT-04 | Scripted Record creation | New Record links and sensible defaults. | M | Scripted Record adapter | Adapt | P2 |
| SCRIPT-05 | Scripted Record navigation | Scripts, deployments, forms and workflows actions. | L | Multiple routes | Adapt | P2 |
| SCRIPT-06 | Deployment status analysis | Explains deployment and audience state. | XL | Metadata, rules engine | Rebuild | P3 |
| SCRIPT-07 | Script Debugger defaults | SuiteScript 2.1 and enhanced styling. | S | Debugger DOM | Direct | P1 |
| SCRIPT-08 | Enhanced text-file editor | Themed editor, links, Ctrl+S and AJAX save. | L | CodeMirror, file APIs | Rebuild | P3 |
| SCRIPT-09 | Script status links | Direct Script and Deployment links. | M | Script metadata | Adapt | P1 |
| SCRIPT-10 | Latest Log modal | Opens the newest execution or web-service log. | L | Log endpoints, formatter | Adapt | P2 |
| SCRIPT-11 | Execution-log Live View | Refreshes and formats execution logs. | L | Timers, formatter | Adapt | P2 |
| SCRIPT-12 | File and script associations | Edit File, File Record and Script Record links. | M | Script metadata | Adapt | P1 |
| SCRIPT-13 | Full execution log | Opens the complete script log. | M | Log route | Adapt | P1 |
| SCRIPT-14 | Queue polling | Tracks scheduled and Map/Reduce status. | L | Timers, status APIs | Adapt | P2 |
| SCRIPT-15 | Execute without navigation | Runs Scheduled or Map/Reduce scripts in place. | L | Safeguards, queue checks | Adapt | P3 |
| SCRIPT-16 | Suitelet deployment links | Open Suitelet and status navigation. | M | Deployment metadata | Adapt | P2 |
| SCRIPT-17 | Deployment file edit link | Opens the deployment script file. | S | File metadata | Adapt | P1 |
| SCRIPT-18 | Runtime heatmap | Scheduled and Map/Reduce runtime visualization. | XL | SuiteQL, timezone | Rebuild | P3 |
| SCRIPT-19 | Suitelet URL normalization | Rewrites URLs using script and deployment IDs. | M | Deployment metadata | Adapt | P2 |

## 8. Dashboard and monitoring

| ID | Feature | Description | Complexity | Dependencies | Migration | Priority |
|---|---|---|---:|---|---|---:|
| MON-01 | Generic Live View | Polls lists with visibility and hover pause. | L | Timers, DOM replacement | Adapt | P2 |
| MON-02 | Dashboard Refresh All | Refreshes all dashboard portlets. | M | Private dashboard API | Adapt | P2 |
| MON-03 | Dashboard Live View | Automatically refreshes portlets. | L | Timers, dashboard API | Adapt | P3 |
| MON-04 | Expand or Collapse All | Controls all portlets at once. | S | Dashboard DOM | Direct | P1 |
| MON-05 | Latest Log Live View | Refreshes deployment and web-service logs. | L | Log modal, timers | Adapt | P3 |
| MON-06 | Revenue status Live View | Refreshes revenue arrangement status. | M | Status page adapter | Adapt | P3 |
| MON-07 | Release Preview banner | Seasonal reminder for administrators. | S | Date and role detection | Adapt | P4 |
| MON-08 | Billing usage percentage | Adds a Current Used percentage. | S | Billing list parser | Direct | P3 |
| MON-09 | Preference quick settings | Maximum list sizes and local timezone. | M | Preferences form | Adapt | P3 |

## 9. Record Inspector

| ID | Feature | Description | Complexity | Dependencies | Migration | Priority |
|---|---|---|---:|---|---|---:|
| INS-01 | Body field inspection | IDs, labels, types, text and values. | L | Side Panel, record adapter | Rebuild | P2 |
| INS-02 | Sublist inspection | Every supported sublist and line value. | XL | Bounded serialization | Rebuild | P2 |
| INS-03 | Related transactions | Related transaction graph. | XL | SuiteQL, permissions | Rebuild | P3 |
| INS-04 | Saved Search inspection | Filters, columns and generated code. | XL | Saved Search API | Rebuild | P3 |
| INS-05 | SuiteScript snippets | Generates SuiteScript 1.0 and 2.1 examples. | M | Record and search metadata | Adapt | P2 |
| INS-06 | Inspector UI controls | Search, refresh, copy, expand and collapse. | L | Side Panel UI | Adapt | P2 |
| INS-07 | Navigation tracking | Refreshes when the active record changes. | M | Tab and route lifecycle | Adapt | P2 |

## 10. Remaining SuiteQL Console enhancements

| ID | Feature | Description | Complexity | Dependencies | Migration | Priority |
|---|---|---|---:|---|---|---:|
| SQL-04 | Special result formats | Colors, Markdown, record links, object links and HTML. | L | Sanitizer, record mapping | Adapt | P3 |
| SQL-05 | Advanced query actions | New, Clone, Save, Load, Variables and Export All across unloaded pages. Loaded-row Export and Clear Results are already implemented. | L | Existing Console shell | Adapt | P3 |
| SQL-06 | Remaining keyboard shortcuts | Adds shortcuts for Variables, New, Clone, Save and Load after those actions exist. Core execution shortcuts are already implemented. | M | SQL-05, command registry | Direct | P3 |
| SQL-07 | Saved query bookmarks | Save, load and delete bookmark queries. | L | Bookmarks permission | Adapt | P3 |
| SQL-08 | Query history | Recovers executed queries from browser history. | L | History permission | Adapt | P4 |
| SQL-09 | Dataset loader | Loads NetSuite datasets. | L | Dataset API | Adapt | P3 |
| SQL-10 | External query library | Loads queries from external S3. | M | External service, privacy | Drop | P5 |
| SQL-11 | Variable Manager | Global/account variables and interpolation. | L | Settings schema, parser | Rebuild | P3 |
| SQL-12 | Built-in constants | Account, user, role, environment, date and time. | M | Session context | Adapt | P3 |
| SQL-15 | Large-query URL handling | Temporary storage for oversized query URLs. | M | Session storage | Adapt | P3 |
| SQL-16 | Dataset Builder integration | Get SuiteQL and Run SuiteQL. | L | Dataset conversion API | Adapt | P3 |

## 11. Setup, role and customization tools

| ID | Feature | Description | Complexity | Dependencies | Migration | Priority |
|---|---|---|---:|---|---|---:|
| ADM-01 | Enable Features CSV | Exports feature status, availability, IDs and descriptions. | M | Setup page, CSV | Adapt | P2 |
| ADM-02 | Preferences CSV | Exports labels, IDs, values and help across setup pages. | L | Field Help, CSV | Adapt | P2 |
| ADM-03 | OAuth2 shortcut | Adds Enable OAuth2 to authorization errors. | S | Features route | Direct | P3 |
| ADM-04 | Enhanced Field Help | Shows ID, label, type, value, options and history. | L | Field metadata, bridge | Adapt | P1 |
| ADM-05 | Set value from Field Help | Updates eligible current record fields. | M | Current Record, safeguards | Adapt | P3 |
| ADM-06 | Edit custom field | Opens the field definition from Field Help. | M | Field type mapping | Adapt | P2 |
| ADM-07 | Native shortcut export/import | Copy, validate and restore NetSuite shortcuts. | L | Shortcut record adapter | Adapt | P2 |
| ADM-08 | My Roles account IDs | Displays account IDs on My Roles. | S | Roles page DOM | Adapt | P2 |
| ADM-09 | Admin message helpers | URL cleanup, message storage and auto-Agree. | M | Admin message route | Adapt | P4 |
| ADM-10 | Custom List Used By | Lists fields that reference a custom list. | L | SuiteQL, customization links | Adapt | P2 |
| ADM-11 | Edit Record Type | Direct Custom Record Type links. | S | URL mapping | Adapt | P1 |
| ADM-12 | Edit Transaction Type | Direct Custom Transaction Type links. | S | URL mapping | Adapt | P1 |
| ADM-13 | Custom field context repair | Preserves context and redirects to the right field page. | M | URL mapping | Adapt | P3 |
| ADM-14 | Suitelet Script menu | Direct Suitelet-to-Script link. | S | Script lookup | Adapt | P1 |
| ADM-15 | SuiteCommerce configuration memory | Remembers website and domain selections. | L | Legacy API, form mutation | Adapt | P4 |
| ADM-16 | Role bulk permission editor | Add, change or remove multiple permissions. | XL | Legacy APIs, audit safeguards | Rebuild | P4 |
| ADM-17 | Role permissions CSV | Exports every permission and level. | L | Role sublists, CSV | Adapt | P2 |
| ADM-18 | Permissions Help | Opens permission documentation. | S | Documentation route | Adapt | P3 |
| ADM-19 | Compare Roles | Starts comparison against a baseline role. | M | Role diff routes | Adapt | P2 |
| ADM-20 | Role diff highlighting | Shows permission increases and decreases. | M | Diff page DOM | Direct | P2 |
| ADM-21 | Bundle search autofocus | Focuses the bundle search input. | S | Bundle route | Direct | P4 |
| ADM-22 | Bundle fallback redirect | Finds a bundle by ID when source data is missing. | M | Bundle search | Adapt | P4 |
| ADM-23 | Bundle Builder IDs | Displays internal IDs. | M | Bundle DOM, dropdowns | Adapt | P3 |
| ADM-24 | SDF result cleanup | Removes stale SuiteApp result parameters. | S | URL normalizer | Direct | P4 |
| ADM-25 | Custom Form links | Sublist IDs and PDF/email template links. | M | Custom Form DOM | Adapt | P2 |
| ADM-26 | Reset User Access | Employee reset, unlock, questions and 2FA actions. | M | Employee identity | Adapt | P2 |
| ADM-27 | Employee email datalist | Active employee selector for access reset. | M | Employee query | Adapt | P2 |
| ADM-28 | SuiteApps Control Center CSV | Exports Users, Push Jobs and Releases. | L | SuiteApp APIs, CSV | Adapt | P3 |
| ADM-29 | CSV Import reuse | Start over using the current Saved Import. | M | Import state | Adapt | P2 |
| ADM-30 | CSV type preselection | Preselects import type and subtype. | M | Import metadata | Adapt | P2 |
| ADM-31 | CSV mapping IDs | Displays source and target field IDs. | M | Mapping DOM | Adapt | P2 |
| ADM-32 | CSV completion helpers | Start Another and embed today status. | M | Import routes | Adapt | P2 |
| ADM-33 | Translation dropdown sync | Synchronizes paired collection dropdowns. | M | Private Redwood components | Adapt | P4 |
| ADM-34 | Records Catalog sample query | Runs a top-30 SuiteQL sample. | M | SuiteQL Console | Adapt | P2 |
| ADM-35 | Records Catalog export | Exports fields, subrecords, joins and help. | L | Catalog endpoint, CSV | Adapt | P2 |

## 12. PDF, workflow, Help and login

| ID | Feature | Description | Complexity | Dependencies | Migration | Priority |
|---|---|---|---:|---|---|---:|
| PAGE-01 | Advanced PDF shortcuts | Save and Edit, Ctrl+S and Ctrl+P preview. | M | Template editor | Adapt | P2 |
| PAGE-02 | PDF revision helpers | Preserves source state and improves revisions. | M | Template metadata | Adapt | P3 |
| PAGE-03 | BFO and FreeMarker menus | Inserts BFO, FreeMarker and list constructs. | L | Editor integration | Rebuild | P3 |
| PAGE-04 | Help article improvements | Clean titles, recent tracking, scrolling and images. | M | Help route | Direct | P3 |
| PAGE-05 | Help infinite search | Infinite scrolling and localized counts. | L | Help requests | Adapt | P4 |
| PAGE-06 | Oracle Help link | Direct matching Oracle documentation. | S | Help ID mapping | Adapt | P3 |
| PAGE-07 | Workflow side panel | Persistent resizable workflow layout. | M | Workflow DOM | Adapt | P3 |
| PAGE-08 | Workflow formula helper | Improves workflow formula editing. | M | Formula framework | Adapt | P2 |
| PAGE-09 | Login challenge autofocus | Focuses authentication code. | S | Login route | Direct | P3 |
| PAGE-10 | Login account information | Company, environment, logo and generic login link. | M | Login context | Adapt | P3 |
| PAGE-11 | Logged-out redirect | Returns to the referring NetSuite page. | S | Strict host validation | Adapt | P3 |
| PAGE-12 | SuiteAnswers favicon | Replaces the favicon. | S | Packaged asset | Direct | P5 |

## 13. Commercial and external functionality

| ID | Feature | Description | Complexity | Dependencies | Migration | Priority |
|---|---|---|---:|---|---|---:|
| EXT-01 | ExtPay licensing | Trial, paid, past-due and cancellation states. | L | Missing ExtPay, billing | Drop for now | P5 |
| EXT-02 | Subscription gating | Disables features based on licensing. | L | ExtPay, account state | Drop for now | P5 |
| EXT-03 | Enterprise organization join | Sends email and subscription data externally. | M | External endpoint, privacy | Drop | P5 |
| EXT-04 | Terms/install flow | Opens terms after installation. | M | Missing terms source | Drop for now | P5 |
| EXT-05 | External community links | Reviews, discussions, issues, videos and socials. | S | External ownership | Drop unless required | P5 |
| EXT-06 | Uninstall payment URL | Sets a payment URL on uninstall. | S | ExtPay | Drop | P5 |

## Current selected feature

None. `SET-14` is complete and excluded from the active backlog. The next recommended candidate is `GEN-17`: Internal IDs toolkit.
