(function installChromeStorageStub() {
  "use strict";

  const listeners = new Set();
  const params = new URLSearchParams(location.search);
  let settings = {
    enabled: params.get("enabled") !== "false",
    mode: ["light", "dark", "system"].includes(params.get("mode")) ? params.get("mode") : "light",
    squareCorners: params.get("squareCorners") === "true"
  };

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
    }
  };

  if (globalThis.chrome) {
    Object.defineProperty(globalThis.chrome, "storage", {
      configurable: true,
      value: chromeStub.storage
    });
  } else {
    globalThis.chrome = chromeStub;
  }
})();
