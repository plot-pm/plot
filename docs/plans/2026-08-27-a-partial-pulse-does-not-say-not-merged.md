# A partial pulse does not say "not merged"

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

The Deliver gate reads the wave verdicts the pulse actually carries, and refuses
to answer at all from an incomplete scan — so a finished plan stops being told
its branches have not merged.

## Motivation

### The measurement

Reported by an operator on 2026-08-27, on a plan whose work shipped the day
before:

> plan `an-unreachable-host-is-not-an-answer` has a branch that is not merged —
> a plan is deliverable only once every non-deferred branch has landed

Both of its PRs merged on 2026-08-26: **#446** (wave `Told`) and **#454** (wave
`Withheld`). The scan run against current main agrees:

```
Told — complete
    bug/an-unreachable-host-says-so — merged
Withheld — complete
    bug/an-unknown-pr-withholds-its-verdict — merged
```

The board refused anyway.

### The gate looks in an array the timeout leaves empty

`deliver.ts:209` asks `allWavesMerged(meta, pulseFor(opts))`, and that function
opens with a lookup (`board.ts:429`):

```ts
const plan = pulse?.plans.find((p) => p.file === path.basename(meta.file));
if (!plan) return false;
```

**`false` means *not merged*.** Measured against the live board's payload the
same minute:

```
complete:      False        ← the scan timed out
plans array:   0
waves array:  52
this plan in waves: 2 → all complete: True
```

The pulse carries **52 waves**, including both of this plan's, both `complete`.
It carries **zero plans**, because the scan did not finish. So the lookup fails,
`false` is returned, and the refusal says the branches have not merged — about a
plan the same payload describes as entirely complete.

### Absent read as false, in a gate

Plot's rule everywhere else is that an absent answer is not a negative one:
`plot-host.sh` reports `checks:"unknown"` rather than red; the fleet scan's
`--next` exits 1 for *nothing to start* rather than naming something wrong; the
adapter separates *a lookup that failed* from *a lookup that found nothing*.

This gate breaks that rule at the point where it decides an operator's action.
Worse, the two states it conflates need opposite responses: *your branches have
not landed* means go finish the work, and *the scan did not finish* means wait a
moment and try again.

### It is not the branch deletion, and it is not the ref

Two hypotheses were tested and both refuted on 2026-08-27.

**Deleting the merged branch was not the cause.** `bug/an-unreachable-host-says-so`
was deleted from origin minutes before the refusal, and the natural suspicion was
that the pulse derives `merged` from `origin/<branch>` and could no longer see
it. Measured: the scan against current main still reports both branches `merged`
with the ref gone. The derivation survives deletion.

**The wave verdicts were never consulted.** `allWavesMerged` walks
`plan.waves[].branches[]` for a branch-level `state`, and never reads the
`verdict` the scan computed. Both readings would agree on a complete pulse; only
one of them survives a partial one.

## Design

### Read what the pulse carries, and say when it carries nothing

Two changes, and the second is the one that matters.

**Read the wave verdicts.** The pulse's `waves` array holds a per-wave `verdict`
— `complete`, `eligible`, `blocked`, `unapproved`, `deferred` — computed by the
scan from the same branch states `allWavesMerged` re-derives. A plan whose every
non-deferred wave is `complete` has landed every branch, by the scan's own
arithmetic. Reading the verdict rather than recomputing it also removes a second
implementation of one question.

**Refuse to answer from an incomplete pulse.** `complete: false` means the scan
did not finish, and nothing derived from it can be trusted as a negative. The
gate returns a distinct verdict for that state, and the button says *the scan has
not finished* rather than a claim about branches.

### A fourth verdict, not a fourth reason for an existing one

`deliverable`, `not-found`, `already-delivered` and `not-merged` are the four
today. The new state is a fifth — the plan may be perfectly deliverable, and the
board simply cannot say yet. Folding it into `not-merged` is what produces the
present defect; folding it into `not-found` would claim the plan does not exist.

### Not chosen: fix the timeout instead

