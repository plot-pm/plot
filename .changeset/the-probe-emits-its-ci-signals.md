---
'plot': patch
---

`plot-detect-repo.sh` emits `ci_signals`, so adoption proposes a `CI:` key from what a repository shows. The field is `ci_signals` and not `ci_system`: `stack-readings.ts` has always read the former, while the skill's docs named the latter in six places and the probe emitted neither, so every consumer was complete and the answer was `null`.

<!--
plan: docs/sprints/2026-W39-the-jenkins-team-sees-its-builds.md
bumps:
  skills:
    plot-init: patch
-->
