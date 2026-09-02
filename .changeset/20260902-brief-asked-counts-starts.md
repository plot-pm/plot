---
"plot": patch
---

`plot-dispatch.sh` says what `brief_asked=N` measures. The `Brief command` is detached and never waited on, so the count records commands started, never briefs written. Measured 2026-09-02, first real use: a command that could not reach `/plot-implement` wrote a 33-byte log and the summary still reported `brief_asked=1`. The per-branch line now reads `started, not awaited` and names the log as the evidence.

<!--
bumps:
  skills:
    plot: patch
-->
