# One wave row, two contents

> A wave row says different things depending on how many branches it holds —
> not different CONTENTS, which is right, but a different vocabulary and a
> different subject, which is not.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** <!-- not a member of the-board-tells-the-truth-in-every-section -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-24, Jan Wloka, in-session

## Changelog

- A wave row names its wave whether it holds one branch or five. A wave of one
  keeps showing that branch's own condition — what it stops doing is renaming
  itself after the branch.
- A wave row states its verdict in the wave's vocabulary. `delivered` stops
  being hard-coded per section where the wave already says `complete`.

## Motivation

### The rule this is measured against

A wave row should say the same things whichever kind it is. The slots are the
same; only two of them legitimately hold different CONTENT:

| slot | multi-branch | single-branch |
|---|---|---|
| name | the wave's name | **the wave's name** |
| what it contains | `3 branches` | the branch, linked |
| status | the composite | that branch's own condition |
| verdict word | the wave's | **the wave's** |

Two rows, one grammar. Measured against that rule on the live board
2026-08-24, two slots have drifted and two have not.

### The name is replaced, not supplemented

| plan | waves | the row shows |
|---|---|---|
| `a-plan-moves-through-the-sections` | 2 | **Reachable**, **Started** |
| `a-draft-plan-claims-no-approvals` | 1 | `bug/a-wave-head-says-what-its-verdict-says` |
| `a-marker-is-a-file-not-a-mention` | 1 | `bug/a-marker-is-a-file-not-a-mention` |

The names are in the payload — those rows carry `wave: "Derived"` and
`wave: "Named"`, and the server's wave list agrees. Nothing is missing from the
data.

`AgentList.tsx:1520` sets `soleRow={wg.rows.length > 1 ? undefined : wg.rows[0]}`,
and `soleRow` means *the branch speaks for this wave*. It was written for a
measured defect: a finished single-branch wave read `approved — nobody has taken
it` over PR #323, because the verdict sentence answered an ordering question
about work already done. Showing the branch's own condition is the fix, and it
is correct.

**But the condition is a STATUS, and the name is an IDENTITY.** Letting the
branch speak for the wave's status is the rule; letting it speak for the wave's
NAME was never argued for and is what a reader sees as inconsistency.

### Two words for one condition

`feature/the-sprint-file-names-its-members` reads **`delivered`** while its five
siblings read **`complete`**. All six merged; the payload gives all six
`verdict: complete`.

`delivered` is not the branch's state word. It comes from
`groupedWord={key === 'done' ? 'delivered' : …}` (`AgentList.tsx:1516`) — a word
chosen by SECTION, passed into the row, and reached only when `groupedCount` is
defined. A one-branch wave has no `groupedCount`, so it falls through to the
branch's own note instead, and the two renderings print different words for the
same fact.

The section is not the subject. A wave in DONE is `complete` because its
branches merged, and that verdict is already computed and already on the wire.

### What is NOT drifting

The other two slots differ because the rows differ, exactly as they should:

- **A count where a name would be.** `3 branches` is what a collapsed wave
  contains; a wave of one shows the branch, which is more useful than `1 branch`.
- **A composite status where a single condition would be.** `2 merged, the rest
  not yet` says something no single branch can.

Neither is touched.

## Design

### The name is the wave's, always

Slot 1 holds the wave's name in both renderings. `soleRow` keeps its licence
over the STATUS slot — that is what it was written for and the defect it fixed
is real — and loses it over the name.

Where a wave has no name, `waveLabel` withholds it as it does today: printing
`(unnamed)` beside a branch names nothing. Withholding a label is not the same
as substituting a different subject's.

### The verdict word comes from the wave

`groupedWord` stops being chosen by section. A wave row states the wave's own
verdict — `complete`, `eligible`, `blocked` — which the payload already carries
and which both renderings can reach, `groupedCount` or no `groupedCount`.

`delivered` remains the right word for a BRANCH row, where `stateWord` maps a
merged ref to Plot's own lifecycle word. That argument is about branch-vs-git
and is untouched.

