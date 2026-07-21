(function installSuiteMateV3RouteFixture(globalScope) {
  "use strict";

  const catalog = globalScope.SuiteMateV3FixtureCatalog;
  if (!catalog) {
    throw new Error("SuiteMate V3 fixture catalog is unavailable");
  }

  const requestedFixtureId = new URL(globalScope.location.href).searchParams.get("fixture") || "dashboard";
  const routes = [...catalog.CLASSIC_ROUTES, ...catalog.CLASSIC_VARIANTS];
  const route = routes.find((entry) => entry.fixtureId === requestedFixtureId);

  if (!route) {
    throw new Error(`Unknown SuiteMate V3 fixture: ${requestedFixtureId}`);
  }

  globalScope.SuiteMateV3ActiveFixture = route;
  globalScope.history.replaceState({ fixtureId: route.fixtureId }, "", route.path);
  document.title = `${route.title} - SuiteMate V3 Classic fixture`;
  document.documentElement.dataset.fixtureId = route.fixtureId;
  document.documentElement.dataset.fixtureProfile = "classic";
  document.documentElement.dataset.fixtureRouteExpected = route.routeId;

  for (const style of route.pageStyles) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.fixturePageStyle = style;
    link.href = style.startsWith("../../")
      ? `/src/styles/pages/${style}`
      : `/src/styles/pages/${style}`;
    document.head.append(link);
  }

  function escapeText(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function shell(content, options = {}) {
    const recordType = options.recordType || "NetSuite";
    const actions = options.actions === false
      ? ""
      : `<div class="fixture-actions uir-buttons-top uir-header-buttons">
          <table><tbody><tr class="uir-buttons">
            <td><button class="uir-button" type="button">Edit</button></td>
            <td class="uir-button-menu"><ul class="ns-menu"><li class="ns-menuitem"><a href="#actions">Actions</a></li></ul></td>
          </tr></tbody></table>
        </div>`;

    return `<header class="fixture-shell-header" data-widget="ClassicSystemHeader">
        <strong>NetSuite Classic</strong>
        <nav aria-label="Main navigation">
          <a href="#transactions">Transactions</a>
          <a href="#lists">Lists</a>
          <a href="#reports">Reports</a>
          <a href="#setup">Setup</a>
        </nav>
      </header>
      <main id="div__body" class="fixture-page">
        <div class="fixture-title">
          <div>
            <div class="fixture-record-type uir-record-type">${escapeText(recordType)}</div>
            <h1 class="fixture-page-title uir-page-title-firstline">${escapeText(route.title)}</h1>
          </div>
          ${actions}
        </div>
        ${content}
      </main>`;
  }

  function listTable(id, columns, rows) {
    return `<div class="uir-list-body">
      <table id="${escapeText(id)}" class="uir-list-table">
        <tbody>
          <tr class="uir-list-headerrow">${columns.map((column) => `<td class="uir-list-header-td"><div class="listheader">${escapeText(column)}</div></td>`).join("")}</tr>
          ${rows.map((row, index) => `<tr class="uir-list-row-tr ${index % 2 ? "uir-list-row-even" : "uir-list-row-odd"}">${row.map((cell) => `<td>${escapeText(cell)}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function fieldGrid(fields) {
    return `<section class="fixture-form-grid">${fields.map(([label, value, kind = "input"]) => {
      if (kind === "select") {
        return `<label class="uir-field-wrapper"><span class="uir-label">${escapeText(label)}</span><select class="uir-input-dropdown-native"><option>${escapeText(value)}</option></select></label>`;
      }
      if (kind === "textarea") {
        return `<label class="uir-field-wrapper"><span class="uir-label">${escapeText(label)}</span><textarea class="input">${escapeText(value)}</textarea></label>`;
      }
      return `<label class="uir-field-wrapper"><span class="uir-label">${escapeText(label)}</span><input class="input" value="${escapeText(value)}"></label>`;
    }).join("")}</section>`;
  }

  function machineTable(id = "item_splits") {
    return `<section class="uir-machine-table-container">
      <table id="${escapeText(id)}" class="uir-machine-table">
        <tbody>
          <tr class="uir-machine-headerrow"><td><div class="listheader">Item</div></td><td><div class="listheader">Description</div></td><td><div class="listheader">Quantity</div></td><td><div class="listheader">Amount</div></td></tr>
          <tr class="uir-machine-row"><td>SKU-1001</td><td>Fixture product one</td><td>2</td><td>$36.00</td></tr>
          <tr class="uir-machine-row"><td>SKU-2004</td><td>Fixture product two</td><td>1</td><td>$24.00</td></tr>
        </tbody>
      </table>
    </section>`;
  }

  function recordTabs() {
    return `<nav class="uir-tabs uir-tab-list uir-tab-list-tabs" aria-label="Record tabs">
      <span class="formtabon"><a class="formtabtext formtabtexton" href="#items">Items</a></span>
      <span class="formtaboff"><a class="formtabtext" href="#shipping">Shipping</a></span>
      <span class="formtaboff"><a class="formtabtext" href="#related">Related Records</a></span>
    </nav>
    <div class="uir-subtab-panel-tabs">
      <div class="uir-subtab-panel-tabs-row fixture-subtabs">
        <span class="formsubtabon"><a class="formsubtabtext" href="#standard">Standard</a></span>
        <span class="formsubtaboff"><a class="formsubtabtext" href="#system">System Notes</a></span>
      </div>
    </div>`;
  }

  function renderDashboard() {
    return shell(`<section id="ns-dashboard-content" class="ns-dashboard-column">
      <article class="ns-portlet-wrapper" data-portlet-type="reminders"><div class="ns-portlet-header">Reminders</div><div class="ns-portlet-body">Sales Orders to Fulfill <strong>12</strong><br>Invoices to Approve <strong>4</strong></div></article>
      <article class="ns-portlet-wrapper" data-portlet-type="recentrecords"><div class="ns-portlet-header">Recent Records</div><div class="ns-portlet-body">Sales Order #SO10428<br>Sample Customer<br>Inventory Item SKU-1001</div></article>
      <article class="ns-portlet-wrapper" data-portlet-type="tasklinks"><div class="ns-portlet-header">Shortcuts</div><div class="ns-portlet-body">Enter Sales Order<br>Create Customer<br>Upload CSV</div></article>
      <article class="ns-portlet-wrapper" data-portlet-type="calendar"><div class="ns-portlet-header">Calendar</div><div class="ns-portlet-body">Monday 21 July 2026<br>Release checkpoint</div></article>
    </section>`, { recordType: "Dashboard", actions: false });
  }

  function renderLogin() {
    return `<main class="fixture-login-page">
      <form id="login-form" class="fixture-login-card">
        <h1>${escapeText(route.title)}</h1>
        <p>Sign in to your NetSuite account.</p>
        <label>Email address<input class="input" type="email" value="fixture@example.com"></label>
        <label>Password<input class="input" type="password" value="fixture-password"></label>
        <button id="login-submit" class="uir-button" type="button">Log In</button>
      </form>
    </main>`;
  }

  function renderFile() {
    return shell(`<form id="mediaitem_form">
      <div class="fgroup_title uir-field-group"><div class="fgroup_title uir-field-group-title">File Information</div></div>
      ${fieldGrid([["Name", "fixture-script.js"], ["Folder", "SuiteScripts", "select"], ["Description", "Regression fixture", "textarea"]])}
      ${listTable("filelinks", ["Referenced By", "Type", "Modified"], [["Custom Script", "SuiteScript", "21/07/2026"]])}
    </form>`, { recordType: "File Cabinet" });
  }

  function renderFileCabinet() {
    return shell(`<div class="fixture-split">
      <aside id="div__nav" class="fixture-tree"><strong>Folders</strong><ul id="nav_tree_b_c"><li>SuiteScripts<ul><li>SuiteMate V3</li><li>Libraries</li></ul></li><li>Images</li><li>Templates</li></ul></aside>
      <section><div class="fixture-toolbar"><button class="uir-button">Add File</button><button class="uir-button">New Folder</button></div>${listTable("mediaitemlist", ["Name", "Type", "Size", "Modified"], [["SuiteMate.js", "JavaScript", "18 KB", "21/07/2026"], ["logo.png", "Image", "42 KB", "18/07/2026"]])}</section>
    </div>`, { recordType: "Documents", actions: false });
  }

  function renderCodeEditor() {
    return shell(`<section id="codeeditor" class="fixture-section"><div class="fixture-toolbar"><button class="uir-button">Save</button><button class="uir-button">Download</button></div><div class="CodeMirror" role="textbox" aria-label="Source code">/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(["N/record"], (record) =&gt; {
  const beforeLoad = (context) =&gt; context.form.title = "Fixture";
  return { beforeLoad };
});</div></section>`, { recordType: "File" });
  }

  function renderScriptForm() {
    return shell(`<form id="script_form">
      <div class="fgroup_title uir-field-group"><div class="fgroup_title uir-field-group-title">Primary Information</div></div>
      ${fieldGrid([["Name", "SuiteMate Fixture Script"], ["Script ID", "customscript_suitemate_fixture"], ["Owner", "Administrator", "select"]])}
      ${recordTabs()}
      ${listTable("scriptdeployments", ["Deployment", "Status", "Audience"], [["customdeploy_suitemate_fixture", "Testing", "Administrator"], ["customdeploy_suitemate_release", "Released", "All Roles"]])}
    </form>`, { recordType: "Customization" });
  }

  function renderStatusList() {
    return shell(`<div class="fixture-toolbar"><button class="uir-button">Refresh</button><select class="uir-input-dropdown-native"><option>All Statuses</option></select></div>${listTable("scriptstatuslist", ["Script", "Deployment", "Status", "Start Time", "Duration"], [["SuiteMate Fixture", "customdeploy_fixture", "Complete", "10:24 AM", "2.4 s"], ["CSV Worker", "customdeploy_csv", "Processing", "10:26 AM", "18.2 s"]])}`, { recordType: "Customization", actions: false });
  }

  function renderSearchForm(editing = false) {
    return shell(`<form id="search_form">
      ${fieldGrid([["Search Title", editing ? "Example Transaction Search" : "", "input"], ["Search Type", "Transaction", "select"], ["Public", "No", "select"]])}
      <nav class="uir-tabs uir-tab-list-tabs" aria-label="Search tabs"><span id="criteria_tablnk" class="formtabon"><a class="formtabtext formtabtexton" href="#criteria">Criteria</a></span><span class="formtaboff"><a class="formtabtext" href="#results">Results</a></span><span class="formtaboff"><a class="formtabtext" href="#audience">Audience</a></span></nav>
      <div class="uir-subtab-panel-tabs"><div class="uir-subtab-panel-tabs-row fixture-subtabs"><span class="formsubtabon">Standard</span><span class="formsubtaboff">Summary</span></div></div>
      ${machineTable("searchfilters")}
    </form>`, { recordType: "Reports" });
  }

  function renderResultList() {
    const nativeMarker = route.routeId === "global-search-results" ? '<p id="native-global-search-result">Native Global Search remains active.</p>' : "";
    return shell(`${nativeMarker}<div class="fixture-toolbar"><button class="uir-button">Edit Search</button><select class="uir-input-dropdown-native"><option>1 to 25 of 100</option></select></div>${listTable("searchresultstable", ["Edit | View", "Internal ID", "Name", "Status"], [["Edit | View", "5471", "Example Transaction Search", "Public"], ["Edit | View", "5472", "Open Sales Orders", "Private"]])}`, { recordType: "Lists", actions: false });
  }

  function renderSuiteQL() {
    return `<header class="fixture-shell-header" data-widget="ClassicSystemHeader"><strong>NetSuite Classic</strong><nav aria-label="Main navigation"><a href="#transactions">Transactions</a><a href="#lists">Lists</a><a href="#reports">Reports</a></nav></header>
      <table id="div__body"><tbody><tr><td>Native Global Search results placeholder</td></tr></tbody></table>
      <form id="footer_actions_form"><button type="button">Native action</button></form>`;
  }

  function renderHelp() {
    return shell(`<section id="helpcenter" class="fixture-split"><aside class="fixture-tree"><strong>Help Topics</strong><ul class="help-topic-list"><li>Accounting</li><li>Lists</li><li>Transactions</li><li>SuiteCloud Platform</li></ul></aside><article class="fixture-panel"><div class="fixture-panel-title">NetSuite Help Center</div><div class="fixture-panel-body"><label class="fixture-stack">Search Help<input class="input" value="SuiteQL"></label><h2>SuiteAnalytics Workbook</h2><p>Use SuiteAnalytics to query and analyze NetSuite data.</p></div></article></section>`, { recordType: "Help", actions: false });
  }

  function renderCatalog() {
    return shell(`<section id="recordscatalog"><div class="fixture-toolbar"><input class="input" value="transaction"><button class="uir-button">Search</button></div>${listTable("catalogrecords", ["Record", "Script ID", "Category"], [["Transaction", "transaction", "Transactions"], ["Customer", "customer", "Relationships"], ["Item", "item", "Lists"]])}</section>`, { recordType: "Analytics", actions: false });
  }

  function renderAssistant() {
    const isBundle = route.routeId === "bundle-builder";
    return shell(`<section id="importassistant">
      <div class="fixture-wizard-steps"><span class="active">1 ${isBundle ? "Bundle Basics" : "Scan & Upload CSV File"}</span><span>2 ${isBundle ? "Select Objects" : "Import Options"}</span><span>3 ${isBundle ? "Review" : "Field Mapping"}</span><span>4 Save & Run</span></div>
      ${fieldGrid([[isBundle ? "Bundle Name" : "Import Type", isBundle ? "SuiteMate Fixture Bundle" : "Transactions", "select"], [isBundle ? "Version" : "Record Type", isBundle ? "1.0.0" : "Sales Order", "select"], ["Character Encoding", "UTF-8", "select"]])}
      <input name="recordtype" type="hidden" value="ACCOUNTING"><input name="inpt_recordtype" type="hidden" value="Transactions"><input name="recordsubtype" type="hidden" value="ACCOUNT"><input name="inpt_recordsubtype" type="hidden" value="Account"><div data-name="recordsubtype" data-options='[{"value":"SALESORDER","text":"Sales Order"}]'></div>
      ${listTable("assistantobjects", ["Include", "Object", "Type"], [["Yes", "SuiteMate Fixture", isBundle ? "Custom Object" : "CSV File"], ["No", "Related Records", "Dependency"]])}
    </section>`, { recordType: "Setup", actions: false });
  }

  function renderTemplateEditor() {
    return shell(`<section id="template-editor"><div class="fixture-toolbar"><button class="uir-button">Save</button><button class="uir-button">Preview</button><select class="uir-input-dropdown-native"><option>Source Code</option></select></div><div class="CodeMirror" role="textbox" aria-label="Template source">&lt;?xml version="1.0"?&gt;
&lt;pdf&gt;
  &lt;head&gt;&lt;style&gt;body { font-family: sans-serif; }&lt;/style&gt;&lt;/head&gt;
  &lt;body&gt;
    &lt;h1&gt;\${record.tranid}&lt;/h1&gt;
    &lt;p&gt;\${record.entity}&lt;/p&gt;
  &lt;/body&gt;
&lt;/pdf&gt;</div></section>`, { recordType: "Advanced PDF/HTML Template" });
  }

  function renderWorkflow() {
    return shell(`<section id="workflow-desktop" class="workflow-canvas"><article class="workflow-state"><strong>Entry</strong><p>On Create</p></article><article class="workflow-state"><strong>Pending Approval</strong><p>Send approval email</p></article><article class="workflow-state"><strong>Approved</strong><p>Set status</p></article></section>`, { recordType: "Workflow" });
  }

  function renderRecord() {
    return shell(`<form id="main_form"><input id="baserecordtype" type="hidden" value="salesorder">
      <div class="fgroup_title uir-field-group"><div class="fgroup_title uir-field-group-title">Primary Information</div></div>
      ${fieldGrid([["Customer", "Sample Customer"], ["Date", "21/07/2026"], ["Status", "Pending Fulfillment", "select"], ["Memo", "Route-complete regression fixture", "textarea"]])}
      <div class="fgroup_title uir-field-group"><div class="fgroup_title uir-field-group-title">Classification</div></div>
      ${fieldGrid([["Subsidiary", "Australia", "select"], ["Location", "Sydney Warehouse", "select"], ["Department", "Sales", "select"]])}
      ${recordTabs()}${machineTable()}
    </form>`, { recordType: "Sales Order" });
  }

  function renderFieldHelp() {
    return `<main id="fieldhelp" class="fixture-field-help"><section class="uir-alert-box"><h1>Customer</h1><p>Select the customer for this transaction. The available values depend on the selected subsidiary.</p><button class="uir-button" type="button">Close</button></section></main>`;
  }

  const renderers = {
    dashboard: renderDashboard,
    login: renderLogin,
    file: renderFile,
    "file-cabinet": renderFileCabinet,
    "code-editor": renderCodeEditor,
    "script-form": renderScriptForm,
    "status-list": renderStatusList,
    "search-form": () => renderSearchForm(false),
    "search-edit": () => renderSearchForm(true),
    "result-list": renderResultList,
    suiteql: renderSuiteQL,
    help: renderHelp,
    catalog: renderCatalog,
    assistant: renderAssistant,
    "template-editor": renderTemplateEditor,
    workflow: renderWorkflow,
    record: renderRecord,
    "field-help": renderFieldHelp
  };

  function verifyReady() {
    const routeApi = globalScope.SuiteMateV3Routes;
    const actualRoute = routeApi?.createPageContext(globalScope.location, { trustedContentScript: true })?.routeId || "unavailable";
    document.documentElement.dataset.fixtureRouteActual = actualRoute;
    const missing = route.requiredSelectors.filter((selector) => !document.querySelector(selector));
    const unexpected = route.forbiddenSelectors.filter((selector) => document.querySelector(selector));
    if (actualRoute !== route.routeId) {
      document.documentElement.dataset.fixtureError = `Expected route ${route.routeId}, received ${actualRoute}`;
      return false;
    }
    if (missing.length > 0) {
      document.documentElement.dataset.fixtureError = `Missing selectors: ${missing.join(", ")}`;
      return false;
    }
    if (unexpected.length > 0) {
      document.documentElement.dataset.fixtureError = `Unexpected selectors: ${unexpected.join(", ")}`;
      return false;
    }
    document.documentElement.dataset.fixtureReady = "true";
    return true;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const renderer = renderers[route.layout];
    if (!renderer) {
      document.documentElement.dataset.fixtureError = `Unsupported layout: ${route.layout}`;
      return;
    }

    document.body.innerHTML = renderer();
    const session = document.createElement("script");
    session.type = "application/json";
    session.src = "/javascript/sessionstatus/session_status_init.jsp?id=FIXTURE~1~3~N&companyName=Fixture+Company&roleName=Administrator&companyId=FIXTURE&roleId=3";
    document.body.append(session);

    let attempts = 0;
    const readyTimer = globalScope.setInterval(() => {
      attempts += 1;
      if (verifyReady() || attempts >= 100) {
        globalScope.clearInterval(readyTimer);
      }
    }, 50);
  }, { once: true });
})(globalThis);
