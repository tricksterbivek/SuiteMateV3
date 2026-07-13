(function initializePopup() {
  "use strict";

  const api = globalThis.SuiteMateV3Settings;
  const form = document.querySelector("#settings");
  const enabledInput = document.querySelector("#enabled");
  const squareCornersInput = document.querySelector("#squareCorners");
  const roleTheme = document.querySelector("#roleTheme");
  const roleContextLabel = document.querySelector("#roleContext");
  const themeState = document.querySelector("#themeState");
  const mainColorInput = document.querySelector("#mainColor");
  const secondaryColorInput = document.querySelector("#secondaryColor");
  const mainColorValue = document.querySelector("#mainColorValue");
  const secondaryColorValue = document.querySelector("#secondaryColorValue");
  const swapColorsButton = document.querySelector("#swapColors");
  const resetColorsButton = document.querySelector("#resetColors");
  const resetButton = document.querySelector("#reset");
  const status = document.querySelector("#status");
  const LIVE_COLOR_SAVE_INTERVAL_MS = 500;
  let currentSettings = api.DEFAULTS;
  let currentRoleContext = null;
  let activeNetSuiteTabId = null;
  let settingsWriteQueue = Promise.resolve();
  let liveColorSaveTimer = 0;
  let lastLiveColorSaveAt = 0;
  let statusTimer;

  function showStatus(message) {
    window.clearTimeout(statusTimer);
    status.textContent = message;
    statusTimer = window.setTimeout(() => {
      status.textContent = "";
    }, 1600);
  }

  function updateColorLabels() {
    mainColorValue.textContent = mainColorInput.value.toUpperCase();
    secondaryColorValue.textContent = secondaryColorInput.value.toUpperCase();
  }

  function updateThemeState(theme, disabled) {
    themeState.textContent = theme.customized ? "Custom" : "Default";
    themeState.classList.toggle("customized", theme.customized);
    swapColorsButton.disabled = disabled || !theme.customized;
    resetColorsButton.disabled = disabled || !theme.customized;
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
    if (!tab?.id || !tab.url?.includes(".netsuite.com/")) {
      return null;
    }

    activeNetSuiteTabId = tab.id;
    const response = await chrome.tabs.sendMessage(tab.id, { type: api.ROLE_CONTEXT_MESSAGE });
    return response?.roleContext ?? null;
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
    if (!activeNetSuiteTabId || !currentRoleContext) {
      return;
    }

    void chrome.tabs.sendMessage(activeNetSuiteTabId, {
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

  for (const input of [mainColorInput, secondaryColorInput]) {
    input.addEventListener("input", () => handleLiveColorInput(input));
  }

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

  window.addEventListener("pagehide", () => {
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
