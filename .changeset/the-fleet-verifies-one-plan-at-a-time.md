---
'plot': patch
---

The fleet's verify pass starts at most one run at a time, bounds it by `Worker bound`, and reads the plan at `origin/<default branch>` to decide whether a run succeeded, so a run that wrote its record no longer counts as failed and starts again. A run whose plan left Delivered counts as neither. The pass removes only the trees of runs it started, through the trees port, and refuses a plan whose trees a person's run holds as `hand-run`; with `Auto-verify` off it removes nothing. The run's prompt runs `prepare` and then the tools tree's `/plot-deliver` and `/plot-panel` text by absolute path. `prepare` moves an earlier run's `verify-*` juror files to `verify-<n>-*`, and `fold` skips them. A record from a person's `/plot-deliver --verify` clears the plan's failures and the fleet halt, and Verify mode accepts a Released plan for a person's run. `/plot-fleet --status` prints the verification block through `plot-verify.mjs status`, and `/api/fleet` carries it as `verification`.

<!--
plan: docs/plans/2026-10-12-the-fleet-verifies-what-it-delivered.md
bumps:
  skills:
    plot-deliver: patch
    plot-fleet: minor
-->
