# SuiteMate V3 styling smoke test

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

## Exit gate

Feature development may begin only when all required areas pass, all release blockers are resolved, and the final comparison evidence is retained.
