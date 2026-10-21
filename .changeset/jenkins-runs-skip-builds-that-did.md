---
'plot': patch
---

Jenkins: `runs <branch>` no longer lists `NOT_BUILT` or `ABORTED` builds — neither is a run of the branch's code, and a caller reading `runs` to see what actually ran no longer sees builds that did neither. `run-for-sha` and `runs-for-sha` now also drop `NOT_BUILT`: nothing ran, so a sha-bound lookup has nothing to report either. `ABORTED` stays in both: a cancellation of that exact sha did happen, so `run-for-sha` and `runs-for-sha` still report it.

<!--
plan: docs/plans/2026-10-21-jenkins-run-for-sha-can-answer.md
bumps:
  skills:
    plot: patch
-->
