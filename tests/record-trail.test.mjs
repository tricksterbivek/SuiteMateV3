import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = Object.fromEntries(
  await Promise.all([
    "src/shared/utilities.js",
    "src/shared/browser-utilities.js",
    "src/shared/routes.js",
    "src/shared/commands.js",
    "src/shared/bridge.js",
    "src/record-actions/record-trail.js"
  ].map(async (file) => [file, await readFile(resolve(root, file), "utf8")]))
);

async function flushTasks() {
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
}

function createLifecycleStub() {
  let registration;
  let controller = new AbortController();
  let active = false;
  let generation = 0;
  let lastRun = Promise.resolve();

  function run(reason = "mutation") {
    if (!active) {
      return Promise.resolve(false);
    }
    const expectedGeneration = generation;
    lastRun = Promise.resolve(registration.evaluate({
      reason,
      records: [],
      signal: controller.signal,
      isCurrent: () => active
        && generation === expectedGeneration
        && !controller.signal.aborted
    }));
    return lastRun;
  }

  return {
    register(config) {
      registration = config;
      active = !config.startPaused;
      generation += 1;
      const handle = {
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
        },
        dispose(reason = "disposed") {
          if (!active) {
            return false;
          }
          active = false;
          generation += 1;
          controller.abort(reason);
          config.cleanup?.({ reason });
          return true;
        }
      };
      if (active) {
        void run("initial");
      }
      return handle;
    },
    run,
    get lastRun() {
      return lastRun;
    }
  };
}

