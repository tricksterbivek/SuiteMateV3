(function defineSuiteMateV3Permissions(globalScope) {
  "use strict";

  const VERSION = 1;
  const utilityApi = globalScope.SuiteMateV3Utilities;
  if (!utilityApi) {
    return;
  }
  const { deepFreeze } = utilityApi;

  const IDS = Object.freeze({
    BOOKMARKS: "bookmarks",
    CONTEXT_MENUS: "contextMenus",
    HISTORY: "history",
    SIDE_PANEL: "sidePanel"
  });

  const RAW_DEFINITIONS = [
    {
      id: IDS.BOOKMARKS,
      label: "Browser bookmarks",
      reason: "Allows opted-in features to maintain NetSuite account links and saved SuiteQL query references.",
      warning: "Chrome may ask to read and change your bookmarks.",
      featureIds: ["GEN-03", "BRW-07", "SQL-07"]
    },
    {
      id: IDS.CONTEXT_MENUS,
      label: "Context menu actions",
      reason: "Allows opted-in NetSuite search, edit and record-inspection actions in Chrome context menus.",
      warning: "Chrome may ask to add items to context menus.",
      featureIds: ["BRW-01", "BRW-02", "BRW-03"]
    },
    {
      id: IDS.HISTORY,
      label: "Browser history",
      reason: "Allows an opted-in SuiteQL history feature to find queries previously opened in NetSuite.",
      warning: "Chrome may ask to read and change your browsing history on all signed-in devices.",
      featureIds: ["SQL-08"]
    },
    {
      id: IDS.SIDE_PANEL,
      label: "Chrome Side Panel",
      reason: "Allows opted-in NetSuite inspection tools to open in Chrome's Side Panel.",
      warning: "Chrome may ask to enable the extension's Side Panel integration.",
      featureIds: ["BRW-03", "INS-01", "INS-02", "INS-03", "INS-04", "INS-05", "INS-06", "INS-07"]
    }
  ];

  const DEFINITIONS = deepFreeze(RAW_DEFINITIONS.map((definition) => ({
    ...definition,
    permissions: [definition.id]
  })));
  const DEFINITION_BY_ID = new Map(DEFINITIONS.map((definition) => [definition.id, definition]));

  function get(id) {
    return DEFINITION_BY_ID.get(id) ?? null;
  }

  function permissionError(code, message, permissionId = "") {
    const error = new Error(message);
    error.name = "SuiteMatePermissionError";
    error.code = code;
    error.permissionId = permissionId;
    return error;
  }

  function errorResult(id, code, message) {
    return deepFreeze({
      ok: false,
      id: typeof id === "string" ? id : "",
      error: { code, message }
    });
  }

  function stateResult(id, granted, changed = false) {
    const definition = get(id);
    return deepFreeze({
      ok: true,
      id,
      granted: granted === true,
      changed: changed === true,
      permissions: [...definition.permissions]
    });
  }

  function normalizeApiError(id, action, error) {
    const message = String(error?.message || error || `Chrome could not ${action} the optional permission.`);
    return errorResult(id, "OPTIONAL_PERMISSION_API_ERROR", message);
  }

  function create(options = {}) {
    const permissionsApi = options.permissionsApi ?? globalScope.chrome?.permissions;
    const logger = options.console ?? globalScope.console;
    const subscribers = new Set();
    let mutation = null;
    let disposed = false;
    let listening = false;

    function disposedResult(id, action) {
      return errorResult(
        id,
        "PERMISSION_BROKER_DISPOSED",
        `The optional permission broker was disposed before the ${action} completed.`
      );
    }

    function definitionOrFailure(id) {
      const definition = get(id);
      return definition ?? errorResult(
        id,
        "UNKNOWN_OPTIONAL_PERMISSION",
        "The requested optional permission is not registered by SuiteMate V3."
      );
    }

    function assertAvailable(id, methods) {
      if (disposed) {
        return errorResult(
          id,
          "PERMISSION_BROKER_DISPOSED",
          "The optional permission broker has been disposed."
        );
      }
      if (!permissionsApi || methods.some((method) => typeof permissionsApi[method] !== "function")) {
        return errorResult(
          id,
          "PERMISSIONS_API_UNAVAILABLE",
          "The Chrome optional permissions API is unavailable in this context."
        );
      }
      return null;
    }

    async function contains(id) {
      const definition = definitionOrFailure(id);
      if (!definition.id || definition.ok === false) {
        return definition;
      }
      const unavailable = assertAvailable(id, ["contains"]);
      if (unavailable) {
        return unavailable;
      }

      try {
        const granted = await permissionsApi.contains({ permissions: [...definition.permissions] });
        if (disposed) {
          return disposedResult(id, "permission check");
        }
        return stateResult(id, granted);
      } catch (error) {
        if (disposed) {
          return disposedResult(id, "permission check");
        }
        return normalizeApiError(id, "check", error);
      }
    }

    async function getSnapshot() {
      const unavailable = assertAvailable("", ["getAll"]);
      if (unavailable) {
        return unavailable;
      }

      try {
        const current = await permissionsApi.getAll();
        if (disposed) {
          return disposedResult("", "snapshot");
        }
        const grantedPermissions = new Set(
          Array.isArray(current?.permissions) ? current.permissions : []
        );
        const capabilities = {};
        for (const definition of DEFINITIONS) {
          capabilities[definition.id] = definition.permissions.every((permission) =>
            grantedPermissions.has(permission)
          );
        }
        return deepFreeze({
          ok: true,
          version: VERSION,
          capabilities
        });
      } catch (error) {
        if (disposed) {
          return disposedResult("", "snapshot");
        }
        return normalizeApiError("", "read", error);
      }
    }

    async function request(id) {
      const definition = definitionOrFailure(id);
      if (!definition.id || definition.ok === false) {
        return definition;
      }
      const unavailable = assertAvailable(id, ["contains", "request"]);
      if (unavailable) {
        return unavailable;
      }
      if (mutation) {
        return errorResult(
          id,
          "PERMISSION_MUTATION_BUSY",
          `Optional permission ${mutation.id} is already being changed.`
        );
      }

      const token = Object.freeze({ id, action: "request" });
      mutation = token;
      const descriptor = { permissions: [...definition.permissions] };
      let beforePromise;
      let requestPromise;
      try {
        // Consumers must call this from a direct extension-UI user gesture, not
        // relay it through the service worker. Both calls start before the first
        // await so Chrome retains the caller's user activation.
        beforePromise = Promise.resolve(permissionsApi.contains(descriptor));
        requestPromise = Promise.resolve(permissionsApi.request(descriptor));
      } catch (error) {
        void beforePromise?.catch(() => {});
        if (mutation === token) {
          mutation = null;
        }
        return normalizeApiError(id, "request", error);
      }

      try {
        const [before, requested] = await Promise.all([beforePromise, requestPromise]);
        if (disposed || mutation !== token) {
          return disposedResult(id, "request");
        }
        const granted = requested === true;
        return stateResult(id, granted, !before && granted);
      } catch (error) {
        if (disposed || mutation !== token) {
          return disposedResult(id, "request");
        }
        return normalizeApiError(id, "request", error);
      } finally {
        if (mutation === token) {
          mutation = null;
        }
      }
    }

    async function remove(id) {
      const definition = definitionOrFailure(id);
      if (!definition.id || definition.ok === false) {
        return definition;
      }
      const unavailable = assertAvailable(id, ["contains", "remove"]);
      if (unavailable) {
        return unavailable;
      }
      if (mutation) {
        return errorResult(
          id,
          "PERMISSION_MUTATION_BUSY",
          `Optional permission ${mutation.id} is already being changed.`
        );
      }

      const token = Object.freeze({ id, action: "remove" });
      mutation = token;
      try {
        const descriptor = { permissions: [...definition.permissions] };
        const before = await permissionsApi.contains(descriptor);
        if (disposed || mutation !== token) {
          return disposedResult(id, "removal");
        }
        const removed = await permissionsApi.remove(descriptor);
        if (disposed || mutation !== token) {
          return disposedResult(id, "removal");
        }
        return stateResult(id, before === true && removed !== true, before === true && removed === true);
      } catch (error) {
        if (disposed || mutation !== token) {
          return disposedResult(id, "removal");
        }
        return normalizeApiError(id, "remove", error);
      } finally {
        if (mutation === token) {
          mutation = null;
        }
      }
    }

    function affectedIds(change) {
      const changedPermissions = new Set(
        Array.isArray(change?.permissions) ? change.permissions : []
      );
      return DEFINITIONS
        .filter((definition) => definition.permissions.some((permission) =>
          changedPermissions.has(permission)
        ))
        .map((definition) => definition.id);
    }

    function emit(type, change) {
      const capabilityIds = affectedIds(change);
      if (!capabilityIds.length || disposed) {
        return;
      }
      const event = deepFreeze({
        type,
        capabilityIds,
        permissions: [...new Set(
          (Array.isArray(change?.permissions) ? change.permissions : [])
            .filter((permission) => DEFINITION_BY_ID.has(permission))
        )]
      });
      for (const subscriber of [...subscribers]) {
        try {
          subscriber(event);
        } catch (error) {
          logger?.error?.("SuiteMate V3 optional permission subscriber failed.", error);
        }
      }
    }

    const addedListener = (change) => emit("added", change);
    const removedListener = (change) => emit("removed", change);

    function startListening() {
      if (listening) {
        return null;
      }
      const unavailable = assertAvailable("", []);
      if (unavailable) {
        return unavailable;
      }
      if (
        typeof permissionsApi.onAdded?.addListener !== "function"
        || typeof permissionsApi.onAdded?.removeListener !== "function"
        || typeof permissionsApi.onRemoved?.addListener !== "function"
        || typeof permissionsApi.onRemoved?.removeListener !== "function"
      ) {
        return errorResult(
          "",
          "PERMISSION_EVENTS_UNAVAILABLE",
          "Chrome optional permission events are unavailable in this context."
        );
      }
      permissionsApi.onAdded.addListener(addedListener);
      permissionsApi.onRemoved.addListener(removedListener);
      listening = true;
      return null;
    }

    function stopListening() {
      if (!listening) {
        return;
      }
      permissionsApi.onAdded.removeListener(addedListener);
      permissionsApi.onRemoved.removeListener(removedListener);
      listening = false;
    }

    function subscribe(listener) {
      if (typeof listener !== "function") {
        throw permissionError(
          "INVALID_PERMISSION_SUBSCRIBER",
          "Optional permission subscribers must be functions."
        );
      }
      const failure = startListening();
      if (failure) {
        return deepFreeze({
          ok: false,
          error: failure.error,
          unsubscribe: () => false
        });
      }

      subscribers.add(listener);
      let active = true;
      return deepFreeze({
        ok: true,
        unsubscribe() {
          if (!active) {
            return false;
          }
          active = false;
          const removed = subscribers.delete(listener);
          if (!subscribers.size) {
            stopListening();
          }
          return removed;
        }
      });
    }

    function dispose() {
      if (disposed) {
        return false;
      }
      disposed = true;
      mutation = null;
      subscribers.clear();
      stopListening();
      return true;
    }

    return Object.freeze({
      contains,
      getSnapshot,
      request,
      remove,
      subscribe,
      dispose
    });
  }

  globalScope.SuiteMateV3Permissions = Object.freeze({
    VERSION,
    IDS,
    DEFINITIONS,
    get,
    create
  });
})(globalThis);
