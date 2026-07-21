(function defineSuiteMateV3FixtureCatalog(globalScope) {
  "use strict";

  const CLASSIC_ROUTES = [
    {
      fixtureId: "dashboard",
      routeId: "dashboard",
      path: "/app/center/card.nl?sc=-29",
      title: "Home",
      layout: "dashboard",
      pageStyles: ["dashboard.css"],
      requiredSelectors: ["#ns-dashboard-content", ".ns-portlet-wrapper"]
    },
    {
      fixtureId: "login",
      routeId: "login",
      path: "/app/login/secure/enterpriselogin.nl?c=FIXTURE",
      title: "NetSuite Login",
      layout: "login",
      pageStyles: ["login.css"],
      requiredSelectors: ["#login-form", "#login-submit"]
    },
    {
      fixtureId: "file",
      routeId: "file",
      path: "/app/common/media/mediaitem.nl?id=1",
      title: "File",
      layout: "file",
      pageStyles: ["file.css"],
      requiredSelectors: ["#mediaitem_form", ".uir-field-group"]
    },
    {
      fixtureId: "file-cabinet",
      routeId: "file-cabinet",
      path: "/app/common/media/mediaitemfolders.nl",
      title: "File Cabinet",
      layout: "file-cabinet",
      pageStyles: ["filecabinet.css"],
      requiredSelectors: ["#div__nav", "#mediaitemlist"]
    },
    {
      fixtureId: "script-editor",
      routeId: "script-editor",
      path: "/app/common/record/edittextmediaitem.nl?id=1",
      title: "SuiteScript Editor",
      layout: "code-editor",
      pageStyles: ["codeeditor.css"],
      requiredSelectors: ["#codeeditor", ".CodeMirror"]
    },
    {
      fixtureId: "script",
      routeId: "script",
      path: "/app/common/scripting/script.nl?id=1",
      title: "Script",
      layout: "script-form",
      pageStyles: ["scripting.css"],
      requiredSelectors: ["#script_form", "#scriptdeployments"]
    },
    {
      fixtureId: "script-deployment",
      routeId: "script-deployment",
      path: "/app/common/scripting/scriptrecord.nl?id=1",
      title: "Script Deployment",
      layout: "script-form",
      pageStyles: ["scripting.css"],
      requiredSelectors: ["#script_form", "#scriptdeployments"]
    },
    {
      fixtureId: "script-status",
      routeId: "script-status",
      path: "/app/common/scripting/scriptstatus.nl",
      title: "Script Status",
      layout: "status-list",
      pageStyles: ["scripting.css"],
      requiredSelectors: ["#scriptstatuslist", ".uir-list-headerrow"]
    },
    {
      fixtureId: "scripting",
      routeId: "scripting",
      path: "/app/common/scripting/customscriptlist.nl",
      title: "Scripts",
      layout: "status-list",
      pageStyles: ["scripting.css"],
      requiredSelectors: ["#scriptstatuslist", ".uir-list-headerrow"]
    },
    {
      fixtureId: "saved-search",
      routeId: "saved-search",
      path: "/app/common/search/search.nl?searchtype=Transaction",
      title: "Transaction Search",
      layout: "search-form",
      pageStyles: [],
      requiredSelectors: ["#search_form", "#searchfilters"]
    },
    {
      fixtureId: "saved-search-edit",
      routeId: "saved-search-edit",
      path: "/app/common/search/search.nl?id=5471&e=T",
      title: "Saved Transaction Search",
      layout: "search-edit",
      pageStyles: [],
      requiredSelectors: ["#criteria_tablnk", "#searchfilters"]
    },
    {
      fixtureId: "saved-search-results",
      routeId: "saved-search-results",
      path: "/app/common/search/searchresults.nl?searchid=5471",
      title: "Saved Search Results",
      layout: "result-list",
      pageStyles: [],
      requiredSelectors: ["#searchresultstable", ".uir-list-headerrow"]
    },
    {
      fixtureId: "global-search-results",
      routeId: "global-search-results",
      path: "/app/common/search/ubersearchresults.nl?search=customer",
      title: "Global Search Results",
      layout: "result-list",
      pageStyles: ["suiteql.css"],
      requiredSelectors: ["#searchresultstable", "#native-global-search-result"]
    },
    {
      fixtureId: "suiteql-console",
      routeId: "suiteql-console",
      path: "/app/common/search/ubersearchresults.nl?suiteql",
      title: "SuiteQL Console",
      layout: "suiteql",
      pageStyles: ["suiteql.css", "../../suiteql/studio.css"],
      requiredSelectors: ["#suitemate-suiteql-studio", ".cm-editor"]
    },
    {
      fixtureId: "help-center",
      routeId: "help-center",
      path: "/app/help/helpcenter.nl",
      title: "Help Center",
      layout: "help",
      pageStyles: ["helpcenter.css"],
      requiredSelectors: ["#helpcenter", ".help-topic-list"]
    },
    {
      fixtureId: "records-catalog",
      routeId: "records-catalog",
      path: "/app/recordscatalog/rcbrowser.nl",
      title: "Records Catalog",
      layout: "catalog",
      pageStyles: [],
      requiredSelectors: ["#recordscatalog", ".uir-list-headerrow"]
    },
    {
      fixtureId: "import-assistant",
      routeId: "import-assistant",
      path: "/app/setup/assistants/nsimport/importassistant.nl?recordsubtype=salesorder",
      title: "Import Assistant",
      layout: "assistant",
      pageStyles: [],
      requiredSelectors: ["#importassistant", "[name=recordsubtype]"]
    },
    {
      fixtureId: "bundle-builder",
      routeId: "bundle-builder",
      path: "/app/setup/assistants/bundlebuilder.nl",
      title: "Bundle Builder",
      layout: "assistant",
      pageStyles: ["bundlebuilder.css"],
      requiredSelectors: ["#importassistant", ".uir-list-headerrow"]
    },
    {
      fixtureId: "pdf-template",
      routeId: "pdf-template",
      path: "/app/common/custom/advancedprint/pdftemplate.nl?id=1",
      title: "Advanced PDF/HTML Template",
      layout: "template-editor",
      pageStyles: ["pdftemplate.css"],
      requiredSelectors: ["#template-editor", ".CodeMirror"]
    },
    {
      fixtureId: "workflow",
      routeId: "workflow",
      path: "/app/common/workflow/setup/workflow.nl?id=1",
      title: "Workflow",
      layout: "workflow",
      pageStyles: ["workflow.css"],
      requiredSelectors: ["#workflow-desktop", ".workflow-state"]
    },
    {
      fixtureId: "netsuite-page",
      routeId: "netsuite-page",
      path: "/app/accounting/transactions/salesord.nl?id=1",
      title: "Sales Order #SO10428",
      layout: "record",
      pageStyles: [],
      requiredSelectors: ["#main_form", "#item_splits"]
    }
  ];

  const CLASSIC_VARIANTS = [
    {
      fixtureId: "customer-login",
      routeId: "login",
      path: "/pages/customerlogin.jsp?c=FIXTURE",
      title: "Customer Center Login",
      layout: "login",
      pageStyles: ["login.css"],
      requiredSelectors: ["#login-form", "#login-submit"]
    },
    {
      fixtureId: "field-help",
      routeId: "netsuite-page",
      path: "/core/help/fieldhelp.nl?field=entity",
      title: "Field Help",
      layout: "field-help",
      pageStyles: ["fieldhelp.css"],
      requiredSelectors: ["#fieldhelp", ".uir-alert-box"]
    },
    {
      fixtureId: "map-reduce-status",
      routeId: "script-status",
      path: "/app/common/scripting/mapreducescriptstatus.nl",
      title: "Map/Reduce Script Status",
      layout: "status-list",
      pageStyles: ["scripting.css"],
      requiredSelectors: ["#scriptstatuslist", ".uir-list-headerrow"]
    }
  ];

  const REDWOOD_BASELINES = [
    {
      fixtureId: "redwood-record",
      url: "/tests/fixtures/redwood.html",
      title: "Redwood record contract",
      readySelector: ".uir-machine-table-container"
    },
    {
      fixtureId: "redwood-suiteql",
      url: "/tests/fixtures/suiteql-redwood.html",
      title: "Redwood SuiteQL contract",
      readySelector: "#suitemate-suiteql-studio"
    }
  ];

  function freezeRoute(route) {
    const forbiddenSelectors = route.forbiddenSelectors
      || (route.routeId === "suiteql-console" ? [] : ["#suitemate-suiteql-studio"]);
    return Object.freeze({
      ...route,
      pageStyles: Object.freeze([...route.pageStyles]),
      requiredSelectors: Object.freeze([...route.requiredSelectors]),
      forbiddenSelectors: Object.freeze([...forbiddenSelectors])
    });
  }

  const api = Object.freeze({
    VERSION: 1,
    VIEWPORT: Object.freeze({ width: 1440, height: 1000, deviceScaleFactor: 1 }),
    CLASSIC_ROUTES: Object.freeze(CLASSIC_ROUTES.map(freezeRoute)),
    CLASSIC_VARIANTS: Object.freeze(CLASSIC_VARIANTS.map(freezeRoute)),
    REDWOOD_BASELINES: Object.freeze(REDWOOD_BASELINES.map((entry) => Object.freeze({ ...entry })))
  });

  Object.defineProperty(globalScope, "SuiteMateV3FixtureCatalog", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: api
  });
})(globalThis);
