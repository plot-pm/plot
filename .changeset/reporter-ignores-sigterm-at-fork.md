---
'plot': patch
---

The continuation reporter now starts with SIGTERM already ignored, so a group SIGTERM sent right after a continue or restart no longer ends it before it writes the WorkerMonitor finding (issue #3033).

<!--
bumps:
  skills:
    plot-dispatch: patch
-->
