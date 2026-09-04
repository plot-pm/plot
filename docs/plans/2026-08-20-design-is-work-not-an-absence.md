# Design is work, not an absence

> The board's `Design` column means *nobody has started* — it is
> `approved && !started`, computed from a branch's commit count. But design is
> an activity: a spike, a tracer bullet, a spec that makes a plan handable to
> development. A column named for work that is defined by the absence of work
> tells a reader the opposite of what it says.

## Status

- **Phase:** Released
- **Type:** bug
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-20, jwloka, in-session
- **Delivered:** 2026-08-22, jwloka, PRs #259, #265, #289
- **Released:** 2026-08-22, v2.7.0
- **Started:** 2026-08-20, Jan Wloka, `feature/the-gates-know-design`
- **Started:** 2026-08-20, Jan Wloka, `feature/the-design-column-means-design`

## Problem

Reported 2026-08-20 while asking why two branches of one plan can sit in
different phases. The answer exposed something larger than the question.

### Four phases, five columns

`CLAUDE.md` states the model plainly:

> Four workflow phases: **Draft → Approved → Delivered → Released**

The board draws **five** columns: Discovery, Design, Development, Endgame,
Released. The extra one is manufactured in `toBoardPhase`
(`packages/board/src/contract/schema.ts:432`):

```
draft     → Discovery                          always
approved  → started ? Development : Design     the only fork
delivered → Endgame                            always
released  → Released                           always
```

So `Design` is not a phase Plot has. It is `approved` with `started === false`,
and `started` means *this branch has commits or is merged*.

### What the column actually holds

Measured on the live board 2026-08-20:

| Column | Plans | What they are |
|---|---|---|
| Discovery | 1 | `the-row-says-what-it-knows` — genuinely still being written |
| **Design** | **3** | `a-wave-says-what-it-waits-for`, `opus5-longhorizon-hardening`, `the-index-is-derived` |
| Development | 1 | `working-shows-the-agent` |

**All three "Design" plans are fully specified, interrogated and approved.**
Their branches carry briefs. Not one of them is being designed — every one is
waiting for an agent. The column holds *approved work nobody has picked up*,
which is a queue, not a design stage.

### Why the naming is a defect and not a quibble

Design is a real activity this repo already does and already has tooling for:
`skills/tracer-bullets/` exists precisely for *"a thin vertical slice"* when the
architecture is unproven. A spike, a tracer bullet, a spec that answers what a
plan could not answer at approval time — that is work someone performs, produces
commits for, and finishes.

Under the current mapping such a plan is **indistinguishable from one nobody has
touched**, and worse: the moment someone starts the spike, its branch gains
commits and the plan moves to `Development` — leaving `Design` again populated
only by untouched work. The column can never contain design in progress. It is
structurally reserved for its own absence.

This is the same defect the board has been removing all week — a row stating a
fact whose consequence it withholds — one level up: a **column** whose name
states an activity while its membership states an absence.

### The mapping has been wrong here before

`schema.ts:438` carries the scar: a comment recording that an earlier version
"left Discovery a column nothing could ever reach". The five-column shape has
already been repaired once by adjusting which phase maps where, rather than by
asking whether five columns match four phases.

## Design

### Design becomes a phase, between Draft and Approved

Decided 2026-08-20. The three options first considered — rename the column,
give design a phase, drop the column — were all framed as *where does the
existing `Design` word belong?* The operator reframed the question and it is the
better one: **the lifecycle is missing a step.**

```
Draft  →  [Design]  →  Approved  →  Delivered  →  Released
              ↑ optional
```

A plan enters Design when it is written but a question stands that approval
cannot answer: whether the approach works. A spike, a tracer bullet, a spec
completed against reality. It leaves when the question is answered — toward
Approved if the answer holds, back to Draft if it does not.

**This is where the existing `Design` column was pointing all along.** Today the
board computes it as `approved && !started`, which means *nobody has begun*, and
the measured contents prove the mismatch: all three plans in the column were
fully specified and approved, waiting only for an agent. With a real phase the
column reads what its name says, and the queue of approved-but-unstarted work
goes back to Development, where somebody working on it belongs.

### Why a phase and not a field beside Draft

