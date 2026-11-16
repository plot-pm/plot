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
- **Rounds:** 1

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

## Open Points

Round 1, panel of four lenses, all `amend` (`.plot/panels/delivery-fleet-rows-per-agent/panel.md`).

- [ ] [Estate, Contradiction, Deliverable, Cost] "Readings the board and fleetd already take" holds for none of role, live output tokens, bounds or commit activity. Every Fleet agent reads `loop` (`delivery-readings.ts:302`); reviewer, fixer, design and verify runs are not registry entries; a running agent has no output-token reading; `commits`, `headSha` and `subject` are not mapped to agent rows. Name the reading each column uses and what it costs per refresh, or narrow the column.
- [ ] [Estate, Contradiction, Deliverable] `AgentRole` holds six roles (`delivery-placement.ts:92`) and the plan names eight; design and verify runs render today in the "Tickets and plan runs" block (`AgentList.tsx:552`). Name who widens `AgentRole` and whether the plan merges those rows into Fleet.
- [ ] [Estate, Contradiction, Deliverable, Cost] The role chip has two owners: this plan's agent-rows slice and plan 3's `feature/delivery-work-items-by-chips`, both in `delivery-row-form.ts`, with no `waits:` between them. Name one owner and order the other.
- [ ] [Estate, Contradiction, Deliverable, Cost] Open Question 1 is answered: no live per-day output-token reading exists. `.plot/state/slice-spend.jsonl` (`at`, `outputTokens`) gives a finished-runs-today figure that misses running agents and runs killed at the bound, and a run line is cumulative per session. Show that figure labelled as such, or show none.
- [ ] [Estate, Contradiction, Deliverable, Cost] Open Question 2 is answered: design and verify use `Worker bound` (28800 s), the reviewer 3600 s (`auto-review.ts:64`), the fixer 3600 s (`fixer-attempts.ts:8`); idea and brief run with no bound (`brief-ask.ts:105-107`). State that those rows show no bar, and add the reviewer's bound. Verify and design status carry no start time (`schema.ts:4340`, `:4365`).
- [ ] [Cost] `Worker bound` is read only when an ended free wait exists, because the read is an uncached subprocess of 0.12 to 0.94 s and `/api/fleet` polls every 4 s per viewer (`fleet.ts:8612-8619`). A bar on every working loop agent makes it unconditional. Cache it or say what the board pays.
- [ ] [Deliverable] The header's "output tokens today" aggregates slice 1's per-agent token fact, and slice 2 waits only on plan 1. Add `waits: feature/delivery-fleet-agent-rows` to slice 2, or move the header figure into slice 1.
- [ ] [Contradiction] Done When says the switches "write their config keys through their controllers". The switches write `.plot/state/` through `/api/fleet-controls` and never `CLAUDE.md` (`fleet-settings-store.ts`). The slice moves the existing strip (`AgentList.tsx:1403-1418`, `FleetControls.tsx`) and builds no switch. Keep the `#fleet-controls` anchor that the group-held links scroll to.
- [ ] [Contradiction] Plan 1's section header holds counts and no controls slot, and plan 1 calls the Fleet header "plan 5". Say which plan adds the slot, and whether the Fleet card and this header share `FleetControls.tsx`.
- [ ] [Contradiction, Deliverable] Done When item 1, "every agent shows once in one of Working, Blocked or Free", conflicts with `agentGroup`, which gives an agent with an unread process no group and sends it to `unplaced` (`delivery-placement.ts:262-267`). Say "every placed agent", or change the rule against the design's Non-goals.
- [ ] [Contradiction] The design keeps groups open and allows collapsibles in three places; `AgentList.tsx:1430` folds each group. Say whether Working and Blocked lose their fold.
- [ ] [Deliverable, Estate] "No manifest names this desk" comes from `desk-manifest.ts:261` and `desk-lifecycle.ts:211`, and `an-unnamed-desk-says-so.browser.test.ts` asserts it. The Changelog bullet has no slice and no Done When item. Add both, or cut the bullet.
- [ ] [Estate, Deliverable] `ROW_COLUMNS` in `delivery-row-form.ts` is one tuple shared by item rows and agent rows; the plan's columns do not fit it, and `AgentRowFacts` has no token, bound or activity field. Say whether agent rows get their own tuple and which item-row tests change. Reuse plan 1's header counts and do not compute a second summary.
- [ ] [Deliverable, Contradiction] The Waits on targets `CI ⟳` with its run and a rate limit have no reading: the board sets `blockedOn` only to `person`. Build the readings or narrow the slice text.
- [ ] [Contradiction, Cost, Deliverable] The Board impact line says to rebuild the board artifact with each slice, and `check-no-bundle-diff.sh` refuses a committed bundle. Say the rebuild is a local test only.
- [ ] [Not verified by any juror] Whether `commits`, `headSha` and `subject` reach agent rows, the bound for idea runs and approvers, which browser tests select the current Fleet columns.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "engine": "panel",
  "questionHistory": [],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": false},
    "tradeOffs": false
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
