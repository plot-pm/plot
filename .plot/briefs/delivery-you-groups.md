## Implementation brief — delivery-you-blocks-or-feeds (wave 1: Groups and markers)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-you-blocks-or-feeds.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-you-groups` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the first of five slices, and it is the largest. It waits on `feature/delivery-section-header` (#3484) and `feature/delivery-tickets-section` (#3492), and both have merged. Four slices wait on it in heading order: `feature/delivery-you-loose-prs`, `-plan-rows`, `-phase-strip`, `-person-comment`. Plan 1's `feature/delivery-slice-states` and `feature/delivery-tab-todo-list` also read the case and marker this slice exports.

### What to build

The You section has three groups today: Input to the fleet, Review a result and Unblock. Every You row carries a reason sentence under it. Measured on the running board on 2026-11-16, "a draft plan needs your input" repeats under every slice of a draft plan, and the sentence is the same for every row of a group. Mine modes also filter You, so a reader with unknown ownership sees an empty Unblock.

This slice changes the placement rule and what renders from it:

1. **Three new groups**, in this order: `blocks-delivery` (red), `input-to-the-fleet` (blue), `unblock` (grey, labelled "clean up"). Review a result folds into Blocks delivery. Unblock holds `loose` only.
2. **A marker per case**, as a field of the case. The case is `{ group, reason, marker }`.
3. **The PR rule** in `youCase`: the Correction budget arm (`fleet-stuck`) and the Auto-review arm (`review-pr`) both place under Blocks delivery. Otherwise a slice PR is a Work items gate.
4. **You admits every item whose ownership is not `'theirs'`**, in every Mine mode. The `mineAllows(input.mine, …)` test at the You placement no longer applies to You.
5. **The reason line is removed**, and the group tables follow the fold.

Where the code is now. The plan's line numbers drifted, and the board moved from `src/client` to `src/app`. Re-read before you edit:

- `packages/domain/src/rules/delivery-placement.ts`: `YouGroup` (`:21`), the section/group list (`:14`), `YouReason` (`:126`), `youCase` (`:205-229`), `mineAllows` (`:200`), the You placement (`:340`).
- `packages/domain/src/rules/delivery-row-form.ts`: `REASON_STATUS` (`:107`), `REASON_DO` (`:122`), `holdersOf` (`:376`).
- `packages/board/src/app/lib/agent-rows/delivery-view.ts`: group labels (`:33-34`), `REASON_WORDS` and `reasonWords` (`:45-59`), the slice line's `blocked` count (`:437`).
- `packages/board/src/app/lib/agent-rows/delivery-link-targets.ts:106`: reads `'unblock'`.
- `packages/board/src/app/components/AgentList.tsx`: the reason line (`:1163-1169`) and the loose-branch buttons (`:1170-1178`).
- Tests: `packages/domain/test/delivery-placement.test.ts` names the old group ids; six board tests import the rule.

The `ticket-assigned` reason in the plan's table no longer exists: `feature/delivery-tickets-section` removed it. Add nothing for it.

The plan is canonical. This brief is orientation.

### The decisions the plan settles — do not re-derive them

**The reason-to-group table is fixed.** `draft-plan` is Input to the fleet. `plan-approval`, `spike-approval`, `release-approval`, `test-delivered-plan`, `review-pr`, `blocked-marker`, `fleet-stuck`, `merge-conflict` and `agent-died` are Blocks delivery. `loose` is Unblock. `release-approval` stays in Blocks delivery until plan 1's `feature/delivery-release-card` removes the row. Add no `person-comment` reason: slice 5 adds it.

**The case comes from the item, and ownership decides who sees it.** `youCase` reads the item alone. Export the case with its group and marker so plan 1 counts a blocked slice the same way for every reader. A naive implementation folds ownership into the case, and then plan 1's count differs per reader.

**You admits `ownership !== 'theirs'`, not `=== 'mine'`.** Round 1 chose `'mine'`, and it emptied Unblock: a loose branch with no PR reads `'unknown'` (`ownership.ts:287-288`), and so does every PR where the host login is not read (`ownership.ts:103-108`), which includes every Bitbucket repository. A `'theirs'` item with a You case falls to `workGroup` and shows under Work items › Queued. Keep `mineAllows` for tickets and for the `filtered` check; it is no longer a You test.

**The Auto-review arm keeps the `ci === 'passed'` guard.** A PR whose CI runs or failed with Auto-review off stays a gate under Work items; only a passed CI moves it to Blocks delivery (Jan Wloka, 2026-11-16). A test with a running CI and Auto-review off catches an arm that drops the guard.

**The Correction budget arm keeps today's `fleet-stuck` case whole:** `gateUnpassable`, or a failed CI or HIGH review with `corrections >= correctionBudget`. It only changes group.

