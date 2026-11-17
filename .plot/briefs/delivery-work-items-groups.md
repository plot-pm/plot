## Implementation brief — delivery-work-items-show-gates (wave 1: Groups and columns)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-work-items-show-gates.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-work-items-groups` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the first of four slices. It waits on `feature/delivery-section-header` (#3484) and `feature/delivery-you-groups` (#3500), and both have merged. Three slices of this plan wait on it in heading order: `-gate-cells`, `-progress`, `-by-chips`. Plan 1's `feature/delivery-slice-states` and plan 5's `feature/delivery-release-plan-rows` wait on this slice and not on the gate cells, so this is the critical path: ship the groups and columns and nothing else.

### What to build

Work items has three groups today (At a gate, Being built, Queued) and every row has the same seven columns, with one `status` column that holds "complete", "merged", "waiting on approval" and "2 complete" in turn. Measured on the running board on 2026-11-16: no column carries a header, and one column holds four kinds of value.

This slice changes what the section shows and nothing about what a gate or an agent looks like:

1. **The header.** "<n> at a gate · <n> being built · <n> queued · oldest waits <age>", each count linking to its group. "Oldest waits" is the age of the oldest row in the section. Build it on the `SectionView` summary that `feature/delivery-section-header` added (`summarise`, `delivery-view.ts:157`); add the oldest-age fact to that summary and build no second view type.
2. **A group column in the place of `status`.** Columns in Work items are Kind · Item · Where · (group column) · By · Age. The group column is **Gates** for At a gate, **Progress** for Being built and **Waits on** for Queued, and each group renders a column header. One column holds one kind of value. This slice fixes the columns and their headers and leaves the cells to the next two slices: Gates keeps today's single gate string until `-gate-cells`, Progress and Waits on carry what `status` carries today for their rows until `-progress`.
3. **What Queued holds.** Slices of approved plans that have a branch or a claim and no live agent (`stage: 'building'` with no live agent and no stopped agent, and `stage: 'queued'`), and the items You does not admit because they are another person's: their Draft or Design plans and the approvals they owe (`ownership === 'theirs'`). Ticket rows are not in Queued after `feature/delivery-tickets-section`.
4. **The Where column.** The PR with the full branch name beneath it, never shortened.

Where the code is now. Re-read before you edit, because three branches moved these files this week:

- `packages/domain/src/rules/delivery-placement.ts`: `WorkItemGroup` (`:25`), the section/group list (`:15`), `workGroup` (`:292`), the `'theirs'` item that falls to Queued (`:404`).
- `packages/domain/src/rules/delivery-row-form.ts`: `ROW_COLUMNS` (`:13`), the `status` cell in `itemRowCells` (`:220`) and its `statusOf` switch.
- `packages/board/src/app/lib/agent-rows/delivery-view.ts`: `GROUP_LABELS` (`:36-38`), `SectionView` and `summarise` (`:143-167`), the held count at `:419`.
- `packages/board/src/app/lib/agent-rows/delivery-row-facts.ts`: `rowFormsOf` (`:84`), which `AgentList.tsx:1128` calls.
- `packages/board/src/app/components/AgentList.tsx`: the group heading markup and the row render. Mine modes filter through `mine-filter.ts`.

The plan is canonical. This brief is orientation.

### The decisions the plan settles — do not re-derive them

**The group column replaces `status` in Work items only, and `ROW_COLUMNS` stays.** `ROW_COLUMNS` is the column set of the rows that keep it. Plan 5 gives Release delivery's plan rows a set of their own (Plan · Phase · Slices · Owner) and plan 2 gave You one. Do not rename `status` for the other sections and do not delete it: `delivery-row-form.test.ts` and the You tests read it. Add a Work items column set beside it, so a test can assert that no Work items group renders a `status` column. A naive implementation renames the shared column and breaks You and the plan-5 slice in one diff.

**One column holds one kind of value, per group.** At a gate holds gates, Being built holds progress, Queued holds a wait. A row never shows a gate under Progress. A unit test per group that asserts its column name and the kind of the values catches a single shared column with a per-row label.

**Another person's Draft and Design plans and approval-owed items stay in Queued** (Jan Wloka, 2026-11-16). Round 1 moved them out, and the decision reversed it. The placement already sends a `'theirs'` item with a You case to Work items › Queued (`delivery-placement.ts:404`); keep that, and assert it in a unit test. Do not add a reason or a group for it.

**"Oldest waits" is the oldest row in the section, not in a group.** It is the largest age across all three groups' rows. A row with no age reading yields no age, never `0`: an absent reading is not zero. A section with no aged row prints no "oldest waits" clause. A test with an empty Queued and an aged At-a-gate row catches an implementation that takes the oldest of the first group only.

