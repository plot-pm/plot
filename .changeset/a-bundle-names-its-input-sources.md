---
'@plot-pm/board': patch
---

The test selection reads which source files each shipped bundle holds. `pnpm build:board` writes `packages/board/dist/bundle-inputs.json` from esbuild's metafile, and a changed path now selects the tests naming every bundle that holds it, not only the bundle whose entry it is: a change to `packages/domain/src/workflows/approve.ts` selects the tests naming `plot-approve.mjs`. Where the map is missing or unparseable, `plot-local-checks.mjs` selects by the bundle entry sources as before and prints a `# bundle inputs:` line naming that fallback first; with `--ci` the line goes to stderr.

<!--
plan: docs/plans/2026-11-27-a-launcher-change-selects-its-tests.md
bumps:
  skills:
    plot: patch
-->
