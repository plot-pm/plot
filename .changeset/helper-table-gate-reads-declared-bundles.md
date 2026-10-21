---
"plot": patch
---

`scripts/check-helper-table.sh` counts the `board/<name>.mjs` bundles that `packages/board/build.mjs` declares, as well as the tracked ones, so a PR that adds a bundle without a README row fails on the PR instead of on `main` after the build (#2235 and #2243, 2026-10-21). Both gates now read `build.mjs` through one parser, `scripts/lib-declared-bundles.sh`, and a `build.mjs` the gate cannot read fails it.

<!--
bumps:
  skills:
    plot: patch
-->
