import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const utilitySource = await readFile(resolve("src/shared/utilities.js"), "utf8");
const browserUtilitySource = await readFile(resolve("src/shared/browser-utilities.js"), "utf8");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createHarness(extra = {}) {
  const sandbox = { ...extra };
  sandbox.globalThis = sandbox;
  runInNewContext(utilitySource, sandbox);
  runInNewContext(browserUtilitySource, sandbox);
  return {
    sandbox,
    api: sandbox.SuiteMateV3Utilities,
    browserApi: sandbox.SuiteMateV3BrowserUtilities
  };
}

test("loads without browser globals or initialization side effects", () => {
  const calls = [];
  const sandbox = {
    setTimeout() {
      calls.push("timer");
    }
  };
  sandbox.globalThis = sandbox;
  runInNewContext(utilitySource, sandbox);
  runInNewContext(browserUtilitySource, sandbox);

  assert.deepEqual(calls, []);
  assert.equal(sandbox.SuiteMateV3Utilities.VERSION, 1);
  assert.equal(sandbox.SuiteMateV3BrowserUtilities.VERSION, 1);
  assert.equal(Object.isFrozen(sandbox.SuiteMateV3Utilities), true);
  assert.equal(Object.isFrozen(sandbox.SuiteMateV3Utilities.csv), true);
  assert.equal(Object.isFrozen(sandbox.SuiteMateV3BrowserUtilities), true);
});

test("same-version registration is idempotent and incompatible globals are preserved", () => {
  const { sandbox, api } = createHarness();
  runInNewContext(utilitySource, sandbox);
  assert.equal(sandbox.SuiteMateV3Utilities, api);

  const incompatible = { VERSION: 99 };
  const blocked = { SuiteMateV3Utilities: incompatible };
  blocked.globalThis = blocked;
  runInNewContext(utilitySource, blocked);
  assert.equal(blocked.SuiteMateV3Utilities, incompatible);
});

test("deepFreeze handles cycles without reading accessors or traversing host objects", () => {
  const { api } = createHarness();
  let getterReads = 0;
  const value = { child: { enabled: true } };
  value.self = value;
  Object.defineProperty(value, "danger", {
    enumerable: true,
    get() {
      getterReads += 1;
      return {};
    }
  });
  const date = new Date();
  value.date = date;

  assert.equal(api.deepFreeze(value), value);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.child), true);
  assert.equal(Object.isFrozen(date), false);
  assert.equal(getterReads, 0);
});

test("normalizes hex colors and counts UTF-8 bytes", () => {
  const { api } = createHarness();
  assert.equal(api.normalizeHexColor(" #AbC "), "#aabbcc");
  assert.equal(api.normalizeHexColor("#123456"), "#123456");
  assert.equal(api.normalizeHexColor("#12345678"), null);
  assert.equal(api.normalizeHexColor(null), null);
  assert.equal(api.utf8ByteLength("ASCII"), 5);
  assert.equal(api.utf8ByteLength("é"), 2);
  assert.equal(api.utf8ByteLength("😀"), 4);
});

test("normalizes hostile errors without throwing or leaking stacks by default", () => {
  const { api } = createHarness();
  const throwing = {};
  Object.defineProperties(throwing, {
    code: { get() { throw new Error("code getter"); } },
    message: { get() { throw new Error("message getter"); } },
    toString: { value() { throw new Error("string conversion"); } }
  });
  assert.deepEqual(plain(api.normalizeError(throwing, {
    fallbackCode: "SAFE_ERROR",
    fallbackMessage: "Safe message"
  })), {
    code: "SAFE_ERROR",
    message: "Safe message",
    details: ""
  });

  const error = new Error("Broken");
  error.code = "NETSUITE_ERROR";
  error.details = "Useful details";
  assert.deepEqual(plain(api.normalizeError(error)), {
    code: "NETSUITE_ERROR",
    message: "Broken",
    details: "Useful details"
  });
  assert.equal(api.normalizeError({ message: "x", stack: "secret" }).details, "");
  assert.equal(api.normalizeError({ message: "x", stack: "trace" }, { includeStack: true }).details, "trace");
  assert.doesNotThrow(() => api.normalizeError(Symbol("failure")));
  assert.equal(api.normalizeError({ code: "x".repeat(500), message: "short" }).code.length, 128);
  assert.equal(api.normalizeError({ code: "x", message: "y".repeat(5000) }).message.length, 4000);
  const hostileProxy = new Proxy({}, { get() { throw new Error("blocked"); } });
  assert.doesNotThrow(() => api.normalizeError(hostileProxy));
});

