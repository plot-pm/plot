# Board shows a plan twice after its plan PR merges and the branch stays

> The Planning tab lists each plan of a merged batch plan PR twice while the idea branch remains on origin; a plan file becomes one card, read from the default branch first.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bugfix-2-28-2
- **Issue:** #2410
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2434 merged

## Changelog

- The board shows one card per plan file after a plan PR merges and its branch is not deleted.

<!-- Board impact: this is a board change in `packages/board/src/server/board.ts`. It changes which plan files the board stages; no plan format, template, helper script or docs/plans layout changes. -->

## Motivation

On ewz-kus-portal (Plot 2.28.0, Bitbucket) plan PR #3719 (`idea/kus-portal-103-jan-plaene`) merged into `develop` with a merge commit. The merge did not delete the source branch. The Planning tab then showed each of the batch's three plans twice in the Design column: six cards, same path, same slug. Deleting the branch on origin removed the duplicates (issue #2410).

A plan PR merged without `--delete-branch` is the normal case on Bitbucket and a common one on GitHub, so every batch merge on such a host produces the duplicates until someone deletes the branch.

## Design

### Approach

`readBranchPlans` (`packages/board/src/server/board.ts`) already skips a path that `origin/<default>` holds (`onDefault.has(relPath)`). The plan reaches the board twice anyway. Two candidate causes, to be told apart by a failing test before any fix:

1. **Stale cache key.** `collectBranchPlans` caches the result of `readBranchPlans` under a key built from the prefixed branches' names and tip SHAs only. The default branch's tip is not in the key. When the plan PR merges, the default branch gains the plan file and the idea branch's tip does not move, so the key is unchanged and the cache returns the list computed while the file was absent from the default branch. The default-branch reader supplies the same path a second time. Deleting the branch changes the key, which matches the observation.
2. **A default branch that the two readers resolve differently**, or an `onDefault` listing that fails and reads as empty (`planPathsInTree` returns an empty set on an unreadable ref). Less likely, since both readers take the same `defaultBranch`.

Fix, in the order the issue asks:

- Add the default branch's tip SHA to the cache key, so a merge invalidates the branch-plan list.
- Drop a branch whose tip is an ancestor of the default branch before its tree is read. Such a branch carries nothing the default branch lacks. The ancestry question is a prefilter, not a decision about whether work landed: a wrong answer shows or hides one card until the next request, and `scripts/check-ancestry-decisions.sh` needs the `prefilter` declaration beside the call. A merge commit keeps the branch tip reachable from the default branch, so the check holds for the Bitbucket case. A squash-merged branch stays ahead of the default branch; the path rule still covers it.
- De-duplicate the staged plans by canonical path as a last step before parsing, with the default-branch reading winning, so no later source can reintroduce a second card for one path.

### Open Questions

- [ ] Which of the two causes holds on ewz-kus-portal? A fixture with a merged-but-not-deleted idea branch and a warm cache shows it.
- [ ] Does `Refs` already offer an ancestry operation, or does the slice add one to the port and to `refs-git.ts`?
- [ ] Should the path de-duplication also key on slug, since the issue allows "path (or slug)"? A rename between branch and default branch gives two paths with one slug.

## Slices

### Fix

- `bug/plans-shown-twice-after-a-plan` — key the branch-plan cache on the default branch tip, skip branches contained in the default branch, and de-duplicate staged plans by path, with a regression test over a merged branch that remains

## Notes

- Source: tracker issue #2410. Nothing was written to the tracker.
- Related code: `readBranchPlans`, `collectBranchPlans` and `branchPlanCache` in `packages/board/src/server/board.ts`; the staging loop in `buildBoard`.
