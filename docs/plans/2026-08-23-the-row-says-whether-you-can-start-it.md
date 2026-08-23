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

Measured on the live board, 2026-08-23:

```
rows whose wave is eligible          25
rows a reader could actually start    8
```

**Seventeen rows say `eligible` and cannot be started.** The reasons are all
facts the board already holds:

```
plan not approved — the phase gate fails closed      12
work already pushed — someone is on it                3
already claimed by another session                    1
already merged                                        1
```

### The same defect on a WAVE HEAD, and there it is also false

Reported in the same session: a folded wave head in WAITING ON YOU reads
**"work landed — waiting to be merged"** and a reader cannot act on it.

**It is worse than unactionable — it is untrue.** Traced 2026-08-23 on
`a-dispatch-hands-over-a-brief`: no PR was ever opened on any of its three
branches, no ref was ever pushed, and nobody merged anything. The sentence is
false in every part.

It comes from `groupedNote`'s fallback (`AgentList.tsx:753`):

```ts
default: return 'work landed — waiting to be merged';   // any unrecognised word
```

**A `default:` that asserts.** Any word the switch does not know produces a claim
about landed work.

**That is the same shape as `eligible`, one level up:**

| | what it says | what the reader asks |
|---|---|---|
| branch row | `eligible` — every prior wave landed | can I start this? |
| wave head | *work landed, waiting to be merged* | is there something for me to do? |

Both put a value in the reader's slot that answers a different question — and
both sit beside a note or a row that holds the right answer. On the live board
right now, 22 of 25 WAITING ON YOU rows say **"plan not approved yet — still in
review"**, which *is* actionable: approve it. The heads above them do not.

`a-draft-plan-claims-no-approvals` (Draft, in this sprint) owns the `default:`
fix. **This plan and that one are the same finding at two levels** — a row's
status and a head's note — and should be read together. Where they meet, that
plan owns the note and this one owns the status word.

### `eligible` is a correct answer to the wrong question

The scan computes three wave verdicts:

```sh
if   outstanding == 0 ; then verdict="complete"
elif prior_ok == 1    ; then verdict="eligible"
else                        verdict="blocked"
fi
```

`eligible` means exactly one thing: **every prior wave in this plan has landed.**
It is a fact about **ordering inside a plan**, and it is the right fact for the
scan to compute — `--next` uses it, and the wave model rests on it.

It is not what a reader of a row is asking. **They are asking *can I start this*,
and that question has four gates, of which wave order is one:**

| gate | owner | refuses |
|---|---|---|
| wave order | the scan | a prior wave has not landed |
| **plan phase** | `plot-dispatch.sh`, fails closed | **an unapproved plan** |
| the claim | the ref push | a branch another session took |
| a live worktree | dispatch | unlanded work at an occupied desk |

The board reports the first and stays silent on the other three, so a status word
that reads like permission is true one time in three.

### The board already computes the right answer, one cell away

The note beside the status already says it:

> **approved — nobody has taken it**

That sentence *is* the dispatchable answer, rendered on the same row — while the
status word next to it says `eligible`. The row holds both the question a reader
asks and the answer to a different one, and puts the wrong one in the slot that
reads as a verdict.

**Every input is present.** `phase`, `state`, `verdict` and the claim all reach
the row. Nothing needs fetching; one derivation needs relocating.

## Design

### The row's status answers the reader's question

Slot 5 stops carrying the wave's ordering verdict and starts carrying **whether
this can be started**, with the reason when it cannot:

```
startable                     approved, open, unclaimed — go
needs approval                the plan is a draft
taken                         claimed, or work already pushed
blocked by <wave>             an earlier wave has not landed
```

**`blocked` survives unchanged** — it is already an act-shaped answer, and the
`blockedBy` link makes it navigable. Only `eligible` is replaced, because it is
the one verdict that reads as permission and is not.

### The verdict does not go away — it stops being the row's status

`verdict` remains on the payload, remains the scan's answer, and remains what
`--next` and the wave model consult. **This changes what a ROW SAYS, not what the
system computes.** The wave keeps its verdict; the row stops borrowing it to
answer a different question.

That distinction is the model's (`docs/board-domain-model.md`): a question is
answered by the status of the entity it is about. *Can I start this branch* is a
question about a **branch's availability**, not about a **wave's ordering**.

### `statusTone` follows, and it finally has something to colour

The tone rule is *colour what a reader acts on*. Today `eligible` takes the
actionable tone — which paints twelve unapproved plans as ready to start.

Under this change **`startable` takes it and means it.** `a-startable-wave-says-so`
(Draft, in this sprint) proposed exactly that colouring; this plan is the reason
it can be correct rather than misleading, and the two should land together or
that plan should be folded here.

### What NOT to do

**Do not remove `eligible` from the payload.** It is the wave's verdict, the
scan's own vocabulary, and the basis of the ordering the whole fleet depends on.
This is a rendering change.

**Do not compute a fifth vocabulary.** The four answers above are derived from
`phase`, `state` and `verdict` — all present. A new field would be a fifth place
that knows how to answer, which is the defect class this release exists to remove.

### Open Questions

- [ ] Does `taken` distinguish *claimed but nothing pushed* from *work in
      progress*? They are different situations — a claim may be a dead worker —
      and the board has `state: claimed` versus `wip` to tell them apart. Probably
      yes, but it adds a fifth word.
- [ ] Should the eight startable rows offer *Start work* and the seventeen others
      not? The plan-head actions already gate on something similar; check
      `an-approved-plan-offers-its-two-starts` before adding a second gate.

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
