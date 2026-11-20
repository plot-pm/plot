# Every Delivery row keeps its actions in one ⋯ menu in the last column

> Every Delivery row with an action has one ⋯ menu in a fixed last column that lists each action, disabled with its reason where it cannot run; every existing row control has a named new place; You rows start with a verb, Work items is one grid with status pills, Release delivery plan rows unfold to their slices, and the fleet's switches live only in the Fleet section.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-ui-polish
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- Every Delivery row with an action has one ⋯ menu in the last column, at the same position in every group and section. A row with no action keeps an empty last cell of the same width. The menu lists each action of the row; an action that cannot run now is listed disabled with its reason, never hidden, and the ⋯ itself never shows disabled while it lists an item. A destructive action asks for confirmation.
- The plan row's approve, deliver, implement, dispatch and reslice buttons, the slice line's Start work button and the Tickets row's *Plan it ›* move into the row's ⋯.
- You rows start with what to do: verb, object, consequence ("Interrogate · plan X · 3 slices wait · 2h"). Rows with the same verb and the same object kind group into one row ("Release or delete · 2 loose branches · 36–37 days old"), and its ⋯ lists each branch with its own actions. The verb opens the same choice as ⋯. The group-wide delete of all loose branches is removed: each branch is deleted on its own.
- Work items is one grid: item, plan, status, by, age, ⋯. Status shows as pills with a coloured dot and whole words, and it is never cut; the branch segment of the item tuple gives way.
- Each Release delivery plan row unfolds to its slices: slice name, PR and branch, state and ⋯.
- The fleet's switches show as real switches at the top of the open Fleet section, also when the fleet is stopped, and the "turn on ›" links open the Fleet section before they scroll to them.

<!-- Board impact: the Delivery tab only (packages/board, packages/domain). No plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

Plan 5 of 7 of the sprint "Delivery UI Polish". The approved design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside this repository), with mockups in `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish/`; `header-and-sections-v2.html` is the reference and `work-items-columns.html` holds the Work items grid. The spec is canonical for everything this plan does not restate.

Today actions sit in different columns per section, some rows hold buttons and some a menu, status text is cut off, and the You rows lead with a kind instead of what to do. This plan implements goals 5, 6, 8, 9 and 10 and the spec's *Section contents (open)* and *Actions (⋯)* sections. It uses plan 1's tuples and plan 2's fold control, empty groups and reachability rule.

## Design

### Approach

**Inventory of today's row controls.** Every slice starts from this table. A control not in it is not touched.

