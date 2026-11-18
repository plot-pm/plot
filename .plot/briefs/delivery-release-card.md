## Implementation brief — delivery-tab-header-and-my-sprint (wave 7: Release card)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-tab-header-and-my-sprint.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-release-card` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This slice waits on `feature/delivery-slice-states` (#3513), `feature/sprint-owner-field` (#3490) and `feature/delivery-tab-todo-list` (#3530). All three merged, so the slice is startable. `feature/delivery-my-sprint-scope` waits on this slice and applies the **My sprint** scope to the cards, so keep the card set in one fact that the scope rule can filter later, and build no toggle here.

### What to build

The Delivery tab has no place that answers "what is the status of the release". The only release surface is the release PR's row under Work items › At a gate, with its **Approve release** button, and a `release-approval` row under You. This slice adds the **release card** to the tab header, next to `FleetCard`, `SprintCard` and `TodoList` (`AgentList.tsx`, about line 1484), and takes the release off both rows.

Each card shows a five-segment progress bar whose segments add up to the total, the number of people whose sprints form the release, the release's state, and the **Approve release** button. Build on what exists on `main`:

- **The bar** is `countSliceStatesOver` (`rules/slice-states.ts`) over the plans that the Active sprints naming the release hold, as `sprintCards` (`rules/sprint-card.ts`) builds it for one sprint. Sum the per-sprint counts with `sumSliceStates`, or count over the union of plan keys, and build no second classification. Where any named plan has no merge answer the bar is `null` and the card says the reading is missing, never a bar of zeros (`sprintCards`'s `readingMissing`).
- **The people** are the distinct Owners of the Active sprints that name the release. Count them through `resolvePerson` and `samePerson` (`entities/person.ts`), as `sprintIsMine` (`rules/sprint-ownership.ts`) does, so `jwloka` and `Jan Wloka` in two sprints count once. A sprint with no Owner adds no person.
- **The button** is `ReleaseApprove.tsx`, which takes an `AgentRow` and reads `releaseReadingOf(row.pr)` and `releaseApprovable` (`rules/release-approvable.ts`). Reuse the component and the rule. Move the component's mount from the row (`rows.tsx:2305`) to the card; do not write a second button or a second enabled/disabled rule.
- **The binding.** A card binds the release row whose `AgentRow.version` equals the card's `Release:` value. `version` is read from `package.json` on the `changeset-release/<base>` branch (`releaseVersion` in `tuple-row.ts`, `schema.ts` `version`).
- **The release leaves the rows.** Remove the release item from You (`youCaseOfItem`'s `approvalOwed === 'release'` arm, `delivery-placement.ts:307`) and from Work items › At a gate. The release then lives on the card and in the to-do list only.
- **The to-do line.** `rules/todo-list.ts` builds its lines from the You placement and lists `release-approval` first in `REASON_ORDER`. Once the placement no longer holds the release, that line must come from the card set instead: "Approve release <version>", marker read from `YOU_GROUP_MARKERS['release-approval']` (blocks delivery), anchor the card. Add the lines to the same array that the three header counts come from.

The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**A release PR with no sprint behind it still gets a card.** The plan's round-2 panel found that removing the release row removes the only Approve button on the tab. A release row that no card binds gets its own card, "Release <version> · no sprint targets it", with an **enabled** Approve button. A naive implementation builds cards from sprints only and the button vanishes whenever no sprint is Active. Assert it with a fixture of one release row and zero sprints.

**Where the Active sprints name different `Release:` values, the header shows one card per value.** Changesets opens one release PR per base branch, so at most one card binds a given PR. A card whose value no release row carries shows its button **disabled** with the reason "no release PR carries <version>". The button is never hidden: controls always show, disabled with the missing criterion (memory: no hidden UI).

**"No release targeted" is a card, not an absence.** Where no sprint names a release and no release row exists, the tab shows one card reading "No release targeted". Where no sprint names a release and a release row exists, the unbound-row card shows instead and "No release targeted" does not.

**The match is a domain rule and it adds no host call.** It reads only the release row already on the payload. Unit-test it in the domain: bound, unbound card, unbound row, two values, none.

**Compare versions in one form.** The sprint's `Release:` is written by a person (`2.35.0`, possibly `v2.35.0`) and `version` is read from `package.json`. `normalizeVersion` (`entities/release.ts`) is the repo's one normaliser. A naive `===` leaves a card unbound over a leading `v`. Assert a `v`-prefixed sprint value binding a bare `version`, and record in the PR body which side you normalise.

**Blocked is reader-independent.** The bar is the slice-states count the plan fixes: the same release reads the same for every reader because the count reads each item's Blocks delivery case before ownership. Do not narrow the bar by the reader or by the Mine filter. A test asserts two readers with different identities get equal counts from one payload.

**The release leaves You and Work items together, in one merge.** Plan 2 kept `release-approval` in Blocks delivery until this slice so the release showed in exactly one place at every merge. Remove both rows and add the card and the to-do line in this one PR; a PR that removes the row and leaves the line to a later slice leaves the tab with no Approve button.

**`release-approval` stays in `YOU_CASES`.** The reason table and its marker are plan 2's and the to-do list reads them. Stop the placement from emitting the reason for a release; do not delete the case, because `REASON_DO` (`delivery-row-form.ts:211`, `release-approve` action) and the marker still feed the line. If you find the case has no reader left, report it rather than deleting it.

**Rules carried over unchanged:** absent is not false (an unread passkey registration or an unread PR reading disables the button with its reason, it does not enable it); every rendered state is a domain property (CLAUDE.md, "Every rendered state is a domain property"), so counts, wording, bindings and disabled states are asserted on the fact and the component does no arithmetic; a function you write is an arrow; a marker or state is never colour alone; icons come from `glyphs.ts` only.

### Done when

The plan's Done When item for this slice is the specification: "one card shows per target `Release:` value and per release row no value names; a card bound to a release row has an Approve button bound to that row's PR and head, an unbound card's button is disabled with its reason, and "No release targeted" shows where no sprint names a release and no release row exists, each asserted in a unit test; the release shows on no row under You or Work items, and with no Active sprint a release PR still has an enabled Approve button."

Lift these assertions, because a naive implementation passes without them:

- A release row and no Active sprint gives one card with an enabled Approve button bound to that row's PR number and `headSha`. This catches cards built from sprints only.
- Two sprints naming `2.35.0` and `2.36.0` with one release row at `2.35.0` give two cards: one enabled and bound, one disabled with "no release PR carries 2.36.0". This catches a card that binds the first row it finds.
- A `v`-prefixed `Release:` binds a bare `version`. This catches a raw string compare.
- The five bar segments sum to the total, and equal `countSliceStatesOver` for the same plans. This catches a second classification.
- The people count is 1 for two sprints whose Owners resolve to one person, and does not count an empty Owner. This catches a count over handle strings.
- No item with `approvalOwed: 'release'` places under You or Work items, and the to-do list still has exactly one "Approve release <version>" line, marked blocks delivery, whose count is in the header's sum. This catches a removed row with a lost line, and a line shown twice.
- The to-do header's three counts still add up to the line count with the release line in them.
- One browser test proves the card shows above the Work items, that the button is present, and that the to-do line scrolls to the card. Run it with `pnpm --filter @plot-pm/board exec vitest related --run --project parallel <file>`, not the whole board suite, and not while the operator's board is open on this machine. Existing browser tests that look for the release row in At a gate or You (grep `data-testid="release-approve"` and `release` rows) move to the card; list the ones you changed in the PR body.
- No horizontal scroll at 320 px and both themes read (plan, *Constraints*). Check both by looking at the rendered tab after `pnpm build:board`, not by reading the diff.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm run typecheck` and the domain typecheck that `plot-local-checks.mjs` prints. Run `pnpm build:board` only to look at the result, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-tab-header-and-my-sprint.md` line inside the comment block, with no `bumps:` entry, because this slice changes no skill. This slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the new release-card fact in `packages/domain/src/rules/` and its export, the release card component, its mount in `AgentList.tsx` beside the other cards, the move of the `ReleaseApprove` mount from the row to the card, the removal of the release item from the You and Work items placement, the "Approve release" to-do line in `rules/todo-list.ts`, and the unit and browser tests of those. It reads `countSliceStatesOver`, `sprintCards`'s per-sprint count, `releaseApprovable` and `YOU_GROUP_MARKERS`, and changes none of their rules.

Other branches in flight, verified at dispatch: `feature/delivery-release-person-cards` (plan `delivery-release-progress-per-plan`, Started 2026-11-18) edits the Release delivery block in `delivery-view.ts` and extracts a per-sprint function from `sprint-card.ts`; keep your edits in `delivery-view.ts` to the removal of the release item and rebase onto its extraction rather than extracting a second one. `feature/delivery-tab-footer` edits the footer and the not-placed block lower in `AgentList.tsx`; keep clear of them. `feature/delivery-my-sprint-scope` waits on this slice: do not add the toggle, the rename, the scope rule, or the removal of the per-sprint report line. The `data-release-line` header belongs to plan 5; leave it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
