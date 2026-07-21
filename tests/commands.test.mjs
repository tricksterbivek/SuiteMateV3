import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import "./popup-settings-race.test-support.mjs";
import "./suiteql-studio-commands.test-support.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const utilitySource = await readFile(resolve(root, "src/shared/utilities.js"), "utf8");
const routeSource = await readFile(resolve(root, "src/shared/routes.js"), "utf8");
const commandSource = await readFile(resolve(root, "src/shared/commands.js"), "utf8");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createApi(platform = "MacIntel") {
  const sandbox = {
    URL,
    URLSearchParams,
    navigator: { platform },
    console
  };
  sandbox.globalThis = sandbox;
  runInNewContext(utilitySource, sandbox);
  runInNewContext(routeSource, sandbox);
  runInNewContext(commandSource, sandbox);
  return {
    commands: sandbox.SuiteMateV3Commands,
    routes: sandbox.SuiteMateV3Routes
  };
}

function page(routes, path, options = {}) {
  return routes.createPageContext(
    `https://${options.host ?? "123456.app.netsuite.com"}${path}`,
    { isTopFrame: options.isTopFrame !== false }
  );
}

function keyboardEvent(key, options = {}) {
  const target = options.target ?? {
    tagName: "DIV",
    closest: () => null,
    getAttribute: () => null,
    matches: () => false
  };
  return {
    key,
    target,
    ctrlKey: options.ctrlKey === true,
    metaKey: options.metaKey === true,
    altKey: options.altKey === true,
    shiftKey: options.shiftKey === true,
    repeat: options.repeat === true,
    isComposing: options.isComposing === true,
    defaultPrevented: options.defaultPrevented === true,
    getModifierState: (name) => name === "AltGraph" && options.altGraph === true,
    composedPath: () => options.path ?? [target],
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    }
  };
}

test("exports one deeply frozen versioned command registry", () => {
  const { commands } = createApi();
  assert.equal(commands.VERSION, 1);
  assert.equal(Object.isFrozen(commands), true);
  assert.equal(Object.isFrozen(commands.IDS), true);
  assert.equal(Object.isFrozen(commands.DEFINITIONS), true);

  const ids = Object.values(commands.IDS);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(Object.keys(commands.DEFINITIONS).length, ids.length);

  for (const id of ids) {
    const definition = commands.get(id);
    assert.equal(definition.id, id);
    assert.equal(Object.isFrozen(definition), true);
    assert.equal(Object.isFrozen(definition.shortcut), true);
    if (definition.link) {
      assert.equal(Object.isFrozen(definition.link), true);
    }
  }

  const execute = commands.get(commands.IDS.SUITEQL_EXECUTE);
  assert.throws(() => {
    execute.label = "Changed";
  }, TypeError);
  assert.equal(commands.get(commands.IDS.SUITEQL_EXECUTE).label, "Execute");
  assert.equal(commands.get("unknown.command"), null);
});

test("normalizes shortcuts and rejects ambiguous combinations", () => {
  const { commands } = createApi();
  assert.deepEqual(plain(commands.normalizeShortcut("Ctrl+Shift+e")), {
    modifiers: ["Control", "Shift"],
    key: "E",
    canonical: "Control+Shift+E"
  });
  assert.deepEqual(
    plain(commands.normalizeShortcut("shift-control-e")),
    plain(commands.normalizeShortcut("Control+Shift+E"))
  );
  assert.equal(commands.normalizeShortcut("cmd+p").canonical, "Meta+P");
  assert.equal(commands.normalizeShortcut("Esc").canonical, "Escape");

  for (const value of ["", "Control", "Control+Shift", "Control+E+P", "Control Control E", "Control++E"]) {
    assert.throws(
      () => commands.normalizeShortcut(value),
      (error) => error.code === "INVALID_COMMAND_SHORTCUT",
      value
    );
  }
});

