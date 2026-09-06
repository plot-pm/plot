---
'plot': minor
---

The reconciliation sweep reports a live slice whose body claims a wait its branch line does not carry. Section 15 names the slice and quotes the sentence, and the footer carries `stated_waits=`.

Two records of one fact, and only one of them reaches the fleet. Measured 2026-09-06: `a-desk-is-adopted-and-swept` said in bold *"**IT WAITS FOR** `a-desk-is-finished-with-once` (#705)"*, its heading carried no `waits:`, so `bug/the-reaper-reads-prunable` read as eligible and reached the supervisor's queue as `no-brief`. A person recognising the prose was the only thing that stopped it dispatching.

The check matches the claim, never the reference. The drafted rule — a slice body linking a plan file or naming a PR number without `waits:` — fires on **391 of 477 slices**, because plans cite each other as context constantly, and a finding that fires on four slices in five is one a reader learns to skip. One phrase, `waits for` / `waits on`; `depends on` (16 hits) reads as design rationale more often than ordering and `after the …` / `after #…` (13) is temporal prose, so neither is added.

The subject must be the slice, and that is what separates a claim from a description. `waits for` alone hits 12 slices; every genuine one names the thing waiting, while every false positive has something else doing it — a `--stop` that waits for each worker to exit, a wave row that links what it waits on. The anchor takes 12 to 2, and those 2 are exactly the two the plan's own author read as genuine by hand. A backticked span quotes the phrase rather than claiming it, which is what keeps the slice that defines this check from reporting itself.

Draft and Approved only. A shipped plan's wait was resolved by shipping, and reporting it is noise about finished work; that single filter is what takes the whole-estate count to **zero findings on today's estate**. The section stays out of `attention=` and sits below `== blocking sections end ==`, so an unannotated wait never stops a delivery: the repair names a branch no shell can guess, and a plan may legitimately say a slice waits while its author decides the sentence is context.

The section count in `CLAUDE.md` and `AGENTS.md` catches up with the scan — fifteen, where they said fourteen and thirteen.

<!--
plan: docs/plans/2026-09-06-a-stated-wait-is-a-parsed-wait.md
bumps:
  skills:
    plot: minor
-->
