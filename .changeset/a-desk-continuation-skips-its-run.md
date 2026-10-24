---
"@plot-pm/fleet": patch
---

`continueOnDesk` reads `Slice max runs` through the same digits-only grammar the worker loop's own `positive`/`count` use, rather than a bare `Number()` that also accepted `1e1` and `0x5` as real limits. `Slice max spend` now reads as a three-way `unset`/`value`/`unreadable` result, matching the loop's `dollarsOrUnset`, so a present-but-malformed spend limit refuses the continuation instead of running unlimited. A `write`-path continuation (no manifest yet names the desk) now seeds `sliceRuns: 1` on the manifest it writes, so it counts as a run the next continuation reads — it previously read back as `0` forever and never hit `Slice max runs`.

<!--
plan: docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md
bumps:
  skills:
    plot: patch
-->
