---
"plot": patch
---

The reaper asks whether ANY PR for a branch merged, not whether the newest one
did — so a closed duplicate stops masking a real merge.

**The measured bug**: `pr_merged` asked the host with `--limit 1`, which returns
only the most recent PR for the branch. Where a newer, unmerged PR sits in front
of the real merge, the reaper reported `unlanded work — no merged PR` about a
branch whose work was already on main. Measured 2026-08-27 against the live
host, and re-confirmed while implementing:

| branch | newest PR | the real merge |
|---|---|---|
| `an-unreachable-host-says-so` | #473 `mergedAt=null` | **#446 merged** |
| `the-scan-sees-a-stale-sprint-tally` | #464 `mergedAt=null` | **#463 merged** |
| `a-plan-cites-a-jira-key` | #476 `mergedAt=null` | **#447 merged** |

**And the masking PRs are ones the fleet opened itself**, on already-merged
waves, which closes a loop: a leftover worktree lets auto-dispatch adopt a
merged branch; its worker opens a duplicate; the duplicate is newer, so
`--limit 1` reads `mergedAt=null`; the reaper keeps the worktree — the input to
step one.

This is the same lesson the script already learned once and records at
`pr_merged`: it reads `mergedAt` and never `state`, because a merged PR reports
`CLOSED`. Reading only the NEWEST PR is that error one level out — the newest PR
is not the merge, just as the state is not the merge.

**A branch with no merged PR is still kept.** Four such on the estate that day
(`merged=0, open=0`) — genuinely unlanded work, and a fix that reaped them would
destroy work while still passing the first assertion. Both the "PRs exist, none
merged" and the "host knows no PR" cases are pinned under `--yes`, not only in
dry run.

The five refusals are unchanged — live pid, uncommitted changes, a
`PLOT-BLOCKED*` marker, a tree on the default branch, no merged PR. This
corrects how the last one is *measured*; it removes none and adds none.

Why it is worth a wave of its own: the estate is the fleet scan's binding
constraint. Reaping 12 worktrees took the scan from **462.90 s to 51.28 s** —
22 % fewer worktrees, 89 % less wall clock, from over the 90 s budget to inside
it. A worktree the reaper wrongly keeps is not untidiness; it is scan time.

The limit is 100 rather than unbounded: `gh` has no "all" sentinel, and a branch
carrying more than 100 PRs whose only merge is the oldest would still be missed
— a far narrower window than "any duplicate at all", and it fails safe, toward
keeping a worktree.

<!--
bumps:
  skills:
    plot: patch
-->