test("serializes RFC 4180 CSV with formula protection and stable matrix order", () => {
  const { api } = createHarness();
  const rows = [
    ["name", "note", "value"],
    ["=SUM(A1:A2)", "line 1\nline \"2\"", -2],
    [" \t@cmd", null, true],
    ["+plus", "comma,value", 10n],
    ["-text", { id: 1 }, "😀"]
  ];
  const snapshot = rows.map((row) => [...row]);
  assert.equal(
    api.csv.serialize(rows),
    "name,note,value\r\n'=SUM(A1:A2),\"line 1\nline \"\"2\"\"\",-2\r\n' \t@cmd,,true\r\n'+plus,\"comma,value\",10\r\n'-text,\"{\"\"id\"\":1}\",😀"
  );
  assert.deepEqual(rows, snapshot);
  assert.equal(api.csv.protectValue(-2), "-2");
  assert.equal(api.csv.protectValue("\n+formula"), "'\n+formula");
  assert.equal(api.csv.escapeValue("a\rb"), '"a\rb"');
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(api.csv.serialize([[cyclic]]), "[object Object]");
  assert.equal(api.files.sanitizePart(" ACME AU "), "ACME-AU");
  assert.equal(api.files.sanitizeDownloadName("../../unsafe:name.csv"), "unsafe-name.csv");
  assert.equal(api.files.sanitizePart("x".repeat(100)).length, 80);
});

test("formats JSON deterministically and rejects invalid or oversized input", () => {
  const { api } = createHarness();
  assert.deepEqual(plain(api.syntax.formatJson('{"b":2,"a":1}')), {
    ok: true,
    language: "json",
    text: '{\n  "b": 2,\n  "a": 1\n}',
    error: null
  });
  assert.equal(api.syntax.formatJson("{").ok, false);
  assert.equal(api.syntax.formatJson("{").error.code, "INVALID_JSON");
  assert.equal(api.syntax.formatJson(`"${"x".repeat(20)}"`, { maxBytes: 10 }).error.code, "FORMAT_INPUT_TOO_LARGE");
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(api.syntax.formatJson(cyclic).ok, false);
});

test("clipboard writes synchronously inside the caller gesture and returns typed results", async () => {
  let gesture = true;
  const calls = [];
  const { browserApi } = createHarness();
  const clipboard = browserApi.clipboard.create({
    clipboard: {
      writeText(text) {
        calls.push([text, gesture]);
        return Promise.resolve();
      }
    }
  });
  const pending = clipboard.writeText("copy me");
  gesture = false;
  assert.deepEqual(calls, [["copy me", true]]);
  assert.deepEqual(plain(await pending), {
    ok: true,
    method: "clipboard",
    byteLength: 7
  });

  assert.equal((await browserApi.clipboard.create({ clipboard: null }).writeText("x")).error.code, "CLIPBOARD_UNAVAILABLE");
  const rejected = browserApi.clipboard.create({
    clipboard: { writeText: () => Promise.reject(new Error("denied")) }
  });
  assert.equal((await rejected.writeText("x")).error.code, "CLIPBOARD_WRITE_FAILED");
});

test("clipboard disposal invalidates a pending completion", async () => {
  let resolveWrite;
  const { browserApi } = createHarness();
  const clipboard = browserApi.clipboard.create({
    clipboard: {
      writeText() {
        return new Promise((resolve) => {
          resolveWrite = resolve;
        });
      }
    }
  });
  const pending = clipboard.writeText("pending");
  assert.equal(clipboard.dispose(), true);
  resolveWrite();
  assert.equal((await pending).error.code, "CLIPBOARD_DISPOSED");
  assert.equal((await clipboard.writeText("late")).error.code, "CLIPBOARD_DISPOSED");
});

