---
'plot': minor
'@plot-pm/board': minor
---

An agent says when it is free: the worker loop clears `branch` when a slice finishes, and `free` — process alive AND manifest names no branch — becomes a domain rule the board asks.

**Why this exists**: `isFree` was written, exported and unit-tested by `a-dispatch-asks-for-a-free-agent`, and its empty-branch arm had no production caller that could ever satisfy it. `plot-worker-loop.sh` calls `seal_declaration` the moment a branch is done and `update_manifest_on_hop` only after `--next` answers and a worktree is built; between those two points the agent genuinely held no slice and the manifest still named the last one. Measured 2026-09-02: 2 manifests on this estate, neither ever carrying `branch: ""`.

**`branch` and only `branch` is cleared.** `worktree` still names the desk the agent is sitting at — it has not moved — and both the transcript join and the liveness check are keyed on that path. `wavesCount` counts hops and no hop has happened yet. The hop still rewrites `branch` and `worktree` together: clearing is added, not substituted.

**Availability is a second question**, and `DESIGN-agent.md:483` names the gap the eight process states leave. `running` is not busy — an agent between slices is running with no branch and is available, so a row says `running` and `free` at once and both are true. `finished` is not free: its worker exited. `waiting` is not free either — it is live and blocked on a person, so a merged slice does not release it.

`rules/free.ts` owns the derivation and takes readings as values, so it is asserted with no browser and no live process; `entities/agent.ts`'s `isFree` delegates rather than keeping a second copy. The board's `agentAvailability` asks it and renders `data-agent-availability`, sourcing `sliceHasMerged` from the joined row the pulse already published — never from a host call per agent.

**It is not derived from the tree, and there is no announced marker.** A clean desk says the agent left nothing behind, not that it has been handed the next brief, and under `an-agent-holds-one-desk` the desk outlives the slice. An agent that crashed between finishing and announcing would be free without saying so; `PLOT-BLOCKED` survives that objection only because a blocked agent is by definition still alive to write it.

<!--
bumps:
  skills:
    plot: minor
-->
