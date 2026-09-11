# One cap holds across boards

> Two boards on one repository each compute `parallelAgents − live` from their own reading, seconds apart, and both conclude they may start the whole budget. The cap is per-board where it is meant to be per-repository.

## Status

- **State:** Approved
- **Type:** bug
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-11, Jan Wloka, plan-PR #887 merged
- **Started:** 2026-09-11, Jan Wloka, `bug/one-cap-holds-across-boards`

## Changelog

- The parallel-agent cap holds across every board on one repository, so two boards cannot start twice the configured fleet between them.

<!-- Board impact: the Agents tab's cap control. The number it shows must
     continue to mean what it says once the budget is shared. -->

## Motivation

**Measured and filed as a W36 Must; unbuilt when that sprint closed 2026-09-11, and re-validated that day — no cross-board coordination exists.**

**The first draft of this plan misdiagnosed it, and reading the code is what corrected it.** It said each board counts its own agents. It does not: `fleet.ts:2691` sets `entry.agents = readAgentRegistryWithInfo(...)`, so the live count already comes from the **shared registry** both boards read. That half is correct today.

**The gap is the window between dispatching and being visible.** `plot-dispatch.sh` is spawned detached, so a branch dispatched on one pulse shows neither manifest nor claim ref on the next. `auto-dispatch.ts:304` names the consequence exactly — *"counting only the registry would dispatch it a second time and reach 2N"* — and covers it with `autoInFlight`.

**`autoInFlight` is per-board and in memory.** Nothing writes it to disk and nothing shares it. One board's in-flight set is invisible to the other, so the guard that prevents 2N on a single board prevents nothing between two.

**The machine is the resource, not the board.** `DESIGN-machine.md` measures workers dying `exit 124` under load; a cap that doubles silently is how a machine reaches that state without anybody choosing it.

### Why two boards on one repository is a real shape

Not hypothetical: a second board is started by an operator wanting a view from another worktree, and `plot-boardctl.sh --status` exists partly to tell two boards apart — it reads `server.repo` because *"a machine running several"* is the case it was written for.

## What this is not

- **Not a change to the cap's value or its control.** `parallelAgents` stays what a person sets on the Agents tab; this changes who counts against it.
- **Not a lock on dispatch.** The registry's `matchQueue` already holds the one-slice-one-agent lock. This is about how many agents may EXIST, not which takes what.
- **Not cross-machine.** One repository on one machine. A fleet spanning machines is a different question with a different answer.

## Slices

### The dispatch-to-visible window is observable across boards (Branch: bug/one-cap-holds-across-boards)

**The shared record exists and the private one is the problem.** Whatever closes this must make a just-dispatched branch visible to a board that did not dispatch it, before that board's next pulse decides.

**THE OBVIOUS MECHANISM WAS DELETED ON PURPOSE, AND THIS PLAN MUST NOT PROPOSE IT BACK.** A claim ref pushed at dispatch would do exactly this — and `plot-dispatch.sh:2572` records that the hand-over *stopped* pushing one when dispatch became a hand-over to the registry. The same passage measures what that cost: *"two runs left two identical `Started:` records in one plan."* Re-adding a claim push is reversing a settled design decision, and this slice may not do it as a side effect of fixing a different bug.

**So the mechanism is the open question, and it is stated as one** rather than guessed:

| candidate | what it costs |
|---|---|
| persist in-flight marks under `.plot/state/` | new state that must expire; a crashed board holds budget forever |
| a lock around the dispatch decision | a lock nothing else in Plot uses, and a stale-lock problem on crash |
| make the registry entry appear synchronously | changes what `plot-dispatch.sh` guarantees on return, which is the hand-over's contract |

**Done when:**

- Two boards started on one repository, seconds apart, together start no more than `parallelAgents`.
- One board alone is unchanged: the number it starts and the number it shows are what they are today.
- Whatever carries the in-flight fact **expires**. A board that dies mid-dispatch must not hold budget indefinitely — the failure this trades into if the state outlives its owner.
- No claim ref is re-introduced at dispatch. If the chosen mechanism looks like one, that is a signal to re-open `the-registry-queues-a-brief` rather than to proceed here.
- `liveAgentBranches` stays consistent with `liveAgentCount`; `auto-dispatch.ts:131` already requires it.

## Notes

### The failure direction decides the unreadable case — 2026-09-11

**An unreadable registry must start nothing.** The tempting fallback is *count what I can see* — but that reproduces exactly the bug: a board that cannot read the shared record concludes it is alone and spends the whole budget.

**This is the same call `plot-pr-merged.sh` makes**: an unreachable host answers *not merged*, so silence is never permission.

### What makes this testable without two boards — 2026-09-11

The registry half is already a function of readings: given N live agents and a cap of M, the budget is `M − N` whoever asks. That part needs no two-board test and already has none failing.

**The in-flight half is genuinely about time**, not readings — *was this branch dispatched by anyone, recently enough that no ref yet shows it?* — so its test has to simulate two deciders against one shared state, whatever that state turns out to be. That is the harder test and the reason the mechanism is an open question rather than a choice made in advance.

## Open Questions

- [ ] [Technical] Which mechanism carries the in-flight fact between boards — persisted marks, a lock, or a synchronous registry entry? — *deferred: decide during implementation against a real two-board run*
