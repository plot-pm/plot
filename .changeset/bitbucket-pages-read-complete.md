---
'plot': patch
'@plot-pm/domain': patch
---

A Bitbucket pull-request listing page now reads complete from its own envelope's missing `next` key, for any `bb` CLI version — fixing a false "possibly truncated" report on every version but 1.9.0 (#1757).

<!--
plan: docs/plans/2026-10-16-bitbucket-parity-and-app-identities.md
bumps:
  skills:
    plot: patch
-->
