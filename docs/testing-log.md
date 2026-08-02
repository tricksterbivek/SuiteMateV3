# SuiteMate V3 — live testing log

One line per live session against the locked record (account `6998262`,
Sales Order `id=16342809`, and the same record with `&e=T`). A session with no
save still leaves a line. Save lines additionally record the four-eyes gate
verdict.

| Timestamp | Milestone | Exercised | Evidence | Gate verdict |
|---|---|---|---|---|
| 2026-08-02 23:07 AEST | M1 | Dossier §12 probes 1, 2, 3, 4, 6, 6b, 6c, 6d, 7, 9, 10, 11, 12 and probe 8 (Gate A) on `id=16342809&e=T`; read-only except three authorized in-page interactions — probe 8's Gate A cell permutation plus its quantity edit and OK commit on line 3, probe 10's Insert/Remove/Cancel cycle, and probe 11's line-open and OK commit with the Quantity column hidden (all discarded by navigate-away teardown, owner-confirmed); probe 5 deferred (POST-body half requires a save; read-only half not run — open gap for M1.5) | Raw transcripts in `.superpowers/sdd/2026-08-02-edit-mode-table-enhancements/probe-transcripts.md`; interpreted verdict in the M1 checkpoint entry (`save/CHECKPOINTS.md`) | No save; four-eyes gate not invoked. Gate A: REFRAME (model-driven regeneration — repaint replaces, never patches; corruption not manifest; M4 blocked pending M1.5 identity + Gate A′) — see checkpoint. Native drag-order (probe 6b): no |
