import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = Object.fromEntries(await Promise.all(
  [
    "src/shared/utilities.js",
    "src/shared/routes.js",
    "src/shared/commands.js",
    "src/shared/bridge.js",
    "src/shared/settings.js",
    "src/internal-ids/core.js",
    "src/internal-ids/runtime.js",
    "src/record-actions/core.js",
    "src/csv-export/core.js",
    "src/csv-export/runtime.js",
    "src/import-assistant/core.js",
    "src/runtime/theme-runtime.js",
    "src/record-actions/csv-import.js",
    "src/import-assistant/context-runtime.js"
  ].map(async (file) => [file, await readFile(resolve(root, file), "utf8")])
));

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

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
  runInNewContext(sources["src/shared/utilities.js"], sandbox);
  runInNewContext(sources["src/shared/routes.js"], sandbox);
  runInNewContext(sources["src/shared/settings.js"], sandbox);
  runInNewContext(sources["src/runtime/theme-runtime.js"], sandbox);

  const newerSettings = {
    schemaVersion: 2,
    enabled: true,
    mode: "dark",
    squareCorners: false,
    showInternalIds: false,
    roleThemes: {}
  };
  storageListeners[0](
    { suiteMateV3Style: { newValue: newerSettings } },
    "sync"
  );
  resolveInitialRead({
    schemaVersion: 2,
    enabled: true,
    mode: "light",
    squareCorners: false,
    showInternalIds: false,
    roleThemes: {}
  });
  await flushTasks();

  assert.equal(documentElement.dataset.suitemateV3Mode, "dark");
  assert.equal(classes.has("isDarkMode"), true);
});

test("Internal IDs follows its setting live and removes only owned badges", async () => {
  const lifecycle = createLifecycleStub();
  const storageListeners = [];
  const rootClasses = new Set();
  const badges = [];
  const label = {
    badge: null,
    querySelector(selector) {
      return selector.includes("data-suitemate-v3-internal-id") && this.badge?.isConnected
        ? this.badge
        : null;
    },
    append(badge) {
      badge.isConnected = true;
      this.badge = badge;
      badges.push(badge);
    }
  };
  const fieldWrapper = {
    nodeType: 1,
    dataset: { walkthrough: "Field:entity" },
    querySelector(selector) {
      return selector === ".uir-label > span" ? label : null;
    }
  };
  const documentElement = {
    dataset: {},
    classList: {
      add(name) {
        rootClasses.add(name);
      },
      remove(name) {
        rootClasses.delete(name);
      }
    }
  };
  const document = {
    documentElement,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '[data-walkthrough^="Field:"]') {
        return [fieldWrapper];
      }
      if (selector.includes(".ns-field-id[data-suitemate-v3-internal-id]")) {
        return badges.filter((badge) => badge.isConnected);
      }
      return [];
    },
    createElement() {
      return {
        className: "",
        dataset: {},
        textContent: "",
        title: "",
        isConnected: false,
        remove() {
          this.isConnected = false;
        }
      };
    }
  };
  const location = createLocation(
    "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=1"
  );
  const sandbox = {
    URL,
    URLSearchParams,
    location,
    document,
    CSS: { escape: (value) => String(value) },
    chrome: {
      runtime: {},
      storage: {
        sync: {
          async get(key) {
            return {
              [key]: {
                schemaVersion: 2,
                enabled: false,
                mode: "light",
                squareCorners: false,
                showInternalIds: true,
                roleThemes: {}
              }
            };
          }
        },
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          }
        }
      }
    },
    SuiteMateV3Lifecycle: lifecycle,
    SuiteMateV3Bridge: {
      COMMANDS: { RECORD_GET_TYPE: "record.getType" },
      async request() {
        throw new Error("Record bridge should not run in this fixture");
      },
      toCommandResult: (value) => value
    },
    SuiteMateV3RecordActionsCore: {
      resolveRecordTypeFromDocument: () => null,
      normalizeRecordType: (value) => value
    },
    addEventListener() {},
    console
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  runInNewContext(sources["src/shared/utilities.js"], sandbox);
  runInNewContext(sources["src/shared/routes.js"], sandbox);
  runInNewContext(sources["src/shared/settings.js"], sandbox);
  runInNewContext(sources["src/internal-ids/core.js"], sandbox);
  runInNewContext(sources["src/internal-ids/runtime.js"], sandbox);
  await flushTasks();

  assert.equal(rootClasses.has("show-field-ids"), true);
  assert.equal(documentElement.dataset.suitemateV3InternalIds, "visible");
  assert.equal(label.badge.textContent, "entity");
  assert.equal(label.badge.dataset.suitemateV3InternalId, "field");
  assert.equal(label.badge.isConnected, true);

  storageListeners[0]({
    suiteMateV3Style: {
      newValue: {
        schemaVersion: 2,
        enabled: false,
        mode: "light",
        squareCorners: false,
        showInternalIds: false,
        roleThemes: {}
      }
    }
  }, "sync");

  assert.equal(rootClasses.has("show-field-ids"), false);
  assert.equal(documentElement.dataset.suitemateV3InternalIds, "hidden");
  assert.equal(label.badge.isConnected, false);
});

