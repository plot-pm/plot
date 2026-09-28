# A sprint item names a plan or says it has none

> Three readers disagree about an item whose first link is an issue. The shell reads slug `""`; the two TypeScript readers read `"#1039"`. Neither is right, and the format's rule — *the first link is a plan* — is written nowhere.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1045
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

## Changelog

- A sprint item that names an issue rather than a plan is read the same way by all three readers, and is refused at write time if the format cannot express it.

Board impact: sprint membership stops depending on which reader asked.

## Motivation

Measured 2026-09-28. `corpus/sprint-item.corpus.test.ts:265`:

```
plot-observes-and-recovers-its-own-fleet :: item 4 (should) [#1039](…) — **The ::
  slug :: shell=""  typescript="#1039"
```

Three disagreements, one per issue-linked item. **Main was red for six hours** because of it.

| Reader | File | Reads `[#1039](…)` as |
|---|---|---|
| `emit_tier` | `plot-sprint-release.sh:230` | slug `""` |
| `itemsFrom` | `entry/sprint-transition.ts` | slug `"#1039"` |
| `parseSprintMembers` | `server/board.ts` | slug `"#1039"` |

### Why it had never fired

Every sprint item on this estate until W40 links a **plan**, with the issue reference in the prose after it. W40 was the first to make an issue link the subject, because three of its items are tickets that deliberately have no plan yet.

**So the format carries an unwritten rule** — the first link is a plan — that nothing states and nothing enforces. An author following the visible pattern of *link the thing this item is about* writes an item three readers disagree on.

### The TypeScript side is deliberate

`sprint-transition.ts:69-70`:

> The slug group is `(?:\[([^\]]+)\]\s*)?` — optional, and still any bracketed text rather than a slug shape, which is **deliberate**: `[#966](…)` is a reference

So this is not one side having a bug. **Two intentional designs disagree**, which is exactly the class the corpus tier exists to surface.

## Design

### The decision this plan must make first

Three shapes, and the slice argues one before writing code:

- **An issue-linked item has no slug, and all three say so.** Simplest. But `""` is also what a malformed item reads as, so a legal item and a broken one become indistinguishable — and the release gate cannot tell *this Must has no plan yet* from *this Must is unparseable*.
- **An item may name an issue instead of a plan, in its own field.** Truthful and larger: it touches the schema, the release gate's `item_state`, and the board's member list. The gate then has to decide whether an issue-only Must can ever be *done*.
- **Refuse it at write time.** `plot-sprint-state.sh` already refuses nine shapes; a tenth refuses an item whose first link is not a plan. Turns a silent disagreement into a named refusal — and forces every sprint item to have a plan, which W40 demonstrates is not always true when a sprint opens.

**The third is the most Plot-shaped and the most restrictive.** W40 exists as the counter-example: three of its items are real commitments with no plan yet, and a refusal would have blocked the sprint rather than the ambiguity.

**Recommendation to argue against, not to adopt:** the second, because it is the only one that lets a sprint commit to a ticket honestly. The slice should try to refute that before building it.

### The workaround is already in place and is not the fix

W40's items were rewritten: Musts link their plans, Shoulds lead with a bold description and keep the issue after it. Corpus tier green, 60/60. **That is invisible to the next author** — nothing in the template, the skill or a refusal says the first link must be a plan.

### What this does NOT do

- **It does not pick the shape here.** The plan names three and a recommendation; the slice argues and chooses.
- **It does not change what the corpus tier asserts.** It exists to catch exactly this and it worked.
- **It does not re-write historical sprints.** Whatever the shape, old items keep parsing as they do today.

## Done when

- **The PR states which of the three shapes was chosen and why the other two were rejected.** This is the deliverable; the code follows from it.
- All three readers agree on an issue-linked item, asserted by `corpus/sprint-item.corpus.test.ts` with an issue-linked fixture added to it.
- A malformed item is still distinguishable from a legal issue-linked one — whatever the chosen shape, the release gate can tell them apart.
- If the shape is *refuse at write time*, W40's three Should items are shown to still be expressible, or the plan records what an author does instead.
- Historical sprints parse unchanged, asserted over every file in `docs/sprints/`.

## Slices

### A sprint item names a plan or says it has none (Branch: bug/a-sprint-item-names-a-plan-or-says-it-has-none)

Argue the three shapes, choose one, make the readers agree, and add the issue-linked fixture to the corpus test.

## Notes

**This cost six hours of red main and was found by the corpus tier rather than by a person.** The sprint was written, verified to *parse*, and pushed without running CI — the parse check passes because each reader is individually happy.

That is the tier's whole argument: *"what makes it safe is not that one side is authoritative — it is that a test says they agree."*
