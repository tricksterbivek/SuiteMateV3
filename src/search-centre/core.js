(function defineSuiteMateV3SearchCentreCore(global) {
  "use strict";

  const CATEGORIES = Object.freeze([
    Object.freeze({ id: "all", label: "All" }),
    Object.freeze({ id: "records", label: "Records" }),
    Object.freeze({ id: "files", label: "Files" }),
    Object.freeze({ id: "navigation", label: "Navigation" })
  ]);

  // Uber rows self-describe as "Type: Name" ("Non-inventory Item: …",
  // "PDF File: …", "Menu: …"). Files are a closed vocabulary; navigation is
  // primarily decided by the listbox group (pageSearch) with the "Menu"/
  // "Page" prefixes as a fallback; everything else is a record.
  const FILE_TYPE_PATTERN = /\b(?:file|folder|document|attachment)\b/i;
  const NAVIGATION_TYPE_PATTERN = /^(?:menu|page)$/i;

  function cleanText(value, maxLength = 300) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
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
      category: navigation ? "navigation" : categorize(typeText),
      href,
      editHref: sanitizeHref(raw?.editHref, origin),
      nativeIndex
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
    const counts = { all: results.length, records: 0, files: 0, navigation: 0 };
    for (const result of results) {
      counts[result.category] += 1;
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
    cleanText,
    categorize,
    sanitizeHref,
    normalizeResult,
    fromAutofill,
    countByCategory,
    filterByCategory
  });
})(globalThis);
