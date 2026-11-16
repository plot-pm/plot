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

- The **Fleet** header counts working, blocked and free agents and the output tokens of today's finished runs, and holds the fleet switches (dispatch, review, verify, design) and the parallel-agents stepper on the same line.
- Each agent row shows its role as a coloured chip, what it acts on, what it does now (or, when blocked, what it waits on), its output tokens and its time left before its bound.
- Design and verify runs show as Fleet rows with their role, not in a separate block.
- Free agents collapse into one line ("Free · 3 agents ready: … · show"); Working and Blocked stay open.
- Internals such as "no manifest names this desk" leave the rows.

Board impact: changes the Fleet section and `AgentList.tsx` in `packages/board`, and the agent readings and row form in `packages/domain`; no change to the plan format, the template, the helper scripts or the `docs/plans` layout. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one, and `main` builds the bundle after the merge.

## Motivation

Plan 4 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: agent rows show internals such as "no manifest names this desk", and the switches sit in the section body.

The design is canonical. This plan implements its *Fleet* section, the fifth point of *Changes to the 2026-11-08 Design* (the switches move to the header), and the *Calls Made After Review* point listed below. It does not restate them.

## Design

### Approach

Depends on plan 1, `delivery-tab-header-and-my-sprint`, for the section-header pattern and its controls slot; every slice waits on its `feature/delivery-section-header` slice, directly or through this plan's first slice. Plan 3's By column waits on this plan's role slice.

- **Header.** "<n> working · <n> blocked · <n> free · <tokens> output tokens today", and on the same line, right-aligned in plan 1's controls slot, the fleet switches (dispatch · review · verify · design) and the parallel-agents stepper. The switches live here and nowhere else; the tab-header Fleet card (plan 1) renders the same `FleetControls.tsx` components read-only. The header counts are plan 1's section summary filled with the Fleet groups; this plan computes no second summary.
- **Groups:** Working · Blocked · Free. Free agents collapse into one line with a "show" link, one of the design's three collapsibles. Working and Blocked lose today's fold (`AgentList.tsx:1430`), because the design keeps groups open.
- **Columns:** Agent · Role · Acting on · Doing now (Blocked: **Waits on**) · Tokens · Time left. Agent rows get a column set of their own; `ROW_COLUMNS` (`delivery-row-form.ts`) stays the item rows' set, and `AgentRowFacts` gains the role, activity, token and bound fields.
- **Roles.** `AgentRole` (`delivery-placement.ts:92`) holds six roles today: loop, fixer, reviewer, approver, idea, brief. The role slice widens it to eight with design and verify, and gives each role a reading the board or fleetd already takes on this machine: a loop agent from its registry entry; a fixer from the `inFlight` mark in `.plot/state/fixer-attempts/<pr>.json`; design and verify runs from their status on the payload (`schema.ts:4340`, `:4365`), which render today in the "Tickets and plan runs" block (`AgentList.tsx:552`) and move into Fleet; a reviewer, an approver, an idea run and a brief run from the local state their runners write. Every agent reads `loop` today (`delivery-readings.ts:302`). Where the slice finds no local reading for a role, that role shows no row, and the plan's notes name the gap; no role gains a host read. A special agent is an ordinary row with its role; no separate list of special agents exists. The role chip is a domain fact and one component, which plan 3's By column reuses.
- **Acting on** links to the work item's row (plan § slice, or PR), with its branch beneath.
- **Doing now** names the activity ("writing code · 4 commits", "reviewing head 2d929a6", "fixing CI ✗ · attempt 1 of 2"), with the last commit subject for a loop agent, cut at its end where the column is narrow. The commit count and subject come from the pulse's local git reading of the branch; the fixer's attempt comes from the fixer-attempts record against `FIXER_ATTEMPTS_BUDGET`.
- **Waits on** names the gate and links to it. The board sets `blockedOn` only to `person` today (`delivery-readings.ts:303`). The agent-rows slice adds `ci` where the agent's item is a PR whose `ciChecks` reads `pending`, linked to the PR's checks, and `rate-limit` where the connector's limit reading (`entities/limit.ts`) reports an exhausted window. A gate with no reading shows no Waits on value.
- **Time left** is the time before the agent's bound, with a bar that drains and turns red below 20 % left (the design's writer's call):

  | Role | Bound |
  |---|---|
  | loop, design, verify | `Worker bound` (28800 s in this repo) |
  | reviewer | 3600 s, `plot-review`'s own bound (`auto-review.ts:63`) |
  | fixer | 3600 s, `FIXER_BOUND_SECONDS` (`rules/fixer-attempts.ts:8`) |
  | idea, brief | no bound (`brief-ask.ts:105-107`): the cell shows "—" and no bar |
  | approver | not read by any juror; the role slice names its bound, and the cell shows "—" where none exists |

  The bar needs the run's start time. Design and verify status carry none today (`schema.ts:4340`, `:4365`), so their cell shows "—" until a start time is on their status, and the plan's notes name that gap.
