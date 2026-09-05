---
'@plot-pm/board': minor
---

The agent's lifecycle is a domain rule that refuses illegal transitions.
`transitions/agent.ts` carries the eight states' legal edges, transcribed from
`diagrams/agent-lifecycle.mmd`, with 39 tests and 30 refusal assertions. Its
`Decision` carries no write: `DESIGN-plan.md:810` splits stated state from
observed state, and nothing anywhere writes an `AgentState`.

`EndingActorSchema` loses `agent` and keeps two actors. The value was admitted
and documented as *"the agent stopped itself"* while no caller ever wrote it —
`plot-worker-loop.sh` makes three `write_ending` calls and passes `monitor` and
`bound` only. The reading taken is the one the loop's own comment states at
`:1284`: the agent's process runs `exit 124`, but the party that acted is the
watchdog that fired or the monitor that found it idle. `endingIsAttributable`
refuses an ending naming `agent`, reading a string rather than the type, because
an ending file on a desk is bytes until something validates them.

`STATE_SOURCE` records which component reads each of the eight, from
`DESIGN-agent.md:366`, and `observeAgentState` refuses a `source-mismatch`:
`waiting` and `stalled` are desk facts, so a caller reporting either from the
process table is refused rather than believed. Two further refusals come from
the spec — a manifest belongs to the Registry, and `elsewhere` means no worktree
on this machine, which is refused both for an agent with a desk here and for a
machine whose worktrees could not be listed at all.

<!--
bumps:
  skills:
    plot: patch
-->
