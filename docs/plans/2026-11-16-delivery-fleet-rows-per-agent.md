# Delivery tab: Fleet shows one row per agent

> The Fleet section shows one row per agent with its role, what it acts on, what it does now, its output tokens and its time left, and carries the fleet switches on its header line.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:**
- **Issue:**
- **Story:** delivery-tab-reads-at-a-glance
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Started:** 2026-11-17, Jan Wloka, `feature/delivery-agent-roles`
- **Started:** 2026-11-17, Jan Wloka, `feature/delivery-fleet-plan-runs`
- **Started:** 2026-11-17, Jan Wloka, `feature/delivery-fleet-agent-rows`

## Changelog

- The **Fleet** header counts working, blocked and free agents and the output tokens of today's finished runs, and holds the fleet switches (dispatch, review, verify, design) and the parallel-agents stepper on the same line.
- Each agent row shows its role as a coloured chip, what it acts on, what it does now (or, when blocked, what it waits on), the output tokens of its last finished run, and its time left before its bound. A running agent's Tokens cell, and the time left of a design or verify run, show "—" where no reading exists.
- Design and verify runs show as Fleet rows with their role, not in a separate block.
- Free agents collapse into one line ("Free · 3 agents ready: … · show"); Working and Blocked stay open.
- Internals such as "no manifest names this desk" leave the rows and show in the Agent cell's tooltip.

Board impact: changes the Fleet section and `AgentList.tsx` in `packages/board`, and the agent readings and row form in `packages/domain`; no change to the plan format, the template, the helper scripts or the `docs/plans` layout. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one, and `main` builds the bundle after the merge.

## Motivation

Plan 4 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: agent rows show internals such as "no manifest names this desk", and the switches sit in the section body.

The design is canonical. This plan implements its *Fleet* section, the fifth point of *Changes to the 2026-11-08 Design* (the switches move to the header), and the *Calls Made After Review* point listed below. It does not restate them.

## Design

### Approach

Depends on plan 1, `delivery-tab-header-and-my-sprint`, for the section-header pattern and its controls slot; every slice waits on its `feature/delivery-section-header` slice, directly or through this plan's first slice. Plan 3's By column waits on this plan's role slice. The plan-runs slice waits on plan 6's `feature/delivery-tickets-section`, because both edit the "Tickets and plan runs" block (`AgentList.tsx:1499-1506`).

- **Header.** "<n> working · <n> blocked · <n> free · <tokens> output tokens today", and on the same line, right-aligned in plan 1's controls slot, the fleet switches (dispatch · review · verify · design) and the parallel-agents stepper. The switches live here and nowhere else; the tab-header Fleet card (plan 1) renders the same `FleetControls.tsx` components read-only. Plan 1's `feature/delivery-section-header` fills the three counts from today's `agentGroup` groups (`delivery-placement.ts:262-267`); this plan's header slice adds the token figure and the switches, and asserts the counts once design and verify runs are agents.
- **Groups:** Working · Blocked · Free. Free agents collapse into one line with a "show" link, one of the design's three collapsibles. Working and Blocked lose today's fold (`AgentList.tsx:1430`), because the design keeps groups open.
- **Columns:** Agent · Role · Acting on · Doing now (Blocked: **Waits on**) · Tokens · Time left. `agentRowCells` (`packages/domain/src/rules/delivery-row-form.ts:312`) already builds a seven-cell agent row with the role as its `kind` cell, over `AgentRowFacts` (`:81`). The agent-rows slice changes that function and its facts into the design's column set; it builds no second agent row form. `ROW_COLUMNS` (`delivery-row-form.ts:13`) stays the item rows' set.
- **Roles.** `AgentRole` (`delivery-placement.ts:92`) holds six roles today: loop, fixer, reviewer, approver, idea, brief. The role slice widens it to eight with design and verify. Every agent reads `loop` today unless its registry entry names a role (`agent.role ?? 'loop'`, `agent-rows/delivery-readings.ts:302`). Each role takes a reading the board or fleetd already takes on this machine:

  | Role | Reading | Start time |
  |---|---|---|
  | loop | its registry entry | `AgentEntry.startedAt` (`schema.ts:4000`) |
  | idea | the registry entry its board run writes with `role: 'idea'` (`packages/board/src/server/idea.ts:825`, `story-plan.ts:286`) | `startedAt` |
  | brief | the registry entry with `role: 'brief'` (`packages/fleet/src/shared/brief-ask.ts:156`) | `startedAt` |
  | reviewer | `.plot/state/review-in-flight.json` (`packages/domain/src/rules/review-run.ts:1-13`), one live entry per PR and head | the entry's `startedAt` |
  | fixer | the `inFlight` mark in `.plot/state/fixer-attempts/<pr>.json` | `inFlight.startedAt` (`packages/domain/src/entities/fixer-attempts.ts:41`) |
  | design | `.plot/state/auto-design-in-flight.json`, on the payload as `fleet.design` (`schema.ts:4363-4365`) | none on the payload |
  | verify | `.plot/state/auto-verify-in-flight.json`, on the payload as verification status (`schema.ts:4338-4340`) | none on the payload |
  | approver | no runner and no state file found on `main` (`f0dfed71a`) | — |

  A role with no reading shows no row, and Notes names it: today that is the approver. No role gains a host read. A special agent is an ordinary row with its role; no separate list of special agents exists. The role chip is a domain fact and one component, which plan 3's By column reuses.
