---
'plot': patch
---

Section 6 of the reconcile scan exempts docs and infra plans again. The exemption is `case "$ptype" in docs|infra) continue`, and it stopped working when `sprint` was appended to the parsed row: the loop read EIGHT variables for NINE fields, so bash's last-variable-takes-the-rest rule handed `ptype` the value `docs<US>the-sprint-name`, which matches neither arm. Measured 2026-09-16 on this estate, two docs/infra plans were reported as `unreleased_delivered` and `/plot-release`'s step 5b gate is a hard stop on any non-zero, so a correct release could not be closed out. The other two readers of the same row were unaffected only because they discard the field rather than test it — all three now name the ninth variable, and a regression test pins the docs-plus-sprint case that the 136 existing tests did not cover.

<!--
bumps:
  skills:
    plot: patch
-->
