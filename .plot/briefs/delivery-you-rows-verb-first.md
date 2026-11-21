## Implementation brief — delivery-rows-act-from-one-place (wave 3: You rows)

- **Plan (canonical):** docs/plans/2026-11-20-delivery-rows-act-from-one-place.md on main
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/delivery-you-rows-verb-first` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is wave 3 of 6 in plan 5 of the sprint "Delivery UI Polish". Its waits have merged: `feature/mine-means-mine-or-my-plan` (#3590), `feature/delivery-section-empty-kinds` (#3596) and, through wave order, `feature/delivery-row-menu-column` (#3622). The Work items grid, Release delivery unfold and Fleet switches slices come after it. The design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside the repo; read *Section contents (open)* and *Actions (⋯)*), and `header-and-sections-v2.html` beside it is the visual reference.

### What to build

Today a You row leads with its kind, and the loose rows under Unblock each carry a `CleanUpMenu` that returns `null` where no controller accepts the row, plus a bulk-delete button on the group heading (`CleanUpBulkDelete`). The reader cannot tell what to do first, cannot tell a missing action from one that cannot run, and one click can delete many branches.

Build a You row as: verb, object tuple, consequence, ⋯. `REASON_DO` (`delivery-row-form.ts`, `{ verb, action }` today) becomes `Record<YouReason, { verb, action, tone, consequence }>`, so `tsc` proves every reason has an entry; the plan's table fixes verb, tone and consequence per reason. `youRowCells` is rewritten to the four cells. The loose rows under Unblock group into one row whose object is a count ("2 loose branches") and whose consequence is the age range only; each branch tuple sits in the row's ⋯ with its own Open, Release claim and Delete branch, one controller call per branch. `looseActions` returns `{ enabled, reason }` for Release claim and Delete branch instead of booleans, one reason word per refusal (claimed, carries work, open PR, unread claim). `CleanUpBulkDelete`, `bulkDeleteWords` and `cleanUpBranches` go, with their assertions. `rowSprintMembership(item, activeSprints)` is built beside `rowIsSprintExempt` in `sprint-selection.ts` and adds only the "no sprint" answer. The triage footer links to `#tickets`. Wave 2 already grew `RowMenuView` to a `kind: 'items'` variant with `RowMenuItem { action, label, enabled, reason, confirm }` and a `trigger` that is never disabled while it lists an item; the You rows use that shape, they do not add a second one. The plan is canonical; this is orientation. Line numbers in it are from 2026-11-20 morning: search by symbol.

### The decisions the plan settles — do not re-derive them

**Only Unblock groups rows.** The spec says "Similar unblock items group into one row". Every other You row stays one row per item. The grouping runs after `nestItems(..., inYou = true)` and `oneRowPerDraftPlan`, and it groups only lone `loose` items, which no plan block nests. Grouping the blocks-delivery rows was the earlier draft's shape and the panel round 3 found plan line 94 still states it; line 87 is right.

**No bulk action.** The spec calls it out. A bulk delete walks branches one by one under one click, and one refusal then hides behind another. Each branch keeps its own ⋯ item, its own reason and its own `confirm`. The test `loose-ends-show-under-unblock.browser.test.ts` "deletes the quiet branches of the group one by one and names each refusal" is deleted, not rewritten, so `EXPECTED_TESTS` goes down by at least one.

**A refusal is a listed, disabled item, never an absent one.** `CleanUpMenu`'s `null` return goes. "Delete branch — claimed, release it first" shows disabled. The loose row's fixed item set is Open, Release claim, Delete branch, and its unit test asserts each item's `enabled`, `reason` and `confirm` (Release claim and Delete branch confirm: both destroy).

**The verb opens the ⋯; it does not run the action.** The plan says the verb opens the menu while `action` resolves to `{ kind: 'act' }` in `delivery-link-targets.ts`, which runs an action: panel round 3 found the two disagree. Pick the menu: add a `{ kind: 'menu', id }` target, keep `action` in `REASON_DO` because the Do link still reads it, and name the `loose` action (today `create-plan`, which is wrong for a loose branch). A unit test asserts the target per reason.