test("maps Mod consistently for macOS, Windows, Linux, display, ARIA, and CodeMirror", () => {
  const { commands } = createApi();
  const shortcut = commands.get(commands.IDS.SUITEQL_EXPORT_LOADED).shortcut;

  assert.equal(commands.detectPlatform({ platform: "MacIntel" }), commands.PLATFORMS.MAC);
  assert.equal(commands.detectPlatform({ platform: "Win32" }), commands.PLATFORMS.WINDOWS);
  assert.equal(commands.detectPlatform({ platform: "Linux x86_64" }), commands.PLATFORMS.LINUX);
  assert.equal(commands.detectPlatform({ platform: "SunOS" }), commands.PLATFORMS.UNKNOWN);

  assert.equal(commands.shortcutSignature(shortcut, commands.PLATFORMS.MAC), "Meta+Shift+E");
  assert.equal(commands.shortcutSignature(shortcut, commands.PLATFORMS.WINDOWS), "Control+Shift+E");
  assert.equal(commands.shortcutSignature(shortcut, commands.PLATFORMS.LINUX), "Control+Shift+E");
  assert.equal(commands.toEditorShortcut(shortcut), "Mod-Shift-e");
  assert.equal(commands.toAriaShortcut(shortcut, commands.PLATFORMS.MAC), "Meta+Shift+E");
  assert.equal(commands.toAriaShortcut(shortcut, commands.PLATFORMS.WINDOWS), "Control+Shift+E");
  assert.equal(
    commands.toAriaShortcut(shortcut, commands.PLATFORMS.UNKNOWN),
    "Control+Shift+E Meta+Shift+E"
  );
  assert.equal(commands.formatShortcut(shortcut, commands.PLATFORMS.MAC), "Command + Shift + E");
  assert.equal(commands.formatShortcut(shortcut, commands.PLATFORMS.WINDOWS), "Ctrl + Shift + E");
  assert.equal(commands.formatShortcut(shortcut), "Ctrl or Command + Shift + E");
});

test("keeps shortcut signatures collision-free within every surface and platform", () => {
  const { commands } = createApi();
  for (const platform of [
    commands.PLATFORMS.MAC,
    commands.PLATFORMS.WINDOWS,
    commands.PLATFORMS.LINUX
  ]) {
    const seen = new Set();
    for (const definition of Object.values(commands.DEFINITIONS)) {
      if (!definition.shortcut) {
        continue;
      }
      const signature = `${definition.surface}:${commands.shortcutSignature(definition.shortcut, platform)}`;
      assert.equal(seen.has(signature), false, signature);
      seen.add(signature);
    }
  }
});

test("matches exact platform modifiers and rejects repeats, composition, AltGraph, and editable targets by default", () => {
  const { commands } = createApi();
  const execute = commands.IDS.SUITEQL_EXECUTE;

  assert.equal(
    commands.matchesShortcut(keyboardEvent("e", { metaKey: true }), execute, {
      platform: commands.PLATFORMS.MAC
    }),
    true
  );
  assert.equal(
    commands.matchesShortcut(keyboardEvent("e", { ctrlKey: true }), execute, {
      platform: commands.PLATFORMS.MAC
    }),
    false
  );
  assert.equal(
    commands.matchesShortcut(keyboardEvent("e", { ctrlKey: true }), execute, {
      platform: commands.PLATFORMS.WINDOWS
    }),
    true
  );
  assert.equal(
    commands.matchesShortcut(keyboardEvent("e", { ctrlKey: true, altKey: true }), execute, {
      platform: commands.PLATFORMS.WINDOWS
    }),
    false
  );

  for (const options of [
    { ctrlKey: true, repeat: true },
    { ctrlKey: true, isComposing: true },
    { ctrlKey: true, altGraph: true },
    { ctrlKey: true, defaultPrevented: true }
  ]) {
    assert.equal(
      commands.matchesShortcut(keyboardEvent("e", options), execute, {
        platform: commands.PLATFORMS.WINDOWS
      }),
      false
    );
  }

  const input = {
    tagName: "INPUT",
    closest: () => null,
    getAttribute: () => null,
    matches: () => false
  };
  assert.equal(
    commands.matchesShortcutValue(
      keyboardEvent("e", { ctrlKey: true, target: input }),
      "Mod+E",
      { platform: commands.PLATFORMS.WINDOWS }
    ),
    false
  );
  assert.equal(
    commands.matchesShortcutValue(
      keyboardEvent("e", { ctrlKey: true, target: input }),
      "Mod+E",
      { platform: commands.PLATFORMS.WINDOWS, allowInEditable: true }
    ),
    true
  );
  const nested = {
    tagName: "SPAN",
    closest: () => null,
    getAttribute: () => null,
    matches: () => false
  };
  const editableParent = {
    tagName: "DIV",
    isContentEditable: true,
    closest: () => null,
    getAttribute: () => "true",
    matches: () => false
  };
  assert.equal(
    commands.matchesShortcutValue(
      keyboardEvent("e", {
        ctrlKey: true,
        target: nested,
        path: [nested, editableParent]
      }),
      "Mod+E",
      { platform: commands.PLATFORMS.WINDOWS }
    ),
    false
  );
});

