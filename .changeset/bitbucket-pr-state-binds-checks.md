---
'plot': patch
'@plot-pm/domain': patch
---

Bitbucket `pr-state` now emits `headSha`, `checks` and `checksSha`. Under `CI: jenkins` it binds the branch colour to the PR head through the sha-run lookup, and a head that no build carries reads `pending`; without Jenkins, `checks` reads `unknown`. Bitbucket `pr-review` no longer exits 4: it reads the `plot/review` commit status and `review-bypass:` comments. Fixes gaps 2, 6 and 8 of #1867.

<!--
plan: docs/plans/2026-10-16-the-agent-s-ci-wait-never.md
bumps:
  skills:
    plot: patch
-->
