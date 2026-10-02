---
'plot': patch
'@plot-pm/board': patch
---

The supervisor's queue holds a slice whose plan names its branch under no `### ` heading as `slice-unnamed` and hands it to nobody, so a plan approved before that refusal existed no longer sends an agent to a slice with no name. The agent met the same refusal at `openSlicePr`, wrote the heading on its own branch, and the board read `(unnamed)` until that PR merged (#1057); the hold keeps the repair on the default branch instead. The word is the one `/plot-approve` refuses on and the predicate is the one it uses, `unnamedBranches`, so the queue and the approval can never name different branches. The hold is tested after the two landing checks, so a merged unnamed branch still reads `already-merged`; only of a claimable slice, so the estate's backlog stays under `not-claimable`; and before `no-brief`, because writing a brief would not release it. The reading is a property of the plan record and costs no host call. The tick line prints `slice-unnamed=<count>` every pass and a looping daemon names the branch, because the branch is the repair.

<!--
plan: docs/plans/2026-10-01-an-approved-slice-has-a-name.md
bumps:
  skills:
    plot: patch
-->
