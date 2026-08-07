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

  // Quick Access → Transaction Menu: the curated two-level browser, resolved
  // against the account's own navigation tree when available ("intersect,
  // don't replace"). Each type declares NetSuite TASK ids — the documented
  // resolveTaskLink vocabulary (EDIT_TRAN_SALESORD, LIST_TRAN_SALESORD,
  // TRAN_SALESORDAPPRV…), live-harvested from NLNavMenuData.nl — which are
  // stable across renames, languages and accounts. With a task index the
  // tree decides: URLs come from the account's own menu and a task the role
  // lacks hides its action (that is NetSuite's permission answer). Without
  // one, the static fallbacks below reproduce the live-verified MCo menu, so
  // a failed fetch degrades to a working menu, never an empty one. The
  // *manager pages are NOT lists: they are approval/processing screens
  // (salesordermanager.nl?type=apprv renders "Approve Sales Orders" —
  // shipping one as the List action was the original bug).
  const TRANSACTION_ENTRY_PREFIX = "/app/accounting/transactions/";
  const TRANSACTION_MENU = Object.freeze([
    Object.freeze({
      group: "Sales",
      types: Object.freeze([
        Object.freeze({
          id: "salesord",
          label: "Sales Order",
          entry: "salesord",
          listType: "SalesOrd",
          newTask: "EDIT_TRAN_SALESORD",
          listTask: "LIST_TRAN_SALESORD",
          extras: Object.freeze([Object.freeze({
            task: "TRAN_SALESORDAPPRV",
            label: "Approve Sales Orders",
            fallbackUrl: "/app/accounting/transactions/salesordermanager.nl?type=apprv&whence="
          })])
        }),
        Object.freeze({ id: "custinvc", label: "Invoice", entry: "custinvc", listType: "CustInvc", newTask: "EDIT_TRAN_CUSTINVC", listTask: "LIST_TRAN_CUSTINVC" }),
        Object.freeze({ id: "custcred", label: "Credit Memo", entry: "custcred", listType: "CustCred", newTask: "EDIT_TRAN_CUSTCRED", listTask: "LIST_TRAN_CUSTCRED" }),
        Object.freeze({ id: "custdep", label: "Customer Deposit", entry: "custdep", listType: "CustDep", newTask: "EDIT_TRAN_CUSTDEP", listTask: "LIST_TRAN_CUSTDEP" })
      ])
    }),
    Object.freeze({
      group: "Purchasing",
      types: Object.freeze([
        Object.freeze({ id: "purchord", label: "Purchase Order", entry: "purchord", listType: "PurchOrd", newTask: "EDIT_TRAN_PURCHORD", listTask: "LIST_TRAN_PURCHORD" }),
        Object.freeze({
          id: "vendbill",
          label: "Vendor Bill",
          entry: "vendbill",
          listType: "VendBill",
          newTask: "EDIT_TRAN_VENDBILL",
          listTask: "LIST_TRAN_VENDBILL",
          extras: Object.freeze([Object.freeze({
            task: "TRAN_VENDBILLAPPRV",
            label: "Approve Bills",
            fallbackUrl: "/app/accounting/transactions/vendorbillmanager.nl?type=apprv&whence="
          })])
        }),
        // treeOnly: both records sit behind off-by-default Enable Features
        // toggles (Purchase Contracts + its Purchase Orders prerequisite;
        // Inbound Shipment Management), so without the account's tree a
        // static entry would mostly be a dead link into a disabled feature —
        // they render only when the live tree confirms them. Inbound
        // Shipment is its own record family (dedicated pages under
        // transactions/shipping/, task ids without the TRAN_ prefix).
        Object.freeze({ id: "purchcon", label: "Purchase Contract", entry: "purchcon", listType: "PurchCon", treeOnly: true, newTask: "EDIT_TRAN_PURCHCON", listTask: "LIST_TRAN_PURCHCON" }),
        Object.freeze({
          id: "inboundshipment",
          label: "Inbound Shipment",
          treeOnly: true,
          newTask: "EDIT_INBOUNDSHIPMENT",
          listTask: "LIST_INBOUNDSHIPMENT"
        })
      ])
    }),
    Object.freeze({
      group: "Inventory",
      types: Object.freeze([
        // Fulfillments and receipts are transform-only records — no
        // EDIT_TRAN_* task exists for them (harvested-verified), so no New
        // action; their real conveniences are the bulk process pages. Their
        // list task ids likewise never appear in menus, so the static list
        // URL stays unconditional.
        Object.freeze({
          id: "itemship",
          label: "Item Fulfillment",
          entry: "itemship",
          listType: "ItemShip",
          noNew: true,
          extras: Object.freeze([Object.freeze({
            task: "TRAN_SALESORDFULFILL",
            label: "Fulfill Orders",
            fallbackUrl: "/app/accounting/transactions/salesordermanager.nl?type=fulfill&whence="
          })])
        }),
        Object.freeze({
          id: "itemrcpt",
          label: "Item Receipt",
          entry: "itemrcpt",
          listType: "ItemRcpt",
          noNew: true,
          extras: Object.freeze([Object.freeze({
            task: "TRAN_PURCHORDRECEIVE",
            label: "Receive Orders",
            fallbackUrl: "/app/accounting/transactions/purchordermanager.nl?type=receive&whence="
          })])
        }),
        Object.freeze({ id: "workord", label: "Work Order", entry: "workord", listType: "WorkOrd", newTask: "EDIT_TRAN_WORKORD", listTask: "LIST_TRAN_WORKORD" })
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
          listPage: "accountingtransactionlist",
          newTask: "EDIT_TRAN_JOURNAL",
          listTask: "LIST_TRAN_JOURNAL"
        })
      ])
    })
  ]);

  const TRANSACTION_TASK_IDS = Object.freeze([...new Set(
    TRANSACTION_MENU.flatMap((group) => group.types.flatMap((type) => [
      type.newTask,
      type.listTask,
      ...(type.extras ?? []).map((extra) => extra.task)
    ])).filter(Boolean)
  )]);

  // The account's navigation tree (NLNavMenuData.nl JSON) → Map of task id
  // to same-origin path, for exactly the ids the menu declares. Defensive by
  // construction: unknown shapes walk to nothing, hostile URLs sanitize to
  // nothing.
  function buildTaskIndex(value, wantedIds, origin) {
    const wanted = new Set(wantedIds);
    const index = new Map();
    const walk = (node) => {
      if (!node || typeof node !== "object") {
        return;
      }
      if (Array.isArray(node)) {
        for (const child of node) {
          walk(child);
        }
        return;
      }
      const id = String(node.id ?? "");
      if (wanted.has(id) && !index.has(id)) {
        const url = sanitizeHref(node.url, origin);
        if (url) {
          index.set(id, url);
        }
      }
      for (const child of Object.values(node)) {
        if (child && typeof child === "object") {
          walk(child);
        }
      }
    };
    walk(value);
    return index;
  }

  // index === null → static fallbacks (the live-verified MCo menu). With an
  // index, the tree is the authority: a declared task the role's menu lacks
  // hides its action, and every present task contributes the account's own
  // URL. Returns null when nothing survives — the caller hides the type.
  function transactionActions(type, index = null) {
    if (!type || (type.treeOnly && !index)) {
      return null;
    }
    const listPage = type.listPage ?? "transactionlist";
    // Static fallbacks: explicit URLs win (record families outside the
    // Transaction_TYPE vocabulary, like Inbound Shipment); otherwise built
    // from the validated entry/list tokens.
    const staticNew = typeof type.newUrl === "string"
      ? type.newUrl
      : /^[a-z]+$/.test(type.entry ?? "")
        ? `${TRANSACTION_ENTRY_PREFIX}${type.entry}.nl?whence=`
        : "";
    const staticList = typeof type.listUrl === "string"
      ? type.listUrl
      : /^[A-Za-z]+$/.test(type.listType ?? "") && /^[a-z]+$/.test(listPage)
        ? `${TRANSACTION_ENTRY_PREFIX}${listPage}.nl?Transaction_TYPE=${type.listType}`
        : "";
    if (!index && !staticNew && !staticList) {
      return null;
    }
    const actions = [];
    if (!type.noNew) {
      const url = index ? index.get(type.newTask) ?? "" : staticNew;
      if (url) {
        actions.push(Object.freeze({ label: `New ${type.label}`, url, icon: "external" }));
      }
    }
    const listUrl = index && type.listTask
      ? index.get(type.listTask) ?? ""
      : staticList;
    if (listUrl) {
      actions.push(Object.freeze({ label: `${type.label} List`, url: listUrl, icon: "list" }));
    }
    for (const extra of type.extras ?? []) {
      const url = index ? index.get(extra.task) ?? "" : extra.fallbackUrl ?? "";
      if (url) {
        actions.push(Object.freeze({ label: extra.label, url, icon: "edit" }));
      }
    }
    return actions.length ? Object.freeze(actions) : null;
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
    TRANSACTION_TASK_IDS,
    buildTaskIndex,
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