**`holdersOf` keys on the reason, not the group.** Today it ties `autoReview` to the `review-a-result` group. After the fold, `review-pr` and `test-delivered-plan` sit in Blocks delivery beside `plan-approval`, so a group-keyed switch note would name `autoReview` on a group of approvals. Key `autoReview` to `review-pr`, `autoVerify` to `test-delivered-plan`, and `autoDesign` to `draft-plan` in Input to the fleet. A header test per switch catches a switch note on the wrong group.

**The reason line goes; the Status cell keeps its words.** Remove the line and `REASON_WORDS`/`reasonWords` if nothing else reads them (grep first: `card-presentation.ts` has its own `reasonWords`, which is a different function — leave it). `REASON_STATUS` stays.

**The slice line's `blocked` count must not change meaning.** `delivery-view.ts:437` counts You items with group `unblock`. After the fold that group holds `loose` only, and Blocks delivery also holds approvals, so neither new group equals the old set. Count the same reasons the old `unblock` group held (`blocked-marker`, `fleet-stuck`, `merge-conflict`, `agent-died`, `loose`), through the exported case, so the line's number for existing inputs stays the same. Plan 1's slice-states slice owns any later change to that meaning. A test that puts an approval under Blocks delivery and asserts the count does not move catches the naive `group === 'blocks-delivery'`.

**Rules carried over from related work:** an absent reading is not a false one — `looseOf` returning `unread` still means `unplaced`, never loose. The domain decides and the component renders: every group, marker, header text and Status value is a domain property with a unit test, and a new function you write is an arrow. The unit is the function: leave the neighbouring declarations alone.

### Done when

The plan's Done When item for this slice is the specification: every `YouReason` places in the group the table names with its marker, each in a unit test; the reason line under a You row is gone; the Correction budget arm and the Auto-review arm each place a PR under Blocks delivery; a PR whose CI runs or failed with Auto-review off, and a PR with neither arm, place under Work items; You shows the same rows in every Mine mode; a `'theirs'` item shows under Work items › Queued; a loose branch with `'unknown'` ownership shows under Unblock in every Mine mode; the case and its marker are exported.

Lift these assertions, because a naive implementation passes without them:

- A loose branch with `'unknown'` ownership under `strict`, `loose` and `off`: Unblock in all three. This catches `=== 'mine'`.
- The same item with `'theirs'`: Work items › Queued in all three modes, and absent from You.
- Two readers (`'mine'`, `'unknown'`) of one blocked slice: the same exported case. This catches ownership folded into the case.
- A PR with CI `running`, Auto-review off, no spent budget: Work items › At a gate. A PR with CI `passed`, review `pending`, Auto-review off: Blocks delivery with `review-pr`. The same PR with Auto-review on: Work items.
- Group headers: `autoReview` named on no group except where `review-pr` rows sit.
- The slice line's blocked count with an approval added: unchanged.
- No `data-placement-reason` line renders; one browser test proves the three group headings show with their markers (red, blue, grey "clean up"). Unit tests prove placement and markers.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm build:board` only to look at the result, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Look at the rendered You section in both themes and at 320 px. Add a changeset for the package `@plot-pm/board`, with the description first (at least 20 characters), then the `plan: docs/plans/2026-11-16-delivery-you-blocks-or-feeds.md` line inside the comment block, with no `bumps:` entry, because this slice changes no skill. The slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count. If you need one, pay for the growth in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the You groups and markers in `delivery-placement.ts`, the group-keyed tables in `delivery-row-form.ts` and `delivery-view.ts`, the `'unblock'` read in `delivery-link-targets.ts`, the reason line in `AgentList.tsx`, and their unit and browser tests.

It does not own: closed-PR placement and the Delete/Release rules (`-loose-prs`), the one-row plan form, columns and open-question rule (`-plan-rows`), the header counts and phase strip (`-phase-strip`), or `personComment` and `PR_INDEX_VERSION` (`-person-comment`). Do not add the `person-comment` reason, change `looseOf` or bump the index version.

In flight, verified 2026-11-17 with `git diff --name-only origin/main...origin/feature/delivery-machine-line`: `feature/delivery-machine-line` changes `AgentList.tsx`, `delivery-view.ts`, `delivery-view.test.ts` and `agents-tab.browser.test.ts`, which this branch also edits. Its edits sit in the Machine section and the footer, not You. Keep yours to the You rows and group tables, and expect a textual merge in those four files, not a semantic one. The other pushed `feature/*` branches (`a-merged-pending-check-is-asked-again`, `jenkins-reads-in-process-cutover`, `one-pr-reader-per-machine-and`) share no delivery code with this branch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
