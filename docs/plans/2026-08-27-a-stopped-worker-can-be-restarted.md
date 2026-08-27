# A stopped worker can be restarted

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

A branch whose worker has stopped can be handed to a new worker through Plot,
instead of only through a hand-run `claude -p` that the fleet cannot see.

## Motivation

### The measurement

On 2026-08-26 a worker on `bug/loose-checks-the-rollup` stopped. Its worktree
held work, its branch held a claim, and no process was running. The operator
wanted a new worker on it.

There was no way to ask for one.

`plot-dispatch.sh <slug>` answers `dispatched=0`. Not a refusal with a reason —
an empty set. The dispatcher never considered the branch at all.

### Where the branch disappears

The dispatcher does not decide this. It asks the scan, one branch at a time:

```bash
branch=$("$script_dir/plot-fleet-scan.sh" $offline --next "$slug" 2>/dev/null) || break
```

and `--next` prints `claimable[0]`, filled at `plot-fleet-scan.sh:2842` by a
single condition:

```bash
if [ "$verdict" = "eligible" ] && [ "$st" = "open" ]; then
  claimable+=("$br")
fi
```

`open` means **no ref exists**. A branch that has ever been claimed is `claimed`
(ref, no real commits) or `wip` (ref with work) — and neither is ever offered,
by any caller, at any time.

So the dispatcher is not withholding the branch. It was never handed one. This
is why `dispatched=0` carries no explanation: an empty set has nothing to say
about what was filtered out of it.

**This is correct for the case it was built for.** The `open`-only rule is
Plot's locking mechanism working exactly as designed — it is what stops two
workers claiming one branch. The gap is that *release* has no counterpart.

### The fleet already knows the answer

`plot-worker-state.sh` distinguishes eight states, and its own table names the
one this plan needs:

```
process alive                    running   leave it alone
an open or merged PR             finished  the work reached review
a blocked marker in the tree      waiting  a person owes it an answer
uncommitted or unpushed work      stalled  work on the floor, no PR
otherwise                        finished  nothing left behind
```

`stalled` is precisely *a worker stopped and left work behind*. The fleet
computes it, the board renders it, and nothing can act on it.

That is the shape of this defect: **not a missing measurement, a missing verb.**

### Stop exists; start does not

`plot-dispatch.sh` parses `--dry-run`, `--status`, `--stop`, `--no-start`,
`--offline`, `--allow-local`, `--max`, `--migrate`, `--yes`, `--force`.

`--stop <branch>` kills a running worker. Nothing starts one on a branch that
already has a claim. The asymmetry is the whole feature request.

### What the absence actually costs

The operator's recourse on 2026-08-26 was to bypass Plot: run the worker prompt
by hand. That worked, and it produced a second defect — the hand-run worker had
no manifest, so `readAgentRegistry` synthesized a nameless row and the board
displayed the **branch name in the agent-name slot**, linking to a branch where
a session should be. A separate write-up covers the synthesized row; what
matters here is *why a human ended up outside the tool*. They were not
economising. There was no supported path.

A missing affordance does not stop the work. It moves the work somewhere the
fleet cannot see it — which is the failure this sprint's subject names.

## Design

### The verb is `--restart <branch>`, and it is explicit

Not a flag on the fan-out loop. `plot-dispatch.sh <slug>` must keep meaning
*start the work nobody has started*; a restart that could happen as a side
effect of an ordinary dispatch would let one operator's `--max 4` silently
adopt another's stopped work.

So restart takes a branch, never a slug, and never selects one itself:

```bash
plot-dispatch.sh --restart feature/the-thing
```

The branch is named because the judgement is the operator's. `--next` cannot
make it: deciding that a stopped worker should be replaced rather than its work
reviewed, reaped, or abandoned is exactly the call Plot leaves to a person —
the same reasoning `a-claimed-branch-is-not-startable` gives for refusing to
drop a claim when a PR closes.

### It refuses on measurements, the way the reaper does

`plot-reap.sh` is the precedent, and it is a good one: five refusals, every one
a measurement, none a judgement. `--restart` takes the same posture, reusing
`plot_worker_state` rather than re-deriving anything:

| state | answer |
|---|---|
| `running` | **refuse** — a live worker holds this branch |
| `waiting` | **refuse** — a `PLOT-BLOCKED` marker is unanswered; a new worker meets the same question |
| `finished` | **refuse** — the work reached review; restarting discards a PR |
| `stalled` | **restart** — work on the floor, no PR, no process |
| `failed` / `ended` / `none` | **restart** — no process, nothing claiming review |

