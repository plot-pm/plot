# A wave says what it waits for

## Status

- **Phase:** Delivered
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-08-19, Jan Wloka, plan-PR #197 merged
- **Started:** 2026-08-20, Jan Wloka, `feature/a-branch-row-names-its-wave`
- **Delivered:** 2026-08-22, jwloka, PRs #257, #275, #286
- **Released:**
- **Started:** 2026-08-20, Jan Wloka, `feature/a-blocked-wave-names-its-blocker`

## Approval

- **Assignee:** jwloka

## Problem

A reader asked the board a question it could not answer: **is a wave the
same as a branch?**

The question arose because the Agents tab never shows a wave. It shows
plans and it shows branches, and between them it prints a count — *3
waves, first eligible* — that names none of them. So the level that
actually decides ordering is the one level with no line of its own.

### The measurement

**`wave` is on every row of the contract and no component reads it.**
`schema.ts:959` declares `wave: z.string()` — not optional, not
defaulted. A grep for `row.wave`, `.wave` and `wave:` across
`AgentList.tsx` returns nothing. The field arrives and stops.

**The verdict never arrives at all.** `plot-fleet-scan.sh:1084-1086`
computes it from the branches of the wave:

```sh
if [ "$outstanding" -eq 0 ]; then verdict="complete"
elif [ "$prior_ok" -eq 1 ]; then verdict="eligible"
else verdict="blocked"; fi
```

`outstanding` counts the wave's non-deferred, unmerged branches. That is
the whole meaning of waiting for a wave: **I wait for every branch in
it.** `rowsFromPulse` (`fleet.ts:1474`) passes `wave.verdict` into
`classify()` — and `classify()` returns only `{ group, note }`. The
verdict dies in that function.

**Three verdicts leave as two sentences, and one of them is wrong.**
`fleet.ts:1054`:

```ts
if (verdict !== 'eligible') return { group: 'not-started', note: 'blocked by an earlier wave' };
```

`blocked` and `complete` both take this branch. For a `complete` wave the
sentence is false — a finished wave blocks nobody. This is the
blocklist-collapse shape `green-never-outranks-unknown` removed from
`prState` days ago, pointing the other way: there the code caught known-bad
values, here it catches everything-but-one-good value.

**The comment above that line defends a sentence the code does not
write.** It argues the wave note wins over the draft note because *"it
names a branch that must land"*. It names no branch. It names no wave. It
is seven words that repeat the group the row is already in.

**The contract already wrote the fix and declined to build it.**
`schema.ts:461-470`, on `ELIGIBLE_NOTE`:

> *"A row carries no `verdict` field, so this sentence is the only place
> that verdict survives onto the row… The better shape is a `verdict`
> field on `AgentRowSchema`, so the split is data rather than prose. That
> widens the row contract two other branches are widening today, so it is
> deliberately not done here."*

Those two branches have landed. The stated reason for deferring has
expired.

## Design

Three waves, each shipping one level of the answer.

### The shape

The wave becomes a row of its own, between the plan and its branches, and
it says what it waits for in numbers:

```
PLAN  activity-shows-itself                          4d
  └ Truth      complete    3/3 merged
  └ Fold       eligible    1 working, 1 free
  └ Colour     blocked     waits for Fold — 2 outstanding
```

The third line is the sentence the board owes today: **which** wave is
being waited on, and **how many branches** are left in it.

### What carries it

`verdict` moves onto `AgentRowSchema` as data, exactly as the contract
proposed. The note keeps existing — it is what a reader hears — but the
verdict stops being reconstructable only by parsing prose.

`wave` needs nothing added; it is already on the row. It needs a reader.

### What this does not do

It does not change grouping. A blocked branch stays in `not-started`,
where `fleet.ts:1061-1064` put it deliberately: nobody has taken it and
nobody should. This plan changes what the reader is told, not where the
row sits.

It does not add a fourth verdict, a progress bar, or an estimate. The
three verdicts the scan computes are the three the board shows.

## Branches

### Carrier

- `feature/the-row-carries-its-verdict` — `verdict` becomes a field on → #257
  `AgentRowSchema`, written by `classify()`, additive and defaulted; the
  `complete`/`blocked` collapse at `fleet.ts:1054` is split so a finished
  wave stops claiming to block

### Line

