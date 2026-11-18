## Implementation brief — delivery-you-blocks-or-feeds (wave 3: Plan rows)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-you-blocks-or-feeds.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-you-plan-rows` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the third of five slices. It waits on `feature/delivery-you-loose-prs` (#3511), which has merged, and so on `-groups` (#3500). Two slices wait on this one in heading order: `-phase-strip`, `-person-comment`. This slice and `-loose-prs` both edit `AgentList.tsx`, which is why they run one after the other.

### What to build

A Draft or Design plan shows under You as one row per slice of that plan, and the same sentence repeats under each. The plan's own text never reaches the row. Measured on the running board on 2026-11-16: "a draft plan needs your input" repeats under every slice of a draft plan, and the rows push the draft plans that need the developer out of view. `nestItems` (`packages/board/src/app/lib/agent-rows/delivery-view.ts:262`) keeps a Draft item out of the nesting with `item.draft !== null` (`:268`), and `AgentList.tsx:1256` renders it through `DraftPlanRowView` (`agent-rows/draft-plan-row.tsx`).

This slice changes three things:

1. **One row per plan, with chips.** In You, a Draft or Design plan is one row. It carries a slice-count chip, an open-question chip, and the first open question with a "+n more" link. Its slices do not show as rows here. The `item.draft !== null` exception in `nestItems` goes for You only; the other sections keep it.
2. **An open-question rule in the domain.** No parser reads a plan's open questions today. Add a rule in `packages/domain/src/rules/` over the plan text: the unchecked `- [ ]` items under its `### Open Questions` and `## Open Points` headings, returned as a count and the first item's text. The board server calls it where it builds a Draft or Design card, beside `rounds` (`packages/board/src/server/board.ts`, around `:3343` and `:2647`), over the plan file it already lists. The card gains the two fields, with schema defaults in `packages/board/src/contract/schema.ts`. `plot-plan-meta.sh` does not change.
3. **A column set for You.** Kind · Item · Status · Do · Age, under headers. `ROW_COLUMNS` (`packages/domain/src/rules/delivery-row-form.ts:18`) stays the set of the sections that keep it, so You gets a set of its own. **Status** holds the item's state ("Draft · not interrogated", "loose · no plan, nobody works on it") and **Do** holds the verb with `›`. There is no BY column, because every row is the reader's.

Where the code is now. Re-read before you edit, because the line numbers drift (the plan cites `delivery-view.ts` and `AgentList.tsx` under paths that moved to `packages/board/src/app/`):

- `packages/board/src/app/lib/agent-rows/delivery-view.ts`: `nestItems`.
- `packages/board/src/app/components/AgentList.tsx`: the You section, `itemTail`, and the `DraftPlanRowView` call.
- `packages/domain/src/rules/delivery-row-form.ts`: `ROW_COLUMNS`, `REASON_STATUS`, `REASON_DO`, `holdersOf`.
- `packages/board/src/server/board.ts` (`summariseFromPulse` call at `:3093`) and `packages/board/src/contract/schema.ts` (`Card.sliceSummary`).

The plan is canonical. This brief is orientation.

### The decisions the plan settles — do not re-derive them

**The slice count reads `Card.sliceSummary.slices`, not `planSliceCount`.** `planSliceCount` is a field of pulse slices, so a Draft plan with no pulse rows carries none, and the chip would read empty exactly where it is needed. `sliceSummary` is set for every plan that names slices (`board.ts:3093`, guarded by `meta.slices.length > 0`).

**The open-question count is a new domain rule, and `plot-plan-meta.sh` does not change.** A shell parser would add lines to a script that `scripts/check-shell-lines.sh` ratchets, and the rule belongs where it can have a unit test. The server calls the rule over the plan file it already reads; it makes no new read and no new route.

**Both headings count.** The plan format has `### Open Questions` under Design and `## Open Points` at the end, and a plan uses either or both. Only unchecked `- [ ]` items count; a resolved `- [x]` item does not.

**Unchecked means absent is not zero.** A plan with neither heading has no open-question count to show, and the chip is absent. A plan with the heading and every item checked has a count of 0. Do not collapse the two.

**The columns are a set of their own for You.** `ROW_COLUMNS` stays the set of the sections that keep it. Changing it moves every other section's table.

**Domain first.** Every chip count, Status value and column set is a domain property with a unit test. The component renders the answer and decides nothing. A new function you write is an arrow, and the unit is the function: leave neighbouring declarations alone.

### Done when

The plan's Done When item for this slice is the specification: a draft plan with five slices and no pulse rows shows as one row with "5 slices", its open-question count and its first open question; You's rows show the columns Kind · Item · Status · Do · Age under headers.

Lift these assertions, because a naive implementation passes without them:

- A draft plan with five slices and **no pulse rows** reads "5 slices". This catches a chip built on `planSliceCount`.
- A plan with an `### Open Questions` heading and an `## Open Points` heading counts the unchecked items of both. This catches a rule that reads one heading.
- A resolved `- [x]` item adds nothing, and a plan with the heading and every item checked reads 0, while a plan with neither heading carries no count. This catches `0` standing for "not read".
- A Draft plan shows as one row in You and its slices show as no rows there, while the same plan keeps its nesting in the other sections. This catches removing the `nestItems` exception everywhere.
- The first open question carries its text, and "+n more" shows only where n is above 0.
- One browser test shows the one-row plan with its chips and the five column headers. Unit tests prove the rule, and the browser test proves the row renders from it.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm build:board` only to look at the result, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Look at the rendered You section in both themes and at 320 px. Add a changeset for the package `@plot-pm/board`, with the description first (at least 20 characters), then the `plan: docs/plans/2026-11-16-delivery-you-blocks-or-feeds.md` line inside the comment block, with no `bumps:` entry, because this slice changes no skill. The slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count. If you need one, pay for the growth in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the one-row plan form in You, the `nestItems` exception for You, the open-question rule and its two card fields, the slice-count chip, and the You column set, with their unit and browser tests.

It does not own: the You groups and markers (merged), the closed-PR reading and the loose buttons (merged), the header counts and phase strip (`-phase-strip`), or `personComment` and `PR_INDEX_VERSION` (`-person-comment`). Do not change `plot-plan-meta.sh`. Do not add a fetch or a route: the row reads the board payload the client already polls.

In flight: the pushed `feature/*` branches were not diffed at brief time. Run `git diff --name-only origin/main...origin/<branch>` at dispatch for `AgentList.tsx`, `delivery-view.ts`, `delivery-row-form.ts` and `board.ts` before you edit them, and expect a textual merge rather than a semantic one where a sibling touches another section.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