The timeout is real and has its own plan
(`the-scan-parses-its-plans-once`), and the estate work this session cut the scan
from 462.9 s to 111.5 s. But a gate that answers wrongly from partial data is
wrong at 111 s and at 11 s: any scan can be interrupted, and the board renders
`complete: false` whenever one is in flight. **The gate must be correct about
incomplete input regardless of how often that input occurs.**

### Not chosen: fall back to asking the host

The route could ask `plot-host.sh` per branch when the pulse is thin. Rejected:
it puts host latency on a click path, it re-derives a fact the scan owns, and it
would make the gate's answer depend on which of two sources answered — the
disagreement this codebase keeps removing.

### Not chosen: treat a missing plan as deliverable

The inverse error, and worse. `false` at least fails safe; `true` would deliver a
plan whose branches nobody checked.

### The card is wrong too — there are two callers, not one

Checked before approval: `allWavesMerged` has **two** consumers, and the plan
above named only the first.

- `deliver.ts:209` — the Deliver gate, the refusal an operator meets.
- `board.ts:499` — inside `planStatus`, deciding `deliverable`.

So the same partial pulse that refuses the button also renders the CARD wrong: a
plan whose every wave is complete shows as `in-progress` rather than
`deliverable`, because the same lookup fails the same way. The operator sees a
card that does not offer delivery and a button that refuses it, from one cause.

That widens the defect and sharpens the fix: reading the verdicts must happen in
`allWavesMerged` itself, where both callers inherit it, not in the route. The
data is already in the contract — `FleetWaveSchema` carries `verdict`
(`schema.ts:1817`) and the pulse carries `waves` (`:1839`) — so no plumbing is
added.

## Waves

### Verdicted (Branch: bug/the-deliver-gate-reads-the-verdicts)

`allWavesMerged` reads the wave verdicts the pulse carries, and the Deliver gate
returns a distinct *scan incomplete* verdict rather than `not-merged` when
`complete` is false.

## Done when

1. **A plan whose every non-deferred wave is `complete` is deliverable**, on a
   pulse whose `plans` array is empty. The measured shape: 52 waves, 0 plans,
   both of this plan's waves complete, and the gate refusing.
2. **An incomplete pulse produces a DISTINCT verdict**, not `not-merged`. The
   two need opposite responses — finish the work, versus wait for the scan — and
   one refusal cannot carry both.
3. **The button's message names the scan**, not the branches, in that state. A
   reader told *a branch has not merged* about a merged branch goes looking for
   work that does not exist; this session's operator did exactly that.
4. **A plan with a genuinely unmerged non-deferred branch is still refused**, on
   a COMPLETE pulse. The gate this plan must not weaken — asserted separately
   from item 1, because a fix that always returns deliverable passes item 1.
5. **A deleted branch does not change the answer.** Measured 2026-08-27: the
   scan reports `merged` for a branch whose ref is gone, so the gate must too.
   This is the hypothesis that was refuted while diagnosing, pinned so it stays
   refuted.
6. **`allWavesMerged` has ONE implementation of "has this plan landed".** It
   currently re-derives from branch states what the scan already decided as a
   verdict; two derivations of one question is what this repo keeps removing.
7. **The CARD reads `deliverable` on the same partial pulse**, not just the
   button. Two callers (`deliver.ts:209`, `board.ts:499`) share the function;
   fixing the route alone leaves a plan whose card refuses to offer what its
   button would allow.
8. `pnpm run validate`, `pnpm run test:board` green; artifact rebuilt and
   committed.

## Notes

### Found by an operator asking the right question

The report was *"shouldn't it check the plan's status and its wave completion
status?"* — and the answer was that the pulse carried exactly that, and the gate
looked somewhere else. Two wrong hypotheses were tested first (the branch
deletion, the ref derivation) and both refuted by measurement before the payload
was read directly.

### It belongs to this sprint's subject

*The board tells the truth in every section.* A gate that turns *I could not
finish measuring* into *your work is not done* is not a slow board; it is a board
telling an operator something false about their own work, at the moment they ask
it to act.
