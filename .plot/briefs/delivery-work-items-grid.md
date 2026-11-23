## Implementation brief — delivery-rows-act-from-one-place (wave 4: Work items grid)

- **Plan (canonical):** docs/plans/2026-11-20-delivery-rows-act-from-one-place.md on main
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/delivery-work-items-grid` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is wave 4 of 6 in plan 5 of the sprint "Delivery UI Polish". Its waits have merged: `feature/mine-means-mine-or-my-plan` (#3590) and `feature/delivery-section-empty-kinds` (#3596); the Row menu column (#3622) and You rows (#3648) slices before it have merged too. Plan 6 (`delivery-activity-has-three-signals`) waits on this branch, because its spinner slot sits before the status column built here. The Release delivery unfold and Fleet switches slices come after it. The design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside the repo; read *Section contents (open)*), with `work-items-columns.html` beside it for the grid and `header-and-sections-v2.html` as the visual reference.

### What to build

Today a Work items row has the columns `WORK_ITEM_COLUMNS = ['kind', 'item', 'where', 'group', 'by', 'age']` (`packages/domain/src/rules/delivery-work-columns.ts`), with one column per group (Gates, Progress, Waits on) whose value is a text cell. Status text is cut off, the person sits inside the status text, and the `where` value takes a column of its own.

Build one grid for every group: item tuple, plan tuple, status pills, by, age, ⋯. The `kind` column goes, because the tuple's icon says the kind. The `where` value becomes the branch segment of the item's PR+branch tuple, and that segment gives way (ellipsis, full value on hover). The status column sizes to its content and never cuts a pill. Status is one pill type, `StatusPill { word, tone, href | null }`. This slice builds `workItemPills(placement, facts, sprint)`, which maps each `GroupValueKind` (`gate`, `progress`, `wait`) to pills: each gate from `gatesCell` (`delivery-row-form.ts`) is one pill whose dot reads `parts[].outcome` and which keeps its link to its checks or review page; Progress (PR state and unpushed count) and Waits on ("claimed 2 days ago, no work committed") become pills with whole words; "claimed on another machine" is a quiet pill; and the `rowSprintMembership` answer `no sprint` is a grey pill. `workByCell` stays, and the person moves from the status text to By. Plan blocks keep their indented slice rows. Empty groups render as plan 2's "— none" rows in the new grid. `delivery-work-columns.test.ts` is rewritten to the new columns, not deleted. The plan is canonical; this is orientation. Line numbers in it are from 2026-11-20 morning: search by symbol.

### The decisions the plan settles — do not re-derive them

**The grid follows the spec, not the mockup.** `work-items-columns.html` draws Item, Where, Status, By, Age and no Plan column. The spec and the plan say item tuple, plan tuple, status. Do not copy the mockup's columns.

**One pill type, three producers.** An earlier draft had one `statusPills` signature; panel round 2 replaced it with `workItemPills`, `slicePills(state)` and `agentPills(state)`, each with its own unit test. This slice builds `StatusPill` and `workItemPills` only. `slicePills` belongs to the Release delivery unfold slice and `agentPills` to the Fleet switches slice: define `StatusPill` where both can import it from the domain, and do not build their producers here.

**`rowSprintMembership` exists; do not rebuild it.** The You rows slice (#3648) built `rowSprintMembership(item, activeSprints, view)` in `packages/domain/src/rules/sprint-selection.ts`, with a unit test per cell of {`release`, `my-sprint`} × {`off`, `mine`, `strict`}. It answers `no sprint` or `null`. This slice reads the answer for the grey pill, and `AgentList.tsx` already computes `membership` and `sprintView` for the You rows: reuse them, do not compute a second sprint view.

**A gate pill keeps its link.** Today `gatesCell` returns marks with `parts` whose links go to the checks or the review page, and `AgentList.tsx` renders them through `RowCell`. A pill that reads the outcome and drops the `href` is the naive shape: the dot is right and the link is gone. Carry `href` from the part.

**The person moves to By, and status stays person-free.** `workByCell` is unchanged. A status pill that still says "claimed by <name>" duplicates By.

**A column holds one kind of value.** Today's `groupCellItem` and `replacesStatus` in `AgentList.tsx` exist because Progress and Waits on replace the status word. In the new grid every group's value is a pill in the one status column, so both go; a group that falls back to `row.status` today (`group ?? row.status`) has an explicit pill rule instead.

**Release approval, stale claims and placement do not change.** `placeDelivery` is untouched. A stale claim stays in Work items › Queued.

Rules carried over unchanged: absent is not false (a missing reading is `unread`, never an empty list or `none`); read the exit code, not the emptiness; no hidden UI (a control that cannot run is listed disabled with its reason); every artifact a row names is a plan 1 tuple; every rendered state is a domain property with a unit test, so the pill words, tones and hrefs are decided in the domain and the `.tsx` only renders them; new code is arrow functions with factual TSDoc, and a function you rewrite in a `.tsx` file becomes an arrow; the controllers and their refusals do not change and no route is added.

### Done when

The plan has no `## Done when` section. Its slice line and its Changelog bullet for Work items are the specification: one grid of item, plan, status, by, age, ⋯; status as pills with a coloured dot and whole words, never cut; the branch segment of the item tuple gives way. Assertions that exist because a naive implementation would pass without them:

- **A gate pill keeps its link and reads its outcome** — a unit test over `workItemPills` for a gate with a link and one without; a dot-only pill fails it.
- **Every `GroupValueKind` has a pill rule** — the unit test covers `gate`, `progress` and `wait`, and the "claimed on another machine" quiet pill and the grey `no sprint` pill each have a cell.
- **Status is never cut, the branch segment gives way** — one browser test in `delivery-work-items.browser.test.ts` asserts a long status keeps its full words while a long branch is ellipsised with the full value on hover.
- **No `kind` or `where` column remains** — `WORK_ITEM_COLUMNS` has no `kind` or `where` entry, asserted in `delivery-work-columns.test.ts`.
- **"— none" rows land in the new grid once** — an empty group renders plan 2's row inside the grid, not beside it.

Plus: add a changeset that declares its bumps (description first, `bumps:` last); record the `EXPECTED_FILES` / `EXPECTED_TESTS` / `EXPECTED_EXCEPTIONS` delta and its reason in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` and in the PR body (today 101 / 744 / 5). Browser test this slice edits: `delivery-work-items`. A builder runs `pnpm build:board` locally to test and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` is not in play; if that changes, growth is paid for in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. On a conflict in `board-server.mjs`, do not read the diff and do not commit the rebuild: restore the generated paths from the merge base (see CLAUDE.md › Testing).

### Scope guard

This branch owns `packages/domain/src/rules/delivery-work-columns.ts` and `packages/domain/test/delivery-work-columns.test.ts`, the status-pill type and `workItemPills` in the domain, `packages/board/src/app/styles/delivery-work-items.css`, the Work items block of `AgentList.tsx`, `agent-rows/delivery-view.ts` where it builds the Work items plan blocks and slice rows, and `delivery-work-items.browser.test.ts`.

Other branches in flight on the same plan: the Release delivery unfold (`ReleasePlanParts.tsx`, `StartWorkButton.tsx`, `release-plan-rows.ts`) and the Fleet switches slice (`FleetControls.tsx`, Fleet rows in `AgentList.tsx`). Plan 6's `delivery-activity-has-three-signals` waits on this branch and adds a spinner slot before the status column: leave a clean status column for it. Plan 7's `feature/tickets-show-what-the-sprint-delivers-and-found` owns the Tickets rows and `tickets-section.ts`. `AgentList.tsx` is shared with all of them: keep your edits to the Work items block.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
