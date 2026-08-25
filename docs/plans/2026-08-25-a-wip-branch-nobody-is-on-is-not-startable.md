# A wip branch nobody is on is not startable

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-25, Jan Wloka, `bug/auto-dispatch-skips-an-occupied-branch`

## Changelog

Auto-dispatch spends its budget only on branches a dispatch can actually claim,
so one already-claimed branch stops starving every plan behind it.

## Motivation

### The measurement

Reported by an operator on 2026-08-25: *auto-dispatch is checked, the wave is
eligible, and nothing starts.*

Everything the switch needs was true — `autoDispatch: true`, `parallelAgents: 3`,
`working: 2`, so one free slot; the plan `approved`; the wave `eligible`; the
branch unclaimed and without a worktree. It still never started.

Replaying `planAutoDispatch` against the live pulse shows why:

```
budget: 1
  WÜRDE DISPATCHEN: 2026-07-25-opus5-longhorizon-hardening.md max=1
  budget erschöpft bei 2026-08-20-a-dispatch-hands-over-a-brief.md
```

The whole budget goes to a plan from **July**, and the plan the operator was
watching — dated 25 August — is never reached.

### The budget buys nothing

`feature/opus5-hardening-ralph-bounds`, the branch that consumed it, **is already
claimed**: its ref exists on origin, its PR (#49) was closed four weeks ago, and
`plot-dispatch.sh opus5-longhorizon-hardening` answers `dispatched=0`. The
script correctly refuses — pushing a ref that exists is rejected, which is Plot's
entire locking mechanism.

So every pulse plans a spawn the script immediately discards, spends the budget
doing it, and repeats. Nothing changes state, so nothing breaks the cycle.

### The pulse sees it, and `isStartable` accepts it anyway

The first draft of this plan blamed a blind pulse — *`open` says nothing about
whether a ref exists*. **That was wrong, and the correction is the useful part.**

The scan distinguishes both cases already (`plot-fleet-scan.sh:2528`): a branch
whose only commits beyond main are empty claim markers is `claimed`; one
carrying real work is `wip`. Measured on the live pulse:

```
feature/opus5-hardening-ralph-bounds            state=wip
feature/the-board-says-which-registry-it-read   state=open
```

`wip` is the honest answer — that branch really does carry three commits of
unlanded work. The defect is that `isStartable` accepts it:

```ts
function isStartable(state: string): boolean {
  return state === 'open' || state === 'wip';
}
```

Accepting `wip` is deliberate and right for the case it was written for: a wave
someone began and abandoned should be resumable. But it makes no distinction
between *begun and abandoned* and *begun four weeks ago, consolidated into a PR,
and left there on purpose*.

Of the four branches `planAutoDispatch` counted startable on 2026-08-25, **three
were `wip`** and one was `open`. The `open` one is the only one a dispatch could
have acted on, and it is the one that never got a turn.

### Order makes it permanent, not occasional

`planAutoDispatch` iterates `pulse.plans` in file order, which is date order by
filename. A July plan is therefore always considered before an August one — so
under a tight budget the same stale claim wins every pulse, forever. The defect
does not drift; it is pinned to the oldest approved plan holding a claimed
branch.

This is the difference from `a-landed-branch-still-holds-a-slot`
(`a-hung-child-does-not-hold-the-loop`, wave `Counted`): there, a **dead worker**
holds a real slot against the cap. Here, **no worker exists** and the budget is
spent on an action that is refused before it does anything.

## Design

### Startable means a dispatch would do something

`isStartable` answers *is there work here?* Auto-dispatch needs a second
question: *would spawning a dispatch change anything?* For a `wip` branch whose
ref already exists, the answer is no — `plot-dispatch.sh` refuses a branch whose
ref is present, which is Plot's whole locking mechanism.

So `planAutoDispatch` treats `wip` as startable **only when no worker holds it
and no ref blocks the claim**. `open` is unchanged: no ref, no work, nothing to
refuse.

The facts are already in hand. The scan derives `wip` by walking the branch's
commits, so it knows the ref exists; the registry says whether a live worker is
on it. **No new host call**, and none may be added — `maybeAutoDispatch` runs
inside the scan's success path, and per-branch network latency there would be
paid on every pulse.

### The refusal says which branch held the budget

When auto-dispatch skips a claimed branch, it names it. A budget that buys
nothing is the failure this plan removes; a budget that is *withheld* for a
stated reason is a decision the operator can act on.

Today the operator's only recourse was to replay the planner by hand against the
pulse JSON — which is how this defect was found, and not a diagnostic anyone
should need.

### Not chosen: order plans by recency

Tempting, since date order is what makes the starvation permanent. Rejected: it
treats the symptom. A claimed branch would still consume budget, just from a
different plan each pulse — and a fleet whose dispatch order silently depends on
filenames would still be surprising, only less reproducibly.

### Not chosen: drop the claim when its PR closes

`plot-dispatch.sh` deliberately never deletes a remote ref another session may be
reading, and `/plot-reconcile` owns cleanup using the plan's own
`deferred:`/`moved:` annotations to tell abandonment from a dead worker. A closed
PR is not, by itself, abandonment. That decision belongs to a person.

### Not chosen: count claimed branches against the cap

They occupy no process and no worktree. The cap is about machines; this is about
budget spent on a no-op.

## Waves

### Spent (Branch: bug/auto-dispatch-skips-an-occupied-branch)

`planAutoDispatch` counts a `wip` branch as startable only when a dispatch could
act on it, and names the ones it skipped.

**One wave, not two.** The first draft split this into a pulse change and a
planner change, on the belief that the pulse could not see a claim. It can — the
scan already derives `claimed` from empty markers and `wip` from real commits
(`plot-fleet-scan.sh:2528`), and the registry already says which branches hold a
live worker. Nothing new needs collecting; the planner needs to stop counting
what it cannot use.

## Done when

1. With one `wip` branch whose ref exists and one `open` branch, and a budget of
   1, the **`open`** one is dispatched. Asserted with the `wip` branch belonging
   to the earlier plan in file order — the measured shape, and the one a fix that
   merely reorders plans would pass without.
2. **An `open` branch is still startable, and so is a `wip` branch with no ref.**
   The ordinary cases must not regress: a fix that rejects every `wip` branch
   stops resumable waves entirely and passes item 1. This is the assertion that
   keeps `isStartable`'s original purpose intact.
3. `plot-dispatch.sh` is unchanged. Its ref-push claim stays the locking
   mechanism; this plan stops planning spawns it would refuse, and does not move
   the refusal.
4. Auto-dispatch names a claimed branch it skipped, once per pulse at most —
   a message repeated every 5 s is noise, not a diagnostic.
5. **No host call is added to the scan's path.** Asserted by the existing
   no-network test: the claim comes from refs the scan already reads.
6. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### The switch was working the whole time

The operator's report was *auto-dispatch does not work*, and the switch was
functioning exactly as written — it dispatched every pulse, into a refusal. Four
separate facts each looked correct in isolation (`eligible`, `approved`, `open`,
budget available), and only replaying the planner against the pulse showed the
budget landing elsewhere.

That is the argument for item 4: the fleet had no way to say *I spent it here*.

### It belongs to this sprint's subject

*The board tells the truth in every section.* A switch that reports itself as on
and enabled, while every pulse spends its budget on a refusal, is a control
whose state is honest and whose effect is invisible.
