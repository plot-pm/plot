---
'plot': patch
'@plot-pm/board': patch
---

An unattended agent at a fleet desk that starts a suite the `CI suites` config key leaves to CI is refused by `plot-controller-gate.sh`, with the `plot-local-checks.mjs` command to run instead. Measured 2026-10-02 on this repository: with 16 cores and 7-8 agents the load stayed at 55-148, and six of seven agents were inside full local suites CI runs again on every pull request. The rule `ciSuiteRefusal` matches only where a command runs, after `&&`, `;` or `|` and after `NAME=value` and `env` prefixes, with quoted text removed, so a `grep`, a commit message or a PR body that mentions a suite passes. The arm sits before the gate's early exits and decides only in a linked worktree holding `.plot-worker.pid` with `PLOT_UNATTENDED=1`; a person at a terminal is never refused. The bundle answers it as `plot-local-checks.mjs --ci-suite-refusal`.

<!--
plan: docs/plans/2026-10-02-an-agent-runs-the-tests-its-change-touches.md
bumps:
  skills:
    plot: patch
-->
