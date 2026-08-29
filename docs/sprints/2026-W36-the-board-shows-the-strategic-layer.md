# Sprint: The board shows the strategic layer

> The board shows plans and agents but not the stories that organize them. A
> reader who wants the big picture — why are we doing all this? — has to open
> story files by hand. This sprint adds the Stories tab, completing the
> strategy → artifacts → execution funnel.

## Status

- **Phase:** Active
- **Start:** 2026-09-01
- **End:** 2026-09-05
- **Release:** <!-- filled when sprint closes -->

## Sprint Goal

**The board shows stories as the strategic layer above plans.**

A reader can:
1. See all stories organized by status (Draft/Active/Done/Archived)
2. Navigate from story to its plans and back
3. Spot status drift (story says "active" but all plans are released)
4. Browse topics via tag cloud

The tab order becomes Stories · Plans · Agents — strategy at the top, execution
at the bottom.

## Story

- [the-master-agent-holds-the-fleet](../stories/the-master-agent-holds-the-fleet/STORY-the-master-agent-holds-the-fleet.md)

## MoSCoW

### Must Have

- [x] [the-board-shows-stories] Stories tab with columns by status, story cards, tag cloud, archived toggle, empty-state redirect — **UI wave in progress** <!-- status: delivered -->

### Should Have

- [x] [the-domain-moves-out-of-the-board] Extract domain entities to `@plot-pm/domain` package — foundation for testable rules <!-- status: delivered -->
- [x] [the-domain-speaks-slices] Domain objects express slice boundaries for fleet orchestration <!-- status: delivered -->

### Could Have

- [ ] [production-calls-the-domain-one-rule-at-a-time] Production code migrates to domain layer incrementally <!-- status: draft -->
- [ ] [the-domain-runs-the-workflows-in-a-sandbox] Sandbox testing for domain workflows <!-- status: draft -->

## Notes

### Why this sprint focuses on Stories tab

The story `the-master-agent-holds-the-fleet` has five plans and spans domain
extraction, fleet orchestration, and board UI. **The board-shows-stories plan
is the one closest to landing** — Schema and Backend waves are merged, UI wave
is in progress with 3 branches claimed.

Completing it delivers immediate value: the strategic view that's been missing.
The domain extraction plans are foundational but larger scope.

### What "the strategic layer" means

Stories are the **problem space** — they answer "what are we trying to solve?"
Plans are the **solution space** — they answer "how do we solve it?"
Agents are **execution** — they answer "who is doing the work right now?"

The board had artifacts and execution but not strategy. This sprint completes
the funnel.

### Scope Changes

<!-- logged here as the sprint's contents change -->
