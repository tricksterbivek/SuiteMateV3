(function defineSuiteMateV3Commands(globalScope) {
  "use strict";

  const VERSION = 1;
  const utilityApi = globalScope.SuiteMateV3Utilities;
  const routeApi = globalScope.SuiteMateV3Routes;
  if (!utilityApi) {
    return;
  }
  const { deepFreeze } = utilityApi;

  const SURFACES = Object.freeze({
    POPUP: "popup",
    RECORD: "record",
    SUITEQL: "suiteql"
  });

  const SOURCES = Object.freeze({
    BUTTON: "button",
    SHORTCUT: "shortcut",
    LINK: "link",
    PROGRAMMATIC: "programmatic"
  });

  const PLATFORMS = Object.freeze({
    MAC: "mac",
    WINDOWS: "windows",
    LINUX: "linux",
    UNKNOWN: "unknown"
  });

  const IDS = Object.freeze({
    POPUP_OPEN_SUITEQL: "popup.open-suiteql",
    SETTINGS_APPLY_APPEARANCE: "settings.apply-appearance",
    SETTINGS_RESET_ALL: "settings.reset-all",
    THEME_OPEN_MAIN_PICKER: "theme.open-main-picker",
    THEME_OPEN_SECONDARY_PICKER: "theme.open-secondary-picker",
    THEME_SELECT_MATERIAL_SHADE: "theme.select-material-shade",
    THEME_APPLY_AND_CLOSE_PICKER: "theme.apply-and-close-picker",
    THEME_SWAP_COLORS: "theme.swap-colors",
    THEME_RESET_ROLE_COLORS: "theme.reset-role-colors",
    RECORD_CSV_IMPORT: "record.csv-import",
    SUITEQL_EXECUTE: "suiteql.execute",
    SUITEQL_ABORT: "suiteql.abort",
    SUITEQL_TOGGLE_PAGED: "suiteql.toggle-paged",
    SUITEQL_EXPORT_LOADED: "suiteql.export-loaded",
    SUITEQL_CLEAR_RESULTS: "suiteql.clear-results",
    SUITEQL_LOAD_NEXT_PAGE: "suiteql.load-next-page",
    SUITEQL_PREVIOUS_PAGE: "suiteql.previous-page",
    SUITEQL_NEXT_PAGE: "suiteql.next-page",
    SUITEQL_SORT_RESULTS: "suiteql.sort-results",
    SUITEQL_INSPECT_TABLE: "suiteql.inspect-table",
    SUITEQL_OPEN_RECORDS_CATALOG: "suiteql.open-records-catalog",
    SUITEQL_OPEN_SUITESENSE: "suiteql.open-suitesense"
  });

  const COMMAND_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
  const MODIFIER_ORDER = Object.freeze(["Mod", "Control", "Meta", "Alt", "Shift"]);
  const MODIFIER_ALIASES = Object.freeze({
    mod: "Mod",
    primary: "Mod",
    ctrl: "Control",
    control: "Control",
    cmd: "Meta",
    command: "Meta",
    meta: "Meta",
    option: "Alt",
    alt: "Alt",
    shift: "Shift"
  });
  const NAMED_KEYS = Object.freeze({
    esc: "Escape",
    escape: "Escape",
    enter: "Enter",
    return: "Enter",
    tab: "Tab",
    space: "Space",
    spacebar: "Space",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    arrowup: "ArrowUp",
    arrowdown: "ArrowDown",
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
    backspace: "Backspace",
    delete: "Delete",
    insert: "Insert"
  });
  const ALLOWED_DEFINITION_KEYS = new Set([
    "id",
    "label",
    "description",
    "surface",
    "capability",
    "shortcut",
    "allowInEditable",
    "allowRepeat",
    "consumeWhenUnavailable",
    "requiresSettingsEnabled",
    "link"
  ]);

  function commandError(code, message, commandId = "") {
    const error = new Error(message);
    error.name = "SuiteMateCommandError";
    error.code = code;
    error.commandId = commandId;
    return error;
  }

  function normalizeKey(value) {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return "";
    }
    const lower = raw.toLowerCase();
    if (NAMED_KEYS[lower]) {
      return NAMED_KEYS[lower];
    }
    if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(raw)) {
      return raw.toUpperCase();
    }
    return [...raw].length === 1 ? raw.toUpperCase() : "";
  }

  function normalizeShortcut(value) {
    if (
      typeof value !== "string"
      || !value.trim()
      || /\s/.test(value.trim())
      || /[+-]{2}/.test(value.trim())
    ) {
      throw commandError("INVALID_COMMAND_SHORTCUT", "Command shortcuts must contain one key combination.");
    }

    const tokens = value.trim().split(/[+-]/).filter(Boolean);
    const modifiers = new Set();
    let key = "";

    for (const token of tokens) {
      const modifier = MODIFIER_ALIASES[token.toLowerCase()];
      if (modifier) {
        if (modifiers.has(modifier)) {
          throw commandError("INVALID_COMMAND_SHORTCUT", `Shortcut modifier ${modifier} is duplicated.`);
        }
        modifiers.add(modifier);
        continue;
      }

      const normalizedKey = normalizeKey(token);
      if (!normalizedKey || key) {
        throw commandError("INVALID_COMMAND_SHORTCUT", "Command shortcuts must contain exactly one supported key.");
      }
      key = normalizedKey;
    }

    if (!key) {
      throw commandError("INVALID_COMMAND_SHORTCUT", "Command shortcuts cannot contain only modifiers.");
    }

    const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
    return deepFreeze({
      modifiers: orderedModifiers,
      key,
      canonical: [...orderedModifiers, key].join("+")
    });
  }

  function detectPlatform(value = globalScope.navigator) {
    const raw = [
      value?.userAgentData?.platform,
      value?.platform,
      value?.userAgent,
      typeof value === "string" ? value : ""
    ].filter(Boolean).join(" ").toLowerCase();

    if (/(?:mac|iphone|ipad|ipod)/.test(raw)) {
      return PLATFORMS.MAC;
    }
    if (/win/.test(raw)) {
      return PLATFORMS.WINDOWS;
    }
    if (/(?:linux|cros|android)/.test(raw)) {
      return PLATFORMS.LINUX;
    }
    return PLATFORMS.UNKNOWN;
  }

  function normalizePlatform(value) {
    return Object.values(PLATFORMS).includes(value) ? value : detectPlatform(value);
  }

  function resolveShortcut(value, platform = detectPlatform()) {
    const shortcut = typeof value === "string" ? normalizeShortcut(value) : value;
    const normalizedPlatform = normalizePlatform(platform);
    const modifiers = new Set(shortcut.modifiers);
    if (modifiers.delete("Mod")) {
      modifiers.add(normalizedPlatform === PLATFORMS.MAC ? "Meta" : "Control");
    }
    return deepFreeze({
      modifiers: ["Control", "Meta", "Alt", "Shift"].filter((modifier) => modifiers.has(modifier)),
      key: shortcut.key,
      platform: normalizedPlatform
    });
  }

  function shortcutSignature(value, platform) {
    const resolved = resolveShortcut(value, platform);
    return [...resolved.modifiers, resolved.key].join("+");
  }

  function toEditorShortcut(value) {
    const shortcut = typeof value === "string" ? normalizeShortcut(value) : value;
    const key = shortcut.key.length === 1 ? shortcut.key.toLowerCase() : shortcut.key;
    return [...shortcut.modifiers, key].join("-");
  }

  function toAriaShortcut(value, platform = PLATFORMS.UNKNOWN) {
    const shortcut = typeof value === "string" ? normalizeShortcut(value) : value;
    if (platform === PLATFORMS.UNKNOWN && shortcut.modifiers.includes("Mod")) {
      const withoutMod = shortcut.modifiers.filter((modifier) => modifier !== "Mod");
      const suffix = [...withoutMod, shortcut.key].join("+");
      return [`Control+${suffix}`, `Meta+${suffix}`].join(" ");
    }
    const resolved = resolveShortcut(shortcut, platform);
    return [...resolved.modifiers, resolved.key].join("+");
  }

  function formatShortcut(value, platform = PLATFORMS.UNKNOWN) {
    const shortcut = typeof value === "string" ? normalizeShortcut(value) : value;
    const normalizedPlatform = normalizePlatform(platform);
    const labels = [];

    for (const modifier of shortcut.modifiers) {
      if (modifier === "Mod") {
        labels.push(
          platform === PLATFORMS.UNKNOWN
            ? "Ctrl or Command"
            : normalizedPlatform === PLATFORMS.MAC
              ? "Command"
              : "Ctrl"
        );
      } else if (modifier === "Control") {
        labels.push("Ctrl");
      } else if (modifier === "Meta") {
        labels.push(normalizedPlatform === PLATFORMS.MAC ? "Command" : "Meta");
      } else {
        labels.push(modifier);
      }
    }
    labels.push(shortcut.key === "Space" ? "Space" : shortcut.key);
    return labels.join(" + ");
  }

  const RAW_DEFINITIONS = [
    {
      id: IDS.POPUP_OPEN_SUITEQL,
      label: "Open SuiteQL Console",
      description: "Open SuiteQL Console in the active NetSuite tab",
      surface: SURFACES.POPUP,
      capability: routeApi?.CAPABILITIES?.SUITEQL_LAUNCH ?? "suiteql-launch"
    },
    {
      id: IDS.SETTINGS_APPLY_APPEARANCE,
      label: "Apply appearance",
      description: "Apply the selected SuiteMate appearance settings",
      surface: SURFACES.POPUP
    },
    {
      id: IDS.SETTINGS_RESET_ALL,
      label: "Reset all",
      description: "Restore all SuiteMate styling settings",
      surface: SURFACES.POPUP
    },
    {
      id: IDS.THEME_OPEN_MAIN_PICKER,
      label: "Choose Main color",
      description: "Open the Main color picker",
      surface: SURFACES.POPUP,
      requiresSettingsEnabled: true
    },
    {
      id: IDS.THEME_OPEN_SECONDARY_PICKER,
      label: "Choose Secondary color",
      description: "Open the Secondary color picker",
      surface: SURFACES.POPUP,
      requiresSettingsEnabled: true
    },
    {
      id: IDS.THEME_SELECT_MATERIAL_SHADE,
      label: "Select Material shade",
      description: "Apply the selected Material shade",
      surface: SURFACES.POPUP,
      requiresSettingsEnabled: true
    },
    {
      id: IDS.THEME_APPLY_AND_CLOSE_PICKER,
      label: "Apply color",
      description: "Apply the current color and close the picker",
      surface: SURFACES.POPUP,
      shortcut: "Escape",
      allowInEditable: true,
      requiresSettingsEnabled: true
    },
    {
      id: IDS.THEME_SWAP_COLORS,
      label: "Swap colors",
      description: "Swap the current role's Main and Secondary colors",
      surface: SURFACES.POPUP,
      requiresSettingsEnabled: true
    },
    {
      id: IDS.THEME_RESET_ROLE_COLORS,
      label: "Default colors",
      description: "Restore the current role's default colors",
      surface: SURFACES.POPUP,
      requiresSettingsEnabled: true
    },
    {
      id: IDS.RECORD_CSV_IMPORT,
      label: "CSV Import",
      description: "Import this type of record into NetSuite",
      surface: SURFACES.RECORD,
      capability: routeApi?.CAPABILITIES?.CSV_IMPORT_TOOLBAR ?? "csv-import-toolbar",
      requiresSettingsEnabled: true,
      link: {}
    },
    {
      id: IDS.SUITEQL_EXECUTE,
      label: "Execute",
      description: "Execute query",
      surface: SURFACES.SUITEQL,
      capability: routeApi?.CAPABILITIES?.SUITEQL_CONSOLE ?? "suiteql-console",
      shortcut: "Mod+E",
      allowInEditable: true,
      consumeWhenUnavailable: true
    },
    {
      id: IDS.SUITEQL_ABORT,
      label: "Abort",
      description: "Stop waiting for the active query",
      surface: SURFACES.SUITEQL,
      capability: routeApi?.CAPABILITIES?.SUITEQL_CONSOLE ?? "suiteql-console",
      shortcut: "Escape",
      allowInEditable: true
    },
    {
      id: IDS.SUITEQL_TOGGLE_PAGED,
      label: "Paged",
      description: "Toggle progressive paging",
      surface: SURFACES.SUITEQL,
      capability: routeApi?.CAPABILITIES?.SUITEQL_CONSOLE ?? "suiteql-console",
      shortcut: "Mod+Shift+P",
      allowInEditable: true,
      consumeWhenUnavailable: true
    },
    {
      id: IDS.SUITEQL_EXPORT_LOADED,
      label: "Export CSV",
      description: "Export loaded rows as CSV",
      surface: SURFACES.SUITEQL,
      capability: routeApi?.CAPABILITIES?.SUITEQL_CONSOLE ?? "suiteql-console",
      shortcut: "Mod+Shift+E",
      allowInEditable: true,
      consumeWhenUnavailable: true
    },
    {
      id: IDS.SUITEQL_CLEAR_RESULTS,
      label: "Clear Results",
      description: "Clear results",
      surface: SURFACES.SUITEQL,
      capability: routeApi?.CAPABILITIES?.SUITEQL_CONSOLE ?? "suiteql-console",
      shortcut: "Mod+Shift+L",
      allowInEditable: true,
      consumeWhenUnavailable: true
    },
    {
      id: IDS.SUITEQL_LOAD_NEXT_PAGE,
      label: "Load next 1,000",
      description: "Load the next NetSuite result page",
      surface: SURFACES.SUITEQL,
      capability: routeApi?.CAPABILITIES?.SUITEQL_CONSOLE ?? "suiteql-console"
    },
    {
      id: IDS.SUITEQL_PREVIOUS_PAGE,
      label: "Previous 250",
      description: "Show the previous loaded result page",
      surface: SURFACES.SUITEQL,
      capability: routeApi?.CAPABILITIES?.SUITEQL_CONSOLE ?? "suiteql-console"
    },
    {
      id: IDS.SUITEQL_NEXT_PAGE,
      label: "Next 250",
      description: "Show the next loaded result page",
      surface: SURFACES.SUITEQL,
      capability: routeApi?.CAPABILITIES?.SUITEQL_CONSOLE ?? "suiteql-console"
    },
    {
      id: IDS.SUITEQL_SORT_RESULTS,
      label: "Sort results",
      description: "Sort loaded results by column",
      surface: SURFACES.SUITEQL,
      capability: routeApi?.CAPABILITIES?.SUITEQL_CONSOLE ?? "suiteql-console"
    },
    {
      id: IDS.SUITEQL_INSPECT_TABLE,
      label: "Inspect Table",
      description: "Open a table in Records Catalog",
      surface: SURFACES.SUITEQL,
      capability: routeApi?.CAPABILITIES?.SUITEQL_CONSOLE ?? "suiteql-console"
    },
    {
      id: IDS.SUITEQL_OPEN_RECORDS_CATALOG,
      label: "Records Catalog",
      description: "Open NetSuite Records Catalog",
      surface: SURFACES.SUITEQL,
      capability: routeApi?.CAPABILITIES?.SUITEQL_CONSOLE ?? "suiteql-console",
      link: { target: "_blank", rel: "noopener" }
    },
    {
      id: IDS.SUITEQL_OPEN_SUITESENSE,
      label: "Generate with SuiteSense",
      description: "Generate SuiteQL from plain English with SuiteSense",
      surface: SURFACES.SUITEQL,
      capability: routeApi?.CAPABILITIES?.SUITEQL_CONSOLE ?? "suiteql-console",
      link: { target: "_blank", rel: "noopener noreferrer" }
    }
  ];

  function prepareDefinitions(values) {
    const definitions = {};
    const shortcutSignatures = new Set();

    for (const raw of values) {
      for (const key of Object.keys(raw)) {
        if (!ALLOWED_DEFINITION_KEYS.has(key)) {
          throw commandError("INVALID_COMMAND_DEFINITION", `Unknown command definition field ${key}.`, raw.id);
        }
      }
      if (!COMMAND_ID_PATTERN.test(raw.id) || definitions[raw.id]) {
        throw commandError("INVALID_COMMAND_ID", `Command ID ${raw.id || "(empty)"} is invalid or duplicated.`, raw.id);
      }
      if (!Object.values(SURFACES).includes(raw.surface)) {
        throw commandError("INVALID_COMMAND_SURFACE", `Command ${raw.id} has an invalid surface.`, raw.id);
      }
      if (!raw.label?.trim() || !raw.description?.trim()) {
        throw commandError("INVALID_COMMAND_DEFINITION", `Command ${raw.id} requires a label and description.`, raw.id);
      }

      const definition = {
        ...raw,
        label: raw.label.trim(),
        description: raw.description.trim(),
        shortcut: raw.shortcut ? normalizeShortcut(raw.shortcut) : null,
        allowInEditable: raw.allowInEditable === true,
        allowRepeat: raw.allowRepeat === true,
        consumeWhenUnavailable: raw.consumeWhenUnavailable === true,
        requiresSettingsEnabled: raw.requiresSettingsEnabled === true,
        link: raw.link ? { ...raw.link } : null
      };

      if (definition.shortcut) {
        for (const platform of [PLATFORMS.MAC, PLATFORMS.WINDOWS, PLATFORMS.LINUX]) {
          const signature = `${definition.surface}:${platform}:${shortcutSignature(definition.shortcut, platform)}`;
          if (shortcutSignatures.has(signature)) {
            throw commandError(
              "DUPLICATE_COMMAND_SHORTCUT",
              `Command ${definition.id} conflicts with another ${definition.surface} shortcut.`,
              definition.id
            );
          }
          shortcutSignatures.add(signature);
        }
      }

      definitions[definition.id] = deepFreeze(definition);
    }
    return deepFreeze(definitions);
  }

  const DEFINITIONS = prepareDefinitions(RAW_DEFINITIONS);

  function get(id) {
    return DEFINITIONS[id] ?? null;
  }

  function getShortcut(id, platform = PLATFORMS.UNKNOWN) {
    const definition = get(id);
    if (!definition?.shortcut) {
      return null;
    }
    return deepFreeze({
      canonical: definition.shortcut.canonical,
      editor: toEditorShortcut(definition.shortcut),
      aria: toAriaShortcut(definition.shortcut, platform),
      display: formatShortcut(definition.shortcut, platform),
      resolved: resolveShortcut(definition.shortcut, platform)
    });
  }

  function isSupported(id, context = {}) {
    const definition = get(id);
    if (!definition) {
      return false;
    }
    if (definition.requiresSettingsEnabled && context.settings?.enabled !== true) {
      return false;
    }
    if (!definition.capability) {
      return true;
    }
    const pageContext = context.pageContext ?? context;
    return routeApi?.supports?.(definition.capability, pageContext) === true;
  }

  function normalizeEventKey(value) {
    if (value === " ") {
      return "Space";
    }
    return normalizeKey(value);
  }

  function isEditableNode(node) {
    if (!node || typeof node !== "object") {
      return false;
    }
    const tagName = String(node.tagName ?? "").toLowerCase();
    if (["input", "textarea", "select"].includes(tagName) || node.isContentEditable === true) {
      return true;
    }
    const contentEditable = node.getAttribute?.("contenteditable");
    if (contentEditable !== null && contentEditable !== undefined && contentEditable !== "false") {
      return true;
    }
    if (node.getAttribute?.("role") === "textbox") {
      return true;
    }
    return node.matches?.(".cm-content") === true;
  }

  function eventHasEditableTarget(event) {
    const path = typeof event?.composedPath === "function"
      ? event.composedPath()
      : [event?.target];
    for (const node of path) {
      if (isEditableNode(node)) {
        return true;
      }
      const editableParent = node?.closest?.(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .cm-content'
      );
      if (editableParent) {
        return true;
      }
    }
    return false;
  }

  function matchesShortcutValue(event, shortcut, options = {}) {
    const normalizedShortcut = typeof shortcut === "string"
      ? normalizeShortcut(shortcut)
      : shortcut;
    if (!normalizedShortcut || event?.defaultPrevented || event?.isComposing) {
      return false;
    }
    if (event.repeat && options.allowRepeat !== true) {
      return false;
    }
    if (event.getModifierState?.("AltGraph")) {
      return false;
    }
    if (options.allowInEditable !== true && eventHasEditableTarget(event)) {
      return false;
    }

    const resolved = resolveShortcut(normalizedShortcut, options.platform ?? detectPlatform());
    const expected = new Set(resolved.modifiers);
    const modifiers = {
      Control: event.ctrlKey === true,
      Meta: event.metaKey === true,
      Alt: event.altKey === true,
      Shift: event.shiftKey === true
    };
    for (const [modifier, active] of Object.entries(modifiers)) {
      if (active !== expected.has(modifier)) {
        return false;
      }
    }
    return normalizeEventKey(event.key) === resolved.key;
  }

  function matchesShortcut(event, id, options = {}) {
    const definition = get(id);
    return Boolean(
      definition?.shortcut
      && matchesShortcutValue(event, definition.shortcut, {
        ...options,
        allowInEditable: definition.allowInEditable,
        allowRepeat: definition.allowRepeat
      })
    );
  }

  function applyMetadata(element, id, options = {}) {
    const definition = get(id);
    if (!definition || !element) {
      return false;
    }
    element.dataset.suitemateV3Command = id;
    if (options.setLabel === true) {
      element.textContent = definition.label;
    }
    const shortcut = getShortcut(id, options.platform ?? PLATFORMS.UNKNOWN);
    element.title = shortcut
      ? `${definition.description} (${shortcut.display})`
      : definition.description;
    if (shortcut) {
      element.setAttribute("aria-keyshortcuts", shortcut.aria);
    } else {
      element.removeAttribute?.("aria-keyshortcuts");
    }
    if (definition.link) {
      if (definition.link.target) {
        element.target = definition.link.target;
      }
      if (definition.link.rel) {
        element.rel = definition.link.rel;
      }
    }
    return true;
  }

  function createScope(surface, options = {}) {
    if (!Object.values(SURFACES).includes(surface)) {
      throw commandError("INVALID_COMMAND_SURFACE", `Unknown command surface ${surface}.`);
    }

    const registrations = new Map();
    const subscribers = new Set();
    let disposed = false;
    let shortcutBinding = null;

    function report(phase, id, error) {
      try {
        options.onError?.({ phase, commandId: id, error });
      } catch {}
    }

    function context() {
      try {
        return options.getContext?.() ?? {};
      } catch (error) {
        report("context", "", error);
        return null;
      }
    }

    function emit(id) {
      if (subscribers.size === 0) {
        return;
      }
      const state = getState(id);
      for (const subscriber of [...subscribers]) {
        try {
          subscriber(state);
        } catch (error) {
          report("subscriber", id, error);
        }
      }
    }

    function register(id, configuration) {
      const definition = get(id);
      if (!definition) {
        throw commandError("UNKNOWN_COMMAND", `Unknown command ${id}.`, id);
      }
      if (definition.surface !== surface) {
        throw commandError(
          "COMMAND_SURFACE_MISMATCH",
          `Command ${id} belongs to the ${definition.surface} surface.`,
          id
        );
      }
      if (disposed) {
        throw commandError("COMMAND_SCOPE_DISPOSED", "This command scope has been disposed.", id);
      }
      if (registrations.has(id)) {
        throw commandError("DUPLICATE_COMMAND_HANDLER", `Command ${id} is already registered.`, id);
      }
      if (typeof configuration?.run !== "function") {
        throw commandError("INVALID_COMMAND_HANDLER", `Command ${id} requires a run function.`, id);
      }

      const registration = {
        run: configuration.run,
        isAvailable: typeof configuration.isAvailable === "function"
          ? configuration.isAvailable
          : null,
        allowReentry: configuration.allowReentry === true,
        runningCount: 0
      };
      registrations.set(id, registration);
      emit(id);

      let active = true;
      return () => {
        if (!active || registrations.get(id) !== registration) {
          return false;
        }
        active = false;
        registrations.delete(id);
        emit(id);
        return true;
      };
    }

    function evaluateAvailabilityWithContext(
      id,
      payload,
      invocationContext,
      runtimeContext,
      expectedRegistration = null
    ) {
      const definition = get(id);
      const registration = registrations.get(id);
      if (
        disposed
        || !definition
        || definition.surface !== surface
        || !registration
        || (expectedRegistration && registration !== expectedRegistration)
        || !runtimeContext
        || !isSupported(id, runtimeContext)
        || (registration.runningCount > 0 && !registration.allowReentry)
      ) {
        return false;
      }
      try {
        const availability = registration.isAvailable
          ? registration.isAvailable({
            command: definition,
            payload,
            source: invocationContext.source ?? SOURCES.PROGRAMMATIC,
            context: runtimeContext
          })
          : true;
        if (availability && typeof availability.then === "function") {
          report(
            "availability",
            id,
            commandError(
              "ASYNC_COMMAND_AVAILABILITY",
              `Command ${id} availability must be synchronous.`,
              id
            )
          );
          void Promise.resolve(availability).catch((error) => {
            report("availability", id, error);
          });
          return false;
        }
        const available = availability !== false;
        return available && registrations.get(id) === registration;
      } catch (error) {
        report("availability", id, error);
        return false;
      }
    }

    function evaluateAvailability(id, payload, invocationContext = {}) {
      return evaluateAvailabilityWithContext(
        id,
        payload,
        invocationContext,
        context()
      );
    }

    function getState(id, payload) {
      const definition = get(id);
      const registration = registrations.get(id);
      return deepFreeze({
        commandId: id,
        known: Boolean(definition),
        registered: Boolean(registration),
        running: (registration?.runningCount ?? 0) > 0,
        available: evaluateAvailability(id, payload)
      });
    }

    function finish(registration, id) {
      if (registrations.get(id) === registration) {
        registration.runningCount = Math.max(0, registration.runningCount - 1);
        emit(id);
      }
    }

    function failedResult(id, code, message, error = null) {
      return deepFreeze({
        ok: false,
        commandId: id,
        error: {
          code,
          message: String(message),
          details: String(error?.details ?? "")
        }
      });
    }

    function successfulResult(id, value) {
      return Object.freeze({
        ok: true,
        commandId: id,
        value
      });
    }

    function invoke(id, payload, invocationContext = {}) {
      const definition = get(id);
      if (!definition) {
        return failedResult(id, "UNKNOWN_COMMAND", `Unknown command ${id}.`);
      }
      const runtimeContext = context();
      const registration = registrations.get(id);
      if (
        !registration
        || !evaluateAvailabilityWithContext(
          id,
          payload,
          invocationContext,
          runtimeContext,
          registration
        )
      ) {
        const code = registration?.runningCount > 0 ? "COMMAND_BUSY" : "COMMAND_UNAVAILABLE";
        return failedResult(id, code, `Command ${id} is not available.`);
      }

      registration.runningCount += 1;
      emit(id);
      if (disposed || registrations.get(id) !== registration) {
        return failedResult(
          id,
          "COMMAND_STALE",
          `Command ${id} was invalidated before execution.`
        );
      }
      let outcome;
      try {
        outcome = registration.run(Object.freeze({
          command: definition,
          payload,
          source: invocationContext.source ?? SOURCES.PROGRAMMATIC,
          context: runtimeContext
        }));
      } catch (error) {
        finish(registration, id);
        report("execute", id, error);
        return failedResult(id, "COMMAND_FAILED", error?.message || error || "Command failed.", error);
      }

      let isPromiseLike = false;
      try {
        isPromiseLike = Boolean(outcome && typeof outcome.then === "function");
      } catch (error) {
        finish(registration, id);
        report("execute", id, error);
        return failedResult(id, "COMMAND_FAILED", error?.message || error || "Command failed.", error);
      }

      if (isPromiseLike) {
        return Promise.resolve(outcome).then(
          (value) => {
            if (disposed || registrations.get(id) !== registration) {
              return failedResult(id, "COMMAND_STALE", `Command ${id} completed after its scope was disposed.`);
            }
            finish(registration, id);
            return successfulResult(id, value);
          },
          (error) => {
            if (disposed || registrations.get(id) !== registration) {
              return failedResult(id, "COMMAND_STALE", `Command ${id} failed after its scope was disposed.`);
            }
            finish(registration, id);
            report("execute", id, error);
            return failedResult(id, "COMMAND_FAILED", error?.message || error || "Command failed.", error);
          }
        );
      }

      if (disposed || registrations.get(id) !== registration) {
        return failedResult(id, "COMMAND_STALE", `Command ${id} completed after its scope was disposed.`);
      }
      finish(registration, id);
      return successfulResult(id, outcome);
    }

    function subscribe(callback) {
      if (typeof callback !== "function" || disposed) {
        return () => false;
      }
      subscribers.add(callback);
      let active = true;
      return () => {
        if (!active) {
          return false;
        }
        active = false;
        return subscribers.delete(callback);
      };
    }

    function bindShortcuts(target, ids, bindingOptions = {}) {
      if (disposed) {
        throw commandError(
          "COMMAND_SCOPE_DISPOSED",
          "This command scope has been disposed."
        );
      }
      if (!target?.addEventListener || !target?.removeEventListener) {
        throw commandError("INVALID_SHORTCUT_TARGET", "Shortcut target must support DOM events.");
      }
      const commandIds = [...new Set(ids)];
      for (const id of commandIds) {
        const definition = get(id);
        if (!definition?.shortcut || definition.surface !== surface) {
          throw commandError("INVALID_COMMAND_SHORTCUT", `Command ${id} has no ${surface} shortcut.`, id);
        }
      }

      const bindingPlatform = normalizePlatform(bindingOptions.platform ?? detectPlatform());
      const signature = [
        commandIds.join("|"),
        bindingPlatform,
        bindingOptions.stopPropagation === true ? "stop" : "bubble"
      ].join(":");
      if (
        shortcutBinding
        && shortcutBinding.target === target
        && shortcutBinding.signature === signature
      ) {
        return shortcutBinding.handle;
      }
      shortcutBinding?.handle.dispose();

      const listener = (event) => {
        for (const id of commandIds) {
          if (
            matchesShortcut(event, id, { platform: bindingPlatform })
            && evaluateAvailability(id, undefined, { source: SOURCES.SHORTCUT })
          ) {
            event.preventDefault?.();
            if (bindingOptions.stopPropagation === true) {
              event.stopPropagation?.();
            }
            void invoke(id, undefined, { source: SOURCES.SHORTCUT });
            return;
          }
        }
      };
      target.addEventListener("keydown", listener);

      let active = true;
      const handle = Object.freeze({
        dispose() {
          if (!active) {
            return false;
          }
          active = false;
          target.removeEventListener("keydown", listener);
          if (shortcutBinding?.handle === handle) {
            shortcutBinding = null;
          }
          return true;
        }
      });
      shortcutBinding = { target, signature, handle };
      return handle;
    }

    function dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      shortcutBinding?.handle.dispose();
      registrations.clear();
      subscribers.clear();
      return true;
    }

    return Object.freeze({
      surface,
      register,
      invoke,
      getState,
      isAvailable: evaluateAvailability,
      subscribe,
      bindShortcuts,
      dispose
    });
  }

  function createEditorKeyBindings(ids, scope) {
    return ids.map((id) => {
      const definition = get(id);
      if (!definition?.shortcut || definition.surface !== scope?.surface) {
        throw commandError("INVALID_COMMAND_SHORTCUT", `Command ${id} has no editor shortcut.`, id);
      }
      return Object.freeze({
        key: toEditorShortcut(definition.shortcut),
        run() {
          if (!scope.isAvailable(id, undefined, { source: SOURCES.SHORTCUT })) {
            return definition.consumeWhenUnavailable;
          }
          void scope.invoke(id, undefined, { source: SOURCES.SHORTCUT });
          return true;
        }
      });
    });
  }

  globalScope.SuiteMateV3Commands = Object.freeze({
    VERSION,
    IDS,
    SURFACES,
    SOURCES,
    PLATFORMS,
    DEFINITIONS,
    get,
    getShortcut,
    normalizeShortcut,
    detectPlatform,
    resolveShortcut,
    shortcutSignature,
    toEditorShortcut,
    toAriaShortcut,
    formatShortcut,
    matchesShortcutValue,
    matchesShortcut,
    isSupported,
    applyMetadata,
    createScope,
    createEditorKeyBindings
  });
})(globalThis);
