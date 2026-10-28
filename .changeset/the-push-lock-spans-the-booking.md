---
'@plot-pm/board': patch
'plot': patch
---

`commitAndPush` now takes the default-branch push lock itself, holding it across the fetch, reset, reapply, commit and push of every attempt rather than around the push call alone. `plot-push-main.sh` accepts a lock its caller already holds via `PLOT_PUSH_LOCK_HOLDER`, so a caller that already locked does not deadlock retaking it, and `PLOT_PUSH_LOCK_WAIT` now resets its no-progress bound whenever the lock's holder changes rather than measuring one fixed wait. The board bounds its own wait for the lock helper at the helper's wait and stale bounds plus 60 s (780 s by default), so the helper's exit 6 arrives instead of a kill at 120 s, and it releases a lock a cut-short take left under its holder. A board holder is written as `<pid>.<seq>`, so a dead 7-digit Linux pid reads dead. On 2026-10-28, 24 of 53 parallel `POST /api/release` calls stopped after attempt 5 of 5 with `non-fast-forward`, because every queued writer fetched and committed against a base that went stale the instant any other writer's push landed.

<!--
plan: docs/plans/2026-10-28-parallel-release-calls-exhaust-their-push.md
bumps:
  skills:
    plot: patch
-->
