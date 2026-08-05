(function registerSuiteMateV3BrowserUtilities(globalScope) {
  "use strict";

  const VERSION = 1;
  const utilityApi = globalScope.SuiteMateV3Utilities;
  const MAX_CLIPBOARD_BYTES = 10000000;
  const NOTICE_TYPES = Object.freeze(["info", "success", "warning", "error", "loading"]);

  if (globalScope.SuiteMateV3BrowserUtilities !== undefined || !utilityApi) {
    return;
  }

  function success(value = {}) {
    return Object.freeze({ ok: true, ...value });
  }

  function failure(code, message, details = "") {
    return Object.freeze({
      ok: false,
      error: utilityApi.normalizeError({ code, message, details })
    });
  }

  function createClipboard(options = {}) {
    const clipboard = options.clipboard ?? globalScope.navigator?.clipboard;
    let disposed = false;

    function writeText(value) {
      if (disposed) {
        return Promise.resolve(failure(
          "CLIPBOARD_DISPOSED",
          "The clipboard adapter has been disposed."
        ));
      }
      const text = utilityApi.safeString(value);
      const byteLength = utilityApi.utf8ByteLength(text);
      if (byteLength > MAX_CLIPBOARD_BYTES) {
        return Promise.resolve(failure(
          "CLIPBOARD_TEXT_TOO_LARGE",
          `Clipboard text is limited to ${MAX_CLIPBOARD_BYTES.toLocaleString()} bytes.`
        ));
      }
      if (!clipboard || typeof clipboard.writeText !== "function") {
        return Promise.resolve(failure(
          "CLIPBOARD_UNAVAILABLE",
          "Clipboard access is unavailable in this browser context."
        ));
      }

      let pending;
      try {
        pending = clipboard.writeText(text);
      } catch (error) {
        return Promise.resolve(Object.freeze({
          ok: false,
          error: utilityApi.normalizeError(error, {
            fallbackCode: "CLIPBOARD_WRITE_FAILED",
            fallbackMessage: "The text could not be copied."
          })
        }));
      }

      return Promise.resolve(pending).then(
        () => disposed
          ? failure("CLIPBOARD_DISPOSED", "The clipboard adapter was disposed before completion.")
          : success({ method: "clipboard", byteLength }),
        (error) => disposed
          ? failure("CLIPBOARD_DISPOSED", "The clipboard adapter was disposed before completion.")
          : Object.freeze({
              ok: false,
              error: utilityApi.normalizeError(error, {
                fallbackCode: "CLIPBOARD_WRITE_FAILED",
                fallbackMessage: "The text could not be copied."
              })
            })
      );
    }

    function dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      return true;
    }

    return Object.freeze({ writeText, dispose });
  }

  function createDownload(options = {}) {
    const documentRef = options.documentRef ?? globalScope.document;
    const urlApi = options.urlApi ?? globalScope.URL;
    const BlobClass = options.BlobClass ?? globalScope.Blob;
    const setTimeoutFn = options.setTimeoutFn ?? globalScope.setTimeout;
    const clearTimeoutFn = options.clearTimeoutFn ?? globalScope.clearTimeout;
    const pendingRevocations = new Map();
    let disposed = false;

    function revoke(url) {
      const timer = pendingRevocations.get(url);
      if (timer !== undefined) {
        try {
          clearTimeoutFn?.(timer);
        } catch {}
        pendingRevocations.delete(url);
      }
      try {
        urlApi?.revokeObjectURL?.(url);
      } catch {}
    }

    function scheduleRevoke(url) {
      if (typeof setTimeoutFn !== "function") {
        revoke(url);
        return;
      }
      try {
        const timer = setTimeoutFn(() => revoke(url), 1000);
        pendingRevocations.set(url, timer);
      } catch {
        revoke(url);
      }
    }

    function downloadText(value, downloadOptions = {}) {
      if (disposed) {
        return failure("DOWNLOAD_DISPOSED", "The download adapter has been disposed.");
      }
      if (
        !documentRef?.createElement
        || !documentRef?.body?.append
        || typeof urlApi?.createObjectURL !== "function"
        || typeof urlApi?.revokeObjectURL !== "function"
        || typeof BlobClass !== "function"
      ) {
        return failure(
          "DOWNLOAD_UNAVAILABLE",
          "Downloads are unavailable in this browser context."
        );
      }

      const filename = utilityApi.files.sanitizeDownloadName(
        downloadOptions.filename,
        "download.txt"
      );
      const mimeType = typeof downloadOptions.mimeType === "string" && downloadOptions.mimeType.trim()
        ? downloadOptions.mimeType.trim().slice(0, 200)
        : "text/plain;charset=utf-8";
      const source = utilityApi.safeString(value);
      const text = downloadOptions.bom === true && !source.startsWith("\ufeff")
        ? `\ufeff${source}`
        : source;
      let url = "";
      let link;

      try {
        const blob = new BlobClass([text], { type: mimeType });
        url = urlApi.createObjectURL(blob);
        link = documentRef.createElement("a");
        link.href = url;
        link.download = filename;
        documentRef.body.append(link);
        link.click();
        link.remove();
        link = null;
        scheduleRevoke(url);
        return success({
          filename,
          mimeType,
          byteLength: utilityApi.utf8ByteLength(text)
        });
      } catch (error) {
        try {
          link?.remove?.();
        } catch {}
        if (url) {
          revoke(url);
        }
        return Object.freeze({
          ok: false,
          error: utilityApi.normalizeError(error, {
            fallbackCode: "DOWNLOAD_FAILED",
            fallbackMessage: "The download could not be started."
          })
        });
      }
    }

    function dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      for (const url of [...pendingRevocations.keys()]) {
        revoke(url);
      }
      return true;
    }

    return Object.freeze({ downloadText, dispose });
  }

  function createNotice(options = {}) {
    const element = options.element;
    const setTimeoutFn = options.setTimeoutFn ?? globalScope.setTimeout;
    const clearTimeoutFn = options.clearTimeoutFn ?? globalScope.clearTimeout;
    const defaultDuration = Number.isFinite(options.defaultDuration)
      ? Math.max(0, options.defaultDuration)
      : 0;
    const toggleHidden = options.toggleHidden !== false;
    let timer = null;
    let generation = 0;
    let disposed = false;

    function clearTimer() {
      if (timer !== null) {
        try {
          clearTimeoutFn?.(timer);
        } catch {}
        timer = null;
      }
    }

    function clear() {
      if (disposed || !element) {
        return false;
      }
      generation += 1;
      clearTimer();
      element.textContent = "";
      if (toggleHidden) {
        element.hidden = true;
      }
      return true;
    }

    function show(message = "", noticeOptions = {}) {
      if (disposed || !element) {
        return failure("NOTICE_UNAVAILABLE", "The notice target is unavailable.");
      }
      const text = utilityApi.safeString(message);
      if (!text) {
        clear();
        return success({ visible: false, type: "info" });
      }
      generation += 1;
      const operationGeneration = generation;
      clearTimer();
      const type = NOTICE_TYPES.includes(noticeOptions.type) ? noticeOptions.type : "info";
      const duration = Number.isFinite(noticeOptions.duration)
        ? Math.max(0, noticeOptions.duration)
        : defaultDuration;
      element.textContent = text;
      if (element.dataset) {
        element.dataset.type = type;
      }
      if (toggleHidden) {
        element.hidden = false;
      }
      if (duration > 0 && typeof setTimeoutFn === "function") {
        timer = setTimeoutFn(() => {
          if (!disposed && generation === operationGeneration) {
            timer = null;
            element.textContent = "";
            if (toggleHidden) {
              element.hidden = true;
            }
          }
        }, duration);
      }
      return success({ visible: true, type });
    }

    function dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      generation += 1;
      clearTimer();
      return true;
    }

    return Object.freeze({ show, clear, dispose });
  }

  function createModal(options = {}) {
    const dialog = options.dialog;
    const backgroundElements = Array.from(options.backgroundElements ?? []);
    const body = options.body ?? globalScope.document?.body;
    const bodyClass = typeof options.bodyClass === "string" ? options.bodyClass.trim() : "";
    const previousBackgroundState = new Map();
    let trigger = null;
    let open = false;
    let disposed = false;
    let dialogHadTabIndex = false;
    let dialogTabIndex = null;

    function isConnected(element) {
      try {
        return Boolean(element?.isConnected);
      } catch {
        return false;
      }
    }

    function focusableElements() {
      if (!dialog?.querySelectorAll) {
        return [];
      }
      return [...dialog.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((element) => !element.hidden && element.getAttribute?.("aria-hidden") !== "true");
    }

    function handleKeydown(event) {
      if (!open || event.key !== "Tab") {
        return;
      }
      const elements = focusableElements();
      if (!elements.length) {
        event.preventDefault();
        dialog.focus?.();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const activeElement = dialog.ownerDocument?.activeElement;
      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus?.();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus?.();
      }
    }

    function show(openOptions = {}) {
      if (disposed || !dialog || open) {
        return false;
      }
      trigger = openOptions.trigger ?? null;
      previousBackgroundState.clear();
      for (const element of backgroundElements) {
        if (!element) {
          continue;
        }
        previousBackgroundState.set(element, {
          inert: Boolean(element.inert),
          hadInert: element.hasAttribute?.("inert") === true,
          ariaHidden: element.getAttribute?.("aria-hidden")
        });
        element.inert = true;
        element.setAttribute?.("inert", "");
        element.setAttribute?.("aria-hidden", "true");
      }
      dialogHadTabIndex = dialog.hasAttribute?.("tabindex") === true;
      dialogTabIndex = dialog.getAttribute?.("tabindex");
      if (!dialogHadTabIndex) {
        dialog.setAttribute?.("tabindex", "-1");
      }
      dialog.hidden = false;
      if (bodyClass) {
        body?.classList?.add?.(bodyClass);
      }
      trigger?.setAttribute?.("aria-expanded", "true");
      dialog.addEventListener?.("keydown", handleKeydown);
      open = true;
      const initialFocus = openOptions.initialFocus;
      if (isConnected(initialFocus)) {
        initialFocus.focus?.();
      } else {
        const fallbackFocus = focusableElements()[0];
        if (fallbackFocus) {
          fallbackFocus.focus?.();
        } else {
          dialog.focus?.();
        }
      }
      return true;
    }

    function hide(closeOptions = {}) {
      if (!dialog || !open) {
        return false;
      }
      dialog.removeEventListener?.("keydown", handleKeydown);
      dialog.hidden = true;
      if (bodyClass) {
        body?.classList?.remove?.(bodyClass);
      }
      for (const [element, state] of previousBackgroundState) {
        element.inert = state.inert;
        if (state.hadInert) {
          element.setAttribute?.("inert", "");
        } else {
          element.removeAttribute?.("inert");
        }
        if (state.ariaHidden === null || state.ariaHidden === undefined) {
          element.removeAttribute?.("aria-hidden");
        } else {
          element.setAttribute?.("aria-hidden", state.ariaHidden);
        }
      }
      previousBackgroundState.clear();
      if (!dialogHadTabIndex) {
        dialog.removeAttribute?.("tabindex");
      } else if (dialogTabIndex !== null) {
        dialog.setAttribute?.("tabindex", dialogTabIndex);
      }
      trigger?.setAttribute?.("aria-expanded", "false");
      const focusTarget = trigger;
      trigger = null;
      open = false;
      if (closeOptions.restoreFocus !== false && isConnected(focusTarget)) {
        focusTarget.focus?.();
      }
      return true;
    }

    function dispose() {
      if (disposed) {
        return false;
      }
      hide({ restoreFocus: false });
      disposed = true;
      return true;
    }

    return Object.freeze({
      show,
      hide,
      dispose,
      isOpen: () => open
    });
  }

  const api = Object.freeze({
    VERSION,
    clipboard: Object.freeze({ create: createClipboard }),
    downloads: Object.freeze({ create: createDownload }),
    notices: Object.freeze({ create: createNotice }),
    modals: Object.freeze({ create: createModal })
  });

  Object.defineProperty(globalScope, "SuiteMateV3BrowserUtilities", {
    value: api,
    configurable: false,
    enumerable: true,
    writable: false
  });
})(globalThis);
