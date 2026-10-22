---
'plot': patch
---

`plot-host.sh`'s `headsha` helper reports a plain Jenkins job's build once: a build with two `lastBuiltRevision` actions naming the same branch no longer doubles its row in `runs`, `run-for-sha`, and `runs-for-sha`.

<!--
plan: docs/plans/2026-10-22-jenkins-runs-lists-every-build-twice.md
-->
