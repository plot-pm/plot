# One cap holds across boards

> Two boards on one repository each compute `parallelAgents − live` from their own reading, seconds apart, and both conclude they may start the whole budget. The cap is per-board where it is meant to be per-repository.

## Status

- **State:** Draft
- **Type:** bug
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- The parallel-agent cap holds across every board on one repository, so two boards cannot start twice the configured fleet between them.

<!-- Board impact: the Agents tab's cap control. The number it shows must
     continue to mean what it says once the budget is shared. -->

## Motivation

**Measured and filed as a W36 Must; unbuilt when that sprint closed 2026-09-11, and re-validated that day — no cross-board coordination exists.**

`auto-dispatch.ts:48` states the rule: the budget is the **DIFFERENCE**, `parallelAgents − live`, where `liveAgentCount` reads the agents this board can see. Each board computes it on its own pulse. Two boards a few seconds apart both read *0 live, budget 3* and each start 3 — six agents against a cap of three.

**The machine is the resource, not the board.** `DESIGN-machine.md` measures workers dying `exit 124` under load; a cap that doubles silently is how a machine reaches that state without anybody choosing it.

### Why two boards on one repository is a real shape

Not hypothetical: a second board is started by an operator wanting a view from another worktree, and `plot-boardctl.sh --status` exists partly to tell two boards apart — it reads `server.repo` because *"a machine running several"* is the case it was written for.

## What this is not

- **Not a change to the cap's value or its control.** `parallelAgents` stays what a person sets on the Agents tab; this changes who counts against it.
- **Not a lock on dispatch.** The registry's `matchQueue` already holds the one-slice-one-agent lock. This is about how many agents may EXIST, not which takes what.
- **Not cross-machine.** One repository on one machine. A fleet spanning machines is a different question with a different answer.

## Slices

### The live count is read from the registry, not from one board's agents (Branch: bug/one-cap-holds-across-boards)

**The registry is already the shared record.** `plot-registryd.mjs` re-reads the `Agent registry` directory every tick, and `readAgentRegistry` honours the configured path — so two boards on one repository read the same manifests. What each board currently does instead is count the agents in its **own** reading.

**So the fix is a source change, not a new mechanism**: `liveAgentCount` answers from the registry directory rather than from the board's `AgentEntry[]`.

**Done when:**

- Two boards started on one repository, seconds apart, together start no more than `parallelAgents`.
- One board alone is unchanged: the number it starts and the number it shows are what they are today.
- A board that cannot read the registry reports that it cannot, and starts **nothing** — an unreadable shared count must not read as *0 live, full budget*, which is the failure this plan exists to end.
- `liveAgentBranches` stays consistent with `liveAgentCount`; `auto-dispatch.ts:131` already requires it and the two must not diverge under a changed source.

## Notes

### The failure direction decides the unreadable case — 2026-09-11

**An unreadable registry must start nothing.** The tempting fallback is *count what I can see* — but that reproduces exactly the bug: a board that cannot read the shared record concludes it is alone and spends the whole budget.

**This is the same call `plot-pr-merged.sh` makes**: an unreachable host answers *not merged*, so silence is never permission.

### What makes this testable without two boards — 2026-09-11

The rule is a function of readings, not of processes: given a registry holding N live agents and a cap of M, the budget is `M − N` whoever is asking. Two boards is the *scenario*; one function with two callers is the *property*, and only the second needs a test.
