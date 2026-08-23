# The row says whether you can start it

> The board shows `eligible` on 25 rows. A reader can start 8 of them. `eligible` answers *has every prior wave landed* — a true answer to a question nobody asked.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A row now says whether you can start it, instead of showing a wave-ordering verdict that is true on three times as many rows as a reader can act on.

<!-- Board impact: board-only. packages/board/src/app/lib/tuple-row.ts (the status
     word) and src/server/fleet.ts (where the answer is derived). Rebuild. -->

## Motivation

Measured on the live board, **2026-08-23 (re-measured after the day's merges)**:

```
rows whose wave is eligible          26
rows a reader could actually start    ~5
```

**Twenty-one rows say `eligible` and cannot be started**, and every reason is a
fact the board already holds:

```
plan is Discovery/Draft — the phase gate refuses    13
already wip — someone is on it                       6
already claimed by another session                   1
already merged                                       1
```

`eligible` answers *has every prior wave landed*. That is true, it is what
`plot-fleet-scan.sh` means by the word, and it is **not the question a reader
asks of a row.** They ask *can I start this*, and on 21 of 26 rows the honest
answer is no.

### The measurement moved, and got worse

An earlier draft of this plan recorded 25 eligible / 8 startable. Re-measuring
today gives 26 / ~5 — the ratio did not improve as the estate churned, which is
what makes this structural rather than a bad afternoon.

### What is NOT in scope any more: the wave-head note

This plan also cited a second defect — a folded wave head reading **"work landed
— waiting to be merged"** over branches where no PR was opened and no ref pushed.

**That is fixed.** `groupedNote`'s false fallback was removed in **#339**
(merged 2026-08-23) and the sentence no longer appears anywhere in
`packages/board/src`. Verified by grep before dropping it.

It is recorded here rather than deleted silently, because a plan that ships a
fix for a defect that no longer exists spends a branch and misleads its
reviewer — and because the two halves shared a cause worth remembering: a word
chosen for what the code could compute rather than for what a reader needed.

## Design

### The row states a STARTABILITY verdict, and `eligible` stops being shown

One word, computed from every fact the board already holds — prior waves landed
**and** the plan approved **and** not claimed **and** nothing already pushed:

| the row says | live count | what a reader does |
|---|---|---|
| `start work` | ~5 | start it |
| `needs a brief` | see below | run `/plot-implement` to write one |
| `waiting on approval` | 13 | approve the plan, or leave it |
| `someone is on it` | 8 | nothing — and that is a real answer |

Every one of those is actionable or explicitly closes the question. `eligible`
was neither.

### `start work` must mean START IT, which is why there are four words

A fourth verdict exists because the third would otherwise lie. `needsBrief`
already ships in `row-identity.ts`, and its docstring carries the measurement:

> Measured 2026-08-19: nine eligible rows on this board, zero briefs. Every one
> read *eligible — nobody has taken it*, and every dispatch it invited would
> have started an agent that reads a file which is not there.

A branch with no brief is not startable in the sense `start work` promises. The
`Worker command` opens by telling the agent to read `.plot/briefs/<slug>.md`, so
dispatching such a row starts an agent that fails on its first read — a
**worse** outcome than the row saying nothing, because the reader acted on it.

Folding this into `start work` and qualifying it with a note would rebuild the
defect one level down: a word that means *go* except when a smaller word beside
it says otherwise is the same shape as `eligible` plus its reasons. **The
verdict must be the whole answer.**

`briefGapNote`'s wording is reused unchanged — this plan adds a verdict, not a
second vocabulary for the same fact.

### `eligible` survives where it is true — in the SCAN

**This changes the board's word, not the model's.** `plot-fleet-scan.sh` keeps
`eligible` and keeps meaning *every prior wave landed*: it is a correct
measurement about waves, other components read it, and the fleet's ordering
depends on it.

What changes is that the **row** stops rendering a wave-ordering fact as though
it were an instruction. The verdict is still on the wire; the row derives its
own word from it plus the plan phase and the branch state.

**Derive it in the server, where the row is created.** `schema.ts`'s standing
rule: *"a derivation is a guess with a rule attached"* — and the renderer does
not hold the plan phase to join on.

### The phase gate is the biggest single reason, and it must be named

Thirteen of twenty-six eligible rows belong to **Discovery/Draft** plans, where
`plot-phase-gate.sh` refuses the commit. The row must not merely fail to offer a
start — it must say the plan needs approving, because that is a thing the reader
can go and do.

### ONE predicate, and the menu reads it

`isStartable` already lives client-side and gates the row menu's *Start work*
action:

```ts
export function isStartable(row: AgentRow): boolean {
  return row.waitingOn === 'click' && row.state === 'open';
}
```

**It becomes a read of the new verdict, not a second computation of it.** Two
predicates answering *can I start this* is exactly the duplication
`the-wave-is-a-thing-the-board-can-hold` spent four waves removing, and here it
has a specific failure: the row could say `start work` while the menu refuses,
or offer *Start work* on a row the verdict called `waiting on approval`. That
promise/refusal mismatch is the hazard `waveSummaryFor`'s own docstring already
names — *"the summary cannot promise an action the menu then refuses"* — and
keeping two implementations is how it comes back.

The server derives once, where the plan phase is in scope; the row renders the
word and the menu reads the same field.

### Not chosen: keep `eligible` and add a note beside it

Considered and rejected 2026-08-23. The note would carry the actionable half
while the reader still reads an unactionable word first, and the board would
show two facts where one answer was wanted. The row's job is to answer *can I
start this*.

### Open Questions

- [ ] Does `someone is on it` need to distinguish **claimed** (a session took
      the ref) from **wip** (commits pushed)? Both mean *not yours*, which is
      the actionable content. Prefer one word unless a reader needs to chase the
      claimant.
- [ ] Should a row whose plan is Draft offer **Approve** directly, now that the
      plan row carries plan-level actions? It would close the loop the count
      exposes — 13 rows one click from startable — but it puts a lifecycle
      decision on a branch row, which `a-plan-moves-through-the-sections`
      deliberately moved to the plan head.

## Done when

- **Every verdict is reachable, one test each**, building the state that
  produces it: `start work`, `needs a brief`, `waiting on approval`, `someone is
  on it`. Asserted on fixtures rather than against the live estate — the live
  counts belong in Motivation, and they move: this plan already records them
  going from 25/8 to 26/5 while it was being written, so an assertion on them
  would fail for reasons that are not regressions.
- **An exhaustiveness test:** every value the verdict can take is produced by
  some fixture. A verdict nothing constructs is one nobody has read, and it is
  how a fifth case gets added without a reader ever seeing it.
- **No row renders `eligible`.** Asserted as absence across every section — this
  is the defect, and a fix that adds the new words while leaving the old one
  somewhere reads as an improvement in every other test.
- **A row with no brief reads `needs a brief`, never `start work`.** This is the
  assertion that keeps the third word honest; without it an implementation that
  ignores `needsBrief` passes everything else.
- **The row and the menu never disagree.** `isStartable` reads the verdict, so a
  row saying `start work` offers *Start work* and a row saying anything else does
  not. Asserted directly, because the promise/refusal mismatch is the failure
  two predicates produce.
- **The scan is unchanged.** `plot-fleet-scan.sh` still reports `eligible` and
  still means *every prior wave landed*; other components read it and the
  fleet's ordering depends on it. Asserted by running the scan's own suite
  untouched — this plan changes the board's word, not the model's.
- `pnpm run test:board` green; artifact rebuilt and committed.

## Branches

### Answered

- `bug/the-row-says-whether-you-can-start-it` — slot 5 carries startability derived from phase, state and verdict; `eligible` stays on the payload and stops being what a row displays

## Notes

Reported 2026-08-23: *"why do we show the user eligible and not dispatchable?
Users can't act upon eligible."*

The measurement is the whole argument — 25 rows say it, 8 can be acted on — and
the cause is the one this release keeps finding: **a status belonging to one
entity answering a question about another.** `eligible` is the wave's ordering
verdict; *can I start this* is a question about a branch's availability.

The fix is small because the board already has every input and already renders
the right sentence in the note. What is wrong is which of the two goes in the
slot that reads as a verdict.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {"q": "Round 1 (recorded earlier)", "a": "see plan body", "category": "technical"},
    {"q": "The plan never mentions the brief, but needsBrief ships and a briefless dispatch starts an agent that reads a missing file", "a": "A fourth verdict `needs a brief` - start work must mean start it; folding it in as a note rebuilds the eligible defect one level down", "category": "domain"},
    {"q": "isStartable already answers 'can I start this' client-side - two predicates?", "a": "The menu reads the new verdict; derive once in the server where the phase is in scope", "category": "technical"},
    {"q": "Prove against fixtures or the live estate?", "a": "Fixtures, one per verdict, plus exhaustiveness - the live counts move and belong in Motivation", "category": "nonFunctional"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": true,
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
