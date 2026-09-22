# A round is a domain fact

> `Rounds:` is parsed by a shell script and rendered by the board, and no rule anywhere says what a round is — so the only thing that can record one is prose in a skill, and prose is what failed.

## Status

- **State:** Approved
- **Type:** feature
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-22, jwloka, in-session
- **Started:** 2026-09-22, jwloka, `feature/the-domain-knows-a-round`

## Changelog

- Recording an interrogation round becomes a controller call with a named refusal for every way it can go wrong, rather than an instruction a skill may or may not follow. Measured 2026-09-22: four panels ran, zero `Rounds:` fields were written, and the board reported three heavily questioned plans — two of them rejected — as plans nobody had looked at.

Board impact: none in code. The badge renders from the field already; this is about what writes it.

## Design

**This supersedes the slice in `2026-09-22-a-panel-leaves-a-record.md`**, which proposed adding the instruction to `/plot-panel`'s step 5. That is a rule in CLAUDE.md's sense — *"Can you answer 'did I complete this?' without actually doing the work?"* — and the estate has the answer: four panels, four skipped writes.

### What exists, and what does not

| | where | state |
|---|---|---|
| the FIELD | `plot-plan-meta.sh` parses it; `PlanCard.tsx` renders it | built |
| the RULE | — | **nothing** |
| the WRITE | `/challenge-the-plan` prose; `/plot-panel` refuses by design | **prose only** |

`grep rounds packages/domain/src` outside tests returns nothing. **The domain has no idea what a round is**, so there is nothing for a controller to call and nothing a gate could check.

### What a round is

**One completed interrogation of one plan.** The unit is the *sitting*, not the question: `/challenge-the-plan` counts a four-question round as one, and a panel of four lenses is likewise one. The two mechanisms differ in shape and agree on the count.

**A round is completed when it is reconciled**, which is the moment both mechanisms share: `/challenge-the-plan` when it writes its Open Points, `/plot-panel` when its moderation is written. Before that a round is in progress and has produced nothing to record.

### The transition, and its refusals

`recordRound(plan, input) → TransitionResult`, in `transitions/`, the shape `setSprintState` established: it takes the plan document, returns the text to write or a named refusal, and reaches no filesystem.

**The refusals are what make it worth building**, each one a way the estate has already gone wrong or could:

| refusal | why |
|---|---|
| `zero-rounds` | `0` means *questioned and nothing came of it*; the template says leave the line out instead |
| `not-a-plan` | a file with no `State:` is a decision log, not a plan |
| `phase-terminal` | a Released plan cannot gain a round — the interrogation is history |
| `no-moderation` | the round is not complete until it is reconciled; recording one before that records an intention |
| `count-unparseable` | an existing `Rounds:` that is not a number is a defect to report, never to overwrite |

**`no-moderation` is the one that earns the controller.** It is checkable — the moderation file exists or it does not — and it is exactly what prose cannot enforce. A skill told to write the field after moderating can believe it did; a rule handed a subject with no `panel.md` refuses.

### Increment, never set

A plan can face a panel twice: `a-waiting-loop-has-not-finished` is the rewrite of a plan that had already been rejected by one, and both are rounds. **The transition reads the current value and adds one**, which is also why `count-unparseable` refuses rather than resetting — a field that cannot be read is a defect, and overwriting it destroys the evidence.

### Who calls it

**The moderation step, whoever performs it.** `/plot-panel` keeps its refusal to touch the plan — that refusal is load-bearing, because the same mechanism serves `/plot-deliver` where a round is meaningless. What changes is that the caller's instruction becomes *call the controller* rather than *edit the field*.

**And a direct invocation is a caller too.** All four panels on 2026-09-22 were run by a master agent invoking `/plot-panel` directly — the third caller neither `/challenge-the-plan` nor `/plot-deliver` anticipated, and the one for whom *"the caller owns it"* meant nobody owned it.

### What must not break

**The field stays optional.** A plan built without interrogation carries none, and that is the honest reading — `a-failed-tick-must-not-end-the-daemon` has no field and should not gain one.

**No phase moves.** Recording a round is not approval. A rejected plan keeps its round beside its rejection.

**`/challenge-the-plan`'s own write is replaced, not duplicated.** Two writers of one field is the drift this estate names repeatedly; the sequential skill calls the same controller.

**The shell stays the parser.** `plot-plan-meta.sh` reads the field and keeps reading it — this adds a writer, not a second reader.

## Slices

### The domain knows a round (Branch: feature/the-domain-knows-a-round)

- `feature/the-domain-knows-a-round` — `recordRound` lands in `transitions/`, taking the plan text and the subject's moderation path, returning the rewritten `## Status` block or one of five named refusals; unit tests pin each refusal and the increment-not-set rule

### The controller records it (Branch: feature/the-controller-records-it) <!-- waits: feature/the-domain-knows-a-round -->

- `feature/the-controller-records-it` — a `plot-panel-round.mjs` bundle beside `plot-panel.mjs` exposes it without HTTP, `/plot-panel` step 5 and `/challenge-the-plan` both call it instead of editing the field, and the skills name a direct invocation as a caller that owes the same write

## Notes

- **`plot-state-gate.sh` does not cover this**, and should not: it guards `State:` lines, and `Rounds:` is not a lifecycle phase. The refusals are the gate here.
- The bundle is a SIXTH one beside `plot-panel.mjs` for the reason the others give: `plot-ask.mjs` answers by running `plot-fleet-scan.sh`, so a skill recording a round must not start a fleet scan to do it.