**Zero counts stay in the header and an empty group has no body.** Plan 1's header slice settled this; the counts "0 queued" stay and no empty heading renders. Reuse `summarise` and its link targets.

**Plan 1's slice states count a Queued slice as being built.** Queued holds no state of its own, so do not add a slice state or a `blocked` meaning here. Plan 1's `feature/delivery-slice-states` owns that.

**A slice that has not started (no branch, no agent) is not a row here, and this slice does not remove it.** Plan 5's `feature/delivery-release-plan-rows` removes those rows through `isUnbegun` (`row-identity.ts:77`) and gives the eligible ones today's Start (`dispatch`) control on their To do line. If this slice removes them, Start disappears for a whole release. Leave `AgentList.tsx`'s Start control and its rows as they are, and name in the PR that the rows remain.

**The release row under At a gate keeps its form** until plan 1's `feature/delivery-release-card` removes it. It gets the At a gate group column like its neighbours and nothing else.

**Rules carried over from related work:** an absent reading is not a false one (an `unread` gate stays a `null` cell, `delivery-row-form.ts:215-216`). The domain decides and the component renders: every header count, the oldest age, each column name and each group's membership is a domain property with a unit test, and a browser test proves only that the page shows it. A function you write is an arrow, and the unit is the function: leave the neighbouring declarations alone. `localAhead` stays out of any key (`row-identity.ts:418`).

### Done when

The plan's Done When item for this slice is the specification: every group in Work items shows its own column under a header, and no column holds two kinds of value; the header counts each group, each count linking to its group, and names the oldest row's age, asserted in a unit test; Queued holds approved plans' slices with a branch or claim and no live agent, and another person's Draft or Design plan and approval-owed item, asserted in a unit test; Where shows the PR with the full branch name beneath it.

Lift these assertions, because a naive implementation passes without them:

- Three groups, three column names, three kinds of value, in one test over a payload with a row in each group. This catches one shared column relabelled per row.
- An item with `ownership: 'theirs'` and a Draft plan places in Queued, and its Waits on column renders the value `status` rendered before (the person-aware wait is `-progress`). This catches a slice that drops another person's items.
- A payload with an aged Queued row and an unaged At-a-gate row: the header names the Queued row's age. A payload with no aged row prints no "oldest waits". This catches the first-group oldest and the false zero.
- A branch name of 60 characters renders in full under its PR, and a row with no PR renders the branch alone. This catches truncation.
- A not-started slice of an approved plan still renders its Start control. This catches the plan-5 overreach.
- One browser test proves a Work items header shows its counts and that a count link reaches its group, and one proves the column headers appear. Check a 320 px viewport and both themes by looking at the rendered tab, not by reading the diff.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm build:board` only to look at the result in a browser, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan:` line and the `bumps:` block last. This slice touches no `.sh` file; if it does, `scripts/check-shell-lines.sh` refuses growth, and the shell is paid for in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the Work items header, group columns, group membership and Where cell: `delivery-placement.ts` (`workGroup`, the Queued fallthrough), `delivery-row-form.ts` (the Work items column set and the group column in `itemRowCells`), `delivery-view.ts` (`SectionView`, `summarise`, `GROUP_LABELS`), `delivery-row-facts.ts`, the group and column markup in `AgentList.tsx`, and the unit and browser tests of those. It does not change `gateValue`, `GATE_MARK`, `CardPr` links, the Progress or Waits on values, the By cell, `AgentRole` or the fleet payload: those belong to `-gate-cells`, `-progress` and `-by-chips`, and the role chip to plan 4's `feature/delivery-agent-roles`.

Three branches are pushed on 2026-11-17 and touch the same files (`git diff --stat origin/main...origin/<branch>`):

- `feature/delivery-fleet-agent-rows` (#3509) changes `delivery-row-form.ts` by about 209 lines, `delivery-row-facts.ts` and `delivery-row-form.test.ts`. This is the closest collision: it owns the Fleet section's rows, and you share `itemRowCells`' neighbours. Rebase on it if it merges first, and keep your edits to the Work items column set so the merge stays mechanical.
- `feature/delivery-you-loose-prs` (#3511) changes `delivery-placement.ts`, `delivery-view.ts`, `delivery-readings.ts` and `AgentList.tsx` around the loose-branch rows. Your `workGroup` edit is a few lines from its change.
- `feature/delivery-tab-footer` (#3507) changes `AgentList.tsx` by about 107 lines, at the footer and not at the sections.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
