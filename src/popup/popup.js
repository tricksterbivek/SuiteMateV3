(function initializePopup() {
  "use strict";

  const api = globalThis.SuiteMateV3Settings;
  const suiteql = globalThis.SuiteMateV3SuiteQLCore;
  const paletteApi = globalThis.SuiteMateV3MaterialPalette;
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
  const LIVE_COLOR_SAVE_INTERVAL_MS = 500;
  let currentSettings = api.DEFAULTS;
  let currentRoleContext = null;
  let activeNetSuiteTab = null;
  let activePicker = null;
  let pickerHsv = { h: 0, s: 0, v: 0 };
  let settingsWriteQueue = Promise.resolve();
  let liveColorSaveTimer = 0;
  let lastLiveColorSaveAt = 0;
  let pickerAnimationFrame = 0;
  let pickerFinishPromise = null;
  let statusTimer;

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

  function showStatus(message) {
    window.clearTimeout(statusTimer);
    status.textContent = message;
    statusTimer = window.setTimeout(() => {
      status.textContent = "";
    }, 1600);
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

  function setModalBackgroundInert(inert) {
    for (const element of modalSiblings) {
      element.inert = inert;
      element.toggleAttribute("inert", inert);
      element.toggleAttribute("aria-hidden", inert);
    }
  }

  function openColorPicker(input, trigger, colorName) {
    if (trigger.disabled) {
      return;
    }

    activePicker = { input, trigger, colorName, label: colorName === "main" ? "Main" : "Secondary" };
    const rgb = hexToRgb(input.value);
    pickerHsv = rgbToHsv(rgb, pickerHsv.h);
    colorPickerTitle.textContent = `${activePicker.label} color`;
    colorPickerModal.hidden = false;
    document.body.classList.add("picker-open");
    trigger.setAttribute("aria-expanded", "true");
    setModalBackgroundInert(true);
    renderPickerControls();
    renderPickerMaterialShades(input.value);
    colorPlane.focus();
  }

  function hideColorPicker() {
    const trigger = activePicker?.trigger;
    colorPickerModal.hidden = true;
    document.body.classList.remove("picker-open");
    setModalBackgroundInert(false);
    trigger?.setAttribute("aria-expanded", "false");
    activePicker = null;
    trigger?.focus();
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
    const disabled = !available || !currentSettings.enabled;

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
    enabledInput.checked = currentSettings.enabled;
    squareCornersInput.checked = currentSettings.squareCorners;
    document.querySelector(`input[name="mode"][value="${currentSettings.mode}"]`).checked = true;
    form.setAttribute("aria-disabled", String(!currentSettings.enabled));

    for (const input of form.querySelectorAll('fieldset input, #squareCorners')) {
      input.disabled = !currentSettings.enabled;
    }

    renderRoleTheme();
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
    if (!tab?.id || !suiteql.isAllowedNetSuiteUrl(tab.url)) {
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

  function writeSettings(value) {
    const snapshot = api.normalize(value);
    settingsWriteQueue = settingsWriteQueue
      .catch(() => undefined)
      .then(() => api.set(snapshot));
    return settingsWriteQueue;
  }

  function clearLiveColorSaveTimer() {
    window.clearTimeout(liveColorSaveTimer);
    liveColorSaveTimer = 0;
  }

  function persistLiveColors() {
    clearLiveColorSaveTimer();
    lastLiveColorSaveAt = Date.now();
    void writeSettings(currentSettings).catch(() => showStatus("Could not save colors"));
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
    updateThemeState(api.getRoleTheme(currentSettings, currentRoleContext.id), false);
    previewRoleColors();
    scheduleLiveColorSave();
  }

  async function saveRoleColors(colors) {
    if (!currentRoleContext) {
      return;
    }

    clearLiveColorSaveTimer();
    currentSettings = api.withRoleTheme(currentSettings, currentRoleContext, colors);
    render(await writeSettings(currentSettings));
    showStatus("Colors applied");
  }

  form.addEventListener("change", async ({ target }) => {
    if (target.classList.contains("role-color")) {
      const colorName = target === mainColorInput ? "main" : "secondary";
      await saveRoleColors({ [colorName]: target.value });
      return;
    }

    const saved = await writeSettings({ ...currentSettings, ...readAppearance() });
    render(saved);
    showStatus("Applied");
  });

  mainColorTrigger.addEventListener("click", () => openColorPicker(
    mainColorInput,
    mainColorTrigger,
    "main"
  ));
  secondaryColorTrigger.addEventListener("click", () => openColorPicker(
    secondaryColorInput,
    secondaryColorTrigger,
    "secondary"
  ));

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
      void finishColorPicker();
    }
  });

  pickerMaterialShades.addEventListener("click", ({ target }) => {
    const swatch = target.closest("button[data-hex]");
    if (!swatch || !activePicker) {
      return;
    }

    setPickerHex(swatch.dataset.hex, { regenerateMaterial: false });
  });

  closeColorPickerButton.addEventListener("click", () => void finishColorPicker());
  doneColorPickerButton.addEventListener("click", () => void finishColorPicker());
  colorPickerModal.addEventListener("click", ({ target }) => {
    if (target === colorPickerModal) {
      void finishColorPicker();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activePicker) {
      event.preventDefault();
      void finishColorPicker();
    }
  });

  swapColorsButton.addEventListener("click", async () => {
    clearLiveColorSaveTimer();
    render(await writeSettings(api.swapRoleTheme(currentSettings, currentRoleContext)));
    showStatus("Colors swapped");
  });

  resetColorsButton.addEventListener("click", async () => {
    if (!currentRoleContext) {
      return;
    }

    clearLiveColorSaveTimer();
    render(await writeSettings(api.withoutRoleTheme(currentSettings, currentRoleContext.id)));
    showStatus("Default colors restored");
  });

  resetButton.addEventListener("click", async () => {
    clearLiveColorSaveTimer();
    render(await writeSettings(api.DEFAULTS));
    showStatus("All styling reset");
  });

  openSuiteQLButton.addEventListener("click", async () => {
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
  });

  window.addEventListener("pagehide", () => {
    flushPickerColor();
    if (!liveColorSaveTimer) {
      return;
    }

    clearLiveColorSaveTimer();
    void chrome.storage.sync.set({
      [api.STORAGE_KEY]: api.normalize(currentSettings)
    }).catch(() => undefined);
  });

  Promise.all([api.get(), getActiveRoleContext()])
    .then(([settings, roleContext]) => {
      currentRoleContext = roleContext;
      render(settings);
    })
    .catch((error) => {
      console.error("SuiteMate V3 popup could not load settings.", error);
      render(api.DEFAULTS);
      showStatus("Using defaults");
    });
})();