| Control today | Where it renders | New place | Slice |
|---|---|---|---|
| `CleanUpBulkDelete` (`packages/board/src/app/components/CleanUpMenu.tsx:110`) with `bulkDeleteWords` and `cleanUpBranches` (`packages/board/src/app/lib/agent-rows/delivery-view.ts:160,175`) | the You › Unblock group heading (`packages/board/src/app/components/AgentList.tsx:1744`) | removed (spec call: no bulk action), with its assertions in `packages/board/test/unit/delivery-view.test.ts` and `loose-ends-show-under-unblock.browser.test.ts` | You rows |
| `CleanUpMenu` (`CleanUpMenu.tsx`) | a loose You row (`AgentList.tsx:1306`) | the per-branch items of the grouped Unblock row's ⋯ | You rows |
| the You Do cell, `REASON_DO`/`reasonVerb` (`packages/domain/src/rules/delivery-row-form.ts:216-239`) | You rows, via `youRowCells` (`delivery-row-form.ts:844`) | the row's verb, which opens the ⋯ | You rows |
| `PlanActions` (`packages/board/src/app/lib/agent-rows/menus.tsx:1401`): approve, deliver, implement, dispatch | the Release delivery plan row (`AgentList.tsx:1660`) and plan rows (`packages/board/src/app/lib/agent-rows/rows.tsx:942`) | ⋯ items of the plan row | Row menu column |
| `ResliceMenu` (`menus.tsx:1154`) | plan rows (`rows.tsx:1519`) | the ⋯ item "Reslice" of the plan row | Row menu column |
| `SliceActions` (`menus.tsx:1058`) | slice rows (`rows.tsx:1503`) | ⋯ items of the slice row; the trigger is no longer disabled when `!willAct` (`menus.tsx:1106-1110`) | Row menu column |
| `StartWorkButton` (`packages/board/src/app/components/StartWorkButton.tsx`) | each Release delivery slice line (`AgentList.tsx:1686`) | the ⋯ item "Start work" of the slice line | Release delivery unfold |
| `BranchMenu` (`menus.tsx:439`), which wraps `RowActions` (`menus.tsx:511`) | branch rows (`AgentList.tsx:1463`, `rows.tsx:1527,2289`) | ⋯ items of the branch row | Row menu column |
| `BrokenAgentMenu` (`menus.tsx:1800`) with `DropAgentButton` (`menus.tsx:1862`) | a broken agent row (`AgentList.tsx:1461`) | ⋯ items of the Fleet agent row: Restart, Drop agent | Fleet switches |
| `IssueRowActions` (`menus.tsx:1689`): Create plan, Create story, Open on host | Delivery ticket rows (`rows.tsx:2600`) | reused unchanged as the ⋯ of every Tickets section row | Row menu column |
| the bare `CreatePlanButton` labelled *Plan it ›* (`packages/board/src/app/components/TicketsSection.tsx:114-116`, `data-tickets-do`) | Tickets section rows | removed; its action is `IssueRowActions`' Create plan, disabled with `planItReason` (`packages/domain/src/rules/tickets-section.ts:83`) | Row menu column |
| `WorkingCounts` (with the hidden-by-filter count) and `FleetAlert` (`AgentList.tsx:1701,1706`) | the Fleet section, outside any fold guard | the top of the open Fleet section, below the switch row; plan 2 keeps an `alert`-level `FleetAlert` visible while Fleet is folded | Fleet switches |
| the switches with `id="fleet-controls"` and `data-fleet-control-column` (`AgentList.tsx:1623`) | the Fleet section heading | the switch row at the top of the open Fleet section, keeping the id and the attribute | Fleet switches |
| the held-group link "· review off · turn on ›" (`AgentList.tsx:1738`) | group headings | unchanged, through plan 2's jump, which opens Fleet before it scrolls to `#fleet-controls` | Fleet switches |

**Shared rules for every slice:**

- **No change to the controllers or their refusals** (spec non-goal). ⋯ items call the existing board routes (`packages/board/src/server/index.ts:290-497`): `approve`, `deliver`, `implement`, `dispatch`, `continue`, `restart`, `reslice`, `interrogate`, `needs-design` (which moves a plan to Design; no board route starts a design run), `release-claim`, `loose-delete`, `registry/drop`, and Create plan (`CreatePlanButton`). No route is added.
- **Release approval is not a row action** (operator decision, 2026-11-20). It stays only in the header's Release group (plan 4). No You row reads "Approve release", and `placeDelivery` keeps sending release items to `releases` and to no section (`packages/domain/src/rules/delivery-placement.ts:434-437`), so the `release-approval` reason of `YOU_GROUP_OF` (`delivery-placement.ts:215`) reaches no row.
- **No hidden UI.** An action that cannot run is listed disabled with its reason (for example "Delete branch — claimed, release it first"). No action is reachable only on hover. The ⋯ trigger is never disabled while it lists a disabled item.
- **Every rendered state is a domain property** (CLAUDE.md). Each row's verb, verb tone, object, consequence, grouping, menu items, disabled reasons and status pill is a domain or view property with a unit test; browser tests only prove it is seen. New domain code is arrow functions with factual TSDoc. A function the builder rewrites in `menus.tsx`, such as `menuState` (`menus.tsx:250`), becomes an arrow, because the rule follows the diff.
- **Scope and Mine** (operator decision, 2026-11-20). Mine applies to You, Work items and Fleet rows. Mode `off` shows every row; in the `release` scope that keeps today's unnarrowed rows (`selection` is `[]`, `packages/domain/src/rules/delivery-scope.ts:25-27`). Mode `mine` shows a row that is assigned to the reader or whose plan is the reader's, by `ownership(..., reader)` with kind `plan` over the plan's assignee, author and approver (`packages/domain/src/rules/ownership.ts:298-305`), and keeps today's rows of unknown owner. Mode `strict` keeps today's narrower rule, `isMineStrict` (`ownership.ts:326`). In `my-sprint` scope the rows narrow to every active sprint the reader owns (operator decision, 2026-11-20; `delivery-scope.ts:56-61`). In the `release` scope under Mine `mine` or `strict`, a row of a plan in no active sprint says "no sprint": in a You row's consequence, and as a grey status pill in a Work items row. `rowSprintMembership(item, activeSprints)` decides it, built by the You rows slice with a unit test per cell of {`release`, `my-sprint`} × {`off`, `mine`, `strict`}; today's filter lives in `packages/board/src/app/lib/agent-rows/mine-filter.ts` and has no "no sprint" concept.
- **Every artifact a row or menu names is a plan 1 tuple.**
- **Board tests.** The count gate pins `EXPECTED_FILES = 99`, `EXPECTED_TESTS = 719` and `EXPECTED_EXCEPTIONS = 5` (`packages/board/test/integration/stubbed-tests-start-no-board.test.ts:569,956,1014`). Each slice lists the browser tests it edits and records its delta and reason there and in its PR body.

