---
"@plot-pm/board": patch
---

fleetd now elects the PR reader lock before every PR beat, skipping the whole pass on `held` so only one process per repository asks the host. A beat that wins the election fences `writePrStore`'s fold against a takeover re-read immediately before the write, and every pass that held the lock publishes its cadence to the reader-state file and a `fleetd` heartbeat.

<!--
plan: docs/plans/2026-10-23-one-pr-reader-per-machine-and.md
bumps:
  skills:
    plot: patch
-->
