# The row says whether you can start it

> The board shows `eligible` on 25 rows. A reader can start 8 of them. `eligible` answers *has every prior wave landed* — a true answer to a question nobody asked.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-24, Jan Wloka, in-session
- **Started:** 2026-08-24, Jan Wloka, `bug/the-row-says-whether-you-can-start-it`

## Approval

- **Assignee:** Jan Wloka

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

### An absent verdict renders NOTHING, not a fallback

The verdict is a new contract field, and the board **casts** the payload rather
than parsing it (`board as Board`), so a Zod `.default` never fires client-side:
a field an older server omits arrives as `undefined`. Three plans have already
been caught by exactly this — `FLEET_CONTROLS_DEFAULT`, `fleet.waves`, and
`working` on the parallel-agents stepper.

**Where the field is absent the row renders no startability word at all.**

The tempting fallback is to render today's `eligible`, and it is rejected
deliberately: it would keep the word this plan exists to remove alive on exactly
the servers nobody has upgraded, and the promise *"no row says `eligible`"*
would quietly mean *"no row on a current server"*. A word that is wrong 21 times
in 26 is not a safe default just because it is the incumbent.

Nothing is the honest rendering — the server did not say. It reads as an older
board rather than a wrong one, and **the row keeps every other cell**: kind,
name, links, age. Only the startability word is missing, which is precisely the
fact that was not sent.

### The brief is read from the row, not from the filesystem

The verdict needs four facts. Three — plan phase, branch state, claim — are
already `classify`'s arguments. The fourth, whether a brief exists, is a
filesystem question, and asking it per branch per pulse would cost 79 `stat`
calls every 5 seconds on this repo: ~57,000 an hour, against a scan that has
spent repeated measured effort staying cheap.

**It does not need to be asked.** The row already carries `brief`, and
`needsBrief(row)` already reads it. The verdict consumes the same field and adds
no filesystem work. Where the field is absent the verdict degrades to
`start work` rather than inventing a `stat` — the brief gap is then reported by
`briefGapNote` exactly as it is today.

### The scan keeps `eligible`, and the two must not disagree

`plot-fleet-scan.sh --next` also answers *what can I start*, and
`plot-dispatch.sh` refuses branches this plan would call `waiting on approval`
or `needs a brief`. **Their facts already agree** — the scan's phase gate
refuses an unapproved plan, and dispatch reports `brief=missing` — so what
differs is only the word.

Neither is changed here. What is added is an assertion that they stay in step:
**a branch the row calls `start work` is one `--next` would hand out.** Without
it the two vocabularies drift, and the failure is the worst kind — a reader
starts what the fleet then refuses, which is the promise/refusal mismatch this
plan is already trying to end one level up.

Teaching the scan the same four words would be more coherent and is not done: it
is consumed by the board, dispatch and the fleet, so it is a far larger change
than a board wording fix.

### The way back is a revert, and deliberately not a switch

Unlike the scan's rate-limit fix, this carries no runtime cost and no
wrong-state risk: the worst outcome is a word a reader dislikes. Nothing
silently miscounts, no budget drains, no wave fails to complete.

A `PLOT_ROW_VERDICT=0` escape was considered and rejected. It would be a second
code path to test on every change, and — the deciding reason — it would keep
`eligible` alive in the tree as a supported rendering. **This plan exists to
remove that word**; a flag that preserves it concedes the point while appearing
to hedge.

### Not chosen: keep `eligible` and add a note beside it

Considered and rejected 2026-08-23. The note would carry the actionable half
while the reader still reads an unactionable word first, and the board would
show two facts where one answer was wanted. The row's job is to answer *can I
start this*.

### `someone is on it` covers wip and claimed — and NOT merged

The measurement bucketed three states under that word, and one of them does not
belong:

| state | count | verdict |
|---|---|---|
| `wip` — commits pushed | 6 | `someone is on it` |
| `claimed` — a session took the ref | 1 | `someone is on it` |
| `merged` | 1 | **not a startability verdict at all** |

**`wip` and `claimed` share one word** because both mean *not yours*, which is
the entire actionable content; a reader who needs to chase the claimant has the
row's own worker note. Distinguishing them would buy a distinction nobody acts
on differently.

**`merged` is split out, because finished work is not someone working.** A row
saying otherwise is the defect fixed tonight in
`a-closed-pr-is-an-ended-artifact` wearing different clothes — an artifact that
ended, described as activity. A merged branch already reads `merged`, and
startability does not apply to it: there is nothing to start.

### A Draft plan's row points at TWO routes, not one

`waiting on approval` names what is missing; the acts belong to the plan head,
which already carries them. There are two, and the row must not imply only the
second exists:

- **Create PR** — the default route. `Review: pr` is what every plan in this
  repo declares, and the approval IS the plan PR being reviewed and merged.
