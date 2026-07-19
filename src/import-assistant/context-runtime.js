(function initializeSuiteMateV3ImportAssistantContext(global) {
  "use strict";

  const core = global.SuiteMateV3ImportAssistantCore;
  const routeApi = global.SuiteMateV3Routes;
  const settingsApi = global.SuiteMateV3Settings;
  if (!core || !routeApi || !global.document || !global.location || !global.chrome?.runtime) {
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

  const params = new URLSearchParams(location.search);
  const requestedSubtype = core.normalizeImportValue(params.get("recordsubtype"));
  const requestedCategory = core.normalizeImportValue(params.get("recordtype"));
  if (params.get("recid") || (!requestedSubtype && !requestedCategory)) {
    return;
  }

  const root = document.documentElement;

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

  function waitForStepOne(timeoutMs = 30000) {
    if (isStepOneReady()) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (isStepOneReady()) {
          observer.disconnect();
          clearTimeout(timeoutId);
          resolve(true);
        }
      });
      const timeoutId = setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, timeoutMs);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  function hasSubtypeOption(recordSubtype) {
    return readFieldOptions("recordsubtype").some(({ value }) => value === recordSubtype);
  }

  function waitForSubtypeOption(recordSubtype, timeoutMs = 2500) {
    if (hasSubtypeOption(recordSubtype)) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (hasSubtypeOption(recordSubtype)) {
          observer.disconnect();
          clearTimeout(timeoutId);
          resolve(true);
        }
      });
      const timeoutId = setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, timeoutMs);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-options"],
        childList: true,
        subtree: true
      });
    });
  }

  async function findCategoryFromNetSuite(recordSubtype) {
    const categories = readFieldOptions("recordtype").map(({ value }) => value);
    const matches = await Promise.all(categories.map(async (category) => {
      try {
        const url = new URL(location.pathname, location.origin);
        url.searchParams.set("importmethod", "filegroups");
        url.searchParams.set("rectype", category);
        const response = await fetch(url, { credentials: "include" });
        return core.responseContainsSubtype(await response.text(), recordSubtype)
          ? category
          : null;
      } catch {
        return null;
      }
    }));
    return matches.find(Boolean) ?? null;
  }

  async function setImportValues(values) {
    const response = await chrome.runtime.sendMessage({
      type: core.SET_VALUES_MESSAGE,
      values
    });
    return response?.ok === true;
  }

  async function applyImportContext() {
    try {
      if (settingsApi?.get && (await settingsApi.get()).enabled === false) {
        return;
      }
    } catch {
      return;
    }

    if (!await waitForStepOne()) {
      root.dataset.suitemateV3ImportContext = "unavailable";
      return;
    }

    const category = requestedCategory
      ?? core.resolveStaticCategory(requestedSubtype)
      ?? await findCategoryFromNetSuite(requestedSubtype);
    if (!category && requestedSubtype) {
      root.dataset.suitemateV3ImportContext = "unsupported";
      console.warn(`SuiteMate V3 could not determine the CSV Import category for ${requestedSubtype}.`);
      return;
    }

    const currentCategory = readFieldValue("recordtype");
    const firstValues = { charencoding: "UTF-8" };
    const categoryChanged = Boolean(category && category !== currentCategory);
    if (categoryChanged) {
      firstValues.recordtype = category;
    } else if (requestedSubtype && requestedSubtype !== readFieldValue("recordsubtype")) {
      firstValues.recordsubtype = requestedSubtype;
    }

    if (!await setImportValues(firstValues)) {
      root.dataset.suitemateV3ImportContext = "failed";
      return;
    }

    if (categoryChanged && requestedSubtype) {
      await waitForSubtypeOption(requestedSubtype);
      if (!await setImportValues({ recordsubtype: requestedSubtype })) {
        root.dataset.suitemateV3ImportContext = "failed";
        return;
      }
    }

    document.querySelector('[name="inpt_recordtype"]')?.focus();
    root.dataset.suitemateV3ImportContext = "applied";
  }

  applyImportContext().catch((error) => {
    root.dataset.suitemateV3ImportContext = "failed";
    console.error("SuiteMate V3 could not apply the CSV Import record context.", error);
  });
})(globalThis);
