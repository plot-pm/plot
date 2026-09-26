# A claim is released, not deleted

> Deleting a claim ref erases the registry's only record of an assignment, so a later pass hands the same slice to a second agent. Measured 2026-09-26: `feature/the-board-filters-to-my-work` was handed out twice, the second agent's claim push was rejected, and it abandoned a desk holding unpushed commits. `matchQueue` states the backstop *"should never fire"*; it fired.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1003
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 1
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)

## Changelog

- Clearing an abandoned claim goes through a command that releases the registry's assignment with it. A ref deleted by hand no longer leaves the registry believing a dead agent still holds the slice.

Board impact: none directly. The board renders whatever the scan reports, and a released slice reads as unclaimed exactly as a deleted one does today.

## Motivation

### Round 1 refuted this plan's premise, and the design below is corrected

An earlier draft said *"the assignment's only durable record is the claim ref"* and *"there is no way to clear one without the other."* **Both are false.** The **agent manifest** carries the assignment, and `clear_manifest_branch` (`plot-worker-loop.sh:350`) is a separate writer for it.

So deleting the ref clears the **scan's reading of branch state**; the registry's record of the assignment lives in the manifest and is cleared elsewhere. Two facts, and the earlier design rested on their supposed inseparability.

**What the verb must therefore clear is both** — the ref and the manifest's `branch` field — or it half-releases, which is the failure this plan exists to prevent rather than reproduce.

### The two records, and why the ref alone is not enough

**A claim ref and an agent manifest each hold part of the assignment.**

It is the **lock** — git rejects a diverged claim push, which is what stops two agents committing to one branch. It is also the **assignment record** — what tells a later pass the slice is taken. There is no way to clear one without the other.

### Measured 2026-09-26

`.worktrees/free-cf58119b/.plot-worker.log`:

```
plot-worker-loop: REGISTRY LOCK VIOLATION — the claim push for
feature/the-board-filters-to-my-work was rejected, so another agent already
holds a slice this agent was handed. The registry is the assignment lock and
this push is only its backstop; a rejection here means two agents were given
one branch.
```

The agent abandoned its desk (`unpushed-commits`) and left it for the sweep. The slice produced nothing.

The sequence:

1. Pass A assigns the branch to agent 1. The assignment's only durable record is the claim ref.
2. Agent 1 dies — no desk, no manifest, no live pid.
3. An operator deletes the ref. This is the documented repair: `plot-reap.sh` reports the shape as *"still claimed, no commits → needs judgment"* and refuses to decide, correctly, because it cannot tell a thinking worker from a dead one.
4. Pass B reads the slice as `claimable` and assigns it to agent 2.
5. Agent 2's claim push is rejected. The backstop fires.

### `matchQueue`'s invariants hold and do not cover this

The rule names two, and both are true:

> - **one slice to one agent** — a matched agent is removed from the pool
> - **never the same slice twice** — the loop visits each slice once

**Both are scoped to a single pass**, and this collision is across passes. The docstring calls the registry the assignment lock, but the daemon holds nothing between ticks — `plot-registryd.mjs` re-derives the queue every tick with no state file, which is measured and deliberate. So the durable record *is* the ref, and the rule's claim that a collision *"stops being reachable rather than being caught"* is true only while no ref is deleted.

### The estate already names the gap

`plot-dispatch.sh:1174` — *"a claim nobody can release."*
`plot-dispatch.sh:1702` — *"the claim stands until you release it."*

Both assume a person releases it by hand and neither offers a command. This plan gives an existing concept the command it never had.

### It is reachable without an operator

Any ref deletion between a hand-over and the agent's claim push does it. `plot-release-refs.sh` deletes a delivered plan's merged refs and is bounded by the plan file, not by what the registry handed out a second ago.

## Design

### The command

**`--release <branch>` clears BOTH records in one act** — the remote claim ref and the assignment in the agent's manifest, through `clear_manifest_branch`'s existing writer rather than a second one.

Clearing only the ref is what an operator does by hand today, and it is what produced the measured lock violation: the scan then reads the branch as unclaimed while the manifest still names it, so a later pass hands it out again.

**It refuses on a live worker.** That is the one case where the claim is not abandoned, and the refusal is the same measurement `--restart` already makes: a live pid means somebody is working. A dead agent is the population this serves.

**It is the named counterpart to `--stop`.** `--stop` ends a worker and **keeps** the claim — *"each desk and claim stands"* — because stopping is not abandoning. `--release` is the second half nobody wrote: the operator has decided the work is abandoned and the slice should return to the queue.

### Why not make the daemon remember

The daemon's statelessness is argued for explicitly and measured: a tick `kill -9`ed two seconds in is followed by a whole tick reaching the identical decision, with no state file written. Recovery from a failed tick and recovery from a `kill -9` are one code path, and adding an assignment journal would create a second.

**A journal would also need its own repair**, since an assignment recorded for an agent that died is exactly the state this defect is about — it would move the problem rather than remove it.

### Why not detect the double assignment instead

The backstop already detects it, and detection is not the gap: the log line says *"the estate needs the double assignment found"* and nothing finds it. Reporting it better still costs one agent's slot and one abandoned desk per occurrence. Preventing the erasure costs nothing.

### What this does NOT do

- **It does not change `matchQueue`.** The rule is correct as specified; its invariants are per-pass and this defect is across passes. Widening them would mean the daemon remembering, which the section above rejects.
- **It does not change the claim push.** The backstop stays, costs nothing, and is the last line if something else erases a ref.
- **It does not decide which claims are abandoned.** `plot-reap.sh` reports *needs judgment* and refuses, correctly. This gives a person a safe way to act on that report; it does not act for them.
- **It does not touch `plot-release-refs.sh`.** Whether ref deletion there can race a hand-over is a second question with its own blast radius.

## Done when

- `--release <branch>` deletes the claim ref and clears the registry's assignment in one act.
- It refuses on a live worker, naming the pid.
- It refuses a branch carrying real work, since that is not an abandoned claim.
- `--stop` still keeps the claim, and the two verbs' difference is stated where an operator reads it.
- A test covers the sequence above: assign, kill the agent, release, re-assign, and no lock violation.

## Slices

### A claim is released, not deleted (Branch: bug/a-claim-is-released-not-deleted)

Add the verb, its two refusals, and the test that reproduces the measured sequence.

## Notes

Four orphaned claims were cleared by hand in this session — `a-wave-says-which-question-it-answered`, `one-column-one-kind-of-fact`, `the-kind-is-labelled-not-hovered`, `the-board-filters-to-my-work` — all with dead workers, two of them local-only refs already gone from the remote. Only the fourth produced a lock violation, because only it was re-dispatched immediately afterwards.
