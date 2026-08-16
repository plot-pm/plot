---
title: How Plot cuts work into pieces
author: jwloka
status: active
created: 2026-08-16
updated: 2026-08-16
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

## Plans

| Plan | Status | What it covers |
|------|--------|----------------|
| [plot-sprint-support](../../plans/active/plot-sprint-support.md) | Approved, never started | Time-boxed planning with MoSCoW priorities — the sprint half of the vocabulary |

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
