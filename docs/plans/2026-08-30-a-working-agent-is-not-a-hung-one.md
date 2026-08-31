# A working agent is not a hung one

> The loop ends an agent that stopped working, not one that has been working an hour.

## Status

- **Phase:** Delivered
- **Type:** bug
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-30, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** 2026-08-31
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-30, Jan Wloka, `bug/the-loop-reads-the-monitor`
- **Started:** 2026-08-31, Jan Wloka, `bug/a-long-agent-reaches-its-second-slice`

## Approval

- **Assignee:** Jan Wloka

## Changelog

`Worker bound` stops being a wall-clock timer. A worker ends when its agent has
stopped making progress — the reading the WorkerMonitor already takes — so a
long-running agent can hop to the next slice instead of being killed mid-run.

## Motivation

### Measured 2026-08-30: seven workers killed, none of them hung

Every worker that exited 124 that day had committed work:

```
bug/a-monitor-ends-with-its-agent               4 commits
feature/every-worker-is-born-monitored          4 commits
feature/fleet-settings-is-not-fleet-control     3 commits
feature/the-ports-have-adapters                 6 commits
feature/the-worker-monitor-samples-the-process  6 commits
infra/one-place-decides-where-a-log-lives       4 commits
infra/one-rule-decides-what-is-reapable         6 commits
```

**Not one was hung.** The bound fired on seven agents that were working.

### What it costs, per worker

The bound kills the agent mid-run, and what a run does last is bookkeeping. Five
of those seven lost a *different* final step, each recovered by hand:

| worker | work done | step lost |
|---|---|---|
| monitor slice | 783 lines | the PR |
| log resolving | 375 lines | the PR |
| worker monitor | 1153 lines | the PR **and** its changeset |
| reap rule | 513 lines | changeset **and** the artifact rebuild |
| fleet settings | 57 lines | the changeset |

**The work was finished every time.** What the bound takes is the last five
minutes — open the PR, write the changeset, rebuild the artifact — because those
sit at the end of a brief. Nothing reported the loss; each was found by reading
worktrees by hand.

### And it kills the feature it was never meant to touch

`plot-worker-loop.sh` is already a long-running agent. It loops (`:248`), asks
`--next` for the following slice (`:260`), and rewrites its manifest to hop
(`update_manifest_on_hop`, `:284`).

**No worker hopped on 2026-08-30**, because every one died at the bound first.
The loop's own message names it:

```
plot-worker-loop: prompt exceeded the 3600s bound on <branch> — ending worker without hopping
```

**An agent that takes more than an hour on its first slice can never reach its
second.** The hop exists and is unreachable.

### The bound was right about the risk and wrong about the measurement

It came from [`a-hung-child-does-not-hold-the-loop`](2026-08-25-a-hung-child-does-not-hold-the-loop.md),
against a real failure: *"a hung agent has left the worktree in a state nobody
measured"*, so the loop must not wait forever. **That risk is real and this plan
does not dispute it.**

What it disputes is the reading. **Wall-clock time cannot tell working from
hung** — it measures how long, never whether anything happened. On 2026-08-30 it
answered *hung* seven times and was wrong seven times.

## Design

### The measurement already exists, and it shipped today

