# A round is a domain fact

> `Rounds:` is parsed by a shell script and rendered by the board, and no rule anywhere says what a round is — so the only thing that can record one is prose in a skill, and prose is what failed.

## Status

- **State:** Approved
- **Type:** feature
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-22, jwloka, in-session
- **Started:** 2026-09-22, jwloka, `feature/the-domain-knows-a-round`

## Changelog

- Recording an interrogation round becomes a controller call with a named refusal for every way it can go wrong, rather than an instruction a skill may or may not follow. Measured 2026-09-22: four panels ran, zero `Rounds:` fields were written, and the board reported three heavily questioned plans — two of them rejected — as plans nobody had looked at.

Board impact: none in code. The badge renders from the field already; this is about what writes it.

## Design

**This supersedes the slice in `2026-09-22-a-panel-leaves-a-record.md`**, which proposed adding the instruction to `/plot-panel`'s step 5. That is a rule in CLAUDE.md's sense — *"Can you answer 'did I complete this?' without actually doing the work?"* — and the estate has the answer: four panels, four skipped writes.

> **AMENDED 2026-09-23. THE PREMISE INVERTS UNDER MEASUREMENT, and this plan's
> reason for existing changes with it.**
>
> Re-measured today: **39 of 42 panel subjects carry a `Rounds:` field — 93%**,
> against the field's 27.6% base rate across the estate. Panel subjects write
> it more than three times as often as plans in general. *"Four panels, four
> skipped writes"* was ONE DAY generalised to a practice.
>
> **And the four were misclassified.** Every one was a DELIVERY panel, gating
> on `supported|refuted`, where this plan's own rule says a round is
> meaningless. So that day's failure was **over-counting delivery rounds**, not
> under-counting draft ones — the opposite of what the plan argues.
>
> **What survives is the gap, not the urgency.** The domain still has no rule
> for a field the parser reads and the card renders, and that is worth closing.
> It is no longer evidence that prose is failing.

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
| `zero-rounds` | `0` means *questioned and nothing came of it*; the template says leave the line out instead. **Amended 2026-09-23: UNREACHABLE as specified** — the transition increments, so it can only produce ≥1, and the signature admits no explicit count. Either the input takes one and the refusal is real, or it does not and this is dead code. It takes one |
| `not-a-plan` | a file with no `State:` is a decision log, not a plan |
| `phase-terminal` | **Amended 2026-09-23: the refused set is `Delivered`, `Released`, `Rejected` and `Superseded`** — every phase past Development. The original said *"a Released plan cannot gain a round"* and the plan then carved out *"a rejected plan keeps its round beside its rejection"*, which contradicts it: `Rejected` is terminal too. Measured over the 112 plans carrying the field — 96 Released, 8 Rejected, 4 Delivered, 2 Superseded, 1 Approved — so the refusal governs what may be ADDED, never what is already recorded. A round already on a terminal plan stays |
| `no-moderation` | the round is not complete until it is reconciled; recording one before that records an intention |
| `count-unparseable` | an existing `Rounds:` that is not a number is a defect to report, never to overwrite |

**`no-moderation` takes a READING, and it does not earn the controller.**

> **AMENDED 2026-09-23.** This paragraph claimed the refusal is checkable
> because *"the moderation file exists or it does not"*, while the slice hands
> the transition a moderation PATH and the plan states it reaches no
> filesystem. **A path is not an existence check**, and a filesystem-free
> transition cannot make one.
>
> The estate already has the mechanism: `transitions/plan.ts:76` defines
> `Precondition` — *"A fact a transition needs but cannot measure — supplied by
> an adapter"* — producing `precondition-unmet` at `:178`. So `recordRound`
> takes `moderationPresent: boolean` and the SHELL does the `test -f`.
>
> **That costs this plan its headline argument.** Once the check is a
> caller-supplied reading, the refusal catches *"called with no moderation"*
> and never *"never called"* — which is the failure the plan was written
> about. The refusal is still worth having; it is not what justifies a
> controller.

### Increment, never set

A plan can face a panel twice: `a-waiting-loop-has-not-finished` is the rewrite of a plan that had already been rejected by one, and both are rounds. **The transition reads the current value and adds one**, which is also why `count-unparseable` refuses rather than resetting — a field that cannot be read is a defect, and overwriting it destroys the evidence.

### Who calls it

