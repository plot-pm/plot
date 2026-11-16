# Delivery tab: Fleet shows one row per agent

> The Fleet section shows one row per agent with its role, what it acts on, what it does now, its output tokens and its time left, and carries the fleet switches on its header line.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:**
- **Story:** delivery-tab-reads-at-a-glance
- **Review:** pr
- **Impl:** own branches

## Changelog

- The **Fleet** header counts working, blocked and free agents and the output tokens spent today, and holds the fleet switches (dispatch, review, verify, design) and the parallel-agents stepper on the same line.
- Each agent row shows its role as a coloured chip, what it acts on, what it does now (or, when blocked, what it waits on), its output tokens and its time left before its bound.
- Free agents collapse into one line ("Free · 3 agents ready: … · show").
- Internals such as "no manifest names this desk" leave the rows.

Board impact: changes the Fleet section and `AgentList.tsx` in `packages/board`; no change to the plan format, the template, the helper scripts or the `docs/plans` layout. Rebuild the board artifact (`pnpm build:board`) with each slice that changes the board.

## Motivation

Plan 4 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: agent rows show internals such as "no manifest names this desk", and the switches sit in the section body.

The design is canonical. This plan implements its *Fleet* section, the fifth point of *Changes to the 2026-11-08 Design* (the switches move to the header), and the *Calls Made After Review* point listed below. It does not restate them.

## Design

### Approach

Depends on plan 1, `delivery-tab-header-and-my-sprint`, for the section-header pattern; every slice waits on its `feature/delivery-section-header` slice.

- **Header.** "<n> working · <n> blocked · <n> free · <tokens> output tokens today", and on the same line, right-aligned, the fleet switches (dispatch · review · verify · design) and the parallel-agents stepper. The switches live here and nowhere else; the tab-header Fleet card (plan 1) shows them read-only.
- **Groups:** Working · Blocked · Free. Free agents collapse into one line with a "show" link, one of the design's three collapsibles.
- **Columns:** Agent · Role · Acting on · Doing now (Blocked: **Waits on**) · Tokens · Time left.
  - **Role** is a coloured chip: loop, reviewer, fixer, approver, idea, brief, design, verify. A special agent is an ordinary row with its role; no separate list of special agents exists.
  - **Acting on** links to the work item's row (plan § slice, or PR), with its branch beneath.
  - **Doing now** names the activity ("writing code · 4 commits", "reviewing head 2d929a6", "fixing CI ✗ validate · attempt 1 of 2"), with the last commit message for a loop agent.
  - **Waits on** names the gate and links to it: `CI ⟳` with its run, review, your answer, a rate limit.
  - **Time left** is the time before the agent's bound (`Worker bound` for a loop agent, the fixer's bound for a fixer), with a bar that drains and turns red below 20 % left (the design's writer's call).
- **Tokens are output tokens** (*Calls Made After Review*, "Tokens are output tokens"). `packages/domain/src/rules/slice-tokens.ts` refuses a single summed figure, so the Tokens column and the header's "tokens today" show output tokens, labelled as such, with the other counters in the cell's tooltip.
- **Readings.** Tokens, bounds and activity come from readings the board and fleetd already take (*Non-goals*: no new reads from a host or tracker). Where no reading exists for "today", this plan names the gap and shows the per-agent figure only.
- **Fleet stays unscoped**: the **My sprint** toggle does not change it (*The "My sprint" Toggle*).
- **Domain first.** Every group, role, Doing now value, Waits on target, token figure and time-left fraction is a domain property with a unit test, built on the agent row form in `packages/domain/src/rules/delivery-row-form.ts`.

### Done When

- Every agent shows once, in exactly one of Working, Blocked or Free.
- A reviewer, a fixer and a loop agent each show their role chip and a Doing now value, asserted in unit tests.
- The time-left bar turns red below 20 % left, asserted in a unit test over the fraction.
- The switches show on the Fleet header line and write their config keys through their controllers; the section body holds no switch.
- The Tokens column shows output tokens labelled as such; where no "today" reading exists, the plan's notes name the gap.

### Settled Questions

- Every slice waits on plan 1's `feature/delivery-section-header`. Writer's call, from the design: plan 1 lays the section-header pattern every later plan uses.

### Open Questions

- [ ] Does a reading of output tokens per day exist today, or does the header show only the per-agent figure until one exists?
- [ ] Which bound does an agent with no `Worker bound` and no fixer bound (idea, brief, design, verify) show as Time left?

### Left to the Builder

- The names of the new domain facts and their types, within the domain's terminology (Agent, Worker).
- Chip colours within the board's palette.

## Slices

### Agent rows

- `feature/delivery-fleet-agent-rows` <!-- waits: feature/delivery-section-header --> — the Fleet groups and agent rows: role chip, Acting on, Doing now or Waits on, output tokens and the time-left bar; Free collapsed into one line <!-- builds: an agent row with role, activity, tokens and time left -->

### Header switches

- `feature/delivery-fleet-header-switches` <!-- waits: feature/delivery-section-header --> — the Fleet header with its counts and output tokens today, the fleet switches and the parallel-agents stepper on the header line, and the switches out of the body <!-- builds: the Fleet header line with switches -->

## Notes

- Created by `/plot-idea` in one batch with plans 1 to 3, 5 and 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "agent role chip" and "time left" found no artifact of that name in the estate. `slice-tokens.ts` already answers per-slice token counts and is read, not replaced.
