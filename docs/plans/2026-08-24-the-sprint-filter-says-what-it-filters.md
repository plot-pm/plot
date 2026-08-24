# The sprint filter says what it filters

> An unlabelled checkbox beside a sprint name, one number that counts 17 of 21
> members, and an arrow whose meaning a reader has to ask about.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** <!-- not a member of the-board-tells-the-truth-in-every-section -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches

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
| **Done** | delivered |

**`Done` is `Delivered`, not `delivered or released`**, and the distinction is
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

### Named (Branch: feature/the-sprint-control-names-its-state)
- a labelled **Sprint only** toggle; `Sprint:` before the name and `target`
  before the release

### Counted (Branch: feature/a-sprint-counts-every-member)
- `Open / WIP / Done` over exactly the members, summing to a printed total; the
  four `status` buckets give way to three exhaustive ones

### Compared (Branch: feature/the-filter-shows-what-it-excludes)
- estate totals while off, sprint numbers while on, from one derivation

## Done when

1. **The toggle is labelled `Sprint only`** and its on/off states are
   distinguishable without hovering.
2. **The line reads `Sprint: <name>` and `target <version>`.**
3. **The three counts sum to the member total**, asserted over this repo's
   sprint: `21 = 4 + 0 + 17`. This is the assertion the current shape fails.
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
