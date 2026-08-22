---
"@plot-pm/board": minor
---

plot: the registry knows which agents are alive

The agent registry now answers *is this agent still running?* — which nothing
did before. `plot-dispatch.sh` wrote one manifest per agent recording a **launch**
(session, branch, worktree, command, startedAt) and nothing updated it after the
spawn: no pid, no state. Measured 2026-08-22, the gap showed from three
directions at once — seven worktrees carrying a `.plot-worker.pid` with all seven
processes dead, seven registry manifests, and two agents actually alive. Three
numbers, none of them *agents alive now*.

Each manifest now carries the agent's **pid**, and each registry entry a
**state** the pulse refreshes. The pid is a launch fact stamped by the wrapper
the instant it learns its own child — the same value that lands in
`.plot-worker.pid`, written the same way and for the same reason (the wrapper is
the one process that knows the agent's pid). The state is decided on every pulse
by reusing `plot-worker-state.sh` — the fleet's single liveness definition,
sourced not reimplemented — so an entry whose process is gone reads `finished`
on the next scan **without anyone deleting the file**. That is the stale-manifest
cure: four entries outlived their processes because the record could not correct
itself.

**One derivation, three consumers.** The state lands on the registry entry
instead of being recomputed per caller, so the concurrency cap (wave 2), WORKING's
rows (a later plan) and the stale-manifest problem are all answered by one fact.
The count of live entries is one filter over the `agents` array — no per-entry
shell-out, because the cap will ask it every pulse.

The states are exactly the four `plot-worker-state.sh` distinguishes —
`running`, `finished`, `waiting`, `stalled` — carried onto the entry unchanged,
plus the registry's own honest `unknown` for what it cannot decide: an older
manifest with no pid, an agent between branches with no worktree to look in, or a
liveness check that could not run. **Absent is not a guess.** A pid of `0` or
junk reads as absent for the reasons the shell refuses them, and the wire schema
defaults `pid` to `""` and `state` to `unknown` so a client holding an open page
across a server upgrade still validates.

The registry reads liveness from local signals only — it passes an empty PR fact
to `plot_worker_state`, exactly as that function's contract permits — because the
registry must not be behind a host call that can fail: an agent invisible during
an outage is one that gets restarted into work it already holds.

Scope: this is wave 1 of *approval hands the work to agents*. It teaches the
registry to answer liveness and nothing more — it does not build the concurrency
stepper (wave 2) or the auto-dispatch switch (wave 3), and it does not change
WORKING's rendering.

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