test("enforces route capability and settings availability from one descriptor", () => {
  const { commands, routes } = createApi();
  const suiteql = page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?suiteql`);
  const globalSearch = page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?search=customer`);
  const record = page(routes, "/app/accounting/transactions/salesord.nl?id=1");
  const childRecord = page(routes, "/app/accounting/transactions/salesord.nl?id=1", {
    isTopFrame: false
  });

  assert.equal(
    commands.isSupported(commands.IDS.SUITEQL_EXECUTE, { pageContext: suiteql }),
    true
  );
  assert.equal(
    commands.isSupported(commands.IDS.SUITEQL_EXECUTE, { pageContext: globalSearch }),
    false
  );
  assert.equal(
    commands.isSupported(commands.IDS.RECORD_CSV_IMPORT, {
      pageContext: record,
      settings: { enabled: true }
    }),
    true
  );
  assert.equal(
    commands.isSupported(commands.IDS.RECORD_CSV_IMPORT, {
      pageContext: record,
      settings: { enabled: false }
    }),
    false
  );
  assert.equal(
    commands.isSupported(commands.IDS.RECORD_CSV_IMPORT, {
      pageContext: record
    }),
    false,
    "Settings-gated commands must fail closed when settings are missing"
  );
  assert.equal(
    commands.isSupported(commands.IDS.RECORD_CSV_IMPORT, {
      pageContext: record,
      settings: { enabled: "true" }
    }),
    false,
    "Settings-gated commands require the normalized boolean value"
  );
  assert.equal(
    commands.isSupported(commands.IDS.RECORD_CSV_IMPORT, {
      pageContext: childRecord,
      settings: { enabled: true }
    }),
    false
  );
  assert.equal(
    commands.isSupported(commands.IDS.POPUP_OPEN_SUITEQL, {
      pageContext: record,
      settings: { enabled: false }
    }),
    true,
    "SuiteQL launch must remain independent of styling enabled state"
  );
});

test("applies labels, descriptions, shortcuts, and native link metadata from the registry", () => {
  const { commands } = createApi();
  const attributes = new Map();
  const element = {
    dataset: {},
    textContent: "",
    title: "",
    target: "",
    rel: "",
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    }
  };

  assert.equal(
    commands.applyMetadata(element, commands.IDS.SUITEQL_EXECUTE, { setLabel: true }),
    true
  );
  assert.equal(element.dataset.suitemateV3Command, "suiteql.execute");
  assert.equal(element.textContent, "Execute");
  assert.equal(element.title, "Execute query (Ctrl or Command + E)");
  assert.equal(attributes.get("aria-keyshortcuts"), "Control+E Meta+E");

  commands.applyMetadata(element, commands.IDS.SUITEQL_OPEN_SUITESENSE, { setLabel: true });
  assert.equal(element.textContent, "Generate with SuiteSense");
  assert.equal(element.target, "_blank");
  assert.equal(element.rel, "noopener noreferrer");
  assert.equal(attributes.has("aria-keyshortcuts"), false);
});

