---
'plot': patch
---

Adds `macos-shell-contract`, a CI job that runs a bounded subset of the shell gate tests on `macos-latest` with `bash` resolved to `/bin/bash` 3.2.57 — the version macOS ships. `scripts/check-bash32-syntax.sh` (added in the prior slice) is a static scan and can only catch one of the eight named bash-4+ constructs; this job catches a construct not on that list, or a run-time behaviour change with no syntax error, by actually running shipped shell under bash 3.2 rather than grepping for it.

<!--
plan: docs/plans/2026-10-25-ci-does-not-run-shipped-shell.md
bumps:
  skills: {}
-->
