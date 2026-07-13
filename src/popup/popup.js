(function initializePopup() {
  "use strict";

  const api = globalThis.SuiteMateV3Settings;
  const form = document.querySelector("#settings");
  const enabledInput = document.querySelector("#enabled");
  const squareCornersInput = document.querySelector("#squareCorners");
  const resetButton = document.querySelector("#reset");
  const status = document.querySelector("#status");
  let statusTimer;

  function render(value) {
    const settings = api.normalize(value);
    enabledInput.checked = settings.enabled;
    squareCornersInput.checked = settings.squareCorners;
    document.querySelector(`input[name="mode"][value="${settings.mode}"]`).checked = true;
    form.setAttribute("aria-disabled", String(!settings.enabled));

    for (const input of form.querySelectorAll('fieldset input, #squareCorners')) {
      input.disabled = !settings.enabled;
    }
  }

  function readForm() {
    return {
      enabled: enabledInput.checked,
      mode: form.elements.mode.value,
      squareCorners: squareCornersInput.checked
    };
  }

  function showStatus(message) {
    window.clearTimeout(statusTimer);
    status.textContent = message;
    statusTimer = window.setTimeout(() => {
      status.textContent = "";
    }, 1600);
  }

  form.addEventListener("change", async () => {
    const saved = await api.set(readForm());
    render(saved);
    showStatus("Applied");
  });

  resetButton.addEventListener("click", async () => {
    const saved = await api.set(api.DEFAULTS);
    render(saved);
    showStatus("Reset");
  });

  api.get().then(render).catch((error) => {
    console.error("SuiteMate V3 popup could not load settings.", error);
    render(api.DEFAULTS);
    showStatus("Using defaults");
  });
})();
