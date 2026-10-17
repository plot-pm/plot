---
'plot': patch
---

`pr-list --rich` under `CI: jenkins` now binds a PR row's `checks` to its own head sha instead of the branch-colour map's last-measured colour — fixing gaps 3, 4 and 10 of #1867. A row whose colour map entry is `green` or `failing` is checked against Jenkins' REST build history for that exact head; a push that supersedes a build in flight reads `pending` on the new head rather than carrying over the old head's colour, and `checksSha` is emitted only when a sha-bound match was found. A Jenkins build that was `ABORTED` or never built (`NOT_BUILT`) reads `unknown` on the PR row, matching the sha-run path's existing mapping. Rows the colour map already answers unambiguously (`none`, a build in progress) skip the REST call entirely, keeping the added cost bounded to rows that actually need disambiguation.

<!--
plan: docs/plans/2026-10-16-the-agent-s-ci-wait-never.md
bumps:
  skills:
    plot: patch
-->
