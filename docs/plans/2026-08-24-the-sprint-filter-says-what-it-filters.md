# The sprint filter says what it filters

> An unlabelled checkbox beside a sprint name, one number that counts 17 of 21
> members, and an arrow whose meaning a reader has to ask about.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** <!-- not a member of the-board-tells-the-truth-in-every-section -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-24, Jan Wloka, in-session
- **Started:** 2026-08-24, Jan Wloka, `feature/the-fleet-carries-the-sprints-members`
- **Started:** 2026-08-24, Jan Wloka, `bug/the-agents-tab-filters-on-membership`
- **Started:** 2026-08-24, Jan Wloka, `feature/the-sprint-control-names-its-state`
- **Started:** 2026-08-24, Jan Wloka, `feature/a-sprint-counts-every-member`

## Changelog

- The sprint control says what it does: a **Sprint only** toggle rather than an
  unlabelled checkbox, and `Sprint:` before the name so the line reads as a
  sprint rather than a title.
- It states the effect of turning it on: estate totals while off, the sprint's
  own numbers while on, in `Open / WIP / Done` with the member count beside
  them.
- Every member lands in exactly one bucket. Four of this sprint's 21 members
  currently land in none.

## Motivation

### What the control shows today

```
[ ] The board tells the truth in every section  → 2.9.0
    17 delivered
```

Three things a reader cannot get from that:

**What the checkbox does.** Unlabelled, beside a name, it reads as *select this
sprint* — a row-selection idiom. Nothing says the board will filter to it, and
nothing says which state is which.

**What turning it on would change.** `17 delivered` is already sprint-scoped, so
the control shows one side of a comparison and never the other. A reader cannot
tell whether filtering hides three plans or three hundred.

**What the arrow means.** `→ 2.9.0` is the sprint's TARGET release, and 2.9.0 is
unreleased — latest tag `v2.8.0`, `package.json` at `2.8.0`. The arrow is
correct and was still read as *"2.9.0 is already released, right?"*, which is the
measurement that it does not communicate.

### The Agents tab does not filter

The control is honest about being ON. What sits behind it is not: with the
toggle green, the Agents tab renders plans that are not members of the sprint —
`a-citation-is-not-a-claim`, `one-wave-row-two-contents`,
`the-sprint-filter-says-what-it-filters`, `a-worker-asks-for-the-next-wave`.
None appears in the sprint file.

`AgentList.tsx:416` is the whole of the filter:

```ts
fleet.rows.filter((r) => r.sprint === '' || sprintFilter.has(r.sprint))
```

**Two faults, and they compound.**

*The empty-sprint escape is far wider than the case it was written for.* Its
comment defends the release row and unplanned PRs — rows with no plan and so no
sprint to carry. Measured: **55 of 95 rows have an empty sprint, and 53 of those
are plan work** (48 waves, 5 branches). Exactly **2** are the release row and the
PR. The hatch admits every plan that lacks a `Sprint:` back-reference.

