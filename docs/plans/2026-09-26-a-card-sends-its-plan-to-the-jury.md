# A card sends its plan to the jury

> A DISCOVERY card offers **Open** and **Approve**, and nothing between them. The card already shows `0 rounds` — the count an interrogation moves — so the board states the plan is unquestioned and offers no way to question it. The only route is an operator typing `/plot-panel` in a terminal.

## Status

- **State:** Approved
- **Type:** feature
- **Review:** in-session
- **Impl:** own branches
- **Sprint:** a-refusal-names-what-it-cannot-see
- **Rounds:** 1
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)

## Changelog

- A DISCOVERY card offers **Interrogate**, which runs `/plot-panel` on that plan headless and records the round. Approving and questioning are both one click, instead of one click and a terminal.

Board impact: **entirely board.** One action endpoint, one button, one config key. No scan change, no domain rule.

## Motivation

**The card measures the gap it cannot close.** Every DISCOVERY card renders a rounds chip — `0 rounds` on all three open plans, measured 2026-09-26. That chip exists because an unquestioned plan is worth noticing. The card notices, and then offers only **Open** and **Approve**.

So the board's own reading says *this plan has been through nothing*, and the only action it offers is the one that ends the drafting phase.

### The mechanism exists and is fully built

`/plot-panel` takes one plan, fans out N jurors, gates every verdict through `board/plot-panel.mjs`, and reconciles. It is **unattended-first** by design — its own SKILL.md says *"Its reason for existing is that rounds cost attention, so the attended path is the exception"* — and every step declares its behaviour under `PLOT_UNATTENDED=1`.

A headless panel is therefore not an adaptation of the mechanism. It is the mechanism's intended mode, reached today only by hand.

### The board already spawns agents for judgement

Six `* command` config keys run an agent headless: `Worker`, `Approve`, `Idea`, `Story`, `Brief`, `Implement`. `plot-config.sh:72` states the rule for the judgement cases:

> REQUIRED for the issue row's `Create plan` action, unlike `Approve command`: approving has a script to fall back to, and creating a plan does not — **every step of /plot-idea is judgement, and no script here can invoke a skill.**

**Interrogating is that kind.** No script can run a panel: the fan-out is N agents reading a plan. So this follows `Idea command`'s shape — the key is REQUIRED, and its absence makes the button refuse by name rather than accept a click and do nothing.

### Measured cost of the gap

Five panels were run directly in one session on 2026-09-23 **and none recorded a round** — the measurement that put step 6 into `/plot-panel`'s own SKILL.md. Across the estate 39 of 42 panel subjects carry the field, so the practice is healthy; what is missing is the route. A button that runs the skill records the round because the skill records it.

## Design

### The action

**`Interrogate`, on a DISCOVERY card, beside `Approve`.** It runs the configured command with a prompt asking for `/plot-panel <plan path>`, exactly as `Create plan` runs `/plot-idea`.

It writes verdicts to `.plot/panels/<subject>/`, a moderation to `panel.md`, and increments `Rounds:` — all of which the skill already does. **The board adds no panel logic**, and a board that reimplemented the gate would be a second copy of the one rule that makes a panel more than parallel subagents.

### The name is `Interrogate`, not `Panel`

**`agent-panel.ts` already exists** and is the WORKING row's detail popover — *"what one WORKING row can honestly say about the agent holding it"* — served at `/api/agent-panel`. A `/api/panel` beside it would collide in the same directory on the same word.

CLAUDE.md records the estate's rule for exactly this: `/plot-panel` is named `panel`/`juror` and never `verdict`, *"which in this estate is a slice's wave eligibility."* The same care applies one level out. `Interrogate` is unclaimed and matches `/challenge-the-plan`'s vocabulary.

### It decides nothing

`/plot-panel` *"moves no phase and decides nothing"* — it produces verdict files and a reconciliation for a caller to act on. The button inherits that: **no phase write, no approval, no dispatch.** A divided panel is reported and the operator decides, which is the mechanism's own unattended rule.