**Per slice:**

- **⋯ column.** One ⋯ per row with an action, in a fixed last column at the same x across groups and sections (goal 12); a row with no action keeps an empty last cell of the same width. The menu grows from `RowMenuView`/`rowMenuOf` (`delivery-view.ts:100-122`), where a Delivery row's menu is decided today, not from a second menu. Each row kind gets a list of items `{ action, label, enabled, reason | null, confirm | null }`, and a unit test per row kind (You, Work items, Release plan row, Release slice line, Fleet agent, Tickets) asserts each item's `enabled` and `reason`. The eight `.tsx` menus in the inventory become renderers of that list; the reasons they compose inline today (for example `SliceActions`, `menus.tsx:1106-1110`) move into the view. A destructive item (`loose-delete`, `registry/drop`) opens a confirmation. Browser tests: `tickets-section` (`data-tickets-do`, `data-plan-it-reason`), `menu-fits-the-kind`, `delivery-rows`, `tuple-row`.
- **You rows.** Groups stay blocks delivery / input to the fleet / unblock, with today's placement: `YOU_GROUP_OF` (`delivery-placement.ts:211-224`) sends only `loose` to unblock, and a stale claim stays in Work items › Queued (spec call). `youRowCells` (`delivery-row-form.ts:844`) is rewritten to: verb, object tuple, consequence, ⋯. `REASON_DO` becomes a `Record<YouReason, { verb, tone, consequence }>`, so `tsc` proves every reason has one:

  | `YouReason` | Group, tone | Verb | Consequence |
  |---|---|---|---|
  | `draft-plan` | input, amber | Interrogate | "N slices wait" · age |
  | `plan-approval` | blocks delivery, red | Approve | "N slices wait" · age |
  | `spike-approval` | blocks delivery, red | Approve spike | "the spike waits" · age |
  | `release-approval` | blocks delivery, red | Approve release | none: no row carries it (decision 1) |
  | `test-delivered-plan` | blocks delivery, red | Test | "the release waits" · age |
  | `review-pr` | blocks delivery, red | Review | "the merge waits" · age |
  | `blocked-marker` | blocks delivery, red | Answer | "the agent waits" · age |
  | `fleet-stuck` | blocks delivery, red | Unblock | "the fleet waits" · age |
  | `merge-conflict` | blocks delivery, red | Resolve | "the merge waits" · age |
  | `person-comment` | blocks delivery, red | Answer | "the merge waits" · age |
  | `agent-died` | blocks delivery, red | Restart | "the slice stopped" · age |
  | `loose` | unblock, grey | Release or delete | "N loose branches" · age range |

  Rows group where they share the verb and the object kind within one group. The grouped row's object is a count ("2 loose branches"); each branch tuple appears in its ⋯ with its own actions and disabled reasons, one controller call per branch, and no bulk action (spec call). The verb opens the same choice as ⋯. `reasonVerb` (`delivery-row-form.ts:239`) also feeds `todo-list.ts`, which plan 4 removes. Footer: "◎ N tickets assigned to you have no plan · triage", linked to `#tickets` through plan 2's jump; an unread read is plan 2's amber state with the age of the last good reading, never "not read". Browser tests: `loose-ends-show-under-unblock` (`clean-up-bulk`), `delivery-rows`.
