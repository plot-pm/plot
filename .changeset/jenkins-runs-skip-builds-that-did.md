---
'plot': patch
---

Jenkins: `runs <branch>` no longer lists `NOT_BUILT` or `ABORTED` builds — neither is a run of the branch's code, and a caller reading `runs` to see what actually ran no longer sees builds that did neither. `run-for-sha` and `runs-for-sha` are unaffected: a sha-bound lookup still reports a cancelled or not-built state for the exact sha asked.

<!--
plan: docs/plans/2026-10-20-a-sha-bound-run-reports-the.md
bumps:
  skills:
    plot: patch
-->
