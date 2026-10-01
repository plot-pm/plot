---
'plot': patch
---

The board suite's browser tests run inside the private temp root. `scripts/owned-run.sh` points `PLAYWRIGHT_BROWSERS_PATH` at the caller's browser cache unless the caller set it, so the private `HOME` no longer hides Playwright's browsers, and CI's board job runs both of its test steps through the wrapper.

<!--
plan: docs/plans/2026-10-01-every-file-plot-writes-declares-its-bound.md
bumps:
  skills:
    plot: patch
-->
