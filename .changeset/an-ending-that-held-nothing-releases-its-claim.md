---
'@plot-pm/board': patch
---

A desk whose turn pushed only its claim commit, opened no PR and left no marker now seals `nothing-done` with no seal write (#1274), and a take-up ending that names `holding-work` now names the desk's own branch rather than the slice just handed over (#1281). The registry daemon reads a new domain rule, `endingAction`, each tick: a clean `nothing-done` ending with no commit beyond the claim and no open PR releases the claim through `gatherReadingsAndRelease` — the same decide-then-release sequence the board's own release route uses — and every other reading, including a manifest-named desk or an unreadable one, is left alone.

<!--
plan: docs/plans/2026-10-07-every-loop-ending-has-a-supervisor-rule.md
bumps:
  skills:
    plot: patch
-->
