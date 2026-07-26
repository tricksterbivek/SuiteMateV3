import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreSource = await readFile(resolve(root, "src/csv-export/core.js"), "utf8");
const mainWorldSource = await readFile(resolve(root, "src/csv-export/main-world.js"), "utf8");
const qualityFixture = JSON.parse(await readFile(
  resolve(root, "tests/fixtures/csv-export-quality.json"),
  "utf8"
));

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createCore() {
  const sandbox = { URL };
  sandbox.globalThis = sandbox;
  runInNewContext(coreSource, sandbox);
  return sandbox.SuiteMateV3CsvExportCore;
}

class BrowserUrl extends URL {
  static created = [];
  static revoked = [];

  static createObjectURL(blob) {
    this.created.push(blob);
    return `blob:test-${this.created.length}`;
  }

  static revokeObjectURL(url) {
    this.revoked.push(url);
  }
}

class FakeCustomEvent extends Event {
  constructor(type, options = {}) {
    super(type);
    this.detail = options.detail;
  }
}

class FakeBlob {
  constructor(parts, options = {}) {
    this.parts = parts;
    this.type = options.type;
  }
}

function createRecord(options = {}) {
  const sublistId = options.sublistId ?? "expense";
  const lineCount = options.lineCount ?? 1;
  const bodyValues = {
    tranid: "SO/42",
    entity: 7,
    externalid: "EXT-SO-42",
    customform: "",
    custbody_hidden: "Hidden"
  };
  const bodyLabels = {
    tranid: "Document Number",
    entity: "Customer",
    externalid: "External ID",
    custbody_hidden: "Hidden custom body"
  };
  return {
    id: 42,
    type: "salesorder",
    getFields: () => ["tranid", "entity", "externalid", "custbody_hidden"],
    getField: ({ fieldId }) => bodyLabels[fieldId]
      ? { id: fieldId, label: bodyLabels[fieldId] }
      : null,
    getValue: ({ fieldId }) => bodyValues[fieldId] ?? "",
    getText: ({ fieldId }) => fieldId === "entity"
      ? "Acme, Inc."
      : bodyValues[fieldId] ?? "",
    getLineCount: ({ sublistId: requested }) => {
      if (requested === "item") {
        throw new Error("Unsupported sublist");
      }
      return requested === sublistId ? lineCount : 0;
    },
    getSublistFields: ({ sublistId: requested }) =>
      requested === sublistId ? ["account", "memo"] : [],
    getSublistField: ({ sublistId: requested, fieldId }) => {
      if (requested !== sublistId) {
        throw new Error("Unsupported sublist");
      }
      return {
        id: fieldId,
        label: fieldId === "account" ? "Account" : "Memo"
      };
    },
    getSublistText: ({ sublistId: requested, fieldId }) => {
      if (requested !== sublistId) {
        throw new Error("Unsupported sublist");
      }
      if (fieldId === "account") {
        return "Sales";
      }
      if (fieldId === "memo") {
        return "=HYPERLINK(\"https://evil.example\")";
      }
      throw new Error("Text unavailable");
    },
    getSublistValue: ({ sublistId: requested, fieldId, line }) => {
      if (requested !== sublistId) {
        throw new Error("Unsupported sublist");
      }
      return fieldId === "line" ? line + 1 : "";
    }
  };
}

function createMainWorldHarness(options = {}) {
  BrowserUrl.created = [];
  BrowserUrl.revoked = [];
  const target = new EventTarget();
  const links = [];
  const document = {
    body: {
      append(link) {
        links.push(link);
        link.isConnected = true;
      }
    },
    createElement(tagName) {
      assert.equal(tagName, "a");
      return {
        click() {
          this.clicked = true;
        },
        remove() {
          this.removed = true;
          this.isConnected = false;
        }
      };
    }
  };
  const recordRef = options.recordRef ?? createRecord();
  const recordModule = {
    load: {
      promise: async ({ type }) => {
        if (type === "custform") {
          if (options.formRef) {
            return options.formRef;
          }
          throw new Error("No form load expected");
        }
        return recordRef;
      }
    }
  };
  const currentRecordModule = {
    get: () => options.currentRecord ?? { id: 42, type: "salesorder" }
  };
  const sandbox = {
    URL: BrowserUrl,
    Blob: FakeBlob,
    CustomEvent: FakeCustomEvent,
    Event,
    Symbol,
    Promise,
    location: new BrowserUrl(
      options.location ?? "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=42"
    ),
    document,
    console,
    require: (modules, success) => {
      assert.deepEqual(plain(modules), ["N/record", "N/currentRecord"]);
      success(recordModule, currentRecordModule);
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target)
  };
  sandbox.globalThis = sandbox;
  sandbox.top = sandbox;
  runInNewContext(coreSource, sandbox);
  runInNewContext(mainWorldSource, sandbox);
  return { sandbox, links };
}

