import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, "SuiteMate V3");
assert.equal(manifest.version, "3.2.0");
assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
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
  "src/record-actions/csv-import.css"
]);
assert.deepEqual(globalThemeContentScript.js, [
  "src/shared/settings.js",
  "src/runtime/theme-runtime.js",
  "src/runtime/notification-runtime.js",
  "src/record-actions/core.js",
  "src/record-actions/csv-import.js"
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

const popupHtml = await readFile(resolve(root, manifest.action.default_popup), "utf8");
assert.equal((popupHtml.match(/class="role-color" type="hidden"/g) ?? []).length, 2, "The canonical Main and Secondary values changed");
assert.match(popupHtml, /id="mainColorTrigger"[^>]*aria-haspopup="dialog"/, "The Main unified picker trigger is missing");
assert.match(popupHtml, /id="secondaryColorTrigger"[^>]*aria-haspopup="dialog"/, "The Secondary unified picker trigger is missing");
assert.match(popupHtml, /id="colorPickerModal"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/, "The unified picker is not an accessible modal");
assert.match(popupHtml, /id="pickerMaterialShades"/, "Material shades are not contained inside the unified picker");
assert.doesNotMatch(popupHtml, /type="color"|mainMaterialShades|secondaryMaterialShades/, "The separate or native picker UI remains active");
assert.doesNotMatch(popupHtml, /Generate|company logo|recommended pair/i, "A separate palette workflow remains in the popup");
assert.match(popupHtml, />SuiteQL Console</, "The popup does not use the SuiteQL Console name");
assert.doesNotMatch(popupHtml, /SuiteQL Studio/, "The old SuiteQL Studio name remains in the popup");
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
  "tests/fixtures/import-assistant.html",
  "tests/fixtures/saved-search-results.html",
  "tests/fixtures/saved-search-edit.html",
  "tests/fixtures/popup-role.html",
  "tests/fixtures/theme-runtime.html",
  "tests/fixtures/suiteql-classic.html",
  "tests/fixtures/suiteql-redwood.html",
  "tests/fixtures/suiteql-normal-search.html"
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
  "src/shared/settings.js",
  "src/runtime/theme-runtime.js",
  "src/runtime/notification-runtime.js",
  "src/record-actions/core.js",
  "src/record-actions/csv-import.js",
  "src/record-actions/csv-import.css",
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

const themeRuntimeSource = await readFile(resolve(root, "src/runtime/theme-runtime.js"), "utf8");
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
assert.match(popupSource, /addEventListener\("input"/, "Color input does not trigger live preview");
assert.match(popupSource, /addEventListener\("pagehide"/, "Pending live colors are not flushed when the popup closes");
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
assert.match(popupSource, /setModalBackgroundInert\(true\)/, "Background controls remain interactive while the picker is open");
assert.match(popupSource, /event\.key === "Escape" && activePicker/, "Escape does not close the unified picker");
assert.doesNotMatch(popupSource, /companyLogo|logoPixel|generateLogo|recommendedPalette/i, "Logo-specific palette code remains in the popup");
assert.doesNotMatch(themeRuntimeSource, /companyLogo|logoPixel|LOGO_MAX/i, "Logo-specific palette code remains in the NetSuite runtime");

const notificationRuntimeSource = await readFile(resolve(root, "src/runtime/notification-runtime.js"), "utf8");
let notificationClickHandler;
let notificationRemoved = false;
const notificationClasses = new Set();
const notificationRootClasses = new Set();
const notificationSandbox = {
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
};
notificationSandbox.globalThis = notificationSandbox;
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
assert.doesNotMatch(notificationRuntimeSource, /salesord|searchresults|data-path/, "Notification dismissal contains page-specific behavior");

const recordActionsCoreSource = await readFile(resolve(root, "src/record-actions/core.js"), "utf8");
const recordActionsSandbox = { URL, URLSearchParams };
recordActionsSandbox.globalThis = recordActionsSandbox;
runInNewContext(recordActionsCoreSource, recordActionsSandbox);
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
assert.equal(
  recordActionsCore.isSupportedRecordPage({ pathname: "/app/common/search/searchresults.nl", search: "" }),
  false
);
assert.equal(
  recordActionsCore.isSupportedRecordPage({ pathname: "/app/common/search/ubersearchresults.nl", search: "?suiteql" }),
  false
);
assert.equal(
  recordActionsCore.isAllowedRecordSender({
    frameId: 0,
    tab: { id: 7 },
    url: "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=1"
  }),
  true
);
assert.equal(
  recordActionsCore.isAllowedRecordSender({
    frameId: 1,
    tab: { id: 7 },
    url: "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=1"
  }),
  false
);

const csvImportSource = await readFile(resolve(root, "src/record-actions/csv-import.js"), "utf8");
assert.match(csvImportSource, /className = "suitemate-v3-csv-import-cell"/, "CSV Import is not emitted as a standalone toolbar action");
assert.match(csvImportSource, /textContent = "CSV Import"/, "The CSV Import action label is missing");
assert.match(csvImportSource, /\.uir-buttons-top\.uir-header-buttons/, "The top record toolbar target is missing");
assert.match(csvImportSource, /actionsCell\.after\(createToolbarAction\(href\)\)/, "CSV Import is not inserted immediately after Actions");
assert.match(csvImportSource, /data-suitemate-v3-action/, "CSV Import injection is not idempotent");
assert.match(csvImportSource, /MutationObserver/, "Late-rendered NetSuite toolbars are not handled");
assert.doesNotMatch(csvImportSource, /Scripted Record|getRecordTypes|PlatformClientScriptHandler/, "CSV Import copied unrelated V1 dependencies");

const csvImportStyles = await readFile(resolve(root, "src/record-actions/csv-import.css"), "utf8");
assert.match(csvImportStyles, /--theme-secondary-light/, "CSV Import does not use the active SuiteMate theme");
assert.match(csvImportStyles, /--suitemate-radius-compact/, "CSV Import does not use the global radius system");
assert.match(csvImportStyles, /:focus-visible/, "CSV Import lacks a keyboard focus state");

const salesOrderFixtureSource = await readFile(resolve(root, "tests/fixtures/sales-order.html"), "utf8");
assert.match(salesOrderFixtureSource, /id="main_form"[\s\S]*?id="baserecordtype"[^>]+value="salesorder"/, "The CSV Import fixture lacks record context");
assert.match(salesOrderFixtureSource, /class="fixture-actions uir-buttons-top uir-header-buttons"[\s\S]*?class="uir-button-menu"[\s\S]*?>Actions</, "The CSV Import fixture lacks the top Actions toolbar control");

const importAssistantCoreSource = await readFile(resolve(root, "src/import-assistant/core.js"), "utf8");
const importAssistantSandbox = { URL };
importAssistantSandbox.globalThis = importAssistantSandbox;
runInNewContext(importAssistantCoreSource, importAssistantSandbox);
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
assert.equal(
  importAssistantCore.responseContainsSubtype(`label\u0001SALESORDER\u0001Sales Order\u0005ignored`, "salesorder"),
  true
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
assert.equal(
  importAssistantCore.isAllowedImportAssistantSender({
    frameId: 0,
    tab: { id: 8 },
    url: importAssistantUrl
  }),
  true
);
assert.equal(
  importAssistantCore.isAllowedImportAssistantSender({
    frameId: 0,
    tab: { id: 8 },
    url: "https://123456.app.netsuite.com/app/center/card.nl"
  }),
  false
);
const importContextSource = await readFile(resolve(root, "src/import-assistant/context-runtime.js"), "utf8");
assert.match(importContextSource, /charencoding: "UTF-8"/, "CSV Import does not default to UTF-8");
assert.match(importContextSource, /waitForSubtypeOption/, "Dependent CSV Import subtype sourcing is not handled");
assert.match(importContextSource, /data-name=|\[data-name=/, "CSV Import option metadata is not used");
assert.match(importContextSource, /importmethod", "filegroups"/, "Unknown CSV record types cannot resolve their category");
assert.doesNotMatch(importContextSource, /mapper_grp|Start Over|recid.*new/, "Unrelated Import Assistant features were migrated");

const importFixtureSource = await readFile(resolve(root, "tests/fixtures/import-assistant.html"), "utf8");
assert.match(importFixtureSource, /recordsubtype=salesorder/, "The Import Assistant fixture does not carry record context");
assert.match(importFixtureSource, /name="recordtype"[^>]+value="ACCOUNTING"/, "The Import Assistant fixture lacks the native category field");
assert.match(importFixtureSource, /name="recordsubtype"[^>]+value="ACCOUNT"/, "The Import Assistant fixture lacks the native subtype field");

const compatibilityStyles = await readFile(resolve(root, "src/styles/v3-compat.css"), "utf8");
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
  /border-bottom-color: light-dark\(var\(--theme-main\), var\(--theme-main-light\)\)/,
  "Global NetSuite tabs are not controlled by Main"
);
assert.match(
  compatibilityStyles,
  /html:not\(\.ext-f\) \.uir-tab-list-tabs \.formtaboff,[\s\S]*?background-color: var\(--theme-main\) !important/,
  "Inactive global NetSuite tabs are not controlled by Main"
);
assert.match(
  compatibilityStyles,
  /html:not\(\.ext-f\) \.uir-tab-list-tabs \.formtabon,[\s\S]*?background-color: var\(--theme-main-light\) !important/,
  "The active global NetSuite tab is not controlled by Main Light"
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
  /\.uir-subtab-panel-tabs-row \.formsubtabon,[\s\S]*?background-color: var\(--suitemate-v3-subtab-active-bg\) !important/,
  "The active nested NetSuite tab is not controlled by Secondary"
);
assert.match(
  compatibilityStyles,
  /td\.fgroup_title\.uir-field-group>div\.fgroup_title[\s\S]*?background-color: var\(--theme-secondary-light\) !important/,
  "Global NetSuite field groups are not controlled by Secondary"
);
assert.doesNotMatch(
  compatibilityStyles,
  /suitemate-v3-table-header-(?:bg|border): var\(--theme-main/,
  "Global NetSuite table headers still depend on Main"
);
assert.doesNotMatch(
  compatibilityStyles,
  /data-path=|salesord\.nl|#item_splits/,
  "The compatibility layer still contains page-specific styling"
);

const settingsSource = await readFile(resolve(root, "src/shared/settings.js"), "utf8");
const settingsSandbox = {};
settingsSandbox.globalThis = settingsSandbox;
runInNewContext(settingsSource, settingsSandbox);
const settingsApi = settingsSandbox.SuiteMateV3Settings;
assert.equal(settingsApi.THEME_PREVIEW_MESSAGE, "SUITEMATE_V3_PREVIEW_ROLE_THEME");
assert.equal(settingsApi.DEFAULTS.squareCorners, false);
assert.equal(settingsApi.normalize({ squareCorners: true }).squareCorners, true);
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
const materialPaletteSandbox = {};
materialPaletteSandbox.globalThis = materialPaletteSandbox;
runInNewContext(materialPaletteSource, materialPaletteSandbox);
const { generateMaterialShades } = materialPaletteSandbox.SuiteMateV3MaterialPalette;
const materialShades = generateMaterialShades("#607799");
assert.equal(materialShades.source, "#607799");
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
assert.equal(JSON.stringify(generateMaterialShades("#607799")), JSON.stringify(materialShades));
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
const coreSandbox = { URL, Date };
coreSandbox.globalThis = coreSandbox;
runInNewContext(coreSource, coreSandbox);
const suiteqlCore = coreSandbox.SuiteMateV3SuiteQLCore;
const studioUrl = "https://123456.app.netsuite.com/app/common/search/ubersearchresults.nl?suiteql";

assert.equal(suiteqlCore.isAllowedNetSuiteUrl(studioUrl), true);
assert.equal(suiteqlCore.isAllowedNetSuiteUrl("https://www.netsuite.com/portal/home.shtml"), false);
assert.equal(suiteqlCore.isAllowedNetSuiteUrl("https://123.extforms.netsuite.com/app/site/hosting/scriptlet.nl"), false);
assert.equal(suiteqlCore.isSuiteQLStudioUrl(studioUrl), true);
assert.equal(
  suiteqlCore.isSuiteQLStudioUrl("https://123456.app.netsuite.com/app/common/search/ubersearchresults.nl?search=customer"),
  false
);
assert.equal(
  suiteqlCore.createStudioUrl("https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=10"),
  studioUrl
);
assert.equal(
  suiteqlCore.isAllowedStudioSender({ frameId: 0, tab: { id: 44 }, url: studioUrl }),
  true
);
assert.equal(
  suiteqlCore.isAllowedStudioSender({ frameId: 2, tab: { id: 44 }, url: studioUrl }),
  false
);
assert.equal(
  suiteqlCore.isAllowedStudioSender({ frameId: 0, tab: { id: 44 }, url: "https://example.com/app/common/search/ubersearchresults.nl?suiteql" }),
  false
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
assert.deepEqual(
  JSON.parse(JSON.stringify(suiteqlCore.normalizeResponse({
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
  }))),
  {
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
  }
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

assert.equal(suiteqlCore.protectCsvValue("=SUM(A1:A2)"), "'=SUM(A1:A2)");
assert.equal(suiteqlCore.protectCsvValue("  @SUM(A1:A2)"), "'  @SUM(A1:A2)");
assert.equal(suiteqlCore.protectCsvValue(-2), "-2");
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
assert.match(studioSource, /<h1>SuiteQL Console<\/h1>/, "The workspace does not use the SuiteQL Console name");
assert.match(studioSource, /document\.title = "SuiteQL Console"/, "The browser title does not use the SuiteQL Console name");
assert.doesNotMatch(studioSource, /SuiteQL Studio/, "The old SuiteQL Studio name remains in the workspace");
assert.match(studioStyles, /--suiteql-radius-panel: var\(--suitemate-radius-dialog, 10px\)/, "The Console is not connected to the global radius system");
assert.match(studioStyles, /#suitemate-suiteql-studio \[hidden\][\s\S]*?display: none !important/, "Hidden Console controls can be exposed by component display styles");
assert.match(backgroundSource, /PlatformClientScriptHandler\.nl/, "SuiteQL does not use the V1 NetSuite bridge endpoint");
assert.match(backgroundSource, /"queryApiBridge"/, "SuiteQL does not call NetSuite's queryApiBridge");
assert.match(backgroundSource, /"runSuiteQL"/, "Unpaged SuiteQL bridge execution is missing");
assert.match(backgroundSource, /"suiteQLPagedQuery"/, "Paged SuiteQL bridge execution is missing");
assert.match(backgroundSource, /"getSuiteQLQueryPage"/, "Progressive SuiteQL bridge paging is missing");
assert.match(backgroundSource, /"SUITE_QL"/, "SuiteQL permission errors can be hidden by a static metadata provider");
assert.match(backgroundSource, /credentials: "include"/, "SuiteQL bridge requests do not use the authenticated NetSuite session");
assert.match(backgroundSource, /world: "MAIN"/, "SuiteQL is not executed in NetSuite's main world");
assert.match(backgroundSource, /\["N\/currentRecord"\]/, "CSV Import context does not use NetSuite's current record API");
assert.match(backgroundSource, /forceSyncSourcing: true/, "CSV Import dependent fields are not sourced synchronously");
assert.doesNotMatch(backgroundSource, /\["N\/query"\]/, "SuiteQL still depends on an unavailable page-level N/query loader");
assert.match(studioSource, /state\.selection\.main/, "Selected editor text is not executed");
assert.match(studioSource, /document\.querySelector\("#body"\)/, "Studio is not mounted in NetSuite's visible workspace host");
assert.match(studioSource, /sessionStorage\.setItem\(SESSION_KEYS\.draft/, "Per-tab draft persistence is missing");
assert.match(studioSource, /content\.textContent = core\.displayValue\(value\)/, "Query values are not rendered as text");
assert.match(studioSource, /Mod-Shift-p/, "Paged keyboard shortcut is missing");
assert.match(studioSource, /Mod-Shift-e/, "Export keyboard shortcut is missing");
assert.match(studioSource, /Mod-Shift-l/, "Clear keyboard shortcut is missing");
assert.match(
  studioSource,
  /id="suiteql-suitesense" href="https:\/\/suitesense\.vercel\.app\/" target="_blank" rel="noopener noreferrer"/,
  "SuiteSense is not exposed as a safe external SuiteQL resource"
);
assert.match(studioSource, />Generate with SuiteSense<\//, "SuiteSense action text is missing");
assert.match(studioSource, /id="suiteql-inspect-table" type="button" hidden/, "Inspect Table is visible");
assert.match(studioSource, /id="suiteql-records-catalog"[^>]+hidden/, "Records Catalog is visible");
assert.doesNotMatch(backgroundSource, /nlapijsonhandler/i, "SuiteQL uses the unrelated legacy NLAPI JSON endpoint");

let backgroundMessageListener;
let mockNow = 100;
const importAssistantAppliedValues = {};
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
  const request = JSON.parse(options.body);
  const [bridgeName, operation, serializedArguments] = request.params;
  const operationArguments = JSON.parse(serializedArguments);
  bridgeCalls.push({ url, options, method: request.method, bridgeName, operation, operationArguments });

  const query = operation === "suiteQLPagedQuery" ? operationArguments[1] : operationArguments[0];
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
const backgroundSandbox = {
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
  window: {
    require(_modules, onSuccess) {
      onSuccess({
        get() {
          return {
            getField({ fieldId }) {
              return importAssistantCore.ALLOWED_FIELDS.includes(fieldId) ? { type: "select" } : null;
            },
            setValue(options, positionalValue) {
              const fieldId = typeof options === "object" ? options.fieldId : options;
              const value = typeof options === "object" ? options.value : positionalValue;
              importAssistantAppliedValues[fieldId] = value;
            }
          };
        }
      });
    }
  },
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
      async executeScript({ func, args = [] }) {
        if (args.length === 0) {
          return [{ result: "salesorder" }];
        }
        return [{ result: await func(...args) }];
      }
    }
  }
};
backgroundSandbox.globalThis = backgroundSandbox;
runInNewContext(backgroundSource, backgroundSandbox);

function sendBackgroundMessage(message, sender) {
  return new Promise((resolveResponse, rejectResponse) => {
    const handled = backgroundMessageListener(message, sender, resolveResponse);
    if (handled !== true) {
      rejectResponse(new Error(`Background did not handle ${message.type}`));
    }
  });
}

const validBackgroundSender = { frameId: 0, tab: { id: 71, url: studioUrl }, url: studioUrl };
const recordPageUrl = "https://123456.app.netsuite.com/app/accounting/transactions/salesord.nl?id=10";
const validRecordSender = { frameId: 0, tab: { id: 72, url: recordPageUrl }, url: recordPageUrl };
const recordTypeResponse = await sendBackgroundMessage(
  { type: recordActionsCore.RECORD_TYPE_MESSAGE },
  validRecordSender
);
assert.deepEqual(JSON.parse(JSON.stringify(recordTypeResponse)), { ok: true, recordType: "salesorder" });
const rejectedRecordTypeResponse = await sendBackgroundMessage(
  { type: recordActionsCore.RECORD_TYPE_MESSAGE },
  { ...validRecordSender, frameId: 1 }
);
assert.equal(rejectedRecordTypeResponse.error, "INVALID_SENDER");
const validImportAssistantSender = {
  frameId: 0,
  tab: { id: 73, url: importAssistantUrl },
  url: importAssistantUrl
};
const importAssistantResponse = await sendBackgroundMessage(
  {
    type: importAssistantCore.SET_VALUES_MESSAGE,
    values: {
      charencoding: "UTF-8",
      recordtype: "TRANSACTION",
      recordsubtype: "SALESORDER",
      arbitrary: "BLOCKED"
    }
  },
  validImportAssistantSender
);
assert.equal(importAssistantResponse.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(importAssistantResponse.applied)), [
  "charencoding",
  "recordtype",
  "recordsubtype"
]);
assert.deepEqual(importAssistantAppliedValues, {
  charencoding: "UTF-8",
  recordtype: "TRANSACTION",
  recordsubtype: "SALESORDER"
});
const rejectedImportAssistantResponse = await sendBackgroundMessage(
  {
    type: importAssistantCore.SET_VALUES_MESSAGE,
    values: { recordtype: "TRANSACTION" }
  },
  { ...validImportAssistantSender, url: recordPageUrl, tab: { id: 73, url: recordPageUrl } }
);
assert.equal(rejectedImportAssistantResponse.error.code, "INVALID_SENDER");
const rejectedBackgroundResponse = await sendBackgroundMessage(
  { type: suiteqlCore.MESSAGE_TYPES.START, requestId: "rejected", query: "SELECT 1", paged: false },
  { frameId: 1, tab: { id: 71, url: studioUrl }, url: studioUrl }
);
assert.equal(rejectedBackgroundResponse.error.code, "INVALID_SENDER");

const unpagedBackgroundResponse = await sendBackgroundMessage(
  { type: suiteqlCore.MESSAGE_TYPES.START, requestId: "unpaged", query: "SELECT id, scriptid FROM customrecordtype", paged: false },
  validBackgroundSender
);
assert.equal(unpagedBackgroundResponse.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(unpagedBackgroundResponse.columns)), ["id", "scriptid"]);
assert.deepEqual(JSON.parse(JSON.stringify(unpagedBackgroundResponse.rows)), [
  { id: 10, scriptid: "ten" },
  { id: 11, scriptid: "eleven" }
]);
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

const pagedBackgroundResponse = await sendBackgroundMessage(
  { type: suiteqlCore.MESSAGE_TYPES.START, requestId: "paged", query: "SELECT id, scriptid FROM customrecordtype ORDER BY id", paged: true },
  validBackgroundSender
);
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

const nextBackgroundPage = await sendBackgroundMessage(
  { type: suiteqlCore.MESSAGE_TYPES.PAGE, requestId: "paged", pageIndex: 1 },
  validBackgroundSender
);
assert.equal(nextBackgroundPage.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(nextBackgroundPage.rows)), [{ id: 1001, scriptid: "last" }]);
assert.equal(nextBackgroundPage.loadedCount, 1001);
const disposedBackgroundResponse = await sendBackgroundMessage(
  { type: suiteqlCore.MESSAGE_TYPES.DISPOSE, requestId: "paged" },
  validBackgroundSender
);
assert.equal(disposedBackgroundResponse.disposed, true);

const emptyPagedBackgroundResponse = await sendBackgroundMessage(
  { type: suiteqlCore.MESSAGE_TYPES.START, requestId: "empty-paged", query: "SELECT empty_result FROM customrecordtype ORDER BY id", paged: true },
  validBackgroundSender
);
assert.equal(emptyPagedBackgroundResponse.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(emptyPagedBackgroundResponse.rows)), []);
assert.equal(emptyPagedBackgroundResponse.totalCount, 0);
assert.equal(emptyPagedBackgroundResponse.totalPages, 0);

const invalidFieldBackgroundResponse = await sendBackgroundMessage(
  { type: suiteqlCore.MESSAGE_TYPES.START, requestId: "invalid-field", query: "SELECT invalid_field FROM customrecordtype", paged: false },
  validBackgroundSender
);
assert.equal(invalidFieldBackgroundResponse.ok, false);
assert.equal(invalidFieldBackgroundResponse.error.code, "SSS_SEARCH_ERROR_OCCURRED");
assert.equal(invalidFieldBackgroundResponse.error.message, "Field 'invalid_field' was not found.");

await access(resolve(root, "dist/suiteql-studio.js"));
await access(resolve(root, "dist/material-palette.js"));
await access(resolve(root, "save/SUITEMATE_V1_MASTER_FEATURE_INVENTORY.md"));

const expectedStyleHashes = {
  "src/styles/font.css": "ecc7a99f6b820ee9290ab4a3ca2ff1ea4829c1a539c0d42becb19a3d5ea446cf",
  "src/styles/code.css": "e5607100c7432fd7028176ce74c4c999e181108861ea6b992ed3058d92d0d698",
  "src/styles/netsuite.css": "56c4251792aa7884469cb6904ae2ce0fa68731db5e9d660ead7bff2144b2af56",
  "src/styles/pages/bundlebuilder.css": "bb9cae83f75b192d0a913233a33b6a8e557df656f7251a6e48e3105532e9f8fa",
  "src/styles/pages/codeeditor.css": "b58efb6517cfc13ca04cb621bdf269599ad9d6a589f38dee268743dda60f84df",
  "src/styles/pages/dashboard.css": "024b4ea648cf4227bdb7fabe762255a36180ce34c8291e1ba0400ee8295d6a68",
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
  `Verified ${referencedFiles.size} manifest resources, ${Object.keys(expectedStyleHashes).length} V1 style hashes, role themes, CSV Import, and SuiteQL Core behavior.`
);
