# A claimed branch is not startable

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-27, Jan Wloka, `feature/the-pulse-says-a-branch-is-claimed`
- **Started:** 2026-08-27, Jan Wloka, `bug/auto-dispatch-skips-a-claimed-branch`

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

### Half of this was fixed on 2026-08-27, and half was not

`an-eligible-wave-can-be-started` merged as **#470** and taught the scan a new
`unapproved` verdict. Auto-dispatch gates on `wave.verdict !== 'eligible'`
(`auto-dispatch.ts:194`, `:228`), so **13 waves of unapproved plans are now
skipped before the budget is touched**. The starvation-by-Draft-plan half of the
original report is gone.

**The claimed half is untouched, and it is the one this plan is named for.**
Re-measured the same day, minutes after five branches were dispatched:

```
eligible branches: 5
  feature/a-ticket-becomes-a-story              state=wip
  bug/a-dead-fetch-is-not-a-slow-one            state=wip
  bug/a-reaped-worktree-takes-its-manifest      state=wip
  bug/the-board-says-how-old-its-plans-are      state=wip
  feature/a-stopped-worker-can-be-restarted     state=wip
```

Every one has a claim ref, a worktree, and a **live worker**. Every one reports
`wip`, and `isStartable` returns true for `wip`. So auto-dispatch counts all five
as startable and would plan spawns for branches that are already being worked on.

The refusal is immediate and silent:

```
$ plot-dispatch.sh --dry-run a-dead-fetch-is-not-a-slow-one
summary: dispatched=0 reused=0 skipped=0 started=0
```

`dispatched=0` **and** `skipped=0` — an empty set, with nothing to say about what
was filtered out of it. That is the same shape `a-stopped-worker-can-be-restarted`
documents from the other side, and it is why this defect survived a month
unnoticed.

**Five concurrent examples is a stronger measurement than the plan's original
one** (a single July branch), and it shows the defect scales with fleet activity
rather than being a stale-claim curiosity.

### Why the pulse cannot see it

`isStartable` reads the branch's pulse state:

```ts
function isStartable(state: string): boolean {
  return state === 'open' || state === 'wip';
}
```

`open` means *no PR* — it says nothing about whether a ref exists. Measured
across the estate the same day, of the four branches that `planAutoDispatch`
considered startable:

| branch | pulse | claimed |
|---|---|---|
| `feature/opus5-hardening-ralph-bounds` | open | **yes** |
| `bug/the-loop-bounds-its-child` | open | **yes** |
| `feature/a-running-worker-says-if-it-is-idle` | open | **yes** |
| `feature/the-board-says-which-registry-it-read` | open | no |

**Three of four were not startable at all.** The one that was is the one that
never got a turn.

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

### Startable means a dispatch could claim it

`isStartable` is a statement about the *branch's work*; whether a dispatch can
proceed additionally requires that **no ref holds it**. The claim is the fact
`plot-dispatch.sh` already checks, and the pulse already knows how to report
branch facts — the scan reads refs to derive `merged` today.

So the pulse carries whether a branch is claimed, and `planAutoDispatch` skips
the claimed ones when counting `startable`.

**Read from the scan, not from a live `git ls-remote`.** `maybeAutoDispatch`
runs inside the scan's success path and must stay off the request path; adding a
network call per candidate branch would put host latency into the pulse. The
scan already walks refs.

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

### Seen (Branch: feature/the-pulse-says-a-branch-is-claimed, PR: #478)

The pulse reports whether each branch has a ref holding it, derived by the scan
from the refs it already walks.

### Spent (Branch: bug/auto-dispatch-skips-a-claimed-branch)

`planAutoDispatch` counts only unclaimed branches as startable, and names the
claimed ones it skipped.

## Done when

1. With one claimed and one unclaimed startable branch and a budget of 1, the
   **unclaimed** one is dispatched. Asserted with the claimed branch belonging to
   the earlier plan in file order — the measured shape, and the one a fix that
   merely reorders plans would pass without.
2. **A branch with no ref is still startable.** The ordinary case must not
   regress: a fix that treats every branch as claimed stops the fleet entirely
   and passes item 1.
3. `plot-dispatch.sh` is unchanged. Its ref-push claim stays the locking
   mechanism; this plan stops planning spawns it would refuse, and does not move
   the refusal.
