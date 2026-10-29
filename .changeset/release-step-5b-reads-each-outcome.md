---
'plot': patch
---

`/plot-release` step 5b now reads back each plan's own release outcome — the bundle's exit code and `summary:` line on the no-board path, or `GET /api/release/<slug>` polled to a terminal state where a board runs — and prints one line per plan that did not release, carrying that plan's own message, instead of only counting the calls sent. Also drops the false claim that a board button calls `POST /api/release`; no button does, and the step is the route's only caller.

<!--
plan: docs/plans/2026-10-28-parallel-release-calls-exhaust-their-push.md
bumps:
  skills:
    plot-release: minor
-->
