---
title: What a plan costs, and what the approval was worth
author: jwloka
status: draft
created: 2026-08-27
updated: 2026-08-27
---

# What a plan costs, and what the approval was worth

## Objective

Answer two questions Plot can already source but never states:

1. **What did this plan cost?** — measured, in **tokens**, summed from what the
   agents actually did.

   > **Narrowed 2026-08-29, by measurement.** This read *"in tokens and
   > francs"*. A transcript in this repo carries all four token counters
   > (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
   > `cache_read_input_tokens`) and the `model` per turn — **and no monetary
   > field of any kind**. Plot has no price table either; `grep -rniE
   > "price|pricing|per million|costPerToken|CHF"` over `packages/board/src`
   > returns only prose.
   >
   > **So tokens are a derivation and francs are not.** Money would require a
   > per-model price table that Plot would have to carry, that changes
   > externally, and that nothing could verify — a stored number that can be
   > silently wrong, which is precisely what
   > *"cost is derived, never stored"* was written to exclude. Currency is
   > therefore **out of scope until a price source exists that Plot can read
   > rather than embed**, and the unit of this story is the token.
2. **What is this work for?** — the sprint goal and priority the plan serves,
   visible to whoever is working on it, human or agent.

Both are **derivations from artifacts that already exist**. Neither introduces
a number a human estimates. That constraint is the story, not a caveat on it.

## Why Now

A survey of a comparable agent runtime (August 2026) named this as the most
urgent of its consequences, and as a **positioning risk rather than a feature
gap**:

> Tokens per step are a commodity and free to obtain today. Cost per approved
> plan and per human decision are not. If we fail to separate these sharply, we
> sell something that is available for nothing.

That is not hypothetical. A shipping, MIT-licensed runtime already carries
per-phase duration, four token counters and a cost figure, attributed to agent,
model and effort, with attempts defined as *1 + correction rounds* so retries
stay visible. **Competing on that number is competing on a commodity.**

**The denominator is the part such a runtime structurally cannot compute.** It
has no approval to divide by — in the one surveyed, the word `approve` appears
once in the entire repository, as auto-approved permissions for unattended
routines: approval as a thing you *configure away*. Plot records approvals by
name, in the plan, in git.

## Decisions Taken in Scoping

**Q: Isn't "value" exactly the effort tracking the manifesto forbids?**
It would be, if value meant an estimate someone types. Manifesto question 8 —
*"Does it stay focused on scheduling, or creep into effort tracking?"* — is the
gate this story must pass, and it is the reason the objective is worded as a
derivation. See *The distinction this story defends* below; if any plan under
this story starts asking a human for a number, the plan is wrong, not the
question.

**Q: Why is this not part of [[plot-agent-identity]]?**
Different question and different failure mode. That story asks *who is doing
the work*; this one asks *what the work was worth doing*. They touch at one
point — per-role cost is only possible once roles exist — which makes this
story **downstream** of that one, not inside it.

**Q: Why not fold into [[plot-planning-model]]?**
That story owns what the units *are*. This one adds no unit: cost attaches to
a plan, value is already on the sprint. If it turns out a new term is needed,
that is a question to raise there.

## The distinction this story defends

The two halves look adjacent and are epistemically opposite. Confusing them is
how a planning tool becomes a time-tracking tool.

| | **Cost per approved plan** | **Value of the interrogation** |
|---|---|---|
| **Question** | What did we spend to get this? | Why is a person spending attention here? |
| **Source** | Transcripts, summed | The sprint goal, the MoSCoW tier, the named approver — all already written |
| **Epistemics** | Measured, after the fact | Recorded, before the fact |
| **Who produces it** | Nobody — it is derived | A human already did, at approval |
| **If absent** | We cannot price the work | The work proceeds without knowing what it serves |
| **Failure if done wrong** | Averaging retries away; counting tokens as the product | Asking for a story-point estimate |

**Cost is arithmetic.** Plot's registry already joins transcripts by exact
session id and reads `model`, `contextTokens` and `lastActivity`. Summing by
plan, and later by role, needs no new input and no new judgement. Nobody types
it; if the transcript is unreadable the answer is absent, never guessed — the
rule the registry already follows.

