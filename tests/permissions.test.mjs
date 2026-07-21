import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(resolve("src/shared/permissions.js"), "utf8");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEvent() {
  const listeners = new Set();
  return {
    listeners,
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    emit(value) {
      for (const listener of [...listeners]) {
        listener(value);
      }
    }
  };
}

function createHarness(options = {}) {
  const calls = [];
  const granted = new Set(options.granted ?? []);
  const onAdded = createEvent();
  const onRemoved = createEvent();
  const errors = [];
  let containsResolver;
  let containsRejecter;
  let getAllResolver;
  let getAllRejecter;
  let requestResolver;
  let requestRejecter;
  let removeResolver;
  let removeRejecter;

  const permissionsApi = options.apiUnavailable
    ? undefined
    : {
        onAdded,
        onRemoved,
        async contains(descriptor) {
          calls.push(["contains", plain(descriptor)]);
          if (options.containsError) {
            throw new Error(options.containsError);
          }
          const result = descriptor.permissions.every((permission) => granted.has(permission));
          if (options.deferContains) {
            return new Promise((resolveContains, rejectContains) => {
              containsResolver = resolveContains;
              containsRejecter = rejectContains;
            });
          }
          if (options.containsDelay) {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, options.containsDelay));
          }
          return result;
        },
        request(descriptor) {
          calls.push(["request", plain(descriptor), options.isUserGesture?.() ?? null]);
          if (options.requestThrows) {
            throw new Error(options.requestThrows);
          }
          if (options.deferRequest) {
            return new Promise((resolveRequest, rejectRequest) => {
              requestRejecter = rejectRequest;
              requestResolver = (value) => {
                if (value === true) {
                  for (const permission of descriptor.permissions) {
                    granted.add(permission);
                  }
                }
                resolveRequest(value);
              };
            });
          }
          if (options.requestError) {
            return Promise.reject(new Error(options.requestError));
          }
          const approved = options.requestGranted !== false;
          if (approved) {
            for (const permission of descriptor.permissions) {
              granted.add(permission);
            }
          }
          return Promise.resolve(approved);
        },
        async remove(descriptor) {
          calls.push(["remove", plain(descriptor)]);
          if (options.removeError) {
            throw new Error(options.removeError);
          }
          if (options.deferRemove) {
            return new Promise((resolveRemove, rejectRemove) => {
              removeRejecter = rejectRemove;
              removeResolver = (value) => {
                if (value === true) {
                  for (const permission of descriptor.permissions) {
                    granted.delete(permission);
                  }
                }
                resolveRemove(value);
              };
            });
          }
          const removed = options.removeGranted !== false;
          if (removed) {
            for (const permission of descriptor.permissions) {
              granted.delete(permission);
            }
          }
          return removed;
        },
        async getAll() {
          calls.push(["getAll"]);
          if (options.getAllError) {
            throw new Error(options.getAllError);
          }
          if (options.deferGetAll) {
            return new Promise((resolveGetAll, rejectGetAll) => {
              getAllResolver = resolveGetAll;
              getAllRejecter = rejectGetAll;
            });
          }
          return {
            permissions: [...granted, ...(options.unrelatedPermissions ?? [])],
            origins: ["https://unrelated.example/*"]
          };
        }
      };

  const sandbox = {
    chrome: { permissions: permissionsApi },
    console: {
      error(...args) {
        errors.push(args);
      }
    },
    setTimeout
  };
  sandbox.globalThis = sandbox;
  runInNewContext(source, sandbox);

  return {
    api: sandbox.SuiteMateV3Permissions,
    broker: sandbox.SuiteMateV3Permissions.create({ permissionsApi, console: sandbox.console }),
    calls,
    errors,
    granted,
    onAdded,
    onRemoved,
    resolveContains(value) {
      containsResolver?.(value);
    },
    rejectContains(message) {
      containsRejecter?.(new Error(message));
    },
    resolveGetAll(value) {
      getAllResolver?.(value);
    },
    rejectGetAll(message) {
      getAllRejecter?.(new Error(message));
    },
    resolveRequest(value) {
      requestResolver?.(value);
    },
    rejectRequest(message) {
      requestRejecter?.(new Error(message));
    },
    resolveRemove(value) {
      removeResolver?.(value);
    },
    rejectRemove(message) {
      removeRejecter?.(new Error(message));
    }
  };
}

