---
'plot': patch
---

`pnpm run test:contracts` fails on any entry a test leaves in the run's `TMPDIR`, and names each entry with its prefix. The 390-entry `PLOT_LEAK_CEILING` is removed. A full run left 345 entries from 20 test files; each now removes its scratch directories by the exact path `mkdtempSync` returned, in a file-level `after`. Three scan cases built a fixture `PATH` without `rm`, so the scripts' exit traps could not remove their temp files; `rm` is now kept on those paths. A run killed at its bound still reports exit 124 as the bound. `pnpm run test:board` left 127 entries and now leaves none. Eleven board test files cleaned up on `process.on('exit')`, which a vitest worker never reaches; they use `afterAll`. Board agent logs land in the repo's parent, so `makeRepo` and the fixture copies put each repo in a box of its own (`boxedDir`), and `rmTree` removes the box. The test server's `kill()` and `stop()` signal its whole process tree and wait for it, so no orphaned `plot-host.sh` outlives the run. `plot-tmp.sh` traps PIPE like INT and TERM and ignores it during cleanup: a script writing to a closed pipe now removes its temp files and exits 141. A signal that arrives while `plot_tmpfile` or `plot_tmpdir` creates a path is handled once the path is registered, where before the cleanup could run between the two and leave the path unlisted. Browser tests launch Chromium with a `TMPDIR` of their own, removed when the browser closes, because on Linux Chromium's shared-memory files can outlive a clean close. `owned-run.sh` points `NODE_COMPILE_CACHE` into the run's `HOME`, unless the caller set it, so the compile cache vite, vitest and typescript enable leaves no entry in the root.

<!--
plan: docs/plans/2026-10-01-every-file-plot-writes-declares-its-bound.md
bumps:
  skills:
    plot: patch
-->