test("scope rejects unknown, cross-surface, duplicate, unavailable, and busy invocations", async () => {
  const { commands, routes } = createApi();
  let currentPage = page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?suiteql`);
  const scope = commands.createScope(commands.SURFACES.SUITEQL, {
    getContext: () => ({ pageContext: currentPage })
  });
  let calls = 0;
  let release;
  const pending = new Promise((resolvePending) => {
    release = resolvePending;
  });

  assert.throws(
    () => scope.register("unknown.command", { run() {} }),
    (error) => error.code === "UNKNOWN_COMMAND"
  );
  assert.throws(
    () => scope.register(commands.IDS.POPUP_OPEN_SUITEQL, { run() {} }),
    (error) => error.code === "COMMAND_SURFACE_MISMATCH"
  );

  const unregister = scope.register(commands.IDS.SUITEQL_EXECUTE, {
    run() {
      calls += 1;
      return pending;
    }
  });
  assert.throws(
    () => scope.register(commands.IDS.SUITEQL_EXECUTE, { run() {} }),
    (error) => error.code === "DUPLICATE_COMMAND_HANDLER"
  );

  const first = scope.invoke(commands.IDS.SUITEQL_EXECUTE);
  assert.equal(scope.getState(commands.IDS.SUITEQL_EXECUTE).running, true);
  assert.equal(scope.getState(commands.IDS.SUITEQL_EXECUTE).available, false);
  const second = scope.invoke(commands.IDS.SUITEQL_EXECUTE);
  assert.equal(second.ok, false);
  assert.equal(second.error.code, "COMMAND_BUSY");
  assert.equal(calls, 1);

  release("done");
  assert.deepEqual(plain(await first), {
    ok: true,
    commandId: commands.IDS.SUITEQL_EXECUTE,
    value: "done"
  });
  assert.equal(scope.getState(commands.IDS.SUITEQL_EXECUTE).running, false);

  currentPage = page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?search=customer`);
  const unavailable = scope.invoke(commands.IDS.SUITEQL_EXECUTE);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, "COMMAND_UNAVAILABLE");

  assert.equal(unregister(), true);
  assert.equal(unregister(), false);
  assert.equal(scope.getState(commands.IDS.SUITEQL_EXECUTE).registered, false);
  assert.equal(scope.dispose(), true);
  assert.equal(scope.dispose(), false);
  assert.throws(
    () => scope.register(commands.IDS.SUITEQL_ABORT, { run() {} }),
    (error) => error.code === "COMMAND_SCOPE_DISPOSED"
  );
});

test("scope normalizes sync and async failures without leaking running state", async () => {
  const { commands, routes } = createApi();
  const failures = [];
  const scope = commands.createScope(commands.SURFACES.SUITEQL, {
    getContext: () => ({
      pageContext: page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?suiteql`)
    }),
    onError: (failure) => failures.push(failure)
  });

  scope.register(commands.IDS.SUITEQL_ABORT, {
    run() {
      throw new Error("sync failed");
    }
  });
  scope.register(commands.IDS.SUITEQL_EXECUTE, {
    run() {
      return Promise.reject(new Error("async failed"));
    }
  });

  const sync = scope.invoke(commands.IDS.SUITEQL_ABORT);
  assert.equal(sync.ok, false);
  assert.equal(sync.error.code, "COMMAND_FAILED");
  assert.equal(sync.error.message, "sync failed");
  assert.equal(scope.getState(commands.IDS.SUITEQL_ABORT).running, false);

  const asyncResult = await scope.invoke(commands.IDS.SUITEQL_EXECUTE);
  assert.equal(asyncResult.ok, false);
  assert.equal(asyncResult.error.code, "COMMAND_FAILED");
  assert.equal(asyncResult.error.message, "async failed");
  assert.equal(scope.getState(commands.IDS.SUITEQL_EXECUTE).running, false);
  assert.equal(failures.length, 2);
});

test("scope authorizes and executes against one context snapshot", () => {
  const { commands, routes } = createApi();
  const allowed = page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?suiteql`);
  const denied = page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?search=customer`);
  let contextReads = 0;
  let receivedContext = null;
  const scope = commands.createScope(commands.SURFACES.SUITEQL, {
    getContext() {
      contextReads += 1;
      return { pageContext: contextReads === 1 ? allowed : denied };
    }
  });
  scope.register(commands.IDS.SUITEQL_EXECUTE, {
    run({ context }) {
      receivedContext = context;
    }
  });

  const result = scope.invoke(commands.IDS.SUITEQL_EXECUTE);
  assert.equal(result.ok, true);
  assert.equal(contextReads, 1);
  assert.equal(receivedContext.pageContext, allowed);
});

test("scope never executes a handler replaced during authorization", () => {
  const { commands, routes } = createApi();
  let unregisterOld;
  let oldCalls = 0;
  let newCalls = 0;
  const scope = commands.createScope(commands.SURFACES.SUITEQL, {
    getContext() {
      unregisterOld();
      scope.register(commands.IDS.SUITEQL_EXECUTE, {
        run() {
          newCalls += 1;
        }
      });
      return {
        pageContext: page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?suiteql`)
      };
    }
  });
  unregisterOld = scope.register(commands.IDS.SUITEQL_EXECUTE, {
    run() {
      oldCalls += 1;
    }
  });

  const result = scope.invoke(commands.IDS.SUITEQL_EXECUTE);
  assert.equal(result.ok, true);
  assert.equal(oldCalls, 0);
  assert.equal(newCalls, 1);
});

