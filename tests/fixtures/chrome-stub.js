(function installChromeStorageStub() {
  "use strict";

  const listeners = new Set();
  const messageListeners = new Set();
  const previewMessages = [];
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
      onMessage: {
        addListener(listener) {
          messageListeners.add(listener);
        }
      }
    },
    tabs: {
      async query() {
        return [{ id: 1, url: "https://fixture.app.netsuite.com/app/center/card.nl" }];
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
