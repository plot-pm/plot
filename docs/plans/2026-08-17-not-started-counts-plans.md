# NOT STARTED counts plans, because its branches do not exist yet

## Status

- **Phase:** Delivered
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-17, Jan Wloka, plan-PR #188 merged
- **Started:** 2026-08-17, Jan Wloka, `feature/not-started-counts-plans`
- **Delivered:** 2026-08-17

## Problem

Asked on 2026-08-17, from a screenshot of the agents tab: *should the
animated indicator and the status sit beside the **branch**, or — when a
plan is blocked in NOT STARTED — beside the **plan**? The branch is only
the vehicle there, isn't it? In WAITING ON YOU the branch is itself the
subject.*

The measurement says yes, and more sharply than the question puts it.

### In NOT STARTED the branch is a name and nothing else

Every row in that section, measured live:

```
plan=activity-shows-itself  branch=feature/activity-marker-glows      pr=—  age=—
plan=activity-shows-itself  branch=feature/group-shows-inner-activity pr=—  age=—
plan=activity-shows-itself  branch=feature/unpushed-work-shows-still  pr=—  age=—
plan=plot-sprint-support    branch=feature/plot-sprint-support        pr=—  age=—
```

**`pr=—` and `age=—` on all of them.** The branch has no commit, no PR,
no tip — most have not been created at all. The name comes from the
plan's `## Branches` section; it is a *plan for a branch*, not a branch.