- **The `Worker bound` read.** Today the board reads `Worker bound` only when an ended free wait exists, because the read is an uncached subprocess of 0.12 to 0.94 s and `/api/fleet` polls every 4 s per viewer (`fleet.ts:8612-8619`). The agent-rows slice reads it once per board process and again only when the config file changes, never once per agent or per poll.
- **Tokens are output tokens** (*Calls Made After Review*, "Tokens are output tokens"). `packages/domain/src/rules/slice-tokens.ts` refuses a single summed figure, so the Tokens column and the header show output tokens, labelled as such, with the other counters in the cell's tooltip. The readings that exist are the seal and run lines in `.plot/state/slice-spend.jsonl` (`entities/slice-spend.ts`), which the board already reads for plan cost (`board.ts:459`): written when a run ends or a slice seals, never on the bound path, and cumulative per session, so a daily figure takes each line's difference against the session's previous line. A running agent has no output-token reading: its registry entry carries `contextTokens` and `contextSpend`, which count the context ceiling and exclude output (`slice-tokens.ts:22-27`). So the Tokens cell shows the agent's last finished run, and "—" for a run in progress; the header shows "output tokens today, finished runs". This is the gap the design asks the plan to name; see the open question below.
- **"No manifest names this desk"** comes from `desk-manifest.ts:261` and `desk-lifecycle.ts:211` and shows as row text today; `an-unnamed-desk-says-so.browser.test.ts` asserts it. The agent-rows slice moves the text into the Agent cell's tooltip and changes that test.
- **Every placed agent shows once.** `agentGroup` (`delivery-placement.ts:262-267`) gives an agent with an unread process no group and sends it to `unplaced`; that rule stays, and plan 6's footer counts those agents.
- **Fleet stays unscoped**: the **My sprint** toggle does not change it (*The "My sprint" Toggle*).
- **Domain first.** Every group, role, Doing now value, Waits on target, token figure and time-left fraction is a domain property with a unit test, built on the agent row form in `packages/domain/src/rules/delivery-row-form.ts`.

### Done When

- Every placed agent shows once, in exactly one of Working, Blocked or Free; Working and Blocked stay open, and Free collapses into one line.
- Each of the eight roles maps to its reading and shows its chip, and a design or verify run shows as a Fleet row, asserted in unit tests.
- A reviewer, a fixer and a loop agent each show a Doing now value, asserted in unit tests.
- A blocked agent's Waits on names `person`, `ci` or `rate-limit` from its reading and links to it.
- Time left uses the bound the table names per role, shows "—" for a role with no bound or no start time, and the bar turns red below 20 % left, asserted in a unit test over the fraction.
- The board reads `Worker bound` at most once per config change.
- The Tokens column shows output tokens labelled as such, with the other counters in the tooltip, and "—" for a run in progress; the header shows today's finished-run output tokens.
- The switches and the stepper show in the Fleet header's controls slot and write `.plot/state/` through `/api/fleet-controls`, as they do today (`fleet-settings-store.ts`); the section body holds no switch, and the `#fleet-controls` anchor still exists.
- No agent row shows "no manifest names this desk" as row text.

### Settled Questions

- Every slice waits on plan 1's `feature/delivery-section-header`. Writer's call, from the design: plan 1 lays the section-header pattern every later plan uses.
- This plan owns the role chip and the role readings in `feature/delivery-agent-roles`; plan 3's By column waits on it. Writer's call, from the round-1 panel.
- The header's token figure aggregates the agent-rows slice's per-agent token fact, so the header slice waits on it. Writer's call, from the round-1 panel.

### Open Questions

- [x] Does a reading of output tokens per day exist today? Resolved: no live reading exists. The seal and run lines in `.plot/state/slice-spend.jsonl` give a finished-runs-today figure, which misses running agents and runs ended at the bound; the header shows it labelled "finished runs".
- [x] Which bound does an agent with no `Worker bound` and no fixer bound show as Time left? Resolved: design and verify use `Worker bound`, the reviewer 3600 s, the fixer 3600 s; idea and brief have no bound and show "—"; the role slice names the approver's bound.

### Left to the Builder

- The names of the new domain facts and their types, within the domain's terminology (Agent, Worker).
- Chip colours within the board's palette.
- Which browser tests select the current Fleet columns, and which move to unit tests.

## Slices

### Agent roles

- `feature/delivery-agent-roles` <!-- waits: feature/delivery-section-header --> — `AgentRole` widened to eight roles, a local reading per role, design and verify runs moved into Fleet rows, and the role chip as a domain fact and one component <!-- builds: agent roles with their readings and the role chip -->

### Agent rows

- `feature/delivery-fleet-agent-rows` <!-- waits: feature/delivery-agent-roles --> — the Fleet groups and agent rows with their own column set: Acting on, Doing now or Waits on, output tokens from the spend record, the time-left bar per role bound with the cached `Worker bound` read, Free collapsed into one line, and the desk-manifest text moved to a tooltip <!-- builds: an agent row with activity, tokens and time left -->

