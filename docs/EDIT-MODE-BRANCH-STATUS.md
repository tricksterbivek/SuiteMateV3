# Edit Mode branch — status, 2026-08-04 (owner-confirmed)

Branch `feature/edit-mode-table-enhancements` @ `bc8e370`. Recovered from the reflog at `4cf0a1c` on 2026-08-03 night (the 2026-08-03 deletion is undone; the prescribed resume path was followed exactly: verify the Critical's fix, harden the fixture evidence, ship hide/show first).

`main` is untouched and remains v3.21.1.

## Verified and shipped on this branch

- **Foundation (M1)** — route capability gated on Edit Mode, settings flag (default off), storage key, lifecycle attachment, teardown. Reviewed.
- **Column identity (M1.5)** — machine hidden-field decode, 43-id axis, live-proven mount across the mini-form boundary.
- **Column resize (M2)** — works live; widths persist through repaints and reloads. **M2 checkpoint debt stands**: recalc-survival and horizontal-scroll residual checks never ran, and M2's ledger entry was never written.
- **OWNER CONFIRMED 2026-08-04:** hide/show works across Sales Orders — both forms, segment paging, add/remove lines — "okay its working". Ships: M3 hide/show + required-column exemption + hidden-stays-hidden + per-column unanimity (`6ec83e0`) + segment-paging fix (`72a67ca`). 332/332 tests.
- **Hide/show (M3) — COMPLETE AND DECLARED** (`save/CHECKPOINTS.md` "M3 DECLARED"). Four reviewed rounds: `bc8e370` (review of the recovered branch's unreviewed fix — closed the original Critical, found+fixed a same-class regression, plus the full surface sweep), `08e3c1e` (owner directive: NetSuite-starred required columns are not hideable — Item and Tax Code on this form, DOM-derived per install), `c09997a` (owner directive: hidden stays hidden — force-reveal deleted entirely; immediate apply). Two live passes + an independent adjudication closed R1–R4 (field edit with server recalc, add-a-line with the hide re-applied to the new row, behavioural View Tier-4 including a 9-data-row Export); R5 (storage byte-baseline) is struck from M3 and bound as a hard M5 entry gate per spec §9. 322/322 tests, 28 baselines 0.000%.

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
