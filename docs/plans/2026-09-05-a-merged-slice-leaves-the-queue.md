# A merged slice leaves the queue

> A branch whose PR merged is offered to a free agent again. The queue reads *claimed* off the remote ref, and merging deletes the ref — so the one event that finishes a slice is the same event that makes it look unstarted.

## Status

- **Phase:** Delivered
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-05, Jan Wloka, in-session
- **Started:** 2026-09-05, Jan Wloka, `bug/a-merged-slice-leaves-the-queue`
- **Delivered:** 2026-09-05

## Changelog

- A slice whose branch merged leaves the queue, instead of re-entering it the moment its ref is deleted.

<!-- Board impact: the same queue feeds the board's auto-dispatch and the
     supervisor's hand-over, so both stop offering finished work. -->

## Problem

**Measured 2026-09-05, on the first tick that ever matched an agent.** The supervisor reported:

```
plot-registryd tick agents=3 left=3 handed=3 queued=454
  feature/a-story-lifecycle-refuses: hand over to 02489660…
  feature/a-plan-has-a-state:        hand over to 5c7c41bd…
  feature/an-agent-is-started-by-a-command: hand over to 778d3295…
```

**Two of the three had already merged.** `#707` merged `feature/a-story-lifecycle-refuses` at 15:51 UTC and `#708` merged `feature/an-agent-is-started-by-a-command` at 15:28. Only `feature/a-plan-has-a-state` had no PR and was a correct offer.

**The cause is in `queue-reading.ts:82`, and it is one line.**

```ts
if (claimed.has(line.branch)) continue;
queued.push({ branch: line.branch, slug, claimable });
```

`claimed` is a set of remote refs — *"a branch with a ref has been started by somebody; one without has not."* That reading is right for a branch nobody started and wrong for one that finished: **merging deletes the ref.** So the event that completes a slice is the same event that returns it to the queue looking untouched.

**Nothing wrote anything, and that is the only reason this cost nothing.** `--once` decides and performs nothing, so the three hand-overs above were a decision on paper. A tick that performed them would have handed two agents branches whose work is on `main`, and each would have re-opened a PR on merged work — which is precisely the loop `plot-pr-merged.sh` documents: a leftover lets a merged branch be adopted, its worker opens a duplicate, the duplicate is newer, and the reaper then keeps the worktree.

**The slice verdict does not save it.** `claimable` is `verdicts[index] === 'eligible'` — a property of the SLICE, applied to every branch in it. A slice with two branches, one merged and one open, is eligible, so the merged branch inherits `claimable: true`.

## What this is not

**Not a change to `isHandOverReady`.** `rules/queue.ts:122` reads `slice.claimable && slice.briefPresent` and is correct; it is being told the wrong thing. The rule stays.

**Not a new merge check.** `plot-pr-merged.sh` is the ONE answer to *did this land*, reads `mergedAt` rather than `state` or ancestry, and already has a domain rule of its own in flight (`a-merge-is-a-domain-question`). This plan consumes that answer; it does not add a second one.

**Not a claim that refs are the wrong signal.** A ref is exactly right for *has somebody started this*. It is simply not an answer to *is this finished*, and one reading has been carrying both questions.

## Slices

### The queue asks whether it landed (Branch: bug/a-merged-slice-leaves-the-queue, PR: #713)

`buildQueue` excludes a branch the host says merged, alongside the claimed-ref check rather than instead of it.

**TWO QUESTIONS, TWO READINGS.** *Has somebody started this* is the ref, and stays. *Is this finished* is the host's `mergedAt`, and is new. Conflating them is the defect; replacing one with the other would only move it.

**THE HOST'S SILENCE MUST NOT QUEUE WORK.** `pr_merged` answers *not merged* when the host cannot be asked, so an unreachable host would return every finished branch to the queue at once. The failure direction that is safe for the reaper — keep what you were about to delete — is the dangerous one here, because the same word means *offer it to an agent*. So an unanswerable host holds the slice with a stated reason rather than offering it: `QueueHold` already exists for exactly this, and gains a value.

**Done when** a branch whose PR merged is not offered to a free agent, a branch with no PR still is, and an unreachable host offers neither while saying so.

## Notes

### It waits for its sibling — 2026-09-05

[`a-second-slice-needs-its-own-session`](2026-09-05-a-second-slice-needs-its-own-session.md) was found by the same hand-over and goes first. Until it lands **no agent can take a second slice at all** — the prompt dies on the session id before any queue answer matters — so this defect cannot be observed again and a fix for it cannot be tested end to end. Landing this one first would produce correct offers that still fail on arrival.

### Why this surfaced only today — 2026-09-05

The queue has been derived on every tick for weeks, and `agents=0` on every one of them. A queue nobody could take is a list; matching is what made its contents load-bearing. The estate reached three free agents and two merges within the same hour, and the defect was in the first tick that could act.