- **Design and verify move into Fleet.** They render today in the "Tickets and plan runs" block (`AgentList.tsx:537-552, 1499-1506`). The plan-runs slice makes each a Fleet agent with its role and removes the block's run rows, which leaves plan 6's Tickets section holding tickets only.
- **Acting on** links to the work item's row (plan § slice, or PR), with its branch beneath.
- **Doing now** names the activity ("writing code · 4 commits", "reviewing head 2d929a6", "fixing CI ✗ · attempt 1 of 2"), with the last commit subject for a loop agent, cut at its end where the column is narrow. The commit count and subject come from the pulse's local git reading of the branch; the fixer's attempt comes from the fixer-attempts record against `FIXER_ATTEMPTS_BUDGET`.
- **Waits on** names the gate and links to it. `DeliveryGate` (`delivery-placement.ts:27`) already holds `ci`, `review`, `machine`, `rate-limit` and `person`, and the board sets `blockedOn` only to `person` today (`delivery-readings.ts:304`). The agent-rows slice adds `ci` where the agent's item is a PR whose CI reads running, through `ciOf` (`delivery-readings.ts:99-110`), linked to the PR's `checksUrl`; `review` where that PR's CI passed and its review reads `pending`, linked to the PR's `url`; and `rate-limit` where the connector's limit reading (`entities/limit.ts`) reports an exhausted window. A gate with no reading shows no Waits on value.
- **Time left** is the time before the agent's bound, with a bar that drains and turns red below 20 % left (the design's writer's call). The domain rule takes the bound and the start time as readings: `time left = bound − (now − start)`, with `null` for either input giving "—" and no bar. The server passes each bound in; the domain imports none, because `REVIEW_BOUND_MS` lives in `packages/fleet/src/shared/auto-review.ts:64` and the domain may import only `zod`.

  | Role | Bound passed in |
  |---|---|
  | loop, design, verify | `Worker bound` (28800 s in this repo) |
  | reviewer | `REVIEW_BOUND_MS`, 3600 s (`packages/fleet/src/shared/auto-review.ts:64`) |
  | fixer | `FIXER_BOUND_SECONDS`, 3600 s (`packages/domain/src/rules/fixer-attempts.ts:8`) |
  | idea, brief | `null`: these runs have no bound (`packages/fleet/src/shared/brief-ask.ts:103-107`) |

  Design and verify status carry no start time on the payload, so their cell shows "—" until one is there; Notes names the gap.
