## Implementation brief — every-work-item-and-agent-shows (wave Tab: the Delivery tab renders the five sections)

**Ruling, 2026-11-08, Jan Wloka: the fleet payload gains two optional fields.** The served fleet payload carries `autoReview` (boolean) and `correctionBudget` (number), both optional, read from the `Auto-review` and `Correction budget` keys of `## Plot Config`. Add them to the schema in `packages/board/src/contract/schema.ts` as `.optional()`, fill them on the server, and pass them to the mapper as `DeliveryInput.autoReview` and `DeliveryInput.correctionBudget`. A missing field stays absent and is never defaulted. This ruling replaces this brief's statements that the served payload does not change; rebuild the board artifact only to test locally, as before. Continue from PR #3267 (`feature/delivery-tab-sections`), which holds the mapper and its tests, and finish the Not done list in its body.


- **Plan (canonical):** docs/plans/2026-11-08-every-work-item-and-agent-shows.md on main
- **Design (canonical):** docs/superpowers/specs/2026-11-08-delivery-tab-design.md, approved 2026-11-08
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3248 merged
- **Branch:** `feature/delivery-tab-sections` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on main)

This branch is wave "Tab", the second of two. Wave "Rule" (`feature/delivery-placement-rule`, PR #3255) merged on 2026-11-08 as `109c7b4cf`, so nothing waits on this branch's start. Plan 2 (row forms) and plan 3 (tickets, `People`, loose-end controllers) are separate plans and out of scope.

### What to build

The Delivery tab renders what `placeDelivery` returns, in the five sections Release delivery, You, Work items, Fleet and Machine, using the current row components. Lead with the failure it fixes, measured on the running board 2026-11-08: an agent row reading "waiting on you" sits under **Working**, and two idle desks reading "no manifest names this desk" sit under **Waiting on you**. `GROUPS` (`packages/board/src/app/lib/agent-rows/sections.ts`) sorts rows by what they ask of a person, while rows reach a section by the state of one branch or one process. A fix that re-sorts the same list under new titles reproduces the defect.

Three pieces make the change:

1. **A readings mapper.** `placeDelivery(readings, input)` takes `DeliveryReadings` (`items`, `agents`) and `DeliveryInput` (`mine`, `autoReview`, `correctionBudget`). Nothing builds those from the board's payload yet. Write one pure function that maps what the board reads today (the fleet payload's rows, the PR index, `issues.json`, the agent registry, the machine readings) to `DeliveryReadings`, as an arrow in `packages/board/src/app/lib/agent-rows/`, not in a `.tsx` file. It adds no new data source.
2. **The tab.** `AgentList.tsx` stops mapping `GROUPS` (`AgentList.tsx:1133`) and maps `DELIVERY_LAYOUT` instead: section, then group, in the exported order. Each placed item and agent renders with the row component it uses today. Each link between an item and its agent is visible and scrolls to its target.
3. **The replacement.** `GROUPS` in `sections.ts`, `GROUP_ORDER` in `packages/board/src/server/fleet.ts` (`:5859`, sorted at `:7527`) and the assertion at `packages/board/test/unit/agent-list.test.ts:356` (`GROUPS` equals `GROUP_ORDER`) leave together. Wave "Rule" left `GROUP_ORDER` unchanged for exactly this reason and recorded it in its PR body: changing one side alone breaks that test or sorts rows by a vocabulary the tab no longer renders. This branch owns the whole replacement.

The plan is canonical; this is orientation. Read the design's "The Placement Rule", "Section Content", "Groups" and "Calls Made After Review", and `packages/domain/src/rules/delivery-placement.ts`, before writing the mapper.

### Settled decisions — do not re-derive them

**The rule decides; the tab renders.** `placeDelivery` already settled every placement. The tab imports `DELIVERY_LAYOUT` for section and group order and reads `section`, `group`, `reason`, `agents`, `actsOn` and `linked` off the result. A section, group, link target or disabled state computed in a `.tsx` file is a defect (CLAUDE.md, "Every rendered state is a domain property"). If the tab needs a decision the rule does not return, report it. Do not add the decision to the component.

**`unplaced` is shown, never dropped.** `placeDelivery` returns subjects no section holds, with reason `unread` or `delivered`. An `unread` subject renders in a visible "not placed" note that names the reason. The design's anti-goal is "a section that hides an item without saying so", and a mapper that drops unread rows would hide exactly the rows whose reading failed. `delivered` subjects belong to Release delivery, not Work items.

**Absent is not false.** Where the payload does not carry a field, the mapper leaves the reading absent (or `unread` for `PrReading`), and the rule places the row in `unplaced`. The mapper never defaults a missing CI or review reading to `passed`, and never defaults a missing `process` to `stopped`. `WaitingGroupSchema.nullable()` in `contract/schema.ts` exists for the same reason: *shown, never sorted*.

**The mapper maps and decides nothing.** It copies facts the payload already states (`PLOT-BLOCKED` marker, PR conflict, CI state, review state, process state, `Correction budget`). It does not infer `gateUnpassable` or `mergeConflict` from prose, and it does not re-derive a verdict. A fact the payload cannot state stays absent.

**You follows the Mine filter, passed as a value.** The mapper reads the mode from `mine-filter.ts` (three modes) and passes it as `input.mine`. The filter does not move into the domain.

**Config keys come from config.** `autoReview` is the `Auto-review` key and `correctionBudget` is the `Correction budget` key. The board already reads config; reuse that read. A hardcoded `true` or `2` passes the repo's own config and breaks every other project.

