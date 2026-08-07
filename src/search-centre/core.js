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
  // family as the salesord.nl path this codebase already gates on); manager
  // is the type's list page. Manager names are irregular (salesord →
  // salesordermanager), so they are spelled out per type, never derived.
  const TRANSACTION_ENTRY_PREFIX = "/app/accounting/transactions/";
  const TRANSACTION_MENU = Object.freeze([
    Object.freeze({
      group: "Sales",
      types: Object.freeze([
        Object.freeze({ id: "salesord", label: "Sales Order", entry: "salesord", manager: "salesordermanager" }),
        Object.freeze({ id: "custinvc", label: "Invoice", entry: "custinvc", manager: "custinvcmanager" }),
        Object.freeze({ id: "custcred", label: "Credit Memo", entry: "custcred", manager: "custcredmanager" }),
        Object.freeze({ id: "custdep", label: "Customer Deposit", entry: "custdep", manager: "custdepmanager" })
      ])
    }),
    Object.freeze({
      group: "Purchasing",
      types: Object.freeze([
        Object.freeze({ id: "purchord", label: "Purchase Order", entry: "purchord", manager: "purchordmanager" }),
        Object.freeze({ id: "vendbill", label: "Vendor Bill", entry: "vendbill", manager: "vendbillmanager" })
      ])
    }),
    Object.freeze({
      group: "Inventory",
      types: Object.freeze([
        Object.freeze({ id: "itemship", label: "Item Fulfillment", entry: "itemship", manager: "itemshipmanager" }),
        Object.freeze({ id: "itemrcpt", label: "Item Receipt", entry: "itemrcpt", manager: "itemrcptmanager" }),
        Object.freeze({ id: "workord", label: "Work Order", entry: "workord", manager: "workordmanager" })
      ])
    }),
    Object.freeze({
      group: "Finance",
      types: Object.freeze([
        Object.freeze({ id: "journal", label: "Journal Entry", entry: "journal", manager: "journalmanager" })
      ])
    })
  ]);

  function transactionUrls(type) {
    if (!/^[a-z]+$/.test(type?.entry ?? "") || !/^[a-z]+$/.test(type?.manager ?? "")) {
      return null;
    }
    return Object.freeze({
      newUrl: `${TRANSACTION_ENTRY_PREFIX}${type.entry}.nl?whence=`,
      listUrl: `${TRANSACTION_ENTRY_PREFIX}${type.manager}.nl?whence=`
    });
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
    transactionUrls,
    cleanText,
    categorize,
    sanitizeHref,
    normalizeResult,
    fromAutofill,
    countByCategory,
    filterByCategory
  });
})(globalThis);
