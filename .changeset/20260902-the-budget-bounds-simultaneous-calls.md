---
'plot': minor
'@plot-pm/board': minor
---

A cap on host calls in flight per account, discovered rather than compiled in.

Nothing bounded concurrency. `grep -niE 'semaphore|in-?flight|concurren'` over
`plot-host.sh` matched two comments and no code, and the board's `prConcurrency`
held a hard-coded 4 that no call site read. The failure that leaves is the one
measured on 2026-08-27: eight workers against a cap of seven produced a 403
naming abuse detection while both buckets read `5000/5000, used=0`. **A quota
budget cannot prevent it** — a secondary limit counts calls at one moment and
appears in no bucket, so spacing calls further apart does not reduce how many
are simultaneous when several spenders start at once.

**Seven is not shipped.** Both citations in `plot-host.sh` point at that one
incident, where eight failed and seven is the inference. The bound is derived
instead from the ceiling the record already holds: a limit is requests per HOUR
and a bound is requests at one MOMENT, so an account allowed `limit` an hour
sustains `limit / (3600 / 4)` of them at once at four seconds a call. GitHub's
5000/hr gives **5**, below the eight that was refused; 900/hr gives 1; a
connector reporting `unknown` gives none and stays unbounded, which is what
every caller was before this. A different ceiling gives a different bound, which
a constant could not do — asserted rather than described.

**The count is shared state because the population is processes.** Eight workers
are eight processes, each shelling `plot-host.sh` once, and the board's own
refresh is sequential — so an in-process semaphore bounds nothing that incident
measured. **The budget record cannot hold it either**: it is append-only with a
512-byte line cap, the two properties that make it lock-free, and an in-flight
count needs a delete on release. A process killed between claim and release
would leave a line nothing removes and the account would read as permanently
full — the cap degrading into a deadlock, which is worse than the 403. So the
claims sit beside the record, one file per slot under
`$PLOT_BUDGET_HOME/slots/<account>/`, where releasing is an unlink and a dead
claimant is a measurement.

**A claim is published by `link`, never by an exclusive create.** `O_CREAT |
O_EXCL` is exclusive but publishes the NAME before the CONTENT: a second process
opens the empty file, reads no claim in it, and reclaims a slot the first is
about to write into. Measured here — **six processes against a bound of three
took five slots, two of them the same one**. `link` publishes a file that is
already complete and refuses an existing name, so the name and the claim arrive
together. Both halves are written that way and a contract test pins their
format, because the board is TypeScript and the eleven other spenders are shell:
two implementations that could not read each other would be two caps, which is
no cap at all.

**At the cap a caller waits, and the wait IS the degraded cadence.** Nothing is
refused; the call happens later. A wait that runs out after 30 seconds proceeds
rather than refusing, because a board that waited forever reads as broken
instead of busy — and the cost of one extra simultaneous call is a secondary
refusal that lowers the bound, which is evidence arriving through the mechanism
this slice is built on. An unreadable slot directory spends: the cap exists to
prevent a 403, not to become a second way to fail.

**The bound is corrected by the refusals it causes**, the mechanism the limit
itself uses. A secondary refusal halves it, floored at one; a spent quota leaves
it alone, because a quota is an hourly ceiling one caller reaches alone. It only
ever falls within a session — the absence of a refusal is not evidence that more
would have been allowed. **The cadence is untouched by either**, the constraint
slices 4 and 8 both state: a refusal that also lowered the interval would
compound with the division `cadenceStretch` is already performing and drift
downward with nothing to restore it.

**The record shows the bound working rather than merely quiet.** `prSlotsHeld`
and `prConcurrencyCap` travel in the board payload, read from one `readdir` per
refresh and no host request, so `2 of 5` says the account has two callers in
flight and room for three more. A cap that refuses nothing and reports nothing
is indistinguishable from no cap at all.

<!--
bumps:
  skills:
    plot: minor
-->
