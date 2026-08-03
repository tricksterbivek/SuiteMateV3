# Edit Mode branch — status, 2026-08-04

Branch `feature/edit-mode-table-enhancements` @ `bc8e370`. Recovered from the reflog at `4cf0a1c` on 2026-08-03 night (the 2026-08-03 deletion is undone; the prescribed resume path was followed exactly: verify the Critical's fix, harden the fixture evidence, ship hide/show first).

`main` is untouched and remains v3.21.1.

## Verified and shipped on this branch

- **Foundation (M1)** — route capability gated on Edit Mode, settings flag (default off), storage key, lifecycle attachment, teardown. Reviewed.
- **Column identity (M1.5)** — machine hidden-field decode, 43-id axis, live-proven mount across the mini-form boundary.
- **Column resize (M2)** — works live; widths persist through repaints and reloads. **M2 checkpoint debt stands**: recalc-survival and horizontal-scroll residual checks never ran, and M2's ledger entry was never written.
- **Hide/show (M3) — COMPLETE.** `4cf0a1c` (previously committed-but-unreviewed) was independently reviewed: it closes the original Critical but opened a same-class regression (stale `fixed` layout starving later mounts into a 50px-floor partial plan). `bc8e370` closes that plus the reviewer's full surface sweep (scope-key latch, wired dirty-row force-reveal, `hideIncomplete` repair path, menu dismissal, stashed-container teardown), reviewed to **MERGE** over three rounds. Live pass 2026-08-04 on the locked order: hide/show, force-reveal on open line, commit-with-hidden with values preserved, remove-renumber re-apply, persistence round trip, View Mode regression — all at computed level, no save, record byte-identical. Full evidence: `save/CHECKPOINTS.md` M3 entry + `docs/testing-log.md`.

## Not started

- **Reorder (M4)** — blocked pending Gate A′ per the M1 REFRAME verdict.
- **Personalization UI hardening (M5), filter (M6), sort (M7)** — deferred at the owner's direction.

## Carried follow-ups (non-blocking, from the MERGE review)

1. `resolveScopeKey` fallback: make it observable, fail closed on writes (segment-count distinguishes the shapes).
2. Harness: derive event containment via `closest` instead of the `outside` flag.
3. Menu lifecycle edges (unconfirmed reachability): orphaned menu on container replacement without teardown; silent no-op on a stale tick after reseed.
4. Write the M2 checkpoint after its residual live checks.

## Standing cautions

- Settings schema is 6 on this branch (Q1, owner-approved). Reverting the loaded extension to `main` (v3.21.1, schema 5) requires the schema-downgrade console step first — live storage is a one-way door.
- The Edit Mode storage scope is `{company}:{user}:salesord:edit` — one scope for ALL sales orders this user edits, not per-record. The hidden set seen on the test order applies everywhere in Edit Mode.
