---
'plot': minor
'@plot-pm/board': minor
---

`plot-local-checks.mjs --ci --corpus <glob>` names the corpus tier's files: a changed script, source or test that a corpus test file names selects that file in the new `corpusTests` field, and a changed shared corpus module, or a path one names, sets `corpus` for the whole tier. A changed plan, sprint or `.plot/` file still sets `corpus` and now selects no other check, because a test that names a plan file's basename names its own fixture. `--corpus` without `--ci` exits 2.

<!--
plan: docs/plans/2026-10-30-ci-runs-what-the-change-touches.md
bumps:
  skills:
    plot: minor
-->