function createDom() {
  let document;

  class Element {
    constructor(tagName) {
      this.tagName = String(tagName).toUpperCase();
      this.nodeType = 1;
      this.id = "";
      this.className = "";
      this.dataset = {};
      this.attributes = {};
      this.children = [];
      this.parent = null;
      this.listeners = new Map();
      this.hidden = false;
      this.disabled = false;
      this.inert = false;
      this._textContent = "";
    }

    set textContent(value) {
      this._textContent = String(value ?? "");
      this.children = [];
    }

    get textContent() {
      return this._textContent + this.children.map((child) => child.textContent).join("");
    }

    get isConnected() {
      return this === document.documentElement || Boolean(this.parent?.isConnected);
    }

    get classList() {
      const element = this;
      const values = () => new Set(element.className.split(/\s+/).filter(Boolean));
      return {
        add(...names) {
          const next = values();
          names.forEach((name) => next.add(name));
          element.className = [...next].join(" ");
        },
        remove(...names) {
          const next = values();
          names.forEach((name) => next.delete(name));
          element.className = [...next].join(" ");
        },
        contains(name) {
          return values().has(name);
        }
      };
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "id") {
        this.id = String(value);
      }
    }

    getAttribute(name) {
      return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
    }

    hasAttribute(name) {
      return Object.hasOwn(this.attributes, name);
    }

    removeAttribute(name) {
      delete this.attributes[name];
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.listeners.set(
        type,
        (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener)
      );
    }

    emit(type, event = {}) {
      const value = {
        target: this,
        preventDefault() {},
        stopPropagation() {},
        ...event
      };
      for (const listener of this.listeners.get(type) ?? []) {
        listener(value);
      }
    }

    append(...children) {
      for (const child of children) {
        child.parent?.removeChild(child);
        child.parent = this;
        this.children.push(child);
      }
    }

    replaceChildren(...children) {
      this.children.forEach((child) => { child.parent = null; });
      this.children = [];
      this._textContent = "";
      this.append(...children);
    }

    removeChild(child) {
      this.children = this.children.filter((candidate) => candidate !== child);
      child.parent = null;
    }

    remove() {
      this.parent?.removeChild(this);
    }

    after(node) {
      if (!this.parent) {
        return;
      }
      node.parent?.removeChild(node);
      const index = this.parent.children.indexOf(this);
      node.parent = this.parent;
      this.parent.children.splice(index + 1, 0, node);
    }

    contains(candidate) {
      return candidate === this || this.children.some((child) => child.contains(candidate));
    }

    focus() {
      document.activeElement = this;
    }

    descendants() {
      return this.children.flatMap((child) => [child, ...child.descendants()]);
    }

    querySelectorAll(selector) {
      if (selector === "a") {
        return this.descendants().filter((element) => element.tagName === "A");
      }
      if (selector.includes("button:not") || selector.includes("[href]")) {
        return this.descendants().filter((element) =>
          !element.hidden
          && !element.disabled
          && (element.tagName === "BUTTON" || (element.tagName === "A" && element.href)));
      }
      return document.select(selector, this);
    }

    querySelector(selector) {
      if (selector.startsWith(":scope > .ns-menu")) {
        return this.descendants().find((element) => element.tagName === "A") ?? null;
      }
      return this.querySelectorAll(selector)[0] ?? null;
    }

    matches(selector) {
      if (selector === "#main_form") {
        return this.id === "main_form";
      }
      if (selector.includes('[data-suitemate-v3-action="record-trail"]')) {
        return this.dataset.suitemateV3Action === "record-trail";
      }
      return false;
    }
  }

  const html = new Element("html");
  const body = new Element("body");
  const mainForm = new Element("form");
  const toolbar = new Element("table");
  const row = new Element("tr");
  const actionsCell = new Element("td");
  const nativeMenu = new Element("ul");
  const nativeItem = new Element("li");
  const nativeLink = new Element("a");
  nativeLink.href = "#";
  nativeLink.textContent = "Actions";
  actionsCell.className = "uir-button-menu";
  toolbar.className = "uir-buttons-top uir-header-buttons";
  mainForm.id = "main_form";
  nativeItem.append(nativeLink);
  nativeMenu.append(nativeItem);
  actionsCell.append(nativeMenu);
  row.append(actionsCell);
  toolbar.append(row);
  mainForm.append(toolbar);
  body.append(mainForm);
  html.append(body);

  function descendants(rootElement) {
    return [rootElement, ...rootElement.descendants()];
  }

  document = {
    documentElement: html,
    body,
    activeElement: null,
    createElement: (tagName) => new Element(tagName),
    select(selector, rootElement = html) {
      const elements = descendants(rootElement);
      if (selector === "#main_form") {
        return elements.filter((element) => element.id === "main_form");
      }
      if (selector.includes("td.uir-button-menu")) {
        return [actionsCell];
      }
      if (selector.includes('[data-suitemate-v3-action="record-trail"]')) {
        return elements.filter((element) => element.dataset.suitemateV3Action === "record-trail");
      }
      if (selector.includes('[data-suitemate-v3-ui="record-trail"]')) {
        return elements.filter((element) => element.dataset.suitemateV3Ui === "record-trail");
      }
      return [];
    },
    querySelector(selector) {
      return this.select(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      return this.select(selector);
    }
  };
  return { document, actionsCell };
}