**Release delivery and Machine are outside the placement rule**, so the rule places no row in either. Release delivery replaces today's **Done** section. The design's collapsed line ("2.32.0: 12 of 18 slices delivered · 3 held at gates · 1 blocked") counts the delivered subjects in `unplaced` plus the placed ones. Machine collapses the machine readings and the tracker rate-limit banner the tab shows today between work rows. **Plan 2 owns the expanded forms** (Ready for testing grouped by plan with `Done when`, Still in flight link lines, the phase strips, the fleet switches in the Fleet header). If the plan's wording "renders the five sections with the current row components" leaves a Release delivery or Machine detail unclear, build the one-line collapsed form from existing data, and report the rest in the PR body. Do not invent the expanded forms here.

**Collapse state is stale after the key change.** `collapse.ts` stores collapsed group keys in `localStorage` under `plot-board:agents:collapsed`. `readCollapsed` already filters stored keys against the known list, so old keys (`quiet`, `done`) fall away without a migration. `COLLAPSED_BY_DEFAULT` still names the old keys: it needs the new default (the design collapses Free agents into one line). Test that an old stored set yields the new default, not an empty set.

**The server's `group` field stays.** `AgentRow.group` is part of the served payload and `attention.ts`, `working-agents.ts` and `tuple-row.ts` read it (`WaitingGroupSchema`). This branch changes what the tab renders, not what the server serves. Grep every consumer of `GROUP_ORDER` and of the `group` sort before removing the server-side sort, and state in the PR body what the choice was. If removing it changes row order for a consumer other than the tab, keep a sort and say why.

**Terminology is binding** (CLAUDE.md, "The Domain Package"). A **Slice** holds one branch and belongs to one plan. Write `Slice`, never `Wave`, where a slice is meant. An **Agent** is the actor; `Worker` stays machine-side. New functions are arrows: `export const f = (…) => …`. The rule follows the diff: a helper you write in a board file or test is an arrow even though the board's older code uses declarations. Do not convert neighbours you only pass through.

**Invariants this repo keeps re-learning:**

- A verdict is derived fresh from readings and never persisted. The tab stores nothing.
- A decision made in a component is a defect.
- Every item and every agent shows once. A second section may show a link, never a second row.

### Done when

The plan's `Slices` line for this branch is the specification: the tab renders the five sections from the rule with the current row components, replaces `GROUPS` in `sections.ts`, and carries one browser test that shows the sections. The plan has no separate `Done when` list. These assertions exist because a naive implementation passes without them:

- **Mapper totality over a mixed fixture.** One unit test feeds the mapper a payload with items, a fixer on a failed-CI slice, a dead agent, a PR no plan names and a row missing its CI reading, and asserts that every payload row ends up in exactly one section or in `unplaced`. A per-case test passes while two cases double-place or one vanishes.
- **A missing field is not defaulted.** The row missing its CI reading arrives in `unplaced` with reason `unread`. This catches a mapper that fills the gap with `passed`.
- **The fixer case through the mapper**, not only through the rule: slice under Work items › At a gate, fixer under Fleet › Working, slice absent from You.
- **Config keys reach the rule.** `Auto-review` on and off give At a gate and You › Review a result for the same PR, driven by the config value and not a constant.
- **Group order is one constant.** The tab imports `DELIVERY_LAYOUT`; a test asserts the rendered section and group order equals it. `GROUPS` and `GROUP_ORDER` no longer exist, and the old assertion at `agent-list.test.ts:356` is replaced by this one, not loosened.
- **Old stored collapse state yields the new default.**
- **One browser test shows the sections**: the five section headings, and one row under each of You, Work items and Fleet. It proves what is seen. Behaviour stays in the unit tests above.

**Existing browser tests will break and this branch fixes them.** 167 lines in 44 files under `packages/board/test/integration/` name the old section keys (`waiting-on-you`, `waiting-on-machine`, `not-started`), `agents-tab.browser.test.ts` among them (measured 2026-11-08 on `origin/main`). The plan leaves "which existing browser tests move to unit tests" to the Builder. For each: if it asserts a decision, move the assertion to a unit test on the domain or the mapper, and delete the browser version; if it asserts only that something shows, update it to the new headings. Do not delete a test whose assertion has no new home, and do not loosen one to make it pass. Keep a short list of what moved where for the PR body.

Plus: the changeset (package `@plot-pm/board`, description FIRST, `bumps:` block LAST, per CLAUDE.md "Versioning"; run `./scripts/check-changeset-packages.sh`), and the plan's Changelog and Board impact lines. The served payload does not change, so no board artifact rebuild is expected. Rebuild locally only to test, then restore generated paths before pushing (`scripts/check-no-bundle-diff.sh`). A PR diff carries no generated bundle.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. Do not run board tests while an operator's board is open.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. If that changes, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. In the PR body, state the `GROUP_ORDER` choice and the list of browser tests that moved.

### Scope guard

This branch owns `packages/board/src/app/lib/agent-rows/sections.ts`, `collapse.ts`, the new mapper file, the `AgentList.tsx` section mapping, the `GROUP_ORDER` replacement in `packages/board/src/server/fleet.ts`, and the board tests that assert the old vocabulary. It does not change `packages/domain/src/rules/delivery-placement.ts`: if the rule needs a change, report it, because it merged as the settled contract. It does not rewrite row components, columns or the details popover (plan 2), add tickets, the `People` key or tracker reads (plan 3), or change the Tickets, Stories or Plans tabs, the fleet's scheduling, review, fix or merge behaviour, or the served payload shape.

Collision check at dispatch: `git ls-remote --heads origin 'feature/delivery-*' 'feature/*tab*'` returned no branch on 2026-11-08, so no other branch in flight holds these files. Re-run it before the first push: `AgentList.tsx` and the agents-tab tests change often.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