- **The `Worker bound` read.** Today the board reads `Worker bound` only when an ended free wait exists, because the read is an uncached subprocess of 0.12 to 0.94 s and `/api/fleet` polls every 4 s per viewer (`fleet.ts:8612-8619`). The time-and-tokens slice reads it once per board process and again only when one `stat` of the file that declares it shows a new modification time; the stat runs once per `/api/fleet` build, never once per agent.
- **Tokens are output tokens** (*Calls Made After Review*, "Tokens are output tokens"). `packages/domain/src/rules/slice-tokens.ts` refuses a single summed figure, so the Tokens column and the header show output tokens, labelled as such, with the other counters in the cell's tooltip. The reading is the seal and run lines in `.plot/state/slice-spend.jsonl` (`packages/domain/src/entities/slice-spend.ts`), which the board already reads for plan cost (`packages/board/src/server/board.ts:460`): written when a run ends or a slice seals, and cumulative per session, so a daily figure takes each line's difference against the session's previous line. The Tokens cell shows the agent's last finished run, and "—" for a run in progress (Jan Wloka, 2026-11-16): no transcript is read. The header shows "output tokens today, finished runs".
- **The spend read's cost.** `lines()` parses the whole record on every call (`board.ts:2885-2907`). The time-and-tokens slice parses it at most once per `/api/fleet` build, and only when one `stat` of the record shows a new size or modification time; otherwise it serves the last parse. Every other new reading in this plan is already on the payload or in a state file the server reads once per scan.
- **"No manifest names this desk"** comes from `desk-manifest.ts:261` and `desk-lifecycle.ts:211` and shows as row text today; `an-unnamed-desk-says-so.browser.test.ts` asserts it. The agent-rows slice moves the text into the Agent cell's tooltip and changes that test.
- **Every placed agent shows once.** `agentGroup` gives an agent with an unread process no group and sends it to `unplaced`; that rule stays, and plan 6's footer counts those agents.
- **Fleet stays unscoped**: the **My sprint** toggle does not change it (*The "My sprint" Toggle*).
- **Domain first.** Every group, role, Doing now value, Waits on target, token figure and time-left fraction is a domain property with a unit test, built on `agentRowCells`.

### Done When

Per slice, in slice order.

- *Agent roles:* each role with a local reading (loop, fixer, reviewer, idea, brief, design, verify) maps to it and shows its chip, and the approver, with no reading, shows no row and is named in Notes, asserted in unit tests.
- *Plan runs:* a design or verify run shows as a Fleet row with its role, and the "Tickets and plan runs" block holds no run row.
- *Agent rows:* every placed agent shows once, in exactly one of Working, Blocked or Free; Working and Blocked stay open, and Free collapses into one line; a reviewer, a fixer and a loop agent each show a Doing now value; a blocked agent's Waits on names `person`, `ci`, `review` or `rate-limit` from its reading and links to it; `agentRowCells` builds the design's columns; no agent row shows "no manifest names this desk" as row text; each asserted in unit tests.
- *Time and tokens:* Time left uses the bound the table names per role, shows "—" for a role with no bound or no start time, and the bar turns red below 20 % left, asserted in a unit test over the fraction; the Tokens column shows the last finished run's output tokens labelled as such, with the other counters in the tooltip, and "—" for a run in progress; the board reads `Worker bound` at most once per change of its file, parses `slice-spend.jsonl` at most once per `/api/fleet` build and only when its stat changes, and reads no transcript on the poll.
- *Header switches:* the header shows the working, blocked and free counts and today's finished-run output tokens; the switches and the stepper show in the Fleet header's controls slot and write `.plot/state/` through `/api/fleet-controls`, as they do today (`fleet-settings-store.ts`); the section body holds no switch, and the `#fleet-controls` anchor still exists.

### Settled Questions

- Every slice waits on plan 1's `feature/delivery-section-header`. Writer's call, from the design: plan 1 lays the section-header pattern every later plan uses.
- This plan owns the role chip and the role readings in `feature/delivery-agent-roles`; plan 3's By column waits on it. Writer's call, from the round-1 panel.
- The header's token figure aggregates the per-agent token fact, so the header slice comes after the time-and-tokens slice. Writer's call, from the round-1 panel.

### Open Questions

- [x] Does a reading of output tokens per day exist today? Resolved: no live reading exists. The seal and run lines in `.plot/state/slice-spend.jsonl` give a finished-runs-today figure, which misses running agents and runs ended at the bound; the header shows it labelled "finished runs".
- [x] Which bound does an agent with no `Worker bound` and no fixer bound show as Time left? Resolved: design and verify use `Worker bound`, the reviewer 3600 s, the fixer 3600 s; idea and brief have no bound and show "—"; the approver has no reading and shows no row.

### Left to the Builder

- The names of the new domain facts and their types, within the domain's terminology (Agent, Worker).
- Chip colours within the board's palette.
- Which browser tests select the current Fleet columns, and which move to unit tests.

## Slices

### Agent roles

- `feature/delivery-agent-roles` <!-- waits: feature/delivery-section-header --> — `AgentRole` widened to eight roles, the reading per role in the table, and the role chip as a domain fact and one component <!-- builds: agent roles with their readings and the role chip --> → #3493

### Plan runs

