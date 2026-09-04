---
'plot': minor
'@plot-pm/board': minor
---

The registry queues a brief and hands it to a free agent. `plot-dispatch.sh` stops calling `git worktree add` on the fan-out path: it hands slice and brief to the registry and returns, cutting no desk, pushing no claim and starting no worker. A desk is one per agent rather than one per slice — measured 2026-09-02 on the Plot estate as 2 manifests against 11 worktrees, five of them on branches that had already merged — and the agent creates or resets its own, because it is the only party that can see its tree.

The brief gate keeps its rule and changes its position, from the launch to the hand-over. A slice with no brief is still refused and `--no-brief` still hands it over and says so, so the override stays on the record; what changed is what a refusal leaves behind, which is now nothing rather than a prepared desk nobody sat at. The refusal still names the ref the agent will read, not a bare path.

`matchQueue` is the assignment lock and there is only one. It hands a slice to one agent and never hands the same slice twice, held by the shape of the pass rather than by a check: a matched agent leaves the pool and each slice is visited once. It refuses nothing for want of a free agent — `0 free` holds every remaining slice and reports it, because making the hand-over synchronous with fleet capacity is the coupling `DESIGN-machine.md` §10 rejected twice. The queue is derived and stores nothing: an eligible slice with a brief and no claim *is* queued, so a daemon restarted mid-pass loses one pass's readings and no assignment.

`plot-worker-loop.sh` no longer calls `plot-fleet-scan.sh --offline --next`. The agent reads the branch the registry wrote into its manifest instead of shopping for one, so two agents racing for a branch stops being reachable rather than being caught by a rejected claim push — which is demoted to a backstop that should never fire and is still logged loudly when it does. The wait polls a file rather than a 12.7 s fleet scan, and the plan-slug scope goes with the ask: the registry reads every plan and sends the slug with the assignment.

The fan-out reads the eligible list once instead of pulling `--next` per branch, because nothing it does moves the scan's answer any more. Measured on the first run after the claim was removed: one branch handed over, the second never reached. The `Started:` record now checks for itself, since the claim used to be what made a re-dispatch skip a branch it had already booked.

<!--
bumps:
  skills:
    plot: minor
    plot-dispatch: minor
-->
