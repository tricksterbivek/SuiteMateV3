import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "src/recent-records/core.js"), "utf8");
const runtimeSource = await readFile(resolve(root, "src/recent-records/runtime.js"), "utf8");
const styleSource = await readFile(resolve(root, "src/recent-records/recent-records.css"), "utf8");
const sandbox = { URL };
sandbox.globalThis = sandbox;
runInNewContext(source, sandbox);
const core = sandbox.SuiteMateV3RecentRecordsCore;
const origin = "https://1234567.app.netsuite.com";

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function record(id, overrides = {}) {
  return {
    url: `/app/accounting/transactions/salesord.nl?id=${id}`,
    editUrl: `/app/accounting/transactions/salesord.nl?id=${id}&e=T`,
    name: `Sales Order ${id}`,
    secondary: "Acme",
    kind: "transaction",
    timestamp: Date.UTC(2026, 7, Number(id)),
    ...overrides
  };
}

test("exports one frozen versioned Recent Records core", () => {
  assert.equal(core.VERSION, 1);
  assert.equal(core.STORAGE_KEY, "suiteMateV3RecentRecords");
  assert.equal(core.SCHEMA_VERSION, 1);
  assert.equal(Object.isFrozen(core), true);
});

test("accepts only same-origin NetSuite record URLs with IDs", () => {
  assert.equal(
    core.normalizeRecordUrl(`${origin}/app/accounting/transactions/salesord.nl?id=7&e=T#lines`, origin, {
      removeTransient: true
    }),
    "/app/accounting/transactions/salesord.nl?id=7"
  );
  for (const value of [
    "https://evil.example/app/accounting/transactions/salesord.nl?id=7",
    "/app/accounting/transactions/salesord.nl",
    "/app/common/otherlists/recentrecords.nl?id=7",
    "/app/accounting/transactions/not-a-record.txt?id=7"
  ]) {
    assert.equal(core.normalizeRecordUrl(value, origin), "");
  }
});

test("builds a safe local visit and stable identity", () => {
  const visited = core.prepareVisitedRecord(
    `${origin}/app/accounting/transactions/salesord.nl?id=42&e=T&whence=x#items`,
    "Sales Order #SO42 - NetSuite (Production)",
    origin,
    1234
  );
  assert.deepEqual(plain(visited), {
    identity: "/app/accounting/transactions/salesord.nl|42|",
    url: "/app/accounting/transactions/salesord.nl?id=42",
    editUrl: "/app/accounting/transactions/salesord.nl?id=42&e=T",
    name: "Sales Order #SO42",
    secondary: "",
    kind: "transaction",
    timestamp: 1234
  });
  assert.equal(
    core.recordIdentity("/app/accounting/transactions/salesord.nl?rectype=9&id=42&e=T", origin),
    "/app/accounting/transactions/salesord.nl|42|9"
  );
});

test("stores history, snapshots and pins inside independent scopes", () => {
  let stored = core.withVisit(undefined, "account|role-a", record(1), origin, 100);
  stored = core.withSnapshot(stored, "account|role-a", [record(2)], origin, 200);
  stored = core.withPinned(stored, "account|role-a", record(1), true, origin, 300);
  stored = core.withVisit(stored, "account|role-b", record(3), origin, 400);

  assert.deepEqual(plain(stored.scopes["account|role-a"].history.map((item) => item.identity)), [
    "/app/accounting/transactions/salesord.nl|1|"
  ]);
  assert.deepEqual(plain(stored.scopes["account|role-a"].snapshot.items.map((item) => item.identity)), [
    "/app/accounting/transactions/salesord.nl|2|"
  ]);
  assert.equal(stored.scopes["account|role-a"].pinned.length, 1);
  assert.equal(stored.scopes["account|role-b"].pinned.length, 0);
  assert.equal(stored.scopes["account|role-b"].history[0].name, "Sales Order 3");
});

test("deduplicates visits and evicts the oldest scope", () => {
  let stored;
  for (let index = 0; index < core.MAX_SCOPES + 1; index += 1) {
    stored = core.withVisit(stored, `scope-${index}`, record(index + 1), origin, index + 1);
  }
  assert.equal(Object.keys(stored.scopes).length, core.MAX_SCOPES);
  assert.equal(Object.hasOwn(stored.scopes, "scope-0"), false);

  stored = core.withVisit(stored, "scope-8", record(9, { name: "Updated" }), origin, 100);
  assert.equal(stored.scopes["scope-8"].history.length, 1);
  assert.equal(stored.scopes["scope-8"].history[0].name, "Updated");
});