test("Record Trail installs once, renders safely, cancels stale refreshes and restores focus", async () => {
  const { document } = createDom();
  const lifecycle = createLifecycleStub();
  const storageListeners = [];
  const pagehideListeners = [];
  const sentMessages = [];
  const clipboardWrites = [];
  let trailRequestCount = 0;

  const transaction = {
    id: "42",
    type: "SalesOrd",
    typeName: "Sales Order",
    tranId: "SO42",
    tranDate: "1/8/2026",
    status: "Pending Fulfillment"
  };
  const trail = {
    current: transaction,
    sources: [{ ...transaction, id: "40", typeName: "Estimate", tranId: "EST40" }],
    targets: [{ ...transaction, id: "43", typeName: "Item Fulfillment", tranId: "IF43" }]
  };

  const locationUrl = new URL(
    "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=42"
  );
  const location = {
    href: locationUrl.href,
    origin: locationUrl.origin,
    hostname: locationUrl.hostname,
    pathname: locationUrl.pathname,
    search: locationUrl.search,
    hash: locationUrl.hash
  };
  const sandbox = {
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    Node: { ELEMENT_NODE: 1 },
    location,
    document,
    navigator: {
      platform: "MacIntel",
      clipboard: {
        async writeText(value) {
          clipboardWrites.push(value);
        }
      }
    },
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
    SuiteMateV3Notifications: {
      showToast() {}
    },
    chrome: {
      runtime: {
        async sendMessage(message) {
          sentMessages.push(JSON.parse(JSON.stringify(message)));
          if (message.command === "bridge.cancel") {
            return {
              type: "SUITEMATE_V3_NETSUITE_BRIDGE_RESPONSE",
              version: 2,
              ok: true,
              requestId: message.requestId,
              command: message.command,
              data: { canceled: true }
            };
          }
          trailRequestCount += 1;
          if (trailRequestCount === 2) {
            return new Promise(() => {});
          }
          return {
            type: "SUITEMATE_V3_NETSUITE_BRIDGE_RESPONSE",
            version: 2,
            ok: true,
            requestId: message.requestId,
            command: message.command,
            data: trailRequestCount === 1
              ? trail
              : { current: transaction, sources: [], targets: [] }
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
    addEventListener(type, listener) {
      if (type === "pagehide") {
        pagehideListeners.push(listener);
      }
    },
    console,
    crypto: globalThis.crypto
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  for (const file of [
    "src/shared/utilities.js",
    "src/shared/browser-utilities.js",
    "src/shared/routes.js",
    "src/shared/commands.js",
    "src/shared/bridge.js",
    "src/record-actions/record-trail.js"
  ]) {
    runInNewContext(sources[file], sandbox);
  }
  await flushTasks();
  await lifecycle.lastRun;

  const action = document.querySelector('[data-suitemate-v3-action="record-trail"]');
  assert.ok(action);
  await lifecycle.run();
  assert.equal(document.querySelectorAll('[data-suitemate-v3-action="record-trail"]').length, 1);

  const trigger = action.querySelector("a");
  assert.equal(trigger.dataset.suitemateV3Command, "record.show-trail");
  trigger.emit("click");
  await flushTasks();

  const overlay = document.querySelector('[data-suitemate-v3-ui="record-trail"]');
  assert.ok(overlay);
  assert.equal(overlay.attributes.role, "dialog");
  assert.equal(overlay.attributes["aria-modal"], "true");
  assert.equal(overlay.textContent.includes("Records related to this transaction"), true);
  assert.equal(overlay.textContent.includes("You are here"), true);
  assert.equal(overlay.textContent.includes("EST40"), true);
  assert.equal(overlay.textContent.includes("IF43"), true);
  assert.equal(document.activeElement.attributes["aria-label"], "Close Record Trail");

  const relatedLink = overlay.descendants().find((element) => element.tagName === "A");
  assert.match(relatedLink.href, /transaction\.nl\?id=40$/);
  assert.equal(relatedLink.rel, "noopener noreferrer");
  const copy = overlay.descendants().find((element) => element.tagName === "BUTTON" && element.textContent === "#40");
  copy.emit("click");
  await flushTasks();
  assert.deepEqual(clipboardWrites, ["40"]);

  const refresh = overlay.descendants().find((element) =>
    element.tagName === "BUTTON" && element.attributes["aria-label"] === "Refresh Record Trail");
  refresh.emit("click");
  await flushTasks();
  refresh.emit("click");
  await flushTasks();
  const cancellation = sentMessages.find((message) =>
    message.command === "bridge.cancel"
    && message.payload.targetCommand === "record.getTrail");
  assert.ok(cancellation);
  assert.equal(overlay.textContent.includes("No direct source transactions found."), true);
  assert.equal(
    overlay.textContent.includes("This record doesn't generate any direct target transactions yet."),
    true
  );

  const close = overlay.descendants().find((element) => element.attributes["aria-label"] === "Close Record Trail");
  close.emit("click");
  assert.equal(document.querySelector('[data-suitemate-v3-ui="record-trail"]'), null);
  assert.equal(document.activeElement, trigger);

  storageListeners[0]({
    suiteMateV3Style: { newValue: { enabled: false } }
  }, "sync");
  assert.equal(document.querySelector('[data-suitemate-v3-action="record-trail"]'), null);
  pagehideListeners[0]?.({ persisted: false });
});