function createDownloadHarness({ throwOnClick = false } = {}) {
  const calls = [];
  const blobs = [];
  const timers = new Map();
  let timerId = 0;
  class BlobClass {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options.type;
      blobs.push(this);
    }
  }
  const link = {
    href: "",
    download: "",
    click() {
      calls.push("click");
      if (throwOnClick) {
        throw new Error("click failed");
      }
    },
    remove() {
      calls.push("remove");
    }
  };
  const documentRef = {
    body: {
      append(node) {
        assert.equal(node, link);
        calls.push("append");
      }
    },
    createElement(tag) {
      assert.equal(tag, "a");
      calls.push("create");
      return link;
    }
  };
  const urlApi = {
    createObjectURL(blob) {
      assert.equal(blob, blobs.at(-1));
      calls.push("create-url");
      return "blob:test";
    },
    revokeObjectURL(url) {
      calls.push(["revoke", url]);
    }
  };
  const setTimeoutFn = (callback) => {
    timerId += 1;
    timers.set(timerId, callback);
    return timerId;
  };
  const clearTimeoutFn = (id) => timers.delete(id);
  return { BlobClass, calls, documentRef, urlApi, setTimeoutFn, clearTimeoutFn, timers, blobs, link };
}

test("downloads text with one BOM and deterministic anchor cleanup and revocation", () => {
  const harness = createDownloadHarness();
  const { browserApi } = createHarness();
  const download = browserApi.downloads.create(harness);
  const result = download.downloadText("name\r\nvalue", {
    filename: "../SuiteQL.csv",
    mimeType: "text/csv;charset=utf-8",
    bom: true
  });
  assert.equal(result.ok, true);
  assert.equal(result.filename, "SuiteQL.csv");
  assert.deepEqual(Array.from(harness.blobs[0].parts), ["\ufeffname\r\nvalue"]);
  assert.equal(harness.blobs[0].type, "text/csv;charset=utf-8");
  assert.deepEqual(harness.calls, ["create-url", "create", "append", "click", "remove"]);
  [...harness.timers.values()][0]();
  assert.deepEqual(harness.calls.at(-1), ["revoke", "blob:test"]);

  const second = download.downloadText("\ufeffalready", { filename: "second.csv", bom: true });
  assert.equal(second.ok, true);
  assert.equal(harness.blobs[1].parts[0], "\ufeffalready");
  assert.equal(download.dispose(), true);
});

test("download revokes immediately on click failure and fails in worker context", () => {
  const harness = createDownloadHarness({ throwOnClick: true });
  const { browserApi } = createHarness();
  const failed = browserApi.downloads.create(harness).downloadText("x", { filename: "x.txt" });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "DOWNLOAD_FAILED");
  assert.deepEqual(harness.calls.slice(-2), ["remove", ["revoke", "blob:test"]]);
  assert.equal(browserApi.downloads.create({ documentRef: null }).downloadText("x").error.code, "DOWNLOAD_UNAVAILABLE");
});

test("notice controller uses textContent, cancels stale timers and supports persistent notices", () => {
  const callbacks = new Map();
  let timerId = 0;
  const element = { textContent: "", dataset: {}, hidden: true, ariaLive: "polite" };
  const { browserApi } = createHarness();
  const notice = browserApi.notices.create({
    element,
    defaultDuration: 100,
    setTimeoutFn(callback) {
      timerId += 1;
      callbacks.set(timerId, callback);
      return timerId;
    },
    clearTimeoutFn(id) {
      callbacks.delete(id);
    }
  });

  notice.show("<b>first</b>", { type: "invalid" });
  const staleCallback = [...callbacks.values()][0];
  assert.equal(element.textContent, "<b>first</b>");
  assert.equal(element.dataset.type, "info");
  notice.show("second", { type: "success", duration: 0 });
  staleCallback();
  assert.equal(element.textContent, "second");
  assert.equal(element.hidden, false);
  assert.equal(element.ariaLive, "polite");
  assert.equal(notice.dispose(), true);
  assert.equal(notice.show("late").ok, false);
});

