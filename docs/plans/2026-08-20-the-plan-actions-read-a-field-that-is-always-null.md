# The plan actions read a field that is always null

> Reported: *"Hier fehlen immer noch die Plan Actions, dafür hatten wir ein Bug
> fix gemacht."* Measured on the live board 2026-08-20: **all four rows in
> WAITING ON YOU carry `waitingOn: null`**, and `canApprove` /
> `canCommissionDesign` both require `waitingOn === 'you'`. The predicates cannot
> be true there, so the actions never render.
>
> There is exactly **one** assignment of the field in the server — `fleet.ts:4003`
> — and it writes `null`.

## Status

- **Phase:** Superseded
- **Type:** bug
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Superseded:** 2026-08-22, by `a-plan-moves-through-the-sections` — same defect, and this plan's fix is disproved

## Problem

### The field has a narrow contract and is read as a broad one

`schema.ts` on `waitingOn`, verbatim:

> *"What this row is waiting for … **Null outside `not-started`**, and null is the
> honest answer there rather than a fourth value: a row being worked on, or
> waiting on CI, is not waiting for one of these three things."*

So `waitingOn` answers *"what is this **not-yet-started** work waiting for"* —
`you`, `click` or `time`. Outside NOT STARTED it is null **by design**, and the
comment says so.

Four consumers read it, and three of them are on rows that live in WAITING ON YOU:

| site | predicate | fires where |
|---|---|---|
| `AgentList.tsx:1243` | `waitingOn === 'click' && state === 'open'` | NOT STARTED — **correct** |
| `AgentList.tsx:2981` | `canCommissionDesign`: `waitingOn === 'you' && state === 'open'` | intended for a Draft plan row |
| `AgentList.tsx:3457` | `canApprove`: `isDraft(card) && approve && waitingOn === 'you'` | same |
| `AgentList.tsx:3526` | the menu pairs the two on that basis | same |

### The measurement

From `/api/fleet`, the whole WAITING ON YOU section:

| row | state | waitingOn |
|---|---|---|
| `feature/opus5-longhorizon-hardening` | open | **null** |
| `changeset-release/main` | open | **null** |
| `bug/a-dispatch-without-a-brief-refuses` | open | **null** |
| `feature/the-board-asks-for-a-brief` | open | **null** |

**Four of four.** And the two brief-plan rows carry `note: "plan not approved yet
— still in review"` — precisely the rows *Approve* and *Commission design* exist
for.

### The comment that records the misreading

`AgentList.tsx:3454`:

> *"`waitingOn === 'you'` is the row's own word for *a person must act*"*

It is not. It is the row's word for *a not-yet-started piece of work is waiting for
a person*. The author read a field with a narrow contract as a general predicate,
and the schema's own comment two files away says otherwise.

**This is why `the-menu-fits-the-kind` (#280) did not fix it.** That wave built a
per-kind menu correctly; its plan half hangs on a condition that no row in the
section it renders can satisfy. The menu is right and its gate is dead.

## Design

### The predicate asks the question it means

*A person must act on this plan* is the intent. Two candidate readings, and the
plan picks the first:

- **`group === 'waiting-on-you'`** — the section's own membership, which is the
  board's existing answer to *does this need a person*. The row is already there;
  the predicate can say so.
- Populate `waitingOn` outside NOT STARTED. **Declined**: the schema argues null is
  the honest answer there, and a fourth value would have to mean *waiting for a
  person in general* — which is what the group already means. Two fields for one
  fact is how they drift.

So `canApprove` and `canCommissionDesign` read the group plus what they already
read about the plan (`isDraft(card)`, `state === 'open'`). `waitingOn` keeps its
narrow contract and its one correct consumer at 1243.

### The `state === 'open'` half stays

It is not redundant. A merged or deferred branch can sit in WAITING ON YOU — a
merged PR awaiting a delivery record, for instance — and neither action applies
there. The measurement shows all four rows `open`, but that is today's estate, not
a rule.

### What must not change

- **`AgentList.tsx:1243`.** `waitingOn === 'click'` is a NOT STARTED predicate on
  a NOT STARTED row and is correct. This plan does not touch it.
- **The field, the schema and its comment.** They are right; the readers were
  wrong.
- **`the-menu-fits-the-kind`'s structure.** Per-kind menus stay; one gate changes.
- **The refusal rule.** An action that cannot act still refuses with its reason on
  the control. Making the gate fire must not make it fire where it cannot act.

### Open Points

- [ ] Are there other readers of narrow-contract fields used as general
      predicates? `waitingDays` has the same shape — documented as *"only `open`
      branches carry it"* — and a consumer treating it as *age in days* would be
      wrong the same way. Worth one grep, not a wave.

## Slices

### Gated (Branch: bug/the-plan-actions-fire-where-they-apply)
- `canApprove` and `canCommissionDesign` stop reading `waitingOn` and read the section's membership instead. Tests: a Draft plan row in WAITING ON YOU offers **Approve** and **Commission design**; the same row with `state` merged offers neither; a NOT STARTED row still gets its `waitingOn === 'click'` treatment unchanged; a row in WORKING offers neither; the actions still refuse with their reason on the control where they cannot act; `waitingOn` has no new writer.

## Notes

Reported by the operator, who remembered a fix had been made — and it had. #280
built the per-kind menu; nothing in it was wrong. Its plan-side gate reads a field
whose contract excludes the section the menu renders in.

The shape is the third instance today of one pattern: **a predicate keyed on a
field that cannot carry the meaning asked of it.** `isReadyToStart` read
`phase === 'Design'` after Design stopped meaning approved-unstarted;
`inMachineSection` admitted any process because an agent is a process; this reads
`waitingOn === 'you'` where the contract says null. Each was correct when written
and each was read one level too literally afterwards.

## Why this plan is superseded

`a-plan-moves-through-the-sections` (PR #310) covers the same defect and was
interrogated twice before approval. Two of this plan's conclusions did not
survive that:

**The proposed fix is wrong.** This plan would have `canApprove` and
`canCommissionDesign` *"read the section's membership instead"*. Measured while
interrogating the successor: a branch **blocked by an earlier wave** is in
`waiting-on-you` too when its plan is Draft (`open/blocked` + `draft` →
`waiting-on-you`), so that predicate puts Approve back on a row whose available
act is not its own — the very defect the `waitingOn === 'you'` clause was added
to prevent. The successor deletes the row-level controls instead, because no
gate makes a plan-level act correct on a branch row.

**The count of writers has gone stale.** *"Exactly one assignment of the field
in the server — `fleet.ts:4003`"* no longer holds: there are two today, a
computed one and the planless `null`, and neither sits at that line.

**What survives is the measurement**, and it has been carried into the
successor's Motivation: on 2026-08-20 every row in WAITING ON YOU carried
`waitingOn: null`, reported by a reader as *"Hier fehlen immer noch die Plan
Actions"*. The successor reaches the same conclusion from the other direction,
by evaluating `waitingOnFor` over its whole input space. Two independent
measurements, one defect.