4. Auto-dispatch names a claimed branch it skipped, once per pulse at most —
   a message repeated every 5 s is noise, not a diagnostic.
5. **No host call is added to the scan's path.** Asserted by the existing
   no-network test: the claim comes from refs the scan already reads.
6. **A claimed branch WITH A LIVE WORKTREE is not counted startable.** The
   danger case, and the one item 1 does not reach: where a worktree survives,
   `plot-dispatch.sh` ADOPTS it rather than refusing, so the phase gate never
   fires and a worker starts on merged work. Measured twice on 2026-08-27 — six
   workers on six already-merged waves, two of which opened PRs ~120 commits
   behind main. A fix asserted only against the no-worktree case passes items
   1-5 and leaves the revert risk exactly where it is.
7. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.

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

### Interrogated 2026-08-27

Two questions, and the first found the Motivation half out of date.

**#470 closed the Draft half hours before this round.** Auto-dispatch gates on
`verdict !== 'eligible'`, and unapproved plans now report `unapproved`, so 13
waves are skipped before the budget is spent. The plan's original narration — a
July plan starving every plan behind it — no longer describes what happens.

**The claimed half survives, and today measured it five times over.** Five
branches dispatched minutes earlier all report `wip` with a claim ref, a
worktree, and a live worker; `isStartable('wip')` is true for every one. A
dry-run dispatch against one answers `dispatched=0 skipped=0` — an empty set that
says nothing about what it filtered. That is a better measurement than the
original single example, and it shows the defect scales with fleet activity.

**Both waves ship together.** `Seen` alone publishes a fact nobody consumes;
`Spent` is what stops the wasted budget. The deferred `Taken` wave of
`an-eligible-wave-can-be-started` needs only `Seen`, and gets unblocked when it
lands either way — waves run in order, so `Spent` starts when `Seen` merges.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "#470 fixed the Draft half \u2014 how should the Motivation record what survives?", "a": "Rewrite around the surviving claimed case, crediting #470, with today's five-branch measurement as the evidence", "category": "technical"},
    {"q": "Dispatch both waves or only Seen, which unblocks Taken?", "a": "Both \u2014 Seen alone publishes a fact nobody consumes; Spent is the payoff", "category": "tradeOffs"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": false, "edgeCases": true, "errors": true, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

### Correction 2026-08-27: the cost is not only a wasted budget

Round one described the defect as *budget spent on an action that is refused
before it does anything*. That is the harmless half, and it holds only where the
branch has no worktree.

**Where a worktree survives, nothing refuses.** `plot-dispatch.sh` adopts an
existing worktree rather than creating one — `reusing existing worktree for
<branch>` — so the phase gate never fires and a worker starts on merged work.
Twice in one hour on 2026-08-27:

| cycle | branches started | already merged as |
|---|---|---|
| 14:56 | an-unreachable-host-says-so | #446 |
| | the-board-reads-approval-not-phase | #458 |
| | the-worktree-root-is-configurable | #445 |
| later | a-bitbucket-issue-is-a-ticket | #449 |
| | a-plan-cites-a-jira-key | #447 |
| | a-jenkins-build-has-a-status | #450 |

Six workers, six merged waves. Two of them opened PRs — **#473 and #476** — each
carrying a branch **~120 commits behind main**, each of which would have reverted
that much work had the fleet's auto-merger taken it green. #473 was closed by
hand; #476 needed the same.

The first cycle also exhausted GitHub's secondary rate limit: eight concurrent
workers against a cap of seven, three of them doing nothing that needed doing.

**So `isStartable` returning true for `wip` is not merely wasteful — it is the
step before a revert.** The `Spent` wave is what stops it, and the danger case
is the one to assert: a claimed branch WITH a live worktree, which is the
population the refusal never reaches today.

**A second-order fix is already available and does not replace this one.**
`plot-reap.sh` would have removed those six worktrees, but it refuses them —
`unlanded work — no merged PR` — because their PRs were squash-merged and a
squash leaves the branch permanently ahead of main. It says that about **11
branches** in this estate. Reaping them narrows the population; it does not stop
auto-dispatch counting a claimed branch startable.
