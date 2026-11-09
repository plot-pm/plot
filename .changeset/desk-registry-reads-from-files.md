---
'@plot-pm/board': patch
---

The agent registry reads each desk's state with the TypeScript desk reader over one process-table read per batch, and its cleanliness with `deskClean` over `git status` and the upstream count, instead of two inline `bash` programs. A reader failure that leaves the batch `unknown` logs its reason. `/plot-fleet --status` prints the board's state of each desk beside the shell's, and marks a desk where the two disagree with `(differs)`.

<!--
plan: docs/plans/2026-11-09-desk-probes-in-domain.md
bumps:
  skills:
    plot: patch
    plot-fleet: patch
-->