**Value is projection, not estimation.** Every sprint already carries a
`## Sprint Goal` — W35's is one sentence: *"A valid board state, shown
honestly, in every section."* Every member already sits in a MoSCoW tier. Every
approval already names a person and a date, and `/plot-approve` records the
channel through which it happened. All of it exists in git. None of it is
visible on the branch where the work happens: an `AgentRow` knows its `sprint`
as a **string**, and neither the human on that branch nor the agent dispatched
to it can see what that sprint is *for*.

So the second half asks for no new number. It asks that the thing a human
already decided — during interrogation, at approval — travels to where the work
is done.

**Why the interrogation is the valuable act.** Plot's own evidence is that the
scarce resource is not execution. Agents produce diffs cheaply; the standing
counter-example is six hundred lines, every check green, and nobody wanted the
result. What made a plan worth building was the interrogation that settled its
decisions and the approval that named someone accountable. Cost per approved
plan is the honest unit **because the approval is the scarce half** — the
denominator is the value, and the numerator is the commodity.

## Current Plan

No plans yet — `draft` until the first is interrogated. This story is
downstream of [[plot-agent-identity]] for per-role attribution, but neither
half below is blocked on it.

- ⏸️ **A plan says what it cost** — derive from transcripts, per plan, in
  tokens. Never stored, absent when unreadable, *incomplete* rather than smaller
  when any slice is missing. **Not blocked on roles**: `registry.ts:236` already
  joins a transcript by exact session id, and session → branch → slice → plan is
  a chain Plot already has.
- ⏸️ **A branch says what it is for** — project the sprint goal and MoSCoW tier
  onto the plan and the board, **for the human**. Not into the worker prompt;
  see the settled point above.
- ⏸️ **Cost per approved plan, stated as such** — the ratio, its denominator,
  and beside it the cost that reached no approval. Retries visible rather than
  averaged away.

**Per-role cost is a fourth plan and waits on [[plot-agent-identity]]** — with
one implicit role it would be a column of one value. It becomes a `group by`
over an attribute that exists by then, which is why it is cheap later and
pointless now.

## Relation to the fleet domain design

**Both halves of this story are derivations over entities that now have specs.**

- **Cost** sums what agents did — [Agent](../the-master-agent-holds-the-fleet/DESIGN-agent.md) — over the work
  they did it on: [Slice](../the-master-agent-holds-the-fleet/DESIGN-slice.md), one branch each by definition.
- **Value** is the sprint goal and priority a plan serves —
  [Sprint](../the-master-agent-holds-the-fleet/DESIGN-sprint.md) and [Plan](../the-master-agent-holds-the-fleet/DESIGN-plan.md), whose double
  link is what makes a `disputed` item expressible at all.

**The trust-tier candidate in the session log was reached independently** by the
fleet story's [job 6](../the-master-agent-holds-the-fleet/STORY-the-master-agent-holds-the-fleet.md#6-which-of-my-own-claims-have-i-actually-verified),
which carries the caution this story should inherit: **a tier only helps where
something DERIVES it.** This repo already measures what happens otherwise — 84
`Jan Wloka` against 43 `jwloka` in approval records, and sprint boxes checked
over plans that were never delivered.

**That caution is this story's own constraint restated.** *"Neither half
introduces a number a human types"* and *"a tier must be derived, never
asserted"* are the same rule, one about the numerator and one about the
denominator.

## Open Points

- ✅ ~~Does cost belong on the board, in the scan footer, or only in
  `/plot-deliver`?~~ **Settled 2026-08-29: `/plot-deliver`, and not the board.**
  The story's own risk — *"rendering it continuously invites optimising the
  commodity"* — decides it, and the surface reinforces the unit: delivery is the
  moment a plan's cost is **final** and its denominator **exists**. A number on
  a 5-second pulse is a number someone watches go up; a number stated once, at
  the transition, is a number someone reads.

  **The board may render it after a plan is delivered**, where it is history
  rather than a live gauge. What it must not do is show a running total for work
  in flight.

- ✅ ~~How is a *rejected* or abandoned plan counted?~~ **Settled 2026-08-29:
  reported separately, never folded into the ratio.** Its cost is real and its
  denominator is zero, so including it makes the average meaningless and
  excluding it silently hides the expensive half of the truth.

  So a cost report has **two figures**: cost per approved plan, and cost that
  reached no approval. Plot already distinguishes the states this needs — a plan
  is `Draft` until `/plot-approve` writes an `Approved:` record, and a branch
  given up carries `deferred:`/`moved:` — so the split is derived, not judged.
  **The uncomfortable number is the point of measuring at all.**

