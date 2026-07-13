# SuiteMate V3 smoke test

The styling foundation is not complete because the extension loads. It is complete only when the visual comparison and functional regression checks pass.

## Test rules

- Compare V3 against V1 at the same viewport, role, account, data, and NetSuite UI version.
- Test Light, Dark, and System modes.
- Test both rounded and Boxy UI settings.
- Test Main and Secondary colors on at least two roles and confirm they remain isolated.
- Capture before and after screenshots for every page group.
- Record browser console errors and failed network requests.
- Treat any blocked click, hidden control, shifted field, clipped menu, or broken scroll area as a release blocker.

## Required page coverage

| Area | Minimum pages | Critical checks |
| --- | --- | --- |
| Global shell | Home dashboard, center navigation, role menu, global search | Header, menus, links, focus states, scrollbars |
| Transactions | Sales Order view/edit, Item Fulfillment, Invoice | Title area, fields, subtabs, sublists, totals, buttons |
| Entity and item records | Customer, Vendor, Inventory Item | Forms, field groups, inline help, lists |
| Lists and searches | Record list, saved search edit, saved search results | Filters, table headers, paging, hover and selected rows |
| Scripting | Script record, deployment, execution log, script debugger | Code areas, status, tables, buttons |
| File Cabinet | Folder list, file record, text file editor | Folder tree, rows, editor, dialogs |
| Workflows | Workflow record and workflow desktop | Diagram, controls, states, dialogs |
| Setup and assistants | CSV Import Assistant, preferences, setup pages | Steps, field layouts, progress and alerts |
| Help | Help Center and field help popup | Search, content, links, popup sizing |
| Authentication | Login and challenge pages where safely available | Branding, fields, validation, buttons |

## Functional regression pass

- Create, edit, save, cancel, and delete actions remain clickable where permitted.
- Dropdowns, date pickers, multiselects, checkboxes, and radio buttons remain usable.
- Subtabs, field groups, sublists, pagination, and inline editing still work.
- Global search, role switching, help, and navigation menus still work.
- Modals, alerts, tooltips, and confirmation dialogs are visible and dismissible.
- Keyboard focus remains visible and tab order is usable.
- Horizontal and vertical scrolling remains available where NetSuite requires it.
- Disabling SuiteMate V3 restores native NetSuite styling immediately.
- Changing Main updates the primary sublist bar, active tab, and other V1 main-theme accents without changing field-group or table colors.
- Changing Secondary updates field-group dropdowns, Item table headers, and other V1 secondary-theme surfaces without a page reload.
- Keeping either color picker open updates NetSuite immediately without clicking away from the picker.
- Swap Colors exchanges the current role's Main and Secondary values.
- Default Colors removes only the current role's custom colors.
- Reset All restores appearance defaults and removes all saved role colors.
- Switching roles applies that role's saved colors and does not leak colors from another role.

## SuiteQL Core Studio pass

- Open the extension popup from an authenticated NetSuite tab and select Open SuiteQL Studio.
- Confirm the active tab navigates to `/app/common/search/ubersearchresults.nl?suiteql` on the same account domain.
- Confirm a normal Global Search page without the `suiteql` parameter remains native and unchanged.
- Run `SELECT id, tranid FROM transaction WHERE ROWNUM <= 10 ORDER BY id`.
- Confirm the request uses the authenticated same-account `PlatformClientScriptHandler.nl` `queryApiBridge` and makes no external request.
- Confirm the editor has line numbers, SQL highlighting, selection execution, and visible keyboard focus.
- Confirm row count, execution time, sorting, 250-row client pages, numeric values, text values, and null values render correctly.
- Export loaded rows and confirm the account identifier and timestamp appear in the filename.
- Open the CSV and confirm commas, quotes, line breaks, and formula-like string values are safe.
- Run a deliberately invalid field and confirm the NetSuite error code and message are readable.
- Run an unpaged query that reaches 5,000 rows and confirm the limit warning appears.
- Enable Paged mode for a query with a unique `ORDER BY`, then load at least two 1,000-row NetSuite pages.
- Confirm loaded count and total count remain distinct and accurate.
- Try Paged mode without `ORDER BY` and confirm Studio requires explicit confirmation.
- Press Escape during an active request and confirm Studio releases the UI, discards late results, and does not claim NetSuite processing was canceled.
- Verify Ctrl or Cmd + E executes, Ctrl or Cmd + Shift + P toggles Paged, Ctrl or Cmd + Shift + E exports, and Ctrl or Cmd + Shift + L clears results.
- Enter a query, resize the editor, refresh the tab, and confirm the query, Paged setting, and editor height are restored in the same tab.
- Use Inspect Table with a valid table name and confirm the Records Catalog opens in a new tab.
- Confirm invalid table names do not open a route.
- Recheck Sales Order view and edit pages after the SuiteQL pass.
- Repeat the SuiteQL execution pass in Release Preview before every NetSuite release and treat a changed bridge response as a release blocker.

## Exit gate

The SuiteQL milestone is complete only when the styling regressions remain clear, the SuiteQL checks pass, and final evidence is retained.
