(function defineSuiteMateV3Lifecycle(globalScope) {
  "use strict";

  const VERSION = 1;
  const existing = globalScope.SuiteMateV3Lifecycle;
  if (existing?.VERSION === VERSION) {
    return;
  }

  existing?.disposeAll?.("module-replaced");

  const routeApi = globalScope.SuiteMateV3Routes;
  const documentRef = globalScope.document;
  const MutationObserverClass = globalScope.MutationObserver;
  const AbortControllerClass = globalScope.AbortController;
  const enqueueMicrotask = typeof globalScope.queueMicrotask === "function"
    ? globalScope.queueMicrotask.bind(globalScope)
    : (callback) => Promise.resolve().then(callback);
  const watchers = new Map();

  let sharedObserver = null;
  let observerConnected = false;
  let observerSignature = "";
  let pendingMutationRecords = [];
  let mutationFlushPending = false;
  let routeRefreshPending = false;
  let pendingRouteReason = "route";
  let forceRouteRefresh = false;
  let currentHref = readCurrentHref();
  let domReadyPromise = null;
  let windowLoadedPromise = null;

  function reportError(id, phase, error) {
    globalScope.console?.error?.(`SuiteMate V3 lifecycle ${phase} failed for ${id}.`, error);
  }

  function readCurrentHref() {
    return String(globalScope.location?.href ?? "");
  }

  function isTopFrame() {
    try {
      return globalScope === globalScope.top;
    } catch {
      return false;
    }
  }

  function createCurrentRouteContext() {
    return routeApi?.createPageContext?.(globalScope.location, {
      isTopFrame: isTopFrame(),
      trustedContentScript: true
    }) ?? null;
  }

  function isCapabilitySupported(watcher, routeContext = createCurrentRouteContext()) {
    return !watcher.capability
      || routeApi?.supports?.(watcher.capability, routeContext) === true;
  }

  function normalizeObserveOptions(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const options = {
      childList: value.childList === true,
      attributes: value.attributes === true,
      characterData: value.characterData === true,
      subtree: value.subtree === true
    };
    if (!options.childList && !options.attributes && !options.characterData) {
      return null;
    }
    if (options.attributes && Array.isArray(value.attributeFilter) && value.attributeFilter.length > 0) {
      options.attributeFilter = Object.freeze(
        [...new Set(value.attributeFilter.map(String))].sort()
      );
    }
    return Object.freeze(options);
  }

  function createObserverOptions(activeWatchers) {
    const options = {
      childList: activeWatchers.some((watcher) => watcher.observe.childList),
      attributes: activeWatchers.some((watcher) => watcher.observe.attributes),
      characterData: activeWatchers.some((watcher) => watcher.observe.characterData),
      subtree: activeWatchers.some((watcher) => watcher.observe.subtree)
    };

    const attributeWatchers = activeWatchers.filter((watcher) => watcher.observe.attributes);
    if (
      attributeWatchers.length > 0
      && attributeWatchers.every((watcher) => Array.isArray(watcher.observe.attributeFilter))
    ) {
      options.attributeFilter = [
        ...new Set(attributeWatchers.flatMap((watcher) => watcher.observe.attributeFilter))
      ].sort();
    }
    return options;
  }

  function updateDiagnostics() {
    const root = documentRef?.documentElement;
    if (!root?.dataset) {
      return;
    }

    root.dataset.suitemateV3Lifecycle = String(watchers.size);
    root.dataset.suitemateV3Observer = observerConnected ? "active" : "idle";
  }

  function isWatcherRunnable(watcher) {
    return watchers.get(watcher.id) === watcher
      && watcher.enabled
      && !watcher.satisfied
      && !watcher.disposed
      && !watcher.controller?.signal.aborted;
  }

  function matchesObserveOptions(record, options) {
    if (!options.subtree && record.target !== documentRef?.documentElement) {
      return false;
    }
    if (record.type === "childList") {
      return options.childList;
    }
    if (record.type === "characterData") {
      return options.characterData;
    }
    if (record.type !== "attributes" || !options.attributes) {
      return false;
    }
    return !options.attributeFilter || options.attributeFilter.includes(record.attributeName);
  }

  function rebuildSharedObserver() {
    const root = documentRef?.documentElement;
    const activeWatchers = [...watchers.values()].filter(
      (watcher) => isWatcherRunnable(watcher) && watcher.observe
    );

    if (!root || typeof MutationObserverClass !== "function" || activeWatchers.length === 0) {
      if (observerConnected) {
        const remainingRecords = sharedObserver?.takeRecords?.() ?? [];
        if (remainingRecords.length > 0) {
          handleMutations(remainingRecords);
        }
        sharedObserver?.disconnect();
      }
      observerConnected = false;
      observerSignature = "";
      updateDiagnostics();
      return;
    }

    const options = createObserverOptions(activeWatchers);
    const signature = JSON.stringify(options);
    if (!sharedObserver) {
      sharedObserver = new MutationObserverClass(handleMutations);
    }
    if (!observerConnected || signature !== observerSignature) {
      const remainingRecords = sharedObserver.takeRecords?.() ?? [];
      if (remainingRecords.length > 0) {
        handleMutations(remainingRecords);
      }
      sharedObserver.disconnect();
      sharedObserver.observe(root, options);
      observerConnected = true;
      observerSignature = signature;
    }
    updateDiagnostics();
  }

  function clearWatcherTimeout(watcher) {
    if (watcher.timeoutId !== null) {
      globalScope.clearTimeout(watcher.timeoutId);
      watcher.timeoutId = null;
    }
  }

  function invokeCleanup(watcher, reason) {
    if (typeof watcher.cleanup !== "function") {
      return;
    }
    try {
      const result = watcher.cleanup({ id: watcher.id, reason });
      if (result && typeof result.then === "function") {
        Promise.resolve(result).catch((error) => reportError(watcher.id, "cleanup", error));
        reportError(
          watcher.id,
          "cleanup",
          new TypeError("Lifecycle cleanup must be synchronous to prevent cross-generation races.")
        );
      }
    } catch (error) {
      reportError(watcher.id, "cleanup", error);
    }
  }

  function invalidateWatcher(watcher, reason, runCleanup) {
    const wasEnabled = watcher.enabled;
    watcher.enabled = false;
    watcher.satisfied = false;
    watcher.generation += 1;
    watcher.queuedGeneration = null;
    watcher.runningGeneration = null;
    watcher.pendingRecords = [];
    watcher.pendingReason = null;
    watcher.rerun = false;
    clearWatcherTimeout(watcher);
    watcher.controller?.abort(reason);
    watcher.controller = null;
    if (wasEnabled && runCleanup) {
      invokeCleanup(watcher, reason);
    }
  }

  function handleWatcherTimeout(watcher, generation) {
    if (!isCurrentGeneration(watcher, generation)) {
      return;
    }

    watcher.timeoutId = null;
    try {
      const result = watcher.onTimeout?.({
        id: watcher.id,
        signal: watcher.controller.signal,
        isCurrent: () => isCurrentGeneration(watcher, generation)
      });
      Promise.resolve(result).catch((error) => reportError(watcher.id, "timeout", error));
    } catch (error) {
      reportError(watcher.id, "timeout", error);
    }

    if (watcher.disposeOnTimeout) {
      disposeWatcher(watcher, "timeout");
      return;
    }

    watcher.satisfied = true;
    watcher.controller.abort("timeout");
    rebuildSharedObserver();
  }

  function startWatcherTimeout(watcher) {
    clearWatcherTimeout(watcher);
    if (!Number.isFinite(watcher.timeoutMs) || watcher.timeoutMs <= 0) {
      return;
    }
    const generation = watcher.generation;
    watcher.timeoutId = globalScope.setTimeout(
      () => handleWatcherTimeout(watcher, generation),
      watcher.timeoutMs
    );
  }

  function activateWatcher(watcher, reason) {
    if (watcher.disposed || watcher.manualPaused || !isCapabilitySupported(watcher)) {
      return;
    }

    watcher.enabled = true;
    watcher.satisfied = false;
    watcher.generation += 1;
    watcher.controller = new AbortControllerClass();
    watcher.pendingRecords = [];
    watcher.pendingReason = null;
    watcher.rerun = false;
    startWatcherTimeout(watcher);
    rebuildSharedObserver();
    scheduleWatcher(watcher, reason);
  }

  function resetWatcher(watcher, reason, routeContext) {
    const shouldEnable = !watcher.manualPaused && isCapabilitySupported(watcher, routeContext);
    if (watcher.enabled) {
      invalidateWatcher(watcher, reason, true);
    }
    if (shouldEnable) {
      activateWatcher(watcher, reason);
    } else {
      rebuildSharedObserver();
    }
  }

  function isCurrentGeneration(watcher, generation) {
    return isWatcherRunnable(watcher) && watcher.generation === generation;
  }

  function completeWatcher(watcher, generation) {
    if (!isCurrentGeneration(watcher, generation)) {
      return;
    }
    if (watcher.disposeOnMatch) {
      disposeWatcher(watcher, "matched");
      return;
    }
    watcher.satisfied = true;
    clearWatcherTimeout(watcher);
    watcher.controller.abort("matched");
    rebuildSharedObserver();
  }

  function scheduleWatcher(watcher, reason, records = []) {
    if (!isWatcherRunnable(watcher)) {
      return;
    }

    if (records.length > 0) {
      watcher.pendingRecords.push(...records);
    }
    watcher.pendingReason = watcher.pendingReason ?? reason;
    if (watcher.runningGeneration === watcher.generation) {
      watcher.rerun = true;
      return;
    }
    if (watcher.queuedGeneration === watcher.generation) {
      return;
    }

    const generation = watcher.generation;
    watcher.queuedGeneration = generation;
    enqueueMicrotask(() => runWatcher(watcher, generation));
  }

  async function runWatcher(watcher, generation) {
    if (watcher.queuedGeneration === generation) {
      watcher.queuedGeneration = null;
    }
    if (!isCurrentGeneration(watcher, generation)) {
      return;
    }

    const records = watcher.pendingRecords.splice(0);
    const reason = watcher.pendingReason ?? "mutation";
    watcher.pendingReason = null;
    watcher.rerun = false;
    watcher.runningGeneration = generation;

    let result = false;
    try {
      result = await watcher.evaluate({
        id: watcher.id,
        reason,
        records,
        signal: watcher.controller.signal,
        isCurrent: () => isCurrentGeneration(watcher, generation)
      });
    } catch (error) {
      reportError(watcher.id, "evaluation", error);
    } finally {
      if (watcher.runningGeneration === generation) {
        watcher.runningGeneration = null;
      }
    }

    if (!isCurrentGeneration(watcher, generation)) {
      return;
    }
    if (watcher.mode === "once" && result === true) {
      completeWatcher(watcher, generation);
      return;
    }
    if (watcher.rerun || watcher.pendingRecords.length > 0) {
      scheduleWatcher(watcher, "mutation");
    }
  }

  function flushMutationRecords() {
    mutationFlushPending = false;
    const records = pendingMutationRecords;
    pendingMutationRecords = [];

    for (const watcher of [...watchers.values()]) {
      if (!isWatcherRunnable(watcher) || !watcher.observe) {
        continue;
      }
      const relevantRecords = records.filter((record) =>
        matchesObserveOptions(record, watcher.observe));
      if (relevantRecords.length === 0) {
        continue;
      }
      if (typeof watcher.relevant === "function") {
        try {
          if (!watcher.relevant(relevantRecords)) {
            continue;
          }
        } catch (error) {
          reportError(watcher.id, "mutation filter", error);
          continue;
        }
      }
      scheduleWatcher(watcher, "mutation", relevantRecords);
    }
  }

  function handleMutations(records) {
    if (readCurrentHref() !== currentHref) {
      scheduleRouteRefresh("dom-route-change");
    }
    pendingMutationRecords.push(...records);
    if (mutationFlushPending) {
      return;
    }
    mutationFlushPending = true;
    enqueueMicrotask(flushMutationRecords);
  }

  function disposeWatcher(watcher, reason = "disposed") {
    if (watchers.get(watcher.id) !== watcher || watcher.disposed) {
      return false;
    }

    watchers.delete(watcher.id);
    watcher.disposed = true;
    invalidateWatcher(watcher, reason, true);
    rebuildSharedObserver();
    return true;
  }

  function pauseWatcher(watcher, reason = "paused") {
    if (watchers.get(watcher.id) !== watcher || watcher.manualPaused) {
      return false;
    }
    watcher.manualPaused = true;
    if (watcher.enabled) {
      invalidateWatcher(watcher, reason, true);
      rebuildSharedObserver();
    }
    return true;
  }

  function resumeWatcher(watcher, reason = "resumed") {
    if (watchers.get(watcher.id) !== watcher || watcher.disposed) {
      return false;
    }
    const wasPaused = watcher.manualPaused;
    watcher.manualPaused = false;
    if (!watcher.enabled && isCapabilitySupported(watcher)) {
      activateWatcher(watcher, reason);
    }
    return wasPaused;
  }

  function createHandle(watcher) {
    const handle = {
      pause: (reason) => pauseWatcher(watcher, reason),
      resume: (reason) => resumeWatcher(watcher, reason),
      dispose: (reason) => disposeWatcher(watcher, reason),
      isCurrent: () => watchers.get(watcher.id) === watcher && isWatcherRunnable(watcher)
    };
    Object.defineProperties(handle, {
      id: { value: watcher.id, enumerable: true },
      active: {
        enumerable: true,
        get: () => watchers.get(watcher.id) === watcher && isWatcherRunnable(watcher)
      },
      signal: {
        enumerable: true,
        get: () => watcher.controller?.signal ?? null
      }
    });
    return Object.freeze(handle);
  }

  function register(config) {
    if (!config || typeof config !== "object") {
      throw new TypeError("Lifecycle registration must be an object.");
    }

    const id = String(config.id ?? "").trim();
    if (!id) {
      throw new TypeError("Lifecycle registration requires a stable id.");
    }
    if (typeof config.evaluate !== "function") {
      throw new TypeError(`Lifecycle registration ${id} requires evaluate().`);
    }
    if (config.cleanup?.constructor?.name === "AsyncFunction") {
      throw new TypeError(`Lifecycle registration ${id} cleanup must be synchronous.`);
    }

    const existingWatcher = watchers.get(id);
    if (existingWatcher && config.replace !== true) {
      throw new Error(`Lifecycle registration ${id} already exists.`);
    }
    existingWatcher?.handle.dispose("replaced");
    const watcher = {
      id,
      capability: config.capability ?? null,
      mode: config.mode === "once" ? "once" : "continuous",
      observe: normalizeObserveOptions(config.observe),
      relevant: config.relevant,
      evaluate: config.evaluate,
      cleanup: config.cleanup,
      onTimeout: config.onTimeout,
      timeoutMs: Number(config.timeoutMs) || 0,
      disposeOnMatch: config.disposeOnMatch === true,
      disposeOnTimeout: config.disposeOnTimeout === true,
      manualPaused: config.startPaused === true,
      enabled: false,
      satisfied: false,
      disposed: false,
      generation: 0,
      controller: null,
      timeoutId: null,
      queuedGeneration: null,
      runningGeneration: null,
      pendingRecords: [],
      pendingReason: null,
      rerun: false,
      handle: null
    };
    watcher.handle = createHandle(watcher);
    watchers.set(id, watcher);
    if (!watcher.manualPaused && isCapabilitySupported(watcher)) {
      activateWatcher(watcher, "initial");
    } else {
      rebuildSharedObserver();
    }
    updateDiagnostics();
    return watcher.handle;
  }

  function waitFor(config) {
    if (!config || typeof config.test !== "function") {
      return Promise.reject(new TypeError("Lifecycle waitFor() requires test()."));
    }

    const id = String(config.id ?? "").trim();
    if (!id) {
      return Promise.reject(new TypeError("Lifecycle waitFor() requires a stable id."));
    }
    if (
      config.capability
      && !routeApi?.supports?.(config.capability, createCurrentRouteContext())
    ) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      let settled = false;
      let externalAbortListener = null;
      let handle = null;

      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        if (externalAbortListener) {
          config.signal?.removeEventListener?.("abort", externalAbortListener);
        }
        resolve(value);
      };

      handle = register({
        id,
        capability: config.capability,
        mode: "once",
        observe: config.observe ?? { childList: true, subtree: true },
        relevant: config.relevant,
        timeoutMs: config.timeoutMs,
        disposeOnMatch: true,
        disposeOnTimeout: true,
        async evaluate(context) {
          if (config.signal?.aborted) {
            finish(null);
            return true;
          }
          const value = await config.test(context);
          if (!context.isCurrent() || config.signal?.aborted || !value) {
            return false;
          }
          finish(value);
          return true;
        },
        onTimeout() {
          finish(null);
        },
        cleanup() {
          finish(null);
        }
      });

      if (config.signal) {
        externalAbortListener = () => {
          finish(null);
          handle.dispose("aborted");
        };
        if (config.signal.aborted) {
          externalAbortListener();
        } else {
          config.signal.addEventListener("abort", externalAbortListener, { once: true });
        }
      }
    });
  }

  function refreshRoute(reason = "route", force = false) {
    const nextHref = readCurrentHref();
    if (!force && nextHref === currentHref) {
      return false;
    }

    currentHref = nextHref;
    const routeContext = createCurrentRouteContext();
    for (const watcher of [...watchers.values()]) {
      resetWatcher(watcher, reason, routeContext);
    }
    return true;
  }

  function scheduleRouteRefresh(reason = "route", force = false) {
    pendingRouteReason = reason;
    forceRouteRefresh ||= force;
    if (routeRefreshPending) {
      return;
    }
    routeRefreshPending = true;
    enqueueMicrotask(() => {
      routeRefreshPending = false;
      const nextForce = forceRouteRefresh;
      forceRouteRefresh = false;
      refreshRoute(pendingRouteReason, nextForce);
    });
  }

  function dispose(id, reason = "disposed") {
    return watchers.get(String(id))?.handle.dispose(reason) ?? false;
  }

  function disposeAll(reason = "disposed-all") {
    for (const watcher of [...watchers.values()]) {
      disposeWatcher(watcher, reason);
    }
    pendingMutationRecords = [];
    mutationFlushPending = false;
    sharedObserver?.disconnect();
    observerConnected = false;
    observerSignature = "";
    updateDiagnostics();
  }

  function suspendAll(reason = "suspended") {
    for (const watcher of [...watchers.values()]) {
      if (watcher.enabled) {
        invalidateWatcher(watcher, reason, true);
      }
    }
    rebuildSharedObserver();
  }

  function getDiagnostics() {
    return Object.freeze({
      version: VERSION,
      watcherCount: watchers.size,
      activeWatcherCount: [...watchers.values()].filter(isWatcherRunnable).length,
      observerConnected,
      watcherIds: Object.freeze([...watchers.keys()].sort())
    });
  }

  function whenDomReady() {
    if (documentRef?.readyState !== "loading") {
      return Promise.resolve();
    }
    domReadyPromise ??= new Promise((resolve) => {
      documentRef.addEventListener("DOMContentLoaded", resolve, { once: true });
    });
    return domReadyPromise;
  }

  function whenWindowLoaded() {
    if (documentRef?.readyState === "complete") {
      return Promise.resolve();
    }
    windowLoadedPromise ??= whenDomReady().then(() => new Promise((resolve) => {
      if (documentRef?.readyState === "complete") {
        resolve();
      } else {
        globalScope.addEventListener("load", resolve, { once: true });
      }
    }));
    return windowLoadedPromise;
  }

  globalScope.addEventListener?.("popstate", () => scheduleRouteRefresh("popstate"));
  globalScope.addEventListener?.("hashchange", () => scheduleRouteRefresh("hashchange"));
  globalScope.addEventListener?.("pageshow", (event) =>
    scheduleRouteRefresh("pageshow", event?.persisted === true));
  globalScope.addEventListener?.("pagehide", (event) => {
    if (event?.persisted) {
      suspendAll("pagehide-persisted");
    } else {
      disposeAll("pagehide");
    }
  });

  globalScope.SuiteMateV3Lifecycle = Object.freeze({
    VERSION,
    register,
    waitFor,
    refreshRoute,
    dispose,
    disposeAll,
    getDiagnostics,
    whenDomReady,
    whenWindowLoaded
  });
  updateDiagnostics();
})(globalThis);