test("merges server metadata into local history and separates pins", () => {
  let stored = core.withVisit(undefined, "scope", record(1, {
    name: "Fallback title",
    secondary: "",
    timestamp: 500
  }), origin, 500);
  stored = core.withSnapshot(stored, "scope", [
    record(1, { name: "SO1001", secondary: "Customer One", timestamp: 0, dateText: "05/08/2026" }),
    record(2, { timestamp: 400 })
  ], origin, 600);
  stored = core.withPinned(stored, "scope", record(2), true, origin, 700);

  const merged = core.mergeRecords(stored.scopes.scope, origin, Date.UTC(2026, 7, 6));
  assert.deepEqual(plain(merged.pinned.map((item) => item.name)), ["Sales Order 2"]);
  assert.deepEqual(plain(merged.recent.map((item) => item.name)), ["SO1001"]);
  assert.equal(merged.recent[0].secondary, "Customer One");
  assert.equal(merged.recent[0].timestamp, 500);
});

test("parses NetSuite dates and assigns calendar groups", () => {
  const now = new Date(2026, 7, 6, 12, 0).getTime();
  assert.equal(core.parseRecentDate("05/08/2026", now), new Date(2026, 7, 5).getTime());
  assert.equal(core.groupForTimestamp(new Date(2026, 7, 6, 9).getTime(), now), "Today");
  assert.equal(core.groupForTimestamp(new Date(2026, 7, 5, 9).getTime(), now), "Yesterday");
  assert.equal(core.groupForTimestamp(new Date(2026, 7, 2, 9).getTime(), now), "This week");
  assert.equal(core.groupForTimestamp(new Date(2026, 6, 1, 9).getTime(), now), "Older");
});

test("treats a future time-only recent record as yesterday", () => {
  const now = new Date(2026, 7, 6, 8, 0).getTime();
  assert.equal(core.parseRecentDate("11:34 PM", now), new Date(2026, 7, 5, 23, 34).getTime());
});

