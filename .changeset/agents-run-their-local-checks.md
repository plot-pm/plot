---
'plot': patch
---

A fleet agent runs the checks its change touches before each push, as `plot-local-checks.mjs` prints them, and leaves the suites in the `CI suites` config key to CI, where a failure comes back to it as a correction. The brief template names the local checks command instead of a list of full suites, and the shipped worker prompt names it by `PLOT_SCRIPT_DIR`, so it resolves under a plugin install; the prompt's instruction holds even where an older brief still lists the suites. Measured 2026-10-02 on this repository: with 16 cores and 7-8 agents the load stayed at 55-148, and six of seven agents were inside full local suites that CI runs again on every pull request.

<!--
plan: docs/plans/2026-10-02-an-agent-runs-the-tests-its-change-touches.md
bumps:
  skills:
    plot: patch
    plot-implement: patch
-->
