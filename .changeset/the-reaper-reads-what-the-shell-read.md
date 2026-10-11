---
'plot': patch
---

The reaper's dirty-tree kind now reads the same leftover filter the reap loop does, so a desk whose only dirt is Plot's own `.plot/state` pulse fixture is no longer reported as a leftover nobody owns. `--sweep-temp` treats an empty `TMPDIR` as unset rather than as the filesystem root, and the temp sweep's ownership check answers by uid alone, defaulting to unowned on an unreadable path rather than defaulting to owned.

<!--
plan: docs/plans/2026-10-10-the-tests-and-gates-close-their-review-findings.md
bumps:
  skills:
    plot: patch
-->
