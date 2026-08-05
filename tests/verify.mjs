import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));

function makeSandbox(globals, ...sources) {
  const sandbox = { ...globals };
  sandbox.globalThis = sandbox;
  for (const source of sources) {
    runInNewContext(source, sandbox);
  }
  return sandbox;
}

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, "SuiteMate V3");
assert.equal(manifest.version, "3.25.0");
assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
assert.equal(
  Object.hasOwn(manifest, "optional_permissions"),
  false,
  "Dormant optional permissions must ship only with their first user-facing consumer"
);
assert.deepEqual(manifest.host_permissions, ["https://*.netsuite.com/*"]);
assert.equal(manifest.background.service_worker, "src/background/service-worker.js");

const globalThemeContentScript = manifest.content_scripts.find((entry) =>
  entry.css?.includes("src/styles/netsuite.css")
);
assert.ok(globalThemeContentScript, "The global NetSuite theme content script is missing");
assert.deepEqual(globalThemeContentScript.matches, ["https://*.netsuite.com/*"]);
assert.equal(globalThemeContentScript.run_at, "document_start");
assert.equal(globalThemeContentScript.all_frames, true);
assert.deepEqual(globalThemeContentScript.css, [
  "src/styles/font.css",
  "src/styles/code.css",
  "src/styles/netsuite.css",
  "src/styles/radii.css",
  "src/styles/v3-compat.css",
  "src/styles/notifications.css",
  "src/internal-ids/internal-ids.css",
  "src/record-actions/csv-import.css",
  "src/so-columns/so-columns.css",
  "src/form-views/form-views.css",
  "src/edit-grid/edit-grid.css"
]);
assert.deepEqual(globalThemeContentScript.js, [
  "src/shared/utilities.js",
  "src/shared/routes.js",
  "src/shared/commands.js",
  "src/shared/bridge.js",
  "src/shared/lifecycle.js",
  "src/shared/settings.js",
  "src/internal-ids/core.js",
  "src/csv-export/core.js",
  "src/so-columns/core.js",
  "src/tab-title/core.js",
  "src/form-views/core.js",
  "src/edit-grid/core.js",
  "src/runtime/theme-runtime.js",
  "src/runtime/notification-runtime.js",
  "src/record-actions/core.js",
  "src/internal-ids/runtime.js",
  "src/record-actions/csv-import.js",
  "src/csv-export/runtime.js",
  "src/so-columns/runtime.js",
  "src/tab-title/runtime.js",
  "src/form-views/runtime.js",
  "src/edit-grid/runtime.js"
]);
assert.equal(
  globalThemeContentScript.js.includes("src/shared/permissions.js"),
  false,
  "The optional permission broker is unnecessarily injected into NetSuite pages"
);
const csvExportMainWorldScript = manifest.content_scripts.find((entry) =>
  entry.world === "MAIN" && entry.js?.includes("src/csv-export/main-world.js")
);
assert.equal(
  csvExportMainWorldScript,
  undefined,
  "CSV Export must not depend on unreliable manifest-level MAIN-world injection"
);
const suiteqlContentScript = manifest.content_scripts.find((entry) =>
  entry.js?.includes("dist/suiteql-studio.js")
);
assert.deepEqual(suiteqlContentScript?.js, [
  "src/shared/utilities.js",
  "src/shared/browser-utilities.js",
  "src/suiteql/core.js",
  "dist/suiteql-studio.js"
]);
const importAssistantContentScript = manifest.content_scripts.find((entry) =>
  entry.js?.includes("src/import-assistant/context-runtime.js")
);
assert.ok(importAssistantContentScript, "The CSV Import context content script is missing");
assert.deepEqual(importAssistantContentScript.matches, [
  "https://*.netsuite.com/app/setup/assistants/nsimport/importassistant.nl",
  "https://*.netsuite.com/app/setup/assistants/nsimport/importassistant.nl?*"
]);
assert.deepEqual(importAssistantContentScript.exclude_matches, [
  "https://www.netsuite.com/*",
  "https://*.extforms.netsuite.com/*"
]);
assert.deepEqual(importAssistantContentScript.js, [
  "src/import-assistant/core.js",
  "src/import-assistant/context-runtime.js"
]);
assert.equal(importAssistantContentScript.run_at, "document_idle");

const referencedFiles = new Set([
  ...Object.values(manifest.icons),
  manifest.action.default_popup,
  manifest.background.service_worker,
  ...Object.values(manifest.action.default_icon)
]);

for (const contentScript of manifest.content_scripts) {
  for (const file of [...(contentScript.css ?? []), ...(contentScript.js ?? [])]) {
    referencedFiles.add(file);
  }
}

for (const file of referencedFiles) {
  await access(resolve(root, file));
}

