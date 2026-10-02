---
'plot': patch
'@plot-pm/board': patch
---

`plot-local-checks.mjs` prints the checks a branch's change needs before it is pushed, from the new `Local checks` config key: `glob = command` pairs separated by `;`, where `{tests}` becomes the test files that name a changed path and `{changed}` the changed paths for a runner that follows imports, such as `vitest related`. Generated files (`-merge` in `.gitattributes`) select nothing, and a path named by more test files than `Local checks limit` (default 20) is reported as left to CI instead of listed. The `CI suites` key lists the suites only CI runs; it is printed in the report. The rule is `localChecks` in `packages/domain/src/rules/local-checks.ts`, and the `Refs` port gains `workingChanges`, `filesNaming` and `mergeUnset`. Measured 2026-10-02 on this repository: with 16 cores and 7-8 fleet agents the load stayed at 55-148, and six of seven agents were inside full local suites that CI runs again on every pull request.

<!--
plan: docs/plans/2026-10-02-an-agent-runs-the-tests-its-change-touches.md
bumps:
  skills:
    plot: patch
-->
