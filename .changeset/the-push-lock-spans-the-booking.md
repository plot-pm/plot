---
'@plot-pm/board': patch
'plot': patch
---

`commitAndPush` now takes the default-branch push lock itself, holding it across the fetch, reset, reapply, commit and push of every attempt rather than around the push call alone. `plot-push-main.sh` accepts a lock its caller already holds via `PLOT_PUSH_LOCK_HOLDER`, so a caller that already locked does not deadlock retaking it, and `PLOT_PUSH_LOCK_WAIT` now resets its no-progress bound whenever the lock's holder changes rather than measuring one fixed wait. 53 parallel `POST /api/release` calls on 2026-10-28 exhausted 24 of their 5 retries with `non-fast-forward`, because every queued writer fetched and committed against a base that went stale the instant any other writer's push landed.

<!--
plan: docs/plans/2026-10-28-parallel-release-calls-exhaust-their-push.md
bumps:
  skills:
    plot: patch
-->