test("scope never executes a handler invalidated by a running-state subscriber", () => {
  const { commands, routes } = createApi();
  let calls = 0;
  const scope = commands.createScope(commands.SURFACES.SUITEQL, {
    getContext: () => ({
      pageContext: page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?suiteql`)
    })
  });
  scope.register(commands.IDS.SUITEQL_EXECUTE, {
    run() {
      calls += 1;
    }
  });
  scope.subscribe((state) => {
    if (state.running) {
      scope.dispose();
    }
  });

  const result = scope.invoke(commands.IDS.SUITEQL_EXECUTE);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "COMMAND_STALE");
  assert.equal(calls, 0);
});

test("scope fails closed when availability returns a promise", () => {
  const { commands, routes } = createApi();
  const failures = [];
  let calls = 0;
  const scope = commands.createScope(commands.SURFACES.SUITEQL, {
    getContext: () => ({
      pageContext: page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?suiteql`)
    }),
    onError: (failure) => failures.push(failure)
  });
  scope.register(commands.IDS.SUITEQL_EXECUTE, {
    isAvailable: async () => false,
    run() {
      calls += 1;
    }
  });

  const result = scope.invoke(commands.IDS.SUITEQL_EXECUTE);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "COMMAND_UNAVAILABLE");
  assert.equal(calls, 0);
  assert.equal(failures[0].error.code, "ASYNC_COMMAND_AVAILABILITY");
});

