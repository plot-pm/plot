---
'@plot-pm/board': patch
---

A desk whose turn pushed only its claim commit, opened no PR and left no marker now ends `nothing-done` and writes no seal (#1274). A take-up that finds unlanded work ends `holding-work` naming the desk's own branch, and records the refused assignment as `refusedAssignment` (#1281). The registry daemon reads a new domain rule, `endingAction`, each tick and releases a claim through `gatherReadingsAndRelease`, the same decide-then-release sequence the board's release route uses: for a `nothing-done` ending with no commit beyond the claim and no open PR it releases the ending's branch, and for a take-up `holding-work` it releases the refused assignment and never the desk's own branch. A commit beyond the claim is counted over every commit from `origin/<default>` to HEAD, so an empty claim on top of earlier work does not hide it. A manifest-named desk, an unreadable ending, and a host that cannot say whether a PR is open are left alone.

<!--
plan: docs/plans/2026-10-07-every-loop-ending-has-a-supervisor-rule.md
bumps:
  skills:
    plot: patch
-->
