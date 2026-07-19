import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const settingsSource = await readFile(resolve(root, "src/shared/settings.js"), "utf8");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createHarness(initialValue, options = {}) {
  let storedValue = clone(initialValue);
  const writes = [];
  let reads = 0;
  const sandbox = {
    chrome: {
      storage: {
        sync: {
          async get(key) {
            reads += 1;
            if (options.rejectRead) {
              throw new Error("Storage read failed");
            }
            return { [key]: clone(storedValue) };
          },
          async set(value) {
            if (options.rejectWrite) {
              throw new Error("Storage write failed");
            }
            const [key, nextValue] = Object.entries(value)[0];
            writes.push({ key, value: clone(nextValue) });
            storedValue = clone(nextValue);
          }
        }
      }
    }
  };
  sandbox.globalThis = sandbox;
  runInNewContext(settingsSource, sandbox);

  return {
    api: sandbox.SuiteMateV3Settings,
    get reads() {
      return reads;
    },
    get storedValue() {
      return clone(storedValue);
    },
    writes
  };
}

test("exports a stable versioned schema and current defaults", () => {
  const { api } = createHarness();
  assert.equal(api.STORAGE_KEY, "suiteMateV3Style");
  assert.equal(api.SCHEMA_VERSION, 1);
  assert.equal(api.DEFAULTS.schemaVersion, api.SCHEMA_VERSION);

  for (const value of [undefined, null, "invalid", 42, [], true]) {
    assert.deepEqual(plain(api.normalize(value)), plain(api.DEFAULTS));
  }
  assert.deepEqual(plain(api.normalize(api.DEFAULTS)), plain(api.DEFAULTS));
});

test("migrates legacy appearance and role themes without changing their meaning", () => {
  const { api } = createHarness();
  const legacy = Object.freeze({
    enabled: false,
    mode: "dark",
    squareCorners: true,
    roleThemes: Object.freeze({
      "9845683_SB2~11596~3~N": Object.freeze({
        name: " DBG Health (SB2) - Administrator ",
        main: "#123456",
        secondary: "#ABCDEF"
      }),
      "6998262_SB1~1001~18~N": Object.freeze({
        name: "MCo Beauty - Developer",
        main: "#f00"
      })
    })
  });

  const migrated = api.migrate(legacy);
  assert.deepEqual(plain(migrated), {
    schemaVersion: 1,
    enabled: false,
    mode: "dark",
    squareCorners: true,
    roleThemes: {
      "9845683_SB2~11596~3~N": {
        name: "DBG Health (SB2) - Administrator",
        main: "#123456",
        secondary: "#abcdef"
      },
      "6998262_SB1~1001~18~N": {
        name: "MCo Beauty - Developer",
        main: "#ff0000"
      }
    }
  });
  assert.deepEqual(plain(api.migrate(migrated)), plain(migrated));
  assert.equal(Object.hasOwn(legacy, "schemaVersion"), false, "Migration mutated the legacy object");
});

test("repairs invalid declared settings while preserving valid role data", () => {
  const { api } = createHarness();
  const maliciousThemes = JSON.parse(
    '{"__proto__":{"main":"#111111"},"constructor":{"main":"#222222"},"valid":{"name":"   ","main":"nope","secondary":"#abc"}}'
  );
  const repaired = api.normalize({
    schemaVersion: 1,
    enabled: "false",
    mode: "sepia",
    squareCorners: 1,
    roleThemes: maliciousThemes,
    unknown: "removed"
  });

  assert.deepEqual(plain(repaired), {
    schemaVersion: 1,
    enabled: true,
    mode: "light",
    squareCorners: false,
    roleThemes: {
      valid: {
        name: "valid",
        secondary: "#aabbcc"
      }
    }
  });
  assert.equal(Object.prototype.main, undefined);
});

test("rejects invalid and future schema versions with typed errors", () => {
  const { api } = createHarness();
  for (const schemaVersion of ["1", -1, 1.5, null]) {
    assert.throws(
      () => api.normalize({ schemaVersion }),
      (error) => error.code === api.INVALID_VERSION_CODE
    );
  }
  assert.throws(
    () => api.normalize({ schemaVersion: api.SCHEMA_VERSION + 1 }),
    (error) =>
      error.code === api.UNSUPPORTED_VERSION_CODE
      && error.storedVersion === api.SCHEMA_VERSION + 1
  );
});

test("reads legacy settings in memory without producing migration writes", async () => {
  const harness = createHarness({ enabled: false, mode: "system", squareCorners: true });
  const settings = await harness.api.get();
  assert.deepEqual(plain(settings), {
    schemaVersion: 1,
    enabled: false,
    mode: "system",
    squareCorners: true,
    roleThemes: {}
  });
  assert.equal(harness.reads, 1);
  assert.equal(harness.writes.length, 0);
});

