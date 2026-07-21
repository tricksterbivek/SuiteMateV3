(function registerSuiteMateV3SettingsTransfer(globalScope) {
  "use strict";

  const VERSION = 1;
  const FORMAT = "suitemate-v3-settings";
  const FORMAT_VERSION = 1;
  const PREFIX = "SUITEMATEV3.SETTINGS.1.";
  const MAX_ENCODED_CHARACTERS = 24000;
  const MAX_DECODED_BYTES = 16000;
  const utilityApi = globalScope.SuiteMateV3Utilities;
  const settingsApi = globalScope.SuiteMateV3Settings;

  if (globalScope.SuiteMateV3SettingsTransfer?.VERSION === VERSION) {
    return;
  }
  if (globalScope.SuiteMateV3SettingsTransfer !== undefined || !utilityApi || !settingsApi) {
    return;
  }

  function transferError(code, message) {
    const error = new Error(message);
    error.name = "SuiteMateSettingsTransferError";
    error.code = code;
    return error;
  }

  function isPlainObject(value) {
    return Boolean(
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.prototype.toString.call(value) === "[object Object]"
    );
  }

  function hasOnlyKeys(value, allowedKeys) {
    return isPlainObject(value)
      && Object.keys(value).every((key) => allowedKeys.includes(key));
  }

  function jsonEquivalent(left, right) {
    if (left === right) {
      return true;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left)
        && Array.isArray(right)
        && left.length === right.length
        && left.every((value, index) => jsonEquivalent(value, right[index]));
    }
    if (!isPlainObject(left) || !isPlainObject(right)) {
      return false;
    }
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) =>
        key === rightKeys[index] && jsonEquivalent(left[key], right[key]));
  }

  function validateTimestamp(value) {
    if (
      typeof value !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    ) {
      throw transferError("INVALID_BACKUP_TIMESTAMP", "The settings backup has an invalid export timestamp.");
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
      throw transferError("INVALID_BACKUP_TIMESTAMP", "The settings backup has an invalid export timestamp.");
    }
  }

  function encodeUtf8(value) {
    if (typeof globalScope.TextEncoder !== "function" || typeof globalScope.btoa !== "function") {
      throw transferError("BACKUP_ENCODING_UNAVAILABLE", "Settings backup encoding is unavailable in this browser.");
    }
    const bytes = new globalScope.TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return globalScope.btoa(binary);
  }

  function decodeUtf8(value) {
    if (typeof globalScope.TextDecoder !== "function" || typeof globalScope.atob !== "function") {
      throw transferError("BACKUP_DECODING_UNAVAILABLE", "Settings backup decoding is unavailable in this browser.");
    }
    let binary;
    try {
      binary = globalScope.atob(value);
    } catch {
      throw transferError("INVALID_BACKUP_ENCODING", "The settings backup is not valid encoded SuiteMate data.");
    }
    if (binary.length > MAX_DECODED_BYTES) {
      throw transferError("BACKUP_TOO_LARGE", "The settings backup is larger than the supported limit.");
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    try {
      return new globalScope.TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw transferError("INVALID_BACKUP_ENCODING", "The settings backup does not contain valid UTF-8 data.");
    }
  }

  function validateCanonicalSettings(value, declaredSchemaVersion) {
    if (!isPlainObject(value)) {
      throw transferError("INVALID_BACKUP_SETTINGS", "The settings backup does not contain a settings object.");
    }
    if (value.schemaVersion !== declaredSchemaVersion) {
      throw transferError("SETTINGS_VERSION_MISMATCH", "The backup settings version does not match its metadata.");
    }

    let normalized;
    try {
      normalized = settingsApi.validateForStorage(value);
    } catch (error) {
      if (settingsApi.isSettingsVersionError(error)) {
        throw error;
      }
      if (error?.code === settingsApi.QUOTA_CODE) {
        throw error;
      }
      throw transferError("INVALID_BACKUP_SETTINGS", "The settings backup contains invalid settings data.");
    }
    if (!jsonEquivalent(value, normalized)) {
      throw transferError(
        "NON_CANONICAL_BACKUP_SETTINGS",
        "The settings backup contains unsupported, missing or invalid fields."
      );
    }
    return normalized;
  }

  function create(value, options = {}) {
    const settings = settingsApi.validateForStorage(value);
    const exportedAt = options.exportedAt ?? new Date().toISOString();
    validateTimestamp(exportedAt);
    const envelope = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      exportedAt,
      settingsSchemaVersion: settings.schemaVersion,
      settings
    };
    const json = JSON.stringify(envelope);
    if (utilityApi.utf8ByteLength(json) > MAX_DECODED_BYTES) {
      throw transferError("BACKUP_TOO_LARGE", "The settings backup is larger than the supported limit.");
    }
    const encoded = `${PREFIX}${encodeUtf8(json)}`;
    if (encoded.length > MAX_ENCODED_CHARACTERS) {
      throw transferError("BACKUP_TOO_LARGE", "The settings backup is larger than the supported limit.");
    }
    return encoded;
  }

  function parse(value) {
    const source = typeof value === "string" ? value.trim() : "";
    if (!source) {
      throw transferError("EMPTY_BACKUP", "Paste a SuiteMate V3 settings backup first.");
    }
    if (source.length > MAX_ENCODED_CHARACTERS) {
      throw transferError("BACKUP_TOO_LARGE", "The settings backup is larger than the supported limit.");
    }
    if (!source.startsWith(PREFIX)) {
      throw transferError("INVALID_BACKUP_PREFIX", "This is not a SuiteMate V3 settings backup.");
    }
    const payload = source.slice(PREFIX.length);
    if (!payload || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) {
      throw transferError("INVALID_BACKUP_ENCODING", "The settings backup is not valid encoded SuiteMate data.");
    }

    let envelope;
    try {
      envelope = JSON.parse(decodeUtf8(payload));
    } catch (error) {
      if (error?.name === "SuiteMateSettingsTransferError") {
        throw error;
      }
      throw transferError("INVALID_BACKUP_JSON", "The settings backup contains invalid JSON data.");
    }
    if (!hasOnlyKeys(envelope, [
      "format",
      "formatVersion",
      "exportedAt",
      "settingsSchemaVersion",
      "settings"
    ])) {
      throw transferError("INVALID_BACKUP_ENVELOPE", "The settings backup has an invalid structure.");
    }
    if (envelope.format !== FORMAT) {
      throw transferError("INVALID_BACKUP_FORMAT", "This backup belongs to a different application.");
    }
    if (envelope.formatVersion !== FORMAT_VERSION) {
      throw transferError(
        "UNSUPPORTED_BACKUP_VERSION",
        `This release supports backup format ${FORMAT_VERSION}, not ${String(envelope.formatVersion)}.`
      );
    }
    if (!Number.isSafeInteger(envelope.settingsSchemaVersion) || envelope.settingsSchemaVersion < 0) {
      throw transferError("INVALID_BACKUP_SETTINGS_VERSION", "The backup settings version is invalid.");
    }
    validateTimestamp(envelope.exportedAt);
    const settings = validateCanonicalSettings(envelope.settings, envelope.settingsSchemaVersion);
    return utilityApi.deepFreeze({
      settings,
      exportedAt: envelope.exportedAt,
      formatVersion: envelope.formatVersion,
      settingsSchemaVersion: envelope.settingsSchemaVersion
    });
  }

  Object.defineProperty(globalScope, "SuiteMateV3SettingsTransfer", {
    value: Object.freeze({
      VERSION,
      FORMAT,
      FORMAT_VERSION,
      PREFIX,
      MAX_ENCODED_CHARACTERS,
      MAX_DECODED_BYTES,
      create,
      parse
    }),
    configurable: false,
    enumerable: true,
    writable: false
  });
})(globalThis);
