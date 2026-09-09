---
'plot': minor
'@plot-pm/board': patch
---

Calling a lifecycle script directly is refused. `plot-controller-gate.sh` is a `PreToolUse` hook over `plot-dispatch.sh`, `plot-approve.sh` and `plot-deliver.sh` — the three measured being called past their controllers on 2026-09-09, five times in one session by the agent that had read the rule, with the board answering on `:7777`. It clears only on a receipt the controller leaves before it spawns, so routing an action past the controller stops at the tool call rather than being noticed later, or never. The desk is the exemption and it is a MEASUREMENT: a call from a linked worktree is a dispatched worker's, read from git rather than from `PLOT_WORKER=1`, because an env var is something an agent sets and this gate exists because an agent's own assertions cannot be trusted. The receipt is spent on the action COMPLETING rather than on the gate clearing, so a retry after a failed run is allowed on the same licence — `plot-approve.sh` and `plot-deliver.sh` document re-running as the repair for an interruption, and a receipt spent at the gate would refuse that fix in the case it is most needed. Only the fan-out is gated: `--status` and `--dry-run` read, while `--stop`, `--restart`, `--start` and `--migrate` have no endpoint, and a refusal that names no route is the shape people turn off — which is also why `gh` and `git` are left out. It fails open with no `.plot/state/` and says the routing went unverified; the escape requires a reason and counts it to `.plot/state/unowned-action-writes.tsv`. `plot-worker-loop.sh` names `/plot-fleet --stop` and `/plot-dispatch --restart` where it printed the script, because a tool that advertises a path its own gate refuses is worse than either alone.

<!--
plan: docs/plans/2026-09-09-a-lifecycle-action-needs-a-controller-receipt.md
bumps:
  skills:
    plot: minor
-->
