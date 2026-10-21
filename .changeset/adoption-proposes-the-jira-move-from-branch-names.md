---
'plot': patch
---

`/plot-board-setup` and `/plot-init` now propose moving a Bitbucket repository off `Tracker: plot` when a Jira project key recurs in its branch names: the proposal names `Tracker: jira <base URL>` together with `Sprint owner: plot`, matching the working configuration `bbIssueCommandMissing`'s refusal already names. `plot-detect-repo.sh` gained the branch-name probe behind it (`branch_ticket_prefix`, `branch_ticket_prefix_count`, `branches_read`), a population distinct from its existing commit-subject ticket probe.

<!--
plan: docs/plans/2026-10-21-bitbucket-with-tracker-plot-the-message.md
bumps:
  skills:
    plot-board-setup: minor
    plot-init: minor
-->