test("exports one frozen versioned allowlist with permission explanations", () => {
  const { api } = createHarness();
  assert.equal(api.VERSION, 1);
  assert.deepEqual(plain(api.IDS), {
    BOOKMARKS: "bookmarks",
    CONTEXT_MENUS: "contextMenus",
    HISTORY: "history",
    SIDE_PANEL: "sidePanel"
  });
  assert.deepEqual(
    plain(api.DEFINITIONS.map((definition) => definition.id)),
    plain(Object.values(api.IDS))
  );
  assert.equal(new Set(api.DEFINITIONS.map((definition) => definition.id)).size, 4);
  assert.equal(Object.isFrozen(api.DEFINITIONS), true);
  for (const definition of api.DEFINITIONS) {
    assert.equal(Object.isFrozen(definition), true);
    assert.equal(Object.isFrozen(definition.permissions), true);
    assert.equal(Object.isFrozen(definition.featureIds), true);
    assert.ok(definition.label.length > 0);
    assert.ok(definition.reason.length > 0);
    assert.ok(definition.warning.length > 0);
    assert.deepEqual(plain(definition.permissions), [definition.id]);
  }
  assert.deepEqual(plain(api.get(api.IDS.BOOKMARKS).featureIds), ["GEN-03", "BRW-07", "SQL-07"]);
  assert.deepEqual(plain(api.get(api.IDS.HISTORY).featureIds), ["SQL-08"]);
  assert.equal(api.get("tabs"), null);
});

test("initialization and discovery never request optional access", () => {
  const harness = createHarness();
  assert.equal(harness.api.DEFINITIONS.length, 4);
  assert.equal(harness.api.get(harness.api.IDS.BOOKMARKS).id, "bookmarks");
  assert.deepEqual(harness.calls, []);
});

test("rejects unknown permissions before calling Chrome", async () => {
  const harness = createHarness();
  for (const operation of ["contains", "request", "remove"]) {
    const result = await harness.broker[operation]("tabs");
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "UNKNOWN_OPTIONAL_PERMISSION");
  }
  assert.deepEqual(harness.calls, []);
});

test("contains checks only the registered permission and returns immutable state", async () => {
  const harness = createHarness({ granted: ["bookmarks"] });
  const result = await harness.broker.contains(harness.api.IDS.BOOKMARKS);
  assert.deepEqual(plain(result), {
    ok: true,
    id: "bookmarks",
    granted: true,
    changed: false,
    permissions: ["bookmarks"]
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.permissions), true);
  assert.deepEqual(harness.calls, [["contains", { permissions: ["bookmarks"] }]]);
});

test("request starts synchronously inside the caller's user gesture", async () => {
  let userGesture = true;
  const harness = createHarness({
    containsDelay: 5,
    isUserGesture: () => userGesture
  });

  const pending = harness.broker.request(harness.api.IDS.BOOKMARKS);
  userGesture = false;
  const result = await pending;

  assert.equal(result.ok, true);
  assert.equal(result.granted, true);
  assert.equal(result.changed, true);
  assert.deepEqual(harness.calls[0], ["contains", { permissions: ["bookmarks"] }]);
  assert.deepEqual(harness.calls[1], ["request", { permissions: ["bookmarks"] }, true]);
});

test("request treats denial as a normal unchanged state", async () => {
  const harness = createHarness({ requestGranted: false });
  const result = await harness.broker.request(harness.api.IDS.HISTORY);
  assert.deepEqual(plain(result), {
    ok: true,
    id: "history",
    granted: false,
    changed: false,
    permissions: ["history"]
  });
});

