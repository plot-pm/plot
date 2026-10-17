---
'plot': patch
'@plot-pm/domain': patch
---

`pr-list --rich` under `CI: jenkins` now binds a PR row's `checks` to its own head sha instead of the branch-colour map's last-measured colour — fixing gaps 3, 4 and 10 of #1867. A row whose colour map entry is `green` or `failing` is checked against Jenkins' REST build history for that exact head: a build of the head gives its own word and `checksSha`, and an answer with no build of the head reads `pending`. A lookup that cannot ask Jenkins — no API credential, no job path, an HTML or empty answer, or a failed bundle — gives no reading, so the row keeps its branch colour with an empty `checksSha`, and the pass asks no further row. One pass reads at most five rows by sha, the most recently updated first, so the Jenkins cost no longer grows with the number of open PRs. A Jenkins build that was `ABORTED` or never built (`NOT_BUILT`) reads `unknown` on the PR row, matching the sha-run path's existing mapping.

<!--
plan: docs/plans/2026-10-16-the-agent-s-ci-wait-never.md
bumps:
  skills:
    plot: patch
-->
