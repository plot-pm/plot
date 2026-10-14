---
'plot': patch
---

`Host.commitStatus()` records one GitHub commit status through `plot-host.sh commit-status`, the layering this repo's domain needs before a `plot-review` command can write `plot/review` on a PR's head. The port names no issue, label or App id; `host-fixture.ts` records each write the way `prCreate` already records opens, for tests that prove a status was written once and not twice.

<!--
plan: docs/plans/2026-10-14-a-pr-cannot-merge-until-its.md
bumps:
  skills:
    plot: patch
-->