`plot-worker-monitor.sh` (PR #538, merged 2026-08-30) answers exactly the
question the bound is guessing at. Its `idle` finding requires **four**
conditions together:

- the pid is alive
- its subtree burned **no CPU** across two consecutive samples
- the **tree did not change** between them
- commits **already exist** on the branch

**The extra conditions are not caution.** A worker waiting on a long model
response has the same zero CPU delta as one whose agent has vanished; what
separated the three stalls measured on 2026-08-30 is that each had already
committed and then gone quiet.

**So the bound has a replacement that is already written, already tested, and
already attached to every dispatched worker** — the Attaching slice starts both
monitors inside the wrapper, before the agent.

### What replaces the timer

**End the worker when the WorkerMonitor reports `idle`**, not after N seconds.
A worker that is committing, or burning CPU, or changing its tree, keeps
running — however long that takes — and hops to its next slice when it finishes.

**The safety property is preserved and strengthened.** The old rule ended a hung
agent after an hour; the new one ends it after two idle samples, which is
faster. What changes is that a *working* agent is no longer ended at all.

### Not chosen: raise the bound

A larger number moves the failure rather than removing it. It also has no
principled value: 3600 was not measured against anything, and neither would
7200 be. The defect is the unit, not the size.

### Not chosen: delete the bound and rely on the monitor alone

**A monitor can die** — that is the whole subject of its own plan, which has one
unexplained termination path recorded and a leak that ran 152 orphans on this
machine. Removing the last resort while its replacement's lifetime is still
being settled trades a wrong answer for no answer.

**So the timer stays as a floor and stops being the verdict.** A very large
bound — a working day rather than an hour — catches an agent whose monitor also
failed, and the monitor catches everything else long before it.

### What this unblocks in `the-registry-owns-what-it-started`

**Its `Asking` slice wires `isFree` into the dispatcher**, and `isFree`'s first
condition is a state this repo has never produced:

```ts
export const isFree = (agent: Agent, sliceHasMerged: boolean): boolean => {
  if (agent.state !== 'running') return false;
  return agent.branch === '' || sliceHasMerged;
};
```

**`branch === ''` means an agent between units** — one that finished a slice and
is asking `--next`. Two things keep it from ever being observed today: no worker
has hopped (the bound kills them first), and `update_manifest_on_hop` sets
`manifest.branch` straight to the next branch rather than clearing it, so even a
hop would not pass through the empty state.

**So that slice would ship a condition covering a case that cannot arise.** It
is not wrong — `sliceHasMerged` carries the other half and is reachable — but
half of `isFree` is unexercised until an agent can actually live between units.

**Neither plan blocks the other.** This one makes the state reachable; that one
gives it a reader. Landing either alone is useful, and landing this one first
means the registry's assertion has something real to assert against.

### Open: what a hop does to the bound

If a worker hops, does its clock reset? Under this design the question mostly
dissolves — the monitor measures the agent, not the run — but the residual timer
needs an answer, and *per hop* and *per worker* are both defensible.

## Slices

### Reading (Branch: bug/the-loop-reads-the-monitor)

The loop ends the prompt on the WorkerMonitor's `idle` finding rather than on a
wall-clock alarm.

**Done when** an agent that commits every few minutes for over an hour is
**never** ended; an agent whose subtree goes quiet with commits on the branch is
ended within two monitor intervals; an agent that has committed **nothing** is
not ended, however quiet — that is the middle row of the monitor's own table,
and calling it a stall is what teaches an operator to ignore the word; and the
loop's message says which reading ended it.

**The regression to lock:** a genuinely hung agent still ends. That is
`a-hung-child-does-not-hold-the-loop`'s property, measured 2026-08-25, and a
test must fail if this slice loses it.

### Hopping (Branch: bug/a-long-agent-reaches-its-second-slice)

With the timer no longer firing mid-run, the hop becomes reachable. This slice
proves it.

**Done when** a worker that finishes one slice claims the next through `--next`
and rewrites its manifest — asserted end to end, not by reading the code that
would do it. **No worker has ever hopped in this repo**, so this is the first
evidence the path works at all.

## Done when

1. Seven workers' worth of the 2026-08-30 failure cannot recur: a committing
   agent is not ended.
2. A hung agent still ends, with a test that fails if it does not.
3. A worker hops, proven end to end.
4. The residual timer is a floor with a stated value and a stated reason.
5. `pnpm test`, `pnpm run test:e2e` (with `env -u PLOT_UNATTENDED`) green.

## Notes

Raised by the operator on 2026-08-30 as *"we must replace or delete this rule —
how else can we have long-running agents that take on new slices?"* The question
answers itself against the loop's own code: the hop is written and the bound
prevents it.

**`Worker bound: 0` already disables the watchdog entirely** (`plot-worker-loop.sh:216`),
so the escape exists. This plan is about the default being wrong, not about
adding a way out.
