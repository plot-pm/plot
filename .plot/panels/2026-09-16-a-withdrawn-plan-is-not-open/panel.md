# Panel — a-withdrawn-plan-is-not-open

**Reconciled: `divided` — amend=premise,blast-radius,semantics · proceed=value**

Four lenses, one rubric, four committed positions. Every juror ran the
derivation rather than reading the plan's numbers back, and the moderator
re-verified each load-bearing finding below before recording it.

## The division is narrower than 3–1 makes it look

**No juror disputes the defect, the layer, or the fix.** All four confirmed that
`rules/phase.ts:140`'s `default:` arm answers for `rejected`/`superseded`, that
the fix belongs in that rule rather than in the counter, and that the shipped
sprint-side vocabulary is the right model.

The single `proceed` is not a disagreement about the plan's correctness. `value`
explicitly records the same two factual errors as the others and calls them
*"imprecise rather than false"*, then adds its own amendment about the gate's
brittleness. **It is the same reading with a different threshold for what
requires a re-draft** — and on the one question only it was asked (is a cheaper
archive move better?) it argued the opposite of its brief and lost the argument
on measurements.

So the panel's shape is: **unanimous on the diagnosis, unanimous that the plan as
written cannot be implemented, divided on whether that warrants the word amend.**

## Three findings the moderator re-verified

**1. The plan counts itself, and its headline gate is unreachable.**
Found independently by `premise` and `blast-radius`; verified here.

```
$ node skills/plot/scripts/board/plot-ask.mjs fleet
estateTotals: {"total":288,"open":12,"wip":0,"done":276}
```

**12, not 11.** The twelfth is this plan's own file, `State: Draft` on
`origin/main` — correctly open. The gate *"falls from 11 open to 0"* is wrong at
both ends: the floor is 1 while the plan lives, and 0 arrives only after the plan
is Delivered, which is after the branch must satisfy the gate.

This is the shape this estate rejects plans for: a measurement taken before the
plan file existed, asserted as a post-condition.

**2. `open` is the bucket, not the status — 10 of 11 report `draft`.**
Found independently by all four. `default:` answers
`review === 'pr' ? 'open' : 'draft'`, and ten withdrawn plans are
`Review: in-session`. The counter is right because `estateTotals` buckets
`draft`, `open` and `approved` together; the plan's title, changelog and Design
prose all describe a `status: open` that one plan out of eleven has.

The slice line is correct. The narrative around it is not.

**3. There is a SECOND switch, and the plan names one.**

```
$ grep -n "switch (status)" packages/board/src/server/fleet.ts
6808:      switch (status) {      <- activeSprints
6875:    switch (status) {        <- estateTotals
```

Both end `default: continue`, which drops a member from every bucket **and from
`total`**. `SprintFilter.tsx` documents the invariant the pair exists to keep:
*"Estate totals and sprint numbers use the SAME bucket derivation, so they cannot
disagree about what a bucket means."* Editing one breaks exactly that.

`blast-radius` measured why this is not hypothetical: five withdrawn plans name
the active sprint and miss the counter only because their sprint lines are
`~~struck through~~`, so `parseSprintMembers` never extracts the slug. **An
accident of markdown, not a guard.**

## The arithmetic question the plan does not answer

`semantics` and `blast-radius` reached this independently and it is the finding
with the largest scope.

`SprintCountsSchema` is `{total, open, wip, done}` and its docstring says
*"Always equals `open + wip + done`"*. A withdrawn member must either get a
fourth key — changing that docstring, `formatCounts`, and the **sprint** rows
that share the renderer — or leave `total`, which makes the estate total stop
being the plan count.

**The plan's `Done when` presupposes the first without saying so**, and its
four-file cost list names neither `SprintCountsSchema` nor `SprintFilter.tsx`.

## What the lenses had in common, and what that hid

All four read the SERVER. Three of the four named `SprintFilter.tsx` only when
chasing the bucket arithmetic, and none examined the rendered string as a
reader sees it. The one client-side question that was asked — what a pre-change
client does with a new value — `blast-radius` answered reassuringly and
correctly: the client casts rather than parses, client and server ship as one
artifact, and no payload is persisted.

**The shared blind spot is the word on screen.** `formatCounts` renders
`N plans · N open · N WIP · N done`. Every juror discussed which bucket a
withdrawn plan belongs in; none asked what the fourth label should say, or
whether a reader glancing at the sprint filter wants a fourth number at all.
That is the question the arithmetic decision actually turns on, and the panel
reached it from four directions without naming it.

## Two citation errors, both cheap

- **`phaseOfPlanState` does not exist.** The function is `toBoardPhase`
  (`phase.ts:41`). Verified: the only occurrence on the estate is the plan's own
  sentence. The quoted docstring is verbatim correct and the argument survives.
- **The Board-impact comment is false.** `board.ts:1956` runs
  `if (!mapped) continue` and `toBoardPhase` returns `null` for both phases, so a
  withdrawn plan **renders no card at all**. Nothing "gains a status".

`semantics` also found a paragraph that is already false on main —
`fleet.ts:3824`, *"Plot has four phases and none of them is withdrawn"* — which
eleven plans now contradict. This estate's convention is to amend such a
paragraph rather than let it break quietly.

## What the panel settles rather than disputes

**The archive-directory alternative is closed.** `value` was briefed to argue for
it and argued against it with measurements: 372 references to `docs/plans` across
the tree, 18 shell scripts reading the config key, inbound markdown links, and
264 Released plans that stay put. Moving the files would make the count read 0 by
making the plans invisible, leaving the rule wrong for the next rejection.

**The recurrence is measured.** Five withdrawals in August, six in September —
**a rate, not a one-off.** That is what separates this from `fe39198e`, which
moved three files that were never plans.

**The word is right.** `ItemStatus.withdrawn` and a plan's `withdrawn` are one
meaning over two subjects, and the item's value is *derived from* the plan's
phase — unlike Slice/Wave, which were two concepts under one name. The plan must
state that argument; it currently presents the precedent without asking the
question.

## The moderator's reading

**Divided, and the majority is right on the mechanics.** The plan's diagnosis
survives every check. Its `Done when` cannot be satisfied as written — not
because a gate is weak, but because two of its numbers are wrong and a third
presupposes a schema field that does not exist. A worker handed this would have
to choose the arithmetic themselves, which is the decision the plan exists to
make.

`value`'s amendment stands alongside the others rather than against them: assert
the count over a **fixture** estate of known composition, not the live census,
which changes every time somebody rejects a plan.

**Nothing here moves the plan's phase.** The panel is a mechanism; the caller
decides.
