(function initializeSuiteMateV3ImportAssistantContext(global) {
  "use strict";

  const core = global.SuiteMateV3ImportAssistantCore;
  const bridgeApi = global.SuiteMateV3Bridge;
  const lifecycleApi = global.SuiteMateV3Lifecycle;
  const routeApi = global.SuiteMateV3Routes;
  const settingsApi = global.SuiteMateV3Settings;
  if (
    !core
    || !bridgeApi
    || !lifecycleApi
    || !routeApi
    || !settingsApi
    || !global.document
    || !global.location
    || !global.chrome?.runtime
  ) {
    return;
  }

  let topFrame = false;
  try {
    topFrame = global === global.top;
  } catch {
    return;
  }

  const pageContext = routeApi.createPageContext(location, {
    isTopFrame: topFrame,
    trustedContentScript: true
  });
  if (!routeApi.supports(routeApi.CAPABILITIES.IMPORT_ASSISTANT_CONTEXT, pageContext)) {
    return;
  }

  const root = document.documentElement;
  let settingsRevision = 0;

  function readFieldValue(fieldId) {
    return core.normalizeImportValue(document.querySelector(`[name="${fieldId}"]`)?.value);
  }

  function readFieldOptions(fieldId) {
    const optionsData = document.querySelector(`[data-name="${fieldId}"]`)?.dataset.options;
    return core.parseOptionsData(optionsData);
  }

  function isStepOneReady() {
    const step = document.querySelector(
      ".uir_assistant_current_step > .uir_assistant_step_number"
    )?.textContent?.trim();
    return step === "1"
      && Boolean(document.querySelector('[name="recordtype"]'))
      && Boolean(document.querySelector('[name="recordsubtype"]'));
  }

  function waitForStepOne(signal, timeoutMs = 30000) {
    return lifecycleApi.waitFor({
      id: "import-assistant.step-one",
      capability: routeApi.CAPABILITIES.IMPORT_ASSISTANT_CONTEXT,
      signal,
      timeoutMs,
      observe: {
        childList: true,
        subtree: true
      },
      test: isStepOneReady
    });
  }

  function hasSubtypeOption(recordSubtype) {
    return readFieldOptions("recordsubtype").some(({ value }) => value === recordSubtype);
  }

  function waitForSubtypeSource(recordSubtype, previousSubtype, signal, timeoutMs = 2500) {
    return lifecycleApi.waitFor({
      id: "import-assistant.subtype-source",
      capability: routeApi.CAPABILITIES.IMPORT_ASSISTANT_CONTEXT,
      signal,
      timeoutMs,
      observe: {
        attributes: true,
        attributeFilter: ["data-options", "value"],
        childList: true,
        subtree: true
      },
      test: () => {
        const sourcedSubtype = readFieldValue("recordsubtype");
        return hasSubtypeOption(recordSubtype)
          || Boolean(sourcedSubtype && sourcedSubtype !== previousSubtype);
      }
    });
  }

  async function findCategoryFromNetSuite(recordSubtype, signal) {
    const categories = readFieldOptions("recordtype").map(({ value }) => value);
    const matches = await Promise.all(categories.map(async (category) => {
      try {
        const url = new URL(location.pathname, location.origin);
        url.searchParams.set("importmethod", "filegroups");
        url.searchParams.set("rectype", category);
        const response = await fetch(url, { credentials: "include", signal });
        return core.responseContainsSubtype(await response.text(), recordSubtype)
          ? category
          : null;
      } catch {
        return null;
      }
    }));
    return matches.find(Boolean) ?? null;
  }

  async function setImportValues(values, signal) {
    const response = await bridgeApi.request(
      bridgeApi.COMMANDS.IMPORT_ASSISTANT_SET_VALUES,
      { values },
      { signal, timeoutMs: 30000 }
    );
    const result = bridgeApi.toCommandResult(response);
    const requestedFields = Object.keys(values);
    return result.ok === true
      && Array.isArray(result.applied)
      && result.applied.length === requestedFields.length
      && requestedFields.every((fieldId) => result.applied.includes(fieldId));
  }

  function readRequestedContext() {
    const params = new URLSearchParams(location.search);
    const requestedSubtype = core.normalizeImportValue(params.get("recordsubtype"));
    const requestedCategory = core.normalizeImportValue(params.get("recordtype"));
    if (params.get("recid") || (!requestedSubtype && !requestedCategory)) {
      return null;
    }
    return {
      requestedSubtype,
      requestedCategory,
      key: `${requestedCategory ?? ""}:${requestedSubtype ?? ""}`
    };
  }

  async function applyImportContext({ signal, isCurrent }) {
    const request = readRequestedContext();
    if (!request) {
      return;
    }

    const { requestedCategory, requestedSubtype } = request;
    if (
      root.dataset.suitemateV3ImportContext === "applied"
      && root.dataset.suitemateV3ImportContextKey === request.key
    ) {
      return;
    }

    root.dataset.suitemateV3ImportContext = "pending";
    root.dataset.suitemateV3ImportContextKey = request.key;

    if (!await waitForStepOne(signal)) {
      if (!signal.aborted && isCurrent()) {
        root.dataset.suitemateV3ImportContext = "unavailable";
      }
      return;
    }
    if (signal.aborted || !isCurrent()) {
      return;
    }

    const category = requestedCategory
      ?? core.resolveStaticCategory(requestedSubtype)
      ?? await findCategoryFromNetSuite(requestedSubtype, signal);
    if (signal.aborted || !isCurrent()) {
      return;
    }
    if (!category && requestedSubtype) {
      root.dataset.suitemateV3ImportContext = "unsupported";
      console.warn(`SuiteMate V3 could not determine the CSV Import category for ${requestedSubtype}.`);
      return;
    }

    const currentCategory = readFieldValue("recordtype");
    const currentSubtype = readFieldValue("recordsubtype");
    const firstValues = { charencoding: "UTF-8" };
    const categoryChanged = Boolean(category && category !== currentCategory);
    if (categoryChanged) {
      firstValues.recordtype = category;
    } else if (requestedSubtype && requestedSubtype !== readFieldValue("recordsubtype")) {
      firstValues.recordsubtype = requestedSubtype;
    }

    if (!await setImportValues(firstValues, signal) || signal.aborted || !isCurrent()) {
      if (!signal.aborted && isCurrent()) {
        root.dataset.suitemateV3ImportContext = "failed";
      }
      return;
    }

    if (categoryChanged && requestedSubtype) {
      const subtypeReady = await waitForSubtypeSource(
        requestedSubtype,
        currentSubtype,
        signal
      );
      if (signal.aborted || !isCurrent()) {
        return;
      }
      if (!subtypeReady) {
        root.dataset.suitemateV3ImportContext = "unavailable";
        return;
      }
      if (
        !await setImportValues({ recordsubtype: requestedSubtype }, signal)
        || signal.aborted
        || !isCurrent()
      ) {
        if (!signal.aborted && isCurrent()) {
          root.dataset.suitemateV3ImportContext = "failed";
        }
        return;
      }
    }

    document.querySelector('[name="inpt_recordtype"]')?.focus();
    root.dataset.suitemateV3ImportContext = "applied";
  }

  const lifecycleHandle = lifecycleApi.register({
    id: "import-assistant.context",
    replace: true,
    capability: routeApi.CAPABILITIES.IMPORT_ASSISTANT_CONTEXT,
    startPaused: true,
    async evaluate(context) {
      try {
        await applyImportContext(context);
      } catch (error) {
        if (!context.signal.aborted && context.isCurrent()) {
          root.dataset.suitemateV3ImportContext = "failed";
          console.error("SuiteMate V3 could not apply the CSV Import record context.", error);
        }
      }
    },
    cleanup() {
      if (root.dataset.suitemateV3ImportContext === "pending") {
        root.dataset.suitemateV3ImportContext = "canceled";
      }
    }
  });

  async function start() {
    const revision = settingsRevision;
    try {
      const settings = await settingsApi.get();
      if (revision !== settingsRevision) {
        return;
      }
      if (settings.enabled) {
        lifecycleHandle.resume("settings-enabled");
      } else {
        lifecycleHandle.pause("settings-disabled");
      }
    } catch {
      lifecycleHandle.pause("settings-failed");
    }
  }

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    const settingsChange = changes[settingsApi.STORAGE_KEY];
    if (areaName !== "sync" || !settingsChange) {
      return;
    }
    settingsRevision += 1;
    try {
      if (settingsApi.normalize(settingsChange.newValue).enabled) {
        lifecycleHandle.resume("settings-enabled");
      } else {
        lifecycleHandle.pause("settings-disabled");
      }
    } catch {
      lifecycleHandle.pause("settings-failed");
    }
  });

  start();
})(globalThis);
