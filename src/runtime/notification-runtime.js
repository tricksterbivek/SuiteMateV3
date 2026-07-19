(function initializeSuiteMateV3Notifications(global) {
  "use strict";

  const routeApi = global.SuiteMateV3Routes;
  const ALERT_SELECTOR = ".uir-alert-box";
  const CLOSE_EDGE_SIZE = 13.5;
  const CLOSE_TOP_SIZE = 15;
  const DISMISS_DELAY_MS = 300;

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

  global.SuiteMateV3Notifications = Object.freeze({
    isCloseHit,
    dismissAlert
  });

  global.document?.addEventListener("click", handleAlertClick);
})(globalThis);
