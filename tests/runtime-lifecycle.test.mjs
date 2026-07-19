import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = Object.fromEntries(await Promise.all(
  [
    "src/shared/routes.js",
    "src/shared/bridge.js",
    "src/shared/settings.js",
    "src/record-actions/core.js",
    "src/import-assistant/core.js",
    "src/runtime/theme-runtime.js",
    "src/record-actions/csv-import.js",
    "src/import-assistant/context-runtime.js"
  ].map(async (file) => [file, await readFile(resolve(root, file), "utf8")])
));

async function flushTasks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createLocation(value) {
  const url = new URL(value);
  return {
    href: url.href,
    origin: url.origin,
    hostname: url.hostname,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash
  };
}

function createLifecycleStub() {
  let registration = null;
  let handle = null;
  let controller = null;
  let generation = 0;
  let active = false;
  let lastRun = Promise.resolve();

  function run(reason = "initial") {
    if (!registration || !active) {
      return Promise.resolve();
    }
    const runGeneration = generation;
    lastRun = Promise.resolve(registration.evaluate({
      reason,
      records: [],
      signal: controller.signal,
      isCurrent: () => active && generation === runGeneration && !controller.signal.aborted
    }));
    return lastRun;
  }

  const api = {
    register(config) {
      registration = config;
      controller = new AbortController();
      active = !config.startPaused;
      generation += 1;
      handle = {
        pause(reason = "paused") {
          if (!active) {
            return false;
          }
          active = false;
          generation += 1;
          controller.abort(reason);
          config.cleanup?.({ reason });
          return true;
        },
        resume() {
          if (active) {
            return false;
          }
          active = true;
          generation += 1;
          controller = new AbortController();
          void run("resumed");
          return true;
        }
      };
      if (active) {
        void run();
      }
      return handle;
    },
    waitFor: async () => true,
    get registration() {
      return registration;
    },
    get handle() {
      return handle;
    },
    get lastRun() {
      return lastRun;
    },
    run
  };
  return api;
}

test("theme ignores a stale settings read after a newer storage update", async () => {
  let resolveInitialRead;
  const initialRead = new Promise((resolve) => {
    resolveInitialRead = resolve;
  });
  const storageListeners = [];
  const classes = new Set();
  const styleValues = new Map();
  const documentElement = {
    dataset: {},
    classList: {
      contains: (name) => classes.has(name),
      toggle(name, enabled) {
        if (enabled) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      }
    },
    style: {
      setProperty(name, value) {
        styleValues.set(name, value);
      },
      removeProperty(name) {
        styleValues.delete(name);
      }
    }
  };
  const location = createLocation("https://123456.app.netsuite.com/app/center/card.nl");
  const sandbox = {
    URL,
    URLSearchParams,
    location,
    history: { length: 1 },
    navigator: { platform: "MacIntel" },
    document: {
      documentElement,
      readyState: "complete",
      referrer: "",
      querySelector: () => null,
      addEventListener() {}
    },
    matchMedia() {
      return { matches: false, addEventListener() {} };
    },
    addEventListener() {},
    chrome: {
      runtime: {
        onMessage: { addListener() {} }
      },
      storage: {
        sync: {
          async get(key) {
            return { [key]: await initialRead };
          }
        },
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          }
        }
      }
    },
    SuiteMateV3Lifecycle: {
      register(config) {
        void config.evaluate({
          signal: new AbortController().signal,
          isCurrent: () => true
        });
        return {};
      }
    },
    console
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  runInNewContext(sources["src/shared/routes.js"], sandbox);
  runInNewContext(sources["src/shared/settings.js"], sandbox);
  runInNewContext(sources["src/runtime/theme-runtime.js"], sandbox);

  const newerSettings = {
    schemaVersion: 1,
    enabled: true,
    mode: "dark",
    squareCorners: false,
    roleThemes: {}
  };
  storageListeners[0](
    { suiteMateV3Style: { newValue: newerSettings } },
    "sync"
  );
  resolveInitialRead({
    schemaVersion: 1,
    enabled: true,
    mode: "light",
    squareCorners: false,
    roleThemes: {}
  });
  await flushTasks();

  assert.equal(documentElement.dataset.suitemateV3Mode, "dark");
  assert.equal(classes.has("isDarkMode"), true);
});

