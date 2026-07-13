(function registerSuiteMateV3Settings(globalScope) {
  "use strict";

  const STORAGE_KEY = "suiteMateV3Style";
  const ROLE_CONTEXT_MESSAGE = "SUITEMATE_V3_GET_ROLE_CONTEXT";
  const THEME_PREVIEW_MESSAGE = "SUITEMATE_V3_PREVIEW_ROLE_THEME";
  const MODES = Object.freeze(["light", "dark", "system"]);
  const DEFAULT_ROLE_COLORS = Object.freeze({
    main: "#607799",
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
    enabled: true,
    mode: "light",
    squareCorners: false,
    roleThemes: Object.freeze({})
  });

  function normalizeHexColor(value) {
    if (typeof value !== "string") {
      return null;
    }

    const compact = value.trim().replace(/^#/, "");
    const expanded = /^[0-9a-f]{3}$/i.test(compact)
      ? compact.replace(/(.)/g, "$1$1")
      : compact;

    return /^[0-9a-f]{6}$/i.test(expanded) ? `#${expanded.toLowerCase()}` : null;
  }

  function normalizeRoleThemes(value) {
    const candidate = value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

  function normalize(value) {
    const candidate = value && typeof value === "object" ? value : {};

    return {
      enabled: candidate.enabled !== false,
      mode: MODES.includes(candidate.mode) ? candidate.mode : DEFAULTS.mode,
      squareCorners: candidate.squareCorners === true,
      roleThemes: normalizeRoleThemes(candidate.roleThemes)
    };
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
    const normalized = normalize(value);
    await chrome.storage.sync.set({ [STORAGE_KEY]: normalized });
    return normalized;
  }

  globalScope.SuiteMateV3Settings = Object.freeze({
    STORAGE_KEY,
    ROLE_CONTEXT_MESSAGE,
    THEME_PREVIEW_MESSAGE,
    DEFAULTS,
    DEFAULT_ROLE_COLORS,
    THEME_VARIABLE_NAMES,
    MODES,
    normalizeHexColor,
    normalize,
    getRoleTheme,
    withRoleTheme,
    withoutRoleTheme,
    swapRoleTheme,
    deriveThemeVariables,
    get,
    set
  });
})(globalThis);
