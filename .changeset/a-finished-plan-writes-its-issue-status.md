---
'plot': minor
'@plot-pm/board': patch
---

A delivered or released plan now writes its issue status through the tracker port. `plot-deliver.sh` calls the new `plot-issue-status.sh` after its push lands and reports `tracker=<outcome>` on its summary line; `/plot-release` calls it once per plan it marks Released. The status word comes from two new config keys, `Tracker delivered status` and `Tracker released status`, and an unset key writes nothing. A failed write is reported and never fails the delivery. The Jira connector writes against the issue a plan names; the GitHub connector answers `no-target`, because it writes a pull request's Projects status and has no issue status. The new bundle `board/plot-issue-status.mjs` carries the rule.

<!--
plan: docs/plans/2026-09-24-a-released-plan-tells-its-tracker.md
bumps:
  skills:
    plot-deliver: minor
    plot-release: minor
-->
