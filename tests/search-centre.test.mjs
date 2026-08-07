import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "src/search-centre/core.js"), "utf8");
const sandbox = { URL };
sandbox.globalThis = sandbox;
runInNewContext(source, sandbox);
const core = sandbox.SuiteMateV3SearchCentreCore;
const origin = "https://1234567.app.netsuite.com";

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("exports one frozen Search Centre core with the five fixed categories", () => {
  assert.equal(Object.isFrozen(core), true);
  assert.deepEqual(plain(core.CATEGORIES.map((category) => category.id)), [
    "all",
    "customers",
    "transactions",
    "files",
    "navigation"
  ]);
});

test("categorizes label fallbacks: files and navigation closed sets, records as the rest", () => {
  assert.equal(core.categorize("PDF File"), "files");
  assert.equal(core.categorize("Excel File"), "files");
  assert.equal(core.categorize("Menu"), "navigation");
  assert.equal(core.categorize("Page"), "navigation");
  assert.equal(core.categorize("Non-inventory Item"), "records");
  assert.equal(core.categorize("Customer"), "records");
  assert.equal(core.categorize(""), "records");
});

test("buckets by the rename-proof URL path, never the display label", () => {
  const at = (key, descr) => core.fromAutofill({ sname: "X", key, descr, bedit: "F" }, origin).category;
  assert.equal(at("/app/accounting/transactions/transaction.nl?id=1042239", "Sales Order"), "transactions");
  // The AP family's display names ("Bill", "Bill Credit", "Bill Payment")
  // diverge from their record ids — the path still buckets them.
  assert.equal(at("/app/accounting/transactions/transaction.nl?id=9", "Bill"), "transactions");
  assert.equal(at("/app/common/entity/custjob.nl?id=4370", "Customer"), "customers");
  assert.equal(at("/app/common/entity/custjob.nl?id=9001", "Lead"), "customers");
  assert.equal(at("/app/common/entity/custjob.nl?id=9002", "Membre"), "customers");
  assert.equal(at("/app/common/media/mediaitem.nl?id=5", "PDF File"), "files");
  assert.equal(at("/app/common/entity/vendor.nl?id=1", "Vendor"), "records");
  assert.equal(at("/app/common/entity/contact.nl?id=16779", "Contact"), "records");
  // A Payment ITEM shares the "Payment" label with the payment transaction;
  // the item path keeps it out of Transactions.
  assert.equal(at("/app/common/item/item.nl?id=7", "Payment"), "records");
  assert.equal(at("/app/common/custom/custrecordentry.nl?rectype=12&id=3", "Bank Details"), "records");
});

test("keeps only same-origin https hrefs, stored as paths", () => {
  assert.equal(
    core.sanitizeHref(`${origin}/app/common/item/item.nl?id=10631&siaQ=ite`, origin),
    "/app/common/item/item.nl?id=10631&siaQ=ite"
  );
  assert.equal(core.sanitizeHref("/app/common/media/mediaitem.nl?id=5", origin), "/app/common/media/mediaitem.nl?id=5");
  assert.equal(core.sanitizeHref("https://evil.example.com/app/x.nl", origin), "");
  assert.equal(core.sanitizeHref("http://1234567.app.netsuite.com/app/x.nl", origin), "");
  assert.equal(core.sanitizeHref("javascript:alert(1)", origin), "");
  assert.equal(core.sanitizeHref("", origin), "");
});

test("normalizes a record row from its visible Type: Name text", () => {
  const result = core.normalizeResult({
    text: "Non-inventory Item: Carryover Item For Sale",
    group: "globalSearch",
    href: `${origin}/app/common/item/item.nl?id=10631`,
    editHref: `${origin}/app/common/item/item.nl?id=10631&e=T`
  }, origin);
  assert.equal(result.title, "Carryover Item For Sale");
  assert.equal(result.typeText, "Non-inventory Item");
  assert.equal(result.category, "records");
  assert.equal(result.href, "/app/common/item/item.nl?id=10631");
  assert.equal(result.editHref, "/app/common/item/item.nl?id=10631&e=T");
  assert.equal(Object.isFrozen(result), true);
});

test("normalizes a file row and drops an edit href the origin check rejects", () => {
  const result = core.normalizeResult({
    text: "PDF File: ITE0-25120014.pdf",
    group: "globalSearch",
    href: "/app/common/media/mediaitem.nl?id=525744",
    editHref: "https://elsewhere.example.com/edit"
  }, origin);
  assert.equal(result.category, "files");
  assert.equal(result.typeText, "PDF File");
  assert.equal(result.title, "ITE0-25120014.pdf");
  assert.equal(result.editHref, "");
});

