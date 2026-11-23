## Implementation brief — delivery-rows-act-from-one-place (wave 5: Release delivery unfold)

- **Plan (canonical):** docs/plans/2026-11-20-delivery-rows-act-from-one-place.md on main
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/release-delivery-plan-rows-unfold` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is wave 5 of 6 in plan 5 of the sprint "Delivery UI Polish". Its wait has merged: `feature/every-delivery-section-folds` (#3587). The Mine rule, Row menu column (#3622), You rows (#3648) and Work items grid (#3660) slices before it have merged too. The Fleet switches slice comes after it. The design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside the repo; read *Section contents (open)*), with `header-and-sections-v2.html` beside it as the visual reference.

### What to build

Today each Release delivery plan row already unfolds: `PlanName` (`ReleasePlanParts.tsx`) toggles, and `plan.lines` from `planLines` (`release-plan-rows.ts`) render one line per slice with `LineState`, `LineSlice` and `LinePr` in the Release block of `AgentList.tsx`. A slice line shows a heading word, a coloured state word, the slice name, a bare PR tuple and, on a startable slice, a bare `StartWorkButton`. It has no branch, its state is plain text and its action is a loose button beside the text.

Build the slice line as a row of the same shape as every other Delivery row: slice name, PR+branch tuple, a status pill and a ⋯ in the fixed last column. The state word and hue map `LINE_STATE` (`ReleasePlanParts.tsx`) moves into a new domain producer, `slicePills(state)`, over `PlanLine['state']`, and returns the plan 5 `StatusPill` (`packages/domain/src/rules/status-pill.ts`, built by the Work items grid slice). The ⋯ holds Start work, which replaces the bare `StartWorkButton`. Today's information stays: the heading, the waits-for text, the merged time and the jump link of a slice line do not disappear. Name the new domain output `releasePlanSlices` (the plan's `builds:` marker). The plan is canonical; this is orientation. Line numbers in it are from 2026-11-20: search by symbol.

### The decisions the plan settles — do not re-derive them

**The fold exists; do not build a second one.** Plan 2 (`every-delivery-section-folds`) built the section fold, and `PlanName`'s ▸ toggle with `openReleasePlans` and `release-delivery-fold.browser.test.ts` ("keeps an opened plan row open across a fold and a reopen") already hold the per-plan unfold. This slice reshapes what opens. A second toggle, a second open-state store or a new fold control is the naive shape.

**A slice line has no branch today, so the PR+branch tuple cannot be built yet** (panel round 3, user 1). `PlanSliceFact` and `PlanLine` carry no branch, and `StartWorkButton` posts no branch although `/api/dispatch` takes one. Add `branch` to both types, fill it where `factsOf` builds a `PlanSliceFact` in `agent-rows/delivery-view.ts`, and post it from the ⋯ item, so Start work on a slice line starts that slice's branch and not the plan's next eligible one. A slice with no branch reads as an absent segment, never as an empty string drawn as a link.

**The ⋯ grows from `rowMenuOf`; it is not a second menu.** The Row menu column slice (#3622) built `rowMenuOf` with `{ action, label, enabled, reason, confirm }` items per row kind, and `sliceItems` already lists `start-work`. Give the Release delivery slice line its own fixed item set through `rowMenuOf`, and render it through the same menu renderer as the other rows. Start work is listed disabled with its reason where the slice cannot start (not eligible, a card missing, a refused dispatch), never hidden. The ⋯ trigger never shows disabled while it lists an item. A slice line with no action keeps an empty last cell of the same width, so the same-x browser test still holds.

**One pill type, three producers.** The Work items grid slice built `StatusPill` and `workItemPills`. This slice builds `slicePills(state)` only. `agentPills` belongs to the Fleet switches slice: do not build it here. `slicePills` covers all six states of `PlanLine['state']` (`delivered`, `blocked`, `at-a-gate`, `being-built`, `not-started`, `unread`), keeps today's words and hues, and reads `unread` as "not read", never as "not started". Absent is not false.

**Every artifact a row names is a plan 1 tuple.** The slice's PR and branch are one PR+branch tuple built with `artifactTuple`, as the Work items rows do. Do not draw a bare `#N` beside a bare branch.

### Done when

The plan has no `## Done when` section. Its slice line and its Changelog bullet ("Each Release delivery plan row unfolds to its slices: slice name, PR and branch, state and ⋯") are the specification. Assertions that exist because a naive implementation would pass without them:

- **`slicePills` covers every state and keeps today's words** — a unit test over each of the six `PlanLine['state']` values, asserting word and tone; a map that drops `unread` or reads it as "not started" fails it.
- **The slice line's items are fixed and carry their reasons** — a unit test of the slice line's `rowMenuOf` items, asserting each item's `enabled` and `reason` for a startable slice, a slice that waits, a slice with no card and a slice with a refused dispatch.
- **Start work starts the slice's own branch** — a test that the dispatch request carries the line's `branch`; a button that still posts only the plan fails it.
- **A line with no branch builds no branch segment** — a unit test over `planLines` with and without a `branch`.
- **The ⋯ sits in the same last column** — the browser test `release-delivery-fold` asserts that a slice line's ⋯ cell has the left edge of the plan row's ⋯ cell, including a line with no action.
- **Today's information stays** — the heading word, waits-for text, merged time and jump link still render; `release-plan-rows.test.ts` keeps its existing cells.

Plus: add a changeset that declares its bumps (description first, `bumps:` last). Record the `EXPECTED_FILES` / `EXPECTED_TESTS` / `EXPECTED_EXCEPTIONS` delta and its reason in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` and in the PR body (today 101 / 754 / 5). Browser tests this slice edits: `release-delivery-fold` and, where it reads the slice line, `release-delivery-visual`. A builder runs `pnpm build:board` locally to test and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` is not in play; if that changes, growth is paid for in the same change.

Rules carried over unchanged: absent is not false (a missing reading is `unread`, never `none`); every rendered state is a domain property with a unit test, so pill words, item reasons and the branch segment are decided in the domain and the `.tsx` only renders them; no hidden UI; new code is arrow functions with factual TSDoc, and a function you rewrite in a `.tsx` file becomes an arrow; the controllers and their refusals do not change and no route is added.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. On a conflict in `board-server.mjs`, do not read the diff and do not commit the rebuild: restore the generated paths from the merge base (see CLAUDE.md › Testing).

### Scope guard

This branch owns `packages/board/src/app/components/ReleasePlanParts.tsx`, `packages/board/src/app/components/StartWorkButton.tsx`, `packages/domain/src/rules/release-plan-rows.ts` and its test, the slice-line item set in `agent-rows/delivery-view.ts` (`rowMenuOf`, and `factsOf` where it builds a `PlanSliceFact`), and the Release block of `AgentList.tsx`.

Other branches in flight on the same plan: the Fleet switches slice (`FleetControls.tsx`, Fleet rows in `AgentList.tsx`). Plan 3's `feature/folded-sections-summarise-visually` and plan 6's `delivery-activity-has-three-signals` also touch `AgentList.tsx` and the status column: keep your edits to the Release block and leave the status column clean for plan 6's spinner slot. The Work items block and `workItemPills` belong to the merged Work items slice: do not edit them.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
