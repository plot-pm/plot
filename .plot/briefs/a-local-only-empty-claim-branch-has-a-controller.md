## Implementation brief — the-reaper-keeps-leftovers-that-no (wave 2: Claim branch)

- **Plan (canonical):** `docs/plans/2026-10-27-the-reaper-keeps-leftovers-that-no.md` on `main`
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2758 merged
- **Branch:** `bug/a-local-only-empty-claim-branch-has-a-controller` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2 of 3. Wave 1 (`bug/the-reaper-reads-a-reused-pid-as-a-live-worker`, PR #2785) has merged. `bug/a-deferred-desk-with-a-pushed-head-is-reapable` waits on this wave, because it reuses the `branchGivenUp` rule this wave extracts.

### What to build

`plot-reap.mjs` keeps two local-only empty claim branches as `needs judgment`, although their plan deferred them. Issue #2757, ticket #2705. Both carry `<!-- deferred: moved to a-row-is-a-tuple … -->` in `docs/plans/2026-08-20-waiting-on-you-says-what-kind-of-waiting.md:361-362`, a Released plan. `claimDisposition` (`packages/board/src/server/entry/reap.ts:1024`) reads only the Active index (`activeDir`, `:1180-1182`) and matches annotation text with `line.includes(...)`, so it never sees a delivered or released plan.

The controller for the removal already exists: `runClaimKind` (`reap.ts:1045`) calls `ctx.trees.deleteBranch` when `claimDisposition` answers `abandoned`. Change only what feeds it:

1. Add one domain rule, `branchGivenUp`, in `packages/domain/src/rules/`. It answers true when at least one plan's parser reports the branch's slice as `intent: 'deferred'` (`slicesDeferred`, `entities/plan.ts:250`), and no plan in the Active index schedules the same branch as an `active` slice (`branchesWanted`, `entities/plan.ts:231`). The parser reports `deferred` for both `deferred:` and `moved:`.
2. `claimDisposition` reads every plan under the configured `Plan directory` (active, delivered and released), parses each through the plan parser, and asks `branchGivenUp`. It answers `abandoned` or `unresolved` as before.
3. `firstClaimRefusal` (`rules/sweepable.ts`) stays unchanged. The report reason stays `abandoned claim (plan says deferred/moved)`.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**An unannotated local-only empty claim stays `needs judgment`.** Deleting every local-only empty claim would race a dispatch between its local claim commit and its push (`agent-loop.ts:723`, `auto-design.ts:734-741`). The operator chose the narrow rule in panel round 1.

**The removal belongs to the reap entry, not to `plot-dispatch.sh --release`.** `--release` answers "holds no claim" (`plot-dispatch.sh:2186-2190`) because its claim is the remote lock, which is correct for its scope. Add no shell to it.

**The annotation word does not carry the meaning.** 8 of the `<!-- deferred: … -->` annotations under `docs/plans/` say "moved to" another plan, and 7 use `<!-- moved: … -->`. Read `intent`, not the word.

**A slice that moved and continues on the same branch is not given up.** If an Active-index plan schedules the branch as an `active` slice, both kinds keep it. Both #2705 branches pass the rule: the receiving plan `2026-08-20-a-row-is-a-tuple.md` is Released and names them in a table and in prose, not as slices.

**Wrong *given up* costs little here.** The claim kind deletes only a wholly empty claim (`isWhollyEmptyClaim`), so the worst case is one empty commit. Keep that guard.

Carried over from related work: absent is not false. A plan that cannot be read or parsed is no evidence of a deferral; the branch stays `unresolved`.

### Done when

The plan's `## Design › Acceptance › Claim branch` list is the specification. Assertions that exist because a naive implementation passes without them:

- A local-only empty claim annotated `deferred:` in a plan linked only from `delivered/` reads `would` and `--yes` deletes it. A fix that widens only the Active-index text match leaves this red.
- The same for a Released plan that neither index links. It catches a fix that reads the Delivered index but not the plan directory.
- Kept: an unannotated local-only empty claim (`test/reconcile/sweep.test.mjs:294-308` stays green unedited); a `deferred:` branch that an Active-index plan schedules as an active slice; a claim branch that carries a real file (`sweep.test.mjs:310`); a branch checked out in a worktree. These catch an over-eager deletion.
- Domain unit tests cover `branchGivenUp` with `deferred:`, `moved:` and `deferred: moved to …`, and with the active-slice exception.
- `quiet-kinds-render.browser.test.ts:159` stays unchanged: the report text does not change.

Plus: tests that run the built `plot-reap.mjs` need `pnpm build:board` first; restore the generated bundle before push (`scripts/check-no-bundle-diff.sh`). Add a changeset (description first, `bumps:` block last). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice needs no shell. Write new domain functions as arrows, with TSDoc that states what the export does and returns, not the history of the decision.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `claimDisposition` and its call chain in `packages/board/src/server/entry/reap.ts`, the new `branchGivenUp` rule and its unit test under `packages/domain/`, and new tests under `test/reconcile/`.

Other branches in flight: the deferred-desk slice of this plan touches `markerRecordsWork`, `rules/reapable.ts` and `rules/sweepable.ts`. Do not edit those. Keep your `reap.ts` diff to `claimDisposition`, `runClaimKind`'s call site and the plan-directory resolution near `:1180`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
