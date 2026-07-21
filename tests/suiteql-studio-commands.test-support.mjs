import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [
  utilitySource,
  browserUtilitySource,
  routeSource,
  commandSource,
  suiteqlCoreSource,
  studioModuleSource
] = await Promise.all([
  readFile(resolve(root, "src/shared/utilities.js"), "utf8"),
  readFile(resolve(root, "src/shared/browser-utilities.js"), "utf8"),
  readFile(resolve(root, "src/shared/routes.js"), "utf8"),
  readFile(resolve(root, "src/shared/commands.js"), "utf8"),
  readFile(resolve(root, "src/suiteql/core.js"), "utf8"),
  readFile(resolve(root, "src/suiteql/studio-entry.js"), "utf8")
]);
const studioSource = studioModuleSource.replace(/^import .*;\n/gm, "");

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function flushTasks() {
  return new Promise((resolveTask) => setImmediate(resolveTask));
}

class FakeClassList {
  values = new Set();

  add(...values) {
    for (const value of values) {
      this.values.add(value);
    }
  }

  remove(...values) {
    for (const value of values) {
      this.values.delete(value);
    }
  }
}

class FakeElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.dataset = {};
    this.style = {
      height: "",
      setProperty() {}
    };
    this.classList = new FakeClassList();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.textContent = "";
    this.parentNode = null;
    this._elementsById = new Map();
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this._elementsById.clear();
    const tagById = new Map();
    for (const match of this._innerHTML.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/gi)) {
      tagById.set(match[2], match[1]);
    }
    for (const [id, tagName] of tagById) {
      const element = new FakeElement(tagName, id);
      const openingTag = this._innerHTML.match(
        new RegExp(`<${tagName}[^>]*\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`, "i")
      )?.[0] ?? "";
      element.hidden = /\shidden(?:\s|>|=)/i.test(openingTag);
      element.disabled = /\sdisabled(?:\s|>|=)/i.test(openingTag);
      this._elementsById.set(id, element);
    }
    const table = this._elementsById.get("suiteql-result-table");
    if (table) {
      table.tHead = new FakeElement("thead");
      table.tBodies = [new FakeElement("tbody")];
    }
  }

  get innerHTML() {
    return this._innerHTML ?? "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatchEvent(event) {
    if (!event.target) {
      event.target = this;
    }
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
      listener(event);
    }
    return event.defaultPrevented !== true;
  }

  click() {
    this.dispatchEvent(new FakeEvent("click"));
  }

  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  querySelector(selector) {
    return selector.startsWith("#") ? this._elementsById.get(selector.slice(1)) ?? null : null;
  }

  closest(selector) {
    return selector === "button[data-column]" && this.tagName === "BUTTON"
      ? this
      : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  getBoundingClientRect() {
    return { height: 300 };
  }

  setPointerCapture() {}

  requestMeasure() {}
}

