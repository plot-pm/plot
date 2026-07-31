# Plot in the Pipeline

Plot deals with **plan management** — ceremony, approval, lifecycle,
collaboration — from a project-planning perspective. It is one layer of a
delivery pipeline, and it stays in its lane. This page shows the seams,
so adopters can wire their own tools on either side.

## The three layers

| Layer | Owns | Examples |
|---|---|---|
| **Plan management (plot)** | Which ceremony, who approved, what phase, where implementation lives; the board | `/plot-idea`, `/plot-approve`, `/plot-implement`, `/plot-deliver` |
| **Plan content** | Writing specs and plans, executing them, reviewing code | your brainstorming / spec-writing / plan-execution workflow of choice |
| **Domain knowledge** | How code is actually written here | your stack-, framework-, and project-specific skills and rules |

Plot never writes plan *content* and never implements. When a plot
command notices a content gap ("this idea reads unshaped"), it routes out
and names the kind of step needed — a discovery interview, a design
session — rather than absorbing the work.

## Hand-off contracts

**Inbound (something → plot):** upstream tools deliver a *shaped input* —
a ready ticket, a spec, discovery notes. Plot never re-asks what the
input already answers; its intake only fills what's missing (goal, why,
constraints, sources).

**Outbound (plot → implementation):** `/plot-implement` produces a brief
that pre-answers the mechanics — branch and base, PR-or-direct, review
channel, done-criteria, canonical plan link. Implementation-side tooling
must not re-ask those ("merge, PR, or cleanup?" is answered by the
brief's *Ends as* line). The implementing session needs no plot at all in
the minimal case: brief + plan link suffice.

**Sideways (tracker):** where a tracker is the system of record, it owns
work items, business status, and sprints; plot owns reviewable plans,
narrative continuity, and plan phases. Plans reference tickets, never
mirror them.

## Where stories sit

Stories (the `story-tracking` companion) are the umbrella layer *above*
plans: they hold what neither tickets nor plans structurally can —
multi-session narrative, decisions with their reversals, findings, dead
ends. The triage rule: a story exists only when no umbrella (ticket →
existing story → plan) can hold the effort's knowledge, or when knowledge
overflows the one that exists.

## Design intent

The boundary is deliberate (Manifesto: "deliberately small and
opinionated"). Plot being vendor-neutral about the content layer is what
lets teams keep their own writing and implementation workflows — plot
composes with them instead of competing.