- **Approve** — the shortcut. `/api/approve` performs the mechanical half
  directly, for a plan whose review has happened elsewhere.

Naming only *Approve* would teach readers that the shortcut is the path, and the
reviewed-PR route would quietly become the exception. **The default must be the
one that looks default.**

Neither act moves onto the branch row. `a-plan-moves-through-the-sections`
settled that lifecycle acts live on the plan head, and this plan is about what a
row SAYS, not what it can do — the word points, the head acts.

### Computed in `classify`, beside the group it must agree with

`classify` already receives every fact the verdict needs — plan phase, branch
state, worker, claim — and already returns a derived triple
(`{ group, note, verdict }`). The startability verdict joins it.

Deriving it anywhere else would traverse the same inputs a second time and put
the verdict out of reach of the group and note it must stay consistent with: a
row cannot say `start work` in one field and sit in `waiting-on-you` in another.
One site, one traversal, one answer.

### Open Questions

<!-- Both of this plan's open questions were resolved in interrogation round 4;
     their answers are the three sections above. -->

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
- **No row renders `eligible` WHERE THE FIELD IS PRESENT.** Asserted as absence
  across every section — this is the defect, and a fix that adds the new words
  while leaving the old one somewhere reads as an improvement in every other
  test. Qualified deliberately: a pulse that carries no verdict renders no word,
  which is the next assertion.
- **An absent verdict renders NO startability word, and the row keeps every
  other cell.** Asserted with a pulse whose rows omit the field — the
  cast-not-parsed trap that has caught three plans before this one. Asserted as
  absence rather than as a fallback string, because rendering today's `eligible`
  would keep the removed word alive on every un-upgraded server.
- **The verdict adds no filesystem work.** It reads the row's existing `brief`
  field; asserted by construction (where the value comes from), since 79
  branches on a 5 s pulse would be ~57,000 `stat` calls an hour.
- **A branch the row calls `start work` is one `plot-fleet-scan.sh --next` would
  hand out.** The two vocabularies must not drift: a reader starting what the
  fleet then refuses is the promise/refusal mismatch this plan exists to end.
- **A MERGED branch carries no startability verdict.** Asserted as absence:
  finished work is not someone working, and a row claiming otherwise is
  `a-closed-pr-is-an-ended-artifact`'s defect in another form. This is the case
  the measurement bucketed wrongly, so it is the one an implementation reading
  that table would get wrong.
- **`wip` and `claimed` produce the SAME word.** Asserted with both states in one
  test, so a later change that splits them has to say why.
- **A `start work` row is coloured and the others are not.** Asserted on the
  rendered class, and paired with an assertion that `waiting on approval`,
  `needs a brief` and `someone is on it` keep the ordinary colour — a tone
  applied to all four would mean nothing, which is what `waitingTone`'s rule was
  protecting against.
- **`waitingTone`'s docstring no longer claims `click` gets no colour.** Its
  reasoning is overridden by this plan, and a rule that reads as current after
  being overridden is how the next reader reverts the change. Asserted by
  reading the comment, which is the one assertion here a test cannot make — so
  it belongs in review.
- **The verdict is computed in `classify` and travels with `group`.** Asserted by
  construction: a row's verdict and its group come from one call, so no fixture
  can produce a row that says `start work` while sitting in `waiting-on-you`.
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

## Waves


<!-- COLLIDES WITH `the-fleet-knows-its-sprints`, in flight 2026-08-24 on
     `schema.ts` and `fleet.ts` — the two files this branch must also edit
     (`classify` lives in fleet.ts, the contract field in schema.ts).
     DISPATCH AFTER that wave merges. Tonight produced four artifact
     re-conflicts and one 2616-line hunk that ended a refactor; the branches
     that survived were the ones whose collisions were known before they
     started, not the ones that discovered them at merge time. -->

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
  "round": 5,
  "questionHistory": [
    {"q": "Rounds 1-4 (recorded above)", "a": "see plan body", "category": "technical"},
    {"q": "waitingTone gives `click` no colour, but the wave rule colours what is actionable - which applies to `start work`?", "a": "OVERRIDE waitingTone: colour it, matching an-eligible-wave-takes-the-actionable-tone. The cost (section and colour agree in NOT STARTED) is stated, and waitingTone's comment must be updated rather than left standing", "category": "ux"},
    {"q": "A worker is editing schema.ts and fleet.ts right now - the same files this branch needs", "a": "Record the collision as a scope guard on the wave; dispatch after that wave merges", "category": "tradeOffs"},
    {"q": "How is this rolled back?", "a": "Revert. No switch - a flag would keep `eligible` alive as a supported rendering, which is the word the plan exists to remove", "category": "technical"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": true,
    "nonFunctional": {"security": false, "performance": true, "scalability": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