test("exports one frozen versioned CSV baseline core", () => {
  const core = createCore();
  assert.equal(core.VERSION, 2);
  assert.equal(Object.isFrozen(core), true);
  assert.equal(Object.isFrozen(core.CANDIDATE_SUBLISTS), true);
  assert.equal(core.toCellText({ raw: true }), "");
  assert.equal(core.toCellText(["A", "B"]), "A; B");
  assert.equal(core.REQUEST_EVENT, "suitemate:v3:csv-export:request");
  assert.equal(core.RESULT_EVENT, "suitemate:v3:csv-export:result");
});

test("limits CSV Export to saved record-like locations", () => {
  const core = createCore();
  for (const value of [
    "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=42",
    "https://123456.app.netsuite.com/app/common/entity/custjob.nl?e=T&id=7"
  ]) {
    assert.equal(core.isExportableLocation(value), true, value);
  }
  for (const value of [
    "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl",
    "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=-1",
    "https://123456.app.netsuite.com/app/common/custom/custlist.nl?id=9",
    "not a URL"
  ]) {
    assert.equal(core.isExportableLocation(value), false, value);
  }
});

test("serializes RFC 4180 CSV and neutralizes spreadsheet formulas", () => {
  const core = createCore();
  assert.equal(
    core.serializeCsv([
      ["Customer", "Memo"],
      ["Acme, Inc.", "=HYPERLINK(\"https://evil.example\")"],
      ["Line\nbreak", -2]
    ]),
    'Customer,Memo\r\n"Acme, Inc.","\'=HYPERLINK(""https://evil.example"")"\r\nLine break,-2'
  );
  assert.equal(core.serializeCsv([["Tags"], [["A", "B"]]]), "Tags\r\nA; B");
  assert.equal(core.serializeCsv([["Raw"], [{ token: "must-not-export" }]]), "Raw\r\n");
  assert.deepEqual(
    plain(core.makeUniqueHeaders([
      { label: "Amount", fieldId: "amount" },
      { label: "Amount", fieldId: "foreignamount" },
      { label: "Amount", fieldId: "amount" }
    ])),
    ["Amount", "Foreign Amount", "Amount 2"]
  );
  assert.deepEqual(
    plain(core.makeUniqueHeaders([
      { label: "Currency", fieldId: "currency", scope: "record" },
      { label: "Currency", fieldId: "currency", scope: "item" },
      { label: "Status", fieldId: "orderstatus", scope: "record" },
      { label: "Internal ID", fieldId: "internalid", scope: "record" },
      { label: "Billing Address", fieldId: "billaddress", scope: "record" },
      {
        label: "Billing Address",
        fieldId: "billingaddress_text",
        scope: "record"
      }
    ])),
    [
      "Record Currency",
      "Item Currency",
      "Order Status",
      "Record Internal ID",
      "Billing Address",
      "Billing Address Text"
    ]
  );
  assert.equal(core.createFilename("../../SO:42"), "SO-42.csv");
});

test("removes columns that are blank across every exported row", () => {
  const core = createCore();
  assert.deepEqual(
    plain(core.removeEmptyColumns([
      ["Order #", "Unused", "Line Id", "Memo", "Whitespace only"],
      ["SO1", "", "1", "", "   "],
      ["SO1", "", "2", "Ready", "\t"]
    ])),
    [
      ["Order #", "Line Id", "Memo"],
      ["SO1", "1", ""],
      ["SO1", "2", "Ready"]
    ]
  );
  assert.deepEqual(plain(core.removeEmptyColumns([])), []);
  assert.deepEqual(
    plain(core.removeEmptyColumns([
      ["Required", "Unused"],
      ["", ""]
    ], [0])),
    [["Required"], [""]]
  );
});

