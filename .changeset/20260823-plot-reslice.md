---
"plot": minor
---

Add `/plot-reslice`: a spoke command that slices a plan's multi-branch wave
into one wave per branch. It reads the entangled branches — their diffs, PRs
and conflicts — proposes one named wave each in an argued dependency order,
asks a person to confirm the order, then rewrites only the plan's
`## Branches` section, leaving the branch names and the rest of the file
untouched. A plan already one-branch-per-wave yields no proposal, a
`complete` wave is left alone, and unattended it stops with a `PLOT-UNASKED:`
line rather than writing the source of truth without confirmation.

<!--
bumps:
  skills:
    plot-reslice: minor
-->
