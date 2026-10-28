## Implementation brief — deliver-passes-a-plan-whose-slices (wave 2: Deliver refusal)

- **Plan (canonical):** docs/plans/2026-10-28-deliver-passes-a-plan-whose-slices.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2827 merged
- **Branch:** `bug/deliver-refuses-unread-branch-items` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** PR review per repo convention

Wave 1 (`bug/deliver-reads-unread-branch-items`, PR #2858) merged and added the parser field this wave reads. Waves 3 and 4 wait on this one.

### What to build

Plan 3853 in ewz-kus-portal names six foreign-repository branches in list items no claim reads, and `deliverabilityOf` still answered `deliverable: true` with `verified 1 branch(es) merged`. Plan 3819 parses zero branches and delivery prints `no branches found in plan — proceeding`. Wave 1 reports such items as `unreadBranchItems` on `PlanRecord`. This wave makes delivery refuse on them.

- `DeliverReadings` (`packages/domain/src/workflows/deliver.ts`) gains the unread items. `DeliverRefusal` gains `slices-unread`. `deliver()` refuses with it after the phase switch, names each item (wave, branch, line) and both repairs (a claim line `` - `<branch>` — <repo>: … → owner/repo#N ``, or `<!-- deferred: <reason> -->`), and does so also when `branches` is empty. Update the function's TSDoc list of refusals.
- `deliverabilityOf` (`packages/board/src/server/controllers/deliverability.ts`) passes `plan.unreadBranchItems` into the `deliver()` readings it builds. Today it passes none.
- `landed()` (`packages/domain/src/rules/deliverable.ts`) answers `not-merged` for a pulse plan with non-deferred unread items, so `allSlicesConfirmed`, the board's Testing column and auto-delivery agree with `deliver()`.
- Step 4b of `skills/plot-deliver/SKILL.md` reports the domain's `slices-unread` refusal and offers no override. Its text follows the domain; it does not decide.

### Settled decisions — do not re-derive

- **Refuse, in the domain, in attended and unattended mode.** Rejected: asking the user in step 4b. Step 4b is prose; `deliverabilityOf` also serves the board, `plot-ask.mjs deliverable` and fleet auto-delivery (`auto-deliver.ts:106`), none of which read step 4b.
- **A deferred item is already excluded by the parser** (wave 1: deferred items never reach `unread_branch_items`). Do not re-filter in the domain; test that an empty list does not refuse.
- **Pulse plan gap, measured at brief time (origin/main):** `git grep unread` over `packages/domain/src/entities/fleet.ts` and `skills/plot/scripts/plot-fleet-scan.sh` returns nothing. Wave 1's plan text says the pulse plan (`PlanSchema`, `fleet.ts` ~:695) carries the field; on main it does not. `landed()` reads the pulse, so this wave must add the field to `PlanSchema` and make `plot-fleet-scan.sh` pass it through, or `landed()` has nothing to read. Verify first with the grep, then add it; report the gap in the PR. Shell growth is paid for under `scripts/check-shell-lines.sh` (below).
- **Absent is not empty.** A pulse plan from an older scan that lacks the field reads as no items (default `[]`), never as a refusal and never as proof of none. Do not make the schema field required in a way that rejects an older pulse.
- **Do not touch** `crossRepoReferences`, `branchesOf` merging by name, or `plot-impl-status.sh`; wave 3 owns them.
- The `owner/repo@branch` form stays dropped: `@` means a commit.

### Done when

The plan's tests for slice 2 are the specification:

- `packages/domain/test/workflows-deliver.test.ts`: readings with unread items refuse `slices-unread` and name each item; no items does not refuse; a plan with zero branches and one unread item refuses.
- `packages/domain/test/deliverable.test.ts` and `auto-deliver.test.ts`: a pulse plan with unread items is `not-merged`, and auto-delivery does not start it. Mutation-check it: with the `landed()` line removed, the test must fail.
- `packages/board/test/unit/deliverability.test.ts`: the 3853 plan text with its one branch merged gives `deliverable: false` (today `true`) with reason `slices-unread`. Make the fixture disagree with the old behaviour, so the test fails on main.

Plus: add a changeset (description first, `bumps:` block last; `plot-deliver` minor or patch by your call, package `plot`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI. Do not run `test:e2e`.

`scripts/check-shell-lines.sh` refuses a pull request whose shipped shell is longer than at its merge base. The `plot-fleet-scan.sh` passthrough adds shell, so remove an equal number of commands elsewhere, or move logic into the domain and ask it through a bundle, and name the removed lines in the PR body. Joining statements with `;` or `&&` is not a payment.

New functions are arrows. Do not rewrite neighbouring declarations.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owned: `packages/domain/src/workflows/deliver.ts`, `packages/domain/src/rules/deliverable.ts`, `packages/domain/src/entities/fleet.ts` (pulse plan field only), `skills/plot/scripts/plot-fleet-scan.sh` (passthrough only), `packages/board/src/server/controllers/deliverability.ts` (passing the items only), `skills/plot-deliver/SKILL.md` step 4b, and their tests. Not owned: `crossRepoReferences`, `plot-impl-status.sh` (wave 3), template, `/plot-idea` and plot skill docs (wave 4), the parser and section 24c (wave 1, merged).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
