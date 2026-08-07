(function defineSuiteMateV3SearchCentreCore(global) {
  "use strict";

  const CATEGORIES = Object.freeze([
    Object.freeze({ id: "all", label: "All" }),
    Object.freeze({ id: "customers", label: "Customers" }),
    Object.freeze({ id: "records", label: "Records" }),
    Object.freeze({ id: "files", label: "Files" }),
    Object.freeze({ id: "navigation", label: "Navigation" })
  ]);

  // Uber rows self-describe as "Type: Name" ("Non-inventory Item: …",
  // "PDF File: …", "Menu: …"), but the type label is renameable per account
  // and localized per language — matching on it silently fails the moment an
  // administrator renames a record or runs NetSuite in French. The result's
  // URL is the rename-proof key (live-verified per family): the whole
  // customer family — Customer, Lead, Prospect, Job are ONE record split by
  // Stage — lives under custjob.nl, files under mediaitem.nl. The label
  // stays display-only (the type chip), plus a fallback for files and
  // navigation rows with unrecognized paths. Everything else — transactions,
  // items, vendors, employees, custom records — is a Record.
  const CUSTOMER_ENTITY_PATH = "/app/common/entity/custjob.nl";
  const FILE_PATH = "/app/common/media/mediaitem.nl";
  const FILE_TYPE_PATTERN = /\b(?:file|folder|document|attachment)\b/i;
  const NAVIGATION_TYPE_PATTERN = /^(?:menu|page)$/i;

  function cleanText(value, maxLength = 300) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function categorizeHref(href) {
    if (href.startsWith(CUSTOMER_ENTITY_PATH)) {
      return "customers";
    }
    if (href.startsWith(FILE_PATH)) {
      return "files";
    }
    return "";
  }

  function categorize(typeText) {
    const value = cleanText(typeText, 120);
    if (FILE_TYPE_PATTERN.test(value)) {
      return "files";
    }
    if (NAVIGATION_TYPE_PATTERN.test(value)) {
      return "navigation";
    }
    return "records";
  }

  // Dropdown anchors are untrusted page DOM: only same-origin https survives,
  // stored as a path so navigation can never leave the account.
  function sanitizeHref(value, origin) {
    const raw = String(value ?? "").trim();
    if (!raw || /^\s*javascript:/i.test(raw)) {
      return "";
    }
    try {
      const url = new URL(raw, origin);
      if (url.protocol !== "https:" || url.origin !== new URL(origin).origin) {
        return "";
      }
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return "";
    }
  }

  // raw: { text, group, href, editHref, nativeIndex } — text is the row's
  // visible "Type: Name" string, group the listbox section that carried it
  // ("globalSearch" | "pageSearch"). Menu names arrive as full "A > B > C"
  // paths; the leaf becomes the title, the trail the secondary. Current-page
  // field rows carry no href at all — NetSuite navigates them with its own
  // click handler — so a native row index is an accepted substitute.
  function normalizeResult(raw, origin) {
    const href = sanitizeHref(raw?.href, origin);
    const nativeIndex = cleanText(raw?.nativeIndex, 12);
    const text = cleanText(raw?.text, 300);
    if ((!href && !nativeIndex) || !text) {
      return null;
    }
    const colon = text.indexOf(": ");
    const typeText = colon > 0 ? text.slice(0, colon) : "";
    const name = colon > 0 ? text.slice(colon + 2) : text;
    const navigation = raw?.group === "pageSearch"
      || NAVIGATION_TYPE_PATTERN.test(typeText)
      || !href;
    let title = name;
    let secondary = "";
    if (navigation && name.includes(" > ")) {
      const segments = name.split(" > ").map((segment) => segment.trim()).filter(Boolean);
      title = segments.pop() ?? name;
      secondary = segments.join(" > ");
    }
    if (!title) {
      return null;
    }
    return Object.freeze({
      title,
      typeText,
      secondary,
      category: navigation ? "navigation" : categorizeHref(href) || categorize(typeText),
      href,
      editHref: sanitizeHref(raw?.editHref, origin),
      nativeIndex
    });
  }

  // Quick Access → Transaction Menu: the curated two-level browser. entry is
  // NetSuite's canonical transaction entry basename (account-agnostic, same
  // family as the salesord.nl path this codebase already gates on).
  // Lists live on the shared transactionlist.nl page filtered by the
  // Transaction_TYPE token (user-verified for SalesOrd and PurchOrd) —
  // finance types route to accountingtransactionlist.nl instead
  // (user-verified for Journal). The *manager pages are NOT lists: they are
  // the approval/processing screens (salesordermanager.nl renders "Approve
  // Sales Orders", live-verified — shipping it as the List action was the
  // original bug), so they surface as explicit approve actions only where
  // verified.
  const TRANSACTION_ENTRY_PREFIX = "/app/accounting/transactions/";
  const TRANSACTION_MENU = Object.freeze([
    Object.freeze({
      group: "Sales",
      types: Object.freeze([
        // Approve pages harvested from a live account's own menu tree
        // (NLNavMenuData.nl): the uniform shape is <recordword>manager.nl
        // ?type=apprv, with FULL-WORD basenames (vendorbillmanager, not
        // vendbillmanager) — never derivable from the entry basename.
        // Absent by the same evidence: Approve Purchase Orders (no native
        // page — SuiteApp-only) and Approve Journal Entries (menu entry
        // only exists when journal approval routing is enabled).
        Object.freeze({
          id: "salesord",
          label: "Sales Order",
          entry: "salesord",
          listType: "SalesOrd",
          approve: Object.freeze({ page: "salesordermanager", label: "Approve Sales Orders" })
        }),
        Object.freeze({ id: "custinvc", label: "Invoice", entry: "custinvc", listType: "CustInvc" }),
        Object.freeze({ id: "custcred", label: "Credit Memo", entry: "custcred", listType: "CustCred" }),
        Object.freeze({ id: "custdep", label: "Customer Deposit", entry: "custdep", listType: "CustDep" })
      ])
    }),
    Object.freeze({
      group: "Purchasing",
      types: Object.freeze([
        Object.freeze({ id: "purchord", label: "Purchase Order", entry: "purchord", listType: "PurchOrd" }),
        Object.freeze({
          id: "vendbill",
          label: "Vendor Bill",
          entry: "vendbill",
          listType: "VendBill",
          approve: Object.freeze({ page: "vendorbillmanager", label: "Approve Bills" })
        })
      ])
    }),
    Object.freeze({
      group: "Inventory",
      types: Object.freeze([
        // Fulfillments and receipts are transform-only records — created from
        // a Sales/Purchase Order, never standalone — so a "New" entry form
        // would land on an error page (Nadmin-verified).
        Object.freeze({ id: "itemship", label: "Item Fulfillment", entry: "itemship", listType: "ItemShip", noNew: true }),
        Object.freeze({ id: "itemrcpt", label: "Item Receipt", entry: "itemrcpt", listType: "ItemRcpt", noNew: true }),
        Object.freeze({ id: "workord", label: "Work Order", entry: "workord", listType: "WorkOrd" })
      ])
    }),
    Object.freeze({
      group: "Finance",
      types: Object.freeze([
        Object.freeze({
          id: "journal",
          label: "Journal Entry",
          entry: "journal",
          listType: "Journal",
          listPage: "accountingtransactionlist"
        })
      ])
    })
  ]);

  function transactionActions(type) {
    const listPage = type?.listPage ?? "transactionlist";
    if (
      !/^[a-z]+$/.test(type?.entry ?? "")
      || !/^[A-Za-z]+$/.test(type?.listType ?? "")
      || !/^[a-z]+$/.test(listPage)
      || (type.approve && !/^[a-z]+$/.test(type.approve.page ?? ""))
    ) {
      return null;
    }
    const actions = [];
    if (!type.noNew) {
      actions.push(Object.freeze({
        label: `New ${type.label}`,
        url: `${TRANSACTION_ENTRY_PREFIX}${type.entry}.nl?whence=`,
        icon: "external"
      }));
    }
    actions.push(Object.freeze({
      label: `${type.label} List`,
      url: `${TRANSACTION_ENTRY_PREFIX}${listPage}.nl?Transaction_TYPE=${type.listType}`,
      icon: "list"
    }));
    if (type.approve) {
      actions.push(Object.freeze({
        label: type.approve.label,
        url: `${TRANSACTION_ENTRY_PREFIX}${type.approve.page}.nl?type=apprv&whence=`,
        icon: "edit"
      }));
    }
    return Object.freeze(actions);
  }

  // A direct autosuggest.nl row: { sname, key, descr, dashurl, bedit }.
  // descr is the same type label the native dropdown prefixes; bedit gates
  // the edit action exactly as the dropdown renders it (key plus e=T).
  function fromAutofill(entry, origin) {
    const sname = cleanText(entry?.sname, 200);
    const descr = cleanText(entry?.descr, 80);
    let editHref = "";
    if (entry?.bedit === "T") {
      try {
        const url = new URL(String(entry?.key ?? ""), origin);
        url.searchParams.set("e", "T");
        editHref = `${url.pathname}${url.search}`;
      } catch {}
    }
    return normalizeResult({
      text: descr ? `${descr}: ${sname}` : sname,
      group: "globalSearch",
      href: entry?.key,
      editHref
    }, origin);
  }

  function countByCategory(results) {
    const counts = { all: results.length };
    for (const category of CATEGORIES) {
      if (category.id !== "all") {
        counts[category.id] = 0;
      }
    }
    for (const result of results) {
      if (result.category in counts) {
        counts[result.category] += 1;
      }
    }
    return counts;
  }

  function filterByCategory(results, categoryId) {
    return categoryId === "all"
      ? results
      : results.filter((result) => result.category === categoryId);
  }

  global.SuiteMateV3SearchCentreCore = Object.freeze({
    CATEGORIES,
    TRANSACTION_MENU,
    transactionActions,
    cleanText,
    categorize,
    sanitizeHref,
    normalizeResult,
    fromAutofill,
    countByCategory,
    filterByCategory
  });
})(globalThis);
