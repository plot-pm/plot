---
'plot': patch
---

`plot-install-hooks.sh --verify` reports the exit code of a gate that exits 128 or more on both probes, for example `exited 255 twice (128 or more)`, instead of asserting that a signal ended it. `install-hooks.test.mjs` also covers a signal on the first probe with a permit on the second, and asserts that the retry runs in a different scratch repository.

<!--
plan: docs/plans/2026-10-10-the-tests-and-gates-close-their-review-findings.md
bumps:
  skills:
    plot: patch
-->