> **AMENDED 2026-09-23, and the cheap fix comes first.**
>
> **`/plot-panel` never tells anyone to write the field.** Verified: it
> mentions `Rounds:` twice, both in *"Why a panel rather than more rounds"*,
> as a COST MEASUREMENT of sequential questioning. Nothing in its step 5 says
> a round was completed or who records it.
>
> So the measured miss — five panels run in one session, five fields unwritten
> — is a **missing instruction in the mechanism**, not a rule nobody follows.
> A cross-reference in step 5 costs one line and closes the case this plan was
> written from.
>
> **`/challenge-the-plan` already writes the field**, and more precisely than
> this plan specifies the transition — replace-or-insert after `Impl:`, never a
> section rewrite. Slice 2 replacing that is a net-zero move on the caller that
> works, to serve one that has no instruction at all.
>
> **The ordering that follows:** add the cross-reference first and measure
> whether the miss recurs. Build the transition for the refusals it holds —
> `count-unparseable` and the terminal-phase set are checkable from the text
> and worth having — rather than as the enforcement mechanism, which
> `no-moderation` cannot be.

**The moderation step, whoever performs it.** `/plot-panel` keeps its refusal to touch the plan — that refusal is load-bearing, because the same mechanism serves `/plot-deliver` where a round is meaningless. What changes is that the caller's instruction becomes *call the controller* rather than *edit the field*.

**And a direct invocation is a caller too.** All four panels on 2026-09-22 were run by a master agent invoking `/plot-panel` directly — the third caller neither `/challenge-the-plan` nor `/plot-deliver` anticipated, and the one for whom *"the caller owns it"* meant nobody owned it.

### What must not break

**The field stays optional.** A plan built without interrogation carries none, and that is the honest reading — `a-failed-tick-must-not-end-the-daemon` has no field and should not gain one.

**No phase moves.** Recording a round is not approval. A rejected plan keeps its round beside its rejection.

**`/challenge-the-plan`'s own write is replaced, not duplicated.** Two writers of one field is the drift this estate names repeatedly; the sequential skill calls the same controller.

**The shell stays the parser.** `plot-plan-meta.sh` reads the field and keeps reading it — this adds a writer, not a second reader.

## Slices

### The domain knows a round (Branch: feature/a-round-is-a-domain-fact)

- `feature/a-round-is-a-domain-fact` — `recordRound` lands in `transitions/`, taking the plan text plus `moderationPresent` as a **`Precondition` reading** (`transitions/plan.ts:76`) rather than a path the domain cannot check; it INCREMENTS and never sets; it refuses `not-a-plan`, `count-unparseable`, `phase-terminal` over `{Delivered, Released, Rejected, Superseded}`, `zero-rounds` on an explicit `0`, and `precondition-unmet` where the caller reports no moderation. Unit tests pin each refusal and the increment rule. **It wires no caller**: `/plot-panel` step 6 already names the obligation in prose, and whether a skill calls a controller instead of editing one field is a separate question this plan no longer answers

## Notes

### Resliced 2026-09-23, from two slices to one

The split existed because slice 2 was going to wire two callers. **One of them is already wired** — `/plot-panel` step 6 names a direct invocation as a caller that owes the write, shipped as `plot-panel: the moderation completes a round`. And the justification for wiring the other is gone: the panel showed `no-moderation` cannot enforce anything from a filesystem-free transition, so *"call it instead of editing the field"* is no longer the argument.

**The superseded first slice held no work.** Its branch tip was an ancestor of main with an empty diff — a stale claim marker, not a delivery, which is why the scan read the wave `complete` while `recordRound` existed nowhere on the estate.

**The note lives here rather than in `## Slices`, and that is the parser's rule rather than taste.** `test/reconcile/parser.test.mjs` sweeps the branches section and refuses any line an unanchored matcher would read as a branch claim. A blockquote opening with a backticked branch name is exactly that ambiguity: prose ABOUT a branch, indistinguishable from a line NAMING one. CI caught it on this plan.


- **`plot-state-gate.sh` does not cover this**, and should not: it guards `State:` lines, and `Rounds:` is not a lifecycle phase. The refusals are the gate here.
- The bundle is a SIXTH one beside `plot-panel.mjs` for the reason the others give: `plot-ask.mjs` answers by running `plot-fleet-scan.sh`, so a skill recording a round must not start a fleet scan to do it.
