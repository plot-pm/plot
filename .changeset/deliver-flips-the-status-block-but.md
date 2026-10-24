---
"plot": patch
---

A plan carrying both front matter (`status:`/`phase:`) and a `## Status` block now has both flipped together on delivery, approval, and undeliver — `/plot-deliver` previously flipped only the block, reported `phase=flipped`, and left the front matter at its old value, which `plot-reconcile-scan.sh` then read as a disagreement between the two fields. `flipFrontMatterPhase` in `@plot-pm/domain`'s `plan-record-edit.ts` mirrors `frontMatterPhaseOf`'s own read order (first `status:` or `phase:` line inside the leading `---` fence, first occurrence of each key, nothing past the closing fence), so the writer changes exactly what the parser would read back. A plan in only one format is untouched, matching "absent is not false".

<!--
plan: docs/plans/2026-10-24-deliver-flips-the-status-block-but.md
bumps:
  skills:
    plot: patch
-->