Compare WAITING ON YOU in the same pulse: **4 rows, all 4 carrying a real
PR with a real age** (#57 at 22d, #116 at 30m, #186 at 7m). There the
branch is the subject, because it holds work that exists.

**One row shape, two meanings** — the defect this board keeps finding,
this time not in a field but in the identity of a row.

### So the section over-counts

**6 rows for 4 plans.** `activity-shows-itself` appears three times, once
per unstarted wave. The plan is waiting once; the board says so three
times, and the two extra rows carry nothing the first does not.

Worse, they are not equal: waves 3 and 4 are *blocked by an earlier
wave*, which resolves itself when their predecessor merges. Only the
first wave is actually startable. So of the three identical-looking rows,
one is an invitation and two are noise.

### Two clocks, and the row shows the wrong one here

The question's follow-up — *plan age versus branch-change age* — names a
distinction the contract already draws:

| Field | Measures | Answers |
|---|---|---|
| `ageMinutes` | since the branch tip moved | *is anyone still working here?* |
| `waitingDays` | since the plan was approved | *has this been sitting?* |

`schema.ts:1015` states it: *"A DIFFERENT CLOCK from `ageMinutes`, and
deliberately its own field … Overloading one field with two meanings is
precisely the ambiguity that makes `22d` (no commits for three weeks)
unreadable beside `22d` (never begun)."*

**And that half is already built.** `waitingDays` is computed, reaches
the row, and renders in amber with the title *"Approved this long ago,
and nobody has started it"*. `plot-sprint-support` carries **187**.

So this plan does not introduce the second clock. It inherits it — and
the clock is the strongest argument for the change, because 187 days of
waiting is a fact about a **plan**, printed today on three rows that
share it or on one row whose branch does not exist.

## Design

### The plan is the row; its waves fold beneath it

**Collapsed by default, expandable — not summarised away.** The first
draft said the waves become a *detail* of the plan row. Interrogation
kept the plan row and rejected the erasure: the branch names are the
plan's own words for what it will do, and a reader who wants them should
not have to open the plan file to get them back. They are folded, not
discarded.

This also fits what the section already is. `groupByPlan`
(`AgentList.tsx:394`) exists and groups these rows today; what is missing
is that the group has no head of its own and no folded state. This plan
gives it both.

**The cost, stated:** the section gains a second level of folding, on top
of the group-level collapse that WAITING ON YOU and friends already have.
That is real, and it is bounded — the inner fold exists only where a plan
has more than one unstarted wave, which is exactly where the three
identical rows appear today.

One row per plan, not per unstarted branch. It carries:

| Cell | Content |
|---|---|
| Indicator | beside the plan, where the state holds |
| Plan | the plan's name — the subject |
| Status | what it is waiting for |
| Age | `waitingDays` — the plan's clock |

**The wave count and the first eligible wave show on the plan row** — *3
waves, first eligible* — and the individual waves sit folded beneath it.
The reader learns what they actually need in one line instead of three,
and can still open the three.

**The summary is derived from the group's own rows, not from a new
field.** Measured: `waveSummary` lives on the CARD; a row knows only its
own wave. But the group *holds* every row of the plan in this section, so
counting them and reading their states answers *how many, and which is
first* without touching the contract.

The limit is worth recording rather than hiding: this counts the waves
**in this section**, so a plan whose first wave already merged shows two
where the plan file lists three. That is the honest number for the
question the section answers — *what is not started* — and a reader
wanting the full arc has the plan link on the row.

**The indicator moves to the plan because that is where the state
holds.** This is the same rule the other sections follow rather than a
new one: in WAITING ON YOU the marker sits with the branch because the
branch is what waits. Same rule, different subject.

### What this does not change

**Every other section keeps the branch as its row.** WAITING ON YOU,
WORKING, WAITING ON A MACHINE, QUIET and DONE all hold branches that
exist, with real PRs and real tips. The change is confined to the one
section whose rows are not branches.

That is a real cost and worth stating: **the six sections stop sharing
one row shape.** `agent-rows-line-up` established that they should, and
its reasoning holds for every section whose rows are the same kind of
thing. NOT STARTED's are not — and forcing them into the shared shape is
what produces `pr=—`, `age=—`, and three rows for one plan.

**The grid tracks stay.** Phase, plan, branch, status, age, menu — a plan
row fills them differently (the branch cell carries the wave summary),
but every column keeps its x. A reader scanning down the board does not
lose alignment at the section boundary.

**No contract change.** `waitingDays` exists and the rows carry `plan`
already; the wave count is derived from the group's own rows. This is a
grouping and a sort in the view, not a new fact.

### The deferred case keeps its branch

`state === 'deferred'` rows are the exception, and they are why this is
not simply "group by plan". A deferred branch **has** been started — it
may hold commits and a PR — and it landed in NOT STARTED because someone
shelved it, not because it never began.

Measured in `fleet.ts`: three of the six paths into `not-started` are
deferred branches, and they carry exactly what the others lack. The
comment there warns against flattening them: an earlier version wrote
`deferred` as the note and *"a branch started and then shelved read as
never begun, with its age and its PR erased."*

**So deferred rows stay branch-rows**, with their own age and PR, and
they sit **beneath their own plan row**, in the fold with that plan's
other branches. Grouping them into a separate "shelved" section at the
end was the alternative and was rejected: it separates a deferred branch
from the plan that explains it, and plan-proximity is what makes the
section readable at all.

A plan with one unstarted wave and one deferred branch therefore shows a
plan row with two branches folded under it — one that never began and one
that was set down. Both keep their own words.

### The section's sort is broken today, and this fixes it

**Measured while planning:** `groupByPlan` sorts by

```ts
const urgency = (g) => Math.max(...g.rows.map((r) => r.ageMinutes ?? -1));
```

In NOT STARTED `ageMinutes` is `null` on **every** row, so every group
scores `-1` and the sort does nothing. `plot-sprint-support` — approved
**187 days** ago — sits wherever the map's insertion order happens to put
it, beside a plan drafted this afternoon.

So the section sorts by `waitingDays`, **oldest first**. It is the only
clock that ticks here, which is the same reason the row shows it: the
branch clock has nothing to say about work that never began.

Sorting startable-first was considered and rejected. It reads as more
actionable and buys less: the startable plans are already marked, and
burying a six-month-old plan under a fresh one would hide exactly the
drift this section exists to surface.

## Branches

### Grouping

- `feature/not-started-counts-plans` — NOT STARTED renders one row per
  plan with the plan's clock and a wave summary derived from its own
  rows, the branches folded beneath it and expandable; the section sorts
  by `waitingDays`, oldest first; deferred branches keep their own rows
  under their plan; the indicator sits with the plan → #191

## Done when

- **A plan with three unstarted waves shows ONE row by default**, with
  its three branches folded beneath it. Assert the live shape:
  `activity-shows-itself` with waves 2–4 unstarted renders one row.
- **The fold OPENS and the three branch names come back.** Assert every
  branch name is reachable — the pairing that matters: an implementation
  that summarises the waves away passes the assertion above and loses the
  plan's own words for what it will do.
- **A plan with ONE unstarted wave gets no inner fold.** Assert no
  expander where there is nothing to expand — a control that reveals one
  row it already shows is noise.
- **The row's age is `waitingDays`, not `ageMinutes`.** Assert
  `plot-sprint-support` reads 187 days rather than blank — today its
  branch has no tip, so the branch clock says nothing about the six
  months the plan has waited.
- **The wave summary is on the row and derived from the group's rows.**
  Assert it names how many waves remain and that the first is eligible —
  and assert no contract field was added to carry it.
- **The summary counts only what is in this section.** Assert a plan
  whose first wave already merged reports the remaining waves, not the
  plan file's total — the honest number for the question this section
  asks.
- **The section sorts by `waitingDays`, oldest first.** Assert
  `plot-sprint-support` (187 days) sorts above a plan approved today. The
  pairing that matters: `groupByPlan`'s existing `ageMinutes` sort scores
  every group in this section `-1`, so a test that only checks "the
  groups are ordered" passes against a sort that does nothing.
- **A deferred branch keeps its OWN row, with its own PR and age**, and
  sits beneath its own plan row rather than in a separate section. The
  pairing that matters: an implementation that simply groups by plan
  passes every assertion above and erases exactly what the `fleet.ts`
  comment warns about — a started-then-shelved branch reading as never
  begun.
- **Every other section is unchanged.** Assert WAITING ON YOU, WORKING,
  WAITING ON A MACHINE, QUIET and DONE still render branch rows, byte for
  byte.
- **The grid tracks do not move.** Assert a plan row's columns land at
  the same x as a branch row's — the section boundary must not break
  alignment.
- **The indicator sits with the plan** on a plan row, and with the branch
  on a deferred row.
- **No contract change.** Assert the grouping is derived in the view from
  fields the rows already carry.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
  `pnpm run validate` all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present, with its `bumps:` block.

## Notes

The question also asked whether the *order* in NOT STARTED is wrong. It
is not the order — it is the unit. Reordering cells on a row whose
subject does not exist would have moved the symptom.

Half of what the question identified turned out to be built already: the
plan clock (`waitingDays`) versus the branch clock (`ageMinutes`) is
drawn in the contract, computed, and rendered in amber with an explaining
title. `plot-sprint-support` carries 187 days today. This plan inherits
that distinction rather than introducing it — and it is the strongest
argument for the change, because 187 days is a fact about a plan that the
board currently prints on a row named after a branch nobody ever created.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "groupByPlan already exists — how far should the folding go?", "a": "Expandable, not summarised away: the branch names are the plan's own words", "category": "ux"},
    {"q": "groupByPlan sorts by ageMinutes, which is null on every row here", "a": "Sort by waitingDays, oldest first — the only clock that ticks in this section", "category": "technical"},
    {"q": "waveSummary is on the CARD, not the row — where does the count come from?", "a": "Derived from the group's own rows; no contract change, and the limit is recorded", "category": "technical"},
    {"q": "Deferred rows have PR and age — where do they sit?", "a": "Beneath their own plan row; a separate section would cut them from what explains them", "category": "ux"}
  ],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "ux": {"happyPath": true, "edgeCases": true, "accessibility": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
