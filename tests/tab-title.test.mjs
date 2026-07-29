import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "src/tab-title/core.js"), "utf8");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createApi() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  runInNewContext(source, sandbox);
  return sandbox.SuiteMateV3TabTitleCore;
}

function stubDoc({ headline, headlineAfterStrip, status } = {}) {
  const statusNode = status === undefined ? null : { textContent: status };
  const headlineNode = headline === undefined ? null : {
    textContent: headline,
    cloneNode: () => ({
      querySelectorAll: () => [{ remove() {} }],
      textContent: headlineAfterStrip ?? headline
    })
  };
  return {
    querySelector: (selector) => {
      if (selector === ".uir-page-title-secondline") {
        return headlineNode;
      }
      return selector === ".uir-record-status" ? statusNode : null;
    }
  };
}

test("exports a frozen versioned tab-title core", () => {
  const core = createApi();
  assert.equal(core.VERSION, 1);
  assert.equal(Object.isFrozen(core), true);
  assert.equal(Object.isFrozen(core.RECORD_TYPES), true);
});

test("parseRecordPath maps known record tokens and rejects the rest", () => {
  const core = createApi();
  assert.deepEqual(
    plain(core.parseRecordPath("/app/accounting/transactions/salesord.nl")),
    { abbrev: "SO", leadingDocNumber: true }
  );
  assert.deepEqual(
    plain(core.parseRecordPath("/app/common/entity/custjob.nl")),
    { abbrev: "CUST", leadingDocNumber: false }
  );
  assert.deepEqual(
    plain(core.parseRecordPath("/APP/ACCOUNTING/TRANSACTIONS/ITEMSHIP.NL")),
    { abbrev: "IF", leadingDocNumber: true }
  );
  assert.equal(core.parseRecordPath("/app/accounting/transactions/unknownthing.nl"), null);
  assert.equal(core.parseRecordPath("/app/center/card.nl/extra"), null);
  assert.equal(core.parseRecordPath(null), null);
});

test("titleCaseStatus humanizes all-caps statuses only", () => {
  const core = createApi();
  assert.equal(core.titleCaseStatus("PENDING FULFILLMENT"), "Pending Fulfillment");
  assert.equal(core.titleCaseStatus("PENDING BILLING/PARTIALLY BILLED"), "Pending Billing/Partially Billed");
  assert.equal(core.titleCaseStatus("Partially Received"), "Partially Received");
  assert.equal(core.titleCaseStatus("  "), "");
  assert.equal(core.titleCaseStatus(null), "");
});

test("extractHeaderParts splits document number, strips injected nodes and truncates", () => {
  const core = createApi();
  const parsedTransaction = { abbrev: "SO", leadingDocNumber: true };
  const parts = core.extractHeaderParts(stubDoc({
    headline: "SO886672INTERNALBADGE 754 Online Sales - MCoBeauty, Inc.",
    headlineAfterStrip: " SO886672  754 Online Sales - MCoBeauty, Inc. ",
    status: "PENDING FULFILLMENT"
  }), parsedTransaction);
  assert.deepEqual(plain(parts), {
    docNumber: "SO886672",
    entity: "754 Online Sales - MCoBeauty, Inc.",
    status: "Pending Fulfillment"
  });

  const entityParts = core.extractHeaderParts(stubDoc({
    headline: "Acme Wholesale Group",
    status: undefined
  }), { abbrev: "CUST", leadingDocNumber: false });
  assert.deepEqual(plain(entityParts), { docNumber: "", entity: "Acme Wholesale Group", status: "" });

  const longEntity = `SO1 ${"x".repeat(80)}`;
  const truncated = core.extractHeaderParts(stubDoc({ headline: longEntity }), parsedTransaction);
  assert.equal(truncated.entity.length, 60);
  assert.equal(truncated.entity.endsWith("…"), true);

  assert.deepEqual(
    plain(core.extractHeaderParts(stubDoc({}), parsedTransaction)),
    { docNumber: "", entity: "", status: "" }
  );
});

test("composeTitle joins parts and refuses degraded titles", () => {
  const core = createApi();
  const parsed = { abbrev: "IF", leadingDocNumber: true };
  assert.equal(
    core.composeTitle(parsed, { docNumber: "IF4512", entity: "AcmeCo", status: "Picked" }),
    "IF · IF4512 · AcmeCo · Picked"
  );
  assert.equal(
    core.composeTitle({ abbrev: "CUST", leadingDocNumber: false }, { docNumber: "", entity: "AcmeCo", status: "" }),
    "CUST · AcmeCo"
  );
  assert.equal(core.composeTitle(parsed, { docNumber: "", entity: "", status: "" }), null);
  assert.equal(core.composeTitle(null, { docNumber: "X", entity: "", status: "" }), null);
});
