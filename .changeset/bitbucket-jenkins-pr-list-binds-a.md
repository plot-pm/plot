---
'plot': patch
---

Bitbucket's `pr-list --rich` under `CI: jenkins` now binds each row's checks to its own head commit through `jenkins_bind_rows`, the same sha-bind path `pr-state` uses, and emits `checksSha`. A push between Jenkins builds previously left the row showing the branch-colour map's stale reading for the old head; an unmatched head now reads `unknown` rather than that stale colour.

<!--
plan: docs/plans/2026-10-18-bitbucket-jenkins-pr-list-binds-a.md
bumps:
  skills:
    plot: patch
-->
