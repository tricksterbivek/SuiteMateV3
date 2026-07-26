# CSV Export Proof-of-Concept Review

Source reviewed: `/Users/Bivek.Shah/Downloads/Concept for CSV EXPORT`

Review date: 2026-07-26

## Verdict

The proof of concept proves that record export is technically viable from an ordinary NetSuite record page. Its central approach is worth preserving for the first V3 baseline:

1. Add an `Export CSV` action to a saved record page.
2. execute inside the NetSuite page context;
3. load `N/record` and `N/currentRecord`;
4. load the current record and, where available, its Custom Form;
5. choose the first populated supported sublist;
6. repeat body fields across exported line rows;
7. create and download the CSV in the current tab.

The source is not production-ready as written. It contains no manifest, build, tests, feature boundary, settings integration or lifecycle management. It should not be copied wholesale.

## Original architecture

### Isolated content script

`assets/index.js` detects a URL with an `id` parameter, finds a NetSuite menu, appends an `Export CSV` item, dispatches a global `DOWNLOAD_CSV_EVENT` and injects a second script into the page.

### Page script

`inject/inject-script.js` loads `N/record` and `N/currentRecord`, reads the current record, optionally reads Custom Form metadata, picks the first populated sublist from a fixed candidate list, converts the result to CSV and downloads a Blob.

### Data model

- body and header fields are included once for records without a supported sublist;
- body and header values are repeated on every exported sublist row;
- only the first populated candidate sublist is exported;
- candidate sublists are `item`, `expense`, `account`, `line`, `inventory` and `invt`;
- display text is preferred over raw internal values.

## Findings

### Architecture

- Good: record data remains in the authenticated NetSuite tab.
- Good: no external backend or Suitelet deployment is required.
- Good: uses supported `N/record` and `N/currentRecord` modules.
- Weak: the two scripts communicate through an unversioned global event with no response envelope.
- Weak: repeated script injection can register duplicate listeners and duplicate menu actions.
- Weak: the feature has no integration with SuiteMate settings, routes, commands or shared lifecycle.
- Weak: broad URL detection treats many non-record pages with an `id` parameter as record pages.

### Correctness

- A missing `customform` value causes an early return and silently produces no export.
- `getLineCount` can throw while probing an unsupported sublist, aborting the whole feature.
- `getSublistField` can throw `SSS_INVALID_SUBLIST_OPERATION`, especially when line zero is not valid.
- unsupported body fields and display-text calls are not consistently isolated.
- duplicate header labels are handled inconsistently.
- field labels are not escaped in the CSV header.
- null and undefined values can become literal text rather than an empty cell.
- some record or form combinations can leave the UI stuck in a disabled state.

### Security and privacy

- formula-like CSV values are not neutralized, allowing spreadsheet formula execution after opening an export.
- downloaded filenames are not sanitized.
- arbitrary record data is not sent externally, which is the correct privacy boundary.
- the original event can be triggered by any page script, but that does not grant the page access it does not already possess.

### Performance

- record loading consumes NetSuite governance according to record type.
- NetSuite limits loaded sublists to 10,000 lines.
- work is proportional to exported lines multiplied by exported fields.
- the implementation builds the full matrix and full CSV in memory.
- a large transaction with many line columns can visibly block the page.
- the first baseline deliberately preserves this model. Streaming, worker-based generation and multi-sublist export are deferred because they would be architectural changes.

### Maintainability

- identifiers, selectors and events are embedded directly in minified-style code.
- no pure core is available for unit testing.
- errors are mostly written to the console.
- there is no deterministic cleanup for DOM nodes, listeners or Blob URLs.
- the fixed candidate-sublist rule is undocumented.

## V3 baseline integration

The V3 baseline preserves the proof of concept’s behavior while applying the minimum required safety and integration fixes:

- one route capability for saved top-frame records with a numeric internal ID;
- one shared command definition;
- one isolated-world runtime using the shared observer lifecycle and SuiteMate enabled setting;
- one idempotent main-world adapter using `N/record` and `N/currentRecord`;
- versioned request and result events containing metadata only;
- missing Custom Form fallback;
- guarded sublist and field probing;
- display-text fallback to raw values;
- stable duplicate headers;
- RFC 4180 CSV encoding with CRLF rows;
- spreadsheet-formula protection;
- UTF-8 BOM;
- sanitized filenames;
- deterministic DOM cleanup and Blob URL revocation;
- success and error feedback rendered through text nodes;
- no record data stored in Chrome storage;
- no external request.

## Deliberately deferred

These changes are not part of the first working baseline:

1. export configuration UI;
2. choosing which sublist to export;
3. exporting multiple sublists;
4. streaming or chunked generation for very large transactions;
5. canceling an `N/record` load already running in NetSuite;
6. background export;
7. raw value versus display text selection;
8. per-field inclusion controls;
9. progress by line or field;
10. automated compatibility mapping for every NetSuite record type.

## Live artifact verification correction

Three authenticated exports were later supplied for a Sales Order, Item Receipt and Purchase Order. Their table shapes were:

- Sales Order: 167 data rows by 333 columns, approximately 1.02 MB;
- Item Receipt: 4 data rows by 69 columns;
- Purchase Order: 4 data rows by 187 columns.

The files were structurally parseable and every row had the expected column count. However, byte-level and header inspection proved they were not generated by the SuiteMate V3 baseline:

- none contained the UTF-8 BOM emitted by V3;
- all used LF-only rows rather than the V3 CRLF serializer;
- duplicate headers used the proof-of-concept `_fieldId` naming pattern instead of the V3 `[fieldId]` naming pattern;
- the Item Receipt contained one duplicate header, which the V3 unique-header function does not emit.

Chrome inspection then confirmed that both exporters were active on the same NetSuite record. The V3 action was identifiable by `data-suitemate-v3-action="csv-export"` and the proof-of-concept action by `id="export_csv_file"`.

These files validate the original proof of concept across three record families, but they do not count as authenticated V3 verification. V3 must be retested with the separate proof-of-concept extension disabled before any optimization work begins.

## External constraints

- Oracle documents that `record.load.promise` is supported in client scripts and has governance costs.
- Oracle documents a 10,000-line maximum for loaded record sublists.
- Oracle documents that `Record.getSublistField` can throw `SSS_INVALID_SUBLIST_OPERATION`.
- these constraints mean large-record performance and record-type compatibility require live testing, not assumptions based only on the proof of concept.
