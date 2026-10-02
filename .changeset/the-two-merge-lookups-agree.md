---
'plot': patch
---

A corpus test holds the two merge lookups to one answer: `pr_merged` in `plot-pr-merged.sh`, which asks `gh` directly, against the host adapter's `prMerged`, which asks `plot-host.sh pr-merged`. Seven built cases over one stub `gh`, comparing whether a caller may treat the branch as merged. `docs/shell-and-domain.md` now names that lookup pair as the duplicate rather than `rules/reapable.ts` and `rules/queue.ts`, whose rule moved into `rules/landed.ts` and is shared by both sides.

<!--
plan: docs/plans/2026-10-01-an-empty-branch-never-reads-as-merged.md
bumps:
  skills:
    plot: patch
-->
