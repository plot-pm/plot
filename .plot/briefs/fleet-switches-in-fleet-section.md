## Implementation brief — delivery-rows-act-from-one-place (wave 6: Fleet switches)

- **Plan (canonical):** docs/plans/2026-11-20-delivery-rows-act-from-one-place.md on main
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/fleet-switches-in-fleet-section` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the last wave of plan 5 of the sprint "Delivery UI Polish". Its waits have merged: `feature/mine-means-mine-or-my-plan` (#3590), `feature/delivery-tab-has-one-header` (#3607) and `feature/delivery-section-empty-kinds` (#3596). The five slices before it have merged too: Mine rule (#3590), Row menu column (#3622), You rows (#3648), Work items grid (#3660) and Release delivery unfold (#3665). The design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside the repo; read *Section contents (open)*), with `header-and-sections-v2.html` beside it as the visual reference.

### What to build

Today the fleet's switches sit in the Fleet section's heading (`AgentList.tsx`, the `<span id={FLEET_CONTROLS_ANCHOR} data-fleet-control-column>` inside the `section.key === 'fleet'` heading), so a folded or narrow heading crowds them, and `WorkingCounts` and `FleetAlert` render in a bar below the heading. The Fleet agent row has its columns but no status pill, and its ⋯ is two hand-written menus (`BrokenAgentMenu`, `BranchMenu`) chosen inline in `agentBody`.

Build four things:

1. **The switch row.** The open Fleet section starts with a row of real switches: dispatch, review, verify, design (`AutoDispatchSwitch`, `AutoSwitch` ×3) and the parallel-agents stepper (`ParallelAgentsStepper`), all from `FleetControls.tsx`. The row keeps `id="fleet-controls"` (`FLEET_CONTROLS_ANCHOR`) and `data-fleet-control-column`. `fleetSwitchRow(fleet)` in the domain decides that the row shows, and it shows for a stopped fleet too. When the fleet is stopped, the row sits above plan 2's stopped frame (`SectionEmptyFrame`, rendered where `empty !== null`). Below the switch row sit `WorkingCounts` and `FleetAlert`, then the working / blocked / free groups, one row per agent. The heading no longer holds the switches. The held-group links "· review off · turn on ›" already call `jump(FLEET_CONTROLS_ANCHOR)`, and `anchorOwner` already maps that anchor to the Fleet section (`delivery-view.ts`): keep both, and prove with a browser test that the link opens a folded Fleet section before it scrolls.
2. **`agentPills(state)`.** One producer of `StatusPill` (`packages/domain/src/rules/status-pill.ts`, built by #3660; `pill(word, tone, href)`), mapping the agent state to whole-word pills with a unit test per state. The `doing` cell of the Fleet agent row shows these pills in place of its text. The spinner slot (`ActivitySlot`) stays where it is: plan 6 (`delivery-activity-has-three-signals`) rebuilds it, and this slice leaves a clean place before the pill.
3. **The Fleet agent row's ⋯ from `rowMenuOf`.** Add a row kind `fleet-agent` to `RowMenuInput` (`packages/board/src/app/lib/agent-rows/delivery-view.ts`), the way #3622 added `slice-line` and #3665 used it. Its fixed item set holds `BrokenAgentMenu`'s actions (Restart, Drop agent) for a broken agent and `BranchMenu`'s items (worker log, Open, Continue, Restart, open plan, reveal branch) for every other agent that has a branch. Each item is `{ action, label, enabled, reason, confirm }`; an item that cannot run is listed disabled with its reason, never hidden; Drop agent asks for confirmation as `DropAgentButton` does today. The renderers in `menus.tsx` render the list and decide nothing. A function you rewrite there becomes an arrow.
4. **No switch outside the Fleet section.** One browser test asserts that none of the five controls renders outside `[data-section="fleet"]`. The Machine section shows load, rate limits and headroom only.

The plan is canonical; this is orientation. Line numbers in it are from 2026-11-20 morning: search by symbol.

### The decisions the plan settles — do not re-derive them

**The agent row keeps role, tokens and time left.** The spec's Fleet row is "circle, agent, working-on tuple, status pill, duration, ⋯". The plan keeps role and tokens and shows time left in place of duration, because `AGENT_COLUMNS = ['agent', 'role', 'actingOn', 'doing', 'tokens', 'timeLeft']` carries them today and dropping one loses a value. The new row is circle, agent, role, working-on tuple, status pill, tokens, time left, ⋯. `FleetAgentRow.tsx` already has the circle, the ⋯ track (`--delivery-menu-track`) and the details popover: add the pills and the `rowMenuOf` menu, and do not rebuild the grid.

**The switch row is not a card.** Plan 4 (#3607) removed `FleetCard` from the header; do not bring a card back. The switches are in the open section only: a folded Fleet section shows its summary and, for an `alert` supervisor, its `FleetAlert` (plan 2), and no switches.

**Mine applies to the agent rows.** The Fleet agent rows show only the agents the Mine rule keeps (`agentsForReader`, built by #3590 over the agent arm and the plan of the row the agent's `branch` joins). Do not add a second filter, and do not filter the switch row.

**No hidden UI** (`no-hidden-ui`): the ⋯ is never disabled while it lists an item, and an agent with no action keeps an empty last cell of the same width, as the Row menu column slice fixed.

**No change to controllers or their refusals, and no new route.** Items call `continue`, `restart`, `registry/drop`, `dispatch` and `implement` as today.

Rules carried over unchanged: absent is not false (an unread supervisor or fleet reading is `unread`, never "stopped" or an empty list); read the exit code, not the emptiness; every rendered state is a domain property with a unit test, so the switch row's visibility, each pill's word and tone and each menu item's `enabled`, `reason` and `confirm` are decided in the domain and the `.tsx` only renders them; every artifact a row names is a plan 1 tuple; new code is arrow functions with factual TSDoc.

### Done when

The plan has no `## Done when` section. Its slice line and its Changelog bullet for the fleet's switches are the specification: real switches at the top of the open Fleet section, also when the fleet is stopped, and the "turn on ›" links open the Fleet section before they scroll to them. Assertions that exist because a naive implementation would pass without them:

