# SuiteMate v3 — Edit Mode Table Enhancements: Build Brief

**Goal:** Bring SuiteMate's table enhancement features to Edit Mode — THIS PHASE:
**Sales Orders in Edit Mode only**. Generalizing to other transaction types is
explicitly out of scope until this is stable and validated.
Working directory: `/Users/Bivek.Shah/Documents/suitemate/suitematev3`.

Every section of this brief is binding. Never skip a stop.

## WORKFLOW — follow in order

### 1. PLANNING — use /superpowers:brainstorming before writing ANY code. It must:

- Review the current SuiteMate v3 implementation and coding standards (read the
  repo's CLAUDE.md / README / docs first if present).
- Understand exactly how the existing View Mode table enhancements work — which
  modules, how they attach to NetSuite's DOM, how personalization is persisted.
- Discover the build-and-reload loop: how the extension is built, loaded, and
  reloaded in Chrome after a change. If reloading can't be automated, define
  precisely what I must do manually each test cycle.
- Investigate the Edit Mode risk areas below and identify the best architecture for
  supporting Edit Mode WITHOUT touching View Mode code paths.
- Divide the research across parallel Opus 5 subagents where independent (one maps
  the View Mode architecture; one investigates sublist machine re-render and
  line-index mechanics; one works out the build-and-reload loop) — research is
  read-only and parallelizes safely.
- Produce an implementation plan with milestones, each ending in a checkpoint
  (git commit + one-line summary), and a feature-status table declaring, for each
  required feature, whether it is fully supportable / degraded / not technically
  possible in Edit Mode, with the reason.
- Structure milestones as divide-and-conquer: milestone 1 is the shared Edit Mode
  foundation (attachment + re-render survival), then one milestone per feature,
  ordered safest → riskiest (resize → hide/show → column reorder → personalization
  → sort/filter). Each milestone must be independently shippable and fully tested
  (Edit Mode + View Mode regression) before the next begins — so if a later feature
  proves impossible, everything before it still lands.

**STOP after the plan is written and wait for my approval.**

### Edit Mode risk areas the brainstorm must investigate

NetSuite sublist "machine" tables are live editing surfaces, not static tables:

- Line index integrity: NetSuite tracks sublist lines by position; reordering or
  filtering DOM rows may corrupt line commits. Determine what is safe (visual-only
  approaches vs true reordering) before promising sorting/filtering.
- Inline editing events: field change, line commit/rollback, row add/remove, and
  server-side recalculation re-render the table — enhancements must survive
  re-renders and never swallow or reorder NetSuite's own event handling.
- Hidden columns must still commit their values; hiding must be display-only.
- Column resizing vs NetSuite's own width management.
- Machine re-render timing: when NetSuite rebuilds the table after a line commit,
  enhancements must re-attach cleanly (no duplicate handlers, no lost state).

### 2. IMPLEMENTATION — once I approve the plan, use /ponytail:ponytail

- Work on a feature branch (e.g. `feature/edit-mode-table-enhancements`), never on
  the default branch. Commit at every milestone checkpoint.
- Build SEQUENTIALLY per the milestone ladder: foundation first, then one feature at
  a time — NEVER implement features in parallel; they share the attachment
  foundation and would collide. Parallel subagents are for research, review, and
  verification — not for writing this feature's code concurrently.

## GOAL COMPLETION REQUIREMENTS — in Edit Mode on Sales Orders

- Drag-and-drop column ordering
- Column personalization
- Hide/show columns
- Column resizing
- Excel-style sorting and filtering where technically possible (per the
  feature-status table from planning — "not possible" is an acceptable answer if
  justified there)

## THE IMPLEMENTATION MUST

- Preserve all native NetSuite Edit Mode behavior.
- Not interfere with inline editing or standard record functionality.
- Leave the existing View Mode implementation completely unchanged — enforce by
  diff: no View Mode module may be modified; shared utilities may change only if the
  approved plan explicitly flagged them, and View Mode must be regression-tested
  after.
- Follow the existing SuiteMate architecture and coding standards.
- Create checkpoints (git commits) at meaningful milestones.

## TESTING — Claude in Chrome against the PRODUCTION account

Treat every browser action as production-grade.

- **RECORD LOCK:** use ONLY this dedicated test Sales Order, and no other record:
  `https://6998262.app.netsuite.com/app/accounting/transactions/salesord.nl?id=16342809&whence=&cmid=1785645578382_2284`
  Before ANY interaction, confirm the URL shows account 6998262 and id=16342809. If
  the browser is on any other record or account, stop and tell me. Never create
  additional test Sales Orders. Never open other transactions in Edit Mode.
- **SAFETY CHECKS** — verify all three BEFORE TESTING BEGINS and again BEFORE EVERY
  SAVE (they are what keeps this order from being sent to the 3PL):
  1. `custbody_salesorder_issue` is checked (true)
  2. Status is Pending Approval
  3. The Memo clearly indicates it is a testing record

  If any check fails at any point: do NOT save, stop, and tell me immediately.
- **SAVE GATE — FOUR-EYES PROTOCOL.** The captain NEVER decides alone that a save is
  safe. Before EVERY save:
  1. Captain gathers evidence: screenshot(s) showing the URL bar (account 6998262,
     id=16342809), the three safety fields (custbody_salesorder_issue, Status,
     Memo), and a one-paragraph statement of exactly what this save will change and
     why.
  2. Captain dispatches an Opus 5 subagent — the "save gate" — with that evidence.
     The gate independently verifies: correct record and account; all three safety
     checks pass; the pending change matches the approved test intent; no forbidden
     verb is involved.
  3. The gate answers exactly GO or NO-GO with reasons. Default is NO-GO: missing,
     stale, or ambiguous evidence means NO-GO. The captain clicks Save ONLY on GO.
     On NO-GO: do not save, stop, and report to me.

  The FIRST save of each session additionally requires my explicit go-ahead in chat.
  After every save, append one line to `docs/testing-log.md` (timestamp, what
  changed, gate verdict) and include it in the next checkpoint commit.
- Saving the test record is allowed ONLY through the save gate above. Never edit the
  three safeguard fields themselves.
- **FORBIDDEN regardless of anything else:** Approve, Reject, Bill, Fulfill, Email,
  Print, Delete, Make Copy, or any status-changing or document-sending action. Edit
  and Save are the only permitted record verbs.
- Any interpretation question during testing — "does this render correctly?", "is
  this a regression?", "did NetSuite recalc as expected?" — is answered by an Opus 5
  subagent from screenshots/DOM evidence, never by the captain's own reading.
- Validate every completed feature thoroughly in Edit Mode, including around
  NetSuite's own behaviors: add a line, edit a line, remove a line, trigger a
  recalc — enhancements must survive each.
- Confirm zero regressions in View Mode by testing View Mode on the same record
  after each milestone.

## COMPLETION — before marking the task complete

- Verify every goal completion requirement is met (or documented as not technically
  possible in the approved feature-status table).
- Perform end-to-end testing of the full feature set in Edit Mode, plus the View
  Mode regression pass.
- Confirm no existing SuiteMate functionality has been affected.
- Create a final checkpoint: commit + a short completion doc recording what was
  implemented, the feature-status table as-built, known limitations, the testing
  log, and what to do next to generalize beyond Sales Orders.

## MODEL POLICY — CAPTAIN/WORKER SPLIT

- The captain (the main session) runs on Fable 5 and orchestrates: planning
  coordination, delegation, reviews, checkpoints, git, and driving the browser for
  testing.
- If the captain spawns ANY agent or subagent, for ANY reason — including agents
  spawned from inside /superpowers:brainstorming, /ponytail:ponytail, or any other
  plugin command — it MUST be explicitly dispatched on Opus 5. Set the model on
  every Task/agent call; NEVER rely on inheritance, which would silently give Fable
  workers.
- Never spawn a Fable worker. If Opus 5 is unavailable for a subagent, stop and tell
  me — do not do the work inline instead, do not downgrade.
- Browser testing stays sequential — never parallel agents sharing Chrome.
