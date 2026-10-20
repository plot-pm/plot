---
'plot': patch
---

A corpus test now pairs the scan and the domain rule on a `waits:` target that carries an open pull request, under one heading and across two — the shape `branch-state-waits.corpus.test.ts`'s `gh` shim could not reach, since it always answered "no pull requests found". Reproduction against that exact shape showed the rule, the scan and `--list-eligible` already agree (`waiting`, never `eligible`); no change to `branch-state.ts`, `plot-fleet-scan.sh` or `stuck.ts` was needed.

<!--
plan: docs/plans/2026-10-19-chain-under-one-heading-reads-as.md
bumps:
  skills:
    plot: patch
-->