test("splits pageSearch menu paths into leaf title and breadcrumb secondary", () => {
  const result = core.normalizeResult({
    text: "Menu: Transactions > Sales > Invoice Sales Orders",
    group: "pageSearch",
    href: "/app/accounting/transactions/salesordermanager.nl?type=proc",
    editHref: ""
  }, origin);
  assert.equal(result.category, "navigation");
  assert.equal(result.typeText, "Menu");
  assert.equal(result.title, "Invoice Sales Orders");
  assert.equal(result.secondary, "Transactions > Sales");

  const single = core.normalizeResult({
    text: "Menu: SuiteApps",
    group: "pageSearch",
    href: "/app/suiteapps/suiteapps.nl",
    editHref: ""
  }, origin);
  assert.equal(single.title, "SuiteApps");
  assert.equal(single.secondary, "");
});

test("treats a pageSearch row as navigation even without a Menu prefix", () => {
  const result = core.normalizeResult({
    text: "Amount (field)",
    group: "pageSearch",
    href: "/app/center/card.nl#amount",
    editHref: ""
  }, origin);
  assert.equal(result.category, "navigation");
  assert.equal(result.title, "Amount (field)");
});

test("rejects rows without a usable href or title", () => {
  assert.equal(core.normalizeResult({ text: "Customer: Acme", href: "javascript:x", editHref: "" }, origin), null);
  assert.equal(core.normalizeResult({ text: "  ", href: "/app/x.nl", editHref: "" }, origin), null);
});

test("accepts hrefless current-page rows through their native index as navigation", () => {
  const field = core.normalizeResult({
    text: "Field: Sales Channel",
    group: "pageSearch",
    href: "",
    editHref: "",
    nativeIndex: "12"
  }, origin);
  assert.equal(field.category, "navigation");
  assert.equal(field.title, "Sales Channel");
  assert.equal(field.typeText, "Field");
  assert.equal(field.href, "");
  assert.equal(field.nativeIndex, "12");
  assert.equal(core.normalizeResult({ text: "Field: Sales Channel", href: "", nativeIndex: "" }, origin), null);
});

test("maps direct autosuggest entries into results with permission-gated edit", () => {
  const result = core.fromAutofill({
    sname: "Carryover Item For Sale",
    key: "/app/common/item/item.nl?id=10631",
    descr: "Non-inventory Item",
    dashurl: "",
    bedit: "T"
  }, origin);
  assert.equal(result.title, "Carryover Item For Sale");
  assert.equal(result.typeText, "Non-inventory Item");
  assert.equal(result.category, "records");
  assert.equal(result.href, "/app/common/item/item.nl?id=10631");
  assert.equal(result.editHref, "/app/common/item/item.nl?id=10631&e=T");

  const file = core.fromAutofill({
    sname: "a.pdf",
    key: "/app/common/media/mediaitem.nl?id=5",
    descr: "PDF File",
    bedit: "F"
  }, origin);
  assert.equal(file.category, "files");
  assert.equal(file.editHref, "");

  const bare = core.fromAutofill({ sname: "Just a name", key: "/app/x.nl" }, origin);
  assert.equal(bare.typeText, "");
  assert.equal(bare.category, "records");

  assert.equal(core.fromAutofill({ sname: "x", key: "https://evil.example.com/a", bedit: "T" }, origin), null);
  assert.equal(core.fromAutofill({ sname: "", key: "/app/x.nl" }, origin), null);
});

test("counts and filters by category with all as the identity", () => {
  const results = [
    core.normalizeResult({ text: "Customer: Acme", group: "globalSearch", href: "/app/common/entity/custjob.nl?id=1" }, origin),
    core.normalizeResult({ text: "PDF File: a.pdf", group: "globalSearch", href: "/b.nl" }, origin),
    core.normalizeResult({ text: "Menu: Lists > Items", group: "pageSearch", href: "/c.nl" }, origin)
  ];
  assert.deepEqual(
    plain(core.countByCategory(results)),
    { all: 3, customers: 1, transactions: 0, files: 1, navigation: 1 }
  );
  assert.equal(core.filterByCategory(results, "all").length, 3);
  assert.deepEqual(core.filterByCategory(results, "files").map((result) => result.title), ["a.pdf"]);
  assert.deepEqual(core.filterByCategory(results, "navigation").map((result) => result.title), ["Items"]);
});
