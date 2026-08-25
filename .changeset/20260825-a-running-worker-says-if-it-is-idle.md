---
'@plot-pm/board': patch
---

A running worker's row says whether its child is idle

`running` is honest and coarse. Measured across the fleet 2026-08-25 it covered a
worker mid-thought, a worker between waves, and a worker whose child had crashed
hours earlier while the loop waited on it — and 11 of 13 workers were in that
last, worst case. The word is true and tells a reader nothing about which.

A running worker's row now carries a **secondary cue** saying which kind of
running it is — a child doing work reads `working`, a child whose CPU clock is
frozen reads `idle`. `plot-worker-state.sh` gains `plot_worker_activity`: it
samples the worker's whole descendant CPU twice and reports the growth. The
discriminator is the CHILD's CPU, not the shell's — the loop shell waits on its
child and burns near-zero CPU in every case, so an implementation reading the
shell's own CPU distinguishes nothing. The fleet scan emits `worker_activity`
beside `worker`, only where `worker` is `running`; the board forwards it onto the
row and `workerStatus` renders it.

It is a **cue, not a sixth state**. `AgentStateSchema` stays five members, its
size pinned by a test, and `isLiveState`/`isBrokenState` are untouched — an idle
worker with a live child still *is* running, and `idle` is an attribute of
`running` carried in its own `WorkerActivitySchema`, never a peer state. This
does not kill anything; ending a hung worker is a separate plan.
