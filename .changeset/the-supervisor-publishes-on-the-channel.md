---
'plot': minor
---

The fleet supervisor publishes the PR index's changes on the channel at `.plot/fleet.sock`. The IndexMonitor reports `checks green`, `checks failing`, `pr merged` (24 h window) and `default branch red`, and a subscriber that waits `until ci is green` or `until ci is red` is served from them.

<!--
plan: docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md
bumps:
  skills:
    plot-fleet: minor
-->
