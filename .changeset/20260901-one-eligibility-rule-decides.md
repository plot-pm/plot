---
'@plot-pm/board': patch
'plot': patch
---

One eligibility rule decides whether a slice can be started.

`sliceVerdict`, `sliceVerdicts` and `isClaimable` move to
`packages/domain/src/rules/eligible.ts`, and `plot-fleet-scan.sh` reaches them
through a bundled `plot-verdicts.mjs` entry point instead of deciding in shell.
The phase test is an allowlist of one — `approved` — so an unreadable phase
withholds `eligible` rather than inheriting it.

<!--
bumps:
  skills:
    plot: patch
-->
