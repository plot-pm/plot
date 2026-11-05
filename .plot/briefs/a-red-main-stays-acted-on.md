## Implementation brief — open-plot-review-findings-from-the (wave 3: Red main)

- **Plan (canonical):** docs/plans/2026-11-03-open-plot-review-findings-from-the.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3075 merged
- **Branch:** `bug/a-red-main-stays-acted-on` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` on the PR, per the plan's `Review: pr`

This slice waited on `feature/fleetd-merges-as-the-merger-app`. That slice merged as PR #3085, so nothing blocks it. `bug/a-high-gets-its-own-fixer-attempts` (Fixer attempts) edits the same `slice-pr-next.test.ts` and lands in either order. Whichever merges second rebases.

### What to build

Three fixes to the red default branch repair, all findings of the 2026-10-29 review gate (issue #2926). Read the plan's `## Design › Red default branch repair` first: it is canonical, this is orientation.

1. **A green re-run no longer ends an episode that a later commit keeps red.** `redMainStep` (`packages/domain/src/rules/repair.ts`) answers `close-prs` for `rerunSettled === 'green'` in the `idle`/`rerun` branch without reading the settled commit. If the first red SHA re-runs green (a flake) while a later SHA is settled red, the repair tick falls through to `none` on `close-prs` (`packages/fleet/src/shared/repair-start.ts`, the final `return 'none'`), the revert tick answers `await-rerun`, and `keepsRepairRecord` keeps the record. No repair and no revert starts, and the red stays. **Fix:** `redMainStep` reads `reading.settled` before it answers `close-prs` on a green re-run, and answers `close-prs` only while the settled reading is green. A green re-run of `firstRedSha` with a later SHA settled red answers a repair step (`start-repair`) and closes nothing. The record is not replaced, so a person's recorded `repairPr` stays.
2. **The revert branch check compares the number.** `isRevertBranch` accepts any `bug/revert-<n>`. `repairBranchMatches` (`packages/domain/src/rules/repair-pr.ts`) takes the `revert` role on that shape alone. Compare `<n>` with `RepairRecord.revertedPr` (`entities/repair-record.ts`), which `makeRevert` in `revert-start.ts` writes before it opens the revert PR. A record with no `revertedPr` refuses `repair-branch-mismatch`. Correct the docstring on `isRevertBranch` ("The record holds no number for the reverted PR" is false), and make the `wanted` text in `repairMergeVerdict`'s refusal name the expected `bug/revert-<revertedPr>` where it is known. The record schema does not change.
3. **The revert re-asks both SHAs (LOW).** `makeRevert` re-asks `record.firstRedSha` only (`runsForSha(reading.branch, record.firstRedSha)`). Re-ask the settled SHA too, and open the revert only when both read red. The `firstRedSha` re-ask stays: it stops a revert of a PR whose red was a flake.

### Decisions the plan settles — do not re-derive them

- **No new field, no version bump.** `revertedPr` already exists and is written before the revert PR opens. The check narrows the accepted branch shape and does not move the trust boundary, because `revertedPr` lives in the same record as `revertPr`.
- **The revert tick keeps passing `rerunSettled: 'none'`.** Fix 1 lives in `redMainStep`, one layer, and neither caller changes how it reads the re-run. Do not add the re-run read to the revert tick.
- **`episodeOpen` does not change.** A settled green already closes the episode there. Fix 1 closes the second path, a green re-run read against a red settled commit.
- **Pin the same-SHA case with a test and name your answer in the PR.** If `settled.sha === record.firstRedSha` and settled reads red while the re-run reads green, the two readings of one commit disagree for one beat. The plan's sentence covers a later SHA only. Pick the answer that closes nothing wrongly and holds nothing forever, and say which in the PR body.
- **Rules carried over:** a stale reading never reverts (`defaultBranchRed` gates every later answer); the index never says no, so a missing `revertedPr` refuses and never admits; a held host answer writes nothing.

### Done when

The plan's `### Red main tests` list is the specification. Each new test must fail on `origin/main` and pass with the fix:

- `packages/domain/test/repair.test.ts`: `a green re-run answers none` (now at `:123`, name says none, asserts `close-prs`) changes; its input gains a green settled reading. New: `a green re-run of the first red SHA with a later SHA settled red answers a repair step`. It catches a fix that only edits the existing case.
- `packages/domain/test/repair-pr.test.ts`: the `isRevertBranch` table (`:78-83`) changes, because the check takes `revertedPr`. New: `refuses repair-branch-mismatch for bug/revert-<n> where n differs from revertedPr`, `refuses repair-branch-mismatch for a record with no revertedPr`. Keep the shape cases (`bug/revert-0`, `bug/revert-12x`, `feature/bug/revert-12`) refusing.
- `packages/domain/test/slice-pr-next.test.ts` (`admits the revert PR the open episode names from bug/revert-<pr>`, now near `:541`; the plan said `:468`) and `packages/domain/test/workflows-merge.test.ts:507`, and `repair-pr.test.ts:137`: the fixtures carry a matching `revertedPr`. Any other existing test that fails is a regression.
- `packages/fleet/test/unit/revert-start.test.ts`: `opens no revert PR when the first red SHA re-runs green and the settled SHA reads red`, `closes no PR while the settled reading is red`. Feed a real `runsForSha` fake per SHA; a fake that answers one value for every SHA passes without fix 3.

Plus: add a changeset with `plot` or `@plot-pm/board` as the package, the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows. This slice touches no `.sh` file, so none is expected to move. The domain package takes arrow functions only (`export const f = (…) => …`), factual TSDoc, and no history in comments. `redMainStep`'s docstring bullets (`idle` or `rerun`, and the closed-episode bullet) change with fix 1.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to this branch's line under `### Red main` in the plan's `## Slices`. Push the first real commit as soon as it exists.

Docs for this slice: `CLAUDE.md` paragraph *One hold reads a non-terminal answer* (the `bug/revert-<pr>` rule now compares `revertedPr`) and the `plot-ask.mjs repair-pr` sentence if it names the revert branch, then `./scripts/check-agents-md.sh --write` so `AGENTS.md` follows. Slice 1 (`bug/the-merge-gate-bounds-an-unknown-head`) edits the same paragraph for `default-branch-unsettled`; the second to merge rebases.

### Scope guard

This branch owns: `packages/domain/src/rules/repair.ts`, `rules/repair-pr.ts`, `packages/fleet/src/shared/revert-start.ts`, `CLAUDE.md` and `AGENTS.md` for the paragraph above, and the tests named above. `repair-start.ts` is read, and changes only if fix 1 needs it; say so in the PR if it does.

In flight beside it, verified at dispatch:

- `bug/a-high-gets-its-own-fixer-attempts` (same plan, claimed) edits `rules/slice-pr-next.ts`, `rules/fixer-attempts.ts`, `rules/ticket.ts`, `auto-fixer.ts`, `auto-ticket.ts` and `slice-pr-next.test.ts`. Touch only the `bug/revert-<n>` fixture in that test file.
- `bug/the-merge-gate-bounds-an-unknown-head` (same plan, waits on #3074) edits `workflows/merge.ts`. `workflows-merge.test.ts:507` changes here for the fixture only; do not touch `merge()`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
