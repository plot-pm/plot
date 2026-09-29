# The jury button names its caller

> `POST /api/interrogate` asks for `/plot-panel` and supplies one of its four parameters, so every click produces a refusal. The caller that already owns the other three is `/challenge-the-plan`, and the button should ask for it.

## Status

- **State:** Delivered
- **Approved:** 2026-09-28, jwloka, in-session after panel (round 1)
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1035
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1
- **Started:** 2026-09-28, jwloka, `bug/the-jury-button-names-its-caller`
- **Delivered:** 2026-09-29

## Changelog

- The board's Interrogate button produces a panel. It asks for `/challenge-the-plan`, which owns the Draft lenses and commitment, instead of asking for the mechanism directly and naming only the subject.

Board impact: the button starts working, and it inherits everything `/challenge-the-plan` does — a sibling comparison, an Open Points section written into the plan body, and a metadata block beside `Rounds:`. No payload change and no route change; the plan format gains a block on interrogated plans that did not have one.

## Motivation

### Measured 2026-09-27, the first real click

`Interrogate command` was configured that evening (`e99fcf0a`) and the button clicked on `a-dispatch-promises-a-worker`. The route worked end to end — prompt written, agent spawned, status `running` then `done` — and the agent wrote nothing:

```
PLOT-UNASKED: Which commitment shape should the jurors use?
  — refused — no panel run, the caller must name it
```

No juror files, no moderation, no `Rounds:` increment. The plan still reads `Rounds: 1`, from a hand-run panel earlier the same day.

### The prompt names one parameter of four

`composeInterrogatePrompt` (`interrogate.ts:114`) emits `/plot-panel <path>` plus an instruction to default the rest. Its docstring says so deliberately:

> It names the plan and nothing else: no lenses, no commitment, no rubric. `/plot-panel` states that those are the caller's parameters and that an unattended run refuses when one is missing (its step 1), **so this prompt defers to the skill rather than choosing them.**

`skills/plot-panel/SKILL.md:58` names the four — Subject, Lenses, Commitment, Rubric — and `:104` declares the refusal:

> **Unattended:** nothing to ask — the caller supplied every parameter. If one is missing, refuse; a panel run with a guessed commitment validates against a vocabulary nobody chose.

So the prompt's instruction, *"do what the skill says an unattended run does"*, resolves to **refuse**. The deferral the docstring describes is the one move the mechanism forbids.

### Why the mechanism cannot default it

CLAUDE.md, on `plot-panel`:

> The commitment vocabulary is the **CALLER'S** (`proceed/amend/reject` for a Draft juror, `supported/refuted` for a delivery one) and the mechanism knows neither; **hardcoding one is what makes the second caller impossible**, and the second caller is why it is extracted.

That is a property worth keeping. The gap is on the calling side.

## Design

### The rule

**The button asks for `/challenge-the-plan`, not for `/plot-panel`.**

`/challenge-the-plan` is the Draft-plan panel caller and it already supplies all four parameters: its own lenses (`SKILL.md:198`), the commitment `Position: proceed | amend | reject` (`:224`), and one rubric identical across lenses. It calls the mechanism and implements none of it — *"This phase calls `/plot-panel` and implements none of it."*

So the fix is a prompt change: name the caller that knows the answers, rather than the mechanism that refuses without them.

### Why not teach the board the four parameters

Two reasons, and the second is the load-bearing one.

**It would be a third copy.** `/challenge-the-plan` and `/plot-deliver` each hold a lens set and a commitment for their own question. A board-side set would drift from the Draft one the moment either changed.

**A prompt is not a place to keep a rubric.** The lenses are prose with argument attached — *"Brief each juror to look, not to agree"* — and a rubric inlined into `composeInterrogatePrompt` is prose in TypeScript that no skill author would think to update.

### The `Evidence` line

`/challenge-the-plan`'s commitment is `Position:` alone. Measured 2026-09-26: a Draft panel of five returned 1 reject and 4 amend, and **four of five had read without running**; the one that executed is the one that overturned the plan's justification. Adding `Evidence: executed|read` as a second gated commitment the next day moved execution from **1 of 5 to 9 of 9**.

**Whether `/challenge-the-plan` gains that second label is its own question and is out of scope here.** This plan makes the button reach a caller that works; it does not redesign that caller. If the slice finds the Draft panel weaker without `Evidence`, it says so and files it.

### What the button inherits, and it is more than a panel

Asking for the caller means asking for its whole phase, not only its four parameters. **Three behaviours come with it and none is a reason to reject — but the plan must name them.**

