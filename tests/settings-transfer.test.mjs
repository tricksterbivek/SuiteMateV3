import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [utilitySource, settingsSource, transferSource] = await Promise.all([
  readFile(resolve(root, "src/shared/utilities.js"), "utf8"),
  readFile(resolve(root, "src/shared/settings.js"), "utf8"),
  readFile(resolve(root, "src/shared/settings-transfer.js"), "utf8")
]);

function createHarness() {
  const sandbox = {
    TextDecoder,
    TextEncoder,
    atob,
    btoa
  };
  sandbox.globalThis = sandbox;
  runInNewContext(utilitySource, sandbox);
  runInNewContext(settingsSource, sandbox);
  runInNewContext(transferSource, sandbox);
  return {
    settings: sandbox.SuiteMateV3Settings,
    transfer: sandbox.SuiteMateV3SettingsTransfer
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function decodeEnvelope(transfer, backup) {
  return JSON.parse(Buffer.from(backup.slice(transfer.PREFIX.length), "base64").toString("utf8"));
}

function encodeEnvelope(transfer, envelope) {
  return `${transfer.PREFIX}${Buffer.from(JSON.stringify(envelope), "utf8").toString("base64")}`;
}

function expectCode(action, code) {
  assert.throws(action, (error) => error?.code === code);
}

test("creates a versioned UTF-8 backup and restores canonical settings", () => {
  const { settings, transfer } = createHarness();
  const value = settings.withRoleTheme(
    { ...settings.DEFAULTS, mode: "dark", squareCorners: true },
    { id: "ACCOUNT~ROLE", name: "Administrateur Café 😀" },
    { main: "#123456", secondary: "#abcdef" }
  );
  const exportedAt = "2026-07-22T01:02:03.456Z";
  const backup = transfer.create(value, { exportedAt });

  assert.equal(backup.startsWith(transfer.PREFIX), true);
  assert.equal(backup.length < transfer.MAX_ENCODED_CHARACTERS, true);
  const envelope = decodeEnvelope(transfer, backup);
  assert.deepEqual(envelope, {
    format: transfer.FORMAT,
    formatVersion: transfer.FORMAT_VERSION,
    exportedAt,
    settingsSchemaVersion: settings.SCHEMA_VERSION,
    settings: plain(value)
  });

  const parsed = transfer.parse(`  ${backup}\n`);
  assert.deepEqual(plain(parsed.settings), plain(value));
  assert.equal(parsed.exportedAt, exportedAt);
  assert.equal(Object.isFrozen(parsed), true);
});

test("rejects empty, unrecognized and malformed encoded input", () => {
  const { transfer } = createHarness();
  expectCode(() => transfer.parse(""), "EMPTY_BACKUP");
  expectCode(() => transfer.parse("not-a-backup"), "INVALID_BACKUP_PREFIX");
  expectCode(() => transfer.parse(`${transfer.PREFIX}%%%`), "INVALID_BACKUP_ENCODING");
  expectCode(
    () => transfer.parse(`${transfer.PREFIX}${Buffer.from("{", "utf8").toString("base64")}`),
    "INVALID_BACKUP_JSON"
  );
});

test("rejects wrong application, future backup format and invalid timestamps", () => {
  const { settings, transfer } = createHarness();
  const backup = transfer.create(settings.DEFAULTS, { exportedAt: "2026-07-22T01:02:03.456Z" });
  const envelope = decodeEnvelope(transfer, backup);

  expectCode(
    () => transfer.parse(encodeEnvelope(transfer, { ...envelope, format: "other-extension" })),
    "INVALID_BACKUP_FORMAT"
  );
  expectCode(
    () => transfer.parse(encodeEnvelope(transfer, { ...envelope, formatVersion: 2 })),
    "UNSUPPORTED_BACKUP_VERSION"
  );
  expectCode(
    () => transfer.parse(encodeEnvelope(transfer, { ...envelope, exportedAt: "yesterday" })),
    "INVALID_BACKUP_TIMESTAMP"
  );
  expectCode(
    () => transfer.parse(encodeEnvelope(transfer, { ...envelope, extra: true })),
    "INVALID_BACKUP_ENVELOPE"
  );
});

test("rejects schema mismatches, future settings and non-canonical data", () => {
  const { settings, transfer } = createHarness();
  const backup = transfer.create(settings.DEFAULTS, { exportedAt: "2026-07-22T01:02:03.456Z" });
  const envelope = decodeEnvelope(transfer, backup);

  expectCode(
    () => transfer.parse(encodeEnvelope(transfer, { ...envelope, settingsSchemaVersion: 0 })),
    "SETTINGS_VERSION_MISMATCH"
  );
  expectCode(
    () => transfer.parse(encodeEnvelope(transfer, {
      ...envelope,
      settingsSchemaVersion: settings.SCHEMA_VERSION + 1,
      settings: { ...envelope.settings, schemaVersion: settings.SCHEMA_VERSION + 1 }
    })),
    settings.UNSUPPORTED_VERSION_CODE
  );
  expectCode(
    () => transfer.parse(encodeEnvelope(transfer, {
      ...envelope,
      settings: { ...envelope.settings, unknown: "must not be silently discarded" }
    })),
    "NON_CANONICAL_BACKUP_SETTINGS"
  );
  expectCode(
    () => transfer.parse(encodeEnvelope(transfer, {
      ...envelope,
      settings: { ...envelope.settings, mode: "sepia" }
    })),
    "NON_CANONICAL_BACKUP_SETTINGS"
  );
});

test("rejects oversized settings both before export and after decoding", () => {
  const { settings, transfer } = createHarness();
  const roleThemes = {};
  for (let index = 0; index < 100; index += 1) {
    roleThemes[`ACCOUNT_${index}~ROLE_${index}`] = {
      name: `Role ${index} ${"x".repeat(150)}`,
      main: "#123456",
      secondary: "#abcdef"
    };
  }
  const oversized = { ...settings.DEFAULTS, roleThemes };
  expectCode(() => transfer.create(oversized), settings.QUOTA_CODE);

  const envelope = {
    format: transfer.FORMAT,
    formatVersion: transfer.FORMAT_VERSION,
    exportedAt: "2026-07-22T01:02:03.456Z",
    settingsSchemaVersion: settings.SCHEMA_VERSION,
    settings: oversized
  };
  expectCode(() => transfer.parse(encodeEnvelope(transfer, envelope)), "BACKUP_TOO_LARGE");
});

test("transfer core has no storage, network or DOM authority", () => {
  assert.doesNotMatch(transferSource, /chrome\.|fetch\(|XMLHttpRequest|document\.|localStorage|sessionStorage/);
});
