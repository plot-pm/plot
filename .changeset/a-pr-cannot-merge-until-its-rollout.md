---
'plot': patch
---

The plan-PR merge in `approve.ts` and the ladder's micro-PR fallback in `ladder.ts` each write `plot/review` success on the PR they are about to merge, before the merge call — the two PR kinds that previously merged with no review status. `plot-host.sh` gains a read-only `pr-comments <number>` op (GitHub only; Bitbucket exits 4). `/plot-reconcile`'s new "20a. Review bypass" section reports — never gates — a merged PR whose checks were not green and which carries no `review-bypass:` comment; the signal is `pr-state`'s folded `checks` field, an approximation named in the section's own comments, not a precise per-context read of the `plot/review` status alone.

<!--
plan: docs/plans/2026-10-14-a-pr-cannot-merge-until-its.md
bumps:
  skills:
    plot: patch
-->
