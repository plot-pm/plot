---
'plot': patch
---

A timed-out script's process group gets SIGTERM, and SIGKILL only after a 5-second grace, so `plot-tmp.sh`'s trap removes the temp paths a killed fleet scan registered.