test("scope consumes and reports a rejecting async availability predicate", async () => {
  const { commands, routes } = createApi();
  const failures = [];
  let calls = 0;
  const scope = commands.createScope(commands.SURFACES.SUITEQL, {
    getContext: () => ({
      pageContext: page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?suiteql`)
    }),
    onError: (failure) => failures.push(failure)
  });
  scope.register(commands.IDS.SUITEQL_EXECUTE, {
    isAvailable: async () => {
      throw new Error("availability rejected");
    },
    run() {
      calls += 1;
    }
  });

  const result = scope.invoke(commands.IDS.SUITEQL_EXECUTE);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "COMMAND_UNAVAILABLE");
  assert.equal(calls, 0);
  await new Promise((resolveTask) => setImmediate(resolveTask));
  assert.equal(failures[0].error.code, "ASYNC_COMMAND_AVAILABILITY");
  assert.equal(failures[1].error.message, "availability rejected");
});

test("scope freezes only success envelopes and accepts hostile handler-owned values", async () => {
  const { commands, routes } = createApi();
  const pageContext = page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?suiteql`);
  const hostile = new Proxy({}, {
    ownKeys() {
      throw new Error("handler value must not be inspected");
    }
  });
  const mutable = { nested: { value: 1 } };
  const syncScope = commands.createScope(commands.SURFACES.SUITEQL, {
    getContext: () => ({ pageContext })
  });
  syncScope.register(commands.IDS.SUITEQL_EXECUTE, {
    run: () => hostile
  });

  const sync = syncScope.invoke(commands.IDS.SUITEQL_EXECUTE);
  assert.equal(sync.ok, true);
  assert.equal(sync.value, hostile);
  assert.equal(Object.isFrozen(sync), true);

  const asyncScope = commands.createScope(commands.SURFACES.SUITEQL, {
    getContext: () => ({ pageContext })
  });
  asyncScope.register(commands.IDS.SUITEQL_EXECUTE, {
    run: async () => mutable
  });
  const asyncResult = await asyncScope.invoke(commands.IDS.SUITEQL_EXECUTE);
  assert.equal(asyncResult.ok, true);
  assert.equal(asyncResult.value, mutable);
  assert.equal(Object.isFrozen(asyncResult), true);
  assert.equal(Object.isFrozen(mutable), false);
  assert.equal(Object.isFrozen(mutable.nested), false);
});

test("scope normalizes a thenable with a throwing then getter", () => {
  const { commands, routes } = createApi();
  const failures = [];
  const scope = commands.createScope(commands.SURFACES.SUITEQL, {
    getContext: () => ({
      pageContext: page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?suiteql`)
    }),
    onError: (failure) => failures.push(failure)
  });
  scope.register(commands.IDS.SUITEQL_EXECUTE, {
    run() {
      return Object.defineProperty({}, "then", {
        get() {
          throw new Error("broken thenable");
        }
      });
    }
  });

  const result = scope.invoke(commands.IDS.SUITEQL_EXECUTE);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "COMMAND_FAILED");
  assert.equal(result.error.message, "broken thenable");
  assert.equal(scope.getState(commands.IDS.SUITEQL_EXECUTE).running, false);
  assert.equal(failures.length, 1);
});

test("scope tracks allowed re-entry and rejects stale async completion after disposal", async () => {
  const { commands } = createApi();
  const releases = [];
  const scope = commands.createScope(commands.SURFACES.POPUP, {
    getContext: () => ({ settings: { enabled: true } })
  });
  scope.register(commands.IDS.SETTINGS_APPLY_APPEARANCE, {
    allowReentry: true,
    run() {
      return new Promise((resolvePending) => releases.push(resolvePending));
    }
  });

  const first = scope.invoke(commands.IDS.SETTINGS_APPLY_APPEARANCE);
  const second = scope.invoke(commands.IDS.SETTINGS_APPLY_APPEARANCE);
  assert.equal(scope.getState(commands.IDS.SETTINGS_APPLY_APPEARANCE).running, true);
  releases[0]("first");
  assert.equal((await first).ok, true);
  assert.equal(
    scope.getState(commands.IDS.SETTINGS_APPLY_APPEARANCE).running,
    true,
    "The second re-entrant invocation is still active"
  );
  releases[1]("second");
  assert.equal((await second).ok, true);
  assert.equal(scope.getState(commands.IDS.SETTINGS_APPLY_APPEARANCE).running, false);

  let releaseStale;
  const staleScope = commands.createScope(commands.SURFACES.POPUP, {
    getContext: () => ({ settings: { enabled: true } })
  });
  staleScope.register(commands.IDS.SETTINGS_RESET_ALL, {
    run() {
      return new Promise((resolvePending) => {
        releaseStale = resolvePending;
      });
    }
  });
  const stale = staleScope.invoke(commands.IDS.SETTINGS_RESET_ALL);
  staleScope.dispose();
  releaseStale("late");
  const staleResult = await stale;
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.error.code, "COMMAND_STALE");
});

test("allowed re-entry supports abort followed by immediate execution restart", async () => {
  const { commands, routes } = createApi();
  const releases = [];
  let busy = false;
  let executeCalls = 0;
  const scope = commands.createScope(commands.SURFACES.SUITEQL, {
    getContext: () => ({
      pageContext: page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?suiteql`)
    })
  });
  scope.register(commands.IDS.SUITEQL_EXECUTE, {
    allowReentry: true,
    isAvailable: () => !busy,
    run() {
      executeCalls += 1;
      busy = true;
      return new Promise((resolvePending) => releases.push(resolvePending));
    }
  });
  scope.register(commands.IDS.SUITEQL_ABORT, {
    isAvailable: () => busy,
    run() {
      busy = false;
    }
  });

  const first = scope.invoke(commands.IDS.SUITEQL_EXECUTE);
  assert.equal(scope.invoke(commands.IDS.SUITEQL_ABORT).ok, true);
  const second = scope.invoke(commands.IDS.SUITEQL_EXECUTE);
  assert.equal(executeCalls, 2);

  releases[0]("abandoned");
  releases[1]("current");
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
});

test("shortcut binding is idempotent, exact, and disposed with its scope", () => {
  const { commands } = createApi();
  const listeners = new Set();
  const target = {
    addEventListener(type, listener) {
      if (type === "keydown") {
        listeners.add(listener);
      }
    },
    removeEventListener(type, listener) {
      if (type === "keydown") {
        listeners.delete(listener);
      }
    }
  };
  let activePicker = true;
  let calls = 0;
  const scope = commands.createScope(commands.SURFACES.POPUP, {
    getContext: () => ({ settings: { enabled: true } })
  });
  scope.register(commands.IDS.THEME_APPLY_AND_CLOSE_PICKER, {
    isAvailable: () => activePicker,
    run() {
      calls += 1;
    }
  });

  const first = scope.bindShortcuts(
    target,
    [commands.IDS.THEME_APPLY_AND_CLOSE_PICKER],
    { platform: commands.PLATFORMS.MAC }
  );
  const second = scope.bindShortcuts(
    target,
    [commands.IDS.THEME_APPLY_AND_CLOSE_PICKER],
    { platform: commands.PLATFORMS.MAC }
  );
  assert.equal(first, second);
  assert.equal(listeners.size, 1);

  const rebound = scope.bindShortcuts(
    target,
    [commands.IDS.THEME_APPLY_AND_CLOSE_PICKER],
    { platform: commands.PLATFORMS.WINDOWS, stopPropagation: true }
  );
  assert.notEqual(rebound, first);
  assert.equal(listeners.size, 1, "Changed binding options must replace the old listener");

  const escape = keyboardEvent("Escape");
  for (const listener of listeners) {
    listener(escape);
  }
  assert.equal(calls, 1);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.propagationStopped, true);

  activePicker = false;
  const idleEscape = keyboardEvent("Escape");
  for (const listener of listeners) {
    listener(idleEscape);
  }
  assert.equal(calls, 1);
  assert.equal(idleEscape.defaultPrevented, false);

  assert.equal(scope.dispose(), true);
  assert.equal(listeners.size, 0);
  assert.equal(first.dispose(), false);
  assert.throws(
    () => scope.bindShortcuts(target, [commands.IDS.THEME_APPLY_AND_CLOSE_PICKER]),
    (error) => error.code === "COMMAND_SCOPE_DISPOSED"
  );
});

test("CodeMirror bindings derive from registry shortcuts and share command availability", () => {
  const { commands, routes } = createApi();
  let busy = false;
  let hasRows = false;
  let hasExecuted = false;
  let executeCalls = 0;
  let abortCalls = 0;
  let pagedCalls = 0;
  let exportCalls = 0;
  let clearCalls = 0;
  const scope = commands.createScope(commands.SURFACES.SUITEQL, {
    getContext: () => ({
      pageContext: page(routes, `${routes.PATHS.SUITEQL_CONSOLE}?suiteql`)
    })
  });
  scope.register(commands.IDS.SUITEQL_EXECUTE, {
    isAvailable: () => !busy,
    run() {
      executeCalls += 1;
    }
  });
  scope.register(commands.IDS.SUITEQL_ABORT, {
    isAvailable: () => busy,
    run() {
      abortCalls += 1;
    }
  });
  scope.register(commands.IDS.SUITEQL_TOGGLE_PAGED, {
    isAvailable: () => !busy,
    run() {
      pagedCalls += 1;
    }
  });
  scope.register(commands.IDS.SUITEQL_EXPORT_LOADED, {
    isAvailable: () => !busy && hasRows,
    run() {
      exportCalls += 1;
    }
  });
  scope.register(commands.IDS.SUITEQL_CLEAR_RESULTS, {
    isAvailable: () => !busy && hasExecuted,
    run() {
      clearCalls += 1;
    }
  });

  const bindings = commands.createEditorKeyBindings([
    commands.IDS.SUITEQL_EXECUTE,
    commands.IDS.SUITEQL_ABORT,
    commands.IDS.SUITEQL_TOGGLE_PAGED,
    commands.IDS.SUITEQL_EXPORT_LOADED,
    commands.IDS.SUITEQL_CLEAR_RESULTS
  ], scope);
  assert.deepEqual(
    bindings.map(({ key }) => key),
    ["Mod-e", "Escape", "Mod-Shift-p", "Mod-Shift-e", "Mod-Shift-l"]
  );
  assert.equal(bindings[0].run(), true);
  assert.equal(executeCalls, 1);
  assert.equal(bindings[1].run(), false, "Idle Escape must remain available to the editor");
  assert.equal(bindings[2].run(), true);
  assert.equal(pagedCalls, 1);
  assert.equal(bindings[3].run(), true, "Unavailable Export must consume its reserved shortcut");
  assert.equal(exportCalls, 0);
  assert.equal(bindings[4].run(), true, "Unavailable Clear must consume its reserved shortcut");
  assert.equal(clearCalls, 0);

  busy = true;
  assert.equal(bindings[0].run(), true, "Busy Execute must consume its reserved shortcut");
  assert.equal(bindings[1].run(), true);
  assert.equal(bindings[2].run(), true, "Busy Paged toggle must consume its reserved shortcut");
  assert.equal(abortCalls, 1);

  busy = false;
  hasRows = true;
  hasExecuted = true;
  assert.equal(bindings[3].run(), true);
  assert.equal(bindings[4].run(), true);
  assert.equal(exportCalls, 1);
  assert.equal(clearCalls, 1);
});
