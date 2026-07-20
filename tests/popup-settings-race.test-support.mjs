import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [
  routeSource,
  commandSource,
  settingsSource,
  suiteqlCoreSource,
  popupSource
] = await Promise.all([
  readFile(resolve(root, "src/shared/routes.js"), "utf8"),
  readFile(resolve(root, "src/shared/commands.js"), "utf8"),
  readFile(resolve(root, "src/shared/settings.js"), "utf8"),
  readFile(resolve(root, "src/suiteql/core.js"), "utf8"),
  readFile(resolve(root, "src/popup/popup.js"), "utf8")
]);

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function flushTasks(count = 4) {
  for (let index = 0; index < count; index++) {
    await new Promise((resolveTask) => setImmediate(resolveTask));
  }
}

class FakeClassList {
  constructor(values = []) {
    this.values = new Set(values);
  }

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

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    const enabled = force ?? !this.values.has(value);
    if (enabled) {
      this.values.add(value);
    } else {
      this.values.delete(value);
    }
    return enabled;
  }
}

class FakeElement {
  constructor(tagName = "div", id = "", classes = []) {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.classList = new FakeClassList(classes);
    this.dataset = {};
    this.style = { setProperty() {} };
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
    this.parentNode = null;
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this.value = "";
    this.textContent = "";
    this.inert = false;
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

  dispatch(type, target = this) {
    const event = {
      type,
      target,
      key: "",
      preventDefault() {},
      stopPropagation() {}
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }

  click() {
    this.dispatch("click");
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

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  toggleAttribute(name, force) {
    if (force) {
      this.attributes.set(name, "");
    } else {
      this.attributes.delete(name);
    }
  }

  querySelectorAll() {
    return [];
  }

  closest() {
    return null;
  }

  matches() {
    return false;
  }

  focus() {}

  setPointerCapture() {}

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 100 };
  }
}

function createPopupDocument() {
  const elements = new Map();
  const add = (id, tagName = "div", classes = []) => {
    const element = new FakeElement(tagName, id, classes);
    elements.set(id, element);
    return element;
  };

  const main = add("main-root", "main");
  const form = add("settings", "form");
  const modal = add("colorPickerModal", "section");
  modal.hidden = true;
  main.append(form, modal);

  const enabled = add("enabled", "input");
  const squareCorners = add("squareCorners", "input");
  const light = add("mode-light", "input");
  light.value = "light";
  light.checked = true;
  const dark = add("mode-dark", "input");
  dark.value = "dark";
  const system = add("mode-system", "input");
  system.value = "system";
  const modes = [light, dark, system];
  const formControls = [
    enabled,
    squareCorners,
    ...modes,
    add("mainColor", "input", ["role-color"]),
    add("secondaryColor", "input", ["role-color"]),
    add("mainColorTrigger", "button"),
    add("secondaryColorTrigger", "button"),
    add("swapColors", "button"),
    add("resetColors", "button"),
    add("reset", "button")
  ];
  form.elements = {
    mode: {
      get value() {
        return modes.find(({ checked }) => checked)?.value ?? "";
      }
    }
  };
  form.querySelectorAll = (selector) => {
    if (selector === "input, button") {
      return formControls;
    }
    if (selector === "fieldset input, #squareCorners") {
      return [...modes, squareCorners];
    }
    return [];
  };

  for (const [id, tagName] of [
    ["roleTheme", "section"],
    ["roleContext", "p"],
    ["themeState", "span"],
    ["mainColorValue", "code"],
    ["secondaryColorValue", "code"],
    ["openSuiteQL", "button"],
    ["suiteqlToolContext", "small"],
    ["status", "output"],
    ["colorPickerTitle", "h2"],
    ["closeColorPicker", "button"],
    ["doneColorPicker", "button"],
    ["colorPlane", "div"],
    ["colorHue", "input"],
    ["colorSaturation", "input"],
    ["colorBrightness", "input"],
    ["colorHex", "input"],
    ["pickerMaterialShades", "div"]
  ]) {
    add(id, tagName);
  }

  const body = new FakeElement("body");
  body.append(main);
  const documentElement = new FakeElement("html");
  const documentListeners = new Map();
  const document = {
    body,
    documentElement,
    querySelector(selector) {
      if (selector === "main") {
        return main;
      }
      if (selector.startsWith("#")) {
        return elements.get(selector.slice(1)) ?? null;
      }
      const mode = selector.match(/^input\[name="mode"\]\[value="([^"]+)"\]$/)?.[1];
      if (mode) {
        return modes.find(({ value }) => value === mode) ?? null;
      }
      return null;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) ?? [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      const listeners = documentListeners.get(type) ?? [];
      documentListeners.set(type, listeners.filter((candidate) => candidate !== listener));
    }
  };

  return {
    document,
    element: (id) => elements.get(id),
    modes,
    form
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function createPopupHarness() {
  const dom = createPopupDocument();
  const initialSettings = {
    schemaVersion: 1,
    enabled: true,
    mode: "light",
    squareCorners: false,
    roleThemes: {
      "role-1": {
        name: "Fixture Role",
        main: "#112233",
        secondary: "#445566"
      }
    }
  };
  let storedSettings = clone(initialSettings);
  const pendingSets = [];
  const writes = [];
  const windowListeners = new Map();

  const chrome = {
    storage: {
      sync: {
        async get(key) {
          return { [key]: clone(storedSettings) };
        },
        set(value) {
          const [key, snapshot] = Object.entries(value)[0];
          const completion = deferred();
          const write = { key, snapshot: clone(snapshot), completion };
          writes.push(write);
          pendingSets.push(write);
          return completion.promise.then(() => {
            storedSettings = clone(snapshot);
          });
        }
      }
    },
    tabs: {
      async query() {
        return [{
          id: 1,
          url: "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=1"
        }];
      },
      async sendMessage(_tabId, message) {
        if (message?.type === "SUITEMATE_V3_GET_ROLE_CONTEXT") {
          return {
            roleContext: {
              id: "role-1",
              name: "Fixture Role",
              companyId: "123456",
              roleId: "3"
            }
          };
        }
        return { applied: true };
      },
      async update() {}
    }
  };

  const sandbox = {
    URL,
    URLSearchParams,
    console,
    navigator: { platform: "MacIntel" },
    chrome,
    document: dom.document,
    location: new URL("chrome-extension://fixture/src/popup/popup.html"),
    requestAnimationFrame: (callback) => {
      callback();
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout: () => 1,
    clearTimeout() {}
  };
  sandbox.window = sandbox;
  sandbox.window.top = sandbox;
  sandbox.window.close = () => {};
  sandbox.window.addEventListener = (type, listener) => {
    const listeners = windowListeners.get(type) ?? [];
    listeners.push(listener);
    windowListeners.set(type, listeners);
  };
  sandbox.globalThis = sandbox;

  runInNewContext(routeSource, sandbox);
  runInNewContext(commandSource, sandbox);
  runInNewContext(settingsSource, sandbox);
  runInNewContext(suiteqlCoreSource, sandbox);
  sandbox.SuiteMateV3MaterialPalette = {
    generateMaterialShades: () => null
  };
  runInNewContext(popupSource, sandbox);
  await flushTasks();

  return {
    ...dom,
    writes,
    get storedSettings() {
      return clone(storedSettings);
    },
    async resolveNextWrite() {
      const write = pendingSets.shift();
      assert.ok(write, "Expected a pending settings write");
      write.completion.resolve();
      await flushTasks();
      return write;
    }
  };
}

test("popup composes rapid color swap and appearance edits without stale rendering", async () => {
  const harness = await createPopupHarness();
  const swap = harness.element("swapColors");
  const squareCorners = harness.element("squareCorners");
  const light = harness.modes.find(({ value }) => value === "light");
  const dark = harness.modes.find(({ value }) => value === "dark");

  assert.equal(swap.disabled, false);
  swap.click();
  await flushTasks();
  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.writes[0].snapshot.roleThemes["role-1"], {
    name: "Fixture Role",
    main: "#445566",
    secondary: "#112233"
  });

  light.checked = false;
  dark.checked = true;
  squareCorners.checked = true;
  harness.form.dispatch("change", dark);
  await flushTasks();
  assert.equal(harness.writes.length, 1, "The second write must wait for the queued first write");

  await harness.resolveNextWrite();
  assert.equal(harness.writes.length, 2);
  assert.equal(dark.checked, true, "The stale swap completion must not render the old light mode");
  assert.equal(squareCorners.checked, true, "The stale swap completion must not clear the pending draft");

  assert.equal(harness.writes[1].snapshot.mode, "dark");
  assert.equal(harness.writes[1].snapshot.squareCorners, true);
  assert.deepEqual(harness.writes[1].snapshot.roleThemes["role-1"], {
    name: "Fixture Role",
    main: "#445566",
    secondary: "#112233"
  });

  await harness.resolveNextWrite();
  assert.equal(harness.storedSettings.mode, "dark");
  assert.equal(harness.storedSettings.squareCorners, true);
  assert.deepEqual(harness.storedSettings.roleThemes["role-1"], {
    name: "Fixture Role",
    main: "#445566",
    secondary: "#112233"
  });
  assert.equal(harness.element("mainColor").value, "#445566");
  assert.equal(harness.element("secondaryColor").value, "#112233");
  assert.equal(dark.checked, true);
  assert.equal(squareCorners.checked, true);
});
