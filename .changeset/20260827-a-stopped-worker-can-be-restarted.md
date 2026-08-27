---
"plot": minor
---

`plot-dispatch.sh --restart <branch>` hands a branch whose worker has stopped to a new worker.

`--stop` killed a worker; nothing started one on a branch that already held a
claim. The dispatcher asks the scan for `--next`, and `--next` offers only
`open` branches — meaning **no ref exists at all**. A branch that has ever been
claimed is `claimed` or `wip`, so it was never offered and a dispatch answered
`dispatched=0`: not a refusal with a reason, an empty set, which has nothing to
say about what it filtered out. The operator's recourse was to run the worker
prompt by hand, which worked and produced a second defect — an unregistered
agent, so the board rendered a branch name in the agent-name slot.

The `open`-only rule is Plot's **lock** and does not move: three callers consume
`--next`, and widening it would let the board's auto-dispatch begin restarting
stalled work on a five-second timer with nobody deciding anything. This adds a
second question, asked only when a person asks it — so the branch is explicit
and never selected automatically, and `plot-dispatch.sh <slug>` still means
*start what nobody has started*.

**The PR is asked first, before the state word.** Measured across this estate,
five of five `failed` worktrees held a PR — four open, one already merged —
because `plot-worker-state.sh` refines `finished` by the tree and deliberately
does not refine `failed`, whose non-zero exit "is already a specific answer
about the process." True about the process, silent about the work: a worker that
opened its PR and then exited non-zero reads `failed` with nothing left to redo.
A gate written on the state word alone would have restarted all five and
discarded exactly what the `finished` refusal exists to protect. It is the same
lesson `plot-reap.sh` learned from the other side, where the state word lies
about merging and `mergedAt` is honest. A `failed` worker with **no** PR still
restarts — without that the verb cannot do the one thing it exists for.

It then refuses on a live worker (naming the pid) and on a `PLOT-BLOCKED` marker
(naming the file), and restarts `stalled`, `failed`, `ended` and `none` alike.
There is **no `--force`**: a flag overriding a liveness refusal is the flag typed
reflexively, and what it overrides is another agent's work.

The worktree is inherited exactly as it stands — a stall is uncommitted work by
definition, and a measured stall in this repo left 324 finished lines on the
floor, so a restart that reset would be worse than the missing affordance. The
worker starts through `start_worker`, the ordinary dispatch path, so the
manifest is written by one writer and the fleet can see what it started.

<!--
bumps:
  skills:
    plot-dispatch: minor
    plot: patch
-->
