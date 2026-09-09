---
'plot': minor
---

A commit that changes a `State:` line in a plan or sprint file is refused unless the script that owns that write made it. `plot-state-gate.sh` is a PreToolUse hook beside `plot-phase-gate.sh`: it reads the diff, so a plan or sprint created from a template passes and an unchanged value passes, while a changed one needs a receipt that only `plot-approve.sh`, `plot-deliver.sh` or `plot-sprint-state.sh` can leave. Measured 2026-09-08, three lifecycle states were written by hand in one afternoon and every refusal in the estate stayed silent, because an editor on a markdown line invokes nothing. The three writes no script owns — `/plot-approve` under `Review: in-session` or `ballot`, `/plot-release`, `/plot-reject` — declare themselves through a named escape that records the routing gap.

<!--
plan: docs/plans/2026-09-08-the-master-agent-uses-the-controllers.md
bumps:
  skills:
    plot: minor
    plot-approve: patch
    plot-release: patch
    plot-reject: patch
-->