`running` and `waiting` are the two that matter. A restart over a live worker
duplicates effort; a restart over an unanswered question re-asks it of someone
who cannot answer either, which is how a blocked branch becomes an infinite
loop.

**Refusals name the state and stop.** No `--force` in this plan. A flag that
overrides a liveness refusal is the flag that gets typed reflexively, and the
thing it overrides is another agent's work.

### It preserves the tree; it does not clean it

A `stalled` worktree holds uncommitted work — that is what `stalled` means.
`--restart` starts a worker in the existing worktree and touches nothing in it.

The alternative — reset the tree to a known state first — was rejected on the
measurement in `rescue-a-hung-worker-by-committing-its-tree`: a stalled worker
in this repo left **324 finished lines uncommitted**. Work that survives a stall
is the most easily destroyed thing in the fleet, and a restart that discards it
is worse than the missing affordance, because it looks like a supported
operation.

The new worker inherits the tree as it stands. Its brief already tells it to
commit and push before verifying.

### It writes a manifest, because that is the point

The bypass produced an unregistered agent. A restart that spawned a worker
without a manifest would reproduce the exact defect it exists to prevent, so
the manifest write is not incidental to this feature — it is half of it.

Restart uses the same manifest path as the ordinary dispatch. One writer, so
the two cannot drift.

### Not chosen: teach `--next` to offer claimed branches

Tempting — one condition at `plot-fleet-scan.sh:2842`. Rejected: `--next` is
consumed by `plot-dispatch.sh`, `/plot-implement`, and the board's auto-dispatch,
none of which asked for a stopped branch. Widening it would hand claimed
branches to three callers to fix a gap in one, and auto-dispatch would begin
restarting stalled work on a five-second timer with nobody deciding anything.

The scan's answer is right. What was missing is a second question.

### Not chosen: make the board's *Drop the agent* action restart instead

Drop removes a row. Restart starts a process. Overloading one control with both
would mean the destructive reading and the constructive one share a button.

### Not chosen: a `--restart` that also reaps

Reaping removes a worktree whose work has **landed**; restarting acts on one
whose work has **not**. They are disjoint by definition — `plot-reap.sh` refuses
on uncommitted changes, which is the state restart requires. A combined verb
would be two operations that can never both apply.

## Waves

### Restarted (Branch: feature/a-stopped-worker-can-be-restarted)

`plot-dispatch.sh --restart <branch>` starts a worker on a branch that already
holds a claim, refusing on `running`, `waiting`, and `finished`, preserving the
worktree, and writing a manifest through the ordinary dispatch path.

## Done when

1. `--restart <branch>` starts a worker on a `stalled` branch and **the fleet
   scan reports it as `running` afterwards**. Asserted through the scan, not by
   checking a pid: an unregistered worker is the defect this closes, so a
   restart the fleet cannot see has not succeeded.
2. A manifest exists for the restarted worker, carrying its session and pid.
   Asserted by reading the registry — not by the file's existence, since the
   measured failure was a row synthesized *because* no manifest was there.
3. **`--restart` refuses on `running` and names the pid.** The refusal that
   prevents two workers on one branch.
4. **`--restart` refuses on `waiting` and names the marker file.** A blocked
   branch restarted is the same question asked again with nobody to answer it.
5. **`--restart` refuses on `finished` and names the PR.** Restarting over work
   that reached review discards it.
6. **Uncommitted work in the worktree survives the restart, byte for byte.**
   Asserted with a dirty tree, because a restart that resets is the one failure
   worse than no restart at all.
7. `--restart` requires an explicit branch: `plot-dispatch.sh <slug>` never
   restarts anything. Asserted by dispatching a plan whose only branch is
   stalled and observing `dispatched=0` — the behaviour today, deliberately
   unchanged.
8. `plot-fleet-scan.sh --next` is unchanged. Its `open`-only rule is the lock;
   this plan adds a second question rather than widening the first.
9. `pnpm run validate`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### Why this is a feature and not a bug

Nothing here is behaving incorrectly. `--next` filters exactly as designed, the
dispatcher refuses nothing, and the claim held. The fleet lost visibility of a
worker because a person had to leave the tool to do something the tool has no
verb for — and that is a gap, not a fault.

Filing it as a bug would put the blame on the lock, which is the one part of
this that must not change.

### It belongs to this sprint's subject

*The board tells the truth in every section.* An operator who cannot restart a
stopped worker through the tool restarts it beside the tool, and everything the
board knows about that worker is then a guess. The measured consequence was a
row whose name was a branch — a section reporting a fact it had inferred,
because the worker it described was never announced to it.
