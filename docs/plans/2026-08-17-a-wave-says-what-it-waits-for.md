# A wave says what it waits for

## Status

- **Phase:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Approved:**
- **Started:**
- **Delivered:**
- **Released:**

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

- `feature/the-row-carries-its-verdict` — `verdict` becomes a field on
  `AgentRowSchema`, written by `classify()`, additive and defaulted; the
  `complete`/`blocked` collapse at `fleet.ts:1054` is split so a finished
  wave stops claiming to block

### Line

- `feature/a-wave-gets-its-own-row` — NOT STARTED renders a wave row
  between the plan and its branches, reading `row.wave` for the first
  time

### Count

- `feature/a-blocked-wave-names-its-blocker` — the blocked wave's row
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
