# A closed sprint says what it achieved

> A sprint's tally is reconciled against its plans' phases before it closes, so
> a timebox is never recorded as having achieved less than it did.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-board-serves-an-enterprise-stack
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

- Closing a sprint reconciles its checkboxes against each plan's phase first, so
  an item whose plan has been delivered is not recorded as unfinished. The
  reconcile scan reports the same disagreement for sprints already closed.

## Motivation

### Measured 2026-08-26

Two closed sprints understated what they achieved:

| sprint | reported at close | actually done |
|---|---|---|
| `2026-W34-the-board-tells-the-truth` | **1 of 13** | 12 of 13 |
| `2026-W34-working-shows-the-agent` | 10 of 11 | 11 of 11 |

Eleven items were plans that reached `Phase: Released` *after* their sprint
closed. Nobody re-ticked the boxes, so the files said the first sprint had
achieved one thing out of thirteen. Its retrospective, read today, is wrong
about its own subject.

### One direction is guarded and the other is not

`/plot-sprint close` refuses on a **checked box over an undelivered plan** — a
false completion, the failure that would let a sprint claim work it never did.
That guard is right and stays.

Nothing checks the inverse: an **unchecked box over a delivered plan**. It is a
false *incompletion*, and it is the one that actually happened — eleven times.

The asymmetry is already understood elsewhere in the estate.
`plot-sprint-release.sh` documents it precisely, for the ACTIVE case:

> The plan estate outranks the checkbox where there is one to read, but only in
> one direction — a checked box over an undelivered plan is `disputed`, while an
> unchecked box over a delivered one is `done`, because `/plot-deliver` moves the
> plan and nobody re-ticks the box.

So the rule exists, is written down, and is applied when a release gate reads a
live sprint. It is simply never applied when a sprint CLOSES, which is the
moment the tally stops being recomputed and becomes the record.

### Why it matters after the fact

A closed sprint's tally is not decoration. `plot-sprint-release.sh` reads it,
the board renders it, and a retrospective is written from it. A sprint that
reports 1 of 13 when it delivered 12 misinforms every reader it has — and
unlike a live sprint, nothing will ever recompute it.

## Design

### Closing reconciles first

`/plot-sprint close` gains a step before it flips the phase: for every unchecked
item, read its plan's phase through `plot-plan-meta.sh`. Where the phase is
`delivered` or `released`, tick the box and annotate it with the phase that
justified the tick.

**Ticked on the plan's own phase, never on a re-reading of the work.** The phase
is a recorded transition with a date and, for released plans, a version. Judging
"is this really done?" from the diff at close time is a different and much larger
act, and it is not what the checkbox means.

An item with **no resolvable plan** — a bare prose line, of which these sprints
have several — is left alone and named in the output. A human wrote it and only a
human can close it.

### The scan reports what has already drifted

`plot-reconcile-scan.sh` gains a section: sprint items unchecked whose plan is
delivered or released. It reports **closed sprints too**, because those are the
ones nothing else will ever revisit.

Advisory, like section 9 — it names the file, the item and the plan's phase, and
prints the fix. It does not gate: a closed sprint with a stale tick is wrong, not
broken, and rewriting history automatically is worse than reporting it.

### Not chosen: recompute the tally on every read

The board could ignore the checkboxes and derive completion from the plans, the
way `plot-sprint-release.sh` already does for its own gate. Rejected: the
checkbox is a person's mark, and a sprint can legitimately contain an item that
is done but was descoped, or one whose plan is delivered while the sprint's
intent for it was not. Deriving everything would silently overwrite that
judgement. The reconcile ASKS; it does not assume.

### Not chosen: refuse to close while items disagree

Symmetrical with the existing guard, and tempting for that reason. Rejected: a
false incompletion harms nobody at close time — the work is done either way —
while a refusal blocks an operator from closing a finished sprint over
bookkeeping. The existing refusal guards against claiming work that was not
done; this case is the opposite and does not warrant a stop.

## Waves

### Reconciled (Branch: bug/closing-a-sprint-reconciles-its-tally)

`/plot-sprint close` ticks unchecked items whose plan is delivered or released,
annotating each with the phase that justified it, and names every item it could
not resolve.

### Reported (Branch: bug/the-scan-sees-a-stale-sprint-tally)

`plot-reconcile-scan.sh` reports unchecked items over delivered plans, in closed
sprints as well as active ones, with a machine-countable footer field.

## Done when

1. **Closing a sprint ticks an item whose plan is `released`**, and annotates it
   with that phase.
2. **It also ticks a `delivered` one.** Both, or the step misses every plan that
   shipped in an unreleased version — which is most of them at close time.
3. **An item with no resolvable plan is untouched and named.** These sprints
   carry bare prose lines ("a release window: dispatch refuses…"), and a step
   that ticks what it cannot verify is the false completion the existing guard
   exists to prevent.
4. **The existing refusal still fires** — a checked box over an undelivered plan
   still stops the close. This plan adds a direction; it removes none.
5. **The scan reports a stale tally in a CLOSED sprint.** Asserted against one of
   the two measured today. A scan that only reads active sprints misses the
   entire population this plan is about.
6. **The scan gates nothing** — its footer count is advisory, like `index_drift`.
7. `pnpm test`, `pnpm run test:reconcile` green.

## Notes

### The two sprints were fixed by hand first

Both W34 sprints were reconciled on 2026-08-26, before this plan existed: eleven
items ticked on their plans' phases, and the correction recorded in each file's
Notes. That repair is what produced the measurement above, and it is why the plan
can name an exact number rather than a suspicion.

The single genuinely unbuilt item — *a release window: dispatch refuses while a
release PR is open* — was left unticked in both the repair and this plan. It was
never planned, and the sprint said so at the time.
