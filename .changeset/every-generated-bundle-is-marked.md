---
'plot': patch
---

Every bundle `pnpm build:board` emits is marked `-merge` in `.gitattributes`, and `scripts/check-bundle-attributes.sh` derives that set from `build.mjs` so it cannot go stale. Measured 2026-09-05 on one rebase: the one marked file took 0 conflict markers, `plot-ask.mjs` took 5 and `plot-registryd.mjs` took 3 — spliced into generated output that is committable, pushable, and not JavaScript. `plot-monitor.mjs` stays unmarked: nothing rebuilds it, and the rebuild is the licence.

<!--
bumps:
  skills:
    plot: patch
-->
