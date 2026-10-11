---
'plot': patch
---

`scripts/owned-run.sh` re-checks a leaked entry every 0.5 s for up to 10 s before it fails the run, and names each entry that cleared during the wait. `PLOT_OWNED_RUN_GRACE_S` sets the bound; 0 restores the immediate check.
