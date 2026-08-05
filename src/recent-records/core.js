(function defineSuiteMateV3RecentRecordsCore(globalScope) {
  "use strict";

  const VERSION = 1;
  const STORAGE_KEY = "suiteMateV3RecentRecords";
  const SCHEMA_VERSION = 1;
  const MAX_SCOPES = 8;
  const MAX_HISTORY = 50;
  const MAX_SNAPSHOT = 300;
  const MAX_PINNED = 100;
  const MAX_TEXT_LENGTH = 500;
  const TRANSIENT_PARAMS = Object.freeze(["e", "whence", "cp"]);
  const EMPTY_STORE = Object.freeze({ schemaVersion: SCHEMA_VERSION, scopes: Object.freeze({}) });

  if (globalScope.SuiteMateV3RecentRecordsCore?.VERSION === VERSION) {
    return;
  }

  function isPlainObject(value) {
    return Boolean(
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.prototype.toString.call(value) === "[object Object]"
    );
  }

  function cleanText(value, maximum = MAX_TEXT_LENGTH) {
    return String(value ?? "")
      .replace(/[\u00a0\s]+/g, " ")
      .trim()
      .slice(0, maximum);
  }

  function safeTimestamp(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  function parseRecordUrl(value, baseOrigin) {
    try {
      const base = new URL(baseOrigin);
      const url = new URL(String(value ?? ""), base);
      if (
        base.protocol !== "https:"
        || url.protocol !== "https:"
        || url.origin !== base.origin
        || !url.pathname.startsWith("/app/")
        || !url.pathname.toLowerCase().endsWith(".nl")
        || url.pathname.startsWith("/app/common/otherlists/")
        || !cleanText(url.searchParams.get("id"), 200)
      ) {
        return null;
      }
      url.hash = "";
      return url;
    } catch {
      return null;
    }
  }

  function relativeUrl(url) {
    return `${url.pathname}${url.search}`;
  }

  function normalizeRecordUrl(value, baseOrigin, options = {}) {
    const url = parseRecordUrl(value, baseOrigin);
    if (!url) {
      return "";
    }
    if (options.removeTransient === true) {
      for (const name of TRANSIENT_PARAMS) {
        url.searchParams.delete(name);
      }
    }
    return relativeUrl(url);
  }

  function recordIdentity(value, baseOrigin) {
    const url = parseRecordUrl(value, baseOrigin);
    if (!url) {
      return "";
    }
    const id = cleanText(url.searchParams.get("id"), 200).toLowerCase();
    const recordType = cleanText(url.searchParams.get("rectype"), 200).toLowerCase();
    return `${url.pathname.toLowerCase()}|${id}|${recordType}`;
  }

  function editUrl(value, baseOrigin) {
    const url = parseRecordUrl(value, baseOrigin);
    if (!url) {
      return "";
    }
    for (const name of ["whence", "cp"]) {
      url.searchParams.delete(name);
    }
    url.searchParams.set("e", "T");
    return relativeUrl(url);
  }

  function classifyRecord(value) {
    const source = String(value ?? "").toLowerCase();
    const rules = [
      [/(?:employee|employeerecord)\.nl/, "employee"],
      [/customer\.nl/, "customer"],
      [/vendor\.nl/, "vendor"],
      [/contact\.nl/, "contact"],
      [/partner\.nl/, "partner"],
      [/(?:inventoryitem|item)\.nl/, "item"],
      [/mediaitem\.nl/, "file"],
      [/\/transactions\/|(?:salesord|invoice|cashsale|purchaseord|vendorbill|itemship|itemrcpt|journal)\.nl/, "transaction"],
      [/customrecordtype\.nl/, "custom-record-type"],
      [/customrecordentry\.nl|rectype=/, "custom-record"],
      [/customfield\.nl/, "custom-field"],
      [/(?:entryform|transactionform)\.nl/, "form"],
      [/role\.nl/, "role"],
      [/(?:scriptrecord|scriptdeployment|script)\.nl/, "script"],
      [/workflow\.nl/, "workflow"],
      [/(?:search|searchresults)\.nl/, "search"],
      [/\/crm\//, "crm"],
      [/\/setup\//, "setup"]
    ];
    return rules.find(([pattern]) => pattern.test(source))?.[1] ?? "record";
  }

  function cleanDocumentTitle(value) {
    return cleanText(value)
      .replace(/\s+(?:-|\|)\s+NetSuite(?:\s+.*)?$/i, "")
      .trim();
  }

  function prepareVisitedRecord(value, title, baseOrigin, now = Date.now()) {
    const url = normalizeRecordUrl(value, baseOrigin, { removeTransient: true });
    const identity = recordIdentity(url, baseOrigin);
    if (!url || !identity) {
      return null;
    }
    return Object.freeze({
      identity,
      url,
      editUrl: editUrl(url, baseOrigin),
      name: cleanDocumentTitle(title) || "NetSuite record",
      secondary: "",
      kind: classifyRecord(url),
      timestamp: safeTimestamp(now)
    });
  }

  function normalizeItem(value, baseOrigin) {
    if (!isPlainObject(value)) {
      return null;
    }
    const url = normalizeRecordUrl(value.url, baseOrigin, { removeTransient: true });
    const identity = recordIdentity(url, baseOrigin);
    if (!url || !identity) {
      return null;
    }
    const normalizedEditUrl = normalizeRecordUrl(value.editUrl, baseOrigin)
      || editUrl(url, baseOrigin);
    return {
      identity,
      url,
      editUrl: normalizedEditUrl,
      name: cleanText(value.name) || "NetSuite record",
      secondary: cleanText(value.secondary),
      kind: cleanText(value.kind, 40) || classifyRecord(url),
      timestamp: safeTimestamp(value.timestamp),
      dateText: cleanText(value.dateText, 100)
    };
  }

  function normalizeItems(values, baseOrigin, maximum) {
    const items = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const item = normalizeItem(value, baseOrigin);
      if (!item || seen.has(item.identity)) {
        continue;
      }
      seen.add(item.identity);
      items.push(item);
      if (items.length >= maximum) {
        break;
      }
    }
    return items;
  }

  function normalizeScope(value, baseOrigin) {
    const candidate = isPlainObject(value) ? value : {};
    return {
      updatedAt: safeTimestamp(candidate.updatedAt),
      pinned: normalizeItems(candidate.pinned, baseOrigin, MAX_PINNED),
      history: normalizeItems(candidate.history, baseOrigin, MAX_HISTORY),
      snapshot: {
        fetchedAt: safeTimestamp(candidate.snapshot?.fetchedAt),
        items: normalizeItems(candidate.snapshot?.items, baseOrigin, MAX_SNAPSHOT)
      }
    };
  }

  function normalizeStored(value, baseOrigin) {
    if (
      !isPlainObject(value)
      || (Object.hasOwn(value, "schemaVersion") && value.schemaVersion !== SCHEMA_VERSION)
      || !isPlainObject(value.scopes)
    ) {
      return { schemaVersion: SCHEMA_VERSION, scopes: {} };
    }
    const entries = Object.entries(value.scopes)
      .filter(([key]) => key && key.length <= 400 && !["__proto__", "constructor", "prototype"].includes(key))
      .map(([key, scope]) => [key, normalizeScope(scope, baseOrigin)])
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_SCOPES);
    return { schemaVersion: SCHEMA_VERSION, scopes: Object.fromEntries(entries) };
  }

  function writeScope(value, scopeKey, baseOrigin, update, now = Date.now()) {
    const key = cleanText(scopeKey, 400);
    if (!key || ["__proto__", "constructor", "prototype"].includes(key)) {
      return normalizeStored(value, baseOrigin);
    }
    const store = normalizeStored(value, baseOrigin);
    const scope = normalizeScope(store.scopes[key], baseOrigin);
    const nextScope = normalizeScope(update(scope), baseOrigin);
    nextScope.updatedAt = safeTimestamp(now);
    const scopes = { ...store.scopes, [key]: nextScope };
    const kept = Object.entries(scopes)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_SCOPES);
    return { schemaVersion: SCHEMA_VERSION, scopes: Object.fromEntries(kept) };
  }

  function withVisit(value, scopeKey, record, baseOrigin, now = Date.now()) {
    const item = normalizeItem(record, baseOrigin);
    if (!item) {
      return normalizeStored(value, baseOrigin);
    }
    item.timestamp = safeTimestamp(record.timestamp) || safeTimestamp(now);
    return writeScope(value, scopeKey, baseOrigin, (scope) => ({
      ...scope,
      history: [item, ...scope.history.filter((entry) => entry.identity !== item.identity)].slice(0, MAX_HISTORY)
    }), now);
  }

  function withSnapshot(value, scopeKey, items, baseOrigin, now = Date.now()) {
    const snapshotItems = normalizeItems(items, baseOrigin, MAX_SNAPSHOT);
    return writeScope(value, scopeKey, baseOrigin, (scope) => ({
      ...scope,
      snapshot: { fetchedAt: safeTimestamp(now), items: snapshotItems }
    }), now);
  }

  function withPinned(value, scopeKey, record, pinned, baseOrigin, now = Date.now()) {
    const item = normalizeItem(record, baseOrigin);
    if (!item) {
      return normalizeStored(value, baseOrigin);
    }
    item.timestamp = safeTimestamp(record.timestamp) || safeTimestamp(now);
    return writeScope(value, scopeKey, baseOrigin, (scope) => ({
      ...scope,
      pinned: pinned
        ? [item, ...scope.pinned.filter((entry) => entry.identity !== item.identity)].slice(0, MAX_PINNED)
        : scope.pinned.filter((entry) => entry.identity !== item.identity)
    }), now);
  }

  function parseRecentDate(value, now = Date.now()) {
    const text = cleanText(value, 100);
    if (!text) {
      return 0;
    }
    const current = new Date(now);
    const timeOnly = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
    if (timeOnly) {
      let hour = Number(timeOnly[1]);
      const minute = Number(timeOnly[2]);
      const suffix = timeOnly[3]?.toUpperCase();
      if (suffix === "PM" && hour < 12) hour += 12;
      if (suffix === "AM" && hour === 12) hour = 0;
      const candidate = new Date(current.getFullYear(), current.getMonth(), current.getDate(), hour, minute);
      return Number.isFinite(candidate.getTime()) ? candidate.getTime() : 0;
    }
    const numeric = text.match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})(?:\s+(.*))?$/);
    if (numeric) {
      const first = Number(numeric[1]);
      const second = Number(numeric[2]);
      const third = Number(numeric[3]);
      const yearFirst = numeric[1].length === 4;
      const year = yearFirst ? first : (third < 100 ? 2000 + third : third);
      const pairs = yearFirst ? [[second, third]] : [[first, second], [second, first]];
      const candidates = pairs
        .filter(([month, day]) => month >= 1 && month <= 12 && day >= 1 && day <= 31)
        .map(([month, day]) => new Date(year, month - 1, day).getTime())
        .filter(Number.isFinite)
        .filter((timestamp) => timestamp <= now + 86_400_000)
        .sort((left, right) => right - left);
      if (candidates.length > 0) {
        return candidates[0];
      }
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function groupForTimestamp(timestamp, now = Date.now()) {
    if (!safeTimestamp(timestamp)) {
      return "Older";
    }
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const day = new Date(timestamp);
    day.setHours(0, 0, 0, 0);
    const difference = Math.floor((today.getTime() - day.getTime()) / 86_400_000);
    if (difference <= 0) return "Today";
    if (difference === 1) return "Yesterday";
    if (difference < 7) return "This week";
    return "Older";
  }

  function displayDate(record, now = Date.now()) {
    const timestamp = safeTimestamp(record?.timestamp) || parseRecentDate(record?.dateText, now);
    if (!timestamp) {
      return cleanText(record?.dateText, 100);
    }
    const date = new Date(timestamp);
    const group = groupForTimestamp(timestamp, now);
    if (group === "Today") {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    if (group === "Yesterday") {
      return `Yesterday, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }
    return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
  }

  function mergeRecords(scopeValue, baseOrigin, now = Date.now()) {
    const scope = normalizeScope(scopeValue, baseOrigin);
    const merged = new Map();
    for (const record of scope.history) {
      merged.set(record.identity, { ...record });
    }
    for (const serverRecord of scope.snapshot.items) {
      const local = merged.get(serverRecord.identity);
      merged.set(serverRecord.identity, local ? {
        ...serverRecord,
        ...local,
        name: serverRecord.name || local.name,
        secondary: serverRecord.secondary || local.secondary,
        editUrl: serverRecord.editUrl || local.editUrl,
        kind: serverRecord.kind || local.kind,
        dateText: serverRecord.dateText || local.dateText
      } : {
        ...serverRecord,
        timestamp: serverRecord.timestamp || parseRecentDate(serverRecord.dateText, now)
      });
    }
    const pinnedMap = new Map(scope.pinned.map((record) => [record.identity, record]));
    const pinned = scope.pinned.map((record) => ({
      ...record,
      ...(merged.get(record.identity) ?? {}),
      pinned: true
    }));
    const recent = [...merged.values()]
      .filter((record) => !pinnedMap.has(record.identity))
      .sort((left, right) => (right.timestamp || parseRecentDate(right.dateText, now))
        - (left.timestamp || parseRecentDate(left.dateText, now)));
    return { pinned, recent };
  }

  Object.defineProperty(globalScope, "SuiteMateV3RecentRecordsCore", {
    value: Object.freeze({
      VERSION,
      STORAGE_KEY,
      SCHEMA_VERSION,
      MAX_SCOPES,
      MAX_HISTORY,
      MAX_SNAPSHOT,
      MAX_PINNED,
      EMPTY_STORE,
      cleanText,
      normalizeRecordUrl,
      recordIdentity,
      editUrl,
      classifyRecord,
      prepareVisitedRecord,
      normalizeStored,
      withVisit,
      withSnapshot,
      withPinned,
      parseRecentDate,
      groupForTimestamp,
      displayDate,
      mergeRecords
    }),
    configurable: false,
    enumerable: true,
    writable: false
  });
})(globalThis);
