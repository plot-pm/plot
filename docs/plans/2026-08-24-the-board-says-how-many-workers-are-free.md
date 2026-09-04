# The board says how many workers are free

> The stepper states a cap of 12 and never its balance. Worse, the count behind it called five finished agents busy, so the fleet declined to dispatch work it had room for.

## Status

- **Phase:** Released
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-24, Jan Wloka, in-session
- **Started:** 2026-08-24, Jan Wloka, `bug/the-board-says-how-many-workers-are-free`
- **Delivered:** 2026-08-24
- **Released:** 2026-08-26, 2.9.0

## Approval

- **Assignee:** Jan Wloka

## Changelog

- The Agents tab states how many of its parallel-agent slots are in use, and the count no longer treats a finished worker's lingering process as occupied capacity.

<!-- Board impact: adds an optional `working` to `fleetControls` in the payload
     contract, changes `liveAgentCount`, and renders one element beside the
     stepper. Rebuild the artifact. Also untracks `.plot/agents/`. -->

## Motivation

Asked from the running board: *why is the board not showing available workers?*

It never did. The stepper renders `parallelAgents` — the cap — and no component
computes or displays the balance. A reader deciding whether to start something
had to count rows.

That is the small half. Measured while answering it:

```
64 manifests in .plot/agents/
  48  dead pid
   9  no pid at all
   7  pid alive
```

and of those seven, **five sat on branches whose PRs had merged hours earlier**
(#360, #361, #362, #364, #367) — `claude` processes that outlived their work.

```
liveAgentCount(agents)  ->  7   of 12 slots reported busy
genuinely working       ->  3
```

**So the fleet believed it had 5 slots occupied by nothing**, and `planAutoDispatch`
measures the cap against exactly this number. It declined to dispatch work it had
room for, silently, with no signal a reader could see — because the number was
not rendered anywhere either.

### Why the existing rule could not see it

`liveAgentCount` was already careful, and its docstring is right about what it
excludes:

> `finished`, `stalled` and `unknown` do NOT occupy a slot … `unknown` is not a
> claim of liveness.

The gap is not in what it rejects; it is that **a live process was treated as
sufficient**. `plot-worker-state.sh` supplies the state and answers about the
PROCESS — "six PROCESS states", in its own words — and has no view of whether
the branch landed. Asked *is a worker running in this worktree?*, it answered
correctly every time. Nobody asked the second question.

### What is NOT the cause

**Not registry staleness**, though 48 of 64 manifests were dead. Stale entries
read `unknown` or `finished`, both already excluded. Reaping them is hygiene
(see below) and would not have changed the count by one.

**Not `the-registry-names-a-live-agent`** (delivered this sprint), which fixed a
dead pid *displayed beside* `running`. These five pids are alive. That plan
made liveness truthful about the process; this one is about the process being
the wrong question on its own.

## Design

### Liveness takes two facts

An agent occupies a slot when its process is live **and** its branch has not
landed:

```ts
export function liveAgentCount(agents: AgentEntry[], pulse?: FleetPulse): number {
  const landed = pulse ? landedBranches(pulse) : new Set<string>();
  return agents.filter((a) => LIVE_STATES.has(a.state) && !(a.branch && landed.has(a.branch))).length;
}
```

**The join belongs in the board**, not in `plot-worker-state.sh`. That script is
the ONE answer to a process question and is shared by the dispatcher and the
scan; teaching it about pull requests would give it a host dependency and a
second subject. The board already holds both facts in one place.

### It may only ever REMOVE from the count

A branch the pulse does not mention stays counted. Absent is not evidence: a
scan that could not see a plan must err toward the cap rather than through it,
because over-counting slows the fleet while under-counting exceeds a limit the
operator set.

`pulse` is optional so every existing caller keeps its answer, and the
no-pulse path is asserted unchanged.

### The server publishes the number; the client does not re-derive it

`fleetControls` gains an optional `working`. `auto-dispatch.ts` is server-only,
so the renderer cannot import `liveAgentCount` — and a second implementation is
how a control comes to disagree with the rule it describes. A reader acting on
`9 free` that the dispatcher does not honour is worse served than one shown
nothing.

**Optional, and absent is not zero.** A payload from a server predating the
field, or a pulse that could not read the registry, renders nothing. `0 working`
reads as an idle fleet, which is the one claim such a pulse cannot make. The
client CASTS this payload rather than parsing it, so a Zod `.default` would
never fire — the field is emitted explicitly or not at all.

### The registry is machine-local and stops being committed

`.gitignore` ignores `.plot/state/` as machine-local, with the reason stated:
*"A checked-in pulse would be one clone telling another what its branches are
doing."* A manifest holds a `pid` and an ABSOLUTE `worktree` path — the same
category, and 54 were on main, one per agent ever dispatched here.

`.plot/agents/` joins it. **The registry keeps working**: the board reads the
directory, never git, so untracking changes what is shared, not what is
recorded.

This is bundled rather than split off because the reap that exposed it deleted
48 tracked files — leaving that uncommitted would have been the alternative, and
it is one commit of the same evening's work.

### Not chosen: reap dead manifests on every pulse

Tempting, and rejected: a write on the read path, deleting files on an inference
about a pid the board does not own. The count no longer depends on registry
hygiene, so the write buys nothing the fix does not already give.

### Open Questions

- [ ] Should `working` also count the in-flight set — branches dispatched this
      pulse but not yet in the registry? `planAutoDispatch` already adds it to
      the denominator, so the rendered number can lag the dispatcher's by one
      for a few seconds. Probably yes; decide from whether a reader notices.

## Done when

- **A live agent on a merged branch does not occupy a slot.** This is the
  defect; assert it directly with a pulse where one agent's branch is `merged`.
- **A live agent the pulse does not mention still occupies one** — the direction
  guard. Without it an implementation that drops every unmatched branch reports
  an empty fleet during a partial scan.
- **`liveAgentCount(agents)` with no pulse is unchanged**, so every existing
  caller keeps its answer.
- The board **renders** the count beside the stepper, and renders **nothing**
  when `working` is absent. Asserted as absence, not as `0`.
- The rendered number equals the dispatcher's: one derivation, published, never
  recomputed in the client.
- `.plot/agents/` is untracked and ignored, and the board still reads the
  registry from disk.
- `pnpm run test:board` green; artifact rebuilt and committed.

## Slices


### Counted (Branch: bug/the-board-says-how-many-workers-are-free, PR: #375)
- liveness takes two facts, the server publishes `working`, the stepper renders it, and the registry stops being committed

## Notes

Found by an operator asking why the board did not show available workers. The
answer was that it never had — and looking for where to put the number found
that the number would have been wrong.

The shape is one this repo keeps meeting: a predicate that was correct about its
own subject, consulted for a question one step wider than it answers.
`plot-worker-state.sh` answers about processes and says so plainly; the defect
was reading its answer as though it were about capacity. Same evening, same
shape as `a-resurrected-ref-does-not-hide-a-merge`, where a docstring reasoned
correctly from a premise about refs that a resurrected ref falsified.
