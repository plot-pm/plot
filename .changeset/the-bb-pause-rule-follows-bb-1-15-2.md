---
'plot': patch
---

fleetd writes the same pause as `bb` 1.15.2 after a Bitbucket 429: a `Retry-After` above one day (86,400 s) pauses for one day. Before, fleetd paused for up to 999,999,999 s where `bb` paused for one day.

<!--
plan: docs/plans/2026-11-24-the-bb-pause-rule-follows-bb-1-15-2.md
bumps:
  skills:
    plot: patch
-->
