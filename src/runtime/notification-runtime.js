(function initializeSuiteMateV3Notifications(global) {
  "use strict";

  const routeApi = global.SuiteMateV3Routes;
  const ALERT_SELECTOR = ".uir-alert-box";
  const CLOSE_EDGE_SIZE = 13.5;
  const CLOSE_TOP_SIZE = 15;
  const DISMISS_DELAY_MS = 300;
  const TOAST_DISMISS_DELAY_MS = 180;
  const TOAST_DURATION_MS = 5000;
  const TOAST_CONTAINER_ID = "suitemate-v3-toast-region";
  const TOAST_CLASS = "suitemate-v3-toast";
  const MAX_TOASTS = 4;
  const toastStates = new WeakMap();
  let toastSequence = 0;

  let topFrame = false;
  try {
    topFrame = global === global.top;
  } catch {}
  const pageContext = routeApi?.createPageContext(global.location, {
    isTopFrame: topFrame,
    trustedContentScript: true
  });
  if (!routeApi?.supports(routeApi.CAPABILITIES.NOTIFICATIONS, pageContext)) {
    return;
  }

  function isCloseHit(offsetX, offsetY, alertWidth, isMac) {
    const x = Number(offsetX);
    const y = Number(offsetY);
    const width = Number(alertWidth);
    if (![x, y, width].every(Number.isFinite) || width <= 0) {
      return false;
    }

    const edgeDistance = isMac ? x : width - x;
    return edgeDistance <= CLOSE_EDGE_SIZE && y <= CLOSE_TOP_SIZE;
  }

  function dismissAlert(alert) {
    if (!alert || alert.classList.contains("dismiss")) {
      return false;
    }

    alert.classList.add("dismiss");
    global.setTimeout(() => alert.remove(), DISMISS_DELAY_MS);
    return true;
  }

  function handleAlertClick(event) {
    const alert = event.target;
    const root = global.document?.documentElement;
    if (
      root?.classList.contains("ext-f")
      || !alert?.matches?.(ALERT_SELECTOR)
      || !isCloseHit(event.offsetX, event.offsetY, alert.offsetWidth, root?.classList.contains("mac"))
    ) {
      return;
    }

    dismissAlert(alert);
  }

  function normalizeToastType(type) {
    return ["success", "warning", "error", "info", "loading"].includes(type)
      ? type
      : "info";
  }

  function ensureToastContainer() {
    if (!topFrame || !pageContext.allowedNetSuite) {
      return null;
    }
    const existing = global.document?.getElementById?.(TOAST_CONTAINER_ID);
    if (existing) {
      return existing;
    }
    const target = global.document?.body ?? global.document?.documentElement;
    if (!target || !global.document?.createElement) {
      return null;
    }
    const container = global.document.createElement("section");
    container.id = TOAST_CONTAINER_ID;
    container.dataset.suitemateV3Ui = "toast-region";
    container.setAttribute("aria-label", "SuiteMate notifications");
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-relevant", "additions text");
    target.append(container);
    return container;
  }

  function clearToastTimer(toast) {
    const state = toastStates.get(toast);
    if (state?.timerId == null) {
      return;
    }
    global.clearTimeout(state.timerId);
    state.timerId = null;
  }

  function removeToast(toast, immediate = false) {
    if (!toast?.classList) {
      return false;
    }
    const remove = () => {
      clearToastTimer(toast);
      toastStates.delete(toast);
      toast.remove();
      const container = global.document?.getElementById?.(TOAST_CONTAINER_ID);
      if (container && container.childElementCount === 0) {
        container.remove();
      }
    };
    if (immediate) {
      remove();
      return true;
    }
    if (toast.dataset.suitemateV3Dismissing === "true") {
      return false;
    }
    toast.dataset.suitemateV3Dismissing = "true";
    clearToastTimer(toast);
    toast.classList.add("is-leaving");
    global.setTimeout(remove, TOAST_DISMISS_DELAY_MS);
    return true;
  }

  function scheduleToast(toast, durationMs) {
    const state = toastStates.get(toast);
    if (!state || durationMs <= 0 || toast.dataset.suitemateV3Dismissing === "true") {
      return;
    }
    state.remainingMs = durationMs;
    state.startedAt = Date.now();
    state.timerId = global.setTimeout(() => {
      state.timerId = null;
      removeToast(toast);
    }, durationMs);
  }

  function pauseToast(toast) {
    const state = toastStates.get(toast);
    if (state?.timerId == null) {
      return;
    }
    state.remainingMs = Math.max(
      250,
      state.remainingMs - (Date.now() - state.startedAt)
    );
    clearToastTimer(toast);
  }

  function resumeToast(toast) {
    const state = toastStates.get(toast);
    if (!state || state.timerId != null || state.remainingMs <= 0) {
      return;
    }
    scheduleToast(toast, state.remainingMs);
  }

  function showToast(message, options = {}) {
    const text = String(message ?? "").trim();
    const container = ensureToastContainer();
    if (!text || !container) {
      return null;
    }
    const type = normalizeToastType(options.type);
    const durationMs = type === "error" || type === "loading"
      ? 0
      : TOAST_DURATION_MS;

    while (container.childElementCount >= MAX_TOASTS) {
      removeToast(container.lastElementChild, true);
    }

    const toast = global.document.createElement("article");
    const icon = global.document.createElement("span");
    const body = global.document.createElement("div");
    const close = global.document.createElement("button");
    const id = `suitemate-v3-toast-${++toastSequence}`;

    toast.id = id;
    toast.className = TOAST_CLASS;
    toast.dataset.type = type;
    toast.dataset.suitemateV3Toast = "true";
    toast.setAttribute("role", type === "error" ? "alert" : "status");

    icon.className = "suitemate-v3-toast-icon";
    icon.textContent = type === "loading"
      ? ""
      : type === "success"
        ? "✓"
        : type === "warning" || type === "error"
          ? "!"
          : "i";
    icon.setAttribute("aria-hidden", "true");

    body.className = "suitemate-v3-toast-message";
    body.textContent = text;

    close.className = "suitemate-v3-toast-close";
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss notification");

    toast.append(icon, body, close);
    toastStates.set(toast, {
      timerId: null,
      remainingMs: durationMs,
      startedAt: 0
    });
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      removeToast(toast);
    });
    toast.addEventListener("mouseenter", () => pauseToast(toast));
    toast.addEventListener("mouseleave", () => resumeToast(toast));
    toast.addEventListener("focusin", () => pauseToast(toast));
    toast.addEventListener("focusout", (event) => {
      if (!toast.contains(event.relatedTarget)) {
        resumeToast(toast);
      }
    });
    container.prepend(toast);
    scheduleToast(toast, durationMs);

    return Object.freeze({
      id,
      dismiss: () => removeToast(toast)
    });
  }

  function clearToasts() {
    const container = global.document?.getElementById?.(TOAST_CONTAINER_ID);
    if (!container) {
      return;
    }
    [...container.children].forEach((toast) => removeToast(toast, true));
  }

  global.SuiteMateV3Notifications = Object.freeze({
    isCloseHit,
    dismissAlert,
    showToast,
    clearToasts
  });

  global.document?.addEventListener("click", handleAlertClick);
  global.addEventListener?.("pagehide", (event) => {
    if (!event.persisted) {
      clearToasts();
    }
  });
})(globalThis);