- **Work items grid.** Today's grid is `WORK_ITEM_COLUMNS = ['kind', 'item', 'where', 'group', 'by', 'age']` (`packages/domain/src/rules/delivery-work-columns.ts:14`) through `workItemCells` (`delivery-work-columns.ts:39`, called at `AgentList.tsx:1237,1245`), with one column per group (`WORK_GROUP_COLUMN`, `delivery-work-columns.ts:24-28`: Gates, Progress, Waits on). The new grid for every group is: item tuple, plan tuple, status pills, by, age, ⋯. The `kind` column goes, because the tuple's icon says the kind. The `where` value becomes the branch segment of the item's PR+branch tuple, and that segment gives way (ellipsis, full value on hover), goal 8; the status column sizes to its content. `statusPills(placement, facts)` maps each `GroupValueKind` (`delivery-work-columns.ts:21`: `gate`, `progress`, `wait`) to pills: each gate from `gatesCell` (`delivery-row-form.ts:286`) is one pill whose dot reads `parts[].outcome` and which keeps its link to its checks or review page; Progress (PR state and unpushed count) and Waits on ("claimed 2 days ago, no work committed") become pills with whole words; "claimed on another machine" is a quiet pill. `workByCell` (`delivery-row-form.ts:373`) stays, and the person moves from the status text to By. Plan blocks keep their indented slice rows (`delivery-view.ts:440-452`). Empty groups render as plan 2's "— none" rows in the new grid. `packages/domain/test/delivery-work-columns.test.ts` is rewritten to the new columns, not deleted. Browser test: `delivery-work-items`.
- **Release delivery unfold.** Each plan row gets plan 2's fold control and opens to its slices. The unfold exists today: `PlanName` toggles (`packages/board/src/app/components/ReleasePlanParts.tsx:104`), and `plan.lines` from `planLines` (`packages/domain/src/rules/release-plan-rows.ts:116,154`) render slice lines with `LineState`, `LineSlice` and `LinePr` (`AgentList.tsx:1673-1690`). The slice's work is the PR+branch tuple, a status pill from `statusPills` over `PlanLine['state']` (`ReleasePlanParts.tsx:179`) with its unit test, and the ⋯ on each `PlanLine`, which takes `StartWorkButton`'s action. Today's information stays. Browser test: `release-delivery-fold`.
- **Fleet switches.** The open Fleet section starts with a switch row: dispatch, review, verify and design as real switches and parallel agents as a stepper (`AutoDispatchSwitch`, `AutoSwitch`, `ParallelAgentsStepper` in `packages/board/src/app/components/FleetControls.tsx`, rendered in the section heading today at `AgentList.tsx:1622-1630`). The row keeps `id="fleet-controls"` and `data-fleet-control-column`. `fleetSwitchRow(fleet)` decides that the row shows, also for a stopped fleet, with a unit test; when the fleet is stopped, the row sits above plan 2's stopped frame. Below it sit `WorkingCounts` and `FleetAlert`, then groups working / blocked / free, one row per agent. Today's agent columns are `AGENT_COLUMNS = ['agent', 'role', 'actingOn', 'doing', 'tokens', 'timeLeft']` (`delivery-row-form.ts:540`); the new row is circle, agent, role, working-on tuple (`actingOn`), status pill from `statusPills` over the agent state (`doing`), tokens, time left, ⋯, so no value is lost. Machine shows only load, rate limits and headroom (`FleetMachineSchema`, `packages/board/src/contract/schema.ts:4475-4481`); it holds no switch. A browser test proves that no switch renders outside the Fleet section. Browser tests: `fleet-settings`, `delivery-fleet-look` (`#fleet-controls`, `data-fleet-control-column`, kept).

### Open Questions

- [x] Which rows are similar enough to group into one You row? Answer: the same verb and the same object kind within one group; the grouped row's object is a count, and each item appears in its ⋯.

## Slices

### Row menu column

