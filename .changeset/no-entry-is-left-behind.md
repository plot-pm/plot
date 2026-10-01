---
'plot': patch
---

`pnpm run test:contracts` fails on any entry a test leaves in the run's `TMPDIR`, and names each entry with its prefix. The 390-entry `PLOT_LEAK_CEILING` is removed. A full run left 345 entries from 20 test files; each now removes its scratch directories by the exact path `mkdtempSync` returned, in a file-level `after`. Three scan cases built a fixture `PATH` without `rm`, so the scripts' exit traps could not remove their temp files; `rm` is now kept on those paths. A run killed at its bound still reports exit 124 as the bound. `pnpm run test:board` left 127 entries and now leaves none. Eleven board test files cleaned up on `process.on('exit')`, which a vitest worker never reaches; they use `afterAll`. Board agent logs land in the repo's parent, so `makeRepo` and the fixture copies put each repo in a box of its own (`boxedDir`), and `rmTree` removes the box. The test server's `kill()` and `stop()` signal its whole process tree and wait for it, so no orphaned `plot-host.sh` outlives the run. `plot-tmp.sh` traps PIPE like INT and TERM and ignores it during cleanup: a script writing to a closed pipe now removes its temp files and exits 141. `owned-run.sh` does not count Node's `node-compile-cache`, which vite, vitest and typescript create.

<!--
plan: docs/plans/2026-10-01-every-file-plot-writes-declares-its-bound.md
bumps:
  skills:
    plot: patch
-->
