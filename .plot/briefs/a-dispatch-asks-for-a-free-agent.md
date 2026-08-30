# Implementation brief — the-registry-owns-what-it-started (Asking)

- **Plan (canonical):** `docs/plans/2026-08-30-the-registry-owns-what-it-started.md` on main
- **Branch:** `feature/a-dispatch-asks-for-a-free-agent` (base: `main`)
- **Ends as:** one PR to main
- **Independent of the other two slices.** They touch the machine and the
  manifest; this one touches the agent count.

### What to build

`planAutoDispatch` reads `isFree` beside `liveAgentCount`, and its refusal
distinguishes *no slot* from *no free agent*.

**The function already exists** — `packages/domain/src/entities/agent.ts:120`,
six assertions in `agent.test.ts`, **zero production callers**:

```ts
export const isFree = (agent: Agent, sliceHasMerged: boolean): boolean => {
  if (agent.state !== 'running') return false;
  return agent.branch === '' || sliceHasMerged;
};
```

**The two call sites** are `auto-dispatch.ts:229` (`planAutoDispatch`, where the
budget is computed and the decision made) and `:527` (the same arithmetic, for
the log line that names what holds the slots). They must not diverge — the file
says so already about `liveAgentCount` and `liveAgentBranches`.

### The decisions the plan settles — do not re-derive them

**`isFree` does NOT replace `liveAgentCount`, and the code argues against
merging them for a measured reason:**

> *Measured 2026-08-25: eleven workers whose branches had merged sat at zero CPU
> for up to ten hours, none counted against the cap. The "liveness takes two
> facts" rule inverted the defect: it excluded landed agents and let the fleet
> grow unbounded.*

| question | answered by | what it protects |
|---|---|---|
| does this agent **consume a machine**? | `liveAgentCount` | the cap |
| can this agent **take a slice**? | `isFree` | dispatching to someone who can work |

A landed-branch agent is **occupied** and **free** at once. This slice adds a
reader and changes **no arithmetic**.

**`waiting` is not free.** It is live and blocked on a person: it holds a slot
and can take nothing. `isFree` already encodes that; do not "improve" it.

### Done when

The plan's list, and one of them is a trap worth naming:

- a fleet at the cap whose agents are all between units **dispatches**
- a fleet at the cap whose agents all hold unmerged branches **still refuses**
- **`liveAgentCount`'s arithmetic is unchanged**, asserted by its existing tests
  passing **unedited**
- the refusal names **which** of the two it is

**The regression to lock:** an agent whose branch merged still counts toward the
cap (`bug/a-landed-branch-still-holds-a-slot`, 2026-08-25). Write a test that
fails if this slice re-inverts it — that is the one defect this change could
plausibly reintroduce.

**`sliceHasMerged` is the input you have to source.** `isFree` takes it as an
argument rather than reading it, so the caller decides where it comes from. The
pulse knows which branches merged; use that rather than asking the host again.

Plus: `pnpm test:board`, `pnpm run typecheck`, artifact rebuilt, changeset
(`'@plot-pm/board': patch`).

### Scope guard

The agent question only. Not the machine (`feature/a-dispatch-asks-the-machine`),
not the manifest (`feature/a-manifest-names-every-process`), not the cap's
arithmetic.

If wiring `isFree` reveals that the pulse cannot answer `sliceHasMerged`
cheaply, report it — that is a finding about the payload, not licence to ask the
host per agent.
