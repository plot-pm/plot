# The bundle gate refuses the repair it prints

> The bundle-commit gate accepts a commit that stages a generated path when the staged content equals `origin/<default>`'s content, and its repair text restores from `origin/<default>`.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2970
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- The bundle-commit gate allows a commit that stages a generated bundle path whose content equals `origin/<default>`, and its refusal prints a restore from `origin/<default>`.

<!-- Board impact: none. The change touches the commit gate and its rule in the domain package; no plan format, template, helper script table or docs/plans layout changes. -->

## Motivation

A branch that carries an old copy of a generated bundle cannot be repaired by an agent. Measured 2026-10-31 on PR #2965:

- `plot-bundle-commit-gate.sh` refuses a `git commit` whose index stages any path in the generated set (`bundleCommitPaths`, `packages/domain/src/rules/bundle-commit.ts`). "Staged" means different from `HEAD` (`Refs.stagedPaths`).
- The refusal prints `git restore --staged --worktree --source=<merge base> -- <path>`. When `HEAD` holds a different copy than the merge base, the restored path is still staged against `HEAD`, so the next commit is refused again.
- The `feature/fleetd-starts-the-fixer` desk restored its bundles from merge base `e57b2aa2a` to finish one merge. That left older copies than `main`. On the next merge of `origin/main`, 17 files under `skills/plot/scripts/board/` conflicted, every commit that took `main`'s copy was refused, and the desk spent its last correction and stopped with `PLOT-BLOCKED`.
- A master-agent repair hit the same refusal. `git merge -X theirs origin/main` resolved 7 conflicting bundles without a `git commit` call; 5 more (`plot-gate.mjs`, `plot-reconcile.mjs`, `plot-release-gate.mjs`, `plot-slice-pr.mjs`, `plot-worker-loop.mjs`) still differ from `origin/main`. Restoring them needs a commit that stages them, which the gate refuses, so a person must run that commit.
- Earlier conflict merges passed only because their branches already held `main`'s bundles, so the merge commit staged none.

The commit that removes a branch's bundle diff is the one `scripts/check-no-bundle-diff.sh` asks for in CI. The local gate refuses exactly that commit.

## Design

### Approach

1. **Allow a staged path that equals the default branch.** A staged generated path is allowed when its staged content (blob id) equals the blob at the same path on `origin/<default>`. Every other staged generated path stays refused, as now. A path `origin/<default>` does not hold has no blob to equal, so it stays refused.
2. **Print a repair the gate accepts.** The refusal names `git restore --staged --worktree --source=origin/<default> -- <path>` for a path `origin/<default>` holds, and `git rm --cached <path>` for one it never held. The merge base stops being the restore source, because it is the wrong source whenever it differs from `origin/<default>`.
3. **Keep the rule in the domain.** `bundleCommitPaths` and `bundleCommitRefusal` in `packages/domain/src/rules/bundle-commit.ts` decide; the reading of blob ids goes through the `Refs` port (`packages/domain/src/ports/refs.ts`) and its git and fixture adapters. `packages/board/src/server/entry/gate.ts` collects readings and calls the rule; it decides nothing. The rule is an arrow function, per the domain package style.
4. **Name the default branch from config.** The gate reads `origin/main` as a literal today (`gate.ts`, `mergeBase('HEAD', 'origin/main')`). The new reading uses the host's default branch instead, so a repository whose default branch is not `main` gets the same behaviour.

### Open Questions

- [ ] Should the merge base reading stay at all? The repair no longer uses it, but `bundleCommitRefusal` refuses with no repair when no merge base resolves; the new reading may make that case unnecessary.
- [ ] What does the gate do when `origin/<default>` cannot be resolved (no remote, scratch fixture)? Today `mergeBase === null` refuses without a repair. Candidate: keep refusing, since the equality cannot be proven.
- [ ] `git restore --staged --worktree --source=origin/<default>` stages the default branch's copy, but a rename or a deleted-on-default path needs `git rm --cached`. Confirm the two repair forms cover every staged status `StagedPath` carries.
- [ ] A corpus or contract test should hold the gate against `check-no-bundle-diff.sh`: a commit the CI check accepts is never refused locally. Decide whether that is a corpus pair or a contract test.

## Slices

### Gate

- `feature/the-bundle-gate-refuses-the-repair` — the bundle-commit rule allows a staged generated path equal to `origin/<default>`, prints a restore from `origin/<default>`, and the gate collects the blob-id readings; tests cover a merge-base copy that differs from `HEAD`, a staged copy equal to `origin/<default>`, a staged copy that differs from it, and a path `origin/<default>` never held <!-- builds: bundleCommitRefusal allowing a staged path equal to origin/default -->

## Notes

- Issue: https://github.com/plot-pm/plot/issues/2970. The blocked PR is #2965.
- Related: `scripts/check-no-bundle-diff.sh`, the CI side of the same rule.
