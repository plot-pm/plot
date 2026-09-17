---
'plot': patch
---

`plot-dispatch.sh --start` works from a plugin installation. It asked its rule by importing `rules/fleet-size.ts` and `entities/machine.ts` as `file://` sources, and an install carrying no `node_modules` cannot resolve the second: `machine.ts` opens with `import { z } from 'zod'`. Node 24 strips types, so the TypeScript was never the obstacle — measured 2026-09-17 against a copy with no `node_modules` on the resolution path, `fleet-size.ts` imported and `machine.ts` answered `Cannot find package 'zod'`. The answer now comes from `skills/plot/scripts/board/plot-fleet-size.mjs`, tracked beside the 24 bundles that already reach every install because a skill's own script directory is what a plugin ships; it carries both rules, since a bundle of `fleetSize` alone would import cleanly and still fail. The refusal also named two conditions that held — the reporter's node was 24.4.1 and their checkout was readable — so a missing bundle and a bundle that answered nothing are now separated and each names what to do. The count is unchanged: compared across 40 readings, both paths agree on the number, the headroom and the shortfall.

<!--
plan: docs/plans/2026-09-17-a-rule-reaches-the-install-that-runs-it.md
bumps:
  skills:
    plot-dispatch: patch
-->
