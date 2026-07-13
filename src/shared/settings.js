(function registerSuiteMateV3Settings(globalScope) {
  "use strict";

  const STORAGE_KEY = "suiteMateV3Style";
  const MODES = Object.freeze(["light", "dark", "system"]);
  const DEFAULTS = Object.freeze({
    enabled: true,
    mode: "light",
    squareCorners: false
  });

  function normalize(value) {
    const candidate = value && typeof value === "object" ? value : {};

    return {
      enabled: candidate.enabled !== false,
      mode: MODES.includes(candidate.mode) ? candidate.mode : DEFAULTS.mode,
      squareCorners: candidate.squareCorners === true
    };
  }

  async function get() {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    return normalize(result[STORAGE_KEY]);
  }

  async function set(value) {
    const normalized = normalize(value);
    await chrome.storage.sync.set({ [STORAGE_KEY]: normalized });
    return normalized;
  }

  globalScope.SuiteMateV3Settings = Object.freeze({
    STORAGE_KEY,
    DEFAULTS,
    MODES,
    normalize,
    get,
    set
  });
})(globalThis);