const utilitySource = await readFile(resolve(root, "src/shared/utilities.js"), "utf8");
const browserUtilitySource = await readFile(resolve(root, "src/shared/browser-utilities.js"), "utf8");
const popupHtml = await readFile(resolve(root, manifest.action.default_popup), "utf8");
const popupStyles = await readFile(resolve(root, "src/popup/popup.css"), "utf8");
assert.match(popupStyles, /:root\s*\{[\s\S]*?min-width:\s*360px/, "The Chrome popup root lacks an explicit minimum width");
assert.match(popupStyles, /body\s*\{[\s\S]*?width:\s*360px;[\s\S]*?min-width:\s*360px/, "The Chrome popup body can collapse below its intended width");
assert.doesNotMatch(popupStyles, /max-width:\s*100vw/, "Viewport-relative sizing can collapse the Chrome action popup");
assert.match(
  popupHtml,
  /<script src="\.\.\/shared\/utilities\.js"><\/script>[\s\S]*?<script src="\.\.\/shared\/browser-utilities\.js"><\/script>[\s\S]*?<script src="popup\.js"><\/script>/,
  "The popup cannot use the optional permission broker from direct user actions"
);
assert.equal((popupHtml.match(/class="role-color" type="hidden"/g) ?? []).length, 2, "The canonical Main and Secondary values changed");
assert.match(popupHtml, /id="mainColorTrigger"[^>]*aria-haspopup="dialog"/, "The Main unified picker trigger is missing");
assert.match(popupHtml, /id="secondaryColorTrigger"[^>]*aria-haspopup="dialog"/, "The Secondary unified picker trigger is missing");
assert.match(popupHtml, /<dialog\s+id="colorPickerModal"[\s\S]*?aria-labelledby="colorPickerTitle"/, "The unified picker is not a native dialog");
assert.match(popupHtml, /id="pickerMaterialShades"/, "Material shades are not contained inside the unified picker");
assert.match(popupHtml, /id="settingsTransfer"[\s\S]*?id="settingsBackupData"[\s\S]*?id="exportSettings"[\s\S]*?id="importSettings"/, "The settings backup controls are missing or out of order");
assert.match(popupHtml, /<script src="\.\.\/shared\/settings\.js"><\/script>\s*<script src="\.\.\/shared\/settings-transfer\.js"><\/script>/, "Settings transfer does not load after the schema authority");
assert.doesNotMatch(popupHtml, /type="color"|mainMaterialShades|secondaryMaterialShades/, "The separate or native picker UI remains active");
assert.doesNotMatch(popupHtml, /Generate|company logo|recommended pair/i, "A separate palette workflow remains in the popup");
assert.match(popupHtml, />SuiteQL Console</, "The popup does not use the SuiteQL Console name");
assert.doesNotMatch(popupHtml, /SuiteQL Studio/, "The old SuiteQL Studio name remains in the popup");
assert.match(
  popupHtml,
  /for="showInternalIds"[\s\S]*?>Show Internal IDs<[\s\S]*?id="showInternalIds"[^>]*type="checkbox"/,
  "The Internal IDs popup checkbox is missing"
);
for (const match of popupHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const reference = match[1];
  if (!reference.startsWith("#")) {
    await access(resolve(root, dirname(manifest.action.default_popup), reference));
  }
}

for (const fixture of [
  "tests/fixtures/classic.html",
  "tests/fixtures/redwood.html",
  "tests/fixtures/sales-order.html",
  "tests/fixtures/sales-order-edit.html",
  "tests/fixtures/import-assistant.html",
  "tests/fixtures/saved-search-results.html",
  "tests/fixtures/saved-search-edit.html",
  "tests/fixtures/popup-role.html",
  "tests/fixtures/theme-runtime.html",
  "tests/fixtures/suiteql-classic.html",
  "tests/fixtures/suiteql-redwood.html",
  "tests/fixtures/suiteql-normal-search.html",
  "tests/fixtures/route-classic.html"
]) {
  const html = await readFile(resolve(root, fixture), "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    if (
      !reference.startsWith("#") &&
      !reference.startsWith("data:") &&
      !reference.startsWith("/javascript/")
    ) {
      const target = reference.startsWith("/")
        ? resolve(root, `.${reference}`)
        : resolve(root, dirname(fixture), reference);
      await access(target);
    }
  }
}

const extensionSources = [
  "src/shared/utilities.js",
  "src/shared/browser-utilities.js",
  "src/shared/routes.js",
  "src/shared/commands.js",
  "src/shared/bridge.js",
  "src/shared/lifecycle.js",
  "src/shared/settings.js",
  "src/shared/settings-transfer.js",
  "src/internal-ids/core.js",
  "src/internal-ids/runtime.js",
  "src/internal-ids/internal-ids.css",
  "src/runtime/theme-runtime.js",
  "src/runtime/notification-runtime.js",
  "src/styles/notifications.css",
  "src/record-actions/core.js",
  "src/record-actions/csv-import.js",
  "src/record-actions/csv-import.css",
  "src/so-columns/core.js",
  "src/so-columns/runtime.js",
  "src/so-columns/so-columns.css",
  "src/edit-grid/core.js",
  "src/edit-grid/runtime.js",
  "src/edit-grid/edit-grid.css",
  "src/import-assistant/core.js",
  "src/import-assistant/context-runtime.js",
  "src/popup/popup.html",
  "src/popup/popup.css",
  "src/popup/popup.js",
  "src/palette/material-palette.js",
  "src/suiteql/core.js",
  "src/suiteql/studio-entry.js",
  "src/suiteql/studio.css",
  "src/background/service-worker.js"
];

for (const file of extensionSources) {
  const source = await readFile(resolve(root, file), "utf8");
  const sourceWithoutApprovedLinks = source.replaceAll("https://suitesense.vercel.app/", "");
  const sourceWithoutNetSuitePaymentRecords = sourceWithoutApprovedLinks.replace(
    /PAYMENTINSTRUMENTS|PAYMENTCARDTOKEN|PAYMENTCARD|PAYMENTITEM|CUSTOMERPAYMENT|VENDORPAYMENT/g,
    ""
  );
  assert.equal(/https?:\/\//.test(sourceWithoutApprovedLinks), false, `${file} contains an unapproved remote dependency`);
  assert.equal(
    /SuiteAdvanced|ExtPay|payment|license/i.test(sourceWithoutNetSuitePaymentRecords),
    false,
    `${file} contains an excluded V1 integration`
  );
}

const permissionBackgroundSource = await readFile(resolve(root, "src/background/service-worker.js"), "utf8");
assert.equal(
  permissionBackgroundSource.startsWith('importScripts(chrome.runtime.getURL("src/shared/utilities.js"));'),
  true,
  "The service worker does not initialize the pure utility foundation first"
);

for (const file of extensionSources) {
  const source = await readFile(resolve(root, file), "utf8");
  assert.doesNotMatch(
    source,
    /chrome\.permissions\.(?:contains|getAll|request|remove)/,
    `${file} requests optional permissions`
  );
}

assert.doesNotMatch(
  utilitySource,
  /\b(?:document|window|navigator|chrome)\b|innerHTML|createObjectURL|\bfetch\s*\(/,
  "The pure utility core has a browser or DOM initialization dependency"
);
assert.doesNotMatch(
  browserUtilitySource,
  /innerHTML|execCommand|chrome\.downloads|\bfetch\s*\(/,
  "Browser utilities contain unsafe HTML, deprecated copy fallback, broad downloads access, or network transport"
);
assert.match(browserUtilitySource, /clipboard\.writeText\(text\)/, "Clipboard writes are not started directly by the browser adapter");
assert.match(browserUtilitySource, /urlApi\?\.revokeObjectURL/, "Blob download URLs are not revoked");

const routeSource = await readFile(resolve(root, "src/shared/routes.js"), "utf8");
const routeSandbox = makeSandbox({ URL, URLSearchParams }, routeSource);
const routeApi = routeSandbox.SuiteMateV3Routes;

const commandSource = await readFile(resolve(root, "src/shared/commands.js"), "utf8");
assert.doesNotMatch(commandSource, /function deepFreeze/, "Commands retain a private deep-freeze implementation");
const commandSandbox = makeSandbox({
  URL,
  URLSearchParams,
  SuiteMateV3Routes: routeApi,
  navigator: { platform: "MacIntel" },
  console
}, utilitySource, commandSource);
const commandApi = commandSandbox.SuiteMateV3Commands;
assert.equal(commandApi.VERSION, 2);
assert.equal(commandApi.IDS.SUITEQL_EXECUTE, "suiteql.execute");
assert.equal(commandApi.IDS.POPUP_OPEN_SUITEQL, "popup.open-suiteql");
assert.equal(commandApi.IDS.RECORD_CSV_IMPORT, "record.csv-import");
assert.equal(commandApi.IDS.RECORD_CSV_EXPORT, "record.csv-export");
assert.equal(commandApi.IDS.RECORD_CSV_TEMPLATE, "record.csv-template");
assert.equal(commandApi.IDS.RECORD_CSV_EXPORT_VIEW, "record.csv-export-view");
assert.equal(commandApi.IDS.SETTINGS_EXPORT_BACKUP, "settings.export-backup");
assert.equal(commandApi.IDS.SETTINGS_IMPORT_BACKUP, "settings.import-backup");
assert.equal(Object.isFrozen(commandApi.DEFINITIONS), true);
assert.equal(
  commandApi.getShortcut(commandApi.IDS.SUITEQL_EXECUTE).editor,
  "Mod-e"
);
assert.equal(
  commandApi.getShortcut(commandApi.IDS.SUITEQL_ABORT).editor,
  "Escape"
);

const bridgeSource = await readFile(resolve(root, "src/shared/bridge.js"), "utf8");
assert.match(bridgeSource, /utilityApi\.utf8ByteLength\(serialized\)/, "The bridge bypasses the shared UTF-8 byte counter");
assert.match(bridgeSource, /routeApi\?\.isAllowedSender/, "The typed bridge bypasses the route registry");
assert.match(bridgeSource, /UNKNOWN_BRIDGE_COMMAND/, "Unknown bridge commands are not rejected");
assert.match(bridgeSource, /UNSUPPORTED_BRIDGE_VERSION/, "Bridge protocol versions are not enforced");
assert.match(bridgeSource, /BRIDGE_RESPONSE_MISMATCH/, "Stale bridge responses are not rejected");
assert.match(bridgeSource, /DUPLICATE_BRIDGE_REQUEST/, "Duplicate in-flight bridge requests are not rejected");
assert.doesNotMatch(bridgeSource, /PlatformClientScriptHandler|queryApiBridge|N\/currentRecord/, "The shared bridge contains feature-specific NetSuite adapters");
const bridgeSandbox = makeSandbox({
  URL,
  URLSearchParams,
  AbortController,
  setTimeout,
  clearTimeout,
  SuiteMateV3Routes: routeApi
}, utilitySource, bridgeSource);
const bridgeApi = bridgeSandbox.SuiteMateV3Bridge;
assert.equal(bridgeApi.VERSION, 2);
assert.equal(bridgeApi.COMMANDS.SUITEQL_START, "suiteql.start");
assert.equal(bridgeApi.COMMANDS.RECORD_GET_TYPE, "record.getType");
assert.equal(bridgeApi.COMMANDS.RECORD_EXPORT_CSV, "record.exportCsv");
assert.equal(
  bridgeApi.COMMANDS.IMPORT_ASSISTANT_SET_VALUES,
  "importAssistant.setValues"
);

const themeRuntimeSource = await readFile(resolve(root, "src/runtime/theme-runtime.js"), "utf8");
assert.match(themeRuntimeSource, /routeApi\.createPageContext\(location/, "The theme runtime does not use the route registry");
assert.match(themeRuntimeSource, /lifecycleApi\.register/, "The theme runtime bypasses the shared observer lifecycle");
assert.doesNotMatch(themeRuntimeSource, /new MutationObserver/, "The theme runtime retains direct observer ownership");
assert.match(themeRuntimeSource, /routeApi\.serializeParams\(context, \["suiteql"\]\)/, "Route metadata is not centralized");
assert.doesNotMatch(themeRuntimeSource, /function normalizePath|function hasPath|function pathStartsWith/, "Duplicated route helpers remain in the theme runtime");
assert.match(themeRuntimeSource, /setClass\("sfc", enabled\)/, "V1 frozen-column styling is not enabled");
assert.match(themeRuntimeSource, /setClass\("sln", enabled\)/, "V1 sublist line-number styling is not enabled");
assert.match(
  themeRuntimeSource,
  /setClass\("disable_radii", enabled && value\.squareCorners\)/,
  "The V1 Boxy UI class is not driven by the global radius setting"
);
assert.match(
  themeRuntimeSource,
  /message\?\.type === settingsApi\.THEME_PREVIEW_MESSAGE/,
  "Live theme preview messages are not handled"
);
const popupSource = await readFile(resolve(root, "src/popup/popup.js"), "utf8");
assert.match(popupSource, /browserUtilityApi\.notices\.create/, "Popup status bypasses the shared notice controller");
assert.match(popupSource, /addEventListener\("input"/, "Color input does not trigger live preview");
assert.match(popupSource, /addEventListener\("pagehide"/, "Pending live colors are not flushed when the popup closes");
assert.match(popupSource, /commandApi\.createScope\(commandApi\.SURFACES\.POPUP/, "The popup does not use the shared command scope");
assert.match(popupSource, /createStudioUrl\(activeNetSuiteTab\?\.url\)/, "The popup does not build the account-scoped Studio URL");
assert.match(popupSource, /chrome\.tabs\.update/, "The popup does not open Studio in the active tab");
assert.match(
  popupSource,
  /paletteApi\.generateMaterialShades\(seed\)/,
  "Material shades are not derived from the unified picker's active color"
);
assert.match(
  popupSource,
  /activePicker\.input\.value = hex;[\s\S]*?handleLiveColorInput\(activePicker\.input\)/,
  "Unified picker changes do not use the existing live preview flow"
);
assert.match(popupSource, /requestAnimationFrame/, "Pointer movement is not coalesced before live preview");
assert.match(popupSource, /saveRoleColors\(\{ \[picker\.colorName\]: picker\.input\.value \}\)/, "Closing the unified picker does not flush its final value");
assert.match(
  popupSource,
  /colorPickerModal\.showModal\(\)/,
  "The unified picker does not open through the native dialog top layer"
);
assert.match(
  popupSource,
  /commandScope\.bindShortcuts\(\s*document,\s*\[COMMANDS\.THEME_APPLY_AND_CLOSE_PICKER\]/,
  "The unified picker Escape shortcut bypasses the shared command dispatcher"
);
assert.doesNotMatch(popupSource, /companyLogo|logoPixel|generateLogo|recommendedPalette/i, "Logo-specific palette code remains in the popup");
assert.doesNotMatch(themeRuntimeSource, /companyLogo|logoPixel|LOGO_MAX/i, "Logo-specific palette code remains in the NetSuite runtime");
assert.match(popupSource, /api\.ensureCurrentSchema\(\)/, "The popup does not intentionally persist legacy settings migration");
assert.match(popupSource, /transferApi\.create\(currentSettings\)/, "Popup export bypasses the validated settings transfer core");
assert.match(popupSource, /transferApi\.parse\(settingsBackupData\.value\)/, "Popup import bypasses the validated settings transfer core");
assert.match(popupSource, /window\.confirm\(/, "Settings import does not require overwrite confirmation");
assert.match(popupSource, /settingsClipboard\.writeText\(backup\)/, "Settings export does not use the shared clipboard adapter");
assert.match(popupSource, /settingsLocked = true/, "Settings failures do not lock the popup");
assert.doesNotMatch(popupSource, /chrome\.storage\.sync\.set/, "The popup bypasses the versioned settings API");
assert.match(themeRuntimeSource, /isSettingsVersionError\(error\)/, "The theme runtime does not safely handle future settings");

const internalIdsCoreSource = await readFile(resolve(root, "src/internal-ids/core.js"), "utf8");
const internalIdsRuntimeSource = await readFile(resolve(root, "src/internal-ids/runtime.js"), "utf8");
assert.match(
  internalIdsRuntimeSource,
  /capability: routeApi\.CAPABILITIES\.INTERNAL_IDS/,
  "Internal IDs bypasses the route capability registry"
);
assert.match(
  internalIdsRuntimeSource,
  /lifecycleApi\.register/,
  "Internal IDs bypasses the shared observer lifecycle"
);
assert.match(
  internalIdsRuntimeSource,
  /settings\.showInternalIds/,
  "Internal IDs is not driven by the popup setting"
);
assert.match(
  internalIdsRuntimeSource,
  /bridgeApi\.COMMANDS\.RECORD_GET_TYPE/,
  "Internal IDs bypasses the typed record-type bridge fallback"
);
assert.match(
  internalIdsRuntimeSource,
  /badge\.textContent = normalized/,
  "Internal ID badges are not rendered as inert text"
);
assert.doesNotMatch(
  `${internalIdsCoreSource}\n${internalIdsRuntimeSource}`,
  /innerHTML|new MutationObserver|Ctrl\s*\+\s*I|addEventListener\(["']keydown/,
  "Internal IDs contains unsafe HTML, direct observer ownership or the rejected keyboard shortcut"
);

const suiteqlStudioSource = await readFile(resolve(root, "src/suiteql/studio-entry.js"), "utf8");
assert.match(
  suiteqlStudioSource,
  /commandApi\.createScope\(commandApi\.SURFACES\.SUITEQL/,
  "SuiteQL Console does not use the shared command scope"
);
assert.match(
  suiteqlStudioSource,
  /commandApi\.createEditorKeyBindings/,
  "SuiteQL Console shortcuts are not derived from the command registry"
);
assert.match(
  suiteqlStudioSource,
  /UI_COMMANDS\.SUITEQL_EXECUTE,\s*\{\s*allowReentry:\s*true/,
  "SuiteQL Execute cannot restart immediately after Abort"
);
assert.match(
  suiteqlStudioSource,
  /UI_COMMANDS\.SUITEQL_LOAD_NEXT_PAGE,\s*\{\s*allowReentry:\s*true/,
  "Progressive paging can remain locked after Abort"
);
assert.match(
  suiteqlStudioSource,
  /addEventListener\("pagehide", \(event\)[\s\S]*?if \(!event\.persisted\) \{\s*void disposeRequest\(state\.requestId\);\s*commandScope\.dispose\(\)/,
  "SuiteQL Console disposes request state during a bfcache navigation"
);
assert.doesNotMatch(
  suiteqlStudioSource,
  /addEventListener\("keydown"/,
  "SuiteQL Console installs a second global keyboard dispatcher"
);

assert.doesNotMatch(
  commandSource,
  /PlatformClientScriptHandler|N\/query|chrome\.runtime|chrome\.scripting|\bfetch\s*\(/,
  "The UI command registry is coupled to privileged NetSuite transport"
);

const notificationRuntimeSource = await readFile(resolve(root, "src/runtime/notification-runtime.js"), "utf8");
let notificationClickHandler;
let notificationRemoved = false;
const notificationClasses = new Set();
const notificationRootClasses = new Set();
const notificationSandbox = makeSandbox({
  SuiteMateV3Routes: routeApi,
  location: {
    pathname: "/app/center/card.nl",
    search: "",
    hash: "",
    hostname: "fixture.app.netsuite.com",
    origin: "https://fixture.app.netsuite.com"
  },
  document: {
    documentElement: {
      classList: {
        contains: (name) => notificationRootClasses.has(name)
      }
    },
    addEventListener(type, handler) {
      if (type === "click") {
        notificationClickHandler = handler;
      }
    }
  },
  setTimeout(callback) {
    callback();
    return 1;
  }
});
notificationSandbox.top = notificationSandbox;
runInNewContext(notificationRuntimeSource, notificationSandbox);
const notificationApi = notificationSandbox.SuiteMateV3Notifications;

assert.equal(notificationApi.isCloseHit(390, 10, 400, false), true);
assert.equal(notificationApi.isCloseHit(10, 10, 400, true), true);
assert.equal(notificationApi.isCloseHit(200, 10, 400, false), false);
assert.equal(notificationApi.isCloseHit(390, 40, 400, false), false);
const notificationAlert = {
  offsetWidth: 400,
  matches: (selector) => selector === ".uir-alert-box",
  classList: {
    contains: (name) => notificationClasses.has(name),
    add: (name) => notificationClasses.add(name)
  },
  remove() {
    notificationRemoved = true;
  }
};
notificationClickHandler({ target: notificationAlert, offsetX: 390, offsetY: 10 });
assert.equal(notificationClasses.has("dismiss"), true, "Alert dismissal animation is not applied");
assert.equal(notificationRemoved, true, "Alert is not removed after clicking the V1 close target");
assert.match(notificationRuntimeSource, /\.uir-alert-box/, "The global NetSuite alert selector is missing");
assert.match(notificationRuntimeSource, /classList\.contains\("mac"\)/, "The macOS left-side close target is not supported");
assert.match(notificationRuntimeSource, /showToast/, "The right-side toast API is missing");
assert.match(notificationRuntimeSource, /body\.textContent = text/, "Toast messages are not rendered as plain text");
assert.match(notificationRuntimeSource, /MAX_TOASTS = 4/, "Toast stacking is not bounded");
assert.match(notificationRuntimeSource, /TOAST_DURATION_MS = 5000/, "Non-error toasts do not use the required five-second lifetime");
assert.match(notificationRuntimeSource, /type === "error" \|\| type === "loading"/, "Loading feedback is not persistent");
assert.match(notificationRuntimeSource, /container\.prepend\(toast\)/, "Newest toast notifications are not placed at the top");
assert.match(notificationRuntimeSource, /container\.lastElementChild/, "Toast overflow does not remove the oldest notification");
assert.match(notificationRuntimeSource, /mouseenter[\s\S]*?pauseToast/, "Toast auto-dismiss does not pause for reading");
assert.match(notificationRuntimeSource, /aria-label", "Dismiss notification"/, "Toast notifications lack an accessible close action");
assert.doesNotMatch(notificationRuntimeSource, /salesord|searchresults|data-path/, "Notification dismissal contains page-specific behavior");
assert.doesNotMatch(notificationRuntimeSource, /innerHTML/, "Toast notifications can interpret arbitrary HTML");

const notificationStyles = await readFile(resolve(root, "src/styles/notifications.css"), "utf8");
assert.match(notificationStyles, /position:\s*fixed/, "Toast notifications are not viewport-positioned");
assert.match(notificationStyles, /right:\s*16px/, "Toast notifications are not aligned to the right side");
assert.match(notificationStyles, /top:\s*16px/, "Toast notifications are not aligned to the top of the viewport");
assert.match(notificationStyles, /z-index:\s*2147483000/, "Toast notifications can be hidden behind NetSuite overlays");
assert.match(notificationStyles, /prefers-reduced-motion/, "Toast animations ignore reduced-motion preferences");
assert.match(notificationStyles, /\[data-type=loading\][\s\S]*?suitemate-v3-toast-spin/, "Loading feedback lacks a progress indicator");
assert.doesNotMatch(notificationStyles, /html:not\(\.ext-f\)/, "Owned toast styles are incorrectly disabled by a NetSuite page class");

const recordActionsCoreSource = await readFile(resolve(root, "src/record-actions/core.js"), "utf8");
assert.doesNotMatch(recordActionsCoreSource, /isAllowedSender/, "Record actions retain a duplicate sender policy");
assert.doesNotMatch(recordActionsCoreSource, /hostname\.endsWith|extforms\.netsuite/, "Record actions retain a duplicate host policy");
const recordActionsSandbox = makeSandbox({ URL, URLSearchParams, SuiteMateV3Routes: routeApi }, recordActionsCoreSource);
const recordActionsCore = recordActionsSandbox.SuiteMateV3RecordActionsCore;

assert.equal(recordActionsCore.normalizeRecordType(" SalesOrder "), "salesorder");
assert.equal(recordActionsCore.normalizeRecordType("clientScript"), "script");
assert.equal(recordActionsCore.normalizeRecordType("-1"), null);
assert.equal(recordActionsCore.deriveImportSubtype("salesorder", "sale"), "salesorder");
assert.equal(recordActionsCore.deriveImportSubtype("noninventoryitem", "Sale"), "noninventorysaleitem");
assert.equal(recordActionsCore.deriveImportSubtype("otherchargeitem", "purchase"), "otherchargepurchaseitem");
assert.equal(recordActionsCore.deriveImportSubtype("serviceitem", "resale"), "serviceresaleitem");
assert.equal(
  recordActionsCore.createCsvImportUrl("salesorder", "https://123456.app.netsuite.com"),
  "/app/setup/assistants/nsimport/importassistant.nl?recordsubtype=salesorder"
);

function createRecordDocument(values, fieldHelpOnclick = "") {
  return {
    querySelector(selector) {
      if (selector.includes("nlFieldHelp")) {
        return fieldHelpOnclick
          ? { getAttribute: () => fieldHelpOnclick }
          : null;
      }
      return Object.hasOwn(values, selector) ? { value: values[selector] } : null;
    }
  };
}

assert.equal(
  recordActionsCore.resolveRecordTypeFromDocument(
    createRecordDocument({ "#baserecordtype": "salesorder" }),
    "/app/accounting/transactions/salesord.nl"
  ),
  "salesorder"
);
assert.equal(
  recordActionsCore.resolveRecordTypeFromDocument(
    createRecordDocument({ "#searchtype": "Opprtnty" }),
    "/app/common/search/search.nl"
  ),
  "opportunity"
);
assert.equal(
  recordActionsCore.resolveRecordTypeFromDocument(
    createRecordDocument({}, "return nlFieldHelp('field', 'label', 'customrecord_fixture');")
  ),
  "customrecord_fixture"
);
const csvImportSource = await readFile(resolve(root, "src/record-actions/csv-import.js"), "utf8");
assert.match(csvImportSource, /className = "suitemate-v3-csv-utils-cell"/, "CSV Utils is not emitted as one toolbar menu");
assert.match(csvImportSource, /textContent = "CSV Utils"/, "The CSV Utils parent label is missing");
assert.match(csvImportSource, /"csv-utils-export"/, "CSV Utils does not expose Export");
assert.match(csvImportSource, /"csv-utils-import"/, "CSV Utils does not expose Import");
assert.match(csvImportSource, /"csv-utils-template"/, "CSV Utils does not expose Template");
assert.match(csvImportSource, /className = "ns-menuitem suitemate-v3-csv-utils-option"/, "CSV Utils does not use native NetSuite menu items");
assert.match(csvImportSource, /applyMetadata\(link, commandId/, "CSV Utils children do not use shared command metadata");
assert.match(csvImportSource, /createScope\(commandApi\.SURFACES\.RECORD/, "CSV Utils does not use a record command scope");
assert.match(csvImportSource, /commandScope\.invoke\(/, "CSV Import bypasses click-time command authority");
assert.match(csvImportSource, /csvExport\.runtime\.v3/, "CSV Utils is not connected to the isolated CSV Export runtime");
assert.match(csvImportSource, /\.uir-buttons-top\.uir-header-buttons/, "The top record toolbar target is missing");
assert.match(csvImportSource, /actionsCell\.after\(createToolbarMenu\(href\)\)/, "CSV Utils is not inserted immediately after Actions");
assert.match(csvImportSource, /data-suitemate-v3-action/, "CSV Utils injection is not idempotent");
assert.match(csvImportSource, /lifecycleApi\.register/, "CSV Utils bypasses the shared observer lifecycle");
assert.match(csvImportSource, /COMMANDS\.RECORD_GET_TYPE/, "CSV Import bypasses the typed NetSuite bridge");
assert.match(csvImportSource, /signal\.aborted \|\| !isCurrent\(\)/, "CSV Import does not reject stale asynchronous installation");
assert.doesNotMatch(csvImportSource, /new MutationObserver/, "CSV Utils retains direct observer ownership");
assert.doesNotMatch(csvImportSource, /Scripted Record|getRecordTypes|PlatformClientScriptHandler/, "CSV Import copied unrelated V1 dependencies");

const csvImportStyles = await readFile(resolve(root, "src/record-actions/csv-import.css"), "utf8");
assert.match(csvImportStyles, /--theme-secondary-light/, "CSV Utils does not use the active SuiteMate theme");
assert.match(csvImportStyles, /--suitemate-radius-overlay/, "CSV Utils does not use the global overlay radius");
assert.match(csvImportStyles, /:focus-visible/, "CSV Utils lacks a keyboard focus state");
assert.match(csvImportStyles, /\[data-open=true\]>.suitemate-v3-csv-utils-dropdown/, "CSV Utils does not expose its explicit open state");
assert.doesNotMatch(csvImportStyles, /:hover>.suitemate-v3-csv-utils-dropdown/, "CSV Utils still opens on hover");
assert.doesNotMatch(csvImportStyles, /:focus-within>.suitemate-v3-csv-utils-dropdown/, "CSV Utils still opens on focus without activation");
assert.doesNotMatch(csvImportSource, /addEventListener\("pointer(?:enter|leave)"/, "CSV Utils still binds hover-open listeners");

const csvExportCoreSource = await readFile(resolve(root, "src/csv-export/core.js"), "utf8");
const csvExportMainWorldSource = await readFile(resolve(root, "src/csv-export/main-world.js"), "utf8");
const csvExportRuntimeSource = await readFile(resolve(root, "src/csv-export/runtime.js"), "utf8");
assert.match(csvExportCoreSource, /FORMULA_PREFIX/, "CSV Export does not neutralize spreadsheet formulas");
assert.match(csvExportCoreSource, /join\("\\r\\n"\)/, "CSV Export does not generate RFC 4180 line endings");
assert.match(csvExportCoreSource, /replace\(\/\\r\\n\?\|\\n\/g, " "\)/, "CSV Export does not normalize multiline values");
assert.doesNotMatch(csvExportCoreSource, /JSON\.stringify\(value\)/, "CSV Export can serialize raw record objects");
assert.match(csvExportMainWorldSource, /\["N\/record", "N\/currentRecord"\]/, "CSV Export does not use the proof-of-concept record APIs");
assert.match(csvExportMainWorldSource, /recordModule\.load\.promise/, "CSV Export does not use supported asynchronous record loading");
assert.match(csvExportMainWorldSource, /UI_ONLY_FIELD_PATTERN/, "CSV Export does not reject page-only HTML controls");
assert.match(csvExportMainWorldSource, /\|\| !normalizedLabel/, "CSV Export can expose unlabeled internal fields");
const csvExportBodyValueSource = csvExportMainWorldSource.match(
  /function safeTextValue[\s\S]*?\n  }\n\n  function safeSublistTextValue/
)?.[0] ?? "";
const csvExportLineValueSource = csvExportMainWorldSource.match(
  /function safeSublistTextValue[\s\S]*?\n  }\n\n  function safeIdentifierValue/
)?.[0] ?? "";
assert.doesNotMatch(csvExportBodyValueSource, /getValue/, "CSV Export body text falls back to raw values");
assert.doesNotMatch(csvExportLineValueSource, /getSublistValue/, "CSV Export line text falls back to raw values");
assert.match(
  csvExportMainWorldSource,
  /safeIdentifierValue\(recordRef, "externalid"\)/,
  "CSV Export does not include the targeted record External ID"
);
assert.match(
  csvExportMainWorldSource,
  /safeIdentifierValue\(recordRef, "entity"\)/,
  "CSV Export does not include the targeted entity Internal ID"
);
assert.match(
  csvExportMainWorldSource,
  /sourceFieldId: "item"[\s\S]*?valueMode: "identifier"/,
  "CSV Export does not include the targeted item Internal ID"
);
assert.match(csvExportMainWorldSource, /revokeObjectURL/, "CSV Export leaks Blob download URLs");
assert.match(csvExportRuntimeSource, /csvExport\.runtime\.v3/, "CSV Export does not expose its isolated runtime contract");
assert.match(csvExportRuntimeSource, /\{ mode \}/, "CSV Export does not send its explicit export or template mode");
assert.match(csvExportRuntimeSource, /commandScope\.invoke\(command/, "CSV Export bypasses command authority");
assert.match(csvExportRuntimeSource, /COMMANDS\.RECORD_EXPORT_CSV/, "CSV Export bypasses the typed NetSuite bridge");
assert.match(csvExportRuntimeSource, /bridgeApi\.toCommandResult/, "CSV Export does not normalize typed bridge responses");
assert.doesNotMatch(csvExportRuntimeSource, /CustomEvent|REQUEST_EVENT|RESULT_EVENT/, "CSV Export UI retains a direct main-world event bridge");
assert.match(csvExportRuntimeSource, /notificationApi\.showToast\(message/, "CSV Export does not use the shared toast notification API");
assert.match(
  csvExportRuntimeSource,
  /Exporting CSV\. Larger exports may take a moment\.[\s\S]*?"loading"[\s\S]*?await bridgeApi\.request/,
  "CSV Export does not show persistent progress before starting the bridge request"
);
assert.match(csvExportRuntimeSource, /progressToast\?\.dismiss\(\)[\s\S]*?showExportResult/, "CSV Export does not replace progress with its final status");
assert.doesNotMatch(csvExportRuntimeSource, /uir-alert-box|#div__alert/, "CSV Export still renders an inline NetSuite alert");
assert.doesNotMatch(csvExportRuntimeSource, /lifecycleApi|new MutationObserver|innerHTML/, "CSV Export owns UI lifecycle or renders arbitrary HTML");
assert.doesNotMatch(
  `${csvExportCoreSource}\n${csvExportMainWorldSource}\n${csvExportRuntimeSource}`,
  /chrome\.storage\.(?:sync|local)\.(?:set|remove)|localStorage|sessionStorage|fetch\(|XMLHttpRequest/,
  "CSV Export persists record data or makes external requests"
);

const salesOrderFixtureSource = await readFile(resolve(root, "tests/fixtures/sales-order.html"), "utf8");
assert.match(salesOrderFixtureSource, /id="main_form"[\s\S]*?id="baserecordtype"[^>]+value="salesorder"/, "The CSV Import fixture lacks record context");
assert.match(salesOrderFixtureSource, /class="fixture-actions uir-buttons-top uir-header-buttons"[\s\S]*?class="uir-button-menu"[\s\S]*?>Actions</, "The CSV Import fixture lacks the top Actions toolbar control");

const importAssistantCoreSource = await readFile(resolve(root, "src/import-assistant/core.js"), "utf8");
assert.doesNotMatch(importAssistantCoreSource, /isAllowedSender/, "Import Assistant retains a duplicate sender policy");
assert.doesNotMatch(importAssistantCoreSource, /hostname\.endsWith|extforms\.netsuite/, "Import Assistant retains a duplicate host policy");
const importAssistantSandbox = makeSandbox({ URL, SuiteMateV3Routes: routeApi }, importAssistantCoreSource);
const importAssistantCore = importAssistantSandbox.SuiteMateV3ImportAssistantCore;
assert.equal(importAssistantCore.resolveStaticCategory("salesorder"), "TRANSACTION");
assert.equal(importAssistantCore.resolveStaticCategory("noninventorysaleitem"), "ITEM");
assert.equal(importAssistantCore.resolveStaticCategory("customrecord_example"), "CUSTOMRECORD");
assert.equal(importAssistantCore.resolveStaticCategory("customtransaction_example"), "TRANSACTION");
assert.equal(importAssistantCore.resolveStaticCategory("currencyrate"), null);
assert.deepEqual(
  JSON.parse(JSON.stringify(importAssistantCore.parseOptionsData('[{"value":"TRANSACTION","text":"Transactions"}]'))),
  [{ value: "TRANSACTION", text: "Transactions" }]
);
assert.deepEqual(
  JSON.parse(JSON.stringify(importAssistantCore.normalizeFieldValues({
    charencoding: "UTF-8",
    recordtype: "transaction",
    recordsubtype: "salesorder",
    arbitrary: "blocked"
  }))),
  { charencoding: "UTF-8", recordtype: "TRANSACTION", recordsubtype: "SALESORDER" }
);
const importAssistantUrl = "https://123456.app.netsuite.com/app/setup/assistants/nsimport/importassistant.nl?recordsubtype=salesorder";
const importContextSource = await readFile(resolve(root, "src/import-assistant/context-runtime.js"), "utf8");
const dataAdapterSource = await readFile(resolve(root, "src/netsuite/data-adapter.js"), "utf8");
assert.match(importContextSource, /charencoding: "UTF-8"/, "CSV Import does not default to UTF-8");
assert.match(importContextSource, /waitForSubtypeSource/, "Dependent CSV Import subtype sourcing is not handled");
assert.match(importContextSource, /lifecycleApi\.waitFor/, "Import Assistant waits bypass the shared observer lifecycle");
assert.match(importContextSource, /COMMANDS\.IMPORT_ASSISTANT_SET_VALUES/, "Import Assistant bypasses the typed NetSuite bridge");
assert.match(importContextSource, /suitemateV3ImportContext = "pending"/, "Import Assistant lacks a pending execution sentinel");
assert.doesNotMatch(importContextSource, /new MutationObserver/, "Import Assistant retains direct observer ownership");
assert.match(importContextSource, /data-name=|\[data-name=/, "CSV Import option metadata is not used");
assert.match(importContextSource, /COMMANDS\.IMPORT_ASSISTANT_RESOLVE_CATEGORY/, "Unknown CSV record types bypass the typed adapter");
assert.doesNotMatch(importContextSource, /\bfetch\(/, "Import Assistant still owns an authenticated fetch");
assert.match(dataAdapterSource, /importmethod", "filegroups"/, "Unknown CSV record types cannot resolve their category");
assert.doesNotMatch(importContextSource, /mapper_grp|Start Over|recid.*new/, "Unrelated Import Assistant features were migrated");

const importFixtureSource = await readFile(resolve(root, "tests/fixtures/import-assistant.html"), "utf8");
assert.match(importFixtureSource, /recordsubtype=salesorder/, "The Import Assistant fixture does not carry record context");
assert.match(importFixtureSource, /name="recordtype"[^>]+value="ACCOUNTING"/, "The Import Assistant fixture lacks the native category field");
assert.match(importFixtureSource, /name="recordsubtype"[^>]+value="ACCOUNT"/, "The Import Assistant fixture lacks the native subtype field");

const compatibilityStyles = await readFile(resolve(root, "src/styles/v3-compat.css"), "utf8");
// Read for the sheet-equality pin below: the active-tab treatment is stated in
// both sheets and the two must agree value-for-value.
const netsuiteStyles = await readFile(resolve(root, "src/styles/netsuite.css"), "utf8");
const radiusStyles = await readFile(resolve(root, "src/styles/radii.css"), "utf8");
assert.match(
  compatibilityStyles,
  /--suitemate-v3-subtab-bg: var\(--theme-secondary-light\)/,
  "Nested subtab surfaces are not controlled by the Secondary Color"
);
assert.match(
  compatibilityStyles,
  /\.uir-subtab-panel-tabs,[\s\S]*?\.uir-subtab-panel-tabs>\.bgsubtabbar,[\s\S]*?\.uir-subtab-panel-tabs-row,[\s\S]*?\.uir-list-control-bar[\s\S]*?background-color: var\(--suitemate-v3-subtab-bg\) !important/,
  "Native role colors can leak through shared nested-subtab surfaces"
);
assert.doesNotMatch(
  compatibilityStyles,
  /\.uir-subtab-panel-tabs-row>\.bgsubtabbar/,
  "The nested-subtab background selector points at a child that does not exist"
);
for (const [token, value] of Object.entries({
  "--suitemate-radius-control": "3px",
  "--suitemate-radius-compact": "4px",
  "--suitemate-radius-surface": "5px",
  "--suitemate-radius-overlay": "8px",
  "--suitemate-radius-dialog": "10px",
  "--suitemate-radius-pill": "20px"
})) {
  assert.equal(radiusStyles.includes(`${token}: ${value};`), true, `${token} changed from the V1 radius scale`);
}
assert.match(
  radiusStyles,
  /html:not\(\.ext-f\)\.disable_radii[\s\S]*?--suitemate-radius-surface: 0px/,
  "Boxy UI does not disable the global radius tokens"
);
assert.match(
  radiusStyles,
  /--nsn-uif-redwood-border-rounded-corners: var\(--suitemate-radius-surface\)/,
  "The V1 surface radius is not mapped to Redwood controls"
);
assert.match(
  radiusStyles,
  /:is\(\.uir-tab-list, \.n-w-tab-list\.style-standalone, \[data-widget=ScrollTabList\]\)/,
  "Primary NetSuite tab containers do not use the global surface radius"
);
assert.match(
  radiusStyles,
  /:is\(div\.bgsubtabbar, \.uir-subtab-panel-tabs\)/,
  "Nested NetSuite tab containers do not use the global surface radius"
);
assert.match(
  radiusStyles,
  /:is\(\.uir-list-body, \.uir-list-table-container, \.uir-machine-table-container\)/,
  "NetSuite list and machine-table containers do not use the global surface radius"
);
assert.match(
  radiusStyles,
  /:is\(\.uir-popup, \.uir-menu, \.page-title-menu \.ns-menu, \.n-w-window\[data-role=contextmenu\]\)/,
  "NetSuite overlays do not use the V1 overlay radius"
);
assert.match(
  radiusStyles,
  /\[data-widget=Popover\]:has\(\[data-widget=Menu\]\[role=menu\]\)/,
  "Redwood navigation popovers do not use the V1 overlay radius"
);
assert.match(
  radiusStyles,
  /\[data-widget=Popover\][\s\S]*?border-radius: var\(--suitemate-radius-overlay\) !important/,
  "Redwood's generated navigation styles can override the V1 overlay radius"
);
assert.match(
  radiusStyles,
  /:is\(\.ddmDivButtonY, \.ddmDivButtonG\)/,
  "Legacy NetSuite navigation dropdowns do not use the V1 overlay radius"
);
assert.match(
  radiusStyles,
  /:is\([\s\S]*?input\.input:not\(\[type=button\]\)[\s\S]*?\.uir-input-dropdown-native[\s\S]*?\.uir-select-input-container>input[\s\S]*?border-radius: var\(--suitemate-radius-surface\) !important/,
  "Editable NetSuite fields do not use the global V1 surface radius"
);
assert.match(
  radiusStyles,
  /:is\(\.uir-alert-box, \.n-w-window--modal\)/,
  "NetSuite dialogs do not use the V1 dialog radius"
);
assert.doesNotMatch(
  radiusStyles,
  /data-path=|salesord\.nl|search\.nl|suiteql/,
  "The radius layer contains page-specific styling"
);
assert.match(
  compatibilityStyles,
  /border-radius: var\(--suitemate-radius-surface\) var\(--suitemate-radius-surface\) 0 0/,
  "Field-group radii do not use the global V1 surface token"
);
assert.match(
  compatibilityStyles,
  /--suitemate-v3-table-header-bg: var\(--theme-secondary-light\)/,
  "Global NetSuite table headers are not controlled by Secondary"
);
assert.match(
  compatibilityStyles,
  /:is\(\.uir-list-headerrow, \.uir-list-header-td, \.uir-machine-headerrow>td\)/,
  "The global table-header selector is missing"
);
assert.match(
  compatibilityStyles,
  /\.uir-list-body \.uir-list-headerrow>td\.uir-list-header-td,[\s\S]*?\.uir-machine-table-container \.uir-machine-headerrow>td[\s\S]*?border-bottom: 1px solid var\(--suitemate-v3-table-header-border\) !important/,
  "Global NetSuite table-header borders are not controlled by Secondary"
);
assert.match(
  compatibilityStyles,
  /\.uir-machine-table-container \.uir-machine-table \.uir-machine-headerrow>td[\s\S]*?--table-border-color: var\(--suitemate-v3-table-header-border\)[\s\S]*?border-bottom: 1px solid var\(--suitemate-v3-table-header-border\) !important/,
  "Editable NetSuite machine-table borders are not controlled by Secondary"
);
assert.match(
  compatibilityStyles,
  /\.uir-machine-table-container \{\s+--sln-header-bg-color: var\(--suitemate-v3-table-header-bg\)/,
  "Sublist line-number headers are not controlled by Secondary"
);
assert.match(
  compatibilityStyles,
  /\.uir-tab-list-tabs \.formtabon \{\s+border-bottom: 3px solid var\(--theme-main\) !important/,
  "The active global NetSuite tab accent is not derived from Main"
);
assert.match(
  compatibilityStyles,
  /\.uir-subtab-panel-tabs-row \.formsubtabon \{\s+border-bottom: 3px solid var\(--theme-main\) !important/,
  "The active nested-subtab accent is not derived from Main"
);
assert.match(
  compatibilityStyles,
  /html:not\(\.ext-f\) \.uir-tab-list-tabs \.formtaboff,[\s\S]*?background-color: var\(--theme-main\) !important/,
  "Inactive global NetSuite tabs are not controlled by Main"
);
assert.match(
  compatibilityStyles,
  /html:not\(\.ext-f\) \.uir-tab-list-tabs \.formtabon \{\s+background-color: color-mix\(in srgb, var\(--theme-main\) 68%, #fff\) !important/,
  "The active global NetSuite tab surface is not the owner's 68% theme tint"
);
assert.match(
  compatibilityStyles,
  /--suitemate-v3-subtab-active-bg: color-mix\(in srgb, var\(--theme-main\) 68%, #fff\)/,
  "The active nested subtab is not the owner's 68% theme tint"
);
assert.match(
  compatibilityStyles,
  /\.uir-tab-list-tabs>\.bgtabbar/,
  "The global NetSuite tab bar background is not controlled by Main"
);
assert.match(
  compatibilityStyles,
  /\.uir-tab-list-tabs \.uir-unroll-tabs-button[\s\S]*?background-color: var\(--theme-main\) !important/,
  "The global NetSuite tab overflow control is not controlled by Main"
);
assert.match(
  compatibilityStyles,
  /\.uir-tab-list>\.uir-unroll-tabs-button[\s\S]*?background-color: var\(--theme-main\) !important/,
  "The legacy NetSuite tab overflow control is not controlled by Main"
);
assert.match(
  compatibilityStyles,
  /\.uir-subtab-panel-tabs-row \.formsubtaboff[\s\S]*?background-color: var\(--suitemate-v3-subtab-bg\) !important/,
  "Inactive nested NetSuite tabs are not controlled by Secondary Light"
);
assert.match(
  compatibilityStyles,
  /\.uir-subtab-panel-tabs-row \.formsubtabon \{\s+background-color: var\(--suitemate-v3-subtab-active-bg\) !important/,
  "The active nested NetSuite tab does not use the shared subtab-active token"
);

// ===== Active-tab sheet equality =====
// The active-tab treatment is stated in THREE places on purpose: netsuite.css
// scopes it to a container set, netsuite.css states it again bare for strips that
// set does not reach, and v3-compat.css states it a third time because that sheet
// loads last and is what a page actually renders. Three copies is the deliberate
// design — one sheet winning by load order must produce the same pixels as another
// winning by specificity — but three copies is also three chances to drift.
//
// These assertions COMPARE THE SHEETS TO EACH OTHER rather than describe any one
// of them, which is the difference that matters: the checks above pin v3-compat's
// derivation, and every one of them would still have passed while netsuite.css
// said something else. That is not hypothetical — this round shipped an accent
// that rendered 3px from one sheet and 2px from another, because only one site
// carried the width. A divergence now names the site that moved.
// Scans EVERY rule with this selector and keeps the LAST one that sets the
// property, because that is the one the page gets: v3-compat states the surface
// and the accent under one identical selector, and between two equal-specificity
// blocks the cascade takes the later. Returning the first read a declaration that
// does not render — an appended duplicate saying something else passed this pin
// while the browser painted the duplicate, which is the exact drift these
// assertions exist to catch.
// CEILING, stated so the claim matches the mechanism: "last" means the last
// block whose selector head is EXACTLY this text. A duplicate hiding in a
// comma-list head or winning on higher specificity evades a literal-text
// reader; closing that means parsing CSS, which this file deliberately does
// not do.
const ruleValue = (sheet, label, selector, property) => {
  let value = null;
  for (let at = sheet.indexOf(selector); at !== -1; at = sheet.indexOf(selector, at + 1)) {
    const block = sheet.slice(at + selector.length, sheet.indexOf("}", at));
    const found = new RegExp(`(?:^|[;{\\s])${property}:([^;\\n}]+)`).exec(block);
    if (found) {
      value = found[1].replace("!important", "").trim();
    }
  }
  return value ?? assert.fail(`${label}: no rule "${selector}" sets ${property}`);
};

// A token is a declaration like any other, so it is read the same way — block
// scoped and last-wins. Read loose over the whole sheet it would have taken the
// first block that happened to name it, wherever that block was and whether or
// not a later one overrode it.
const tokenValue = (sheet, label, name) => ruleValue(sheet, label, "html:not(.ext-f) {", name);

const TOP_SCOPED = "html:not(.ext-f) :is(.uir-tabs, .uir-tab-list, .uir-tab-list-tabs, .bgtabbar) .formtabon {";
const SUB_SCOPED = "html:not(.ext-f) :is(.uir-subtab-panel-tabs-row, div.bgsubtabbar) .formsubtabon {";
for (const [what, sites] of Object.entries({
  "the active top-tab surface": [
    ["netsuite.css scoped", () => ruleValue(netsuiteStyles, "netsuite.css scoped", TOP_SCOPED, "background-color")],
    ["netsuite.css bare", () => ruleValue(netsuiteStyles, "netsuite.css bare", "html:not(.ext-f) .formtabon {", "background-color")],
    ["v3-compat.css", () => ruleValue(compatibilityStyles, "v3-compat.css", "html:not(.ext-f) .uir-tab-list-tabs .formtabon {", "background-color")]
  ],
  "the active top-tab accent": [
    ["netsuite.css scoped", () => ruleValue(netsuiteStyles, "netsuite.css scoped", TOP_SCOPED, "border-bottom")],
    ["v3-compat.css", () => ruleValue(compatibilityStyles, "v3-compat.css", "html:not(.ext-f) .uir-tab-list-tabs .formtabon {", "border-bottom")]
  ],
  "the active subtab surface": [
    ["netsuite.css scoped", () => ruleValue(netsuiteStyles, "netsuite.css scoped", SUB_SCOPED, "background-color")],
    ["netsuite.css bare", () => ruleValue(netsuiteStyles, "netsuite.css bare", "html:not(.ext-f) .formsubtabon {", "background-color")],
    ["v3-compat.css token", () => tokenValue(compatibilityStyles, "v3-compat.css token", "--suitemate-v3-subtab-active-bg")]
  ],
  "the active subtab accent": [
    ["netsuite.css scoped", () => ruleValue(netsuiteStyles, "netsuite.css scoped", SUB_SCOPED, "border-bottom")],
    ["v3-compat.css", () => ruleValue(compatibilityStyles, "v3-compat.css", "html:not(.ext-f) .uir-subtab-panel-tabs-row .formsubtabon {", "border-bottom")]
  ],
  // The hover halves are duplicated across the same two sheets as the active
  // ones — they were split out of a single rule this round, which is precisely
  // when a pair starts to drift — and the descriptive assertions above never
  // compare them. A hover shade that moved in one sheet only would render
  // whichever the cascade picked, with the whole suite green.
  "the inactive top-tab hover surface": [
    ["netsuite.css scoped", () => ruleValue(netsuiteStyles, "netsuite.css scoped", "html:not(.ext-f) :is(.uir-tabs, .uir-tab-list, .uir-tab-list-tabs, .bgtabbar) .formtaboff:has(>a:hover) {", "background-color")],
    ["v3-compat.css", () => ruleValue(compatibilityStyles, "v3-compat.css", "html:not(.ext-f) .uir-tab-list-tabs .formtaboff:has(>a:hover) {", "background-color")]
  ],
  "the inactive subtab hover surface": [
    ["netsuite.css scoped", () => ruleValue(netsuiteStyles, "netsuite.css scoped", "html:not(.ext-f) :is(.uir-subtab-panel-tabs-row, div.bgsubtabbar) .formsubtaboff:has(>a:hover) {", "background-color")],
    ["v3-compat.css token", () => tokenValue(compatibilityStyles, "v3-compat.css token", "--suitemate-v3-subtab-hover-bg")]
  ]
})) {
  const [[baselineLabel, readBaseline], ...rest] = sites;
  const expected = readBaseline();
  for (const [label, read] of rest) {
    assert.equal(
      read(),
      expected,
      `${what} differs between "${baselineLabel}" and "${label}" — the copies have drifted`
    );
  }
}
// The uif top nav's CURRENT SECTION marker — the same orphaned-main-light
// defect as .formtabon, on a surface found live only after the tab fix
// shipped (the classic account's top bar is the uif MenuBar, not tab markup,
// so no fixture renders it). Pinned to the SAME blend the tab surfaces carry:
// the equality block above proves the tab copies agree with each other, and
// this ties the nav to that family, so a treatment change that skips one
// surface fails here instead of shipping another two-tone chrome.
assert.equal(
  ruleValue(
    netsuiteStyles,
    "the uif nav current section",
    "html:not(.ext-f) [data-header-section=navigation] [data-widget=MenuBar] [data-widget=MenuGroup]>[data-widget=MenuItem][data-highlighted=true] {",
    "background-color"
  ),
  ruleValue(compatibilityStyles, "v3-compat.css", "html:not(.ext-f) .uir-tab-list-tabs .formtabon {", "background-color"),
  "The uif nav's current-section fill is not the tab family's active blend"
);
// ===== Transaction totals box =====
// EVERY value here goes through ruleValue, not a bare assert.match. Existence
// matching answers "does the sheet say this anywhere", which an APPENDED
// duplicate block satisfies while the browser paints the duplicate — the exact
// hole this file closed for the tab treatment, reopened by pinning this
// component the easy way. ruleValue reads the block the cascade lands on, and
// its exact selector heads also stop a loose /table.totallingtable {/ from
// matching the .isDarkMode rule that merely ends the same way.
//
// The WHOLE component is pinned, not just the interesting parts, because
// NOTHING ELSE HOLDS ANY OF IT. The screenshot gate fails at 1% and this box is
// small: a full revert of the cell padding moves the record baseline 0.276%, the
// Total sizing 0.053%, the Total-label rule 0.019%, the inner radii 0.007%, the
// container radius 0.002%, and a theme hardcode or a respelled shadow 0.000%.
// Measured on netsuite-page, every one of them green.
const TOTALS_ROW = "html:not(.ext-f) .totallingtable tbody tr:last-child ";
const TOTALS_RADII = "html:not(.ext-f):not(.disable_radii) ";
for (const [what, selector, property, expected] of [
  // The two theme-derived surfaces. Both must read var(--theme-main) DIRECTLY:
  // the live check is moving the variable and watching the caption and the rule
  // above the Total follow together, and a hardcode renders pixel-identical to
  // the variable that produced it. The rule was a color-mix towards the table
  // border until this round and did not follow. The caption's selector head ends
  // in a comma because the fill lives in a shared group — slicing from there to
  // the block still reads that group's declaration and nobody else's.
  ["the caption fill", "html:not(.ext-f) table.totallingtable caption,", "background-color", "var(--theme-main)"],
  ["the rule above the Total row", `${TOTALS_ROW}td {`, "border-top", "2px solid var(--theme-main)"],
  // Literals, because the spec named literals — an equivalent spelling renders
  // identically and passes every screenshot. The dark variant is pinned on the
  // same terms as the light one: no fixture renders either shadow to within the
  // 1% gate, so "no test can see it" argues for pinning both or neither.
  // Card chrome lives on the WRAPPER (span.bgmd.totallingbg): a <caption> sits
  // outside the table's border box, so chrome on the table wraps only the body
  // and renders the header as a detached pill over a separately-rounded
  // Subtotal block — the owner saw exactly that. The wrapper's overflow:hidden
  // is what rounds the caption fill and the last row now, so it is pinned on
  // the same terms as the radius it implements.
  ["the elevation", "html:not(.ext-f) span.bgmd.totallingbg {", "box-shadow", "0 1px 4px rgba(20, 22, 26, 0.22)"],
  ["the dark-mode elevation", "html:not(.ext-f).isDarkMode span.bgmd.totallingbg {", "box-shadow", "0 1px 4px rgba(0, 0, 0, 0.5)"],
  ["the container radius", `${TOTALS_RADII}span.bgmd.totallingbg {`, "border-radius", "16px"],
  ["the card fill", "html:not(.ext-f) span.bgmd.totallingbg {", "background-color", "var(--field-backgroud-color)"],
  ["the hairline", "html:not(.ext-f) span.bgmd.totallingbg {", "border", "1px solid var(--table-border-color)"],
  ["the corner clip", "html:not(.ext-f) span.bgmd.totallingbg {", "overflow", "hidden"],
  // And the table stays FLAT: any of these coming back splits the card at the
  // caption seam again, which is the defect this geometry exists to kill.
  ["the table's flat background", "html:not(.ext-f) table.totallingtable {", "background-color", "transparent"],
  ["the table's flat border", "html:not(.ext-f) table.totallingtable {", "border", "0"],
  ["the table's flat shadow", "html:not(.ext-f) table.totallingtable {", "box-shadow", "none"],
  ["the caption padding", "html:not(.ext-f) table.totallingtable caption {", "padding", "8px 16px"],
  ["the cell padding", "html:not(.ext-f) .totallingtable td {", "padding", "8px 16px"],
  ["the Total row size", `${TOTALS_ROW}td {`, "font-size", ".98em"],
  ["the Total amount size", `${TOTALS_ROW}td+td {`, "font-size", "1.08em"],
  // The Total LABEL, which the dimmed tier was also catching. Pinned because the
  // rule that undims it is one deletable block and deleting it renders a box
  // that still passes at 0.019% — the defect it fixes is invisible to the gate
  // in exactly the way the defect itself was.
  ["the Total label colour", `${TOTALS_ROW}span.uir-label {`, "color", "var(--text-0)"],
  ["the Total label weight", `${TOTALS_ROW}span.uir-label {`, "font-weight", "700"]
]) {
  assert.equal(
    ruleValue(netsuiteStyles, `the totals box: ${what}`, selector, property),
    expected,
    `The totals box: ${what} is not ${expected}`
  );
}
// ===== Clean Commerce item tables =====
// Same terms as the totals box: every value cascade-read at its exact selector
// head, because nothing else holds any of it — the machine tint at 4.5% sits
// below even the stripe probe's old floor, and a respelled mix or a retuned
// percentage renders pixel-identical to every screenshot gate. The zebra and
// hover values are ROW-SCOPED overrides (machines only; lists keep 8%), which
// is the scoping the owner's "do not modify unrelated lists" requires — these
// pins hold the scoping as much as the values.
const MACHINE_CONTAINER = "html:not(.ext-f) .uir-machine-table-container {";
const MACHINE_ROW_TOKENS = "html:not(.ext-f) :is(.uir-machine-row, .uir-machine-totals-row) {";
const MACHINE_CELL = "html:not(.ext-f) .uir-machine-table .uir-machine-row>td {";
for (const [sheet, sheetName, what, selector, property, expected] of [
  [netsuiteStyles, "netsuite.css", "the container hairline", MACHINE_CONTAINER, "border", "1px solid light-dark(rgba(10, 19, 23, 0.1), var(--dark-3))"],
  [netsuiteStyles, "netsuite.css", "the container elevation", MACHINE_CONTAINER, "box-shadow", "0 1px 4px rgba(20, 22, 26, 0.14)"],
  [netsuiteStyles, "netsuite.css", "the dark container elevation", "html:not(.ext-f).isDarkMode .uir-machine-table-container {", "box-shadow", "0 1px 4px rgba(0, 0, 0, 0.5)"],
  [netsuiteStyles, "netsuite.css", "the container radius", `${TOTALS_RADII}.uir-machine-table-container {`, "border-radius", "12px"],
  [netsuiteStyles, "netsuite.css", "the machine zebra tint", MACHINE_ROW_TOKENS, "--row-odd-bg-color", "light-dark(color-mix(in srgb, var(--theme-main) 4.5%, #fff), var(--dark-2))"],
  [netsuiteStyles, "netsuite.css", "the machine hover tint", MACHINE_ROW_TOKENS, "--row-hover-bg-color", "light-dark(color-mix(in srgb, var(--theme-main) 6%, #fff), var(--dark-3))"],
  [netsuiteStyles, "netsuite.css", "the row height", MACHINE_CELL, "height", "46px"],
  [netsuiteStyles, "netsuite.css", "the cell padding", MACHINE_CELL, "padding", "0 12px"],
  [netsuiteStyles, "netsuite.css", "the row divider", MACHINE_CELL, "border-bottom", "1px solid light-dark(rgba(10, 19, 23, 0.08), var(--dark-3))"],
  [netsuiteStyles, "netsuite.css", "the tabular figures", "html:not(.ext-f) .uir-machine-table .uir-machine-row>td[align=right] {", "font-variant-numeric", "tabular-nums"],
  [netsuiteStyles, "netsuite.css", "the item link colour", "html:not(.ext-f) .uir-machine-table .uir-machine-row td a:is(.dottedlink, [href]) {", "color", "var(--theme-main)"],
  [compatibilityStyles, "v3-compat.css", "the header surface", MACHINE_CONTAINER, "--suitemate-v3-table-header-bg", "light-dark(#fff, var(--dark-1))"],
  [compatibilityStyles, "v3-compat.css", "the header rule colour", MACHINE_CONTAINER, "--suitemate-v3-table-header-border", "var(--theme-main)"],
  [compatibilityStyles, "v3-compat.css", "the header height", "html:not(.ext-f) .uir-machine-table-container .uir-machine-table .uir-machine-headerrow>td {", "height", "48px"],
  [compatibilityStyles, "v3-compat.css", "the header rule width", "html:not(.ext-f) .uir-machine-table-container .uir-machine-table .uir-machine-headerrow>td {", "border-bottom-width", "3px"],
  [compatibilityStyles, "v3-compat.css", "the header weight", "html:not(.ext-f) .uir-machine-headerrow>td :is(.listheader, [class*=listheader]) {", "font-weight", "500"]
]) {
  assert.equal(
    ruleValue(sheet, `Clean Commerce: ${what} (${sheetName})`, selector, property),
    expected,
    `Clean Commerce: ${what} is not ${expected} in ${sheetName}`
  );
}
assert.match(
  compatibilityStyles,
  /td\.fgroup_title\.uir-field-group>div\.fgroup_title[\s\S]*?background-color: var\(--theme-secondary-light\) !important/,
  "Global NetSuite field groups are not controlled by Secondary"
);
// The ROOT header tokens stay on Secondary — read at the root block head so
// the Clean Commerce machine-scoped override (which deliberately puts the
// MACHINE header underline on Main, per the owner's spec) does not trip a
// whole-sheet regex that was only ever about the global defaults.
assert.equal(
  tokenValue(compatibilityStyles, "v3-compat root header bg", "--suitemate-v3-table-header-bg"),
  "var(--theme-secondary-light)",
  "Global NetSuite table headers no longer default to Secondary"
);
assert.equal(
  tokenValue(compatibilityStyles, "v3-compat root header border", "--suitemate-v3-table-header-border"),
  "var(--theme-secondary)",
  "Global NetSuite table header borders no longer default to Secondary"
);
assert.doesNotMatch(
  compatibilityStyles,
  /data-path=|salesord\.nl|#item_splits/,
  "The compatibility layer still contains page-specific styling"
);

const settingsSource = await readFile(resolve(root, "src/shared/settings.js"), "utf8");
const settingsTransferSource = await readFile(resolve(root, "src/shared/settings-transfer.js"), "utf8");
assert.doesNotMatch(settingsTransferSource, /chrome\.|fetch\(|XMLHttpRequest|document\.|localStorage|sessionStorage/, "Settings transfer has unnecessary browser, storage or network authority");
assert.match(settingsTransferSource, /settingsApi\.validateForStorage/, "Settings transfer bypasses canonical schema and quota validation");
assert.match(settingsTransferSource, /TextEncoder/, "Settings export is not Unicode safe");
assert.match(settingsTransferSource, /TextDecoder\("utf-8", \{ fatal: true \}\)/, "Settings import does not reject malformed UTF-8");
assert.doesNotMatch(settingsSource, /function normalizeHexColor|function utf8ByteLength/, "Settings retain duplicated shared primitives");
const settingsSandbox = makeSandbox({}, utilitySource, settingsSource);
const settingsApi = settingsSandbox.SuiteMateV3Settings;
assert.equal(settingsApi.THEME_PREVIEW_MESSAGE, "SUITEMATE_V3_PREVIEW_ROLE_THEME");
assert.equal(settingsApi.SCHEMA_VERSION, 6);
assert.equal(settingsApi.DEFAULTS.schemaVersion, settingsApi.SCHEMA_VERSION);
assert.equal(settingsApi.DEFAULTS.squareCorners, false);
assert.equal(settingsApi.DEFAULTS.showInternalIds, false);
assert.equal(settingsApi.DEFAULTS.salesOrderColumns, false);
assert.equal(settingsApi.DEFAULTS.smartTabTitles, false);
assert.equal(settingsApi.DEFAULTS.formViews, false);
assert.equal(settingsApi.DEFAULTS.salesOrderColumnsEdit, false);
assert.deepEqual(
  JSON.parse(JSON.stringify(settingsApi.validateForStorage({ mode: "dark" }))),
  {
    schemaVersion: 6,
    enabled: true,
    mode: "dark",
    squareCorners: false,
    showInternalIds: false,
    salesOrderColumns: false,
    smartTabTitles: false,
    formViews: false,
    salesOrderColumnsEdit: false,
    roleThemes: {}
  }
);
assert.equal(settingsApi.normalize({ squareCorners: true }).squareCorners, true);
assert.equal(settingsApi.normalize({ showInternalIds: true }).showInternalIds, true);
const roleContext = { id: "9845683_SB2~11596~3~N", name: "DBG Health (SB2) - Administrator" };
const roleSettings = settingsApi.withRoleTheme(settingsApi.DEFAULTS, roleContext, {
  main: "#123456",
  secondary: "#abcdef"
});
assert.equal(settingsApi.getRoleTheme(roleSettings, roleContext.id).customized, true);
assert.deepEqual(
  JSON.parse(JSON.stringify(settingsApi.deriveThemeVariables(settingsApi.getRoleTheme(roleSettings, roleContext.id)))),
  {
    "--custom-theme-main": "light-dark(#123456, #102f4d)",
    "--custom-theme-main-light": "light-dark(#597189, #415d78)",
    "--custom-theme-secondary": "light-dark(#abcdef, #89a4bf)",
    "--custom-theme-secondary-light": "light-dark(#c4dcf4, #b3d2f1)",
    "--custom-theme-secondary-light-light": "light-dark(#ddebf9, #cde1f5)"
  },
  "V1 theme color variants changed"
);
const mainOnlySettings = settingsApi.withRoleTheme(settingsApi.DEFAULTS, roleContext, { main: "#ff0000" });
const mainOnlyTheme = settingsApi.getRoleTheme(mainOnlySettings, roleContext.id);
assert.equal(mainOnlyTheme.mainCustomized, true);
assert.equal(mainOnlyTheme.secondaryCustomized, false);
assert.deepEqual(Object.keys(settingsApi.deriveThemeVariables(mainOnlyTheme)), [
  "--custom-theme-main",
  "--custom-theme-main-light"
]);
const swappedTheme = settingsApi.getRoleTheme(
  settingsApi.swapRoleTheme(mainOnlySettings, roleContext),
  roleContext.id
);
assert.equal(swappedTheme.mainCustomized, false);
assert.equal(swappedTheme.secondaryCustomized, true);
assert.equal(swappedTheme.secondary, "#ff0000");
assert.equal(
  settingsApi.getRoleTheme(settingsApi.withoutRoleTheme(roleSettings, roleContext.id), roleContext.id).customized,
  false
);

const materialPaletteSource = await readFile(resolve(root, "dist/material-palette.js"), "utf8");
const materialPaletteEntrySource = await readFile(resolve(root, "src/palette/material-palette.js"), "utf8");
assert.doesNotMatch(
  materialPaletteEntrySource,
  /function normalizeHexColor/,
  "The Material palette retains a private hex normalizer"
);
const materialPaletteSandbox = makeSandbox({}, utilitySource, materialPaletteSource);
const { generateMaterialShades } = materialPaletteSandbox.SuiteMateV3MaterialPalette;
const materialShades = generateMaterialShades("#6269e7");
assert.equal(materialShades.source, "#6269e7");
assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(materialShades.shades))), [
  "50", "100", "200", "300", "400", "500", "600", "700", "800", "900"
]);
for (const hex of Object.values(materialShades.shades)) {
  assert.match(hex, /^#[0-9a-f]{6}$/);
}
function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
const materialLuminances = Object.values(materialShades.shades).map(relativeLuminance);
for (let index = 1; index < materialLuminances.length; index += 1) {
  assert.equal(materialLuminances[index] < materialLuminances[index - 1], true, "Material tones are not ordered light to dark");
}
assert.equal(JSON.stringify(generateMaterialShades("#6269e7")), JSON.stringify(materialShades));
assert.equal(generateMaterialShades("#60g"), null);
assert.equal(generateMaterialShades("#678").source, "#667788");
assert.equal(generateMaterialShades("#12345678"), null);
assert.equal(generateMaterialShades(null), null);
assert.equal(Object.isFrozen(materialShades), true);
assert.equal(Object.isFrozen(materialShades.shades), true);
const neutralShades = generateMaterialShades("#808080");
assert.equal(neutralShades.chroma, 0);
for (const hex of Object.values(neutralShades.shades)) {
  const [red, green, blue] = hex.slice(1).match(/.{2}/g);
  assert.equal(red, green);
  assert.equal(green, blue);
}
assert.notEqual(generateMaterialShades("#ffffff").source, generateMaterialShades("#ffffff").shades[500]);

const coreSource = await readFile(resolve(root, "src/suiteql/core.js"), "utf8");
assert.doesNotMatch(coreSource, /isAllowedSender/, "SuiteQL Core retains a duplicate sender policy");
assert.doesNotMatch(coreSource, /host\.endsWith|extforms\.netsuite/, "SuiteQL retains a duplicate host policy");
const coreSandbox = makeSandbox({ URL, Date, SuiteMateV3Routes: routeApi }, utilitySource, coreSource);
const suiteqlCore = coreSandbox.SuiteMateV3SuiteQLCore;
const studioUrl = "https://123456.app.netsuite.com/app/common/search/ubersearchresults.nl?suiteql";

assert.equal(suiteqlCore.isAllowedNetSuiteUrl(studioUrl), true);
assert.equal(suiteqlCore.isAllowedNetSuiteUrl("https://www.netsuite.com/portal/home.shtml"), false);
assert.equal(suiteqlCore.isAllowedNetSuiteUrl("https://123.extforms.netsuite.com/app/site/hosting/scriptlet.nl"), false);
assert.equal(
  suiteqlCore.createStudioUrl("https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=10"),
  studioUrl
);
assert.equal(suiteqlCore.validateQuery("").code, "EMPTY_QUERY");
assert.equal(suiteqlCore.validateQuery("UPDATE transaction SET memo = 'x'").code, "READ_ONLY_QUERY_REQUIRED");
assert.equal(suiteqlCore.validateQuery("SELECT 1; DELETE FROM transaction").code, "MULTIPLE_STATEMENTS_NOT_ALLOWED");
assert.equal(suiteqlCore.validateQuery("SELECT '--'; DELETE FROM transaction").code, "MULTIPLE_STATEMENTS_NOT_ALLOWED");
assert.equal(suiteqlCore.validateQuery("-- comment\nSELECT id FROM transaction;").valid, true);
assert.equal(suiteqlCore.validateQuery("WITH ids AS (SELECT id FROM transaction) SELECT id FROM ids").valid, true);
assert.equal(suiteqlCore.validateQuery(`SELECT '${"x".repeat(100001)}'`).code, "QUERY_TOO_LARGE");
assert.equal(suiteqlCore.hasOrderBy("SELECT * FROM transaction ORDER BY id"), true);
assert.equal(suiteqlCore.hasOrderBy("SELECT 'ORDER BY id' AS note FROM transaction"), false);

assert.deepEqual(
  JSON.parse(JSON.stringify(suiteqlCore.normalizeError({ name: "SSS_SEARCH_ERROR_OCCURRED", message: "Invalid field" }))),
  { code: "SSS_SEARCH_ERROR_OCCURRED", message: "Invalid field", details: "" }
);
const suiteqlResponse = {
    ok: true,
    requestId: "request-1",
    columns: ["id"],
    rows: [{ id: 1 }],
    elapsedMs: 18,
    paged: false,
    pageIndex: 0,
    pageSize: 1,
    loadedCount: 1,
    totalCount: 1,
    totalPages: 1
  };
assert.deepEqual(
  JSON.parse(JSON.stringify(suiteqlCore.normalizeResponse(suiteqlResponse))),
  suiteqlResponse
);
assert.equal(suiteqlCore.normalizeResponse(undefined, "request-2").error.code, "SUITEQL_ERROR");

const sortableRows = [{ value: null }, { value: 10 }, { value: 2 }, { value: "3" }];
assert.deepEqual(
  JSON.parse(JSON.stringify(suiteqlCore.sortRows(sortableRows, "value", "asc"))).map((row) => row.value),
  [2, "3", 10, null]
);
assert.deepEqual(
  JSON.parse(JSON.stringify(suiteqlCore.sortRows(sortableRows, "value", "desc"))).map((row) => row.value),
  [10, "3", 2, null]
);
const clientPage = suiteqlCore.getClientPage(Array.from({ length: 620 }, (_, id) => ({ id })), 2);
assert.equal(clientPage.pageSize, 250);
assert.equal(clientPage.rows.length, 120);
assert.equal(clientPage.start, 500);
assert.equal(clientPage.end, 620);

assert.equal(
  suiteqlCore.toCsv(["name", "note"], [{ name: "+formula", note: "line 1\nline \"2\"" }]),
  "name,note\r\n'+formula,\"line 1\nline \"\"2\"\"\""
);
assert.equal(
  suiteqlCore.createExportFilename("ACME AU", new Date("2026-07-13T03:04:05.678Z")),
  "SuiteQL-ACME-AU-2026-07-13T03-04-05-678Z.csv"
);

const backgroundSource = await readFile(resolve(root, "src/background/service-worker.js"), "utf8");
const studioSource = await readFile(resolve(root, "src/suiteql/studio-entry.js"), "utf8");
const studioStyles = await readFile(resolve(root, "src/suiteql/studio.css"), "utf8");
assert.match(studioSource, /browserUtilityApi\.downloads\.create/, "SuiteQL export bypasses the shared download adapter");
assert.match(studioSource, /browserUtilityApi\.notices\.create/, "SuiteQL notices bypass the shared notice controller");
assert.doesNotMatch(studioSource, /new Blob|createObjectURL|revokeObjectURL/, "SuiteQL retains a private Blob download implementation");
assert.match(studioSource, /<h1>SuiteQL Console<\/h1>/, "The workspace does not use the SuiteQL Console name");
assert.match(studioSource, /document\.title = "SuiteQL Console"/, "The browser title does not use the SuiteQL Console name");
assert.doesNotMatch(studioSource, /SuiteQL Studio/, "The old SuiteQL Studio name remains in the workspace");
assert.match(studioStyles, /--suiteql-radius-panel: var\(--suitemate-radius-dialog, 10px\)/, "The Console is not connected to the global radius system");
assert.match(studioStyles, /#suitemate-suiteql-studio \[hidden\][\s\S]*?display: none !important/, "Hidden Console controls can be exposed by component display styles");
assert.match(backgroundSource, /src\/netsuite\/data-adapter\.js/, "The service worker does not load the NetSuite data adapter");
assert.match(dataAdapterSource, /PlatformClientScriptHandler\.nl/, "SuiteQL does not use the V1 NetSuite bridge endpoint");
assert.match(dataAdapterSource, /"queryApiBridge"/, "SuiteQL does not call NetSuite's queryApiBridge");
assert.match(dataAdapterSource, /"runSuiteQL"/, "Unpaged SuiteQL bridge execution is missing");
assert.match(dataAdapterSource, /"suiteQLPagedQuery"/, "Paged SuiteQL bridge execution is missing");
assert.match(dataAdapterSource, /"getSuiteQLQueryPage"/, "Progressive SuiteQL bridge paging is missing");
assert.match(dataAdapterSource, /"SUITE_QL"/, "SuiteQL permission errors can be hidden by a static metadata provider");
assert.match(dataAdapterSource, /credentials: "include"/, "Adapter requests do not use the authenticated NetSuite session");
assert.match(dataAdapterSource, /world: "MAIN"/, "NetSuite data is not executed in the authenticated main world");
assert.match(dataAdapterSource, /\["N\/currentRecord"\]/, "CSV Import and record metadata do not use NetSuite's current record API");
assert.match(dataAdapterSource, /forceSyncSourcing: true/, "CSV Import dependent fields are not sourced synchronously");
assert.doesNotMatch(dataAdapterSource, /\["N\/query"\]/, "SuiteQL still depends on an unavailable page-level N/query loader");
assert.match(backgroundSource, /bridgeApi\.createDispatcher/, "Background commands bypass the typed bridge dispatcher");
assert.match(backgroundSource, /src\/csv-export\/core\.js/, "The service worker does not load the CSV Export contract");
assert.match(
  backgroundSource,
  /files:\s*\[\s*"src\/csv-export\/core\.js",\s*"src\/csv-export\/main-world\.js"\s*\]/,
  "CSV Export does not inject its fixed main-world adapter on demand"
);
assert.match(backgroundSource, /\[COMMANDS\.SUITEQL_START\]/, "SuiteQL start is not allowlisted");
assert.match(backgroundSource, /\[COMMANDS\.RECORD_GET_TYPE\]/, "Record type lookup is not allowlisted");
assert.match(backgroundSource, /\[COMMANDS\.RECORD_EXPORT_CSV\]/, "CSV Export is not allowlisted");
assert.match(backgroundSource, /\[COMMANDS\.IMPORT_ASSISTANT_SET_VALUES\]/, "Import Assistant updates are not allowlisted");
assert.match(backgroundSource, /\[COMMANDS\.IMPORT_ASSISTANT_RESOLVE_CATEGORY\]/, "Import Assistant category lookup is not allowlisted");
assert.doesNotMatch(
  backgroundSource,
  /SUITEMATE_V3_SUITEQL_(?:START|PAGE|DISPOSE)|SUITEMATE_V3_RECORD_TYPE|SUITEMATE_V3_IMPORT_ASSISTANT_SET_VALUES/,
  "Legacy privileged message types remain in the background"
);
assert.match(studioSource, /state\.selection\.main/, "Selected editor text is not executed");
assert.match(studioSource, /COMMANDS\.SUITEQL_START/, "SuiteQL Console bypasses the typed bridge");
assert.match(studioSource, /bridgeApi\.toCommandResult/, "SuiteQL Console does not normalize typed responses");
assert.match(
  studioSource,
  /new URLSearchParams\(location\.search\)/,
  "SuiteQL Console depends on an undeclared URL parameter global"
);
assert.match(studioSource, /document\.querySelector\("#body"\)/, "Studio is not mounted in NetSuite's visible workspace host");
assert.match(studioSource, /sessionStorage\.setItem\(SESSION_KEYS\.draft/, "Per-tab draft persistence is missing");
assert.match(studioSource, /content\.textContent = core\.displayValue\(value\)/, "Query values are not rendered as text");
assert.match(studioSource, /createEditorKeyBindings/, "SuiteQL shortcuts bypass the shared command framework");
assert.equal(
  commandApi.getShortcut(commandApi.IDS.SUITEQL_TOGGLE_PAGED).editor,
  "Mod-Shift-p",
  "Paged keyboard shortcut is missing"
);
assert.equal(
  commandApi.getShortcut(commandApi.IDS.SUITEQL_EXPORT_LOADED).editor,
  "Mod-Shift-e",
  "Export keyboard shortcut is missing"
);
assert.equal(
  commandApi.getShortcut(commandApi.IDS.SUITEQL_CLEAR_RESULTS).editor,
  "Mod-Shift-l",
  "Clear keyboard shortcut is missing"
);
assert.match(
  studioSource,
  /id="suiteql-suitesense" href="https:\/\/suitesense\.vercel\.app\/" target="_blank" rel="noopener noreferrer"/,
  "SuiteSense is not exposed as a safe external SuiteQL resource"
);
assert.match(studioSource, />Generate with SuiteSense<\//, "SuiteSense action text is missing");
assert.match(studioSource, /id="suiteql-inspect-table" type="button" hidden/, "Inspect Table is visible");
assert.match(studioSource, /id="suiteql-records-catalog"[^>]+hidden/, "Records Catalog is visible");
assert.doesNotMatch(dataAdapterSource, /fetch\(envelope\.payload|url: envelope\.payload|method: envelope\.payload/, "The data adapter exposes caller-controlled transport primitives");

let backgroundMessageListener;
let mockNow = 100;
const importAssistantAppliedValues = {};
let deferCurrentRecord = false;
let deferredCurrentRecordSuccess = null;
let missingImportField = "";
let forcedMainWorldUrl = "";
let lastScriptingTarget = null;
let resolveSlowBridgeFetchStarted;
let slowBridgeFetchAborted = false;
let slowBridgeFetchStarted = new Promise((resolveStarted) => {
  resolveSlowBridgeFetchStarted = resolveStarted;
});
const currentRecordModule = {
  get() {
    return {
      id: "10",
      type: "salesorder",
      isReadOnly: false,
      getField({ fieldId }) {
        if (
          importAssistantCore.ALLOWED_FIELDS.includes(fieldId)
          && fieldId !== missingImportField
        ) {
          return {
            label: fieldId,
            type: "select",
            isDisabled: false,
            isReadOnly: false
          };
        }
        return fieldId === "entity"
          ? {
              label: "Vendor",
              type: "select",
              isDisabled: false,
              isReadOnly: false,
              value: "must-not-leak"
            }
          : null;
      },
      getSublist() {
        return null;
      },
      setValue(options, positionalValue) {
        const fieldId = typeof options === "object" ? options.fieldId : options;
        const value = typeof options === "object" ? options.value : positionalValue;
        importAssistantAppliedValues[fieldId] = value;
      }
    };
  }
};
const pagedRows = [
  Array.from({ length: 1000 }, (_, index) => [index + 1, `row_${index + 1}`]),
  [[1001, "last"]]
];
const bridgeCalls = [];
const bridgeResult = (result) => ({
  ok: true,
  status: 200,
  async text() {
    return JSON.stringify({ result: { result } });
  }
});
const bridgeRows = (rows) => ({
  count: rows.length,
  aliases: ["id", "scriptid"],
  ...Object.fromEntries(rows.map((values, index) => [`v${index}`, values]))
});
const mockBridgeFetch = async (url, options) => {
  const parsedUrl = new URL(url, mainWorldLocation.origin);
  if (parsedUrl.pathname === routeApi.PATHS.IMPORT_ASSISTANT) {
    const category = parsedUrl.searchParams.get("rectype");
    return {
      ok: true,
      status: 200,
      url: parsedUrl.href,
      async text() {
        return category === "TRANSACTION"
          ? `Transactions\u0001CUSTOMCSVTYPE\u0005ignored`
          : `Other\u0001UNRELATED\u0005ignored`;
      }
    };
  }

  const request = JSON.parse(options.body);
  if (parsedUrl.pathname === "/app/common/scripting/nlapijsonhandler.nl") {
    bridgeCalls.push({
      url,
      options,
      method: request.method,
      searchParams: request.params
    });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          result: {
            rows: [{
              id: 99,
              cells: [
                { name: "internalid", value: "99", text: "99" },
                { name: "title", value: "Adapter Search", text: "Adapter Search" }
              ]
            }]
          }
        });
      }
    };
  }

  const [bridgeName, operation, serializedArguments] = request.params;
  const operationArguments = JSON.parse(serializedArguments);
  bridgeCalls.push({ url, options, method: request.method, bridgeName, operation, operationArguments });

  const query = operation === "suiteQLPagedQuery" ? operationArguments[1] : operationArguments[0];
  if (operation === "runSuiteQL" && String(query).includes("slow_bridge_query")) {
    resolveSlowBridgeFetchStarted();
    return new Promise((_resolveResponse, rejectResponse) => {
      options.signal.addEventListener("abort", () => {
        slowBridgeFetchAborted = true;
        rejectResponse(Object.assign(new Error("Bridge fetch aborted."), { name: "AbortError" }));
      }, { once: true });
    });
  }
  if (String(query).includes("invalid_field")) {
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          result: "error",
          error: {
            code: "SSS_SEARCH_ERROR_OCCURRED",
            detail: "Field 'invalid_field' was not found."
          }
        });
      }
    };
  }

  if (operation === "runSuiteQL") {
    return bridgeResult(bridgeRows([[10, "ten"], [11, "eleven"]]));
  }
  if (operation === "suiteQLPagedQuery") {
    if (String(query).includes("empty_result")) {
      return bridgeResult({ count: 0, numPages: 0, pages: [] });
    }
    return bridgeResult({ numPages: 2, pages: [{ index: 0 }, { index: 1 }] });
  }
  if (operation === "getSuiteQLQueryPage") {
    const pageIndex = Number(operationArguments[0]?.index) || 0;
    return bridgeResult(bridgeRows(pagedRows[pageIndex] ?? []));
  }
  throw new Error(`Unexpected bridge operation: ${operation}`);
};
const backgroundSetTimeout = (...args) => {
  const timeout = setTimeout(...args);
  timeout.unref?.();
  return timeout;
};
const mainWorldLocation = new URL(studioUrl);
const mainWorldDocument = { documentElement: { dataset: {} } };
const mainWorldWindow = {
  location: mainWorldLocation,
  document: mainWorldDocument,
  nlapiGetRecordType() {
    return "salesorder";
  },
  require(_modules, onSuccess) {
    if (deferCurrentRecord) {
      deferredCurrentRecordSuccess = onSuccess;
    } else {
      onSuccess(currentRecordModule);
    }
  }
};
const backgroundSandbox = makeSandbox({
  URL,
  URLSearchParams,
  SuiteMateV3Routes: routeApi,
  SuiteMateV3Bridge: bridgeApi,
  SuiteMateV3SuiteQLCore: suiteqlCore,
  SuiteMateV3RecordActionsCore: recordActionsCore,
  SuiteMateV3ImportAssistantCore: importAssistantCore,
  Symbol,
  Map,
  Set,
  Promise,
  Number,
  String,
  Array,
  Object,
  AbortController,
  performance: { now: () => mockNow++ },
  setTimeout: backgroundSetTimeout,
  clearTimeout,
  window: mainWorldWindow,
  location: mainWorldLocation,
  document: mainWorldDocument,
  navigator: { language: "en-US" },
  fetch: mockBridgeFetch,
  importScripts() {},
  chrome: {
    runtime: {
      getURL: (path) => path,
      onMessage: {
        addListener(listener) {
          backgroundMessageListener = listener;
        }
      }
    },
    scripting: {
      async executeScript({ target, func, args = [] }) {
        lastScriptingTarget = target;
        mainWorldLocation.href = forcedMainWorldUrl
          || args[0]?.expectedUrl
          || mainWorldLocation.href;
        return [{ result: await func(...args) }];
      }
    }
  }
}, dataAdapterSource, backgroundSource);
assert.equal(
  backgroundMessageListener(
    { type: "SUITEMATE_V3_SUITEQL_START", requestId: "legacy-message" },
    { frameId: 0, tab: { id: 71, url: studioUrl }, url: studioUrl },
    () => {}
  ),
  undefined,
  "The background still accepts a legacy privileged message"
);

function sendBackgroundMessage(message, sender) {
  return new Promise((resolveResponse, rejectResponse) => {
    const handled = backgroundMessageListener(message, sender, resolveResponse);
    if (handled !== true) {
      rejectResponse(new Error(`Background did not handle ${message.type}`));
    }
  });
}

const validBackgroundSender = {
  frameId: 0,
  documentId: "document-suiteql",
  tab: { id: 71, url: studioUrl },
  url: studioUrl
};
const recordPageUrl = "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=10";
const validRecordSender = {
  frameId: 0,
  documentId: "document-record",
  tab: { id: 72, url: recordPageUrl },
  url: recordPageUrl
};

async function sendBridgeCommand(command, payload, sender, requestId) {
  const message = bridgeApi.createRequest(command, payload, { requestId });
  const response = await sendBackgroundMessage(message, sender);
  return {
    response,
    result: bridgeApi.toCommandResult(response)
  };
}

const recordTypeBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.RECORD_GET_TYPE,
  {},
  validRecordSender,
  "record-type"
);
assert.deepEqual(JSON.parse(JSON.stringify(recordTypeBridge.result)), {
  recordType: "salesorder",
  ok: true,
  requestId: "record-type"
});

forcedMainWorldUrl = "https://123456.app.netsuite.com/app/center/card.nl";
const staleDocumentRecordTypeBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.RECORD_GET_TYPE,
  {},
  validRecordSender,
  "record-type-stale-document"
);
assert.equal(
  staleDocumentRecordTypeBridge.response.error.code,
  "INVALID_MAIN_WORLD_DOCUMENT"
);
forcedMainWorldUrl = "";
const missingDocumentRecordTypeBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.RECORD_GET_TYPE,
  {},
  { ...validRecordSender, documentId: undefined },
  "record-type-missing-document"
);
assert.equal(
  missingDocumentRecordTypeBridge.response.error.code,
  "INVALID_SENDER"
);
const rejectedRecordTypeBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.RECORD_GET_TYPE,
  {},
  { ...validRecordSender, frameId: 1 },
  "record-type-rejected"
);
assert.equal(rejectedRecordTypeBridge.response.error.code, "INVALID_SENDER");
const validImportAssistantSender = {
  frameId: 0,
  documentId: "document-import",
  tab: { id: 73, url: importAssistantUrl },
  url: importAssistantUrl
};
const importCategoryBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.IMPORT_ASSISTANT_RESOLVE_CATEGORY,
  {
    recordSubtype: "CUSTOMCSVTYPE",
    candidateCategories: ["ITEM", "TRANSACTION"]
  },
  validImportAssistantSender,
  "import-category"
);
assert.deepEqual(JSON.parse(JSON.stringify(importCategoryBridge.result)), {
  category: "TRANSACTION",
  ok: true,
  requestId: "import-category"
});
const rejectedImportField = await sendBackgroundMessage(
  {
    type: bridgeApi.MESSAGE_TYPE,
    version: bridgeApi.VERSION,
    requestId: "import-field-rejected",
    command: bridgeApi.COMMANDS.IMPORT_ASSISTANT_SET_VALUES,
    payload: {
      values: {
        recordtype: "TRANSACTION",
        arbitrary: "BLOCKED"
      }
    }
  },
  validImportAssistantSender
);
assert.equal(rejectedImportField.error.code, "UNSUPPORTED_IMPORT_FIELD");
const importAssistantBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.IMPORT_ASSISTANT_SET_VALUES,
  {
    values: {
      charencoding: "UTF-8",
      recordtype: "TRANSACTION",
      recordsubtype: "SALESORDER"
    }
  },
  validImportAssistantSender,
  "import-values"
);
assert.equal(importAssistantBridge.response.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(importAssistantBridge.result.applied)), [
  "charencoding",
  "recordtype",
  "recordsubtype"
]);
assert.deepEqual(importAssistantAppliedValues, {
  charencoding: "UTF-8",
  recordtype: "TRANSACTION",
  recordsubtype: "SALESORDER"
});
assert.deepEqual(JSON.parse(JSON.stringify(lastScriptingTarget)), {
  tabId: 73,
  documentIds: ["document-import"]
});
const valuesBeforeMissingField = { ...importAssistantAppliedValues };
missingImportField = "recordsubtype";
const unavailableImportFieldBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.IMPORT_ASSISTANT_SET_VALUES,
  {
    values: {
      recordtype: "CUSTOM_RECORD",
      recordsubtype: "BLOCKED_SUBTYPE"
    }
  },
  validImportAssistantSender,
  "import-missing-field"
);
assert.equal(
  unavailableImportFieldBridge.response.error.code,
  "IMPORT_FIELD_UNAVAILABLE"
);
assert.deepEqual(importAssistantAppliedValues, valuesBeforeMissingField);
missingImportField = "";

deferCurrentRecord = true;
deferredCurrentRecordSuccess = null;
const valuesBeforeCanceledImport = { ...importAssistantAppliedValues };
const pendingImportAssistantBridge = sendBridgeCommand(
  bridgeApi.COMMANDS.IMPORT_ASSISTANT_SET_VALUES,
  {
    values: {
      recordtype: "CUSTOM_RECORD",
      recordsubtype: "CANCELED_SUBTYPE"
    }
  },
  validImportAssistantSender,
  "import-canceled"
);
while (typeof deferredCurrentRecordSuccess !== "function") {
  await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
}
const canceledImportAssistantBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.CANCEL,
  {
    targetCommand: bridgeApi.COMMANDS.IMPORT_ASSISTANT_SET_VALUES,
    targetRequestId: "import-canceled"
  },
  validImportAssistantSender,
  "cancel-import-canceled"
);
assert.equal(canceledImportAssistantBridge.result.canceled, true);
assert.equal(
  (await pendingImportAssistantBridge).response.error.code,
  "ABORTED"
);
await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
deferredCurrentRecordSuccess(currentRecordModule);
await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
assert.deepEqual(importAssistantAppliedValues, valuesBeforeCanceledImport);
deferCurrentRecord = false;
deferredCurrentRecordSuccess = null;

const rejectedImportAssistantBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.IMPORT_ASSISTANT_SET_VALUES,
  { values: { recordtype: "TRANSACTION" } },
  { ...validImportAssistantSender, url: recordPageUrl, tab: { id: 73, url: recordPageUrl } },
  "import-sender-rejected"
);
assert.equal(rejectedImportAssistantBridge.response.error.code, "INVALID_SENDER");
const rejectedBackgroundBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.SUITEQL_START,
  { query: "SELECT 1", paged: false },
  { frameId: 1, tab: { id: 71, url: studioUrl }, url: studioUrl },
  "suiteql-sender-rejected"
);
assert.equal(rejectedBackgroundBridge.response.error.code, "INVALID_SENDER");

const unpagedBackgroundBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.SUITEQL_START,
  { query: "SELECT id, scriptid FROM customrecordtype", paged: false },
  validBackgroundSender,
  "unpaged"
);
const unpagedBackgroundResponse = unpagedBackgroundBridge.result;
assert.equal(unpagedBackgroundResponse.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(unpagedBackgroundResponse.columns)), ["id", "scriptid"]);
assert.deepEqual(JSON.parse(JSON.stringify(unpagedBackgroundResponse.rows)), [
  { id: 10, scriptid: "ten" },
  { id: 11, scriptid: "eleven" }
]);
assert.deepEqual(JSON.parse(JSON.stringify(lastScriptingTarget)), {
  tabId: 71,
  documentIds: ["document-suiteql"]
});
const unpagedBridgeCall = bridgeCalls.find((call) => call.operation === "runSuiteQL");
assert.equal(unpagedBridgeCall.url, "/app/common/scripting/PlatformClientScriptHandler.nl");
assert.equal(unpagedBridgeCall.method, "remoteObject.bridgeCall");
assert.equal(unpagedBridgeCall.bridgeName, "queryApiBridge");
assert.equal(unpagedBridgeCall.options.credentials, "include");
assert.equal(unpagedBridgeCall.options.headers.nsxmlhttprequest, "NSXMLHttpRequest");
assert.deepEqual(JSON.parse(JSON.stringify(unpagedBridgeCall.operationArguments)), [
  "SELECT id, scriptid FROM customrecordtype",
  "[]",
  "SUITE_QL",
  ""
]);

const pagedBackgroundBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.SUITEQL_START,
  { query: "SELECT id, scriptid FROM customrecordtype ORDER BY id", paged: true },
  validBackgroundSender,
  "paged"
);
const pagedBackgroundResponse = pagedBackgroundBridge.result;
assert.equal(pagedBackgroundResponse.ok, true);
assert.equal(pagedBackgroundResponse.loadedCount, 1000);
assert.equal(pagedBackgroundResponse.totalCount, 1001);
assert.equal(pagedBackgroundResponse.totalPages, 2);
const pagedBridgeCall = bridgeCalls.find((call) => call.operation === "suiteQLPagedQuery");
assert.deepEqual(JSON.parse(JSON.stringify(pagedBridgeCall.operationArguments)), [
  1000,
  "SELECT id, scriptid FROM customrecordtype ORDER BY id",
  "[]",
  "SUITE_QL",
  ""
]);

const nextBackgroundPageBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.SUITEQL_PAGE,
  { pageIndex: 1 },
  validBackgroundSender,
  "paged"
);
const nextBackgroundPage = nextBackgroundPageBridge.result;
assert.equal(nextBackgroundPage.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(nextBackgroundPage.rows)), [{ id: 1001, scriptid: "last" }]);
assert.equal(nextBackgroundPage.loadedCount, 1001);
const invalidBackgroundPageBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.SUITEQL_PAGE,
  { pageIndex: 2 },
  validBackgroundSender,
  "paged"
);
assert.equal(invalidBackgroundPageBridge.response.error.code, "INVALID_PAGE");
const disposedBackgroundBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.SUITEQL_DISPOSE,
  {},
  validBackgroundSender,
  "paged"
);
const disposedBackgroundResponse = disposedBackgroundBridge.result;
assert.equal(disposedBackgroundResponse.disposed, true);
const expiredBackgroundPageBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.SUITEQL_PAGE,
  { pageIndex: 0 },
  validBackgroundSender,
  "paged"
);
assert.equal(
  expiredBackgroundPageBridge.response.error.code,
  "ABORTED"
);

const pendingSlowSuiteQLBridge = sendBridgeCommand(
  bridgeApi.COMMANDS.SUITEQL_START,
  { query: "SELECT slow_bridge_query FROM customrecordtype", paged: false },
  validBackgroundSender,
  "slow-suiteql"
);
await slowBridgeFetchStarted;
const canceledSlowSuiteQLBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.CANCEL,
  {
    targetCommand: bridgeApi.COMMANDS.SUITEQL_START,
    targetRequestId: "slow-suiteql"
  },
  validBackgroundSender,
  "cancel-slow-suiteql"
);
assert.equal(canceledSlowSuiteQLBridge.result.canceled, true);
assert.equal((await pendingSlowSuiteQLBridge).response.error.code, "ABORTED");
await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
assert.equal(slowBridgeFetchAborted, true);
slowBridgeFetchStarted = new Promise((resolveStarted) => {
  resolveSlowBridgeFetchStarted = resolveStarted;
});

const emptyPagedBackgroundBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.SUITEQL_START,
  { query: "SELECT empty_result FROM customrecordtype ORDER BY id", paged: true },
  validBackgroundSender,
  "empty-paged"
);
const emptyPagedBackgroundResponse = emptyPagedBackgroundBridge.result;
assert.equal(emptyPagedBackgroundResponse.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(emptyPagedBackgroundResponse.rows)), []);
assert.equal(emptyPagedBackgroundResponse.totalCount, 0);
assert.equal(emptyPagedBackgroundResponse.totalPages, 0);

const invalidFieldBackgroundBridge = await sendBridgeCommand(
  bridgeApi.COMMANDS.SUITEQL_START,
  { query: "SELECT invalid_field FROM customrecordtype", paged: false },
  validBackgroundSender,
  "invalid-field"
);
const invalidFieldBackgroundResponse = invalidFieldBackgroundBridge.result;
assert.equal(invalidFieldBackgroundResponse.ok, false);
assert.equal(invalidFieldBackgroundResponse.error.code, "SSS_SEARCH_ERROR_OCCURRED");
assert.equal(invalidFieldBackgroundResponse.error.message, "Field 'invalid_field' was not found.");

await access(resolve(root, "dist/suiteql-studio.js"));
await access(resolve(root, "dist/material-palette.js"));
await access(resolve(root, "save/SUITEMATE_V1_MASTER_FEATURE_INVENTORY.md"));

const expectedStyleHashes = {
  "src/styles/font.css": "ecc7a99f6b820ee9290ab4a3ca2ff1ea4829c1a539c0d42becb19a3d5ea446cf",
  "src/styles/code.css": "e5607100c7432fd7028176ce74c4c999e181108861ea6b992ed3058d92d0d698",
  "src/styles/netsuite.css": "aa34d01749a11185639c5f8b94e088c2bbd24328b9b25db31429d5d22375b994",
  "src/styles/pages/bundlebuilder.css": "bb9cae83f75b192d0a913233a33b6a8e557df656f7251a6e48e3105532e9f8fa",
  "src/styles/pages/codeeditor.css": "b58efb6517cfc13ca04cb621bdf269599ad9d6a589f38dee268743dda60f84df",
  "src/styles/pages/dashboard.css": "caedaa535b9bd516a977cdbb9f85de0f42d04e2e7f59a13f41996101dc0db7b5",
  "src/styles/pages/fieldhelp.css": "8515c1f4faff7978138f7d1c4cff631703af0b550c5deb6eb4ea95351bb78e2d",
  "src/styles/pages/file.css": "7932445f8a76bf76b6d9ce6d02bc8d69f071e4c8f600171a8a26c03e8a3eb1b2",
  "src/styles/pages/filecabinet.css": "cac334ebfece700d1f4ab625b120226900c692ded5889e91227d3f266d41b0a5",
  "src/styles/pages/helpcenter.css": "a55d71f695b9e0d3b10208042336e39825812a4851f2fea0271561a07354dd2d",
  "src/styles/pages/login.css": "1fccdd4e23bcea525cae2d97f0b07f570cae3ffc2b008c488cc50efa17699a85",
  "src/styles/pages/pdftemplate.css": "b1494b7aad20982b6fe5e38866c6c733de9a1e0bb356b98e26fdbd24660f991a",
  "src/styles/pages/scripting.css": "fe85ad7e89062db75dcce2b604f6e8c02c1d4aa913ba942a76a341a992d2102c",
  "src/styles/pages/suiteql.css": "a7828bfb563baf36dc1d9b51ddf7b7077e8e8d37471dd0c31544705f69851cda",
  "src/styles/pages/workflow.css": "8c4dee7e097f533613dc10792c29d8465e50288f5498fe82b0942cd1185b115d"
};

for (const [file, expectedHash] of Object.entries(expectedStyleHashes)) {
  const source = await readFile(resolve(root, file));
  const actualHash = createHash("sha256").update(source).digest("hex");
  assert.equal(actualHash, expectedHash, `${file} no longer matches the V1 styling source`);
}

console.log(
  `Verified ${referencedFiles.size} manifest resources, the route registry, the typed NetSuite bridge, the observer lifecycle, ${Object.keys(expectedStyleHashes).length} V1 style hashes, role themes, CSV Import, CSV Export, and SuiteQL Core behavior.`
);
