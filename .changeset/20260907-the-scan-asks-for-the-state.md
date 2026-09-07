---
'plot': minor
---

`plot-fleet-scan.sh` reads git, the claim ref and the plan's annotations, and asks `branchState` in `@plot-pm/domain` what they mean. `branch_state()` merged those readings into a state word with an `if` chain 183 lines long; `branch_readings()` keeps every line of that archaeology and reports eight tab-separated readings instead. The eight words and the precedence over them are one implementation with a test per case, shared with the three domain rules that already consumed a `BranchState` and could not produce one.

The ref check still stays in front of the merge lookup. It is no longer a `return`, so the ordering holds a different way: `mergeSubjectFound` is read only in the no-ref arm and reported `false` otherwise, and a recreated branch's stale merge subject never reaches the rule at all.

`waits_state()` becomes `waits_pr_state()` — the reading without the verdict, whose three answers are now `waitVerdict`. The host round trip it costs is still spent only where a prerequisite could change the answer, and which states those are is `REPLACEABLE_BY_PREREQUISITE`, reported by the rule rather than copied into a shell `case`.

Measured over this estate's 59 branches: the same state for every one, and the same summary.

<!--
plan: docs/plans/2026-09-04-a-branch-state-is-derived-once.md
bumps:
  skills:
    plot: minor
-->
