---
'plot': patch
---

`pnpm run test:contracts` fails on any entry a test leaves in the run's `TMPDIR`, and names each entry with its prefix. The 390-entry `PLOT_LEAK_CEILING` is removed. A full run left 345 entries from 20 test files; each now removes its scratch directories by the exact path `mkdtempSync` returned, in a file-level `after`. Three scan cases built a fixture `PATH` without `rm`, so the scripts' exit traps could not remove their temp files; `rm` is now kept on those paths. A run killed at its bound still reports exit 124 as the bound.

<!--
plan: docs/plans/2026-10-01-every-file-plot-writes-declares-its-bound.md
bumps:
  skills:
    plot: patch
-->