function createElement({ attributes = {}, connected = true } = {}) {
  const values = new Map(Object.entries(attributes));
  const listeners = new Map();
  return {
    hidden: false,
    inert: false,
    isConnected: connected,
    ownerDocument: { activeElement: null },
    classList: { toggle() {}, remove() {} },
    focusCount: 0,
    focus() { this.focusCount += 1; this.ownerDocument.activeElement = this; },
    hasAttribute(name) { return values.has(name); },
    getAttribute(name) { return values.has(name) ? values.get(name) : null; },
    setAttribute(name, value) { values.set(name, String(value)); },
    removeAttribute(name) { values.delete(name); },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    querySelectorAll() { return []; },
    values,
    listeners
  };
}

test("modal restores inert and aria state, focus ownership and listeners", () => {
  const { browserApi } = createHarness();
  const dialog = createElement({ attributes: { role: "dialog" } });
  dialog.hidden = true;
  const firstBackground = createElement({ attributes: { "aria-hidden": "false" } });
  const secondBackground = createElement({ attributes: { inert: "", "aria-hidden": "true" } });
  secondBackground.inert = true;
  const trigger = createElement();
  const initialFocus = createElement();
  const body = createElement();
  const modal = browserApi.modals.create({
    dialog,
    backgroundElements: [firstBackground, secondBackground],
    body,
    bodyClass: "open"
  });

  assert.equal(modal.show({ trigger, initialFocus }), true);
  assert.equal(modal.show({ trigger, initialFocus }), false);
  assert.equal(dialog.hidden, false);
  assert.equal(firstBackground.inert, true);
  assert.equal(firstBackground.getAttribute("aria-hidden"), "true");
  assert.equal(initialFocus.focusCount, 1);
  assert.equal(dialog.listeners.has("keydown"), true);
  assert.equal(modal.hide(), true);
  assert.equal(dialog.hidden, true);
  assert.equal(firstBackground.inert, false);
  assert.equal(firstBackground.getAttribute("aria-hidden"), "false");
  assert.equal(secondBackground.inert, true);
  assert.equal(secondBackground.getAttribute("aria-hidden"), "true");
  assert.equal(trigger.focusCount, 1);
  assert.equal(dialog.listeners.size, 0);
});

function createXmlNode(name, children = [], text = "") {
  return {
    nodeType: 1,
    nodeName: name,
    childNodes: children,
    textContent: text || children.map((child) => child.textContent || "").join(""),
    cloneNode() {
      return createXmlNode(name);
    }
  };
}

class FakeXmlParser {
  parseFromString(text) {
    if (text === "invalid") {
      return { documentElement: null, getElementsByTagName: () => [{}] };
    }
    const textNode = { nodeType: 3, textContent: "value", serialized: "value" };
    const child = createXmlNode("child", [textNode], "value");
    const root = createXmlNode("root", [child], "value");
    return {
      documentElement: root,
      childNodes: [root],
      getElementsByTagName: () => []
    };
  }
}

class FakeXmlSerializer {
  serializeToString(node) {
    if (node.serialized) {
      return node.serialized;
    }
    if (!node.childNodes?.length) {
      return `<${node.nodeName}/>`;
    }
    return `<${node.nodeName}>${node.childNodes.map((child) => this.serializeToString(child)).join("")}</${node.nodeName}>`;
  }
}

test("XML formatter returns text only and rejects invalid or unavailable parsers", () => {
  const { browserApi } = createHarness();
  const formatter = browserApi.syntax.createXmlFormatter({
    DOMParserClass: FakeXmlParser,
    XMLSerializerClass: FakeXmlSerializer
  });
  assert.deepEqual(plain(formatter.format("<root><child>value</child></root>")), {
    ok: true,
    language: "xml",
    text: "<root>\n  <child>value</child>\n</root>",
    error: null
  });
  assert.equal(formatter.format("invalid").error.code, "INVALID_XML");
  assert.equal(browserApi.syntax.createXmlFormatter({ DOMParserClass: null }).format("<x/>").error.code, "XML_FORMATTER_UNAVAILABLE");
});