*It joins on `r.sprint` — the field `Repointed` (#386) moved away from.* That
wave added `sprintMembershipLookup`, joining on the sprint file's own plan array
(`sprint.members`) precisely because the inline back-reference is unreliable: 21
members, 5 carrying the field.

**And the Agents tab could not have been repointed with the others.** #386
changed `Board.tsx` and `Swimlanes.tsx`, which read the BOARD payload — and
`board.sprints` carries `members`. `AgentList.tsx` reads the FLEET payload, and
`fleet.sprints` carries `{slug, title, release, counts}` and **no members at
all**. The Agents tab kept the old join because the new one had nothing to join
against.

That is why one genuine member renders beside four non-members: the member
passes by membership, the others pass through the hole.

### Four members are counted by nothing

`counts` is `{delivered: 17, deliverable: 0, inProgress: 0, approved: 0}` over a
sprint with **21 distinct members**. The four missing are all `Phase: Draft`:
`a-folded-row-still-says-what-matters`, `loose-checks-what-it-promises`,
`the-page-is-as-tall-as-the-screen`, `the-plan-the-board-holds`.

The omission is deliberate and documented (`fleet.ts:5052`): *"a `draft`/`open`
member is committed to but not yet in flight."* True — and it is a different
statement from *the sprint has 21 members*. The four buckets tally `plan.status`,
a derived fact about BRANCH progress; `Draft` is a PHASE. The counts aggregate
over one dimension while membership spans another, so members fall through the
gap rather than being excluded by a rule.

With three zeros beside the 17, the shape also cannot show its own incompleteness:
a reader sees one number and no reason to doubt it.

## Design

### The fleet payload carries the sprint's plan array

`fleet.sprints` gains `members`, the same array `board.sprints` already carries
and the same one `parseSprintMembers` produces from the sprint file. It is the
sprint's own statement of what it contains, and it is the only source this
filter should consult.

This is the prerequisite, not a detail: without it the Agents tab has nothing to
join against, which is why #386 left it behind rather than overlooking it.

### The Agents tab joins on membership, like the other two tabs

`AgentList.tsx` then joins through `sprintMembershipLookup` — the function
`Repointed` already wrote, reading `sprint.members`.

**`passesSprintFilter` itself cannot be reused as it stands.** It takes a `Card`
and keys on `card.slug` (`filters.ts:206`); an `AgentRow` has no `slug`. The join
key is `row.plan`, which carries the same value in the same shape —
`'waves-name-themselves'` against a member's `slug: 'done-means-delivered'`. So
either the predicate is generalised over *(slug, membership)* rather than over a
`Card`, or the tab gets a sibling that takes a row. Generalising is preferable:
one predicate means the three tabs cannot answer differently, which is the point
of the wave.

One rule and one source for all three tabs, so a plan cannot be in the sprint on
one tab and out of it on another.

**A row with no plan is exempt; a row with a plan is not.** The release row and
an unplanned PR are not plans, have no sprint to carry, and hiding them would
erase them from the tab entirely — that is the case the current comment defends
and it is right. The test is the row's own kind (`release`, `pr`, `issue`), not
an empty string, because 53 of the 55 rows the empty string admits today are
plan work.

A plan row whose plan names no sprint is HIDDEN while the filter is on. That is
what *Sprint only* says, and it is the whole point of the control.

### A toggle that names its state

**Sprint only**, as a labelled toggle. On means the board shows this sprint's
plans; off means it shows everything. The label is the sentence the checkbox was
asking the reader to infer.

Two Active sprints may share one release train, so the control stays one row per
sprint and each row carries its own toggle — unchanged.

### `Sprint:` before the name

`Sprint: "The board tells the truth in every section" → target 2.9.0`

The prefix says what kind of thing the line names. `target` says the release is
where the sprint is going, not where it has been — the word the bare arrow left
to inference.

### Three buckets, and a total that makes an omission visible

| bucket | holds |
|---|---|
| **Open** | committed, not started — `Draft` and `Approved` with no branch in flight |
| **WIP** | started, not delivered |
| **Done** | delivered — every plan the board shows in **Testing** |

**`Done` is the Testing column.** That is the plainest statement of it: the
board's Testing column is keyed on `delivered_raw` (`phaseDateOf`,
`board.ts:580`), so *delivered* and *in Testing* are the same population under
two names — the file format's and the board's. A reader comparing the control
against the columns should find the same number in both places, and naming the
column is what makes that checkable rather than coincidental.

**It is not `delivered or released`**, and the distinction is
the sprint's own lifecycle rather than a simplification. A sprint targets a
release; while it is Active that release has not been cut, so **no member of an
Active sprint can be `Released`**. Measured on this repo 2026-08-24: 21 members,
17 `delivered`, 4 `draft`, **zero released**.

Releasing is what ENDS the sprint. `/plot-release` records `Phase: Released` on
the plans it ships, and the sprint stops being Active — so a released member and
an Active sprint are states that do not coexist. A `Done` bucket spelled
*delivered or released* would be describing a population that cannot arrive
while the control is on screen, and the `or` would read as though it could.

Where a released member DOES appear under an Active sprint, that is drift worth
seeing rather than a case to absorb: either the sprint was left Active past its
release, or a plan was released outside it. It counts in `Done` — the work is
done — and `plot-reconcile-scan.sh` section 9 is where the disagreement belongs,
not hidden inside a bucket name.

Every member lands in exactly one, so the three **sum to the member count**, and
the total is printed beside them:

```
21 members · 4 open · 0 WIP · 17 done
```

The sum is the property that matters. Today's four buckets can silently drop a
member; three exhaustive buckets plus a total cannot — the arithmetic fails
visibly.

