# A closed sprint says what it achieved

> A sprint's tally is reconciled against its plans' phases before it closes, so
> a timebox is never recorded as having achieved less than it did.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-serves-an-enterprise-stack
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-26, Jan Wloka, in-session
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

### Both directions read the phase, not the directory

The existing guard and this plan's new inverse would otherwise answer *is this
plan delivered?* two different ways:

| check | reads |
|---|---|
| existing false-completion guard | *"checked but plan is in `active/`"* — the **directory** |
| this plan's false-incompletion step | `plot-plan-meta.sh` — the **phase** |

**The phase is the answer `/plot-deliver` settled on.** It made the phase edit
and the `Delivered:` record the transition, and the index write best-effort,
with the reason stated: *"an index that can only ever make a plan invisible is
not a check; it is a second source of truth about a fact the file already
states."*

So a delivered plan whose symlink move failed — the exact case `/plot-deliver`
made survivable — would be reported by the old guard as a false completion. The
sprint step would be refusing on the bookkeeping of a plan that shipped.

**Measured 2026-08-26: zero plans are in that state today** (no `active/` link
points at a delivered or released plan). This is a latent inconsistency, not a
live defect, and it is fixed here because this wave is already editing that
function and leaving two spellings of one rule behind is how they drift.

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
4b. **Both directions decide from the plan's PHASE**, not from `active/`. The
   existing guard reads the directory today; a delivered plan whose symlink move
   failed would be reported as a false completion, which is the case
   `/plot-deliver` deliberately made survivable. Zero plans are in that state as
   of 2026-08-26, so this is asserted by a test, not by the estate.
5. **The scan reports a stale tally in a CLOSED sprint.** Asserted against one of
   the two measured today. A scan that only reads active sprints misses the
   entire population this plan is about.
6. **The scan gates nothing** — its footer count is advisory, like `index_drift`.
7. `pnpm test`, `pnpm run test:reconcile` green.

## Approval

- **Assignee:** Jan Wloka

## Notes

### The two sprints were fixed by hand first

Both W34 sprints were reconciled on 2026-08-26, before this plan existed: eleven
items ticked on their plans' phases, and the correction recorded in each file's
Notes. That repair is what produced the measurement above, and it is why the plan
can name an exact number rather than a suspicion.

The single genuinely unbuilt item — *a release window: dispatch refuses while a
release PR is open* — was left unticked in both the repair and this plan. It was
never planned, and the sprint said so at the time.

### Interrogated 2026-08-26

One round, spent verifying the measurement rather than extending the design —
this plan arrived with an unusually complete argument, and the useful thing was
to check whether it was true.

**It is.** `2026-W34-the-board-tells-the-truth` reads `Phase: Closed` with
**1 checked, 12 unchecked**, and of those twelve, **ten resolve to plans that
are Delivered or Released** and none is still open. The other two are bare prose
lines — *"Decide PR #57…"* and *"A release window: dispatch refuses…"* — with no
plan to read a phase from, which is exactly the population Done-when 3 protects.
`2026-W34-working-shows-the-agent` reads 10/1 as stated.

The one thing the round added is scope: the existing false-completion guard
decides by DIRECTORY while this plan's new step decides by PHASE, and
`/plot-deliver` already settled that the phase wins. Both now read the phase —
see *Both directions read the phase* above. No plan is currently mis-reported by
the old spelling, so the fix is against drift rather than against a live bug.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {
      "q": "Does the measured 1-of-13 tally hold, and are the unchecked items really delivered?",
      "a": "Verified: 1 checked / 12 unchecked, 10 resolve to Delivered or Released, 0 still open, 2 are prose lines with no plan",
      "category": "domain"
    },
    {
      "q": "The existing guard reads active/ while the new step reads the phase — scope?",
      "a": "Fix both to read the phase; /plot-deliver already settled that the phase wins and the index is best-effort",
      "category": "technical"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": { "stack": false, "architecture": true, "implementation": false },
    "domain": true,
    "ux": { "happyPath": false, "edgeCases": true, "errors": false, "accessibility": false },
    "nonFunctional": { "security": false, "performance": false, "scalability": false },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