- ✅ ~~Are transcripts a stable enough source?~~ **Yes for tokens, and the
  degradation rule already exists in code.** Measured 2026-08-29 on a live
  transcript: `usage` carries `input_tokens`, `output_tokens`,
  `cache_creation_input_tokens` and `cache_read_input_tokens`, with `model` per
  turn. `transcript.ts:133` records that these paths were *"MEASURED, not
  assumed (2026-08-19)"*, and `registry.ts:103` states the rule — *"From the
  transcript. Absent when it could not be read — never guessed."*

  **Costing inherits that rule rather than restating it**: an unreadable
  transcript yields an absent cost, and a plan with any absent slice reports
  *incomplete*, never a smaller total. **A partial sum is worse than no sum**,
  because it looks like an answer.

  **This is also the argument for tokens over money**: the token counters are in
  the artifact, while a price is not, so only one of the two can degrade
  honestly.

- ✅ ~~Does the sprint goal reach the **agent's brief**?~~ **Settled 2026-08-29:
  the human's view first; the brief only with a scope guard.** The risk is
  precise — `.plot/worker-prompt.sh` tells a worker *"do not re-derive them, do
  not widen the scope"*, and a sprint goal is a **wider** objective by
  construction. Handing an agent a goal it was told not to serve is an
  instruction conflict, and the worker prompt is the one place Plot cannot
  afford ambiguity.

  So: project the goal onto the **board and the plan**, where a person reads it.
  If it later goes into a brief, it goes as *context for judging a discovery*,
  never as an objective — and that is its own plan with its own interrogation.

- ✅ ~~Is per-role cost worth having before roles exist?~~ **No, and the story
  does not wait for it either.** Per-role attribution is genuinely blocked on
  [[plot-agent-identity]] — with one implicit role, every cost attributes to
  `default` and the grouping is a column of one value.

  **But per-**plan** cost is not blocked**, because the join it needs already
  exists: `registry.ts:236` joins a transcript *"by exact session id"*, and a
  session belongs to a branch, which belongs to a slice, which belongs to a
  plan. So the first plan under this story ships per-plan cost now, and per-role
  cost becomes a later, cheap addition — a `group by` over an attribute that by
  then exists.

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-27 | Cost is derived, never stored | Keeps manifesto Q1 (git is the database) and Q8 (no effort tracking). A stored cost is a record that can be wrong. |
| 2026-08-27 | Value is projection, not estimation | The sprint goal, MoSCoW tier and named approver already exist in git. Any plan that asks a human for a value number has misread this story. |
| 2026-08-27 | The unit is cost per **approved** plan | Tokens per step are a commodity a step-cost runtime gives away; the denominator is what Plot uniquely has. Requested explicitly by Jan Wloka. |
| 2026-08-27 | Separate story from [[plot-agent-identity]] | Different question, different failure mode; downstream, not inside. |
| 2026-08-29 | The unit is the **token**, not the franc | A transcript carries four token counters and `model` per turn, and no monetary field; Plot has no price table. Money would need an embedded, externally-changing table that nothing can verify — a stored number that can be silently wrong. |
| 2026-08-29 | Cost is stated at `/plot-deliver`, not on the live board | Delivery is when the cost is final and the denominator exists. A continuously rendered figure is one people optimise; the story names that risk itself. |
| 2026-08-29 | Unapproved cost is reported beside the ratio, never inside it | Denominator zero. Folding it in makes the average meaningless; dropping it hides the expensive half. Both figures are derived from records Plot already writes (`Approved:`, `deferred:`). |
| 2026-08-29 | An absent slice makes a plan's cost *incomplete*, never smaller | Inherits `registry.ts:103` — *"Absent when it could not be read — never guessed."* A partial sum is worse than none, because it looks like an answer. |
| 2026-08-29 | The sprint goal reaches the human view, not the worker prompt | `.plot/worker-prompt.sh` tells a worker not to widen scope; a sprint goal is a wider objective by construction. Handing it over is an instruction conflict in the one place Plot cannot afford one. |

## Key Findings

### 2026-08-27 — a step-cost runtime cannot compute the denominator

**Expected:** the comparison's cost accounting was ahead and Plot needed to
catch up.