Deferred members stay excluded, and the count reflects it: they are under
`### Deferred` in the sprint file and are not commitments. That decision was
settled by an earlier plan's open question and is not reopened here.

### Off shows the estate, on shows the sprint

Off: `Total — 112 plans · 9 open · 2 WIP · 101 done`
On: `Sprint — 21 members · 4 open · 0 WIP · 17 done`

The control states the effect of its own toggle. A reader compares the two before
touching it, which is what makes the toggle legible without being tried.

The estate totals are the same three buckets over every plan the board found —
one derivation, two scopes, so the numbers cannot disagree about what a bucket
means.

## Waves

### Carried (Branch: feature/the-fleet-carries-the-sprints-members)
- `fleet.sprints` gains `members`, the sprint file's own plan array — the same
  one `board.sprints` already carries

### Joined (Branch: bug/the-agents-tab-filters-on-membership, PR: #393)
- `AgentList.tsx` filters through `sprintMembershipLookup`/`passesSprintFilter`
  like the other two tabs; the exemption is by row KIND, not by empty sprint

### Named (Branch: feature/the-sprint-control-names-its-state)
- a labelled **Sprint only** toggle; `Sprint:` before the name and `target`
  before the release

### Counted (Branch: feature/a-sprint-counts-every-member)
- `Open / WIP / Done` over exactly the members, summing to a printed total; the
  four `status` buckets give way to three exhaustive ones

### Compared (Branch: feature/the-filter-shows-what-it-excludes)
- estate totals while off, sprint numbers while on, from one derivation

## Done when

1. **With the filter ON, the Agents tab shows only sprint members.** The four
   named above are absent. Asserted on this repo's estate, where the tab
   currently shows them.
1b. **A release row and an unplanned PR stay visible with the filter on.** The
   two rows the exemption exists for — asserted by KIND, so a later change from
   `r.sprint === ''` to a kind test cannot silently drop them.
1c. **A plan row whose plan names no sprint is hidden.** The 53 rows the empty
   string admits today.
1e. **`fleet.sprints` carries `members`**, equal to `board.sprints`'s array for
   the same sprint — asserted equal, since two payloads deriving one fact is how
   they drift.
1d. **All three tabs agree.** One plan, one membership answer, whether the
   reader is on Board, Swimlanes or Agents.
2. **The toggle is labelled `Sprint only`** and its on/off states are
   distinguishable without hovering.
2. **The line reads `Sprint: <name>` and `target <version>`.**
3. **The three counts sum to the member total**, asserted over this repo's
   sprint: `21 = 4 + 0 + 17`. This is the assertion the current shape fails.
3b. **`Done` equals the sprint's plans in the board's Testing column.** Counted
   both ways — through the bucket rule and by filtering the Testing column to
   sprint members — and asserted equal, so the control and the columns cannot
   drift into disagreeing about one population.
4. **A Draft member is counted**, in `Open`. The four named above appear.
4b. **No member of an Active sprint is `Released`** — asserted on this repo's
   sprint, where the phases are exactly `17 delivered, 4 draft`. The assertion
   is what keeps `Done` meaning `Delivered`: if a released member ever appears
   here, the test says so rather than the bucket quietly widening.
5. **A deferred member is counted in nothing**, and the total excludes it —
   deferred is not a commitment.
6. **Toggling off shows estate totals**, computed by the same bucket rule as the
   sprint numbers. Asserted by feeding one plan set through both scopes and
   comparing.
7. **Two Active sprints render two rows**, each with its own toggle and its own
   numbers.
8. `pnpm run test:board` green; artifact rebuilt and committed.

## Notes

### `→ 2.9.0` was right

2.9.0 is unreleased: no `v2.9.0` tag, latest is `v2.8.0`, `package.json` reads
`2.8.0`. The arrow correctly names the sprint's target. It is changed anyway,
because a correct fact that a reader has to ask about is a presentation defect —
the question *"2.9.0 is already released, right?"* is the measurement.

### Not chosen: map the counts to the board's five phases

Discovery / Design / Development / Testing / Released would let a reader compare
the control against the Kanban columns directly, in vocabulary the board already
uses. Rejected because five numbers on a one-line control is a table, and the
question the control answers — *how much of this sprint is left* — has three
answers, not five. The phases remain where they are useful: on the board.