test("request reports an already granted permission without a false change", async () => {
  const harness = createHarness({ granted: ["sidePanel"] });
  const result = await harness.broker.request(harness.api.IDS.SIDE_PANEL);
  assert.equal(result.ok, true);
  assert.equal(result.granted, true);
  assert.equal(result.changed, false);
});

test("remove revokes only the registered permission and reports whether state changed", async () => {
  const harness = createHarness({ granted: ["history", "storage"] });
  const result = await harness.broker.remove(harness.api.IDS.HISTORY);
  assert.deepEqual(plain(result), {
    ok: true,
    id: "history",
    granted: false,
    changed: true,
    permissions: ["history"]
  });
  assert.equal(harness.granted.has("storage"), true);
  assert.deepEqual(harness.calls, [
    ["contains", { permissions: ["history"] }],
    ["remove", { permissions: ["history"] }]
  ]);
});

test("maps Chrome failures without leaking opaque exceptions", async () => {
  const checks = [
    ["contains", { containsError: "contains failed" }, "contains failed"],
    ["request", { requestError: "request failed" }, "request failed"],
    ["remove", { granted: ["history"], removeError: "remove failed" }, "remove failed"]
  ];
  for (const [operation, options, message] of checks) {
    const harness = createHarness(options);
    const result = await harness.broker[operation](harness.api.IDS.HISTORY);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "OPTIONAL_PERMISSION_API_ERROR");
    assert.equal(result.error.message, message);
  }
});

test("fails closed when Chrome's permissions API is unavailable", async () => {
  const harness = createHarness({ apiUnavailable: true });
  for (const operation of ["contains", "request", "remove"]) {
    const result = await harness.broker[operation](harness.api.IDS.BOOKMARKS);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "PERMISSIONS_API_UNAVAILABLE");
  }
  const snapshot = await harness.broker.getSnapshot();
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.error.code, "PERMISSIONS_API_UNAVAILABLE");
});

test("snapshot exposes only registered capability state", async () => {
  const harness = createHarness({
    granted: ["bookmarks", "sidePanel"],
    unrelatedPermissions: ["activeTab", "storage", "tabs"]
  });
  const result = await harness.broker.getSnapshot();
  assert.deepEqual(plain(result), {
    ok: true,
    version: 1,
    capabilities: {
      bookmarks: true,
      contextMenus: false,
      history: false,
      sidePanel: true
    }
  });
  assert.equal(Object.isFrozen(result.capabilities), true);
  assert.equal(Object.hasOwn(result, "origins"), false);
});

test("subscriptions are lazy, filter unrelated events and clean up after the last listener", () => {
  const harness = createHarness();
  const received = [];
  assert.equal(harness.onAdded.listeners.size, 0);
  assert.equal(harness.onRemoved.listeners.size, 0);

  const subscription = harness.broker.subscribe((event) => received.push(event));
  assert.equal(subscription.ok, true);
  assert.equal(harness.onAdded.listeners.size, 1);
  assert.equal(harness.onRemoved.listeners.size, 1);

  harness.onAdded.emit({ permissions: ["tabs"], origins: ["https://example.com/*"] });
  assert.equal(received.length, 0);
  harness.onAdded.emit({ permissions: ["bookmarks", "tabs"] });
  harness.onRemoved.emit({ permissions: ["history"] });
  assert.deepEqual(plain(received), [
    { type: "added", capabilityIds: ["bookmarks"], permissions: ["bookmarks"] },
    { type: "removed", capabilityIds: ["history"], permissions: ["history"] }
  ]);
  assert.equal(Object.isFrozen(received[0]), true);
  assert.equal(subscription.unsubscribe(), true);
  assert.equal(subscription.unsubscribe(), false);
  assert.equal(harness.onAdded.listeners.size, 0);
  assert.equal(harness.onRemoved.listeners.size, 0);
});