**Discovered:** Ahead on the numerator only. Its per-phase statistics attribute
cost per agent, model and attempt — genuinely better than Plot has. But the
word `approve` occurs once in that repository, as auto-approved permissions for
unattended routines. There is no plan, no story, no signature; approval is not
a concept it has, but a thing it configures away.

**Impact:** The competitive line is not "we also count tokens". Cost per
approved plan is not a metric such a runtime lacks by oversight — it is one its
model cannot express. That is a durable difference rather than a feature race,
and it decides how the work is framed.

### 2026-08-29 — The artifact carries tokens, and no money at all

**Expected:** Cost in francs was a summing problem — the numbers were in the
transcripts and needed adding up per plan.

**Discovered:** A live transcript's `usage` object carries `input_tokens`,
`output_tokens`, `cache_creation_input_tokens` and `cache_read_input_tokens`,
plus `model` per turn. **It carries no monetary field**, and Plot has no price
table: `grep -rniE "price|pricing|per million|costPerToken|CHF"` over
`packages/board/src` matches only prose.

`transcript.ts` reads exactly **one** of the four counters today
(`cache_read_input_tokens`), so even the token sum is unbuilt — but every input
it needs is present in the artifact.

**Impact:** The story's unit changes from the franc to the token, and that is a
strengthening rather than a retreat. A franc figure would need a per-model price
table embedded in Plot, changing externally, verifiable by nothing — **a stored
number that can be silently wrong**, which the story's own first decision
(*"cost is derived, never stored"*) exists to forbid. Tokens degrade honestly
because they are in the artifact; money could only degrade into a wrong figure.

**This is the same defect the story warns about, found in its own objective.**
It asked for a number that no source produces, one paragraph after establishing
that the test of this story is whether a number is derived or typed.

### 2026-08-27 — The sprint goal never reaches the work

**Expected:** Value would need a new field somewhere in the plan format.

**Discovered:** Everything needed is already recorded. Sprints carry
`## Sprint Goal` and MoSCoW tiers; plans carry `Approved:` with a name, a date
and a channel. What is missing is a **projection**: `AgentRow` carries `sprint`
as a bare string, so a branch knows which sprint it belongs to and not what
that sprint is for.

**Impact:** The value half needs no new input from anyone, which is what keeps
it on the right side of manifesto Q8. It is a rendering and hand-off problem,
not a measurement one.

## Excluded from Scope

| Item | Reason | Revisit If |
|------|--------|------------|
| Human-estimated value or story points | Effort tracking; manifesto Q8 refuses it, and it is the exact failure this story is written to avoid | Never — a different story would have to argue against the manifesto |
| Time tracking of human hours | Same reason; Plot schedules work, it does not meter people | Never |
| Per-step token display as a headline | The commodity a step-cost runtime gives away free; leading with it sells what costs nothing | It becomes a debugging aid rather than a value claim |
| Billing or invoicing integration | External system; manifesto Q1 forbids the dependency | A customer engagement makes it concrete — then argue it there, not here |

## Session Log

### 2026-08-27 — Scoping from the runtime comparison

Split out of the agent-registry assessment when the cost question proved to be
a different kind of question from the identity one. Read the comparison's
statistics, knowledge and approval-related sources; read Plot's sprint
format (`docs/sprints/2026-W35-…`), `plot-sprint/SKILL.md` MoSCoW handling, and
`AgentRowSchema` on `origin/main`.

Jan Wloka asked specifically that cost per approved plan be distinguished from
the value of a human's interrogation and approval toward a sprint goal. That
distinction is now the story's central section, because it is also what keeps
the story inside manifesto Q8.

**Key outcomes:**

- Cost = measured and derived; value = recorded and projected. Opposite
  epistemics, adjacent surfaces.
- Neither half introduces a number a human types — the test any plan under this
  story must pass.
- The inability to compute the denominator is **structural**, not a gap
- **Trust tiers** (`unverified` / `machine-confirmed` / `human-reviewed`,
  derived rather than asserted) are a candidate mechanism for making the human
  half legible — noted, not yet scoped. Independently reached from the fleet
  story's job 6; see
  [the master agent holds the fleet](../the-master-agent-holds-the-fleet/STORY-the-master-agent-holds-the-fleet.md#6-which-of-my-own-claims-have-i-actually-verified).

---
