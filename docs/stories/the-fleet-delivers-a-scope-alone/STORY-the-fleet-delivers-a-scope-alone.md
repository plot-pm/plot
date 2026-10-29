---
title: The fleet delivers a scope alone
author: jwloka
status: active
created: 2026-10-29
updated: 2026-10-29
---

# The fleet delivers a scope alone

## Objective

A person starts a sprint of approved plans and turns auto-dispatch on. fleetd carries every plan in that sprint to Delivered and prepares the release, with no input from a person and no help from a master agent. The release is the one stop: it is published only when a person approves it.

The design is [DESIGN-delivery-loop.md](DESIGN-delivery-loop.md).

## Why Now

The master agent is the delivery mechanism today, not a fallback. From 2026-10-16 to 2026-10-29 one master session answered 99 `PLOT-BLOCKED` questions by hand, ran every `plot-review` and every slice merge from a watcher script, and started a fix agent for every HIGH finding and every red PR with a dead desk. When that session ends, delivery stops.

This story succeeds [the-supervisor-delivers-the-approved-scope](../archived/the-supervisor-delivers-the-approved-scope/STORY-the-supervisor-delivers-the-approved-scope.md), done on 2026-10-12. It reverses one line of that story's Out of Scope: *"The supervisor escalates a question; it never answers one."* Here the fleet answers every question and records the answer on the plan issue.

## Decisions Taken in Scoping

- **Approach:** fleetd decides through domain rules; named role agents (reviewer, fixer, unblocker, main-repair) do the judgement work. A supervisor agent session and a shell port of the master agent's scripts were rejected.
- **Scope:** the active sprint's plans, frozen when the sprint starts.
- **Only the release waits for a person.** Every other stop is handled by fleetd or by an agent fleetd starts.
- **A HIGH finding is fixed first.** A follow-up ticket exists only for a HIGH the fleet could not fix, and `plot/review` turns green on that head only once the ticket exists. The fleet gets no bypass rights.
- **MEDIUM and LOW findings get no ticket.** They go into a PR comment.
- **Ticket statuses follow the work** with no hand edit.
- **Anti-goal:** the default branch goes red and stays red.
- The 22 findings issues open on 2026-10-29 stay open.

## Current Plan

### Phase 1: Plans ⏸️

- ⏸️ Split the design into plans through `/plot-idea` and panel review
- ⏸️ Create the sprint that holds them

## Open Points

- ⏸️ The state file shapes for fixer attempts, the merge-in-flight mark and the run log (left to the builder)
- ⏸️ How the board shows the loop's steps (left to the builder)

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-29 | Approach A: fleetd decides, role agents work | Every decision is a testable rule and survives a session ending (jwloka) |
| 2026-10-29 | Scope is the active sprint, frozen at its start | The sprint already names the plans; nothing else defines the boundary (jwloka) |
| 2026-10-29 | An unfixed HIGH passes `plot/review` only through its ticket | The ruleset stays required and the fleet gets no bypass (jwloka) |
| 2026-10-29 | Design approved | jwloka |

## Excluded from Scope

| Item | Reason | Revisit If |
|------|--------|------------|
| Approving or writing plans, choosing a sprint's scope | The scope is what a person approved | Never for this story |
| Publishing a release without a person | A release cannot be undone | Never for this story |
| Closing the 22 open findings issues | jwloka keeps them open | A person asks |

## Session Log

### 2026-10-29 — Scoping and design

Brainstormed the goal with jwloka, recorded what fleetd automates today with a read-only recon of `packages/fleet` and `packages/domain`, and wrote the design. A builder check raised nine questions: jwloka answered three and the rest are recorded as calls in the design.

**Key outcomes:**

- Design approved by jwloka.
- Seven finished stories archived in `88ab8e4be` before this story started.