test("subscriber failures are isolated from other permission consumers", () => {
  const harness = createHarness();
  let delivered = 0;
  const first = harness.broker.subscribe(() => {
    throw new Error("subscriber failed");
  });
  const second = harness.broker.subscribe(() => {
    delivered += 1;
  });

  harness.onAdded.emit({ permissions: ["contextMenus"] });
  assert.equal(delivered, 1);
  assert.equal(harness.errors.length, 1);
  first.unsubscribe();
  second.unsubscribe();
});

test("rejects overlapping permission mutations", async () => {
  const harness = createHarness({ deferRequest: true });
  const pending = harness.broker.request(harness.api.IDS.BOOKMARKS);
  const overlapping = await harness.broker.remove(harness.api.IDS.HISTORY);
  assert.equal(overlapping.ok, false);
  assert.equal(overlapping.error.code, "PERMISSION_MUTATION_BUSY");
  harness.resolveRequest(true);
  assert.equal((await pending).ok, true);
});

test("disposal removes listeners and invalidates pending operations", async () => {
  const harness = createHarness({ granted: ["history"], deferRemove: true });
  let delivered = 0;
  harness.broker.subscribe(() => {
    delivered += 1;
  });
  const pending = harness.broker.remove(harness.api.IDS.HISTORY);
  await new Promise((resolveTick) => setTimeout(resolveTick, 0));

  assert.equal(harness.broker.dispose(), true);
  assert.equal(harness.broker.dispose(), false);
  assert.equal(harness.onAdded.listeners.size, 0);
  assert.equal(harness.onRemoved.listeners.size, 0);
  harness.onAdded.emit({ permissions: ["bookmarks"] });
  assert.equal(delivered, 0);

  harness.resolveRemove(true);
  const stale = await pending;
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "PERMISSION_BROKER_DISPOSED");
  const afterDispose = await harness.broker.contains(harness.api.IDS.BOOKMARKS);
  assert.equal(afterDispose.error.code, "PERMISSION_BROKER_DISPOSED");
});

test("disposal takes precedence over late Chrome promise rejections", async () => {
  const containsHarness = createHarness({ deferContains: true });
  const pendingContains = containsHarness.broker.contains(containsHarness.api.IDS.BOOKMARKS);
  containsHarness.broker.dispose();
  containsHarness.rejectContains("late contains failure");
  assert.equal((await pendingContains).error.code, "PERMISSION_BROKER_DISPOSED");

  const snapshotHarness = createHarness({ deferGetAll: true });
  const pendingSnapshot = snapshotHarness.broker.getSnapshot();
  snapshotHarness.broker.dispose();
  snapshotHarness.rejectGetAll("late snapshot failure");
  assert.equal((await pendingSnapshot).error.code, "PERMISSION_BROKER_DISPOSED");

  const requestHarness = createHarness({ deferRequest: true });
  const pendingRequest = requestHarness.broker.request(requestHarness.api.IDS.HISTORY);
  requestHarness.broker.dispose();
  requestHarness.rejectRequest("late request failure");
  assert.equal((await pendingRequest).error.code, "PERMISSION_BROKER_DISPOSED");

  const removeHarness = createHarness({ granted: ["history"], deferRemove: true });
  const pendingRemove = removeHarness.broker.remove(removeHarness.api.IDS.HISTORY);
  await new Promise((resolveTick) => setTimeout(resolveTick, 0));
  removeHarness.broker.dispose();
  removeHarness.rejectRemove("late remove failure");
  assert.equal((await pendingRemove).error.code, "PERMISSION_BROKER_DISPOSED");
});

test("disposal during removal preflight prevents Chrome revocation", async () => {
  const harness = createHarness({ granted: ["history"], deferContains: true });
  const pending = harness.broker.remove(harness.api.IDS.HISTORY);
  assert.equal(harness.broker.dispose(), true);
  harness.resolveContains(true);

  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PERMISSION_BROKER_DISPOSED");
  assert.deepEqual(harness.calls, [["contains", { permissions: ["history"] }]]);
});
