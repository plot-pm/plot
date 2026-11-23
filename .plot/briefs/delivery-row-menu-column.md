## Implementation brief — delivery-rows-act-from-one-place (wave 2: Row menu column)

- **Plan (canonical):** docs/plans/2026-11-20-delivery-rows-act-from-one-place.md on main
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/delivery-row-menu-column` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is wave 2 of 6 in plan 5 of the sprint "Delivery UI Polish". It waited on `feature/delivery-tuples-in-every-row`, which merged as #3593. Wave 1, `feature/mine-means-mine-or-my-plan`, merged as #3590. The You rows slice (verb opens this menu) and plan 7's new ticket rows wait on this branch, so the item list you build is their input. The design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside the repo; read its *Actions (⋯)* section), and `header-and-sections-v2.html` beside it is the visual reference.

### What to build

Today a Delivery row carries its actions in the wrong place and in the wrong shape. Plan rows hold buttons (`PlanActions`, `menus.tsx:314`), slice rows hold a `⋯` that is greyed out when `!willAct` and takes its explanation with it (`SliceActions`, `menus.tsx:1058-1110`), branch rows hold `BranchMenu` over `RowActions` whose items exist only where a flag holds (`menuState`, `menus.tsx:250-322`), and a Tickets row holds the bare *Plan it ›* in a `data-tickets-do` cell (`TicketsSection.tsx:124`) while `IssueRowActions` (`menus.tsx:1689`) hides Open on host where the issue has no URL. The reader cannot tell a missing action from one that cannot run.

Build one `⋯` per row with an action, in a last column at the same x in every group and section. A row with no action keeps an empty last cell of the same width. Grow `RowMenuView` and `rowMenuOf` (`packages/board/src/app/lib/agent-rows/delivery-view.ts:101,120`) so a row's menu is a list of items `{ action, label, enabled, reason | null, confirm | null }`. Then make `PlanActions`, `ResliceMenu`, `SliceActions`, `BranchMenu` and `IssueRowActions` renderers of that list. Their inline reasons (for example `menus.tsx:1106-1110`) move into the view function. Rows of a Tickets section render `IssueRowActions` from the Tickets kind's list and the bare *Plan it ›* goes.

The plan's inventory table (Design › Approach) is the work list: a control not in it is not touched. Line numbers in the plan are from 2026-11-20 morning and have moved (`rowMenuOf` was `:100-122`, now `:120`); search by symbol. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Grow `rowMenuOf`; add no second menu.** `rowMenuOf` already decides which menu a row has: `{ kind: 'clean-up', … }` for a loose item under You, `{ kind: 'row' }` otherwise. The plan wants that one function to own every kind. A parallel `menuItemsOf` beside it is the shape this plan exists to remove: two places deciding what a row offers.

**The item set per row kind is fixed, and an item that cannot run is listed disabled with its reason.** An item outside a kind's set is never listed. An item inside it always is. Today the opposite holds: `menuState` computes `present` from `canStart || canResolve || … || hasOpen`, `CleanUpMenu` returns `null` where no controller accepts the row, and `IssueRowActions` hides Open on host. Each of those becomes a listed item with a reason. Start each kind's set from the flags in `menuState`: every flag is an item of that kind, always present. Name the sets in the unit test per kind.

**The `⋯` trigger never shows disabled while it lists an item.** `SliceActions` sets `aria-disabled` and a grey class on `!willAct` and swallows the click (`menus.tsx:1106-1110`). That is the defect: the reason lives on a control that cannot be opened. The trigger opens, and the item shows disabled with the reason. A kind with no item at all has no trigger and keeps the empty cell.

**Confirmation stays where it exists today and is added to every destructive item.** The existing ones: Release claim (`releaseWords(...).confirm`, `delivery-view.ts:137-142`), Approve (`armedLabel`, `ApproveButton.tsx:70`), Deliver (`DeliverButton.tsx`), Create plan and Create story (`CreatePlanButton.tsx`, `CreateStoryButton.tsx`). Destructive ones: `loose-delete` and `registry/drop`. The unit test asserts each item's `confirm`, so an item that silently lost its armed step fails.

**No controller or refusal changes, and no route is added.** Items call the routes that exist (`packages/board/src/server/index.ts:290-497`): `approve`, `deliver`, `implement`, `dispatch`, `reslice`, `continue`, `restart`, `release-claim`, `loose-delete`, `registry/drop` and Create plan. The master-agent rule applies to the code: a menu item that needs a controller that does not exist is a gap to report, not a reason to add a route.

**Release approval is not a row action** (operator decision, 2026-11-20). It stays in the header's Release group (plan 4). `placeDelivery` keeps sending release items to `releases` and to no section.

**The Tickets item reasons join in one order.** Create plan reads `planItReason` (`packages/domain/src/rules/tickets-section.ts:83`) first and `createPlanRefusal` (`packages/board/src/app/lib/card-presentation.ts:715`, passed at `menus.tsx:1745` today) second. The first one that refuses supplies the reason. `data-tickets-do` and `data-plan-it-reason` are asserted by `tickets-section.browser.test.ts`: keep the reason reachable on the item and edit the test to read it there.

**This slice builds four kinds' lists and no others.** The Release plan row, the slice row, the branch row and the Tickets row (Create plan, Create story, Open on host). The loose row (You rows slice), the Release delivery slice line's Start work (Release delivery unfold slice) and the Fleet agent row (Fleet switches slice) build and test their own lists. `CleanUpMenu` and `StartWorkButton` stay until those slices. Do not delete or half-convert them here.

**Every rendered state is a domain property.** Each item's label, `enabled`, `reason` and `confirm` comes from a pure function with a unit test, never from a `.tsx` ternary. A decision made inside a component can only be tested by starting a board server, which is how 42 of 43 browser tests came to do so. Any function you write or rewrite is an arrow with factual TSDoc, so `menuState` becomes an arrow if you rewrite its body. Leave neighbouring `function` declarations alone: the unit is the function, and a rewrite destroys `git blame`.

**Rules carried over unchanged:** an absent address is not a dead link (an Open item with no URL is listed disabled with "no address", not removed); a reason names the missing criterion in words, as in "Delete branch — claimed, release it first"; a read (Open, worker log, Status) is not refused for a missing `WillAct`, only an act is, as `menuState`'s TSDoc records; nothing is reachable only on hover.

### Done when

The plan has no `## Done when` section. Its `## Changelog` and the slice line are the specification: one `⋯` per row with an action in a fixed last column, `rowMenuOf` grown to `{action, label, enabled, reason, confirm}` items with unit tests, the five renderers reading those items, a fixed item set per kind, a trigger that never shows disabled, confirmation where it exists today and on destructive items, the same-x browser test, and `IssueRowActions` in place of *Plan it ›*. Lift these assertions, because a naive implementation passes without them:

