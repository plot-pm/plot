---
'plot': minor
'@plot-pm/board': minor
---

`plot-local-checks.mjs --ci` prints the checks a change selects as one line of JSON for a CI job: `suites`, `checks` (each with `suite`, `command`, `tests` and `always`), `tests`, `corpus` and `untested`. In this mode every test file that names a changed path is selected with no limit, a check with no `{tests}` or `{changed}` placeholder runs on every change, and a changed plan, sprint or `.plot/` file sets `corpus`. The map from a changed path to the test files that name it moves into `@plot-pm/domain` (`testsNaming`), so the local run and CI read one map. A `{changed}` check now also runs the test files under its glob that name a changed script, bundle or document, which `vitest related` cannot see. The default output and its exit codes are unchanged.

<!--
plan: docs/plans/2026-10-30-ci-runs-what-the-change-touches.md
bumps:
  skills:
    plot: minor
-->