- `feature/delivery-fleet-plan-runs` <!-- waits: feature/delivery-agent-roles, feature/delivery-tickets-section --> — design and verify runs as Fleet agents with their roles, and their rows out of the "Tickets and plan runs" block <!-- builds: design and verify runs as Fleet agents --> → #3499

### Agent rows

- `feature/delivery-fleet-agent-rows` <!-- waits: feature/delivery-fleet-plan-runs --> — the Fleet groups with Free collapsed and the other folds removed, `agentRowCells` changed to the design's columns, Acting on, Doing now, Waits on through `ciOf` and the limit reading, and the desk-manifest text moved to a tooltip <!-- builds: an agent row with role, activity and waits-on --> → #3509

### Time and tokens

- `feature/delivery-fleet-time-tokens` <!-- waits: feature/delivery-fleet-agent-rows --> — the time-left rule over a passed-in bound and start time, its bar, the cached `Worker bound` read, and the Tokens cell from the spend record parsed once per changed stat <!-- builds: agent time left and output tokens -->

### Header switches

- `feature/delivery-fleet-header-switches` <!-- waits: feature/delivery-fleet-time-tokens --> — the existing switch strip (`AgentList.tsx:1403-1418`, `FleetControls.tsx`) moved into the Fleet header's controls slot with the `#fleet-controls` anchor kept, the header counts asserted, and the header's output tokens today <!-- builds: the Fleet header line with switches and tokens today -->

## Notes

- Created by `/plot-idea` in one batch with plans 1 to 3, 5 and 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "agent role chip" and "time left" found no artifact of that name in the estate. `slice-tokens.ts` already answers per-slice token counts and is read, not replaced. `agentRowCells` already builds an agent row and is changed, not replaced. The switch strip and its writes through `/api/fleet-controls` exist; the header slice moves them and builds no switch.
- Named gaps, per the design's *Non-goals*: no output-token reading for a running agent (its cell shows "—", by Jan Wloka's decision of 2026-11-16); no start time on design and verify status; no reading for the approver role, which therefore shows no row.
- The 7.7 MiB transcript figure is at `packages/domain/src/workflows/slice-spend.ts:58` and `packages/board/src/server/entry/slice-spend.ts:23`; this plan reads no transcript, so it needs neither.
- Amended after the round-1 panel, 2026-11-16: the role slice is new and comes first, the header slice waits on the agent rows, and each column names its reading.
- Amended after the round-2 panel (`.plot/panels/delivery-fleet-rows-per-agent/r2-panel.md`) and Jan Wloka's decision on live tokens, 2026-11-16: the two large slices are split into roles, plan runs, agent rows, and time with tokens; each role names its reading file; the bounds reach the domain as readings; the agent rows change `agentRowCells`; the spend and config reads have a stat-based cost bound.

## Open Points

Round 1, panel of four lenses, all `amend` (`.plot/panels/delivery-fleet-rows-per-agent/panel.md`).

