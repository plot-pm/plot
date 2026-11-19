---
title: The Delivery tab reads at a glance
author: jwloka
issue: https://github.com/plot-pm/plot/issues/3468
status: active
created: 2026-11-16
updated: 2026-11-16
---

# The Delivery tab reads at a glance

## Objective

Within five seconds of opening the Delivery tab, a developer answers four questions: what is the status of the release or of my sprint, am I the blocker and for what, how is the fleet doing, and where do I act. Every section has one shape: a header line of counts that link to their groups, and a body that holds only the rows to act on, under column headers.

## Why Now

The tab shows helpful information in an unhelpful way. Measured on the running board on 2026-11-16: one reason sentence repeats on about 30 rows, 30 ticket rows in **You** push two draft plans out of view, **Release delivery** lists about 40 rows where nothing needs anyone, internals such as desk paths and "PR data 485s ago" show as content, and no column carries a header. The design states the full measurement.

## Sources

- The approved design: [2026-11-16-delivery-tab-reads-at-a-glance-design.md](../../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16 after a builder check. The design is canonical; this story does not restate it.
- The design it builds on: [2026-11-08-delivery-tab-design.md](../../superpowers/specs/2026-11-08-delivery-tab-design.md), whose three plans are released in v2.33.0 (`every-work-item-and-agent-shows`, `rows-share-seven-columns-and-link`, `tickets-for-the-release-and-loose`).

## Decisions Taken in Scoping

- **Approach A: evolve the current tab in place**, one section per plan, each plan shipping alone. Approach B (a new view on the card grammar) and C (styling only) are rejected in the design. — jwloka, 2026-11-16
- **The "This sprint" filter is renamed "My sprint"** and switches the status card, the delivery section, You and Work items between release scope and sprint scope. — jwloka, 2026-11-16
- **A sprint has an owner** (`- **Owner:** <handle>` in the sprint's Status block); "My sprint" is the Active sprint the reader owns. — jwloka, 2026-11-16
- **You always means the reader** and ignores the Mine filter. — jwloka, 2026-11-16

## Current Plan

Six plans, one per entry in the design's "The Plans" section, in delivery order. Plan 1 lays the section-header pattern that plans 2 to 6 use, so each later plan's slices wait on plan 1's header slice.

| # | Plan | Section | State |
|---|------|---------|-------|
| 1 | [delivery-tab-header-and-my-sprint](../../plans/2026-11-16-delivery-tab-header-and-my-sprint.md) | Tab header and the toggle | Draft |
| 2 | [delivery-you-blocks-or-feeds](../../plans/2026-11-16-delivery-you-blocks-or-feeds.md) | You | Draft |
| 3 | [delivery-work-items-show-gates](../../plans/2026-11-16-delivery-work-items-show-gates.md) | Work items | Draft |
| 4 | [delivery-fleet-rows-per-agent](../../plans/2026-11-16-delivery-fleet-rows-per-agent.md) | Fleet | Draft |
| 5 | [delivery-release-progress-per-plan](../../plans/2026-11-16-delivery-release-progress-per-plan.md) | Release delivery | Draft |
| 6 | [delivery-machine-tickets-footer](../../plans/2026-11-16-delivery-machine-tickets-footer.md) | Machine, Tickets and footer | Draft |

## Open Points

- ⏸️ The six plans are Draft on one batch plan PR and wait for review.

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-16 | One plan per section, in the design's delivery order | Each section ships alone and keeps the browser tests' subjects. — the design's writer's call |
| 2026-11-16 | The plans name no `Issue:`; this story names issue #3468 | Six plans writing their phase to one issue would overwrite each other's plan-state comment. — the plan writer's call |

## Session Log

### 2026-11-16 — Story and plans created

The story and six Draft plans were created from the approved design. The plans sit on one batch plan PR.