class FakeEvent {
  constructor(type) {
    this.type = type;
    this.target = null;
    this.defaultPrevented = false;
    this.persisted = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

function success(requestId, {
  rows = [{ id: "row" }],
  paged = false,
  pageIndex = 0,
  loadedCount = rows.length,
  totalCount = rows.length,
  totalPages = rows.length ? 1 : 0
} = {}) {
  return {
    ok: true,
    requestId,
    columns: ["id"],
    rows,
    elapsedMs: 1,
    paged,
    pageIndex,
    pageSize: paged ? 1000 : rows.length,
    loadedCount,
    totalCount,
    totalPages
  };
}

function createStudioHarness(onRequest) {
  const workspaceHost = new FakeElement("div", "body");
  const documentElement = new FakeElement("html");
  const body = new FakeElement("body");
  const documentListeners = new Map();
  const windowListeners = new Map();
  const sessionValues = new Map();
  const capturedBindings = [];
  const requests = [];
  let requestSequence = 0;

  const document = {
    readyState: "complete",
    documentElement,
    body,
    title: "",
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    querySelector(selector) {
      if (selector === "#body") {
        return workspaceHost;
      }
      return null;
    },
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) ?? [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    }
  };

  class FakeEditorView {
    static lineWrapping = {};
    static updateListener = { of: (listener) => ({ listener }) };

    constructor({ doc, extensions }) {
      this.state = {
        doc: { toString: () => doc },
        selection: { main: { empty: true, from: 0, to: 0 } },
        sliceDoc: (from, to) => doc.slice(from, to)
      };
      this.extensions = extensions;
    }

    focus() {}

    requestMeasure() {}
  }

  const bridgeApi = {
    COMMANDS: {
      SUITEQL_START: "suiteql.start",
      SUITEQL_PAGE: "suiteql.page",
      SUITEQL_DISPOSE: "suiteql.dispose"
    },
    request(command, payload, options = {}) {
      const call = { command, payload, requestId: options.requestId };
      requests.push(call);
      return onRequest(call);
    },
    toCommandResult(value) {
      return value;
    }
  };

  const location = new URL(
    "https://123456.app.netsuite.com/app/common/search/ubersearchresults.nl"
      + "?suiteql=SELECT%20id%20FROM%20customrecordtype%20ORDER%20BY%20id"
  );
  const sandbox = {
    URL,
    URLSearchParams,
    Blob,
    Blob,
    console,
    navigator: { platform: "MacIntel" },
    document,
    location,
    history: {
      state: null,
      replaceState() {}
    },
    sessionStorage: {
      getItem: (key) => sessionValues.get(key) ?? null,
      setItem: (key, value) => sessionValues.set(key, String(value))
    },
    crypto: {
      randomUUID: () => `studio-request-${++requestSequence}`
    },
    confirm: () => true,
    prompt: () => null,
    open() {},
    Event: FakeEvent,
    basicSetup: {},
    StandardSQL: {},
    sql: () => ({}),
    Prec: { high: (value) => value },
    keymap: {
      of(bindings) {
        capturedBindings.push(...bindings);
        return { bindings };
      }
    },
    EditorView: FakeEditorView,
    setTimeout,
    clearTimeout
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  sandbox.window.top = sandbox;
  sandbox.window.innerHeight = 900;
  sandbox.window.addEventListener = (type, listener) => {
    const listeners = windowListeners.get(type) ?? [];
    listeners.push(listener);
    windowListeners.set(type, listeners);
  };
  sandbox.globalThis = sandbox;

  runInNewContext(utilitySource, sandbox);
  runInNewContext(browserUtilitySource, sandbox);
  runInNewContext(routeSource, sandbox);
  runInNewContext(commandSource, sandbox);
  runInNewContext(suiteqlCoreSource, sandbox);
  sandbox.SuiteMateV3Bridge = bridgeApi;
  runInNewContext(studioSource, sandbox);

  const rootElement = workspaceHost.children[0];
  return {
    bindings: capturedBindings,
    requests,
    element: (id) => rootElement.querySelector(`#${id}`),
    resultIds() {
      const table = this.element("suiteql-result-table");
      return table.tBodies[0].children.map(
        (row) => row.children[0].children[0].textContent
      );
    }
  };
}

function binding(harness, key) {
  const matches = harness.bindings.filter((candidate) => candidate.key === key);
  assert.equal(matches.length, 1, `${key} must have exactly one CodeMirror owner`);
  return matches[0];
}

test("SuiteQL Console gives each shortcut one owner and Execute sends one start request", async () => {
  const harness = createStudioHarness((call) => {
    if (call.command === "suiteql.start") {
      return Promise.resolve(success(call.requestId));
    }
    return Promise.resolve({ ok: true, requestId: call.requestId });
  });

  assert.deepEqual(
    harness.bindings.map(({ key }) => key),
    ["Mod-e", "Escape", "Mod-Shift-p", "Mod-Shift-e", "Mod-Shift-l"]
  );
  assert.equal(binding(harness, "Mod-e").run(), true);
  await flushTasks();

  assert.equal(
    harness.requests.filter(({ command }) => command === "suiteql.start").length,
    1
  );
});

test("SuiteQL Console Abort permits immediate restart and discards the abandoned completion", async () => {
  const starts = [deferred(), deferred()];
  let startIndex = 0;
  const harness = createStudioHarness((call) => {
    if (call.command === "suiteql.start") {
      return starts[startIndex++].promise;
    }
    return Promise.resolve({ ok: true, requestId: call.requestId });
  });
  const execute = binding(harness, "Mod-e");
  const abort = binding(harness, "Escape");

  execute.run();
  assert.equal(abort.run(), true);
  execute.run();
  assert.equal(startIndex, 2, "The second query must start before the abandoned query settles");

  starts[1].resolve(success("studio-request-2", { rows: [{ id: "current" }] }));
  await flushTasks();
  assert.deepEqual(harness.resultIds(), ["current"]);

  starts[0].resolve(success("studio-request-1", { rows: [{ id: "stale" }] }));
  await flushTasks();
  assert.deepEqual(harness.resultIds(), ["current"]);
});

test("SuiteQL Console can load a new query page while an aborted page request is still pending", async () => {
  const pages = [deferred(), deferred()];
  let startCount = 0;
  let pageIndex = 0;
  const harness = createStudioHarness((call) => {
    if (call.command === "suiteql.start") {
      startCount += 1;
      return Promise.resolve(success(call.requestId, {
        rows: [{ id: `query-${startCount}` }],
        paged: true,
        loadedCount: 1,
        totalCount: 3,
        totalPages: 3
      }));
    }
    if (call.command === "suiteql.page") {
      return pages[pageIndex++].promise;
    }
    return Promise.resolve({ ok: true, requestId: call.requestId });
  });
  const execute = binding(harness, "Mod-e");
  const abort = binding(harness, "Escape");
  const paged = harness.element("suiteql-paged");
  const loadNext = harness.element("suiteql-load-next");
  paged.checked = true;

  execute.run();
  await flushTasks();
  loadNext.click();
  assert.equal(pageIndex, 1);
  assert.equal(abort.run(), true);

  execute.run();
  await flushTasks();
  loadNext.click();
  assert.equal(pageIndex, 2, "The new page request must not wait for the abandoned page");

  pages[1].resolve(success("studio-request-2", {
    rows: [{ id: "current-page" }],
    paged: true,
    pageIndex: 1,
    loadedCount: 2,
    totalCount: 3,
    totalPages: 3
  }));
  await flushTasks();
  assert.deepEqual(harness.resultIds(), ["query-2", "current-page"]);

  pages[0].resolve(success("studio-request-1", {
    rows: [{ id: "stale-page" }],
    paged: true,
    pageIndex: 1,
    loadedCount: 2,
    totalCount: 3,
    totalPages: 3
  }));
  await flushTasks();
  assert.deepEqual(harness.resultIds(), ["query-2", "current-page"]);
});
