---
'plot': patch
---

The board's continue-route test now waits for each worker pid it started to exit before it removes the desk, so a passing run no longer leaves a `plot-continue-*` directory in the run's TMPDIR (#1468).
