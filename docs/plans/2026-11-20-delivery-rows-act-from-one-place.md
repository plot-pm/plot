# Every Delivery row keeps its actions in one ⋯ menu in the last column

> Every Delivery row with an action has one ⋯ menu in a fixed last column that lists each action, disabled with its reason where it cannot run; You rows start with a verb, Work items is one grid with status pills, Release delivery plan rows unfold to their slices, and the fleet's switches live only in the Fleet section.

## Status

- **State:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Changelog

- Every Delivery row with an action has one ⋯ menu in the last column, at the same position in every group and section. The menu lists each action of the row; an action that cannot run now is listed disabled with its reason, never hidden. A destructive action asks for confirmation.
- You rows start with what to do: verb, object, consequence ("Interrogate · plan X · 3 slices wait · 2h"). Similar items group into one row ("Release or delete · 2 loose branches · 36–37 days old"), and its ⋯ lists each branch with its own actions. The verb opens the same choice as ⋯.
- Work items is one grid: item, plan, status, by, age, ⋯. Status shows as pills with a coloured dot and whole words, and it is never cut; the branch column gives way.
- Each Release delivery plan row unfolds to its slices: slice name, PR and branch, state and ⋯.
- The Tickets section's *Plan it ›* moves into the row's ⋯ menu, disabled with its reason when no plan can be created.
- The fleet's switches show as real switches at the top of the open Fleet section, also when the fleet is stopped.

<!-- Board impact: the Delivery tab only (packages/board, packages/domain). No plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

Plan 5 of 7 of the sprint "Delivery UI Polish". The approved design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside this repository), with mockups in `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish/`; `header-and-sections-v2.html` is the reference and `work-items-columns.html` holds the Work items grid. The spec is canonical for everything this plan does not restate.

Today actions sit in different columns per section, some rows hold buttons and some a menu, status text is cut off, and the You rows lead with a kind instead of what to do. This plan implements goals 5, 6, 8, 9 and 10 and the spec's *Section contents (open)* and *Actions (⋯)* sections. It uses plan 1's tuples.

## Design

### Approach

**Shared rules for every slice:**

- **No change to the controllers or their refusals** (spec non-goal). ⋯ items call the existing controllers: `release-claim`, `loose-delete`, `restart`, release approval with passkey, interrogate and design starts, and *Plan it* (`CreatePlanButton`, `TicketsSection.tsx:115`).
- **No hidden UI.** An action that cannot run is listed disabled with its reason (for example "Delete branch — claimed, release it first"). No action is reachable only on hover.
- **Every rendered state is a domain property** (CLAUDE.md). Each row's verb, object, consequence, grouping, menu items, disabled reasons and status pill is a domain or view property with a unit test; browser tests only prove it is seen. Moving assertions into unit tests updates `stubbed-tests-start-no-board.test.ts` with the reason. New domain code is arrow functions with factual TSDoc.
- **Scope and Mine** decide which rows show, per the spec's table: in the `release` scope Mine on shows every item assigned to the reader, also those in no active sprint, and such a row names "no sprint" in its consequence; in `my-sprint` scope Mine on shows only the reader's items in the reader's sprint (`DeliveryScopeKind`, `packages/domain/src/rules/delivery-scope.ts:8`).
- **Every artifact a row or menu names is a plan 1 tuple.**

**Per slice:**

