---
'plot': minor
---

A stated contract for shell-to-domain, and the first corpus comparison built to it. `docs/shell-and-domain.md` answers three questions: when a shell script calls the domain rather than duplicating it, where the call goes, and how a test holds a duplicate. The cost rule is a measurement — `node` starts in 34 ms and a shipped bundle answers in 39 ms, so a script running once per operator command calls the domain while one running once per agent per pass keeps its own implementation. `packages/domain/corpus/sprint-score.corpus.test.ts` compares `scoreItem` against `plot-sprint-release.sh`'s `item_state` over every MoSCoW item on the estate, and names both answers on a disagreement.

<!--
plan: docs/plans/2026-09-07-a-shell-script-asks-the-domain.md
bumps:
  skills:
    plot: patch
-->