### Header switches

- `feature/delivery-fleet-header-switches` <!-- waits: feature/delivery-fleet-agent-rows --> — the existing switch strip (`AgentList.tsx:1403-1418`, `FleetControls.tsx`) moved into the Fleet header's controls slot with the `#fleet-controls` anchor kept, and the header's output tokens today <!-- builds: the Fleet header line with switches and tokens today -->

## Notes

- Created by `/plot-idea` in one batch with plans 1 to 3, 5 and 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "agent role chip" and "time left" found no artifact of that name in the estate. `slice-tokens.ts` already answers per-slice token counts and is read, not replaced. The switch strip and its writes through `/api/fleet-controls` exist; the header slice moves them and builds no switch.
- Named gaps, per the design's *Non-goals*: no output-token reading for a running agent; no start time on design and verify status; any role the role slice finds no local reading for.
- Amended after the round-1 panel, 2026-11-16: the role slice is new and comes first, the header slice waits on the agent rows, and each column names its reading.

## Open Points

Round 1, panel of four lenses, all `amend` (`.plot/panels/delivery-fleet-rows-per-agent/panel.md`).

- [x] [Estate, Contradiction, Deliverable, Cost] "Readings the board and fleetd already take" holds for none of role, live output tokens, bounds or commit activity. Resolved: the Approach names the reading each column uses and its cost, and names the gaps.
- [x] [Estate, Contradiction, Deliverable] `AgentRole` holds six roles and the plan names eight. Resolved: `feature/delivery-agent-roles` widens it and moves design and verify runs into Fleet.
- [x] [Estate, Contradiction, Deliverable, Cost] The role chip has two owners. Resolved: this plan's role slice owns it; plan 3's By slice waits on it.
- [ ] [Estate, Contradiction, Deliverable, Cost] Open Question 1 is answered: no live per-day output-token reading exists. Resolved for the header: it shows the finished-runs figure labelled as such. Question for Jan Wloka: the design's Tokens column is "what the agent spent on its current run", and a running agent has no output-token reading. The plan shows the last finished run and "—" while a run is in progress. A live figure needs a transcript fold per running agent (up to 7.7 MiB per file, 90 to 250 ms, `slice-spend.ts:57-60`), which is local and not a host read. Accept "—", or add an incremental local transcript read.
- [x] [Estate, Contradiction, Deliverable, Cost] Open Question 2 is answered. Resolved: the bound table in the Approach names each role, with the reviewer's 3600 s; idea and brief show "—", and the role slice names the approver's; design and verify show "—" until their status carries a start time.
- [x] [Cost] `Worker bound` is read only when an ended free wait exists. Resolved: the agent-rows slice reads it once per board process and per config change.
- [x] [Deliverable] The header's "output tokens today" aggregates slice 1's per-agent token fact. Resolved: the header slice waits on `feature/delivery-fleet-agent-rows`.
- [x] [Contradiction] Done When says the switches "write their config keys through their controllers". Resolved: Done When says they write `.plot/state/` through `/api/fleet-controls`; the slice moves the existing strip and keeps `#fleet-controls`.
- [x] [Contradiction] Plan 1's section header holds no controls slot, and plan 1 calls the Fleet header "plan 5". Resolved: plan 1's header slice now has the controls slot, and plan 1 names this plan as the Fleet header's owner; the Fleet card and this header share `FleetControls.tsx`.
- [x] [Contradiction, Deliverable] Done When item 1 conflicts with `agentGroup`. Resolved: it reads "every placed agent", and the placement rule stays.
- [x] [Contradiction] The design keeps groups open; `AgentList.tsx:1430` folds each group. Resolved: Working and Blocked lose their fold; Free stays collapsed.
- [x] [Deliverable, Estate] "No manifest names this desk" has no slice and no Done When item. Resolved: the agent-rows slice moves it to the Agent cell's tooltip and changes `an-unnamed-desk-says-so.browser.test.ts`; Done When has a line.
- [x] [Estate, Deliverable] `ROW_COLUMNS` is one tuple shared by item rows and agent rows. Resolved: agent rows get their own column set; the header reuses plan 1's summary.
- [x] [Deliverable, Contradiction] The Waits on targets `CI ⟳` and a rate limit have no reading. Resolved: `ci` comes from the PR's `ciChecks` and `rate-limit` from the connector's limit reading; a gate with no reading shows no value.
- [x] [Contradiction, Cost, Deliverable] The Board impact line says to rebuild the board artifact with each slice. Resolved: the rebuild is a local test only.
- [x] [Not verified by any juror] Whether `commits`, `headSha` and `subject` reach agent rows, the bounds of idea runs and approvers, and which browser tests select the columns. Resolved: commit count and subject come from the pulse's local git reading, added by the agent-rows slice; idea and brief have no bound, and the role slice reads the approver's; the browser tests are the builder's.

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