**A sibling comparison.** `challenge-the-plan/SKILL.md:172-196` resolves sibling plans and puts them in the rubric. Measured 2026-09-28: the active sprint has **9 members**, and the no-sprint fallback arm is **27 unfinished plans**. So each of N jurors reads the subject plus up to 9 more. That is the button's real cost, and it is the reason the estate lens finds duplication a single-plan panel cannot.

**Open Points written into the plan body.** `:243-248` — *"each juror's unresolved finding becomes an open point, in the section this skill already owns."* `interrogate.ts:18-20` lists three artifacts the skill writes — verdict files, `panel.md`, the `Rounds:` increment. **Open Points is a fourth**, and the route's docstring should say so.

**A metadata block.** Phase 5b (`:353-380`) writes `CHALLENGE-THE-PLAN-METADATA` beside `Rounds:`. `/plot-panel` step 6 deliberately does not — a direct interrogation *"needs no metadata block to do it."* Measured: **71 plans carry the block against 158 carrying `Rounds:`**, so most interrogated plans here have none and the button starts adding one.

**Settled: the button gets all three.** The richer caller is what a person clicking *Interrogate* wants — a panel that has read the neighbours and leaves its unresolved findings in the plan. The slice updates `interrogate.ts`'s docstring to name the fourth artifact and the block.

### What this does NOT do

- **It does not change `/plot-panel`.** `readJuror` and `readPanel` learn no vocabulary. The mechanism stays generic, which is the property the extraction was for.
- **It does not add lenses, a commitment or a rubric to the board.** Those stay in the skill that owns them.
- **It does not change the route, the spawn, the log, the status read-back or the button.** All five work; only the prompt is short.
- **It does not touch `Interrogate command`.** It is configured and correct.

## Done when

- Clicking Interrogate on a Draft plan produces juror files, a `panel.md` and a `Rounds:` increment.
- A test asserts the composed prompt names a caller that supplies all four parameters — not merely that the string changed.
- **All three sites in `interrogate-route.test.ts` are handled, not one.** `grep -n 'plot-panel'` returns `:173` (the named assertion), `:185` (a second test, *"names the real plan file, relative to the repo"*, with the same pin), and `:229` — **the stub runner's parser**, `plan=$(sed -n "1s|^/plot-panel ||p" ...)`, which returns empty against a `/challenge-the-plan` prompt and fails three lines later on an empty variable, naming neither the prompt nor the skill.
- The rewritten assertions test that the prompt names a caller supplying all four parameters — not merely that the string changed.
- `interrogate.ts`'s docstring names Open Points as a fourth artifact and the metadata block as a fifth.
- The board still holds no lens, commitment or rubric text.

## Slices

### The jury button names its caller (Branch: bug/the-jury-button-names-its-caller, PR: #1043)

Change the prompt, fix all three sites that pin the old shape (two assertions and the stub's parser), update the route docstring, and prove a real click produces a panel.

## Notes

The capability shipped complete — route, button, schema field, status read-back, nine passing route tests — and could never produce its output. `interrogate-route.test.ts` passes 9 of 9 including *"asks for /plot-panel on the plan path and chooses no parameters"*, which asserts the defect as intended behaviour.

**That is the shape worth recording: a test can lock in a gap when it was written from the implementation rather than from the outcome.** Nothing in the suite asks whether a panel appears.

**Round 1 (2026-09-28): the central claim held and the scope was understated.** The evidence juror committed `amend` having executed, and confirmed what the plan rests on — `/challenge-the-plan` does supply all four parameters (Subject `:193`, Lenses `:203-208`, Commitment `:224`, Rubric `:238`), and the routing works, because `interrogate.ts:317` sets `PLOT_UNATTENDED=1` and the skill routes on exactly that at `:58-59`.

Two findings changed the plan. **There are three sites pinning the old prompt, not one** — and the third is the stub runner's `sed`, which fails on an empty shell variable rather than on the string it pins, so an implementer following round 1's Done-when would have hit an error naming nothing relevant. **And `/challenge-the-plan` does three things beyond running a panel**, which round 1 omitted while claiming *"no schema change"*. Both are now stated.

The juror named the first finding as the plan's own defect in miniature: its Notes warn that *"a test can lock in a gap when it was written from the implementation rather than from the outcome"*, and the plan then counted those tests by reading one test name instead of grepping the file.

Verdict and full reading: `.plot/panels/2026-09-28-the-jury-button-names-its-caller/evidence.md`.