test("CSV Import rejects a late record-type response after lifecycle pause", async () => {
  let mainFormReady = false;
  let toolbarReady = false;
  let injectedAction = null;
  let resolveRecordType;
  let recordTypeResponse = new Promise((resolve) => {
    resolveRecordType = resolve;
  });
  const lifecycle = createLifecycleStub();
  const location = createLocation(
    "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=1"
  );
  const actionsCell = {
    isConnected: true,
    querySelector: () => ({ textContent: "Actions" }),
    after(node) {
      injectedAction = node;
    }
  };
  const document = {
    documentElement: { dataset: {} },
    querySelector(selector) {
      if (selector === "#main_form") {
        return mainFormReady ? {} : null;
      }
      if (selector === '[data-suitemate-v3-action="csv-import-toolbar"]') {
        return injectedAction;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes("td.uir-button-menu")) {
        return toolbarReady ? [actionsCell] : [];
      }
      if (selector.includes("data-suitemate-v3-action")) {
        return injectedAction ? [injectedAction] : [];
      }
      return [];
    },
    createElement(tagName) {
      return {
        tagName,
        dataset: {},
        append(child) {
          this.child = child;
        },
        remove() {
          if (injectedAction === this) {
            injectedAction = null;
          }
        }
      };
    }
  };
  const storageListeners = [];
  const sandbox = {
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    Node: { ELEMENT_NODE: 1 },
    location,
    document,
    SuiteMateV3Lifecycle: lifecycle,
    SuiteMateV3Settings: {
      STORAGE_KEY: "suiteMateV3Style",
      async get() {
        return { enabled: true };
      },
      normalize(value) {
        return value;
      }
    },
    chrome: {
      runtime: {
        async sendMessage(message) {
          const recordType = await recordTypeResponse;
          return {
            type: "SUITEMATE_V3_NETSUITE_BRIDGE_RESPONSE",
            version: 1,
            ok: true,
            requestId: message.requestId,
            command: message.command,
            data: { recordType }
          };
        }
      },
      storage: {
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          }
        }
      }
    },
    console
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  runInNewContext(sources["src/shared/routes.js"], sandbox);
  runInNewContext(sources["src/shared/bridge.js"], sandbox);
  runInNewContext(sources["src/record-actions/core.js"], sandbox);
  runInNewContext(sources["src/record-actions/csv-import.js"], sandbox);
  await flushTasks();

  mainFormReady = true;
  toolbarReady = true;
  const pendingInstallation = lifecycle.run("mutation");
  lifecycle.handle.pause("settings-disabled");
  resolveRecordType("salesorder");
  await pendingInstallation;
  assert.equal(injectedAction, null);

  recordTypeResponse = Promise.resolve("salesorder");
  lifecycle.handle.resume("settings-enabled");
  await lifecycle.lastRun;
  assert.equal(injectedAction?.dataset.suitemateV3Action, "csv-import-toolbar");

  const nestedToolbar = {
    nodeType: 1,
    matches: () => false,
    querySelector: (selector) => selector.includes("td.uir-button-menu") ? actionsCell : null
  };
  assert.equal(
    lifecycle.registration.relevant([
      { addedNodes: [nestedToolbar], removedNodes: [] }
    ]),
    true
  );
});

test("Import Assistant does not write a subtype after its sourced option wait fails", async () => {
  const lifecycle = createLifecycleStub();
  lifecycle.waitFor = async ({ id }) => id === "import-assistant.step-one";
  const location = createLocation(
    "https://123456.app.netsuite.com/app/setup/assistants/nsimport/importassistant.nl?recordsubtype=salesorder"
  );
  const documentElement = { dataset: {} };
  const sentValues = [];
  const storageListeners = [];
  const fields = {
    recordtype: { value: "ACCOUNTING" },
    recordsubtype: { value: "ACCOUNT" },
    inpt_recordtype: { focus() {} }
  };
  const document = {
    documentElement,
    querySelector(selector) {
      if (selector.includes("uir_assistant_step_number")) {
        return { textContent: "1" };
      }
      const name = selector.match(/\[name="([^"]+)"\]/)?.[1];
      if (name) {
        return fields[name] ?? null;
      }
      const dataName = selector.match(/\[data-name="([^"]+)"\]/)?.[1];
      if (dataName === "recordtype") {
        return {
          dataset: {
            options: JSON.stringify([
              { value: "ACCOUNTING", text: "Accounting" },
              { value: "TRANSACTION", text: "Transactions" }
            ])
          }
        };
      }
      if (dataName === "recordsubtype") {
        return {
          dataset: {
            options: JSON.stringify([{ value: "ACCOUNT", text: "Account" }])
          }
        };
      }
      return null;
    }
  };
  const sandbox = {
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    location,
    document,
    SuiteMateV3Lifecycle: lifecycle,
    SuiteMateV3Settings: {
      STORAGE_KEY: "suiteMateV3Style",
      async get() {
        return { enabled: true };
      },
      normalize(value) {
        return value;
      }
    },
    chrome: {
      runtime: {
        async sendMessage(message) {
          sentValues.push(message.payload.values);
          return {
            type: "SUITEMATE_V3_NETSUITE_BRIDGE_RESPONSE",
            version: 1,
            ok: true,
            requestId: message.requestId,
            command: message.command,
            data: { applied: Object.keys(message.payload.values) }
          };
        }
      },
      storage: {
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          }
        }
      }
    },
    fetch: async () => {
      throw new Error("Unexpected category fetch");
    },
    console
  };
  sandbox.globalThis = sandbox;
  sandbox.top = sandbox;
  runInNewContext(sources["src/shared/routes.js"], sandbox);
  runInNewContext(sources["src/shared/bridge.js"], sandbox);
  runInNewContext(sources["src/import-assistant/core.js"], sandbox);
  runInNewContext(sources["src/import-assistant/context-runtime.js"], sandbox);
  await flushTasks();
  await lifecycle.lastRun;

  assert.deepEqual(
    JSON.parse(JSON.stringify(sentValues)),
    [{ charencoding: "UTF-8", recordtype: "TRANSACTION" }]
  );
  assert.equal(documentElement.dataset.suitemateV3ImportContext, "unavailable");
});