- `feature/delivery-row-menu-column` <!-- waits: feature/delivery-tuples-in-every-row --> — one ⋯ per row in a fixed last column across every Delivery section with an empty cell for a row with no action, `rowMenuOf` grown to `{action, label, enabled, reason, confirm}` items per row kind with unit tests, `PlanActions`, `ResliceMenu`, `SliceActions` and `BranchMenu` rendered from those items with a trigger that never shows disabled, confirmation on destructive items, and `IssueRowActions` as the Tickets row's ⋯ in place of the bare *Plan it ›* <!-- builds: rowMenu, the one ⋯ menu of a Delivery row -->

### You rows

- `feature/delivery-you-rows-verb-first` — You rows as verb, object tuple, consequence and ⋯ from a `REASON_DO` record of verb, tone and consequence per `YouReason`, rows grouped by verb and object kind with each branch in the ⋯, `CleanUpBulkDelete`, `bulkDeleteWords` and `cleanUpBranches` removed with their tests, `rowSprintMembership` with the scope and Mine cells, and the triage footer linked to `#tickets` <!-- builds: youRowForm and rowSprintMembership, a verb-first You row with grouping -->

### Work items grid

- `feature/delivery-work-items-grid` <!-- waits: feature/delivery-section-empty-kinds --> — one Work items grid of item tuple, plan tuple, status pills, by, age and ⋯ replacing `WORK_ITEM_COLUMNS`, `statusPills` over the Gates, Progress and Waits-on values with linked gate pills, a status column that sizes to its content and a branch segment that gives way, plan blocks with indented slice rows, and `delivery-work-columns.test.ts` rewritten <!-- builds: workItemsGrid and statusPills, the Work items columns and status pills -->

### Release delivery unfold

- `feature/release-delivery-plan-rows-unfold` <!-- waits: feature/every-delivery-section-folds --> — each Release delivery plan row with plan 2's fold control, opening to `PlanLine` slice lines with name, PR+branch tuple, a status pill from `statusPills` and a ⋯ that holds Start work <!-- builds: releasePlanSlices, the unfolded slice lines of a release plan row -->

### Fleet switches

- `feature/fleet-switches-in-fleet-section` <!-- waits: feature/delivery-tab-has-one-header, feature/delivery-section-empty-kinds --> — the switch row with `#fleet-controls` at the top of the open Fleet section from `fleetSwitchRow`, visible above the stopped frame, `WorkingCounts` and `FleetAlert` below it, agent rows with circle, agent, role, working-on tuple, status pill, tokens, time left and a ⋯ that holds `BrokenAgentMenu`'s actions, and no switch outside the Fleet section <!-- builds: fleetSwitchRow, the Fleet section's switch row -->

## Notes

- Created by `/plot-idea` in one batch with the other six plans of the sprint "Delivery UI Polish". Type `feature` came from the brief; the design question was answered no, because the design spec already exists outside the repository, so the plan starts in Draft.
- Panel round 1 (2026-11-20, unanimous `amend`) found that the plan inventoried what it builds and not what exists; the inventory table above is the answer, and every slice starts from it.
- Slices in one plan run in heading order. The ⋯ column comes first because the You rows' verb and the grouped row's per-branch list open the ⋯ menu; the spec lists You rows first.
- Cross-plan order, named in `waits:` markers: the first slice waits on plan 1's `feature/delivery-tuples-in-every-row`; the Work items grid waits on plan 2's `feature/delivery-section-empty-kinds`, so the "— none" rows land in the new grid once; the Release delivery unfold waits on plan 2's `feature/every-delivery-section-folds` for the fold control; the Fleet slice waits on plan 4's `feature/delivery-tab-has-one-header` (it removes `FleetCard`) and on plan 2's `feature/delivery-section-empty-kinds` (the stopped frame the switch row sits above).
- Plan 6 (`delivery-activity-has-three-signals`) waits on `feature/delivery-work-items-grid`, because its spinner slot sits before the status column this plan builds. Plan 7 (`tickets-show-what-the-sprint-delivers-and-found`) waits on `feature/delivery-row-menu-column` for the ⋯ of its new ticket rows.
- The spec's mockup draws an "Approve release" row first under You › Blocks delivery. That row is out of scope (operator decision, 2026-11-20): release approval stays in the header's Release group, and placement is unchanged.
- The mockup `work-items-columns.html:22,55` draws Item, Where, Status, By, Age and no Plan column. The grid follows the spec instead (item tuple, plan tuple, status), and the `where` value lives in the item tuple's branch segment.