**So this action is safe to run without asking**, unlike Approve or Deliver: its whole output is a file and a count.

### Which cards offer it

**A plan at `Draft`.** Interrogating an Approved plan is a question whose answer changes nothing the lifecycle reads, and `/plot-deliver` runs its own delivery panel with a different commitment vocabulary.

**A card already running a panel offers no second one.** Two panels writing one subject directory would interleave verdict files and the moderator would read a mixture.

**The mechanism is `ideaStatus`'s, not `action-receipt`'s.** An earlier draft of this plan cited `action-receipt.ts`, and a juror refuted it: that file is three words — `export type ControllerAction = 'dispatch' | 'approve' | 'deliver'` — and answers nothing about what is running. `idea.ts:369` is the shape this needs: *"Read back what an earlier POST started. Never spawns, never blocks."* It reads a log path and a state file keyed by the subject, which is exactly what a per-plan panel wants.

### Reporting

The button reports what every spawn action reports: running, then the log path. **The moderation is the result and it is a file** — the card's rounds chip moving from `0` to `1` is the visible outcome, and the operator opens `panel.md` to read why.

### The chip informs; Approve is never disabled

**Asked 2026-09-26 whether `Approve` should be disabled at `Rounds: 0`. It should not, and the estate has already voted.**

**195 plans reached Delivered or Released carrying no `Rounds:` field at all**, against 144 plans with one, out of 346. A gate refusing approval on an uninterrogated plan would have blocked the majority of everything this estate has shipped.

The rule behind the measurement: `/plot-panel` is *"a mechanism, not a lifecycle step"* and *"moves no phase and decides nothing."* A gate requiring it would make an optional mechanism into a phase transition by the back door — and it is the shape people route around, since a one-juror panel would tick the box and produce a recorded round that means nothing.

**What the card should do instead is distinguish the two states it currently renders identically.** `schema.ts:163` already draws the line:

> `0 rounds` reads as *interrogated and found nothing*; a missing block means nobody asked.

Those are different claims and the chip shows them the same way — the same grey as `no story`. A plan nobody has questioned is worth marking; a plan questioned and found sound is not the same thing and must not be marked as if it were.

**Informing, never forbidding.** The operator decides whether a plan is questioned enough, and this makes the fact legible rather than making the decision.

### What this does NOT do

- **It does not implement a panel.** The skill owns the fan-out, the gate and the reconciliation.
- **It does not choose the lenses.** `/plot-panel` states that lens choice is the caller's judgement about the subject; the prompt names the plan and lets the skill's Draft-caller defaults apply.
- **It does not act on the verdict.** No auto-approve on `unanimous: proceed`, and no auto-reject. The panel is evidence and the person decides.
- **It does not change `/plot-panel`.** If the skill needs a change to run from a button, that is a finding rather than a thing to work around here.
- **It does not disable `Approve`.** See above: 195 shipped plans carry no round, and a gate on the count would refuse the estate's own history.
- **It adds no round counter.** The skill records the round; a board that also wrote one would double it.

## Done when

- A Draft card shows `Interrogate` beside `Approve`.
- Clicking it runs the configured command and the plan's `Rounds:` increases by one.
- With the config key absent, the button refuses and names the key as the fix.
- An Approved, Delivered or Released card does not offer it.
- A card whose panel is in flight does not offer a second.
- A plan with no `Rounds:` field renders differently from one recording `Rounds: 0`.
- `Approve` is enabled at every round count, including none.
- The new route is registered in the write-gate test, as every `POST /api/*` must be.

## Slices

### A card sends its plan to the jury (Branch: `feature/a-card-sends-its-plan-to-the-jury`)

The `Interrogate command` config key, the endpoint, the button, its four refusals, and the write-gate registration.

## Notes

The rounds chip is what makes this worth building rather than a convenience: the board already measures how interrogated a plan is and already shows it on the card. An action that moves a number the card displays is a smaller claim than one that introduces the number.