test("validates event envelopes and renders only bounded result metadata", () => {
  const core = createCore();
  const requestId = "csv-12345678";
  assert.deepEqual(plain(core.normalizeRequestDetail({ requestId, extra: "ignored" })), {
    requestId
  });
  assert.equal(core.normalizeRequestDetail({ requestId: "<script>" }), null);
  assert.deepEqual(
    plain(core.normalizeResultDetail({
      ok: true,
      requestId,
      filename: "../SO:42.csv",
      recordType: "salesorder",
      sublistId: "item",
      rowCount: 2,
      columnCount: 4,
      html: "<img onerror=alert(1)>"
    }, requestId)),
    {
      ok: true,
      requestId,
      filename: "SO-42.csv",
      recordType: "salesorder",
      sublistId: "item",
      rowCount: 2,
      columnCount: 4
    }
  );
  assert.equal(
    core.normalizeResultDetail({ ok: true, requestId: "csv-other123" }, requestId),
    null
  );
});

test("main-world baseline survives unsupported sublists and missing custom forms", async () => {
  const { sandbox, links } = createMainWorldHarness();
  const core = sandbox.SuiteMateV3CsvExportCore;
  const result = new Promise((resolveResult) => {
    sandbox.addEventListener(core.RESULT_EVENT, (event) => resolveResult(event.detail), {
      once: true
    });
  });

  sandbox.dispatchEvent(new FakeCustomEvent(core.REQUEST_EVENT, {
    detail: { requestId: "csv-export-123456" }
  }));
  assert.deepEqual(plain(await result), {
    ok: true,
    requestId: "csv-export-123456",
    filename: "SO-42.csv",
    recordType: "salesorder",
    sublistId: "expense",
    rowCount: 1,
    columnCount: 7
  });
  assert.equal(links.length, 1);
  assert.equal(links[0].download, "SO-42.csv");
  assert.equal(links[0].clicked, true);
  assert.equal(links[0].removed, true);
  assert.equal(BrowserUrl.created[0].type, "text/csv;charset=utf-8");
  assert.match(
    BrowserUrl.created[0].parts[0],
    /^\ufeffDocument Number,Record Internal ID,Record External ID,Customer Internal ID,Customer,Account,Memo/
  );
  assert.match(BrowserUrl.created[0].parts[0], /"'=HYPERLINK\(""https:\/\/evil\.example""\)"/);
  assert.deepEqual(BrowserUrl.revoked, ["blob:test-1"]);
});

