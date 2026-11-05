---
'plot': patch
---

The worker loop checks that the resolved prompt file exists before it launches on the `command` runner. An absent file ends the run after one line that names the file, with no start retries, and the `PLOT-BLOCKED` question names it.

<!--
bumps:
  skills:
    plot-fleet: patch
-->
