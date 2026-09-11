---
title: An agent is declared and corrected
author: jwloka
status: active
created: 2026-09-11
updated: 2026-09-11
---

# An agent is declared and corrected

## Objective

Make a Plot fleet autonomous in the one direction it is not: **let an agent be declared as a kind of worker rather than an interchangeable one, and let a failed gate become a correction rather than a halt.**

Plot's gates are strong and its fleet is parallel. What it lacks is the second half of a gate: every refusal ends at a person. A fleet whose every failure requires a human is not autonomous — it is parallel and supervised.

## Why Now

Four measurements, taken 2026-09-12 on this estate.

**An agent cannot say what it is.** `CharterSchema` (`packages/domain/src/entities/charter.ts`) declares `harness`, `model`, `effort` and `capabilities`. Readers on the estate:

| field | readers |
|---|---|
| `harness` | **0** |
| `model` | **0** |
| `effort` | **0** |
| `capabilities` | **0** |

Charters on the estate: **0**. The prompt half is wired end to end — `plot-prompt.mjs` resolves which prompt an agent runs and refuses rather than falling back on a broken charter — while the *invocation* still comes from one global `Worker command` read at `plot-dispatch.sh:749`. This is the defect class CLAUDE.md already names: *"Where a rule exists and nothing calls it, that is a defect to report."* It is `setSprintState` again — nine refusals, zero callers.

**A build failure reaches nobody.** `plot-build-monitor.sh:370` detects a failing run and publishes `build failed`. Consumers of that finding on the estate: **none**. The board reads `buildMonitorPid` and nothing reads the finding. So CI's verdict is measured, published, and dropped.

**The only correction path is a person.** `plot-worker-loop.sh:1683` writes a `PLOT-BLOCKED` marker whose text ends *"fix the invocation in the prompt file, then restart this agent."* That is correct for a prompt that never ran. It is the only shape Plot has, so a failing test on a slice produces a stopped agent rather than a second attempt.

**73% of plans are never questioned.** 262 plans, **71** carrying a `Rounds:` field — 27%. Of those 71, 33 stopped at one round. `/challenge-the-plan` asks four questions per round and states that comprehensive coverage needs five to ten rounds, so full coverage costs 20–40 questions with a person answering each. The uptake is a cost measurement, not a disagreement about value.

## The shape

Two capabilities, sharing no code and both missing:

**An agent is declared.** A charter names a harness, a model, a tool scope and a set of capabilities, and the fleet acts on all four. This makes a specialised agent expressible — which `DESIGN-agent.md:203` already anticipated: *"A specialised agent that never becomes a loop-worker still has a registry entry and simply has no worker — which is the case this distinction exists to keep expressible."* The vocabulary was built for it; nothing populates it.

**A gate corrects.** A failing check produces a correction prompt into the agent's own session, bounded by an attempt budget, and blocks only when the budget is spent. Plot already holds every piece: the session id the manifest records, the resume flag the loop decides, the `attempts` counter the supervisor reads, and a monitor that already knows the build failed.

A third strand rides the same mechanism: **a plan is questioned by several lenses at once, in parallel, rather than by one interrogator in sequence.** That converts the 27% from a cost problem into a dispatch.

## What this story does not do

**It does not make agents share a desk.** `DESIGN-worktree.md:§1` — a worktree is *"the fleet's unit of isolation — the reason several agents can work at once without touching each other's files."* Two incidents on this estate are post-mortems of accidental sharing: a `PLOT-BLOCKED` marker written by another branch's worker made a finished branch read as blocked, because *"the protocol assumes one worker per worktree and has no writer identity"*; and a `git stash` returned a stranger's parked work, because stash entries are per-repo rather than per-worktree. Sequential handover on one desk is a separate question and is deliberately out of scope here.

**It does not add a step list.** Plot's slices fan out in parallel with dependency ordering and a merge queue. A linear sequence of steps within one run is a weaker model and adopting one would be a downgrade.

**It does not introduce a second scheduler.** The supervisor schedules this fleet. A second timer over the same estate is the pattern-guess shape that killed an operator's board on 2026-09-04.

## Vocabulary

The terms are `DESIGN-slice.md`'s and binding here.

A **Slice** holds exactly one branch and belongs to one plan — it is what one agent works on, authored by a person, written in a plan file. A **Wave** is the fleet's cohort: many slices, from several plans, sized by what can land together, and **persisted nowhere**. They are not nested versions of one idea.

This story's juries are **per plan**, never per wave. A wave's slices come from unrelated plans, so a jury over one has no shared subject.

The code still says `Wave` where it means `Slice`. That is a known defect with its own plan, and no slice here may add to it.

## Slices

| # | plan | what it settles |
|---|---|---|
| 1 | [an-agent-declares-what-it-runs](../../plans/2026-09-12-an-agent-declares-what-it-runs.md) | the charter's `harness`, `model` and `effort` reach the invocation |
| 2 | [a-charter-bounds-what-an-agent-may-touch](../../plans/2026-09-12-a-charter-bounds-what-an-agent-may-touch.md) | `capabilities` becomes an enforced tool scope, not a prompt |
| 3 | [a-failed-gate-becomes-a-correction](../../plans/2026-09-12-a-failed-gate-becomes-a-correction.md) | the build finding reaches the agent that caused it |
| 4 | [a-panel-questions-one-plan](../../plans/2026-09-12-a-panel-questions-one-plan.md) | the panel mechanism: fan-out, verdict files, commitment gate, reconciliation |
| 5 | [a-plan-is-questioned-before-it-is-approved](../../plans/2026-09-12-a-plan-is-questioned-before-it-is-approved.md) | the Draft panel, and the delivery panel it shares a mechanism with |

Slices 1 and 2 are independent of 3–5. Slice 4 is the mechanism slice 5 consumes.

## Definition of Done

- A charter naming a harness this machine cannot run **refuses**, and names what it looked for.
- A failing build produces a second attempt without a person, and a `PLOT-BLOCKED` marker only once the budget is spent.
- Every `PLOT-BLOCKED` marker names the agent that wrote it.
- A panel's verdict is a file on disk carrying a committed position, not a claim in a transcript.
- No new code says `Wave` where it means `Slice`.
