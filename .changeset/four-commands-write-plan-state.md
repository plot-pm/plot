---
'plot': minor
---

`plot-idea`, `/plot-approve`, `/plot-deliver` and `/plot-release` now reflect a plan's phase on the issues its `Issue:` line names, through `Tracker.planStateWrite`: `plot-idea` writes `draft` carrying its new PR's link, `approve.ts` and `deliver.ts` write `approved` and `delivered` from their own controllers, and `/plot-release` writes `released` with the version and closes the issue. The write goes through a new script, `plot-plan-state.sh`, and its bundle `board/plot-plan-state.mjs` — a sibling to `plot-issue-status.sh` that never merges with its Jira-style status-word path. `Tracker approved status`, a `plot-issue-status.sh` config key already wired and tested, is now documented in `plot-config.sh`. Two stale sentences claiming no command closes an issue are corrected in `plot-release/SKILL.md` and `plot-reconcile-scan.sh`.

<!--
plan: docs/plans/2026-10-17-a-planned-issue-shows-its-plan.md
bumps:
  skills:
    plot: minor
    plot-idea: minor
    plot-approve: minor
    plot-deliver: minor
    plot-release: minor
-->