- [x] [Estate, Contradiction, Deliverable, Cost] "Readings the board and fleetd already take" holds for none of role, live output tokens, bounds or commit activity. Resolved: the Approach names the reading each column uses and its cost, and names the gaps.
- [x] [Estate, Contradiction, Deliverable] `AgentRole` holds six roles and the plan names eight. Resolved: `feature/delivery-agent-roles` widens it, and `feature/delivery-fleet-plan-runs` moves design and verify runs into Fleet.
- [x] [Estate, Contradiction, Deliverable, Cost] The role chip has two owners. Resolved: this plan's role slice owns it; plan 3's By slice waits on it.
- [x] [Estate, Contradiction, Deliverable, Cost] A running agent has no output-token reading. Resolved (Jan Wloka, 2026-11-16): a running agent shows "—" until its run finishes; no transcript is read. The header shows the finished-runs figure labelled as such.
- [x] [Estate, Contradiction, Deliverable, Cost] Open Question 2 is answered. Resolved: the bound table names each role; idea and brief show "—"; design and verify show "—" until their status carries a start time.
- [x] [Cost] `Worker bound` is read only when an ended free wait exists. Resolved: the time-and-tokens slice reads it once per board process and again per change of its file.
- [x] [Deliverable] The header's "output tokens today" aggregates the per-agent token fact. Resolved: the header slice comes after `feature/delivery-fleet-time-tokens`.
- [x] [Contradiction] Done When says the switches "write their config keys through their controllers". Resolved: Done When says they write `.plot/state/` through `/api/fleet-controls`; the slice moves the existing strip and keeps `#fleet-controls`.
- [x] [Contradiction] Plan 1's section header holds no controls slot, and plan 1 calls the Fleet header "plan 5". Resolved: plan 1's header slice has the controls slot, and plan 1 names this plan as the Fleet header's owner; the Fleet card and this header share `FleetControls.tsx`.
- [x] [Contradiction, Deliverable] Done When item 1 conflicts with `agentGroup`. Resolved: it reads "every placed agent", and the placement rule stays.
- [x] [Contradiction] The design keeps groups open; `AgentList.tsx:1430` folds each group. Resolved: Working and Blocked lose their fold; Free stays collapsed.
- [x] [Deliverable, Estate] "No manifest names this desk" has no slice and no Done When item. Resolved: the agent-rows slice moves it to the Agent cell's tooltip and changes `an-unnamed-desk-says-so.browser.test.ts`; Done When has a line.
- [x] [Estate, Deliverable] `ROW_COLUMNS` is one tuple shared by item rows and agent rows. Resolved: agent rows take the column set `agentRowCells` builds; the header reuses plan 1's summary.
- [x] [Deliverable, Contradiction] The Waits on targets `CI ⟳` and a rate limit have no reading. Resolved: `ci` comes from `ciOf`, `review` from the PR's review reading, and `rate-limit` from the connector's limit reading; a gate with no reading shows no value.
- [x] [Contradiction, Cost, Deliverable] The Board impact line says to rebuild the board artifact with each slice. Resolved: the rebuild is a local test only.
- [x] [Not verified by any juror] Whether `commits`, `headSha` and `subject` reach agent rows, the bounds of idea runs and approvers, and which browser tests select the columns. Resolved: commit count and subject come from the pulse's local git reading, added by the agent-rows slice; idea and brief have no bound, and the approver has no reading; the browser tests are the builder's.

Round 2, panel of four lenses, all `amend` (`.plot/panels/delivery-fleet-rows-per-agent/r2-panel.md`).

- [x] [Contradiction, Deliverable] Done When item 2 says each of the eight roles shows its chip, while a role with no reading shows no row. Resolved: each role with a local reading shows its chip, and the approver, which has none, is named in Notes.
- [x] [Deliverable] Slices 1 and 2 are each larger than one PR. Resolved: they are split into `feature/delivery-agent-roles`, `feature/delivery-fleet-plan-runs`, `feature/delivery-fleet-agent-rows` and `feature/delivery-fleet-time-tokens`; the role slice keeps its name, because plan 3 waits on it.
- [x] [Contradiction, Deliverable] The header counts have no slice and no Done When line. Resolved: plan 1's section-header slice fills them from `agentGroup`, and this plan's header slice asserts them in its Done When line.
- [x] [Contradiction, Estate] `REVIEW_BOUND_MS` lives in `packages/fleet` and the domain imports `zod` only. Resolved: the time-left rule takes the bound as a reading, and the server passes it in.
- [x] [Estate] `agentRowCells`, `DeliveryGate`, `AgentEntry.startedAt` and `ciOf` already exist. Resolved: the agent-rows slice changes `agentRowCells`, a loop agent's start time is `startedAt`, and Waits on `ci` reuses `ciOf`.
- [x] [Cost] The spend read parses the record on every call, and the `Worker bound` cache names no change signal. Resolved: one `stat` per `/api/fleet` build decides both re-reads, and Done When says no transcript is read on the poll.
- [x] [Contradiction, Deliverable] `feature/delivery-agent-roles` and plan 6's `feature/delivery-tickets-section` edit the "Tickets and plan runs" block with no `waits:` between them. Resolved: the block's edit is in `feature/delivery-fleet-plan-runs`, which waits on `feature/delivery-tickets-section`.
- [x] [Contradiction, Deliverable] The Changelog overstates time left and tokens, and Waits on omits the design's "review" gate. Resolved: the Changelog names the "—" cases, and Waits on adds `review` from the PR's review reading.
- [x] [Estate, Cost] Citation paths lack packages and drift by a line. Resolved: every path names its package, re-read on `main` at `f0dfed71a`.
- [x] [Not verified by any juror] A local reading for the reviewer, approver, idea and brief roles. Resolved: the role table names each file or registry write; the approver has none on `main`.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
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
