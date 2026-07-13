(function installChromeStorageStub() {
  "use strict";

  const listeners = new Set();
  const messageListeners = new Set();
  const previewMessages = [];
  const suiteqlMessages = [];
  const params = new URLSearchParams(location.search);
  let settings = {
    enabled: params.get("enabled") !== "false",
    mode: ["light", "dark", "system"].includes(params.get("mode")) ? params.get("mode") : "light",
    squareCorners: params.get("squareCorners") === "true"
  };
  const roleKey = params.get("roleKey");
  const main = params.get("mainColor");
  const secondary = params.get("secondaryColor");

  if (roleKey && (main || secondary)) {
    settings.roleThemes = {
      [roleKey]: {
        name: "Fixture Role",
        ...(main ? { main } : {}),
        ...(secondary ? { secondary } : {})
      }
    };
  }

  function suiteqlRows(start, count) {
    return Array.from({ length: count }, (_, offset) => {
      const id = start + offset + 1;
      return {
        id,
        scriptid: id === 3 ? "=FORMULA_TEST" : `customrecord_fixture_${id}`,
        description: id % 9 === 0 ? null : `Fixture row ${id}`
      };
    });
  }

  async function handleSuiteQLMessage(message) {
    suiteqlMessages.push(JSON.parse(JSON.stringify(message)));
    document.documentElement.dataset.suiteqlMessageCount = String(suiteqlMessages.length);
    document.documentElement.dataset.suiteqlLastType = message.type ?? "";
    document.documentElement.dataset.suiteqlLastQuery = message.query ?? "";

    if (message.type === "SUITEMATE_V3_SUITEQL_DISPOSE") {
      return { ok: true, requestId: message.requestId, disposed: true };
    }
    if (message.type === "SUITEMATE_V3_SUITEQL_START") {
      if (/slow_query/i.test(message.query ?? "")) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
      if (/invalid_field/i.test(message.query ?? "")) {
        return {
          ok: false,
          requestId: message.requestId,
          error: { code: "SSS_SEARCH_ERROR_OCCURRED", message: "Field 'invalid_field' was not found.", details: "" }
        };
      }
      if (/empty_result/i.test(message.query ?? "")) {
        return {
          ok: true,
          requestId: message.requestId,
          columns: [],
          rows: [],
          elapsedMs: 8,
          paged: message.paged === true,
          pageIndex: 0,
          pageSize: message.paged ? 1000 : 0,
          loadedCount: 0,
          totalCount: 0,
          totalPages: 0
        };
      }

      const paged = message.paged === true;
      const rows = suiteqlRows(0, paged ? 1000 : /five_thousand/i.test(message.query ?? "") ? 5000 : 12);
      return {
        ok: true,
        requestId: message.requestId,
        columns: ["id", "scriptid", "description"],
        rows,
        elapsedMs: paged ? 42 : 16,
        paged,
        pageIndex: 0,
        pageSize: paged ? 1000 : rows.length,
        loadedCount: rows.length,
        totalCount: paged ? 2250 : rows.length,
        totalPages: paged ? 3 : 1
      };
    }
    if (message.type === "SUITEMATE_V3_SUITEQL_PAGE") {
      const start = message.pageIndex * 1000;
      const count = message.pageIndex === 2 ? 250 : 1000;
      return {
        ok: true,
        requestId: message.requestId,
        columns: ["id", "scriptid", "description"],
        rows: suiteqlRows(start, count),
        elapsedMs: 21,
        paged: true,
        pageIndex: message.pageIndex,
        pageSize: 1000,
        loadedCount: Math.min((message.pageIndex + 1) * 1000, 2250),
        totalCount: 2250,
        totalPages: 3
      };
    }
    return undefined;
  }

  const chromeStub = {
    storage: {
      sync: {
        async get(key) {
          return { [key]: settings };
        },
        async set(value) {
          const [key, nextSettings] = Object.entries(value)[0];
          const previousSettings = settings;
          settings = nextSettings;
          document.documentElement.dataset.storageWrites = String(
            Number(document.documentElement.dataset.storageWrites ?? 0) + 1
          );
          document.documentElement.dataset.storedMain = settings.roleThemes?.[roleKey]?.main ?? "";
          document.documentElement.dataset.storedSecondary = settings.roleThemes?.[roleKey]?.secondary ?? "";
          for (const listener of listeners) {
            listener({ [key]: { oldValue: previousSettings, newValue: settings } }, "sync");
          }
        }
      },
      onChanged: {
        addListener(listener) {
          listeners.add(listener);
        }
      }
    },
    runtime: {
      sendMessage: handleSuiteQLMessage,
      onMessage: {
        addListener(listener) {
          messageListeners.add(listener);
        }
      }
    },
    tabs: {
      async query() {
        return [{ id: 1, url: params.get("tabUrl") || "https://fixture.app.netsuite.com/app/center/card.nl" }];
      },
      async update(_tabId, updateProperties) {
        document.documentElement.dataset.suiteqlOpenedUrl = updateProperties?.url ?? "";
        return { id: 1, url: updateProperties?.url ?? "" };
      },
      async sendMessage(_tabId, message) {
        if (message?.type === "SUITEMATE_V3_PREVIEW_ROLE_THEME") {
          previewMessages.push(JSON.parse(JSON.stringify(message)));
          document.documentElement.dataset.previewCount = String(previewMessages.length);
          document.documentElement.dataset.previewRoleId = message.roleId ?? "";
          document.documentElement.dataset.previewMain = message.colors?.main ?? "";
          document.documentElement.dataset.previewSecondary = message.colors?.secondary ?? "";
          return { applied: true };
        }

        return {
          roleContext: roleKey
            ? { id: roleKey, name: "Fixture Company - Administrator", companyId: "FIXTURE", roleId: "3" }
            : null
        };
      }
    }
  };

  if (globalThis.chrome) {
    Object.defineProperty(globalThis.chrome, "storage", {
      configurable: true,
      value: chromeStub.storage
    });
    Object.defineProperty(globalThis.chrome, "runtime", {
      configurable: true,
      value: chromeStub.runtime
    });
    Object.defineProperty(globalThis.chrome, "tabs", {
      configurable: true,
      value: chromeStub.tabs
    });
  } else {
    globalThis.chrome = chromeStub;
  }

  globalThis.SuiteMateV3Fixture = {
    get settings() {
      return settings;
    },
    previewMessages,
    suiteqlMessages,
    dispatchRuntimeMessage(message) {
      let response;
      for (const listener of messageListeners) {
        listener(message, {}, (value) => {
          response = value;
        });
      }
      return response;
    }
  };
})();
