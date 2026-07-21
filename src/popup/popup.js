(function initializePopup() {
  "use strict";

  const api = globalThis.SuiteMateV3Settings;
  const transferApi = globalThis.SuiteMateV3SettingsTransfer;
  const commandApi = globalThis.SuiteMateV3Commands;
  const routeApi = globalThis.SuiteMateV3Routes;
  const suiteql = globalThis.SuiteMateV3SuiteQLCore;
  const paletteApi = globalThis.SuiteMateV3MaterialPalette;
  const browserUtilityApi = globalThis.SuiteMateV3BrowserUtilities;
  if (!api || !transferApi || !commandApi || !routeApi || !suiteql || !paletteApi || !browserUtilityApi) {
    return;
  }
  const { IDS: COMMANDS, SOURCES: COMMAND_SOURCES } = commandApi;
  const form = document.querySelector("#settings");
  const enabledInput = document.querySelector("#enabled");
  const squareCornersInput = document.querySelector("#squareCorners");
  const roleTheme = document.querySelector("#roleTheme");
  const roleContextLabel = document.querySelector("#roleContext");
  const themeState = document.querySelector("#themeState");
  const mainColorInput = document.querySelector("#mainColor");
  const secondaryColorInput = document.querySelector("#secondaryColor");
  const mainColorTrigger = document.querySelector("#mainColorTrigger");
  const secondaryColorTrigger = document.querySelector("#secondaryColorTrigger");
  const mainColorValue = document.querySelector("#mainColorValue");
  const secondaryColorValue = document.querySelector("#secondaryColorValue");
  const swapColorsButton = document.querySelector("#swapColors");
  const resetColorsButton = document.querySelector("#resetColors");
  const resetButton = document.querySelector("#reset");
  const settingsTransfer = document.querySelector("#settingsTransfer");
  const settingsBackupData = document.querySelector("#settingsBackupData");
  const exportSettingsButton = document.querySelector("#exportSettings");
  const importSettingsButton = document.querySelector("#importSettings");
  const openSuiteQLButton = document.querySelector("#openSuiteQL");
  const suiteqlToolContext = document.querySelector("#suiteqlToolContext");
  const status = document.querySelector("#status");
  const colorPickerModal = document.querySelector("#colorPickerModal");
  const colorPickerTitle = document.querySelector("#colorPickerTitle");
  const closeColorPickerButton = document.querySelector("#closeColorPicker");
  const doneColorPickerButton = document.querySelector("#doneColorPicker");
  const colorPlane = document.querySelector("#colorPlane");
  const colorHue = document.querySelector("#colorHue");
  const colorSaturation = document.querySelector("#colorSaturation");
  const colorBrightness = document.querySelector("#colorBrightness");
  const colorHex = document.querySelector("#colorHex");
  const pickerMaterialShades = document.querySelector("#pickerMaterialShades");
  const modalSiblings = [...document.querySelector("main").children]
    .filter((element) => element !== colorPickerModal);
  const statusNotice = browserUtilityApi.notices.create({
    element: status,
    defaultDuration: 1600,
    toggleHidden: false,
    setTimeoutFn: window.setTimeout.bind(window),
    clearTimeoutFn: window.clearTimeout.bind(window)
  });
  const settingsClipboard = browserUtilityApi.clipboard.create();
  const colorPickerModalController = browserUtilityApi.modals.create({
    dialog: colorPickerModal,
    backgroundElements: modalSiblings,
    body: document.body,
    bodyClass: "picker-open"
  });
  const LIVE_COLOR_SAVE_INTERVAL_MS = 500;
  let currentSettings = api.DEFAULTS;
  let currentRoleContext = null;
  let activeNetSuiteTab = null;
  let activePicker = null;
  let pickerHsv = { h: 0, s: 0, v: 0 };
  let settingsWriteQueue = Promise.resolve();
  let settingsStateRevision = 0;
  let liveColorSaveTimer = 0;
  let lastLiveColorSaveAt = 0;
  let pickerAnimationFrame = 0;
  let pickerFinishPromise = null;
  let settingsLocked = false;
  let settingsReady = false;
  let settingsTransferBusy = false;
  const commandScope = commandApi.createScope(commandApi.SURFACES.POPUP, {
    getContext: () => ({
      pageContext: routeApi.createPageContext(activeNetSuiteTab?.url, { isTopFrame: true }),
      settings: settingsReady ? currentSettings : null,
      roleContext: currentRoleContext,
      activePicker: Boolean(activePicker)
    }),
    onError: ({ commandId, error }) => {
      console.error(`SuiteMate V3 command ${commandId || "(context)"} failed.`, error);
    }
  });

  form.setAttribute("aria-disabled", "true");
  for (const control of form.querySelectorAll("input, button, textarea")) {
    control.disabled = true;
  }

  for (const [element, commandId, setLabel] of [
    [openSuiteQLButton, COMMANDS.POPUP_OPEN_SUITEQL, true],
    [mainColorTrigger, COMMANDS.THEME_OPEN_MAIN_PICKER, false],
    [secondaryColorTrigger, COMMANDS.THEME_OPEN_SECONDARY_PICKER, false],
    [swapColorsButton, COMMANDS.THEME_SWAP_COLORS, true],
    [resetColorsButton, COMMANDS.THEME_RESET_ROLE_COLORS, true],
    [exportSettingsButton, COMMANDS.SETTINGS_EXPORT_BACKUP, true],
    [importSettingsButton, COMMANDS.SETTINGS_IMPORT_BACKUP, true],
    [resetButton, COMMANDS.SETTINGS_RESET_ALL, true],
    [closeColorPickerButton, COMMANDS.THEME_APPLY_AND_CLOSE_PICKER, false],
    [doneColorPickerButton, COMMANDS.THEME_APPLY_AND_CLOSE_PICKER, false]
  ]) {
    commandApi.applyMetadata(element, commandId, { setLabel });
  }

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function hexToRgb(hex) {
    const normalized = api.normalizeHexColor(hex);
    if (!normalized) {
      return null;
    }

    const value = Number.parseInt(normalized.slice(1), 16);
    return {
      red: (value >> 16) & 255,
      green: (value >> 8) & 255,
      blue: value & 255
    };
  }

  function rgbToHex({ red, green, blue }) {
    return `#${[red, green, blue]
      .map((value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  function rgbToHsv({ red, green, blue }, fallbackHue = 0) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const maximum = Math.max(r, g, b);
    const minimum = Math.min(r, g, b);
    const delta = maximum - minimum;
    let hue = fallbackHue;

    if (delta > 0) {
      if (maximum === r) {
        hue = 60 * (((g - b) / delta) % 6);
      } else if (maximum === g) {
        hue = 60 * ((b - r) / delta + 2);
      } else {
        hue = 60 * ((r - g) / delta + 4);
      }
    }

    if (hue < 0) {
      hue += 360;
    }

    return {
      h: hue,
      s: maximum === 0 ? 0 : delta / maximum,
      v: maximum
    };
  }

  function hsvToRgb({ h, s, v }) {
    const hue = ((h % 360) + 360) % 360;
    const chroma = v * s;
    const segment = hue / 60;
    const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
    let channels;

    if (segment < 1) {
      channels = [chroma, secondary, 0];
    } else if (segment < 2) {
      channels = [secondary, chroma, 0];
    } else if (segment < 3) {
      channels = [0, chroma, secondary];
    } else if (segment < 4) {
      channels = [0, secondary, chroma];
    } else if (segment < 5) {
      channels = [secondary, 0, chroma];
    } else {
      channels = [chroma, 0, secondary];
    }

    const offset = v - chroma;
    return {
      red: (channels[0] + offset) * 255,
      green: (channels[1] + offset) * 255,
      blue: (channels[2] + offset) * 255
    };
  }

  function currentPickerHex() {
    return rgbToHex(hsvToRgb(pickerHsv));
  }

  function showStatus(message, type = "success", duration) {
    statusNotice.show(message, { type, ...(duration === undefined ? {} : { duration }) });
  }

  function showTransferError(error) {
    showStatus(error?.message || "Settings transfer failed", "error", 4500);
  }

  function updateSettingsTransferState() {
    const unavailable = settingsLocked || !settingsReady || settingsTransferBusy;
    settingsTransfer.dataset.settingsLocked = String(unavailable);
    settingsBackupData.disabled = unavailable;
    exportSettingsButton.disabled = unavailable;
    importSettingsButton.disabled = unavailable || !settingsBackupData.value.trim();
  }

  function updateColorTrigger(input, trigger, colorName) {
    const value = input.value.toUpperCase();
    trigger.style.setProperty("--picker-color", input.value);
    trigger.setAttribute("aria-label", `Choose ${colorName} color. Current value ${value}.`);
  }

  function updateColorLabels() {
    mainColorValue.textContent = mainColorInput.value.toUpperCase();
    secondaryColorValue.textContent = secondaryColorInput.value.toUpperCase();
    updateColorTrigger(mainColorInput, mainColorTrigger, "Main");
    updateColorTrigger(secondaryColorInput, secondaryColorTrigger, "Secondary");
  }

  function updateThemeState(theme, disabled) {
    themeState.textContent = theme.customized ? "Custom" : "Default";
    themeState.classList.toggle("customized", theme.customized);
    swapColorsButton.disabled = disabled || !theme.customized;
    resetColorsButton.disabled = disabled || !theme.customized;
    mainColorTrigger.disabled = disabled;
    secondaryColorTrigger.disabled = disabled;
  }

  function createMaterialSwatch(colorName, shade, hex, textColor) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "material-swatch";
    button.dataset.hex = hex;
    button.dataset.suitemateV3Command = COMMANDS.THEME_SELECT_MATERIAL_SHADE;
    button.title = `${colorName} Material shade ${shade}: ${hex.toUpperCase()}`;
    button.setAttribute("aria-label", button.title);
    button.style.setProperty("--palette-color", hex);
    button.style.setProperty("--palette-text", textColor);
    const label = document.createElement("span");
    label.textContent = shade;
    button.append(label);
    return button;
  }

  function renderPickerMaterialShades(seed) {
    const palette = paletteApi.generateMaterialShades(seed);
    pickerMaterialShades.replaceChildren();
    if (!palette || !activePicker) {
      return;
    }

    for (const [shade, hex] of Object.entries(palette.shades)) {
      pickerMaterialShades.append(createMaterialSwatch(
        activePicker.label,
        shade,
        hex,
        palette.onShades[shade]
      ));
    }
  }

  function renderPickerControls() {
    const hex = currentPickerHex();
    const saturation = Math.round(pickerHsv.s * 100);
    const brightness = Math.round(pickerHsv.v * 100);
    colorPickerModal.style.setProperty("--picker-color", hex);
    colorPickerModal.style.setProperty("--picker-hue", String(Math.round(pickerHsv.h)));
    colorPickerModal.style.setProperty("--picker-saturation", `${saturation}%`);
    colorPickerModal.style.setProperty("--picker-brightness-position", `${100 - brightness}%`);
    colorHue.value = String(Math.round(pickerHsv.h) % 360);
    colorSaturation.value = String(saturation);
    colorBrightness.value = String(brightness);
    colorHex.value = hex.toUpperCase();
    colorHex.setAttribute("aria-invalid", "false");
    colorPlane.setAttribute(
      "aria-valuetext",
      `Saturation ${saturation} percent, brightness ${brightness} percent`
    );
  }

  function applyPickerColor({ regenerateMaterial = true } = {}) {
    const hex = currentPickerHex();
    renderPickerControls();
    if (regenerateMaterial) {
      renderPickerMaterialShades(hex);
    }
    if (!activePicker) {
      return;
    }

    activePicker.input.value = hex;
    handleLiveColorInput(activePicker.input);
  }

  function setPickerHex(value, { apply = true, regenerateMaterial = true } = {}) {
    const normalized = api.normalizeHexColor(value);
    const rgb = hexToRgb(normalized);
    if (!normalized || !rgb) {
      return false;
    }

    pickerHsv = rgbToHsv(rgb, pickerHsv.h);
    if (apply) {
      applyPickerColor({ regenerateMaterial });
    } else {
      renderPickerControls();
      if (regenerateMaterial) {
        renderPickerMaterialShades(normalized);
      }
    }
    return true;
  }

  function schedulePickerColor() {
    if (pickerAnimationFrame) {
      return;
    }

    pickerAnimationFrame = window.requestAnimationFrame(() => {
      pickerAnimationFrame = 0;
      applyPickerColor();
    });
  }

  function flushPickerColor() {
    if (!pickerAnimationFrame) {
      return;
    }

    window.cancelAnimationFrame(pickerAnimationFrame);
    pickerAnimationFrame = 0;
    applyPickerColor();
  }

  function updatePickerFromPlane(event) {
    const bounds = colorPlane.getBoundingClientRect();
    pickerHsv.s = clamp((event.clientX - bounds.left) / bounds.width);
    pickerHsv.v = 1 - clamp((event.clientY - bounds.top) / bounds.height);
    schedulePickerColor();
  }

  function openColorPicker(input, trigger, colorName) {
    if (trigger.disabled) {
      return;
    }

    activePicker = { input, trigger, colorName, label: colorName === "main" ? "Main" : "Secondary" };
    const rgb = hexToRgb(input.value);
    pickerHsv = rgbToHsv(rgb, pickerHsv.h);
    colorPickerTitle.textContent = `${activePicker.label} color`;
    renderPickerControls();
    renderPickerMaterialShades(input.value);
    colorPickerModalController.show({ trigger, initialFocus: colorPlane });
  }

  function hideColorPicker() {
    colorPickerModalController.hide();
    activePicker = null;
  }

  async function finishColorPicker() {
    if (!activePicker) {
      return;
    }
    if (pickerFinishPromise) {
      return pickerFinishPromise;
    }

    flushPickerColor();
    const picker = activePicker;
    pickerFinishPromise = saveRoleColors({ [picker.colorName]: picker.input.value })
      .catch(() => showStatus("Could not save color"))
      .finally(() => {
        pickerFinishPromise = null;
        hideColorPicker();
      });
    return pickerFinishPromise;
  }

  function renderRoleTheme() {
    const available = Boolean(currentRoleContext?.id);
    const theme = api.getRoleTheme(currentSettings, currentRoleContext?.id);
    const disabled = settingsLocked || settingsTransferBusy || !available || !currentSettings.enabled;

    roleTheme.dataset.unavailable = String(!available);
    roleContextLabel.textContent = available
      ? currentRoleContext.name
      : "Open this popup from a signed-in NetSuite tab.";
    mainColorInput.value = theme.main;
    secondaryColorInput.value = theme.secondary;
    mainColorInput.disabled = disabled;
    secondaryColorInput.disabled = disabled;
    updateThemeState(theme, disabled);
    updateColorLabels();
  }

  function render(value) {
    currentSettings = api.normalize(value);
    settingsStateRevision += 1;
    settingsReady = !settingsLocked;
    enabledInput.checked = currentSettings.enabled;
    squareCornersInput.checked = currentSettings.squareCorners;
    document.querySelector(`input[name="mode"][value="${currentSettings.mode}"]`).checked = true;
    form.dataset.settingsLocked = String(settingsLocked);
    form.setAttribute("aria-disabled", String(settingsLocked || settingsTransferBusy || !currentSettings.enabled));
    form.setAttribute("aria-busy", String(settingsTransferBusy));
    enabledInput.disabled = settingsLocked || settingsTransferBusy;
    resetButton.disabled = settingsLocked || settingsTransferBusy;

    for (const input of form.querySelectorAll('fieldset input, #squareCorners')) {
      input.disabled = settingsLocked || settingsTransferBusy || !currentSettings.enabled;
    }

    renderRoleTheme();
    updateSettingsTransferState();
  }

  function readAppearance() {
    return {
      enabled: enabledInput.checked,
      mode: form.elements.mode.value,
      squareCorners: squareCornersInput.checked
    };
  }

  async function getActiveRoleContext() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabContext = routeApi.createPageContext(tab?.url, { isTopFrame: true });
    if (!tab?.id || !routeApi.supports(routeApi.CAPABILITIES.SUITEQL_LAUNCH, tabContext)) {
      activeNetSuiteTab = null;
      openSuiteQLButton.disabled = true;
      suiteqlToolContext.textContent = "Open a NetSuite tab to launch Studio.";
      return null;
    }

    activeNetSuiteTab = tab;
    openSuiteQLButton.disabled = false;
    suiteqlToolContext.textContent = "Launches in this NetSuite account.";
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: api.ROLE_CONTEXT_MESSAGE });
      return response?.roleContext ?? null;
    } catch {
      return null;
    }
  }

  function writeSettings(update, options = {}) {
    if (settingsLocked) {
      return Promise.reject(new Error("Settings are read-only in this SuiteMate release."));
    }
    let snapshot;
    try {
      const value = typeof update === "function"
        ? update(currentSettings)
        : update;
      snapshot = api.normalize(value);
    } catch (error) {
      return Promise.reject(error);
    }
    currentSettings = snapshot;
    const revision = ++settingsStateRevision;
    settingsWriteQueue = settingsWriteQueue
      .catch(() => undefined)
      .then(() => api.set(snapshot));
    return settingsWriteQueue.then((value) => {
      const saved = api.normalize(value);
      const isLatest = revision === settingsStateRevision;
      if (isLatest) {
        currentSettings = saved;
        if (options.renderResult !== false) {
          render(saved);
        }
      }
      return { settings: saved, isLatest };
    });
  }

  function clearLiveColorSaveTimer() {
    window.clearTimeout(liveColorSaveTimer);
    liveColorSaveTimer = 0;
  }

  function persistLiveColors() {
    clearLiveColorSaveTimer();
    lastLiveColorSaveAt = Date.now();
    void writeSettings((settings) => settings, { renderResult: false })
      .catch(() => showStatus("Could not save colors"));
  }

  function scheduleLiveColorSave() {
    const remaining = LIVE_COLOR_SAVE_INTERVAL_MS - (Date.now() - lastLiveColorSaveAt);
    if (remaining <= 0) {
      persistLiveColors();
    } else if (!liveColorSaveTimer) {
      liveColorSaveTimer = window.setTimeout(persistLiveColors, remaining);
    }
  }

  function previewRoleColors() {
    if (!activeNetSuiteTab?.id || !currentRoleContext) {
      return;
    }

    void chrome.tabs.sendMessage(activeNetSuiteTab.id, {
      type: api.THEME_PREVIEW_MESSAGE,
      roleId: currentRoleContext.id,
      colors: {
        main: mainColorInput.value,
        secondary: secondaryColorInput.value
      }
    }).catch(() => undefined);
  }

  function handleLiveColorInput(input) {
    updateColorLabels();
    if (!currentRoleContext) {
      return;
    }

    const colorName = input === mainColorInput ? "main" : "secondary";
    currentSettings = api.withRoleTheme(currentSettings, currentRoleContext, {
      [colorName]: input.value
    });
    settingsStateRevision += 1;
    updateThemeState(api.getRoleTheme(currentSettings, currentRoleContext.id), false);
    previewRoleColors();
    scheduleLiveColorSave();
  }

  async function saveRoleColors(colors) {
    if (!currentRoleContext) {
      return;
    }

    clearLiveColorSaveTimer();
    const roleContext = currentRoleContext;
    const result = await writeSettings((settings) =>
      api.withRoleTheme(settings, roleContext, colors));
    if (result.isLatest) {
      showStatus("Colors applied");
    }
  }

  function invokePopupCommand(commandId, payload, source = COMMAND_SOURCES.BUTTON) {
    return commandScope.invoke(commandId, payload, { source });
  }

  function installCommands() {
    commandScope.register(COMMANDS.SETTINGS_APPLY_APPEARANCE, {
      allowReentry: true,
      isAvailable: () => settingsReady && !settingsLocked && !settingsTransferBusy,
      async run({ payload }) {
        const target = payload?.target;
        if (target?.classList?.contains("role-color")) {
          const colorName = target === mainColorInput ? "main" : "secondary";
          await saveRoleColors({ [colorName]: target.value });
          return;
        }

        const appearance = readAppearance();
        const result = await writeSettings((settings) => ({ ...settings, ...appearance }));
        if (result.isLatest) {
          showStatus("Applied");
        }
      }
    });
    commandScope.register(COMMANDS.THEME_OPEN_MAIN_PICKER, {
      isAvailable: () => !mainColorTrigger.disabled,
      run: () => openColorPicker(mainColorInput, mainColorTrigger, "main")
    });
    commandScope.register(COMMANDS.THEME_OPEN_SECONDARY_PICKER, {
      isAvailable: () => !secondaryColorTrigger.disabled,
      run: () => openColorPicker(secondaryColorInput, secondaryColorTrigger, "secondary")
    });
    commandScope.register(COMMANDS.THEME_SELECT_MATERIAL_SHADE, {
      isAvailable: ({ payload }) => Boolean(activePicker && api.normalizeHexColor(payload?.hex)),
      run: ({ payload }) => setPickerHex(payload.hex, { regenerateMaterial: false })
    });
    commandScope.register(COMMANDS.THEME_APPLY_AND_CLOSE_PICKER, {
      isAvailable: () => Boolean(activePicker),
      run: finishColorPicker
    });
    commandScope.register(COMMANDS.THEME_SWAP_COLORS, {
      isAvailable: () => !swapColorsButton.disabled,
      async run() {
        clearLiveColorSaveTimer();
        const roleContext = currentRoleContext;
        const result = await writeSettings((settings) =>
          api.swapRoleTheme(settings, roleContext));
        if (result.isLatest) {
          showStatus("Colors swapped");
        }
      }
    });
    commandScope.register(COMMANDS.THEME_RESET_ROLE_COLORS, {
      isAvailable: () => !resetColorsButton.disabled && Boolean(currentRoleContext),
      async run() {
        clearLiveColorSaveTimer();
        const roleId = currentRoleContext.id;
        const result = await writeSettings((settings) =>
          api.withoutRoleTheme(settings, roleId));
        if (result.isLatest) {
          showStatus("Default colors restored");
        }
      }
    });
    commandScope.register(COMMANDS.SETTINGS_EXPORT_BACKUP, {
      isAvailable: () => settingsReady && !settingsLocked && !settingsTransferBusy,
      async run() {
        try {
          const backup = transferApi.create(currentSettings);
          settingsBackupData.value = backup;
          updateSettingsTransferState();
          settingsBackupData.focus();
          settingsBackupData.select();
          const copied = await settingsClipboard.writeText(backup);
          if (copied.ok) {
            showStatus("Settings backup copied", "success", 2200);
          } else {
            showStatus("Backup ready. Copy it manually.", "warning", 4500);
          }
          return copied;
        } catch (error) {
          showTransferError(error);
          return { ok: false, error };
        }
      }
    });
    commandScope.register(COMMANDS.SETTINGS_IMPORT_BACKUP, {
      isAvailable: () =>
        settingsReady
        && !settingsLocked
        && !settingsTransferBusy
        && Boolean(settingsBackupData.value.trim()),
      async run() {
        let parsed;
        try {
          parsed = transferApi.parse(settingsBackupData.value);
        } catch (error) {
          showTransferError(error);
          return false;
        }

        const roleCount = Object.keys(parsed.settings.roleThemes).length;
        const confirmed = window.confirm(
          `Importing this backup will replace all SuiteMate V3 settings, including ${roleCount} role theme${roleCount === 1 ? "" : "s"}. Continue?`
        );
        if (!confirmed) {
          showStatus("Import cancelled", "warning", 2200);
          return false;
        }

        clearLiveColorSaveTimer();
        const previousSettings = currentSettings;
        settingsTransferBusy = true;
        render(previousSettings);
        try {
          const result = await writeSettings(() => parsed.settings, { renderResult: false });
          settingsTransferBusy = false;
          render(currentSettings);
          if (result.isLatest) {
            settingsBackupData.value = "";
            updateSettingsTransferState();
            previewRoleColors();
            showStatus("Settings imported", "success", 2500);
          }
          return true;
        } catch (error) {
          currentSettings = previousSettings;
          settingsTransferBusy = false;
          render(previousSettings);
          showTransferError(error);
          return false;
        }
      }
    });
    commandScope.register(COMMANDS.SETTINGS_RESET_ALL, {
      isAvailable: () => settingsReady && !resetButton.disabled,
      async run() {
        clearLiveColorSaveTimer();
        const result = await writeSettings(() => api.DEFAULTS);
        if (result.isLatest) {
          showStatus("All styling reset");
        }
      }
    });
    commandScope.register(COMMANDS.POPUP_OPEN_SUITEQL, {
      isAvailable: () => Boolean(
        activeNetSuiteTab?.id
        && suiteql.createStudioUrl(activeNetSuiteTab.url)
      ),
      async run() {
        const studioUrl = suiteql.createStudioUrl(activeNetSuiteTab?.url);
        if (!activeNetSuiteTab?.id || !studioUrl) {
          openSuiteQLButton.disabled = true;
          suiteqlToolContext.textContent = "Open a NetSuite tab to launch Studio.";
          return;
        }

        openSuiteQLButton.disabled = true;
        suiteqlToolContext.textContent = "Opening SuiteQL Console...";
        try {
          await chrome.tabs.update(activeNetSuiteTab.id, { url: studioUrl });
          window.close();
        } catch (error) {
          console.error("SuiteMate V3 could not open SuiteQL Console.", error);
          openSuiteQLButton.disabled = false;
          suiteqlToolContext.textContent = "Could not open Studio in this tab.";
        }
      }
    });
  }

  installCommands();
  commandScope.bindShortcuts(
    document,
    [COMMANDS.THEME_APPLY_AND_CLOSE_PICKER]
  );

  form.addEventListener("change", ({ target }) => {
    if (target === settingsBackupData) {
      return;
    }
    void invokePopupCommand(COMMANDS.SETTINGS_APPLY_APPEARANCE, { target });
  });

  mainColorTrigger.addEventListener("click", () => {
    void invokePopupCommand(COMMANDS.THEME_OPEN_MAIN_PICKER);
  });
  secondaryColorTrigger.addEventListener("click", () => {
    void invokePopupCommand(COMMANDS.THEME_OPEN_SECONDARY_PICKER);
  });

  colorPlane.addEventListener("pointerdown", (event) => {
    colorPlane.setPointerCapture(event.pointerId);
    updatePickerFromPlane(event);
  });
  colorPlane.addEventListener("pointermove", (event) => {
    if (colorPlane.hasPointerCapture(event.pointerId)) {
      updatePickerFromPlane(event);
    }
  });
  colorPlane.addEventListener("pointerup", (event) => {
    if (colorPlane.hasPointerCapture(event.pointerId)) {
      colorPlane.releasePointerCapture(event.pointerId);
    }
    flushPickerColor();
  });
  colorPlane.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    if (event.key === "ArrowLeft") {
      pickerHsv.s = clamp(pickerHsv.s - step);
    } else if (event.key === "ArrowRight") {
      pickerHsv.s = clamp(pickerHsv.s + step);
    } else if (event.key === "ArrowUp") {
      pickerHsv.v = clamp(pickerHsv.v + step);
    } else {
      pickerHsv.v = clamp(pickerHsv.v - step);
    }
    applyPickerColor();
  });

  colorHue.addEventListener("input", () => {
    pickerHsv.h = Number(colorHue.value);
    applyPickerColor();
  });
  colorSaturation.addEventListener("input", () => {
    pickerHsv.s = Number(colorSaturation.value) / 100;
    applyPickerColor();
  });
  colorBrightness.addEventListener("input", () => {
    pickerHsv.v = Number(colorBrightness.value) / 100;
    applyPickerColor();
  });

  colorHex.addEventListener("input", () => {
    const applied = setPickerHex(colorHex.value);
    colorHex.setAttribute("aria-invalid", String(!applied));
  });
  colorHex.addEventListener("blur", () => {
    if (colorHex.getAttribute("aria-invalid") === "true") {
      renderPickerControls();
    }
  });
  colorHex.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && colorHex.getAttribute("aria-invalid") !== "true") {
      event.preventDefault();
      void invokePopupCommand(COMMANDS.THEME_APPLY_AND_CLOSE_PICKER, undefined, COMMAND_SOURCES.SHORTCUT);
    }
  });

  pickerMaterialShades.addEventListener("click", ({ target }) => {
    const swatch = target.closest("button[data-hex]");
    if (!swatch || !activePicker) {
      return;
    }

    void invokePopupCommand(COMMANDS.THEME_SELECT_MATERIAL_SHADE, {
      hex: swatch.dataset.hex
    });
  });

  closeColorPickerButton.addEventListener(
    "click",
    () => void invokePopupCommand(COMMANDS.THEME_APPLY_AND_CLOSE_PICKER)
  );
  doneColorPickerButton.addEventListener(
    "click",
    () => void invokePopupCommand(COMMANDS.THEME_APPLY_AND_CLOSE_PICKER)
  );
  colorPickerModal.addEventListener("click", ({ target }) => {
    if (target === colorPickerModal) {
      void invokePopupCommand(COMMANDS.THEME_APPLY_AND_CLOSE_PICKER);
    }
  });
  swapColorsButton.addEventListener("click", () => {
    void invokePopupCommand(COMMANDS.THEME_SWAP_COLORS);
  });

  resetColorsButton.addEventListener("click", () => {
    void invokePopupCommand(COMMANDS.THEME_RESET_ROLE_COLORS);
  });

  settingsBackupData.addEventListener("input", updateSettingsTransferState);

  exportSettingsButton.addEventListener("click", () => {
    void invokePopupCommand(COMMANDS.SETTINGS_EXPORT_BACKUP);
  });

  importSettingsButton.addEventListener("click", () => {
    void invokePopupCommand(COMMANDS.SETTINGS_IMPORT_BACKUP);
  });

  resetButton.addEventListener("click", () => {
    void invokePopupCommand(COMMANDS.SETTINGS_RESET_ALL);
  });

  openSuiteQLButton.addEventListener("click", () => {
    void invokePopupCommand(COMMANDS.POPUP_OPEN_SUITEQL);
  });

  window.addEventListener("pagehide", () => {
    flushPickerColor();
    if (!settingsLocked && liveColorSaveTimer) {
      clearLiveColorSaveTimer();
      void writeSettings((settings) => settings, { renderResult: false })
        .catch(() => undefined);
    }
    statusNotice.dispose();
    settingsClipboard.dispose();
    colorPickerModalController.dispose();
    commandScope.dispose();
  });

  Promise.all([api.ensureCurrentSchema(), getActiveRoleContext()])
    .then(([settings, roleContext]) => {
      currentRoleContext = roleContext;
      render(settings);
    })
    .catch((error) => {
      console.error("SuiteMate V3 popup could not load settings.", error);
      const versionError = api.isSettingsVersionError(error);
      settingsLocked = true;
      render(api.DEFAULTS);
      showStatus(versionError ? "Settings require a newer SuiteMate release" : "Settings unavailable. Reopen SuiteMate.");
    });
})();
