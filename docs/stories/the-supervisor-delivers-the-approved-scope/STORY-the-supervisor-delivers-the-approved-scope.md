---
title: The supervisor delivers the approved scope
author: jwloka
status: active
created: 2026-10-05
updated: 2026-10-05
---

# The supervisor delivers the approved scope

## Objective

With auto-dispatch on, the fleet runs as a release train: once started, it does everything it can to deliver the approved scope. Every stop in an approved plan is the fleet supervisor's to handle. The supervisor fixes what it can and escalates the rest at once, so that little can keep the approved scope from being delivered.

The master agent and a person are targets the supervisor escalates to. They are not the mechanism. A stop that only a watching master agent notices is a missing supervisor capability.

## The Rule

**With auto-dispatch on, the supervisor owns every stop in an approved plan.** For each stop it either:

1. **fixes it** — retries, re-asks the source of truth, hands the slice to a fresh agent, or releases and re-queues it; or
2. **escalates it at once** — lists it where a person looks, then notifies, and raises the notification as the stop ages.

A stop that the supervisor neither fixes nor escalates is a defect in the supervisor, not in the agent that stopped. It gets a plan under this story.

Auto-dispatch off keeps today's behaviour: the operator drives the fleet, and the supervisor only supervises the agents it was given.

## Why Now

One day on this estate, 2026-10-05, three approved plans in delivery with auto-dispatch on. Each stop below needed the master agent to find it by hand:

| Stop | Delivery time lost | What the supervisor did |
|---|---|---|
| An agent's `PLOT-BLOCKED` question went unanswered | 4 h 44 min (13:36 to 18:20) | Nothing. `person=0` on all 10,521 ticks: a free loop that stays alive reads `leave`. |
| The BuildMonitor wrote no finding for a green run (#1275) | 1 h (the loop's checks-wait bound) | Nothing. The loop waited for its bound. |
| A slice spent its correction budget | open at writing | Wrote a marker and stopped. |
| A slice was claimed but nobody worked it (#1276) | manual release by bypass | Nothing. No controller releases a claim. |
| The deliver route refused every Approved plan (#1280) | none this time; the fleet delivered on its own | — |
| The board read finished CI as running (#1277) | misleading rows for hours | — |

None of these needed new judgement. Each needed the supervisor to notice a stop and do the next obvious thing.

## Plans

| Plan | Stop it handles | State |
|---|---|---|
| [`an-unanswered-question-escalates`](../../plans/2026-10-05-an-unanswered-question-escalates.md) | An agent's question waits unanswered | Approved |
| `the-supervisor-asks-the-host-when-the-monitor-is-silent` | The BuildMonitor misses a run (#1275) | to draft |
| `a-spent-correction-budget-gets-a-fresh-agent` | A slice spends its correction budget | to draft |
| `the-supervisor-releases-a-stuck-claim` | A claim nobody works (#1276) | to draft |
| `the-deliver-route-finds-its-plan` | Deliver refuses a finished plan (#1280) | to draft |
| `the-board-re-asks-pending-checks` | CI read as running after it finished (#1277) | to draft |

The order follows the delivery time each stop cost. A plan joins this story when it names `Story: the-supervisor-delivers-the-approved-scope` in its `## Status`.

## Out of Scope

- **Answering a question for a person.** The supervisor escalates a question; it never answers one.
- **Widening a gate.** A stop caused by a gate is escalated, never fixed by weakening the gate.
- **Approving scope.** The release train delivers what is approved; it never adds to it.

## Related

- [`the-master-agent-holds-the-fleet`](../the-master-agent-holds-the-fleet/STORY-the-master-agent-holds-the-fleet.md) — the fleet's entity design (`DESIGN-agent.md`, `DESIGN-process.md`); this story adds the supervisor's duty under auto-dispatch.
- [`the-worker-loop-runs-in-js`](../../plans/2026-10-04-the-worker-loop-runs-in-js.md) — every loop ending that waits for a person writes a `blocked` declaration, which this story's escalation reads as a second signal.