- **The row shows for a stopped fleet, above the stopped frame** — a unit test of `fleetSwitchRow` for running, stopped and unread fleets, and one browser test that the switch row precedes `SectionEmptyFrame` in DOM order. A switch row inside `content` (`empty === null`) fails it, because a stopped fleet renders the frame and no content.
- **"turn on ›" opens a folded Fleet section** — a browser test folds Fleet, clicks a held-group link and expects the section open with `#fleet-controls` scrolled into view.
- **`agentPills` covers every agent state** — the unit test is a `Record` over the state union, so `tsc` proves a new state has a pill.
- **Every `fleet-agent` item has its unit cell** — `enabled`, `reason` and `confirm` for the broken agent's set and the branch agent's set, with a disabled item for each refusal that exists today.
- **No switch outside the Fleet section** — the browser test counts `[data-fleet-control-column]`, `AutoDispatchSwitch`, the three `AutoSwitch`es and the stepper outside the section and expects 0.
- **The ⋯ cell keeps the same x** — the same-x browser test of #3622 (`delivery-rows`) still holds for a Fleet agent row.

Plus: add a changeset that declares its bumps (description first, `bumps:` last). Record the `EXPECTED_FILES` / `EXPECTED_TESTS` / `EXPECTED_EXCEPTIONS` delta and its reason in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` and in the PR body (101 / 758 / 5 on `origin/main` at 2026-11-23). Browser tests this slice edits: `fleet-settings`, `delivery-fleet-look` (`#fleet-controls` and `data-fleet-control-column` are kept), `a-fleet-row-shows-its-role-chip`. A builder runs `pnpm build:board` locally to test and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` is not in play; if that changes, growth is paid for in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. On a conflict in `board-server.mjs`, do not read the diff and do not commit the rebuild: restore the generated paths from the merge base (see CLAUDE.md › Testing).

### Scope guard

This branch owns `fleetSwitchRow` and `agentPills` in the domain (a new rule file beside `status-pill.ts`), the `fleet-agent` kind of `rowMenuOf` in `delivery-view.ts`, `FleetControls.tsx`, `FleetAgentRow.tsx`, the Fleet section block of `AgentList.tsx` (the heading's switch span, the `WorkingCounts` and `FleetAlert` bar, `agentBody`), `BrokenAgentMenu` and `BranchMenu` in `menus.tsx`, and the three browser tests named above.

Other work in flight: plan 6 (`delivery-activity-has-three-signals`) rebuilds the spinner slot and waits on the Work items grid, which has merged: leave `ActivitySlot` and its place in the `doing` cell as they are. Plan 7's `feature/tickets-show-what-the-sprint-delivers-and-found` owns the Tickets rows and `tickets-section.ts`. `AgentList.tsx` is shared with both: keep your edits to the Fleet section block.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