### The fold changes one thing, and it already does

The composite status is a property of the WAVE, not of the fold: an expanded
wave row keeps it while its branches show individually.

This is not a new rule — it is the one the code already follows. The only
`expanded`-dependent behaviour on the row is the change mark, gated on
`expanded === false` because *"open, it is a duplicate"* — the branches flash for
themselves. Nothing else asks about the fold, and nothing else should start.

## Waves

### Named (Branch: bug/a-wave-row-names-its-wave)
- slot 1 holds the wave's name in both renderings; `soleRow` keeps the status
  slot and loses the name

### Spoken (Branch: bug/a-wave-row-speaks-its-own-verdict)
- the verdict word comes from the wave, not from the section; `delivered` stays
  a branch row's word

## Done when

1. **A one-branch wave row shows the wave's name.** `a-draft-plan-claims-no-approvals`
   shows **Derived**, `a-marker-is-a-file-not-a-mention` shows **Named** —
   asserted by name, because a test for *"not the branch name"* passes on an
   empty string.
2. **It still shows that branch's own condition.** The #323 defect must not
   return: a finished single-branch wave does not read `approved — nobody has
   taken it`. Asserted directly, since this is the reason `soleRow` exists.
3. **A multi-branch wave row is unchanged** — name, `3 branches`, composite
   status.
4. **An unnamed wave still withholds its label** rather than substituting a
   branch name.
5. **Six merged waves of one plan print one word.** No row reads `delivered`
   while its siblings read `complete`.
6. **A branch row still reads `delivered` where its ref merged.**
7. **An expanded wave row keeps its composite status**, and its branches show
   their own — asserted, because this plan states the rule and a later change
   should have to break a test to change it.
8. `pnpm run test:board` green; artifact rebuilt and committed.

## Notes

### Round three: `soleRow` does not touch the name either

The Design above says `soleRow` should keep the status slot and lose the name.
Traced at `rows.tsx:965`, it never had the name: `tupleFromWave` is called with
`name: group.wave` **unconditionally**, and `soleRow` feeds only `soleStatus`,
`solePr` and `solePlan`. `tupleFromWave` then renders
`facts.name || UNNAMED_WAVE_LABEL` (`tuple-row.ts:1150`).

The payload agrees: both rows arrive as `kind: 'wave'` carrying `wave: "Derived"`
and `wave: "Named"`. The server is right, the tuple is right, and the rows ARE
waves.

**So the name is dropped somewhere after `tupleFromWave` and before the screen**
— in how the wave tuple's name slot is rendered, not in whether it is populated.
The implementing session should start from `TupleRowView`'s handling of
`name.what === 'plan'` with an empty `href`, which is the one thing that
distinguishes this slot from a branch row's.

The `Spoken` wave is unaffected: `groupedWord` is chosen by section at
`AgentList.tsx:1516` and that is measured, not inferred.

### Three earlier readings, all wrong

**"The wave never grouped."** Refuted by `planHeads` (`AgentList.tsx:905`),
which requires `waveGroupsFor(...).length > 0` — the plan head only renders if
the wave grouped, and both plans have heads.

**"`isOneWavePlan` at the render site is the fix."** Refuted with it: the
trigger is BRANCHES PER WAVE (`soleRow`), not waves per plan. The two coincided
in the reported screenshot, which is why the wrong reading looked right.

**"`soleRow` replaces the wave's name."** Refuted above. Each round moved the
suspected site one layer down and each was wrong in the same direction —
inferring a mechanism from a symptom rather than reading the call. The fourth
attempt should READ THE RENDER, not reason about it.

Recorded because each cost a round, and the visible symptom points at the wrong
layer in both.

### Not chosen: render a one-branch wave exactly like a multi-branch one

Dropping `soleRow` entirely makes the two identical, which sounds like the point
of this plan and is not. The branch's condition is information no verdict
carries, and removing it restores a measured defect. The rule is one GRAMMAR,
not one content.
