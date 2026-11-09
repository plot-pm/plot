# The state branch ahead count grows without limit after the first squash-merge

> The count of commits the state branch is ahead of the default branch starts at the last commit whose tree equals the default tree, so a squash-merge resets it instead of leaving it at the commits since the branch began.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #3314
- **Review:** pr
- **Impl:** own branches

## Changelog

- The board's state-branch lag line and the sync pull request body count only the state-branch commits made after the default branch last held the state tree. A state branch squash-merged into the default branch reports `0 ahead` until it receives a new commit, and then reports only the new commits.

Board impact: yes. The board's lag line reads the count. The plan format, the plan template, the helper scripts and the `docs/plans` layout do not change.

## Motivation

**A squash-merge leaves the state branch's commits unreachable from the default branch.** `commitsBetween(defaultRef, trackRef)` runs `git log <defaultRef>..<trackRef>`, so after the first sync PR squash-merges, every commit the state branch has ever carried still counts. The count only grows. The board's lag line and the sync PR body then report commits as pending that the default branch already holds.

Source: review of PR #3292 (`feature/state-branch-sync`), MEDIUM 1, on head 3a0116c4d. #3292 corrected the changeset wording (`0 ahead` only while the state tree equals the default tree) and left the count unchanged. Issue: #3314.

## Design

### Approach

**Decision (Jan Wloka, 2026-11-09): the count is the number of commits on the state branch since the last commit whose tree equals the default branch's tree.** The alternative, counting changed record files, was not chosen.

- The rule takes the state branch's first-parent commit list, newest first, each with its tree id, and the default branch's tree id. It returns the index of the first commit whose tree equals the default tree. That index is the count.
- A tip whose tree equals the default tree returns 0.
- With no tree-equal commit, the count is the commits between the merge base and the tip, as today (`<defaultRef>..<trackRef>`).
- The rule lives in `packages/domain/src/rules/` as a pure function over those readings. The workflow reads the tree ids through the `Refs` port; a port method for "tree id of a commit" is added if none exists. No adapter code changes the rule.
- One count feeds every reader: the board's lag line, the sync PR body, the `syncPrDecision` refresh comparison (`refreshed.ahead` against the new count), and `recordsAhead` in `record-listing.ts`. `recordsAhead` calls the same rule, so the Read slice and the Sync slice cannot disagree; keeping a second count would reproduce the defect in one of them.
- The opposite direction, `commitsBetween(trackRef, defaultRef)` as the `behind` input to `forwardSync`, keeps its current meaning. Only the ahead direction changes.
- A refresh recorded before the change carries the old count. The comparison sees a difference, refreshes the open PR once, and records the new count.

**Dependency.** `commitsBetween`, `syncPrDecision` and the sync PR body live on `feature/state-branch-sync` (PR #3292, open on 2026-11-09), not on `main`. `recordsAhead` is on `main`. The slice starts after #3292 merges.

### Open Questions

- [x] Which `Refs` method reads a commit's tree id? A new `treeOf` or a widening of `commitSubjects`; the implementer checks the port first. → Left to the builder: check the `Refs` port first and add the smaller of the two.
- [x] A state branch with merge commits: the rule walks first-parent history. Confirm that matches how fleetd writes the branch (fast-forward pushes only, so no merges expected). → The premise does not hold: fleetd's forward sync merges the default branch into the state ref (`ForwardSyncDecision` `merge` in `packages/domain/src/rules/state-sync.ts`), so the state branch carries merge commits. The rule walks first-parent history and stops at the first commit whose tree equals the default branch's tree; every commit on that walk counts, except a forward-sync merge (a merge whose second parent is on the default branch), which carries default-branch content and no record. A forward merge right after a squash leaves the trees equal, so the count reads 0. A test covers a state branch with a forward-sync merge.

## Slices

### Count rule

- `bug/the-state-branch-ahead-count-grows` — one ahead-count rule in `packages/domain`, read by the lag line, the sync PR body, `syncPrDecision` and `recordsAhead`. Tests: a state branch squash-merged into the default branch and given two new commits reports 2 ahead; a state branch whose tip tree equals the default tree reports 0; a state branch with no tree-equal commit reports the merge-base count. <!-- builds: aheadSinceTreeEqual, the one ahead-count rule for the state branch -->

## Notes

- Created from issue #3314 by `/plot-idea`, stopped at Draft. Definition of Done: docs/definition-of-done.md.