test("keeps the runtime alive when the page enters the back-forward cache", () => {
  assert.match(runtimeSource, /pagehide", \(event\) => \{\s*if \(!event\.persisted\)/);
  assert.doesNotMatch(runtimeSource, /pagehide"[\s\S]*?\}, \{ once: true \}\)/);
});

test("matches the reference hover activation behavior", () => {
  assert.match(runtimeSource, /const ACTIVATION_THROTTLE_MS = 200;/);
  assert.doesNotMatch(runtimeSource, /ACTIVATION_DELAY_MS|activationTimer/);
  assert.match(runtimeSource, /now - lastActivationAt < ACTIVATION_THROTTLE_MS/);
  assert.match(runtimeSource, /void refreshSnapshot\(\);\s*void lifecycleApi\.waitFor/);
  assert.match(runtimeSource, /if \(fetchController\) \{\s*return;\s*\}/);
  assert.match(
    runtimeSource,
    /popover\.getAttribute\(INJECTED_ATTRIBUTE\) === "true"[\s\S]*?renderActivePanel\(\)/
  );
});

test("retains the popup while the trigger or popup is active", () => {
  assert.match(runtimeSource, /const HOVER_CLOSE_DELAY_MS = 200;/);
  assert.match(runtimeSource, /function retainPopover/);
  assert.match(runtimeSource, /function schedulePopoverClose/);
  assert.match(runtimeSource, /trigger\?\.matches\(":hover"\)/);
  assert.match(runtimeSource, /popover\.matches\(":hover"\)/);
  assert.match(runtimeSource, /popover\.contains\(document\.activeElement\)/);
  assert.match(runtimeSource, /popover\.addEventListener\("mouseenter"/);
  assert.match(runtimeSource, /popover\.addEventListener\("mouseleave"/);
  assert.match(runtimeSource, /document\.addEventListener\("mouseout", handleTriggerExit, true\)/);
  assert.doesNotMatch(runtimeSource, /renderActivePanel\(\);\s*setTimeout\(\(\) => activePanel\?\.panel === panel/);
  assert.match(
    styleSource,
    /\.suitemate-v3-rr-hover-retained \{[\s\S]*?display: flex !important;[\s\S]*?visibility: visible !important;/
  );
});

test("renders the compact Recent Records panel structure", () => {
  for (const token of [
    "createSvgIcon",
    "suitemate-v3-rr-search-icon",
    "suitemate-v3-rr-title-row",
    "suitemate-v3-rr-count",
    "suitemate-v3-rr-slash-hint",
    "suitemate-v3-rr-footer",
    "suitemate-v3-rr-group-title-pinned",
    "suitemate-v3-rr-action-view",
    "suitemate-v3-rr-action-edit",
    "suitemate-v3-rr-action-pin"
  ]) {
    assert.match(runtimeSource, new RegExp(token));
  }
  assert.match(runtimeSource, /"Recent records"/);
  assert.match(runtimeSource, /"Search recent records"/);
  assert.match(styleSource, /width: min\(412px, calc\(100vw - 16px\)\)/);
  assert.match(styleSource, /max-height: min\(560px, calc\(100vh - 40px\)\)/);
  assert.match(styleSource, /\.suitemate-v3-rr-group-title \{[\s\S]*?position: sticky;/);
  assert.match(styleSource, /\.suitemate-v3-rr-row:hover \.suitemate-v3-rr-row-actions/);
  assert.match(styleSource, /\.suitemate-v3-rr-row:focus-within \.suitemate-v3-rr-row-actions/);
  assert.match(styleSource, /\.suitemate-v3-rr-action-pin\.is-pinned svg/);
  assert.match(styleSource, /scrollbar-width: thin;/);
});

test("groups records into a pinned section, date sections and a footer link", () => {
  assert.match(runtimeSource, /appendGroup\(body, "Pinned", filtered\.pinned, \{ pinned: true \}\)/);
  assert.match(runtimeSource, /\["Today", "Yesterday", "This week", "Older"\]/);
  assert.match(runtimeSource, /"View all recent records"/);
  assert.match(runtimeSource, /createSvgIcon\("arrow-right"\)/);
  assert.match(runtimeSource, /panel\.append\(header, body, footer\);/);
  assert.match(runtimeSource, /body\.scrollTop = previousScroll;/);
});

test("record icons carry restrained semantic tints", () => {
  assert.match(runtimeSource, /function iconTint/);
  assert.match(runtimeSource, /function iconGlyph/);
  assert.match(runtimeSource, /suitemate-v3-rr-icon-tint-\$\{iconTint\(record\)\}/);
  for (const tint of ["transaction", "item", "entity", "po", "neutral"]) {
    assert.match(styleSource, new RegExp(`\\.suitemate-v3-rr-icon-tint-${tint} \\{`));
  }
  assert.match(runtimeSource, /replace\(\/\^\(today\|yesterday\),\\s\*\/i, ""\)/);
});

test("slash focuses the search unless the user is already typing", () => {
  assert.match(runtimeSource, /function isTypingTarget/);
  assert.match(runtimeSource, /\["INPUT", "TEXTAREA", "SELECT"\]\.includes\(target\.tagName\)/);
  assert.match(runtimeSource, /target\.isContentEditable/);
  assert.match(runtimeSource, /event\.key === "\/" && isPanelOpen\(\) && !isTypingTarget\(event\.target\)/);
});

test("responsive rules keep the popup inside the viewport", () => {
  assert.match(styleSource, /max-width: calc\(100vw - 16px\)/);
  assert.match(styleSource, /@media \(max-width: 380px\) \{[\s\S]*?\.suitemate-v3-rr-secondary \{\s*display: none;/);
  assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)/);
});

test("panel survives NetSuite unmounting its popover mid-hover", () => {
  assert.match(runtimeSource, /function maybeRescuePanel/);
  assert.match(runtimeSource, /if \(!popover\.isConnected\) \{\s*maybeRescuePanel\(\);\s*return;\s*\}/);
  assert.match(runtimeSource, /const FLOAT_CLASS = "suitemate-v3-rr-float";/);
  assert.match(styleSource, /\.suitemate-v3-rr-float \{[\s\S]*?position: fixed;/);
});

test("panel offers keyboard escape, semantic group headings and recoverable states", () => {
  assert.match(runtimeSource, /suppressActivationUntil = Date\.now\(\) \+ 350;\s*hidePopover\(\);/);
  assert.match(runtimeSource, /function handleGlobalKeydown/);
  assert.match(runtimeSource, /maybeRescuePanel\(\{ force: true \}\)/);
  assert.match(runtimeSource, /event\.key === "Escape" && activePanel\.panel\?\.contains\(event\.target\)/);
  assert.match(runtimeSource, /createElement\("h3", `suitemate-v3-rr-group-title\$\{modifier\}`, title\)/);
  assert.doesNotMatch(runtimeSource, /"presentation"/);
  assert.match(runtimeSource, /suitemate-v3-rr-retry/);
  assert.match(runtimeSource, /suitemate-v3-rr-message-hint/);
  assert.match(runtimeSource, /if \(popover\.contains\(document\.activeElement\)\) \{\s*document\.activeElement\.blur\(\);/);
});

test("disabling the feature removes every document listener", () => {
  for (const pair of [
    ['"mouseover", handleActivation'],
    ['"focusin", handleActivation'],
    ['"mouseout", handleTriggerExit'],
    ['"focusout", handleTriggerExit'],
  ]) {
    const suffix = pair[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(runtimeSource, new RegExp(`document\\.addEventListener\\(${suffix}, true\\)`));
    assert.match(runtimeSource, new RegExp(`document\\.removeEventListener\\(${suffix}, true\\)`));
  }
  assert.match(runtimeSource, /window\.addEventListener\("keydown", handleGlobalKeydown, true\)/);
  assert.match(runtimeSource, /window\.removeEventListener\("keydown", handleGlobalKeydown, true\)/);
});

test("the core has no DOM, Chrome storage or network authority", () => {
  assert.doesNotMatch(source, /\bdocument\b/);
  assert.doesNotMatch(source, /\bchrome\b/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});
