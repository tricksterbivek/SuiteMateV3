// Throwaway probe: does saveOrders delete a section's stored fieldOrder when
// the same form renders a smaller field subset on another record?
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "src/form-views/core.js"), "utf8");

function createApi() {
  const sandbox = { TextEncoder };
  sandbox.globalThis = sandbox;
  runInNewContext(source, sandbox);
  return sandbox.SuiteMateV3FormViewsCore;
}
const plain = (v) => JSON.parse(JSON.stringify(v));

// ---- stub DOM (verbatim from tests/form-views.test.mjs) ----
function stubMatches(node, selector) {
  if (selector.startsWith("[")) {
    const parsed = selector.match(/^\[([\w-]+)(?:\^="([^"]*)")?\]$/);
    if (!parsed) return false;
    const value = node.attributes?.[parsed[1]];
    return parsed[2] === undefined ? value != null : typeof value === "string" && value.startsWith(parsed[2]);
  }
  const [tagPart, ...classes] = selector.split(".");
  if (tagPart && node.tagName !== tagPart.toUpperCase()) return false;
  return classes.every((cls) => String(node.className ?? "").split(/\s+/).includes(cls));
}

function el(tag, props = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(),
    className: props.cls ?? "",
    colSpan: props.colspan ?? 1,
    text: props.text ?? "",
    attributes: { ...(props.attrs ?? {}) },
    children: [],
    parentElement: null,
    appendCount: 0,
    nodeType: 1,
    get textContent() { return this.text + this.children.map((c) => c.textContent).join(""); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    matches(selector) { return stubMatches(this, selector); },
    closest(selector) {
      let current = this;
      while (current) { if (stubMatches(current, selector)) return current; current = current.parentElement; }
      return null;
    },
    appendChild(child) {
      this.appendCount += 1;
      const from = child.parentElement;
      if (from) from.children.splice(from.children.indexOf(child), 1);
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    cloneNode() { return { textContent: this.textContent, querySelectorAll: () => [] }; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
    querySelectorAll(selector) {
      if (selector.startsWith(":scope")) {
        let level = [this];
        for (const part of selector.split(" > ").slice(1)) {
          level = level.flatMap((parent) => parent.children.filter((child) => stubMatches(child, part)));
        }
        return level;
      }
      const out = [];
      const walk = (parent) => {
        for (const child of parent.children) { if (stubMatches(child, selector)) out.push(child); walk(child); }
      };
      walk(this);
      return out;
    }
  };
  for (const child of children) { child.parentElement = node; node.children.push(child); }
  return node;
}

const stubWrapper = (name) => el("div", {
  cls: "uir-field-wrapper",
  attrs: { "data-field-name": name, "data-walkthrough": `Field:${name}` },
  text: name
});
const stubFieldRow = (wrappers) => el("tr", { cls: "uir-field-wrapper-cell" }, [el("td", {}, wrappers)]);
const stubColumn = (rows) => el("table", { cls: "table_fields" }, [el("tbody", {}, rows)]);
const stubGroup = (title, columns) => el("table", {}, [el("tbody", {}, [
  el("tr", {}, [el("td", { cls: "fgroup_title uir-field-group uir-field-group--collapsible", colspan: 3 }, [
    el("div", { cls: "fgroup_title uir-field-group-title", text: title })
  ])]),
  el("tr", { cls: "uir-fieldgroup-content uir-field-group-content" }, columns.map((c) => el("td", {}, [c])))
])]);

// A Sales Order page: Primary Information (2 columns) + Classification.
// `pofield` present on record A, omitted by NetSuite view mode on record B.
function buildPage({ withPo }) {
  const c1 = stubColumn([stubFieldRow([stubWrapper("tranid")]), stubFieldRow([stubWrapper("entity")])]);
  const c2 = stubColumn([
    stubFieldRow([stubWrapper("trandate")]),
    ...(withPo ? [stubFieldRow([stubWrapper("otherrefnum")])] : [])
  ]);
  const primary = stubGroup("Primary Information", [c1, c2]);
  const classification = stubGroup("Classification", [
    stubColumn([stubFieldRow([stubWrapper("subsidiary")]), stubFieldRow([stubWrapper("location")])])
  ]);
  const layout = el("table", {}, [el("tbody", {}, [
    el("tr", {}, [el("td", { colspan: 3 }, [primary])]),
    el("tr", {}, [el("td", { colspan: 3 }, [classification])])
  ])]);
  return el("body", {}, [layout]);
}

const core = createApi();
const SCOPE = "6998262:2462:salesord";
const columnKeys = (groupTable) =>
  groupTable.querySelectorAll(":scope > tbody > tr.uir-fieldgroup-content > td > table.table_fields")
    .map((column) => column.querySelectorAll(":scope > tbody > tr")
      .map((row) => core.fieldKey(row.querySelector('[data-walkthrough^="Field:"]'))));

// Verbatim port of runtime.js saveOrders() merge logic (lines 191-219).
function saveOrders(document, stored) {
  const entry = core.normalizeStored(stored).views[SCOPE];
  const slots = core.sectionSlots(document);
  const onPage = new Set(slots.map((slot) => core.sectionTitleKey(slot.title)).filter(Boolean));
  const offPage = (entry?.sectionOrder ?? []).filter((title) => !onPage.has(title));
  const delta = core.sectionOrderDelta(document);
  const sections = [...offPage, ...(delta ?? [])];
  let next = core.withSectionOrder(stored, SCOPE, sections.length ? sections : null);
  const orders = { ...(entry?.fieldOrder ?? {}) };
  for (const slot of slots) {
    const title = core.sectionTitleKey(slot.title);
    if (!title) continue;
    const fieldDelta = core.fieldOrderDelta(slot.groupTable);
    if (fieldDelta) orders[title] = fieldDelta;
    else delete orders[title];
  }
  next = next && core.withFieldOrder(next, SCOPE, Object.keys(orders).length ? orders : null);
  return next;
}

// Verbatim port of runtime.js applyStoredOrders() (lines 177-183).
function applyStoredOrders(document, entry) {
  core.applySectionOrder(document, entry?.sectionOrder ?? null);
  for (const slot of core.sectionSlots(document)) {
    const title = core.sectionTitleKey(slot.title);
    core.applyFieldOrder(slot.groupTable, title ? entry?.fieldOrder?.[title] ?? null : null);
  }
}

let storage; // the single chrome.storage.sync value

console.log("=== RECORD A (PO # populated) ===");
{
  const doc = buildPage({ withPo: true });
  applyStoredOrders(doc, core.normalizeStored(undefined).views[SCOPE]);
  const primary = core.sectionSlots(doc)[0].groupTable;
  console.log("native columns   :", plain(columnKeys(primary)));
  // user drags otherrefnum above trandate in column 2 (runtime drop path)
  core.applyFieldOrder(primary, ["tranid", "entity", "otherrefnum", "trandate"]);
  console.log("after user drag  :", plain(columnKeys(primary)));
  storage = saveOrders(doc, undefined);
  console.log("stored           :", JSON.stringify(plain(storage)));
}

console.log("\n=== RECORD B (same form, PO # blank -> row not rendered) ===");
{
  const doc = buildPage({ withPo: false });
  const entry = core.normalizeStored(storage).views[SCOPE];
  applyStoredOrders(doc, entry);
  const primary = core.sectionSlots(doc)[0].groupTable;
  console.log("after apply      :", plain(columnKeys(primary)), "(saved order not expressible)");
  console.log("fieldOrderDelta  :", core.fieldOrderDelta(primary));
  // user drags the Classification section above Primary Information
  core.applySectionOrder(doc, ["Classification", "Primary Information"]);
  console.log("section order now:", plain(core.sectionSlots(doc).map((s) => core.sectionTitleKey(s.title))));
  storage = saveOrders(doc, storage);
  console.log("stored           :", JSON.stringify(plain(storage)));
}

console.log("\n=== BACK TO RECORD A ===");
{
  const doc = buildPage({ withPo: true });
  const entry = core.normalizeStored(storage).views[SCOPE];
  console.log("entry.fieldOrder :", JSON.stringify(entry?.fieldOrder ?? null));
  applyStoredOrders(doc, entry);
  const primary = core.sectionSlots(doc)
    .find((s) => core.sectionTitleKey(s.title) === "Primary Information").groupTable;
  console.log("columns          :", plain(columnKeys(primary)));
  const lost = plain(columnKeys(primary))[1].join(",") === "trandate,otherrefnum";
  console.log(lost ? ">>> SAVED FIELD ORDER LOST (native)" : ">>> saved field order survived");
}

console.log("\n=== CONTROL: record B where BOTH fields render (no subset change) ===");
{
  const doc = buildPage({ withPo: true });
  let s = core.withFieldOrder(undefined, SCOPE, { "Primary Information": ["tranid", "entity", "otherrefnum", "trandate"] });
  applyStoredOrders(doc, core.normalizeStored(s).views[SCOPE]);
  core.applySectionOrder(doc, ["Classification", "Primary Information"]);
  s = saveOrders(doc, s);
  console.log("stored           :", JSON.stringify(plain(s)));
}