A marker (`Design: needed` next to `Phase: Draft`) was the cheaper option and is
rejected. It changes no gate and breaks no reader — 22 files read the phase and
none would notice — but it makes the lifecycle lie: a plan under active
investigation would still report Draft, and *Draft* is the one phase whose
meaning is "nobody has committed to this yet". Someone running a spike has
committed to finding out.

The precedent settles the shape rather than the cost. `plot-plan-meta.sh:184`
already normalises **six** phases — `draft|approved|delivered|released|rejected|superseded`
— so a fifth beyond the CLAUDE.md four is not novel. What *is* novel is that
`rejected` and `superseded` are terminal, and `schema.ts:430` says so
explicitly: they never appear on the board. **Design is the first transitional
phase added since the model was written**, and that is the risk this plan
carries: every gate that today asks *"is this Draft?"* is really asking *"is
this decided?"*, and the two stop being the same question.

### The gates, named rather than estimated

| Site | Today | Must become |
|---|---|---|
| `plot-approve.sh:166` | dies unless phase is `draft` | accepts `draft` **or** `design` |
| `plot-phase-gate.sh` | blocks impl commits while Draft | blocks in Design too — the approach is still open |
| `plot-implement/SKILL.md` | requires Approved | unchanged, and that is the point |
| `toBoardPhase` (`schema.ts:439`) | `approved && !started → Design` | `design → Design`; approved-unstarted goes to Development |
| `plot-plan-meta.sh:184` | six phases | seven |

`/plot-implement` staying unchanged is the load-bearing part: implementation
still requires Approved, so Design cannot become a way to start work early.

### What entering and leaving looks like

Entering is a human act, like approval — nothing derives it. Leaving has two
directions, and both must be expressible: **toward Approved** when the spike
answered its question, and **back to Draft** when it answered it with *no*. A
phase you can only leave forward is a trap, and `/plot-reject` already exists
for the reverse move out of Delivered.

The `Design:` record follows the shape of `Approved:` and `Delivered:` — date,
who, and what was done — because a phase whose entry leaves no trace cannot be
audited later.

### Open Points

- [ ] Does an existing plan enter Design retroactively? Three plans sit in the
      mislabelled column today, and none of them belongs in the new phase — they
      are approved and unstarted, which is exactly what the fix reclassifies as
      Development. So the answer is probably *no plan is migrated*, but that is
      worth stating rather than assuming.
- [ ] Does `/plot-idea` offer Design at creation, or is it only ever entered
      later? Offering it at creation invites a plan to be born in a phase it has
      not earned; entering it later means someone read the draft and found the
      gap, which is the honest trigger.
- [ ] Is there a command, or is it an edit? `/plot-approve` exists because
      approval has mechanics (merge the PR, flip the phase, clear holds).
      Entering Design may have none — in which case it is a field edit and a
      commit, and inventing a spoke for it would add ceremony the change does
      not need.

## Slices


### The phase exists (Branch: feature/design-is-a-phase, PR: #259)
- `plot-plan-meta.sh` normalises `design` as a seventh phase and reports its `Design:` record beside `Approved:`/`Delivered:`. Contract-level and additive: `test/reconcile/parser.test.mjs` must pass unedited, exactly as the `changelog` field did. Tests: a plan in phase Design parses; its `Design:` record is reported; a plan without one is unaffected; the existing six phases are byte-identical.


### The gates know it (Branch: feature/the-gates-know-design, PR: #265)
- `plot-approve.sh` accepts a plan in Design as well as Draft, and `plot-phase-gate.sh` blocks implementation commits in Design as it does in Draft. `/plot-implement` still requires Approved, unchanged. Tests: approving from Design records `Approved:` and flips the phase; an implementation commit under Design is blocked with a message naming the phase; `/plot-implement` refuses a Design plan; the Draft paths are unchanged.


### The board reads it (Branch: feature/the-design-column-means-design, PR: #289)
- `toBoardPhase` maps `design → Design`, and `approved` maps to Development whether or not a branch has started. Tests: a plan in Design appears in the Design column; an approved plan with no started branch appears in Development, not Design; the measured case — three approved-unstarted plans — moves out of Design; Discovery, Endgame and Released are unchanged.

## Notes

Found by an operator asking a narrower question — how two branches of one plan
can show different phases — and following the answer past its own boundary. The
narrow answer is in `the-row-says-what-it-knows`; this is what the answer
revealed.
