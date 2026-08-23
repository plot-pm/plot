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
| `waiting on approval` | 13 | approve the plan, or leave it |
| `someone is on it` | 8 | nothing — and that is a real answer |

Every one of those is actionable or explicitly closes the question. `eligible`
was neither.

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

- A row on an **unapproved** plan never reads as startable. Twelve rows today
  would change; assert on that shape, not on the count.
- A row whose branch is **claimed** or **wip** never reads as startable — four
  rows today.
- The **eight** genuinely startable rows still say so.
- **`verdict` is unchanged on the payload**, and `--next` returns the same branch
  before and after. Assert it: this is a rendering change, and a fix that alters
  the scan's answer has changed the fleet's ordering.
- The status word a reader sees and the note beside it **agree** — today one says
  `eligible` and the other says *plan not approved yet*.
- **Every sentence in WAITING ON YOU names something a reader can do.** The
  section means *a person owes this something*; a head reading *work landed —
  waiting to be merged* over branches with no PR names nothing. Verify against
  `a-draft-plan-claims-no-approvals`, which owns that fix, rather than duplicating
  it here.
- `pnpm run test:board` green; artifact rebuilt and committed.

## Waves


### Answered (Branch: bug/the-row-says-whether-you-can-start-it)
- slot 5 carries startability derived from phase, state and verdict; `eligible` stays on the payload and stops being what a row displays

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
  "round": 1,
  "questionHistory": [
    {"q": "Does the defect still reproduce?", "a": "Yes and worse - re-measured 26 eligible / ~5 startable, against the draft's 25/8. 13 are Discovery plans the phase gate refuses, 8 are wip/claimed/merged", "category": "technical"},
    {"q": "Is the wave-head note half still real?", "a": "No - groupedNote's false 'work landed' fallback was removed by #339 today and the string is absent from packages/board/src. Dropped from scope, recorded rather than deleted", "category": "technical"},
    {"q": "Replace the word, or keep eligible and add a note?", "a": "REPLACE - a startability verdict. A note leaves the reader reading an unactionable word first. eligible survives in the SCAN, where it is a true measurement about waves", "category": "ux"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
