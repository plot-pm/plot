---
'plot': patch
---

Ignore `.plot-worker.monitor.build.jsonl`, the third monitor log. The ignore list carried its two siblings and not this one, because the build monitor was added after the entry was written. A worker's own artifact then reported the desk as dirty, and `plot-reap.sh` refuses a dirty tree — measured 2026-09-02, one of 23 desks was held on this file alone.

<!--
bumps:
  plot: patch
-->
