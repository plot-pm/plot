---
'plot': patch
'@plot-pm/board': patch
---

A heading whose branches each wait for the branch immediately before them now reads as one `waits:` chain rather than as an uncut slice. `plot-reconcile-scan.sh` section 7 and the board's `unsliced-wave` state (`sliceSiblings`, and the `slice not cut` row it drives) both ask the new `isChainedHeading` rule (`@plot-pm/domain/rules/slice-chain`) instead of counting branch lines; a heading of three where only two chain still reports, and a `waits:` target naming a branch under a different heading still does not chain. The shell side asks the rule through a new bundle, `board/plot-slice-chain.mjs`, held against the TypeScript rule by a corpus test.

<!--
plan: docs/plans/2026-10-19-chain-under-one-heading-reads-as.md
bumps:
  skills:
    plot: patch
-->
