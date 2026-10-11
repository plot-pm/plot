---
'plot': patch
---

`scripts/check-decision-count.sh` reads a bundle declaration from one `esbuild.build({ … })` call. The parser opens a block on that line, reads `entryPoints:` and `outfile:` only inside it, and clears both when the block closes, so a first call's entry never pairs with a later call's outfile and a matching line in a template literal or comment is ignored. A bundle counts as declared only when `build.mjs` also passes its dist const and shipped const to one `fs.copyFileSync` call.

<!--
plan: docs/plans/2026-10-10-the-tests-and-gates-close-their-review-findings.md
bumps:
  skills:
    plot: patch
-->
