---
'plot': patch
'@plot-pm/board': patch
---

`/plot-board-setup` and `/plot-init` now propose `Tracker: jira` together with `Sprint owner: plot` for a Bitbucket repository whose branch names carry a recurring Jira project key, in place of the `Tracker: plot` that `issue-list` refuses with exit 4. Unattended, they write `Tracker: jira` with no URL and name the missing base URL; they never write the `<base URL>` placeholder as a value. `plot-detect-repo.sh` reports `branch_ticket_prefix`, `branch_ticket_prefix_count` and `branches_read` over distinct branch names, so a local branch and its `origin/` copy count once. `proposeStack` answers `branchTicket` under the same two-occurrence threshold as `ticket`, and the adoption answers file takes a `sprintOwner`.

<!--
plan: docs/plans/2026-10-21-bitbucket-with-tracker-plot-the-message.md
bumps:
  skills:
    plot-board-setup: minor
    plot-init: minor
-->
