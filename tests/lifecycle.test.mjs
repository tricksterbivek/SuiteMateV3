import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const routeSource = await readFile(resolve(root, "src/shared/routes.js"), "utf8");
const lifecycleSource = await readFile(resolve(root, "src/shared/lifecycle.js"), "utf8");

function createHarness(initialUrl = "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=1") {
  const observers = [];
  const errors = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const documentElement = { dataset: {} };
  const location = {};

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      this.observeCalls = [];
      this.disconnectCalls = 0;
      observers.push(this);
    }

    observe(target, options) {
      this.connected = true;
      this.observeCalls.push({ target, options: structuredClone(options) });
    }

    disconnect() {
      this.connected = false;
      this.disconnectCalls += 1;
    }

    takeRecords() {
      return [];
    }

    emit(records) {
      if (this.connected) {
        this.callback(records);
      }
    }
  }

  function addListener(registry, type, listener) {
    const listeners = registry.get(type) ?? [];
    listeners.push(listener);
    registry.set(type, listeners);
  }

  function setLocation(value) {
    const url = new URL(value);
    Object.assign(location, {
      href: url.href,
      origin: url.origin,
      hostname: url.hostname,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash
    });
  }

  function emitWindow(type, detail = {}) {
    for (const listener of [...(windowListeners.get(type) ?? [])]) {
      listener({ type, ...detail });
    }
  }

  setLocation(initialUrl);
  const sandbox = {
    URL,
    URLSearchParams,
    AbortController,
    MutationObserver: FakeMutationObserver,
    Promise,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    location,
    document: {
      documentElement,
      readyState: "complete",
      addEventListener(type, listener) {
        addListener(documentListeners, type, listener);
      }
    },
    console: {
      error(...args) {
        errors.push(args);
      }
    },
    addEventListener(type, listener) {
      addListener(windowListeners, type, listener);
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.top = sandbox;
  runInNewContext(routeSource, sandbox);
  runInNewContext(lifecycleSource, sandbox);

  return {
    api: sandbox.SuiteMateV3Lifecycle,
    documentElement,
    errors,
    emitWindow,
    location,
    observers,
    sandbox,
    setLocation,
    windowListeners
  };
}

async function flushTasks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function childMutation(name = "node") {
  return {
    type: "childList",
    addedNodes: [{ name }],
    removedNodes: []
  };
}

test("exports one per-document singleton and installs global listeners once", () => {
  const harness = createHarness();
  const firstApi = harness.api;
  const initialListenerCounts = Object.fromEntries(
    [...harness.windowListeners].map(([type, listeners]) => [type, listeners.length])
  );

  runInNewContext(lifecycleSource, harness.sandbox);

  assert.equal(harness.sandbox.SuiteMateV3Lifecycle, firstApi);
  assert.deepEqual(
    Object.fromEntries([...harness.windowListeners].map(([type, listeners]) => [type, listeners.length])),
    initialListenerCounts
  );
  assert.equal(firstApi.VERSION, 1);
  assert.equal(Object.isFrozen(firstApi), true);
});

test("shares one native observer and batches deliveries across independent watchers", async () => {
  const { api, observers } = createHarness();
  const runs = { first: 0, second: 0, third: 0 };
  for (const id of Object.keys(runs)) {
    api.register({
      id,
      observe: { childList: true, subtree: true },
      evaluate({ reason }) {
        if (reason === "mutation") {
          runs[id] += 1;
        }
      }
    });
  }
  await flushTasks();

  assert.equal(observers.length, 1);
  observers[0].emit([childMutation("one")]);
  observers[0].emit([childMutation("two")]);
  await flushTasks();

  assert.deepEqual(runs, { first: 1, second: 1, third: 1 });
  assert.equal(api.getDiagnostics().observerConnected, true);
});

test("replaces duplicate watcher ids and stale handles cannot remove replacements", async () => {
  const { api } = createHarness();
  let oldCleanupCount = 0;
  let newRuns = 0;
  const staleHandle = api.register({
    id: "duplicate",
    observe: { childList: true },
    evaluate() {},
    cleanup() {
      oldCleanupCount += 1;
    }
  });
  const currentHandle = api.register({
    id: "duplicate",
    replace: true,
    observe: { childList: true },
    evaluate() {
      newRuns += 1;
    }
  });
  await flushTasks();

  assert.equal(oldCleanupCount, 1);
  assert.equal(staleHandle.dispose(), false);
  assert.equal(currentHandle.active, true);
  assert.equal(api.getDiagnostics().watcherCount, 1);
  assert.equal(newRuns, 1);
});

test("rejects accidental duplicate ids unless replacement is explicit", () => {
  const { api } = createHarness();
  api.register({
    id: "collision",
    evaluate() {}
  });
  assert.throws(
    () => api.register({ id: "collision", evaluate() {} }),
    /already exists/
  );
  assert.throws(
    () => api.register({ id: "async-cleanup", evaluate() {}, async cleanup() {} }),
    /cleanup must be synchronous/
  );
});

test("isolates callback failures and keeps other watchers running", async () => {
  const { api, errors, observers } = createHarness();
  let safeRuns = 0;
  api.register({
    id: "throws",
    observe: { childList: true, subtree: true },
    evaluate({ reason }) {
      if (reason === "mutation") {
        throw new Error("fixture failure");
      }
    }
  });
  api.register({
    id: "safe",
    observe: { childList: true, subtree: true },
    evaluate({ reason }) {
      if (reason === "mutation") {
        safeRuns += 1;
      }
    }
  });
  await flushTasks();
  observers[0].emit([childMutation()]);
  await flushTasks();

  assert.equal(safeRuns, 1);
  assert.equal(errors.some(([message]) => String(message).includes("throws")), true);
});

test("one-shot watchers stop observing after success and restart on route refresh", async () => {
  const harness = createHarness();
  let ready = false;
  let runs = 0;
  harness.api.register({
    id: "one-shot",
    mode: "once",
    observe: { childList: true, subtree: true },
    evaluate() {
      runs += 1;
      return ready;
    }
  });
  await flushTasks();
  assert.equal(runs, 1);

  ready = true;
  harness.observers[0].emit([childMutation()]);
  await flushTasks();
  assert.equal(runs, 2);
  assert.equal(harness.api.getDiagnostics().activeWatcherCount, 0);
  assert.equal(harness.api.getDiagnostics().observerConnected, false);

  harness.setLocation("https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=2");
  harness.emitWindow("popstate");
  await flushTasks();
  assert.equal(runs, 3);
});

test("waitFor resolves immediately, from mutations, on timeout, and on abort", async () => {
  const harness = createHarness();
  assert.equal(
    await harness.api.waitFor({
      id: "immediate",
      test: () => "ready"
    }),
    "ready"
  );

  let mutationReady = false;
  const mutationWait = harness.api.waitFor({
    id: "mutation",
    timeoutMs: 100,
    test: () => mutationReady
  });
  await flushTasks();
  mutationReady = true;
  harness.observers[0].emit([childMutation()]);
  assert.equal(await mutationWait, true);

  assert.equal(
    await harness.api.waitFor({
      id: "timeout",
      timeoutMs: 5,
      test: () => false
    }),
    null
  );
  assert.equal(
    await harness.api.waitFor({
      id: "unsupported",
      capability: harness.sandbox.SuiteMateV3Routes.CAPABILITIES.IMPORT_ASSISTANT_CONTEXT,
      timeoutMs: 100,
      test: () => false
    }),
    null
  );

  const controller = new AbortController();
  const abortedWait = harness.api.waitFor({
    id: "aborted",
    signal: controller.signal,
    timeoutMs: 100,
    test: () => false
  });
  controller.abort();
  assert.equal(await abortedWait, null);
  assert.equal(harness.api.getDiagnostics().watcherCount, 0);
});

test("route capability loss cleans up and the reverse transition activates once", async () => {
  const harness = createHarness();
  const capability = harness.sandbox.SuiteMateV3Routes.CAPABILITIES.CSV_IMPORT_TOOLBAR;
  let runs = 0;
  let cleanups = 0;
  harness.api.register({
    id: "record.csv",
    capability,
    observe: { childList: true, subtree: true },
    evaluate() {
      runs += 1;
    },
    cleanup() {
      cleanups += 1;
    }
  });
  await flushTasks();
  assert.equal(runs, 1);

  harness.setLocation("https://123456.app.netsuite.com/app/common/search/searchresults.nl");
  harness.emitWindow("popstate");
  await flushTasks();
  assert.equal(cleanups, 1);
  assert.equal(harness.api.getDiagnostics().activeWatcherCount, 0);

  harness.setLocation("https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=2");
  harness.emitWindow("popstate");
  await flushTasks();
  assert.equal(runs, 2);
  assert.equal(cleanups, 1);
});

test("pause, pagehide, and disposeAll invalidate work and disconnect the observer", async () => {
  const harness = createHarness();
  let cleanupCount = 0;
  const handle = harness.api.register({
    id: "owned",
    observe: { childList: true },
    evaluate() {},
    cleanup() {
      cleanupCount += 1;
    }
  });
  await flushTasks();

  assert.equal(handle.pause("settings-disabled"), true);
  assert.equal(handle.signal?.aborted ?? true, true);
  assert.equal(cleanupCount, 1);
  assert.equal(harness.api.getDiagnostics().observerConnected, false);

  handle.resume("settings-enabled");
  await flushTasks();
  harness.emitWindow("pagehide");
  assert.equal(cleanupCount, 2);
  assert.equal(harness.api.getDiagnostics().watcherCount, 0);
  assert.equal(harness.api.getDiagnostics().observerConnected, false);
});

test("invalidates stale asynchronous generations before they can mutate state", async () => {
  const harness = createHarness();
  let releaseFirstRun;
  let staleMutations = 0;
  const firstRunGate = new Promise((resolve) => {
    releaseFirstRun = resolve;
  });
  const handle = harness.api.register({
    id: "async-installer",
    async evaluate({ isCurrent }) {
      await firstRunGate;
      if (isCurrent()) {
        staleMutations += 1;
      }
    }
  });
  await flushTasks();

  handle.pause("settings-disabled");
  releaseFirstRun();
  await flushTasks();
  assert.equal(staleMutations, 0);
});

test("suspends bfcache pages and reactivates watchers on pageshow", async () => {
  const harness = createHarness();
  let runs = 0;
  let cleanups = 0;
  harness.api.register({
    id: "bfcache",
    observe: { childList: true },
    evaluate() {
      runs += 1;
    },
    cleanup() {
      cleanups += 1;
    }
  });
  await flushTasks();
  assert.equal(runs, 1);

  harness.emitWindow("pageshow", { persisted: false });
  await flushTasks();
  assert.equal(runs, 1);
  assert.equal(cleanups, 0);

  harness.emitWindow("pagehide", { persisted: true });
  assert.equal(cleanups, 1);
  assert.equal(harness.api.getDiagnostics().watcherCount, 1);
  assert.equal(harness.api.getDiagnostics().activeWatcherCount, 0);

  harness.emitWindow("pageshow", { persisted: true });
  await flushTasks();
  assert.equal(runs, 2);
  assert.equal(harness.api.getDiagnostics().activeWatcherCount, 1);
});
