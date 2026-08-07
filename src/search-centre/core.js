(function defineSuiteMateV3SearchCentreCore(global) {
  "use strict";

  const CATEGORIES = Object.freeze([
    Object.freeze({ id: "all", label: "All" }),
    Object.freeze({ id: "records", label: "Records" }),
    Object.freeze({ id: "files", label: "Files" }),
    Object.freeze({ id: "navigation", label: "Navigation" })
  ]);

  // Uber-search rows label themselves with a type string ("Customer",
  // "Excel File", "Page"...). Files and navigation are the closed sets;
  // everything else is a record — the safe default for unknown labels.
  const FILE_TYPE_PATTERN = /\b(?:file|folder|document|attachment)\b/i;
  const NAVIGATION_TYPE_PATTERN = /^(?:page|menu|portlet|dashboard|center|tab|category|task link|action)\b/i;

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

  function normalizeResult(raw, origin) {
    const href = sanitizeHref(raw?.href, origin);
    const title = cleanText(raw?.title, 200);
    if (!href || !title) {
      return null;
    }
    const typeText = cleanText(raw?.typeText, 80);
    return Object.freeze({
      title,
      typeText,
      secondary: cleanText(raw?.secondary, 200),
      category: categorize(typeText),
      href,
      editHref: sanitizeHref(raw?.editHref, origin)
    });
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
    countByCategory,
    filterByCategory
  });
})(globalThis);
