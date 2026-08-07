(function registerSuiteMateV3Settings(globalScope) {
  "use strict";

  const utilityApi = globalScope.SuiteMateV3Utilities;
  if (!utilityApi) {
    return;
  }
  const STORAGE_KEY = "suiteMateV3Style";
  const SCHEMA_VERSION = 9;
  const LEGACY_SCHEMA_VERSION = 0;
  const MAX_SYNC_ITEM_BYTES = 7800;
  const INVALID_VERSION_CODE = "INVALID_SETTINGS_VERSION";
  const UNSUPPORTED_VERSION_CODE = "UNSUPPORTED_SETTINGS_VERSION";
  const QUOTA_CODE = "SETTINGS_QUOTA_EXCEEDED";
  const ROLE_CONTEXT_MESSAGE = "SUITEMATE_V3_GET_ROLE_CONTEXT";
  const THEME_PREVIEW_MESSAGE = "SUITEMATE_V3_PREVIEW_ROLE_THEME";
  const MODES = Object.freeze(["light", "dark", "system"]);
  // THE font registry: id → { family (doubles as the UI label), files
  // (weight-or-range → woff2 under src/styles/fonts/) }; null is the system
  // default. Adding or removing a font is one entry here plus its woff2 —
  // fontFaceCss derives the @font-face rules and verify.mjs holds the files
  // in step. Ids are storage values; never rename one without a migration.
  // Faces are INJECTED as a document-level style, never declared in the
  // manifest-injected sheets: relative url() there resolves against the
  // page, and CSS cannot ask chrome.runtime for the extension origin —
  // measured live as NetSuite 404s decoding as fonts.
  const FONTS = Object.freeze({
    "default": null,
    "poppins": Object.freeze({ family: "Poppins", files: Object.freeze({ "400": "poppins-400.woff2", "500": "poppins-500.woff2", "600": "poppins-600.woff2", "700": "poppins-700.woff2" }) }),
    "plus-jakarta-sans": Object.freeze({ family: "Plus Jakarta Sans", files: Object.freeze({ "200 800": "plus-jakarta-sans.woff2" }) }),
    "outfit": Object.freeze({ family: "Outfit", files: Object.freeze({ "100 900": "outfit.woff2" }) }),
    "montserrat": Object.freeze({ family: "Montserrat", files: Object.freeze({ "100 900": "montserrat.woff2" }) }),
    "urbanist": Object.freeze({ family: "Urbanist", files: Object.freeze({ "100 900": "urbanist.woff2" }) }),
    "nunito": Object.freeze({ family: "Nunito", files: Object.freeze({ "200 1000": "nunito.woff2" }) }),
    "figtree": Object.freeze({ family: "Figtree", files: Object.freeze({ "300 900": "figtree.woff2" }) }),
    "manrope": Object.freeze({ family: "Manrope", files: Object.freeze({ "200 800": "manrope.woff2" }) }),
    "satoshi": Object.freeze({ family: "Satoshi", files: Object.freeze({ "300 900": "satoshi.woff2" }) }),
    "quicksand": Object.freeze({ family: "Quicksand", files: Object.freeze({ "300 700": "quicksand.woff2" }) })
  });

  function fontStack(fontId) {
    const font = Object.prototype.hasOwnProperty.call(FONTS, fontId) ? FONTS[fontId] : null;
    // The V1 stack stays as the tail so glyphs outside the packaged latin
    // subset keep rendering through the existing chain.
    return font ? `"${font.family}", "Oracle Sans", "Open Sans", Helvetica, sans-serif` : null;
  }

  function fontFaceCss(resolveFontUrl) {
    // Every registered face at once: the browser only fetches a face whose
    // family rendered text actually uses, so declaring the full set is free
    // and the selected font needs no follow-up injection to swap in.
    const rules = [];
    for (const font of Object.values(FONTS)) {
      if (!font) {
        continue;
      }
      for (const [weight, file] of Object.entries(font.files)) {
        rules.push(
          `@font-face{font-family:"${font.family}";font-style:normal;font-weight:${weight};font-display:swap;src:url("${resolveFontUrl(file)}") format("woff2")}`
        );
      }
    }
    return rules.join("\n");
  }
  const DEFAULT_ROLE_COLORS = Object.freeze({
    main: "#6269e7",
    secondary: "#a2a4a8"
  });
  const THEME_VARIABLE_NAMES = Object.freeze([
    "--custom-theme-main",
    "--custom-theme-main-light",
    "--custom-theme-secondary",
    "--custom-theme-secondary-light",
    "--custom-theme-secondary-light-light"
  ]);
  const DEFAULTS = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    enabled: true,
    mode: "light",
    // Poppins ships as the out-of-box look (owner-directed); "default" stays
    // a selectable id meaning the system stack, and an explicitly stored
    // choice — including "default" — is always preserved as stored.
    font: "poppins",
    squareCorners: false,
    showInternalIds: false,
    salesOrderColumns: false,
    smartTabTitles: false,
    formViews: false,
    salesOrderColumnsEdit: false,
    recentRecords: false,
    searchCentre: false,
    roleThemes: Object.freeze({})
  });

  function isPlainObject(value) {
    return Boolean(
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.prototype.toString.call(value) === "[object Object]"
    );
  }

  function settingsVersionError(code, message, storedVersion) {
    const error = new Error(message);
    error.name = "SuiteMateSettingsVersionError";
    error.code = code;
    error.storedVersion = storedVersion;
    error.supportedVersion = SCHEMA_VERSION;
    return error;
  }

  function readSchemaVersion(value) {
    if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, "schemaVersion")) {
      return LEGACY_SCHEMA_VERSION;
    }

    const version = value.schemaVersion;
    if (!Number.isSafeInteger(version) || version < LEGACY_SCHEMA_VERSION) {
      throw settingsVersionError(
        INVALID_VERSION_CODE,
        "SuiteMate settings contain an invalid schema version.",
        version
      );
    }
    if (version > SCHEMA_VERSION) {
      throw settingsVersionError(
        UNSUPPORTED_VERSION_CODE,
        `SuiteMate settings require schema version ${version}, but this release supports version ${SCHEMA_VERSION}.`,
        version
      );
    }
    return version;
  }

  function assertStoredVersionIsWritable(value) {
    if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, "schemaVersion")) {
      return;
    }
    const version = value.schemaVersion;
    if (Number.isSafeInteger(version) && version > SCHEMA_VERSION) {
      throw settingsVersionError(
        UNSUPPORTED_VERSION_CODE,
        `SuiteMate settings require schema version ${version}, so this older release cannot overwrite them.`,
        version
      );
    }
  }

  const { normalizeHexColor, utf8ByteLength } = utilityApi;

  function normalizeRoleThemes(value) {
    const candidate = isPlainObject(value) ? value : {};
    const roleThemes = {};

    for (const [roleId, theme] of Object.entries(candidate)) {
      if (!roleId || ["__proto__", "constructor", "prototype"].includes(roleId)) {
        continue;
      }

      const main = normalizeHexColor(theme?.main);
      const secondary = normalizeHexColor(theme?.secondary);
      if (!main && !secondary) {
        continue;
      }

      roleThemes[roleId] = {
        name: typeof theme.name === "string" && theme.name.trim() ? theme.name.trim().slice(0, 200) : roleId,
        ...(main ? { main } : {}),
        ...(secondary ? { secondary } : {})
      };
    }

    return roleThemes;
  }

  function normalizeCurrent(value) {
    const candidate = isPlainObject(value) ? value : {};
    return {
      schemaVersion: SCHEMA_VERSION,
      enabled: candidate.enabled !== false,
      mode: MODES.includes(candidate.mode) ? candidate.mode : DEFAULTS.mode,
      font: Object.prototype.hasOwnProperty.call(FONTS, candidate.font) ? candidate.font : DEFAULTS.font,
      squareCorners: candidate.squareCorners === true,
      showInternalIds: candidate.showInternalIds === true,
      salesOrderColumns: candidate.salesOrderColumns === true,
      smartTabTitles: candidate.smartTabTitles === true,
      formViews: candidate.formViews === true,
      salesOrderColumnsEdit: candidate.salesOrderColumnsEdit === true,
      recentRecords: candidate.recentRecords === true,
      searchCentre: candidate.searchCentre === true,
      roleThemes: normalizeRoleThemes(candidate.roleThemes)
    };
  }

  function normalize(value) {
    // Every historical migration only stamped schemaVersion and coerced fields
    // normalizeCurrent re-derives anyway; validating the version is all that's left.
    readSchemaVersion(value);
    return normalizeCurrent(isPlainObject(value) ? value : {});
  }

  function assertWithinStorageLimit(settings) {
    const bytes = utf8ByteLength(`${STORAGE_KEY}${JSON.stringify(settings)}`);
    if (bytes > MAX_SYNC_ITEM_BYTES) {
      const error = new Error(
        `SuiteMate settings use ${bytes} bytes and exceed the safe Chrome sync limit of ${MAX_SYNC_ITEM_BYTES} bytes.`
      );
      error.name = "SuiteMateSettingsQuotaError";
      error.code = QUOTA_CODE;
      error.bytes = bytes;
      error.maximumBytes = MAX_SYNC_ITEM_BYTES;
      throw error;
    }
  }

  function validateForStorage(value) {
    const normalized = normalize(value);
    assertWithinStorageLimit(normalized);
    return normalized;
  }

  function getRoleTheme(value, roleId) {
    const settings = normalize(value);
    const custom = roleId ? settings.roleThemes[roleId] : null;
    const mainCustomized = Boolean(custom?.main);
    const secondaryCustomized = Boolean(custom?.secondary);

    return {
      main: custom?.main ?? DEFAULT_ROLE_COLORS.main,
      secondary: custom?.secondary ?? DEFAULT_ROLE_COLORS.secondary,
      mainCustomized,
      secondaryCustomized,
      customized: mainCustomized || secondaryCustomized,
      name: custom?.name ?? ""
    };
  }

  function withRoleTheme(value, roleContext, colors) {
    const settings = normalize(value);
    const roleId = typeof roleContext?.id === "string" ? roleContext.id.trim() : "";
    if (!roleId) {
      return settings;
    }

    const name = typeof roleContext.name === "string" && roleContext.name.trim()
      ? roleContext.name.trim().slice(0, 200)
      : roleId;
    const existing = settings.roleThemes[roleId] ?? {};
    const nextTheme = { ...existing, name };

    for (const colorName of ["main", "secondary"]) {
      if (!Object.prototype.hasOwnProperty.call(colors ?? {}, colorName)) {
        continue;
      }

      const color = normalizeHexColor(colors[colorName]);
      if (color && color !== DEFAULT_ROLE_COLORS[colorName]) {
        nextTheme[colorName] = color;
      } else {
        delete nextTheme[colorName];
      }
    }

    if (!nextTheme.main && !nextTheme.secondary) {
      return withoutRoleTheme(settings, roleId);
    }

    return {
      ...settings,
      roleThemes: {
        ...settings.roleThemes,
        [roleId]: nextTheme
      }
    };
  }

  function withoutRoleTheme(value, roleId) {
    const settings = normalize(value);
    if (!roleId || !settings.roleThemes[roleId]) {
      return settings;
    }

    const roleThemes = { ...settings.roleThemes };
    delete roleThemes[roleId];
    return { ...settings, roleThemes };
  }

  function swapRoleTheme(value, roleContext) {
    const settings = normalize(value);
    const roleId = typeof roleContext?.id === "string" ? roleContext.id.trim() : "";
    const current = roleId ? settings.roleThemes[roleId] : null;
    if (!current) {
      return settings;
    }

    return withRoleTheme(settings, roleContext, {
      main: current.secondary ?? DEFAULT_ROLE_COLORS.main,
      secondary: current.main ?? DEFAULT_ROLE_COLORS.secondary
    });
  }

  function mixColor(value, amount) {
    const color = normalizeHexColor(value);
    if (!color) {
      return "";
    }

    const number = Number.parseInt(color.slice(1), 16);
    const target = amount < 0 ? 0 : 255;
    const ratio = Math.abs(amount);
    const channels = [number >> 16, (number >> 8) & 255, number & 255];
    const mixed = channels.map((channel) => Math.round((target - channel) * ratio) + channel);

    return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }

  function lightDark(light, dark) {
    return `light-dark(${light}, ${dark})`;
  }

  function deriveThemeVariables(colors) {
    const main = normalizeHexColor(colors?.main) ?? DEFAULT_ROLE_COLORS.main;
    const secondary = normalizeHexColor(colors?.secondary) ?? DEFAULT_ROLE_COLORS.secondary;
    const variables = {};

    if (colors?.mainCustomized !== false) {
      variables["--custom-theme-main"] = lightDark(main, mixColor(main, -0.1));
      variables["--custom-theme-main-light"] = lightDark(mixColor(main, 0.3), mixColor(main, 0.2));
    }

    if (colors?.secondaryCustomized !== false) {
      variables["--custom-theme-secondary"] = lightDark(secondary, mixColor(secondary, -0.2));
      variables["--custom-theme-secondary-light"] = lightDark(
        mixColor(secondary, 0.3),
        mixColor(secondary, 0.1)
      );
      variables["--custom-theme-secondary-light-light"] = lightDark(
        mixColor(secondary, 0.6),
        mixColor(secondary, 0.4)
      );
    }

    return variables;
  }

  async function get() {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    return normalize(result[STORAGE_KEY]);
  }

  async function set(value) {
    const normalized = validateForStorage(value);
    const stored = await chrome.storage.sync.get(STORAGE_KEY);
    assertStoredVersionIsWritable(stored[STORAGE_KEY]);
    await chrome.storage.sync.set({ [STORAGE_KEY]: normalized });
    return normalized;
  }

  async function ensureCurrentSchema() {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    const raw = result[STORAGE_KEY];
    const normalized = normalize(raw);
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      assertWithinStorageLimit(normalized);
      await chrome.storage.sync.set({ [STORAGE_KEY]: normalized });
    }
    return normalized;
  }

  function isSettingsVersionError(error) {
    return error?.code === INVALID_VERSION_CODE || error?.code === UNSUPPORTED_VERSION_CODE;
  }

  globalScope.SuiteMateV3Settings = Object.freeze({
    STORAGE_KEY,
    SCHEMA_VERSION,
    INVALID_VERSION_CODE,
    UNSUPPORTED_VERSION_CODE,
    QUOTA_CODE,
    ROLE_CONTEXT_MESSAGE,
    THEME_PREVIEW_MESSAGE,
    DEFAULTS,
    FONTS,
    fontStack,
    fontFaceCss,
    THEME_VARIABLE_NAMES,
    normalizeHexColor,
    normalize,
    isSettingsVersionError,
    getRoleTheme,
    withRoleTheme,
    withoutRoleTheme,
    swapRoleTheme,
    deriveThemeVariables,
    validateForStorage,
    get,
    set,
    ensureCurrentSchema
  });
})(globalThis);