test("CSV Utils rejects stale installation and routes Import, Export and Template independently", async () => {
  let mainFormReady = false;
  let toolbarReady = false;
  let injectedAction = null;
  const exportInvocations = [];
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
    activeElement: null,
    querySelector(selector) {
      if (selector === "#main_form") {
        return mainFormReady ? {} : null;
      }
      if (selector === '[data-suitemate-v3-action="csv-utils-toolbar"]') {
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
      const element = {
        tagName,
        className: "",
        dataset: {},
        attributes: {},
        listeners: {},
        children: [],
        style: {},
        isConnected: true,
        addEventListener(type, listener) {
          this.listeners[type] = listener;
        },
        setAttribute(name, value) {
          this.attributes[name] = String(value);
        },
        append(...children) {
          this.children.push(...children);
          for (const child of children) {
            child.parent = this;
          }
        },
        contains(candidate) {
          if (!candidate) {
            return false;
          }
          return candidate === this
            || this.children.some((child) => child.contains?.(candidate));
        },
        focus() {
          document.activeElement = this;
        },
        remove() {
          this.isConnected = false;
          if (injectedAction === this) {
            injectedAction = null;
          }
        }
      };
      return element;
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
    addEventListener() {},
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
            version: 2,
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
  sandbox[Symbol.for("SuiteMateV3.csvExport.runtime.v3")] = {
    invoke(mode = "export") {
      exportInvocations.push(mode);
      return { ok: true };
    }
  };
  runInNewContext(sources["src/shared/utilities.js"], sandbox);
  runInNewContext(sources["src/shared/routes.js"], sandbox);
  runInNewContext(sources["src/shared/commands.js"], sandbox);
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
  assert.equal(injectedAction?.dataset.suitemateV3Action, "csv-utils-toolbar");
  assert.equal(injectedAction?.className, "suitemate-v3-csv-utils-cell");
  const createdElements = [];
  const collectElements = (element) => {
    createdElements.push(element);
    element.children?.forEach(collectElements);
  };
  collectElements(injectedAction);
  const importLink = createdElements.find(
    (element) => element.dataset?.suitemateV3Action === "csv-utils-import"
  );
  const exportLink = createdElements.find(
    (element) => element.dataset?.suitemateV3Action === "csv-utils-export"
  );
  const templateLink = createdElements.find(
    (element) => element.dataset?.suitemateV3Action === "csv-utils-template"
  );
  const trigger = createdElements.find(
    (element) => element.dataset?.suitemateV3Action === "csv-utils-trigger"
  );
  const parentItem = createdElements.find(
    (element) => element.className === "ns-menuitem suitemate-v3-csv-utils-parent"
  );
  assert.equal(importLink?.dataset.suitemateV3Command, "record.csv-import");
  assert.equal(exportLink?.dataset.suitemateV3Command, "record.csv-export");
  assert.equal(templateLink?.dataset.suitemateV3Command, "record.csv-template");
  assert.equal(trigger?.textContent, "CSV Utils");
  assert.equal(parentItem?.listeners.pointerenter, undefined, "Hover must not open CSV Utils");
  assert.equal(parentItem?.listeners.pointerleave, undefined, "Hover must not close CSV Utils");
  assert.equal(parentItem?.dataset.open, "false");

  let triggerPrevented = false;
  trigger.listeners.click({
    preventDefault() {
      triggerPrevented = true;
    }
  });
  assert.equal(triggerPrevented, true);
  assert.equal(parentItem?.dataset.open, "true");
  assert.equal(trigger?.attributes["aria-expanded"], "true");
  trigger.listeners.click({ preventDefault() {} });
  assert.equal(parentItem?.dataset.open, "false");
  assert.equal(trigger?.attributes["aria-expanded"], "false");

  let prevented = false;
  importLink.listeners.click({
    preventDefault() {
      prevented = true;
    }
  });
  assert.equal(prevented, false, "An authorized CSV Import click must retain native navigation");
  prevented = false;
  let stopped = false;
  exportLink.listeners.click({
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    }
  });
  assert.equal(prevented, true, "CSV Export must not navigate away from the record");
  assert.equal(stopped, true);
  assert.deepEqual(exportInvocations, ["export"]);
  prevented = false;
  stopped = false;
  templateLink.listeners.click({
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    }
  });
  assert.equal(prevented, true, "CSV Template must not navigate away from the record");
  assert.equal(stopped, true);
  assert.deepEqual(exportInvocations, ["export", "template"]);

  const installedLink = importLink;
  storageListeners[0](
    { suiteMateV3Style: { newValue: { enabled: false } } },
    "sync"
  );
  installedLink.listeners.click({
    preventDefault() {
      prevented = true;
    }
  });
  assert.equal(prevented, true, "A stale CSV Import link must fail closed at click time");

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

test("CSV Utils Export and Template invoke the typed bridge and report their downloads", async () => {
  const location = createLocation(
    "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=1"
  );
  const storageListeners = [];
  const statusElements = [];
  const exportLink = {
    textContent: "Export",
    attributes: {},
    style: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  };
  const templateLink = {
    textContent: "Template",
    attributes: {},
    style: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  };
  const document = {
    documentElement: { dataset: {} },
    querySelector(selector) {
      if (selector === '[data-suitemate-v3-action="csv-utils-export"]') {
        return exportLink;
      }
      if (selector === '[data-suitemate-v3-action="csv-utils-template"]') {
        return templateLink;
      }
      if (selector === "#div__alert") {
        return {
          append(element) {
            statusElements.push(element);
          }
        };
      }
      return null;
    },
    querySelectorAll(selector) {
      return selector === '[data-suitemate-v3-action="csv-export-status"]'
        ? statusElements.filter((element) => element.isConnected !== false)
        : [];
    },
    createElement(tagName) {
      return {
        tagName,
        className: "",
        dataset: {},
        attributes: {},
        children: [],
        isConnected: true,
        setAttribute(name, value) {
          this.attributes[name] = String(value);
        },
        append(...children) {
          this.children.push(...children);
        },
        remove() {
          this.isConnected = false;
        }
      };
    }
  };
  const sentMessages = [];
  const sandbox = {
    URL,
    URLSearchParams,
    AbortController,
    location,
    document,
    console,
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    addEventListener() {},
    chrome: {
      runtime: {
        async sendMessage(message) {
          sentMessages.push(message);
          return {
            type: "SUITEMATE_V3_NETSUITE_BRIDGE_RESPONSE",
            version: 2,
            ok: true,
            requestId: message.requestId,
            command: message.command,
            data: {
              filename: message.payload.mode === "template"
                ? "SO1-template.csv"
                : "SO1.csv",
              recordType: "salesorder",
              sublistId: "item",
              mode: message.payload.mode,
              rowCount: message.payload.mode === "template" ? 0 : 3,
              columnCount: 12
            }
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
    SuiteMateV3Settings: {
      STORAGE_KEY: "suiteMateV3Style",
      async get() {
        return { enabled: true };
      },
      normalize(value) {
        return value;
      }
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  runInNewContext(sources["src/shared/utilities.js"], sandbox);
  runInNewContext(sources["src/shared/routes.js"], sandbox);
  runInNewContext(sources["src/shared/commands.js"], sandbox);
  runInNewContext(sources["src/shared/bridge.js"], sandbox);
  runInNewContext(sources["src/csv-export/core.js"], sandbox);
  runInNewContext(sources["src/csv-export/runtime.js"], sandbox);
  await flushTasks();

  const exportRuntime = runInNewContext(
    'globalThis[Symbol.for("SuiteMateV3.csvExport.runtime.v3")]',
    sandbox
  );
  assert.equal(exportRuntime?.VERSION, 3);
  assert.equal(exportRuntime.isAvailable(), true);
  const commandResult = await exportRuntime.invoke();
  assert.equal(commandResult.ok, true);
  assert.equal(commandResult.value.ok, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].command, "record.exportCsv");
  assert.deepEqual(plain(sentMessages[0].payload), { mode: "export" });
  assert.equal(exportLink.textContent, "Export");
  assert.equal(exportLink.attributes["aria-busy"], "false");
  assert.equal(statusElements.length, 1);
  assert.equal(statusElements[0].attributes.role, "status");
  assert.equal(
    statusElements[0].children[0].children[0].textContent,
    "Exported 3 item rows to SO1.csv."
  );
  const templateResult = await exportRuntime.invoke("template");
  assert.equal(templateResult.ok, true);
  assert.equal(sentMessages.length, 2);
  assert.deepEqual(plain(sentMessages[1].payload), { mode: "template" });
  assert.equal(templateLink.textContent, "Template");
  assert.equal(templateLink.attributes["aria-busy"], "false");
  assert.equal(
    statusElements.at(-1).children[0].children[0].textContent,
    "Downloaded 12-column template to SO1-template.csv."
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
            version: 2,
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
  runInNewContext(sources["src/shared/utilities.js"], sandbox);
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
