---
'plot': patch
---

The host port reads a partial `pr-list` as a partial answer rather than as a refusal, so a caller on the multi-state route keeps the rows the answering states returned. `plot-host.sh` exits 7 where several states are asked and some answer; the `Scripts` port learned to read that and the host port did not, mapping the code to a plain failure and discarding the rows with it. The refusal still reports which states went missing, so a caller gets the rows and the sentence rather than one or the other. The exit codes both adapters read are now named in one file, as numbers only — each adapter keeps its own reading of what a code obliges its callers to do, because a connector answers how long to wait and the generic port carries no such vocabulary.

<!--
plan: docs/plans/2026-09-20-one-exit-code-one-answer.md
bumps:
  skills:
    plot: patch
-->