**Every `YouReason` maps to its row kind's item set** (round 3, testability 3). The plan names the verb for all twelve reasons; give each reason's row its fixed item set from its row kind (plan, slice, branch, Tickets) and a unit test. `release-approval` reaches no row (operator decision 2026-11-20): release approval stays in the header's Release group, `placeDelivery` keeps sending release items to `releases`, and no You row reads "Approve release". Its `REASON_DO` entry exists only because `Record<YouReason, …>` demands one.

**Stale claims stay in Work items › Queued**, and `YOU_GROUP_OF` sends only `loose` to unblock. Placement does not change in this slice.

**The group label "Clean up" becomes "Unblock"** (`delivery-view.ts`; browser assertions at `:148` and `:184` of the loose-ends test). The loose browser tests at `:62` and `:86` assert absence of the menu and need rewriting, not deleting.

**`reasonVerb` also feeds `todo-list.ts`**, which the header's You group keeps. The new verbs reach the header; update `packages/domain/test/todo-list.test.ts` in this slice.

**Footer: unread is never "not read".** "◎ N tickets assigned to you have no plan · triage", linked to `#tickets` through plan 2's jump. While the issue read is unread, the footer shows plan 2's amber unread notice with the age of the last good reading, also while the You section holds rows.

**Scope and Mine.** In the `release` scope under Mine `mine` or `strict`, a row of a plan in no active sprint says "no sprint" in the consequence. `rowSprintMembership` has a unit test per cell of {`release`, `my-sprint`} × {`off`, `mine`, `strict`}. Mode `off` shows every row; `selection` stays `[]` in `release` scope.

Rules carried over unchanged: absent is not false (a missing reading is `unread`, never an empty list or `none`); read the exit code, not the emptiness; no hidden UI (a control that cannot run is listed disabled with its reason); every artifact a row names is a plan 1 tuple; new code is arrow functions with factual TSDoc, and a function you rewrite in a `.tsx` file becomes an arrow; the controllers and their refusals do not change and no route is added.

### Done when

The plan's `## Done when` list is the specification. Assertions that exist because a naive implementation would pass without them:

- **Every `YouReason` has a verb, tone and consequence** — `Record<YouReason, …>` under `tsc`; a `Partial` or an `as` cast hides a missing reason.
- **A grouped Unblock row lists each branch with its own reason** — a test with two loose branches, one claimed and one deletable, asserts the claimed one's Delete is disabled with "claimed, release it first" while the other's is enabled; a naive group-level `enabled` fails it.
- **The group carries no bulk control** — a browser test asserts there is no delete button on the Unblock heading.
- **The verb target is a menu, per reason** — a unit test over all twelve reasons.
- **The footer link and the unread notice** — one browser test for each, with the You section holding rows.

Plus: add a changeset that declares its bumps (description first, `bumps:` last); record the `EXPECTED_FILES` / `EXPECTED_TESTS` / `EXPECTED_EXCEPTIONS` delta and its reason in `stubbed-tests-start-no-board.test.ts` and in the PR body (today 101 / 734 / 5). Browser tests this slice edits: `loose-ends-show-under-unblock` (`clean-up-bulk`), `delivery-rows`. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` is not in play; if that changes, growth is paid for in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. On a conflict in `board-server.mjs`, do not read the diff and do not commit the rebuild: restore the generated paths from the merge base (see CLAUDE.md › Testing).

### Scope guard

This branch owns `packages/domain/src/rules/delivery-row-form.ts`, `delivery-placement.ts` (`looseActions`), `delivery-link-targets.ts`, `sprint-selection.ts`, `todo-list.ts` and their tests; in the board, `agent-rows/delivery-view.ts`, `components/CleanUpMenu.tsx`, the You block of `AgentList.tsx`, `loose-ends-show-under-unblock.browser.test.ts` and `delivery-rows` browser test.

Other branches in flight on the same plan: `feature/delivery-work-items-grid` (rewrites `delivery-work-columns.ts` and Work items rows; leave them), the Release delivery unfold (`ReleasePlanParts.tsx`, `StartWorkButton.tsx`) and the Fleet switches slice (`FleetControls.tsx`, Fleet rows in `AgentList.tsx`). Plan 7's `feature/tickets-show-what-the-sprint-delivers-and-found` owns the Tickets rows and `tickets-section.ts`. `AgentList.tsx` is shared with all of them: keep your edits to the You block.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