- **⋯ column.** One ⋯ per row with an action, in a fixed last column at the same x across groups and sections (goal 12). The menu extends today's `menuState` (`packages/board/src/app/lib/agent-rows/menus.tsx:250`) and `CleanUpMenu.tsx`; it is not a second menu. A destructive item (`loose-delete`, drop) opens a confirmation. The Tickets section's *Plan it ›* moves into its row's ⋯, disabled with `planItReason` (`packages/domain/src/rules/tickets-section.ts:83`: `tracker-unsupported`, `tracker-failed`, `unavailable`) where no plan can be created.
- **You rows.** Groups stay blocks delivery / input to the fleet / unblock, with today's placement: `YOU_GROUP_OF` (`packages/domain/src/rules/delivery-placement.ts:211-224`) sends only `loose` to unblock, and a stale claim stays in Work items › Queued (spec call). A row reads verb (red for blocks delivery, amber for input, grey for unblock), object tuple, consequence, ⋯. Similar unblock items group into one row; its ⋯ lists each branch with its own actions and disabled reasons, one controller call per branch, and no bulk action (spec call). The verb opens the same choice as ⋯. Footer: "◎ N tickets assigned to you have no plan · triage", linked to `#tickets`; an unread read is plan 2's amber state, never "not read".
- **Work items grid.** One grid for every group: item tuple, plan tuple, status pills, by, age, ⋯. No KIND column; the tuple's icon says the kind. Status pills carry a coloured dot and whole words ("● CI running", "● review not asked", "● Design · round 2"); the person moves from the status text to By. The status column sizes to its content and the branch column gives way (ellipsis, full value on hover), goal 8. Today's columns are `ROW_COLUMNS` (`packages/domain/src/rules/delivery-row-form.ts:18`).
- **Release delivery unfold.** Each plan row has its own small fold control and opens to its slices: slice name, PR+branch tuple, status pill, ⋯. Today's information stays. The plan row's toggle exists today (`PlanName`, `packages/board/src/app/components/ReleasePlanParts.tsx:104`); this slice gives it the shared fold control and gives each slice line the tuple, pill and ⋯.
- **Fleet switches.** The open Fleet section starts with a switch row: dispatch, review, verify and design as real switches and parallel agents as a stepper (`AutoDispatchSwitch`, `AutoSwitch`, `ParallelAgentsStepper` in `FleetControls.tsx`, rendered in the section header today at `AgentList.tsx:1624-1628`). The switches stay visible when the fleet is stopped. Then groups working / blocked / free, one row per agent: circle, agent, working-on tuple, status pill, duration, ⋯. Machine shows only load, rate limits and headroom (`FleetMachineSchema`, `packages/board/src/contract/schema.ts:4475-4481`); it holds no switch. Plan 4 removes `FleetCard` and its read-only copy, so this slice waits on plan 4.

### Open Questions

- [ ] Which rows are similar enough to group into one You row? The spec gives loose branches as the example. Suggestion: same verb and same object kind within one group.

## Slices

### Row menu column

- `feature/delivery-row-menu-column` <!-- waits: feature/delivery-tuples-in-every-row --> — one ⋯ per row in a fixed last column across every Delivery section, every action listed with its disabled reason as a domain property, confirmation on destructive items, and *Plan it ›* moved into the Tickets row's ⋯ with `planItReason` <!-- builds: rowMenu, the one ⋯ menu of a Delivery row -->

### You rows

- `feature/delivery-you-rows-verb-first` — You rows as verb, object tuple, consequence and ⋯, similar unblock items grouped into one row whose ⋯ lists each branch, the verb opening the ⋯ choice, "no sprint" in the consequence under Mine, and the triage footer linked to `#tickets` <!-- builds: youRowForm, a verb-first You row with grouping -->

### Work items grid

- `feature/delivery-work-items-grid` — one Work items grid of item, plan, status pills, by, age and ⋯ with no KIND column, a status column that sizes to its content and a branch column that gives way <!-- builds: workItemsGrid, the Work items columns and status pills -->

### Release delivery unfold

- `feature/release-delivery-plan-rows-unfold` — each Release delivery plan row with its own fold control, opening to slice lines with name, PR+branch tuple, status pill and ⋯ <!-- builds: releasePlanSlices, the unfolded slice lines of a release plan row -->

### Fleet switches

- `feature/fleet-switches-in-fleet-section` <!-- waits: feature/delivery-tab-has-one-header --> — the switch row at the top of the open Fleet section, visible when the fleet is stopped, agent rows with circle, working-on tuple, status pill, duration and ⋯, and no switch outside the Fleet section <!-- builds: fleetSwitchRow, the Fleet section's switch row -->

## Notes

- Created by `/plot-idea` in one batch with the other six plans of the sprint "Delivery UI Polish". Type `feature` came from the brief; the design question was answered no, because the design spec already exists outside the repository, so the plan starts in Draft.
- Slices in one plan run in heading order. The ⋯ column comes first because the You rows' verb and the grouped row's per-branch list open the ⋯ menu; the spec lists You rows first.
- Cross-plan order: the first slice waits on plan 1's `feature/delivery-tuples-in-every-row`; the Fleet slice waits on plan 4's `feature/delivery-tab-has-one-header`. Both are named in `waits:` markers.
- Plan 6 (`delivery-activity-has-three-signals`) waits on `feature/delivery-work-items-grid`, because its spinner slot sits before the status column this plan builds.
