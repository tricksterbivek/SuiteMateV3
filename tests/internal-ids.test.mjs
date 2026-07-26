import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "src/internal-ids/core.js"), "utf8");

function createApi() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  runInNewContext(source, sandbox);
  return sandbox.SuiteMateV3InternalIdsCore;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("exports a frozen bounded identifier parser", () => {
  const core = createApi();
  assert.equal(core.VERSION, 1);
  assert.equal(Object.isFrozen(core), true);
  for (const identifier of ["entity", "custbody_order_source", "recmach.custrecord_parent", "_multibtnstate_"]) {
    assert.equal(core.normalizeIdentifier(identifier), identifier);
  }
  for (const invalid of ["", "field id", "<script>", "id/value", `a${"b".repeat(160)}`]) {
    assert.equal(core.normalizeIdentifier(invalid), null);
  }
});

test("extracts V1 field, button, sublist and sublist-column IDs", () => {
  const core = createApi();
  assert.equal(core.fieldIdFromWalkthrough("Field:trandate"), "trandate");
  assert.equal(core.fieldIdFromWalkthrough("Group:primary"), null);
  assert.equal(core.buttonIdFromElementId("tbl_submitter"), "submitter");
  assert.equal(core.buttonIdFromElementId("submitter"), null);
  assert.equal(core.machineIdFromElementId("item_splits"), "item");
  assert.equal(core.machineIdFromElementId("expense_div"), "expense");
  assert.equal(core.sublistColumnId("item_quantity1_fs", "item_div"), "quantity");
  assert.equal(core.sublistColumnId("rate1_fs", ""), "rate");
  assert.equal(core.sublistColumnId("item_quantity2_fs", "item_div"), null);
});

test("parses only the supported V1 list-header handler signatures", () => {
  const core = createApi();
  assert.equal(
    core.listHeaderId("l_sort('list', 'a', 'b', 'c', 'd', 'amount')"),
    "amount"
  );
  assert.equal(
    core.listHeaderId("if (getFormElementViaFormName('main_form').value!='status') return false;"),
    "status"
  );
  assert.equal(core.listHeaderId("alert('entity')"), null);
  assert.equal(core.listHeaderId("l_sort('list', 'a', 'b')"), null);
});

test("decodes customization-grid script IDs without exposing row values", () => {
  const core = createApi();
  const fields = ["custrecordid", "custrecordscriptid", "custrecordlabel"].join("\u0001");
  const data = [
    ["1", "custbody_alpha", "Alpha"].join("\u0001"),
    ["2", "custbody_beta", "Beta"].join("\u0001"),
    ["3", "not a valid id", "Private value"].join("\u0001")
  ].join("\u0002");

  assert.deepEqual(
    plain(core.customizationScriptIds("custrecordfields", fields, data)),
    ["custbody_alpha", "custbody_beta", null]
  );
  assert.deepEqual(plain(core.customizationScriptIds("not-a-fields-input", fields, data)), []);
});

test("core has no DOM, storage, bridge or network authority", () => {
  assert.doesNotMatch(source, /document\.|chrome\.|fetch\(|XMLHttpRequest|innerHTML|localStorage|sessionStorage/);
});