- A unit test per row kind (Release plan row, slice row, branch row, Tickets row) that asserts the exact set of `action` names listed, for a row where every item can run and for a row where none can. This catches an item hidden where it cannot run, which is today's behaviour and the one the plan removes.
- A unit test that for every kind and every input the trigger is never marked disabled while the list holds an item. This catches the `SliceActions` pattern surviving in the renderer.
- A unit test per item of `enabled`, `reason` and `confirm`, with the `confirm` text asserted for Release claim, Approve, Deliver, Create plan and Create story. This catches a confirmation dropped in the move.
- One browser test asserting that the `⋯` cell's left edge is equal across You, Work items, Release delivery, Fleet and Tickets rows, including a row with no action. This catches a column that aligns in one section and not another. It counts in the slice's gate delta. Sections whose own slice has not landed yet (You grouping, Work items grid, Fleet) still render a last cell; draw it with the shared width so those slices inherit the x. Look at the tab in light and dark and at 320 px: no horizontal scroll.
- Edit the browser tests the plan names: `tickets-section`, `menu-fits-the-kind`, `delivery-rows`, `tuple-row`. List each edit and its delta in the PR body.

**The count gate.** `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` pins `EXPECTED_FILES`, `EXPECTED_TESTS` and `EXPECTED_EXCEPTIONS`. The plan's text says 99 / 719 / 5. Measured 2026-11-21 on `origin/main`: **100 / 730 / 5** (`:572`, `:963`, `:1021`). Read the current values before you edit and move them by exactly your delta, with the reason in the gate's comment and in the PR body. #3596 edits the same file; expect a mechanical conflict there and re-read the numbers after you merge `origin/main`.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm build:board` only to look at the result, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Add a changeset for `@plot-pm/board`, the description first and at least 20 characters, then the `plan:` line and `bumps:` block last. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the Delivery row menus: `packages/board/src/app/lib/agent-rows/delivery-view.ts` (`RowMenuView`, `rowMenuOf`), `menus.tsx` (`PlanActions`, `ResliceMenu`, `SliceActions`, `BranchMenu`, `RowActions`, `IssueRowActions`, `menuState`), `rows.tsx` (the plan, slice, branch and ticket row call sites), `TicketsSection.tsx` (*Plan it ›* out, the `⋯` cell in), `AgentList.tsx` (the Release delivery plan row's `PlanActions`, and the last-column cell), the shared last-cell width in `delivery.css`, any new domain rule file for the item lists, and their unit and browser tests.

It does not touch the You rows' verb, grouping or loose items (`delivery-you-rows-verb-first`), the Work items columns (`delivery-work-items-grid`), the Release delivery unfold or `StartWorkButton` (`release-delivery-plan-rows-unfold`), or the Fleet switch row and agent menus (`fleet-switches-in-fleet-section`). It adds no route and changes no controller.

Collisions, verified 2026-11-21 against the open PRs. #3596 (`feature/delivery-section-empty-kinds`, plan 2) edits `AgentList.tsx`, `TicketsSection.tsx`, `delivery-view.ts`, `SectionHead.tsx`, `delivery.css` and the count gate, so it shares five files with this branch. It has not merged. Fetch `origin/main` before you start and again before you push. If #3596 has merged, rebase onto it and put the `⋯` cell inside its structure. If it has not, keep your hunks in those five files small so the later merge is mechanical. #3603 (`the-fixer-merges-the-base-into-a-conflicting-pr`) touches fleet and domain fixer rules only. The sibling slices in this plan have no branch on origin yet.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
