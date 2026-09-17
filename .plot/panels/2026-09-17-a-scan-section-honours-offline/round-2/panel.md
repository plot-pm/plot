# Panel round 2 — a-scan-section-honours-offline

**Reconciled: `unanimous` — amend (adversary, profiler)**

Round 2 found what four prior readings did not, and it is not in any section.

## The finding: 91.2% of an offline scan is spent before section 1

The profiler instrumented a copy of the scan per section. At load 11.17:

| where | cost |
|---|---|
| **before section 1** | **340.79 s — 91.2%** |
| section 18 | 23.78 s |
| section 9 | 4.49 s |
| **section 6 — this plan's subject** | **0.06 s** |

**The cause is `symlinked_from` (`:675`) and it is quadratic.** It walks every
link in an index and forks twice per link, and it is called per plan across both
indexes. Re-derived here from the real directories:

```
active links: 80   delivered links: 275   plans: 292
292 x 355 x 2 = 207,320 forks
```

**It belongs to no section**, which is why two panels, a moderator and the
author all looked inside sections and found nothing. A helper called once per
plan is invisible to a per-section reading and to a per-section fix.

## The cost model two rounds reasoned from does not exist

The adversary found `plot-reconcile-scan.sh:556` — *"ONE parser invocation for
the whole sweep"* — four lines above the call. Both jurors in round 1, the
moderator and the author multiplied 0.117 s by 292 files to predict ~34 s.

Measured: **470 ms for all 292 plans.** The per-plan figure was never a valid
multiplication base, and the comment saying so sits beside the code.

## What the change actually is

**Section 6 under `--offline` is byte-identical to online today.** It reports
`(none)` here, and that is correct. Both rounds framed the change as repairing a
broken flag; what it does is **trade a correct answer for a kept promise**.

That is defensible and it is a different claim, so the plan is reframed: a
**contract fix**, not a performance fix.

## Where the fix does and does not help

- **The reporter's repository: it helps.** 82 delivered plans × 8.2 s ≈ 11
  minutes, and their `exit=124` lands inside section 6.
- **This estate: it changes nothing measurable.** Section 6 costs 0.06 s and
  reaches zero host calls.

**Both are true, and the plan now says both.**

## What the lenses had in common

**Both measured, and neither asked what the fix is worth against the alternative.**
`symlinked_from` is one function and a `readlink`-free rewrite is plausibly an
afternoon; this plan's fix is a guard and a note. Nobody weighed the two, and
the profiler's own framing — *"a separate defect, somebody's plan to write"* —
takes the sequencing for granted rather than arguing it.

That is the shared blind spot and it is small: both changes are cheap, they
share no gate, and doing the contract fix first costs nothing. But it was
assumed rather than decided.

## A note on the run

The profiler's instrumented copy was swept onto `main` by the author's
`git add -A` while the agent was still working, and removed in a follow-up
commit. The measurement is kept; the 2703-line copy is not. **An agent working
in the tree and an author committing the tree are two writers**, and this is the
second time in this session that pair has produced something nobody intended.

## The moderator's reading

**Unanimous, and the amendment is one factual paragraph**: name the residual
rather than calling it unexplained. The fix, its slice and every gate survive
unchanged.

**Nothing here moves the plan's phase.**
