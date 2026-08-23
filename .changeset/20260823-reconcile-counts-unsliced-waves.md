---
"plot": minor
---

`plot-reconcile-scan.sh` gains a section reporting unsliced waves: every `### `
wave heading that carries more than one branch line, named with its plan file,
its heading and its branch count, plus a machine-countable `unsliced_waves=`
footer entry the way each existing section has one. A wave holds exactly one
branch (MANIFESTO.md); one holding several is a shape `/plot-reslice` can
repair, so each finding prints `reslice: /plot-reslice <slug>`.

It REPORTS and repairs nothing — the Principle 3 split: this collects,
`/plot-reslice` and a person conclude. The section is deliberately non-blocking:
it is placed as section 7 (index drift renumbered to 8) and kept out of the
`attention=` count that gates `/plot-deliver` and the `/plot` hygiene line,
because an unsliced wave is a shape to fix, not a branch that cannot move.
Branch counts come from `plot-plan-meta.sh`'s `waves[]` — never a second parser —
so a backticked branch name in a plan's prose is not counted; a phase-less file
is skipped (it is not a plan); and a `complete` wave is history that still
counts, since hiding it would misreport the estate.

The `/plot-deliver` delivery-landed gate is unaffected: its stop marker
(`sed -n '/^== 7./q;p'`) already excludes the two non-blocking sections at 7
and 8, so it needs no change; only its prose is updated to name the new section.

<!--
bumps:
  skills:
    plot: minor
    plot-deliver: patch
-->
