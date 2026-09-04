---
title: How Plot cuts work into pieces
author: jwloka
status: done
created: 2026-08-16
updated: 2026-09-04
---

# How Plot cuts work into pieces

## Objective

Keep the vocabulary Plot uses to divide work — **stories, plans, waves,
branches, sprints** — coherent, and each term earning its place. Every one of
them answers a different question, and the cost of blurring two of them is paid
later, in plans filed under the wrong thing and commands that ask the wrong
question.

The distinctions this story is responsible for:

| Term | Answers | Lifetime |
|------|---------|----------|
| **Story** | *why* — the durable intent several plans serve | outlives its plans |
| **Plan** | *what* — one approved, actionable unit | one lifecycle |
| **Wave** | *in what order* — branches that may start once earlier ones merged | within a plan |
| **Sprint** | *when* — a time-boxed selection of already-planned work | one time box |

## Why Now

The story/sprint distinction was stated for the first time on 2026-08-16, in
the middle of a different plan's interrogation, and it immediately corrected a
question that had been asked wrongly. Asked which story `plot-sprint-support`
should get, the honest answer was that the question confused two axes: a sprint
is **a selection from** planned work, not **a kind of** intent. A plan belongs
to exactly one story, and may or may not sit in a sprint.

The plan format has always encoded this correctly — `Story:` and `Sprint:` are
independent fields at the same level, neither aware of the other — but nothing
had written down *why*. Meanwhile the template shipped with `Sprint:` (optional)
and without `Story:` (which every plan needs), so the vocabulary was clear in
the parser and muddled in the artifact people actually fill in.

## Decisions Taken in Scoping

**Why not fold this into `plot-gates`?** That story is about instructions that
do not enforce themselves. This one is about whether the concepts are right in
the first place. A gate that enforces a muddled distinction enforces the muddle.

**Scope boundary.** This story owns the *meaning* of the terms and the commands
that create and coordinate them (`/plot-idea`, `/plot-sprint`, wave arithmetic).
It does not own their display — the board renders stories as swimlanes and
sprints as badges, and that belongs to `plot-board`.

**Sprints are unproven here.** `plot-sprint-support` has been approved since
February and never started; `docs/sprints/` does not exist. That is a fact
about the story's state, not a reason to close the plan: the concept is defined
and unused, which is a different thing from wrong.

## Open Questions

- ⏸️ **The vocabulary has no term for work whose output is a decision.** Raised
  2026-08-16, from the board: Discovery is a rendered column that is
  structurally always empty, and asking why led back here rather than to
  `plot-board`.
  Every term in the table above answers a question about work already
  understood — *why*, *what*, *in what order*, *when*. None answers **"we do
  not yet know what this is."** The four-term model assumes discovery has
  already happened by the time anything gets named, so the act of writing a
  plan file is the act of leaving Discovery. That is coherent, and it is why
  the column can never fill.
  Two of the four things that prompted the question turn out to be placed
  already, and saying so narrows the gap usefully:
  **a tracer bullet is a wave**, not a discovery activity — `### Tracer` sits
  under `## Branches` and three plans use it; it proves a seam before fan-out
  and is code, so Development is the right column. **A design spec is the plan
  file itself.** What has no home is work whose product is knowledge:
  **a spike** — throwaway investigation to decide whether a plan is viable at
  all, ending in a finding rather than a branch — and **a concept that is not
  yet a story**, which is precisely what four rounds of interrogation produced
  before `fleet-sees-merged-branches` existed as a file.
  **A `Type: spike` was the first candidate, and it is the wrong shape.** The
  question that dissolved it: *are plans in Draft not exactly the pre-plan
  work?* Checked against what Draft phases actually contain rather than what
  they are assumed to contain:

  ```
  #126 idea/fleet-sees-merged-branches   5 commits, 545 lines, 0 code
  #121 idea/fleet-sees-local-work        2 commits, 141 lines, 0 code
  ```

  And what those five commits *did*: built throwaway fixtures, measured a
  first-parent filter and **discarded** it, tested a second-parent check and
  **discarded** it, measured 197ms against 79ms, found that GitFlow breaks the
  design. That is not writing down a plan already held — it is finding out what
  the plan should be, and most of it was thrown away. **That is a spike.** It
  merely happens to be carried in a plan file.

  So the missing thing is not a new plan *type*. It is that **Draft already is
  the discovery phase**, and nothing reads it that way. A plan in Draft is not
  a commitment; it is the investigation deciding whether there is one.
  Approval is the moment discovery ends.

  The four terms stay as they are — no fifth term, no new type, consistent with
  the principle that every term must earn its place. What changes is only the
  reading of an existing phase.

  Corroborating, and visible on the board today: the two cards in Design are
  `opus5-longhorizon-hardening` (approved July) and `plot-sprint-support`
  (approved **February**). Neither is being designed; both are finished designs
  waiting for capacity. Meanwhile the two plans where design is actually
  happening are in no column at all. One column holds two different things
  while the work itself is invisible.

  Still not decided here — but the decision is now about a *phase reading*, not
  about vocabulary, which is a much smaller question. The rendering half is in
  [[plot-board]]; display follows meaning, per the scope boundary above.

## Plans

| Plan | Status | What it covers |
|------|--------|----------------|
| [plot-sprint-support](../../plans/2026-02-11-plot-sprint-support.md) | Released | Time-boxed planning with MoSCoW priorities — the sprint half of the vocabulary |
| [a-sprint-names-what-it-ships](../../plans/2026-08-18-a-sprint-names-what-it-ships.md) | Released | A sprint declares the release it targets, so the gate has something to read |
| [the-index-is-derived](../../plans/2026-08-18-the-index-is-derived.md) | Released | The phase a plan declares decides where it appears; the symlink index stops being a second truth |
| [a-plan-moves-through-the-sections](../../plans/2026-08-22-a-plan-moves-through-the-sections.md) | Approved | The lifecycle a board reader walks: approve a plan, see it where work is taken, start it |
| [approval-hands-the-work-to-agents](../../plans/2026-08-22-approval-hands-the-work-to-agents.md) | Draft | Approval as the handover: eligible waves dispatch themselves, bounded by a cap the operator holds |
| [an-approved-plan-offers-its-two-starts](../../plans/2026-08-22-an-approved-plan-offers-its-two-starts.md) | Draft | The two ways to begin an approved plan — a person implements it, or a fleet dispatches it |
| [an-interrogation-leaves-a-record](../../plans/2026-08-22-an-interrogation-leaves-a-record.md) | Draft | A challenged plan says so: the round count reaches the file, so interrogated and unexamined stop looking alike |

> Three of these arrived on 2026-08-22 and they are one line of work: the
> vocabulary this story keeps coherent is no longer only *what the words mean*
> but *what the board does with them*. Approval is the handover from human-led
> to agent-led — the column model has said so since Design became a phase — and
> these three make the board act on it rather than describe it.

## Session Narrative

**2026-08-16 — the distinction, stated during someone else's interrogation.**
While interrogating `push-main-bypass`, the question "which story does
`plot-sprint-support` deserve?" was answered with a correction rather than a
choice: sprints are sub-slices of planned work, so the question was mixing two
axes. Checking the template confirmed the muddle had a physical form — `Sprint:`
present, `Story:` absent, in the file `/plot-idea` fills in. That template fix
went into `push-main-bypass`, which was already touching the story estate; this
story exists to hold the reasoning behind it and whatever the distinction
turns up next.
