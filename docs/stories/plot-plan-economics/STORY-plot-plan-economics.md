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

1. **What did this plan cost?** — measured, in tokens and francs, summed from
   what the agents actually did.
2. **What is this work for?** — the sprint goal and priority the plan serves,
   visible to whoever is working on it, human or agent.

Both are **derivations from artifacts that already exist**. Neither introduces
a number a human estimates. That constraint is the story, not a caveat on it.

## Why Now

The Plot × Kraftwerk RefCard (August 2026) names this as the most urgent of its
three consequences, and as a positioning risk rather than a feature gap:

> Tokens per step are a commodity and free to obtain today. Cost per approved
> plan and per human decision are not — Kraftwerk has no such reference
> quantity, because it does not know approval. If we fail to separate these
> sharply, we sell something that is available for nothing.

Kraftwerk's `stats.ts` already carries `durationMs`, four token counters and
`costUsd` per phase, attributed to `agent`, `harness`, `model` and `effort`,
with `attempts` defined as *"1 + number of correction rounds"* so retries stay
visible. It is MIT-licensed and shipping. Competing on that number is competing
on a commodity.

The denominator is the part Kraftwerk **structurally cannot compute**. It has
no approval to divide by: the word `approve` appears once in the whole
repository, as `permissions auto-approved` for unattended routines — approval
as something you configure away. Plot records approvals by name, in the plan,
in git.

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
scarce resource is not execution. Agents produce diffs cheaply; the RefCard's
counter-example is six hundred lines, every check green, and nobody wanted the
result. What made a plan worth building was the interrogation that settled its
decisions and the approval that named someone accountable. Cost per approved
plan is the honest unit **because the approval is the scarce half** — the
denominator is the value, and the numerator is the commodity.

## Current Plan

No plans yet — `draft` until the first is interrogated. This story is
downstream of [[plot-agent-identity]] for per-role attribution, but neither
half below is blocked on it.

- ⏸️ **A plan says what it cost** — derive from transcripts, per plan. Never
  stored, absent when unreadable.
- ⏸️ **A branch says what it is for** — project the sprint goal and MoSCoW tier
  onto the wave, for the human and for the dispatched agent's brief.
- ⏸️ **Cost per approved plan, stated as such** — the ratio and its
  denominator, with retries visible rather than averaged away.

## Open Points

- ⏸️ Does cost belong on the board, in the scan footer, or only in
  `/plot-deliver`? Rendering it continuously invites optimising the commodity.
- ⏸️ How is a *rejected* or abandoned plan counted? Its cost is real and its
  denominator is zero — the honest number may be the uncomfortable one.
- ⏸️ Are transcripts a stable enough source? The registry's own docstring warns
  the format is *"the runtime's private business and may change"*. Costing must
  degrade to absent, never to a wrong figure.
- ⏸️ Does the sprint goal reach the **agent's brief**, or only the human's
  view? Putting a goal into a worker prompt risks scope widening — the very
  thing the current `Worker command` explicitly forbids.
- ⏸️ Is per-role cost worth having before roles exist, or does this story wait
  on [[plot-agent-identity]] entirely?

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-27 | Cost is derived, never stored | Keeps manifesto Q1 (git is the database) and Q8 (no effort tracking). A stored cost is a record that can be wrong. |
| 2026-08-27 | Value is projection, not estimation | The sprint goal, MoSCoW tier and named approver already exist in git. Any plan that asks a human for a value number has misread this story. |
| 2026-08-27 | The unit is cost per **approved** plan | Tokens per step are a commodity Kraftwerk gives away; the denominator is what Plot uniquely has. Requested explicitly by Jan Wloka. |
| 2026-08-27 | Separate story from [[plot-agent-identity]] | Different question, different failure mode; downstream, not inside. |

## Key Findings

### 2026-08-27 — Kraftwerk cannot compute the denominator

**Expected:** Kraftwerk's cost accounting was ahead and Plot needed to catch up.

**Discovered:** Ahead on the numerator only. `PhaseStats` attributes cost per
agent, model and attempt — genuinely better than Plot has. But the word
`approve` occurs once in the repository, as `permissions auto-approved` for
unattended routines. There is no plan, no story, no signature; approval is not
a concept it has, but a thing it configures away.

**Impact:** The competitive line is not "we also count tokens". Cost per
approved plan is not a metric Kraftwerk lacks by oversight — it is one its
model cannot express. That is a durable difference rather than a feature race,
and it decides how the work is framed.

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
| Per-step token display as a headline | The commodity Kraftwerk gives away free; leading with it sells what costs nothing | It becomes a debugging aid rather than a value claim |
| Billing or invoicing integration | External system; manifesto Q1 forbids the dependency | A customer engagement makes it concrete — then argue it there, not here |

## Session Log

### 2026-08-27 — Scoping from the Kraftwerk comparison

Split out of the agent-registry assessment when the cost question proved to be
a different kind of question from the identity one. Read `stats.ts`,
`okf.ts` and the `approve` occurrences in kraftwerk 0.12.0; read Plot's sprint
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
- Kraftwerk's inability to compute the denominator is structural, not a gap
- OKF's trust tiers (`unverified` / `machine-confirmed` / `human-reviewed`,
  derived in twelve lines from a `human:` name prefix) are a candidate mechanism
  for making the human half legible — noted, not yet scoped

---
