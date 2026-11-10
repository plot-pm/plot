---
title: The fleet delivers a scope alone
author: jwloka
status: done
created: 2026-10-29
updated: 2026-11-09
archived: 2026-11-09
---

# The fleet delivers a scope alone

## Objective

A person starts a sprint of approved plans and turns auto-dispatch on. fleetd carries every plan in that sprint to Delivered and prepares the release, with no input from a person and no help from a master agent. The release is the one stop: it is published only when a person approves it.

The design is [DESIGN-delivery-loop.md](DESIGN-delivery-loop.md).

## Why Now

The master agent is the delivery mechanism today, not a fallback. From 2026-10-16 to 2026-10-29 one master session answered 99 `PLOT-BLOCKED` questions by hand, ran every `plot-review` and every slice merge from a watcher script, and started a fix agent for every HIGH finding and every red PR with a dead desk. When that session ends, delivery stops.

This story succeeds [the-supervisor-delivers-the-approved-scope](../the-supervisor-delivers-the-approved-scope/STORY-the-supervisor-delivers-the-approved-scope.md), done on 2026-10-12. It reverses one line of that story's Out of Scope: *"The supervisor escalates a question; it never answers one."* Here the fleet answers every question and records the answer on the plan issue.

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

### Phase 1: Plans ✅

- ✅ Split the design into 11 plans through `/plot-idea` and panel review: `fleet-roles-are-declared-agents`, `the-delivery-loop-keeps-a-run`, `fleetd-reviews-every-slice-pr-in`, `fleetd-merges-slice-prs-one-at`, `a-high-finding-is-fixed-before`, `the-fleet-answers-plot-blocked-questions`, `tickets-follow-the-delivery-loop`, `a-dead-desk-gets-a-fixer`, `a-red-default-branch-is-repaired`, `the-release-waits-for-one-approval` and `ci-runs-what-the-change-touches` (plans in `docs/plans/` dated 2026-10-29 and 2026-10-30). All 11 are Released in v2.30.0 on 2026-11-03.
- ✅ Create the sprint that holds them: [2026-W44-delivery-loop](../../../sprints/2026-W44-delivery-loop.md), Closed 2026-11-03, Release 2.30.0. The follow-up sprint [2026-W45-follow-ups-2-30-1](../../../sprints/2026-W45-follow-ups-2-30-1.md) continued the story.

## Open Points

- ✅ The state file shapes for fixer attempts, the merge-in-flight mark and the run log (left to the builder). The builders set them in the plans: the per-PR attempts record and ticket record under `.plot/state/` in [a-high-finding-is-fixed-before](../../../plans/2026-10-29-a-high-finding-is-fixed-before.md), the run log and notify record in [the-delivery-loop-keeps-a-run](../../../plans/2026-10-29-the-delivery-loop-keeps-a-run.md), and the `merge-in-flight` hold, a reading of `.plot/state/default-branch.json` with no file of its own, in [fleetd-merges-slice-prs-one-at](../../../plans/2026-10-29-fleetd-merges-slice-prs-one-at.md).
- ❌ How the board shows the loop's steps (left to the builder). Not built: [the-delivery-loop-keeps-a-run](../../../plans/2026-10-29-the-delivery-loop-keeps-a-run.md) lists "No board view of the run log" under *Out of this plan*, and no later plan takes it. A person who wants the view opens a new plan.

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-29 | Approach A: fleetd decides, role agents work | Every decision is a testable rule and survives a session ending (jwloka) |
| 2026-10-29 | Scope is the active sprint, frozen at its start | The sprint already names the plans; nothing else defines the boundary (jwloka) |
| 2026-10-29 | An unfixed HIGH passes `plot/review` only through its ticket | The ruleset stays required and the fleet gets no bypass (jwloka) |
| 2026-10-29 | Design approved | jwloka |
| 2026-11-09 | Story closed with all 11 plans Released; the board view of the loop's steps stays unbuilt | jwloka decided the story is done: the objective (fleetd carries a sprint to Delivered and the release waits for one approval) shipped in v2.30.0 |

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

### 2026-11-09 — Closed

- jwloka closed the story. All 11 plans of sprint `2026-W44-delivery-loop` are Released in v2.30.0 (2026-11-03), and the sprint closed on 2026-11-03.
- Phase 1 and the first Open Point read as paused although the plans and the sprint exist. This entry marks them done, records the second Open Point (board view of the loop's steps) as not built, and archives the story.
