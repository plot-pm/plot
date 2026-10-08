---
'@plot-pm/board': patch
'plot': patch
---

`Agent max spend` and `Slice max spend` now read `$20` and `20 USD`, not just a bare number — `dollarsOrUnset` accepts a leading `$` and a trailing `USD` (case-insensitive). A present value it cannot read, including `0` or a negative number, now refuses the worker's start and logs the key and the raw value, rather than silently running with no limit. Fixes #1328.

<!--
plan: docs/plans/2026-10-07-the-fleet-loop-reads-its-runs-right.md
bumps:
  skills:
    plot: patch
-->
