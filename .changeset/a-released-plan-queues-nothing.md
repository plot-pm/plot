---
'plot': patch
---

`readQueue` skips a plan in the `delivered` or `released` phase before it reads any of that plan's branches. A finished plan contributes no slice to the queue, so the tick no longer prints its branches held on `waits` or `not-claimable`, and the queue asks the host and git nothing about them. A plan with an empty, missing or unrecognised phase is not finished and queues as before. `FINISHED_PHASES` is now exported from `rules/eligible.ts`.

`readQueue` also reads the PR index on every pass and counts each branch with a merged, non-draft row as merged, whether or not the merged listing answered whole. The listing names the host's newest 500 merged PRs, so a slice of an unfinished plan whose own PR merged further back now leaves the queue, and a `waits:` prerequisite whose PR merged further back no longer holds its slice on `waits` as `unmerged` (#1454). An open, closed or draft row, and a missing row, settle nothing. `landedSource` reads a merged index row before the listing, and the new `indexMergedHeads` in `rules/known-pr.ts` names the heads the index holds a merged row for.

<!--
plan: docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md
bumps:
  skills:
    plot-fleet: patch
-->
