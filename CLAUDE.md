# SuiteMate V3 — Project Rules

## Live testing records (account 6998262)

- Every live validation runs on BOTH records, always:
  - `salesord.nl?id=16342809` — locked small test record (10 rows). Safety checks before interacting: "Has Order Issue" checked, Pending Approval status, Memo "Testing- Do not Process".
  - `salesord.nl?id=16365465` — large order (203 rows × 70 columns, segment-paged in Edit Mode). This is the scale/performance record; a change that only passed on the small record is NOT validated.
- Never save either record. Forbidden verbs: Approve, Reject, Bill, Fulfill, Email, Print, Delete, Make Copy.

## Parked features (do NOT resume unless explicitly asked)

- **Drag-and-drop form layout builder** (v3.22.0 state at `0a04764`) is parked on `feature/form-layout-builder`. Do not continue, merge, or build on it until the owner explicitly says so. Main stays on the v3.21.1 line (classic Personal Form Views + schema-2 storage compat).
