---
'plot': minor
---

A plan file's `- **Phase:**` field is now `- **State:**`, in 226 plan files, 9 sprint files and the three templates. A plan has a state; the development workflow has phases; the file now says which one it holds. The parser reads `State:` and `Phase:` alike, permanently — a plan file may have been written a year ago or copied from another project, and a Plot that refused to read the old spelling would be worse at its own job than the one that confused two words. `State:` is primary and `Phase:` the alternate, the shape front matter already uses for `status:` over `phase:`, so a file carrying both reports the disagreement through `phase_alt` rather than hiding it. The wire key stays `phase`: it is not this field, and every board reader and every gate reads it. The rename reuses `withPhase`'s `## Status` scoping rather than a blanket sed — 27 plan files mention `Phase:` more than once, one of them six times — and adds the parser's fence rule on top, which `withPhase` does not carry and which one file needed. Asserted over the whole plan directory: 229 files parse byte-for-byte identically before and after.

<!--
plan: docs/plans/2026-09-04-the-workflow-owns-the-word-phase.md
bumps:
  skills:
    plot: minor
    plot-approve: patch
    plot-deliver: patch
    plot-idea: patch
    plot-reconcile: patch
    plot-reject: patch
    plot-release: patch
    plot-sprint: patch
    plot-board-setup: patch
    challenge-the-plan: patch
    ralph-plot-sprint: patch
-->
