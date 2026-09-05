## Implementation brief — a-merged-slice-leaves-the-queue (slice: The queue asks whether it landed)

- **Plan (canonical):** `docs/plans/2026-09-05-a-merged-slice-leaves-the-queue.md` on `main`
- **Branch:** `bug/a-merged-slice-leaves-the-queue` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

One slice. **Waits for [`a-second-slice-needs-its-own-session`](../../docs/plans/2026-09-05-a-second-slice-needs-its-own-session.md)** — until that lands no agent can take a second slice at all, so this defect cannot be observed again and a fix for it cannot be tested end to end.

## The failure

**Measured 2026-09-05, on the first supervisor tick that ever matched agents to slices:**

```
plot-registryd tick agents=3 left=3 handed=3 queued=454
  feature/a-story-lifecycle-refuses: hand over to 02489660…
  feature/a-plan-has-a-state:        hand over to 5c7c41bd…
  feature/an-agent-is-started-by-a-command: hand over to 778d3295…
```

**Two of the three had already merged** — `#707` at 15:51 UTC and `#708` at 15:28. Only `feature/a-plan-has-a-state` had no PR and was a correct offer. Both merged branches' remote refs were confirmed gone from the host.

## The cause — one line

`packages/board/src/server/queue-reading.ts:88`:

```ts
if (claimed.has(line.branch)) continue;
queued.push({ branch: line.branch, slug, claimable });
```

`claimed` is a set of remote refs — the comment above it reads *"a branch with a ref has been started by somebody; one without has not."* That is right for a branch nobody started and **wrong for one that finished: merging deletes the ref.** The event that completes a slice is the same event that returns it to the queue looking untouched.

**The slice verdict does not save it.** `claimable` is `verdicts[index] === 'eligible'` (`:82`) — a property of the SLICE applied to every branch in it. A slice with two branches, one merged and one open, is eligible, so the merged branch inherits `claimable: true`.

**Nothing was written, and that is the only reason it cost nothing.** `--once` decides and performs nothing. A performing tick would have handed two agents work already on `main`, each opening a duplicate PR — precisely the loop `plot-pr-merged.sh` documents: a leftover lets a merged branch be adopted, its worker opens a duplicate, the duplicate is newer, and the reaper then keeps the worktree.

## What to build

**TWO QUESTIONS, TWO READINGS.** *Has somebody started this* is the ref, and stays. *Is this finished* is the host's `mergedAt`, and is new. Conflating them is the defect; replacing one with the other only moves it.

**Consume the existing answer, do not add a second.** `plot-pr-merged.sh` is the ONE answer to *did this land* — it reads `mergedAt`, never `state` (a merged PR reports `CLOSED`) and never ancestry (squash-merge leaves a branch permanently ahead). `a-merge-is-a-domain-question` merged as **#706** and put that rule in the domain; use it.

**THE HOST'S SILENCE MUST NOT QUEUE WORK, AND THIS INVERTS THE USUAL DIRECTION.** `pr_merged` answers *not merged* when the host cannot be asked. For the reaper that is safe — keep what you were about to delete. **Here the same word means *offer it to an agent*,** so an unreachable host would return every finished branch to the queue at once.

So an unanswerable host **holds** the slice with a stated reason rather than offering it. `QueueHold` already exists for exactly this and gains a value; `whyNotReady` (`rules/queue.ts`) is where the word is chosen.

**`isHandOverReady` stays as it is.** `rules/queue.ts:122` reads `slice.claimable && slice.briefPresent` and is correct — it is being told the wrong thing. The rule does not change.

## Testing

A queued slice whose branch the host reports merged is not offered; one with no PR is; and an unreachable host offers neither while naming why. Three cases, all expressible as readings passed to the rule — the domain here takes readings as values and performs no I/O, so none of them needs a network.

Gates: `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

`scripts/check-ancestry-decisions.sh` is a live gate: if this branch adds an ancestry call, it declares its kind within five lines above it. It should not need one — the host answers this question.

## Done when

- a branch whose PR merged is not offered to a free agent
- a branch with no PR still is
- an unreachable host offers neither, and the hold says why
- the ref reading still answers *has somebody started this*
- `isHandOverReady` is unchanged
- the gates above pass

## Do not

- **Do not replace the ref check.** It answers a different question and both are needed.
- **Do not add a second merge implementation.** `plot-pr-merged.sh` and #706's domain rule are the one answer.
- **Do not read `state` or ancestry.** Measured 2026-09-04: ancestry disagreed with the host on ten of ten merged branches.
- **Do not let an unreachable host default to offering.** That failure direction is safe for the reaper and dangerous here.
- **Do not start before the session fix lands.** A correct offer that dies on arrival proves nothing.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