test("ensureCurrentSchema persists one canonical migration and then becomes idempotent", async () => {
  const harness = createHarness({
    enabled: true,
    mode: "dark",
    roleThemes: {
      "ACCOUNT~ROLE": { name: "Role", main: "#123" }
    }
  });

  const first = await harness.api.ensureCurrentSchema();
  assert.equal(first.schemaVersion, 1);
  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.storedValue, plain(first));

  const second = await harness.api.ensureCurrentSchema();
  assert.deepEqual(plain(second), plain(first));
  assert.equal(harness.writes.length, 1);
});

test("set writes one canonical object and storage values are returned by copy", async () => {
  const harness = createHarness();
  const roleContext = { id: "ACCOUNT~ROLE", name: "Company - Administrator" };
  const next = harness.api.withRoleTheme(harness.api.DEFAULTS, roleContext, {
    main: "#123456",
    secondary: "#abcdef"
  });
  const saved = await harness.api.set({ ...next, mode: "dark" });

  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.storedValue, plain(saved));
  saved.roleThemes["ACCOUNT~ROLE"].main = "#000000";
  assert.equal(harness.storedValue.roleThemes["ACCOUNT~ROLE"].main, "#123456");
});

test("role operations preserve schema version and unrelated roles", () => {
  const { api } = createHarness();
  const roleA = { id: "ACCOUNT_A~ROLE_1", name: "Role A" };
  const roleB = { id: "ACCOUNT_B~ROLE_2", name: "Role B" };
  let settings = api.withRoleTheme(api.DEFAULTS, roleA, { main: "#111111", secondary: "#222222" });
  settings = api.withRoleTheme(settings, roleB, { main: "#333333" });

  const updated = api.withRoleTheme(settings, roleA, { main: "#444444" });
  assert.equal(updated.schemaVersion, api.SCHEMA_VERSION);
  assert.deepEqual(plain(updated.roleThemes[roleB.id]), plain(settings.roleThemes[roleB.id]));
  assert.equal(updated.roleThemes[roleA.id].secondary, "#222222");

  const removed = api.withoutRoleTheme(updated, roleA.id);
  assert.equal(removed.roleThemes[roleA.id], undefined);
  assert.deepEqual(plain(removed.roleThemes[roleB.id]), plain(settings.roleThemes[roleB.id]));
});

test("future settings cannot be read, migrated or overwritten by an older release", async () => {
  const future = {
    schemaVersion: 2,
    enabled: false,
    futureFeature: { importantData: ["must", "survive"] }
  };
  const harness = createHarness(future);

  await assert.rejects(
    harness.api.get(),
    (error) => error.code === harness.api.UNSUPPORTED_VERSION_CODE
  );
  await assert.rejects(
    harness.api.ensureCurrentSchema(),
    (error) => error.code === harness.api.UNSUPPORTED_VERSION_CODE
  );
  await assert.rejects(
    harness.api.set(harness.api.DEFAULTS),
    (error) => error.code === harness.api.UNSUPPORTED_VERSION_CODE
  );
  assert.deepEqual(harness.storedValue, future);
  assert.equal(harness.writes.length, 0);
});

test("rejects settings before Chrome sync produces an opaque quota failure", async () => {
  const harness = createHarness(harnessDefaults(1));
  const roleThemes = {};
  for (let index = 0; index < 100; index += 1) {
    roleThemes[`ACCOUNT_${index}~ROLE_${index}`] = {
      name: `Role ${index} ${"x".repeat(150)}`,
      main: "#123456",
      secondary: "#abcdef"
    };
  }

  await assert.rejects(
    harness.api.set({ ...harness.api.DEFAULTS, roleThemes }),
    (error) => error.code === harness.api.QUOTA_CODE && error.bytes > error.maximumBytes
  );
  assert.equal(harness.writes.length, 0);
});

test("propagates Chrome storage failures without reporting false success", async () => {
  const readFailure = createHarness(undefined, { rejectRead: true });
  await assert.rejects(readFailure.api.get(), /Storage read failed/);
  await assert.rejects(readFailure.api.set(readFailure.api.DEFAULTS), /Storage read failed/);
  assert.equal(readFailure.writes.length, 0);

  const writeFailure = createHarness(undefined, { rejectWrite: true });
  await assert.rejects(writeFailure.api.set(writeFailure.api.DEFAULTS), /Storage write failed/);
  assert.equal(writeFailure.writes.length, 0);
});

function harnessDefaults(schemaVersion) {
  return {
    schemaVersion,
    enabled: true,
    mode: "light",
    squareCorners: false,
    roleThemes: {}
  };
}