- `feature/a-branch-row-names-its-wave` — a branch row states which wave it belongs to, in every section. **Not a wave row of its own**, and the measurement is why. → #275

  A row rather than a label was the first design, and it does not survive counting the estate. Measured 2026-08-20 across the 16 unreleased plans: **32 waves over 46 branches, and only 8 of those waves hold more than one branch.** A wave row would add 32 rows to 46 — **+70%** — to group something that in three cases out of four has exactly one member. That is the defect `a-plan-row-is-not-a-branch-row` removed this week, one level down: a level that claims to group what needs no grouping.

  The board also has no room to spare. Its pointer targets are being raised to 24 x 24 px in `the-row-says-what-it-knows` precisely because the grid is tight, and 70% more rows spends the space that fix needs.

  So the wave becomes a **property of the branch row**, which is what the data already says: `row.wave` is on `AgentRowSchema` and `AgentList.tsx:1617` already compares it when deciding whether two rows belong together. The grouping exists; only the naming is missing.

  **The phase column is where it goes.** `toBoardPhase(planPhase, started)` forks in one of four phases, so in the other three that column repeats the plan's own word on every branch — and where it does fork, `started` describes the wave, not the branch. The column is 5rem of grid stating a fact at the wrong level; the wave name is the fact that belongs there.

  **Every branch belongs to a wave; not every wave has a name.** Measured 2026-08-20: of 46 branches, **35 sit in a `### `-named wave and 11 do not** — the scan reports those as `(unnamed)`, because a plan whose `## Branches` section carries no subheading has exactly one wave holding everything. The membership is therefore always answerable and the label sometimes is not, and the two must not be conflated: `a-blocked-wave-is-not-eligible` has **three** branches in one unnamed wave, so an absent name is not the same as an absent grouping.

  **An unnamed wave is not the same as a single-branch wave**, and the count says so: of the five unnamed waves, **four hold more than one branch** (up to three, in `a-blocked-wave-is-not-eligible`). A plan without `### ` subheadings is not a plan with one branch — it is a plan whose author did not need to divide the work. So the label cannot be derived from branch count, and a plan with several branches in one unnamed wave still needs its rows to read as one group.

  **What such a wave can never be is blocked.** Blocking is wave ORDER — a wave waits because an earlier one has unmerged branches — so a plan with exactly one wave has nothing to wait for by construction. That is already handled: `blockedNote(null)` returns *"blocked by an earlier wave"* as the fallback, and `schema.ts` records why — *"a plan with no `###` sub-headings has an unnamed wave and this is all that can honestly be said."* The fallback exists for the case where a LATER wave is unnamed, not for a lone one, which cannot reach that state.

  **A wave name carries information only where the plan has more than one wave**, and that is the rule the label follows — not *"show it when it exists"*. Splitting the estate on both axes shows why:

  | | named | unnamed |
  |---|---|---|
  | **one wave** | 2 plans, 1 branch each | 5 plans, 11 branches |
  | **several waves** | 9 plans, 33 branches | — none |

  The empty cell is the finding: **no plan divides its work without naming the parts**, because the division is expressed by the `### ` heading itself. So *unnamed* and *one wave* are the same population plus two exceptions — `a-plan-row-is-not-a-branch-row` (wave *Layout*) and `the-marker-gets-a-track-of-its-own` (wave *Track*), each a single branch under a name that distinguishes it from nothing.

  Keying on the name's presence would label those two and leave eleven branches bare; keying on the **wave count** labels exactly the rows where the answer to *which slice of this plan?* is not "all of it". A name over a plan's only wave is a caption for a partition of one.

  Where the label is absent, the grouping still shows — consecutive rows of one wave read as one group — and only the caption goes. Nothing is invented: `Wave 1` or the plan's title would put a string on the board that appears in no plan file, which is the class of invention this repo removes.

  Tests: a branch row names its wave in every section that holds branch rows, **wherever the plan has more than one wave**; a single-wave plan shows no wave label whether or not its wave is named — assert both the unnamed and the named case, since the named single-wave plan is what a presence check would get wrong; a plan whose branches all sit in one wave still has its rows group; consecutive branches of one wave read as one group without repeating the name on each row; row height and column alignment are unchanged; below `CARD_BELOW_PX` nothing regresses.

### Count

- `feature/a-blocked-wave-names-its-blocker` — the blocked wave's row → #286
  names which wave it waits for and how many branches are outstanding

## Done when

- A `complete` wave's row does not say *blocked by an earlier wave*.
  The pairing that matters: `verdict !== 'eligible'` passes every
  assertion about blocked waves and is wrong on exactly the finished
  ones.
- `verdict` is on the row as data, additively and defaulted, and
  `ELIGIBLE_NOTE`'s comment is updated to stop describing a shape that
  now exists.
- A plan with three waves shows three wave rows, each named.
- A wave row states its verdict and its branch count.
- A blocked wave names the wave it waits for and how many branches are
  outstanding there.
- A single-wave plan still reads correctly — the wave row must not turn
  one branch into two lines of ceremony.
- Deferred branches are excluded from the outstanding count, matching
  the scan's own arithmetic.
- Every other section is unchanged.
- The grid tracks do not move.
- `[data-live-dot]`, `[data-change-mark]`, `[data-stuck-cue]` and
  `[data-activity-mark]` are untouched.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
`pnpm run validate` all pass; the board artifact is rebuilt in the
implementing worktree and committed; a changeset is present with its
`bumps:` block.

## Notes

The scan is not touched. It already computes every number this plan
displays — `plot-fleet-scan.sh:1084-1086` is the source, and Manifesto
Principle 3 puts the interpretation on this side of the line.