test("golden quality cases reject internal fields, raw fallbacks, HTML controls, and multiline output", async () => {
  assert.equal(qualityFixture.version, 2);
  for (const fixture of qualityFixture.cases) {
    let rawBodyFallbackCalls = 0;
    let rawSublistFallbackCalls = 0;
    let targetedItemIdCalls = 0;
    const uiOnlyFields = fixture.uiOnlyFieldIds.map((fieldId) => ({
      fieldId,
      label: "-",
      mandatory: "T",
      onScreen: "T"
    }));
    const bodyFieldDefinitions = [
      { fieldId: "tranid", label: "Document Number" },
      { fieldId: "shipaddress", label: "Shipping Address" },
      { fieldId: "rawmetadata", label: "Raw Metadata" },
      ...fixture.blockedBodyFieldIds.map((fieldId) => ({ fieldId, label: "" }))
    ];
    const lineFieldDefinitions = [
      { fieldId: "item", label: "Item" },
      { fieldId: "description", label: "Description" },
      { fieldId: "rawlinemetadata", label: "Raw Line Metadata" },
      ...fixture.blockedLineFieldIds.map((fieldId) => ({ fieldId, label: "" }))
    ];
    const bodyDefinitions = new Map(
      bodyFieldDefinitions.map((definition) => [definition.fieldId, definition])
    );
    const lineDefinitions = new Map(
      lineFieldDefinitions.map((definition) => [definition.fieldId, definition])
    );
    const recordRef = {
      id: 42,
      type: fixture.recordType,
      getFields: () => bodyFieldDefinitions.map(({ fieldId }) => fieldId),
      getField: ({ fieldId }) => {
        const definition = bodyDefinitions.get(fieldId);
        return definition ? { id: fieldId, label: definition.label } : null;
      },
      getValue: ({ fieldId }) => {
        if (fieldId === "customform") {
          return "77";
        }
        if (fieldId === "tranid") {
          return "TEST-42";
        }
        if (fieldId === "rawmetadata") {
          rawBodyFallbackCalls += 1;
          return { token: "raw-body-must-not-export" };
        }
        return "internal-body-must-not-export";
      },
      getText: ({ fieldId }) => ({
        tranid: "TEST-42",
        shipaddress: "Line 1\nLine 2",
        rawmetadata: "ERROR: Field 'rawmetadata' Not Found"
      })[fieldId] ?? "",
      getLineCount: ({ sublistId }) => sublistId === "item" ? 1 : 0,
      getSublistFields: ({ sublistId }) =>
        sublistId === "item"
          ? lineFieldDefinitions.map(({ fieldId }) => fieldId)
          : [],
      getSublistField: ({ sublistId, fieldId }) => {
        if (sublistId !== "item") {
          return null;
        }
        const definition = lineDefinitions.get(fieldId);
        return definition ? { id: fieldId, label: definition.label } : null;
      },
      getSublistText: ({ sublistId, fieldId }) => {
        assert.equal(sublistId, "item");
        return {
          line: "1",
          item: "Widget",
          description: "Blue\nWidget",
          rawlinemetadata: "ERROR: Field 'rawlinemetadata' Not Found"
        }[fieldId] ?? "";
      },
      getSublistValue: ({ sublistId, fieldId }) => {
        if (sublistId === "item" && fieldId === "item") {
          targetedItemIdCalls += 1;
          return 9001;
        }
        rawSublistFallbackCalls += 1;
        return ["raw-line-must-not-export"];
      }
    };
    const formRef = {
      getLineCount: ({ sublistId }) => sublistId === "body" ? uiOnlyFields.length : 0,
      getSublistValue: ({ sublistId, line, fieldId }) => {
        assert.equal(sublistId, "body");
        const definition = uiOnlyFields[line];
        return {
          bodyfield: definition.fieldId,
          bodylabel: definition.label,
          bodymandatory: definition.mandatory,
          bodybscreen: definition.onScreen
        }[fieldId] ?? "";
      }
    };
    const { sandbox } = createMainWorldHarness({
      currentRecord: { id: 42, type: fixture.recordType },
      recordRef,
      formRef
    });
    const result = new Promise((resolveResult) => {
      sandbox.addEventListener(
        sandbox.SuiteMateV3CsvExportCore.RESULT_EVENT,
        (event) => resolveResult(event.detail),
        { once: true }
      );
    });

    sandbox.dispatchEvent(new FakeCustomEvent(
      sandbox.SuiteMateV3CsvExportCore.REQUEST_EVENT,
      { detail: { requestId: `csv-quality-${fixture.recordType}` } }
    ));

    assert.deepEqual(plain(await result), {
      ok: true,
      requestId: `csv-quality-${fixture.recordType}`,
      filename: "TEST-42.csv",
      recordType: fixture.recordType,
      sublistId: "item",
      rowCount: 1,
      columnCount: qualityFixture.expectedHeaders.length - 2
    });
    const csv = BrowserUrl.created[0].parts[0].slice(1);
    assert.equal(
      csv,
      "Document Number,Record Internal ID,Shipping Address,Line ID,"
      + "Item Internal ID,Item,Description\r\n"
      + "TEST-42,42,Line 1 Line 2,1,9001,Widget,Blue Widget"
    );
    assert.equal(rawBodyFallbackCalls, 0);
    assert.equal(rawSublistFallbackCalls, 0);
    assert.equal(targetedItemIdCalls, 1);
    for (const fieldId of [
      ...fixture.blockedBodyFieldIds,
      ...fixture.blockedLineFieldIds,
      ...fixture.uiOnlyFieldIds
    ]) {
      assert.doesNotMatch(csv, new RegExp(fieldId, "i"));
    }
    assert.doesNotMatch(
      csv.replaceAll("\r\n", ""),
      /raw-body-must-not-export|raw-line-must-not-export|<div|\r|\n/
    );
  }
});

test("main-world baseline returns a readable failure instead of throwing", async () => {
  const { sandbox, links } = createMainWorldHarness({
    currentRecord: { id: "", type: "" }
  });
  const core = sandbox.SuiteMateV3CsvExportCore;
  const result = new Promise((resolveResult) => {
    sandbox.addEventListener(core.RESULT_EVENT, (event) => resolveResult(event.detail), {
      once: true
    });
  });

  sandbox.dispatchEvent(new FakeCustomEvent(core.REQUEST_EVENT, {
    detail: { requestId: "csv-export-987654" }
  }));
  assert.deepEqual(plain(await result), {
    ok: false,
    requestId: "csv-export-987654",
    error: {
      code: "CURRENT_RECORD_UNAVAILABLE",
      message: "This page does not expose a saved NetSuite record."
    }
  });
  assert.equal(links.length, 0);
});

test("the core keeps record values out of extension storage and network APIs", () => {
  assert.doesNotMatch(
    `${coreSource}\n${mainWorldSource}`,
    /chrome\.storage|localStorage|sessionStorage|fetch\(|XMLHttpRequest|innerHTML/
  );
});
